#!/usr/bin/env node
// PreToolUse guard for the Bash tool. Reads the hook input JSON from stdin and
// exits 2 (blocking, stderr is the reason Claude sees) when the command:
//   - stages the whole tree (git add -A / --all / -u / --update / . / :/)
//   - commits every tracked change (git commit -a / --all)
//   - carries a Co-Authored-By trailer into a commit (message, heredoc or -F file)
//   - force-pushes (--force, -f, --force-with-lease, +refspec)
//   - edits in place with sed (-i / --in-place), which rewrites CRLF files
// Anything else exits 0 with no output, so the normal permission flow applies.
//
// This is a guardrail, not a security boundary: eval, variables, xargs,
// shell-expanded globs and env with options (env -i ...) are not followed, and
// a relative -F path under git -C <dir> is resolved against the hook cwd, not
// <dir>.

"use strict";

const fs = require("fs");
const path = require("path");

const MAX_DEPTH = 3;

const MESSAGES = {
  add: "bash-guard: whole-tree staging is blocked; stage files by path.",
  commitAll:
    "bash-guard: commit -a stages every tracked change; stage files by path, then commit.",
  coAuthor:
    "bash-guard: commit message contains Co-Authored-By; remove the trailer.",
  push: "bash-guard: force push is blocked; push without force or ask the operator.",
  sed: "bash-guard: sed -i rewrites line endings on this CRLF tree; use the Edit tool or perl -i and check the CR count.",
};

const CO_AUTHOR = /co-authored-by/i;

// ---------------------------------------------------------------------------
// Tokenizer
//
// Splits a command string into simple commands. Each simple command is
// { words: string[], raw: string }, where raw is the source text of that
// command plus the bodies of any heredocs it declared. Quotes are removed from
// words; $(...) is kept verbatim inside the word and its contents are also
// analysed as commands of their own (subs). Heredoc bodies are never parsed
// as commands.
// ---------------------------------------------------------------------------

// Reads a heredoc delimiter starting at s[j] (just past "<<"). Returns
// { delim, stripTabs, next }.
function readHeredocDelim(s, j) {
  let stripTabs = false;
  if (s[j] === "-") {
    stripTabs = true;
    j++;
  }
  while (s[j] === " " || s[j] === "\t") j++;
  let delim = "";
  while (j < s.length && !/[\s;&|<>()]/.test(s[j])) {
    if (s[j] === "'" || s[j] === '"') {
      const q = s[j];
      const end = s.indexOf(q, j + 1);
      const stop = end === -1 ? s.length : end;
      delim += s.slice(j + 1, stop);
      j = stop + 1;
    } else if (s[j] === "\\") {
      delim += s[j + 1] || "";
      j += 2;
    } else {
      delim += s[j];
      j++;
    }
  }
  return { delim, stripTabs, next: j };
}

// Starting just past a newline, skips the bodies of the given heredocs and
// returns { next, bodies }.
function skipHeredocBodies(s, i, heredocs) {
  const bodies = [];
  for (const h of heredocs) {
    const lines = [];
    while (i < s.length) {
      let nl = s.indexOf("\n", i);
      if (nl === -1) nl = s.length;
      const line = s.slice(i, nl).replace(/\r$/, "");
      i = nl + 1;
      const cmp = h.stripTabs ? line.replace(/^\t+/, "") : line;
      if (cmp === h.delim) break;
      lines.push(line);
    }
    bodies.push(lines.join("\n"));
  }
  return { next: i, bodies };
}

