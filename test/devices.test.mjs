import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioRooms } = loadCard();

// ── Was man hinzufügen kann und was vorausgewählt ist ──

test("isPickable: Bedienbares und Sensoren ja, Technik nein", () => {
  for (const id of ["camera.tuer", "light.decke", "switch.dose", "sensor.temp", "binary_sensor.bewegung", "event.klingel", "button.tor", "siren.alarm"]) {
    assert.equal(ElvioRooms.isPickable(id), true, id);
  }
  for (const id of ["automation.x", "update.fw", "number.helligkeit", "select.modus", "person.julian", "weather.home"]) {
    assert.equal(ElvioRooms.isPickable(id), false, id);
  }
});

test("isUseful: Geräte der Automatik, sinnvolle Sensoren und Klingel vorausgewählt", () => {
  assert.equal(ElvioRooms.isUseful("camera.tuer"), true);
  assert.equal(ElvioRooms.isUseful("switch.dose"), true);
  assert.equal(ElvioRooms.isUseful("sensor.temp", "temperature"), true);
  assert.equal(ElvioRooms.isUseful("sensor.feuchte", "humidity"), true);
  assert.equal(ElvioRooms.isUseful("binary_sensor.bewegung", "motion"), true);
  assert.equal(ElvioRooms.isUseful("binary_sensor.fenster", "window"), true);
  assert.equal(ElvioRooms.isUseful("binary_sensor.rauch", "smoke"), true);
  assert.equal(ElvioRooms.isUseful("event.klingel", "doorbell"), true);
});

test("isUseful: Messwerte und Technik nicht vorausgewählt", () => {
  assert.equal(ElvioRooms.isUseful("sensor.leistung", "power"), false);
  assert.equal(ElvioRooms.isUseful("sensor.energie", "energy"), false);
  assert.equal(ElvioRooms.isUseful("sensor.lf", "power_factor"), false);
  assert.equal(ElvioRooms.isUseful("sensor.ohne_klasse"), false);
  assert.equal(ElvioRooms.isUseful("binary_sensor.eingang", "power"), false);
  assert.equal(ElvioRooms.isUseful("event.taster", "button"), false);
  assert.equal(ElvioRooms.isUseful("button.neustart"), false);
});

// ── Filter: Art eines Geräts ──

test("entityKind ordnet Funktionen den Filtern zu", () => {
  assert.equal(ElvioRooms.entityKind("camera.tuer"), "camera");
  assert.equal(ElvioRooms.entityKind("event.klingel", "doorbell"), "camera");
  assert.equal(ElvioRooms.entityKind("light.decke"), "light");
  assert.equal(ElvioRooms.entityKind("switch.dose"), "switch");
  assert.equal(ElvioRooms.entityKind("fan.luefter"), "switch");
  assert.equal(ElvioRooms.entityKind("sensor.temp", "temperature"), "sensor");
  assert.equal(ElvioRooms.entityKind("binary_sensor.bewegung", "motion"), "sensor");
  assert.equal(ElvioRooms.entityKind("cover.rollo"), "other");
  assert.equal(ElvioRooms.entityKind("event.taster", "button"), null);
  assert.equal(ElvioRooms.entityKind("button.tor"), null);
});

test("deviceKind: Kamera vor Licht vor Schalter vor Sonstigem vor Sensor", () => {
  const e = (entity_id, device_class) => ({ entity_id, device_class });
  // Klingel: Kamera, Bewegung, Klingel-Ereignis
  assert.equal(ElvioRooms.deviceKind([e("binary_sensor.b", "motion"), e("camera.k"), e("event.k", "doorbell")]), "camera");
  // Shelly Pro 4PM: Schalter und Messwerte
  assert.equal(ElvioRooms.deviceKind([e("sensor.p", "power"), e("switch.a"), e("switch.b")]), "switch");
  // Thermostat mit Temperatursensor
  assert.equal(ElvioRooms.deviceKind([e("sensor.t", "temperature"), e("climate.h")]), "other");
  // Bewegungsmelder
  assert.equal(ElvioRooms.deviceKind([e("binary_sensor.m", "motion"), e("sensor.l", "illuminance")]), "sensor");
  // Nur Taster-Ereignisse und Knöpfe
  assert.equal(ElvioRooms.deviceKind([e("event.t", "button"), e("button.x")]), "other");
});

