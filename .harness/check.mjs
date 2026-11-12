#!/usr/bin/env node
// Copied into each service repo as .harness/check.mjs by harness/sync/sync.mjs.
// Fails when a file or block copied from usehardal/harness was edited in this
// repo: it compares each copy with the SHA-256 recorded in .harness/sync.json.
// Edit the source in harness and run `node sync/sync.mjs` there instead.
// On a pull request it also checks the branch name.
import console from "node:console";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

// The block from its BEGIN marker line to its END marker line, inclusive, or
// null when the text has no complete block for this source file.
export function extractBlock(text, source) {
  const begin = text.indexOf(`<!-- BEGIN ${source}`);
  if (begin === -1) return null;
  const endMarker = `<!-- END ${source} -->`;
  const end = text.indexOf(endMarker, begin);
  if (end === -1) return null;
  return text.slice(begin, end + endMarker.length);
}

// A branch is named after its Linear issue: feature/dev-1234 or bug/dev-1234.
// Dependabot names its own branches; its PRs run as dependabot[bot], so a
// person can't skip the rule with a dependabot/ name. Returns null for a valid
// name, and for no name, which is a run outside a pull request.
export function branchProblem(branch, actor) {
  if (!branch) return null;
  if (branch.startsWith("dependabot/") && actor === "dependabot[bot]") return null;
  if (/^(feature|bug)\/dev-\d+$/.test(branch)) return null;
  return `Branch ${branch} should be named after its Linear issue: feature/dev-1234 or bug/dev-1234.`;
}

// Harness CI runs this on its own pull requests; the repos run it in check().
export function warnOnBranch(env = process.env) {
  const problem = branchProblem(env.GITHUB_HEAD_REF, env.GITHUB_ACTOR);
  // Only a warning until the PRs opened with older branch names have merged.
  if (problem) console.log(`::warning title=Branch name::${problem}`);
}

function check(repoRoot) {
  warnOnBranch();

  const statePath = join(repoRoot, ".harness", "sync.json");
  if (!existsSync(statePath)) {
    console.error(".harness/sync.json is missing; run `node sync/sync.mjs` in harness.");
    return 1;
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const problems = [];

  for (const [path, hash] of Object.entries(state.files ?? {})) {
    const full = join(repoRoot, path);
    if (!existsSync(full)) problems.push(`${path} is missing.`);
    else if (sha256(readFileSync(full)) !== hash) problems.push(`${path} was changed.`);
  }
  for (const [path, { source, sha256: hash }] of Object.entries(state.blocks ?? {})) {
    const full = join(repoRoot, path);
    const block = existsSync(full) ? extractBlock(readFileSync(full, "utf8"), source) : null;
    if (block === null) problems.push(`${path} has no ${source} block.`);
    else if (sha256(block) !== hash) problems.push(`The ${source} block in ${path} was changed.`);
  }

  if (problems.length > 0) {
    console.error(`These copies no longer match usehardal/harness ${state.commit.slice(0, 7)}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "Revert them here. To change them, edit the source in usehardal/harness, run " +
        "`node sync/sync.mjs` from the workspace folder and open a PR in each changed repo.",
    );
    return 1;
  }
  console.log(`Harness copies match usehardal/harness ${state.commit.slice(0, 7)}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(check(resolve(dirname(fileURLToPath(import.meta.url)), "..")));
}
