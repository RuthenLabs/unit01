import { IndexerDB, ChunkRecord } from '../../core/database/db.js';
import { generateLocalEmbedding, ensureEmbeddingModel } from './embeddings.js';
import { calculateCosineSimilarity, fuseRRF } from './hybrid.js';

/**
 * Scan all chunks in the SQLite database and generate vector embeddings
 * for any chunk that does not have one yet.
 */
export async function indexMissingEmbeddings(db: IndexerDB, silent: boolean = false): Promise<void> {
  const isAvailable = await ensureEmbeddingModel(silent);
  if (!isAvailable) {
    // Gracefully degrade if Ollama is offline or embedding model cannot be pulled
    return;
  }

  // Fetch all chunks from DB
  const chunks = db.getAllChunks();
  const missing = chunks.filter(c => !c.embedding);

  if (missing.length === 0) return;

  if (!silent) {
    console.log(`  ⚙️  [code index] Updating database vector index (${missing.length} new chunks)...`);
  }

  // Batch process to prevent local server exhaustion
  const batchSize = 10;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async chunk => {
        const vector = await generateLocalEmbedding(chunk.content);
        if (vector) {
          // Serialize vector array to JSON string for SQLite storage
          const embeddingStr = JSON.stringify(vector);
          
          // Execute database update
          db.db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').run(embeddingStr, chunk.id);
        }
      })
    );
  }
}

/**
 * Execute a hybrid lexical (FTS5) + semantic vector search query.
 */
export async function executeHybridSearch(db: IndexerDB, query: string): Promise<ChunkRecord[]> {
  // 1. Run standard FTS5 keyword lookup
  const ftsResults = db.searchChunks(query);

  // 2. Try generating embedding for user query
  const queryVector = await generateLocalEmbedding(query);
  if (!queryVector) {
    // If Ollama is offline, degrade gracefully to lexical FTS5 search
    return ftsResults.slice(0, 5);
  }

  // 3. Load all indexed chunks with embeddings
  const allChunks = db.getAllChunks();
  const vectorResults: { chunk: ChunkRecord; similarity: number }[] = [];

  for (const chunk of allChunks) {
    if (!chunk.embedding) continue;
    try {
      const chunkVector = JSON.parse(chunk.embedding) as number[];
      const similarity = calculateCosineSimilarity(queryVector, chunkVector);
      
      // Keep only high-affinity results (threshold > 0.45)
      if (similarity > 0.45) {
        vectorResults.push({ chunk, similarity });
      }
    } catch (_) {
      // Skip corrupt JSON strings
    }
  }

  // 4. Perform Reciprocal Rank Fusion
  const fusedList = fuseRRF(ftsResults, vectorResults);

  // 5. Return top 5 fusion ranked chunks
  return fusedList.slice(0, 5);
}
