import test from "node:test";
import assert from "node:assert/strict";
import { loadCard } from "./load.mjs";

const { cameraCrop } = loadCard();

test("cameraCrop: ohne Angabe kein Ausschnitt", () => {
  assert.equal(cameraCrop(undefined), null);
  assert.equal(cameraCrop(null), null);
});

test("cameraCrop: Prozent je Seite als Anteile, fehlende Seiten 0", () => {
  assert.deepEqual(cameraCrop({ top: 20 }), { top: 0.2, bottom: 0, left: 0, right: 0 });
  assert.deepEqual(cameraCrop({ top: "10", bottom: 5, left: 0, right: 12.5 }), { top: 0.1, bottom: 0.05, left: 0, right: 0.125 });
});

test("cameraCrop: höchstens 80 % je Richtung", () => {
  assert.deepEqual(cameraCrop({ top: 60, bottom: 20, left: 40, right: 40 }), { top: 0.6, bottom: 0.2, left: 0.4, right: 0.4 });
  assert.throws(() => cameraCrop({ top: 60, bottom: 21 }), /höchstens 80 %/);
  assert.throws(() => cameraCrop({ left: 81 }), /höchstens 80 %/);
});

test("cameraCrop: unsinnige Angaben werfen", () => {
  assert.throws(() => cameraCrop(20), /Seiten mit Prozent/);
  assert.throws(() => cameraCrop([20]), /Seiten mit Prozent/);
  assert.throws(() => cameraCrop({ oben: 20 }), /oben gibt es nicht/);
  assert.throws(() => cameraCrop({ top: -5 }), /Zahl ab 0/);
  assert.throws(() => cameraCrop({ top: "20%" }), /Zahl ab 0/);
});
