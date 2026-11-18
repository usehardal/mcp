// Same list as Beacon's `aiClientFromName` in @beacon/shared, so MCP and
// Beacon connection events name the AI client the same way.
export enum AiClient {
  Claude = "claude",
  ChatGpt = "chatgpt",
  Codex = "codex",
  Cursor = "cursor",
  Grok = "grok",
  Other = "other",
}

const aiClientMatches: ReadonlyArray<[RegExp, AiClient]> = [
  [/claude/i, AiClient.Claude],
  [/codex/i, AiClient.Codex],
  [/chatgpt|openai/i, AiClient.ChatGpt],
  [/cursor/i, AiClient.Cursor],
  [/grok/i, AiClient.Grok],
];

/** Maps an OAuth app name to the AI client it belongs to. */
export function aiClientFromName(name: string | null): AiClient {
  return aiClientMatches.find(([pattern]) => name && pattern.test(name))?.[1] ?? AiClient.Other;
}
