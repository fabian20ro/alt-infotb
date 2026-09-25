# Inventar istoric: implementare și pașii următori

Data: 2026-09-25. Continuarea planului de catalog, după integrarea PR #45.

## Livrat

- Baza include actualizările utilizatorului: devalue 5.9.2 și nanoid 3.3.19.
- Inventar separat de catalogul runtime: ID-uri, etichete istorice, prima/ultima observație, prezență în registru și calitatea topologiei. Starea operațională rămâne necunoscută fără dovezi suplimentare.
- Capturi legate prin hashuri de snapshot/audit/discovery; scope, acoperire, direcții și timestampurile răspunsurilor păstrate. Replay idempotent; datele din cache nu devin artificial proaspete.
- Descoperire iterativă: serviciu observat → detaliu/ambele sensuri → stații noi → servicii noi. Limite de runde, servicii, stații și timp. Registrele, identitățile și coordonatele contradictorii rămân neconcludente.
- Istoric durabil pe `data/service-inventory`, independent de publicarea catalogului. Salvare atomică, istoric append-only validat și protecție împotriva scrierilor concurente. Eșecurile de autentificare/rețea nu resetează istoricul.
- Workflow-ul salvează dovezile valide chiar dacă auditul e neconcludent, apoi eșuează explicit. Publicarea automată rămâne oprită; registry-only și auditul complet sunt distincte în istoric.
- Promovarea proxy-ului pregătită separat: [shared-api-host PR #2](https://github.com/fabian20ro/shared-api-host/pull/2), pin exact la codul integrat; build izolat pentru STB, verificat fără deploy.

## Dovezi și limite

Replay din răspunsurile brute păstrate pentru 3.980 ID-uri: 3.936 verificate, 44 neconcludente; inventarul conține 206 identități (203 listate + 907/909/1036). ID-urile suplimentare apar la 1/1/29 stații. Acesta este replay istoric, nu o nouă captură live și nu dovadă că N700 circulă acum.

Scenariile automate acoperă servicii absente/reapărute, ID nou cu aceeași etichetă, descoperire prin stații regionale, surse incomplete, schimbări în timpul scanării, limite, proveniență și concurență Git. Numerele finale și verificările browserului sunt în descrierea PR-ului și jurnalul iterației.

## Restanțe și probleme descoperite

1. **Promovarea efectivă Cloudflare:** `/lines` răspunde încă 404. OAuth local expirat; control-plane fără token de deploy. Actualizarea e pregătită și verificată, dar necesită autentificare. Nu s-au schimbat secrete.
2. **Buildul control-plane depindea de alt proiect indisponibil:** corectat în PR-ul privat prin selectarea modulului pentru Cloudflare/Vercel. Render păstrează buildul compus; disponibilitatea celuilalt proiect rămâne problema acelui sistem.
3. **Testele modulului proxy izolat căutau configurația Svelte a aplicației:** adăugat tsconfig pentru teste, independent de frontend.
4. **Proveniență registru instabil:** proba finală suprascrie dovada inițială. Inventarul exclude etichetele registrului când cele două probe diferă; observațiile pozitive independente rămân păstrate.
5. **N700, ID-urile 907/909 și 14 ID-uri GTFS:** încă neelucidate operațional. Inventarul permite comparații în timp, fără aliasuri sau ștergeri presupuse.
6. **Topologia descoperită nu este încă publicată pe hartă.** Este dovadă separată; promovarea ei cere contract explicit și verificări pentru favorită/platformă/serviciu.
7. **Istoric fără compactare:** păstrează toate capturile. Înaintea unei arhivări trebuie definite retenția dovezilor și păstrarea tranzițiilor; fără tăiere implicită.
8. **Verificări concurente:** Vitest poate regenera fișierele Svelte și reîncărca browserul, pierzând selecția în test. Cauză reprodusă; verificările browser se rulează separat, fără schimbare în aplicație.
9. **Fallback GTFS regional și calendare:** filtrarea veche a fallbackului și integrarea calendarelor rămân separate de datele STB deja nefiltrate geografic.

## Recomandarea următoare

Prioritate operațională: integrarea PR-urilor, autentificare Cloudflare, deploy doar al modulului STB și probe live pentru registru, detaliu, ambele sensuri și sosiri. Apoi audit complet `publish=false` și încă o captură independentă; un rezultat neconcludent păstrează dovezile și catalogul anterior.

Prioritate arhitecturală: **contract explicit între dovezi și catalogul publicabil**. Separăm inventarul listat de serviciile cu topologie verificată și identitatea afișată. Un adaptor comun rezolvă platformele/stațiile fizice; relațiile de înlocuire între servicii includ sursă și perioadă de valabilitate. Calendarul și starea operațională sunt dimensiuni independente de calitatea topologiei.

Înainte de activarea publicării: teste pentru servicii descoperite complet dar nelistate, reînființări cu ID nou, dovezi contradictorii, favorite păstrate, calendare de eveniment și expirarea excepțiilor exacte. Nu activăm publicarea doar fiindcă istoricul poate salva o scanare neconcludentă.
