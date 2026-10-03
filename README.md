# Pénzügyek — CIB folyószámla-könyvelő

Webes alkalmazás, amely a CIB `tranzakciok.xls` kivonatot beimportálja,
automatikusan (és kézzel is) kategorizálja a tételeket (bevétel / kiadás /
megtakarítás) többszintű attribútum-fával, és diagramokon mutatja a
kiadások fő attribútum szerinti megoszlását.

Az alkalmazás **AWS-en, szerver nélkül** fut, kizárólag AWS Free Tier
szolgáltatásokkal, és a teljes infrastruktúrát **és** az alkalmazás
telepítését **Terraform** kezeli. Fejlesztéshez helyben, Docker Compose-zal
is futtatható.

## Architektúra (AWS)

```
                                   ┌─ /*      ──OAC──▶ Amazon S3 (privát bucket)
 Böngésző ──HTTPS──▶ CloudFront ───┤                   React + Radix UI felület, config.json
                                   └─ /api/*  ──OAC──▶ Lambda Function URL (AWS_IAM)
                                                         └▶ AWS Lambda (Python 3.13, arm64 — Flask REST API)
                                                              │  IAM auth token, TLS
                                                              ▼
                                                         Amazon Aurora DSQL (szerver nélküli, PostgreSQL-kompatibilis)
```

| Réteg | Szolgáltatás | Free Tier |
|---|---|---|
| Statikus tartalom | **Amazon S3** privát bucket (`frontend/dist` + `config.json`) | 5 GB, 20 000 GET / 2 000 PUT havonta¹ |
| HTTPS belépési pont | **Amazon CloudFront** — felület és API egy címen (alapértelmezett `*.cloudfront.net` tanúsítvány) | mindig ingyenes: 1 TB adatforgalom és 10 millió kérés havonta |
| Dinamikus réteg | **AWS Lambda** + **Function URL** (nem nyilvános, csak a CloudFront hívhatja; nincs API Gateway) | mindig ingyenes: 1 millió kérés és 400 000 GB-mp havonta |
| Adatbázis | **Amazon Aurora DSQL** | mindig ingyenes: 100 000 DPU és 1 GB tárhely havonta |
| Naplók | **CloudWatch Logs** (14 napos megőrzés) | mindig ingyenes: 5 GB havonta |
| Jogosultság | **IAM** szerepkör és policy-k | díjmentes |

¹ Az S3 a 2025. július 15. előtt nyitott fiókoknál 12 hónapig ingyenes; az
újabb fiókok Free Tier kreditet kapnak, amiből ez a néhány MB-os,
alacsony forgalmú tárolás fillérekbe kerül (a CloudFront gyorsítótára
miatt az S3-hoz alig jut kérés). Szándékosan **nincs** VPC, NAT Gateway
vagy API Gateway, így nincs óradíjas erőforrás.

**Hogyan működik:**

- A felület egy statikus React build, amit a CloudFront HTTPS-en szolgál ki
  (HTTP → HTTPS átirányítás, tömörítés, HTTP/3, AWS által kezelt
  biztonsági fejlécek: HSTS, X-Frame-Options, X-Content-Type-Options…). A
  bucket teljesen privát; csak a CloudFront olvashatja Origin Access
  Controllal. A hash-elt assetek egy évig, az `index.html` és a
  `config.json` csak 1 másodpercig gyorsítótárazódik, így telepítés után
  nincs szükség cache-érvénytelenítésre.
- Az API ugyanazon a CloudFront címen, az `/api/*` útvonalon érhető el
  (gyorsítótár nélkül), így **nincs szükség CORS-ra**. A Lambda Function
  URL `AWS_IAM` hitelesítésű, és csak ez a CloudFront disztribúció hívhatja
  (Origin Access Control, SigV4 aláírás) — közvetlenül az internetről nem
  érhető el. A Flask alkalmazás egy beépített WSGI adapterrel fut
  (`app/lambda_handler.py`).
