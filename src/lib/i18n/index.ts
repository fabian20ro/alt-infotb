import { translations, type TranslationKey } from './translations.js';
import type { Lang } from '$lib/stores/settings.svelte.js';

let currentLang: Lang = 'ro';

export function setLanguage(lang: Lang): void {
	currentLang = lang;
}

export function t(key: TranslationKey): string {
	const value = translations[currentLang][key];

	if (value === undefined) {
		console.warn(`[i18n] Missing translation for "${String(key)}" in lang "${currentLang}"`);
		const fallback = translations.ro[key];
		if (fallback !== undefined) return fallback;
		console.error(
			`[i18n] FATAL: missing translation key "${String(key)}" in both current lang and Romanian fallback. ` +
				`Returning raw key — this indicates a broken or incomplete translation bundle.`
		);
		return String(key);
	}

	return value;
}
