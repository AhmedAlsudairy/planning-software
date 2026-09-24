import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { runSearch } from "@/lib/search";
import { expandAbbreviations } from "@/lib/vocabulary";

/**
 * Retrieval quality gate, measured against the promoted upload rather than asserted.
 *
 * Opt-in because it needs a database and issues real searches: `npm run eval-search`. The .eval.ts
 * suffix keeps it out of `npm run verify`. Without a measurement like this, tuning ranking is
 * guesswork - a change that visibly improves one query routinely regresses ten others, and only an
 * aggregate over a sample catches that.
 *
 * The gold set is built from the catalog itself: each sampled row's own short description is
 * paraphrased into something a person might type, and the row it came from is the right answer.
 */
const SAMPLE_SIZE = Number(process.env.SEARCH_EVAL_SAMPLE || 60);
const RESULT_LIMIT = 10;

// Deterministic, so a recall change between runs is a change in the ranking and not in the sample.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Turns a catalog short description into a plausible query: expanded out of the SAP abbreviations,
 * lower-cased, punctuation dropped and word order disturbed. The reordering matters - left verbatim
 * the description would hit the exact-match arm and the measurement would be meaningless.
 */
function paraphrase(shortDescription: string, seed: number): string {
  const words = expandAbbreviations(shortDescription)
    .replace(/[^A-Z0-9/."'-]+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter((word) => word.length > 1);
  const random = seededRandom(seed);
  for (let index = words.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [words[index], words[swap]] = [words[swap], words[index]];
  }
  return words.join(" ");
}

interface Outcome {
  query: string;
  expected: string;
  rank: number | null;
  top: string;
}

function rate(outcomes: Outcome[], within: number): number {
  const hits = outcomes.filter((outcome) => outcome.rank != null && outcome.rank <= within).length;
  return outcomes.length ? hits / outcomes.length : 0;
}

describe("search retrieval quality", () => {
  it(`finds the right material for a paraphrase of its own description`, async () => {
    process.loadEnvFile(".env.local");
    expect(process.env.DATABASE_URL, "DATABASE_URL must be configured to evaluate retrieval").toBeTruthy();
    const sql = neon(process.env.DATABASE_URL as string);
    const rows = (await sql`
      SELECT sap_no, short_description
      FROM materials
      WHERE upload_id = (SELECT current_upload_id FROM material_settings WHERE id = 1)
        AND status_active = true
        AND length(short_description) >= 12
      ORDER BY md5(sap_no)
      LIMIT ${SAMPLE_SIZE}
    `) as Array<{ sap_no: string; short_description: string }>;
    expect(rows.length, "no promoted upload to evaluate - import a file first").toBeGreaterThan(0);

    const outcomes: Outcome[] = [];
    for (const [index, row] of rows.entries()) {
      const query = paraphrase(row.short_description, index + 1);
      if (query.split(" ").length < 2) continue;
      const result = await runSearch(query, RESULT_LIMIT);
      const position = result.matches.findIndex((match) => match.sapNo === row.sap_no);
      outcomes.push({
        query,
        expected: row.sap_no,
        rank: position === -1 ? null : position + 1,
        top: result.matches[0]?.shortDescription ?? "(no results)",
      });
    }

    const mrr = outcomes.reduce((sum, outcome) => sum + (outcome.rank ? 1 / outcome.rank : 0), 0) / outcomes.length;
    const empty = outcomes.filter((outcome) => outcome.top === "(no results)").length;
    const report = [
      `sample            ${outcomes.length}`,
      `recall@1          ${(rate(outcomes, 1) * 100).toFixed(1)}%`,
      `recall@5          ${(rate(outcomes, 5) * 100).toFixed(1)}%`,
      `recall@${RESULT_LIMIT}         ${(rate(outcomes, RESULT_LIMIT) * 100).toFixed(1)}%`,
      `MRR               ${mrr.toFixed(3)}`,
      `queries with none ${empty}`,
    ].join("\n");
    const misses = outcomes.filter((outcome) => outcome.rank == null).slice(0, 10)
      .map((outcome) => `  MISS ${outcome.expected} "${outcome.query}" -> ${outcome.top}`).join("\n");
    const output = `${report}${misses ? `\n\nworst cases:\n${misses}` : ""}`;
    console.info(`\n${output}\n`);
    // Also written to disk: vitest suppresses console output under some reporters, and the measured
    // number is the entire point of the run.
    writeFileSync(process.env.SEARCH_EVAL_REPORT || "search-eval-report.txt", `${output}\n`);

    // A query that returns nothing is the failure this measurement exists to prevent, so it is the
    // one gate with no tolerance.
    //
    // The recall floors are regression alarms, not targets, and sit well below the baseline
    // measured on the 12,257-row reference export (recall@1 81.7%, recall@5 85.0%, recall@10 86.7%,
    // MRR 0.831 over a 60-row sample). Note that shuffling the word order makes these queries
    // harder than anything a person types, so the baseline understates real-world recall.
    expect(empty, "every query must return candidates").toBe(0);
    expect(rate(outcomes, RESULT_LIMIT)).toBeGreaterThanOrEqual(0.8);
    expect(rate(outcomes, 5)).toBeGreaterThanOrEqual(0.75);
  }, 1_800_000);
});
