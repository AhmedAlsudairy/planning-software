<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project workflow

- Run `npm run verify` before committing; it executes lint, typecheck, Vitest, and the production build.
- Material imports are atomically promoted in Neon and concurrent imports are rejected with a database lock.
- `/dashboard` and `GET /api/dashboard` analyze only the current promoted upload.
- Dashboard readiness is a completeness indicator, not a calibrated match probability.
- Keep `DATABASE_URL` and `GEMINI_API_KEY` in ignored environment files; never commit ERP spreadsheets or credentials.
- Import accepts either the iDXP or the SAP plant export layout; headers resolve to logical fields in `src/lib/spreadsheet.ts`, so a new export format is a dictionary entry there.
- `src/lib/vocabulary.ts` owns every controlled term list (SAP abbreviations, item-type families, materials, connections). Add terms there, not inline.
- An export may carry a constant class column, so search families are derived from the description - never filter candidates by class name alone.
- `npm run eval-search` measures retrieval recall against the promoted upload; run it after changing parsing, retrieval or ranking. It is not part of `npm run verify`.
- `docs/ux-guidelines.md` holds the result-list rules (one row per material, blocked stock visible but last, never an empty result set).
