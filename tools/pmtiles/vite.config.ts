import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	root: fileURLToPath(new URL('./preview/', import.meta.url)),
	// Shared pure contracts live under src/, whose nearest tsconfig extends generated Svelte files.
	// Force the independent tool config even when the application has never been installed/built.
	tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
	build: { outDir: '../dist-preview', emptyOutDir: true },
	server: { host: '127.0.0.1' }
});
