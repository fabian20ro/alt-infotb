# Plan: integrare PMTiles și hărți offline

**Stare: plan acceptat, 2026-11-07.** Pasul 1 este implementat pe branchul `codex/pmtiles-integration-contracts`; pașii 2–6 rămân planificați. Nicio activare sau publicare în producție. Detalii: [contractele pasului 1](../pmtiles-contracts.md).

## Recomandare

MapLibre devine motorul țintă al hărții. Va afișa atât pachetul vectorial PMTiles local, cât și sursele raster CARTO/Esri existente. Leaflet rămâne temporar disponibil pentru revenire, până la paritate funcțională și verificare pe dispozitive. Un singur motor este activ într-un moment; nu suprapunem două hărți.

Descărcarea București–Ilfov este opțională. Pachetul se gestionează separat de renderer, datele STB, catalogul stațiilor și actualizarea aplicației. Nu descărcăm anticipat tile-uri CARTO/Esri pentru a construi pachetul.

Punct de plecare verificat: [raportul prototipului](2026-11-07-pmtiles-baseline.md). Pachetul complet are aproximativ 49 MB, din care 28,79 MB geometrie și 17,82 MB fonturi/simboluri; ocuparea observată pe Pixel a fost 50–54 MB. Date native z0–15, afișare până la z19 prin mărire. Pixel 6a / Chrome 156 a trecut testele offline, iar instalarea PWA urmată de o nouă solicitare a acordat persistență. Aceste rezultate nu sunt garanții pentru toate dispozitivele sau pentru originea de producție.

## Limitele primei versiuni

- Un pachet: București–Ilfov + marjă, dreptunghi `[25.80,44.19,26.49,44.80]`. Acoperirea exactă este afișată; nu presupunem că include toate traseele 4xx.
- Descărcare și actualizare inițiate explicit, cu progres și anulare. Fără descărcare obligatorie la prima vizită.
- Verificare de actualizări prin manifest mic, la cerere și cel mult o dată/24 h când aplicația este în prim-plan și conectată. Fără descărcări mari automate.
- Prima versiune reia o descărcare întreruptă de la început. Reluarea prin offset/ETag, actualizările diferențiale și descărcarea garantată în fundal sunt extensii ulterioare.
- Compatibilitatea offline se detectează: OPFS cu `createWritable`, CacheStorage, IndexedDB, Web Locks, service worker și renderer WebGL funcțional. În browsere incompatibile, harta online rămâne utilizabilă; nu declarăm un pachet „pregătit offline”.
- Harta offline nu furnizează sosiri sau vehicule live. Păstrăm comportamentul existent pentru datele de transport și marcarea informațiilor vechi; nu extindem implicit salvarea traseelor/istoricului.

## 1. Separarea responsabilităților

Trei limite clare, fără un framework generic pentru hărți:

| Componentă | Responsabilitate | Nu gestionează |
|---|---|---|
| `MapView.svelte` + model de scenă | Stare UI, stație selectată, scene stații/trasee/vehicule, comenzi de recentrare/overview | Fișiere, permisiuni de stocare, protocolul de actualizare |
| Adaptorul rendererului | Cameră, gesturi, markere, surse de fundal, stil, atribuire, erori de afișare | Descărcarea/ștergerea pachetelor, polling STB |
| Managerul pachetelor offline | Manifest, spațiu, transfer, verificare, activare, cititori, recuperare, ștergere, persistență | Coordonate live, selecția stațiilor, implementarea vizuală a hărții |

Contractul rendererului exprimă operațiile deja necesare: scenă, sursă de fundal, cameră, recentrare, overview, evenimente de viewport/selecție și eliberare. Nu exportă tipuri Leaflet/MapLibre. Mutăm tipurile scenei din componenta Svelte într-un modul de model; identitățile STB și regulile de apartenență rămân independente de motor.

Managerul expune un snapshot și operații precum `install`, `cancel`, `checkUpdate`, `update`, `remove`, `requestPersistence`, `openActiveReader`. Svelte 5 runes adaptează snapshotul pentru UI. Nu folosim preferințele din localStorage ca sursă de adevăr pentru existența pachetului.

Markere DOM accesibile pentru stații/vehicule în prima integrare, păstrând numele, rolurile și activarea cu tastatura. Nu mutăm totul pe canvas înainte de a avea o alternativă accesibilă verificată.

