# claude-find

Pull deep memory from across your Claude Code sessions — when you need it.

Semantic search across all your past Claude Code sessions. Find relevant context by meaning — not just keywords — and inject it into your current session. Searches raw conversation transcripts, not compressed summaries, so Claude gets the full story: reasoning, constraints, failed approaches, and decisions.

## Setup

### 1. Install Ollama (for fast embedding)

```bash
brew install ollama
brew services start ollama
ollama pull nomic-embed-text
```

### 2. Index your sessions

```bash
bun run src/index.ts index
```

### 3. Add MCP server to Claude Code

```bash
claude mcp add --transport stdio claude-find -- bunx --bun claude-find serve
```

### 4. Use it

In any Claude Code session:

```
/find how we set up the auth flow
/find that discussion about Redis vs Postgres for caching
/find what was decided about the API rate limiting design
/find the Ashby ATS integration across all projects
```

Claude searches your past sessions semantically, finds the relevant conversations, and synthesizes the context — including what was tried, what failed, what constraints you stated, and what decisions were made.

## How it works

1. **Indexes** all Claude Code session JSONL files from `~/.claude/projects/`
2. **Extracts** user + assistant messages, compact summaries, file paths from tool calls
3. **Embeds** conversation chunks using nomic-embed-text via Ollama (Metal GPU)
4. **Searches** with hybrid semantic + keyword (FTS5) merged via Reciprocal Rank Fusion
5. **Returns** raw conversation chunks — Claude does the synthesis with full context

## What makes this different

- **Searches raw transcripts** — not summaries or observations. Nothing lost through compression.
- **Retroactive** — works on all existing sessions immediately. No hooks needed.
- **On-demand** — zero token overhead until you ask. No background processes.
- **Uses compact summaries** — Claude's own session understanding, boosted in ranking.
- **Indexes tool call metadata** — search by files touched, errors encountered.
- **Fast** — Ollama + Metal GPU keeps indexing fast and memory bounded.

## Requirements

- [Bun](https://bun.sh) runtime
- [Ollama](https://ollama.com) with `nomic-embed-text` model (falls back to transformers.js without Ollama, but much slower)
- Claude Code

## License

MIT
