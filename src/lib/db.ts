import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { buildDashboardInsights, percentage } from "@/lib/dashboard";
import { deriveSubtypeVocabulary } from "@/lib/normalization";
import type { ClassQualityItem, DashboardAnalytics, DashboardSummary, DistributionItem, MissingPattern, PlantHealthItem, QualityMetric } from "@/types/dashboard";
import type { MaterialAttributes, MaterialCandidate, MaterialImportRow } from "@/types/material";

let schemaPromise: Promise<void> | null = null;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return neon(connectionString);
}

export async function ensureSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const sql = getSql();
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    await sql`
      CREATE TABLE IF NOT EXISTS material_uploads (
        id text PRIMARY KEY,
        file_name text NOT NULL,
        sheet_name text NOT NULL,
        row_count integer NOT NULL DEFAULT 0,
        active_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS material_import_lock (
        id integer PRIMARY KEY CHECK (id = 1),
        upload_id text NOT NULL,
        locked_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS material_settings (
        id integer PRIMARY KEY CHECK (id = 1),
        current_upload_id text REFERENCES material_uploads(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS materials (
        id text PRIMARY KEY,
        corporate_no text NOT NULL,
        sap_no text NOT NULL,
        plant text NOT NULL DEFAULT '',
        class_name text NOT NULL DEFAULT '',
        short_description text NOT NULL DEFAULT '',
        long_description text NOT NULL DEFAULT '',
        uom text NOT NULL DEFAULT '',
        material_type text NOT NULL DEFAULT '',
        unspsc text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        status_description text NOT NULL DEFAULT '',
        item_type_source text NOT NULL DEFAULT '',
        attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
        status_active boolean NOT NULL DEFAULT true,
        raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        embedding vector(768),
        upload_id text NOT NULL REFERENCES material_uploads(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        search_text text GENERATED ALWAYS AS (
          lower(class_name || ' ' || short_description || ' ' || long_description)
        ) STORED,
        search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('simple'::regconfig, class_name || ' ' || short_description || ' ' || long_description)
        ) STORED,
        status_rank smallint GENERATED ALWAYS AS (
          CASE WHEN status = 'B2-ERP ACCEPTED' THEN 0 WHEN status LIKE 'C2-RFC%' THEN 1 ELSE 2 END
        ) STORED,
        UNIQUE (upload_id, corporate_no, sap_no, plant)
      )
    `;
    await sql`ALTER TABLE materials DROP CONSTRAINT IF EXISTS materials_corporate_no_sap_no_plant_key`;
    await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS status_rank smallint GENERATED ALWAYS AS (
      CASE WHEN status = 'B2-ERP ACCEPTED' THEN 0 WHEN status LIKE 'C2-RFC%' THEN 1 ELSE 2 END
    ) STORED`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS materials_upload_identity_idx ON materials(upload_id, corporate_no, sap_no, plant)`;
    await sql`CREATE INDEX IF NOT EXISTS materials_search_vector_idx ON materials USING gin(search_vector)`;
    await sql`CREATE INDEX IF NOT EXISTS materials_search_trgm_idx ON materials USING gin(search_text gin_trgm_ops)`;
    await sql`CREATE INDEX IF NOT EXISTS materials_filter_idx ON materials(status_active, class_name)`;
    await sql`CREATE INDEX IF NOT EXISTS materials_class_trgm_idx ON materials USING gin(lower(class_name) gin_trgm_ops)`;
    await sql`CREATE INDEX IF NOT EXISTS materials_dedup_idx ON materials(upload_id, status_active, corporate_no, sap_no, status_rank, updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS materials_embedding_idx ON materials USING hnsw(embedding vector_cosine_ops)`;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

let subtypeVocabularyCache: { terms: string[]; expiresAt: number } | null = null;
const SUBTYPE_VOCABULARY_TTL_MS = 5 * 60 * 1000;

