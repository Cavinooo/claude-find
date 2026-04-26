# claude-find

Pull deep memory from across your Claude Code sessions — when you need it.

Semantic search across all your past Claude Code sessions. Find relevant context by meaning — not just keywords — and inject it into your current session. Searches raw conversation transcripts, not compressed summaries, so Claude gets the full story: reasoning, constraints, failed approaches, and decisions.

## Setup

### 1. Install prerequisites

**macOS:**
```bash
brew install bun ollama
brew services start ollama
```

**Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
```

**Windows:**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```
Download and install [Ollama for Windows](https://ollama.com/download/windows), then start it from the Start menu.

The embedding model (`nomic-embed-text`) is downloaded automatically on first use.

### 2. Add MCP server to Claude Code

```bash
claude mcp add --transport stdio claude-find -- bunx --bun claude-find serve
```

Sessions are indexed automatically on first search. To index manually: `bunx --bun claude-find index`

### 3. Use it

In any Claude Code session:

```
/find that database migration we discussed last week
/find why we chose websockets over polling
/find the session where we kept getting timeout errors
/find refactoring the payment module across all projects
```

Claude searches your past sessions semantically, finds the relevant conversations, and synthesizes the context — including what was tried, what failed, what constraints you stated, and what decisions were made.

## How it works

1. **Indexes** all Claude Code session JSONL files from `~/.claude/projects/`
2. **Extracts** user + assistant messages, compact summaries, file paths from tool calls
3. **Embeds** conversation chunks using nomic-embed-text via Ollama (GPU accelerated)
4. **Searches** with hybrid semantic + keyword (FTS5) merged via Reciprocal Rank Fusion
5. **Returns** raw conversation chunks — Claude does the synthesis with full context

## What makes this different

- **Searches raw transcripts** — not summaries or observations. Nothing lost through compression.
- **Retroactive** — works on all existing sessions immediately. No hooks needed.
- **On-demand** — zero token overhead until you ask. No background processes.
- **Uses compact summaries** — Claude's own session understanding, boosted in ranking.
- **Indexes tool call metadata** — search by files touched, errors encountered.
- **Fast** — Ollama + GPU keeps indexing fast and memory bounded.

## Requirements

- [Bun](https://bun.sh) runtime
- [Ollama](https://ollama.com) (model auto-downloaded on first use)
- Claude Code

## License

MIT
