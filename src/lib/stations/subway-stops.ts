/**
 * Maps GTFS metro parent station IDs to STB API subway stop IDs.
 *
 * GTFS metro parent station IDs (14xxx, 15xxx, 57xxx, 99xxx) return empty
 * responses from the STB API. The API uses its own internal stop IDs (95xx-97xx)
 * for subway stations. Each physical station has 2+ stops (one per platform/direction).
 * Interchange stations (where lines cross) have 4+ stops.
 *
 * Discovered via scripts/discover-subway-stops.ts on 2026-02-15.
 * M5 (Drumul Taberei) stations have no API data and are excluded.
 */

/** Maps GTFS metro parent station ID → STB API subway stop IDs */
export const SUBWAY_STOP_IDS: Record<number, number[]> = {
	// M1 line stations
	14718: [9629, 9630], // Pantelimon
	14719: [9632, 9633], // Republica
	14717: [9635, 9636], // Costin Georgian
	14716: [9639, 9640], // Titan
	15102: [9645, 9646, 9647, 9864], // Nicolae Grigorescu (M1+M3 interchange)
	14712: [9662, 9663], // Mihai Bravu (M1+M3 shared)
	14697: [9653, 9654, 9656, 9657], // Dristor 1+2 (M1+M3 interchange)
	14713: [9653, 9654, 9656, 9657], // Dristor 1 (same physical station)
	14711: [9666, 9667], // Timpuri Noi (M1+M3 shared)
	15100: [9543, 9544, 9552, 9553], // Piața Unirii (M1+M2+M3 interchange)
	14725: [9596, 9597], // Universitate (M2)
	14724: [9592, 9593], // Piața Romană (M2)
	15099: [9607, 9608, 9609, 9610], // Piața Victoriei (M1+M2 interchange)
	14701: [9704, 9705], // Ștefan cel Mare (M1)
	14700: [9699, 9700], // Obor (M1)
	14699: [9695, 9696], // Piața Iancului (M1)
	14698: [9691, 9692], // Piața Muncii (M1)
	14703: [9751, 9752], // Gara de Nord 1 (M1)
	14704: [9735, 9738, 9756, 9757], // Basarab (M1+M4 interchange)
	14705: [9721, 9729], // Crângași (M1)
	14706: [9707, 9714], // Petrache Poenaru (M1)
	14707: [9673, 9676], // Grozăvești (M1)
	14708: [9578, 9579], // Eroilor (M1+M3 interchange)
	14709: [9539, 9540], // Izvor (M1+M3 shared)

	// M2 line stations (not already covered above)
	14727: [9587, 9588], // Tineretului (M2)
	14728: [9572, 9573], // Eroii Revoluției (M2)
	14729: [9569, 9570], // Constantin Brâncoveanu (M2)
	14730: [9565, 9566], // Piața Sudului (M2)
	14731: [9562, 9563], // Apărătorii Patriei (M2)
	14733: [9556, 9557], // Berceni (M2)
	14732: [9559, 9560], // Dimitrie Leonida (M2)
	14722: [9613, 9614], // Aviatorilor (M2)
	14721: [9616, 9617], // Aurel Vlaicu (M2)
	14720: [9620, 9621], // Pipera (M2)

	// M3 line stations (not already covered above)
	14738: [9584, 9585], // Politehnica (M3)
	14737: [9624, 9625], // Lujerului (M3)
	14736: [9628, 9641], // Gorjului (M3)
	14735: [9652, 9655], // Păcii (M3)
	14734: [9660, 9668], // Preciziei (M3)
	14739: [9674, 9675], // 1 Decembrie 1918 (M3)
	14740: [9681, 9682], // Nicolae Teclu (M3)
	14741: [9685, 9686], // Anghel Saligny (M3)

	// M4 line stations (not already covered above)
	14742: [9753, 9754], // Gara de Nord 2 (M4)
	14744: [9747, 9748], // Grivița (M4)
	14745: [9742, 9743], // 1 Mai (M4)
	14746: [9733, 9734], // Jiului (M4)
	14747: [9727, 9728], // Parc Bazilescu (M4)
	57443: [9722, 9723], // Laminorului (M4)
	57442: [9712, 9713], // Străulești (M4)
};

