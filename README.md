# Pénzügyek — CIB folyószámla-könyvelő

Webes alkalmazás, amely a CIB `tranzakciok.xls` kivonatot beimportálja,
automatikusan (és kézzel is) kategorizálja a tételeket (bevétel / kiadás /
megtakarítás) többszintű attribútum-fával, és diagramokon mutatja a
kiadások fő attribútum szerinti megoszlását.

**Többfelhasználós:** a belépés Google-fiókkal történik (Amazon Cognito), és
csak az engedélyezett címek léphetnek be (alapértelmezés:
`hundjmada@gmail.com`, `dferenczi@gmail.com`). Minden felhasználó a saját
tételeit látja és kezeli; belépés nélkül az alkalmazás egyetlen oldala sem
érhető el.

Az alkalmazás **AWS-en, szerver nélkül** fut, kizárólag AWS Free Tier
szolgáltatásokkal, és a teljes infrastruktúrát **és** az alkalmazás
telepítését **Terraform** kezeli. Fejlesztéshez helyben, Docker Compose-zal
is futtatható.

## Architektúra (AWS)

```
                                   ┌─ /*      ─[CloudFront Function: munkamenet-ellenőrzés]─OAC─▶ Amazon S3 (privát bucket)
 Böngésző ──HTTPS──▶ CloudFront ───┤                                                            React + Radix UI felület
                                   └─ /api/*  ──OAC──▶ Lambda Function URL (AWS_IAM)
                                                         └▶ AWS Lambda (Python 3.13, arm64 — Flask REST API)
                                                              │  IAM auth token, TLS          │ belépés (OAuth 2.0 + PKCE)
                                                              ▼                               ▼
                                                         Amazon Aurora DSQL          Amazon Cognito ──▶ Google
                                                                                     (+ pre sign-up Lambda: engedélyezett címek)
```

| Réteg | Szolgáltatás | Free Tier |
|---|---|---|
| Statikus tartalom | **Amazon S3** privát bucket (`frontend/dist` + `config.json`) | 5 GB, 20 000 GET / 2 000 PUT havonta¹ |
| HTTPS belépési pont | **Amazon CloudFront** — felület és API egy címen (alapértelmezett `*.cloudfront.net` tanúsítvány) | mindig ingyenes: 1 TB adatforgalom és 10 millió kérés havonta |
| Belépés | **Amazon Cognito** (Google social login) + pre sign-up **Lambda** trigger | mindig ingyenes: 10 000 aktív felhasználó (MAU) havonta |
| Belépés-kapu | **CloudFront Functions** (munkamenet-süti ellenőrzése) | mindig ingyenes: 2 millió hívás havonta |
| Konfiguráció | **SSM Parameter Store** (standard paraméterek: Cognito kliens adatai) | díjmentes |
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
- **Belépés (Cognito + Google):** érvényes munkamenet nélkül a CloudFront
  Function a felület egyetlen fájlját sem adja ki, hanem a belépéshez
  irányít; az API pedig 401-et ad. A belépést a Lambda vezérli (OAuth 2.0
  authorization code + PKCE, bizalmas kliens): a Cognito a Google-höz
  irányít, a visszatérő kódot a Lambda cseréli tokenre, ellenőrzi az ID
  token állításait és az engedélyezett címek listáját, majd egy aláírt,
  `HttpOnly`/`Secure`/`SameSite=Lax` munkamenet-sütit állít ki (alapból 8
  órás). A böngésző JavaScriptje tokent nem lát. A módosító kérések
  ezen felül egyedi fejlécet is igényelnek (CSRF védelem).
- **Engedélyezett címek, három szinten:** a Cognito *pre sign-up* trigger
  már a felhasználó létrehozását elutasítja, a belépési callback újra
  ellenőriz, és minden API-kérés is (így egy cím törlése a listából a
  következő telepítéskor azonnal hatályos).
- **Adatok szétválasztása:** minden tétel a tulajdonosa e-mail címéhez
  tartozik; minden lekérdezés és módosítás a bejelentkezett felhasználóra
  szűkít. Ugyanazt a kivonatot két felhasználó egymástól függetlenül is
  feltöltheti. A korábbi (egyfelhasználós) tételeket telepítéskor a
  `legacy_data_owner` (alapból `hundjmada@gmail.com`) kapja meg.
- A Lambda a DSQL-hez a saját IAM szerepkörével, rövid életű auth tokennel
  és TLS-sel csatlakozik — nincs tárolt adatbázis-jelszó.
- Az adatbázis-sémát a Terraform hozza létre / frissíti telepítéskor (a
  Lambda `migrate` műveletét hívja meg, `aws_lambda_invocation`).

## Telepítés AWS-re

