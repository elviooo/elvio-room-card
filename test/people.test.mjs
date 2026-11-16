import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioPeople } = loadCard();

const st = (entity_id, state, attributes = {}, last_changed = "2026-11-18T13:20:00Z") => ({ entity_id, state, attributes, last_changed });

const STATES = {
  "person.anna": st("person.anna", "home", { friendly_name: "Anna", entity_picture: "/api/image/anna.jpg", device_trackers: ["device_tracker.anna_iphone"], latitude: 52.5, longitude: 13.4 }),
  "person.ben": st("person.ben", "not_home", { friendly_name: "Ben", device_trackers: ["device_tracker.ben_pixel"], latitude: 52.6, longitude: 13.5 }),
  "person.chris": st("person.chris", "Arbeit", { friendly_name: "Chris", device_trackers: [] }),
  "person.admin": st("person.admin", "unknown", { friendly_name: "Elvio Admin", device_trackers: ["device_tracker.test"] }),
  "device_tracker.anna_iphone": st("device_tracker.anna_iphone", "home", { battery_level: 64 }),
  "device_tracker.ben_pixel": st("device_tracker.ben_pixel", "not_home", {}),
  "sensor.ben_pixel_battery_level": st("sensor.ben_pixel_battery_level", "15", { device_class: "battery", unit_of_measurement: "%" }),
  "sensor.ben_pixel_battery_state": st("sensor.ben_pixel_battery_state", "charging", {}),
  "device_tracker.test": st("device_tracker.test", "unknown", { battery_level: 25 }),
};
const ENTITIES = {
  "person.anna": { entity_id: "person.anna", labels: [] },
  "person.ben": { entity_id: "person.ben", labels: [] },
  "person.chris": { entity_id: "person.chris" },
  "person.admin": { entity_id: "person.admin", labels: ["nicht_am_tablet"] },
  "device_tracker.anna_iphone": { entity_id: "device_tracker.anna_iphone", device_id: "d_anna" },
  "device_tracker.ben_pixel": { entity_id: "device_tracker.ben_pixel", device_id: "d_ben" },
  "sensor.ben_pixel_battery_level": { entity_id: "sensor.ben_pixel_battery_level", device_id: "d_ben" },
  "sensor.ben_pixel_battery_state": { entity_id: "sensor.ben_pixel_battery_state", device_id: "d_ben" },
  "device_tracker.test": { entity_id: "device_tracker.test", device_id: "d_test" },
};
const DEVICES = {
  d_anna: { id: "d_anna", name: "iPhone von Anna" },
  d_ben: { id: "d_ben", name: "Pixel", name_by_user: "Bens Handy" },
  d_test: { id: "d_test", name: "iPhone Test" },
};
const args = (extra = {}) => ({ states: STATES, entities: ENTITIES, devices: DEVICES, hideLabel: "nicht_am_tablet", ...extra });

test("list: Zuhause zuerst, dann Zonen, Unterwegs, Unbekannt; Ausgeblendete fehlen", () => {
  const list = ElvioPeople.list(args());
  assert.deepEqual(list.map((p) => [p.id, p.place.kind, p.place.label]), [
    ["person.anna", "home", "Zuhause"],
    ["person.chris", "zone", "Arbeit"],
    ["person.ben", "away", "Unterwegs"],
  ]);
});

test("list: mit includeHidden auch Ausgeblendete, markiert", () => {
  const admin = ElvioPeople.list(args({ includeHidden: true })).find((p) => p.id === "person.admin");
  assert.equal(admin.hidden, true);
  assert.deepEqual(admin.place, { kind: "unknown", label: "Standort unbekannt" });
});

test("list: Foto, Anfangsbuchstabe, Position", () => {
  const [anna, chris, ben] = ElvioPeople.list(args());
  assert.equal(anna.picture, "/api/image/anna.jpg");
  assert.equal(chris.initial, "C");
  assert.equal(chris.picture, null);
  assert.equal(anna.position, true);
  assert.equal(chris.position, false);
  assert.equal(ben.since, Date.parse("2026-11-18T13:20:00Z"));
});

test("phones: Akku aus dem Tracker oder dem Akku-Sensor des Handys, Laden, knapp", () => {
  const list = ElvioPeople.list(args());
  assert.deepEqual(list[0].phones, [{ id: "device_tracker.anna_iphone", name: "iPhone von Anna", battery: 64, charging: false, low: false }]);
  assert.deepEqual(list[2].phones, [{ id: "device_tracker.ben_pixel", name: "Bens Handy", battery: 15, charging: true, low: true }]);
  assert.deepEqual(list[1].phones, []);
});

test("phones: ohne Akkuwert null, nicht knapp", () => {
  const states = { ...STATES, "device_tracker.anna_iphone": st("device_tracker.anna_iphone", "home", {}) };
  const anna = ElvioPeople.list(args({ states }))[0];
  assert.equal(anna.phones[0].battery, null);
  assert.equal(anna.phones[0].low, false);
});

test("summary: zuhause und unterwegs (Zonen zählen als unterwegs)", () => {
  assert.equal(ElvioPeople.summary(ElvioPeople.list(args())), "1 zuhause · 2 unterwegs");
  assert.equal(ElvioPeople.summary([]), "");
});

test("since: heute mit Uhrzeit, gestern, sonst Wochentag und Datum", () => {
  const now = new Date(2026, 10, 18, 18, 0).getTime();
  assert.equal(ElvioPeople.since(new Date(2026, 10, 18, 14, 5).getTime(), now), "seit 14:05");
  assert.equal(ElvioPeople.since(new Date(2026, 10, 17, 9, 30).getTime(), now), "seit gestern 09:30");
  assert.equal(ElvioPeople.since(new Date(2026, 10, 16, 9, 30).getTime(), now), "seit Mo 16.11.");
  assert.equal(ElvioPeople.since(null, now), "");
});
