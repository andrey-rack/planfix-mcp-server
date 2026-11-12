import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers.js")>();
  return {
    ...actual,
    planfixRequest: vi.fn(),
    planfixRedirectLocation: vi.fn(),
    fetchBytesNoAuth: vi.fn(),
    log: vi.fn(),
  };
});

import { fetchBytesNoAuth, planfixRedirectLocation, planfixRequest } from "../helpers.js";
import planfixGetTaskCommentsTool from "./planfix_get_task_comments.js";
import { assertAllowedDownloadUrl, getFile, kindFromName, sniffType } from "./planfix_get_file.js";

const request = vi.mocked(planfixRequest);
const location = vi.mocked(planfixRedirectLocation);
const download = vi.mocked(fetchBytesNoAuth);

const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.alloc(20)]);
const S3 = "https://planfix.s3.eu-west-1.amazonaws.com/acct/1/file.wav?X-Amz-Signature=abc";
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pf-dl-"));

beforeEach(() => vi.clearAllMocks());

describe("sniffType: audio and text only, decided by content", () => {
  it("recognises the audio formats", () => {
    expect(sniffType(wav, "a.wav")).toEqual({ mimeType: "audio/wav", ext: "wav" });
    expect(sniffType(Buffer.from("ID3\u0004\u0000\u0000"), "a.mp3")?.ext).toBe("mp3");
    expect(sniffType(Buffer.from([0xff, 0xfb, 0x90, 0x00]), "a.mp3")?.ext).toBe("mp3");
    expect(sniffType(Buffer.from("OggS\u0000\u0002"), "a.ogg")?.ext).toBe("ogg");
    expect(sniffType(Buffer.from("fLaC\u0000\u0000"), "a.flac")?.ext).toBe("flac");
    expect(sniffType(Buffer.from("\u0000\u0000\u0000\u0018ftypM4A "), "a.m4a")?.ext).toBe("m4a");
  });
  it("accepts UTF-8 text only when the name says text", () => {
    expect(sniffType(Buffer.from("Привіт, світ"), "note.txt")?.mimeType).toBe("text/plain");
    expect(sniffType(Buffer.from("Привіт"), "note.exe")).toBeUndefined();
    expect(sniffType(Buffer.from([0x68, 0x00, 0x69]), "note.txt")).toBeUndefined(); // NUL byte
    expect(sniffType(Buffer.from([0xff, 0xfe, 0xfd, 0xc3]), "note.txt")).toBeUndefined(); // invalid UTF-8
  });
  it("refuses executables and images even if the name claims audio", () => {
    expect(sniffType(Buffer.from("MZ\u0090\u0000\u0003"), "call.wav")).toBeUndefined();
    expect(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "call.wav")).toBeUndefined();
    expect(sniffType(Buffer.from("#!/bin/sh\nrm -rf ~\n"), "call.wav")).toBeUndefined();
  });
  it("kindFromName is only a listing hint", () => {
    expect(kindFromName("Запис дзвінка 10-09-2026.WAV")).toBe("audio");
    expect(kindFromName("brief.txt")).toBe("text");
    expect(kindFromName("setup.exe")).toBe("other");
  });
});

describe("assertAllowedDownloadUrl: the pre-signed link must be on a known host", () => {
  it("accepts Planfix's own bucket and explicitly added hosts", () => {
    expect(assertAllowedDownloadUrl(S3).hostname).toBe("planfix.s3.eu-west-1.amazonaws.com");
    expect(assertAllowedDownloadUrl("https://files.example.com/x", ["files.example.com"]).hostname).toBe("files.example.com");
  });
  it.each([
    "http://planfix.s3.eu-west-1.amazonaws.com/x",
    "https://evil.example.com/x",
    "https://planfix.s3.eu-west-1.amazonaws.com.evil.com/x",
    "https://user:pw@planfix.s3.eu-west-1.amazonaws.com/x",
    "https://planfix.s3.eu-west-1.amazonaws.com:8443/x",
    "https://other-bucket.s3.amazonaws.com/x",
    "file:///etc/passwd",
    "not a url",
  ])("refuses %s", (bad) => {
    expect(() => assertAllowedDownloadUrl(bad, [])).toThrow();
  });
});

