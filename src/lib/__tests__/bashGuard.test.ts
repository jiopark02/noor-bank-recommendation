// Execution tests for the Claude Code PreToolUse guard in
// .claude/hooks/bash-guard.cjs. Each case spawns the real script with the hook
// input JSON on stdin and asserts the exit code (2 = blocked, 0 = pass) and,
// for blocks, the stderr reason.
//
// Run: npm run test   (vitest)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SCRIPT = path.resolve(__dirname, "../../../.claude/hooks/bash-guard.cjs");

function run(command: unknown, cwd?: string) {
  const input = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    cwd: cwd ?? process.cwd(),
    tool_input: { command },
  });
  const r = spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

function runRaw(input: string) {
  const r = spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

// A fresh repository in a temp directory, with core.hooksPath set to
// hooksPath when given and, unless hookFile is false, a .githooks/pre-commit
// file. The guard lets a commit through only where core.hooksPath is
// ".githooks" and that file exists.
function makeRepo(hooksPath?: string, hookFile = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bash-guard-repo-"));
  for (const args of [["init", "-q"], ...(hooksPath ? [["config", "core.hooksPath", hooksPath]] : [])]) {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  if (hookFile) {
    fs.mkdirSync(path.join(dir, ".githooks"));
    fs.writeFileSync(path.join(dir, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  }
  return dir;
}

// Forward slashes: an unquoted backslash is an escape to bash, and to the guard.
const slash = (p: string) => p.replace(/\\/g, "/");

const HEREDOC_COMMIT_WITH_TRAILER = [
  "git commit -m \"$(cat <<'EOF'",
  "Fix the thing",
  "",
  "Co-Authored-By: Someone <someone@example.com>",
  "EOF",
  ')"',
].join("\n");

const HEREDOC_COMMIT_MENTIONING_RULES = [
  "git commit -F - <<'EOF'",
  "Block git add -A and sed -i in the guard",
  "",
  "It doesn't stop git push --force via eval (that's a known gap).",
  "EOF",
].join("\n");

const SUBSTITUTION_COMMIT_MENTIONING_RULES = [
  "git commit -m \"$(cat <<'EOF'",
  "Don't run git add -A (it stages everything)",
  "EOF",
  ')"',
].join("\n");

describe("bash-guard: blocks", () => {
  const cases: Array<[string, string]> = [
    ["git add -A", "whole-tree staging"],
    ["git add --all", "whole-tree staging"],
    ["git add .", "whole-tree staging"],
    ["git add -- .", "whole-tree staging"],
    ["git add -u", "whole-tree staging"],
    ["git add --update", "whole-tree staging"],
    ["git add :/", "whole-tree staging"],
    ["git add -vA", "whole-tree staging"],
    ["cd /c/dev/noor && git add -A", "whole-tree staging"],
    ["git -C /c/dev/noor add -A", "whole-tree staging"],
    ['bash -c "git add -A"', "whole-tree staging"],
    ["git commit -a -m x", "commit -a"],
    ["git commit --all -m x", "commit -a"],
    ["git commit -am x", "commit -a"],
    ['git commit -m "x" -m "Co-Authored-By: A <a@example.com>"', "Co-Authored-By"],
    ['git commit -m "x\n\nco-authored-by: A <a@example.com>"', "Co-Authored-By"],
    [HEREDOC_COMMIT_WITH_TRAILER, "Co-Authored-By"],
    ["git push --force", "force push"],
    ["git push -f origin main", "force push"],
    ["git push --force-with-lease", "force push"],
    ["git push --force-with-lease=main:abc origin main", "force push"],
    ["git push -uf origin main", "force push"],
    ["git push origin +main", "force push"],
    ["sed -i 's/a/b/' x", "sed -i"],
    ["sed -i.bak 's/a/b/' x", "sed -i"],
    ["sed --in-place 's/a/b/' x", "sed -i"],
    ["sed -ni 's/a/b/p' x", "sed -i"],
    ["sed 's/a/b/' -i x", "sed -i"],
    ["grep -l foo * | xargs echo; sed -i 's/a/b/' x", "sed -i"],
  ];

  for (const [command, reason] of cases) {
    it(`blocks: ${JSON.stringify(command)}`, () => {
      const r = run(command);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(reason);
    });
  }
});

describe("bash-guard: commit -F file", () => {
  let dir: string;
  beforeAll(() => {
    // A repository with the hooks path set, so only the -F rule decides.
    dir = makeRepo(".githooks");
    fs.writeFileSync(path.join(dir, "with.txt"), "Fix\r\n\r\nCo-Authored-By: A <a@example.com>\r\n");
    fs.writeFileSync(path.join(dir, "without.txt"), "Fix the thing\n");
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("blocks a -F file that carries the trailer (relative to the hook cwd)", () => {
    const r = run("git commit -F with.txt", dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Co-Authored-By");
  });

  it("blocks --file=<absolute path> that carries the trailer", () => {
    // Forward slashes: an unquoted backslash is an escape to bash, and to the guard.
    const abs = path.join(dir, "with.txt").replace(/\\/g, "/");
    const r = run(`git commit --file=${abs}`, dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Co-Authored-By");
  });

  it("passes a -F file without the trailer", () => {
    expect(run("git commit -F without.txt", dir).status).toBe(0);
  });

  it("passes a -F file that does not exist (git reports that itself)", () => {
    expect(run("git commit -F missing.txt", dir).status).toBe(0);
  });
});

describe("bash-guard: passes", () => {
  // Commit cases need a repository with the hooks path set; the others ignore cwd.
  let repo: string;
  beforeAll(() => {
    repo = makeRepo(".githooks");
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const cases: string[] = [
    'echo "git add -A"',
    'grep -n "sed -i" f',
    "git add -- ./path",
    "git add .gitignore src/a.b.ts",
    "git add -- src/u.ts",
    "git add src/x.ts",
    HEREDOC_COMMIT_MENTIONING_RULES,
    SUBSTITUTION_COMMIT_MENTIONING_RULES,
    'git commit -m "fix"',
    'git commit -m "fix sed -i usage"',
    'git commit -m"add a test"',
    "git commit --amend --no-edit",
    "git log --grep=Co-Authored-By",
    "git push origin main",
    "git push -u origin chore/x",
    "git push origin HEAD:refs/heads/x",
    "sed -n 's/i/x/p' f",
    "sed -e 's/i/x/' f",
    "sed -n 1p CLAUDE.md",
    "npx vitest run > /c/Temp/out.txt 2>&1; echo \"exit=$?\"",
    "git diff --no-index -- /dev/null src/new.ts >> /c/Temp/new.diff",
  ];

  for (const command of cases) {
    it(`passes: ${JSON.stringify(command)}`, () => {
      const r = run(command, repo);
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    });
  }
});

describe("bash-guard: commits must reach .githooks/pre-commit", () => {
  let hooked: string;
  let unhooked: string;
  let noHookFile: string;
  beforeAll(() => {
    hooked = makeRepo(".githooks");
    unhooked = makeRepo();
    noHookFile = makeRepo(".githooks", false);
  });
  afterAll(() => {
    for (const d of [hooked, unhooked, noHookFile]) fs.rmSync(d, { recursive: true, force: true });
  });

  const blocked: Array<[string, string]> = [
    ['git commit --no-verify -m "x"', "--no-verify"],
    ['git commit --no-veri -m "x"', "--no-verify"],
    ['git commit -n -m "x"', "--no-verify"],
    ['git commit -nm "x"', "--no-verify"],
    ['git --attr-source HEAD commit -n -m "x"', "--no-verify"],
    ['git -c core.hooksPath=/tmp commit -m "x"', "core.hooksPath"],
    ['git -c core.hookspath=/tmp commit -m "x"', "core.hooksPath"],
    ['git -c core.hooksPath commit -m "x"', "core.hooksPath"],
    ["git --config-env=core.hooksPath=HP commit -m x", "core.hooksPath"],
    ["git --config-env core.hooksPath=HP commit -m x", "core.hooksPath"],
    ['git --git-dir .git commit -m "x"', "--git-dir"],
    ['git --git-dir=.git commit -m "x"', "--git-dir"],
    ['git --work-tree . commit -m "x"', "--git-dir"],
    ['GIT_DIR=.git git commit -m "x"', "GIT_DIR"],
    ['GIT_WORK_TREE=. git commit -m "x"', "GIT_DIR"],
    ['env GIT_DIR=.git git commit -m "x"', "GIT_DIR"],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git commit -m "x"', "GIT_CONFIG_"],
    ['GIT_CONFIG_PARAMETERS="core.hooksPath=/x" git status', "GIT_CONFIG_"],
  ];
  for (const [command, reason] of blocked) {
    it(`blocks in a repository with the hooks path set: ${JSON.stringify(command)}`, () => {
      const r = run(command, hooked);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(reason);
    });
  }

  it("blocks a commit where core.hooksPath is unset", () => {
    const r = run('git commit -m "x"', unhooked);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("git config core.hooksPath .githooks");
  });

  it("reads core.hooksPath at git -C <dir>, not the hook cwd", () => {
    const r = run(`git -C ${slash(unhooked)} commit -m "x"`, hooked);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("git config core.hooksPath .githooks");
  });

  it("passes a commit where core.hooksPath is .githooks", () => {
    const r = run('git commit -m "x"', hooked);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("blocks a commit where core.hooksPath is .githooks but .githooks/pre-commit is missing", () => {
    const r = run('git commit -m "x"', noHookFile);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(".githooks/pre-commit is missing");
  });

  const passed = [
    'git commit -mnote',
    "git commit -uno -m x",
    "git commit -S -m x",
    "git commit -Sabc123 -m x",
  ];
  for (const command of passed) {
    it(`passes (no -n inside an attached value): ${JSON.stringify(command)}`, () => {
      const r = run(command, hooked);
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    });
  }

  it("still sees -n after a bare -u or -S", () => {
    for (const command of ["git commit -u -n -m x", "git commit -S -n -m x"]) {
      const r = run(command, hooked);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("--no-verify");
    }
  });
});

describe("bash-guard: unreadable input fails closed", () => {
  it("blocks when stdin is not JSON", () => {
    const r = runRaw("not json");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("could not read its input");
  });

  it("blocks when tool_input.command is missing", () => {
    const r = run(undefined);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("could not read its input");
  });
});
