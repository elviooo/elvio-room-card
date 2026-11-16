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

test("autoTile: dieselben Kacheln wie die Karte", () => {
  assert.deepEqual(R.autoTile("light.a", "A"), { type: "lights", entities: ["light.a"], name: "A" });
  assert.deepEqual(R.autoTile("media_player.m"), { type: "media", entity: "media_player.m" });
  assert.deepEqual(R.autoTile("camera.c"), { type: "camera", entity: "camera.c" });
  assert.deepEqual(R.autoTile("climate.k"), { type: "climate", entity: "climate.k" });
  assert.deepEqual(R.autoTile("switch.s"), { type: "toggle", entity: "switch.s", icon: "mdi:power-socket-de" });
  assert.deepEqual(R.autoTile("fan.f"), { type: "toggle", entity: "fan.f", icon: "mdi:fan" });
  assert.deepEqual(R.autoTile("cover.r"), { type: "entity", entity: "cover.r" });
});

test("blockReason: Kacheln, die danach anders aussähen", () => {
  const c = ctx({ "light.bad": "bad", "switch.bad": "bad", "climate.bad": "bad" });
  const v = (tiles) => view("bad", { area: "Bad", tiles });
  assert.equal(R.blockReason(v([{ type: "lights", name: "Licht", entities: ["light.bad"] }]), "bad", c), null);
  assert.match(R.blockReason(v([{ type: "lights", name: "Deckenlicht", entities: [] }]), "bad", c), /„Deckenlicht“ hieße danach „Licht“/);
  assert.match(R.blockReason(v([{ type: "lights", entities: [], span: 2 }]), "bad", c), /eigene Einstellungen \(span\)/);
  assert.match(R.blockReason(v([{ type: "lights", entities: [] }, { type: "lights", entities: [] }]), "bad", c), /mehrere Licht-Kacheln/);
  assert.equal(R.blockReason(v([{ type: "toggle", entity: "switch.bad", icon: "mdi:power-socket-de" }]), "bad", c), null);
  assert.match(R.blockReason(v([{ type: "entity", entity: "switch.bad" }]), "bad", c), /sähe danach anders aus/);
  assert.match(R.blockReason(v([{ type: "climate", entity: "climate.bad", name: "Heizung" }]), "bad", c), /„Heizung“ sähe danach anders aus/);
  assert.match(R.blockReason(v([{ type: "entity", entity: "light.bad" }]), "bad", c), /sähe danach anders aus/);
});

test("blockReason: Entität, die die Automatik nicht einsammelt", () => {
  const c = { ...ctx({ "light.bad": "bad" }), isCollected: (id) => id !== "light.bad" };
  const v = view("bad", { area: "Bad", tiles: [{ type: "lights", entities: ["light.bad"] }] });
  assert.match(R.blockReason(v, "bad", c), /light\.bad erscheint nicht von selbst/);
});

test("migrationPlan: Ansicht mit anderem Bereich als der nav-Raum blockiert", () => {
  const cfg = config();
  cfg.views[1].cards[0].area = "Flur";
  const plan = R.migrationPlan(cfg, { ...ctx(), resolveArea: (k) => ({ Bad: "bad", Flur: "flur" })[k] || null });
  assert.deepEqual(plan.blocked, [{ room: "Bad", reason: "die Ansicht zeigt einen anderen Bereich (Flur)" }]);
});

test("migrationPlan: Temperatur aus climate.* blockiert", () => {
  const cfg = config();
  cfg.views[0].cards[0].nav = NAV.map((i) => (i.name === "Bad" ? { ...i, temperature: "climate.bad" } : i));
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, [{ room: "Bad", reason: "Temperatur climate.bad lässt sich nicht übernehmen (HA nimmt nur Sensoren)" }]);
});

test("migrationPlan: unterschiedliche Karten-Einstellungen blockieren", () => {
  const cfg = config();
  cfg.views[2].cards[0].logo = "/local/logo.png";
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, [{ room: "Keller", reason: "die Raumkarte hat andere Einstellungen als die erste Raum-Ansicht" }]);
});

test("migrationPlan: keine Räume → blockiert, Konfiguration unverändert", () => {
  const cfg = config();
  for (const v of cfg.views) v.cards[0].nav = NAV.filter((i) => !i.room);
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, [{ room: "–", reason: "keine Räume in nav" }]);
  assert.deepEqual(plan.config, cfg);
});

