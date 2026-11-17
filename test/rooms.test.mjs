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
    { areaId: null, name: "Keller", icon: null, image: null, temperature: null, floorId: null, floorName: null, path: "/d/keller", lights: [], hidden: false },
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

test("sameDashboard: nur Sprünge im selben Dashboard gehen ohne Neuladen", () => {
  const from = "/dashboard-tablet/zuhause";
  assert.equal(R.sameDashboard(from, "/dashboard-tablet/raum?bereich=bad"), true);
  assert.equal(R.sameDashboard(from, "/dashboard-tablet/einstellungen#x"), true);
  assert.equal(R.sameDashboard(from, "raum"), true);
  // Raus in die HA-Oberfläche: dort räumt kiosk-mode seine Styles nicht weg.
  assert.equal(R.sameDashboard(from, "/lovelace/0"), false);
  assert.equal(R.sameDashboard(from, "/home/overview"), false);
  assert.equal(R.sameDashboard(from, "/config/integrations/dashboard/add?domain=sonos"), false);
  assert.equal(R.sameDashboard(from, "/dashboard-tablett/zuhause"), false);
  assert.equal(R.sameDashboard(from, "https://example.org/"), false);
  assert.equal(R.sameDashboard("/", "/lovelace/raum"), true);
});

test("swap: tauscht zwei IDs, Rest bleibt", () => {
  assert.deepEqual(R.swap(["a", "b", "c", "d"], "b", "d"), ["a", "d", "c", "b"]);
  assert.deepEqual(R.swap(["a", "b"], "a", "zz"), ["a", "b"]);
});

// ── Stockwerke verwalten ──

test("groupForEdit: alle Stockwerke in Registry-Reihenfolge, auch leere, dann „Weitere“", () => {
  const floors = [
    { floor_id: "eg", name: "Erdgeschoss" },
    { floor_id: "og", name: "Obergeschoss" },
    { floor_id: "keller", name: "Keller" },
  ];
  const rooms = [
    { areaId: "kueche", floorId: "eg" },
    { areaId: "bad", floorId: "og" },
    { areaId: "schuppen", floorId: null },
  ];
  const groups = R.groupForEdit(rooms, floors);
  assert.deepEqual(
    groups.map((g) => [g.floorId, g.title, g.rooms.map((r) => r.areaId)]),
    [
      ["eg", "Erdgeschoss", ["kueche"]],
      ["og", "Obergeschoss", ["bad"]],
      ["keller", "Keller", []],
      [null, "Weitere", ["schuppen"]],
    ],
  );
});

test("groupForEdit: ohne Räume ohne Stockwerk keine Gruppe „Weitere“; ohne Stockwerke eine Gruppe ohne Titel", () => {
  const floors = [{ floor_id: "eg", name: "Erdgeschoss" }];
  assert.deepEqual(
    R.groupForEdit([{ areaId: "a", floorId: "eg" }], floors).map((g) => g.floorId),
    ["eg"],
  );
  assert.deepEqual(R.groupForEdit([{ areaId: "a", floorId: null }], []), [
    { floorId: null, title: null, rooms: [{ areaId: "a", floorId: null }] },
  ]);
  assert.deepEqual(R.groupForEdit([], []), [{ floorId: null, title: null, rooms: [] }]);
});

test("floorPreset: Vorlagen mit Symbol und Ebene, unabhängig von Groß-/Kleinschreibung", () => {
  assert.deepEqual(R.floorPreset("keller"), { name: "Keller", icon: "mdi:home-floor-negative-1", level: -1 });
  assert.deepEqual(R.floorPreset("Erdgeschoss"), { name: "Erdgeschoss", icon: "mdi:home-floor-0", level: 0 });
  assert.equal(R.floorPreset("Obergeschoss").level, 1);
  assert.equal(R.floorPreset("Dachgeschoss").icon, "mdi:home-roof");
  assert.equal(R.floorPreset("Aussen").level, null);
  assert.equal(R.floorPreset("Außen").name, "Aussen");
  assert.equal(R.floorPreset("Büro"), null);
});