function readSubstitution(s, i) {
  // s[i] === "(" right after "$". Returns the index just past the matching ")".
  // Heredoc bodies inside are skipped, so an apostrophe or parenthesis in a
  // commit message body does not unbalance the scan.
  let depth = 1;
  let j = i + 1;
  let quote = null;
  let pending = [];
  while (j < s.length && depth > 0) {
    const c = s[j];
    if (!quote && c === "<" && s[j + 1] === "<" && s[j + 2] !== "<") {
      const h = readHeredocDelim(s, j + 2);
      pending.push(h);
      j = h.next;
      continue;
    }
    if (!quote && c === "\n" && pending.length) {
      j = skipHeredocBodies(s, j + 1, pending).next;
      pending = [];
      continue;
    }
    if (quote) {
      if (c === "\\" && quote === '"') {
        j += 2;
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "\\") {
      j += 2;
      continue;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    }
    j++;
  }
  return j;
}

function tokenize(s) {
  const commands = [];
  const subs = [];
  let words = [];
  let word = "";
  let inWord = false;
  let segStart = 0;
  let pendingHeredocs = [];
  let heredocBodies = [];
  let dropNextWord = false;

  function endWord() {
    if (inWord) {
      if (dropNextWord) {
        dropNextWord = false;
      } else {
        words.push(word);
      }
    }
    word = "";
    inWord = false;
  }

  function endCommand(endIdx) {
    endWord();
    if (words.length > 0 || heredocBodies.length > 0) {
      commands.push({
        words,
        raw: s.slice(segStart, endIdx) + "\n" + heredocBodies.join("\n"),
      });
    }
    words = [];
    heredocBodies = [];
    dropNextWord = false;
  }

  function readHeredocBodies(i) {
    // i is the index just past a newline. Consumes every pending heredoc body.
    const { next, bodies } = skipHeredocBodies(s, i, pendingHeredocs);
    heredocBodies.push(...bodies);
    pendingHeredocs = [];
    return next;
  }

  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      const stop = end === -1 ? s.length : end;
      word += s.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }

    if (c === '"') {
      inWord = true;
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\" && j + 1 < s.length) {
          word += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === "$" && s[j + 1] === "(") {
          const end = readSubstitution(s, j + 1);
          word += s.slice(j, end);
          subs.push(s.slice(j + 2, end - 1));
          j = end;
          continue;
        }
        word += s[j];
        j++;
      }
      i = j + 1;
      continue;
    }

    if (c === "\\") {
      if (s[i + 1] === "\n") {
        i += 2;
        continue;
      }
      word += s[i + 1] || "";
      inWord = true;
      i += 2;
      continue;
    }

    if (c === "$" && s[i + 1] === "(") {
      const end = readSubstitution(s, i + 1);
      word += s.slice(i, end);
      subs.push(s.slice(i + 2, end - 1));
      inWord = true;
      i = end;
      continue;
    }

    if (c === "\n") {
      endCommand(i);
      i = readHeredocBodies(i + 1);
      segStart = i;
      continue;
    }

    if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      endCommand(i);
      i++;
      while (i < s.length && (s[i] === "&" || s[i] === "|" || s[i] === ";")) i++;
      segStart = i;
      continue;
    }

    if (c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
      // Heredoc: <<DELIM, <<-DELIM, <<'DELIM', <<"DELIM"
      endWord();
      const h = readHeredocDelim(s, i + 2);
      pendingHeredocs.push({ delim: h.delim, stripTabs: h.stripTabs });
      i = h.next;
      continue;
    }

    if (c === "<" || c === ">") {
      // Redirection: drop an all-digit fd prefix and the target word.
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      } else {
        endWord();
      }
      let j = i + 1;
      while (j < s.length && /[<>&|]/.test(s[j])) j++;
      // "2>&1" style: the target is an fd and part of the operator.
      if (s[j - 1] === "&" && /\d/.test(s[j] || "")) {
        while (j < s.length && /\d/.test(s[j])) j++;
      } else {
        dropNextWord = true;
      }
      i = j;
      continue;
    }

    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
      continue;
    }

    word += c;
    inWord = true;
    i++;
  }
  endCommand(s.length);

  return { commands, subs };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function baseName(w) {
  return w.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
}

// Scans a short-option cluster such as "-am" letter by letter. Returns
// { letters, valueLetter } where letters are the flags seen before the first
// letter that takes a value, and valueLetter is that letter (or null) along
// with whether its value is attached in the same token.
function scanCluster(token, valueLetters) {
  const letters = [];
  for (let k = 1; k < token.length; k++) {
    const ch = token[k];
    letters.push(ch);
    if (valueLetters.includes(ch)) {
      return { letters, valueLetter: ch, attached: token.slice(k + 1) };
    }
  }
  return { letters, valueLetter: null, attached: "" };
}

