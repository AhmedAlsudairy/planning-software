import { neon } from "@neondatabase/serverless";
import { deriveSubtypeVocabulary, parseAttributes } from "../src/lib/normalization.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const sql = neon(DATABASE_URL);
const BATCH_SIZE = 2000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const vocabularyRows = await sql`SELECT short_description, class_name FROM materials WHERE status_active = true`;
  const subtypeVocabulary = deriveSubtypeVocabulary(vocabularyRows.map((row) => `${String(row.short_description)} ${String(row.class_name)}`));
  console.log(`Derived ${subtypeVocabulary.length} subtype terms from the active dataset.`);
  let processed = 0;
  let changed = 0;
  for (;;) {
    const rows = await sql`
      SELECT id, class_name, short_description, long_description, attributes
      FROM materials
      WHERE status_active = true
      ORDER BY id
      OFFSET ${processed} LIMIT ${BATCH_SIZE}
    `;
    if (!rows.length) break;
    const updates = rows
      .map((row) => {
        const recomputed = parseAttributes(`${row.short_description} ${row.long_description}`, String(row.class_name), subtypeVocabulary);
        return canonical(recomputed) === canonical(row.attributes) ? null : { id: row.id, attributes: recomputed };
      })
      .filter((entry): entry is { id: string; attributes: ReturnType<typeof parseAttributes> } => entry !== null);
    if (updates.length) {
      await sql.query(
        `UPDATE materials AS m SET attributes = x.attributes
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, attributes jsonb)
         WHERE m.id = x.id`,
        [JSON.stringify(updates)],
      );
      changed += updates.length;
    }
    processed += rows.length;
    console.log(`progress: ${processed} scanned, ${changed} updated`);
  }
  console.log(`Done. ${processed} active rows scanned, ${changed} attribute sets updated.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
