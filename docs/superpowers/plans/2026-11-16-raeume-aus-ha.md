# Räume aus Home Assistant – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Räume der elvio Room Card kommen aus den HA-Bereichen und lassen sich am Tablet (mit Admin-Anmeldung) anlegen, ändern, sortieren, ausblenden und löschen; alte Dashboards lassen sich per Einrichtungspunkt umstellen.

**Architecture:** Reine Logik in einem Objekt `ElvioRooms` (in Node per VM testbar), eine Raumliste `_rooms()` für alle Stellen der Karte, eine gemeinsame Ansicht `raum` mit `area: auto` (Raum aus `?bereich=`), ein Raum-Blatt im bestehenden Bearbeiten-Blatt (`_editWrap`, Modus `"room"`), ein neuer Punkt in `_collectSetup`.

**Tech Stack:** Eine JavaScript-Datei ohne Build und ohne Abhängigkeiten (`elvio-room-card.js`), Home-Assistant-WebSocket-API, Node ≥ 20 nur für Tests (`node --test`) und den Entwicklerserver.

**Spec:** `docs/superpowers/specs/2026-11-16-raeume-aus-ha-design.md`

## Global Constraints

- Keine Abhängigkeiten, kein Build: Die Karte bleibt **eine** Datei `elvio-room-card.js`, die HACS bzw. jsDelivr unverändert ausliefert. Keine `module.exports`, kein Node-Code in der Datei.
- Altmodus: Steht in `nav` ein Eintrag mit `room: true`, verhält sich die Karte wie v1.5.0 (Leiste, Raumübersicht, Verschieben, Musik, Tablet-Raum).
- Bilder aus dem Kartenpaket: `IMAGE_BASE = "https://cdn.jsdelivr.net/gh/elviooo/elvio-room-card@v1.3.0/bilder/"` – fest auf `@v1.3.0`, nie `@main`.
- Ausblenden über das bestehende Label `nicht_am_tablet` (`LABEL_HIDE`), angelegt über `_ensureLabels()`.
- `config/area_registry/reorder` verlangt **alle** Bereichs-IDs genau einmal.
- Foto-Upload: `hass.fetchWithAuth("/api/image/upload", {method: "POST", body: FormData mit Feld "file"})` → `{id}`; Bild-Adresse `/api/image/serve/<id>/original` (lädt ohne Anmeldung).
- Räume verwalten nur mit Admin-Anmeldung (`hass.user.is_admin`); ohne Admin ändert sich nichts.
- UI-Texte deutsch, kurze Sätze; Kommentare deutsch im Stil der Datei (erklären das Warum).
- Git: nur auf Branch `feat/raeume-aus-ha` committen. **Nicht pushen, nicht taggen**, den Ressourcen-Pin der Test-Installation (`@v1.5.0`) nicht ändern – erst nach Julians lokaler Sichtung.
- `shelly-belegung.csv` (Kundendaten, ungetrackt im Repo-Ordner) nie committen: immer gezielt `git add <datei>`, nie `git add -A`/`.`.
- Commit-Nachrichten enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test-HA: Test-Installation, `http://<ha-adresse>` (Tailscale), echtes Dashboard `dashboard-tablet` wird nicht verändert (nur Lesen), Testen in eigenen Test-Dashboards.
- Handprüfungen laufen über den Entwickler-Proxy `http://localhost:8766` (reicht alles an HA weiter und liefert `/elvio-dev/elvio-room-card-dev.js` aus dem Repo). Grund: Browser laden in einer `http://`-Seite keine Skripte von localhost oder anderen Rechnern (Private Network Access). Die HA-Ressource ist relativ (`/elvio-dev/elvio-room-card-dev.js`): am echten Tablet liefert HA dafür nur 404.

---

### Task 1: Reine Raumlogik `ElvioRooms` und Testgerüst

**Files:**
- Modify: `elvio-room-card.js` – neuer Block direkt nach `function setupErrText(err) {…}` (endet bei Zeile 147), vor dem Kommentar `// ───────────── Gegensprechen über SIP Core ─────────────`
- Create: `test/load.mjs`
- Create: `test/rooms.test.mjs`

**Interfaces:**
- Produces (Top-Level in `elvio-room-card.js`):
  - `IMAGE_BASE: string`, `BUNDLED_IMAGES: string[]`, `ROOM_ICONS: string[]`, `ROOM_PHOTO_MAX = 1920`
  - `ElvioRooms.slugs(name: string): string[]`
  - `ElvioRooms.bundledImage(area: {area_id, name}): string|null`
  - `ElvioRooms.isLegacy(nav: object[]|undefined): boolean`
  - `ElvioRooms.fromAreas(areas: Area[], floors: Floor[], {basePath, hideLabel, includeHidden=false}): Room[]`
  - `ElvioRooms.fromNav(nav, resolveArea: (key)=>string|null): Room[]`
  - `Room = {areaId: string|null, name, icon, image: string|null, temperature: string|null, floorId: string|null, floorName: string|null, path, lights: string[], hidden: boolean}`
  - `ElvioRooms.groupByFloor(rooms: Room[]): {floorId: string|null, title: string|null, rooms: Room[]}[]`
  - `ElvioRooms.areaFromLocation(search: string): string|null`
  - `ElvioRooms.roomsBasePath(pathname: string, override?: string): string`
  - `ElvioRooms.swap(ids: string[], a: string, b: string): string[]`
- Produces (Test): `loadCard()` aus `test/load.mjs` → `{ElvioRooms, IMAGE_BASE, BUNDLED_IMAGES, ROOM_ICONS, AUTO_DOMAINS}`; Rückgaben von `ElvioRooms.*` sind per `structuredClone` in normale Node-Objekte kopiert (sonst scheitert `deepStrictEqual` an fremden Prototypen aus der VM).

- [ ] **Step 1: Testgerüst anlegen**

`test/load.mjs`:

```js
// Lädt elvio-room-card.js unverändert in eine Node-VM. Gebraucht wird nur die reine Logik;
// für die Browser-Teile, die beim Laden ausgeführt werden (class … extends HTMLElement,
// customElements.define, window.customCards), reichen Platzhalter.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../elvio-room-card.js", import.meta.url), "utf8");
const EXPORT = "\n;globalThis.__test = { ElvioRooms, IMAGE_BASE, BUNDLED_IMAGES, ROOM_ICONS, AUTO_DOMAINS };";

// Ergebnisse aus der VM haben deren Array-/Object-Prototypen; kopiert sind sie normale Werte.
const plain = (v) => (v === undefined ? v : structuredClone(v));

export function loadCard() {
  const sandbox = {
    HTMLElement: class {},
    customElements: { define() {} },
    window: {},
    URLSearchParams,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC + EXPORT, sandbox, { filename: "elvio-room-card.js" });
  const t = sandbox.__test;
  const rooms = {};
  for (const [name, fn] of Object.entries(t.ElvioRooms)) rooms[name] = (...args) => plain(fn(...args));
  return {
    ElvioRooms: rooms,
    IMAGE_BASE: t.IMAGE_BASE,
    BUNDLED_IMAGES: plain(t.BUNDLED_IMAGES),
    ROOM_ICONS: plain(t.ROOM_ICONS),
    AUTO_DOMAINS: plain(t.AUTO_DOMAINS),
  };
}
```

- [ ] **Step 2: Fehlschlagende Tests schreiben**

`test/rooms.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioRooms: R, IMAGE_BASE, BUNDLED_IMAGES, ROOM_ICONS } = loadCard();
const HIDE = "nicht_am_tablet";
const OPTS = { basePath: "/tab/raum", hideLabel: HIDE };
const floors = [
  { floor_id: "eg", name: "Erdgeschoss" },
  { floor_id: "og", name: "Obergeschoss" },
];
const area = (area_id, name, extra = {}) => ({
  area_id, name, icon: null, picture: null, floor_id: null, labels: [], temperature_entity_id: null, ...extra,
});

test("Konstanten: Bilder fest auf v1.3.0, 30 Icons", () => {
  assert.equal(IMAGE_BASE, "https://cdn.jsdelivr.net/gh/elviooo/elvio-room-card@v1.3.0/bilder/");
  assert.ok(BUNDLED_IMAGES.includes("gaeste_bad"));
  assert.equal(ROOM_ICONS.length, 30);
  assert.ok(ROOM_ICONS.every((i) => i.startsWith("mdi:")));
});

test("slugs: beide Umlaut-Schreibweisen, ohne Doppel", () => {
  assert.deepEqual(R.slugs("Gäste-Bad"), ["gaeste_bad", "gaste_bad"]);
  assert.deepEqual(R.slugs("Garage"), ["garage"]);
  assert.deepEqual(R.slugs(""), []);
});

test("bundledImage: passt über Name oder ID, sonst null", () => {
  assert.equal(R.bundledImage(area("gaste_bad", "Gäste-Bad")), `${IMAGE_BASE}gaeste_bad.jpg`);
  assert.equal(R.bundledImage(area("garage", "Carport")), `${IMAGE_BASE}garage.jpg`);
  assert.equal(R.bundledImage(area("buero", "Büro")), null);
});

test("isLegacy: nur mit room: true in nav", () => {
  assert.equal(R.isLegacy([{ name: "Zuhause", path: "/a/z" }, { name: "Bad", room: true }]), true);
  assert.equal(R.isLegacy([{ name: "Zuhause", path: "/a/z" }]), false);
  assert.equal(R.isLegacy(undefined), false);
});

test("fromAreas: erst Stockwerk, dann Registry-Reihenfolge, ohne Stockwerk ans Ende", () => {
  const areas = [
    area("a", "Ohne"),
    area("b", "Bad", { floor_id: "og" }),
    area("c", "Küche", { floor_id: "eg" }),
    area("d", "Flur", { floor_id: "eg" }),
  ];
  const rooms = R.fromAreas(areas, floors, OPTS);
  assert.deepEqual(rooms.map((r) => r.areaId), ["c", "d", "b", "a"]);
  assert.equal(rooms[0].floorName, "Erdgeschoss");
  assert.equal(rooms[3].floorId, null);
  assert.equal(rooms[3].floorName, null);
});

test("fromAreas: Felder und Ersatzwerte", () => {
  const [r] = R.fromAreas([area("garage", "Garage", { temperature_entity_id: "sensor.t" })], [], OPTS);
  assert.deepEqual(r, {
    areaId: "garage",
    name: "Garage",
    icon: "mdi:door",
    image: `${IMAGE_BASE}garage.jpg`,
    temperature: "sensor.t",
    floorId: null,
    floorName: null,
    path: "/tab/raum?bereich=garage",
    lights: [],
    hidden: false,
  });
});

test("fromAreas: eigenes Bild und Icon gehen vor", () => {
  const [r] = R.fromAreas([area("garage", "Garage", { icon: "mdi:car", picture: "/api/image/serve/x/original" })], [], OPTS);
  assert.equal(r.icon, "mdi:car");
  assert.equal(r.image, "/api/image/serve/x/original");
});

test("fromAreas: Ausgeblendete nur mit includeHidden, dann markiert", () => {
  const areas = [area("a", "A"), area("b", "B", { labels: [HIDE] })];
  assert.deepEqual(R.fromAreas(areas, [], OPTS).map((r) => r.areaId), ["a"]);
  const all = R.fromAreas(areas, [], { ...OPTS, includeHidden: true });
  assert.deepEqual(all.map((r) => [r.areaId, r.hidden]), [["a", false], ["b", true]]);
});

test("fromAreas: unbekanntes Stockwerk zählt als ohne Stockwerk; ID wird in der Adresse kodiert", () => {
  const [r] = R.fromAreas([area("x y", "X", { floor_id: "weg" })], floors, OPTS);
  assert.equal(r.floorId, null);
  assert.equal(r.path, "/tab/raum?bereich=x%20y");
});

test("fromNav: gleiche Form wie fromAreas", () => {
  const nav = [
    { name: "Zuhause", path: "/d/zuhause" },
    { name: "Bad", path: "/d/bad", room: true, icon: "mdi:shower", image: "/local/bad.jpg", temperature: "sensor.bad", lights: ["light.x"] },
    { name: "Keller", path: "/d/keller", room: true },
  ];
  const rooms = R.fromNav(nav, (k) => (k === "Bad" ? "bad" : null));
  assert.deepEqual(rooms, [
    { areaId: "bad", name: "Bad", icon: "mdi:shower", image: "/local/bad.jpg", temperature: "sensor.bad", floorId: null, floorName: null, path: "/d/bad", lights: ["light.x"], hidden: false },
    { areaId: null, name: "Keller", icon: "mdi:door", image: null, temperature: null, floorId: null, floorName: null, path: "/d/keller", lights: [], hidden: false },
  ]);
});

test("groupByFloor: Überschriften, „Weitere“ am Ende, eine Gruppe ohne Überschrift", () => {
  const rooms = R.fromAreas([area("a", "A", { floor_id: "eg" }), area("b", "B"), area("c", "C", { floor_id: "og" })], floors, OPTS);
  const g = R.groupByFloor(rooms);
  assert.deepEqual(g.map((x) => [x.floorId, x.title, x.rooms.map((r) => r.areaId)]), [
    ["eg", "Erdgeschoss", ["a"]],
    ["og", "Obergeschoss", ["c"]],
    [null, "Weitere", ["b"]],
  ]);
  const one = R.groupByFloor(R.fromAreas([area("a", "A", { floor_id: "eg" })], floors, OPTS));
  assert.equal(one[0].title, null);
  assert.deepEqual(R.groupByFloor([]), []);
});

test("areaFromLocation: liest ?bereich=", () => {
  assert.equal(R.areaFromLocation("?bereich=gaste_bad"), "gaste_bad");
  assert.equal(R.areaFromLocation("?x=1&bereich=x%20y"), "x y");
  assert.equal(R.areaFromLocation(""), null);
  assert.equal(R.areaFromLocation("?bereich="), null);
});

test("roomsBasePath: /<dashboard>/raum oder rooms_path", () => {
  assert.equal(R.roomsBasePath("/dashboard-tablet/garten"), "/dashboard-tablet/raum");
  assert.equal(R.roomsBasePath("/"), "/lovelace/raum");
  assert.equal(R.roomsBasePath("/dashboard-tablet/garten", "/x/zimmer"), "/x/zimmer");
});

test("swap: tauscht zwei IDs, Rest bleibt", () => {
  assert.deepEqual(R.swap(["a", "b", "c", "d"], "b", "d"), ["a", "d", "c", "b"]);
  assert.deepEqual(R.swap(["a", "b"], "a", "zz"), ["a", "b"]);
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `node --test`
Expected: FAIL – `ReferenceError: ElvioRooms is not defined` (aus `test/load.mjs`).

- [ ] **Step 4: `ElvioRooms` einfügen**

In `elvio-room-card.js` direkt nach `function setupErrText(err) {…}` und vor `// ───────────── Gegensprechen über SIP Core ─────────────`:

