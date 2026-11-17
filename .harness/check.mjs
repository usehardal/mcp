#!/usr/bin/env node
// Copied into each service repo as .harness/check.mjs by harness/sync/sync.mjs.
// Fails when a file or block copied from usehardal/harness was edited in this
// repo: it compares each copy with the SHA-256 recorded in .harness/sync.json.
// Edit the source in harness and run `node sync/sync.mjs` there instead.
// On a pull request it also checks the branch name, and warns about the PR's
// size and a route change without the Postman collection.
import { execFileSync } from "node:child_process";
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
// Returns the exit status: 1 for a branch named another way.
export function checkBranch(env = process.env) {
  const problem = branchProblem(env.GITHUB_HEAD_REF, env.GITHUB_ACTOR);
  if (!problem) return 0;
  console.log(`::error title=Branch name::${problem}`);
  return 1;
}

// The harness action plan's limit: past this many changed lines a PR is hard to
// review. Over it, CI warns and never fails.
export const PR_SIZE_LIMIT = 400;

// Lockfiles, snapshots, generated OpenAPI documents and harness copies don't
// count toward a PR's size.
const NOT_COUNTED = [
  /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /(^|\/)openapi\/[^/]+\.json$/,
  /^\.harness\//,
];

// Warnings for a PR's `git diff --numstat`, as [title, message] pairs. `synced`
// lists the files harness copies into the repo; they don't count either.
export function diffWarnings(numstat, synced = []) {
  const changes = numstat
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [added, deleted, path] = row.split("\t");
      return { path, lines: added === "-" ? 0 : Number(added) + Number(deleted) };
    });
  const warnings = [];

  const size = changes
    .filter(({ path }) => !synced.includes(path) && !NOT_COUNTED.some((pattern) => pattern.test(path)))
    .reduce((total, { lines }) => total + lines, 0);
  if (size > PR_SIZE_LIMIT) {
    warnings.push([
      "PR size",
      `This PR changes ${size} lines, not counting lockfiles, snapshots and generated files. ` +
        `Over ${PR_SIZE_LIMIT} is hard to review; split it if you can.`,
    ]);
  }

  const routes = changes.map(({ path }) => path).filter((path) => /(^|\/)routes\.ts$/.test(path));
  if (routes.length > 0 && !changes.some(({ path }) => path.startsWith("postman/"))) {
    warnings.push([
      "Postman",
      `This PR changes ${routes.join(", ")} but nothing under postman/. ` +
        "An endpoint change updates the Postman collection in the same PR.",
    ]);
  }
  return warnings;
}

// On a pull request, GITHUB_SHA is the merge commit and actions/checkout fetched
// only that commit; one more level of history gives its first parent, the base.
// Warnings never fail the check, and a diff that can't be read is only noted.
export function warnOnDiff(env = process.env, synced = [], cwd = process.cwd()) {
  if (!env.GITHUB_BASE_REF || !env.GITHUB_SHA) return;
  let numstat;
  try {
    execFileSync("git", ["fetch", "--quiet", "--no-tags", "--depth=2", "origin", env.GITHUB_SHA], { cwd, stdio: "ignore" });
    numstat = execFileSync("git", ["diff", "--numstat", "--no-renames", `${env.GITHUB_SHA}^1`, env.GITHUB_SHA], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    console.log("::notice title=PR size::Couldn't read this pull request's diff, so its size and Postman changes weren't checked.");
    return;
  }
  for (const [title, message] of diffWarnings(numstat, synced)) console.log(`::warning title=${title}::${message}`);
}

function check(repoRoot) {
  const branchStatus = checkBranch();

  const statePath = join(repoRoot, ".harness", "sync.json");
  if (!existsSync(statePath)) {
    console.error(".harness/sync.json is missing; run `node sync/sync.mjs` in harness.");
    return 1;
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  warnOnDiff(process.env, Object.keys(state.files ?? {}), repoRoot);
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
  return branchStatus;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(check(resolve(dirname(fileURLToPath(import.meta.url)), "..")));
}
