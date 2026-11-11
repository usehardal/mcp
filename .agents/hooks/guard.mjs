#!/usr/bin/env node
// Blocks agent actions that the engineering rules forbid:
//   - reading or editing real .env files (.env.example and similar stay readable)
//   - psql / pg_dump / clickhouse-client against a non-local host
//   - network calls (curl, wget, fetch, ...) to the production ClickHouse
//     gateway, chproxy instances, nodes or Keepers
//   - migrations and other prod-capable scripts when their database or service
//     URL points at a non-local host
//
// One script for Claude Code and Codex (PreToolUse) and Cursor
// (beforeShellExecution, beforeReadFile). It is a guardrail against mistakes,
// not a security boundary. Keep the copies in every repo identical, except
// that this public repo's copy leaves out the internal ClickHouse addresses.
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { URL } from "node:url";

const input = readInput();
const event = input.hook_event_name ?? "";
const cursor = event === "beforeShellExecution" || event === "beforeReadFile";
const root = projectRoot();
const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : root;


function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function print(value) {
  process.stdout.write(JSON.stringify(value));
}

function projectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (Array.isArray(input.workspace_roots) && input.workspace_roots[0]) return input.workspace_roots[0];
  return typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
}

function checkCursor() {
  if (event === "beforeReadFile") {
    const paths = [input.file_path, ...(input.attachments ?? []).map((a) => a?.file_path)];
    for (const path of paths) {
      const r = typeof path === "string" ? checkPath(path) : null;
      if (r) return r;
    }
    return null;
  }
  return typeof input.command === "string" ? checkCommand(input.command) : null;
}

function checkToolCall() {
  const toolInput = input.tool_input ?? {};
  if (typeof toolInput.command === "string" && input.tool_name !== "apply_patch") {
    return checkCommand(toolInput.command);
  }
  for (const key of ["file_path", "path", "notebook_path"]) {
    const r = typeof toolInput[key] === "string" ? checkPath(toolInput[key]) : null;
    if (r) return r;
  }
  if (typeof toolInput.glob === "string" && /(^|\/)\.env/.test(toolInput.glob) && !isExampleEnv(toolInput.glob)) {
    return "searching .env files is not allowed; use .env.example";
  }
  // Codex apply_patch: file paths are inside the patch text.
  for (const value of Object.values(toolInput)) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      const r = checkPath(match[1].trim());
      if (r) return r;
    }
  }
  return null;
}

// --- .env files ------------------------------------------------------------

function isSecretEnvName(name) {
  return /^\.env(\.[\w.-]+)?$/.test(name) && !isExampleEnv(name);
}

function isExampleEnv(name) {
  return /\.(example|sample|template|dist)$/.test(name);
}

function checkPath(path) {
  return isSecretEnvName(basename(path))
    ? `${basename(path)} holds secrets; agents may not read or edit it. Use .env.example for the variable names.`
    : null;
}

// --- shell commands --------------------------------------------------------

function checkCommand(command) {
  return (
    checkEnvFiles(command) ??
    checkDatabaseClients(command) ??
    checkClickHouseNetwork(command) ??
    checkProdScripts(command)
  );
}

