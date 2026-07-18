export function formatLastUpdate(timestamp: number | undefined | null, lang: 'ro' | 'en'): string {
	if (timestamp === undefined || timestamp === null || isNaN(new Date(timestamp).getTime())) return '';
	const now = Date.now();
	const diffSeconds = (now - timestamp) / 1000;

	// "Just now" for very recent timestamps (< 60s, non-negative)
	if (diffSeconds < 60 && diffSeconds >= 0) {
		return lang === 'ro' ? 'Acum' : 'Just now';
	}

	const locale = lang === 'ro' ? 'ro-RO' : 'en-US';

	// Relative time for timestamps between 1 min and ~7 days ago
	if (diffSeconds >= 60 && diffSeconds < 7 * 24 * 3600) {
		const abs = Math.abs(diffSeconds);

		if (abs < 60 * 60) {
			const mins = Math.round(abs / 60);
			const minuteWord = mins === 1 && lang !== 'ro' ? 'minute' : 'minutes';
			return lang === 'ro' ? `${mins} min` : `${mins} ${minuteWord} ago`;
		} else if (abs < 24 * 3600) {
			const hours = Math.floor(abs / 3600);
			const hourWord = hours === 1 && lang !== 'ro' ? 'hour' : 'hours';
			return lang === 'ro' ? `${hours} h` : `${hours} ${hourWord} ago`;
		} else {
			const days = Math.floor(abs / 86400);
			return lang === 'ro' ? `${days} z` : `${days} days ago`;
		}
	}

	// Future timestamps (clock skew) → full date format
	// Empty for very near-future (< 1 min ahead), otherwise full date
	if (diffSeconds < 0 && diffSeconds > -60) return '';
	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(timestamp));
}
