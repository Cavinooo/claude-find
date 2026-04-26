import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5";
const OLLAMA_URL = "http://localhost:11434";
const OLLAMA_MODEL = "nomic-embed-text";

let useOllama: boolean | null = null; // null = not yet checked
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let extractorResolved: FeatureExtractionPipeline | null = null;

export function isModelLoaded(): boolean {
  return useOllama === true || extractorResolved !== null;
}

/**
 * Check if Ollama is running and has the embedding model.
 */
async function checkOllama(): Promise<boolean> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return false;
    const data = await resp.json() as any;
    const models = data.models || [];
    return models.some((m: any) => m.name?.startsWith(OLLAMA_MODEL));
  } catch {
    return false;
  }
}

/**
 * Embed via Ollama HTTP API (Metal GPU accelerated).
 */
async function embedViaOllama(texts: string[], prefix: string): Promise<Float32Array[]> {
  const prefixed = texts.map((t) => `${prefix}: ${t}`);
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: prefixed }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama embed failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as any;
  return data.embeddings.map((emb: number[]) => new Float32Array(emb));
}

/**
 * Load transformers.js model as fallback.
 */
async function loadTransformersModel(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    console.error(`[claude-find] Loading embedding model (${MODEL_NAME})...`);
    extractorPromise = pipeline("feature-extraction", MODEL_NAME, {
      dtype: "q8",
    });
    extractorPromise.then((model) => {
      extractorResolved = model;
      console.error("[claude-find] Model loaded.");
    });
  }
  return extractorPromise;
}

/**
 * Embed via transformers.js (CPU, fallback).
 */
async function embedViaTransformers(texts: string[], prefix: string): Promise<Float32Array[]> {
  const model = await loadTransformersModel();
  const results: Float32Array[] = [];

  for (const text of texts) {
    const prefixed = `${prefix}: ${text}`;
    const output = await model(prefixed, { pooling: "mean", normalize: true });
    results.push(new Float32Array(output.data));
    output.dispose?.();
  }

  return results;
}

/**
 * Initialize embedding backend — prefer Ollama if available.
 */
async function init(): Promise<void> {
  if (useOllama !== null) return;

  const ollamaAvailable = await checkOllama();
  if (ollamaAvailable) {
    useOllama = true;
    console.error("[claude-find] Using Ollama (Metal GPU accelerated)");
  } else {
    useOllama = false;
    console.error("[claude-find] Ollama not available, using transformers.js (slower)");
    console.error("[claude-find] For faster indexing: brew install ollama && ollama pull nomic-embed-text");
  }
}

/**
 * Embed a single text.
 */
export async function getEmbedding(
  text: string,
  prefix: "search_document" | "search_query" = "search_document"
): Promise<Float32Array> {
  await init();
  const results = useOllama
    ? await embedViaOllama([text], prefix)
    : await embedViaTransformers([text], prefix);
  return results[0];
}

/**
 * Embed multiple texts in a batch.
 */
export async function getEmbeddings(
  texts: string[],
  prefix: "search_document" | "search_query" = "search_document"
): Promise<Float32Array[]> {
  await init();

  if (useOllama) {
    // Ollama handles batching natively, fall back to individual on error
    const BATCH_SIZE = 8;
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      try {
        const batchResults = await embedViaOllama(batch, prefix);
        results.push(...batchResults);
      } catch (err: any) {
        // Only retry individually for content errors (4xx).
        // Network/server errors (connection refused, 5xx) should propagate.
        const status = err?.message?.match(/(\d{3})/)?.[1];
        if (status && parseInt(status) >= 400 && parseInt(status) < 500) {
          for (const text of batch) {
            try {
              const [single] = await embedViaOllama([text], prefix);
              results.push(single);
            } catch {
              console.error(`[claude-find] Warning: failed to embed chunk (${text.length} chars), skipping`);
              results.push(new Float32Array(768));
            }
          }
        } else {
          throw err; // Network/server error — don't retry, propagate
        }
      }
    }
    return results;
  }

  return embedViaTransformers(texts, prefix);
}
