# Kako uporabljati `responsive-modernize` — vodič za laika

## Kaj to dela v eni vrstici

**Robot, ki avtomatsko popravi tvojo spletno stran, da pravilno izgleda na vseh napravah** — iPhone, Samsung, iPad, laptop, ultra-široki monitor. Brez ročnega popravljanja CSS.

---

## Zakaj sploh rabiš to

60–75% obiskovalcev pride na spletke z **mobitelom**. Polovica spletk dobro izgleda na razvijalčevem monitorju in popolnoma odpove na 360-pikslnem Androidu:

- besedilo poskoči iz škatle
- gumb je 30×20 pikslov, kjer prst ne ujame
- fiksen footer prekrije iPhone home indikator
- 1600-pikslna škatla povzroči horizontalni scroll na vsakem telefonu
- velikosti pisav so trdo kodirane na 12 ali 10 pikslov, kar je nečitljivo

Vse to **brez izgovora** v 2026. Skill najde vse te probleme, prikaže kateri elementi so polomljeni, in jih večinoma **avtomatsko popravi** brez da bi se ti dotikal kode.

---

## Kako zaganjati — 3 koraki

### 1. korak — pojdi v projekt

```bash
cd ~/projects/mojklient
```

### 2. korak — naredi brief

To je majhna konfiguracija. Pove robotu, KAJ naj testira.

```bash
cp ~/.openclaw/scripts/responsive-modernize/templates/.responsive-modernize.example.json \
   ./.responsive-modernize.json
```

Odpri `.responsive-modernize.json` in popravi 2–3 stvari:

```json
{
  "target": {
    "url": "http://localhost:3000",
    "routes": ["/", "/o-podjetju", "/kontakt"]
  },
  "framework": "next"
}
```

- `url` = kje teče tvoj dev server (najpogosteje `localhost:3000` ali `localhost:5173`)
- `routes` = katere strani testirati (`/` je domov, ostale po želji)
- `framework` = `next` / `vite` / `vue` / `svelte` / `astro` / `static`

Vse ostalo ima razumne privzete nastavitve.

### 3. korak — zaženi robota

**Samo poglej (brez popravkov):**

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs
```

V 30 sekundah – 5 minut (odvisno od števila strani) dobiš poročilo. Nobena datoteka ni spremenjena.

**Popravi avtomatsko:**

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes
```

Doda zastavico `--yes`. Robot ima dovoljenje, da spremeni tvoje CSS-je in JSX-je, ampak naredi **varnostno kopijo prej**. Če kaj ne ti všeč, kopiraš nazaj iz `.responsive-modernize/backup/`.

**Agresivni način** (popravi tudi gumbi, ki niso dovolj veliki):

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --aggressive
```

**Polni paket** (vse zaslone, vsi brskalniki, dva tona, RTL, itd. – traja ~3 minute):

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --deep
```

