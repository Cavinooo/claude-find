import { startServer } from "./server";
import { createDatabase } from "./db";
import { indexSessions } from "./indexer";
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

const command = process.argv[2];

async function main() {
  switch (command) {
    case "serve":
      await startServer();
      break;

    case "index": {
      console.log("Indexing Claude Code sessions...");
      const db = createDatabase(DB_PATH);
      await indexSessions(db, CLAUDE_PROJECTS_DIR, (p) => {
        if (p.status === "indexing") {
          process.stdout.write(`\rIndexing ${p.current}/${p.total}: ${p.sessionId}`);
        } else if (p.status === "skipped") {
          process.stdout.write(`\rSkipped ${p.current}/${p.total}: ${p.sessionId}`);
        } else if (p.status === "done") {
          console.log(`\nDone. ${p.total} sessions processed.`);
        }
      });
      db.close();
      break;
    }

    case "status": {
      if (!existsSync(DB_PATH)) {
        console.log("No index found. Run 'claude-find index' or use the MCP server (indexes on first search).");
        break;
      }
      const db = createDatabase(DB_PATH);
      const ids = db.getAllSessionIds();
      const archived = ids.filter((id) => {
        const s = db.getSession(id);
        return s?.is_archived;
      });
      console.log(`Sessions indexed: ${ids.length} (${ids.length - archived.length} live, ${archived.length} archived)`);
      const stat = Bun.file(DB_PATH);
      console.log(`Index size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
      console.log(`Index path: ${DB_PATH}`);
      db.close();
      break;
    }

    case "install": {
      console.log("Adding claude-find MCP server to Claude Code...");
      const proc = Bun.spawn(
        ["claude", "mcp", "add", "--transport", "stdio", "claude-find", "--", "bunx", "claude-find", "serve"],
        { stdout: "inherit", stderr: "inherit" }
      );
      await proc.exited;
      if (proc.exitCode === 0) {
        console.log("Done! claude-find is now available in Claude Code sessions.");
      } else {
        console.error("Failed to add MCP server. Try manually:");
        console.error("  claude mcp add --transport stdio claude-find -- bunx claude-find serve");
      }
      break;
    }

    default:
      console.log(`claude-find — On-demand deep context from past Claude Code sessions

Usage:
  claude-find serve     Start the MCP server (called by Claude Code)
  claude-find install   Add claude-find to Claude Code as an MCP server
  claude-find index     Manually index all sessions
  claude-find status    Show index statistics
`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
