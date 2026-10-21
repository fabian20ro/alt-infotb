# RCA preliminar: harta absentă pe telefon

Data: 2026-10-21. Investigație; fără modificări de runtime sau deploy.

## Concluzie

Cauza este accesul CARTO fără cheie: furnizorul livrează imagini-placeholder „API KEY REQUIRED”, fără străzi. Utilizatorul a confirmat același mesaj și faptul că apare peste tot; am reprodus independent răspunsurile pe ambele teme CARTO. Nu avem dovada unei limite depășite prin utilizarea telefonului.

Estimare de diagnostic după confirmarea utilizatorului: **aproximativ 99% lipsa cheii CARTO**, aproximativ 1% cumulat pentru factori suplimentari/locali încă neobservați. Este o apreciere a încrederii, nu o probabilitate măsurată statistic. Inițial am evaluat și limitare/rețea, service worker vechi și inițializare/layout; răspunsurile live și simptomul identic pe mai multe dispozitive le fac explicații principale mult mai puțin probabile. Nu avem telemetria telefonului pentru a exclude orice problemă concomitentă.

Cache-ul placeholder-ului este un factor agravant al cauzei confirmate, nu o cauză independentă adăugată artificial în procente. Nu cunoaștem data schimbării de comportament a furnizorului.

## Dovezi

1. `src/lib/components/map/tiles.ts` folosește CARTO pentru light/dark, fără `key`; satellite folosește Esri. Tile-urile sunt cerute direct de browser, separat de proxy-ul STB. Auditul celor 3.980 de stații interoghează STB, nu CARTO.
2. Pe 2026-10-21, aproximativ 13:47 Europe/Bucharest, patru GET-uri pentru București, zoom 15, x18759/18760, y11860, subdomenii a/b/c, normal și @2x: toate HTTP 200. Dark: 2.513 bytes, SHA256 `cc3f31364a735d9a8179af36b3db7617cdff8bdb0248654ebcc3df91607abedc`; light: 2.049 bytes, SHA256 `69be4aecf9f814ba45d585801a5aa41e79b16fc88eafec5b1954a9f06a69e6be`. Același conținut pentru coordonate/rezoluții diferite în aceeași temă; inspecția imaginii dark arată exclusiv fundal și watermark. Un GET Esri pentru aceeași zonă: HTTP 200, JPEG 25.070 bytes.
3. CARTO trimite `Cache-Control: public, max-age=2592000, immutable` — 30 zile — și `Access-Control-Allow-Origin: *`. ETag-urile încep cu `wm-`. Niciun 429 în probe. Nu cunoaștem momentul exact al schimbării furnizorului și nu extrapolăm aceste probe la toate regiunile CDN.
4. **Configurație existentă, activare absentă în browserul testat:** pagina publică a încărcat 12 tile-uri și 91 markere, însă `navigator.serviceWorker.getRegistrations()` a returnat `[]`, controller absent și `caches.keys()` gol, inclusiv după reload. Linkul manifest lipsește din DOM. Codul local nu înregistrează explicit SW și HTML-ul public nu include script de înregistrare. Nu am inspectat instalările mai vechi ale utilizatorului. Așadar nu putem afirma că cache-ul configurat este efectiv activ pentru fiecare utilizator. Service worker-ul publicat, descărcat de la `/alt-infotb/sw.js`, confirmă `map-tiles`: StaleWhileRevalidate, maximum 500 intrări, 7 zile. Regula generică pentru extensii nu umbrește CARTO: Workbox cere potrivire de la începutul URL-ului pentru cross-origin.
5. StaleWhileRevalidate face un fetch la fiecare utilizare; cache-ul HTTP al browserului poate totuși satisface acel fetch fără trafic la furnizor. Nu putem deduce numărul de cereri taxate doar din numărul de evenimente fetch.
6. Leaflet nu setează `crossOrigin`; imaginile externe sunt no-cors. Workbox StaleWhileRevalidate acceptă implicit răspunsuri opaque (status 0) și 200. Un PNG-placeholder valid trece oricum verificarea HTTP și nu declanșează `tileerror`. Nu există UI de eroare pentru tile-uri în MapView. Schimbarea temei actualizează doar URL-ul; atribuirea rămâne cea inițială, problemă separată de corectat pentru trecerea CARTO↔Esri.
7. Satelitul nu are o regulă runtime de Cache Storage dedicată; cache-ul HTTP normal se poate aplica. Testele E2E de hartă folosesc Vite dev și blochează/simulează tile-urile externe: verifică interacțiunile, nu autenticitatea basemapului sau service worker-ul de producție.

Repro minimal efectuat:

```sh
curl -sS -D /tmp/tile.headers \
  'https://a.basemaps.cartocdn.com/dark_all/15/18759/11860.png' \
  -H 'Referer: https://fabian20ro.github.io/alt-infotb/' -o /tmp/tile.png
```

