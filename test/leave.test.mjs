import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ElvioLeave } = loadCard();

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

test("settings: aus der Dashboard-Konfiguration, sonst Grundeinstellung", () => {
  assert.deepEqual(ElvioLeave.settings(null), { switches: [], media: true, auto: false });
  assert.deepEqual(ElvioLeave.settings({ elvio_leave: { switches: ["switch.tv"], media: false, auto: true } }), {
    switches: ["switch.tv"],
    media: false,
    auto: true,
  });
  assert.deepEqual(ElvioLeave.settings({ elvio_leave: { switches: "kaputt" } }), { switches: [], media: true, auto: false });
});

test("script: alle Lichter aus, gewählte Steckdosen, Musik pausieren – Fehler halten nicht auf", () => {
  const cfg = ElvioLeave.script({ switches: ["switch.tv", "switch.insel"], media: true, players: ["media_player.wohnen"] });
  assert.equal(cfg.alias, "Haus verlassen");
  assert.equal(cfg.mode, "single");
  assert.deepEqual(cfg.sequence, [
    { action: "light.turn_off", target: { entity_id: "all" }, continue_on_error: true },
    { action: "switch.turn_off", target: { entity_id: ["switch.tv", "switch.insel"] }, continue_on_error: true },
    { action: "media_player.media_pause", target: { entity_id: ["media_player.wohnen"] }, continue_on_error: true },
  ]);
});

test("script: ohne Steckdosen und ohne Musik nur das Licht", () => {
  assert.deepEqual(ElvioLeave.script({ switches: [], media: false, players: ["media_player.x"] }).sequence, [
    { action: "light.turn_off", target: { entity_id: "all" }, continue_on_error: true },
  ]);
  assert.equal(ElvioLeave.script({ switches: [], media: true, players: [] }).sequence.length, 1);
});

test("automation: wenn niemand mehr zuhause ist (10 Minuten), Skript starten", () => {
  const a = ElvioLeave.automation();
  assert.equal(a.id, "elvio_haus_verlassen");
  assert.deepEqual(a.triggers, [{ trigger: "state", entity_id: "zone.home", to: "0", for: { minutes: 10 } }]);
  assert.deepEqual(a.actions, [{ action: "script.turn_on", target: { entity_id: "script.haus_verlassen" } }]);
});

test("plan: Lichter an, gewählte Steckdosen an, laufende Musik", () => {
  const states = {
    "light.a": st("light.a", "on", { friendly_name: "Decke" }),
    "light.b": st("light.b", "off"),
    "light.c": st("light.c", "unavailable"),
    "switch.tv": st("switch.tv", "on"),
    "switch.insel": st("switch.insel", "off"),
    "switch.kuehlschrank": st("switch.kuehlschrank", "on"),
    "media_player.wohnen": st("media_player.wohnen", "playing"),
    "media_player.bad": st("media_player.bad", "paused"),
  };
  assert.deepEqual(ElvioLeave.plan(states, { switches: ["switch.tv", "switch.insel"], media: true }), {
    lights: ["light.a"],
    switches: ["switch.tv"],
    playing: ["media_player.wohnen"],
  });
  assert.deepEqual(ElvioLeave.plan(states, { switches: [], media: false }).playing, []);
});
