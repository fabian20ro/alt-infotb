const LOCALE_MAP: Record<'ro' | 'en', string> = { ro: 'ro-RO', en: 'en-US' };

export function formatCatalogDate(timestamp: string, lang: 'ro' | 'en'): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat(LOCALE_MAP[lang], {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'Europe/Bucharest'
	}).format(date);
}
