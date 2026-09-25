# Station membership audit

Status: **inconclusive**. Inventory: catalog-and-topology.
Observation interval: 2026-09-24T23:53:34.816Z – 2026-09-25T00:16:21.545Z.

API stops: 3980 known; 3980 requested; 3936 verified; 44 unverified.
Catalog markers: 3911; 3867 verified; 44 unverified.

“Verified” means a named response with known transport types and positive line evidence; it does not prove the absence of any other line.
Inventory covers known catalog/platform IDs and supplied topology IDs. Stops absent from every source remain undiscoverable.
An absent arrival never removes a station or membership. JSON includes exact observations and response hashes.

## Discrepancies

| Issue | API stop | Marker | Station | Line ID | Line | Raw type | Direction | Comparison |
|---|---|---|---|---|---|---|---|---|
| missing-membership | 3690 | 3690 | Mecet | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3693 | 3693 | Mecet | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3694 | 3694 | Calea Mosilor | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3695 | 3695 | Traian | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3705 | 3705 | Bd. Pierre de Coubertin | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3709 | 3709 | Scoala Iancului | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3710 | 3710 | Agricultorilor | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3711 | 3711 | Soseaua Mihai Bravu | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3712 | 3712 | Lt. Victor Manu | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3713 | 3713 | Aura Buzescu | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3728 | 3728 | Soseaua Mihai Bravu | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3764 | 3764 | Teatrul National | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3767 | 3767 | Arena Nationala | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3768 | 3768 | Arena Nationala | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3771 | 3771 | Dumitru Marinescu | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3827 | 3827 | Armeneasca | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3838 | 3838 | Scoala Iancului | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3839 | 3839 | Agricultorilor | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3840 | 3840 | Lt. Victor Manu | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3841 | 3841 | Aura Buzescu | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3842 | 3842 | Bd. Pierre de Coubertin | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3866 | 3866 | Armeneasca | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 3896 | 3896 | Piata Rosetti | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3899 | 3899 | Calea Mosilor | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 3902 | 3902 | Traian | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 6207 | 6207 | Pasaj Cfr Chitila | 907 | 429 | BUS | 1 | canonical-key |
| missing-membership | 6207 | 6207 | Pasaj Cfr Chitila | 909 | 476 | BUS | 1 | canonical-key |
| missing-membership | 6886 | 6886 | Piata Unirii 2 | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 7256 | 7256 | Universitate | 1036 | N700 | BUS | 1 | canonical-key |
| missing-membership | 7428 | 7428 | Piata Unirii 1 | 1036 | N700 | BUS | 0 | canonical-key |
| missing-membership | 7514 | 7514 | Piata Unirii 5 | 1036 | N700 | BUS | 1 | canonical-key |

## Unverified markers


## Issues

- empty /lines/stop?stop_id=3101: Empty HTTP 200 response
- empty /lines/stop?stop_id=3332: Empty HTTP 200 response
- empty /lines/stop?stop_id=3443: Empty HTTP 200 response
- empty /lines/stop?stop_id=3509: Empty HTTP 200 response
- empty /lines/stop?stop_id=3511: Empty HTTP 200 response
- unregistered-line /lines/stop?stop_id=3690: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3693: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3694: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3695: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3705: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3709: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3710: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3711: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3712: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3713: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3728: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3764: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3767: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3768: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3771: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3827: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3838: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3839: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3840: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3841: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3842: Observed line 1036 (N700, BUS) is absent from the topology registry
- empty /lines/stop?stop_id=3855: Empty HTTP 200 response
- unregistered-line /lines/stop?stop_id=3866: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3896: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3899: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=3902: Observed line 1036 (N700, BUS) is absent from the topology registry
- empty /lines/stop?stop_id=6014: Empty HTTP 200 response
- unregistered-line /lines/stop?stop_id=6207: Observed line 907 (429, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=6207: Observed line 909 (476, BUS) is absent from the topology registry
- empty /lines/stop?stop_id=6258: Empty HTTP 200 response
- empty /lines/stop?stop_id=6650: Empty HTTP 200 response
- unregistered-line /lines/stop?stop_id=6886: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=7256: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=7428: Observed line 1036 (N700, BUS) is absent from the topology registry
- unregistered-line /lines/stop?stop_id=7514: Observed line 1036 (N700, BUS) is absent from the topology registry
- empty /lines/stop?stop_id=12446: Empty HTTP 200 response
- empty /lines/stop?stop_id=12496: Empty HTTP 200 response
- empty /lines/stop?stop_id=12584: Empty HTTP 200 response
- empty /lines/stop?stop_id=12604: Empty HTTP 200 response
- empty /lines/stop?stop_id=15101: Empty HTTP 200 response
