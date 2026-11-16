import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioScenes } = loadCard();

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

test("capture: Licht an mit Helligkeit und der Farbe seines Modus, aus nur aus", () => {
  const states = {
    "light.decke": st("light.decke", "on", { brightness: 102, color_mode: "color_temp", color_temp_kelvin: 2700, hs_color: [30, 50] }),
    "light.band": st("light.band", "on", { brightness: 255, color_mode: "hs", hs_color: [240, 80], color_temp_kelvin: null }),
    "light.flur": st("light.flur", "off", { brightness: null }),
    "light.schalter": st("light.schalter", "on", { color_mode: "onoff" }),
  };
  assert.deepEqual(ElvioScenes.capture(["light.decke", "light.band", "light.flur", "light.schalter"], states), {
    "light.decke": { state: "on", brightness: 102, color_mode: "color_temp", color_temp_kelvin: 2700 },
    "light.band": { state: "on", brightness: 255, color_mode: "hs", hs_color: [240, 80] },
    "light.flur": { state: "off" },
    "light.schalter": { state: "on", color_mode: "onoff" },
  });
});

test("capture: Steckdose, Rollladen mit Position, Lüfter mit Stufe; Unbekanntes fehlt", () => {
  const states = {
    "switch.dose": st("switch.dose", "on"),
    "cover.rollo": st("cover.rollo", "open", { current_position: 40 }),
    "fan.luefter": st("fan.luefter", "on", { percentage: 66 }),
  };
  assert.deepEqual(ElvioScenes.capture(["switch.dose", "cover.rollo", "fan.luefter", "light.weg"], states), {
    "switch.dose": { state: "on" },
    "cover.rollo": { state: "open", current_position: 40 },
    "fan.luefter": { state: "on", percentage: 66 },
  });
});

test("describe: Stand in Worten", () => {
  assert.equal(ElvioScenes.describe(st("light.a", "on", { brightness: 102 })), "An · 40 %");
  assert.equal(ElvioScenes.describe(st("light.a", "on", {})), "An");
  assert.equal(ElvioScenes.describe(st("light.a", "off")), "Aus");
  assert.equal(ElvioScenes.describe(st("cover.r", "open", { current_position: 40 })), "Offen · 40 %");
  assert.equal(ElvioScenes.describe(st("cover.r", "closed", { current_position: 0 })), "Zu");
  assert.equal(ElvioScenes.describe(st("switch.d", "on")), "An");
  assert.equal(ElvioScenes.describe(st("switch.d", "unavailable")), "Nicht erreichbar");
  assert.equal(ElvioScenes.describe(undefined), "Nicht gefunden");
});

test("forArea: Szenen des Bereichs bzw. ohne Bereich, in der Reihenfolge des Anlegens", () => {
  const scenes = [
    st("scene.kino", "unknown", { friendly_name: "Kino", id: "1700000000300" }),
    st("scene.abend", "unknown", { friendly_name: "Abend", id: "1700000000100" }),
    st("scene.alles_aus", "unknown", { friendly_name: "Alles aus", id: "1700000000200" }),
    st("scene.yaml", "unknown", { friendly_name: "Aus YAML" }),
  ];
  const area = { "scene.kino": "wohnen", "scene.abend": "wohnen", "scene.alles_aus": null, "scene.yaml": "wohnen" };
  assert.deepEqual(
    ElvioScenes.forArea(scenes, (id) => area[id], "wohnen").map((s) => s.entity_id),
    ["scene.abend", "scene.kino", "scene.yaml"],
  );
  assert.deepEqual(ElvioScenes.forArea(scenes, (id) => area[id], null).map((s) => s.entity_id), ["scene.alles_aus"]);
});

test("Vorlagen ohne Umlaute, mit Symbol", () => {
  const presets = ElvioScenes.presets();
  assert.ok(presets.length >= 6);
  for (const p of presets) {
    assert.match(p.name, /^[A-Za-z ]+$/);
    assert.match(p.icon, /^mdi:/);
  }
});

// ── Werte je Licht im Szenen-Blatt ──

test("lightCaps: dimmbar, Weißton mit Grenzen, Farbe", () => {
  assert.deepEqual(ElvioScenes.lightCaps(st("light.a", "off", { supported_color_modes: ["onoff"] })), { dim: false, temp: null, color: false });
  assert.deepEqual(ElvioScenes.lightCaps(st("light.b", "off", { supported_color_modes: ["brightness"] })), { dim: true, temp: null, color: false });
  assert.deepEqual(
    ElvioScenes.lightCaps(st("light.c", "off", { supported_color_modes: ["color_temp", "hs"], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 })),
    { dim: true, temp: { min: 2200, max: 6500 }, color: true },
  );
  assert.deepEqual(ElvioScenes.lightCaps(st("light.d", "off", { supported_color_modes: ["color_temp"] })).temp, { min: 2000, max: 6500 });
  assert.deepEqual(ElvioScenes.lightCaps(undefined), { dim: false, temp: null, color: false });
});

test("edit: aus macht nur aus, an mit voller Helligkeit, Helligkeit schaltet an", () => {
  assert.deepEqual(ElvioScenes.edit({ state: "on", brightness: 80, color_mode: "hs", hs_color: [1, 2] }, { state: "off" }), { state: "off" });
  assert.deepEqual(ElvioScenes.edit({ state: "off" }, { state: "on" }), { state: "on", brightness: 255 });
  assert.deepEqual(ElvioScenes.edit({ state: "on", brightness: 80 }, { state: "on" }), { state: "on", brightness: 80 });
  assert.deepEqual(ElvioScenes.edit({ state: "off" }, { brightness: 102 }), { state: "on", brightness: 102 });
});

test("edit: Weißton und Farbe schließen sich aus", () => {
  const warm = ElvioScenes.edit({ state: "on", brightness: 200, color_mode: "hs", hs_color: [240, 80] }, { color_temp_kelvin: 2700 });
  assert.deepEqual(warm, { state: "on", brightness: 200, color_mode: "color_temp", color_temp_kelvin: 2700 });
  const blau = ElvioScenes.edit(warm, { hs_color: [240, 80] });
  assert.deepEqual(blau, { state: "on", brightness: 200, color_mode: "hs", hs_color: [240, 80] });
});

test("pct/bri: Prozent und Helligkeit (1–255) ineinander", () => {
  assert.equal(ElvioScenes.pct(102), 40);
  assert.equal(ElvioScenes.pct(undefined), 100);
  assert.equal(ElvioScenes.bri(40), 102);
  assert.equal(ElvioScenes.bri(0), 1);
  assert.equal(ElvioScenes.bri(100), 255);
});
