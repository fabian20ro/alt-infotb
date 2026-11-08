# Curățarea sigură a shellurilor de preview

Continuarea PR #65, 2026-11-08. Exclusiv buildul local `offline-preview`;
fără deploy, servicii noi sau modificări ale dependențelor.

## Decizie

Fiecare document ține un Web Lock comun pe versiunea sa de shell până când
browserul distruge documentul. Nu eliberăm acest lock la ascundere, `pagehide`
sau demontarea unui component. Workerul poate verifica proprietarii lockurilor
chiar după repornirea propriului proces; nu deduce dispariția unui cititor din
expirarea unui heartbeat. Chromium-ul testat raportează ID-uri diferite prin
Web Locks și Service Worker, deși specificația le corelează. Un token aleator
per document identifică un al doilea lock ținut pe aceeași durată. Workerul leagă
expeditorul real al mesajului de acel lock și verifică faptul că el și cititorul
versiunii au același proprietar în API-ul Web Locks. Nu echivalăm cele două ID-uri.

Un registru mic, separat de datele hărții, reține numai shellurile create prin
noul protocol, legăturile cititorilor confirmate, identitatea shellului activ și navigările care încă nu și-au
confirmat cititorul. Cache-ul registrului are un nume distinct de precache-uri.
Instalarea, activarea, înregistrarea navigărilor și curățarea folosesc aceeași
poartă de coordonare. Instalarea Workbox este apelată explicit în interiorul ei.

Înainte de a livra HTML, workerul înregistrează versiunea și clientul navigării.
Aceasta închide intervalul în care pagina nu execută încă JavaScript și nu apare
în lista documentelor active. Confirmarea vine numai de la clientul real din
scope, după ce browserul îi acordă lockul corespunzător. O navigare rămasă în
coada unui worker vechi folosește identitatea activă din registru.

## Condiții pentru ștergere

- Shellul trebuie să fie înregistrat ca proprietate a noului protocol, cu numele
  exact al cache-ului și scope-ul potrivit.
- Shellul activ trebuie să fie complet. Instalarea sau așteptarea unei alte
  versiuni amână curățarea.
- Un client din scope fără o protecție recunoscută amână curățarea.
- Navigările neconfirmate și documentele care țin un lock păstrează versiunea.
- Ștergerea cere lock exclusiv pe versiunea candidat, fără a aștepta un cititor.
  Eșecul sau incertitudinea păstrează datele pentru o verificare ulterioară.
- OPFS, generațiile PMTiles, cache-urile raster, datele STB și favoritele nu fac
  parte din acest registru și nu intră în selecția pentru ștergere.

Curățarea este oportunistă, la verificarea shellului: pornire, revenire în prim
plan și verificarea din panou. Nu este necesar ca workerul să ruleze permanent.

## Alternative respinse

Un număr fix de versiuni păstrate poate elimina versiunea unui tab vechi încă
deschis. Un timeout de heartbeat confundă suspendarea cu închiderea. Doar
`clients.matchAll()` nu acoperă documentele care încă se încarcă și nu reprezintă
singur o dovadă suficientă pentru paginile suspendate. Ștergerea tuturor cache-urilor
cu un prefix comun nu stabilește că noul protocol le deține.

## Migrare și limite

Cache-urile create de PR #65 sau mai devreme nu sunt adoptate automat: acele
pagini nu țineau lockuri de shell. Rămân o bază fixă de stocare; acest pas oprește
acumularea normală a versiunilor noi după închiderea cititorilor lor, fără să
pretindă că toate cache-urile istorice au fost eliminate.

O navigare anulată înainte de confirmare poate lăsa o protecție conservatoare.
Nu o expirăm arbitrar: absența din lista clienților poate avea alte cauze decât
închiderea definitivă. Nu promitem o limită strictă de bytes cât timp există
taburi vechi, cache-uri anterioare protocolului sau navigări neconfirmate.

Registrul lipsă/corupt oprește colectarea. Dacă identitatea activă nu mai poate
fi citită sau protecția navigării nu poate fi scrisă (de exemplu, cotă epuizată),
workerul refuză noua navigare în loc să livreze o pagină neprotejată. Pagina deja
încărcată și pachetul rămân intacte. Recuperarea explicită a shellului fără
ștergerea pachetului este un gate suplimentar înainte de rollout, nu o garanție
implementată în acest preview.

Readiness include validitatea registrului și confirmarea cititorului. Un eșec
de colectare a unui cache vechi nu invalidează un shell activ sănătos. Dacă
activarea browserului reușește, dar commitul identității active este întrerupt,
workerul efectiv activ reconciliază registrul înainte de a confirma readiness
sau de a livra următoarea navigare.

Brave fizic și iOS rămân verificări separate. Distribuția publică fără risc de
facturare rămâne nealeasă; R2 nu este activat.

## Verificare

Teste unitare la granița protocolului: ordine/contendență a lockurilor, client
necunoscut, navigare înainte de bootstrap, instalare/activare concurentă,
registru invalid, shell activ incomplet, eșec parțial de ștergere și izolarea scope-ului.

Browser pe builduri reale: A → B cu tab A suspendat; import vechi offline după
repornirea workerului; colectarea lui A numai după închidere; candidat în așteptare;
bootstrap întârziat; rollback și pornire într-un proces nou. Pachetul instalat,
persistența și datele fără legătură trebuie să rămână intacte. Playwright: un worker.

Rezultate locale: 1.341 teste unitare, 8/8 teste browser (1,8 minute, un worker),
verificări de tipuri și build normal izolat. Cu BFCache permis explicit, Chromium
nu a restaurat documentul nici înainte, nici după update; revenirea offline a
încărcat corect B. Restaurarea efectivă din BFCache rămâne neobservată. Testul cu
document suspendat și repornirea workerului a trecut separat.
Pixel 6a / Chrome 156: actualizare A → B prin UI; A păstrat cu tab vechi deschis,
apoi șters după închiderea lui. Pornire PWA după oprirea serverului și a procesului
Chrome: hartă offline funcțională, aceeași generație PMTiles, persistență acordată.
Stocare totală după colectare: aproximativ 75,1 MB, inclusiv patru shelluri istorice
păstrate. Aceasta este o măsurătoare a originii de test, nu o limită garantată.

## Recomandarea următoare

Stabilirea distribuției publice fără facturare și a catalogului de încredere,
separat de activarea în producție. Înainte de rollout: verificare Brave și politică
explicită de migrare a cache-urilor anterioare protocolului. Recuperarea automată
a navigărilor neconfirmate cere o dovadă de închidere, nu un simplu timeout.
Adăugăm și o cale verificată de recuperare a registrului/shellului, care să păstreze
pachetul PMTiles și să nu transforme cache-uri necunoscute în ținte de ștergere.

## Referințe

- [Web Locks](https://www.w3.org/TR/web-locks/) — identitatea clientului și
  eliberarea lockurilor la distrugerea documentului.
- [Service Worker clients](https://www.w3.org/TR/service-workers/#clients-matchall)
  și [navigări](https://www.w3.org/TR/service-workers/#dom-fetchevent-resultingclientid).
- [Workbox precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)
  — controlul explicit al instalării și activării.
