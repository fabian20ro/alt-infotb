/** Calendar day of service, with the 04:00 Europe/Bucharest boundary (including DST). */
const formatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Bucharest',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	hourCycle: 'h23'
});
export function transitDay(timestamp: number): string {
	const parts = Object.fromEntries(
		formatter.formatToParts(timestamp).map((part) => [part.type, part.value])
	);
	const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
	if (Number(parts.hour) < 4) day.setUTCDate(day.getUTCDate() - 1);
	return day.toISOString().slice(0, 10);
}
