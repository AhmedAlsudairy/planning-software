# Material Match AI

Engineering-aware SAP material matching built with Next.js, Neon Postgres, and the Gemini API.

## Features

- Imports `.xlsx` and `.csv` material masters up to 100,000 rows
- Replaces the current searchable dataset atomically after a complete successful import
- Accepts either export layout - the Jindal/iDXP columns and the SAP plant MM export (`Material Number`, `Material Description`, `Material Text`, ...) - by resolving headers to logical fields, and preserves extra columns in `raw_data`
- Excludes deleted and deletion-staged records by default
- Extracts item class, subtype, DN/size, pressure, connection, face-to-face, MOC, standards, and actuation
- Combines deterministic weighted engineering scoring with Gemini semantic embeddings
- Shows exact, compatible, missing, and mismatched attributes
- Exports ranked results to Excel or the browser PDF print flow
- Provides a dedicated `/dashboard` with total/searchable/excluded counts, status and class distributions, plant and ERP-type analysis, attribute coverage, readiness tiers, embedding coverage, and prioritized quality insights

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

## Analytics dashboard

Open `/dashboard` to analyze the active material master. Dashboard calculations always use the current promoted upload and distinguish all imported rows from records eligible for normal matching. The API representation is available from `GET /api/dashboard`.

The readiness score measures description, item type, subtype, size, pressure, connection, materials, standards, and actuation coverage. It is a data-completeness indicator, not a probability that a material is correct.

Advanced analysis includes SAP-code maturity, exact normalized-description repetition, description-length distribution, creation-year volume, common engineering-gap combinations, class-level attribute coverage, and plant-level eligibility/readiness. Dashboard methodology explains every derived metric and warns when mixed-class statistics should not be interpreted as universal requirements.

## Upload replacement behavior

Each successful upload becomes the single active dataset:

1. Rows are inserted under a new upload id while the previous dataset stays searchable.
2. The stored row count is verified against the parsed row count; a mismatch rolls the import back.
3. Only then is the new upload promoted and every older row deleted in one transaction.
4. Reused embeddings are carried over for records whose descriptions did not change.
5. Concurrent imports are rejected with HTTP 409 through a database lock, so two uploads can never delete each other's rows.

Recognized core columns update the searchable fields, and any additional spreadsheet columns are retained in `raw_data`. Headers are resolved by meaning rather than exact name, so both the iDXP layout and the SAP plant export import without configuration; a file is rejected only when it carries no material code column or no description column, and the error names which. An export whose class column holds a single constant value (the SAP export labels all 12,257 rows `PIPE FITT & NOZZLES`) has its search family derived from the description instead.

## Matching pipeline

1. Parse the free-text query with deterministic engineering rules, expanding the catalog's SAP abbreviations (`FLNG` to `FLANGE`) so either spelling matches.
2. Use Gemini structured output to fill only explicitly supplied attributes missed by the rules.
3. Retrieve candidates through four independent arms that are unioned before scoring: exact code, full-text (OR semantics), trigram word similarity, and stored engineering attributes. One arm finding nothing cannot empty the result set.
4. Collapse each material to a single row carrying every plant that stocks it.
5. Shortlist candidates with the same weighted engineering scoring and penalties used for final ranking.
6. Generate and cache 768-dimensional `gemini-embedding-2` vectors for the shortlist only.
7. Rank using 70% parametric and 30% semantic similarity, then penalize conflicting size, second bore, angle, schedule and connection values, and scale by item-type family agreement.

An item type from a different family is penalized rather than filtered out, so a genuine cross-family match still surfaces below the right family. Gemini failures fall back to deterministic parsing and lexical similarity. Numeric engineering conflicts are never overridden by semantic similarity.

## Retrieval quality

`npm run eval-search` samples materials from the promoted upload, paraphrases each one's own description into a query, and reports recall@1/@5/@10 and MRR. It fails if any sampled query returns no candidates. It needs `DATABASE_URL` and is excluded from `npm run verify`.

See `docs/ux-guidelines.md` for the rules the result list follows.

## Scoring behavior

Confidence is deliberately conservative. A candidate that matches every stated attribute scores above 90%, while a candidate of the correct type with the wrong nominal size is penalized to roughly 25% even when its text is semantically similar. Attributes that the record does not state are reported as `missing` rather than treated as matches, and `PN` and ASME `Class` ratings are never reported as equivalent without an approved conversion.

## Verification

```bash
npm run verify
```
