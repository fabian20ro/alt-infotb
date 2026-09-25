# Versioned catalog sources

`stb-topology.json` is the independently collected STB registry and per-direction topology. It is the regression oracle, not generated from `stations.json`. Each response has its capture timestamp and SHA-256; the collector retains raw response checkpoints outside git. The collection window is an observation interval, not a server-side atomic revision.

`gtfs-fallback.json` is the last independently generated TPBI catalog (feed metadata retained). Compose a **clean GTFS** input with a complete topology snapshot; never feed the previous composed catalog back into the generator.

Runtime data is generated in `src/lib/stations/stations.json`. The browser does not download these source files. Historical fixtures establish decoding/generation behavior for their capture date, not permanent service membership. New network changes require fresh evidence.