describe("getFile", () => {
  const meta = (name: string, size = 3) => request.mockResolvedValueOnce({ file: { id: 7, name, size } });

  it("saves audio under a name built from the id, never from the Planfix file name", async () => {
    const dir = tmpDir();
    meta("../../etc/Запис дзвінка.wav");
    location.mockResolvedValueOnce(S3);
    download.mockResolvedValueOnce(wav);
    const res = await getFile({ fileId: 7 }, dir);
    expect(res.error).toBeUndefined();
    expect(res.savedPath).toBe(path.join(fs.realpathSync(dir), "planfix-file-7.wav"));
    expect(res).toMatchObject({ mimeType: "audio/wav", sizeBytes: wav.length });
    expect(fs.readFileSync(res.savedPath!).equals(wav)).toBe(true);
    expect(fs.statSync(res.savedPath!).mode & 0o777).toBe(0o600);
    expect(download.mock.calls[0][1]).toBe(25 * 1024 * 1024);
  });

  it("is disabled without a download folder, and does not touch the network", async () => {
    const res = await getFile({ fileId: 7 }, "");
    expect(res.error).toMatch(/disabled/);
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses the home directory and the filesystem root as a download folder", async () => {
    expect((await getFile({ fileId: 7 }, os.homedir())).error).toMatch(/dedicated/);
    expect((await getFile({ fileId: 7 }, "/")).error).toMatch(/dedicated/);
  });

  it("refuses non-audio/text names before downloading anything", async () => {
    meta("payload.exe");
    const res = await getFile({ fileId: 7 }, tmpDir());
    expect(res.error).toMatch(/audio and text/);
    expect(location).not.toHaveBeenCalled();
  });

  it("refuses files over 25 MB (size is in KB) before downloading", async () => {
    meta("long.wav", 25 * 1024 + 1);
    const res = await getFile({ fileId: 7 }, tmpDir());
    expect(res.error).toMatch(/25 MB/);
    expect(location).not.toHaveBeenCalled();
  });

  it("refuses a download location on an unknown host and never fetches it", async () => {
    meta("a.wav");
    location.mockResolvedValueOnce("https://evil.example.com/steal");
    const res = await getFile({ fileId: 7 }, tmpDir());
    expect(res.error).toMatch(/not allowed/);
    expect(download).not.toHaveBeenCalled();
  });

  it("does not save content that is not audio or text, whatever the name says", async () => {
    const dir = tmpDir();
    meta("call.wav");
    location.mockResolvedValueOnce(S3);
    download.mockResolvedValueOnce(Buffer.from("MZ\u0090\u0000 this is an executable"));
    const res = await getFile({ fileId: 7 }, dir);
    expect(res.error).toMatch(/not audio or text/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("never puts the signed link into an error message", async () => {
    meta("a.wav");
    location.mockResolvedValueOnce(S3);
    download.mockRejectedValueOnce(new Error("Could not download the file from the storage link"));
    const res = await getFile({ fileId: 7 }, tmpDir());
    expect(JSON.stringify(res)).not.toContain("X-Amz");
  });

  it("replaces an earlier copy and refuses to write through a symlink", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "planfix-file-7.wav"), "old");
    meta("a.wav");
    location.mockResolvedValueOnce(S3);
    download.mockResolvedValueOnce(wav);
    expect((await getFile({ fileId: 7 }, dir)).error).toBeUndefined();

    const dir2 = tmpDir();
    const victim = path.join(dir2, "victim.txt");
    fs.writeFileSync(victim, "keep");
    fs.symlinkSync(victim, path.join(dir2, "planfix-file-7.wav"));
    meta("a.wav");
    location.mockResolvedValueOnce(S3);
    download.mockResolvedValueOnce(wav);
    await getFile({ fileId: 7 }, dir2);
    expect(fs.readFileSync(victim, "utf8")).toBe("keep");
  });
});

describe("comments list their attachments", () => {
  it("returns files with a kind, and omits the field when there are none", async () => {
    request.mockResolvedValueOnce({
      comments: [
        { id: 1, type: "Comment", files: [{ id: 11, size: 245, name: "Запис дзвінка.wav" }] },
        { id: 2, type: "Comment" },
      ],
      totalCount: 2,
    });
    const res = (await planfixGetTaskCommentsTool.handler!({ taskId: 5 })) as {
      comments: { id: number; files?: { id: number; kind: string; sizeKb?: number }[] }[];
    };
    expect(res.comments[0].files).toEqual([{ id: 11, name: "Запис дзвінка.wav", sizeKb: 245, kind: "audio" }]);
    expect(res.comments[1]).not.toHaveProperty("files");
    expect(JSON.stringify(request.mock.calls[0][0])).toContain("files");
  });
});
