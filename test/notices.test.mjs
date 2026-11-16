import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioNotices } = loadCard();

const NOW = new Date(2026, 10, 18, 18, 0).getTime();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const st = (entity_id, state, attributes = {}, changedMin = 60) => ({ entity_id, state, attributes, last_changed: ago(changedMin) });

const DEVICES = {
  cam: { id: "cam", name: "G6 Dome", via_device_id: "nvr", area_id: "garten" },
  nvr: { id: "nvr", name: "UNVR" },
  eg: { id: "eg", name: "EG-A4" },
  ch1: { id: "ch1", name: "Bad Hauptlicht", via_device_id: "eg" },
  ch2: { id: "ch2", name: "Bad LED", via_device_id: "eg" },
  neu: { id: "neu", name: "Gerade weg" },
  phone: { id: "phone", name: "iPhone" },
  kontakt: { id: "kontakt", name: "Fensterkontakt Bad" },
  sun: { id: "sun", name: "Sonne", entry_type: "service" },
};
const ENTITIES = {
  "camera.g6": { entity_id: "camera.g6", device_id: "cam" },
  "binary_sensor.g6_motion": { entity_id: "binary_sensor.g6_motion", device_id: "cam" },
  "sensor.nvr_cpu": { entity_id: "sensor.nvr_cpu", device_id: "nvr" },
  "sensor.eg_temp": { entity_id: "sensor.eg_temp", device_id: "eg" },
  "switch.ch1": { entity_id: "switch.ch1", device_id: "ch1" },
  "switch.ch2": { entity_id: "switch.ch2", device_id: "ch2" },
  "switch.neu": { entity_id: "switch.neu", device_id: "neu" },
  "sensor.iphone_battery": { entity_id: "sensor.iphone_battery", device_id: "phone", platform: "mobile_app" },
  "sensor.kontakt_battery": { entity_id: "sensor.kontakt_battery", device_id: "kontakt" },
  "binary_sensor.fenster_bad": { entity_id: "binary_sensor.fenster_bad", device_id: "kontakt" },
  "sensor.sun_next": { entity_id: "sensor.sun_next", device_id: "sun" },
};
const STATES = {
  "camera.g6": st("camera.g6", "unavailable", { friendly_name: "G6" }, 90),
  "binary_sensor.g6_motion": st("binary_sensor.g6_motion", "unavailable", {}, 90),
  "sensor.nvr_cpu": st("sensor.nvr_cpu", "12"),
  "sensor.eg_temp": st("sensor.eg_temp", "unavailable", {}, 30),
  "switch.ch1": st("switch.ch1", "unavailable", {}, 30),
  "switch.ch2": st("switch.ch2", "unavailable", {}, 30),
  "switch.neu": st("switch.neu", "unavailable", {}, 2),
  "sensor.iphone_battery": st("sensor.iphone_battery", "8", { device_class: "battery", unit_of_measurement: "%" }),
  "sensor.kontakt_battery": st("sensor.kontakt_battery", "12", { device_class: "battery", unit_of_measurement: "%", friendly_name: "Fensterkontakt Bad Batterie" }),
  "binary_sensor.fenster_bad": st("binary_sensor.fenster_bad", "on", { device_class: "window", friendly_name: "Fenster Bad" }),
  "binary_sensor.rauch_flur": st("binary_sensor.rauch_flur", "on", { device_class: "smoke", friendly_name: "Rauchmelder Flur" }),
  "sensor.sun_next": st("sensor.sun_next", "unavailable", {}, 90),
  "update.shelly_fw": st("update.shelly_fw", "on", { friendly_name: "EG-A4 Firmware" }),
  "update.core": st("update.core", "off", { friendly_name: "Core" }),
};
const args = (extra = {}) => ({
  states: STATES, entities: ENTITIES, devices: DEVICES, areas: { garten: { name: "Garten" } },
  now: NOW, ignore: [], admin: true, rainText: "Regen ab 22 Uhr", repairs: 2, ...extra,
});

test("collect: Reihenfolge Alarm, nicht erreichbar, Akku, Regen, Reparaturen, Updates", () => {
  const list = ElvioNotices.collect(args());
  assert.deepEqual(list.map((n) => n.key), [
    "alarm:binary_sensor.rauch_flur",
    "offline:eg",
    "offline:cam",
    "battery:sensor.kontakt_battery",
    "rain",
    "repairs",
    "updates",
  ]);
});

test("collect: nicht erreichbar – ganzer Shelly einmal mit Kanälen, frische Ausfälle (< 5 min) noch nicht", () => {
  const list = ElvioNotices.collect(args());
  const eg = list.find((n) => n.key === "offline:eg");
  assert.equal(eg.title, "EG-A4 nicht erreichbar");
  assert.equal(eg.sub, "mit 2 Kanälen · seit 17:30");
  const cam = list.find((n) => n.key === "offline:cam");
  assert.equal(cam.sub, "Garten · seit 16:30");
  assert.equal(cam.entity, "camera.g6");
  assert.equal(list.some((n) => n.key === "offline:neu"), false);
  assert.equal(list.some((n) => n.key === "offline:sun"), false);
});

test("collect: Akku ohne Handys, Alarm mit Art, Regen nur mit offenem Fenster", () => {
  const list = ElvioNotices.collect(args());
  assert.deepEqual(list.find((n) => n.kind === "battery"), {
    key: "battery:sensor.kontakt_battery", kind: "battery", level: 2, title: "Fensterkontakt Bad Batterie", sub: "Akku 12 %",
    entity: "sensor.kontakt_battery", path: null, ignored: false,
  });
  assert.equal(list.find((n) => n.kind === "alarm").sub, "Rauch – bitte nachsehen");
  assert.deepEqual(list.find((n) => n.kind === "rain").title, "Fenster Bad offen");
  assert.equal(list.find((n) => n.kind === "rain").sub, "Regen ab 22 Uhr");
  const dry = ElvioNotices.collect(args({ rainText: "" }));
  assert.equal(dry.some((n) => n.kind === "rain"), false);
});

test("collect: Updates und Reparaturen nur für Admins", () => {
  const list = ElvioNotices.collect(args({ admin: false }));
  assert.equal(list.some((n) => n.kind === "updates" || n.kind === "repairs"), false);
  const upd = ElvioNotices.collect(args()).find((n) => n.kind === "updates");
  assert.equal(upd.title, "1 Update verfügbar");
  assert.equal(upd.path, "/config/updates");
});

test("collect: Ausgeblendetes bleibt in der Liste, markiert", () => {
  const list = ElvioNotices.collect(args({ ignore: ["offline:cam"] }));
  assert.equal(list.find((n) => n.key === "offline:cam").ignored, true);
  assert.equal(list.filter((n) => !n.ignored).length, 6);
});
