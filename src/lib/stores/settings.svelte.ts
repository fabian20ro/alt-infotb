const STORAGE_KEY = 'better-stb-settings';

export type Theme = 'light' | 'dark';
export type Lang = 'ro' | 'en';

interface Settings {
	theme: Theme;
	lang: Lang;
}

const DEFAULTS: Settings = { theme: 'dark', lang: 'ro' };

function loadSettings(): Settings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		return { ...DEFAULTS, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULTS };
	}
}

function persistSettings(settings: Settings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Silently fail
	}
}

export function createSettingsStore() {
	const initial = loadSettings();
	let theme = $state<Theme>(initial.theme);
	let lang = $state<Lang>(initial.lang);

	function applyTheme(t: Theme) {
		document.documentElement.setAttribute('data-theme', t);
		document.querySelector('meta[name="theme-color"]')?.setAttribute(
			'content',
			t === 'dark' ? '#1a1a2e' : '#ffffff'
		);
	}

	function setTheme(t: Theme) {
		theme = t;
		applyTheme(t);
		persistSettings({ theme, lang });
	}

	function setLang(l: Lang) {
		lang = l;
		document.documentElement.lang = l;
		persistSettings({ theme, lang });
	}

	// Apply on creation
	if (typeof document !== 'undefined') {
		applyTheme(initial.theme);
		document.documentElement.lang = initial.lang;
	}

	return {
		get theme() { return theme; },
		get lang() { return lang; },
		setTheme,
		setLang
	};
}
