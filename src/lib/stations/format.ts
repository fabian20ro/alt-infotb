export function formatLastUpdate(timestamp: number | undefined | null, lang: 'ro' | 'en'): string {
	if (!timestamp || isNaN(new Date(timestamp).getTime())) return '';
	const locale = lang === 'ro' ? 'ro-RO' : 'en-US';
// ... (rest of the code)
	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(timestamp));
}
