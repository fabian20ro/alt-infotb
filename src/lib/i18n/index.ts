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
		throw new Error(
			`[i18n] FATAL: missing translation key "${String(key)}" in both current lang and Romanian fallback. ` +
				`This indicates a broken or incomplete translation bundle — raw keys must not be shipped to users.`
		);
	}

	return value;
}
