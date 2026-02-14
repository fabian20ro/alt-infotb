# Iteration Log

> Append-only journal of AI agent work sessions on this project.
> **Add an entry at the end of every iteration.**
> When patterns emerge (same issue 2+ times), promote to `LESSONS_LEARNED.md`.

## Format

Each entry should follow this structure:

---

### [YYYY-MM-DD] Brief Description of Work Done

**Context:** What was the goal / what triggered this work
**What happened:** Key actions taken, decisions made
**Outcome:** Result — success, partial, or failure
**Insight:** (optional) What would you tell the next agent about this?
**Promoted to Lessons Learned:** Yes/No

---

### [2026-02-14] Switch to real STB API with protobuf decoding

**Context:** The app was using speculative multi-API fallback code (mo-bi.ro, info.stbsa.ro) without a confirmed working endpoint. User discovered the real endpoint at `info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570` and shared the raw protobuf response.
**What happened:** Wrote a minimal protobuf wire-format reader (`proto.ts`, ~100 lines). Rewrote `arrivals.ts` to decode the binary response. Removed all the old multi-API fallback code. Updated constants with stop_id=3570 and the correct API headers. Updated types to match the real response structure (lineName, lineId, vehicleType, color, direction, arrivingTimes).
**Outcome:** Success — type-check passes, build succeeds. Arrival time field mapping (fields 6, 7, 8) is educated guessing from hex dump analysis and needs real-world validation.
**Insight:** The STB API ignores the `Accept: application/json` header and always returns protobuf. Don't waste time trying to get JSON out of it. The hex dump from `hexdump -C` is invaluable for reverse-engineering the protobuf schema.
**Promoted to Lessons Learned:** Yes

---

### [2026-02-14] Add tests, documentation, AGENTS.md, and CI improvements

**Context:** Project had no tests, no docs folder, no AGENTS.md, and the CI workflow only ran `build` without checks.
**What happened:** Installed vitest. Wrote 29 tests across 4 files covering protobuf decoding, HTTP client, arrival parsing, and format helpers. Hit a gotcha where `DOMException.name` is read-only (can't use `Object.assign`). Created `docs/` with architecture.md, codemap.md, and api.md. Created AGENTS.md with tech stack, required experience, UX guidelines. Updated README with build badge and live app link. Updated CI to run type-check and tests on PRs.
**Outcome:** Success — 29 tests pass, 0 type errors, build succeeds.
**Insight:** The `DOMException` constructor accepts the name as the second argument: `new DOMException('msg', 'AbortError')`. This is the correct way to create named DOMExceptions in tests.
**Promoted to Lessons Learned:** Yes

---

### [2026-02-14] Add lessons learned memory system

**Context:** Need a persistent learning system so AI agents accumulate wisdom across sessions.
**What happened:** Created `LESSONS_LEARNED.md` with categorized insights from previous iterations. Created `ITERATION_LOG.md` with session journal entries. Updated `AGENTS.md` with a "Memory & Continuous Learning" section describing the required workflow.
**Outcome:** Success — both files created, AGENTS.md updated, all seeded with initial entries from the project's history.
**Insight:** Seeding the files with real entries from past work is more useful than leaving them empty. Future agents immediately see the format and depth expected.
**Promoted to Lessons Learned:** No (meta-process, not project-specific)

---

<!-- New entries go above this line, most recent first -->
