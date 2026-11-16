import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioEnergy } = loadCard();

// ── HA-Energie-Einstellungen lesen ──

const NEW_PREFS = {
  energy_sources: [
    {
      type: "grid",
      stat_energy_from: "sensor.bezug",
      stat_energy_to: "sensor.einspeisung",
      stat_cost: "sensor.bezug_kosten",
      stat_compensation: null,
      power_config: { stat_rate_from: "sensor.netz_bezug_w", stat_rate_to: "sensor.netz_einsp_w" },
    },
    { type: "solar", stat_energy_from: "sensor.pv", stat_rate: "sensor.pv_w" },
    { type: "battery", stat_energy_from: "sensor.akku_aus", stat_energy_to: "sensor.akku_ein", power_config: { stat_rate: "sensor.akku_w" } },
  ],
  device_consumption: [
    { stat_consumption: "sensor.waschmaschine", stat_rate: "sensor.waschmaschine_w", name: "Waschmaschine" },
    { stat_consumption: "sensor.licht" },
  ],
};

const OLD_PREFS = {
  energy_sources: [
    {
      type: "grid",
      flow_from: [{ stat_energy_from: "sensor.bezug_ht", stat_cost: null }, { stat_energy_from: "sensor.bezug_nt", stat_cost: null }],
      flow_to: [{ stat_energy_to: "sensor.einspeisung", stat_compensation: "sensor.verguetung" }],
      cost_adjustment_day: 0,
    },
  ],
  device_consumption: [],
};

test("normalize: neue Form mit Leistung, Solar, Batterie, Geräten", () => {
  const n = ElvioEnergy.normalize(NEW_PREFS);
  assert.deepEqual(n.gridIn, ["sensor.bezug"]);
  assert.deepEqual(n.gridOut, ["sensor.einspeisung"]);
  assert.deepEqual(n.cost, ["sensor.bezug_kosten"]);
  assert.deepEqual(n.compensation, []);
  assert.deepEqual(n.solar, ["sensor.pv"]);
  assert.deepEqual(n.batteryOut, ["sensor.akku_aus"]);
  assert.deepEqual(n.batteryIn, ["sensor.akku_ein"]);
  assert.deepEqual(n.rates.grid, [{ plus: ["sensor.netz_bezug_w"], minus: ["sensor.netz_einsp_w"] }]);
  assert.deepEqual(n.rates.solar, [{ plus: ["sensor.pv_w"], minus: [] }]);
  assert.deepEqual(n.rates.battery, [{ plus: ["sensor.akku_w"], minus: [] }]);
  assert.deepEqual(n.devices, [
    { stat: "sensor.waschmaschine", rate: "sensor.waschmaschine_w", name: "Waschmaschine", includedIn: null },
    { stat: "sensor.licht", rate: null, name: null, includedIn: null },
  ]);
  assert.equal(ElvioEnergy.hasData(n), true);
});

test("normalize: alte Form (flow_from/flow_to) mit Hoch- und Niedertarif", () => {
  const n = ElvioEnergy.normalize(OLD_PREFS);
  assert.deepEqual(n.gridIn, ["sensor.bezug_ht", "sensor.bezug_nt"]);
  assert.deepEqual(n.gridOut, ["sensor.einspeisung"]);
  assert.deepEqual(n.compensation, ["sensor.verguetung"]);
  assert.deepEqual(n.rates.grid, []);
});

