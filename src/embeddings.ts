import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let extractorResolved: FeatureExtractionPipeline | null = null;

export function isModelLoaded(): boolean {
  return extractorResolved !== null;
}

async function loadModel(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    console.error(`[claude-find] Loading embedding model (${MODEL_NAME})...`);
    extractorPromise = pipeline("feature-extraction", MODEL_NAME, {
      dtype: "fp32",
    });
    extractorPromise.then((model) => {
      extractorResolved = model;
      console.error("[claude-find] Model loaded.");
    });
  }
  return extractorPromise;
}

/**
 * Embed a single text. Use search_document: prefix for indexing,
 * search_query: prefix for queries.
 */
export async function getEmbedding(
  text: string,
  prefix: "search_document" | "search_query" = "search_document"
): Promise<Float32Array> {
  const model = await loadModel();
  const prefixed = `${prefix}: ${text}`;
  const output = await model(prefixed, { pooling: "mean", normalize: true });

  // Copy data out and dispose the tensor to free ONNX buffers
  const result = new Float32Array(output.data);
  output.dispose?.();
  return result;
}

/**
 * Embed multiple texts in a batch.
 */
export async function getEmbeddings(
  texts: string[],
  prefix: "search_document" | "search_query" = "search_document"
): Promise<Float32Array[]> {
  const model = await loadModel();
  const prefixed = texts.map((t) => `${prefix}: ${t}`);
  const output = await model(prefixed, { pooling: "mean", normalize: true });

  // Derive dimension from output, copy data, dispose tensor
  const dim = output.data.length / texts.length;
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(new Float32Array(output.data.slice(i * dim, (i + 1) * dim)));
  }
  output.dispose?.();
  return results;
}