```js
// ───────────── Räume aus HA-Bereichen (reine Logik, in Node testbar) ─────────────
// Ein Raum ist ein Bereich in Home Assistant: Name, Icon, Bild, Temperatursensor, Stockwerk
// und Reihenfolge stehen dort – der Kunde ändert sie am Tablet, Updates der Karte lassen
// sie in Ruhe. Altmodus: Räume als Einträge mit room: true in nav (bis v1.5.0).

// Bilder aus dem Repo (bilder/). Fest auf einen Tag, damit sich ein Raumbild nicht
// unbemerkt ändert, wenn im Repo ein Bild getauscht wird.
const IMAGE_BASE = "https://cdn.jsdelivr.net/gh/elviooo/elvio-room-card@v1.3.0/bilder/";
const BUNDLED_IMAGES = [
  "flur_oben", "flur_unten", "gaeste_bad", "garage", "garten", "kind_1", "kind_2",
  "master_bad", "schlafzimmer", "sicherheit", "wohnbereich", "zuhause",
];
// Auswahl im Raum-Blatt – bewusst kein Freitext, am Tablet tippt niemand „mdi:…“.
const ROOM_ICONS = [
  "mdi:sofa-outline", "mdi:television", "mdi:silverware-fork-knife", "mdi:stove", "mdi:fridge-outline",
  "mdi:bed-outline", "mdi:bed-single-outline", "mdi:bed-king-outline", "mdi:teddy-bear", "mdi:rocket-launch-outline",
  "mdi:bathtub-outline", "mdi:shower", "mdi:toilet", "mdi:washing-machine", "mdi:hanger",
  "mdi:desk", "mdi:laptop", "mdi:bookshelf", "mdi:dumbbell", "mdi:gamepad-variant-outline",
  "mdi:door", "mdi:stairs", "mdi:home-floor-negative-1", "mdi:garage-variant", "mdi:tools",
  "mdi:flower-outline", "mdi:pine-tree", "mdi:grill-outline", "mdi:pool", "mdi:car-outline",
];
// Eigene Fotos: längste Kante beim Hochladen – reicht fürs Tablet, schont Speicher und Netz.
const ROOM_PHOTO_MAX = 1920;

const ElvioRooms = {
  // Slug-Varianten eines Namens: HA macht aus „ä“ ein „a“, die Bilder im Repo heißen „ae“.
  slugs(name) {
    const base = String(name || "").toLowerCase();
    const make = (map) =>
      base.replace(/[äöüß]/g, (ch) => map[ch]).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return [...new Set([make({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }), make({ ä: "a", ö: "o", ü: "u", ß: "ss" })])].filter(Boolean);
  },

  // Bild aus dem Kartenpaket, wenn Name oder ID zu einer Datei passt („Garage“ → garage.jpg).
  bundledImage(area) {
    const keys = [...ElvioRooms.slugs(area.name), area.area_id];
    const hit = keys.find((k) => BUNDLED_IMAGES.includes(k));
    return hit ? `${IMAGE_BASE}${hit}.jpg` : null;
  },

  isLegacy(nav) {
    return (nav || []).some((i) => i && i.room);
  },

  // Neuer Modus: Bereiche in Registry-Reihenfolge (so liefert HA hass.areas/hass.floors),
  // sortiert nach Stockwerk; Bereiche ohne (bekanntes) Stockwerk ans Ende.
  fromAreas(areas, floors, { basePath, hideLabel, includeHidden = false }) {
    const floorIdx = new Map((floors || []).map((f, i) => [f.floor_id, i]));
    const floorName = new Map((floors || []).map((f) => [f.floor_id, f.name]));
    const pos = (a) => (floorIdx.has(a.floor_id) ? floorIdx.get(a.floor_id) : Number.MAX_SAFE_INTEGER);
    return (areas || [])
      .map((a, i) => ({ a, i, hidden: (a.labels || []).includes(hideLabel) }))
      .filter((x) => includeHidden || !x.hidden)
      .sort((x, y) => pos(x.a) - pos(y.a) || x.i - y.i)
      .map(({ a, hidden }) => ({
        areaId: a.area_id,
        name: a.name,
        icon: a.icon || "mdi:door",
        image: a.picture || ElvioRooms.bundledImage(a),
        temperature: a.temperature_entity_id || null,
        floorId: floorIdx.has(a.floor_id) ? a.floor_id : null,
        floorName: floorIdx.has(a.floor_id) ? floorName.get(a.floor_id) : null,
        path: `${basePath}?bereich=${encodeURIComponent(a.area_id)}`,
        lights: [],
        hidden,
      }));
  },

  // Altmodus: dieselbe Form aus nav; den Bereich findet resolveArea über den Namen.
  fromNav(nav, resolveArea) {
    return (nav || [])
      .filter((i) => i && i.room)
      .map((r) => ({
        areaId: resolveArea(r.area || r.name),
        name: r.name,
        icon: r.icon || "mdi:door",
        image: r.image || null,
        temperature: r.temperature || null,
        floorId: null,
        floorName: null,
        path: r.path,
        lights: r.lights || [],
        hidden: false,
      }));
  },

  // Gruppen für die Raumübersicht (Räume sind schon nach Stockwerk sortiert). Eine einzige
  // Gruppe braucht keine Überschrift.
  groupByFloor(rooms) {
    const groups = [];
    for (const r of rooms) {
      const key = r.floorId || null;
      let g = groups.find((x) => x.floorId === key);
      if (!g) {
        g = { floorId: key, title: key ? r.floorName : "Weitere", rooms: [] };
        groups.push(g);
      }
      g.rooms.push(r);
    }
    if (groups.length === 1) groups[0].title = null;
    return groups;
  },

  areaFromLocation(search) {
    return new URLSearchParams(search || "").get("bereich") || null;
  },

  // Adresse der gemeinsamen Raum-Ansicht: /<dashboard>/raum, außer rooms_path ist gesetzt.
  roomsBasePath(pathname, override) {
    if (override) return override;
    const dash = String(pathname || "").split("/")[1] || "lovelace";
    return `/${dash}/raum`;
  },

  swap(ids, a, b) {
    const out = [...ids];
    const i = out.indexOf(a);
    const j = out.indexOf(b);
    if (i < 0 || j < 0) return out;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  },
};
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node --test`
Expected: PASS, alle Tests grün (`# fail 0`).

- [ ] **Step 6: Syntax der Karte prüfen**

Run: `node --check elvio-room-card.js`
Expected: keine Ausgabe, Exit-Code 0.

- [ ] **Step 7: Commit**

```bash
git add elvio-room-card.js test/load.mjs test/rooms.test.mjs
git commit -m "Räume: reine Raumlogik (ElvioRooms) mit Tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Entwickler-Proxy und Test-Dashboards

> **Geändert nach dem ersten Durchlauf (Ruling 6):** Ein Server auf `localhost` reicht nicht – Browser laden in der `http://`-Seite von HA keine Skripte von localhost oder anderen Rechnern (Private Network Access, im eingebauten Browser und in Chrome). Der Entwicklerserver wird deshalb ein lokaler Proxy: `http://localhost:<PORT>` zeigt HA, dieselbe Adresse liefert die Entwicklerkarte. Die Test-Dashboards und die Ressource aus dem ersten Durchlauf bestehen schon; die Ressource wird auf die relative Adresse umgestellt.

**Files:**
- Modify: `tools/dev-server.mjs` (aus Commit eab59a0)
- Modify: `test/dev-server.test.mjs`

**Interfaces:**
- Consumes: nichts aus Task 1.
- Produces: aus `tools/dev-server.mjs` exportiert `devBuild(src: string): string`, `DEV_PATH = "/elvio-dev/elvio-room-card-dev.js"`, `isDevPath(url: string): boolean`; Start mit `HA_URL=http://<ha> PORT=<port> node tools/dev-server.mjs` (HA_URL Pflicht, nur `http:`); in der Test-Installation: Ressource `/elvio-dev/elvio-room-card-dev.js` (Modul), Dashboards `tablet-test` (Altmodus-Kopie) und `tablet-neu` (neuer Modus, Ansichten `zuhause`/`raum`/`einstellungen`), beide nicht in der Seitenleiste, nur Admins.

- [ ] **Step 1: Fehlschlagenden Test ergänzen**

In `test/dev-server.test.mjs` den Import auf `import { devBuild, isDevPath, DEV_PATH } from "../tools/dev-server.mjs";` ändern und anfügen:

```js
test("isDevPath: nur die Entwicklerkarte, Query egal", () => {
  assert.equal(DEV_PATH, "/elvio-dev/elvio-room-card-dev.js");
  assert.equal(isDevPath("/elvio-dev/elvio-room-card-dev.js"), true);
  assert.equal(isDevPath("/elvio-dev/elvio-room-card-dev.js?v=2"), true);
  assert.equal(isDevPath("/api/websocket"), false);
  assert.equal(isDevPath("/elvio-dev/elvio-room-card-dev.jsx"), false);
  assert.equal(isDevPath(undefined), false);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node --test`
Expected: FAIL – `isDevPath` bzw. `DEV_PATH` wird nicht exportiert (SyntaxError beim Import).

- [ ] **Step 3: Proxy schreiben**

`tools/dev-server.mjs` vollständig ersetzen durch:

