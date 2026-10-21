import { deflateSync } from 'node:zlib';

function crc32(buffer: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, bytes: Buffer): Buffer {
	const name = Buffer.from(type);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(bytes.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
	return Buffer.concat([length, name, bytes, crc]);
}

// A synthetic road grid, not geographic evidence or a live-provider canary.
// Generate a valid RGB PNG with no native image library or network dependency.
export function syntheticMapTile(): Buffer {
	const width = 256;
	const rows = Buffer.alloc((width * 3 + 1) * width);
	for (let y = 0; y < width; y++) {
		for (let x = 0; x < width; x++) {
			const road = x % 64 < 8 || y % 64 < 8;
			const offset = y * (width * 3 + 1) + 1 + x * 3;
			rows.set(road ? [230, 224, 201] : [91, 126, 101], offset);
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(width, 4);
	header[8] = 8;
	header[9] = 2;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))
	]);
}
