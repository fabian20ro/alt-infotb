# Pasul 5: UI și shell offline în aplicația de preview

Implementare 2026-11-08, peste PR #62 (include #63 și #64).
Buildul normal păstrează Leaflet. `npm run build:offline` produce separat
`build-offline`, servit exclusiv pe loopback, la `/alt-infotb/`.
Nu se publică în producție și nu se configurează servicii cloud sau facturare.

## Decizii

- Coordonatorul aplicației deține managerul și alegerea sursei. Un adaptor stabil
  păstrează controlerul, camera, selecția și scena când înlocuiește rendererul.
  Descărcarea și activarea vizuală sunt acțiuni separate. Managerul păstrează
  generația precedentă până la confirmarea primei randări.
- Panoul „Hărți offline”, RO/EN, este un dialog separat de meniul îngust: stare,
  regiune, dată, dimensiune, spațiu temporar, progres/anulare, persistență reală,
  instalare PWA, actualizare, reparare și ștergere cu confirmare.
- Worker separat pentru preview, cu cache de shell per build. Pregătirea offline
  este confirmată prin mesaj către worker și verificarea tuturor intrărilor de
  precache, inclusiv chunkuri lazy și workerul MapLibre. Versiunea aplicației
  încărcate trebuie să coincidă cu versiunea controllerului.
- Actualizarea aplicației cere acțiune explicită. Un Web Lock exclusiv pentru
  activare împiedică suprapunerea cu operațiile managerului și schimbarea sursei,
  care dețin același lock în mod shared. Taburile vechi nu sunt reîncărcate automat.
- Shellurile precedente sunt păstrate pentru importurile lazy ale taburilor vechi.
  Fallback-ul citește numai cache-uri de shell deținute de preview și URL-uri
  imuabile ale aceleiași aplicații. Niciun cache de pachet, STB sau raster nu este
  șters de actualizarea shellului.
- Distribuția locală validează pachetul ales de operator înainte de build și fixează
  hashul manifestului în configurația compilată. Browserul nu acceptă un hash din
  același document pe care îl verifică. Descărcările sunt network-only pentru SW;
  arhiva se păstrează o singură dată în OPFS.

## Verificare

Verificate local: 1.306 teste unitare în 38 suite; 64 teste ale pipeline-ului;
verificări TypeScript pentru aplicație, catalog, shared API, worker și tooling;
build normal fără runtime MapLibre, plus două shelluri de preview complete.
Fiecare shell verifică explicit 24 assets imuabile JS/MJS/CSS, inclusiv workerul.

Cinci teste browser pe aplicația compilată, un singur worker, fără excepții
neașteptate: RO/EN/teme/dialog; anulare; persistență refuzată fără pierderea hărții;
activare explicită; ștergere exactă; actualizare aplicație și pachet între taburi;
import lazy din shell vechi; rollback de aplicație cu pachet mai nou; WebGL pierdut;
stil corupt și reparare; chunk lipsă; lock concurent; proces Chromium nou offline.
Capturi în ambele teme inspectate; regresia de suprapunere confirmă că markerii nu
interceptează controalele de zoom sau atribuirea. Instalarea izolată numai a
tooling-ului trece separat 64 teste și ambele builduri: core-ul validatorului primește
dependențele runtime de la fiecare consumator, fără dependențe implicite pe app. Review Standards și Spec: toate observațiile
rezolvate, inclusiv precondiția de generație verificată în lockul de mutație și
actualizarea imediată a stării shellului în taburi deja deschise.

Harness-ul de stocare are șapte teste browser, inclusiv o regresie deterministă
pentru notificări suprapuse: o singură inspecție activă, urmată de o citire grupată.
Un timeout CI la snapshot-ul celui de-al doilea tab a trecut pe același commit la
reluare; cauza timeout-ului nu este demonstrată. Defectul separat de concurență
al harness-ului a fost reprodus și corectat fără mărirea timeout-urilor.

Pixel 6a / Chrome 156: PWA instalat nativ, deschis în standalone; pachet de
47.176.137 bytes instalat prin interfață și activat separat. Cererea explicită de
persistență a returnat true; grantul a rămas după actualizarea aplicației și după
oprirea Chrome/PWA, server oprit, relansare. Aceeași generație a fost afișată, cu
45 stații în viewport, tema luminoasă și engleză. Poziție de test controlată la
Piața Unirii pentru selecție; tap nativ verificat, plus pan/pinch reale prin CDP.

Eșantion de gesturi: 216 cadre, p95 16,8 ms, maxim 16,9 ms, fără long tasks;
heap JS aproximativ 44,7 MB (nu RAM total/GPU). Acest eșantion era într-o zonă cu
puține stații vizibile; nu reprezintă un benchmark exhaustiv al scenei aglomerate.
Originea ocupa circa 51,7 MB după prima instalare și circa 64,5 MB după trei
shelluri de test păstrate. Shellurile istorice explică o parte din creștere;
colectarea lor sigură rămâne o limită explicită a preview-ului. După al patrulea
shell de test: aproximativ 69,8 MB; încă un restart rece a păstrat harta și persistența.

Brave fizic amânat explicit de utilizator. Local preview nu configurează proxy-ul
STB: eroarea de sosiri live este afișată separat de harta offline funcțională.
Nu se declară testate date live, Safari/iOS sau distribuția publică în acest pas.

## Lucruri rămase și recomandarea următoare

1. Distribuție publică fără risc de facturare și catalog de încredere: încă nealese.
   Nu activăm R2. Preview-ul local nu reprezintă o soluție de distribuție publică.
2. [Curățarea shellurilor](2026-11-08-offline-shell-cleanup.md): etapa următoare
   implementează lease-uri de document și protecția navigărilor înainte de bootstrap.
   Cache-urile anterioare protocolului rămân păstrate conservator; acestea nu pot
   fi adoptate doar fiindcă nu vedem un tab activ care le folosește.
3. Descărcări reluate, împachetarea/deduplicarea celor 1.039 assets și performanța
   pe conexiune mobilă reală: optimizări separate, cu integritate păstrată.
4. Validarea browserelor: rezultate Chrome și Brave raportate separat; suportul
   offline iOS nu se declară fără verificare fizică și WebKit.
5. Activarea implicită a PMTiles în producție rămâne o decizie și o schimbare
   separate, după alegerea distribuției și îndeplinirea matricei de acceptare.

Îmbunătățirea arhitecturală este continuată în planul de curățare: registru mic
pentru ownership și navigări, cu cititori deținuți de browser, separat de jurnalul
generațiilor de hartă. Distribuția publică și migrarea cache-urilor vechi rămân
decizii separate.

## Referințe tehnice

- [Workbox precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)
  — activarea curăță intrările precache; separarea pe build protejează taburile vechi.
- [InjectManifest și actualizări explicite](https://vite-pwa-org.netlify.app/guide/inject-manifest)
  — worker custom și activare la cerere.
