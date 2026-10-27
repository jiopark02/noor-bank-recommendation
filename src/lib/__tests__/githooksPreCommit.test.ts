// Execution tests for .githooks/pre-commit. Each case makes a temp repository
// whose core.hooksPath is this repo's .githooks directory, runs a real
// git commit, and asserts the exit code and whether the commit count moved.
//
// Run: npm run test   (vitest)

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const HOOKS = path.resolve(__dirname, "../../../.githooks");
const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function mustGit(cwd: string, args: string[]) {
  const r = git(cwd, args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// One commit on main, made before the hook is enabled, then core.hooksPath
// pointed at .githooks.
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "githooks-pre-commit-"));
  dirs.push(dir);
  mustGit(dir, ["init", "-q"]);
  mustGit(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  mustGit(dir, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "init"]);
  mustGit(dir, ["config", "core.hooksPath", HOOKS]);
  return dir;
}

const commitCount = (dir: string) => Number(mustGit(dir, ["rev-list", "--count", "HEAD"]));
const commit = (dir: string) => git(dir, [...IDENTITY, "commit", "-q", "--allow-empty", "-m", "change"]);

describe(".githooks/pre-commit", () => {
  it("refuses a commit on main and leaves the history unchanged", () => {
    const dir = makeRepo();
    const r = commit(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("committing on main is blocked");
    expect(commitCount(dir)).toBe(1);
  });

  it("allows a commit on another branch", () => {
    const dir = makeRepo();
    mustGit(dir, ["checkout", "-q", "-b", "feature"]);
    const r = commit(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(commitCount(dir)).toBe(2);
  });

  it("allows a commit on a detached HEAD", () => {
    const dir = makeRepo();
    mustGit(dir, ["checkout", "-q", "--detach"]);
    const r = commit(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(commitCount(dir)).toBe(2);
  });
});