test("normalize: Batterie mit Richtungen, Leistung invertiert", () => {
  const n = ElvioEnergy.normalize({
    energy_sources: [
      {
        type: "battery",
        stat_energy_from_grid: "sensor.n_a",
        stat_energy_from_solar: "sensor.s_a",
        stat_energy_to_home: "sensor.a_h",
        stat_energy_to_grid: "sensor.a_n",
        power_config: { stat_rate_to_home: "sensor.w_ah", stat_rate_from_solar: "sensor.w_sa" },
      },
      { type: "grid", stat_energy_from: "sensor.b", stat_energy_to: null, power_config: { stat_rate_inverted: "sensor.netz_inv" } },
    ],
  });
  assert.deepEqual(n.batteryIn, ["sensor.n_a", "sensor.s_a"]);
  assert.deepEqual(n.batteryOut, ["sensor.a_h", "sensor.a_n"]);
  assert.deepEqual(n.rates.battery, [{ plus: ["sensor.w_ah"], minus: ["sensor.w_sa"] }]);
  assert.deepEqual(n.rates.grid, [{ plus: [], minus: ["sensor.netz_inv"] }]);
});

test("normalize: leer bzw. ohne Einstellungen", () => {
  const n = ElvioEnergy.normalize(null);
  assert.equal(ElvioEnergy.hasData(n), false);
  assert.equal(ElvioEnergy.hasData(ElvioEnergy.normalize({ energy_sources: [], device_consumption: [] })), false);
});

// ── Jetzt ──

test("live: Haus = Solar + Netz + Batterie, Vorzeichen zeigen die Richtung", () => {
  const n = ElvioEnergy.normalize(NEW_PREFS);
  const w = { "sensor.netz_bezug_w": 0, "sensor.netz_einsp_w": 1200, "sensor.pv_w": 4000, "sensor.akku_w": -800 };
  const live = ElvioEnergy.live(n, (id) => (id in w ? w[id] : null));
  assert.deepEqual(live, { solar: 4000, grid: -1200, battery: -800, home: 2000 });
});

test("live: ohne Netz-Leistung kein errechneter Hausverbrauch", () => {
  const n = ElvioEnergy.normalize(NEW_PREFS);
  const live = ElvioEnergy.live(n, (id) => (id === "sensor.pv_w" ? 3000 : null));
  assert.deepEqual(live, { solar: 3000, grid: null, battery: null, home: null });
});

// ── Zeiträume ──

