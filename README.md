# Pénzügyek — CIB folyószámla-könyvelő

Docker Compose-ban futó alkalmazás, amely a CIB `tranzakciok.xls` kivonatot
beimportálja, automatikusan (és kézzel is) kategorizálja a tételeket
(bevétel / kiadás / megtakarítás) többszintű attribútum-fával, és a
felületen, Chart.js-szel rajzolt diagramokon mutatja a kiadások fő
attribútum szerinti megoszlását.

## Összetevők

| Szolgáltatás | Mi ez | Port |
|---|---|---|
| `app` | Python (Flask) alkalmazás: XLS import, kategorizáló motor, web UI (táblázat + diagramok), REST API | http://localhost:5000 |
| adatbázis | **SQLite**, egyetlen fájlban (`/data/penzugyek.db`), az `app` konténerben fut beágyazva, egy Docker volume-on | — |

## Indítás

```bash
docker compose up --build
```

Az alkalmazás: **http://localhost:5000**

## Használat

1. Nyisd meg az `http://localhost:5000` oldalt.
2. Töltsd fel a CIB `tranzakciok.xls` (vagy `.xlsx`) fájlt.
   - A feldolgozó a **11. sortól (A11)** olvassa a tranzakciókat: A=dátum,
     B=típus, C=közlemény, D=összeg.
   - **Nincs semmilyen dátum/hónap szerinti szűrés** — a fájl A11-től kezdődő
     teljes tartalma bekerül az adatbázisba, pontosan ahogy a kivonatban
     szerepel.
   - Ismételt feltöltésnél a már betöltött rekordok (dátum+típus+közlemény+
     összeg alapján) automatikusan kimaradnak — nem lesz duplikátum. Ez teszi
     lehetővé, hogy egy korábbi (pl. részleges) feltöltés után egy később
     letöltött, bővebb/teljesebb kivonatot nyugodtan újra feltölts: csak a
     ténylegesen új tételek kerülnek be. Ez akkor is igaz, ha időközben
     töröltél egy tételt a felületen: egy törölt tétel **nem** kerül vissza
     az adatbázisba egy újrafeltöltéskor (lásd lent, "Tételek törlése").
3. **Kiadás** rekordoknál (negatív összeg) a rendszer a közlemény tartalma
   alapján automatikusan beállítja a fő attribútumot (és néhány esetben egy
   al-attribútumot is, pl. "Magyar Államkincstár" → gyerekek / babakötvény,
   "BudapestGO" → egyéb / tömegközlekedés). A keresés **nem
   case-sensitive**. **Bevétel** rekordoknál (pozitív összeg) automatikusan
   a "bevétel" fő attribútum kerül beállításra — ez utólag bármikor
   felülírható kézzel.
4. A táblázatban minden sornál:
   - a **Fő attribútum** mezőbe írva/módosítva a rendszer **azonnal, mentés
     gomb nélkül** elmenti a változást (a mező "kézi"-re vált),
   - az **Al-attribútumok** oszlopban `+ al-attribútum` gombbal új címkét
     adhatsz hozzá, egy meglévő címke `+` gombjával tetszőleges mélységű
     al-al-attribútumot fűzhetsz alá, a `×` gombbal törölheted (az adott
     csomópont alatti egész ágat) — minden módosítás azonnal mentésre kerül,
   - a sor végén lévő **🗑** gombbal bármelyik tétel törölhető (soft delete:
     megmarad az adatbázisban inaktívként, hogy egy újrafeltöltés ne hozza
     vissza).
5. **Checkbox minden sor elején.** Alapesetben minden tétel ki van pipálva.
   Ha kiveszed a pipát egy tételről, az a tétel **kimarad** a fejléc-
   összesítőkből (Bevétel/Kiadás/Megtakarítás/Egyenleg) és a diagramokból is
   — de a táblázatban továbbra is látszik (elhalványítva), nem törlődik.
   Hasznos pl. egy még nem végleges, vitatott vagy duplikációgyanús tétel
   ideiglenes kihagyásához a számításokból. Ez a kijelölés csak a böngésző
   munkamenetében él, nem kerül mentésre az adatbázisba — oldal
   újratöltésekor minden tétel újra bepipáltként indul.
