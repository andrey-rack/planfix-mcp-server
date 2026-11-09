import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveAllowedUploadPath } from "./planfix_upload_file.js";

describe("resolveAllowedUploadPath", () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pf-up-")));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pf-out-")));
    fs.writeFileSync(path.join(root, "ok.txt"), "x");
    fs.writeFileSync(path.join(root, ".hidden"), "x");
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "sub", "a.txt"), "x");
    fs.writeFileSync(path.join(outside, "key"), "secret");
    fs.symlinkSync(path.join(outside, "key"), path.join(root, "link"));
    fs.writeFileSync(path.join(root, "big.bin"), "");
    fs.truncateSync(path.join(root, "big.bin"), 26 * 1024 * 1024);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("is disabled when no upload folder is configured", () => {
    expect(() => resolveAllowedUploadPath("ok.txt", "")).toThrow(/disabled/);
  });

  it("allows relative and absolute paths inside the folder", () => {
    expect(resolveAllowedUploadPath("ok.txt", root)).toBe(path.join(root, "ok.txt"));
    expect(resolveAllowedUploadPath("sub/a.txt", root)).toBe(path.join(root, "sub", "a.txt"));
    expect(resolveAllowedUploadPath(path.join(root, "ok.txt"), root)).toBe(path.join(root, "ok.txt"));
  });

  it("refuses files outside the folder", () => {
    expect(() => resolveAllowedUploadPath(path.join(outside, "key"), root)).toThrow(/outside/);
    expect(() => resolveAllowedUploadPath("/etc/hosts", root)).toThrow(/outside/);
  });

  it("refuses path traversal", () => {
    const rel = path.relative(root, path.join(outside, "key"));
    expect(() => resolveAllowedUploadPath(rel, root)).toThrow(/outside/);
    expect(() => resolveAllowedUploadPath("sub/../../x", root)).toThrow();
  });

  it("refuses hidden files", () => {
    expect(() => resolveAllowedUploadPath(".hidden", root)).toThrow(/Hidden/);
  });

  it("refuses a symlink that points outside the folder", () => {
    expect(() => resolveAllowedUploadPath("link", root)).toThrow(/outside/);
  });

  it("refuses files over 25 MB and directories", () => {
    expect(() => resolveAllowedUploadPath("big.bin", root)).toThrow(/25 MB/);
    expect(() => resolveAllowedUploadPath("sub", root)).toThrow(/regular file/);
  });
});
