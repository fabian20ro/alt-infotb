import { translations, type TranslationKey } from './translations.js';
import type { Lang } from '$lib/stores/settings.svelte.js';

let currentLang: Lang = 'ro';

export function setLanguage(lang: Lang): void {
	currentLang = lang;
}

export function t(key: TranslationKey): string {
	return translations[currentLang][key] ?? translations.ro[key] ?? key;
}
