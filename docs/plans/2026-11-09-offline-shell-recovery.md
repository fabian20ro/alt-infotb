# Recuperarea shellului și registrului offline

Preview local, continuarea PR #66 integrat în #65. Fără schimbări în producție,
servicii noi sau modificări ale dependențelor.

## Interfețe de testare confirmate

Utilizatorul a confirmat explicit, 2026-11-09:

1. Interfața publică de recuperare: rezultat, întreruperi, concurență și păstrarea pachetului.
2. Fluxul browser/PWA: pornire defectă → reparare → repornire offline, inclusiv Pixel Chrome.

Skill Matt Pocock TDD: câte un test comportamental care eșuează, apoi implementarea
minimă; fără teste ale funcțiilor private sau simularea colaboratorilor interni.
Simulările de eroare rămân la CacheStorage, rețea și lockurile browserului.

## Decizie

Workerul instalat conține o pagină autonomă de recuperare, fără dependență de
fișierele aplicației. O servește când pornirea protejată nu poate fi realizată și
la o adresă explicită accesibilă din panoul normal. Interfața RO/EN explică faptul
că se repară aplicația; pachetul PMTiles, favoritele și setările rămân intacte.

Manifestul compilat fixează hashul SHA-256 al fiecărui fișier al shellului.
Repararea verifică fișierele locale și descarcă numai fișierele lipsă/invalide,
acceptând exclusiv bytes ai aceleiași versiuni. HTML-ul unei versiuni mai noi nu
poate fi etichetat ca versiune veche. Fișierele verificate se refolosesc la retry;
nu ștergem shellul înainte de redescărcare.

Repararea deține lockul exclusiv de tranziție și un cititor al versiunii reparate.
Operațiile locale și commitul registrului folosesc poarta de lifecycle; rețeaua
nu ține această poartă. Identitatea workerului și eventualul înlocuitor sunt
reverificate înainte de scriere. Registrul se recitește înainte de commit pentru
păstrarea protecțiilor adăugate între timp.

Un registru valid își păstrează proprietatea, cititorii și navigările protejate.
Dacă registrul nu mai este de încredere, reconstruim numai identitatea verificată
a shellului compilat și îi adăugăm o protecție permanentă. Celelalte cache-uri
rămân în afara autorității de ștergere. Altfel am pierde dovada unei navigări care
încă nu și-a confirmat cititorul. Recuperarea nu este migrare sau colectare globală. Un worker înlocuit refuză să servească HTML-ul altui build, pentru care nu are hashuri de încredere; pagina autonomă trimite repararea către workerul activ.

## Pași TDD

1. Recuperare offline a metadatelor din shell complet; navigare posibilă după commit.
2. Fișiere lipsă/corupte: bytes verificați, versiune greșită respinsă, retry fără pierderi.
3. Cotă, întrerupere, concurență, worker înlocuit și protecții adăugate între timp.
4. Pagină autonomă: pornire cu registru defect, RO/EN, acțiune explicită, succes/retry.
5. Builduri reale A/B, pachet instalat, tab suspendat și proces repornit offline.
6. Pixel PWA: același pachet/persistență după reparare și pornire la rece fără server.

## Limite asumate

- Fișierele lipsă nu pot fi recreate offline; este necesară sursa versiunii exacte.
- Cota epuizată poate împiedica repararea; nu eliberăm spațiu prin ștergerea hărții.
- Workerul cu această funcție trebuie să fie deja instalat. Un worker vechi deja defect nu poate primi recuperarea retroactiv, offline; ștergerea datelor site-ului nu este reparabilă offline.
- Protecția adăugată după pierderea registrului rămâne conservatoare; fără TTL.
- Brave fizic și distribuția publică fără facturare rămân etape separate.

## Referințe

- [Workbox precaching și integrity](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)
- [Service Workers](https://www.w3.org/TR/service-workers/)

## Rezultate — 2026-11-09

- 1.356 teste unitare, inclusiv 42 pentru shell/recuperare; 0 erori/avertismente Svelte, worker și tooling verificate.
- 12 fluxuri browser seriale pe builduri reale A/B: instalare/actualizare/ștergere,
  cititori suspendați, proces întrerupt, recuperare registru, RO/EN și temă,
  fișiere lipsă, hash greșit, cotă simulată, retry offline, concurență și worker în așteptare.
- TDD: 8 cicluri red→green la API și 7 la browser; acoperirea suplimentară care
  trecea deja a fost păstrată ca regresie, fără a fi prezentată ca red→green.
- Pixel 6a, Chrome 156, PWA instalat: registru corupt reparat fără server în ~397 ms
  (o observație, nu benchmark); aceeași generație PMTiles și `persisted=true`.
  Fișier JS șters → mesaj de conectare fără succes fals → reparare din același build.
  Force-stop Chrome + PWA și pornire la rece cu server/adb reverse oprite:
  randare offline reușită, EN/light păstrate. Spațiu total origin ~75,02 MB,
  incluzând cache-uri istorice și pachetul existent; nu dimensiunea acestei funcții.
- Buildul normal exclude workerul/UI de recuperare. Nicio dependență schimbată,
  serviciu nou, încărcare R2 sau deploy în producție.

## Următorul pas recomandat

1. Contract de distribuție a versiunilor shellului: resurse imuabile, manifest cu
   hashuri, păstrarea unei surse exacte pentru recuperare și test A→B cu A indisponibil.
   Început local, apoi evaluare separată a unei distribuții gratuite; fără activare automată.
2. Separați catalogul de versiuni de adaptorul de distribuție. Recuperarea primește
   o sursă verificabilă a versiunii instalate, fără să ghicească bytes din versiunea curentă.
3. Restanțe: Brave pe telefon, compatibilitatea MIME a gazdei reale, procedura pentru
   worker vechi deja defect, cache-uri neatribuite și protecții permanente după pierderea
   registrului. Curățarea acestora cere dovadă nouă sau reset explicit; fără expirare arbitrară.
4. Păstrați o probă de upgrade/recuperare/pornire offline în CI pentru orice schimbare
   la worker, schema registrului sau manifestul de build. Producția rămâne o decizie separată.