```js
// Entwickler-Proxy: Unter http://localhost:<PORT> erscheint Home Assistant (alles wird an
// HA_URL weitergereicht, auch der WebSocket), und DEV_PATH liefert die Karte aus dem Repo als
// <elvio-room-card-dev>. Gleicher Ursprung wie HA, weil Browser in einer http-Seite keine
// Skripte von localhost oder anderen Rechnern laden (Private Network Access).
// Start: HA_URL=http://<ha-adresse> node tools/dev-server.mjs   (Port über PORT=…, Standard 8765)
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8765);
const FILE = fileURLToPath(new URL("../elvio-room-card.js", import.meta.url));
export const DEV_PATH = "/elvio-dev/elvio-room-card-dev.js";

export function devBuild(src) {
  return src
    .replace('customElements.define("elvio-room-card",', 'customElements.define("elvio-room-card-dev",')
    .replace('  type: "elvio-room-card",', '  type: "elvio-room-card-dev",')
    .replace('  name: "Elvio Raumkarte",', '  name: "Elvio Raumkarte (Entwicklung)",');
}

export function isDevPath(url) {
  return String(url || "").split("?")[0] === DEV_PATH;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.HA_URL) {
    console.error("HA_URL fehlt, z. B. HA_URL=http://192.168.1.10:8123 node tools/dev-server.mjs");
    process.exit(1);
  }
  const target = new URL(process.env.HA_URL);
  if (target.protocol !== "http:") {
    console.error("HA_URL: nur http:// wird unterstützt");
    process.exit(1);
  }
  const port = Number(target.port || 80);
  const server = createServer(async (req, res) => {
    if (isDevPath(req.url)) {
      const src = devBuild(await readFile(FILE, "utf8"));
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(src);
      return;
    }
    const up = request(
      { host: target.hostname, port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`HA nicht erreichbar: ${err.message}`);
    });
    req.pipe(up);
  });
  // WebSocket (/api/websocket): Handshake neu schreiben (Host von HA), danach roh durchreichen.
  server.on("upgrade", (req, socket, head) => {
    const up = connect(port, target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries({ ...req.headers, host: target.host })) lines.push(`${k}: ${v}`);
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`HA mit Entwicklerkarte: http://localhost:${PORT}/  (Karte: ${DEV_PATH})`));
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test`
Expected: PASS (`# fail 0`).

- [ ] **Step 5: Proxy kurz starten und prüfen**

Run (Hintergrund): `HA_URL=http://<ha-adresse> PORT=8769 node tools/dev-server.mjs`
Dann:
- `curl -s http://localhost:8769/elvio-dev/elvio-room-card-dev.js | grep -c 'elvio-room-card-dev'` → `2`
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:8769/` → `200` (HA-Startseite über den Proxy)
- `curl -s -o /dev/null -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' --max-time 3 http://localhost:8769/api/websocket` → `101`
Danach den Proxy wieder beenden (Port 8766 betreibt der Controller dauerhaft).

- [ ] **Step 6: HA-Ressource auf die relative Adresse umstellen**

Im eingebauten Browser `http://<ha-adresse>/config/dashboard` (direkt, als Admin angemeldet) in der Seite ausführen:

```js
const h = document.querySelector("home-assistant").hass;
const res = await h.callWS({ type: "lovelace/resources" });
const dev = res.find((r) => /elvio-room-card-dev\.js/.test(r.url));
const url = "/elvio-dev/elvio-room-card-dev.js";
if (!dev) await h.callWS({ type: "lovelace/resources/create", res_type: "module", url });
else if (dev.url !== url) await h.callWS({ type: "lovelace/resources/update", resource_id: dev.id, res_type: "module", url });
(await h.callWS({ type: "lovelace/resources" })).map((r) => r.url);
```

Expected: Liste enthält `/elvio-dev/elvio-room-card-dev.js`, keine `http://localhost…`-Ressource mehr. Die Dashboards `tablet-test` und `tablet-neu` bestehen aus dem ersten Durchlauf (nicht neu anlegen).

- [ ] **Step 7: Commit**

```bash
git add tools/dev-server.mjs test/dev-server.test.mjs
git commit -m "Entwicklerserver: als Proxy für HA mit Entwicklerkarte am gleichen Ursprung

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Die Prüfung im Browser über `http://localhost:8766` (Anmeldung bei HA über den Proxy) macht der Controller.

---

### Task 3: Eine Raumliste für alle Stellen (Altmodus unverändert)

**Files:**
- Modify: `elvio-room-card.js` – `set hass` (ab Zeile ~446), `_roomLightIds` (~Zeile 607), `_navItems`/`_renderRoomsNav` (~3558–3647), `_tabletRoom`/`_openTabletRoom`/`_musicRooms`/`_updateNowPlaying` (~2399–2480), `_moveTargets` (~3908), CSS-Block `STYLE` (nach `.roomcard.current`).

**Interfaces:**
- Consumes: `ElvioRooms.isLegacy`, `fromAreas`, `fromNav`, `groupByFloor`, `roomsBasePath` (Task 1).
- Produces: `this._rooms({includeHidden?: boolean}): Room[]`, `this._isAdmin(): boolean`, `this._tabletRoomArea(): string|null`; `set hass` setzt `this._roomCards = null`, wenn sich `hass.areas` oder `hass.floors` ändern; CSS-Klasse `.rgroup`.

- [ ] **Step 1: `_rooms` und `_isAdmin` hinzufügen**

Direkt vor `// Bereich dieser Ansicht: …` (über `_areaId`) einfügen:

```js
  // Eine Raumliste für alle Stellen (Leiste, Übersicht, Verschieben, Musik, Tablet-Raum).
  // Altmodus: aus nav. Neuer Modus: aus den HA-Bereichen.
  _rooms({ includeHidden = false } = {}) {
    const nav = this._config.nav || [];
    if (ElvioRooms.isLegacy(nav)) return ElvioRooms.fromNav(nav, (k) => this._resolveArea(k));
    const hass = this._hass;
    return ElvioRooms.fromAreas(Object.values(hass.areas || {}), Object.values(hass.floors || {}), {
      basePath: ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path),
      hideLabel: LABEL_HIDE.id,
      includeHidden,
    });
  }

  _isAdmin() {
    return !!(this._hass && this._hass.user && this._hass.user.is_admin);
  }
```

- [ ] **Step 2: Raumübersicht neu zeichnen, wenn Bereiche/Stockwerke sich ändern**

In `set hass(hass)` die Zeilen

```js
    const regChanged =
      !prev || hass.entities !== prev.entities || hass.devices !== prev.devices || hass.areas !== prev.areas;
```

ersetzen durch

```js
    const regChanged =
      !prev || hass.entities !== prev.entities || hass.devices !== prev.devices || hass.areas !== prev.areas || hass.floors !== prev.floors;
    // Bereich umbenannt, verschoben, neu: die offene Raumübersicht baut ihre Kacheln neu.
    if (prev && (hass.areas !== prev.areas || hass.floors !== prev.floors)) this._roomCards = null;
```

- [ ] **Step 3: `_roomLightIds` auf `room.areaId` umstellen**

Ersetzen:

```js
    const areaId = this._resolveArea(room.area || room.name);
```

durch:

```js
    const areaId = room.areaId;
```

- [ ] **Step 4: `_navItems` für den neuen Modus erweitern**

Am Anfang von `_navItems()` direkt nach `const all = this._config.nav || [];` einfügen:

```js
    if (!ElvioRooms.isLegacy(all)) {
      // Neuer Modus: „Räume“ direkt hinter dem ersten Eintrag (meist Zuhause).
      const base = ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path);
      const items = all.map((item) => ({ ...item, active: this._isCurrent(item.path) }));
      if (this._rooms().length) {
        items.splice(Math.min(1, items.length), 0, { name: "Räume", icon: "mdi:floor-plan", rooms: true, active: this._isCurrent(base) });
      }
      return items;
    }
```

- [ ] **Step 5: `_renderRoomsNav` mit Stockwerk-Gruppen**

Den Block `const rooms = (this._config.nav || []).filter((i) => i.room);` bis einschließlich der schließenden Klammer von `if (!this._roomCards) { … }` ersetzen durch:

```js
    if (!this._roomCards) {
      this._roomGrid.innerHTML = "";
      const here = this._areaId();
      this._roomCards = [];
      for (const group of ElvioRooms.groupByFloor(this._rooms())) {
        if (group.title) this._roomGrid.appendChild(el("div", "rgroup", group.title));
        for (const room of group.rooms) {
          const card = el("button", "roomcard");
          if (this._isCurrent(room.path) || (room.areaId && room.areaId === here)) card.classList.add("current");
          const img = el("img", "rc-img");
          img.alt = "";
          if (room.image) img.src = room.image;
          const txt = el("div", "rc-text");
          const name = el("div", "rc-name", room.name);
          const status = el("div", "rc-status");
          txt.append(name, status);
          const ic = el("div", "rc-icon");
          ic.appendChild(icon(room.icon || "mdi:door"));
          card.append(img, txt, ic);
          card.addEventListener("click", () => {
            this._roomsNavWrap.hidden = true;
            this._navigate(room.path);
          });
          card.style.setProperty("--i", String(this._roomGrid.children.length));
          this._roomGrid.appendChild(card);
          this._roomCards.push({ room, status });
        }
      }
    }
```

Die anschließende Schleife `for (const { room, status } of this._roomCards) { … }` bleibt unverändert.

- [ ] **Step 6: Tablet-Raum über die Bereichs-ID**

`_setTabletRoom(name)` umbenennen in `_setTabletRoom(value)` und `name` darin durch `value` ersetzen. Nach `_tabletRoom()` einfügen:

```js
  // Gespeichert wird die Bereichs-ID (bleibt beim Umbenennen gleich). Ältere Einträge mit dem
  // Raumnamen werden weiter erkannt.
  _tabletRoomArea() {
    const v = this._tabletRoom();
    if (!v) return null;
    return this._hass.areas && this._hass.areas[v] ? v : this._resolveArea(v);
  }
```

In `_openTabletRoom()` ersetzen:

```js
    const cur = this._tabletRoom();
    const rooms = (this._config.nav || []).filter((r) => r.room);
    for (const r of [...rooms, { name: null, icon: "mdi:cellphone" }]) {
```

durch:

```js
    const cur = this._tabletRoomArea();
    const rooms = this._rooms().filter((r) => r.areaId);
    for (const r of [...rooms, { areaId: null, name: null, icon: "mdi:cellphone" }]) {
```

und darin `if ((r.name || null) === cur) {` durch `if ((r.areaId || null) === cur) {` sowie `row.addEventListener("click", () => this._setTabletRoom(r.name));` durch `row.addEventListener("click", () => this._setTabletRoom(r.areaId));`.

- [ ] **Step 7: Musik-Räume und Live-Karte**

In `_musicRooms()` ersetzen:

```js
    for (const room of (this._config.nav || []).filter((r) => r.room)) {
      const areaId = this._resolveArea(room.area || room.name);
```

durch:

```js
    for (const room of this._rooms()) {
      const areaId = room.areaId;
```

In `_updateNowPlaying(tile)` ersetzen:

```js
    const wanted = this._tabletRoom();
    const room = wanted ? rooms.find((r) => r.name === wanted) : null;
```

durch:

```js
    const wanted = this._tabletRoomArea();
    const room = wanted ? rooms.find((r) => r.areaId === wanted) : null;
```

- [ ] **Step 8: Verschieben-Ziele**

`_moveTargets()` ersetzen durch:

```js
  // Räume, in die man verschieben kann: die Räume des Tablets, die einen HA-Bereich haben.
  _moveTargets() {
    return this._rooms()
      .filter((r) => r.areaId)
      .map((r) => ({ name: r.name, icon: r.icon, areaId: r.areaId }));
  }
```

- [ ] **Step 9: CSS für Stockwerk-Überschriften**

Im `STYLE`-String direkt nach der Zeile `.roomcard.current { border-color: rgba(255,255,255,.7); }` einfügen:

```css
.rgroup { grid-column: 1 / -1; margin: 10px 2px 0; font-size: 13px; font-weight: 600; opacity: .75;
  text-transform: uppercase; letter-spacing: .06em; }
.rgroup:first-child { margin-top: 0; }
```

- [ ] **Step 10: Tests und Syntax**

Run: `node --test && node --check elvio-room-card.js`
Expected: PASS, keine Syntaxfehler.

- [ ] **Step 11: Altmodus im Browser prüfen**

Entwickler-Proxy läuft (Task 2, Controller betreibt ihn auf Port 8766). `http://localhost:8766/tablet-test/wohnbereich?disable_km` neu laden.
Expected:
- Leiste: „Zuhause · Räume · Einstellungen“ wie bisher.
- „Räume“ öffnet die Übersicht mit 12 Räumen in nav-Reihenfolge, **ohne** Stockwerk-Überschriften (Altmodus hat keine Stockwerke → eine Gruppe).
- Wohnbereich ist als „current“ umrandet; „Geräte bearbeiten“ → „Verschieben“ zeigt alle Räume.
- Einstellungen → „Wo hängt dieses Tablet?“ listet die Räume; Auswahl Wohnbereich wird gespeichert und beim erneuten Öffnen als „gewählt“ markiert.
- Konsole ohne neue Fehler.

