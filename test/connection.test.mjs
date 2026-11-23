import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { ensureConnection } = loadCard();

// Nachbau der HA-WebSocket-Verbindung (home-assistant-js-websocket): ping(), reconnect(force),
// Ereignis "ready" nach dem Neuverbinden.
function fakeConn({ connected = true, ping = "ok" } = {}) {
  const listeners = {};
  return {
    connected,
    pings: 0,
    reconnects: [],
    ping() {
      this.pings++;
      if (ping === "ok") return Promise.resolve();
      if (ping === "fail") return Promise.reject(new Error("Verbindung weg"));
      return new Promise(() => {}); // halb offen: keine Antwort, nie
    },
    reconnect(force) {
      this.reconnects.push(force);
      this.connected = false;
    },
    addEventListener(ev, cb) {
      (listeners[ev] ||= []).push(cb);
    },
    removeEventListener(ev, cb) {
      listeners[ev] = (listeners[ev] || []).filter((x) => x !== cb);
    },
    ready() {
      this.connected = true;
      for (const cb of [...(listeners.ready || [])]) cb();
    },
    listeners(ev) {
      return (listeners[ev] || []).length;
    },
  };
}

const OPTS = { pingMs: 20, readyMs: 60 };
const later = (ms, fn) => setTimeout(fn, ms);

test("ensureConnection: ohne Verbindung nichts zu tun", async () => {
  assert.equal(await ensureConnection(null, OPTS), false);
  assert.equal(await ensureConnection(undefined, OPTS), false);
});

test("ensureConnection: Verbindung antwortet – nicht neu verbinden", async () => {
  const conn = fakeConn();
  assert.equal(await ensureConnection(conn, OPTS), false);
  assert.equal(conn.pings, 1);
  assert.deepEqual(conn.reconnects, []);
});

test("ensureConnection: keine Antwort auf ping – erzwungen neu verbinden, true nach ready", async () => {
  const conn = fakeConn({ ping: "hang" });
  const p = ensureConnection(conn, OPTS);
  later(35, () => conn.ready());
  assert.equal(await p, true);
  assert.deepEqual(conn.reconnects, [true]);
  assert.equal(conn.listeners("ready"), 0);
});

test("ensureConnection: ping schlägt fehl – erzwungen neu verbinden", async () => {
  const conn = fakeConn({ ping: "fail" });
  const p = ensureConnection(conn, OPTS);
  later(5, () => conn.ready());
  assert.equal(await p, true);
  assert.deepEqual(conn.reconnects, [true]);
});

test("ensureConnection: HA verbindet schon neu – nur auf ready warten", async () => {
  const conn = fakeConn({ connected: false });
  const p = ensureConnection(conn, OPTS);
  later(10, () => conn.ready());
  assert.equal(await p, true);
  assert.equal(conn.pings, 0);
  assert.deepEqual(conn.reconnects, []);
});

test("ensureConnection: kommt ready nicht rechtzeitig, false und kein Zuhörer bleibt hängen", async () => {
  const conn = fakeConn({ ping: "hang" });
  assert.equal(await ensureConnection(conn, OPTS), false);
  assert.deepEqual(conn.reconnects, [true]);
  assert.equal(conn.listeners("ready"), 0);
});

test("ensureConnection: gleichzeitige Aufrufe teilen sich eine Prüfung", async () => {
  const conn = fakeConn({ ping: "hang" });
  const a = ensureConnection(conn, OPTS);
  const b = ensureConnection(conn, OPTS);
  later(35, () => conn.ready());
  assert.deepEqual([await a, await b], [true, true]);
  assert.equal(conn.pings, 1);
  assert.deepEqual(conn.reconnects, [true]);
  // danach prüft ein neuer Aufruf wieder selbst
  await ensureConnection(conn, OPTS);
  assert.equal(conn.pings, 2);
});
