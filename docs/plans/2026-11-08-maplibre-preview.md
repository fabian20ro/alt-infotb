# Pasul 4: adaptor MapLibre în preview

Implementare 2026-11-08, peste ramura PR #62 (care include managerul din PR #63).
Aplicația păstrează Leaflet implicit. MapLibre se injectează numai în fixture-urile
browserului și în preview-ul local de stocare; buildul normal nu include runtime-ul,
CSS-ul sau workerul MapLibre. CI verifică explicit această izolare.

## Implementare

- `MapRendererFactory` permite unui consumator de preview să furnizeze motorul.
  `MapView` păstrează aceeași scenă, traduceri, recentrare și controler de cameră.
  Schimbarea motorului cere remontarea componentei; nu există selector în producție.
- Adaptor MapLibre: stații cu butoane native accesibile, selecție și apartenența
  la linie în ambele sensuri, trasee/vehicule separate, poziție și cerc de precizie.
  Actualizările scenei nu schimbă camera; schimbarea stilului reface suprapunerile.
- Zoomul contractului rămâne pe scara Leaflet: MapLibre folosește o lume de 512 px,
  deci adaptorul aplică `zoomMapLibre = zoomContract - 1`. Încadrarea folosește
  limitele geografice și paddingul existent, fără conversii în logica de transport.
- CARTO/Esri păstrează configurația și verificarea canary existente. Fără cheie,
  adaptorul nu solicită tile-uri CARTO. Eșecurile și reîncercarea au stări explicite.
- Sursa PMTiles citește exclusiv prin `ReaderLease`; nu accesează direct OPFS,
  CacheStorage sau IndexedDB. Fiecare hartă are protocol propriu, inclusiv când
  două hărți citesc aceeași generație. Nu există fallback de rețea pentru assets locale.
- Compatibilitatea de profil este un modul pur comun pipeline-ului și rendererului.
  Sursa verifică stilul/headerul și rescrie numai URL-urile locale cunoscute.
- Confirmare după primul cadru complet (`idle` fără erori); refuzul confirmării nu
  devine succes vizual. Eșecul primei afișări permite rollback; erorile ulterioare și
  pierderea contextului WebGL sunt raportate separat. Un cititor eșuat se redeschide
  din generația activă, nu se reutilizează după rollback.
- `destroy()` îndepărtează harta înainte de a elibera cititorul. Erorile de stil nu
  eliberează prematur fișierele unei hărți încă montate; citirile în curs sunt drenate.

Bibliotecile MapLibre/PMTiles folosesc decoderul MVT propriu; API-ul STB păstrează
neschimbat decoderul protobuf personalizat și accesul prin proxy.

## Verificare

Verificate local: 1.277 teste unitare (36 suite), 64 teste Node tooling, typecheck
aplicație/catalog/service worker/shared API, build static fără runtime MapLibre.
36 scenarii de paritate și 6 scenarii cu stocare reală trecute; verificarea suplimentară
fără WebGL și măsurătorile fizice sunt în curs înainte de finalizarea PR-ului.
Fixture-ul liniei 66 este comparat cu capturile protobuf originale. Vehiculele de
pe acest traseu sunt sintetice și etichetate ca atare; geometria provine din captură.
Testele includ toate stațiile catalogate pentru N109 și cele trei platforme Isovolta.

Preview componentă: `npm run test:e2e:maplibre`, un singur worker, Chromium desktop
și Android emulat. Fixture-ul poate fi deschis local la
`/e2e/fixtures/map-parity.html?engine=maplibre` prin Vite în `--mode test`.
Nu este o rută publicată a aplicației.

Preview offline: din `tools/pmtiles`, `npm run build:storage`, apoi
`PMTILES_PACKAGE_DIR=... PMTILES_CLI=... node src/serve-storage.ts`.
Folosește managerul real, catalogul complet și adaptorul nou. Pachetul rămâne
47.176.137 bytes; nicio sursă/glyph/stil din pachet nu este regenerată în acest pas.

## Limite și probleme rămase

- Distribuția publică fără risc de facturare și catalogul de oferte de încredere nu
  sunt încă alese. R2 rămâne refuzat; niciun serviciu cloud nu este activat.
- Harta nu blochează camera la marginea pachetului: stațiile regionale rămân vizibile
  și în afara acoperirii, unde fundalul vectorial poate lipsi. UI trebuie să distingă
  lipsa acoperirii de coruperea pachetului și de lipsa datelor STB live.
- Brave fizic este amânat explicit de utilizator pentru etapa următoare. Suportul
  iOS/WebKit pentru MapLibre și stocare offline nu este declarat verificat.
- Localizarea controalelor native MapLibre se aplică la creare; componenta exterioară
  își schimbă textele reactiv. În integrarea reală trebuie stabilită actualizarea
  controalelor la schimbarea limbii fără pierderea camerei.
- Shellul testului este separat. Precache-ul aplicației reale, actualizarea workerului,
  compatibilitatea aplicație/pachet și UI de instalare/ștergere rămân pașii 5–6.
- Pachetul are 1.039 assets: operațiile seriale de descărcare/verificare au cost vizibil.
  Împachetarea/deduplicarea și reluarea descărcării sunt optimizări ulterioare, cu
  verificare completă a resurselor; nu tăiem fonturi după presupuneri lingvistice.

## Recomandare următoare: UI și shell offline, încă opt-in

1. Un coordonator la nivel de aplicație deține managerul și generația selectată.
   Rendererul primește numai sursa imutabilă și callbacks de randare. La actualizare,
   alegerea de a trece pe versiunea nouă este explicită; cititorul vechi se închide
   după distrugerea rendererului. Metadatele rămân singura sursă de adevăr a pachetului.
2. Panou „Hărți offline” RO/EN, Svelte 5: regiune/data/bytes/spațiu temporar,
   descărcare/anulare/progres, persistență reală și instalare PWA, actualizare,
   reparare și ștergere cu cititori încă deschiși. Refuzul persistenței nu șterge pachetul.
3. Shell/worker/chunk-uri MapLibre disponibile offline înainte de activare; nu
   duplicăm arhiva OPFS în precache. Migrarea păstrează cache-urile raster/datele STB
   și verifică aplicație nouă + pachet vechi, tab vechi + SW nou și rollback.
4. Stări distincte: pachet absent/deteriorat, context WebGL pierdut, regiune neacoperită,
   sursă raster indisponibilă, sosiri live indisponibile. Fallback-ul raster nu trebuie
   descris ca hartă regională offline. Oferim remontare/reparare explicită.
5. Validare opt-in în buildul real sub `/alt-infotb/`: Chrome și Brave pe Pixel,
   restart rece cu server oprit, pan/pinch/stații/trasee și măsurători RAM/cadre.
   Activarea implicită în producție rămâne un pas separat, după acest gate.

Îmbunătățirea arhitecturală: coordonatorul leagă politica de instalare de selecția
sursei și de versiunea shellului. Rendererul rămâne fără acces la manager/stocare,
controlerul camerei rămâne fără dependențe de motor, iar catalogul STB rămâne separat.
