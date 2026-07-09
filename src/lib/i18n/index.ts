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
	}

	return value ?? translations.ro[key] ?? key;
}