6. **Megtakarítás mint harmadik típus.** Bármelyik tétel fő attribútumaként
   beírható a `megtakarítás` szó (tetszőleges kis-/nagybetűvel) — ekkor a
   tétel se bevételként, se kiadásként nem számít, hanem külön
   "Megtakarítás" sorban összegződik, és az Egyenleget mindkét előjel esetén
   módosítja, csak a Bevétel/Kiadás összegekbe és a kiadás-diagramokba nem
   számít bele.
7. A táblázat fölötti **szűrő sávban** bármikor leszűkítheted a listát (és
   ezzel együtt a fejléc-összesítőt és a diagramokat is):
   - **Dátumtól / Dátumig**, **Fő attribútum**, **Al-attribútum** (szabad
     szöveges keresés, tetszőleges mélységben), **Típus** (bevétel / kiadás
     / megtakarítás). A szűrők kombinálhatók, a **"Szűrők törlése"** gomb
     visszaállítja a teljes listát.
8. **Jobb oldali menüsáv.** Görgetéstől függetlenül mindig ugyanott, a képernyő
   jobb szélén látható egy fix sáv két gombbal:
   - **Kördiagram** — a kiadások megoszlása fő attribútum szerint,
   - **Oszlopdiagram** — vízszintes oszlopdiagram, a legnagyobb költésű fő
     attribútum felül, csökkenő sorrendben lefelé.
   Mindkét diagram Chart.js-szel készül, kategóriánként eltérő színnel, és
   **csak** a jelenlegi szűrésnek megfelelő és bepipált (kijelölt) tételek
   alapján számol. A diagramok a megnyitásukkor (és minden adatváltozáskor,
   ha éppen nyitva vannak) automatikusan frissülnek.

## Automatikus kategorizálási szabályok

A `app/categorize.py` fájlban van a teljes szabálylista (közlemény →
fő attribútum [, al-attribútum]). A szabályok csak az XLS-importnál, kiadás-
rekordokra futnak le automatikusan; a kategorizálás bármikor felülírható
kézzel az UI-n.

## Adatok törlése / friss kezdés

```bash
docker compose down -v   # a -v törli az SQLite adat-volume-ot is
```

## Fejlesztői megjegyzések

- Backend: Flask + SQLAlchemy, `models.py` (transactions, attributes —
  önhivatkozó fa-tábla tetszőleges mélységhez; a `Transaction.kind`
  property adja a bevétel/kiadás/megtakarítás besorolást az összeg előjele
  és a fő attribútum alapján), `excel_parser.py` (XLS/XLSX beolvasás — a
  teljes A11-től kezdődő tartalmat visszaadja, szűrés nélkül),
  `categorize.py` (kulcsszó-alapú automatikus kategorizálás), `main.py`
  (REST API + UI szerving; itt történik a duplikátum-ellenőrzés `tx_hash`
  alapján).
- Frontend: natív HTML/CSS/JS (nincs build lépés), `static/app.js` kezeli az
  azonnali mentést, a fa-szerkezetű al-attribútum szerkesztőt, a kliens
  oldali szűrést/kijelölést, és a Chart.js diagramokat (CDN-ről betöltve,
  `/static/style.css`-ben a `.sidebar` / `.chart-modal` osztályok alatt).
- A `tx_hash` (dátum+típus+közlemény+összeg SHA-256) biztosítja, hogy
  ugyanazt a kivonatot többször feltöltve ne keletkezzen duplikátum.
- **Törlés = soft delete.** A `transactions.is_active` mező jelzi, hogy egy
  tétel aktív-e; a törlés gomb ezt állítja `false`-ra, a rekord fizikailag
  megmarad. Minden listázó/összesítő API-lekérdezés `is_active = 1`-re szűr.
  Egy korábbi (a mezőt még nem ismerő) adatbázison az app indulásakor egy
  automatikus `ALTER TABLE` pótolja az oszlopot, adatvesztés nélkül.
- A **checkbox-alapú kijelölés** (bevétel/kiadás/megtakarítás számításba
  vétele) kizárólag kliens oldali állapot (`excludedIds` Set az
  `app.js`-ben) — nincs hozzá backend mező/végpont, szándékosan: ez egy
  ideiglenes, munkamenet-szintű elemzési eszköz, nem tartós adatmódosítás.