`http://localhost:8766/tablet-neu/zuhause?disable_km`:
- Leiste: „Zuhause · Räume · Einstellungen“.
- Raumübersicht gruppiert nach „Erdgeschoss“, „Obergeschoss“, „Außen“; Räume tragen Bilder aus dem Kartenpaket, wo der Name passt.

- [ ] **Step 12: Commit**

```bash
git add elvio-room-card.js
git commit -m "Räume: eine Raumliste für Leiste, Übersicht, Musik und Verschieben

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Gemeinsame Raum-Ansicht `area: auto`

**Files:**
- Modify: `elvio-room-card.js` – `_areaId`, `_effectiveConfig`, `set hass`, `connectedCallback`/`disconnectedCallback`, `_renderEdit` (Titelzeile).

**Interfaces:**
- Consumes: `this._rooms()` (Task 3), `ElvioRooms.areaFromLocation`, `ElvioRooms.roomsBasePath` (Task 1).
- Produces: `this._autoRoom(): Room|null`, `this._locationChanged()`, `this._maybePickRoom()`, `this._onRoomsPath(): boolean`; Konfigurationswert `area: auto` und optional `rooms_path`.

- [ ] **Step 1: `_autoRoom` und `_areaId`**

Direkt vor `_areaId(cfg = this._rawConfig) {` einfügen:

```js
  // Raum der gemeinsamen Raum-Ansicht (area: auto) aus ?bereich=… – nur sichtbare Räume.
  _autoRoom() {
    const id = ElvioRooms.areaFromLocation(location.search);
    return (id && this._rooms().find((r) => r.areaId === id)) || null;
  }
```

In `_areaId(cfg = this._rawConfig)` als erste Zeile einfügen:

```js
    if (cfg.area === "auto") {
      const room = this._autoRoom();
      return room ? room.areaId : null;
    }
```

- [ ] **Step 2: Titel, Bild und Temperatur aus dem Raum**

In `_effectiveConfig()` die erste Zeile `const c = this._rawConfig;` ersetzen durch:

```js
    let c = this._rawConfig;
    // Gemeinsame Raum-Ansicht: Titel, Hintergrund und Temperatur kommen aus dem Bereich.
    if (c.area === "auto") {
      const room = this._autoRoom();
      if (room) c = { ...c, title: room.name, background: room.image || c.background, temperature: room.temperature || c.temperature };
    }
```

- [ ] **Step 3: Auf Adressänderungen hören**

In `connectedCallback()` vor `sipBridge.attach(this);` einfügen:

```js
    // Gemeinsame Raum-Ansicht: HA tauscht die Karte nicht aus, wenn nur ?bereich= wechselt.
    this._onLocation = () => this._locationChanged();
    window.addEventListener("location-changed", this._onLocation);
    window.addEventListener("popstate", this._onLocation);
```

In `disconnectedCallback()` vor `sipBridge.detach(this);` einfügen:

```js
    window.removeEventListener("location-changed", this._onLocation);
    window.removeEventListener("popstate", this._onLocation);
```

Nach `_rebuildKeepingPlace() { … }` einfügen:

```js
  // Anderer Raum in der Adresse: dieselbe Karte zeigt einen anderen Raum – mit derselben
  // Einblendung wie ein Ansichtswechsel. HA meldet die neue Adresse, bevor es die Ansicht
  // tauscht; erst danach prüfen, ob diese Karte überhaupt noch sichtbar ist.
  _locationChanged() {
    if (!this._hass || !this._rawConfig || this._rawConfig.area !== "auto") return;
    setTimeout(() => {
      if (!this.isConnected || !this._onRoomsPath()) return;
      const eff = this._effectiveConfig();
      const sig = JSON.stringify(eff);
      if (sig !== this._effSig) {
        this._effSig = sig;
        this._config = eff;
        this._build();
        this._update();
      }
      this._maybePickRoom();
    }, 0);
  }

  // Ohne (gültigen) Raum in der Adresse: Raumübersicht öffnen – einmal je Adresse, damit sie
  // nach dem Schließen nicht bei jeder Zustandsänderung wieder aufgeht.
  _maybePickRoom() {
    if (!this._rawConfig || this._rawConfig.area !== "auto" || !this._onRoomsPath() || this._autoRoom() || !this._roomsNavWrap) return;
    const key = location.pathname + location.search;
    if (this._pickedFor === key) return;
    this._pickedFor = key;
    this._openRoomsNav();
  }

  // Steht der Browser (noch) auf der Raum-Ansicht? Beim Wechsel nach „Zuhause“ meldet sich die
  // verschwindende Raumkarte sonst noch einmal und öffnete die Raumübersicht.
  _onRoomsPath() {
    return location.pathname === ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path);
  }
```

- [ ] **Step 4: Nach dem ersten Aufbau Raum wählen lassen**

In `set hass(hass)` die Zeilen

```js
    if (!this._built) this._build();
    this._update();
```

ersetzen durch

```js
    if (!this._built) this._build();
    this._update();
    this._maybePickRoom();
```

- [ ] **Step 5: Titel im Geräte-Blatt**

In `_renderEdit()` ersetzen:

```js
    this._editTitle.textContent = `Geräte · ${this._rawConfig.title}`;
```

durch:

```js
    this._editTitle.textContent = `Geräte · ${this._config.title}`;
```

- [ ] **Step 6: Tests und Syntax**

Run: `node --test && node --check elvio-room-card.js`
Expected: PASS, keine Syntaxfehler.

- [ ] **Step 7: Im Browser prüfen**

`http://localhost:8766/tablet-neu/raum?bereich=garten&disable_km`:
- Titel „Garten“, Gartenbild als Hintergrund, Licht-Kachel mit den 5 Außenlichtern, Stift „Geräte bearbeiten“ oben rechts.
- Über „Räume“ → „Garage“: Adresse `…/raum?bereich=garage`, Titel „Garage“, Garage Spot in der Licht-Kachel, Einblendung wie beim Ansichtswechsel. „Zurück“ im Browser führt zurück zu Garten.
- `http://localhost:8766/tablet-neu/raum?disable_km` (ohne Bereich): Raumübersicht öffnet sich von selbst; nach „Zurück“ bleibt sie zu.
- `…/raum?bereich=gibtsnicht`: Raumübersicht öffnet sich.
- Von `…/raum?bereich=garten` über die Leiste zu „Zuhause“: Zuhause erscheint, **keine** Raumübersicht geht auf.
- `http://localhost:8766/tablet-test/garten?disable_km` (Altmodus) unverändert.

- [ ] **Step 8: Commit**

```bash
git add elvio-room-card.js
git commit -m "Räume: gemeinsame Raum-Ansicht mit area: auto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Räume verwalten – Bearbeiten-Modus und Raum-Blatt

**Files:**
- Modify: `elvio-room-card.js` – `_buildRoomsNav`, `_openRoomsNav`, `_renderRoomsNav`, `_rebuildKeepingPlace`; neue Methoden nach `_renderRoomsNav`; CSS im `STYLE`-String.

**Interfaces:**
- Consumes: `this._rooms({includeHidden})`, `this._isAdmin()` (Task 3), `ElvioRooms.groupByFloor`, `ElvioRooms.swap`, `ElvioRooms.isLegacy`, `ROOM_ICONS` (Task 1), `this._ensureLabels()`, `LABEL_HIDE`, `setupErrText` (bestehend).
- Produces: `this._roomsEditing: boolean`, `this._roomsMsg`, `this._roomsEditBtn`, `this._openRoomForm(areaId: string|null, floorId?: string|null)`, `this._roomDraft = {areaId, name, floorId, icon, picture, temperature, shown, labels}`, `this._roomFormView: "main"|"icon"|"image"|"delete"`, `this._renderRoomForm()`, Helfer `pick(label, view, preview)` in `_renderRoomForm` (Task 6 nutzt ihn für die Bild-Zeile), `this._swapRooms(a, b)`, `this._saveRoom(button)`, `this._deleteRoom(button)`, `this._temperatureSensors(areaId): string[]`, `this._renderIconPick()`, `this._renderRoomDelete()`.

- [ ] **Step 1: Kopf der Raumübersicht mit „Bearbeiten“**

`_buildRoomsNav()` und `_openRoomsNav()` ersetzen durch:

```js
  _buildRoomsNav() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel rpanel");
    const head = el("div", "shead");
    head.appendChild(el("div", "ptitle", "Räume"));
    // Räume verwalten: nur Admins (HA lässt Bereiche nur sie ändern) und nur, wenn die Räume
    // aus HA kommen – im Altmodus stehen sie in nav, ein Bereich änderte dort nichts.
    const actions = el("div", "sactions");
    this._roomsEditBtn = el("button", "stextbtn", "Bearbeiten");
    this._roomsEditBtn.hidden = true;
    this._roomsEditBtn.addEventListener("click", () => {
      this._roomsEditing = !this._roomsEditing;
      this._roomCards = null;
      this._renderRoomsNav();
    });
    actions.appendChild(this._roomsEditBtn);
    head.appendChild(actions);
    this._roomsMsg = el("div", "emsg");
    this._roomsMsg.hidden = true;
    this._roomGrid = el("div", "roomgrid");
    panel.append(head, this._roomsMsg, this._roomGrid, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._roomsNavWrap = wrap;
    return wrap;
  }

  _openRoomsNav() {
    this._roomsNavWrap.hidden = false;
    this._roomsEditing = false;
    this._roomsMsg.hidden = true;
    this._roomCards = null;
    this._renderRoomsNav();
  }
```

- [ ] **Step 2: `_renderRoomsNav` mit Bearbeiten-Modus**

`_renderRoomsNav()` vollständig ersetzen durch:

```js
  _renderRoomsNav() {
    if (!this._roomsNavWrap || this._roomsNavWrap.hidden) return;
    const hass = this._hass;
    const canEdit = this._isAdmin() && !ElvioRooms.isLegacy(this._config.nav);
    const editing = canEdit && !!this._roomsEditing;
    this._roomsEditBtn.hidden = !canEdit;
    this._roomsEditBtn.textContent = editing ? "Fertig" : "Bearbeiten";
    if (!this._roomCards) {
      this._roomGrid.innerHTML = "";
      this._roomGrid.classList.toggle("editing", editing);
      const here = this._areaId();
      this._roomCards = [];
      const groups = ElvioRooms.groupByFloor(this._rooms({ includeHidden: editing }));
      if (editing && !groups.length) groups.push({ floorId: null, title: null, rooms: [] });
      for (const group of groups) {
        if (group.title) this._roomGrid.appendChild(el("div", "rgroup", group.title));
        group.rooms.forEach((room, i) => {
          // Im Bearbeiten-Modus ein div: Die Pfeile darin sind eigene Knöpfe.
          const card = el(editing ? "div" : "button", "roomcard");
          if (this._isCurrent(room.path) || (room.areaId && room.areaId === here)) card.classList.add("current");
          if (room.hidden) card.classList.add("hiddenroom");
          const img = el("img", "rc-img");
          img.alt = "";
          if (room.image) img.src = room.image;
          const txt = el("div", "rc-text");
          const status = el("div", "rc-status");
          txt.append(el("div", "rc-name", room.name), status);
          const ic = el("div", "rc-icon");
          ic.appendChild(icon(room.icon || "mdi:door"));
          card.append(img, txt, ic);
          if (editing) {
            card.addEventListener("click", () => this._openRoomForm(room.areaId));
            // Pfeile statt Ziehen: am Wandtablet treffsicherer. Nur innerhalb des Stockwerks.
            const moves = el("div", "rc-move");
            for (const [name, label, other] of [
              ["mdi:chevron-left", "Nach vorne", group.rooms[i - 1]],
              ["mdi:chevron-right", "Nach hinten", group.rooms[i + 1]],
            ]) {
              const b = el("button", "rc-arrow");
              b.setAttribute("aria-label", label);
              b.appendChild(icon(name));
              b.disabled = !other;
              b.addEventListener("click", (ev) => {
                ev.stopPropagation();
                if (other) this._swapRooms(room.areaId, other.areaId);
              });
              moves.appendChild(b);
            }
            card.appendChild(moves);
          } else {
            card.addEventListener("click", () => {
              this._roomsNavWrap.hidden = true;
              this._navigate(room.path);
            });
          }
          card.style.setProperty("--i", String(this._roomGrid.children.length));
          this._roomGrid.appendChild(card);
          this._roomCards.push({ room, status });
        });
        if (editing) {
          const add = el("button", "roomcard roomadd");
          add.append(icon("mdi:plus"), el("span", "", "Raum hinzufügen"));
          add.addEventListener("click", () => this._openRoomForm(null, group.floorId));
          this._roomGrid.appendChild(add);
        }
      }
    }
    // Live-Status je Raum: Lichter an, Temperatur.
    for (const { room, status } of this._roomCards) {
      if (room.hidden) {
        status.textContent = "Am Tablet ausgeblendet";
        continue;
      }
      const parts = [];
      const lights = this._roomLightIds(room).map((id) => hass.states[id]).filter(Boolean);
      if (lights.length) {
        const on = lights.filter((l) => l.state === "on").length;
        parts.push(on ? `${on} ${on === 1 ? "Licht" : "Lichter"} an` : "Licht aus");
      }
      const t = room.temperature && hass.states[room.temperature];
      if (t) {
        const v = Number(t.entity_id.startsWith("climate.") ? t.attributes.current_temperature : t.state);
        if (Number.isFinite(v)) parts.push(`${Math.round(v)}°`);
      }
      status.textContent = parts.join(" · ");
    }
  }

  // Reihenfolge: HA verlangt beim Umsortieren immer alle Bereiche – frisch holen, zwei tauschen.
  async _swapRooms(a, b) {
    this._roomsMsg.hidden = true;
    try {
      const list = await this._hass.callWS({ type: "config/area_registry/list" });
      const ids = list.map((x) => x.area_id);
      await this._hass.callWS({ type: "config/area_registry/reorder", area_ids: ElvioRooms.swap(ids, a, b) });
    } catch (err) {
      this._roomsMsg.textContent = `Nicht verschoben: ${setupErrText(err)}`;
      this._roomsMsg.hidden = false;
    }
  }
