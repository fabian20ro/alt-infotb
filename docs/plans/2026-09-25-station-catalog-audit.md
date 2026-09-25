# Plan propus: catalog STB verificabil și audit complet al stațiilor

Data: 2026-09-25. Plan inițial păstrat pentru trasabilitate. Implementarea și verificările sunt descrise în [planul actualizat](2026-09-25-station-catalog-next.md); publicarea automată rămâne blocată de neconcordanțe upstream și de promovarea proxy-ului. Secțiunile de mai jos descriu intenția inițială, nu statusul curent.

## Obiectiv și constatări

Fiecare stație a unei linii suportate trebuie identificată corect pe hartă, pe ambele sensuri. Schimbările externe și cazurile neprevăzute trebuie detectate automat, inclusiv linii/stații care nu există încă în catalog. „Toate” trebuie raportat față de un inventar independent, nu față de lista incompletă pe care o testăm.

Auditul inițial, intenționat nereprezentativ, a interogat 31 de ID-uri de stație: 30 răspunsuri cu identitate/date, unul gol. A identificat 60 de perechi stație–linie neasociate la 23 de ID-uri: 25 din cauza aliasului CABLE_CAR/TROLLEYBUS; 35 rămase după normalizare, pentru 26 de linii. Dintre acestea, 23 nu există deloc în indexul liniilor din catalog. Detalii în [raportul auditului](../station-membership-audit-2026-09-25.md).

Testele anterioare verificau un catalog derivat din același GTFS și foloseau TROLLEYBUS în fixture. Nu verificau completitudinea sursei și nici valoarea reală CABLE_CAR de la STB.

## Decizia arhitecturală recomandată

Păstrăm frontendul static/PWA și un catalog versionat inclus în aplicație. Construim catalogul din topologia oficială STB, dacă prima etapă confirmă contractul sursei. GTFS rămâne sursă suplimentară pentru datele pe care le oferă corect și fallback explicit pentru servicii fără topologie STB disponibilă.

Folosim ID-ul STB al liniei pentru asocieri, nu concatenarea tipului și numelui. Numele rămâne pentru afișare; normalizarea tipurilor rămâne necesară la intrarea în domeniu. Nu introducem un serviciu nou cu bază de date și nici descoperire a întregii rețele în browser.

| Date | Sursă recomandată | Regula |
| --- | --- | --- |
| Inventar de linii | Registrul STB | Enumerare independentă de catalogul curent |
| Stații pe linie/sens | Topologie STB completă și validată | Autoritate pentru apartenență; înlocuire coerentă, nu unire permanentă cu date istorice |
| ID-uri, nume, coordonate STB | Stațiile din topologia STB | Permite adăugarea stațiilor absente din GTFS |
| Date GTFS utile, eventual servicii fără acoperire STB | TPBI GTFS | Proveniență și acoperire distincte; fallback vizibil în raport |
| Sosiri / vehicule | API live existent | Observațiile pozitive sunt dovezi; absența nu autorizează ștergeri |
| Stații fizice de metrou | Mapare explicită platformă API → marker | Cereri deduplicate, păstrând relațiile cu toți markerii relevanți |

### Surse identificate, dar contract încă de verificat live

