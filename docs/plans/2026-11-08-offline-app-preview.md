# Pasul 5: UI și shell offline în aplicația de preview

Implementare în curs, 2026-11-08, peste PR #62 (include #63 și #64).
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

Rezultatele finale se completează după testele automate și verificarea fizică.

## Lucruri rămase și recomandarea următoare

1. Distribuție publică fără risc de facturare și catalog de încredere: încă nealese.
   Nu activăm R2. Preview-ul local nu reprezintă o soluție de distribuție publică.
2. Curățarea shellurilor istorice: introducerea unor lease-uri per versiune de
   aplicație ar permite ștergerea numai după închiderea ultimului tab vechi.
   Până atunci păstrăm shellurile, evitând invalidarea importurilor lazy offline.
3. Descărcări reluate, împachetarea/deduplicarea celor 1.039 assets și performanța
   pe conexiune mobilă reală: optimizări separate, cu integritate păstrată.
4. Validarea browserelor: rezultate Chrome și Brave raportate separat; suportul
   offline iOS nu se declară fără verificare fizică și WebKit.
5. Activarea implicită a PMTiles în producție rămâne o decizie și o schimbare
   separate, după alegerea distribuției și îndeplinirea matricei de acceptare.

Îmbunătățire arhitecturală recomandată: un registru mic al versiunilor de shell
folosite de taburi, separat de jurnalul generațiilor de hartă. Va lega colectarea
cache-urilor vechi de cititori reali, fără a amesteca actualizările aplicației cu
actualizările datelor cartografice.

## Referințe tehnice

- [Workbox precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)
  — activarea curăță intrările precache; separarea pe build protejează taburile vechi.
- [InjectManifest și actualizări explicite](https://vite-pwa-org.netlify.app/guide/inject-manifest)
  — worker custom și activare la cerere.