```

- [ ] **Step 3: Raum-Blatt (anlegen/ändern/löschen)**

Direkt nach `_swapRooms` einfügen:

```js
  // ───────────── Raum-Blatt ─────────────
  // Der Entwurf liegt am Objekt, damit er einen Neuaufbau übersteht (jede Registry-Änderung
  // kann die Karte neu aufbauen, siehe _rebuildKeepingPlace).

  _openRoomForm(areaId, floorId = null) {
    const a = areaId && (this._hass.areas || {})[areaId];
    this._roomDraft = a
      ? {
          areaId,
          name: a.name,
          floorId: a.floor_id || null,
          icon: a.icon || "mdi:door",
          picture: a.picture || null,
          temperature: a.temperature_entity_id || null,
          shown: !(a.labels || []).includes(LABEL_HIDE.id),
          labels: a.labels || [],
        }
      : { areaId: null, name: "", floorId, icon: "mdi:door", picture: null, temperature: null, shown: true, labels: [] };
    this._roomFormView = "main";
    this._editMode = "room";
    this._editActions.replaceChildren();
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderRoomForm();
  }

  _roomFormError(text) {
    this._editMsg.textContent = text;
    this._editMsg.hidden = false;
  }

  _renderRoomForm() {
    if (this._editMode !== "room" || this._editWrap.hidden || !this._roomDraft) return;
    const d = this._roomDraft;
    const list = this._editList;
    list.innerHTML = "";
    if (this._roomFormView === "icon") return this._renderIconPick();
    if (this._roomFormView === "delete") return this._renderRoomDelete();
    this._editTitle.textContent = d.areaId ? "Raum bearbeiten" : "Neuer Raum";
    this._editHint.textContent = "Gespeichert wird in Home Assistant – Updates ändern daran nichts.";

    const name = el("input", "einput");
    name.value = d.name;
    name.placeholder = "Name, z. B. Büro";
    name.addEventListener("input", () => (d.name = name.value));
    list.append(el("div", "esub", "Name"), name);

    const floors = Object.values(this._hass.floors || {});
    if (floors.length) {
      const chips = el("div", "echips");
      for (const f of [...floors, { floor_id: null, name: "Kein Stockwerk" }]) {
        const b = el("button", "echip", f.name);
        b.classList.toggle("on", (d.floorId || null) === (f.floor_id || null));
        b.addEventListener("click", () => {
          d.floorId = f.floor_id || null;
          this._renderRoomForm();
        });
        chips.appendChild(b);
      }
      list.append(el("div", "esub", "Stockwerk"), chips);
    }

    // Zeile, die eine Auswahl (Icon, Bild) öffnet.
    const pick = (label, view, preview) => {
      const row = el("button", "erow epick");
      const ic = el("div", "eicon");
      ic.appendChild(preview);
      row.append(ic, el("div", "etext sname", label), el("div", "ssub", "Ändern"));
      row.addEventListener("click", () => {
        this._roomFormView = view;
        this._renderRoomForm();
      });
      return row;
    };
    list.append(el("div", "esub", "Aussehen"), pick("Icon", "icon", icon(d.icon)));

    if (d.areaId) {
      const temps = this._temperatureSensors(d.areaId);
      if (temps.length) {
        const chips = el("div", "echips");
        for (const id of [...temps, null]) {
          const b = el("button", "echip", id ? this._friendly(id) : "Keine");
          b.classList.toggle("on", (d.temperature || null) === id);
          b.addEventListener("click", () => {
            d.temperature = id;
            this._renderRoomForm();
          });
          chips.appendChild(b);
        }
        list.append(el("div", "esub", "Temperatur"), chips);
      }
    }

    const show = el("div", "erow");
    const sw = el("button", "lswitch");
    sw.classList.toggle("on", d.shown);
    sw.setAttribute("aria-label", d.shown ? "Ausblenden" : "Am Tablet zeigen");
    sw.addEventListener("click", () => {
      d.shown = !d.shown;
      this._renderRoomForm();
    });
    show.append(el("div", "etext sname", "Am Tablet zeigen"), sw);
    list.appendChild(show);

    const save = el("button", "pbtn unlock esave", d.areaId ? "Speichern" : "Raum anlegen");
    save.addEventListener("click", () => this._saveRoom(save));
    list.appendChild(save);
    if (d.areaId) {
      const del = el("button", "stextbtn edanger", "Raum löschen");
      del.addEventListener("click", () => {
        this._roomFormView = "delete";
        this._renderRoomForm();
      });
      list.appendChild(del);
    }
  }

  // Temperatursensoren im Bereich (direkt oder über ihr Gerät) – Auswahl für die Statuszeile.
  _temperatureSensors(areaId) {
    const hass = this._hass;
    return Object.values(hass.entities || {})
      .filter((e) => e.entity_id.startsWith("sensor.") && this._entityArea(e) === areaId)
      .filter((e) => {
        const st = hass.states[e.entity_id];
        return st && st.attributes.device_class === "temperature";
      })
      .map((e) => e.entity_id);
  }

  _renderIconPick() {
    const d = this._roomDraft;
    this._editTitle.textContent = "Icon wählen";
    this._editHint.textContent = "";
    const grid = el("div", "iconpick");
    for (const name of ROOM_ICONS) {
      const b = el("button", "ipick");
      b.classList.toggle("on", d.icon === name);
      b.setAttribute("aria-label", name.replace("mdi:", ""));
      b.appendChild(icon(name));
      b.addEventListener("click", () => {
        d.icon = name;
        this._roomFormView = "main";
        this._renderRoomForm();
      });
      grid.appendChild(b);
    }
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._roomFormView = "main";
      this._renderRoomForm();
    });
    this._editList.append(grid, back);
  }

  _renderRoomDelete() {
    const d = this._roomDraft;
    const hass = this._hass;
    // Geräte des Bereichs plus Entitäten ohne Gerät, die direkt im Bereich stehen.
    const n =
      Object.values(hass.devices || {}).filter((x) => x.area_id === d.areaId).length +
      Object.values(hass.entities || {}).filter((e) => !e.device_id && e.area_id === d.areaId).length;
    this._editTitle.textContent = "Raum löschen";
    this._editHint.textContent = "";
    const box = el("div", "cbox");
    box.append(
      icon("mdi:delete-outline"),
      el("div", "ctitle", `„${d.name}“ löschen?`),
      el(
        "div",
        "ctext",
        n
          ? `${n} ${n === 1 ? "Gerät ist" : "Geräte sind"} dann ohne Raum und lassen sich unter „Geräte bearbeiten“ neu zuordnen.`
          : "Diesem Raum ist nichts zugeordnet.",
      ),
    );
    const go = el("button", "pbtn edangerbtn", "Löschen");
    go.addEventListener("click", () => this._deleteRoom(go));
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._roomFormView = "main";
      this._renderRoomForm();
    });
    box.append(go, back);
    this._editList.appendChild(box);
  }

  async _saveRoom(button) {
    const d = this._roomDraft;
    const name = d.name.trim();
    if (!name) return this._roomFormError("Bitte einen Namen eingeben.");
    this._editMsg.hidden = true;
    button.disabled = true;
    const labels = new Set(d.labels);
    if (d.shown) labels.delete(LABEL_HIDE.id);
    else labels.add(LABEL_HIDE.id);
    const data = { name, floor_id: d.floorId, icon: d.icon, picture: d.picture, labels: [...labels] };
    try {
      if (!d.shown) await this._ensureLabels();
      if (d.areaId) {
        await this._hass.callWS({ type: "config/area_registry/update", area_id: d.areaId, ...data, temperature_entity_id: d.temperature });
      } else {
        await this._hass.callWS({ type: "config/area_registry/create", ...data });
      }
      this._roomDraft = null;
      this._editWrap.hidden = true;
    } catch (err) {
      button.disabled = false;
      this._roomFormError(`Nicht gespeichert: ${setupErrText(err)}`);
    }
  }

  async _deleteRoom(button) {
    const d = this._roomDraft;
    button.disabled = true;
    try {
      await this._hass.callWS({ type: "config/area_registry/delete", area_id: d.areaId });
      this._roomDraft = null;
      this._editWrap.hidden = true;
      // Zeigt die Raum-Ansicht gerade diesen Raum, geht es zur Raumübersicht.
      if (this._rawConfig.area === "auto" && ElvioRooms.areaFromLocation(location.search) === d.areaId) {
        this._navigate(ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path));
      }
    } catch (err) {
      button.disabled = false;
      this._roomFormError(`Nicht gelöscht: ${setupErrText(err)}`);
    }
  }
```

- [ ] **Step 4: Offene Blätter beim Neuaufbau behalten**

`_rebuildKeepingPlace()` ersetzen durch:

```js
  _rebuildKeepingPlace() {
    const top = this._scroller ? this._scroller.scrollTop : 0;
    const open = this._editWrap && !this._editWrap.hidden;
    const editing = open && this._editMode === "devices";
    const roomForm = open && this._editMode === "room" && !!this._roomDraft;
    const roomsOpen = this._roomsNavWrap && !this._roomsNavWrap.hidden;
    this._build(true);
    this._update();
    this._scroller.scrollTop = top;
    if (editing) this._openEdit();
    // Raumübersicht (auch im Bearbeiten-Modus) und Raum-Blatt mit Entwurf bleiben offen.
    if (roomsOpen) {
      this._roomsNavWrap.hidden = false;
      this._roomCards = null;
      this._renderRoomsNav();
    }
    if (roomForm) {
      this._editMode = "room";
      this._editActions.replaceChildren();
      this._editWrap.hidden = false;
      this._renderRoomForm();
    }
  }
```

- [ ] **Step 5: CSS**

Im `STYLE`-String direkt nach den `.rgroup`-Regeln aus Task 3 einfügen:

```css
.roomgrid.editing .roomcard { cursor: pointer; }
.roomcard.hiddenroom .rc-img { filter: grayscale(1) brightness(.5); }
.roomcard.hiddenroom .rc-text { opacity: .6; }
.rc-move { position: absolute; top: 10px; right: 10px; z-index: 2; display: flex; gap: 6px; }
.rc-arrow { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(0,0,0,.45); --mdc-icon-size: 20px; }
.rc-arrow:disabled { opacity: .25; cursor: default; }
.roomadd { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  border-style: dashed; font-size: 14px; font-weight: 600; --mdc-icon-size: 26px; }
.roomadd::after { display: none; }
.einput { width: 100%; height: 48px; padding: 0 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,.2);
  background: rgba(255,255,255,.08); color: inherit; font: inherit; font-size: 16px; outline: none; }