// ── Abschnitte und Symbole in der Raum-Ansicht ──

test("roomSection: Kameras, Sensoren, Weitere Geräte", () => {
  assert.equal(ElvioRooms.roomSection("camera.tuer"), "Kameras");
  assert.equal(ElvioRooms.roomSection("event.klingel", "doorbell"), "Sensoren");
  assert.equal(ElvioRooms.roomSection("sensor.temp", "temperature"), "Sensoren");
  assert.equal(ElvioRooms.roomSection("binary_sensor.fenster", "window"), "Sensoren");
  assert.equal(ElvioRooms.roomSection("event.taster", "button"), "Sensoren");
  assert.equal(ElvioRooms.roomSection("switch.dose"), "Weitere Geräte");
  assert.equal(ElvioRooms.roomSection("cover.rollo"), "Weitere Geräte");
});

test("stateIcon: Symbol nach Geräteklasse und Zustand", () => {
  assert.equal(ElvioRooms.stateIcon("binary_sensor.b", "motion", "on"), "mdi:motion-sensor");
  assert.equal(ElvioRooms.stateIcon("binary_sensor.b", "motion", "off"), "mdi:motion-sensor-off");
  assert.equal(ElvioRooms.stateIcon("binary_sensor.t", "door", "on"), "mdi:door-open");
  assert.equal(ElvioRooms.stateIcon("binary_sensor.t", "door", "off"), "mdi:door-closed");
  assert.equal(ElvioRooms.stateIcon("binary_sensor.f", "window", "on"), "mdi:window-open-variant");
  assert.equal(ElvioRooms.stateIcon("sensor.t", "temperature", "21.5"), "mdi:thermometer");
  assert.equal(ElvioRooms.stateIcon("sensor.h", "humidity", "50"), "mdi:water-percent");
  assert.equal(ElvioRooms.stateIcon("event.k", "doorbell", "2026-11-16T10:00:00"), "mdi:doorbell");
  assert.equal(ElvioRooms.stateIcon("sensor.x", undefined, "1"), null);
  assert.equal(ElvioRooms.stateIcon("switch.x", undefined, "on"), null);
});

test("isAlert: Rauch, Wasser, Gas schlagen an, Bewegung nicht", () => {
  assert.equal(ElvioRooms.isAlert("binary_sensor.r", "smoke", "on"), true);
  assert.equal(ElvioRooms.isAlert("binary_sensor.w", "moisture", "on"), true);
  assert.equal(ElvioRooms.isAlert("binary_sensor.r", "smoke", "off"), false);
  assert.equal(ElvioRooms.isAlert("binary_sensor.b", "motion", "on"), false);
  assert.equal(ElvioRooms.isAlert("sensor.f", "moisture", "on"), false);
});

// ── Labels: nur die Abweichung vom Normalfall ──

test("shownLabels: zeigt/versteckt nur abweichend vom Normalfall, fremde Labels bleiben", () => {
  assert.deepEqual(ElvioRooms.shownLabels(["x"], true, false), ["x", "am_tablet"]);
  assert.deepEqual(ElvioRooms.shownLabels(["x", "nicht_am_tablet"], true, true), ["x"]);
  assert.deepEqual(ElvioRooms.shownLabels(["am_tablet"], false, false), []);
  assert.deepEqual(ElvioRooms.shownLabels([], false, true), ["nicht_am_tablet"]);
});

// ── Plan fürs Hinzufügen ──

const ent = (entity_id, extra = {}) => ({ entity_id, area_id: null, labels: [], device_id: "d1", ...extra });

