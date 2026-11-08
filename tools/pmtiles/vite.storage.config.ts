import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
	root:fileURLToPath(new URL('./storage-preview/',import.meta.url)),
	tsconfig:fileURLToPath(new URL('./tsconfig.browser.json',import.meta.url)),
	resolve:{alias:[
		{find:'@noble/hashes/sha2.js',replacement:fileURLToPath(import.meta.resolve('@noble/hashes/sha2.js'))},
		{find:/^maplibre-gl$/,replacement:fileURLToPath(import.meta.resolve('maplibre-gl'))},
		{find:/^maplibre-gl\/(.*)$/,replacement:fileURLToPath(new URL('./node_modules/maplibre-gl/',import.meta.url))+'$1'},
		{find:/^pmtiles$/,replacement:fileURLToPath(import.meta.resolve('pmtiles'))},
		{find:/^@maplibre\/maplibre-gl-style-spec$/,replacement:fileURLToPath(import.meta.resolve('@maplibre/maplibre-gl-style-spec'))}
	]},
	build:{outDir:'../dist-storage',emptyOutDir:true},server:{host:'127.0.0.1'}
});