.einput:focus { border-color: rgba(255,255,255,.6); }
.echips { display: flex; flex-wrap: wrap; gap: 8px; }
.echip { height: 38px; padding: 0 16px; border-radius: 999px; background: rgba(255,255,255,.1); font-size: 14px; }
.echip.on { background: rgba(255,255,255,.9); color: #1f1f1f; }
.esave { flex: none; margin-top: 24px; }
.stextbtn.edanger { color: #ff6b61; margin-top: 14px; align-self: center; }
.pbtn.edangerbtn { flex: none; width: 100%; background: #ff453a; color: #fff; }
.iconpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 10px; margin-bottom: 16px; }
.ipick { height: 64px; border-radius: 16px; display: grid; place-items: center; background: rgba(255,255,255,.08);
  --mdc-icon-size: 28px; }
.ipick.on { background: rgba(255,255,255,.9); color: #1f1f1f; }
```

- [ ] **Step 6: Tests und Syntax**

Run: `node --test && node --check elvio-room-card.js`
Expected: PASS, keine Syntaxfehler.

- [ ] **Step 7: Im Browser prüfen (Admin)**

`http://localhost:8766/tablet-neu/raum?bereich=garten&disable_km` → „Räume“:
- Oben rechts „Bearbeiten“. Im Altmodus (`/tablet-test/…`) fehlt der Knopf.
- „Bearbeiten“: Pfeile an jedem Raum, am Ende jedes Stockwerks „+ Raum hinzufügen“, Knopf heißt „Fertig“.
- „+ Raum hinzufügen“ im Erdgeschoss: Blatt „Neuer Raum“, Stockwerk „Erdgeschoss“ vorgewählt. Name „Testraum“, Icon „Schreibtisch“ wählen, „Raum anlegen“ → Blatt schließt, „Testraum“ erscheint im Erdgeschoss (auch in HA unter Einstellungen → Bereiche).
- Pfeil „Nach vorne“ an „Testraum“: tauscht mit dem Nachbarn; Reihenfolge stimmt auch in HA.
- „Testraum“ antippen → umbenennen in „Testraum 2“, „Am Tablet zeigen“ aus, Speichern → Karte ausgegraut mit „Am Tablet ausgeblendet“; nach „Fertig“ ist der Raum nicht mehr in der Übersicht.
- Wieder „Bearbeiten“ → „Testraum 2“ → „Raum löschen“ → Rückfrage „Diesem Raum ist nichts zugeordnet.“ → „Löschen“ → Raum weg (auch in HA).
- Leeren Namen speichern → „Bitte einen Namen eingeben.“; Namen eines vorhandenen Raums („Garage“) beim Anlegen → „Nicht gespeichert: …“.
- Während das Raum-Blatt offen ist, in HA einen anderen Bereich umbenennen → Blatt bleibt offen mit eingetipptem Namen.

- [ ] **Step 8: Commit**

```bash
git add elvio-room-card.js
git commit -m "Räume verwalten: anlegen, ändern, sortieren, ausblenden, löschen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Raumbild – Galerie und eigenes Foto

**Files:**
- Modify: `elvio-room-card.js` – `_renderRoomForm` (Bild-Zeile, Ansicht `"image"`), neue Methoden `_renderImagePick`, `_uploadRoomPhoto`; CSS.

**Interfaces:**
- Consumes: `pick(label, view, preview)` in `_renderRoomForm`, `this._roomDraft.picture`, `this._roomFormView` (Task 5), `IMAGE_BASE`, `BUNDLED_IMAGES`, `ROOM_PHOTO_MAX` (Task 1), `hass.fetchWithAuth`.
- Produces: `this._uploadRoomPhoto(file: File): Promise<string>` (Adresse `/api/image/serve/<id>/original`).

- [ ] **Step 1: Bild-Zeile und Bild-Ansicht im Raum-Blatt**

In `_renderRoomForm()` die Zeile

```js
    if (this._roomFormView === "delete") return this._renderRoomDelete();
```

ergänzen um (direkt darunter):

```js
    if (this._roomFormView === "image") return this._renderImagePick();
```

und die Zeile

```js
    list.append(el("div", "esub", "Aussehen"), pick("Icon", "icon", icon(d.icon)));
```

ersetzen durch:

```js
    let preview = icon("mdi:image-off-outline");
    if (d.picture) {
      preview = el("img", "ethumb");
      preview.alt = "";
      preview.src = d.picture;
    }
    list.append(
      el("div", "esub", "Aussehen"),
      pick("Icon", "icon", icon(d.icon)),
      pick(d.picture ? "Bild" : "Bild: keins", "image", preview),
    );
```

- [ ] **Step 2: Galerie und Upload**

Nach `_renderIconPick()` einfügen:

```js
  _renderImagePick() {
    const d = this._roomDraft;
    this._editTitle.textContent = "Bild wählen";
    this._editHint.textContent = "Eigenes Foto: Am Tablet öffnet sich die Kamera oder die Fotos.";
    const grid = el("div", "imgpick");
    const choose = (url) => {
      d.picture = url;
      this._roomFormView = "main";
      this._renderRoomForm();
    };
    // label statt button: Ein Tipp öffnet die Dateiauswahl ohne eigenes Skript.
    const own = el("label", "impick imtext");
    const input = el("input");
    input.type = "file";
    input.accept = "image/*";
    const ownText = el("span", "", "Eigenes Foto");
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      own.classList.add("busy");
      ownText.textContent = "Lade hoch …";
      try {
        choose(await this._uploadRoomPhoto(file));
      } catch (err) {
        own.classList.remove("busy");
        ownText.textContent = "Eigenes Foto";
        this._roomFormError(`Foto nicht hochgeladen: ${setupErrText(err)}`);
      }
    });
    own.append(input, icon("mdi:camera-outline"), ownText);
    const none = el("button", "impick imtext");
    none.classList.toggle("on", !d.picture);
    none.append(icon("mdi:image-off-outline"), el("span", "", "Kein Bild"));
    none.addEventListener("click", () => choose(null));
    grid.append(own, none);
    for (const name of BUNDLED_IMAGES) {
      const url = `${IMAGE_BASE}${name}.jpg`;
      const b = el("button", "impick");
      b.classList.toggle("on", d.picture === url);
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = url;
      b.appendChild(img);
      b.addEventListener("click", () => choose(url));
      grid.appendChild(b);
    }
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._roomFormView = "main";
      this._renderRoomForm();
    });
    this._editList.append(grid, back);
  }

  // Foto verkleinern (längste Kante ROOM_PHOTO_MAX) und über HAs Bild-Upload ablegen – derselbe
  // Weg wie Bereichsbilder in der HA-Oberfläche. Die Adresse lädt ohne Anmeldung, taugt also
  // als Hintergrund. Ein ersetztes Foto bleibt in HA liegen (Einstellungen → Bereiche zeigt es nicht mehr).
  async _uploadRoomPhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, ROOM_PHOTO_MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild ließ sich nicht umwandeln"))), "image/jpeg", 0.85),
    );
    const form = new FormData();
    form.append("file", blob, "raum.jpg");
    const resp = await this._hass.fetchWithAuth("/api/image/upload", { method: "POST", body: form });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return `/api/image/serve/${data.id}/original`;
  }
```

- [ ] **Step 3: CSS**

Im `STYLE`-String nach den Regeln aus Task 5 einfügen:

```css
.ethumb { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; }
.imgpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
.impick { position: relative; height: 96px; border-radius: 14px; overflow: hidden; background: rgba(255,255,255,.08);
  border: 2px solid transparent; cursor: pointer; }
.impick img { width: 100%; height: 100%; object-fit: cover; display: block; }
.impick.on { border-color: rgba(255,255,255,.9); }
.impick.imtext { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  font-size: 14px; font-weight: 600; --mdc-icon-size: 26px; }
.impick input { display: none; }
.impick.busy { opacity: .6; pointer-events: none; }
```

- [ ] **Step 4: Tests und Syntax**

Run: `node --test && node --check elvio-room-card.js`
Expected: PASS, keine Syntaxfehler.

- [ ] **Step 5: Im Browser prüfen**

`/tablet-neu/raum?bereich=garage&disable_km` → Räume → Bearbeiten → „Garage“:
- Zeile „Bild“ zeigt das Garagenbild als Vorschau; „Ändern“ → Galerie mit „Eigenes Foto“, „Kein Bild“ und 12 Bildern, das Garagenbild ist markiert.
- „Kein Bild“ → Speichern: Garage hat in der Übersicht wieder das Bild aus dem Kartenpaket (Ersatz über den Namen), in HA ist `picture` leer.
- „Eigenes Foto“ mit einem großen JPEG (z. B. ein Handyfoto > 3 MB): „Lade hoch …“, danach Vorschau mit dem Foto; Speichern → Raum-Ansicht Garage zeigt das Foto als Hintergrund. In HA (Einstellungen → Bereiche → Garage) ist dasselbe Foto zu sehen.
- Netzwerk-Tab: Upload kleiner als 1 MB, Bildgröße höchstens 1920 px.
- Zum Schluss Garage wieder auf „Kein Bild“ stellen und das Testfoto löschen: in der Seite `await document.querySelector("home-assistant").hass.callWS({type: "image/list"})` → ID suchen → `callWS({type: "image/delete", image_id: "<id>"})`.

- [ ] **Step 6: Commit**

```bash
git add elvio-room-card.js
git commit -m "Räume verwalten: Bild aus der Galerie oder eigenes Foto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Umstellungsplan (reine Logik)

**Files:**
- Modify: `elvio-room-card.js` – `ElvioRooms` um `isRoomCardType`, `blockReason`, `migrationPlan`, `areaPatch`, `orderFirst` erweitern (vor der schließenden `};` von `ElvioRooms`).
- Create: `test/migration.test.mjs`

