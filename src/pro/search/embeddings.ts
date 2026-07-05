import { ollama } from '../../core/llm/client.js';

// Default embedding model that runs fast on local CPUs
const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Generate a dense vector embedding (float array) for a string chunk using Ollama.
 * Falls back to null if the embedding model is not downloaded or running.
 */
export async function generateLocalEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text
      })
    });

    if (!response.ok) {
      // Model might not be downloaded yet, do not block indexer
      return null;
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding || null;
  } catch (err) {
    // Ollama is offline or embedding failed, degrade gracefully
    return null;
  }
}

/**
 * Trigger an automatic download of the nomic-embed-text model if not present.
 */
export async function ensureEmbeddingModel(silent: boolean = false): Promise<boolean> {
  try {
    const list = await ollama.listModels();
    const hasEmbedModel = list.some(m => m.name.startsWith(EMBEDDING_MODEL));
    if (hasEmbedModel) return true;

    // Pull model asynchronously
    if (!silent) {
      console.log(`  🔎 [code index] Pulling ${EMBEDDING_MODEL} embedding model...`);
    }
    const res = await fetch('http://127.0.0.1:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: EMBEDDING_MODEL, stream: false })
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}
