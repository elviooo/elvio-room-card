import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioButtons } = loadCard();

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });
const TYPES = ["btn_up", "long_push", "double_push", "single_push", "triple_push", "btn_down"];

test("isButton: Taster-Ereignisse ja, Klingel und Sonstiges nein", () => {
  assert.equal(ElvioButtons.isButton(st("event.taster", "unknown", { event_types: TYPES })), true);
  assert.equal(ElvioButtons.isButton(st("event.klingel", "unknown", { event_types: ["ring"], device_class: "doorbell" })), false);
  assert.equal(ElvioButtons.isButton(st("event.zugang", "unknown", { event_types: ["access"] })), false);
  assert.equal(ElvioButtons.isButton(st("sensor.x", "1", { event_types: TYPES })), false);
});

test("presses: in fester Reihenfolge, nur was der Taster kann", () => {
  assert.deepEqual(ElvioButtons.presses(TYPES).map((p) => p.type), ["single_push", "double_push", "triple_push", "long_push"]);
  assert.deepEqual(ElvioButtons.presses(["single_push", "long_push"]).map((p) => p.label), ["1× drücken", "Lang drücken"]);
});

test("automationId: aus der Entität", () => {
  assert.equal(ElvioButtons.automationId("event.eg_a1_taster_treppe_eg"), "elvio_taster_eg_a1_taster_treppe_eg");
});

const MAP = {
  single_push: { kind: "toggle", targets: ["light.treppe", "light.flur"] },
  double_push: { kind: "scene", scene: "scene.abend" },
  long_push: { kind: "all_off" },
  triple_push: { kind: "leave" },
};

test("automation: ein Auslöser, je Drückart eine Wahl, Warteschlange", () => {
  const a = ElvioButtons.automation("event.t", "Taster Treppe EG", MAP);
  assert.equal(a.id, "elvio_taster_t");
  assert.equal(a.alias, "Taster: Taster Treppe EG");
  assert.equal(a.mode, "queued");
  assert.deepEqual(a.triggers, [{ trigger: "state", entity_id: "event.t", not_from: ["unavailable"] }]);
  const choose = a.actions[0].choose;
  assert.deepEqual(choose.map((c) => c.conditions[0].state), ["single_push", "double_push", "triple_push", "long_push"]);
  assert.deepEqual(choose[0], {
    conditions: [{ condition: "state", entity_id: "event.t", attribute: "event_type", state: "single_push" }],
    sequence: [{ action: "homeassistant.toggle", target: { entity_id: ["light.treppe", "light.flur"] } }],
  });
  assert.deepEqual(choose[1].sequence, [{ action: "scene.turn_on", target: { entity_id: "scene.abend" } }]);
  assert.deepEqual(choose[2].sequence, [{ action: "script.turn_on", target: { entity_id: "script.haus_verlassen" } }]);
  assert.deepEqual(choose[3].sequence, [{ action: "light.turn_off", target: { entity_id: "all" } }]);
});

test("automation: ohne Belegung keine Automation; leeres Umschalten zählt nicht", () => {
  assert.equal(ElvioButtons.automation("event.t", "T", {}), null);
  assert.equal(ElvioButtons.automation("event.t", "T", { single_push: { kind: "toggle", targets: [] } }), null);
  assert.equal(ElvioButtons.automation("event.t", "T", { single_push: { kind: "none" } }), null);
});

test("parse: liest die eigene Automation zurück, Fremdes bleibt erhalten", () => {
  const a = ElvioButtons.automation("event.t", "T", MAP);
  assert.deepEqual(ElvioButtons.parse(a), MAP);
  a.actions[0].choose[0].sequence = [{ action: "notify.notify", data: { message: "x" } }];
  const p = ElvioButtons.parse(a);
  assert.equal(p.single_push.kind, "other");
  const again = ElvioButtons.automation("event.t", "T", p);
  assert.deepEqual(again.actions[0].choose[0].sequence, [{ action: "notify.notify", data: { message: "x" } }]);
});

test("summary: kurz und lesbar", () => {
  const names = { "light.treppe": "Licht Treppenhaus", "light.flur": "Flur", "scene.abend": "Abend" };
  assert.equal(
    ElvioButtons.summary(MAP, (id) => names[id] || id),
    "1×: Licht Treppenhaus, Flur · 2×: Abend · 3×: Haus verlassen · lang: Alle Lichter aus",
  );
  assert.equal(ElvioButtons.summary({}, (id) => id), "");
  assert.equal(
    ElvioButtons.summary({ single_push: { kind: "toggle", targets: ["a", "b", "c", "d"] } }, (id) => id.toUpperCase()),
    "1×: A, B +2",
  );
});

test("lastPress: Art und Zeitpunkt des letzten Drückens", () => {
  assert.deepEqual(ElvioButtons.lastPress(st("event.t", "2026-11-18T13:20:00.000+00:00", { event_type: "double_push" })), {
    label: "2×",
    at: Date.parse("2026-11-18T13:20:00.000+00:00"),
  });
  assert.equal(ElvioButtons.lastPress(st("event.t", "unknown", {})), null);
});
