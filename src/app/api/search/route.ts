import { z } from "zod";
import { findCandidates } from "@/lib/db";
import { embedSearchQuery, extractQueryAttributes, hydrateCandidateEmbeddings } from "@/lib/gemini";
import { rankCandidates, shortlistCandidates } from "@/lib/matcher";
import { parseAttributes } from "@/lib/normalization";
import type { SearchResponse } from "@/types/material";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  query: z.string().trim().min(3).max(2_000),
  limit: z.number().int().min(3).max(10).default(5),
});

export async function POST(request: Request) {
  const started = performance.now();
  try {
    const input = requestSchema.parse(await request.json());
    const warnings: string[] = [];
    const deterministic = parseAttributes(input.query);
    let parsedQuery = deterministic;
    if (process.env.GEMINI_API_KEY) {
      try {
        parsedQuery = await extractQueryAttributes(input.query, deterministic);
      } catch {
        warnings.push("Gemini attribute extraction was unavailable; deterministic extraction was used.");
      }
    } else {
      warnings.push("GEMINI_API_KEY is not configured; deterministic extraction and lexical similarity were used.");
    }
    const candidates = await findCandidates(input.query, parsedQuery, 60);
    const shortlist = shortlistCandidates(parsedQuery, candidates, Math.max(input.limit * 2, 8));
    let queryEmbedding: number[] | null = null;
    if (process.env.GEMINI_API_KEY && shortlist.length) {
      try {
        [queryEmbedding] = await Promise.all([
          embedSearchQuery(input.query),
          hydrateCandidateEmbeddings(shortlist),
        ]);
      } catch {
        warnings.push("Gemini semantic embeddings were unavailable; lexical similarity was used as a fallback.");
      }
    }
    const response: SearchResponse = {
      query: input.query,
      parsedQuery,
      matches: rankCandidates(parsedQuery, shortlist, queryEmbedding, input.limit),
      semanticMode: queryEmbedding ? "gemini" : "lexical-fallback",
      warnings,
      elapsedMs: Math.round(performance.now() - started),
    };
    return Response.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Enter a material specification of at least 3 characters" }, { status: 400 });
    const message = error instanceof Error ? error.message : "Search failed";
    return Response.json({ error: message.includes("DATABASE_URL") ? message : "The search could not be completed" }, { status: 500 });
  }
}
