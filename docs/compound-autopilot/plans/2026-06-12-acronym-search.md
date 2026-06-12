# Plan: Acronym handling in search

## Goal
Improve the `normalize` function to handle acronyms like "C.F.R." correctly (converting them to "cfr") without breaking the normalization of names with punctuation (e.g., "Station.Name" -> "station name").

## Context
Currently, `normalize` replaces all non-alphanumeric characters with spaces, converting "C.F.R." to "c f r". This makes it difficult to match search queries like "cfr" against the normalized station name.

## Tasks
- [ ] **Task 1: Refine `normalize` logic**
    - Implement a way to distinguish between punctuation used in acronyms and punctuation used as delimiters.
    - (Potential approach: identify sequences of letters separated by dots and remove the dots).
- [ ] **Task 2: Verification**
    - Add tests for "C.F.R." and other acronyms.
    - Add tests for "Station.Name" and "Station-Name" to ensure they still become "station name".
    - Verify `searchStations` with both forms.

## Definition of Done
- `normalize('C.F.R. Progresul')` returns `cfr progresul`.
- `normalize('Station.Name')` returns `station name`.
- `searchStations('cfr', [{id: 1, name: 'C.F.R. Progresul', ...}])` returns the station.
- No regressions in existing tests.