**Előfeltételek:** [Terraform](https://developer.hashicorp.com/terraform/install)
≥ 1.6, Node.js 22, Python 3 + pip, AWS hitelesítő adatok (pl. `aws configure`
vagy `AWS_PROFILE`), olyan régió, ahol az Aurora DSQL elérhető
(alapértelmezés: `eu-central-1`, Frankfurt), és egy Google-fiók a Google
Cloud Console-hoz.

### Belépés (Cognito + Google): mi automatikus, mi kézi?

| Ki / hol | Mit kell tenni | Milyen gyakran |
|---|---|---|
| **Terraform** (`make deploy`) | Mindent az AWS-ben: Cognito user pool, belépési domain, Google mint identity provider, app kliens (client secret-tel), *pre sign-up* Lambda az engedélyezett címekkel, a kliens adatai az SSM-ben, a callback/logout címek a CloudFront címére állítva | minden telepítéskor, magától |
| **Te, AWS-ben** | Csak egy AWS fiók és helyi hitelesítő adatok (`aws configure` / `AWS_PROFILE`). Az AWS konzolban Cognitóhoz **semmit nem kell kattintani**. | egyszer |
| **Te, Google Cloud Console-ban** | OAuth consent screen + *Web application* OAuth kliens a Cognito címeivel, Test users felvétele (lásd 2. lépés). A kapott Client ID/secret a `terraform.tfvars`-ba kerül. | egyszer (új felhasználónál: Test user felvétele) |
| **Végfelhasználók** | **Semmit.** Megnyitják a weboldalt és belépnek a Google-fiókjukkal. Az első belépéskor a Google egy hozzájárulási képernyőt mutat (*Testing* állapotban „Google hasn't verified this app” figyelmeztetéssel is — *Continue*). AWS fiók, regisztráció, jelszó nem kell. | — |

Mivel a Cognito címét a választott domain előtag határozza meg, a Google
kliens a telepítés **előtt** beállítható; nincs „először telepíts, aztán
állítsd be” sorrend. Új felhasználó felvétele: e-mail cím az
`allowed_emails`-be + `make deploy`, és (*Testing* állapotban) Test userként
a Google consent screenen. Aki nincs mindkét listán, azt a Google vagy a
Cognito elutasítja.

**1. Cognito domain előtag kiválasztása.** Régiónként globálisan egyedi
legyen, pl. `penzugyek-hundjmada`. Ebből adódik a Cognito belépési címe:
`https://penzugyek-hundjmada.auth.eu-central-1.amazoncognito.com`.

**2. Google OAuth kliens létrehozása** ([Google Cloud Console](https://console.cloud.google.com/)):

1. Hozz létre (vagy válassz) egy projektet.
2. *APIs & Services → OAuth consent screen*: típus **External**,
   alkalmazásnév pl. „Pénzügyek”, scope-ok: `openid`, `email`, `profile`.
   Tesztelési (*Testing*) állapotban add hozzá a két fiókot
   (`hundjmada@gmail.com`, `dferenczi@gmail.com`) **Test users**-ként —
   így publikálás nélkül is működik.
3. *APIs & Services → Credentials → Create credentials → OAuth client ID*,
   típus **Web application**:
   - **Authorized JavaScript origins:** `https://<előtag>.auth.<régió>.amazoncognito.com`
   - **Authorized redirect URIs:** `https://<előtag>.auth.<régió>.amazoncognito.com/oauth2/idpresponse`
4. Jegyezd fel a **Client ID**-t és a **Client secret**-et.

**3. Konfiguráció és telepítés:**

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# töltsd ki: cognito_domain_prefix, google_client_id, google_client_secret
make deploy
```

**Windowson** a `make` opcionális (pl. `winget install ezwinports.make`). Nélküle
PowerShellből ugyanez:

```powershell
$env:AWS_PROFILE = "penzugyek"
cd frontend; npm ci; npm run build; cd ..
python scripts\build_lambda.py
terraform -chdir=infra init
terraform -chdir=infra apply
```

A `make deploy` lépései: frontend build (`npm ci && npm run build`), Lambda
csomag (`python scripts/build_lambda.py` — a függőségeket a Lambda arm64
környezetére tölti le, Docker nélkül), majd `terraform init` és
`terraform apply`. A végén kiírja a weboldal címét
(`https://….cloudfront.net`; az első telepítésnél a CloudFront
disztribúció kiépülése néhány percig tart). Megnyitva a Google
belépési oldalára irányít; csak az engedélyezett fiókokkal lehet belépni.
A Google OAuth kliensnél beállítandó címeket a Terraform is kiírja
(`google_oauth_redirect_uri`, `google_oauth_javascript_origin`).

**Felhasználók módosítása:** az `allowed_emails` változó
(`terraform.tfvars`), majd `make deploy`. Ha a Google consent screen
*Testing* állapotú, az új címet ott is fel kell venni Test userként.

**Frissítés:** kódváltozás után ugyanúgy `make deploy` — a Terraform csak a
megváltozott fájlokat tölti fel az S3-ba, és csak akkor telepíti újra a
Lambdát, ha a csomag tartalma változott.

**Megjegyzések:**

- A Terraform állapot (`infra/terraform.tfstate`) helyben tárolódik, és
  **titkokat tartalmaz** (munkamenet-aláíró kulcs, Cognito és Google
  kliens titok) — ne kerüljön gitbe (a `.gitignore` kizárja, ahogy a
  `terraform.tfvars`-t is). Több gépről történő kezeléshez érdemes S3
  backendet beállítani a `infra/versions.tf`-ben.
- Az első `terraform init` után keletkező `infra/.terraform.lock.hcl`
  fájlt érdemes commitolni.
- **Minden munkamenet érvénytelenítése** (pl. elveszett eszköz esetén):
  `terraform -chdir=infra apply -replace=random_password.session_secret`.
- Saját domainhez a CloudFront disztribúcióhoz egy ACM tanúsítvány
  (us-east-1 régióban, díjmentes) és `aliases` adható.

### Adatátköltöztetés a korábbi (SQLite-os) verzióból

```bash
# a régi Docker Compose-os verzióból (még a régi kóddal futó konténerből):
docker compose cp app:/data/penzugyek.db ./penzugyek.db

pip install -r app/requirements.txt
cd app
DSQL_ENDPOINT=$(terraform -chdir=../infra output -raw dsql_endpoint) \
  python import_sqlite.py --owner hundjmada@gmail.com ../penzugyek.db
```

A szkript a megadott felhasználó tulajdonaként viszi át a tételeket — a
törölt (inaktív) tételeket is, hogy a duplikátum-védelem megmaradjon; a már
meglévő tételeket kihagyja, így többször is futtatható.

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
helyi megfelelője, ugyanazzal a sémával). Helyben nincs belépés
(`AUTH_MODE=none`): minden adat a `DEV_USER_EMAIL` felhasználóhoz tartozik.
Adatok törlése: `docker compose down -v`.

## Használat

1. Nyisd meg a weboldalt (AWS-en a `terraform output website_url` címe,
   helyben `http://localhost:5000`). AWS-en a Google-fiókoddal lépsz be;
   a jobb felső sarokban lévő monogramra kattintva látod, ki van
   bejelentkezve, és ott van a **Kijelentkezés** is. A belépés 8 óráig
   érvényes, utána a következő műveletnél automatikusan újra belép
   (Google-lel ez általában egyetlen átirányítás).
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
| `app/` | Python backend: `main.py` (Flask REST API), `auth.py` (Cognito belépés, munkamenet-süti), `lambda_handler.py` (Lambda belépési pont + WSGI adapter), `db.py` (kapcsolat + séma), `repository.py` (SQL, felhasználónként szűkítve), `excel_parser.py`, `categorize.py`, `import_sqlite.py` |
| `infra/` | Terraform: `s3.tf`, `cloudfront.tf`, `cognito.tf`, `lambda.tf`, `dsql.tf`, `variables.tf`, `outputs.tf` |
| `infra/functions/` | `auth_gate.js` (CloudFront Function: belépés-kapu), `pre_signup.py` (Cognito trigger: engedélyezett címek) |
| `scripts/build_lambda.py` | Lambda csomag összeállítása (`build/lambda/`) |
| `Makefile` | `build`, `deploy`, `destroy`, `test` |

### Frontend (`frontend/`)

- UI: **Radix Themes** (`@radix-ui/themes`), a **Radix Toast** primitív
  (`radix-ui`), ikonok: `@radix-ui/react-icons`, diagramok: **Recharts**
  (külön chunkba töltve, csak az Elemzés fül megnyitásakor).
- Fejlesztés hot reloaddal: indítsd a backendet (`docker compose up`),
  majd `cd frontend && npm install && npm run dev` →
  http://localhost:5173 (az `/api` hívásokat a :5000-re proxyzza).
  A Vite proxy célja a `VITE_API_PROXY` változóval módosítható (a felhős
  telepítés ellen a belépési süti miatt nem használható).
- Az API címe alapból az azonos origin (`/api`); felülírható a
  futásidejű `config.json`-nal vagy a build-idejű `VITE_API_BASE_URL`-lel.
  401-es válasznál a felület a `/api/auth/login` címre irányít (visszatérési
  címmel).
- A **checkbox-alapú kijelölés** kizárólag kliens oldali állapot
  (`excludedIds` Set az `App.tsx`-ben) — szándékosan nincs hozzá
  backend mező/végpont.

### Backend (`app/`)

- Flask + **psycopg 3**, sima SQL (nincs ORM), pandas nélküli Excel
  beolvasás (`xlrd` / `openpyxl`) — így kicsi a Lambda csomag.
- Az adatbázist környezeti változó választja ki: `DSQL_ENDPOINT` (Aurora
  DSQL, IAM token) vagy `DATABASE_URL` (PostgreSQL).
- Hitelesítés: `AUTH_MODE=cognito` (AWS-en kötelező) vagy `none` (helyi,
  `DEV_USER_EMAIL`). A Cognito kliens adatait a Lambda SSM Parameter
  Store-ból olvassa (`SSM_PREFIX`).
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
- **Tesztek** (valódi PostgreSQL ellen, a Lambda adapterrel, a Cognito
  belépési folyamattal, a felhasználók elkülönítésével és — ha van Node.js
  — a CloudFront Function-nel együtt):

  ```bash
  pip install -r app/requirements-dev.txt
  TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/penzugy_test make test
  ```
