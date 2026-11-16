// Lädt elvio-room-card.js unverändert in eine Node-VM. Gebraucht wird nur die reine Logik;
// für die Browser-Teile, die beim Laden ausgeführt werden (class … extends HTMLElement,
// customElements.define, window.customCards), reichen Platzhalter.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../elvio-room-card.js", import.meta.url), "utf8");
const EXPORT = "\n;globalThis.__test = { ElvioRooms, IMAGE_BASE, BUNDLED_IMAGES, ROOM_ICONS, AUTO_DOMAINS };";

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
  return {
    ElvioRooms: rooms,
    IMAGE_BASE: t.IMAGE_BASE,
    BUNDLED_IMAGES: plain(t.BUNDLED_IMAGES),
    ROOM_ICONS: plain(t.ROOM_ICONS),
    AUTO_DOMAINS: plain(t.AUTO_DOMAINS),
  };
}
