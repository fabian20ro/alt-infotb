export interface StationRecord {
	id: number;
	name: string;
	description: string;
	lat: number;
	lon: number;
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
	sourceUpdatedAt: string
): StationCatalog {
	const parsedDate = new Date(sourceUpdatedAt);
	if (Number.isNaN(parsedDate.getTime())) throw new Error('Invalid source update timestamp');

	const catalog: StationCatalog = {
		feedVersion: parseFeedVersion(rawFeedInfo),
		sourceUpdatedAt: parsedDate.toISOString(),
		stations: parseStations(rawStops)
	};
	validateCatalog(catalog);
	return catalog;
}
