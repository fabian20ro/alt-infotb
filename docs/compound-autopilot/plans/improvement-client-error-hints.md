# Plan: Improve Client Error Hints

## Goal
Enhance `apiFetchBinary` to provide more specific error hints for known status codes (specifically HTTP 412) and verify with tests.

## Context
The STB API uses a proxy that retries on 412 errors, but the client's error message could be even more helpful for debugging if it explicitly identifies this scenario.

## Tasks
- [x] **Task 1: Update `src/lib/api/client.ts`**
    - Add HTTP 412 to the hint logic.
    - Expected behavior: `HTTP 412 (Token expired, check proxy retry)`
- [x] **Task 2: Update `src/lib/api/client.test.ts`**
    - Add a test case for HTTP 412 response.
    - Verify the error message contains the new hint.
- [x] **Task 3: Verification**
    - Run `npm test -- src/lib/api/client.test.ts`.

## Definition of Done
- `src/lib/api/client.ts` updated with correct hints.
- `src/lib/api/client.test.ts` passing with new 412 test case.
- No regression in existing 401/403/network error tests.
