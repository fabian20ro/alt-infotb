const STORAGE_KEY = 'alt-stb-settings';

export type Theme = 'light' | 'dark';
export type Lang = 'ro' | 'en';

interface Settings {
	theme: Theme;
	lang: Lang;
}

const DEFAULTS: Settings = { theme: 'dark', lang: 'ro' };

function isValidTheme(v: unknown): v is Theme {
	return typeof v === 'string' && (v === 'light' || v === 'dark');
}

function isValidLang(v: unknown): v is Lang {
	return typeof v === 'string' && (v === 'ro' || v === 'en');
}

function loadSettings(): Settings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		const parsed: Partial<Settings> = JSON.parse(raw);
		if (!isValidTheme(parsed.theme) || !isValidLang(parsed.lang)) {
			return { ...DEFAULTS };
		}
		return { ...DEFAULTS, theme: parsed.theme!, lang: parsed.lang! };
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
			t === 'dark' ? '#1a1a2e' : '#f5f5f7'
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

let _store: ReturnType<typeof createSettingsStore> | null = null;

function ensureStore(): void {
	if (!_store) _store = createSettingsStore();
}

export function getSettings(): { theme: Theme; lang: Lang } {
	ensureStore();
	return { theme: _store!.theme, lang: _store!.lang };
}

export function reset() {
	ensureStore();
	_store!.setTheme(DEFAULTS.theme);
	_store!.setLang(DEFAULTS.lang);
}
