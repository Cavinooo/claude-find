import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createDatabase } from "./db";
import { indexSessions } from "./indexer";
import { search, type SearchResult } from "./searcher";
import { join } from "path";
import { existsSync } from "fs";

const CLAUDE_PROJECTS_DIR = join(
  process.env.HOME || "~",
  ".claude",
  "projects"
);
const DB_PATH = join(
  process.env.HOME || "~",
  ".claude-find",
  "index.db"
);

/**
 * Format search results as readable text for Claude.
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No matching sessions found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} relevant session${results.length > 1 ? "s" : ""}:\n`);

  for (const result of results) {
    lines.push("---");
    lines.push(`**${result.title || "Untitled session"}**${result.isArchived ? " [archived]" : ""}`);
    lines.push(`Project: ${result.projectPath} | Branch: ${result.branch || "unknown"} | ${result.messageCount} messages`);

    if (result.createdAt) {
      const date = new Date(result.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      lines.push(`Date: ${date}`);
    }

    if (result.filesTouched.length > 0) {
      lines.push(`Files: ${result.filesTouched.join(", ")}`);
    }

    lines.push("");

    for (const chunk of result.chunks) {
      if (chunk.isCompactSummary) {
        lines.push(`[Compact Summary]`);
      }
      lines.push(chunk.text);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Start the MCP server.
 */
export async function startServer(): Promise<void> {
  const server = new McpServer({
    name: "claude-find",
    version: "0.1.0",
  });

  let db: ReturnType<typeof createDatabase> | null = null;
  let indexed = false;

  function getDb() {
    if (!db) {
      db = createDatabase(DB_PATH);
    }
    return db;
  }

  server.tool(
    "search_sessions",
    "Search the full conversation history from past Claude Code sessions stored in ~/.claude/projects/. This tool has access to the complete raw transcripts of all previous sessions — including the actual back-and-forth discussion, reasoning, failed approaches, user constraints, and code decisions. Use this tool FIRST whenever the user mentions anything from a past session, asks 'what did we discuss', 'pull in context from', 'remember when we', 'how did we handle', or references any prior work. This tool searches semantically — the user doesn't need to remember exact words. Much more detailed than built-in memory.",
    {
      query: z.string().describe("What to search for — natural language description of the past session or topic"),
      max_sessions: z.number().optional().default(3).describe("Max sessions to return (default 3)"),
      max_chunks: z.number().optional().default(2).describe("Max conversation chunks per session (default 2)"),
    },
    async ({ query, max_sessions, max_chunks }) => {
      try {
        const database = getDb();

        // Lazy indexing on first search
        if (!indexed && existsSync(CLAUDE_PROJECTS_DIR)) {
          console.error("[claude-find] First search — indexing sessions...");
          await indexSessions(database, CLAUDE_PROJECTS_DIR, (p) => {
            if (p.status === "indexing") {
              console.error(`[claude-find] Indexing ${p.current}/${p.total}: ${p.sessionId}`);
            }
          });
          indexed = true;
          console.error("[claude-find] Indexing complete.");
        }

        const results = await search(database, {
          query,
          maxSessions: max_sessions,
          maxChunks: max_chunks,
        });

        const formatted = formatSearchResults(results);

        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      } catch (err) {
        console.error("[claude-find] Search error:", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching sessions: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[claude-find] MCP server running on stdio");
}