Clientul public oficial [InfoTB](https://info.stb.ro/) folosește:

- `GET /lines?lang=ro` — `RequestGetLinesDTO`, câmpul 1 repetat conține linii cu ID, nume și tip.
- `GET /lines/{lineId}?lang=ro` — `ResponseGetLineDTO`, câmpul 12 repetat conține `StopDTO`.
- `GET /lines/{lineId}/direction/{direction}?lang=ro` — aceeași structură; clientul solicită 0 și 1 pentru sensuri. Opțiunea „ambele” folosește ruta fără `/direction`, nu un sens nou inventat.
- `StopDTO` include ID (1), latitudine (2), longitudine (3), nume (4), descriere (5), tip (6).

Dovezile provin din metodele și schema protobuf incluse în `main-es2015.a0ab48d23666b50dae9b.js`, inspectate la data planului. Nu am obținut încă răspunsuri live pentru aceste trei endpointuri: proxy-ul de producție permite momentan doar `/lines/stop`. Schema și utilizarea în client confirmă existența interfețelor, nu exhaustivitatea lor.

**Poartă obligatorie:** verificăm paginare, sensuri/variante, linii suspendate, stații de capăt, stabilitatea ID-urilor, coordonate, metrou și comportament zi/noapte. Nu presupunem că 0/1 reprezintă toate variantele posibile. Dacă sursa nu poate demonstra inventar complet, raportul spune „toate elementele descoperite/cunoscute”, cu acoperire explicită; nu declarăm acoperire a întregii rețele.

### Alternative respinse

- Corecții manuale doar pentru Isovolta/N109: nu previn reapariția problemei și lasă celelalte omisiuni.
- Apartenență dedusă din apropierea de polilinie: confundă linii care se intersectează sau împart un coridor.
- Unirea tuturor observațiilor istorice: adaugă stații corecte, dar nu poate elimina asocieri expirate.
- Parcurgerea rețelei la fiecare deschidere a aplicației: cost multiplicat per utilizator, încărcare lentă, rezultate diferite și offline degradat.
- Testarea completitudinii folosind numai GTFS drept intrare și rezultat așteptat: verifică transformarea, nu adevărul extern.

## Plan de implementare

### 1. Validarea contractului sursei — risc verificat primul

Fișiere principale: `shared-api/src/index.ts`, `shared-api/test/contract.test.ts`, fixture protobuf nou pentru topologie.

Extindem proxy-ul existent strict cu cele trei căi read-only necesare, ID-uri pozitive și parametri validați. Niciun proxy arbitrar și nicio cheie în frontend sau rapoarte. Testăm paritatea dev/producție și că `/lines/stop` rămâne compatibil. Colectorul va folosi proxy-ul; nu copiază autentificarea în mai multe scripturi. Publicarea extensiei de proxy este o dependență separată înaintea colectării live, nu ceva considerat deja realizat în plan.

Verificare: răspunsuri reale pentru 66, N109, 47, 640, o linie absentă complet din GTFS, o linie regională și metrou. N109 trebuie să includă Isovolta în sensurile relevante. Comparăm listele de sens cu detaliul complet și cu dovezile pozitive din `/lines/stop`. Capturăm fixture sanitizate și hashurile lor; nu publicăm tokenuri sau antete de autentificare.

Dacă validarea eșuează, oprim migrarea sursei. Normalizarea și auditorul rămân utile; putem păstra temporar dovezi pozitive versionate, dar nu le prezentăm drept topologie completă și nu ștergem relații pe baza lor.

### 2. Model și decoder comune

Fișiere principale propuse: `src/lib/api/transport.ts`, `src/lib/api/topology.ts`, teste colocate.

Normalizăm explicit `CABLE_CAR` → `TROLLEYBUS`; păstrăm valoarea brută în dovezi. Un enum necunoscut devine incident de contract, nu BUS implicit. Extindem decoderul protobuf existent, fără biblioteci protobuf noi. Funcțiile pure de decodare/normalizare nu depind de Vite, DOM sau configurarea rețelei, pentru a putea fi folosite de aplicație și scripturile Node.

Identități: STB lineId și stopId ca identități sursă; ID-urile GTFS într-un namespace separat. Pentru metrou păstrăm separația între platforma API și stația fizică. Asocierea nume+tip între surse este un adaptor verificat, nu identitatea principală. Orice coliziune rămâne explicită.

Un serviciu fallback GTFS fără lineId STB verificat păstrează identitatea GTFS și statutul „nemapat la STB”; nu inventăm un ID STB. Serviciile declarate în afara acoperirii STB pot rămâne în catalog fără a bloca publicarea, dar nu sunt declarate verificate sau asociate automat unei selecții live ambigue.

Verificare: fixture reale pentru CABLE_CAR:66, Isovolta, tip necunoscut, ID invalid și protobuf trunchiat. Așteptările cunoscute sunt afirmate independent de outputul generatorului.

### 3. Colector reluabil și inventar de acoperire

Fișiere principale propuse: `scripts/collect-stb-catalog.ts`, `scripts/catalog-manifest.ts`, teste ale colectorului.

Enumerăm registrul STB independent, colectăm fiecare linie/sens/variantă suportată și toate stațiile referite. Comparam și cu inventarul precedent și GTFS: elementele numai-GTFS, numai-STB, nou apărute sau nemapate trebuie clasificate, nu omise înainte de calculul acoperirii.

O singură cerere simultan, ritm configurabil, timeout și buget total. Respectăm `Retry-After`, retry limitat cu backoff pentru erori tranzitorii și oprire la autentificare persistent invalidă. Nu lansăm mii de refreshuri de token. Salvăm checkpoint, timestamp, status și hash per răspuns. Reluarea refuză manifest incompatibil sau excesiv de vechi.

Manifestul conține commit/versiune decoder, hash catalog/inventar/surse, intervalul capturii și ziua de transport Europe/Bucharest cu limita 04:00. Fără revizie globală upstream, raportăm un interval de observație, nu pretindem un snapshot instantaneu. Revalidăm inventarul la sfârșit; schimbarea sa invalidează completitudinea execuției.

Două niveluri de numărare: stații fizice și platforme/ID-uri API. Rezultate explicite: verificat, nou, nemapat, fără coordonate, exclus prin politică, răspuns gol, timeout, eroare HTTP, eroare de schemă. HTTP 200 gol nu înseamnă succes. Platformele comune între markerii Dristor sunt interogate o dată și raportate către ambii.

Verificare: transport fals pentru întrerupere/reluare, 429, 5xx, gol, schemă modificată și inventar care se schimbă. Suma categoriilor trebuie să egaleze inventarul declarat.

### 4. Generatorul catalogului candidat

Fișiere principale: `scripts/station-catalog.ts`, `scripts/fetch-stations.ts`, `src/lib/stations/types.ts`.

Generăm linii, stații și apartenență per sens din topologia validată. GTFS completează explicit câmpuri/servicii lipsă, fără să suprascrie asocieri STB validate sau să reintroducă automat opriri eliminate. Proveniența și statutul de completitudine sunt păstrate în manifest.

Păstrăm ID-urile existente ale markerilor pentru favorite/recente. Stațiile noi primesc identități compatibile; metroul folosește mapări explicite. Nu tăiem un traseu suportat la bounding-boxul actual al Bucureștiului: includem toate stațiile liniilor declarate suportate. Dacă acoperirea regională rămâne limitată, limitarea apare explicit și linia nu este etichetată completă.

Politica geografică trebuie să fie comună generatorului și runtimeului. `data.ts::loadStations` respinge acum coordonate din afara 44.2–44.7 / 25.6–26.4; modificarea generatorului singur nu ajunge. Testăm un capăt regional exterior prin încărcarea reală a catalogului și apoi prin filtrul hărții.

Un snapshot candidat trebuie să rezolve fiecare stopId referit la un marker cu coordonate. Linkurile orfane, tipurile neînțelese și mapările ambigue blochează publicarea. Coordonatele și asocierile se publică împreună, niciodată în două actualizări independente.

Eliminările se bazează pe topologie completă, nu pe lipsa sosirilor. Inițial, schimbările distructive necesită confirmare în două colectări complete independente; modificările masive sau ambigue cer investigație. Eliminarea unei linii trebuie confirmată și în registru. Un răspuns gol/incomplet nu poate produce ștergeri. Nu promovăm automat o sursă degradată.

Verificare: generare deterministă din fixture fixe; stație nouă fără GTFS; linie nouă; ambele sensuri; metrou; variante; retragere validă; captură parțială care păstrează ultimul catalog bun. Timestamps de colectare separat de hashul conținutului semantic, ca să nu provocăm redeploy zilnic fără schimbări de date.

### 5. Integrarea în hartă, fără cereri suplimentare per utilizator

Fișiere principale: `src/lib/stations/data.ts`, `src/lib/stores/arrivals.svelte.ts`, `src/lib/components/MapView.svelte`.

Lookupul de apartenență folosește lineId STB și reuniunea stațiilor celor două sensuri. Numele și tipul nu mai pot invalida apartenența unei linii cunoscute. Tipul normalizat rămâne folosit pentru prezentare și adaptoare. Actualizările live de vehicule nu recalculează inventarul rețelei și nu mută viewportul.

Catalogul rămâne inclus și precached în PWA; nu adăugăm IndexedDB duplicat. Pollingul sosirilor rămâne neschimbat. Datele/sursele GTFS și STB au prospețime separată; data buildului nu face o sursă veche să pară actuală.

Verificare: preferințe/favorite existente păstrate; selecție în ambele sensuri; nume schimbat fără pierderea asocierii; mod offline; >100 stații de fundal fără dispariția opririlor liniei.

### 6. Teste automate pe toate elementele, la fiecare PR

Fișiere principale propuse: `scripts/station-membership.test.ts`, manifest/fixture versionate, `e2e/route-map.spec.ts`.

Comanda propusă `npm run test:catalog` parcurge fiecare linie/sens și fiecare relație din snapshotul de referință. Verifică rezolvarea identităților, reuniunea sensurilor, coordonatele și funcțiile de selecție/filtrare folosite efectiv de hartă. Pentru viewporturi controlate, fiecare oprire a liniei aflată în bounds trebuie păstrată inclusiv peste pragul de 100.

Comparam sursa de referință decodată cu candidatul, nu candidatul cu sine. Adăugăm aserțiuni independente pentru cazurile reale găsite și fixture brute la limita decoderului. Include: 66 cu CABLE_CAR, N109/640–Isovolta, 47–Piața Unirii, linie absentă din GTFS, stație nouă, tip nou, coliziune de ID, metrou nemapat, eșec parțial și retragere de linie.

Testele PR sunt deterministe, fără rețea sau secrete. Câteva teste browser verifică traseul complet decoder → selecție → marker în ambele teme; Playwright păstrează un worker. Exhaustivitatea se obține în comparatorul de date, nu prin mii de clickuri în browser.

Verificare prin defecte introduse controlat în teste: eliminarea unei relații, schimbarea unui enum sau adăugarea unei stații nemapate trebuie să facă suita să eșueze.

### 7. Audit live independent și raport de regresie

Fișiere principale propuse: `scripts/audit-station-membership.ts`, `.github/workflows/audit-station-membership.yml`, schema raportului/baseline.

- **Zilnic, după 04:00 București:** inventar și topologie pentru toate liniile/sensurile descoperite; traversarea tuturor relațiilor sursă → candidat. Rulează chiar dacă GTFS nu s-a schimbat.
- **Săptămânal și manual (`stations:audit --live --full`):** suplimentar, `/lines/stop` pentru toate ID-urile API cunoscute, deduplicate inclusiv metroul, drept control independent. O primă execuție completă este obligatorie înaintea migrării. Observațiile pot descoperi linii neincluse în registru; acestea devin incidente de acoperire. Absența sosirilor nu justifică ștergeri, indiferent câte scanări o repetă.
- Raport JSON + Markdown și artifacts cu dovezi, acoperire, erori și diferențe față de ultima execuție validă. Retenție recomandată 30 zile; fixture relevante promovate în repo.
- Stări distincte: conform, neconform, neconcludent. Ultimele două nu apar ca audit verde. Raportul nu extrapolează acoperirea dincolo de inventarul/serviciile validate.
- Baseline inițial numai cu perechi exacte, motiv și expirare; nu „maximum 60 probleme”. Problemele noi nu sunt mascate de dispariția celor vechi. Nu reînnoim automat excepțiile.

Separăm **schimbarea normală a rețelei** de **regresia codului**: o linie nouă complet descrisă de sursă și inclusă în candidat este o actualizare de date validă. O relație din sursă pierdută în candidat, un tip necunoscut sau o contradicție cu dovezile live este o eroare. Diferența față de catalogul deja publicat este raportată pentru actualizare, nu confundată automat cu eșecul generatorului.

Dovezile au interval de valabilitate: fixture istorice verifică fidelitatea decoderului/generatorului pentru acea captură, nu impun o apartenență eternă. Numai contradicțiile din capturi contemporane, într-o fereastră explicită de prospețime, pot bloca o actualizare a topologiei. O dovadă veche sau colectată în timpul unei schimbări cere reverificare, nu păstrarea permanentă a unei opriri retrase.

Un test bazat pe sosiri nu poate promite descoperirea unui stopId care nu apare în nicio sursă de inventar. Această limită trebuie declarată, nu ascunsă printr-un procent aparent de 100%.

### 8. Publicare și operare fără regresii de disponibilitate

Fișiere principale: `.github/workflows/deploy.yml`, workflowul de audit, `docs/architecture.md`.

Pipelineul actual sare toate verificările când `stations.json` derivat din GTFS rămâne identic. Noua achiziție/audit nu depinde de acea condiție. Verificarea conținutului schimbat se face după construirea catalogului compus STB/GTFS.

Jobul de audit are concurență separată față de Pages, `cancel-in-progress:false` și un buget de execuție configurat după măsurarea primei colectări integrale. Runtime estimat din inventar și timpi reali, nu din presupunerea că toate cererile răspund instantaneu. Pipelineurile partajează colectorul și artifacts, nu dublează logica de autentificare/decodare.

Publicăm numai candidatul validat: check, teste, build, apoi exact artifactul testat. Actualizarea făcută cu GITHUB_TOKEN nu declanșează automat alt workflow; păstrăm deployul explicit al aceluiași artifact validat. Nu regenerăm datele între test și publicare.

La căderea STB/GTFS, actualizarea datelor se oprește și aplicația păstrează ultimul catalog valid. PR-urile și deployurile de bugfix folosind catalogul existent nu sunt blocate de acea indisponibilitate externă. În schimb, auditul rămâne neconcludent și nu actualizează data ultimei verificări reușite.

Rollback: revenire la ultimul snapshot versionat și la adaptorul compatibil; cache-ul PWA primește versiunea artifactului. Păstrăm manifestele și fixture pentru diagnostic.

## Ordine recomandată de livrare

1. Contract sursă + fixture reale + normalizare: rezolvă riscul de fundament și bugul sigur pentru troleibuze.
2. Colector + audit complet, inițial numai observare; stabilește acoperirea și diferențele fără a publica date.
3. Generator bazat pe topologie + migrare la lineId + teste exhaustive; comparare în paralel cu vechiul catalog înainte de activare.
4. Publicare automată protejată și auditul recurent; activare numai după primul audit complet și tratarea discrepanțelor.

## Criterii de acceptare

- Fiecare linie/sens/variantă și stație din inventarul declarat are rezultat explicit; necunoscutele nu dispar din denominator.
- Cazurile live confirmate nu mai sunt ascunse: 66, N109/640–Isovolta, 47–Piața Unirii și liniile descoperite ulterior.
- Un tip nou sau o identitate ambiguă provoacă eșec diagnosticabil; o linie nouă validă poate fi preluată fără patch manual.
- Datele actualizate schimbă conținutul semantic; timestampurile singure nu declanșează deploy.
- Nici eroarea upstream, nici un răspuns gol nu șterg stații; nicio unire istorică nelimitată nu păstrează automat relații expirate.
- Testele PR detectează defecte de implementare fără rețea; auditul live detectează deriva sursei independent de refreshul GTFS.
- Aplicația rămâne statică, funcționează offline cu ultimul catalog valid și nu adaugă trafic de descoperire per utilizator.
