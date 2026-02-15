/**
 * Extract station data from GTFS stops.txt file.
 * Filters to STB stops (numeric IDs), outputs JSON for bundling.
 *
 * Usage: npx tsx scripts/fetch-stations.ts
 * Output: src/lib/stations/stations.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const GTFS_STOPS_PATH = resolve(import.meta.dirname ?? '.', '../data/gtfs/stops.txt');
const OUTPUT_PATH = resolve(import.meta.dirname ?? '.', '../src/lib/stations/stations.json');

interface GtfsStop {
	stop_id: string;
	stop_name: string;
	stop_desc: string;
	stop_lat: string;
	stop_lon: string;
	location_type: string;
}

interface Station {
	id: number;
	name: string;
	description: string;
	lat: number;
	lon: number;
}

function parseCSVLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;

	for (const char of line) {
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			fields.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	fields.push(current);
	return fields;
}

function main() {
	console.log(`Reading GTFS stops from: ${GTFS_STOPS_PATH}`);
	const raw = readFileSync(GTFS_STOPS_PATH, 'utf-8');
	const lines = raw.trim().split('\n');

	const header = parseCSVLine(lines[0]);
	const idxId = header.indexOf('stop_id');
	const idxName = header.indexOf('stop_name');
	const idxDesc = header.indexOf('stop_desc');
	const idxLat = header.indexOf('stop_lat');
	const idxLon = header.indexOf('stop_lon');
	const idxType = header.indexOf('location_type');

	const stations: Station[] = [];
	const seenIds = new Set<number>();

	for (let i = 1; i < lines.length; i++) {
		const fields = parseCSVLine(lines[i]);
		const stopId = fields[idxId];

		// Only include STB stops with numeric IDs (format: 1008-{number})
		const match = stopId.match(/^1008-(\d+)$/);
		if (!match) continue;

		const numericId = parseInt(match[1], 10);
		if (seenIds.has(numericId)) continue;

		const lat = parseFloat(fields[idxLat]);
		const lon = parseFloat(fields[idxLon]);
		if (isNaN(lat) || isNaN(lon)) continue;

		// Filter to Bucharest area (rough bounding box)
		if (lat < 44.3 || lat > 44.6 || lon < 25.9 || lon > 26.3) continue;

		const locationType = fields[idxType];
		// Skip entrances (type 2) and platforms (type 4)
		if (locationType === '2' || locationType === '4') continue;

		seenIds.add(numericId);
		stations.push({
			id: numericId,
			name: fields[idxName],
			description: fields[idxDesc],
			lat,
			lon
		});
	}

	// Sort by ID for consistent output
	stations.sort((a, b) => a.id - b.id);

	console.log(`Extracted ${stations.length} STB stations`);
	console.log(`Bucharest area: lat 44.3-44.6, lon 25.9-26.3`);

	// Verify known stop
	const piataUnirii = stations.find((s) => s.id === 3570);
	if (piataUnirii) {
		console.log(`Verified: stop 3570 = "${piataUnirii.name}" at ${piataUnirii.lat}, ${piataUnirii.lon}`);
	} else {
		console.error('WARNING: stop 3570 (Piata Unirii) not found!');
	}

	writeFileSync(OUTPUT_PATH, JSON.stringify(stations));
	console.log(`Written to: ${OUTPUT_PATH}`);

	// Stats
	const sampleNames = stations.slice(0, 5).map((s) => `  ${s.id}: ${s.name}`);
	console.log(`\nSample stations:\n${sampleNames.join('\n')}`);
}

main();
