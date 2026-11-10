import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_NOTICE, serverInstructions, skillInstalled } from "./skillNotice.js";

const fakeHome = () => mkdtempSync(join(tmpdir(), "pf-skill-"));

describe("skillNotice", () => {
  it("is missing in an empty home and present once SKILL.md exists", () => {
    const home = fakeHome();
    expect(skillInstalled(home, {})).toBe(false);
    mkdirSync(join(home, ".claude", "skills", "planfix"), { recursive: true });
    writeFileSync(join(home, ".claude", "skills", "planfix", "SKILL.md"), "x");
    expect(skillInstalled(home, {})).toBe(true);
  });
  it("PLANFIX_SKILL_CHECK=0 silences the check (skill lives in the Claude chat account)", () => {
    expect(skillInstalled(fakeHome(), { PLANFIX_SKILL_CHECK: "0" })).toBe(true);
  });
  it("the hint tells the user what to do, without any secret", () => {
    expect(SKILL_NOTICE).toMatch(/install\.sh/);
    expect(SKILL_NOTICE).toMatch(/planfix-skill\.zip/);
    expect(serverInstructions(false)).toMatch(/NOT installed/);
    expect(serverInstructions(true)).not.toMatch(/NOT installed/);
  });
});