**Avtomatska eskalacija** (za probleme ki rabijo AI presoje):

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --auto-impeccable
```

Po koncu vseh popravkov robot poženi še **drugega AI agenta**, ki razume kontekst in popravi stvari kot "ta gumb je premajhen v Footerju, dodaj inline-flex" – stvari, ki jih navadno popravlja samo človek.

---

## Kaj dobiš v izhodu

V mapi `.responsive-modernize/` (avtomatsko skrita pred Gitom):

```
.responsive-modernize/
├── REPORT.html              ← OPRI TO V BRSKALNIKU
├── REPORT.md                ← za branje v urejevalniku
├── propose.md               ← seznam vseh najdenih problemov
├── sprite-baseline.png      ← slika "pred" — vse zaslone naenkrat
├── sprite-verify.png        ← slika "po" — če si zagnal --yes
├── baseline/                ← screenshot vsake strani × vsakega zaslona
├── backup/                  ← originalne datoteke pred popravki
└── ESCALATION-BRIEF.md      ← navodilo za /impeccable agenta
```

**Glavna stvar**: `REPORT.html` — odpri jo v Safariju/Chromu. Vidiš ščitke:
- koliko napak najdenih
- koliko jih je avto-popravil
- mrežica zaslonov pred/po
- vsako napako kot panel z barvno kodo

---

## Tipična uporaba pri agencijskih strankah

### Scenarij A — nova stranka

1. Klient pride: "stran mi ne dela na mobitelu"
2. Vzameš njihov dev URL (ali lokalno preveriš)
3. `cd ~/projects/<klient> && cp template ./.responsive-modernize.json`
4. `node run.mjs` — generiraš `REPORT.html`
5. Pošlješ stranki link na `REPORT.html` ali tunelaš jo (`cloudflared`)
6. Strinjamo se kateri popravki: `--yes` za varne, manualno za riskantne
7. Commit, deploy, pošlješ before/after sprita

### Scenarij B — pre-deploy gate v CI

V GitHub Actions:

```yaml
- run: node ~/.openclaw/scripts/responsive-modernize/run.mjs --url ${{ env.PREVIEW_URL }} --json-output
```

Robot vrne:
- `exit 0` = vse OK, deploy lahko gre naprej
- `exit 1` = našel napake, blokiraj merge
- `exit 2` = robot je crashnil, preveri konfiguracijo

### Scenarij C — periodični audit živih strank

Cron 1× tedensko ali mesečno:

```bash
0 6 * * 1  cd /Users/aimusic/projects/<klient> && node ~/.openclaw/scripts/responsive-modernize/run.mjs --url https://<klient>.com --json-output > /tmp/<klient>-audit.json
```

Klientu pošlješ avtomatski report.

---

## Kaj robot avtomatsko popravi

| Problem | Popravek |
|---|---|
| Manjkajoč `<meta viewport>` | Doda canonical viewport meta v `<head>` |
| `width: 1600px` | Spremeni v `min(100%, 1600px)` |
| `font-size: 14px` × veliko mest | Inject Utopia fluid skalu (tekoča pisava med 320 in 1920 piksli) |
| `padding: 16px` (trdno) | Doda fluid tokens |
| Fiksen bottom bar brez safe-area | Doda `env(safe-area-inset-bottom)` |
| Slika brez dimensions | Doda `aspect-ratio` (lokalna preko Sharp, oddaljena preko fetch) |
| Touch target manjši kot 44px (Tailwind) | Doda `min-h-11` |
| Animacije brez reduced-motion zaščite | Doda `@media (prefers-reduced-motion: reduce)` |
| Eden gumb overflowuje | Doda `max-width: 100%` |

**15 različnih avto-popravkov**, vsi varni in idempotentni (lahko jih poženeš 10×, naredi isto stvar samo enkrat).

---

## Kaj robot najde ampak NE popravi (ker rabi človeško presojo)

- Tekstovne preskoke ki imajo kontekst ("ali je to namensko ime brenda?")
- Layout grids ki bi se rušili (cards, navigacije)
- CSS-in-JS template literals (tvegano editat)
- Tailwind classNames v `cn(isActive && "h-7")` z logiko

**To bo robot iztipal in zapisal v `ESCALATION-BRIEF.md`**. Če zaženeš z `--auto-impeccable`, AI agent prebere brief in se loti — semantične JSX editi, ki upoštevajo blagovno znamko.

---

## Pogosta vprašanja

### Robot mi je polomil stran. Kako vrnem nazaj?

```bash
cp -r .responsive-modernize/backup/* .
```

Robot dela varnostno kopijo VSAK file ki ga spreminja. V backupu so originali.

### Kako vem kateri popravki so bili apply?

Odpri `.responsive-modernize/apply.json` — vidiš seznam vseh sprememb (kateri file, koliko sprememb).

### Kaj če dev server ne teče?

Robot to zazna: `[rm] HEALTH FAIL: target.url unreachable (timeout 5000ms)`. Zaženi `npm run dev` najprej.

### Kaj če rabim samo audit brez popravkov?

Pač ne dajaj `--yes`. Privzeto je read-only.

### Koliko časa traja?

- Default (1 stran × 6 zaslonov × Chrome): **~30 sekund**
- `--yes` (avto-popravki + verify): **~1 minuta**
- `--deep` (11 zaslonov × 3 brskalniki): **~3 minute**
- `--deep --yes --auto-impeccable` (cel paket): **~5–10 minut**

### Stane kaj?

**$0**. Vse teče lokalno (Playwright + Node). Edina opcija ki rabi API je `--auto-impeccable`, ki uporabi tvoj Claude OAuth → $0 marginal.

### Ali deluje na WordPress/Webflow/Shopify?

DA — preverjaš živo stran preko `--url https://...`. Robot ne rabi kode, samo URL. Vendar **ne more popravljati** kode, ki je v tujem CMS-ju. Za WordPress: prevedeš nasvete v custom CSS in pripneš.

### Ali to nadomesti dizajnerja?

Ne. Robot je **diagnostika + osnova**. Človek se odloča "ali je 12px namerno" in "kako naj se tip-scale obnaša na 4K". Robot poskrbi za 80% mehanske dela.

### Ali deluje za Vue/Svelte/Astro?

**Da** — od v1.6+. Skener čita `<style>` v Vue SFC, Svelte, Astro datotekah. Kodemoda jih ne edita (pretvegano), ampak iztipa probleme.

---

## Pravila zdrave pameti

1. **Vedno najprej brez `--yes`** — vidiš REPORT, vidiš zaslone, vidiš kaj bi popravil
2. **Pred `--yes` commit-aj** — če dela napako, lažje vidiš diff in vrneš
3. **`--aggressive` opt-in** — agresivne touch-target popravki spremenijo layout, ne vsaki sayt jih hoče
4. **Pri Tailwind sitehi**: codemod popravi safe-area in touch-targets z visoko zaupanjem; pisava in spacing morata iti preko `--auto-impeccable` ali ročno
5. **Pri vanilla CSS sitehi**: codemod popravi praktično vse mehanične stvari avtomatsko

---

## Konkretni primer (klient solaronics.si)

```bash
cd ~/projects/solaronics-si
# brief že obstaja
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --auto-impeccable
```

Rezultat (preverjeno 2026-06-07):
- Pre-apply: 154 napak
- Po code-fix: 6 napak
- Po `/impeccable` agentu: ~10 datotek touch-target popravkov, 79% redukcija touch-target hits

Stranka dobi:
- `REPORT.html` s pred/po slikami
- `propose.md` s seznam vseh najdenih problemov
- 10 commitov z minimal diff-i (lahko cherry-pick)
- Honest "kaj sem pustil za človeka" sekcijo v `ESCALATION-BRIEF.md`

---

## Glavni ukazi v eni tabeli

| Ukaz | Kaj naredi |
|---|---|
| `node run.mjs` | Samo audit. Brez sprememb. |
| `node run.mjs --yes` | Avtomatski popravki + verify |
| `node run.mjs --yes --aggressive` | Plus opt-in popravki (touch-target enforce) |
| `node run.mjs --deep` | Vsi zasloni × vsi brskalniki |
| `node run.mjs --yes --auto-impeccable` | Plus AI agent za semantične popravke |
| `node run.mjs --url https://...` | Hitri audit brez briefa (poljubni URL) |
| `node run.mjs --json-output` | Strukturiran JSON za CI/skripte |
| `node run.mjs --no-escalate` | Brez generiranja agent briefa |
| `node run.mjs --dry-run` | Preveri brief, pokaži plan, ničesar ne sproži |
| `node run.mjs --phase scan,report` | Zaženi samo subset faz |

---

## Če potrebuješ pomoč

- `REPORT.md` ima vse o tem run-u
- `propose.md` ima razumljiv seznam vseh problemov
- `~/.openclaw/scripts/responsive-modernize/README.md` ima tehnično dokumentacijo
- `~/.openclaw/scripts/responsive-modernize/CHANGELOG.md` ima zgodovino verzij
- Vsa razlaga delovanja je v `lib/` mapi z .mjs datotekami — vsaka faza ima komentarje

Skupna velikost stack-a: ~2500 vrstic kode + ~1000 vrstic dokumentacije. Berljivo v 1–2 urah, če te zanima.