const iso = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}`;
};

test("periodRange: Heute, Woche ab Montag, Monat, Jahr", () => {
  const now = new Date(2026, 10, 18, 15, 30).getTime(); // Mittwoch, 18.11.2026
  const day = ElvioEnergy.periodRange("day", now);
  assert.equal(iso(day.start), "2026-11-18 00");
  assert.equal(iso(day.end), "2026-11-19 00");
  assert.equal(day.bucket, "hour");
  const week = ElvioEnergy.periodRange("week", now);
  assert.equal(iso(week.start), "2026-11-16 00");
  assert.equal(iso(week.end), "2026-11-23 00");
  assert.equal(week.bucket, "day");
  const month = ElvioEnergy.periodRange("month", now);
  assert.equal(iso(month.start), "2026-11-01 00");
  assert.equal(iso(month.end), "2026-12-01 00");
  const year = ElvioEnergy.periodRange("year", now);
  assert.equal(iso(year.start), "2026-01-01 00");
  assert.equal(iso(year.end), "2027-01-01 00");
  assert.equal(year.bucket, "month");
});

test("periodRange: Woche am Sonntag beginnt am Montag davor", () => {
  const sunday = new Date(2026, 10, 22, 10).getTime();
  assert.equal(iso(ElvioEnergy.periodRange("week", sunday).start), "2026-11-16 00");
});

test("buckets: 24 Stunden, 7 Tage, 30 Tage im November, 12 Monate", () => {
  const now = new Date(2026, 10, 18, 15, 30).getTime();
  assert.equal(ElvioEnergy.buckets(ElvioEnergy.periodRange("day", now)).length, 24);
  assert.equal(ElvioEnergy.buckets(ElvioEnergy.periodRange("week", now)).length, 7);
  assert.equal(ElvioEnergy.buckets(ElvioEnergy.periodRange("month", now)).length, 30);
  assert.equal(ElvioEnergy.buckets(ElvioEnergy.periodRange("year", now)).length, 12);
});

// ── Summen ──

test("totals: Hausverbrauch, Autarkie, Eigenverbrauch", () => {
  const n = ElvioEnergy.normalize(NEW_PREFS);
  const c = { "sensor.bezug": 4, "sensor.einspeisung": 6, "sensor.pv": 18, "sensor.akku_aus": 3, "sensor.akku_ein": 5, "sensor.bezug_kosten": 1.2 };
  const t = ElvioEnergy.totals(n, (id) => (id in c ? c[id] : null));
  assert.equal(t.gridIn, 4);
  assert.equal(t.gridOut, 6);
  assert.equal(t.solar, 18);
  assert.equal(t.home, 14); // 4 + 18 + 3 − 6 − 5
  assert.equal(Math.round(t.autarky * 100), 71); // 1 − 4/14
  assert.equal(Math.round(t.selfUse * 100), 67); // 1 − 6/18
  assert.equal(t.cost, 1.2);
  assert.equal(t.compensation, null);
});

test("totals: ohne Zähler bleibt alles leer", () => {
  const n = ElvioEnergy.normalize({ device_consumption: [{ stat_consumption: "sensor.licht" }] });
  const t = ElvioEnergy.totals(n, () => 2);
  assert.equal(t.home, null);
  assert.equal(t.autarky, null);
  assert.equal(t.selfUse, null);
});

// ── Verlauf ──

test("series: Werte je Stunde, fehlende Stunden 0, mehrere Zähler addiert", () => {
  const n = ElvioEnergy.normalize(OLD_PREFS);
  const now = new Date(2026, 10, 18, 15, 30).getTime();
  const range = ElvioEnergy.periodRange("day", now);
  const b = ElvioEnergy.buckets(range);
  const stats = {
    "sensor.bezug_ht": [{ start: b[7], change: 0.5 }, { start: b[8], change: 0.25 }],
    "sensor.bezug_nt": [{ start: b[7], change: 0.25 }],
    "sensor.einspeisung": [{ start: b[12], change: 1.5 }],
  };
  const rows = ElvioEnergy.series(n, stats, b);
  assert.equal(rows.length, 24);
  assert.deepEqual(rows[7], { t: b[7], gridIn: 0.75, gridOut: 0, solar: 0, used: 0 });
  assert.deepEqual(rows[8], { t: b[8], gridIn: 0.25, gridOut: 0, solar: 0, used: 0 });
  assert.deepEqual(rows[12], { t: b[12], gridIn: 0, gridOut: 1.5, solar: 0, used: 0 });
  assert.deepEqual(rows[0], { t: b[0], gridIn: 0, gridOut: 0, solar: 0, used: 0 });
});

test("series: Verbrauch der Geräte ohne die enthaltenen", () => {
  const n = ElvioEnergy.normalize({
    device_consumption: [
      { stat_consumption: "sensor.kueche" },
      { stat_consumption: "sensor.herd", included_in_stat: "sensor.kueche" },
      { stat_consumption: "sensor.licht" },
    ],
  });
  const b = ElvioEnergy.buckets(ElvioEnergy.periodRange("day", new Date(2026, 10, 18, 15).getTime()));
  const stats = {
    "sensor.kueche": [{ start: b[10], change: 1 }],
    "sensor.herd": [{ start: b[10], change: 0.8 }],
    "sensor.licht": [{ start: b[10], change: 0.2 }],
  };
  assert.equal(ElvioEnergy.series(n, stats, b)[10].used, 1.2);
});

// ── Verbraucher ──

test("ranking: nach Verbrauch sortiert, mit Leistung und Namen", () => {
  const n = ElvioEnergy.normalize(NEW_PREFS);
  const c = { "sensor.waschmaschine": 1.5, "sensor.licht": 3 };
  const rows = ElvioEnergy.ranking(n, (id) => c[id] ?? null, (id) => (id === "sensor.waschmaschine_w" ? 1800 : null), (id) => `Name ${id}`);
  assert.deepEqual(rows, [
    { stat: "sensor.licht", name: "Name sensor.licht", kwh: 3, w: null },
    { stat: "sensor.waschmaschine", name: "Waschmaschine", kwh: 1.5, w: 1800 },
  ]);
});

// ── Einrichtungspunkt: Verbraucher finden ──

const DEVICES = {
  main: { id: "main", name: "EG-A2" },
  ch0: { id: "ch0", name: "Aussenlicht Haustuer", via_device_id: "main" },
  ch1: { id: "ch1", name: "Reserve O2", via_device_id: "main" },
  ch2: { id: "ch2", name: "Terrasse", name_by_user: "Terrasse Nord", via_device_id: "main" },
};
const STATES = {
  "sensor.a_output_0_energie": { attributes: { device_class: "energy", state_class: "total_increasing", friendly_name: "Aussenlicht Haustuer Energie" } },
  "sensor.a_output_0_energieeinspeisung": { attributes: { device_class: "energy", state_class: "total_increasing", friendly_name: "Aussenlicht Haustuer Energieeinspeisung" } },
  "sensor.a_output_0_leistung": { attributes: { device_class: "power", unit_of_measurement: "W" } },
  "sensor.a_output_1_energie": { attributes: { device_class: "energy", state_class: "total_increasing" } },
  "sensor.a_output_2_energie": { attributes: { device_class: "energy", state_class: "total_increasing" } },
  "sensor.a_output_2_leistung": { attributes: { device_class: "power", unit_of_measurement: "W" } },
  "sensor.a_total_energie": { attributes: { device_class: "energy", state_class: "total_increasing" } },
  "sensor.a_temperatur": { attributes: { device_class: "temperature" } },
};
const ENTITIES = [
  { entity_id: "sensor.a_output_0_energie", device_id: "ch0" },
  { entity_id: "sensor.a_output_0_energieeinspeisung", device_id: "ch0" },
  { entity_id: "sensor.a_output_0_leistung", device_id: "ch0" },
  { entity_id: "sensor.a_output_1_energie", device_id: "ch1" },
  { entity_id: "sensor.a_output_2_energie", device_id: "ch2" },
  { entity_id: "sensor.a_output_2_leistung", device_id: "ch2" },
  { entity_id: "sensor.a_total_energie", device_id: "main" },
  { entity_id: "sensor.a_temperatur", device_id: "main", entity_category: "diagnostic" },
];

test("consumerCandidates: benannte Kanäle mit Leistung, ohne Reserve, Einspeisung, Summe des Geräts", () => {
  const rows = ElvioEnergy.consumerCandidates({ entities: ENTITIES, states: STATES, devices: DEVICES, existing: [] });
  assert.deepEqual(rows, [
    { stat_consumption: "sensor.a_output_0_energie", stat_rate: "sensor.a_output_0_leistung", name: "Aussenlicht Haustuer" },
    { stat_consumption: "sensor.a_output_2_energie", stat_rate: "sensor.a_output_2_leistung", name: "Terrasse Nord" },
  ]);
});

test("consumerCandidates: schon Eingetragenes kommt nicht noch einmal", () => {
  const rows = ElvioEnergy.consumerCandidates({ entities: ENTITIES, states: STATES, devices: DEVICES, existing: ["sensor.a_output_0_energie"] });
  assert.deepEqual(rows.map((r) => r.stat_consumption), ["sensor.a_output_2_energie"]);
});

test("consumerCandidates: versteckte und technische Sensoren bleiben draußen", () => {
  const ents = ENTITIES.map((e) => (e.entity_id === "sensor.a_output_2_energie" ? { ...e, hidden: true } : e));
  const rows = ElvioEnergy.consumerCandidates({ entities: ents, states: STATES, devices: DEVICES, existing: [] });
  assert.deepEqual(rows.map((r) => r.stat_consumption), ["sensor.a_output_0_energie"]);
});
