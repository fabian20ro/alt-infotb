const LOCALE_MAP: Record<'ro' | 'en', string> = { ro: 'ro-RO', en: 'en-US' };

export function formatCatalogDate(timestamp: string, lang: 'ro' | 'en', withTime: boolean = false): string {
	const locale = LOCALE_MAP[lang];
	if (!locale) return '';
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return '';
	const base = new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'Europe/Bucharest'
	}).format(date);
	if (!withTime) return base;
	const time = new Intl.DateTimeFormat(locale, {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/Bucharest',
		hour12: false
	}).format(date);
	return `${base}, ${time}`;
}
