import { ChunkRecord } from '../../core/database/db.js';

/**
 * Calculates the Cosine Similarity between two float arrays.
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Combines two ranked lists using Reciprocal Rank Fusion (RRF).
 * Formula: RRF(doc) = 1 / (60 + rank_fts) + 1 / (60 + rank_vector)
 */
export function fuseRRF(
  ftsResults: (ChunkRecord & { rank: number })[],
  vectorResults: { chunk: ChunkRecord; similarity: number }[]
): (ChunkRecord & { rrfScore: number })[] {
  const ftsMap = new Map<string, number>(); // ID -> Rank (1-indexed)
  ftsResults.forEach((res, idx) => {
    ftsMap.set(res.id, idx + 1);
  });

  const vectorMap = new Map<string, number>(); // ID -> Rank (1-indexed)
  // Sort vector results descending before mapping ranks
  const sortedVector = [...vectorResults].sort((a, b) => b.similarity - a.similarity);
  sortedVector.forEach((res, idx) => {
    vectorMap.set(res.chunk.id, idx + 1);
  });

  // Collect all unique chunks
  const allChunkIds = new Set<string>([...ftsMap.keys(), ...vectorMap.keys()]);
  const combinedList: (ChunkRecord & { rrfScore: number })[] = [];

  const getRecordFromResults = (id: string): ChunkRecord | null => {
    const fts = ftsResults.find(r => r.id === id);
    if (fts) return fts;
    const vec = vectorResults.find(r => r.chunk.id === id);
    if (vec) return vec.chunk;
    return null;
  };

  const RRF_CONSTANT = 60;

  allChunkIds.forEach(id => {
    const record = getRecordFromResults(id);
    if (!record) return;

    const ftsRank = ftsMap.get(id) ?? 10000; // Large fallback rank for missing items
    const vectorRank = vectorMap.get(id) ?? 10000;

    const rrfScore = (1 / (RRF_CONSTANT + ftsRank)) + (1 / (RRF_CONSTANT + vectorRank));

    combinedList.push({
      ...record,
      rrfScore
    });
  });

  // Sort descending by RRF score
  return combinedList.sort((a, b) => b.rrfScore - a.rrfScore);
}
