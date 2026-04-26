---
name: find
description: Search past Claude Code sessions for context. Use when user wants to recall or pull in context from a previous session or conversation.
---

Use the `search_sessions` MCP tool (from the claude-find server) to search past Claude Code sessions.

Pass the user's query to the tool. If the user said `/find auth discussion`, use "auth discussion" as the query.

After receiving results, synthesize the key context for the user — including reasoning, decisions, failed approaches, and constraints from the past session. Present it as useful context for the current conversation.

If no results are found, let the user know and suggest they try different search terms.