export async function getSubtypeVocabulary(): Promise<string[]> {
  if (subtypeVocabularyCache && subtypeVocabularyCache.expiresAt > Date.now()) return subtypeVocabularyCache.terms;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT DISTINCT class_name FROM materials WHERE upload_id = (SELECT current_upload_id FROM material_settings WHERE id = 1) AND status_active = true`;
  const terms = deriveSubtypeVocabulary(rows.map((row) => String(row.class_name)));
  subtypeVocabularyCache = { terms, expiresAt: Date.now() + SUBTYPE_VOCABULARY_TTL_MS };
  return terms;
}

export class ImportInProgressError extends Error {
  constructor() {
    super("Another material import is currently running. Wait for it to finish before uploading again.");
    this.name = "ImportInProgressError";
  }
}

const IMPORT_BATCH_SIZE = 3000;
const IMPORT_CONCURRENCY = 6;

const IMPORT_UPSERT_SQL = `INSERT INTO materials (
    id, corporate_no, sap_no, plant, class_name, short_description, long_description,
    uom, material_type, unspsc, status, status_description, item_type_source, attributes,
    status_active, raw_data, upload_id
  )
  SELECT x.id, x.corporate_no, x.sap_no, x.plant, x.class_name, x.short_description,
    x.long_description, x.uom, x.material_type, x.unspsc, x.status, x.status_description,
    x.item_type_source, x.attributes, x.status_active, x.raw_data, x.upload_id
  FROM jsonb_to_recordset($1::jsonb) AS x(
    id text, corporate_no text, sap_no text, plant text, class_name text,
    short_description text, long_description text, uom text, material_type text,
    unspsc text, status text, status_description text, item_type_source text,
    attributes jsonb, status_active boolean, raw_data jsonb, upload_id text
  )
  ON CONFLICT (upload_id, corporate_no, sap_no, plant) DO UPDATE SET
    class_name = EXCLUDED.class_name,
    short_description = EXCLUDED.short_description,
    long_description = EXCLUDED.long_description,
    uom = EXCLUDED.uom,
    material_type = EXCLUDED.material_type,
    unspsc = EXCLUDED.unspsc,
    status = EXCLUDED.status,
    status_description = EXCLUDED.status_description,
    item_type_source = EXCLUDED.item_type_source,
    attributes = EXCLUDED.attributes,
    status_active = EXCLUDED.status_active,
    raw_data = EXCLUDED.raw_data,
    upload_id = EXCLUDED.upload_id,
    embedding = CASE
      WHEN materials.long_description = EXCLUDED.long_description AND materials.short_description = EXCLUDED.short_description THEN materials.embedding
      ELSE NULL
    END,
    updated_at = now()`;

export async function importMaterials(fileName: string, sheetName: string, rows: MaterialImportRow[]): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const uploadId = randomUUID();
  const lock = await sql`
    INSERT INTO material_import_lock (id, upload_id, locked_at)
    VALUES (1, ${uploadId}, now())
    ON CONFLICT (id) DO UPDATE SET upload_id = EXCLUDED.upload_id, locked_at = now()
    WHERE material_import_lock.locked_at < now() - interval '30 minutes'
    RETURNING upload_id
  `;
  if (!lock.length) throw new ImportInProgressError();
  try {
    return await runImport(sql, uploadId, fileName, sheetName, rows);
  } finally {
    await sql`DELETE FROM material_import_lock WHERE id = 1 AND upload_id = ${uploadId}`;
  }
}

type SqlClient = ReturnType<typeof getSql>;

async function runImport(sql: SqlClient, uploadId: string, fileName: string, sheetName: string, rows: MaterialImportRow[]): Promise<string> {
  const uniqueRows = [...new Map(rows.map((row) => [`${row.corporateNo}|${row.sapNo}|${row.plant}`, row])).values()];
  const activeCount = uniqueRows.filter((row) => row.statusActive).length;
  await sql`INSERT INTO material_uploads (id, file_name, sheet_name, row_count, active_count) VALUES (${uploadId}, ${fileName}, ${sheetName}, ${uniqueRows.length}, ${activeCount})`;
  const batches: MaterialImportRow[][] = [];
  for (let offset = 0; offset < uniqueRows.length; offset += IMPORT_BATCH_SIZE) batches.push(uniqueRows.slice(offset, offset + IMPORT_BATCH_SIZE));
  for (let offset = 0; offset < batches.length; offset += IMPORT_CONCURRENCY) {
    await Promise.all(
      batches.slice(offset, offset + IMPORT_CONCURRENCY).map((batch) => {
        const payload = batch.map((row) => ({
          id: randomUUID(),
          corporate_no: row.corporateNo,
          sap_no: row.sapNo,
          plant: row.plant,
          class_name: row.className,
          short_description: row.shortDescription,
          long_description: row.longDescription,
          uom: row.uom,
          material_type: row.materialType,
          unspsc: row.unspsc,
          status: row.status,
          status_description: row.statusDescription,
          item_type_source: row.itemTypeSource,
          attributes: row.attributes,
          status_active: row.statusActive,
          raw_data: row.rawData,
          upload_id: uploadId,
        }));
        return sql.query(IMPORT_UPSERT_SQL, [JSON.stringify(payload)]);
      }),
    );
  }
  await sql.query(
    `UPDATE materials fresh
      SET embedding = previous.embedding
      FROM materials previous, material_settings settings
      WHERE settings.id = 1
        AND previous.upload_id = settings.current_upload_id
        AND fresh.upload_id = $1
        AND fresh.corporate_no = previous.corporate_no
        AND fresh.sap_no = previous.sap_no
        AND fresh.plant = previous.plant
        AND fresh.short_description = previous.short_description
        AND fresh.long_description = previous.long_description
        AND previous.embedding IS NOT NULL`,
    [uploadId],
  );
  const imported = await sql`SELECT count(*)::int AS count FROM materials WHERE upload_id = ${uploadId}`;
  if (Number(imported[0]?.count || 0) !== uniqueRows.length) {
    await sql`DELETE FROM materials WHERE upload_id = ${uploadId}`;
    await sql`DELETE FROM material_uploads WHERE id = ${uploadId}`;
    throw new Error(`The import stored ${imported[0]?.count ?? 0} of ${uniqueRows.length} rows and was rolled back`);
  }
  await sql.transaction([
    sql`INSERT INTO material_settings (id, current_upload_id) VALUES (1, ${uploadId}) ON CONFLICT (id) DO UPDATE SET current_upload_id = EXCLUDED.current_upload_id, updated_at = now()`,
    sql`DELETE FROM materials WHERE upload_id <> ${uploadId}`,
    sql`DELETE FROM material_uploads WHERE id <> ${uploadId}`,
  ]);
  await sql`ANALYZE materials`;
  subtypeVocabularyCache = null;
  return uploadId;
}

function parseEmbedding(value: unknown): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "string") return value.replace(/^\[|\]$/g, "").split(",").filter(Boolean).map(Number);
  return null;
}

// A SAP code or corporate number never resembles an engineering description, so lexical/trigram
// text scoring against class_name+description never finds it. Detect that shape and look it up
// directly instead of only scoring free text.
function extractCodeToken(query: string): string {
  const trimmed = query.trim().toUpperCase().replace(/\s+/g, "");
  if (/^\d{4,}$/.test(trimmed)) return trimmed;
  if (/^[A-Z]\d{6,}$/.test(trimmed)) return trimmed;
  if (/^NIR-/.test(trimmed)) return trimmed;
  return "";
}

export async function findCandidates(query: string, attributes: MaterialAttributes, limit = 24): Promise<MaterialCandidate[]> {
  await ensureSchema();
  const sql = getSql();
  const classFilter = attributes.itemType ? `%${attributes.itemType.toLowerCase()}%` : "%";
  const codeToken = extractCodeToken(query);
  const rows = await sql.query(
    `WITH scored AS (
      SELECT m.*,
        (CASE WHEN $8::text <> '' AND (m.sap_no LIKE '%' || $8 || '%' OR upper(m.corporate_no) LIKE '%' || $8 || '%') THEN 1
              ELSE ts_rank_cd(m.search_vector, plainto_tsquery('simple', $1)) END) AS lexical_score,
        (CASE WHEN $8::text <> '' AND (m.sap_no LIKE '%' || $8 || '%' OR upper(m.corporate_no) LIKE '%' || $8 || '%') THEN 1
              ELSE greatest(similarity(m.search_text, lower($1)), word_similarity(lower($1), m.search_text)) END) AS fuzzy_score,
        (
          CASE WHEN $8::text <> '' AND (m.sap_no LIKE '%' || $8 || '%' OR upper(m.corporate_no) LIKE '%' || $8 || '%') THEN 3 ELSE 0 END +
          CASE WHEN $4::text <> '' AND (upper(coalesce(m.attributes->>'subtype', '')) = $4 OR upper(m.class_name) LIKE '%' || $4 || '%') THEN 0.5 ELSE 0 END +
          CASE WHEN $5::double precision IS NOT NULL AND m.attributes->>'sizeMm' IS NOT NULL AND abs((m.attributes->>'sizeMm')::double precision - $5) <= 1 THEN 0.35 ELSE 0 END +
          CASE WHEN $6::text <> '' AND upper(coalesce(m.attributes->>'connection', '')) = $6 THEN 0.15 ELSE 0 END +
          CASE WHEN $7::text <> '' AND upper(coalesce(m.attributes->>'pressureClass', '')) = $7 THEN 0.15 ELSE 0 END
        ) AS engineering_score,
        row_number() OVER (
          PARTITION BY m.corporate_no, m.sap_no
          ORDER BY m.status_rank, m.updated_at DESC
        ) AS material_rank
      FROM materials m
      WHERE m.upload_id = (SELECT current_upload_id FROM material_settings WHERE id = 1)
        AND m.status_active = true
        AND (lower(m.class_name) LIKE $2 OR ($8::text <> '' AND (m.sap_no LIKE '%' || $8 || '%' OR upper(m.corporate_no) LIKE '%' || $8 || '%')))
    )
    SELECT id, corporate_no, sap_no, plant, class_name, short_description, long_description,
      uom, material_type, unspsc, status, status_description, item_type_source, attributes,
      status_active, raw_data, embedding::text, lexical_score, fuzzy_score
    FROM scored
    WHERE material_rank = 1
    ORDER BY (engineering_score * 0.65 + lexical_score * 0.15 + fuzzy_score * 0.2) DESC
    LIMIT $3`,
    [query, classFilter, limit, attributes.subtype || "", attributes.sizeMm, attributes.connection || "", attributes.pressureClass || "", codeToken],
  );
  return rows.map((row) => ({
    id: String(row.id),
    corporateNo: String(row.corporate_no),
    sapNo: String(row.sap_no),
    plant: String(row.plant),
    className: String(row.class_name),
    shortDescription: String(row.short_description),
    longDescription: String(row.long_description),
    uom: String(row.uom),
    materialType: String(row.material_type),
    unspsc: String(row.unspsc),
    status: String(row.status),
    statusDescription: String(row.status_description),
    itemTypeSource: String(row.item_type_source),
    attributes: row.attributes as MaterialAttributes,
    statusActive: Boolean(row.status_active),
    rawData: row.raw_data as Record<string, string>,
    embedding: parseEmbedding(row.embedding),
    lexicalScore: Math.max(0, Number(row.lexical_score) || 0),
    fuzzyScore: Math.max(0, Number(row.fuzzy_score) || 0),
  }));
}

export async function saveEmbedding(id: string, embedding: number[]): Promise<void> {
  const sql = getSql();
  await sql.query("UPDATE materials SET embedding = $1::vector, updated_at = updated_at WHERE id = $2", [`[${embedding.join(",")}]`, id]);
}

export async function getMaterialStats() {
  if (!process.env.DATABASE_URL) return { configured: false, materials: 0, active: 0, uploads: 0, lastUpload: null };
  await ensureSchema();
  const sql = getSql();
  const [counts, latest] = await Promise.all([
    sql`SELECT count(*)::int AS materials, count(*) FILTER (WHERE status_active)::int AS active, (SELECT count(*)::int FROM material_uploads) AS uploads FROM materials WHERE upload_id = (SELECT current_upload_id FROM material_settings WHERE id = 1)`,
    sql`SELECT u.id, u.file_name, u.row_count, u.active_count, u.created_at FROM material_uploads u JOIN material_settings s ON s.current_upload_id = u.id WHERE s.id = 1`,
  ]);
  return {
    configured: true,
    materials: Number(counts[0]?.materials || 0),
    active: Number(counts[0]?.active || 0),
    uploads: Number(counts[0]?.uploads || 0),
    lastUpload: latest[0] || null,
  };
}

const readinessExpression = `
  CASE WHEN nullif(long_description, '') IS NOT NULL THEN 20 ELSE 0 END +
  CASE WHEN nullif(attributes->>'itemType', '') IS NOT NULL THEN 15 ELSE 0 END +
  CASE WHEN nullif(attributes->>'subtype', '') IS NOT NULL THEN 10 ELSE 0 END +
  CASE WHEN nullif(attributes->>'sizeMm', '') IS NOT NULL THEN 15 ELSE 0 END +
  CASE WHEN nullif(attributes->>'pressureClass', '') IS NOT NULL OR nullif(attributes->>'pressureBar', '') IS NOT NULL THEN 10 ELSE 0 END +
  CASE WHEN nullif(attributes->>'connection', '') IS NOT NULL THEN 10 ELSE 0 END +
  CASE WHEN jsonb_array_length(coalesce(attributes->'materials', '[]'::jsonb)) > 0 THEN 10 ELSE 0 END +
  CASE WHEN jsonb_array_length(coalesce(attributes->'standards', '[]'::jsonb)) > 0 THEN 5 ELSE 0 END +
  CASE WHEN nullif(attributes->>'actuation', '') IS NOT NULL THEN 5 ELSE 0 END
`;

function distribution(rows: Record<string, unknown>[], total: number): DistributionItem[] {
  return rows.map((row) => ({
    label: String(row.label || "UNSPECIFIED"),
    count: Number(row.count || 0),
    percentage: percentage(Number(row.count || 0), total),
    active: row.active == null ? undefined : Number(row.active),
    inactive: row.inactive == null ? undefined : Number(row.inactive),
    readiness: row.readiness == null ? undefined : Math.round(Number(row.readiness) * 10) / 10,
  }));
}

export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  await ensureSchema();
  const sql = getSql();
  const currentUpload = `(SELECT current_upload_id FROM material_settings WHERE id = 1)`;
  const [summaryRows, uploadRows, statusRows, classRows, plantRows, materialTypeRows, qualityRows, readinessRows, duplicateRows, descriptionRows, yearRows, missingRows] = await Promise.all([
    sql.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status_active)::int AS active,
      count(DISTINCT (corporate_no, sap_no))::int AS unique_materials,
      count(DISTINCT nullif(plant, ''))::int AS plants,
      count(DISTINCT nullif(class_name, ''))::int AS classes,
      count(*) FILTER (WHERE status_active AND embedding IS NOT NULL)::int AS embedded,
      count(*) FILTER (WHERE sap_no ~ '^[0-9]+$')::int AS numeric_sap,
      count(*) FILTER (WHERE upper(sap_no) LIKE 'NIR-%')::int AS provisional_sap,
      count(*) FILTER (WHERE nullif(sap_no, '') IS NULL)::int AS missing_sap,
      count(*) FILTER (WHERE upper(trim(class_name)) IN ('', 'MATERIAL', 'GENERIC'))::int AS generic_class,
      count(*) FILTER (WHERE raw_data->>'Created Date' ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$')::int AS dated,
      coalesce(avg(length(long_description)) FILTER (WHERE status_active), 0)::double precision AS average_description_length,
      coalesce(avg((${readinessExpression})) FILTER (WHERE status_active), 0)::double precision AS readiness
      FROM materials WHERE upload_id = ${currentUpload}`),
    sql.query(`SELECT u.file_name, u.sheet_name, u.row_count, u.active_count, u.created_at FROM material_uploads u JOIN material_settings s ON s.current_upload_id = u.id WHERE s.id = 1`),
    sql.query(`SELECT coalesce(nullif(status, ''), 'UNSPECIFIED') AS label, count(*)::int AS count, count(*) FILTER (WHERE status_active)::int AS active, count(*) FILTER (WHERE NOT status_active)::int AS inactive FROM materials WHERE upload_id = ${currentUpload} GROUP BY status ORDER BY count DESC`),
    sql.query(`SELECT coalesce(nullif(class_name, ''), 'UNSPECIFIED') AS label, count(*)::int AS count,
      count(*) FILTER (WHERE status_active)::int AS active, count(*) FILTER (WHERE NOT status_active)::int AS inactive,
      coalesce(avg((${readinessExpression})) FILTER (WHERE status_active), 0)::double precision AS readiness,
      count(*) FILTER (WHERE status_active AND nullif(attributes->>'sizeMm', '') IS NOT NULL)::int AS size_count,
      count(*) FILTER (WHERE status_active AND (nullif(attributes->>'pressureClass', '') IS NOT NULL OR nullif(attributes->>'pressureBar', '') IS NOT NULL))::int AS pressure_count,
      count(*) FILTER (WHERE status_active AND nullif(attributes->>'connection', '') IS NOT NULL)::int AS connection_count,
      count(*) FILTER (WHERE status_active AND jsonb_array_length(coalesce(attributes->'materials', '[]'::jsonb)) > 0)::int AS material_count,
      count(*) FILTER (WHERE status_active AND jsonb_array_length(coalesce(attributes->'standards', '[]'::jsonb)) > 0)::int AS standard_count
      FROM materials WHERE upload_id = ${currentUpload} GROUP BY class_name ORDER BY count DESC LIMIT 15`),
    sql.query(`SELECT coalesce(nullif(plant, ''), 'UNSPECIFIED') AS label, count(*)::int AS count,
      count(*) FILTER (WHERE status_active)::int AS active, count(*) FILTER (WHERE NOT status_active)::int AS inactive,
      coalesce(avg((${readinessExpression})) FILTER (WHERE status_active), 0)::double precision AS readiness
      FROM materials WHERE upload_id = ${currentUpload} GROUP BY plant ORDER BY count DESC LIMIT 20`),
    sql.query(`SELECT coalesce(nullif(material_type, ''), 'UNSPECIFIED') AS label, count(*)::int AS count FROM materials WHERE upload_id = ${currentUpload} GROUP BY material_type ORDER BY count DESC LIMIT 10`),
    sql.query(`SELECT
      count(*) FILTER (WHERE nullif(long_description, '') IS NOT NULL)::int AS description,
      count(*) FILTER (WHERE nullif(attributes->>'itemType', '') IS NOT NULL)::int AS item_type,
      count(*) FILTER (WHERE nullif(attributes->>'subtype', '') IS NOT NULL)::int AS subtype,
      count(*) FILTER (WHERE nullif(attributes->>'sizeMm', '') IS NOT NULL)::int AS size,
      count(*) FILTER (WHERE nullif(attributes->>'pressureClass', '') IS NOT NULL OR nullif(attributes->>'pressureBar', '') IS NOT NULL)::int AS pressure,
      count(*) FILTER (WHERE nullif(attributes->>'connection', '') IS NOT NULL)::int AS connection,
      count(*) FILTER (WHERE jsonb_array_length(coalesce(attributes->'materials', '[]'::jsonb)) > 0)::int AS materials,
      count(*) FILTER (WHERE jsonb_array_length(coalesce(attributes->'standards', '[]'::jsonb)) > 0)::int AS standards,
      count(*) FILTER (WHERE nullif(attributes->>'faceToFaceMm', '') IS NOT NULL)::int AS face_to_face,
      count(*) FILTER (WHERE nullif(attributes->>'actuation', '') IS NOT NULL)::int AS actuation
      FROM materials WHERE upload_id = ${currentUpload} AND status_active`),
    sql.query(`WITH readiness AS (SELECT (${readinessExpression}) AS score FROM materials WHERE upload_id = ${currentUpload} AND status_active) SELECT CASE WHEN score >= 70 THEN 'Strong' WHEN score >= 40 THEN 'Partial' ELSE 'Sparse' END AS label, count(*)::int AS count FROM readiness GROUP BY 1 ORDER BY min(score) DESC`),
    sql.query(`WITH duplicate_groups AS (SELECT lower(trim(long_description)) AS description, count(*)::int AS rows FROM materials WHERE upload_id = ${currentUpload} AND status_active AND length(trim(long_description)) >= 10 GROUP BY 1 HAVING count(*) > 1) SELECT count(*)::int AS groups, coalesce(sum(rows - 1), 0)::int AS duplicate_rows FROM duplicate_groups`),
    sql.query(`SELECT CASE WHEN length(long_description) < 40 THEN 'Under 40 chars' WHEN length(long_description) < 100 THEN '40-99 chars' WHEN length(long_description) < 200 THEN '100-199 chars' ELSE '200+ chars' END AS label, count(*)::int AS count FROM materials WHERE upload_id = ${currentUpload} AND status_active GROUP BY 1 ORDER BY min(length(long_description))`),
    sql.query(`SELECT right(raw_data->>'Created Date', 4) AS label, count(*)::int AS count FROM materials WHERE upload_id = ${currentUpload} AND raw_data->>'Created Date' ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$' GROUP BY 1 ORDER BY label`),
    sql.query(`WITH gaps AS (SELECT concat_ws(', ',
      CASE WHEN nullif(attributes->>'sizeMm', '') IS NULL THEN 'Size' END,
      CASE WHEN nullif(attributes->>'pressureClass', '') IS NULL AND nullif(attributes->>'pressureBar', '') IS NULL THEN 'Pressure' END,
      CASE WHEN nullif(attributes->>'connection', '') IS NULL THEN 'Connection' END,
      CASE WHEN jsonb_array_length(coalesce(attributes->'materials', '[]'::jsonb)) = 0 THEN 'Materials' END,
      CASE WHEN jsonb_array_length(coalesce(attributes->'standards', '[]'::jsonb)) = 0 THEN 'Standards' END
    ) AS label FROM materials WHERE upload_id = ${currentUpload} AND status_active) SELECT CASE WHEN label = '' THEN 'No critical gaps' ELSE label END AS label, count(*)::int AS count FROM gaps GROUP BY label ORDER BY count DESC LIMIT 8`),
  ]);
  const source = summaryRows[0] || {};
  const total = Number(source.total || 0);
  const searchable = Number(source.active || 0);
  const unique = Number(source.unique_materials || 0);
  const embedded = Number(source.embedded || 0);
  const numericSap = Number(source.numeric_sap || 0);
  const provisionalSap = Number(source.provisional_sap || 0);
  const missingSap = Number(source.missing_sap || 0);
  const descriptionDuplicates = duplicateRows[0] || {};
  const summary: DashboardSummary = {
    totalRecords: total,
    searchableRecords: searchable,
    excludedRecords: total - searchable,
    searchableRate: percentage(searchable, total),
    uniqueMaterials: unique,
    duplicateRows: total - unique,
    plants: Number(source.plants || 0),
    classes: Number(source.classes || 0),
    embeddedRecords: embedded,
    embeddingCoverage: percentage(embedded, searchable),
    matchReadiness: Math.round(Number(source.readiness || 0) * 10) / 10,
    numericSapRecords: numericSap,
    provisionalSapRecords: provisionalSap,
    missingSapRecords: missingSap,
    otherSapRecords: Math.max(0, total - numericSap - provisionalSap - missingSap),
    genericClassRecords: Number(source.generic_class || 0),
    duplicateDescriptionGroups: Number(descriptionDuplicates.groups || 0),
    duplicateDescriptionRows: Number(descriptionDuplicates.duplicate_rows || 0),
    averageDescriptionLength: Math.round(Number(source.average_description_length || 0)),
    datedRecords: Number(source.dated || 0),
  };
  const qualitySource = qualityRows[0] || {};
  const qualityDefinitions: Array<[string, string, boolean]> = [
    ["description", "Long description", true], ["item_type", "Item type", true], ["subtype", "Subtype", false],
    ["size", "Size / DN", true], ["pressure", "Pressure rating", true], ["connection", "Connection", true],
    ["materials", "Materials of construction", true], ["standards", "Standards / norms", false],
    ["face_to_face", "Face-to-face", false], ["actuation", "Actuation", false],
  ];
  const qualityMetrics: QualityMetric[] = qualityDefinitions.map(([key, label, critical]) => ({ key, label, critical, count: Number(qualitySource[key] || 0), percentage: percentage(Number(qualitySource[key] || 0), searchable) }));
  const classDistribution = distribution(classRows, total);
  const classQuality: ClassQualityItem[] = classRows.map((row) => {
    const active = Number(row.active || 0);
    return { label: String(row.label), count: Number(row.count), active, readiness: Math.round(Number(row.readiness || 0) * 10) / 10, sizeCoverage: percentage(Number(row.size_count || 0), active), pressureCoverage: percentage(Number(row.pressure_count || 0), active), connectionCoverage: percentage(Number(row.connection_count || 0), active), materialCoverage: percentage(Number(row.material_count || 0), active), standardCoverage: percentage(Number(row.standard_count || 0), active) };
  });
  const plantHealth: PlantHealthItem[] = plantRows.map((row) => {
    const count = Number(row.count || 0);
    const active = Number(row.active || 0);
    return { label: String(row.label), count, searchable: active, excluded: Number(row.inactive || 0), searchableRate: percentage(active, count), readiness: Math.round(Number(row.readiness || 0) * 10) / 10 };
  });
  const upload = uploadRows[0] ? {
    fileName: String(uploadRows[0].file_name), sheetName: String(uploadRows[0].sheet_name), rowCount: Number(uploadRows[0].row_count), activeCount: Number(uploadRows[0].active_count), createdAt: new Date(String(uploadRows[0].created_at)).toISOString(),
  } : null;
  const sapMaturityDistribution: DistributionItem[] = [
    { label: "ERP numeric code", count: numericSap, percentage: percentage(numericSap, total) },
    { label: "Provisional NIR", count: provisionalSap, percentage: percentage(provisionalSap, total) },
    { label: "Other format", count: summary.otherSapRecords, percentage: percentage(summary.otherSapRecords, total) },
    { label: "Missing", count: missingSap, percentage: percentage(missingSap, total) },
  ].filter((item) => item.count > 0);
  const missingPatterns: MissingPattern[] = missingRows.map((row) => ({ label: String(row.label), count: Number(row.count || 0), percentage: percentage(Number(row.count || 0), searchable) }));
  return {
    generatedAt: new Date().toISOString(), upload, summary,
    statusDistribution: distribution(statusRows, total),
    classDistribution,
    plantDistribution: distribution(plantRows, total),
    materialTypeDistribution: distribution(materialTypeRows, total),
    qualityMetrics,
    readinessDistribution: distribution(readinessRows, searchable),
    sapMaturityDistribution,
    descriptionLengthDistribution: distribution(descriptionRows, searchable),
    createdYearDistribution: distribution(yearRows, summary.datedRecords),
    classQuality,
    plantHealth,
    missingPatterns,
    insights: buildDashboardInsights(summary, qualityMetrics, classDistribution),
  };
}
