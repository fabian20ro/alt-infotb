# Catalogul STB: implementare, restanțe și recomandarea următoare

Data: 2026-09-25. Urmează planului inițial `2026-09-25-station-catalog-audit.md`.

## Implementat în această iterație

- Proxy comun dev/producție: căi de topologie validate, autentificare coordonată, timeout inclusiv corpul autentificării și anulare propagată.
- Decoder protobuf strict și normalizare CABLE_CAR → TROLLEYBUS, cu valoarea brută păstrată. Fixture reale la limita API.
- Colector serial, reluabil, cu buget, Retry-After, timeout, hashuri și invalidarea cache-ului la 04:00 Europe/Bucharest. Identitatea upstream este separată de transportul proxy.
- Catalog STB versionat, compus cu fallback GTFS independent. ID-uri STB pentru apartenență; identitățile markerilor existente păstrate. M5 și Tudor Arghezi mapate explicit la stațiile fizice existente. Limita geografică implicită eliminată pentru traseele suportate.
- Verificare exhaustivă prin încărcarea reală, matcher și filtrul hărții: 203 linii, 406 sensuri, 3.966 stații API, 3.911 markeri, 9.759 relații stație–linie–sens.
- Audit live al tuturor celor 3.980 de ID-uri cunoscute; JSON/Markdown cu acoperire, diferențe și răspunsuri neconcludente. Capturile istorice nu impun apartenența pentru totdeauna.
- Workflow separat de audit zilnic; audit complet săptămânal/manual. Publicare implementată, dar dezactivată implicit; necesită audit conform, date contemporane legate prin hashuri, confirmare independentă a ștergerilor și verificări ale aplicației. Deployul normal nu depinde de disponibilitatea STB.

Catalogul inclus în PR este revizuit pentru cele 203 de linii din registru. Nu afirmă că registrul STB descrie fiecare serviciu întâlnit la sosiri. Auditul live **nu este verde**; noul generator rezolvă N109/Isovolta și omisiunile liniilor descrise complet, iar diferențele de mai jos rămân explicit deschise. Publicarea recurentă nu este activată prin acest PR.

## Verificări efectuate

950 teste unitare, verificările TypeScript ale aplicației/scripturilor/proxy-ului și buildul de producție trec. Browser: 31 trecute, 5 omise intenționat după capabilitățile dispozitivului, fără retry și cu un worker. Gate-ul de publicare a fost încercat cu auditul real și refuză corect rezultatul neconcludent. Verificarea separată a scripturilor a descoperit erori de tip neacoperite de Svelte; au fost corectate și check-ul este acum în CI.

## Probleme descoperite și restanțe

| Prioritate | Problemă / dovadă | Tratament și criteriu de închidere |
| --- | --- | --- |
| P1 | N700, ID 1036, apare în sosirile a 29 de stații, dar lipsește din registru. | Toate cele trei endpointuri de detaliu/sens răspund HTTP 200 cu zero bytes. Nu inventăm traseul complet. Necesită sursă de topologie validă sau politică explicită de acoperire parțială; auditul semnalează fiecare pereche lipsă. |
| P1 | Stația 6207 returnează simultan 429 cu ID-urile 796/907 și 476 cu 798/909, pe sensuri diferite. | Detaliile pentru 907 și 909 sunt goale. Numele identic nu dovedește echivalența. Păstrăm identitățile brute; închiderea cere relație verificată între serviciu, variantă și linia afișată. |
| P1 | Proxy-ul public existent nu permite încă noile căi; `WORKER_DEPLOY_ENABLED=false`, fără secrete de deploy în repository. | Implementarea este verificată prin același handler local. Promovare separată a modulului/proxy-ului; validare live a căilor după promovare. Nu schimbăm secrete/variabile sau infrastructura în acest PR. |
| P2 | 14 stații numai-GTFS răspund gol și lipsesc din topologia STB. | Păstrate drept fallback explicit, fără ștergeri deduse din lipsa sosirilor. Clasificare prin dovadă independentă: retrase, suport indisponibil sau ID schimbat. ID-uri în raportul complet. |
| P2 | Auditul strict blochează orice publicare automată cât timp există aceste diferențe. | Comportament intenționat. Nu relaxăm pragurile global. Dacă se aprobă excepții, să fie perechi exacte, motiv, dovadă și expirare; nu baseline autoacceptat sau limită numerică. |
| P2 | Descoperirea actuală pornește din registrul STB + catalog + mapările platformelor. Un ID absent din toate acestea nu poate fi descoperit. | Extinderea descrisă mai jos; procentul raportat rămâne numai pentru inventarul declarat. |
| P3 | Actualizările GTFS rămân dependente de interpretarea existentă a tipurilor/ID-urilor și de filtrul regional al fallbackului. | STB nu mai este tăiat de acel filtru. Pentru servicii numai-GTFS: raport explicit al rândurilor excluse, calendare de serviciu și mapări namespaced înainte de extinderea acoperirii. |

