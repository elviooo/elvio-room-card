import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { devBuild, isDevPath, DEV_PATH } from "../tools/dev-server.mjs";

const SRC = readFileSync(new URL("../elvio-room-card.js", import.meta.url), "utf8");

test("devBuild: registriert die Karte als elvio-room-card-dev", () => {
  const out = devBuild(SRC);
  assert.ok(out.includes('customElements.define("elvio-room-card-dev", ElvioRoomCard);'));
  assert.ok(out.includes('type: "elvio-room-card-dev",'));
  assert.ok(!out.includes('customElements.define("elvio-room-card",'));
});

test("devBuild: findet die Stellen noch (sonst Ersetzung an die Datei anpassen)", () => {
  assert.equal(SRC.split('customElements.define("elvio-room-card",').length, 2);
  assert.equal(SRC.split('  type: "elvio-room-card",').length, 2);
  assert.equal(SRC.split('  name: "Elvio Raumkarte",').length, 2);
});

test("isDevPath: nur die Entwicklerkarte, Query egal", () => {
  assert.equal(DEV_PATH, "/elvio-dev/elvio-room-card-dev.js");
  assert.equal(isDevPath("/elvio-dev/elvio-room-card-dev.js"), true);
  assert.equal(isDevPath("/elvio-dev/elvio-room-card-dev.js?v=2"), true);
  assert.equal(isDevPath("/api/websocket"), false);
  assert.equal(isDevPath("/elvio-dev/elvio-room-card-dev.jsx"), false);
  assert.equal(isDevPath(undefined), false);
});