## 2. Pachet și distribuție

### Contract versionat

Manifestul imutabil include:

- `regionId`, versiune, data datelor, limite geografice, zoom nativ și schema tile-urilor;
- schema manifestului și intervalul de compatibilitate al aplicației/rendererului;
- arhiva PMTiles: URL imutabil, bytes, SHA256;
- resursele stilului: versiune, glyph-uri, sprites light/dark 1x/2x, bytes și hash pentru fiecare;
- dimensiunea totală, atribuire și licențe.

Manifestul este validat la intrare: scheme/versiuni cunoscute, limite numerice, dimensiuni finite, căi canonice și origini aprobate. Pachetul nu poate introduce JavaScript sau URL-uri arbitrare pentru workeri. Codul MapLibre și workerul său fac parte din shellul aplicației; stilul și datele au compatibilitate explicită cu acel cod.

Pipeline separat: extragere din sursă Protomaps fixată → verificare PMTiles → resurse complete → verificări de simboluri/fonturi → manifest/hashuri → test offline → publicare obiecte imutabile → publicare pointerul `latest` **ultimul**. Păstrăm extrasul regional; nu depindem de retenția temporară a arhivelor planetare Protomaps. Nu schimbăm sursa în tăcere dacă data fixată nu mai există.

**Găzduire recomandată:** bucket Cloudflare R2 separat pentru aceste date redistribuibile, cu adresă publică stabilă și CORS pentru aplicație. Nu trecem fișierele prin proxy-ul STB și nu avem nevoie de chei secrete în browser. Fișierele PMTiles păstrează reprezentarea binară pentru Range requests; fără transformări care schimbă offseturile. Verificăm GET/HEAD/Range, răspuns 206, Content-Range, ETag și CORS. Nu folosim domeniul de dezvoltare cu limitări ca infrastructură permanentă.

Obiecte versionate: cache HTTP lung, immutable; manifestul `latest`: prospețime scurtă/revalidare. Păstrăm cel puțin ultimele trei versiuni / 90 zile pentru reinstalare și revenire; politica exactă se confirmă înainte de lansare. Pachetele deja instalate continuă să funcționeze și după retragerea versiunii lor de pe server.

Inițial publicare manuală; ulterior candidat lunar și la cerere, activat numai după verificări. Publicarea unui pachet nou nu obligă dispozitivele să îl descarce.

## 3. Stocare și stări

- **OPFS:** fișier PMTiles separat, imutabil pentru fiecare versiune. Scriere streaming și SHA256 incremental; citire prin intervale din `FileSource`, fără încărcarea întregii arhive în RAM.
- **CacheStorage dedicat:** glyph-uri/stil/sprites per versiune. Fără TTL, limită de 100 intrări sau ștergere automată la erori de cotă. Prima versiune poate duplica resursele între două generații pentru a simplifica actualizarea sigură.
- **IndexedDB:** metadate mici: versiune activă, precedentă, candidat, jurnal de operație, stare de verificare și ștergeri în așteptare. Nu duplicăm aici fișierul PMTiles sau catalogul stațiilor.

Namespace-ul tuturor resurselor include baza aplicației `/alt-infotb/`, regiunea și versiunea. Alte proiecte GitHub Pages pot împărți originea; nu ștergem toate cache-urile/fișierele acelei origini. Permisiunea persistentă este la nivel de origine, nu de pachet.

Stările sunt independente:

| Dimensiune | Exemple |
|---|---|
| Disponibilitate | absent, gata, deteriorat/incomplet |
| Operație | inactiv, descarcă, verifică, actualizează, șterge, curățare amânată |
| Persistență | necunoscută, acordată, neacordată, indisponibilă |

O actualizare în curs nu ascunde faptul că versiunea veche este încă utilizabilă. Refuzul persistenței nu transformă o descărcare reușită într-un eșec. Acordarea protejează împotriva evacuării automate la presiune de stocare; nu împotriva ștergerii deliberate a datelor browserului. Instalarea PWA ajută, dar nu garantează acordarea; afișăm rezultatul efectiv.

## 4. Descărcare și persistență

