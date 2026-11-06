import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	root: fileURLToPath(new URL('./preview/', import.meta.url)),
	build: { outDir: '../dist-preview', emptyOutDir: true },
	server: { host: '127.0.0.1' }
});
