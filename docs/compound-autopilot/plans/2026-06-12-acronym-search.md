# Plan: Acronym handling in search

## Goal
Improve the `normalize` function to handle acronyms like "C.F.R." correctly (converting them to "cfr") without breaking the normalization of names with punctuation (e.g., "Station.Name" -> "station name").

## Context
Currently, `normalize` replaces all non-alphanumeric characters with spaces, converting "C.F.R." to "c f r". This makes it difficult to match search queries like "cfr" against the normalized station name.

## Tasks
10|	- [x] **Task 1: Refine `normalize` logic**
11|    - Implement a way to distinguish between punctuation used in acronyms and punctuation used as delimiters.
12|    - (Potential approach: identify sequences of letters separated by dots and remove the dots).
13|	- [x] **Task 2: Verification**
14|    - Add tests for "C.F.R." and other acronyms.
15|    - Add tests for "Station.Name" and "Station-Name" to ensure they still become "station name".
16|    - Verify `searchStations` with both forms.

## Definition of Done
- `normalize('C.F.R. Progresul')` returns `cfr progresul`.
- `normalize('Station.Name')` returns `station name`.
- `searchStations('cfr', [{id: 1, name: 'C.F.R. Progresul', ...}])` returns the station.
- No regressions in existing tests.
