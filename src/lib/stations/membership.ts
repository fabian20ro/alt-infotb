import { normalizeTransportType } from '../api/transport.ts';
import type { Station } from './types.ts';

export interface CatalogLineSelection {
	lineId?: number;
	lineName: string;
	vehicleType: string;
}

/** Known upstream identities are authoritative, including an explicitly absent edge. */
export function stationServesLine(
	station: Station,
	line: CatalogLineSelection,
	authoritativeLineIds: ReadonlySet<number> = new Set()
): boolean {
	if (line.lineId !== undefined && authoritativeLineIds.has(line.lineId)) {
		return station.lineIds?.includes(line.lineId) ?? false;
	}
	const type = normalizeTransportType(line.vehicleType);
	return type !== undefined && (station.lines?.includes(`${type}:${line.lineName.trim()}`) ?? false);
}

/** Geography belongs to source coverage, not an implicit city rectangle. */
export function hasValidStationCoordinates(station: Pick<Station, 'lat' | 'lon'>): boolean {
	return Number.isFinite(station.lat) && Math.abs(station.lat) <= 90 &&
		Number.isFinite(station.lon) && Math.abs(station.lon) <= 180;
}

/** Shared by the application and exhaustive source-to-renderability audits. */
export function validateStations(stations: readonly Station[]): Station[] {
	return stations.filter(hasValidStationCoordinates).sort((a, b) => a.id - b.id);
}
