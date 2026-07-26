// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {}

	interface ImportMetaEnv {
		/**
		 * Base URL for the STB API.
		 * Must be non-empty, without trailing slash (e.g. "https://info.stb.ro/api/web/v2-6").
		 * Empty string or whitespace falls back to /stb-api in dev and info.stb.ro in prod —
		 * see src/lib/api/constants.ts:_resolveApiBase.
		 */
		readonly VITE_STB_API_BASE?: string;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}
}

export {};
