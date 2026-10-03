# Pénzügyek — CIB folyószámla-könyvelő

Docker Compose-ban futó alkalmazás, amely a CIB `tranzakciok.xls` kivonatot
beimportálja, automatikusan (és kézzel is) kategorizálja a tételeket
(bevétel / kiadás / megtakarítás) többszintű attribútum-fával, és
diagramokon mutatja a kiadások fő attribútum szerinti megoszlását.

A felület egy [Radix UI](https://www.radix-ui.com/)-ra (Radix Themes +
Radix primitívek) épülő React alkalmazás (`frontend/`), ami statikus
fájlokká buildelődik — így a Flask szerveren kívül bármilyen statikus
tárhelyről (pl. később AWS S3-ról) is kiszolgálható.

## Összetevők

| Szolgáltatás | Mi ez | Port |
|---|---|---|
| `app` | Python (Flask) alkalmazás: XLS import, kategorizáló motor, REST API, valamint a lebuildelt React/Radix UI felület kiszolgálása | http://localhost:5000 |
| adatbázis | **SQLite**, egyetlen fájlban (`/data/penzugyek.db`), az `app` konténerben fut beágyazva, egy Docker volume-on | — |

## Indítás

```bash
docker compose up --build
```

Az alkalmazás: **http://localhost:5000**

## Használat

1. Nyisd meg az `http://localhost:5000` oldalt.
2. A jobb felső **Importálás** gombbal (üres adatbázisnál a középen
   megjelenő gombbal is) nyílik a feltöltő ablak: húzd bele a CIB
   `tranzakciok.xls` (vagy `.xlsx`) fájlt, vagy tallózd ki.
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
   - Az ablak az import végén kiírja, hány új tétel került be és hány
     létezett már.
3. **Kiadás** rekordoknál (negatív összeg) a rendszer a közlemény tartalma
   alapján automatikusan beállítja a fő attribútumot (és néhány esetben egy
   al-attribútumot is, pl. "Magyar Államkincstár" → gyerekek / babakötvény,
   "BudapestGO" → egyéb / tömegközlekedés). A keresés **nem
   case-sensitive**. **Bevétel** rekordoknál (pozitív összeg) automatikusan
   a "bevétel" fő attribútum kerül beállításra — ez utólag bármikor
   felülírható kézzel.
4. A **Tételek** fülön lévő táblázatban minden sornál:
   - a **Fő attribútum** mezőbe írva a rendszer **azonnal, mentés gomb
     nélkül** elmenti a változást (gépelés szüneténél vagy a mező
     elhagyásakor); a mezőben egy jelző mutatja a mentés állapotát
     (folyamatban / mentve / hiba), alatta pedig hogy a besorolás
     "automatikus" vagy "kézi". A mező a meglévő fő attribútumokat
     javasolja.
   - az **Al-attribútumok** oszlopban a `+` gombbal új címkét adhatsz
     hozzá; egy meglévő címkére kattintva felugró panelen **átnevezheted**,
     tetszőleges mélységű **al-al-attribútumot** fűzhetsz alá, vagy
     **törölheted** (megerősítés után, az alatta lévő egész ággal együtt).
     A gyermek-címkék `›` jellel a szülőjük után jelennek meg. Minden
     módosítás azonnal mentésre kerül.
   - a sor végén lévő **kuka** ikonnal bármelyik tétel törölhető, egy
     megerősítő ablak után (soft delete: megmarad az adatbázisban
     inaktívként, hogy egy újrafeltöltés ne hozza vissza).
   - a **Dátum** és **Összeg** oszlopfejlécre kattintva rendezhetsz; a
     táblázat lapozható (25 / 50 / 100 / összes sor oldalanként).
5. **Checkbox minden sor elején.** Alapesetben minden tétel ki van jelölve.
   Ha kiveszed a pipát egy tételről, az a tétel **kimarad** a fejléc-
   összesítőkből (Bevétel/Kiadás/Megtakarítás/Egyenleg) és a diagramokból is
   — de a táblázatban továbbra is látszik (elhalványítva), nem törlődik.
   A fejlécben lévő checkbox-szal az összes (szűrt) tétel egyszerre
   ki-/bejelölhető. A szűrősáv mellett egy jelvény mutatja, hány látható
   tétel nincs kijelölve. Ez a kijelölés csak a böngésző munkamenetében
   él, nem kerül mentésre az adatbázisba — oldal újratöltésekor minden
   tétel újra kijelöltként indul.
6. **Megtakarítás mint harmadik típus.** Bármelyik tétel fő attribútumaként
   beírható a `megtakarítás` szó (tetszőleges kis-/nagybetűvel) — ekkor a
   tétel se bevételként, se kiadásként nem számít, hanem külön
   "Megtakarítás" sorban összegződik, és az Egyenleget mindkét előjel esetén
   módosítja, csak a Bevétel/Kiadás összegekbe és a kiadás-diagramokba nem
   számít bele.
