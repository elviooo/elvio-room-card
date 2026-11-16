// Lädt elvio-room-card.js unverändert in eine Node-VM. Gebraucht wird nur die reine Logik;
// für die Browser-Teile, die beim Laden ausgeführt werden (class … extends HTMLElement,
// customElements.define, window.customCards), reichen Platzhalter.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../elvio-room-card.js", import.meta.url), "utf8");
const EXPORT = "\n;globalThis.__test = { ElvioRooms, ElvioEnergy, ElvioPeople, ElvioScenes, ElvioLeave, ElvioNotices, ElvioButtons, IMAGE_BASE, BUNDLED_IMAGES, ROOM_ICONS, AUTO_DOMAINS };";

// Ergebnisse aus der VM haben deren Array-/Object-Prototypen; kopiert sind sie normale Werte.
const plain = (v) => (v === undefined ? v : structuredClone(v));

export function loadCard() {
  const sandbox = {
    HTMLElement: class {},
    customElements: { define() {} },
    window: {},
    URLSearchParams,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC + EXPORT, sandbox, { filename: "elvio-room-card.js" });
  const t = sandbox.__test;
  const rooms = {};
  for (const [name, fn] of Object.entries(t.ElvioRooms)) rooms[name] = (...args) => plain(fn(...args));
  const energy = {};
  for (const [name, fn] of Object.entries(t.ElvioEnergy)) energy[name] = (...args) => plain(fn(...args));
  const people = {};
  for (const [name, fn] of Object.entries(t.ElvioPeople)) people[name] = (...args) => plain(fn(...args));
  const scenes = {};
  for (const [name, fn] of Object.entries(t.ElvioScenes)) scenes[name] = (...args) => plain(fn(...args));
  const leave = {};
  for (const [name, fn] of Object.entries(t.ElvioLeave)) leave[name] = (...args) => plain(fn(...args));
  const notices = {};
  for (const [name, fn] of Object.entries(t.ElvioNotices)) notices[name] = (...args) => plain(fn(...args));
  const buttons = {};
  for (const [name, fn] of Object.entries(t.ElvioButtons)) buttons[name] = (...args) => plain(fn(...args));
  return {
    ElvioButtons: buttons,
    ElvioNotices: notices,
    ElvioLeave: leave,
    ElvioRooms: rooms,
    ElvioEnergy: energy,
    ElvioPeople: people,
    ElvioScenes: scenes,
    IMAGE_BASE: t.IMAGE_BASE,
    BUNDLED_IMAGES: plain(t.BUNDLED_IMAGES),
    ROOM_ICONS: plain(t.ROOM_ICONS),
    AUTO_DOMAINS: plain(t.AUTO_DOMAINS),
  };
}
