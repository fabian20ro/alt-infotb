/** Canonical types shared by API boundaries and the generated station catalog. */
export type CanonicalTransportType = 'BUS' | 'TRAM' | 'TROLLEYBUS' | 'SUBWAY';

/** Keep unknown values visible to callers instead of silently classifying them as buses. */
export function normalizeTransportType(raw: string): CanonicalTransportType | undefined {
	switch (raw.trim().toUpperCase()) {
		case 'BUS': return 'BUS';
		case 'TRAM': return 'TRAM';
		case 'CABLE_CAR':
		case 'TROLLEYBUS': return 'TROLLEYBUS';
		case 'SUBWAY': return 'SUBWAY';
		default: return undefined;
	}
}