- Az OAC miatt a törzzsel rendelkező kéréseknél (POST/PATCH/DELETE) a
  böngésző kiszámolja a törzs SHA-256 hash-ét és az `x-amz-content-sha256`
  fejlécben küldi (a fájlfeltöltés multipart törzsét ezért a frontend maga
  állítja össze) — ezt a `frontend/src/lib/api.ts` kezeli.
- **Hitelesítés:** minden `/api` kérésnek a Terraform által generált
  **hozzáférési kulcsot** kell küldenie az `X-Access-Key` fejlécben (az
  `Authorization` fejlécet a CloudFront aláírása foglalja). A felület
  belépéskor kéri.
- A Lambda a DSQL-hez a saját IAM szerepkörével, rövid életű auth tokennel
  és TLS-sel csatlakozik — nincs tárolt adatbázis-jelszó.
- Az adatbázis-sémát a Terraform hozza létre / frissíti telepítéskor (a
  Lambda `migrate` műveletét hívja meg, `aws_lambda_invocation`).

## Telepítés AWS-re

**Előfeltételek:** [Terraform](https://developer.hashicorp.com/terraform/install)
≥ 1.6, Node.js 22, Python 3 + pip, AWS hitelesítő adatok (pl. `aws configure`
vagy `AWS_PROFILE`), olyan régió, ahol az Aurora DSQL elérhető
(alapértelmezés: `eu-central-1`, Frankfurt).

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars   # opcionális, régió/név
make deploy
```

A `make deploy` lépései: frontend build (`npm ci && npm run build`), Lambda
csomag (`scripts/build_lambda.sh` — a függőségeket a Lambda arm64
környezetére tölti le, Docker nélkül), majd `terraform init` és
`terraform apply`. A végén kiírja a weboldal címét
(`https://….cloudfront.net`; az első telepítésnél a CloudFront
disztribúció kiépülése néhány percig tart). A belépéshez szükséges
kulcs:

```bash
terraform -chdir=infra output -raw access_key
```

**Frissítés:** kódváltozás után ugyanúgy `make deploy` — a Terraform csak a
megváltozott fájlokat tölti fel az S3-ba, és csak akkor telepíti újra a
Lambdát, ha a csomag tartalma változott.

**Megjegyzések:**

- A Terraform állapot (`infra/terraform.tfstate`) helyben tárolódik, és
  **titkot tartalmaz** (a hozzáférési kulcsot) — ne kerüljön gitbe (a
  `.gitignore` kizárja). Több gépről történő kezeléshez érdemes S3
  backendet beállítani a `infra/versions.tf`-ben.
- Az első `terraform init` után keletkező `infra/.terraform.lock.hcl`
  fájlt érdemes commitolni.
- **Kulcscsere:** `terraform -chdir=infra apply -replace=random_password.access_key`.
- Saját domainhez a CloudFront disztribúcióhoz egy ACM tanúsítvány
  (us-east-1 régióban, díjmentes) és `aliases` adható.

### Adatátköltöztetés a korábbi (SQLite-os) verzióból

```bash
# a régi Docker Compose-os verzióból (még a régi kóddal futó konténerből):
docker compose cp app:/data/penzugyek.db ./penzugyek.db

pip install -r app/requirements.txt
cd app
DSQL_ENDPOINT=$(terraform -chdir=../infra output -raw dsql_endpoint) \
  python import_sqlite.py ../penzugyek.db
```

A szkript a törölt (inaktív) tételeket is átviszi, hogy a duplikátum-védelem
megmaradjon; a már meglévő tételeket kihagyja, így többször is futtatható.

### AWS erőforrások törlése

Az adatbázison alapértelmezésben törlésvédelem van. Törléshez:

```bash
terraform -chdir=infra apply -var dsql_deletion_protection=false
make destroy
```

## Helyi futtatás (fejlesztés)

```bash
docker compose up --build
```

Az alkalmazás: **http://localhost:5000** — a Flask szerver itt a felületet
is kiszolgálja, az adatbázis egy helyi PostgreSQL konténer (az Aurora DSQL
helyi megfelelője, ugyanazzal a sémával). Helyben alapértelmezésben nincs
hozzáférési kulcs; a `docker-compose.yml`-ben az `ACCESS_KEY` változóval
bekapcsolható. Adatok törlése: `docker compose down -v`.

