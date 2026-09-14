# Material Match AI

Engineering-aware SAP material matching built with Next.js, Neon Postgres, and the Gemini API.

## Features

- Imports `.xlsx` and `.csv` material masters up to 50,000 rows
- Replaces the current searchable dataset atomically after a complete successful import
- Maps the Jindal/iDXP columns used by the supplied 20,000-row workbook and preserves extra columns in `raw_data`
- Excludes deleted and deletion-staged records by default
- Extracts item class, subtype, DN/size, pressure, connection, face-to-face, MOC, standards, and actuation
- Combines deterministic weighted engineering scoring with Gemini semantic embeddings
- Shows exact, compatible, missing, and mismatched attributes
- Exports ranked results to Excel or the browser PDF print flow

## Setup

1. Create a Neon database and copy its connection string.
2. Create a Gemini API key in Google AI Studio.
3. Copy `.env.example` to `.env.local` and set:

```env
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
```

4. Install and run:

```bash
npm install
npm run dev
```

The application creates the required Neon extensions, tables, and indexes on first use. The equivalent SQL is in `database/schema.sql`.

## Upload replacement behavior

Each successful upload becomes the single active dataset:

1. Rows are inserted under a new upload id while the previous dataset stays searchable.
2. The stored row count is verified against the parsed row count; a mismatch rolls the import back.
3. Only then is the new upload promoted and every older row deleted in one transaction.
4. Reused embeddings are carried over for records whose descriptions did not change.
5. Concurrent imports are rejected with HTTP 409 through a database lock, so two uploads can never delete each other's rows.

Recognized core columns update the searchable fields, and any additional spreadsheet columns are retained in `raw_data`.

## Matching pipeline

1. Parse the free-text query with deterministic engineering rules.
2. Use Gemini structured output to fill only explicitly supplied attributes missed by the rules.
3. Filter inactive records and restrict candidates by material class.
4. Retrieve up to 60 candidates using stored engineering attributes plus PostgreSQL full-text and trigram similarity.
5. Shortlist candidates with the same weighted engineering scoring and penalties used for final ranking.
6. Generate and cache 768-dimensional `gemini-embedding-2` vectors for the shortlist only.
7. Rank using 70% parametric and 30% semantic similarity, then penalize conflicting size and connection values.

Gemini failures fall back to deterministic parsing and lexical similarity. Numeric engineering conflicts are never overridden by semantic similarity.

## Scoring behavior

Confidence is deliberately conservative. A candidate that matches every stated attribute scores above 90%, while a candidate of the correct type with the wrong nominal size is penalized to roughly 25% even when its text is semantically similar. Attributes that the record does not state are reported as `missing` rather than treated as matches, and `PN` and ASME `Class` ratings are never reported as equivalent without an approved conversion.

## Verification

```bash
npm run verify
```
