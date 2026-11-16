import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Eigener Loader statt load.mjs: braucht nur extensionStore und dieselben Platzhalter.
const SRC = readFileSync(new URL("../elvio-room-card.js", import.meta.url), "utf8");
const sandbox = { HTMLElement: class {}, customElements: { define() {} }, window: {}, URLSearchParams, console };
vm.createContext(sandbox);
vm.runInContext(SRC + "\n;globalThis.__test = { extensionStore };", sandbox, { filename: "elvio-room-card.js" });
const { extensionStore } = sandbox.__test;

// Websocket-Attrappe: antwortet je Befehlstyp, merkt sich die Aufrufe.
function fakeWs(handlers) {
  const calls = [];
  const ws = async (msg) => {
    calls.push(structuredClone(msg));
    const h = handlers[msg.type];
    if (!h) throw { code: "unknown_command", message: `Unknown command ${msg.type}` };
    return h(msg);
  };
  return { ws, calls };
}

const CARD = { id: "1422024850", full_name: "elviooo/elvio-room-card", installed_version: "v1.6.0", available_version: "v1.6.1" };

test("extensionStore: Marketplace zuerst, nur Dashboard-Erweiterungen, Installation per ID", async () => {
  const { ws, calls } = fakeWs({
    "marketplace/repositories/list": () => [CARD],
    "marketplace/repository/install": () => null,
    "hacs/repositories/list": () => assert.fail("HACS nicht fragen, wenn der Marketplace da ist"),
  });
  const store = await extensionStore(ws, ["frontend", "hacs", "marketplace"]);
  assert.equal(store.name, "Marketplace");
  assert.equal(store.repos[0].full_name, "elviooo/elvio-room-card");
  await store.install(store.repos[0]);
  assert.deepEqual(calls, [
    { type: "marketplace/repositories/list", categories: ["plugin"] },
    { type: "marketplace/repository/install", repository: "1422024850" },
  ]);
});

test("extensionStore: Hinweis nicht bestätigt → verständliche Meldung, nichts bestätigt", async () => {
  const { ws, calls } = fakeWs({
    "marketplace/repositories/list": () => [CARD],
    "marketplace/repository/install": () => {
      throw { code: "warning_not_accepted", message: "Accept the warning first" };
    },
  });
  const store = await extensionStore(ws, ["marketplace"]);
  await assert.rejects(store.install(CARD), { message: /Marketplace .*öffnen .*Hinweis bestätigen/ });
  assert.ok(!calls.some((c) => c.type === "marketplace/warning/accept"));
});

test("extensionStore: andere Fehler beim Installieren gehen unverändert durch", async () => {
  const err = { code: "github_rate_limited", message: "Rate limited" };
  const { ws } = fakeWs({
    "marketplace/repositories/list": () => [CARD],
    "marketplace/repository/install": () => {
      throw err;
    },
  });
  const store = await extensionStore(ws, ["marketplace"]);
  await assert.rejects(store.install(CARD), (e) => e === err);
});

test("extensionStore: Marketplace nicht geladen → HACS wie bisher", async () => {
  const { ws, calls } = fakeWs({
    "marketplace/repositories/list": () => {
      throw { code: "not_loaded", message: "not loaded" };
    },
    "hacs/repositories/list": () => [CARD],
    "hacs/repository/download": () => null,
  });
  const store = await extensionStore(ws, ["marketplace", "hacs"]);
  assert.equal(store.name, "HACS");
  await store.install(CARD);
  assert.deepEqual(calls.slice(1), [
    { type: "hacs/repositories/list" },
    { type: "hacs/repository/download", repository: "1422024850" },
  ]);
});

test("extensionStore: Marketplace-Befehl unbekannt und kein HACS → null", async () => {
  const { ws } = fakeWs({});
  assert.equal(await extensionStore(ws, ["marketplace"]), null);
});

test("extensionStore: nur HACS (HA vor 2026.11)", async () => {
  const { ws, calls } = fakeWs({ "hacs/repositories/list": () => [CARD] });
  const store = await extensionStore(ws, ["hacs"]);
  assert.equal(store.name, "HACS");
  assert.deepEqual(calls, [{ type: "hacs/repositories/list" }]);
});

test("extensionStore: weder noch → null, ohne Anfrage", async () => {
  const { ws, calls } = fakeWs({});
  assert.equal(await extensionStore(ws, ["frontend"]), null);
  assert.equal(calls.length, 0);
});

test("extensionStore: andere Fehler beim Auflisten brechen ab (wie bisher bei HACS)", async () => {
  const { ws } = fakeWs({
    "marketplace/repositories/list": () => {
      throw { code: "unauthorized", message: "Unauthorized" };
    },
    "hacs/repositories/list": () => [CARD],
  });
  await assert.rejects(extensionStore(ws, ["marketplace", "hacs"]), { code: "unauthorized" });
});