Semnal: `200 image/png`, ETag `wm-…-dark`, 2.513 bytes, imagine fără cartografie. Un test care verifică doar HTTP 200 este fals pozitiv. Capturile acestei investigații sunt în `/tmp/better-stb-tile-probes-20261021.json` și `/tmp/better-stb-*-20261021.png`.

## Recomandarea de implementare

1. **Repară accesul la furnizor înaintea cache-ului.** Cheie CARTO a proiectului, restricționată pentru domeniul aplicației; utilizatorii PWA nu au nevoie de cont individual. Cheia pentru browser este vizibilă și nu trebuie tratată ca secret de server. Pentru instalări independente: configurație proprie sau furnizor alternativ. Nu folosi un proxy ca ocolire a autentificării/limitelor.
2. **Înregistrează și verifică service worker-ul în producție**, cu scope/base și manifest corecte pentru `/alt-infotb/`, apoi **cache local CacheFirst pentru tile-uri valide**, cu expirare explicită și limită LRU/storage, conform politicii furnizorului. Punct de pornire: 500 tile-uri/7 zile, ajustat după măsurători; doar zone vizitate, fără descărcare în masă. Activează CORS pentru furnizori verificați; cache doar răspunsuri lizibile de succes, fără 401/403/429/5xx sau opaque eronate. Status/MIME nu detectează singure placeholder-ul 200: acces valid și probă vizuală separată rămân necesare.
3. **Migrare a cache-ului la remediere:** configurație comună furnizor/stil/versiune pentru Leaflet și service worker, namespace de cache corespunzător, eliminare numai a vechiului cache de hartă. URL-urile cu cheia validă sunt diferite de cele fără cheie; nu elimina cheia din identitatea cache-ului. Nu șterge favoritele și setările. Cache Storage și cache HTTP sunt mecanisme diferite; simpla ștergere a primului nu invalidează automat al doilea.
4. **Degradare controlată:** mesaj clar pentru indisponibilitatea fundalului, păstrarea stațiilor/traseului, opțiune de furnizor alternativ cu atribuirea corectă. Retry limitat cu backoff/Retry-After pentru erori reale; fără reîncărcări în buclă. O imagine-placeholder 200 nu poate fi detectată numai prin evenimentul Leaflet tileerror.
5. **Verificare pe build de producție:** service worker activ; a doua vizită în TTL fără cerere externă pentru tile-ul valid; offline cu zonă vizitată; cache rece offline; erori 401/403/429/5xx; placeholder 200; cotă/evicție; migrare cache; light/dark/satellite și mobil. Separat, canary live cu trafic minim și verificare de conținut, fiindcă testele mock nu pot surprinde o schimbare comercială a furnizorului. Nu folosi doar dimensiunea mică a fișierului ca detector: există tile-uri legitime uniforme.

**Pe termen lung:** arhivă regională PMTiles găzduită de proiect, din date cu drept de redistribuire, pentru București–Ilfov și aria liniilor regionale. Separă sursa basemapului de stratul STB. PMTiles permite citirea fragmentelor prin HTTP Range și cache la CDN/client; nu oferă automat offline complet. Necesită pipeline de actualizare, atribuiri, buget de stocare/trafic și, pentru vectori, evaluarea MapLibre și a performanței mobile. Nu este condiție pentru repararea incidentului de azi.

Cache-ul local reduce cererile repetate și păstrează zone deja vizitate. Nu asigură zone noi fără rețea, nu repară o cheie lipsă și poate fi evacuat de browser. Cache comun la CDN/proxy numai dacă furnizorul permite redistribuirea; pentru PMTiles propriu este o alegere arhitecturală naturală.

## Surse verificate

- [CARTO: chei și cote actuale](https://www.carto.com/basemaps/apikey/) — 5M cereri/lună non-comercial, 1M comercial; total pe cont/chei, nu o cotă declarată per telefon.
- [CARTO: raster/vector](https://github.com/CartoDB/basemap-styles) — cheie cerută, watermark fără cheie. Documentația actuală spune că raster continuă să primească actualizări; afirmația din nota noastră din septembrie despre retragere nu mai trebuie folosită ca premisă.
- [Integrarea SvelteKit PWA](https://vite-pwa-org.netlify.app/frameworks/sveltekit).
- [Workbox: strategii](https://developer.chrome.com/docs/workbox/modules/workbox-strategies) și [runtime caching](https://developer.chrome.com/docs/workbox/caching-resources-during-runtime).
- [Workbox: cross-origin route matching](https://developer.chrome.com/docs/workbox/modules/workbox-routing).
- [PMTiles](https://docs.protomaps.com/pmtiles/).
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) — cache local cerut, bulk/prefetch interzis pe serverul public; nu este sursă pentru descărcarea unui pachet offline.
