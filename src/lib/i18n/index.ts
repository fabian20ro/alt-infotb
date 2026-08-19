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

	const PLACEHOLDER_RE = /\{(\\w+)\}/g;
	const placeholderKeys = new Set<string>();
	let m: RegExpExecArray | null;
	PLACEHOLDER_RE.lastIndex = 0;
	while ((m = PLACEHOLDER_RE.exec(value)) !== null) {
		placeholderKeys.add(m[1]);
	}

	if (placeholderKeys.size > 0) {
		const dangling = Object.keys(p).filter((k) => !placeholderKeys.has(k));
		if (dangling.length > 0) {
			console.warn(
				`[i18n] Dangling translation params for key "${String(key)}" in lang "${currentLang}": ` +
					`${JSON.stringify(dangling)}. Template placeholders: ${[...placeholderKeys].join(', ')}.`
			);
		}
	}

	const translated = formatTranslation(value, p);
	return translated;
}
