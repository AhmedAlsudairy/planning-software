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
