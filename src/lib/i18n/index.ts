import { formatTranslation, translations, type TranslationKey } from './translations.js';
import type { Lang } from '$lib/stores/settings.svelte.js';

let currentLang: Lang = 'ro';

export function setLanguage(lang: Lang): void {
	currentLang = lang;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
	const p = params ?? {};
	const value = translations[currentLang][key];

	if (value === undefined) {
		console.warn(`[i18n] Missing translation for "${String(key)}" in lang "${currentLang}"`);
		const fallback = translations.ro[key];
		if (fallback !== undefined) return formatTranslation(fallback, p);
		console.error(
			`[i18n] FATAL: missing translation key "${String(key)}" in both current lang and Romanian fallback. ` +
				`Returning raw key — this indicates a broken or incomplete translation bundle.`
		);
		return String(key);
	}

	const translated = formatTranslation(value, p);
	return translated;
}
