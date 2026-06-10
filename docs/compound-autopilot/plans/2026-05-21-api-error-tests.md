# Plan: Expand ApiError test coverage

## Goal
Add unit tests to `src/lib/api/client.test.ts` specifically covering more error status code ranges (400 and 500) for `ApiError`.

## Context
Currently, we have coverage for 401, 403, and 412 errors. Adding 400 (Bad Request) and 500 (Internal Server Error) ensures our error handling logic remains robust as more status codes are added to the client-side hints.

## Tasks
10|    - [x] **Task 1: Update `src/lib/api/client.test.ts`**
11|        - Add a test case for HTTP 400 response, verifying the generic error message is handled correctly.
12|        - Add a test case for HTTP 500 response, verifying it also uses the standard error format.
13|    - [x] **Task 2: Verification**
14|        - Run `npm test -- src/lib/api/client.test.ts` and ensure all tests (existing + new) pass.

## Definition of Done
- `src/lib/api/client.test.ts` contains two new test cases for HTTP 4/5 error ranges.
- `npm test` passes in the worktree.