test("addPlan: Gerät ohne Raum zieht ganz um, Auswahl wird gezeigt, Abgewähltes versteckt", () => {
  const plan = ElvioRooms.addPlan({
    device: { id: "d1", area_id: null },
    entities: [ent("camera.tuer"), ent("binary_sensor.bewegung"), ent("sensor.signal"), ent("switch.licht_tuer")],
    selected: ["camera.tuer", "binary_sensor.bewegung"],
    areaId: "flur",
    placed: [],
  });
  assert.deepEqual(plan.device, { device_id: "d1", area_id: "flur" });
  assert.deepEqual(plan.entities, [
    { entity_id: "binary_sensor.bewegung", labels: ["am_tablet"] },
    { entity_id: "switch.licht_tuer", labels: ["nicht_am_tablet"] },
  ]);
});

test("addPlan: Gerät in anderem Raum – nur die gewählten Funktionen kommen her", () => {
  const plan = ElvioRooms.addPlan({
    device: { id: "d1", area_id: "wohnbereich" },
    entities: [ent("switch.a"), ent("switch.b"), ent("sensor.leistung_b")],
    selected: ["switch.b"],
    areaId: "flur",
    placed: [],
  });
  assert.equal(plan.device, null);
  assert.deepEqual(plan.entities, [{ entity_id: "switch.b", area_id: "flur" }]);
});

test("addPlan: eigene Raumzuordnung wird aufgehoben, wenn das Gerät schon hier ist", () => {
  const plan = ElvioRooms.addPlan({
    device: { id: "d1", area_id: "flur" },
    entities: [ent("switch.a", { area_id: "garten", labels: ["nicht_am_tablet"] })],
    selected: ["switch.a"],
    areaId: "flur",
    placed: [],
  });
  assert.equal(plan.device, null);
  assert.deepEqual(plan.entities, [{ entity_id: "switch.a", area_id: null, labels: [] }]);
});

test("addPlan: Funktion mit eigener Zuordnung bleibt beim Umzug des Geräts, wo sie ist", () => {
  const plan = ElvioRooms.addPlan({
    device: { id: "d1", area_id: null },
    entities: [ent("switch.a"), ent("switch.b", { area_id: "garten" })],
    selected: ["switch.a"],
    areaId: "flur",
    placed: [],
  });
  assert.deepEqual(plan.device, { device_id: "d1", area_id: "flur" });
  assert.deepEqual(plan.entities, []);
});

test("addPlan: Entität ohne Gerät bekommt den Bereich direkt", () => {
  const plan = ElvioRooms.addPlan({
    device: null,
    entities: [ent("sensor.aussen", { device_id: null })],
    selected: ["sensor.aussen"],
    areaId: "garten",
    placed: [],
  });
  assert.equal(plan.device, null);
  assert.deepEqual(plan.entities, [{ entity_id: "sensor.aussen", area_id: "garten", labels: ["am_tablet"] }]);
});

test("addPlan: fest eingetragene Kachel gilt als normal sichtbar", () => {
  const plan = ElvioRooms.addPlan({
    device: { id: "d1", area_id: "flur" },
    entities: [ent("sensor.temp")],
    selected: ["sensor.temp"],
    areaId: "flur",
    placed: ["sensor.temp"],
  });
  assert.deepEqual(plan, { device: null, entities: [] });
});

test("preselect: bei Kameras nur Bild, Klingel und Melder – kein Lautsprecher, keine Geräuscherkennung", () => {
  assert.equal(ElvioRooms.preselect("camera.dome", undefined, "camera"), true);
  assert.equal(ElvioRooms.preselect("binary_sensor.bewegung", "motion", "camera"), true);
  assert.equal(ElvioRooms.preselect("binary_sensor.tuer", "door", "camera"), true);
  assert.equal(ElvioRooms.preselect("event.klingel", "doorbell", "camera"), true);
  assert.equal(ElvioRooms.preselect("media_player.lautsprecher", undefined, "camera"), false);
  assert.equal(ElvioRooms.preselect("binary_sensor.co_gehoert", "carbon_monoxide", "camera"), false);
  assert.equal(ElvioRooms.preselect("sensor.leistung", "power", "camera"), false);
});

test("preselect: sonst wie isUseful", () => {
  assert.equal(ElvioRooms.preselect("binary_sensor.rauch", "smoke", "sensor"), true);
  assert.equal(ElvioRooms.preselect("media_player.box", undefined, "other"), true);
  assert.equal(ElvioRooms.preselect("sensor.leistung", "power", "switch"), false);
});
