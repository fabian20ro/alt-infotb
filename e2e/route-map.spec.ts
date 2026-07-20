import { expect, test, type Page } from '@playwright/test';

async function mapViewportSignature(page: Page): Promise<string | null> {
	const selectedStationMarker = page.locator('.station-marker-selected');
	await expect(selectedStationMarker).toHaveCount(1);
	return selectedStationMarker.getAttribute('style');
}

function encodeVarint(value: number): number[] {
	const bytes: number[] = [];
	let remaining = value >>> 0;
	do {
		let byte = remaining & 0x7f;
		remaining >>>= 7;
		if (remaining) byte |= 0x80;
		bytes.push(byte);
	} while (remaining);
	return bytes;
}

function tag(field: number, wire: number): number[] {
	return encodeVarint((field << 3) | wire);
}

function varintField(field: number, value: number): number[] {
	return [...tag(field, 0), ...encodeVarint(value)];
}

function bytesField(field: number, bytes: number[]): number[] {
	return [...tag(field, 2), ...encodeVarint(bytes.length), ...bytes];
}

function stringField(field: number, value: string): number[] {
	return bytesField(field, [...new TextEncoder().encode(value)]);
}

function doubleField(field: number, value: number): number[] {
	const buffer = new ArrayBuffer(8);
	new DataView(buffer).setFloat64(0, value, true);
	return [...tag(field, 1), ...new Uint8Array(buffer)];
}

function encodePolyline(points: Array<{ lat: number; lng: number }>): string {
	let previousLat = 0;
	let previousLng = 0;
	let encoded = '';
	const encodeDelta = (delta: number) => {
		let value = delta < 0 ? ~(delta << 1) : delta << 1;
		do {
			let chunk = value & 0x1f;
			value >>>= 5;
			if (value) chunk |= 0x20;
			encoded += String.fromCharCode(chunk + 63);
		} while (value);
	};
	for (const point of points) {
		const lat = Math.round(point.lat * 1e5);
		const lng = Math.round(point.lng * 1e5);
		encodeDelta(lat - previousLat);
		encodeDelta(lng - previousLng);
		previousLat = lat;
		previousLng = lng;
	}
	return encoded;
}

function stopResponse(selectedDirection: 0 | 1 | null, responseDirection = selectedDirection ?? 0): Buffer {
	const forwardPoints = [
		{ lat: 44.42, lng: 26.1 },
		{ lat: 44.43, lng: 26.101 },
		{ lat: 44.44, lng: 26.105 }
	];
	const direction = responseDirection;
	const route = encodePolyline(direction === 0 ? forwardPoints : [...forwardPoints].reverse());
	const arrival = [...varintField(1, 0), ...varintField(2, 300)];
	const vehicle = [
		...varintField(1, direction === 0 ? 7001 : 8001),
		...doubleField(2, direction === 0 ? 44.423 : 44.437),
		...doubleField(3, direction === 0 ? 26.1003 : 26.1038),
		...stringField(4, 'BUS'),
		...varintField(5, 1)
	];
	const line = [
		...stringField(1, 'N111'),
		...varintField(2, 208),
		...stringField(3, 'BUS'),
		...stringField(4, '#006b3c'),
		...stringField(5, direction === 0 ? 'Valea Oltului' : 'Piata Unirii'),
		...varintField(8, direction),
		...bytesField(9, arrival),
		...(selectedDirection !== null ? stringField(11, route) : []),
		...(selectedDirection !== null ? bytesField(12, vehicle) : [])
	];
	return Buffer.from([
		...stringField(1, 'Piata Unirii'),
		...stringField(2, 'Bd. Regina Maria, Bucuresti'),
		...bytesField(10, line)
	]);
}

test.describe('Selected line route map', () => {
	test('tap fetches and renders both directions with distinct vehicles', async ({ page }) => {
		const selectedRequests: URL[] = [];
		await page.route('**/lines/stop**', async (route) => {
			const url = new URL(route.request().url());
			const stopId = url.searchParams.get('stop_id');
			const selectedDirection = url.searchParams.has('selected_line_id')
				? Number(url.searchParams.get('direction')) as 0 | 1
				: null;
			const payloadSelection = selectedDirection === 1 && stopId === '3570'
				? null
				: selectedDirection;
			if (selectedDirection !== null) selectedRequests.push(url);
			await route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: stopResponse(payloadSelection, payloadSelection ?? (stopId === '12283' ? 1 : 0))
			});
		});

		await page.goto('/');
		const line = page.locator('button.arrival-row', { hasText: 'N111' });
		await expect(line).toBeVisible();
		const initialViewport = await mapViewportSignature(page);
		await line.click();

		await expect(line).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('.route-status')).toContainText('N111');
		await expect(page.locator('.selected-route-line')).toBeVisible();
		await expect(page.locator('.opposite-route-line')).toBeVisible();
		await expect(page.locator('.vehicle-marker.primary')).toContainText('N111');
		await expect(page.locator('.vehicle-marker.opposite')).toContainText('N111');
		expect(await mapViewportSignature(page)).toBe(initialViewport);

		await page.getByRole('button', { name: 'Vezi întregul traseu' }).click();
		await page.waitForTimeout(500);
		const overviewViewport = await mapViewportSignature(page);
		expect(overviewViewport).not.toBe(initialViewport);

		await page.getByRole('button', { name: 'Zoom in' }).click();
		await page.waitForTimeout(500);
		const userViewport = await mapViewportSignature(page);
		expect(userViewport).not.toBe(overviewViewport);

		const requestsBeforeRefresh = selectedRequests.length;
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect.poll(() => selectedRequests.length).toBeGreaterThan(requestsBeforeRefresh);
		await page.waitForTimeout(100);
		expect(await mapViewportSignature(page)).toBe(userViewport);

		expect(selectedRequests.every((request) => request.searchParams.get('selected_line_id') === '208')).toBe(true);
		expect(selectedRequests.some((request) =>
			request.searchParams.get('stop_id') === '3570' &&
			request.searchParams.get('direction') === '0'
		)).toBe(true);
		expect(selectedRequests.some((request) =>
			request.searchParams.get('stop_id') === '12283' &&
			request.searchParams.get('direction') === '1'
		)).toBe(true);
	});

	test('route closes on a second row tap without changing station', async ({ page }) => {
		await page.route('**/lines/stop**', async (route) => {
			const url = new URL(route.request().url());
			const stopId = url.searchParams.get('stop_id');
			const selectedDirection = url.searchParams.has('selected_line_id')
				? Number(url.searchParams.get('direction')) as 0 | 1
				: null;
			const payloadSelection = selectedDirection === 1 && stopId === '3570'
				? null
				: selectedDirection;
			await route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: stopResponse(payloadSelection, payloadSelection ?? (stopId === '12283' ? 1 : 0))
			});
		});

		await page.goto('/');
		const line = page.locator('button.arrival-row', { hasText: 'N111' });
		await line.click();
		await expect(page.locator('.route-status')).toBeVisible();
		await line.click();
		await expect(page.locator('.route-status')).not.toBeVisible();
		await expect(page.locator('.selected-route-line')).not.toBeVisible();
	});
});