## Használat

1. Nyisd meg a weboldalt (AWS-en a `terraform output website_url` címe,
   helyben `http://localhost:5000`). AWS-en először a **hozzáférési
   kulcsot** kéri (`terraform -chdir=infra output -raw access_key`); a
   böngésző megjegyzi, a fejléc menüjében **Kijelentkezés** törli.
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
   - a feltöltött fájl nem kerül tárolásra, csak a beolvasott tételek.
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

## Fejlesztői megjegyzések

### Könyvtárszerkezet

| Útvonal | Tartalom |
|---|---|
| `frontend/` | React 19 + TypeScript + Vite felület (Radix Themes, Radix primitívek, Recharts) |
| `app/` | Python backend: `main.py` (Flask REST API), `lambda_handler.py` (Lambda belépési pont + WSGI adapter), `db.py` (kapcsolat + séma), `repository.py` (SQL), `excel_parser.py`, `categorize.py`, `import_sqlite.py` |
| `infra/` | Terraform: `s3.tf`, `cloudfront.tf`, `lambda.tf`, `dsql.tf`, `variables.tf`, `outputs.tf` |
| `scripts/build_lambda.sh` | Lambda csomag összeállítása (`build/lambda/`) |
| `Makefile` | `build`, `deploy`, `destroy`, `test` |

### Frontend (`frontend/`)

- UI: **Radix Themes** (`@radix-ui/themes`), a **Radix Toast** primitív
  (`radix-ui`), ikonok: `@radix-ui/react-icons`, diagramok: **Recharts**
  (külön chunkba töltve, csak az Elemzés fül megnyitásakor).
- Fejlesztés hot reloaddal: indítsd a backendet (`docker compose up`),
  majd `cd frontend && npm install && npm run dev` →
  http://localhost:5173 (az `/api` hívásokat a :5000-re proxyzza).
  A felhős API ellen is fejleszthetsz (a Vite proxyzza a hívásokat, CORS
  nem kell): `VITE_API_PROXY=$(terraform -chdir=../infra output -raw
  website_url) npm run dev`.
- Az API címe alapból az azonos origin (`/api`); felülírható a
  futásidejű `config.json`-nal vagy a build-idejű `VITE_API_BASE_URL`-lel.
  A hozzáférési kulcsot a böngésző `localStorage`-ban tárolja.
- A **checkbox-alapú kijelölés** kizárólag kliens oldali állapot
  (`excludedIds` Set az `App.tsx`-ben) — szándékosan nincs hozzá
  backend mező/végpont.

### Backend (`app/`)

- Flask + **psycopg 3**, sima SQL (nincs ORM), pandas nélküli Excel
  beolvasás (`xlrd` / `openpyxl`) — így kicsi a Lambda csomag.
- Az adatbázist környezeti változó választja ki: `DSQL_ENDPOINT` (Aurora
  DSQL, IAM token) vagy `DATABASE_URL` (PostgreSQL).
- **Aurora DSQL-hez igazított séma és lekérdezések:** UUID elsődleges
  kulcsok (nincs szekvencia), nincs idegen kulcs (a fa törlését az
  alkalmazás végzi), indexek `CREATE INDEX ASYNC`-kel, minden DDL külön
  tranzakcióban, az import legfeljebb 500 tételes tranzakciókban, és
  konkurencia-ütközésnél (SQLSTATE 40001) automatikus újrapróbálás.
- A `tx_hash` (dátum+típus+közlemény+összeg SHA-256, egyedi index)
  biztosítja, hogy ugyanazt a kivonatot többször feltöltve ne keletkezzen
  duplikátum — a fájlon belüli ismétlődéseket is kiszűri.
- **Törlés = soft delete** (`transactions.is_active`); minden listázó
  lekérdezés csak az aktív tételeket adja vissza, a duplikátum-ellenőrzés
  viszont a törölteket is figyelembe veszi.
- **Tesztek** (valódi PostgreSQL ellen, a Lambda adapterrel együtt):

  ```bash
  pip install -r app/requirements-dev.txt
  TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/penzugy_test make test
  ```