test("migrationPlan: Ansicht ohne cards bleibt ohne cards; nav-Pfad mit / am Ende passt", () => {
  const cfg = config();
  cfg.views.push({ title: "Sektionen", path: "sek", type: "sections", sections: [] });
  cfg.views[0].cards[0].nav = NAV.map((i) => (i.name === "Keller" ? { ...i, path: "/d/keller/" } : i));
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, []);
  const sek = plan.config.views.find((v) => v.path === "sek");
  assert.equal("cards" in sek, false);
  assert.deepEqual(plan.config.views.map((v) => v.path), ["zuhause", "raum", "einstellungen", "sek"]);
});

test("migrationPlan: Ansichts-Einstellungen der Vorlage bleiben (z. B. icon)", () => {
  const cfg = config();
  cfg.views[1].icon = "mdi:door";
  const plan = R.migrationPlan(cfg, ctx());
  assert.equal(plan.config.views[1].icon, "mdi:door");
  assert.equal(plan.config.views[1].path, "raum");
});

test("migrationPlan: Temperatur-Sensor, der keine Temperatur misst, blockiert", () => {
  const ok = R.migrationPlan(config(), { ...ctx(), isTemperatureSensor: () => true });
  assert.deepEqual(ok.blocked, []);
  const plan = R.migrationPlan(config(), { ...ctx(), isTemperatureSensor: (id) => id !== "sensor.bad" });
  assert.deepEqual(plan.blocked, [{ room: "Bad", reason: "Temperatur sensor.bad ist kein Temperatursensor" }]);
});

test("migrationPlan: Raum ohne Ansicht blockiert", () => {
  const cfg = config();
  cfg.views = cfg.views.filter((v) => v.path !== "keller");
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, [{ room: "Keller", reason: "Ansicht nicht gefunden (/d/keller)" }]);
});

test("migrationPlan: zwei Räume im selben Bereich – der spätere blockiert", () => {
  const cfg = config();
  cfg.views[2].cards[0].area = "Keller";
  const plan = R.migrationPlan(cfg, { ...ctx(), resolveArea: (k) => ({ Bad: "bad", Keller: "bad" })[k] || null });
  assert.deepEqual(plan.blocked, [{ room: "Keller", reason: "teilt sich den Bereich mit „Bad“" }]);
});

test("migrationPlan: Raum hieße danach wie sein Bereich – blockiert", () => {
  const same = R.migrationPlan(config(), { ...ctx(), areaName: (id) => ({ bad: "Bad" })[id] });
  assert.deepEqual(same.blocked, []);
  const plan = R.migrationPlan(config(), { ...ctx(), areaName: (id) => ({ bad: "Badezimmer" })[id] });
  assert.deepEqual(plan.blocked, [
    { room: "Bad", reason: "hieße danach „Badezimmer“ – Bereich in HA umbenennen oder Raum in nav anpassen" },
  ]);
});

test("migrationPlan: Licht-Kachel mit etwas anderem als light.* blockiert", () => {
  const cfg = config();
  cfg.views[1].cards[0].tiles = [{ type: "lights", name: "Licht", entities: ["light.bad", "switch.bad"] }];
  const plan = R.migrationPlan(cfg, ctx({ "light.bad": "bad", "switch.bad": "bad" }));
  assert.deepEqual(plan.blocked, [{ room: "Bad", reason: "switch.bad ist kein Licht" }]);
});

test("migrationPlan: jede übrige Karte behält ihre eigene nav (ohne Räume)", () => {
  const cfg = config();
  const extra = { name: "Kameras", path: "/d/kameras", icon: "mdi:cctv" };
  cfg.views[3].cards[0].nav = [...NAV, extra];
  const plan = R.migrationPlan(cfg, ctx());
  assert.deepEqual(plan.blocked, []);
  const plainNav = NAV.filter((i) => !i.room);
  const byPath = Object.fromEntries(plan.config.views.map((v) => [v.path, v.cards[0].nav]));
  assert.deepEqual(byPath.zuhause, plainNav);
  assert.deepEqual(byPath.raum, plainNav);
  assert.deepEqual(byPath.einstellungen, [...plainNav, extra]);
});

test("areasToHide: Bereiche, die kein Raum waren und noch kein Label haben", () => {
  const areas = [
    { area_id: "bad", labels: [] },
    { area_id: "flur" },
    { area_id: "keller", labels: ["x"] },
    { area_id: "dach", labels: ["nicht_am_tablet"] },
  ];
  assert.deepEqual(R.areasToHide(areas, ["bad", null], "nicht_am_tablet"), ["flur", "keller"]);
  assert.deepEqual(R.areasToHide(areas, ["bad", "flur", "keller", "dach"], "nicht_am_tablet"), []);
});
