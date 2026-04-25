export interface ParsedMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  index: number;
}

export interface FileTouch {
  path: string;
  operation: "read" | "edit" | "write";
}

export interface SessionMetadata {
  sessionId: string;
  branch: string | null;
  title: string | null;
  projectPath: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number;
}

export interface ParsedSession {
  messages: ParsedMessage[];
  compactSummaries: string[];
  filesTouched: FileTouch[];
  metadata: SessionMetadata;
}

export async function parseSession(filePath: string): Promise<ParsedSession> {
  const messages: ParsedMessage[] = [];
  const compactSummaries: string[] = [];
  const filesTouched: FileTouch[] = [];
  const fileSet = new Set<string>();

  let sessionId: string | null = null;
  let branch: string | null = null;
  let title: string | null = null;
  let projectPath: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let messageIndex = 0;

  function processRecord(record: any) {
    const type = record.type;

    if (
      type === "progress" ||
      type === "file-history-snapshot" ||
      type === "queue-operation"
    ) {
      return;
    }

    if (record.sessionId && !sessionId) sessionId = record.sessionId;
    if (record.gitBranch && !branch) branch = record.gitBranch;
    if (record.cwd && !projectPath) projectPath = record.cwd;

    if (record.timestamp) {
      if (!firstTimestamp) firstTimestamp = record.timestamp;
      lastTimestamp = record.timestamp;
    }

    if (type === "summary") {
      title = record.summary || null;
      return;
    }

    if (record.isCompactSummary && type === "user") {
      const content = record.message?.content;
      if (typeof content === "string" && content.length > 0) {
        compactSummaries.push(content);
      }
      return;
    }

    if (type === "user") {
      const content = record.message?.content;
      if (typeof content === "string" && content.length > 0) {
        messages.push({
          role: "user",
          text: content,
          timestamp: record.timestamp || "",
          index: messageIndex++,
        });
      }
      return;
    }

    if (type === "assistant") {
      const content = record.message?.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        if (!block || typeof block !== "object") continue;

        if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
          messages.push({
            role: "assistant",
            text: block.text,
            timestamp: record.timestamp || "",
            index: messageIndex++,
          });
        }

        if (block.type === "tool_use") {
          const toolName = block.name;
          const input = block.input;

          if (input?.file_path && (toolName === "Read" || toolName === "Edit" || toolName === "Write")) {
            const operation = toolName.toLowerCase() as "read" | "edit" | "write";
            const key = `${input.file_path}:${operation}`;
            if (!fileSet.has(key)) {
              fileSet.add(key);
              filesTouched.push({ path: input.file_path, operation });
            }
          }
        }
      }
    }
  }

  // Stream the file line-by-line to handle large files
  const file = Bun.file(filePath);
  const stream = file.stream();
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        processRecord(JSON.parse(line));
      } catch {
        // skip corrupted lines
      }
    }
  }

  // Process any remaining content in the buffer
  if (buffer.trim()) {
    try {
      processRecord(JSON.parse(buffer));
    } catch {
      // skip corrupted final line
    }
  }

  if (!sessionId) {
    const match = filePath.match(/([a-f0-9-]{36})\.jsonl$/);
    if (match) sessionId = match[1];
  }

  return {
    messages,
    compactSummaries,
    filesTouched,
    metadata: {
      sessionId: sessionId || "unknown",
      branch,
      title,
      projectPath,
      createdAt: firstTimestamp,
      updatedAt: lastTimestamp,
      messageCount: messages.length,
    },
  };
}