**Interfaces:**
- Consumes: `AUTO_DOMAINS` (bestehend), `ElvioRooms` (Task 1).
- Produces:
  - `ElvioRooms.isRoomCardType(type: string): boolean` (`custom:elvio-room-card` und `custom:elvio-room-card-dev`)
  - `ElvioRooms.blockReason(view, areaId: string|null, ctx): string|null`
  - `ElvioRooms.migrationPlan(config, ctx): {blocked: {room, reason}[], rooms: {name, areaId: string|null, icon, image, temperature}[], config}`; `ctx = {resolveArea(key): string|null, entityArea(entityId): string|null}`
  - `ElvioRooms.areaPatch(area, room): {icon?, picture?, temperature_entity_id?}`
  - `ElvioRooms.orderFirst(allIds: string[], firstIds: string[]): string[]`

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`test/migration.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioRooms: R } = loadCard();
const T = "custom:elvio-room-card";
const NAV = [
  { name: "Zuhause", path: "/d/zuhause", icon: "mdi:home-outline" },
  { name: "Bad", path: "/d/bad", icon: "mdi:shower", room: true, image: "/b/bad.jpg", temperature: "sensor.bad" },
  { name: "Keller", path: "/d/keller", room: true },
  { name: "Einstellungen", path: "/d/einstellungen", icon: "mdi:cog-outline" },
];
const card = (extra) => ({ type: T, brand: "{name}.", nav: NAV, screensaver: { after: 180 }, ...extra });
const view = (path, extra) => ({ title: path, path, type: "panel", cards: [card({ title: path, ...extra })] });
const config = () => ({
  kiosk_mode: { non_admin_settings: { hide_sidebar: true } },
  views: [
    view("zuhause", { tiles: [{ type: "weather", entity: "weather.home" }] }),
    view("bad", { area: "Bad", background: "/v/bad.jpg", tiles: [{ type: "lights", name: "Licht", entities: [] }] }),
    view("keller", { tiles: [{ type: "lights", name: "Licht", entities: [] }] }),
    view("einstellungen", { tiles: [{ type: "setup" }] }),
  ],
});
const ctx = (entityAreas = {}) => ({
  resolveArea: (k) => ({ Bad: "bad" })[k] || null,
  entityArea: (id) => entityAreas[id] || null,
});

test("isRoomCardType: echte und Entwickler-Karte", () => {
  assert.equal(R.isRoomCardType("custom:elvio-room-card"), true);
  assert.equal(R.isRoomCardType("custom:elvio-room-card-dev"), true);
  assert.equal(R.isRoomCardType("entities"), false);
});

test("migrationPlan: schlichte Räume → eine Ansicht raum, nav ohne Räume", () => {
  const plan = R.migrationPlan(config(), ctx());
  assert.deepEqual(plan.blocked, []);
  assert.deepEqual(plan.rooms, [
    { name: "Bad", areaId: "bad", icon: "mdi:shower", image: "/b/bad.jpg", temperature: "sensor.bad" },
    { name: "Keller", areaId: null, icon: null, image: null, temperature: null },
  ]);
  const v = plan.config.views;
  assert.deepEqual(v.map((x) => x.path), ["zuhause", "raum", "einstellungen"]);
  const plainNav = NAV.filter((i) => !i.room);
  for (const x of v) assert.deepEqual(x.cards[0].nav, plainNav);
  assert.deepEqual(v[1].cards[0], {
    type: T, brand: "{name}.", nav: plainNav, screensaver: { after: 180 },
    title: "Raum", area: "auto", tiles: [{ type: "lights", name: "Licht", entities: [] }],
  });
  assert.deepEqual(plan.config.kiosk_mode, { non_admin_settings: { hide_sidebar: true } });
  assert.deepEqual(v[0].cards[0].tiles, [{ type: "weather", entity: "weather.home" }]);
});

test("migrationPlan: Bild/Temperatur der Ansicht, wenn nav nichts hat", () => {
  const cfg = config();
  cfg.views[0].cards[0].nav = cfg.views[0].cards[0].nav.map((i) => (i.name === "Bad" ? { ...i, image: undefined, temperature: undefined } : i));
  cfg.views[1].cards[0].nav = cfg.views[0].cards[0].nav;
  cfg.views[1].cards[0].temperature = "sensor.v";
  const plan = R.migrationPlan(cfg, ctx());
  assert.equal(plan.rooms[0].image, "/v/bad.jpg");
  assert.equal(plan.rooms[0].temperature, "sensor.v");
});

test("blockReason: Licht aus anderem Raum, fremde Kachel, Abschnitte, Chips", () => {
  const c = ctx({ "light.bad": "bad", "light.flur": "flur", "cover.bad": "bad" });
  const v = (extra) => view("bad", { area: "Bad", tiles: [{ type: "lights", name: "Licht", entities: [] }], ...extra });
  assert.equal(R.blockReason(v({ tiles: [{ type: "lights", entities: ["light.bad"] }] }), "bad", c), null);
  assert.equal(R.blockReason(v({ tiles: [{ type: "entity", entity: "cover.bad" }] }), "bad", c), null);
  assert.match(R.blockReason(v({ tiles: [{ type: "lights", entities: ["light.flur"] }] }), "bad", c), /light\.flur gehört nicht zu diesem Raum/);
  assert.match(R.blockReason(v({ tiles: [{ type: "weather", entity: "weather.home", name: "Wetter" }] }), "bad", c), /„Wetter“ erscheint nicht von selbst/);
  assert.match(R.blockReason(v({ sections: [{ title: "x", tiles: [] }] }), "bad", c), /Abschnitte/);
  assert.match(R.blockReason(v({ chips: ["offen"] }), "bad", c), /Chips/);
  assert.match(R.blockReason({ cards: [card({}), card({})] }, "bad", c), /mehr als die Raumkarte/);
  assert.match(R.blockReason(v({ tiles: [{ type: "lights", entities: ["light.bad"] }] }), null, c), /noch keinen Bereich/);
});

test("migrationPlan: blockiert und nennt Raum und Grund", () => {
  const cfg = config();
  cfg.views[1].cards[0].tiles = [{ type: "lights", entities: ["light.flur"] }];
  const plan = R.migrationPlan(cfg, ctx({ "light.flur": "flur" }));
  assert.deepEqual(plan.blocked, [{ room: "Bad", reason: "light.flur gehört nicht zu diesem Raum" }]);
});

test("migrationPlan: vorhandene Ansicht raum blockiert", () => {
  const cfg = config();
  cfg.views.push(view("raum", { tiles: [{ type: "setup" }] }));
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, [{ room: "raum", reason: "es gibt schon eine Ansicht mit dem Pfad raum" }]);
});

test("migrationPlan: Entwickler-Karte wird erkannt und bleibt Entwickler-Karte", () => {
  const cfg = JSON.parse(JSON.stringify(config()).replaceAll(`"${T}"`, `"${T}-dev"`));
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, []);
  assert.equal(plan.config.views[1].cards[0].type, `${T}-dev`);
});

test("areaPatch: nur Leeres ergänzen, Temperatur nur von Sensoren", () => {
  const room = { icon: "mdi:shower", image: "/b.jpg", temperature: "sensor.t" };
  assert.deepEqual(R.areaPatch({ icon: null, picture: null, temperature_entity_id: null }, room), {
    icon: "mdi:shower", picture: "/b.jpg", temperature_entity_id: "sensor.t",
  });
  assert.deepEqual(R.areaPatch({ icon: "mdi:x", picture: "/p.jpg", temperature_entity_id: "sensor.a" }, room), {});
  assert.deepEqual(R.areaPatch({}, { icon: null, image: null, temperature: "climate.bad" }), {});
});

test("orderFirst: genannte zuerst, ohne Doppel und Unbekannte, Rest in alter Reihenfolge", () => {
  assert.deepEqual(R.orderFirst(["a", "b", "c", "d"], ["c", "x", "a", "c"]), ["c", "a", "b", "d"]);
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `node --test`
Expected: FAIL – `R.isRoomCardType is not a function` (u. a.).

- [ ] **Step 3: Funktionen in `ElvioRooms` ergänzen**

In `ElvioRooms` nach `swap(ids, a, b) {…},` einfügen:

```js
  // ── Umstellung alter Dashboards (Räume in nav → Räume aus HA) ──

  isRoomCardType(type) {
    return type === "custom:elvio-room-card" || type === "custom:elvio-room-card-dev";
  },

  // Warum eine alte Raum-Ansicht nicht verlustfrei in die gemeinsame Ansicht passt (null = passt).
  // Verlustfrei heißt: Alles, was sie zeigt, sammelt die Karte im neuen Modus von selbst ein.
  blockReason(view, areaId, ctx) {
    const cards = view.cards || [];
    if (cards.length !== 1 || !ElvioRooms.isRoomCardType(cards[0].type)) return "die Ansicht hat mehr als die Raumkarte";
    const card = cards[0];
    if ((card.sections || []).length) return "eigene Abschnitte (sections)";
    if ((card.chips || []).length) return "eigene Chips";
    for (const t of card.tiles || []) {
      const ids = t.type === "lights" ? t.entities || [] : t.entity ? [t.entity] : [];
      if (!areaId && ids.length) return "der Raum hat noch keinen Bereich, zeigt aber eigene Geräte";
      if (t.type !== "lights" && (!t.entity || !AUTO_DOMAINS.includes(String(t.entity).split(".")[0]))) {
        return `Kachel „${t.name || t.type}“ erscheint nicht von selbst`;
      }
      const foreign = ids.find((id) => ctx.entityArea(id) !== areaId);
      if (foreign) return `${foreign} gehört nicht zu diesem Raum`;
    }
    return null;
  },

  // Plan für die Umstellung – schreibt nichts. Liefert, was blockiert, welche Räume in welche
  // Bereiche gehen und die neue Dashboard-Konfiguration (Raum-Ansichten → eine Ansicht raum).
  migrationPlan(config, ctx) {
    const views = config.views || [];
    const cardOf = (v) => (v.cards || [])[0];
    const first = views.map(cardOf).find((c) => c && ElvioRooms.isRoomCardType(c.type));
    const nav = (first && first.nav) || [];
    const plainNav = nav.filter((i) => !(i && i.room));
    const blocked = [];
    const rooms = [];
    const roomViews = new Set();
    for (const r of nav.filter((i) => i && i.room)) {
      const vi = views.findIndex((v) => v.path && r.path && r.path.endsWith(`/${v.path}`));
      const areaId = ctx.resolveArea(r.area || r.name);
      const card = vi >= 0 ? cardOf(views[vi]) : null;
      if (vi >= 0) {
        roomViews.add(vi);
        const why = ElvioRooms.blockReason(views[vi], areaId, ctx);
        if (why) blocked.push({ room: r.name, reason: why });
      }
      rooms.push({
        name: r.name,
        areaId,
        icon: r.icon || null,
        image: r.image || (card && card.background) || null,
        temperature: r.temperature || (card && card.temperature) || null,
      });
    }
    if (views.some((v, i) => v.path === "raum" && !roomViews.has(i))) {
      blocked.push({ room: "raum", reason: "es gibt schon eine Ansicht mit dem Pfad raum" });
    }
    // Vorlage für die gemeinsame Ansicht: die erste Raum-Ansicht ohne ihre raumeigenen Teile.
    const tpl = (roomViews.size && cardOf(views[[...roomViews][0]])) || first || { type: "custom:elvio-room-card" };
    const { area, title, background, tiles, sections, temperature, chips, ...base } = tpl;
    const roomView = {
      title: "Raum",
      path: "raum",
      type: "panel",
      cards: [{ ...base, nav: plainNav, title: "Raum", area: "auto", tiles: [{ type: "lights", name: "Licht", entities: [] }] }],
    };
    const kept = views
      .filter((_, i) => !roomViews.has(i))
      .map((v) => ({
        ...v,
        cards: (v.cards || []).map((c) => (c && ElvioRooms.isRoomCardType(c.type) && c.nav ? { ...c, nav: plainNav } : c)),
      }));
    kept.splice(Math.min(1, kept.length), 0, roomView);
    return { blocked, rooms, config: { ...config, views: kept } };
  },

  // Nur ergänzen, was der Bereich noch nicht hat. Temperatur nur von Sensoren – HA nimmt als
  // Temperatur eines Bereichs nur einen Sensor (alte Dashboards erlaubten auch climate.*).
  areaPatch(area, room) {
    const patch = {};
    if (!area.icon && room.icon) patch.icon = room.icon;
    if (!area.picture && room.image) patch.picture = room.image;
    if (!area.temperature_entity_id && room.temperature && room.temperature.startsWith("sensor.")) {
      patch.temperature_entity_id = room.temperature;
    }
    return patch;
  },

  orderFirst(allIds, firstIds) {
    const first = [...new Set(firstIds.filter((id) => allIds.includes(id)))];
    return [...first, ...allIds.filter((id) => !first.includes(id))];
  },
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test && node --check elvio-room-card.js`
Expected: PASS (`# fail 0`), keine Syntaxfehler.

- [ ] **Step 5: Commit**

```bash
git add elvio-room-card.js test/migration.test.mjs
git commit -m "Umstellung: Plan für alte Dashboards (rein, mit Tests)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Einrichtungspunkt „Räume aus Home Assistant“

**Files:**
- Modify: `elvio-room-card.js` – `_collectSetup` (vor `return items;`), neue Methode `_migrateRooms` nach `_runSetup`.

**Interfaces:**
- Consumes: `ElvioRooms.isLegacy`, `migrationPlan`, `areaPatch`, `orderFirst` (Tasks 1, 7), `this._resolveArea`, `this._entityArea`, `_runSetup` (bestehend; zeigt Schritte, Fehler als `${item.name}: …`, lädt bei `"reload"` neu).
- Produces: Setup-Eintrag `{id: "rooms", …}`; `this._migrateRooms(step, dash): Promise<"reload">`. (Ruling 11: `migrationPlan`-ctx enthält zusätzlich `isCollected(id)`.)

- [ ] **Step 1: Eintrag in `_collectSetup`**

In `_collectSetup(dash)` direkt vor `return items;` einfügen:

```js
    // Altes Dashboard (Räume in nav): auf Räume aus HA umstellen. Prüft vor jedem Schreiben,
    // sichert das Dashboard und baut erst danach um.
    if (ElvioRooms.isLegacy(this._rawConfig.nav)) {
      items.push({
        id: "rooms",
        icon: "mdi:floor-plan",
        name: "Räume aus Home Assistant",
        sub: "Räume am Tablet verwalten (anlegen, umbenennen, Bild). Das Dashboard wird vorher gesichert.",
        done: false,
        run: (step) => this._migrateRooms(step, dash),
      });
    }