/** Maps GTFS metro parent station ID → human-readable Romanian name. */
export const STATION_NAMES: Record<number, string> = {
	14718: 'Pantelimon',
	14719: 'Republica',
	14717: 'Costin Georgian',
	14716: 'Titan',
	15102: 'Nicolae Grigorescu',
	14712: 'Mihai Bravu',
	14697: 'Dristor 1+2',
	14713: 'Dristor 1',
	14711: 'Timpuri Noi',
	15100: 'Piața Unirii',
	14725: 'Universitate',
	14724: 'Piața Romană',
	15099: 'Piața Victoriei',
	14701: 'Ștefan cel Mare',
	14700: 'Obor',
	14699: 'Piața Iancului',
	14698: 'Piața Muncii',
	14703: 'Gara de Nord 1',
	14704: 'Basarab',
	14705: 'Crângași',
	14706: 'Petrache Poenaru',
	14707: 'Grozăvești',
	14708: 'Eroilor',
	14709: 'Izvor',
	14727: 'Tineretului',
	14728: 'Eroii Revoluției',
	14729: 'Constantin Brâncoveanu',
	14730: 'Piața Sudului',
	14731: 'Apărătorii Patriei',
	14733: 'Berceni',
	14732: 'Dimitrie Leonida',
	14722: 'Aviatorilor',
	14721: 'Aurel Vlaicu',
	14720: 'Pipera',
	14738: 'Politehnica',
	14737: 'Lujerului',
	14736: 'Gorjului',
	14735: 'Păcii',
	14734: 'Preciziei',
	14739: '1 Decembrie 1918',
	14740: 'Nicolae Teclu',
	14741: 'Anghel Saligny',
	14742: 'Gara de Nord 2',
	14744: 'Grivița',
	14745: '1 Mai',
	14746: 'Jiului',
	14747: 'Parc Bazilescu',
	57443: 'Laminorului',
	57442: 'Străulești',
};

/** Resolve a station ID to its STB API stop IDs. Non-subway stations return [stationId]. */
export function resolveStopIds(stationId: number): number[] {
	if (!Number.isInteger(stationId) || stationId <= 0) {
		return [];
	}

	return SUBWAY_STOP_IDS[stationId] ?? [stationId];
}

/** Resolve a station ID to its human-readable name. Returns null for unknown IDs. */
export function getStationName(stationId: number): string | null {
	if (!Number.isInteger(stationId) || stationId <= 0) {
		return null;
	}

	return STATION_NAMES[stationId] ?? null;
}

// Cross-validation: fail fast if SUBWAY_STOP_IDS and STATION_NAMES drift out of sync.
for (const gtfsIdStr of Object.keys(SUBWAY_STOP_IDS)) {
	const id = Number(gtfsIdStr);
	if (!(id in STATION_NAMES)) {
		throw new Error(
			`[subway-stops] SUBWAY_STOP_IDS key ${gtfsIdStr} is missing a STATION_NAMES entry`,
		);
	}
}
for (const gtfsIdStr of Object.keys(STATION_NAMES)) {
	const id = Number(gtfsIdStr);
	if (!(id in SUBWAY_STOP_IDS)) {
		throw new Error(
			`[subway-stops] STATION_NAMES key ${gtfsIdStr} is missing a SUBWAY_STOP_IDS entry`,
		);
	}
}

// Fail fast on data-entry errors: duplicate stop IDs within a single station break
// the assumption that each API stop ID maps to exactly one platform.
for (const gtfsIdStr of Object.keys(SUBWAY_STOP_IDS)) {
	const id = Number(gtfsIdStr);
	const apiIds = SUBWAY_STOP_IDS[id];
	if (!apiIds || new Set(apiIds).size !== apiIds.length) {
		throw new Error(
			`[subway-stops] station ${gtfsIdStr} has duplicate stop IDs — expected unique values`,
		);
	}
}

/** A single subway station entry grouped by line. */
export interface SubwayStationEntry {
	gtfsId: number;
	name: string;
	stopIds: number[];
}

type LineGroup = Record<string, SubwayStationEntry[]>;

/** Group all subway stations by their metro line (M1–M4). */
const STATION_LINE_MAP: Record<number, string> = {
	// M1
	14718: 'M1', 14719: 'M1', 14717: 'M1', 14716: 'M1',
	15102: 'M1', 14712: 'M1', 14697: 'M1', 14713: 'M1',
	14711: 'M1', 15100: 'M1', 14725: 'M1', 14724: 'M1',
	15099: 'M1', 14701: 'M1', 14700: 'M1', 14699: 'M1',
	14698: 'M1', 14703: 'M1', 14704: 'M1', 14705: 'M1',
	14706: 'M1', 14707: 'M1', 14708: 'M1', 14709: 'M1',

	// M2
	14727: 'M2', 14728: 'M2', 14729: 'M2', 14730: 'M2',
	14731: 'M2', 14733: 'M2', 14732: 'M2', 14722: 'M2',
	14721: 'M2', 14720: 'M2',

	// M3
	14738: 'M3', 14737: 'M3', 14736: 'M3', 14735: 'M3',
	14734: 'M3', 14739: 'M3', 14740: 'M3', 14741: 'M3',

	// M4
	14742: 'M4', 14744: 'M4', 14745: 'M4', 14746: 'M4',
	14747: 'M4', 57443: 'M4', 57442: 'M4',
};

export function getStationsByLine(): LineGroup {
	const grouped: Record<string, SubwayStationEntry[]> = {};
	for (const gtfsIdStr of Object.keys(SUBWAY_STOP_IDS)) {
		const id = Number(gtfsIdStr);
		const line = STATION_LINE_MAP[id];
		if (!line) continue; // station not in any explicit group (e.g. interchange M1+M3 share GTFS ID)

		if (!grouped[line]) grouped[line] = [];
		grouped[line].push({ gtfsId: id, name: STATION_NAMES[id], stopIds: SUBWAY_STOP_IDS[id] });
	}
	return grouped;
}
