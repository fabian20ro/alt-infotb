# Pasul 3: manager offline PMTiles

Implementare izolată, 2026-11-07. PR separat peste pasul 2; fără activare în
aplicație, modificări ale service workerului de producție, distribuție cloud sau R2.

## Ce este implementat

- Instalare și actualizare explicită, progres, anulare locală/din alt tab,
  verificare de spațiu și păstrarea pachetului activ la eșec.
- Manifest fixat prin SHA256 primit de la un catalog de încredere; HTTPS/origini
  aprobate, limite de bytes, timeout, refuz de redirect și hashuri streaming.
- Fișier PMTiles în OPFS; cele 1.039 resurse în CacheStorage; metadate în IndexedDB.
  Pachet verificat: 47.176.137 bytes. Dimensiunea raportată de browser include overhead.
- Recitirea și verificarea tuturor fișierelor salvate înainte de activare.
  Arhiva se verifică în bucăți de maximum 1 MiB; nu este încărcată integral în RAM.
- Activare atomică în IDB după închiderea fișierelor și verificarea shellului offline.
  Prima randare confirmă versiunea nouă; eșecul ei permite revenirea la precedenta.
- Cititori cu lease pentru generația fizică; un cititor vechi poate continua în
  timpul actualizării sau după ștergerea logică. Curățarea fizică așteaptă eliberarea lui.
- Maximum două generații. O a treia instalare așteaptă confirmarea/curățarea.
  Reinstalarea aceleiași versiuni folosește alt ID fizic.
- Recuperare din jurnal după oprire; ștergere exactă a datelor pachetului,
  fără ștergerea altor cache-uri, datelor STB sau revocarea persistenței originii.
- Cerere explicită de persistență și citirea rezultatului real. Refuzul nu invalidează
  instalarea. PWA/persistență nu împiedică ștergerea manuală a datelor browserului.

## Verificare și reproducere

Teste deterministe: 27 manager, 16 jurnal, 21 transfer; incluse în cele 1.259 teste
ale aplicației. Pipeline izolat: 64 teste Node, inclusiv coruperea fișierelor salvate.
Typecheck aplicație/tooling/service worker și build static trecute.

Preview-ul testează OPFS/CacheStorage/IDB/Web Locks reale, instalare, randare offline,
actualizare, rollback, două taburi, ștergere amânată, anulare, crash și restart.
Nu folosește transportul de test în aplicație. Serverul validează independent
pachetul înainte de a emite ofertele fixate prin digest; versiunea v2 este un fixture
sintetic cu aceleași resurse, pentru verificarea mecanismului de actualizare.

Din `tools/pmtiles`, după generarea pachetului prin pasul 2:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build:storage
PMTILES_PACKAGE_DIR=out/bucuresti-ilfov/20261106-v1 PMTILES_CLI=.bin/pmtiles npm run test:storage
```

Pentru verificare manuală, aceleași variabile cu `node src/serve-storage.ts`;
adresa locală implicită este `http://localhost:4187/`. Android prin `adb reverse
tcp:4187 tcp:4187`. Testele Playwright folosesc un singur worker.

CI verifică și construiește preview-ul la PR. Workflow-ul manual generează pachetul,
rulează cele 84 scenarii cartografice și testele de stocare. Artifactele sunt opționale,
dezactivate implicit; niciun job de publicare/deploy nu este adăugat.

## Limite și probleme rămase

- Distribuția publică și catalogul de oferte de încredere rămân deschise. Digestul
  nu poate fi preluat fără verificare chiar din manifestul care trebuie autentificat.
- Descărcarea întreruptă pornește de la început. Fără resume/delta/background download
  garantat; progresul numeric este local tabului care descarcă, starea operației este comună.
- Verificarea existenței la pornire nu recalculează întreaga arhivă. Assets sunt
  revalidate la citire; verificarea integrală are loc la instalare. O degradare ulterioară
  a arhivei cu aceeași dimensiune poate apărea ca eroare a rendererului: integrarea trebuie
  să raporteze problema și să ofere reparare explicită, fără ștergere automată.
- Jurnalul necunoscut/corupt este refuzat. Nu se face reset orb al întregii origini;
  recuperarea metadatelor deteriorate și migrările de schemă au nevoie de UX dedicat.
- Permisiunea persistentă este per origine/browser. Rezultatul de pe localhost
  nu dovedește acordarea pe originea reală; Brave și iOS necesită verificări separate.
- Preview-ul precachează propriul shell/worker. Integrarea PWA reală, rotația shellului,
  compatibilitatea aplicație nouă/pachet vechi și rollback aplicație rămân pașii 5–6.
- Cele 1.039 assets implică multe operații HTTP/cache și verificări. Măsurăm costul
  pe telefon; împachetarea sau deduplicarea este o optimizare ulterioară, cu audit complet
  al glyph-urilor, fără eliminări după presupuneri lingvistice.

## Următorul pas recomandat: adaptor MapLibre, opt-in

1. Implementare `MapRenderer` cu tipurile scenei existente: stații accesibile,
   selecție, ambele sensuri, trasee/vehicule, cameră și comenzi consumate o singură dată.
2. Surse raster CARTO/Esri și PMTiles prin `ReaderLease`. Stilul/glyph/sprite citesc
   numai generația lease-ului; rendererul eliberează lease-ul după `destroy`.
3. Confirmarea/rejecția primei randări la manager; erori ulterioare și context WebGL
   pierdut raportate distinct. Păstrăm pachetul pentru reparare, fără fallback prezentat
   incorect drept „offline complet”.
4. Selector opt-in numai în preview/test; Leaflet rămâne implicit. Testele scenei și
   cele de gesturi rulează pe ambele adaptoare, inclusiv RO/EN, teme, tastatură și DPR.
5. Gate Pixel Chrome/Brave: cold offline, pan/pinch, traseul 66, N109/Isovolta și
   o linie regională la limita pachetului; măsurători frame-time/RAM/idle cu scena completă.

Îmbunătățirea arhitecturală: adaptorul MapLibre consumă un cititor imutabil,
nu accesează direct OPFS/IDB și nu decide când descarcă/șterge. Validatorul de profil
se extrage ulterior din tooling într-un modul comun rendererului; managerul rămâne
independent de bibliotecile grafice. UI și service workerul real vin într-un PR separat.
