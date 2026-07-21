export function formatCatalogDate(timestamp: string, lang: 'ro' | 'en'): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat(lang === 'ro' ? 'ro-RO' : 'en-US', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'Europe/Bucharest'
	}).format(date);
}