Rezultat final al auditului: 3.980 ID-uri parcurse; 3.966 răspunsuri numite cu date, dintre care 30 conțin serviciile neînregistrate; 14 răspunsuri goale. Clasificarea strictă: 3.936 verificate fără incidente și 44 neconcludente. 31 apartenențe neconfirmate: 29 pentru N700 și câte una pentru ID-urile 907/909; nicio contradicție de sens pentru liniile din registrul colectat. Toate cele 20 de platforme M5 au răspuns cu date de linie.

## Recomandarea arhitecturală următoare

Separăm explicit trei identități: **stație fizică → platformă API → serviciu/variantă STB**. Deasupra serviciilor, o linie afișată poate grupa mai multe variante numai pe baza unei relații verificate. Numele și tipul sunt etichete, nu chei de identitate între surse.

Registrul de linii devine o sursă de inventar, iar răspunsurile stațiilor devin o a doua sursă de descoperire. Modelul păstrează distinct „listat în registru”, „observat la sosiri”, „topologie verificată” și „neclar”. Nu transformăm automat orice observație într-o linie completă sau într-o asociere permanentă.

### Planul următoarei iterații

1. **Promovarea proxy-ului verificat.** Actualizare controlată a implementării deployed/pinului din `shared-api-host`; probe pentru `/lines`, detaliu și ambele sensuri. Apoi prima execuție GitHub Actions de observare, cu publicarea încă oprită.
2. **Inventar cu descoperire iterativă, limitată.** Din audit colectăm ID-urile noi; cerem detalii și sensuri; adăugăm numai stațiile cu identitate/coordonate valide; audităm noile stații; repetăm până nu apar ID-uri noi. Număr maxim de runde și buget global. Lipsa convergenței sau un endpoint gol produce rezultat neconcludent, nu succes.
3. **Rezolvarea celor trei servicii neînregistrate.** Probe la date diferite și comparație cu sursele oficiale de traseu. Dacă API-ul rămâne inconsistent, alegere explicită: suport parțial cu proveniență și expirare sau excludere documentată din acoperirea garantată. Fără aliasuri bazate doar pe nume.
4. **Separarea adaptoarelor de identitate.** Mapările metroului și viitoarele variante de suprafață într-un modul de identitate verificabil, consumat de generator, auditor și aplicație. Detectarea coliziunilor și migrări pentru favorite testate independent.
5. **Politică de publicare pe acoperire declarată.** Definim serviciile garantate și excepțiile exacte, rezolvăm cele 14 ID-uri GTFS, apoi executăm două capturi complete și auditul integral. Activăm `STB_CATALOG_PUBLISH_ENABLED` numai după trecerea gate-ului; păstrăm protecția contra ștergerilor și rollbackul versionat.

Verificări obligatorii: nou ID de serviciu cu același nume, variantă nouă cu stație nouă, detaliu gol, sens lipsă, ID canonic diferit de cel cerut, descoperire fără convergență, modificare în timpul scanării, expirarea excepțiilor, indisponibilitate upstream și limita de zi la 04:00 inclusiv schimbarea orei.

## Operare și rollback

Comenzi și activare: `docs/deployment.md`. Dovezi: `docs/station-membership-full-audit-2026-09-25.md` și `catalog/audit-findings-2026-09-25.json` (extras cu incidente, nu raport complet de publicare). Datele brute complete rămân local în directorul de audit și în artifacts pentru execuțiile CI viitoare.

Rollbackul revine atomic la perechea snapshot/catalog compatibilă. O cădere STB nu înlocuiește catalogul existent; timestampurile singure nu provoacă deploy. PR-urile obișnuite folosesc datele versionate și nu așteaptă rețeaua STB.
