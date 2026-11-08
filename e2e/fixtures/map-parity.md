# Renderer parity fixtures

`MapParity.svelte` mounts the real `MapView` with an explicitly injected renderer
factory. The application does not expose this fixture or a renderer query flag.
Both engines receive the same scene and controller commands.

`line66-scene.json` is a static projection of the existing public protobuf captures
in `src/lib/map/fixtures`: 122 forward points and 159 return points, line ID72.
The browser parity suite decodes those original bytes with `decodeStopResponse`
and compares both paths to this projection. The isolated offline preview can
bundle the geometry without importing the live arrival/network module.

The original captures have no vehicles. The parity fixture adds two explicitly
synthetic vehicle positions along their respective paths; this is rendering
coverage, not evidence of current vehicle locations. N109 membership and the
three Isovolta markers come directly from the bundled catalog, not proximity.
