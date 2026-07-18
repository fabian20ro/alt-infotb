import { expect, test } from '@playwright/test';

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

function stopResponse(selected: boolean): Buffer {
	const route = encodePolyline([
		{ lat: 44.42, lng: 26.1 },
		{ lat: 44.43, lng: 26.101 },
		{ lat: 44.44, lng: 26.105 }
	]);
	const arrival = [...varintField(1, 0), ...varintField(2, 300)];
	const vehicle = [
		...varintField(1, 7001),
		...doubleField(2, 44.423),
		...doubleField(3, 26.1003),
		...stringField(4, 'BUS'),
		...varintField(5, 1)
	];
	const line = [
		...stringField(1, 'N111'),
		...varintField(2, 208),
		...stringField(3, 'BUS'),
		...stringField(4, '#006b3c'),
		...stringField(5, 'Valea Oltului'),
		...varintField(8, 0),
		...bytesField(9, arrival),
		...(selected ? stringField(11, route) : []),
		...(selected ? bytesField(12, vehicle) : [])
	];
	return Buffer.from([
		...stringField(1, 'Piata Unirii'),
		...stringField(2, 'Bd. Regina Maria, Bucuresti'),
		...bytesField(10, line)
	]);
}

test.describe('Selected line route map', () => {
	test('tap sends the exact line direction and renders route plus live vehicle', async ({ page }) => {
		const selectedRequests: URL[] = [];
		await page.route('**/lines/stop**', async (route) => {
			const url = new URL(route.request().url());
			const selected = url.searchParams.has('selected_line_id');
			if (selected) selectedRequests.push(url);
			await route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: stopResponse(selected)
			});
		});

		await page.goto('/');
		const line = page.locator('button.arrival-row', { hasText: 'N111' });
		await expect(line).toBeVisible();
		await line.click();

		await expect(line).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('.route-status')).toContainText('N111');
		await expect(page.locator('.selected-route-line')).toBeVisible();
		await expect(page.locator('.vehicle-marker.primary')).toContainText('N111');
		expect(selectedRequests).toHaveLength(1);
		expect(selectedRequests[0].searchParams.get('stop_id')).toBe('3570');
		expect(selectedRequests[0].searchParams.get('selected_line_id')).toBe('208');
		expect(selectedRequests[0].searchParams.get('direction')).toBe('0');
	});

	test('route closes on a second row tap without changing station', async ({ page }) => {
		await page.route('**/lines/stop**', async (route) => {
			const url = new URL(route.request().url());
			await route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: stopResponse(url.searchParams.has('selected_line_id'))
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
