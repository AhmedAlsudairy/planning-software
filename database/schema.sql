CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS material_uploads (
  id text PRIMARY KEY,
  file_name text NOT NULL,
  sheet_name text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  active_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_import_lock (
  id integer PRIMARY KEY CHECK (id = 1),
  upload_id text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  current_upload_id text REFERENCES material_uploads(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
  search_text text GENERATED ALWAYS AS (lower(class_name || ' ' || short_description || ' ' || long_description)) STORED,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, class_name || ' ' || short_description || ' ' || long_description)) STORED,
  UNIQUE (upload_id, corporate_no, sap_no, plant)
);

CREATE UNIQUE INDEX IF NOT EXISTS materials_upload_identity_idx ON materials(upload_id, corporate_no, sap_no, plant);
CREATE INDEX IF NOT EXISTS materials_search_vector_idx ON materials USING gin(search_vector);
CREATE INDEX IF NOT EXISTS materials_search_trgm_idx ON materials USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS materials_filter_idx ON materials(status_active, class_name);
CREATE INDEX IF NOT EXISTS materials_embedding_idx ON materials USING hnsw(embedding vector_cosine_ops);
