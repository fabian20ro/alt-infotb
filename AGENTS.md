# AGENTS.md

> This file provides non-discoverable bootstrap context.
> If the model can find it in the codebase, it does not belong here.
> For corrections and patterns, see LESSONS_LEARNED.md.

## Constraints

- **Svelte 5 runes only** — Use `$state`, `$derived`, `$effect`, `$props()`. Never use legacy `$:` reactive syntax or `export let` for props.
- **Protobuf, not JSON** — The STB API returns binary protobuf. Use the custom decoder in `src/lib/api/proto.ts`. Do not add protobuf libraries.
- **Proxy-mediated API access** — The browser never sends custom headers to the STB API directly. All API calls go through a proxy (Vite plugin in dev, Cloudflare Worker in prod) that injects auth headers.
- **E2E tests: 1 worker only** — Playwright must run with `workers: 1` due to auth token race conditions in the shared dev proxy.
- **Transit day boundary: 4 AM Romanian time** — Station data staleness checks use `Intl.DateTimeFormat` with `timeZone: 'Europe/Bucharest'`, not midnight or fixed 24h windows.

## Learning System

This project uses a persistent learning system. Follow this workflow every session:

1. **Start of task:** Read `LESSONS_LEARNED.md` — it contains validated corrections and patterns
2. **During work:** Note any surprises or non-obvious discoveries
3. **End of iteration:** Append to `ITERATION_LOG.md` with what happened
4. **If insight is reusable and validated:** Also add to `LESSONS_LEARNED.md`
5. **If same issue appears 2+ times in log:** Promote to `LESSONS_LEARNED.md`
6. **If something surprised you:** Flag it to the developer

| File | Purpose | When to Write |
|------|---------|---------------|
| `LESSONS_LEARNED.md` | Curated, validated wisdom and corrections | When insight is reusable |
| `ITERATION_LOG.md` | Raw session journal (append-only, never delete) | Every iteration (always) |

Rules: Never delete from ITERATION_LOG. Obsolete lessons go to the Archive section in LESSONS_LEARNED (not deleted). Date-stamp everything YYYY-MM-DD. When in doubt: log it.

## Sub-Agents

Specialized agents in `.claude/agents/`. Invoke proactively — don't wait to be asked.

| Agent | File | Invoke When |
|-------|------|-------------|
| Architect | `.claude/agents/architect.md` | System design, scalability, refactoring, ADRs |
| Planner | `.claude/agents/planner.md` | Complex multi-step features — plan before coding |
| UX Expert | `.claude/agents/ux-expert.md` | UI components, interaction patterns, accessibility |
| Agent Creator | `.claude/agents/agent-creator.md` | Need a new specialized agent for a recurring task domain |
| Code Simplifier | `.claude/agents/code-simplifier.md` | Refine recently modified code for clarity and consistency |
