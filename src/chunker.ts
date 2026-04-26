import type { ParsedMessage } from "./parser";

export interface Chunk {
  msgStart: number;
  msgEnd: number;
  text: string;
  isCompactSummary: boolean;
}

const TARGET_TOKENS = 1500;
const CHARS_PER_TOKEN = 4; // rough estimate
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;

function formatMessage(msg: ParsedMessage): string {
  const label = msg.role === "user" ? "USER" : "CLAUDE";
  return `${label}: ${msg.text}`;
}

/**
 * Split a parsed session into chunks.
 * - Compact summaries get their own dedicated chunks
 * - Message chunks target ~1500 tokens
 * - Never splits a user message from its immediate assistant response
 */
export function chunkSession(
  messages: ParsedMessage[],
  compactSummaries: string[]
): Chunk[] {
  const chunks: Chunk[] = [];

  // Compact summaries each get their own prioritized chunk
  for (const summary of compactSummaries) {
    chunks.push({
      msgStart: -1,
      msgEnd: -1,
      text: summary,
      isCompactSummary: true,
    });
  }

  if (messages.length === 0) return chunks;

  // Split messages into chunks, respecting user+assistant pairs
  let currentTexts: string[] = [];
  let currentChars = 0;
  let chunkStart = messages[0].index;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const formatted = formatMessage(msg);
    const msgChars = formatted.length;

    // Would adding this message exceed the target?
    if (currentChars + msgChars > TARGET_CHARS && currentTexts.length > 0) {
      // Check: is this an assistant message following a user message?
      // If so, keep them together (don't split the pair)
      const prevMsg = i > 0 ? messages[i - 1] : null;
      const isResponseToPrev = msg.role === "assistant" && prevMsg?.role === "user";

      if (!isResponseToPrev) {
        // Safe to split here — flush the current chunk
        chunks.push({
          msgStart: chunkStart,
          msgEnd: messages[i - 1].index,
          text: currentTexts.join("\n"),
          isCompactSummary: false,
        });
        currentTexts = [];
        currentChars = 0;
        chunkStart = msg.index;
      }
    }

    currentTexts.push(formatted);
    currentChars += msgChars;
  }

  // Flush remaining messages
  if (currentTexts.length > 0) {
    chunks.push({
      msgStart: chunkStart,
      msgEnd: messages[messages.length - 1].index,
      text: currentTexts.join("\n"),
      isCompactSummary: false,
    });
  }

  return chunks;
}
