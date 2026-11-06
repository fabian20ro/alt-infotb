# Renderer parity evidence

Unmodified public STB protobuf responses for line 66 / ID 72, captured through the
existing proxy. `manifest.json` records request paths, source stop/direction, size,
SHA256 and capture time. No headers or credentials are stored. Arrival times and
vehicle absence are historical evidence, not current-service assertions.

Both routes were replayed on the physical Pixel 6a against the integration build.
These fixtures complement the renderer-independent camera scenarios and existing
browser tests. They are test inputs only; the application never imports them.
