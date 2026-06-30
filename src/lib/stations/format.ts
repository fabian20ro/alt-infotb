export function formatLastUpdate(timestamp: number | undefined | null, lang: 'ro' | 'en'): string {
	if (timestamp === undefined || timestamp === null || isNaN(new Date(timestamp).getTime())) return '';
	const now = Date.now();
	const diffSeconds = (now - timestamp) / 1000;
	if (diffSeconds < 60 && diffSeconds >= 0) {
		return lang === 'ro' ? 'Acum' : 'Just now';
	}
	const locale = lang === 'ro' ? 'ro-RO' : 'en-US';
	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(timestamp));
}
