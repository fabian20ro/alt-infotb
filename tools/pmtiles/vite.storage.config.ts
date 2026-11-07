import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	root: fileURLToPath(new URL('./storage-preview/', import.meta.url)),
	tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
	resolve: { alias: {
		'@noble/hashes/sha2.js': fileURLToPath(import.meta.resolve('@noble/hashes/sha2.js'))
	} },
	build: { outDir: '../dist-storage', emptyOutDir: true },
	server: { host: '127.0.0.1' }
});
