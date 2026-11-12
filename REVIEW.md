# Review rules

The one review definition for this repo. Codex follows it on every PR, and
any agent asked to review a change here uses it.

This public repo is the remote MCP server. Its tools read Beacon's Reports
API with a token exchanged for each user.

## How to review

- Review only the diff from the merge base. Read the PR description and its
  Linear issue first and judge the change against the scope they state;
  deferred work is not a finding unless leaving it out breaks the changed
  behaviour, and behaviour that was already there is not a finding.
- Trace callers, consumers and contracts only as far as needed to prove or
  disprove a suspected defect.
- Run the checks listed under Commands in `AGENTS.md` when one would settle a
  finding, and report which ran and which didn't.
- Stay read-only: don't edit, stage, commit, push, approve, request changes or
  post comments unless you are asked to.

## What failure looks like here

**P0, blocks merge:**

- A user token, exchanged token or the service private key logged, returned
  or put in an error.
- A `/mcp` request served without a valid token for `MCP_RESOURCE`.
- A report scoped beyond the tenants the user approved.

**P1, fix before merge:**

- The user's token forwarded instead of exchanged, or an MCP token accepted
  for the Reports API.
- Calls to Sirius, ClickHouse or Beacon's internal APIs.
- The per-user rate limit removed or bypassed.
- A tool name or input schema renamed or removed without a decision on the
  issue.
- Internal hostnames, IP addresses or other non-public details committed to
  this public repo.
- Tests that call a real Beacon.
- A change to `.harness/check.mjs` or `.harness/sync.json` that isn't a sync
  from `harness`: CI trusts the hashes in `sync.json`, so it would accept an
  edited copy.

**P2, worth fixing:**

- A tool change without the `docs/report-coverage.md` and README updates.
- Beacon errors passed to the client with internal detail.
- An unexplained number for a limit, timeout or retry.

Rank a defect that isn't listed by comparing its impact with these examples.
Only what doesn't change behaviour, security or reliability is a nit.

## Skip

- `bun.lock`, unless it changes without a matching `package.json` change.
- The `AGENTS.base.md` block at the end of `AGENTS.md`: a copy from the
  `harness` repo. CI already fails if it was edited here.
- Style, formatting and naming that tooling or the surrounding code already
  settles; refactoring ideas; missing tests on their own; defects that were
  there before the PR.

## Nits

At most three per review, listed together after the findings, one line each
with `path:line`. Never post them as review comments. Drop the rest.

## Every finding

- Only a defect the diff introduces or makes worse, with a realistic trigger.
  One finding per root cause. If you would write "maybe", it is not a finding.
- Title: the finding's own priority, `[P0]`, `[P1]` or `[P2]`, then the failure
  rather than the topic, under 80 characters.
- Location: `path:line` or a short range, on a changed line.
- One paragraph: the trigger, what happens, and why it matters.
- Evidence: the execution path, the contract or test it breaks, or a failing
  command.
- Fix: the smallest change that corrects it, in one line.

On GitHub, post P0 and P1 as review comments; P2 and nits go in the summary.

## Summary

Start with the count, for example `2 findings (1 P1, 1 P2), 1 nit` or
`No findings`. Then list the checks run and not run, the residual risk in one
or two lines (unverified consumers, production or load assumptions), and two
sentences on what the PR changes.
