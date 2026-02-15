export function formatLastUpdate(timestamp: number, lang: 'ro' | 'en'): string {
	if (!timestamp) return '';
	const locale = lang === 'ro' ? 'ro-RO' : 'en-US';
	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(timestamp));
}