function checkEnvFiles(command) {
  const stripped = command
    // Loading an env file into a process is fine; printing it is not.
    .replace(/--env-file(?:=|\s+)\S+/g, " ")
    // Creating a local .env from the example is fine.
    .replace(/\bcp\s+(?:-\w+\s+)*\S*\.env\.(?:example|sample|template)\s+\S*\.env\b/g, " ");
  for (const match of stripped.matchAll(/(?:^|[\s'"=:/<>|;&(])(\.env(?:\.[\w.-]+)?)(?=$|[\s'";|&)<>])/g)) {
    if (isSecretEnvName(match[1])) {
      return `the command touches ${match[1]}, which holds secrets; agents may not read or edit it. Use .env.example for the variable names.`;
    }
  }
  return null;
}

const DB_CLIENT = /(?:^|[\s;&|(])(psql|pg_dump|pg_dumpall|pg_restore|clickhouse-client|clickhouse\s+client)(?=$|\s)/;

function checkDatabaseClients(command) {
  const client = command.match(DB_CLIENT)?.[1];
  if (!client) return null;
  const hosts = [
    ...[...command.matchAll(/(?:^|\s)(?:-h\s*|--host[=\s]+)['"]?([^\s'"]+)/g)].map((m) => m[1]),
    ...[...command.matchAll(/\b(?:postgres(?:ql)?|clickhouse|https?|tcp):\/\/[^\s'"]+/g)].map((m) => hostOf(m[0])),
    ...[...command.matchAll(/\b(?:PGHOST|CLICKHOUSE_HOST)=['"]?([^\s'"]+)/g)].map((m) => m[1]),
  ];
  if (!hosts.length && process.env.PGHOST && /psql|pg_/.test(client)) hosts.push(process.env.PGHOST);
  if (hosts.some((host) => host && host.includes("$")) || /\$\{?\w*(?:URL|HOST|DSN)\b/i.test(command)) {
    return `${client} with a host taken from a variable; spell out a local host (localhost or 127.0.0.1).`;
  }
  if (hosts.some((host) => !isLocalHost(host))) {
    return `${client} against a non-local host; agents may only query local databases. Production data goes through the app or a person.`;
  }
  return null;
}

// Production ClickHouse hosts. This repo is public, so its copy lists only
// the public name; the private repos' copies also list the internal
// addresses. The ClickHouse URLs in the repo's env files and environment
// count too.
const CLICKHOUSE_PROD_HOSTS = [
  /\bch\.usehardal\.com\b/i,
];
const NETWORK_CALL =
  /:\/\/|(?:^|[\s;&|(])(?:curl|wget|http|https|xh|nc|ncat|netcat|telnet|socat|ssh|scp)(?=$|\s)|\bfetch\s*\(|\brequests\.|\baxios\b|\burllib\b/;

function checkClickHouseNetwork(command) {
  if (!NETWORK_CALL.test(command)) return null;
  const configured = [];
  for (const file of envFiles("provisioner")) {
    for (const [key, value] of parseEnvFile(file)) {
      if (/CLICKHOUSE\w*_(?:URL|HOST)$/.test(key)) configured.push(value);
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (/CLICKHOUSE\w*_(?:URL|HOST)$/.test(key) && value) configured.push(value);
  }
  const hosts = configured
    .map((value) => (/^[\w+.-]+:\/\//.test(value) ? hostOf(value) : value))
    .filter((host) => host && !isLocalHost(host));
  const hit =
    CLICKHOUSE_PROD_HOSTS.some((pattern) => pattern.test(command)) ||
    hosts.some((host) => command.toLowerCase().includes(host.toLowerCase()));
  return hit
    ? "the command calls the production ClickHouse gateway, proxies, nodes or Keepers. Agents never query or probe production ClickHouse; use a local ClickHouse or ask a person."
    : null;
}

// Scripts that write to a database or a running service, matched only when a
// package runner starts them. The URLs they would use come from inline
// assignments in the command, then the environment, then the repo's env files.
const RUN = String.raw`(?:^|[\s;&|(])(?:bun|bunx|npm|npx|pnpm|yarn|node)\b[^;&|\n]*?`;
const PROD_SCRIPTS = [
  {
    pattern: new RegExp(String.raw`${RUN}(?:\b(?:db:migrate|db:setup|db:push)\b|\bsetup-db\.ts\b|\bdrizzle-kit\s+(?:migrate|push)\b)`),
    keys: /DATABASE_URL$/,
  },
  {
    pattern: new RegExp(String.raw`${RUN}(?:\bscheduler:migrate\b|\bprisma\s+(?:migrate\s+(?!diff)|db\s+(?:push|execute)))`),
    keys: /(?:DATABASE_URL|POSTGRE_URL)$/,
  },
  {
    pattern: new RegExp(
      String.raw`${RUN}(?:\b(?:provisioner|tenants:backfill-isolation|tenants:offboard|identity:stage|identity:promote-stage|dlq:replay|oauth:register-service-identity|platform-admin)\b|\b(?:offboard-tenant|backfill-tenant-isolation|stage-uuid-identities|promote-uuid-stage|dlq-replay|register-oauth-service-identity|platform-admin)\.ts\b)|\bVIRGO_DEPLOYMENT_MODE=provisioner\b`,
    ),
    keys: /_(?:URL|HOST)$/,
  },
];

function checkProdScripts(command) {
  const rule = PROD_SCRIPTS.find((r) => r.pattern.test(command));
  if (!rule) return null;
  const script = command.match(rule.pattern)[0].trim();
  const inline = new Map(
    [...command.matchAll(/(?:^|\s)([A-Z][A-Z0-9_]*)=(?:'([^']*)'|"([^"]*)"|(\S+))/g)].map((m) => [m[1], m[2] ?? m[3] ?? m[4]]),
  );
  const values = new Map();
  for (const file of envFiles(script)) {
    for (const [key, value] of parseEnvFile(file)) {
      if (rule.keys.test(key) && !values.has(key)) values.set(key, { value, source: file });
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (rule.keys.test(key) && !values.has(key)) values.set(key, { value, source: "the environment" });
  }
  for (const [key, value] of inline) {
    if (rule.keys.test(key)) values.set(key, { value, source: "the command" });
  }
  for (const [key, { value, source }] of values) {
    const host = /^[\w+.-]+:\/\//.test(value) ? hostOf(value) : key.endsWith("_HOST") ? value : null;
    if (host && !isLocalHost(host)) {
      const where = source === "the command" || source === "the environment" ? source : source.slice(root.length + 1) || source;
      return `${script} would use ${key} from ${where}, which points at a non-local host. Agents run migrations and ops scripts only against local databases; production changes ship through CI after merge.`;
    }
  }
  return null;
}

function envFiles(script) {
  const names = [".env", ".env.local", ".env.runtime"];
  if (/provisioner/.test(script)) names.unshift(".env.provisioner");
  const dirs = [...new Set([cwd, root, join(root, "apps/api")])];
  return dirs.flatMap((dir) => names.map((name) => resolve(dir, name))).filter((file) => existsSync(file));
}

function parseEnvFile(file) {
  try {
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, "$2")]);
  } catch {
    return [];
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^[\w+.-]+:\/\//, "").replace(/^[^@/]*@/, "").split(/[:/?]/)[0];
  }
}

function isLocalHost(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "" ||
    h === "localhost" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h === "host.docker.internal" ||
    /^127\./.test(h) ||
    /\.(?:localhost|local)$/.test(h) ||
    // Single-label names are docker compose services or the local socket.
    !h.includes(".")
  );
}

// Runs last so every constant above is initialised.
function main() {
  const reason = cursor ? checkCursor() : checkToolCall();
  if (reason) {
    if (cursor) {
      print({ permission: "deny", user_message: reason, agent_message: reason });
    } else {
      process.stderr.write(`Blocked by .agents/hooks/guard.mjs: ${reason}\n`);
      process.exit(2);
    }
  } else if (cursor) {
    print({ permission: "allow" });
  }
  process.exit(0);
}

main();