1. UI arată regiunea, data, dimensiunea și spațiul temporar necesar. Verificăm capabilitățile și `storage.estimate()`, dar tratăm estimarea ca orientativă, nu ca rezervare de spațiu.
2. Din acțiunea explicită „Descarcă pentru offline”, cerem persistență. Dacă este refuzată, descărcarea poate continua cu statut clar. Oferim instalarea PWA și buton de reîncercare; după instalare cererea se reevaluează, fără buclă de solicitări.
3. Luăm lock exclusiv de modificare pentru această regiune. Descărcăm numai în versiunea candidat; respectăm anularea, limitele de bytes și timeout/retry limitat.
4. Închidem fișierul; verificăm SHA256, dimensiune, header/schema/limite, resursele și compatibilitatea. Testăm și tile-uri reprezentative, etichete, ambele teme și simboluri retina.
5. Verificăm că shellul aplicației, chunk-urile lazy și workerul MapLibre necesare sunt disponibile offline înainte de a afișa „pregătit offline”.
6. Activăm printr-o tranzacție scurtă în IndexedDB. Permisiunea se citește separat prin `persisted()`; UI nu deduce acordarea doar din instalarea PWA.

La refuz de cotă, rețea pierdută sau anulare: curățăm candidatul, păstrăm orice versiune activă și oferim retry. După închiderea browserului în mijlocul transferului, următoarea pornire recuperează jurnalul și curăță resturile fără a descărca automat din nou.

La fiecare pornire: verificare rapidă a pointerului, existenței/dimensiunii fișierului și resurselor necesare. Revalidare completă la instalare/actualizare/reparare; nu recalculăm 49 MB de hash la fiecare deschidere. Dacă există deteriorare, oferim reparare când există conexiune și păstrăm stațiile/UI funcționale.

## 5. Actualizare fără pierderea hărții existente

**OPFS, CacheStorage și IndexedDB nu au o tranzacție comună.** Siguranța provine din date imutabile plus schimbarea atomică a pointerului, nu dintr-o presupusă tranzacție între cele trei.

1. Utilizatorul vede „Actualizare disponibilă”, data și bytes de descărcat/spațiul suplimentar.
2. Versiunea A rămâne activă; B se descarcă și se verifică separat.
3. Numai după verificarea completă, o tranzacție IDB setează B activă și A ca versiune precedentă. Nu ținem tranzacția deschisă în timpul operațiilor de rețea/fișiere.
4. Fiecare renderer deschide un cititor al versiunii exacte. Schimbarea A→B păstrează camera, selecția și overlay-urile.
5. Păstrăm A până la prima randare reușită a lui B și până când nu mai are cititori. Dacă B nu este încă afișată, A rămâne pentru revenire; nu începem acumularea unei a treia generații.
6. La eșec de afișare a lui B, revenim la A prin metadate și marcăm B ca defectă. La succes, curățăm A când este sigur.

Recuperare după crash: înaintea schimbării pointerului, A rămâne valabilă; după schimbare, B completă poate fi redeschisă, iar A rămâne pentru confirmare/revenire. Candidatul necomplet nu devine niciodată sursă activă.

Planificăm aproximativ 100–120 MB ocupați temporar pentru două pachete de mărimea prototipului și marjă; necesarul se calculează din manifest și se verifică din nou la scriere. Dacă nu încape B, nu ștergem automat A. Utilizatorul poate elibera spațiu sau poate alege separat ștergerea pachetului, asumând intervalul fără hartă offline.

## 6. Ștergere și mai multe taburi

- Acțiunea „Șterge harta offline” arată regiunea și spațiul estimat recuperat. Favoritele, catalogul stațiilor și preferințele nu sunt ținte ale ștergerii.
- Lock exclusiv pentru modificarea regiunii; anulăm/închidem transferul candidat și înregistrăm intenția de ștergere înaintea eliminării fișierelor.
- Dezactivăm pointerul, anunțăm celelalte taburi prin BroadcastChannel și schimbăm sursa hărții. Online poate reveni la raster; offline rămân stațiile și mesajul privind lipsa fundalului.
- Cititorii țin lock comun pe versiunea folosită. Deschiderea unui cititor verifică din nou metadatele după obținerea lockului, pentru a evita cursa cu ștergerea.
- Curățarea fizică ia lock exclusiv pe versiune. Un tab suspendat poate amâna eliberarea: UI spune „ștergere în curs”, nu „spațiu eliberat”. Nu folosim un timeout care șterge arbitrar versiunea citită.
- Ștergerea poate fi reluată după crash; operațiile sunt idempotente. „Șters” apare numai după eliminarea arhivelor/cache-urilor/metadatelor pachetului și recitirea spațiului estimat.
- Nu încercăm să revocăm automat permisiunea persistentă a întregii origini și nu ștergem shellul PWA.

