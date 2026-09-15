import { findCandidates, getSubtypeVocabulary } from "@/lib/db";
import { embedSearchQuery, extractQueryAttributes, hydrateCandidateEmbeddings } from "@/lib/gemini";
import { rankCandidates, shortlistCandidates } from "@/lib/matcher";
import { parseAttributes } from "@/lib/normalization";
import type { SearchResponse } from "@/types/material";

export async function runSearch(query: string, limit: number): Promise<SearchResponse> {
  const started = performance.now();
  const warnings: string[] = [];
  const subtypeVocabulary = await getSubtypeVocabulary();
  const deterministic = parseAttributes(query, "", subtypeVocabulary, true);
  let parsedQuery = deterministic;
  if (process.env.GEMINI_API_KEY) {
    try {
      parsedQuery = await extractQueryAttributes(query, deterministic);
    } catch {
      warnings.push("Gemini attribute extraction was unavailable; deterministic extraction was used.");
    }
  } else {
    warnings.push("GEMINI_API_KEY is not configured; deterministic extraction and lexical similarity were used.");
  }
  const candidates = await findCandidates(query, parsedQuery, 120);
  const shortlist = shortlistCandidates(parsedQuery, candidates, Math.max(limit * 2, 8));
  let queryEmbedding: number[] | null = null;
  if (process.env.GEMINI_API_KEY && shortlist.length) {
    try {
      [queryEmbedding] = await Promise.all([
        embedSearchQuery(query),
        hydrateCandidateEmbeddings(shortlist),
      ]);
    } catch {
      warnings.push("Gemini semantic embeddings were unavailable; lexical similarity was used as a fallback.");
    }
  }
  return {
    query,
    parsedQuery,
    matches: rankCandidates(parsedQuery, shortlist, queryEmbedding, limit),
    semanticMode: queryEmbedding ? "gemini" : "lexical-fallback",
    warnings,
    elapsedMs: Math.round(performance.now() - started),
  };
}

const BATCH_CONCURRENCY = 3;

export async function runBatchSearch(items: string[], limit: number): Promise<SearchResponse[]> {
  const results: SearchResponse[] = new Array(items.length);
  for (let offset = 0; offset < items.length; offset += BATCH_CONCURRENCY) {
    const slice = items.slice(offset, offset + BATCH_CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async (item) => {
        try {
          return await runSearch(item, limit);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Search failed";
          return { query: item, parsedQuery: parseAttributes(item, "", undefined, true), matches: [], semanticMode: "lexical-fallback", warnings: [message], elapsedMs: 0 } satisfies SearchResponse;
        }
      }),
    );
    settled.forEach((result, index) => { results[offset + index] = result; });
  }
  return results;
}
