export interface StationRecord {
	id: number;
	name: string;
	description: string;
	lat: number;
	lon: number;
	lines?: string[];
}

export interface LineMembershipFiles {
	routes: string;
	trips: string;
	stopTimes: string;
}

export interface StationCatalog {
	feedVersion: string;
	sourceUpdatedAt: string;
	stations: StationRecord[];
}

const MIN_STATION_COUNT = 2_400;
const BUCHAREST_BOUNDS = {
	minLat: 44.3,
	maxLat: 44.6,
	minLon: 25.9,
	maxLon: 26.3
};

export function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"') {
			if (inQuotes && line[index + 1] === '"') {
				current += '"';
				index += 1;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			fields.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	if (inQuotes) throw new Error('Unterminated quoted CSV field');
	fields.push(current);
	return fields;
}

function requiredColumn(header: string[], name: string): number {
	const index = header.indexOf(name);
	if (index === -1) throw new Error(`Missing required GTFS column: ${name}`);
	return index;
}

function parseStbStopId(rawId: string): number | null {
	const match = rawId.match(/^(?:1008-)?(\d+)$/);
	return match ? Number.parseInt(match[1], 10) : null;
}

// Iterate the large stop_times file without retaining an array of all its lines.
function* csvRows(raw: string): Generator<string[]> {
	let start = 0;
	while (start < raw.length) {
		const newline = raw.indexOf('\n', start);
		const end = newline === -1 ? raw.length : newline;
		const line = raw.slice(start, end).replace(/\r$/, '');
		if (line) yield parseCsvLine(line);
		start = end + 1;
	}
}

/** Exact scheduled stop membership, unioned across trips and both directions. */
export function parseStationLines(
	rawStops: string,
	files: LineMembershipFiles
): Map<number, string[]> {
	const vehicleTypes: Record<string, string> = {
		'0': 'TRAM', '1': 'SUBWAY', '3': 'BUS', '11': 'TROLLEYBUS'
	};
	const routes = csvRows(files.routes);
	const routeHeader = routes.next().value ?? [];
	const routeId = requiredColumn(routeHeader, 'route_id');
	const routeName = requiredColumn(routeHeader, 'route_short_name');
	const routeType = requiredColumn(routeHeader, 'route_type');
	const lineByRoute = new Map<string, string>();
	for (const row of routes) {
		const type = vehicleTypes[row[routeType]];
		const name = row[routeName]?.trim();
		if (type && name) lineByRoute.set(row[routeId], `${type}:${name}`);
	}

	const trips = csvRows(files.trips);
	const tripHeader = trips.next().value ?? [];
	const tripId = requiredColumn(tripHeader, 'trip_id');
	const tripRoute = requiredColumn(tripHeader, 'route_id');
	const lineByTrip = new Map<string, string>();
	for (const row of trips) {
		const line = lineByRoute.get(row[tripRoute]);
		if (line) lineByTrip.set(row[tripId], line);
	}

	const stops = csvRows(rawStops);
	const stopHeader = stops.next().value ?? [];
	const stopId = requiredColumn(stopHeader, 'stop_id');
	const parentId = stopHeader.indexOf('parent_station');
	const stationByStop = new Map<string, number>();
	for (const row of stops) {
		// Metro platforms are not catalog markers: retain their physical parent station.
		const id = parseStbStopId(row[parentId] || row[stopId]);
		if (id !== null) stationByStop.set(row[stopId], id);
	}

	const stopTimes = csvRows(files.stopTimes);
	const timeHeader = stopTimes.next().value ?? [];
	const timeTrip = requiredColumn(timeHeader, 'trip_id');
	const timeStop = requiredColumn(timeHeader, 'stop_id');
	const pickup = timeHeader.indexOf('pickup_type');
	const dropOff = timeHeader.indexOf('drop_off_type');
	const linesByStation = new Map<number, Set<string>>();
	for (const row of stopTimes) {
		if (row[pickup] === '1' && row[dropOff] === '1') continue;
		const line = lineByTrip.get(row[timeTrip]);
		const station = stationByStop.get(row[timeStop]);
		if (!line || station === undefined) continue;
		let lines = linesByStation.get(station);
		if (!lines) linesByStation.set(station, lines = new Set());
		lines.add(line);
	}
	return new Map([...linesByStation].map(([id, lines]) => [id, [...lines].sort()]));
}

export function parseStations(raw: string): StationRecord[] {
	const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
	if (lines.length < 2) throw new Error('GTFS stops.txt is empty');

	const header = parseCsvLine(lines[0]);
	const idIndex = requiredColumn(header, 'stop_id');
	const nameIndex = requiredColumn(header, 'stop_name');
	const descriptionIndex = requiredColumn(header, 'stop_desc');
	const latIndex = requiredColumn(header, 'stop_lat');
	const lonIndex = requiredColumn(header, 'stop_lon');
	const typeIndex = requiredColumn(header, 'location_type');
	const stations: StationRecord[] = [];
	const seenIds = new Set<number>();

	for (const line of lines.slice(1)) {
		const fields = parseCsvLine(line);
		const id = parseStbStopId(fields[idIndex] ?? '');
		if (id === null || seenIds.has(id)) continue;

		const locationType = fields[typeIndex] ?? '';
		if (locationType === '2' || locationType === '4') continue;

		const lat = Number.parseFloat(fields[latIndex] ?? '');
		const lon = Number.parseFloat(fields[lonIndex] ?? '');
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		if (
			lat < BUCHAREST_BOUNDS.minLat || lat > BUCHAREST_BOUNDS.maxLat ||
			lon < BUCHAREST_BOUNDS.minLon || lon > BUCHAREST_BOUNDS.maxLon
		) continue;

		const name = fields[nameIndex] ?? '';
		if (!name) continue;

		seenIds.add(id);
		stations.push({
			id,
			name,
			description: fields[descriptionIndex] ?? '',
			lat,
			lon
		});
	}

	return stations.sort((a, b) => a.id - b.id);
}

export function parseFeedVersion(raw: string): string {
	const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
	if (lines.length < 2) throw new Error('GTFS feed_info.txt is empty');
	const header = parseCsvLine(lines[0]);
	const versionIndex = requiredColumn(header, 'feed_version');
	const version = parseCsvLine(lines[1])[versionIndex]?.trim();
	if (!version) throw new Error('GTFS feed_version is empty');
	return version;
}

export function validateCatalog(catalog: StationCatalog): void {
	if (catalog.stations.length < MIN_STATION_COUNT) {
		throw new Error(`Station catalog is unexpectedly small: ${catalog.stations.length}`);
	}
	if (!catalog.stations.some((station) => station.id === 3570)) {
		throw new Error('Known station 3570 (Piata Unirii) is missing');
	}
	if (new Set(catalog.stations.map((station) => station.id)).size !== catalog.stations.length) {
		throw new Error('Station catalog contains duplicate IDs');
	}
}

export function buildCatalog(
	rawStops: string,
	rawFeedInfo: string,
	sourceUpdatedAt: string,
	lineFiles: LineMembershipFiles
): StationCatalog {
	const parsedDate = new Date(sourceUpdatedAt);
	if (Number.isNaN(parsedDate.getTime())) throw new Error('Invalid source update timestamp');

	const stationLines = parseStationLines(rawStops, lineFiles);
	const catalog: StationCatalog = {
		feedVersion: parseFeedVersion(rawFeedInfo),
		sourceUpdatedAt: parsedDate.toISOString(),
		stations: parseStations(rawStops).map((station) => ({
			...station,
			lines: stationLines.get(station.id) ?? []
		}))
	};
	validateCatalog(catalog);
	return catalog;
}
