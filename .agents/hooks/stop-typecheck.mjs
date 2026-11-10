#!/usr/bin/env node
// Keeps the agent working until `type-check` passes.
//
// Runs on Stop (Claude Code, Codex) and stop (Cursor). It only type-checks
// when code changed on this branch, caches a passing result for the same
// working tree, and lets the agent stop after three blocked rounds in a row so
// a broken base branch can't trap it. Full tests stay in CI. Keep the copies
// in every repo identical.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_ROUNDS = 3;
const CODE = /\.(?:[cm]?[jt]sx?|json)$|(?:^|\/)tsconfig[^/]*\.json$/;

const input = readInput();
const cursor = input.hook_event_name === "stop";
if (cursor && input.status && input.status !== "completed") done();

const root = git(["rev-parse", "--show-toplevel"], projectDir())?.trim();
if (!root) done();

const changed = changedFiles();
if (!changed.some((file) => CODE.test(file))) done();

const stateDir = join(tmpdir(), "agent-stop-typecheck");
mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, `${hash(root)}.json`);
const treeKey = hash([git(["rev-parse", "HEAD"], root), git(["diff", "HEAD"], root), untrackedFingerprint()].join("\0"));
const state = readState();
if (state.passedTree === treeKey) done();

const [command, args] = typeCheckCommand();
const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 280_000, maxBuffer: 32 * 1024 * 1024 });
if (result.status === 0) {
  writeState({ ...state, passedTree: treeKey, rounds: {} });
  done();
}

// A round is one blocked stop in a row; a fresh stop (not caused by this hook)
// starts counting again.
const session = String(input.session_id ?? input.conversation_id ?? "unknown");
const rounds = cursor
  ? (Number(input.loop_count) || 0) + 1
  : input.stop_hook_active
    ? (state.rounds?.[session] ?? 0) + 1
    : 1;
writeState({ ...state, rounds: { ...state.rounds, [session]: rounds } });
if (rounds > MAX_ROUNDS) {
  process.stderr.write(`type-check still fails after ${MAX_ROUNDS} rounds; stopping anyway.\n`);
  done();
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-60).join("\n");
const why = result.error ? `could not run: ${result.error.message}` : `failed`;
const message =
  `\`${[command, ...args].join(" ")}\` ${why}. Fix the type errors before finishing ` +
  `(round ${rounds} of ${MAX_ROUNDS}).\n\n${output}`;

process.stdout.write(JSON.stringify(cursor ? { followup_message: message } : { decision: "block", reason: message }));
process.exit(0);

// ---------------------------------------------------------------------------

function done() {
  if (cursor) process.stdout.write("{}");
  process.exit(0);
}

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function projectDir() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (Array.isArray(input.workspace_roots) && input.workspace_roots[0]) return input.workspace_roots[0];
  return typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

// Uncommitted changes plus commits on this branch that the default branch lacks.
function changedFiles() {
  const files = new Set();
  for (const line of (git(["status", "--porcelain", "--untracked-files=all"], root) ?? "").split("\n")) {
    if (line.trim()) files.add(line.slice(3).split(" -> ").pop());
  }
  const base = ["origin/HEAD", "origin/main", "origin/master"]
    .map((ref) => git(["merge-base", "HEAD", ref], root)?.trim())
    .find(Boolean);
  if (base) {
    for (const file of (git(["diff", "--name-only", base, "HEAD"], root) ?? "").split("\n")) {
      if (file) files.add(file);
    }
  }
  return [...files];
}

function untrackedFingerprint() {
  return (git(["ls-files", "--others", "--exclude-standard"], root) ?? "")
    .split("\n")
    .filter((file) => CODE.test(file))
    .map((file) => {
      try {
        return `${file}:${hash(readFileSync(join(root, file)))}`;
      } catch {
        return file;
      }
    })
    .join("\n");
}

function typeCheckCommand() {
  const bun = ["bun.lock", "bun.lockb"].some((file) => existsSync(join(root, file)));
  return bun ? ["bun", ["run", "type-check"]] : ["npm", ["run", "--silent", "type-check"]];
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function writeState(value) {
  try {
    writeFileSync(stateFile, JSON.stringify(value));
  } catch {
    // A missing cache only costs another type-check.
  }
}

function hash(value) {
  return createHash("sha256").update(value ?? "").digest("hex").slice(0, 16);
}