## 7. Integrarea hărții și service workerului

### Paritate funcțională înainte de schimbarea motorului implicit

Păstrăm: selecția stației; stațiile liniei în ambele sensuri peste limita fundalului; identitățile stațiilor/favorite; primary/opposite route și vehicule; GPS și cerc de precizie; recentrare în timpul zoomului și înaintea primei poziții; overview explicit; polling fără mutarea camerei; temă, limbă și accesibilitate. Schimbarea stilului MapLibre reatașează overlay-urile fără cereri STB suplimentare.

În etapa opt-in, MapLibre poate utiliza sursele raster existente chiar fără pachet offline. Pachetul valid este preferat în aria sa. La ieșirea din aria acoperită, UI indică limita și oferă sursa online pentru întregul viewport; evităm suprapunerea etichetelor raster/vector. Offline afișăm partea acoperită și un mesaj pentru zona lipsă, fără a restrânge artificial stațiile/traseele la dreptunghi. Satelitul rămâne opțiune separată, fără promisiune de descărcare completă.

### Reguli SW

În codul actual, ruta statică generică are 100 intrări, 180 secunde și `purgeOnQuotaError`. Resursele pachetului primesc rute explicite înaintea ei și cache-uri dedicate; fallbackul generic nu le poate captura sau expira. URL-urile virtuale locale includ baza aplicației și versiunea, cu normalizare consecventă pentru `@2x`.

Arhiva mare este citită din OPFS, nu duplicată automat în precache/CacheStorage. Operațiile de descărcare aparțin managerului, nu unui service worker despre care presupunem că rulează continuu. API-ul STB rămâne network-only.

Actualizarea aplicației și actualizarea pachetului sunt operații diferite. Revizuim `skipWaiting`/`clientsClaim`/`cleanupOutdatedCaches`: activarea unui shell nou trebuie coordonată cu operațiile în curs și cu taburile vechi, fără ștergerea resurselor încă necesare importurilor lor lazy. Alegem activare controlată cu mesaj de reîncărcare, nu reload necondiționat în mijlocul transferului. Un deploy nu șterge cache-uri de pachet doar pentru că versiunea aplicației s-a schimbat.

Aplicația/SW noi trebuie să poată deschide schemele pachetelor încă suportate. Nu lansăm o versiune care invalidează singurul pachet offline instalat; o schimbare incompatibilă cere tranziție explicită, cu posibilitatea revenirii.

## 8. Etape de implementare și verificare

Fiecare etapă produce un PR separat; producția se activează abia după gate-ul final. Sunt direcții de fișiere, nu obligația de a crea module goale anticipat.

| Etapă | Livrabil și zone principale | Criteriu de închidere |
|---|---|---|
| 1. Contract și risc de integrare | `src/lib/map/model.ts`, contract renderer, fixtures de scenă; manifest pachet într-un modul separat | Baseline pe Pixel cu stații/trasee reale; acoperire/zoom comparate ([rezultate și limite](2026-11-07-pmtiles-baseline.md)); contract stabil și teste independente de Leaflet |
| 2. Pipeline pachet | Generator, validator și workflow manual dedicat; artefacte imutabile | Extract repetabil, hashuri/licențe/simboluri validate; HTTP Range/CORS verificate într-un mediu separat; nimic publicat în producție implicit |
| 3. Manager offline | `src/lib/offline-maps/`: manifest, repository, manager și testele lor | Install/update/delete/recuperare funcționează independent de UI; fault injection în fiecare etapă; două taburi și cote insuficiente |
| 4. Adaptor MapLibre | Renderer lazy + integrarea din `MapView.svelte`; Leaflet disponibil pentru revenire | Paritate cu testele existente de hartă, ambele teme, tastatură/touch, raster și PMTiles; un singur motor activ |
| 5. SW și UI | Rute SW dedicate și activare controlată; panou „Hărți offline” în `DrawerMenu.svelte`, traduceri RO/EN și store Svelte 5 | Stări corecte, instalare PWA, request/read persistence, dimensiuni/progres/update/delete; shell și pachet complet offline |
| 6. Verificare și lansare | E2E pe buildul real cu baza `/alt-infotb/`; test fizic; documentație operațională | Matricea de acceptare de mai jos; preview opt-in, apoi activare explicită separată; revenire testată |

