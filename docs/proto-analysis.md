# Protobuf Analysis

Analysis dates: 2026-02-15, updated 2026-07-19
Stops tested: surface `3570`, night-bus `6886`, subway `9543`/`9544`

## Discovery: Arrival Times in Field 9 Sub-Messages

The original schema assumed arrival times were in fields 6, 7, 8 as individual varints. This was **wrong**. The actual structure uses **field 9 as a repeated sub-message** containing arrival entries.

### What went wrong

Reading fields 6, 7, 8 produced values like `[120, 0, 1]`:
- Field 6: 120 (first arrival time — redundant copy)
- Field 7: 0 (unknown flag, NOT an arrival time)
- Field 8: 1 (route direction ID, NOT an arrival time)

After sorting: `[0, 1, 120]` — displaying "acum", "1 min", "2 min" instead of the real "2 min", "18 min", "28 min".

### Correct Schema

```protobuf
message StopResponse {
  string name = 1;                    // "Piata Unirii"
  string address = 2;                 // "Bd. Regina Maria, Bucuresti"
  string type = 5;                    // "STATION"
  repeated LineEntry lines = 10;
  int32  unknown_11 = 11;             // always 0
}

message LineEntry {
  string name = 1;                    // "27"
  int32  id = 2;                      // 66
  string vehicle_type = 3;            // "TRAM"
  string color = 4;                   // "#BE1622"
  string direction = 5;               // "Faur"
  int32  first_arrival_seconds = 6;   // seconds (redundant with arrivals[0].seconds)
  int32  unknown_7 = 7;              // always 0
  int32  direction_id = 8;           // 0 or 1; used by the selected-line query
  repeated ArrivalEntry arrivals = 9; // THE REAL ARRIVAL DATA
  string encoded_path = 11;          // selected line only; Google encoded polyline
  repeated Vehicle vehicles = 12;    // selected line only; live positions
  int32  unknown_13 = 13;            // 0 or 1
}

message Vehicle {
  int32 id = 1;
  double latitude = 2;               // protobuf fixed64, little-endian
  double longitude = 3;              // protobuf fixed64, little-endian
  string vehicle_type = 4;           // BUS, TRAM, TROLLEYBUS, SUBWAY, ...
  int32 accessible = 5;              // boolean flag
}

message ArrivalEntry {
  int32  is_scheduled = 1;           // 0 = real-time GPS, 1 = scheduled estimate (hypothesis)
  int32  seconds = 2;                // arrival time in seconds from now
  int32  unknown_3 = 3;             // 0 or 1, sometimes absent
}
```

### Raw Evidence

Line 7 → C.F.R. Progresul:
```
field 6: 120              → redundant (= arrivals[0].seconds)
field 7: 0                → flag
field 8: 1                → flag
field 9[0]: {1:0, 2:120,  3:0}  →  2 min (real-time)
field 9[1]: {1:0, 2:1080, 3:1}  → 18 min (real-time)
field 9[2]: {1:1, 2:1680}       → 28 min (scheduled)
```

Line 32 → Depoul Alexandria:
```
field 6: 240
field 9[0]: {1:0, 2:240, 3:1}  →  4 min
field 9[1]: {1:0, 2:540, 3:1}  →  9 min
field 9[2]: {1:0, 2:840, 3:1}  → 14 min
```

Line 27 → Faur:
```
field 6: 480
field 9[0]: {1:0, 2:480, 3:0}  →  8 min
field 9[1]: {1:0, 2:1560, 3:0} → 26 min
field 9[2]: {1:1, 2:2280}      → 38 min
```

### Hypothesis: `is_scheduled` flag (ArrivalEntry.field 1)

- `0` = Real-time GPS tracking data
- `1` = Estimated from schedule (no GPS signal)

Evidence: the last entry for lines 7 and 27 has `is_scheduled=1` and larger time gaps, consistent with a vehicle not yet tracked by GPS.

## Selected-line route and vehicle payload

The official map expands a line with the same stop endpoint:

```text
/lines/stop?stop_id={sourceStopId}&selected_line_id={lineId}&direction={0|1}
```

The response still contains every arrival row. The selected `LineEntry` additionally contains field 11 (a standard Google encoded polyline ordered from origin to destination) and field 12 (all live vehicles returned for that direction). Field 8 is the exact `direction` query value. Both directions were verified for N101, tram 27, and subway M2; M2 returned shapes but no live vehicles during inspection.
