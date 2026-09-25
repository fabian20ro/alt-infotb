# Decoder fixtures

`isovolta-6084.pb` and `bucur-obor-3684.pb` are unmodified protobuf response bodies
captured on 2026-09-25 through the production STB proxy, from
`GET /lines/stop?stop_id=6084` and `GET /lines/stop?stop_id=3684` respectively.
They contain public stop/line/arrival information, no request headers or credentials.

Isovolta provides positive evidence for N109 (ID 199) and 640 (ID 889), absent from
its TPBI 6.39 membership. Bucur Obor records STB's real `CABLE_CAR` value for 66.
Arrival times are historical observations and are not assertions about current service.

Registry and topology decoder tests construct **synthetic** protobuf messages from
the schema embedded in the official STB web client
`https://info.stb.ro/main-es2015.a0ab48d23666b50dae9b.js`, inspected on 2026-09-25.
Those tests validate decoding and defensive checks, not live endpoint completeness.

`chitila-6207.pb` and `unirii-7428.pb` were captured through the shared local proxy
during the complete stop audit. Exact paths, capture times, and SHA-256 checksums
are in `registry-gap-manifest.json`. They preserve observed arrival line identities
907 (429), 909 (476), and 1036 (N700), absent from the contemporaneous 203-line
registry. The registry contained other IDs for names 429 and 476; matching names
alone does not establish identity equivalence and must not rewrite these IDs.
The Chitila response contains both IDs at once for each name: 796/907 for 429 and
798/909 for 476, with directions 0/1 respectively.

`lines.pb`, `lines_199*.pb`, `lines_72.pb`, and `lines_657.pb` are **real** topology
responses collected on 2026-09-25 through the shared local proxy. `manifest.json`
records exact endpoint paths, timestamps and hashes. The exhaustive catalog tests
use these bytes for the registry, trolleybus, and N109 contract, in addition to
the synthetic malformed-input tests in `topology.test.ts`.
