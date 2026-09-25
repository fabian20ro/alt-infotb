# Station–line membership audit — 2026-09-25

Checked at 2026-09-24T23:29:01.254Z. Catalog TPBI 6.39, source date 2026-09-09T19:15:24.000Z.

## Scope and interpretation

31 surface stop IDs sampled: 16 selected stop IDs at named hubs and Isovolta, plus the most connected remaining stop in each occupied cell of a 4×4 grid (44.36–44.52 latitude, 25.98–26.22 longitude). This is purposive sampling, not a network-wide or statistically representative audit. Metro was excluded because parent station IDs require platform resolution.

Requests ran sequentially against the app's production proxy, GET https://alt-stb-proxy.fabian20ro.workers.dev/lines/stop?stop_id=ID, with the allowed application Origin https://fabian20ro.github.io. Responses were decoded using the existing custom ProtoReader. All 31 requests returned HTTP 200; 30 returned named stations/line data, while stop 6014 returned no named station or lines and remains unverified. A line present in the API but absent from the catalog is a confirmed discrepancy. A line absent from a live response is **not** proof of discontinued service.

## Results

- 60 unmatched station–line pairs, affecting 23 stop IDs and 39 distinct lines in this sample.
- 25 pairs at 13 stops across 13 trolleybus lines fail solely because the API uses CABLE_CAR and the catalog uses TROLLEYBUS. The decoder and selected-route store preserve the raw API type; stationServesLine compares exact type/name keys. For these selections, cataloged trolleybus stops are treated as background markers.
- After accounting for that alias: 35 missing pairs at 14 stops across 26 lines. Four sampled stops have both problems.
- Of those 26 lines, 23 have no membership anywhere in the bundled catalog: BUS:228, BUS:403, BUS:409, BUS:409B, BUS:411, BUS:412, BUS:413, BUS:416, BUS:417, BUS:447, BUS:447B, BUS:449, BUS:450, BUS:459, BUS:464, BUS:467, BUS:468, BUS:468B, BUS:476, BUS:480, BUS:488, BUS:N700, TRAM:47. The other three (BUS:640, BUS:N109, BUS:N103) exist elsewhere in the catalog but omit observed stops.
- The 100-marker threshold hides background markers, so incorrect or missing membership can make actual route stops disappear. Recognized route stops are not capped by that threshold.

Confirmed trolleybus aliases: 62, 66, 72, 73, 74, 76, 79, 85, 86, 93, 95, 96, 97. Other trolleybus lines were not confirmed by this sample.

## Observed discrepancies

| Stop ID | API station name | Trolleybus alias mismatch (line) | Missing even after type normalization |
| --- | --- | --- | --- |
| 6084 | Isovolta | — | BUS:640, BUS:N109 |
| 6165 | Isovolta | — | BUS:640, BUS:N109 |
| 7267 | Isovolta | — | BUS:640, BUS:N109 |
| 6886 | Piata Unirii 2 | — | BUS:N700 |
| 7514 | Piata Unirii 5 | — | BUS:N700 |
| 3684 | Bucur Obor | 66 | BUS:409, BUS:409B, BUS:411, BUS:412, BUS:413, BUS:417, BUS:467, BUS:468, BUS:468B, BUS:N103 |
| 3940 | Bucur Obor | 66 | — |
| 3734 | Gara de Nord | 79, 86, 93, 97 | — |
| 3783 | Gara de Nord | 79, 86, 93, 97 | — |
| 3860 | Gara de Nord | 62, 85, 93, 96 | — |
| 7774 | M Straulesti | 95 | BUS:476 |
| 3570 | Piata Unirii | — | TRAM:47 |
| 6985 | Piata Presei | 93 | — |
| 6061 | Pod Eroilor | 96 | — |
| 12339 | Piata Presei | — | BUS:403, BUS:447, BUS:447B |
| 7428 | Piata Unirii 1 | 73 | BUS:N700 |
| 3812 | Cremenita (Piata Colentina) | 66 | — |
| 3671 | Pridvorului | 72, 73, 74, 76 | — |
| 3785 | Depoul Alexandria | 96 | BUS:228, BUS:464 |
| 5942 | M Laminorului | 95 | — |
| 12288 | Aeroport Baneasa | — | BUS:403, BUS:447, BUS:447B |
| 6088 | Taberei | — | BUS:480 |
| 6235 | Barbu Vacarescu | — | BUS:416, BUS:449, BUS:450, BUS:459, BUS:488 |

Full sampled IDs: 6084, 6165, 7267, 6886, 7514, 3684, 3940, 3734, 3783, 3860, 6008, 7774, 3570, 3175, 6985, 6014, 6061, 12339, 7428, 3812, 3671, 3785, 7180, 5974, 5942, 5992, 7581, 12288, 6925, 6088, 6235.

Raw decoded snapshot and response buffers retained locally at /tmp/better-stb-membership-audit-20260925/. No application behavior changed during this audit.

## Implications

Fixing only N109 would leave a separate transport-type bug and wider membership omissions. Normalize STB transport identifiers at the API/catalog boundary and validate membership against positive live evidence. Mocked tests must include the API's actual CABLE_CAR value. A recently generated GTFS file and a successful feed-to-catalog comparison do not establish real-world route completeness.
