import { GoogleGenAI } from "@google/genai";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";

if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

const sql = neon(DATABASE_URL);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const BATCH_SIZE = 30;
const REQUEST_SPACING_MS = 1500;
const MAX_ATTEMPTS = 6;

function candidateDocument(row) {
  return `title: ${row.short_description || row.class_name} | text: ${row.class_name}; ${row.long_description}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DailyQuotaExhaustedError extends Error {}

async function embedWithRetry(text) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.embedContent({
        model: GEMINI_EMBEDDING_MODEL,
        contents: text,
        config: { outputDimensionality: 768 },
      });
      const values = response.embeddings?.[0]?.values;
      if (!values?.length) throw new Error("Gemini returned an empty embedding");
      return values;
    } catch (error) {
      const status = error?.status;
      if (status === 429 && /PerDay/.test(error?.message || "")) {
        throw new DailyQuotaExhaustedError("The free-tier daily embedding quota is exhausted. Re-run this script after it resets.");
      }
      const retryable = status === 429 || status === 503 || status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) throw error;
      const backoffMs = Math.min(60_000, 2000 * 2 ** attempt);
      console.warn(`  retry ${attempt}/${MAX_ATTEMPTS} after ${status} (waiting ${backoffMs}ms): ${error?.message}`);
      await sleep(backoffMs);
    }
  }
  throw new Error("unreachable");
}

async function processBatch(rows) {
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    const requestStarted = Date.now();
    try {
      const embedding = await embedWithRetry(candidateDocument(row));
      await sql.query("UPDATE materials SET embedding = $1::vector, updated_at = updated_at WHERE id = $2", [`[${embedding.join(",")}]`, row.id]);
      done++;
    } catch (error) {
      if (error instanceof DailyQuotaExhaustedError) return { done, failed, exhausted: true };
      failed++;
      console.error("  failed:", error?.message || error);
    }
    const remaining = REQUEST_SPACING_MS - (Date.now() - requestStarted);
    if (remaining > 0) await sleep(remaining);
  }
  return { done, failed };
}

async function main() {
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM materials WHERE status_active = true AND embedding IS NULL`;
  console.log(`Backfilling embeddings for ${total} active rows without one (model: ${GEMINI_EMBEDDING_MODEL})`);
  let processed = 0;
  let failedTotal = 0;
  const started = Date.now();
  for (;;) {
    const rows = await sql.query(
      "SELECT id, class_name, short_description, long_description FROM materials WHERE status_active = true AND embedding IS NULL ORDER BY id LIMIT $1",
      [BATCH_SIZE],
    );
    if (!rows.length) break;
    const { done, failed, exhausted } = await processBatch(rows);
    processed += done;
    failedTotal += failed;
    const elapsedS = Math.round((Date.now() - started) / 1000);
    console.log(`progress: ${processed}/${total} embedded, ${failedTotal} failed (${elapsedS}s elapsed)`);
    if (exhausted) {
      console.log(`Stopping: daily embedding quota exhausted. ${total - processed} rows remain — re-run this script tomorrow (it resumes automatically).`);
      return;
    }
  }
  console.log(`Done. Embedded ${processed} rows, ${failedTotal} failures remain (re-run to retry them).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