7. A **szűrősáv** (mindkét fülön látható) leszűkíti a listát, és ezzel
   együtt a fejléc-összesítőt és a diagramokat is:
   - **Keresés** — szabad szöveg a közleményben, a tranzakció típusában és
     az al-attribútum fában (tetszőleges mélységben). A `/` billentyűvel
     bárhonnan a keresőmezőre ugorhatsz, `Esc` törli.
   - **Dátumtól / Dátumig**, **Fő attribútum**, **Típus** (mind / bevétel /
     kiadás / megtakarítás). A szűrők kombinálhatók, a **"Szűrők törlése"**
     gomb visszaállítja a teljes listát.
8. **Elemzés fül** (közvetlen link: `/#elemzes`):
   - **Kiadások fő attribútum szerint** — vízszintes oszlopdiagram, a
     legnagyobb költésű fő attribútum felül, csökkenő sorrendben.
   - **Kiadások megoszlása** — fánkdiagram a 7 legnagyobb kategóriával
     (a többi "Egyéb" alá gyűjtve), mellette táblázatos jelmagyarázat
     összeggel és aránnyal. A kategóriák színe a teljes adathalmaz alapján
     rögzül, így szűréskor nem színeződnek át.
   - **Havi pénzmozgás** — havi bevétel és kiadás oszlopdiagramon.
   A diagramok **csak** a jelenlegi szűrésnek megfelelő és kijelölt
   tételek alapján számolnak, és minden változásra azonnal frissülnek.
9. **Megjelenés:** a fejlécben világos / sötét / rendszer szerinti téma
   választható (a böngésző megjegyzi).

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

### Frontend (`frontend/`)

- **React 19 + TypeScript + Vite**, UI: **Radix Themes** (`@radix-ui/themes`
  — Card, Table, Tabs, Dialog, AlertDialog, Popover, Select,
  SegmentedControl, DropdownMenu, Tooltip, Skeleton…), a **Radix Toast**
  primitív (`radix-ui`) az értesítésekhez, ikonok: `@radix-ui/react-icons`,
  diagramok: **Recharts** (külön chunkba töltve, csak az Elemzés fül
  megnyitásakor).
- Szerkezet: `src/lib/` (API kliens, típusok, szűrés/összesítés,
  formázás, paletta, hookok), `src/components/` (felület elemei),
  `src/App.tsx` (elrendezés, állapot).
- Helyi fejlesztés (hot reload): indítsd a backendet (`docker compose up`
  vagy helyben, lásd lent), majd:

  ```bash
  cd frontend
  npm install
  npm run dev        # http://localhost:5173, az /api hívásokat a :5000-re proxyzza
  ```

- Build: `npm run build` (típusellenőrzés + statikus build a
  `frontend/dist/` könyvtárba). A build **relatív útvonalakat** használ
  (`base: "./"`), így tetszőleges statikus tárhelyről működik.
- **API cím:** alapértelmezésben a felület ugyanarról az originről hívja az
  API-t, ahonnan kiszolgálták. Külön hosztolt frontendnél (pl. S3) a
  build előtt a `VITE_API_BASE_URL` környezeti változóban adható meg a
  backend címe (lásd `frontend/.env.example`). *(Ilyenkor a backendre
  CORS-beállítás is kell majd — ez az AWS-re költözés része, itt még
  nincs megvalósítva.)*
- A **checkbox-alapú kijelölés** kizárólag kliens oldali állapot
  (`excludedIds` Set az `App.tsx`-ben) — nincs hozzá backend
  mező/végpont, szándékosan: ez egy ideiglenes, munkamenet-szintű elemzési
  eszköz, nem tartós adatmódosítás.

### Backend (`app/`)

- Flask + SQLAlchemy, `models.py` (transactions, attributes —
  önhivatkozó fa-tábla tetszőleges mélységhez; a `Transaction.kind`
  property adja a bevétel/kiadás/megtakarítás besorolást az összeg előjele
  és a fő attribútum alapján), `excel_parser.py` (XLS/XLSX beolvasás — a
  teljes A11-től kezdődő tartalmat visszaadja, szűrés nélkül),
  `categorize.py` (kulcsszó-alapú automatikus kategorizálás), `main.py`
  (REST API + a lebuildelt felület kiszolgálása; itt történik a
  duplikátum-ellenőrzés `tx_hash` alapján).
- A Flask a felületet a `WEB_DIR` könyvtárból szolgálja ki (Docker-ben
  `/app/web`, ahová a multi-stage `app/Dockerfile` másolja a frontend
  buildet; helyben automatikusan a `frontend/dist`). Az `/api/...`
  végpontok változatlanok.
- Helyi futtatás Docker nélkül:

  ```bash
  (cd frontend && npm install && npm run build)
  pip install -r app/requirements.txt
  cd app && DATABASE_PATH=./data/penzugyek.db UPLOAD_DIR=./uploads python main.py
  ```

- A `tx_hash` (dátum+típus+közlemény+összeg SHA-256) biztosítja, hogy
  ugyanazt a kivonatot többször feltöltve ne keletkezzen duplikátum.
- **Törlés = soft delete.** A `transactions.is_active` mező jelzi, hogy egy
  tétel aktív-e; a törlés gomb ezt állítja `false`-ra, a rekord fizikailag
  megmarad. Minden listázó/összesítő API-lekérdezés `is_active = 1`-re szűr.
  Egy korábbi (a mezőt még nem ismerő) adatbázison az app indulásakor egy
  automatikus `ALTER TABLE` pótolja az oszlopot, adatvesztés nélkül.