Prima implementare recomandată: contractul pachetului + limita rendererului și scenariile de paritate. Nu mutăm direct codul demo în `MapView.svelte`.

### Matrice minimă de acceptare

- Toate testele actuale relevante: recentrare, touch, selecție, trasee/vehicule, apartenența stațiilor și protecția cache-ului raster.
- Download nou, anulare, fișier corupt, hash greșit, font/sprite/worker lipsă, manifest incompatibil, resurse `@2x`, full offline fără CDN.
- Oprirea procesului în timpul fiecărei faze: transfer, scriere, verificare, schimbare pointer, prima randare, curățare. Versiunea veche rămâne utilizabilă sau operația este recuperată corect.
- Actualizare în timp ce harta este folosită; două taburi concurente; tab suspendat care citește versiunea veche; ștergere concurentă cu download și cu pornirea unui cititor.
- Spațiu insuficient atât la estimarea inițială, cât și `QuotaExceededError` în timpul scrierii. Fără ștergerea automată a versiunii active.
- PWA neinstalată/instalată, persistență refuzată/acordată; verificare reală pe originea de test și ulterior pe originea de producție, nu transferarea concluziei de la localhost.
- Aplicație/SW noi cu pachet vechi; tab vechi cu SW nou; rollback de aplicație și de pachet; ștergerea manuală a datelor browserului; alte cache-uri de pe aceeași origine rămân intacte.
- Șapte localități × două teme × z10/z15/z18, plus limita regiunii și o linie regională care o depășește. Fără avertismente de simboluri lipsă.
- Pixel 6a fizic: oprire server, restart aplicație, pan/pinch/selectare stații/trasee. Chrome și Brave verificate separat; Safari/WebKit verificat înainte de a declara suport offline pe iOS.
- Bugete inițiale de acceptare, de confirmat cu scena completă: map-idle ≤1,5 s după construcția rendererului pe Pixel; p95 interval cadre ≤33 ms într-un pan controlat; fără blocaje >200 ms atribuibile verificării/hashării. Măsurăm și RAM/GPU disponibil, contexte pierdute și descărcare pe rețea realistă; viteza USB nu este reper pentru internet.
- Playwright cu **un singur worker**. Typecheck/unit/build înaintea browserelor; nu regenerăm Svelte/Vite în timpul E2E. Păstrăm update-urile de securitate și verificăm instalarea/peer dependencies/audit la introducerea noilor biblioteci.

## Revenire și lucruri amânate

În rollout opt-in, putem selecta adaptorul Leaflet fără a șterge pachetul. Dacă rendererul PMTiles este defect, păstrăm datele pentru o versiune reparată și explicăm că fundalul offline este temporar indisponibil; revenirea la raster nu înseamnă că întreaga regiune este offline. Orice rollback de aplicație trebuie să recunoască metadatele existente și să nu le curețe.

După stabilizare: eliminarea adaptorului Leaflet temporar, reducerea/deduplicarea glyph-urilor, împachetarea resurselor pentru mai puține cereri HTTP, resume Range verificat, mai multe regiuni și eventual actualizări diferențiale. Nu eliminăm glyph-uri după o simplă presupunere că toate numele sunt latine; o optimizare trebuie verificată pe conținutul și stilul efective.

Decizii de confirmat înainte de rollout, fără a bloca proiectarea acum: numele/bugetul infrastructurii R2, politica finală de retenție/publicare și lista browserelor suportate. Opt-in și revenirea rămân obligatorii până la validarea funcțiilor existente.

## Surse

- [PMTiles cu MapLibre](https://docs.protomaps.com/pmtiles/maplibre), [cerințe pentru găzduire](https://docs.protomaps.com/pmtiles/cloud-storage), [CORS R2](https://developers.cloudflare.com/r2/buckets/cors/).
- [Persistență în Chrome](https://web.dev/articles/persistent-storage), [estimarea stocării](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate), [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
- Dovezi locale: [raportul complet](2026-11-07-pmtiles-baseline.md), `MapView.svelte`, `src/service-worker.ts`, `LESSONS_LEARNED.md`.
