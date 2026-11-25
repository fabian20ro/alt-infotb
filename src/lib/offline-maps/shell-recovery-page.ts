/// <reference lib="dom" />
export const shellRecoveryText = {
	ro: {
		title: 'Repararea aplicației offline', repair: 'Repară aplicația offline', open: 'Deschide aplicația',
		intro: 'Repararea modifică doar fișierele aplicației. Pachetul hărții, favoritele și setările nu sunt șterse.',
		working: 'Verificăm și reparăm aplicația…', ready: 'Aplicația este pregătită să pornească offline.',
		failed: 'Repararea nu a fost finalizată. Reîncearcă.',
		errors: { replacement: 'O actualizare a aplicației este în curs. Închide toate ferestrele aplicației, apoi redeschide și reîncearcă.', busy: 'O altă operație folosește aplicația offline. Așteaptă finalizarea ei și reîncearcă.', 'storage-error': 'Nu s-a putut salva repararea. Verifică spațiul disponibil și reîncearcă.', 'integrity-error': 'Fișierele disponibile nu corespund acestei versiuni. Reîncearcă după restabilirea versiunii corecte.', 'network-required': 'Lipsesc sau sunt deteriorate fișiere ale aplicației. Conectează-te la internet și reîncearcă.' }
	},
	en: {
		title: 'Offline app recovery', repair: 'Repair offline app', open: 'Open app',
		intro: 'Repair changes only app files. Your map package, favorites and settings are not deleted.',
		working: 'Checking and repairing the app…', ready: 'The app is ready to start offline.',
		failed: 'Repair could not finish. Please retry.',
		errors: { replacement: 'An app update is in progress. Close all app windows, then reopen and retry.', busy: 'Another operation is using the offline app. Wait for it to finish and retry.', 'storage-error': 'Repair could not be saved. Check available storage and retry.', 'integrity-error': 'Available files do not match this version. Retry after the correct version is restored.', 'network-required': 'App files are missing or damaged. Connect to the internet and retry.' }
	}
};
/** Embedded in the installed worker: recovery must not import damaged app assets. */
function recoveryClient(scope: string, texts: typeof shellRecoveryText) {
	let lang: 'ro' | 'en' = 'ro';
	let theme = 'dark';
	try {
		const settings = JSON.parse(localStorage.getItem('alt-stb-settings') ?? 'null');
		if (settings?.lang === 'en') lang = 'en';
		if (settings?.theme === 'light') theme = 'light';
	} catch { /* Storage can be unavailable; recovery still has safe defaults. */ }
	const strings = texts[lang];
	document.documentElement.lang = lang;
	document.documentElement.dataset.theme = theme;
	document.title = strings.title;
	document.querySelector('h1')!.textContent = strings.title;
	document.querySelector('#intro')!.textContent = strings.intro;
	const button = document.querySelector<HTMLButtonElement>('button')!;
	const status = document.querySelector<HTMLElement>('[role="status"]')!;
	const open = document.querySelector<HTMLAnchorElement>('a')!;
	button.textContent = strings.repair;
	open.textContent = strings.open;
	function report(message: string, failed = false) {
		status.textContent = message;
		status.setAttribute('role', failed ? 'alert' : 'status');
		status.setAttribute('aria-live', failed ? 'assertive' : 'polite');
	}
	button.addEventListener('click', async () => {
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		open.hidden = true;
		report(strings.working);
		try {
			const worker = (await navigator.serviceWorker.getRegistration(scope))?.active;
			if (!worker) throw new Error('Worker unavailable');
			const result = await new Promise<{ status: string }>((resolve, reject) => {
				const channel = new MessageChannel();
				const close = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
				const timer = setTimeout(() => { close(); reject(new Error('Recovery timeout')); }, 120_000);
				channel.port1.onmessage = event => { close(); resolve(event.data); };
				try { worker.postMessage({ type: 'OFFLINE_SHELL_RECOVER' }, [channel.port2]); }
				catch (error) { close(); reject(error); }
			});
			if (result.status !== 'ready') {
				const message = strings.errors[result.status as keyof typeof strings.errors];
				report(typeof message === 'string' ? message : strings.failed, true);
				return;
			}
			report(strings.ready);
			open.hidden = false;
		} catch { report(strings.failed, true); }
		finally { button.disabled = false; button.removeAttribute('aria-busy'); }
	});
}

export function shellRecoveryResponse(scope: string): Response {
	const nonce = crypto.randomUUID();
	const argumentsJson = [scope, shellRecoveryText].map(value => JSON.stringify(value).replaceAll('<', '\\u003c')).join(',');
	return new Response(`<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Repararea aplicației offline</title>
<style>:root{--color-bg:#1a1a2e;--color-text:#e8e8f0;--color-accent:#4cc9f0;color-scheme:dark}
[data-theme='light']{--color-bg:#f5f5f7;--color-text:#1a1a2e;--color-accent:#0077b6;color-scheme:light}
*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100dvh;background:var(--color-bg);color:var(--color-text);font:18px/1.5 system-ui,sans-serif}
main{max-width:36rem;margin:auto}button,a{min-height:44px;padding:12px 18px;font:inherit}a{display:inline-block;color:var(--color-accent)}[hidden]{display:none}button:disabled{opacity:.65}:focus-visible{outline:3px solid var(--color-accent);outline-offset:3px}</style></head>
<body><main><h1>Repararea aplicației offline</h1><p id="intro">Repararea modifică doar fișierele aplicației. Pachetul hărții, favoritele și setările nu sunt șterse.</p>
<p role="status" aria-live="polite"></p><button type="button">Repară aplicația offline</button><a href="${new URL(scope).pathname}" hidden>Deschide aplicația</a></main>
<script nonce="${nonce}">(${recoveryClient.toString()})(${argumentsJson});</script></body></html>`, {
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
			'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
			'X-Content-Type-Options': 'nosniff' }
	});
}