// Walks an argument list, separating options from operands. longWithValue
// lists long options that take a separate value when written without "=".
function parseArgs(args, valueLetters, longWithValue) {
  const longs = [];
  const shortLetters = [];
  const operands = [];
  const values = []; // { opt, value }
  let k = 0;
  let endOfOptions = false;
  while (k < args.length) {
    const a = args[k];
    if (endOfOptions) {
      operands.push(a);
    } else if (a === "--") {
      endOfOptions = true;
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a : a.slice(0, eq);
      longs.push(name);
      if (eq !== -1) {
        values.push({ opt: name, value: a.slice(eq + 1) });
      } else if (longWithValue.includes(name) && k + 1 < args.length) {
        values.push({ opt: name, value: args[k + 1] });
        k++;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      const { letters, valueLetter, attached } = scanCluster(a, valueLetters);
      shortLetters.push(...letters);
      if (valueLetter) {
        if (attached !== "") {
          values.push({ opt: "-" + valueLetter, value: attached });
        } else if (k + 1 < args.length) {
          values.push({ opt: "-" + valueLetter, value: args[k + 1] });
          k++;
        }
      }
    } else {
      operands.push(a);
    }
    k++;
  }
  return { longs, shortLetters, operands, values };
}

const GIT_GLOBAL_WITH_VALUE = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"];

function checkGitAdd(args) {
  const p = parseArgs(args, [], ["--chmod", "--pathspec-from-file"]);
  if (p.longs.includes("--all") || p.longs.includes("--update")) return MESSAGES.add;
  if (p.shortLetters.includes("A") || p.shortLetters.includes("u")) return MESSAGES.add;
  if (p.operands.some((o) => o === "." || o === ":/")) return MESSAGES.add;
  return null;
}

function checkGitCommit(args, raw, cwd) {
  const p = parseArgs(
    args,
    ["m", "F", "c", "C", "t"],
    [
      "--message", "--file", "--author", "--date", "--template", "--reuse-message",
      "--reedit-message", "--fixup", "--squash", "--cleanup", "--trailer",
      "--pathspec-from-file", "--untracked-files",
    ]
  );
  if (p.longs.includes("--all") || p.shortLetters.includes("a")) return MESSAGES.commitAll;
  if (CO_AUTHOR.test(raw)) return MESSAGES.coAuthor;
  for (const v of p.values) {
    if ((v.opt === "-F" || v.opt === "--file") && v.value !== "-") {
      const file = path.resolve(cwd, v.value);
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8");
      } catch (e) {
        text = "";
      }
      if (CO_AUTHOR.test(text)) return MESSAGES.coAuthor;
    }
  }
  return null;
}

function checkGitPush(args) {
  const p = parseArgs(args, ["o"], ["--repo", "--receive-pack", "--exec", "--push-option"]);
  if (p.longs.some((l) => l === "--force" || l === "--force-with-lease")) return MESSAGES.push;
  if (p.shortLetters.includes("f")) return MESSAGES.push;
  if (p.operands.some((o) => o.startsWith("+"))) return MESSAGES.push;
  return null;
}

function checkSed(args) {
  const p = parseArgs(args, ["e", "f", "l"], ["--expression", "--file", "--line-length"]);
  if (p.longs.includes("--in-place")) return MESSAGES.sed;
  if (p.shortLetters.includes("i")) return MESSAGES.sed;
  return null;
}

function checkCommand(cmd, cwd, depth) {
  const words = cmd.words.slice();
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  while (words.length && ["env", "command", "exec", "time", "nohup"].includes(words[0])) words.shift();
  if (words.length === 0) return null;

  const name = baseName(words[0]);
  const args = words.slice(1);

  if ((name === "bash" || name === "sh") && depth < MAX_DEPTH) {
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a) && k + 1 < args.length) {
        return analyse(args[k + 1], cwd, depth + 1);
      }
    }
    return null;
  }

  if (name === "sed") return checkSed(args);

  if (name === "git") {
    let k = 0;
    while (k < args.length && args[k].startsWith("-")) {
      const a = args[k];
      if (GIT_GLOBAL_WITH_VALUE.includes(a)) {
        k += 2;
      } else {
        k += 1;
      }
    }
    const sub = args[k];
    const rest = args.slice(k + 1);
    if (sub === "add") return checkGitAdd(rest);
    if (sub === "commit") return checkGitCommit(rest, cmd.raw, cwd);
    if (sub === "push") return checkGitPush(rest);
  }
  return null;
}

function analyse(command, cwd, depth) {
  const { commands, subs } = tokenize(command);
  for (const cmd of commands) {
    const reason = checkCommand(cmd, cwd, depth);
    if (reason) return reason;
  }
  if (depth < MAX_DEPTH) {
    for (const sub of subs) {
      const reason = analyse(sub, cwd, depth + 1);
      if (reason) return reason;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function block(message) {
  process.stderr.write(message + "\n");
  process.exit(2);
}

function main(input) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch (e) {
    block("bash-guard could not read its input; report this");
    return;
  }
  const command = payload && payload.tool_input && payload.tool_input.command;
  if (typeof command !== "string") {
    block("bash-guard could not read its input; report this");
    return;
  }
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();

  let reason;
  try {
    reason = analyse(command, cwd, 0);
  } catch (e) {
    block("bash-guard failed while checking the command; report this: " + (e && e.message));
    return;
  }
  if (reason) block(reason);
  process.exit(0);
}

let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  data += chunk;
});
process.stdin.on("end", () => main(data));
