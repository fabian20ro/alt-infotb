# Lessons Learned

> This file is maintained by AI agents working on this project.
> It captures validated, reusable insights discovered during development.
> **Read this file at the start of every task. Update it at the end of every iteration.**

## How to Use This File

### Reading (Start of Every Task)
Before starting any work, read this file to avoid repeating known mistakes
and to leverage proven approaches.

### Writing (End of Every Iteration)
After completing a task or iteration, evaluate whether any new insight was
gained that would be valuable for future sessions. If yes, add it to the
appropriate category below.

### Promotion from Iteration Log
Patterns that appear 2+ times in `ITERATION_LOG.md` should be promoted
here as a validated lesson.

### Pruning
If a lesson becomes obsolete (e.g., a dependency was removed, an API changed),
move it to the Archive section at the bottom with a date and reason.

---

## Architecture & Design Decisions

**[2026-02-14]** STB API returns protobuf, not JSON — The `info.stb.ro` API endpoint returns Protocol Buffers binary despite sending an `Accept: application/json` header. A custom ~100-line decoder (`proto.ts`) handles this. No protobuf library is needed since the schema is small and stable.

**[2026-02-14]** No backend required — All API calls go directly from the browser to `info.stb.ro`. This means zero hosting cost but depends on CORS being allowed. If CORS is ever blocked, a proxy will be needed.

## Code Patterns & Pitfalls

**[2026-02-14]** DOMException.name is read-only — When mocking `AbortError` in tests, use the constructor `new DOMException('message', 'AbortError')` instead of `Object.assign(new DOMException(...), { name: 'AbortError' })`. The `name` property on `DOMException` is a getter and cannot be overwritten.

**[2026-02-14]** TRAM_LINES is a Set, not an array — `constants.ts` defines `TRAM_LINES` as `new Set(...)` for O(1) lookup in the protobuf decoder. Use `LINE_ORDER` (array) when you need ordered iteration for display.

## Testing & Quality

**[2026-02-14]** Protobuf tests need encoding helpers — Tests for the protobuf decoder require building valid binary messages. Use `encodeVarint`, `encodeStringField`, `encodeVarintField`, and `encodeMessageField` helpers (defined in `proto.test.ts`) to construct test fixtures.

## Performance & Infrastructure

**[2026-02-14]** CI runs type-check, tests, then build — The GitHub Actions workflow (`deploy.yml`) runs `npm run check`, `npm test`, and `npm run build` in sequence. It also runs on PRs (not just main branch pushes), with deploy only on main/master.

## Dependencies & External Services

**[2026-02-14]** STB API endpoint is `info.stb.ro`, not `info.stbsa.ro` — The older `info.stbsa.ro` domain was used by previous versions of the API. The current v2-6 endpoint is at `info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570`.

**[2026-02-14]** package-lock.json is gitignored — The project's `.gitignore` excludes `package-lock.json`. Don't try to `git add` it.

## Process & Workflow

**[2026-02-14]** Arrival time field mapping is tentative — Protobuf fields 6, 7, 8 in the line sub-message are assumed to be arrival times in seconds. This was determined by hex dump inspection, not official documentation. If times look wrong in production, these field numbers may need adjustment.

---

## Archive

<!-- Lessons that are no longer applicable. Keep for historical context. -->
<!-- Format: **[YYYY-MM-DD] Archived [YYYY-MM-DD]** Title — Reason for archival -->