```

- [ ] **Step 2: `_migrateRooms`**

Nach `async _runSetup(item, button, txt) {…}` einfügen:

```js
  async _migrateRooms(step, dash) {
    const hass = this._hass;
    const ws = (msg) => hass.callWS(msg);
    const urlPath = dash === "lovelace" ? null : dash;

    step("Prüfe das Dashboard …");
    const dashboards = await ws({ type: "lovelace/dashboards/list" });
    const meta = dashboards.find((d) => d.url_path === dash);
    if (meta && meta.mode === "yaml") throw new Error("YAML-Dashboard – bitte von Hand umstellen (README: Räume aus Home Assistant)");
    const config = await ws({ type: "lovelace/config", url_path: urlPath });
    const plan = ElvioRooms.migrationPlan(config, {
      resolveArea: (k) => this._resolveArea(k),
      entityArea: (id) => this._entityArea((hass.entities || {})[id]),
      // Was die Automatik im neuen Modus einsammelt (_areaEntities): nicht versteckt, nicht technisch, mit Zustand.
      isCollected: (id) => {
        const e = (hass.entities || {})[id];
        return !!(e && !e.hidden && !e.entity_category && hass.states[id]);
      },
    });
    if (plan.blocked.length) {
      throw new Error(`nicht umgestellt – ${plan.blocked.map((b) => `${b.room}: ${b.reason}`).join("; ")}`);
    }

    // Sicherung zuerst: Erst wenn die Kopie gespeichert ist, wird irgendetwas geändert.
    step("Sichere das Dashboard …");
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const taken = new Set(dashboards.map((d) => d.url_path));
    const stem = `${dash === "lovelace" ? "uebersicht" : dash}-sicherung-${stamp}`;
    let backup = stem;
    for (let i = 2; taken.has(backup); i++) backup = `${stem}-${i}`;
    await ws({
      type: "lovelace/dashboards/create",
      url_path: backup,
      title: `${(meta && meta.title) || "Dashboard"} (Sicherung ${now.toLocaleDateString("de-DE")})`,
      icon: "mdi:content-save-outline",
      show_in_sidebar: false,
      require_admin: true,
      mode: "storage",
    });
    await ws({ type: "lovelace/config/save", url_path: backup, config });

    step("Übernehme die Räume …");
    for (const room of plan.rooms) {
      if (!room.areaId) {
        const made = await ws({ type: "config/area_registry/create", name: room.name, icon: room.icon || undefined, picture: room.image || undefined });
        room.areaId = made.area_id;
        continue;
      }
      const { temperature_entity_id, ...patch } = ElvioRooms.areaPatch((hass.areas || {})[room.areaId] || {}, room);
      if (Object.keys(patch).length) await ws({ type: "config/area_registry/update", area_id: room.areaId, ...patch });
      // Einen Temperatursensor lehnt HA ab, wenn er keiner ist – das soll die Umstellung nicht kippen.
      if (temperature_entity_id) {
        await ws({ type: "config/area_registry/update", area_id: room.areaId, temperature_entity_id }).catch(() => null);
      }
    }

    step("Sortiere die Räume …");
    const all = (await ws({ type: "config/area_registry/list" })).map((a) => a.area_id);
    await ws({ type: "config/area_registry/reorder", area_ids: ElvioRooms.orderFirst(all, plan.rooms.map((r) => r.areaId)) });

    step("Baue das Dashboard um …");
    await ws({ type: "lovelace/config/save", url_path: urlPath, config: plan.config });
    return "reload";
  }
```

- [ ] **Step 3: Tests und Syntax**

Run: `node --test && node --check elvio-room-card.js`
Expected: PASS, keine Syntaxfehler.

- [ ] **Step 4: Umstellung am Test-Dashboard (Altmodus-Kopie) prüfen**

Vorher Reihenfolge und Felder der Bereiche notieren (in der Seite):
`(await document.querySelector("home-assistant").hass.callWS({type: "config/area_registry/list"})).map(a => [a.area_id, a.icon, a.picture])`

`http://localhost:8766/tablet-test/einstellungen?disable_km` → Einrichtung:
- Neuer Punkt „Räume aus Home Assistant“ mit „Einrichten“.
- „Einrichten“: Schritte „Prüfe …“, „Sichere …“, „Übernehme …“, „Sortiere …“, „Baue um …“, dann „Fertig – die Seite lädt neu“.
- Danach: Leiste „Zuhause · Räume · Einstellungen“; Räume gruppiert nach Stockwerk in der alten nav-Reihenfolge; „Gaestezimmer“ mit dem Unsplash-Bild; jede Raum-Ansicht `…/raum?bereich=…` zeigt dieselben Lichter wie vorher.
- HA → Dashboards: „Tablet Test (Altmodus) (Sicherung 16.11.2026)“ (nicht in der Seitenleiste) mit der alten Konfiguration.
- HA → Bereiche: Icons/Bilder ergänzt, nur wo vorher leer.
- Der Einrichtungspunkt ist danach verschwunden (Dashboard ist im neuen Modus).
- Gegenprobe Blockieren: Sicherung als `tablet-test` zurückspielen (`lovelace/config/save` mit der Konfiguration aus `tablet-test-sicherung-…`), in der Ansicht `wohnbereich` der Licht-Kachel `light.garage_garage_spot` hinzufügen, Einrichtung erneut → Meldung „Räume aus Home Assistant: nicht umgestellt – Wohnbereich: light.garage_garage_spot gehört nicht zu diesem Raum“, keine neue Sicherung, nichts geändert.
- Danach `tablet-test` wieder aus der Sicherung herstellen, Sicherungs-Dashboards löschen (`lovelace/dashboards/delete` mit `dashboard_id`).

- [ ] **Step 5: Commit**

```bash
git add elvio-room-card.js
git commit -m "Einrichtung: alte Dashboards auf Räume aus HA umstellen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Dokumentation und Übergabe zur lokalen Sichtung

**Files:**
- Modify: `README.md` – neuer Abschnitt nach „## Verwendung“ … „### Kacheltypen“-Block, Tabelle der Einrichtungspunkte, neuer Abschnitt „## Entwicklung“ am Ende.
- Modify: `EINRICHTEN-MIT-CLAUDE.md` – Schritt 3 (Aufbau) und Referenz.

**Interfaces:**
- Consumes: alles aus Tasks 1–8.
- Produces: Doku; kein Code.

- [ ] **Step 1: README – Abschnitt „Räume aus Home Assistant“**

In `README.md` direkt vor `## Gegensprechen über SIP Core` einfügen:

````markdown
## Räume aus Home Assistant

Ab v1.6.0 sind Räume die **Bereiche** in Home Assistant. Name, Icon, Bild, Temperatursensor,
Stockwerk und Reihenfolge stehen im Bereich; das Dashboard braucht nur noch drei Ansichten:

```yaml
basis: &basis
  type: custom:elvio-room-card
  brand: "{name}."
  menu_path: /lovelace/0
  nav:
    - {name: Zuhause, path: /dashboard-tablet/zuhause, icon: mdi:home-outline}
    - {name: Einstellungen, path: /dashboard-tablet/einstellungen, icon: mdi:cog-outline}

views:
  - {title: Zuhause, path: zuhause, type: panel, cards: [{<<: *basis, title: Zuhause, tiles: [...]}]}
  - title: Raum
    path: raum
    type: panel
    cards:
      - <<: *basis
        title: Raum
        area: auto                       # Raum kommt aus der Adresse: …/raum?bereich=<id>
        tiles: [{type: lights, name: Licht, entities: []}]
  - {title: Einstellungen, path: einstellungen, type: panel, cards: [{<<: *basis, title: Einstellungen, tiles: [{type: setup}]}]}
```

- **Leiste:** „Räume“ erscheint hinter dem ersten Eintrag; die Übersicht gruppiert nach Stockwerk.
- **Räume verwalten** (nur mit Admin-Anmeldung): Raumübersicht → **Bearbeiten**. Raum
  hinzufügen, umbenennen, Stockwerk, Icon, Bild (Galerie oder eigenes Foto), Temperatur,
  „Am Tablet zeigen“, Reihenfolge (Pfeile), löschen. Gespeichert wird in HA.
- **Bild ohne eigene Wahl:** passt der Name zu einem Bild im Repo (`bilder/`), wird es genommen.
- **Ausblenden:** Label „Nicht am Tablet“ am Bereich.
- **`rooms_path`** (optional): andere Adresse der Raum-Ansicht als `/<dashboard>/raum`.
- **Alte Dashboards** (Räume mit `room: true` in `nav`) laufen unverändert. Umstellen per
  Einrichtungspunkt „Räume aus Home Assistant“: sichert das Dashboard als verstecktes
  Dashboard „… (Sicherung Datum)“, übernimmt Icon/Bild/Temperatur in die Bereiche und baut auf
  die Ansicht `raum` um. Hat eine Raum-Ansicht Kacheln, die die Karte nicht von selbst zeigt,
  wird nichts geändert und der Grund genannt. YAML-Dashboards nach dem Beispiel oben von Hand
  umstellen.
````

- [ ] **Step 2: README – Einrichtungstabelle und Entwicklung**

In der Tabelle unter „## Einrichtung auf Knopfdruck“ nach der Zeile `| Startseite für alle | … |` einfügen:

```markdown
| Räume aus Home Assistant | Nur bei alten Dashboards: sichern, Räume in die Bereiche übernehmen, auf die Ansicht `raum` umbauen |
```

Am Ende von `README.md` anfügen:

````markdown
## Entwicklung

```bash
node --test                    # reine Logik (Node ≥ 20, keine Pakete)
HA_URL=http://<ha-adresse> node tools/dev-server.mjs   # HA über http://localhost:8765 + Entwicklerkarte
```

Der Entwickler-Proxy zeigt Home Assistant unter `http://localhost:8765` und liefert dazu
`/elvio-dev/elvio-room-card-dev.js` aus dem Repo (Elementname `elvio-room-card-dev`). In HA die
Ressource `/elvio-dev/elvio-room-card-dev.js` (Typ Modul, relative Adresse) eintragen und im
Test-Dashboard `type: custom:elvio-room-card-dev` verwenden; die installierte Karte bleibt
unberührt, am Tablet liefert HA für die Ressource nur 404. Über den Proxy einmal bei HA anmelden.
````

- [ ] **Step 3: EINRICHTEN-MIT-CLAUDE.md**

In Schritt 3 den Satz

```markdown
Aufbau: eine Ansicht „Zuhause“ als Übersicht, dann je Raum eine Ansicht. Jede Ansicht ist
```

ersetzen durch

```markdown
Aufbau: eine Ansicht „Zuhause“ als Übersicht, eine Ansicht „Raum“ (`path: raum`, `area: auto`)
für alle Räume und eine Ansicht „Einstellungen“. Räume sind die Bereiche in HA – sie stehen
**nicht** in `nav`; Icon, Bild und Temperatur des Raums gehören an den Bereich. Jede Ansicht ist
```

Im YAML-Beispiel desselben Schritts den `nav`-Eintrag `- {name: Wohnzimmer, …}` und die Ansicht `- title: Wohnzimmer …` ersetzen durch:

```yaml
    - {name: Einstellungen, path: /DASHBOARD-URL/einstellungen, icon: mdi:cog-outline}
```

bzw.

```yaml
  - title: Raum
    path: raum
    type: panel
    cards:
      - <<: *basis
        title: Raum
        area: auto                       # Raum aus der Adresse (…/raum?bereich=<id>)
        tiles:
          - {type: lights, name: Licht, entities: []}
```

Unter „### Referenz“ bei **Karte:** nach `area` ergänzen: `` (`auto` = Raum aus der Adresse) ``, und `rooms_path` in die Aufzählung aufnehmen.

- [ ] **Step 4: Gesamtprüfung**

Run: `node --test && node --check elvio-room-card.js && git status --short`
Expected: Tests grün; `git status` zeigt nur `?? shelly-belegung.csv` (und keine anderen ungetrackten/geänderten Dateien nach dem Commit).

- [ ] **Step 5: Commit**

```bash
git add README.md EINRICHTEN-MIT-CLAUDE.md
git commit -m "Doku: Räume aus Home Assistant, Umstellung, Entwicklung

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Übergabe an Julian (kein Push, kein Tag)**

Entwicklerserver laufen lassen. Julian bekommt:
- Branch `feat/raeume-aus-ha`, Liste der Commits (`git log --oneline main..`).
- Links zum Ansehen in seinem Browser auf dem Mac (Entwicklerserver muss laufen):
  `http://localhost:8766/tablet-neu/raum?bereich=wohnbereich&disable_km` (neuer Modus, Räume verwalten)
  und `http://localhost:8766/tablet-test/einstellungen?disable_km` (Altmodus bzw. nach der Umstellung).
- Hinweis: Freigabe-Schritte (merge nach `main`, Tag `v1.6.0`, Push, Pin der Test-Installation, Umstellung am echten Dashboard, Aufräumen von Test-Dashboards und Entwickler-Ressource) erst nach seinem OK, jeweils einzeln.
