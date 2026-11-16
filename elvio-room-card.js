// Raumkarte fürs Wandtablet: Vollbild-Hintergrund, großer Titel, Chips, Milchglas-Kacheln.
// Bewusst ohne Abhängigkeiten und ohne Build: die Datei kommt per Git-Update unverändert
// nach /config/www und wird von Home Assistant direkt geladen.
//
// Die Karte legt sich per position:fixed über die ganze Oberfläche (Kopfleiste und
// Seitenleiste von HA verschwinden darunter). Ein Tipp auf die Marke oben links führt
// zurück in die normale Oberfläche (menu_path). Dialoge von HA liegen in der Top-Layer
// und bleiben darüber sichtbar.

// Symbole für Sensor-Chips nach Geräteklasse (statt des allgemeinen ⓘ).
const DEVICE_CLASS_ICON = {
  carbon_dioxide: "mdi:molecule-co2",
  humidity: "mdi:water-percent",
  temperature: "mdi:thermometer",
  pm25: "mdi:air-filter",
  power: "mdi:flash-outline",
  energy: "mdi:lightning-bolt-outline",
  illuminance: "mdi:brightness-5",
  motion: "mdi:motion-sensor",
  moisture: "mdi:water-alert-outline",
  door: "mdi:door",
  window: "mdi:window-open-variant",
  battery: "mdi:battery-outline",
};

const CAMERA_REFRESH_MS = 10000;
const CLOCK_REFRESH_MS = 15000;
// Ein Klingeln gilt so lange als „aktuell“ (Kachel-Text, Hervorhebung).
const RING_ACTIVE_MS = 60000;
// Nur ein Ereignis, das höchstens so alt ist, öffnet das Popup – kein Popup für alte
// Zeitstempel, die nach einem Neuladen oder Neustart wieder auftauchen.
const RING_FRESH_MS = 30000;
const POPUP_AUTO_CLOSE_MS = 120000;
const UNLOCK_CONFIRM_MS = 5000;
// Gegensprechen über SIP Core (Klingel-Kachel mit sip_extension): Nach dem Annehmen sendet
// die Karte auf Wunsch eine Taste (sip_answer_dtmf). Bewusst ohne Vorgabe: Bei vielen
// Türstationen öffnet eine Taste das Schloss – ein Annehmen darf nie von selbst die Tür
// öffnen. Bei UniFi Access öffnet „*“ (help.ui.com, Third-Party SIP); „*“ ist hier gesperrt.
// Abstand zwischen bestätigtem Anruf und Taste: Asterisk soll beide Seiten schon verbunden haben.
const SIP_DTMF_DELAY_MS = 600;
// Die Karte sendet die Taste erst, wenn der Anruf bestätigt ist (ACK da,
// RTCSession.C.STATUS_CONFIRMED) – strenger als JsSIP, das schon ab WAITING_FOR_ACK annimmt.
const SIP_STATUS_CONFIRMED = 9;
// Ab hier hängt die eigene Mikrofonspur an der Verbindung (RTCSession.C.STATUS_WAITING_FOR_ACK).
// Vorher liefe Stummschalten ins Leere, und JsSIP holt es beim Anhängen nicht nach.
const SIP_STATUS_WAITING_FOR_ACK = 6;
// Nach dem Auflegen bleibt der Hinweis so lange stehen, dann schließt das Popup.
const SIP_END_HOLD_MS = 1800;
const SIP_ERROR_HOLD_MS = 6000;
// Fortschrittsbalken der Live-Karte läuft lokal weiter – HA meldet die Position nur bei
// Sprüngen (Pause, Titelwechsel), nicht jede Sekunde.
const PROGRESS_TICK_MS = 1000;
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_LIMIT = 12;
const LIBRARY_PAGE = 40;
// Termine: neu laden alle 5 Minuten oder sobald sich ein Kalender ändert.
const AGENDA_REFRESH_MS = 5 * 60 * 1000;
// Spritpreise ändern sich über den Tag mehrfach; der Verlauf fürs Minidiagramm wird
// nicht bei jedem Zustandswechsel, sondern in diesem Takt neu geholt.
const FUEL_REFRESH_MS = 15 * 60 * 1000;
// Einrichtung: was zur Karte gehört, aber außerhalb der Karte installiert werden muss.
const SETUP_TTL_MS = 10 * 60 * 1000;
const SETUP_CARD_REPO = "elviooo/elvio-room-card";
const SETUP_KIOSK_REPO = "NemesisRE/kiosk-mode";
const SETUP_MA_SLUG = "d5369777_music_assistant";
const SETUP_MA_STORE = "https://github.com/music-assistant/home-assistant-addon";
// Ein Stand für alle Ansichten: sonst fragt jede Ansicht HACS und Supervisor neu.
let setupCache = null;
// Speichern in der Dashboard-Konfiguration lädt das Dashboard neu – die Karte wird neu
// angelegt. Dieses Blatt öffnet die neue Karte dann wieder (gleiche Seite, kurz danach).
let reopenSheet = null;
// Energie-Seite: Einstellungen von HA-Energie für alle Karten gemeinsam (eine Abfrage statt
// einer je Ansicht), alle 10 Minuten neu; Summen und Verlauf bei offener Seite alle 5 Minuten.
const ENERGY_PREFS_TTL_MS = 10 * 60 * 1000;
const ENERGY_REFRESH_MS = 5 * 60 * 1000;
const ENERGY_PERIODS = [
  { key: "day", label: "Heute" },
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
  { key: "year", label: "Jahr" },
];
// Farben im Verlauf (dunkle Fläche, mit dem Farb-Prüfer der Diagramm-Regeln geprüft):
// Bezug blau, Einspeisung türkis, Solar orange – wie die Gewohnheit aus HA-Energie.
const ENERGY_COLORS = { gridIn: "#3987e5", gridOut: "#199e70", solar: "#d95926", used: "#3987e5" };
let energyCache = null;

function loadEnergyPrefs(hass, force) {
  if (!force && energyCache && Date.now() - energyCache.at < ENERGY_PREFS_TTL_MS) return energyCache.promise;
  // Ohne Einstellungen antwortet HA mit einem Fehler („No prefs“) – das heißt schlicht „leer“.
  const promise = hass
    .callWS({ type: "energy/get_prefs" })
    .catch(() => null)
    .then((prefs) => ElvioEnergy.normalize(prefs));
  energyCache = { at: Date.now(), promise };
  return promise;
}

function fmtWatt(w) {
  const a = Math.abs(w);
  return a < 1000 ? `${Math.round(a)} W` : `${(a / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`;
}

function fmtKwh(k) {
  if (k == null || !Number.isFinite(k)) return "–";
  // Kleine Mengen (ein Licht am Tag) nicht als „0,0“: unter 1 kWh zwei Stellen.
  const a = Math.abs(k);
  const digits = a === 0 ? 0 : a < 1 ? 2 : a < 10 ? 1 : 0;
  return `${k.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} kWh`;
}
let setupRunning = null;
const FUEL_KINDS = [
  { key: "e5", label: "Super E5" },
  { key: "e10", label: "E10" },
  { key: "diesel", label: "Diesel" },
];
// Bildschirmschoner: Fotowechsel und Prüftakt für „untätig“.
const SAVER_PHOTO_MS = 20000;
const SAVER_CHECK_MS = 5000;
// Magnet: kurze Wische unter diesem Anteil federn zurück, längere rasten um.
const SNAP_THRESHOLD = 0.12;
const SNAP_IDLE_MS = 140;
// Geräte, die ein Raum von selbst zeigt, sobald sie in HA dem Raum (Bereich) zugeordnet
// sind. Alles andere (Sensoren, Knöpfe …) erst mit dem Label „Am Tablet“.
const AUTO_DOMAINS = [
  "light", "cover", "climate", "lock", "media_player", "fan", "switch", "camera",
  "vacuum", "humidifier", "valve", "water_heater", "alarm_control_panel",
];
// Labels in HA – die Wahl des Kunden liegt in der Registry, nicht im Repo, und übersteht
// jedes Update per Git pull. IDs fest, damit auch ein Benutzer ohne Admin-Rechte sie lesen kann.
const LABEL_SHOW = { id: "am_tablet", name: "Am Tablet", icon: "mdi:tablet-dashboard" };
const LABEL_HIDE = { id: "nicht_am_tablet", name: "Nicht am Tablet", icon: "mdi:eye-off-outline" };
// Geräte hinzufügen: was sich einem Raum zuordnen lässt und was davon vorausgewählt ist.
// Kachel-Typen dieser Version. Ohne Entität kommen die einen aus; ein unbekannter Typ (aus einer
// neueren Version, das Tablet hat aber noch die alte Karte) wird nicht zum Konfigurationsfehler
// für die ganze Ansicht, sondern zu einer Kachel „Seite neu laden“.
const TILE_TYPES_NO_ENTITY = [
  "lights", "service", "account", "now_playing", "search", "agenda", "energy", "tablet_room", "automations", "fuel", "setup", "views",
];
const TILE_TYPES = [...TILE_TYPES_NO_ENTITY, "entity", "climate", "camera", "doorbell", "media", "tv", "toggle", "action", "weather"];
const PICK_DOMAINS = [...AUTO_DOMAINS, "sensor", "binary_sensor", "event", "button", "siren"];
const USEFUL_CLASSES = {
  sensor: [
    "temperature", "humidity", "illuminance", "carbon_dioxide", "pm25", "pm10", "aqi",
    "volatile_organic_compounds", "volatile_organic_compounds_parts", "moisture",
    "precipitation", "precipitation_intensity", "wind_speed",
  ],
  binary_sensor: [
    "motion", "occupancy", "presence", "door", "window", "garage_door", "opening",
    "smoke", "moisture", "gas", "carbon_monoxide", "safety", "lock",
  ],
  event: ["doorbell"],
};
// Filter und Symbole in der Auswahl „Hinzufügen“ (Art aus ElvioRooms.deviceKind).
const ADD_FILTERS = [
  { key: "all", label: "Alle" },
  { key: "camera", label: "Kameras & Klingeln" },
  { key: "sensor", label: "Sensoren" },
  { key: "switch", label: "Schalter & Steckdosen" },
  { key: "light", label: "Licht" },
  { key: "other", label: "Sonstiges" },
];
const KIND_ICONS = {
  camera: "mdi:cctv",
  sensor: "mdi:motion-sensor",
  switch: "mdi:power-socket-de",
  light: "mdi:lightbulb-outline",
  other: "mdi:devices",
};
const ALERT_CLASSES = ["smoke", "moisture", "gas", "carbon_monoxide", "safety"];
// Symbole wie in HA: [an, aus] für Melder, sonst eines.
const STATE_ICONS = {
  binary_sensor: {
    motion: ["mdi:motion-sensor", "mdi:motion-sensor-off"],
    occupancy: ["mdi:home-account", "mdi:home-outline"],
    presence: ["mdi:home-account", "mdi:home-outline"],
    door: ["mdi:door-open", "mdi:door-closed"],
    window: ["mdi:window-open-variant", "mdi:window-closed-variant"],
    garage_door: ["mdi:garage-open", "mdi:garage"],
    opening: ["mdi:square-outline", "mdi:square"],
    smoke: ["mdi:smoke-detector-variant-alert", "mdi:smoke-detector-variant"],
    moisture: ["mdi:water-alert", "mdi:water-off"],
    gas: ["mdi:alert-circle", "mdi:check-circle"],
    carbon_monoxide: ["mdi:alert-circle", "mdi:check-circle"],
    safety: ["mdi:alert-circle", "mdi:check-circle"],
    lock: ["mdi:lock-open", "mdi:lock"],
  },
  sensor: {
    temperature: "mdi:thermometer",
    humidity: "mdi:water-percent",
    illuminance: "mdi:brightness-5",
    carbon_dioxide: "mdi:molecule-co2",
    pm25: "mdi:blur",
    pm10: "mdi:blur",
    aqi: "mdi:air-filter",
    moisture: "mdi:water-percent",
    precipitation: "mdi:weather-rainy",
    precipitation_intensity: "mdi:weather-rainy",
    wind_speed: "mdi:weather-windy",
    power: "mdi:flash",
    energy: "mdi:lightning-bolt",
    voltage: "mdi:sine-wave",
    current: "mdi:current-ac",
    battery: "mdi:battery",
    signal_strength: "mdi:wifi",
  },
  event: {
    doorbell: "mdi:doorbell",
    button: "mdi:gesture-tap-button",
    motion: "mdi:motion-sensor",
  },
};
// Wo dieses Tablet hängt: je Gerät im Browser gespeichert, nicht in HA – ein zweites
// Tablet oder ein Handy hängt woanders bzw. nirgends.
const TABLET_ROOM_KEY = "elvio.tablet_room";
const AGENDA_COLORS = ["#7cc4ff", "#f5b450", "#9be08a", "#f08aa8", "#c3a6ff", "#6ee0d2"];

// Filter der Musiksuche → media_type von Music Assistant.
const SEARCH_FILTERS = [
  { key: "all", label: "Alles", types: ["track", "album", "artist", "playlist", "radio"] },
  { key: "track", label: "Titel", types: ["track"] },
  { key: "album", label: "Alben", types: ["album"] },
  { key: "artist", label: "Künstler", types: ["artist"] },
  { key: "playlist", label: "Playlists", types: ["playlist"] },
  { key: "radio", label: "Radio", types: ["radio"] },
];
const RESULT_KEYS = { track: "tracks", album: "albums", artist: "artists", playlist: "playlists", radio: "radio" };
const TYPE_LABEL = { track: "Titel", album: "Album", artist: "Künstler", playlist: "Playlist", radio: "Radio" };

const HVAC_LABEL = {
  heat: "Heizen",
  cool: "Kühlen",
  heat_cool: "Auto",
  auto: "Auto",
  dry: "Entfeuchten",
  fan_only: "Lüften",
};

const HVAC_ICON = {
  heat: "mdi:fire",
  cool: "mdi:snowflake",
  heat_cool: "mdi:sun-snowflake-variant",
  auto: "mdi:thermostat-auto",
  dry: "mdi:water-percent",
  fan_only: "mdi:fan",
};

function comfortLabel(temp) {
  if (temp < 18) return "Kühl";
  if (temp > 24) return "Warm";
  return "Angenehm";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const node = document.createElement("ha-icon");
  node.setAttribute("icon", name);
  return node;
}

// Deutlicher Knopf mit Symbol und Text (Bearbeiten, Geräte, Hinzufügen) – ein Textlink allein
// geht auf Fotos und am Wandtablet unter.
function pillButton(iconName, text) {
  const b = el("button", "pillbtn");
  setPill(b, iconName, text);
  return b;
}

function setPill(b, iconName, text) {
  b.replaceChildren(icon(iconName), el("span", "", text));
}

function setupErrText(err) {
  return (err && ((err.body && err.body.message) || err.message || err.code)) || String(err);
}

// ───────────── Räume aus HA-Bereichen (reine Logik, in Node testbar) ─────────────
// Ein Raum ist ein Bereich in Home Assistant: Name, Icon, Bild, Temperatursensor, Stockwerk
// und Reihenfolge stehen dort – der Kunde ändert sie am Tablet, Updates der Karte lassen
// sie in Ruhe. Altmodus: Räume als Einträge mit room: true in nav (bis v1.5.0).

// Bilder aus dem Repo (bilder/). Fest auf einen Tag, damit sich ein Raumbild nicht
// unbemerkt ändert, wenn im Repo ein Bild getauscht wird.
const IMAGE_BASE = "https://cdn.jsdelivr.net/gh/elviooo/elvio-room-card@v1.3.0/bilder/";
const BUNDLED_IMAGES = [
  "flur_oben", "flur_unten", "gaeste_bad", "garage", "garten", "kind_1", "kind_2",
  "master_bad", "schlafzimmer", "sicherheit", "wohnbereich", "zuhause",
];
// Auswahl im Raum-Blatt – bewusst kein Freitext, am Tablet tippt niemand „mdi:…“.
const ROOM_ICONS = [
  "mdi:sofa-outline", "mdi:television", "mdi:silverware-fork-knife", "mdi:stove", "mdi:fridge-outline",
  "mdi:bed-outline", "mdi:bed-single-outline", "mdi:bed-king-outline", "mdi:teddy-bear", "mdi:rocket-launch-outline",
  "mdi:bathtub-outline", "mdi:shower", "mdi:toilet", "mdi:washing-machine", "mdi:hanger",
  "mdi:desk", "mdi:laptop", "mdi:bookshelf", "mdi:dumbbell", "mdi:gamepad-variant-outline",
  "mdi:door", "mdi:stairs", "mdi:home-floor-negative-1", "mdi:garage-variant", "mdi:tools",
  "mdi:flower-outline", "mdi:pine-tree", "mdi:grill-outline", "mdi:pool", "mdi:car-outline",
];
// Stockwerke: Vorlagen (Name, Symbol, Ebene für HA) und Symbole zur Auswahl. Namen ohne
// Umlaute wie die übrigen Namen in HA.
const FLOOR_PRESETS = [
  { name: "Keller", icon: "mdi:home-floor-negative-1", level: -1 },
  { name: "Erdgeschoss", icon: "mdi:home-floor-0", level: 0 },
  { name: "Obergeschoss", icon: "mdi:home-floor-1", level: 1 },
  { name: "Dachgeschoss", icon: "mdi:home-roof", level: 2 },
  { name: "Aussen", icon: "mdi:tree-outline", level: null },
];
const FLOOR_ICONS = [
  "mdi:home-floor-negative-1", "mdi:home-floor-0", "mdi:home-floor-1", "mdi:home-floor-2", "mdi:home-floor-3",
  "mdi:home-roof", "mdi:tree-outline", "mdi:garage-variant", "mdi:stairs", "mdi:home-outline",
];
// Eigene Fotos: längste Kante beim Hochladen – reicht fürs Tablet, schont Speicher und Netz.
const ROOM_PHOTO_MAX = 1920;

const ElvioRooms = {
  // Slug-Varianten eines Namens: HA macht aus „ä“ ein „a“, die Bilder im Repo heißen „ae“.
  slugs(name) {
    const base = String(name || "").toLowerCase();
    const make = (map) =>
      base.replace(/[äöüß]/g, (ch) => map[ch]).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return [...new Set([make({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }), make({ ä: "a", ö: "o", ü: "u", ß: "ss" })])].filter(Boolean);
  },

  // Bild aus dem Kartenpaket, wenn Name oder ID zu einer Datei passt („Garage“ → garage.jpg).
  bundledImage(area) {
    const keys = [...ElvioRooms.slugs(area.name), area.area_id];
    const hit = keys.find((k) => BUNDLED_IMAGES.includes(k));
    return hit ? `${IMAGE_BASE}${hit}.jpg` : null;
  },

  isLegacy(nav) {
    return (nav || []).some((i) => i && i.room);
  },

  // Neuer Modus: Bereiche in Registry-Reihenfolge (so liefert HA hass.areas/hass.floors),
  // sortiert nach Stockwerk; Bereiche ohne (bekanntes) Stockwerk ans Ende.
  fromAreas(areas, floors, { basePath, hideLabel, includeHidden = false }) {
    const floorIdx = new Map((floors || []).map((f, i) => [f.floor_id, i]));
    const floorName = new Map((floors || []).map((f) => [f.floor_id, f.name]));
    const pos = (a) => (floorIdx.has(a.floor_id) ? floorIdx.get(a.floor_id) : Number.MAX_SAFE_INTEGER);
    return (areas || [])
      .map((a, i) => ({ a, i, hidden: (a.labels || []).includes(hideLabel) }))
      .filter((x) => includeHidden || !x.hidden)
      .sort((x, y) => pos(x.a) - pos(y.a) || x.i - y.i)
      .map(({ a, hidden }) => ({
        areaId: a.area_id,
        name: a.name,
        icon: a.icon || "mdi:door",
        image: a.picture || ElvioRooms.bundledImage(a),
        temperature: a.temperature_entity_id || null,
        floorId: floorIdx.has(a.floor_id) ? a.floor_id : null,
        floorName: floorIdx.has(a.floor_id) ? floorName.get(a.floor_id) : null,
        path: `${basePath}?bereich=${encodeURIComponent(a.area_id)}`,
        lights: [],
        hidden,
      }));
  },

  // Altmodus: dieselbe Form aus nav; den Bereich findet resolveArea über den Namen.
  fromNav(nav, resolveArea) {
    return (nav || [])
      .filter((i) => i && i.room)
      .map((r) => ({
        areaId: resolveArea(r.area || r.name),
        name: r.name,
        // Ohne Icon bleibt es leer wie bis v1.5.0: Musik-Chips zeigen dann den Lautsprecher.
        icon: r.icon || null,
        image: r.image || null,
        temperature: r.temperature || null,
        floorId: null,
        floorName: null,
        path: r.path,
        lights: r.lights || [],
        hidden: false,
      }));
  },

  // Gruppen für die Raumübersicht (Räume sind schon nach Stockwerk sortiert). Eine einzige
  // Gruppe braucht keine Überschrift.
  groupByFloor(rooms) {
    const groups = [];
    for (const r of rooms) {
      const key = r.floorId || null;
      let g = groups.find((x) => x.floorId === key);
      if (!g) {
        g = { floorId: key, title: key ? r.floorName : "Weitere", rooms: [] };
        groups.push(g);
      }
      g.rooms.push(r);
    }
    if (groups.length === 1) groups[0].title = null;
    return groups;
  },

  // Bearbeiten-Modus: jedes Stockwerk aus HA (auch ohne Räume, damit man es füllen kann), in
  // Registry-Reihenfolge; Räume ohne Stockwerk unter „Weitere“. Ohne Stockwerke eine Gruppe.
  groupForEdit(rooms, floors) {
    const list = floors || [];
    if (!list.length) return [{ floorId: null, title: null, rooms: [...(rooms || [])] }];
    const groups = list.map((f) => ({ floorId: f.floor_id, title: f.name, rooms: [] }));
    const rest = { floorId: null, title: "Weitere", rooms: [] };
    for (const r of rooms || []) (groups.find((g) => g.floorId === r.floorId) || rest).rooms.push(r);
    if (rest.rooms.length) groups.push(rest);
    return groups;
  },

  // Vorlage zu einem Namen; „Außen“ und „Aussen“ gelten als gleich.
  floorPreset(name) {
    const key = ElvioRooms.floorKey(name);
    const p = FLOOR_PRESETS.find((x) => ElvioRooms.floorKey(x.name) === key);
    return p ? { ...p } : null;
  },

  floorKey(name) {
    return String(name || "").trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  },

  areaFromLocation(search) {
    return new URLSearchParams(search || "").get("bereich") || null;
  },

  // Adresse der gemeinsamen Raum-Ansicht: /<dashboard>/raum, außer rooms_path ist gesetzt.
  roomsBasePath(pathname, override) {
    if (override) return override;
    const dash = String(pathname || "").split("/")[1] || "lovelace";
    return `/${dash}/raum`;
  },

  swap(ids, a, b) {
    const out = [...ids];
    const i = out.indexOf(a);
    const j = out.indexOf(b);
    if (i < 0 || j < 0) return out;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  },

  // ── Umstellung alter Dashboards (Räume in nav → Räume aus HA) ──

  // Kachel, die die Karte für eine Entität eines Raums von selbst baut (_autoTile nutzt das).
  autoTile(id, name) {
    const domain = String(id).split(".")[0];
    if (domain === "light") return { type: "lights", entities: [id], name };
    if (domain === "media_player") return { type: "media", entity: id };
    if (domain === "camera") return { type: "camera", entity: id };
    if (domain === "climate") return { type: "climate", entity: id };
    if (domain === "switch" || domain === "fan") {
      return { type: "toggle", entity: id, icon: domain === "fan" ? "mdi:fan" : "mdi:power-socket-de" };
    }
    return { type: "entity", entity: id };
  },

  // Vergleichbare Form eines Objekts: Schlüssel sortiert, ausgelassene und leere Schlüssel weg.
  canon(obj, omit = []) {
    const out = {};
    for (const k of Object.keys(obj || {}).sort()) if (!omit.includes(k) && obj[k] !== undefined) out[k] = obj[k];
    return JSON.stringify(out);
  },

  isRoomCardType(type) {
    return type === "custom:elvio-room-card" || type === "custom:elvio-room-card-dev";
  },

  // Warum eine alte Raum-Ansicht nicht verlustfrei in die gemeinsame Ansicht passt (null = passt).
  // Verlustfrei heißt: Die gemeinsame Ansicht zeigt dasselbe – jede Kachel genau so, wie die
  // Karte sie im neuen Modus von selbst baut, und nur Entitäten, die sie dort von selbst einsammelt.
  blockReason(view, areaId, ctx) {
    const cards = view.cards || [];
    if (cards.length !== 1 || !ElvioRooms.isRoomCardType(cards[0].type)) return "die Ansicht hat mehr als die Raumkarte";
    const card = cards[0];
    if ((card.sections || []).length) return "eigene Abschnitte (sections)";
    if ((card.chips || []).length) return "eigene Chips";
    const tiles = card.tiles || [];
    if (tiles.filter((t) => t && t.type === "lights").length > 1) return "mehrere Licht-Kacheln";
    for (const t of tiles) {
      if (!t) return "leere Kachel";
      let ids;
      if (t.type === "lights") {
        // Die gemeinsame Ansicht hat genau eine Licht-Kachel „Licht“ – ein anderer Name oder eigene
        // Einstellungen gingen verloren.
        if (t.name && t.name !== "Licht") return `Licht-Kachel „${t.name}“ hieße danach „Licht“`;
        const extra = Object.keys(t).filter((k) => !["type", "name", "entities"].includes(k));
        if (extra.length) return `Licht-Kachel hat eigene Einstellungen (${extra.join(", ")})`;
        ids = t.entities || [];
        // Die Automatik legt nur light.* in die Licht-Kachel; alles andere stünde danach woanders.
        const notLight = ids.find((id) => !String(id).startsWith("light."));
        if (notLight) return `${notLight} ist kein Licht`;
      } else {
        if (!t.entity || !AUTO_DOMAINS.includes(String(t.entity).split(".")[0])) {
          return `Kachel „${t.name || t.type}“ erscheint nicht von selbst`;
        }
        if (ElvioRooms.canon(t) !== ElvioRooms.canon(ElvioRooms.autoTile(t.entity))) {
          return `Kachel „${t.name || t.entity}“ sähe danach anders aus`;
        }
        ids = [t.entity];
      }
      for (const id of ids) {
        if (!areaId) return "der Raum hat noch keinen Bereich, zeigt aber eigene Geräte";
        if (ctx.entityArea(id) !== areaId) return `${id} gehört nicht zu diesem Raum`;
        if (ctx.isCollected && !ctx.isCollected(id)) return `${id} erscheint nicht von selbst (versteckt oder technisch)`;
      }
    }
    return null;
  },

  // Plan für die Umstellung – schreibt nichts. Liefert, was blockiert, welche Räume in welche
  // Bereiche gehen und die neue Dashboard-Konfiguration (Raum-Ansichten → eine Ansicht raum).
  // ctx: { resolveArea(key), entityArea(entityId), isCollected?(entityId),
  //        isTemperatureSensor?(entityId), areaName?(areaId) }
  migrationPlan(config, ctx) {
    const views = config.views || [];
    const cardOf = (v) => (Array.isArray(v.cards) ? v.cards[0] : undefined);
    const first = views.map(cardOf).find((c) => c && ElvioRooms.isRoomCardType(c.type));
    const nav = (first && first.nav) || [];
    const navRooms = nav.filter((i) => i && i.room);
    if (!navRooms.length) return { blocked: [{ room: "–", reason: "keine Räume in nav" }], rooms: [], config };
    const plainNav = nav.filter((i) => !(i && i.room));
    const clean = (p) => String(p || "").split("?")[0].replace(/\/+$/, "");
    // Was je Raum verschieden sein darf. Alles andere muss in allen Raumkarten gleich sein – die
    // gemeinsame Ansicht hat nur eine Raumkarte.
    const ROOM_KEYS = ["area", "title", "background", "tiles", "sections", "temperature", "chips", "nav"];
    const blocked = [];
    const rooms = [];
    const roomViews = [];
    // Welcher Raum welchen Bereich schon belegt: Zwei Räume in einem Bereich wären danach einer.
    const areaOwner = new Map();
    for (const r of navRooms) {
      const block = (reason) => blocked.push({ room: r.name, reason });
      const vi = views.findIndex((v) => v.path && clean(r.path).endsWith(`/${v.path}`));
      const areaId = ctx.resolveArea(r.area || r.name);
      const card = vi >= 0 ? cardOf(views[vi]) : null;
      if (vi < 0) block(`Ansicht nicht gefunden (${r.path})`);
      if (areaId) {
        if (areaOwner.has(areaId)) block(`teilt sich den Bereich mit „${areaOwner.get(areaId)}“`);
        else areaOwner.set(areaId, r.name);
        // Der Raum heißt danach wie sein Bereich – ein anderer Name am Tablet wäre eine stille Änderung.
        const areaName = ctx.areaName ? ctx.areaName(areaId) : r.name;
        if (areaName !== r.name) block(`hieße danach „${areaName}“ – Bereich in HA umbenennen oder Raum in nav anpassen`);
      }
      if (vi >= 0) {
        roomViews.push(vi);
        const why = ElvioRooms.blockReason(views[vi], areaId, ctx);
        if (why) block(why);
        else {
          // Bereich so bestimmen, wie ihn die alte Ansicht fand (_areaId): area: oder gleichnamiger Raum.
          const key = card.area || (navRooms.some((n) => n.name === card.title) ? card.title : null);
          const viewArea = key ? ctx.resolveArea(key) : null;
          if (viewArea !== areaId) block(`die Ansicht zeigt einen anderen Bereich (${key || "keinen"})`);
          const tplCard = cardOf(views[roomViews[0]]);
          if (ElvioRooms.canon(card, ROOM_KEYS) !== ElvioRooms.canon(tplCard, ROOM_KEYS)) {
            block("die Raumkarte hat andere Einstellungen als die erste Raum-Ansicht");
          }
        }
      }
      const temperature = r.temperature || (card && card.temperature) || null;
      if (temperature && !String(temperature).startsWith("sensor.")) {
        block(`Temperatur ${temperature} lässt sich nicht übernehmen (HA nimmt nur Sensoren)`);
      } else if (temperature && ctx.isTemperatureSensor && !ctx.isTemperatureSensor(temperature)) {
        // HA lehnt am Bereich jeden Sensor ab, der keine Temperatur misst.
        block(`Temperatur ${temperature} ist kein Temperatursensor`);
      }
      rooms.push({ name: r.name, areaId, icon: r.icon || null, image: r.image || (card && card.background) || null, temperature });
    }
    if (views.some((v, i) => v.path === "raum" && !roomViews.includes(i))) {
      blocked.push({ room: "raum", reason: "es gibt schon eine Ansicht mit dem Pfad raum" });
    }
    // Vorlage für die gemeinsame Ansicht: die erste Raum-Ansicht ohne ihre raumeigenen Teile.
    const tplView = roomViews.length ? views[roomViews[0]] : null;
    const tpl = (tplView && cardOf(tplView)) || first;
    const { area, title, background, tiles, sections, temperature, chips, ...base } = tpl;
    const { title: _title, path: _path, cards: _cards, ...viewRest } = tplView || {};
    const roomView = {
      ...viewRest,
      title: "Raum",
      path: "raum",
      type: "panel",
      cards: [{ ...base, nav: plainNav, title: "Raum", area: "auto", tiles: [{ type: "lights", name: "Licht", entities: [] }] }],
    };
    // Jede übrige Raumkarte behält ihre eigene nav, nur ohne Räume.
    const kept = views
      .filter((_, i) => !roomViews.includes(i))
      .map((v) =>
        Array.isArray(v.cards)
          ? {
              ...v,
              cards: v.cards.map((c) =>
                c && ElvioRooms.isRoomCardType(c.type) && c.nav ? { ...c, nav: c.nav.filter((i) => !(i && i.room)) } : c,
              ),
            }
          : v,
      );
    kept.splice(Math.min(1, kept.length), 0, roomView);
    return { blocked, rooms, config: { ...config, views: kept } };
  },

  // Nur ergänzen, was der Bereich noch nicht hat. Temperatur nur von Sensoren – HA nimmt als
  // Temperatur eines Bereichs nur einen Sensor (alte Dashboards erlaubten auch climate.*).
  areaPatch(area, room) {
    const patch = {};
    if (!area.icon && room.icon) patch.icon = room.icon;
    if (!area.picture && room.image) patch.picture = room.image;
    if (!area.temperature_entity_id && room.temperature && room.temperature.startsWith("sensor.")) {
      patch.temperature_entity_id = room.temperature;
    }
    return patch;
  },

  orderFirst(allIds, firstIds) {
    const first = [...new Set(firstIds.filter((id) => allIds.includes(id)))];
    return [...first, ...allIds.filter((id) => !first.includes(id))];
  },

  // Nach der Umstellung zeigt das Tablet alle Bereiche ohne Ausblende-Label. Damit es dieselben
  // Räume zeigt wie vorher, bekommen die Bereiche, die bisher kein Raum waren, das Label.
  areasToHide(allAreas, roomAreaIds, hideLabel) {
    return (allAreas || [])
      .filter((a) => !roomAreaIds.includes(a.area_id) && !(a.labels || []).includes(hideLabel))
      .map((a) => a.area_id);
  },

  // ── Geräte hinzufügen (Kameras, Sensoren, Schalter …) ──

  // Was sich einem Raum hinzufügen lässt: Bedienbares, Sensoren, Klingel/Taster. Keine
  // Systemfunktionen (Updates, Einstellwerte) und nichts ohne Ort (Personen, Wetter …).
  isPickable(id) {
    return PICK_DOMAINS.includes(String(id).split(".")[0]);
  },

  // Vorausgewählt beim Hinzufügen und im Geräte-Blatt oben (statt unter „Messwerte & Technik“).
  isUseful(id, deviceClass) {
    const domain = String(id).split(".")[0];
    if (AUTO_DOMAINS.includes(domain)) return true;
    return (USEFUL_CLASSES[domain] || []).includes(deviceClass);
  },

  // Vorausgewählt beim Hinzufügen. Kameras bringen viel Beiwerk mit (Lautsprecher der
  // Sprechanlage, „Rauchalarm gehört“ …): dort nur Bild, Klingel und Melder.
  preselect(id, deviceClass, deviceKind) {
    if (!ElvioRooms.isUseful(id, deviceClass)) return false;
    if (deviceKind !== "camera") return true;
    const domain = String(id).split(".")[0];
    if (["media_player", "switch", "siren"].includes(domain)) return false;
    return !(domain === "binary_sensor" && ALERT_CLASSES.includes(deviceClass));
  },

  // Filter in der Auswahl. null: zählt für die Art eines Geräts nicht (Taster, Knöpfe).
  entityKind(id, deviceClass) {
    const domain = String(id).split(".")[0];
    if (domain === "camera" || (domain === "event" && deviceClass === "doorbell")) return "camera";
    if (domain === "light") return "light";
    if (domain === "switch" || domain === "fan") return "switch";
    if (domain === "sensor" || domain === "binary_sensor") return "sensor";
    if (domain === "event" || domain === "button") return null;
    return "other";
  },

  // Art eines Geräts aus seinen Funktionen: eine Klingel mit Bewegungsmelder ist eine Kamera,
  // ein Aktor mit Messwerten ein Schalter, ein Sensor nur, wenn sonst nichts da ist.
  deviceKind(entities) {
    const kinds = (entities || []).map((e) => ElvioRooms.entityKind(e.entity_id, e.device_class));
    return ["camera", "light", "switch", "other", "sensor"].find((k) => kinds.includes(k)) || "other";
  },

  // Abschnitt in der Raum-Ansicht für automatisch gesammelte Geräte (Lichter: Licht-Kachel).
  roomSection(id, deviceClass) {
    const domain = String(id).split(".")[0];
    if (domain === "camera") return "Kameras";
    // Klingel und Taster stehen bei den Sensoren („Türklingel · vor 2 Std.“ neben „Haustür · zu“).
    if (domain === "sensor" || domain === "binary_sensor" || domain === "event") return "Sensoren";
    return "Weitere Geräte";
  },

  // Symbol für Sensoren, Melder und Ereignisse wie in HA (null: Symbol der Entität/Standard).
  stateIcon(id, deviceClass, state) {
    const domain = String(id).split(".")[0];
    const icons = (STATE_ICONS[domain] || {})[deviceClass];
    if (!icons) return null;
    if (typeof icons === "string") return icons;
    return state === "on" ? icons[0] : icons[1];
  },

  // Melder, die Alarm schlagen (Kachel wird rot): Rauch, Wasser, Gas …
  isAlert(id, deviceClass, state) {
    return String(id).startsWith("binary_sensor.") && ALERT_CLASSES.includes(deviceClass) && state === "on";
  },

  // Labels für „am Tablet zeigen“ – nur die Abweichung vom Normalfall wird gespeichert,
  // fremde Labels bleiben.
  shownLabels(labels, show, byDefault) {
    const out = (labels || []).filter((l) => l !== LABEL_SHOW.id && l !== LABEL_HIDE.id);
    if (show && !byDefault) out.push(LABEL_SHOW.id);
    if (!show && byDefault) out.push(LABEL_HIDE.id);
    return out;
  },

  // Plan fürs Hinzufügen – schreibt nichts. Ein Gerät ohne Raum zieht ganz in den Raum
  // (wie in HA üblich); steht es schon woanders, kommen nur die gewählten Funktionen her
  // (Mehrkanal-Aktoren: jeder Ausgang in seinem Raum). Gewähltes wird hier gezeigt,
  // Abgewähltes, das hier landet, versteckt. Nur tatsächliche Änderungen stehen im Plan.
  // device: { id, area_id } | null; entities: Registry-Einträge (entity_id, area_id, labels).
  addPlan({ device, entities, selected, areaId, placed }) {
    const deviceArea = device ? device.area_id || areaId : null;
    const plan = { device: device && !device.area_id ? { device_id: device.id, area_id: areaId } : null, entities: [] };
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    for (const e of entities || []) {
      const pick = (selected || []).includes(e.entity_id);
      const own = e.area_id || null;
      const area = pick ? (deviceArea === areaId ? null : areaId) : own;
      if ((area || deviceArea) !== areaId) continue;
      const byDefault = (placed || []).includes(e.entity_id) || AUTO_DOMAINS.includes(e.entity_id.split(".")[0]);
      const labels = ElvioRooms.shownLabels(e.labels, pick, byDefault);
      const change = { entity_id: e.entity_id };
      if (area !== own) change.area_id = area;
      if (!same(labels, e.labels || [])) change.labels = labels;
      if (Object.keys(change).length > 1) plan.entities.push(change);
    }
    return plan;
  },
};

// ───────────── Energie (aus den Energie-Einstellungen von Home Assistant) ─────────────
// Reine Rechnungen für die Energie-Seite; die Karte holt Einstellungen, Statistik und
// Zustände und gibt sie hier hinein. Getestet in test/energy.test.mjs.

const ElvioEnergy = {
  // Einstellungen von HA-Energie (energy/get_prefs) in eine feste Form bringen. Beide Formen
  // des Netzanschlusses werden verstanden: alt (flow_from/flow_to-Listen) und neu (ein Objekt
  // mit stat_energy_from/stat_energy_to). Leistungen als { plus, minus }: Netz + Bezug,
  // − Einspeisung; Batterie + Entladen, − Laden.
  normalize(prefs) {
    const n = {
      gridIn: [], gridOut: [], solar: [], batteryIn: [], batteryOut: [], home: [], cost: [], compensation: [],
      rates: { grid: [], solar: [], battery: [], home: [] },
      devices: [],
    };
    const add = (list, id) => {
      if (id && !list.includes(id)) list.push(id);
    };
    for (const s of (prefs && prefs.energy_sources) || []) {
      if (s.type === "grid") {
        add(n.gridIn, s.stat_energy_from);
        add(n.gridOut, s.stat_energy_to);
        add(n.cost, s.stat_cost);
        add(n.compensation, s.stat_compensation);
        for (const f of s.flow_from || []) {
          add(n.gridIn, f.stat_energy_from);
          add(n.cost, f.stat_cost);
        }
        for (const f of s.flow_to || []) {
          add(n.gridOut, f.stat_energy_to);
          add(n.compensation, f.stat_compensation);
        }
        const r = ElvioEnergy.rateOf(s);
        if (r) n.rates.grid.push(r);
        for (const p of s.power || []) if (p && p.stat_rate) n.rates.grid.push({ plus: [p.stat_rate], minus: [] });
      } else if (s.type === "solar") {
        add(n.solar, s.stat_energy_from);
        if (s.stat_rate) n.rates.solar.push({ plus: [s.stat_rate], minus: [] });
      } else if (s.type === "battery") {
        add(n.batteryOut, s.stat_energy_from);
        add(n.batteryIn, s.stat_energy_to);
        add(n.batteryIn, s.stat_energy_from_grid);
        add(n.batteryIn, s.stat_energy_from_solar);
        add(n.batteryOut, s.stat_energy_to_home);
        add(n.batteryOut, s.stat_energy_to_grid);
        const r = ElvioEnergy.rateOf(s);
        if (r) n.rates.battery.push(r);
      } else if (s.type === "home") {
        add(n.home, s.stat_energy_to);
        if (s.stat_rate) n.rates.home.push({ plus: [s.stat_rate], minus: [] });
      }
    }
    for (const d of (prefs && prefs.device_consumption) || []) {
      if (!d || !d.stat_consumption) continue;
      n.devices.push({ stat: d.stat_consumption, rate: d.stat_rate || null, name: d.name || null, includedIn: d.included_in_stat || null });
    }
    return n;
  },

  // Leistung eines Anschlusses. Die echten Sensoren aus power_config gehen vor; stat_rate
  // allein kann eine von HA errechnete Statistik ohne Live-Zustand sein.
  rateOf(s) {
    const pc = s.power_config;
    if (pc) {
      const plus = [pc.stat_rate, pc.stat_rate_from, pc.stat_rate_to_home, pc.stat_rate_to_grid].filter(Boolean);
      const minus = [pc.stat_rate_inverted, pc.stat_rate_to, pc.stat_rate_from_grid, pc.stat_rate_from_solar].filter(Boolean);
      if (plus.length || minus.length) return { plus, minus };
    }
    return s.stat_rate ? { plus: [s.stat_rate], minus: [] } : null;
  },

  hasData(n) {
    return !!(n.gridIn.length || n.gridOut.length || n.solar.length || n.batteryIn.length || n.batteryOut.length || n.home.length || n.devices.length);
  },

  // Leistung jetzt in Watt. watts(id) liefert Watt oder null. Den Hausverbrauch ergibt erst
  // das Netz (es gleicht alles aus); ohne Netz-Leistung bleibt er offen, statt zu raten.
  live(n, watts) {
    const val = (specs) => {
      let v = null;
      for (const r of specs) {
        for (const id of r.plus) {
          const w = watts(id);
          if (w != null) v = (v || 0) + w;
        }
        for (const id of r.minus) {
          const w = watts(id);
          if (w != null) v = (v || 0) - w;
        }
      }
      return v;
    };
    const solar = val(n.rates.solar);
    const grid = val(n.rates.grid);
    const battery = val(n.rates.battery);
    let home = val(n.rates.home);
    if (home == null && grid != null) home = Math.max(0, (solar || 0) + grid + (battery || 0));
    return { solar, grid, battery, home };
  },

  // Zeitraum in Ortszeit: Heute (Stunden), Woche ab Montag (Tage), Monat (Tage), Jahr (Monate).
  periodRange(period, now) {
    const d = new Date(now);
    let start;
    let end;
    let bucket = "day";
    if (period === "week") {
      const back = (d.getDay() + 6) % 7;
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    } else if (period === "month") {
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    } else if (period === "year") {
      start = new Date(d.getFullYear(), 0, 1);
      end = new Date(d.getFullYear() + 1, 0, 1);
      bucket = "month";
    } else {
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      bucket = "hour";
    }
    return { period, start: start.getTime(), end: end.getTime(), bucket };
  },

  // Beginn jedes Balkens im Zeitraum (Sommerzeit: der Tag hat dann 23 bzw. 25 Stunden).
  buckets(range) {
    const out = [];
    const s = new Date(range.start);
    for (let i = 0; i < 400; i++) {
      const t =
        range.bucket === "hour"
          ? new Date(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours() + i)
          : range.bucket === "month"
            ? new Date(s.getFullYear(), s.getMonth() + i, 1)
            : new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
      if (t.getTime() >= range.end) break;
      out.push(t.getTime());
    }
    return out;
  },

  // Summen im Zeitraum. change(id) liefert kWh oder null. Hausverbrauch wie in HA:
  // Bezug + Solar + Entladen − Einspeisung − Laden (oder der eigene Hauszähler).
  totals(n, change) {
    const sum = (ids) => {
      let v = null;
      for (const id of ids) {
        const c = change(id);
        if (c != null) v = (v || 0) + c;
      }
      return v;
    };
    const clamp = (x) => Math.min(1, Math.max(0, x));
    const t = {
      gridIn: sum(n.gridIn),
      gridOut: sum(n.gridOut),
      solar: sum(n.solar),
      batteryIn: sum(n.batteryIn),
      batteryOut: sum(n.batteryOut),
      cost: sum(n.cost),
      compensation: sum(n.compensation),
    };
    const meter = sum(n.home);
    const anySource = t.gridIn != null || t.solar != null || t.batteryOut != null;
    t.home = meter != null
      ? meter
      : anySource
        ? Math.max(0, (t.gridIn || 0) + (t.solar || 0) + (t.batteryOut || 0) - (t.gridOut || 0) - (t.batteryIn || 0))
        : null;
    t.autarky = t.home > 0 && t.gridIn != null ? clamp(1 - t.gridIn / t.home) : null;
    t.selfUse = t.solar > 0 ? clamp(1 - (t.gridOut || 0) / t.solar) : null;
    return t;
  },

  // Verlauf: je Balken Bezug, Einspeisung, Solar (kWh). stats wie recorder/statistics_during_period
  // ({ id: [{ start, change }] }); fehlende Stunden zählen 0.
  series(n, stats, buckets) {
    const rows = buckets.map((t) => ({ t, gridIn: 0, gridOut: 0, solar: 0, used: 0 }));
    const idx = (start) => {
      for (let i = buckets.length - 1; i >= 0; i--) if (start >= buckets[i]) return i;
      return -1;
    };
    const addAll = (ids, key) => {
      for (const id of ids) {
        for (const p of (stats && stats[id]) || []) {
          const i = idx(typeof p.start === "number" ? p.start : Date.parse(p.start));
          if (i >= 0 && Number.isFinite(p.change)) rows[i][key] += p.change;
        }
      }
    };
    addAll(n.gridIn, "gridIn");
    addAll(n.gridOut, "gridOut");
    addAll(n.solar, "solar");
    // Verbrauch der eingetragenen Geräte (ohne die, die in einem anderen schon stecken) –
    // Verlauf für Anlagen, die noch keinen Netzzähler haben.
    addAll(n.devices.filter((d) => !d.includedIn).map((d) => d.stat), "used");
    for (const r of rows) for (const k of ["gridIn", "gridOut", "solar", "used"]) r[k] = Math.round(r[k] * 1000) / 1000;
    return rows;
  },

  // Verbraucher nach Verbrauch im Zeitraum (ohne Wert ans Ende), mit Leistung jetzt.
  ranking(n, change, watts, nameOf) {
    return n.devices
      .map((d) => ({ stat: d.stat, name: d.name || nameOf(d.stat), kwh: change(d.stat), w: d.rate ? watts(d.rate) : null }))
      .sort((a, b) => (b.kwh == null ? -1 : b.kwh) - (a.kwh == null ? -1 : a.kwh));
  },

  // Für „Energie einrichten“: Energiezähler einzelner Verbraucher (z. B. Shelly-Kanäle), mit
  // der Leistung desselben Geräts für den Live-Wert. Draußen bleiben: Einspeise-Zähler,
  // Reserven, Versteckt/Technik, schon Eingetragenes und die Summe eines Geräts, dessen
  // Kanäle eigene Zähler haben (sonst zählte alles doppelt).
  consumerCandidates({ entities, states, devices, existing }) {
    const isEnergy = (e) => {
      const st = states[e.entity_id];
      const a = (st && st.attributes) || {};
      return e.entity_id.startsWith("sensor.") && a.device_class === "energy" && ["total_increasing", "total"].includes(a.state_class);
    };
    const visible = (entities || []).filter((e) => !e.hidden && !e.entity_category && !e.disabled_by);
    const energy = visible.filter(isEnergy);
    const parents = new Set(
      energy.map((e) => devices[e.device_id]).filter((d) => d && d.via_device_id).map((d) => d.via_device_id),
    );
    const out = [];
    for (const e of energy) {
      const dev = devices[e.device_id];
      if (!dev || parents.has(dev.id)) continue;
      const name = dev.name_by_user || dev.name || "";
      const label = `${e.entity_id} ${(states[e.entity_id].attributes || {}).friendly_name || ""}`;
      if (!name || /^reserve/i.test(name)) continue;
      if (/einspeis|r(ue|ü)ckspeis|returned|export/i.test(label)) continue;
      if ((existing || []).includes(e.entity_id)) continue;
      const power = visible.filter((p) => {
        const a = (states[p.entity_id] && states[p.entity_id].attributes) || {};
        return p.device_id === e.device_id && p.entity_id.startsWith("sensor.") && a.device_class === "power";
      });
      const common = (x) => {
        let i = 0;
        while (i < x.length && x[i] === e.entity_id[i]) i++;
        return i;
      };
      power.sort((x, y) => common(y.entity_id) - common(x.entity_id));
      out.push({ stat_consumption: e.entity_id, stat_rate: power.length ? power[0].entity_id : undefined, name });
    }
    for (const o of out) if (!o.stat_rate) delete o.stat_rate;
    return out.sort((a, b) => a.name.localeCompare(b.name, "de"));
  },
};

// ───────────── Personen (wer ist wo) ─────────────
// Reine Aufbereitung für die Ansicht „Personen“; getestet in test/people.test.mjs.

const ElvioPeople = {
  // Personen aus HA mit Ort, „seit“, Position und Handys. Zuhause zuerst, dann Zonen,
  // unterwegs, unbekannt. Mit dem Label hideLabel ausgeblendete nur mit includeHidden.
  list({ states, entities, devices, hideLabel, includeHidden = false }) {
    const out = [];
    for (const st of Object.values(states || {})) {
      if (!st || !String(st.entity_id).startsWith("person.")) continue;
      const reg = (entities || {})[st.entity_id] || {};
      const hidden = (reg.labels || []).includes(hideLabel);
      if (hidden && !includeHidden) continue;
      const a = st.attributes || {};
      const name = a.friendly_name || st.entity_id;
      out.push({
        id: st.entity_id,
        name,
        picture: a.entity_picture || null,
        initial: String(name).trim().charAt(0).toUpperCase() || "?",
        place: ElvioPeople.place(st.state),
        since: Date.parse(st.last_changed) || null,
        position: Number.isFinite(a.latitude) && Number.isFinite(a.longitude),
        phones: ElvioPeople.phones(a.device_trackers || [], states, entities || {}, devices || {}),
        hidden,
      });
    }
    const rank = { home: 0, zone: 1, away: 2, unknown: 3 };
    return out.sort((x, y) => rank[x.place.kind] - rank[y.place.kind] || x.name.localeCompare(y.name, "de"));
  },

  place(state) {
    if (state === "home") return { kind: "home", label: "Zuhause" };
    if (state === "not_home") return { kind: "away", label: "Unterwegs" };
    if (!state || state === "unknown" || state === "unavailable") return { kind: "unknown", label: "Standort unbekannt" };
    return { kind: "zone", label: state };
  },

  // Handys einer Person: Name des Geräts, Akku (Tracker-Attribut oder Akku-Sensor des
  // Handys aus der HA-App), lädt gerade, knapp (≤ 20 %).
  phones(trackers, states, entities, devices) {
    const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    return trackers.map((id) => {
      const st = states[id];
      const reg = entities[id] || {};
      const dev = reg.device_id ? devices[reg.device_id] : null;
      let battery = st ? num(st.attributes && st.attributes.battery_level) : null;
      let charging = false;
      if (dev) {
        for (const e of Object.values(entities)) {
          if (e.device_id !== dev.id) continue;
          const s = states[e.entity_id];
          if (!s) continue;
          const dc = (s.attributes || {}).device_class;
          if (battery == null && e.entity_id.startsWith("sensor.") && dc === "battery") battery = num(s.state);
          if (/_battery_state$/.test(e.entity_id) && /^charging$/i.test(s.state)) charging = true;
          if (e.entity_id.startsWith("binary_sensor.") && (dc === "battery_charging" || /_is_charging$/.test(e.entity_id)) && s.state === "on") charging = true;
        }
      }
      const name = dev ? dev.name_by_user || dev.name : (st && st.attributes && st.attributes.friendly_name) || id;
      return { id, name, battery, charging, low: battery != null && battery <= 20 };
    });
  },

  summary(list) {
    const home = list.filter((p) => p.place.kind === "home").length;
    const away = list.filter((p) => p.place.kind === "away" || p.place.kind === "zone").length;
    return [home && `${home} zuhause`, away && `${away} unterwegs`].filter(Boolean).join(" · ");
  },

  // „seit 14:05“, „seit gestern 09:30“, „seit Mo 16.11.“
  since(ms, now) {
    if (!ms) return "";
    const d = new Date(ms);
    const n = new Date(now);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(n) - day(d)) / 86400000);
    if (diff <= 0) return `seit ${hm}`;
    if (diff === 1) return `seit gestern ${hm}`;
    return `seit ${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
  },
};

// ───────────── Szenen ─────────────
// Szenen am Tablet: echte HA-Szenen (Szenen-Datei wie der Szenen-Editor von HA), am Bereich
// des Raums oder ohne Bereich fürs ganze Haus. Reine Teile hier, getestet in test/scenes.test.mjs.

const SCENE_PRESETS = [
  { name: "Abend", icon: "mdi:weather-sunset" },
  { name: "Essen", icon: "mdi:silverware-fork-knife" },
  { name: "Kino", icon: "mdi:movie-open-outline" },
  { name: "Hell", icon: "mdi:white-balance-sunny" },
  { name: "Gedimmt", icon: "mdi:lightbulb-on-30" },
  { name: "Lesen", icon: "mdi:book-open-variant" },
  { name: "Nacht", icon: "mdi:weather-night" },
  { name: "Alles aus", icon: "mdi:power" },
];
const SCENE_ICONS = [
  "mdi:palette-outline", "mdi:weather-sunset", "mdi:weather-night", "mdi:silverware-fork-knife", "mdi:movie-open-outline",
  "mdi:white-balance-sunny", "mdi:lightbulb-on-30", "mdi:book-open-variant", "mdi:sofa-outline", "mdi:party-popper",
  "mdi:coffee-outline", "mdi:power", "mdi:bed-outline", "mdi:music-note", "mdi:heart-outline", "mdi:home-outline",
];
// Farben zur Auswahl im Szenen-Blatt (hs: Farbton, Sättigung).
const SCENE_COLORS = [
  ["Rot", [0, 85]], ["Orange", [30, 90]], ["Gelb", [52, 85]], ["Grün", [120, 70]],
  ["Türkis", [180, 70]], ["Blau", [225, 80]], ["Lila", [275, 70]], ["Pink", [320, 70]],
];
// Farbe eines Lichts: nur die Angabe seines Farbmodus, sonst stritten sich Farbe und Weißton.
const SCENE_COLOR_KEYS = {
  color_temp: "color_temp_kelvin", hs: "hs_color", rgb: "rgb_color", rgbw: "rgbw_color", rgbww: "rgbww_color", xy: "xy_color",
};

const ElvioScenes = {
  presets() {
    return SCENE_PRESETS.map((p) => ({ ...p }));
  },

  // Stand jetzt als Szene: Lichter mit Helligkeit und Farbe, Rollläden mit Position,
  // Lüfter mit Stufe, alles andere an/aus.
  capture(ids, states) {
    const out = {};
    for (const id of ids || []) {
      const st = states[id];
      if (!st) continue;
      const a = st.attributes || {};
      const domain = String(id).split(".")[0];
      if (domain === "light") {
        if (st.state !== "on") {
          out[id] = { state: "off" };
          continue;
        }
        const e = { state: "on" };
        if (a.brightness != null) e.brightness = a.brightness;
        if (a.color_mode) e.color_mode = a.color_mode;
        const key = SCENE_COLOR_KEYS[a.color_mode];
        if (key && a[key] != null) e[key] = a[key];
        out[id] = e;
      } else if (domain === "cover") {
        const e = { state: st.state };
        if (a.current_position != null) e.current_position = a.current_position;
        out[id] = e;
      } else if (domain === "fan") {
        const e = { state: st.state };
        if (st.state === "on" && a.percentage != null) e.percentage = a.percentage;
        out[id] = e;
      } else {
        out[id] = { state: st.state };
      }
    }
    return out;
  },

  describe(st) {
    if (!st) return "Nicht gefunden";
    if (st.state === "unavailable" || st.state === "unknown") return "Nicht erreichbar";
    const a = st.attributes || {};
    const domain = String(st.entity_id).split(".")[0];
    if (domain === "cover") {
      return st.state === "closed" ? "Zu" : a.current_position != null ? `Offen · ${a.current_position} %` : "Offen";
    }
    if (st.state === "on") return a.brightness != null ? `An · ${Math.round((a.brightness / 255) * 100)} %` : "An";
    return st.state === "off" ? "Aus" : st.state;
  },

  // Was ein Licht kann (aus supported_color_modes): dimmen, Weißton (mit Grenzen in Kelvin), Farbe.
  lightCaps(st) {
    const a = (st && st.attributes) || {};
    const modes = a.supported_color_modes || [];
    const color = modes.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m));
    const temp = modes.includes("color_temp")
      ? { min: a.min_color_temp_kelvin || 2000, max: a.max_color_temp_kelvin || 6500 }
      : null;
    return { dim: modes.some((m) => m !== "onoff"), temp, color };
  },

  // Eine Einstellung eines Lichts in der Szene ändern. Aus heißt nur aus; Helligkeit, Weißton
  // oder Farbe schalten an. Weißton und Farbe schließen sich aus (wie der Farbmodus der Lampe).
  edit(entry, change) {
    const e = { ...(entry || {}) };
    if (change.state === "off") return { state: "off" };
    e.state = "on";
    if (change.brightness != null) e.brightness = change.brightness;
    if (e.brightness == null) e.brightness = 255;
    const color = (mode, key, value) => {
      for (const k of Object.values(SCENE_COLOR_KEYS)) delete e[k];
      e.color_mode = mode;
      e[key] = value;
    };
    if (change.color_temp_kelvin != null) color("color_temp", "color_temp_kelvin", change.color_temp_kelvin);
    if (change.hs_color != null) color("hs", "hs_color", change.hs_color);
    return e;
  },

  pct(brightness) {
    return brightness == null ? 100 : Math.round((brightness / 255) * 100);
  },

  bri(pct) {
    return Math.max(1, Math.min(255, Math.round((pct / 100) * 255)));
  },

  // Szenen eines Bereichs (areaId null: ohne Bereich), in der Reihenfolge des Anlegens
  // (die ID aus dem Szenen-Editor ist ein Zeitstempel), Szenen ohne ID danach nach Namen.
  forArea(scenes, areaOf, areaId) {
    const key = (s) => {
      const id = Number((s.attributes || {}).id);
      return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
    };
    const name = (s) => (s.attributes || {}).friendly_name || s.entity_id;
    return (scenes || [])
      .filter((s) => (areaOf(s.entity_id) || null) === (areaId || null))
      .sort((x, y) => key(x) - key(y) || name(x).localeCompare(name(y), "de"));
  },
};

// ───────────── Haus verlassen ─────────────
// Ein Knopf auf Zuhause: Prüfliste (was offen ist, was ausgeht), dann alles aus. Dahinter ein
// echtes HA-Skript (script.haus_verlassen), auf Wunsch eine Automation, wenn alle weg sind.
// Die Einstellung steht in der Dashboard-Konfiguration (elvio_leave), damit auch Nicht-Admins
// sehen, was ausgeht. Getestet in test/leave.test.mjs.

const LEAVE_SCRIPT = "haus_verlassen";
const LEAVE_AUTOMATION = "elvio_haus_verlassen";
// Schalter dieser Integrationen sind Sicherheits- oder Kamerafunktionen (Abriegelung,
// Evakuierung, Privatsphäre …), keine Verbraucher – sie stehen nicht zur Auswahl.
const LEAVE_SKIP_PLATFORMS = ["unifi_access", "unifiprotect", "alarmo", "ring", "reolink", "frigate"];

const ElvioLeave = {
  settings(dashCfg) {
    const l = (dashCfg && dashCfg.elvio_leave) || {};
    return {
      switches: Array.isArray(l.switches) ? l.switches.filter((x) => typeof x === "string") : [],
      media: l.media !== false,
      auto: l.auto === true,
    };
  },

  // Das Skript: alle Lichter aus, gewählte Steckdosen aus, Musik anhalten. Ein Fehler (z. B. ein
  // Gerät nicht erreichbar) hält die übrigen Schritte nicht auf.
  script({ switches, media, players }) {
    const step = (action, entity_id) => ({ action, target: { entity_id }, continue_on_error: true });
    const sequence = [step("light.turn_off", "all")];
    if (switches && switches.length) sequence.push(step("switch.turn_off", [...switches]));
    if (media && players && players.length) sequence.push(step("media_player.media_pause", [...players]));
    return { alias: "Haus verlassen", icon: "mdi:home-export-outline", mode: "single", sequence };
  },

  // Automatisch, wenn niemand mehr zuhause ist (zone.home zählt die Personen daheim).
  automation() {
    return {
      id: LEAVE_AUTOMATION,
      alias: "Haus verlassen, wenn alle weg sind",
      description: "Angelegt von der Raumkarte (Haus verlassen → Einstellen).",
      triggers: [{ trigger: "state", entity_id: "zone.home", to: "0", for: { minutes: 10 } }],
      conditions: [],
      actions: [{ action: "script.turn_on", target: { entity_id: `script.${LEAVE_SCRIPT}` } }],
      mode: "single",
    };
  },

  // Was der Knopf jetzt ausschalten würde.
  plan(states, settings) {
    const all = Object.values(states || {});
    const on = (st) => st.state === "on";
    return {
      lights: all.filter((st) => st.entity_id.startsWith("light.") && on(st)).map((st) => st.entity_id),
      switches: (settings.switches || []).filter((id) => states[id] && on(states[id])),
      playing: settings.media
        ? all.filter((st) => st.entity_id.startsWith("media_player.") && st.state === "playing").map((st) => st.entity_id)
        : [],
    };
  },
};

// ───────────── Hinweise ─────────────
// Was im Haus nicht stimmt, an einer Stelle: Alarm (Rauch, Wasser, Gas), Geräte nicht
// erreichbar, Akku knapp, Fenster offen und Regen; für Admins Updates und Reparaturen.
// Getestet in test/notices.test.mjs.

const NOTICE_OFFLINE_MS = 5 * 60 * 1000;
const NOTICE_ICONS = {
  alarm: "mdi:alarm-light-outline", offline: "mdi:lan-disconnect", battery: "mdi:battery-alert-variant-outline",
  rain: "mdi:weather-pouring", repairs: "mdi:tools", updates: "mdi:update",
};
const NOTICE_BATTERY = 20;
const NOTICE_ALARM_NAMES = { smoke: "Rauch", moisture: "Wasser", gas: "Gas", carbon_monoxide: "Kohlenmonoxid", safety: "Sicherheit" };

const ElvioNotices = {
  collect({ states, entities, devices, areas, now, ignore, admin, rainText, repairs }) {
    const out = [];
    const add = (n) => out.push({ entity: null, path: null, ...n, ignored: (ignore || []).includes(n.key) });
    const all = Object.values(states || {});
    const name = (st) => (st.attributes && st.attributes.friendly_name) || st.entity_id;
    const since = (ms) => ElvioPeople.since(ms, now);

    // Alarm
    for (const st of all) {
      const dc = (st.attributes || {}).device_class;
      if (st.entity_id.startsWith("binary_sensor.") && NOTICE_ALARM_NAMES[dc] && st.state === "on") {
        add({ key: `alarm:${st.entity_id}`, kind: "alarm", level: 0, title: `${name(st)}: Alarm`, sub: `${NOTICE_ALARM_NAMES[dc]} – bitte nachsehen`, entity: st.entity_id });
      }
    }

    // Nicht erreichbar: alle Werte eines Geräts seit mindestens 5 Minuten „nicht verfügbar“.
    // Ist das übergeordnete Gerät (ganzer Shelly) auch weg, steht nur es da, mit seinen Kanälen.
    const byDev = {};
    for (const e of Object.values(entities || {})) {
      if (!e.device_id || !states[e.entity_id]) continue;
      (byDev[e.device_id] = byDev[e.device_id] || []).push(states[e.entity_id]);
    }
    const offline = {};
    for (const [id, sts] of Object.entries(byDev)) {
      const d = devices[id];
      if (!d || d.disabled_by || d.entry_type === "service") continue;
      if (!sts.every((x) => x.state === "unavailable")) continue;
      const newest = Math.max(...sts.map((x) => Date.parse(x.last_changed) || 0));
      if (now - newest < NOTICE_OFFLINE_MS) continue;
      offline[id] = { d, sts, newest, children: 0 };
    }
    for (const o of Object.values(offline)) if (offline[o.d.via_device_id]) offline[o.d.via_device_id].children++;
    for (const [id, o] of Object.entries(offline)) {
      if (offline[o.d.via_device_id]) continue;
      const area = o.d.area_id && areas && areas[o.d.area_id] ? areas[o.d.area_id].name : null;
      const parts = [o.children ? `mit ${o.children} ${o.children === 1 ? "Kanal" : "Kanälen"}` : area, since(o.newest)].filter(Boolean);
      add({ key: `offline:${id}`, kind: "offline", level: 1, title: `${o.d.name_by_user || o.d.name || "Gerät"} nicht erreichbar`, sub: parts.join(" · "), entity: o.sts[0].entity_id });
    }
    out.sort((a, b) => a.level - b.level || (a.kind === "offline" && b.kind === "offline" ? a.title.localeCompare(b.title, "de") : 0));

    // Akku knapp (Handys stehen bei „Personen“)
    for (const st of all) {
      const a = st.attributes || {};
      if (a.device_class !== "battery") continue;
      const e = (entities || {})[st.entity_id] || {};
      if (e.platform === "mobile_app") continue;
      if (st.entity_id.startsWith("sensor.")) {
        const v = Number(st.state);
        if (st.state !== "" && Number.isFinite(v) && v <= NOTICE_BATTERY) {
          add({ key: `battery:${st.entity_id}`, kind: "battery", level: 2, title: name(st), sub: `Akku ${Math.round(v)} %`, entity: st.entity_id });
        }
      } else if (st.entity_id.startsWith("binary_sensor.") && st.state === "on") {
        add({ key: `battery:${st.entity_id}`, kind: "battery", level: 2, title: name(st), sub: "Akku schwach", entity: st.entity_id });
      }
    }

    // Fenster offen und Regen angesagt
    const open = all.filter((st) => st.entity_id.startsWith("binary_sensor.") && ["window", "opening"].includes((st.attributes || {}).device_class) && st.state === "on");
    if (open.length && rainText) {
      const names = open.map(name);
      add({ key: "rain", kind: "rain", level: 3, title: `${names.length > 2 ? `${names.length} Fenster` : names.join(", ")} offen`, sub: rainText, entity: open[0].entity_id });
    }

    if (admin && repairs > 0) {
      add({ key: "repairs", kind: "repairs", level: 4, title: `${repairs} ${repairs === 1 ? "Reparatur" : "Reparaturen"} in Home Assistant`, sub: "Einstellungen → Reparaturen", path: "/config/repairs" });
    }
    if (admin) {
      const upd = all.filter((st) => st.entity_id.startsWith("update.") && st.state === "on");
      if (upd.length) {
        const names = upd.map(name);
        add({
          key: "updates", kind: "updates", level: 5,
          title: `${upd.length} ${upd.length === 1 ? "Update" : "Updates"} verfügbar`,
          sub: names.length > 3 ? `${names.slice(0, 3).join(", ")} …` : names.join(", "),
          path: "/config/updates",
        });
      }
    }
    return out;
  },
};

// ───────────── Gegensprechen über SIP Core ─────────────
// SIP Core (HACS-Integration, TECH7Fox) stellt window.sipCore bereit und meldet jede
// Änderung als Ereignis „sipcore-update“ am window. Benutzt werden nur: callState
// (idle/incoming/outgoing/connecting/connected), RTCSession (JsSIP), remoteExtension,
// callDuration, answerCall(), endCall(); Ton spielt SIP Core selbst ab (<audio id="remoteAudio">).
//
// Eine Steuerung für alle Ansichten: Das Tablet zeigt immer nur eine Raumansicht. Ruft die
// Tür an, öffnet die gerade sichtbare Karte das Popup – auch wenn die Klingel-Kachel in einer
// anderen Ansicht steht. Ohne SIP Core oder ohne sip_extension passiert hier nichts.

// Klingel-Kacheln mit sip_extension aus einer Dashboard-Konfiguration (alle Ansichten).
function collectSipTiles(node, out, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) {
    for (const n of node) collectSipTiles(n, out, depth + 1);
    return;
  }
  if (node.type === "custom:elvio-room-card") {
    const tiles = [...(node.tiles || []), ...(node.sections || []).flatMap((s) => (s && s.tiles) || [])];
    for (const t of tiles) {
      if (t && t.type === "doorbell" && t.sip_extension != null && t.sip_extension !== "") {
        out.set(String(t.sip_extension), t);
      }
    }
    return;
  }
  for (const v of Object.values(node)) collectSipTiles(v, out, depth + 1);
}

const sipBridge = {
  cards: new Set(),
  host: null,
  // Laufender Anruf an eine Klingel: { session, cfg, micOn, ptt, dtmfDone, cause }.
  call: null,
  // Anruf einer Nebenstelle ohne Klingel-Kachel: nicht bei jedem Update neu suchen.
  ignored: null,
  // Nebenstelle → Kachel, auch aus Ansichten, die gerade nicht zu sehen sind.
  known: new Map(),
  listening: false,

  attach(card) {
    if (!this.listening) {
      this.listening = true;
      const sync = () => this.sync();
      for (const type of ["sipcore-update", "sipcore-call-started", "sipcore-call-ended"]) {
        window.addEventListener(type, sync);
      }
    }
    // Reihenfolge = zuletzt verbunden zuletzt: das ist die sichtbare Ansicht.
    this.cards.delete(card);
    this.cards.add(card);
    this.later();
  },

  detach(card) {
    this.cards.delete(card);
    if (this.host === card) {
      this.host = null;
      this.later();
    }
  },

  // Nach einem Ansichtswechsel erst prüfen, wenn die neue Karte steht.
  later() {
    clearTimeout(this._later);
    this._later = setTimeout(() => this.sync(), 0);
  },

  sync() {
    const sc = window.sipCore;
    const session = (sc && sc.RTCSession) || null;
    const state = session ? sc.callState : "idle";
    if (!session) this.ignored = null;

    const prev = this.call;
    if (prev && (prev.session !== session || state === "idle")) {
      this.call = null;
      const host = this.host;
      this.host = null;
      // SIP Core meldet das Ende in seinem eigenen failed-Handler – unserer (mit dem Grund,
      // z. B. Mikrofon verweigert) läuft erst danach. Darum einen Takt später anzeigen.
      if (host) setTimeout(() => host._sipEnded(prev), 0);
    }
    if (!session || state === "idle" || session === this.ignored) return;

    if (!this.call) {
      // Nur ankommende Anrufe. Selbst wählen (z. B. über SIP Core) bleibt Sache von SIP Core.
      if (session.direction !== "incoming") return;
      const ext = sc.remoteExtension;
      const { cfg, complete } = this._find(ext);
      if (cfg || complete) {
        console.info(`elvio-room-card: Anruf von Nebenstelle ${ext}`, cfg ? "→ Klingel-Popup" : "(keine Klingel-Kachel mit dieser sip_extension)");
      }
      if (!cfg) {
        // Endgültig übergehen nur, wenn das Dashboard durchsucht werden konnte. Ist gerade
        // keine Karte im Bild (z. B. HA-Einstellungen), sucht die nächste Karte erneut.
        if (complete) this.ignored = session;
        return;
      }
      const call = { session, cfg, micOn: !cfg.sip_push_to_talk, ptt: false, dtmfDone: false, cause: null };
      this.call = call;
      session.on("failed", (e) => (call.cause = e && e.cause));
      session.on("confirmed", () => this.sync());
    }

    const call = this.call;
    if (state === "connected") {
      this._applyMic(call);
      this._sendDtmf(call);
      this._kickAudio();
    }
    const host = this._pick(call.cfg);
    if (this.host && this.host !== host) this.host._closeDoorbell();
    this.host = host;
    if (host) host._sipShow(call, state);
  },

  // Je Anruf frisch aus den Karten bzw. dem Dashboard (YAML kann sich geändert haben).
  // Was früher gefunden wurde, gilt nur, wenn das Dashboard gerade nicht lesbar ist.
  // complete: Das Dashboard ließ sich durchsuchen – „nicht gefunden“ ist dann endgültig.
  _find(ext) {
    if (ext == null) return { cfg: null, complete: true };
    const key = String(ext);
    const found = new Map();
    for (const card of this.cards) {
      for (const t of card._sipTiles()) found.set(String(t.sip_extension), t);
    }
    let scanned = false;
    if (!found.has(key)) {
      for (const card of this.cards) {
        const conf = card._dashboardConfig();
        if (!conf) continue;
        scanned = true;
        collectSipTiles(conf, found);
      }
    }
    for (const [k, t] of found) this.known.set(k, t);
    if (found.has(key)) return { cfg: found.get(key), complete: true };
    if (scanned) {
      this.known.delete(key);
      return { cfg: null, complete: true };
    }
    return { cfg: this.known.get(key) || null, complete: false };
  },

  // Die laufende Karte behalten; sonst die mit der Kachel, sonst die zuletzt verbundene.
  // Sichtbare Karten zuerst: HA blendet Karten mit Sichtbarkeits-Bedingung nur per
  // display:none aus (hui-card), sie bleiben verbunden.
  _pick(cfg) {
    const live = [...this.cards].filter((c) => c.isConnected && c._built).reverse();
    if (this.host && live.includes(this.host)) return this.host;
    const shown = live.filter((c) => typeof c.checkVisibility !== "function" || c.checkVisibility());
    const pool = shown.length ? shown : live;
    const ext = String(cfg.sip_extension);
    return pool.find((c) => c._sipTiles().some((t) => String(t.sip_extension) === ext)) || pool[0] || null;
  },

  // Nur mit sip_answer_dtmf. Ein Fehlschlag (z. B. Asterisk lehnt das INFO ab) meldet JsSIP
  // nicht nach außen – die Konsole zeigt nur, dass gesendet wurde.
  _sendDtmf(call) {
    if (call.dtmfDone) return;
    const tones = call.cfg.sip_answer_dtmf;
    if (tones == null || tones === false || String(tones) === "" || String(tones).includes("*")) {
      call.dtmfDone = true;
      return;
    }
    if (call.session.status !== SIP_STATUS_CONFIRMED) return;
    call.dtmfDone = true;
    const transportType = String(call.cfg.sip_dtmf_mode || "info").toLowerCase() === "rfc2833" ? "RFC2833" : "INFO";
    setTimeout(() => {
      if (this.call !== call) return;
      try {
        call.session.sendDTMF(String(tones), { transportType });
        console.info(`elvio-room-card: Taste ${tones} an die Tür gesendet (${transportType})`);
      } catch (err) {
        console.warn("elvio-room-card: Taste an die Tür nicht gesendet", err);
      }
    }, SIP_DTMF_DELAY_MS);
  },

  // Mikro offen, wenn eingeschaltet oder Sprechtaste gedrückt. JsSIP schaltet dafür nur die
  // eigene Tonspur stumm; das Gespräch bleibt bestehen.
  _applyMic(call) {
    const status = call.session.status;
    if (status !== SIP_STATUS_WAITING_FOR_ACK && status !== SIP_STATUS_CONFIRMED) return;
    try {
      const muted = call.session.isMuted().audio;
      // Hat jemand anderes umgeschaltet (z. B. das SIP-Core-Popup), gilt dessen Stand –
      // sonst stellte das nächste Update (jede Sekunde) ihn wieder zurück.
      if (call.applied !== undefined && muted === call.applied && !call.ptt) call.micOn = !muted;
      const want = call.micOn || call.ptt;
      if (want && muted) call.session.unmute({ audio: true });
      else if (!want && !muted) call.session.mute({ audio: true });
      call.applied = want;
    } catch (err) {
      console.warn("elvio-room-card: Mikro nicht umgeschaltet", err);
    }
  },

  // SIP Core startet den Ton selbst. Hat der Browser das (Autoplay-Sperre) verweigert,
  // erneut versuchen – nach dem Tipp auf „Annehmen“ ist es erlaubt.
  _kickAudio() {
    const a = document.getElementById("remoteAudio");
    if (a && a.srcObject && a.paused) a.play().catch(() => {});
  },

  answer(call) {
    if (this.call !== call || !window.sipCore) return;
    this._kickAudio();
    Promise.resolve(window.sipCore.answerCall()).catch((err) => console.warn("elvio-room-card: Annehmen fehlgeschlagen", err));
  },

  hangup(call) {
    if (this.call !== call || !window.sipCore) return;
    Promise.resolve(window.sipCore.endCall()).catch((err) => console.warn("elvio-room-card: Auflegen fehlgeschlagen", err));
  },

  toggleMic(call) {
    if (this.call !== call) return;
    call.micOn = !call.micOn;
    this._applyMic(call);
    if (this.host) this.host._sipMicState();
  },

  setPtt(call, on) {
    if (this.call !== call || call.ptt === on) return;
    call.ptt = on;
    this._applyMic(call);
    if (this.host) this.host._sipMicState();
  },
};

// Woher die Einrichtung Erweiterungen (Karte, kiosk-mode) holt: ab Home Assistant 2026.11 der
// eingebaute Marketplace – er löst HACS ab und übernimmt eine HACS-Installation –, davor HACS.
// Beide liefern dieselben Felder (id, full_name, installed_version, available_version).
// null: weder noch, dann entfallen die Punkte.
async function extensionStore(ws, components) {
  if (components.includes("marketplace")) {
    try {
      const repos = await ws({ type: "marketplace/repositories/list", categories: ["plugin"] });
      return {
        name: "Marketplace",
        repos,
        install: (repo) =>
          ws({ type: "marketplace/repository/install", repository: repo.id }).catch((err) => {
            // Den Risikohinweis bestätigt jeder Admin einmal selbst – die Karte tut das nicht für ihn.
            if (err && err.code === "warning_not_accepted") {
              throw new Error("Erst den Marketplace in der Seitenleiste öffnen und den Hinweis bestätigen");
            }
            throw err;
          }),
      };
    } catch (err) {
      // Marketplace nicht geladen (oder ein HA ohne den Befehl): dann wie bisher HACS.
      if (!(err && (err.code === "not_loaded" || err.code === "unknown_command"))) throw err;
    }
  }
  if (components.includes("hacs")) {
    const repos = await ws({ type: "hacs/repositories/list" });
    return { name: "HACS", repos, install: (repo) => ws({ type: "hacs/repository/download", repository: repo.id }) };
  }
  return null;
}

class ElvioRoomCard extends HTMLElement {
  setConfig(config) {
    if (!config.title) throw new Error("title fehlt");
    if (!Array.isArray(config.tiles) || config.tiles.length === 0) {
      throw new Error("tiles fehlt (mindestens eine Kachel)");
    }
    const allTiles = [
      ...(config.tiles || []),
      ...(config.sections || []).flatMap((sec) => sec.tiles || []),
    ];
    for (const tile of allTiles) {
      if (tile.type === "lights" && !Array.isArray(tile.entities)) {
        throw new Error(`Licht-Kachel ohne entities: ${JSON.stringify(tile)}`);
      }
      if (tile.type === "agenda" && !Array.isArray(tile.entities)) {
        throw new Error(`Termine-Kachel braucht entities (Kalender): ${JSON.stringify(tile)}`);
      }
      if (tile.type === "energy" && !tile.solar) {
        throw new Error(`Energie-Kachel braucht solar: ${JSON.stringify(tile)}`);
      }
      if (tile.type === "fuel" && (!Array.isArray(tile.stations) || !tile.stations.length)) {
        throw new Error(`Tank-Kachel braucht stations: ${JSON.stringify(tile)}`);
      }
      if (tile.type === "automations" && !Array.isArray(tile.templates)) {
        throw new Error(`Automationen-Kachel braucht templates: ${JSON.stringify(tile)}`);
      }
      const type = tile.type || "entity";
      if (TILE_TYPES.includes(type) && !TILE_TYPES_NO_ENTITY.includes(type) && !tile.entity) {
        throw new Error(`Kachel ohne Entität: ${JSON.stringify(tile)}`);
      }
      if (tile.type === "service" && !tile.path && !tile.config_flow && !tile.url) {
        throw new Error(`Dienst-Kachel braucht path, url oder config_flow: ${JSON.stringify(tile)}`);
      }
      if (tile.unlock && !/^(button|input_button|lock)\./.test(tile.unlock)) {
        throw new Error(`unlock muss button.*, input_button.* oder lock.* sein: ${tile.unlock}`);
      }
      if (tile.sip_extension != null && tile.type !== "doorbell") {
        throw new Error(`sip_extension gibt es nur bei der Klingel (type: doorbell): ${JSON.stringify(tile)}`);
      }
      if (tile.sip_dtmf_mode && !["info", "rfc2833"].includes(String(tile.sip_dtmf_mode).toLowerCase())) {
        throw new Error(`sip_dtmf_mode muss info oder rfc2833 sein: ${tile.sip_dtmf_mode}`);
      }
      if (tile.sip_answer_dtmf != null && tile.sip_answer_dtmf !== "") {
        const tones = String(tile.sip_answer_dtmf);
        if (tones.includes("*")) {
          throw new Error("sip_answer_dtmf darf kein * enthalten – bei UniFi Access öffnet * die Tür");
        }
        if (!/^[0-9A-D#]+$/i.test(tones)) {
          throw new Error(`sip_answer_dtmf: nur Ziffern, A–D und # erlaubt: ${tones}`);
        }
      }
    }
    this._rawConfig = config;
    this._config = config;
    this._effSig = null;
    this._built = false;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (this._config && (!this._energyAt || Date.now() - this._energyAt > ENERGY_PREFS_TTL_MS)) this._ensureEnergy();
    if (this._built && this._navSigBuilt !== undefined && this._navSig() !== this._navSigBuilt) {
      this._rebuildKeepingPlace();
      return;
    }
    // Geräte, Räume oder Labels geändert (Kunde hat etwas gekoppelt oder am Tablet
    // ein-/ausgeblendet): Ansicht neu zusammenstellen. Nur dann – Zustandsänderungen
    // tauschen diese Objekte nicht aus.
    const regChanged =
      !prev || hass.entities !== prev.entities || hass.devices !== prev.devices || hass.areas !== prev.areas || hass.floors !== prev.floors;
    // Bereich umbenannt, verschoben, neu: die offene Raumübersicht baut ihre Kacheln neu.
    if (prev && (hass.areas !== prev.areas || hass.floors !== prev.floors)) this._roomCards = null;
    if (regChanged) {
      const eff = this._effectiveConfig();
      const sig = JSON.stringify(eff);
      if (sig !== this._effSig) {
        this._effSig = sig;
        this._config = eff;
        if (this._built) {
          this._rebuildKeepingPlace();
          return;
        }
        this._built = false;
      }
    }
    if (!this._built) this._build();
    this._update();
    this._maybePickRoom();
    // Rückfall für die gemeinsame Raum-Ansicht: Hat die Karte einen Wechsel von ?bereich= nicht
    // mitbekommen (HA hält Ansichten vor, abgehängt hört sie nichts), holt sie ihn hier nach.
    if (this._rawConfig.area === "auto" && location.search !== this._lastSearch && this._onRoomsPath()) {
      this._lastSearch = location.search;
      this._locationChanged();
    }
    // Offenes Bearbeiten-Blatt zeigt sofort den neuen Stand (auch wenn sich die Ansicht
    // selbst nicht geändert hat, z. B. ein ausgeblendeter Sensor zieht um).
    if (this._editWrap && !this._editWrap.hidden) {
      if (regChanged && this._editMode === "devices") this._renderEdit();
      if (regChanged && this._editMode === "views") this._renderViews();
      if (this._editMode === "leave") this._renderLeave(true);
      if (this._editMode === "notices") this._renderNotices(true);
      // Neues Stockwerk aus dem Raum-Blatt: erst jetzt kennt hass.floors es als Auswahl.
      if (prev && hass.floors !== prev.floors && this._editMode === "room") this._renderRoomForm();
      if (this._editMode === "automations") this._renderAutomations();
    }
  }

  // Neu aufbauen, ohne dass der Nutzer es merkt: Scrollstand und offenes Bearbeiten-Blatt
  // bleiben, keine Einblend-Animation.
  _rebuildKeepingPlace() {
    const top = this._scroller ? this._scroller.scrollTop : 0;
    const open = this._editWrap && !this._editWrap.hidden;
    const editing = open && this._editMode === "devices";
    const adding = open && this._editMode === "add" && !!this._addState;
    const roomForm = open && this._editMode === "room" && !!this._roomDraft;
    const floorForm = open && this._editMode === "floor" && !!this._floorDraft;
    const sceneForm = open && this._editMode === "scene" && !!this._sceneDraft;
    const leaveOpen = open && this._editMode === "leave";
    const noticesOpen = open && this._editMode === "notices";
    const roomsOpen = this._roomsNavWrap && !this._roomsNavWrap.hidden;
    const energyOpen = this._energyWrap && !this._energyWrap.hidden;
    const peopleOpen = this._peopleWrap && !this._peopleWrap.hidden;
    const viewsOpen = open && this._editMode === "views";
    this._build(true);
    this._update();
    this._scroller.scrollTop = top;
    if (editing) this._openEdit();
    if (adding) this._showAdd();
    if (energyOpen) this._openEnergy(true);
    if (peopleOpen) this._openPeople(true);
    if (viewsOpen) this._openViews();
    // Raumübersicht (auch im Bearbeiten-Modus) und Raum-Blatt mit Entwurf bleiben offen.
    if (roomsOpen) {
      this._roomsNavWrap.hidden = false;
      this._roomCards = null;
      this._renderRoomsNav();
    }
    if (roomForm) {
      this._editMode = "room";
      this._editActions.replaceChildren();
      this._editWrap.hidden = false;
      this._renderRoomForm();
    }
    if (floorForm) {
      this._editMode = "floor";
      this._editActions.replaceChildren();
      this._editWrap.hidden = false;
      this._renderFloorForm();
    }
    if (sceneForm) {
      this._editMode = "scene";
      this._editActions.replaceChildren();
      this._editWrap.hidden = false;
      this._renderSceneForm();
    }
    if (noticesOpen) this._openNotices();
    if (leaveOpen) {
      this._editMode = "leave";
      this._editActions.replaceChildren();
      this._editWrap.hidden = false;
      this._leaveKey = null;
      this._renderLeave();
    }
  }

  // Anderer Raum in der Adresse: dieselbe Karte zeigt einen anderen Raum – mit derselben
  // Einblendung wie ein Ansichtswechsel. HA meldet die neue Adresse, bevor es die Ansicht
  // tauscht; erst danach prüfen, ob diese Karte überhaupt noch sichtbar ist.
  _locationChanged() {
    if (!this._hass || !this._rawConfig || this._rawConfig.area !== "auto") return;
    setTimeout(() => {
      if (!this.isConnected || !this._onRoomsPath()) return;
      this._lastSearch = location.search;
      const eff = this._effectiveConfig();
      const sig = JSON.stringify(eff);
      if (sig !== this._effSig) {
        this._effSig = sig;
        this._config = eff;
        this._build();
        this._update();
      }
      this._maybePickRoom();
    }, 0);
  }

  // Ohne (gültigen) Raum in der Adresse: Raumübersicht öffnen – einmal je Adresse, damit sie
  // nach dem Schließen nicht bei jeder Zustandsänderung wieder aufgeht.
  _maybePickRoom() {
    if (!this._rawConfig || this._rawConfig.area !== "auto" || !this._onRoomsPath() || this._autoRoom() || !this._roomsNavWrap) return;
    const key = location.pathname + location.search;
    if (this._pickedFor === key) return;
    this._pickedFor = key;
    this._openRoomsNav();
  }

  // Steht der Browser (noch) auf der Raum-Ansicht? Beim Wechsel nach „Zuhause“ meldet sich die
  // verschwindende Raumkarte sonst noch einmal und öffnete die Raumübersicht.
  _onRoomsPath() {
    return location.pathname === ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path);
  }

  // ───────────── Räume aus HA-Bereichen ─────────────

  // Eine Raumliste für alle Stellen (Leiste, Übersicht, Verschieben, Musik, Tablet-Raum).
  // Altmodus: aus nav. Neuer Modus: aus den HA-Bereichen.
  _rooms({ includeHidden = false } = {}) {
    const nav = this._config.nav || [];
    if (ElvioRooms.isLegacy(nav)) return ElvioRooms.fromNav(nav, (k) => this._resolveArea(k));
    const hass = this._hass;
    return ElvioRooms.fromAreas(Object.values(hass.areas || {}), Object.values(hass.floors || {}), {
      basePath: ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path),
      hideLabel: LABEL_HIDE.id,
      includeHidden,
    });
  }

  _isAdmin() {
    return !!(this._hass && this._hass.user && this._hass.user.is_admin);
  }

  // Raum der gemeinsamen Raum-Ansicht (area: auto) aus ?bereich=… – nur sichtbare Räume.
  _autoRoom() {
    const id = ElvioRooms.areaFromLocation(location.search);
    return (id && this._rooms().find((r) => r.areaId === id)) || null;
  }

  // Bereich dieser Ansicht: `area:` in der Konfiguration, sonst der gleichnamige Raum aus
  // `nav` (Titel „Wohnbereich“ → Bereich „Wohnbereich“). Ohne Treffer: keine Automatik.
  _areaId(cfg = this._rawConfig) {
    if (cfg.area === "auto") {
      const room = this._autoRoom();
      return room ? room.areaId : null;
    }
    const key = cfg.area || ((cfg.nav || []).some((i) => i.room && i.name === cfg.title) ? cfg.title : null);
    return this._resolveArea(key);
  }

  // Erst nach Namen, dann nach ID: HA bildet die ID beim Anlegen aus dem Namen und behält
  // sie beim Umbenennen. Benennt der Kunde „Wohnbereich“ in „Wohnzimmer“ um, findet die
  // Seite ihren Bereich so trotzdem. (Umlaute: HA macht aus „ä“ ein „a“, wir schreiben „ae“.)
  _resolveArea(key) {
    if (!key) return null;
    const k = String(key).toLowerCase();
    const areas = Object.values(this._hass.areas || {});
    const byName = areas.find((x) => String(x.name || "").toLowerCase() === k);
    if (byName) return byName.area_id;
    const slug = (str, map) =>
      str.toLowerCase().replace(/[äöüß]/g, (ch) => map[ch]).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const ids = [
      key,
      slug(k, { ä: "a", ö: "o", ü: "u", ß: "ss" }),
      slug(k, { ä: "ae", ö: "oe", ü: "ue", ß: "ss" }),
    ];
    const byId = areas.find((x) => ids.includes(x.area_id));
    return byId ? byId.area_id : null;
  }

  // Raum (Bereich) einer Entität – eigene Zuordnung vor der ihres Geräts.
  _entityArea(e) {
    if (!e) return null;
    const dev = e.device_id && this._hass.devices && this._hass.devices[e.device_id];
    return e.area_id || (dev && dev.area_id) || null;
  }

  // Bedienbare Entitäten eines Bereichs – direkt oder über ihr Gerät zugeordnet. Versteckte
  // und technische (Diagnose/Konfiguration) bleiben draußen.
  _areaEntities(areaId) {
    const hass = this._hass;
    return Object.values(hass.entities || {}).filter(
      (e) => !e.hidden && !e.entity_category && hass.states[e.entity_id] && this._entityArea(e) === areaId,
    );
  }

  _placedIds() {
    const c = this._rawConfig;
    const ids = new Set();
    for (const t of [...(c.tiles || []), ...(c.sections || []).flatMap((s) => s.tiles || [])]) {
      if (t.entity) ids.add(t.entity);
      for (const id of t.entities || []) ids.add(id);
    }
    return ids;
  }

  // Ohne Label gilt: fest eingetragene Kacheln und Geräte der AUTO_DOMAINS sind sichtbar.
  _isShown(e, placed) {
    const labels = e.labels || [];
    if (labels.includes(LABEL_HIDE.id)) return false;
    if (labels.includes(LABEL_SHOW.id)) return true;
    return placed.has(e.entity_id) || AUTO_DOMAINS.includes(e.entity_id.split(".")[0]);
  }

  // Konfiguration aus dem Repo + Wahl des Kunden aus HA: Ausgeblendetes fällt weg, neue
  // Geräte des Raums kommen dazu (Lichter in die Licht-Kachel, der Rest unter „Weitere
  // Geräte“). Ohne Bereich und ohne Labels ist das Ergebnis die Konfiguration selbst.
  _effectiveConfig() {
    let c = this._rawConfig;
    // Gemeinsame Raum-Ansicht: Titel, Hintergrund und Temperatur kommen aus dem Bereich.
    if (c.area === "auto") {
      const room = this._autoRoom();
      if (room) c = { ...c, title: room.name, background: room.image || c.background, temperature: room.temperature || c.temperature };
    }
    const reg = this._hass.entities || {};
    const areaId = this._areaId();
    const hidden = new Set(
      Object.values(reg).filter((e) => (e.labels || []).includes(LABEL_HIDE.id)).map((e) => e.entity_id),
    );
    // In einer Raumseite: was der Kunde in HA in einen anderen Raum verschoben hat, steht
    // dort und nicht mehr hier. Geräte ohne Raum bleiben, wo sie eingetragen sind.
    if (areaId) {
      for (const e of Object.values(reg)) {
        const a = this._entityArea(e);
        if (a && a !== areaId) hidden.add(e.entity_id);
      }
    }
    // Licht-Kacheln bleiben vorerst auch leer stehen: Lichter des Raums aus HA füllen sie
    // gleich wieder auf. Erst danach fällt weg, was leer geblieben ist.
    const strip = (t) => {
      if (t.type === "lights") return { ...t, entities: t.entities.filter((id) => !hidden.has(id)) };
      return t.entity && hidden.has(t.entity) ? null : { ...t };
    };
    const filled = (t) => t.type !== "lights" || t.entities.length > 0;
    let tiles = (c.tiles || []).map(strip).filter(Boolean);
    let sections = (c.sections || []).map((sec) => ({ ...sec, tiles: (sec.tiles || []).map(strip).filter(Boolean) }));
    if (areaId) {
      const placed = this._placedIds();
      const extra = this._areaEntities(areaId)
        .filter((e) => !placed.has(e.entity_id) && this._isShown(e, placed))
        .map((e) => e.entity_id)
        .sort();
      const lights = extra.filter((id) => id.startsWith("light."));
      const others = extra.filter((id) => !id.startsWith("light."));
      const lightTile = [...tiles, ...sections.flatMap((sec) => sec.tiles)].find((t) => t.type === "lights");
      if (lightTile) lightTile.entities = [...lightTile.entities, ...lights];
      else others.unshift(...lights);
      // Eigene Abschnitte je Art: Bedienbares, Kameras (mit Klingel), Sensoren.
      const dc = (id) => (this._hass.states[id] || { attributes: {} }).attributes.device_class;
      for (const title of ["Weitere Geräte", "Kameras", "Sensoren"]) {
        const ids = others.filter((id) => ElvioRooms.roomSection(id, dc(id)) === title);
        if (ids.length) sections.push({ title, tiles: ids.map((id) => this._autoTile(id)) });
      }
    }
    tiles = tiles.filter(filled);
    sections = sections
      .map((sec) => ({ ...sec, tiles: sec.tiles.filter(filled) }))
      .filter((sec) => sec.tiles.length);
    return { ...c, tiles, sections };
  }

  _autoTile(id) {
    return ElvioRooms.autoTile(id, this._friendly(id));
  }

  _friendly(id) {
    const st = this._hass.states[id];
    return (st && st.attributes.friendly_name) || id;
  }

  // Lichter eines Raums für die Räume-Übersicht: eingetragene + dem Bereich zugeordnete.
  _roomLightIds(room) {
    const ids = new Set(room.lights || []);
    const areaId = room.areaId;
    if (areaId) {
      const none = new Set();
      for (const e of this._areaEntities(areaId)) {
        if (e.entity_id.startsWith("light.") && this._isShown(e, none)) ids.add(e.entity_id);
      }
    }
    const reg = this._hass.entities || {};
    return [...ids].filter((id) => {
      const e = reg[id];
      if (((e && e.labels) || []).includes(LABEL_HIDE.id)) return false;
      const a = this._entityArea(e);
      return !(areaId && a && a !== areaId);
    });
  }

  getCardSize() {
    return 12;
  }

  connectedCallback() {
    this._clockTimer = setInterval(() => this._updateClock(), CLOCK_REFRESH_MS);
    this._cameraTimer = setInterval(() => this._refreshCameras(), CAMERA_REFRESH_MS);
    this._progressTimer = setInterval(() => this._tickProgress(), PROGRESS_TICK_MS);
    this._saverTimer = setInterval(() => this._checkSaver(), SAVER_CHECK_MS);
    this._lastActive = Date.now();
    // Gemeinsame Raum-Ansicht: HA tauscht die Karte nicht aus, wenn nur ?bereich= wechselt.
    this._onLocation = () => this._locationChanged();
    window.addEventListener("location-changed", this._onLocation);
    window.addEventListener("popstate", this._onLocation);
    // HA hängt die vorgehaltene Raum-Ansicht wieder ein, ohne dass sie den Wechsel der Adresse
    // gehört hat (sie war abgehängt): sonst stünde noch der vorige Raum da.
    this._locationChanged();
    sipBridge.attach(this);
  }

  disconnectedCallback() {
    // Wer die Ansicht verlässt und zurückkommt, sieht wieder die Ansicht, nicht die Energie-Seite.
    this._closeEnergy();
    this._closePeople();
    clearInterval(this._energyTimer);
    clearInterval(this._clockTimer);
    clearInterval(this._cameraTimer);
    clearInterval(this._progressTimer);
    clearInterval(this._saverTimer);
    clearInterval(this._saverPhotoTimer);
    // Ein laufendes Gespräch geht weiter – die nächste sichtbare Karte übernimmt das Popup.
    window.removeEventListener("location-changed", this._onLocation);
    window.removeEventListener("popstate", this._onLocation);
    // Zurück auf /raum ohne Raum soll die Raumübersicht wieder aufgehen.
    this._pickedFor = null;
    sipBridge.detach(this);
    this._closeDoorbell();
  }

  // ───────────── Aufbau (einmal je Konfiguration) ─────────────

  _build(quiet = false) {
    const c = this._config;
    const root = this.shadowRoot;
    root.innerHTML = "";
    root.appendChild(el("style", "", STYLE));

    const frame = el("div", "frame");
    this._frame = frame;
    frame.lang = "de"; // Silbentrennung für zweizeilige Namen („Bewegungs-licht“)
    this._bg = el("div", "bg");
    this._bgImg = el("img", "bg-img");
    this._bgImg.alt = "";
    // Fehlt das Foto noch, bleibt der Verlauf sichtbar statt eines kaputten Bildes.
    this._bgImg.addEventListener("error", () => (this._bgImg.style.visibility = "hidden"));
    this._bgImg.addEventListener("load", () => (this._bgImg.style.visibility = ""));
    this._bg.appendChild(this._bgImg);
    frame.append(this._bg, el("div", "shade"), el("div", "dim"));

    // Kopfzeile: Marke | Ansichten | Uhr. Ein Tipp auf die Marke führt zurück in die
    // normale HA-Oberfläche (menu_path) – statt eines Menüknopfs.
    const header = el("header");
    const left = el("div", "left");
    // Schriftzug: „{name}“ steht für den Namen des Zuhauses aus HA (Einstellungen → System →
    // Allgemein → Name), z. B. „Familie Muster.“ – änderbar ohne YAML, wirkt sofort.
    const brand = el("button", "brand");
    this._brand = brand;
    brand.setAttribute("aria-label", "Zur Home-Assistant-Oberfläche");
    // Erst nachfragen: ein versehentlicher Tipp am Wandtablet soll nicht in die
    // HA-Oberfläche führen.
    brand.addEventListener("click", () => {
      this._confirmWrap.hidden = false;
    });
    left.append(brand);
    // Navigation: Räume (room: true) stehen nicht einzeln in der Leiste, sondern hinter
    // einem Eintrag „Räume“ – so bleibt es bei fünf Einträgen, egal wie viele Räume.
    const navItems = this._navItems();
    this._navEls = [];
    const nav = el("nav", "top");
    for (const item of navItems) {
      const link = el("button", "link", item.name);
      if (item.active) link.classList.add("active");
      this._navEls.push({ item, node: link });
      link.addEventListener("click", () => this._navClick(item));
      nav.appendChild(link);
    }
    this._clock = el("div", "clock");
    const right = el("div", "right");
    // Geräte bearbeiten: oben neben der Uhr, damit es in jedem Raum ohne Scrollen erreichbar
    // ist. Nur in Räumen mit HA-Bereich und nur für Admins – nur sie dürfen Labels und
    // Bereiche in HA ändern. Am Wandtablet: Dienste → Benutzer wechseln.
    if (this._areaId() && this._hass.user && this._hass.user.is_admin) {
      const edit = pillButton("mdi:pencil-outline", "Geräte");
      edit.setAttribute("aria-label", "Geräte bearbeiten");
      edit.addEventListener("click", () => this._openEdit());
      right.appendChild(edit);
    }
    right.appendChild(this._clock);
    if (c.logo) {
      // Marke des Einrichters, dezent rechts neben der Uhr.
      const mark = el("div", "mark");
      const img = el("img");
      img.src = c.logo;
      img.alt = "";
      mark.appendChild(img);
      right.appendChild(mark);
    }
    header.append(left, nav, right);

    // Titelblock
    const hero = el("section", "hero");
    this._status = el("div", "status");
    this._chips = el("div", "chips");
    // Neuer, leerer Behälter: der Merker des alten Inhalts gilt nicht mehr (sonst blieben die
    // Chips nach einem Neuaufbau leer, bis sich zufällig etwas ändert).
    this._chipsKey = "";
    hero.append(this._status, el("h1", "", c.title), this._chips);
    // Szenen des Raums (bzw. des Hauses auf Zuhause) als Knöpfe unter dem Titel.
    this._sceneChips = el("div", "chips scenechips");
    this._sceneChips.hidden = true;
    this._sceneKey = "";
    hero.appendChild(this._sceneChips);
    // Mit Live-Karte: die anderen Räume mit Lautsprecher als Chips über den Kacheln,
    // nebeneinander, bei vielen waagerecht scrollbar. Tipp holt den Raum in die Karte.
    this._roomChips = null;
    if ([...(c.tiles || []), ...(c.sections || []).flatMap((sec) => sec.tiles || [])].some((t) => t.type === "now_playing")) {
      this._roomChips = el("div", "chips roomchips");
      this._roomChipsKey = "";
      hero.appendChild(this._roomChips);
    }

    // Kacheln des ersten Bildschirms
    this._tiles = [];
    const tiles = this._buildTileGrid(c.tiles || []);

    // Erster Bildschirm wie in der Vorlage; darunter scrollbare Abschnitte („alles drin“).
    // Hintergrund und Kopfzeile bleiben stehen, nur der Inhalt wandert.
    const scroller = el("div", "scroller");
    this._scroller = scroller;
    const screen = el("section", "screen");
    screen.append(hero, tiles);
    scroller.appendChild(screen);
    const sections = c.sections || [];
    if (sections.length) {
      const more = el("button", "more");
      more.append(icon("mdi:chevron-down"), document.createTextNode("Mehr"));
      more.addEventListener("click", () =>
        scroller.scrollTo({ top: screen.offsetHeight, behavior: "smooth" }),
      );
      screen.appendChild(more);
      const list = el("div", "sections");
      for (const sec of sections) {
        const block = el("section", "section");
        if (sec.title) block.appendChild(el("h2", "", sec.title));
        block.appendChild(this._buildTileGrid(sec.tiles || []));
        list.appendChild(block);
      }
      scroller.appendChild(list);
    }
    this._wireScroll(frame, scroller, screen);

    const main = [scroller, this._buildEnergy(frame), this._buildPeople(frame)];
    this._navSigBuilt = this._navSig();

    // Leiste unten (nur Handy)
    const tabbar = el("nav", "tabbar");
    tabbar.style.setProperty("--n", String(navItems.length || 1));
    for (const item of navItems) {
      const b = el("button", "tab");
      b.setAttribute("aria-label", item.name);
      b.appendChild(icon(item.icon || "mdi:circle-outline"));
      b.appendChild(el("span", "tab-label", item.name));
      if (item.active) b.classList.add("active");
      this._navEls.push({ item, node: b });
      b.addEventListener("click", () => this._navClick(item));
      tabbar.appendChild(b);
    }

    frame.append(header, ...main, tabbar, this._buildPopup(), this._buildSearch(), this._buildRooms(), this._buildPlayer(), this._buildLights(), this._buildRoomsNav(), this._buildEdit(), this._buildConfirmHa());
    if (c.screensaver) {
      frame.appendChild(this._buildSaver());
      // Jede Berührung zählt als Aktivität. Ist der Schoner an, weckt der erste Tipp nur –
      // er darf nicht durchgreifen und z. B. eine Kachel auslösen (Capture-Phase).
      const wake = (e) => {
        this._lastActive = Date.now();
        if (!this._saver.hidden) {
          e.preventDefault();
          e.stopPropagation();
          this._hideSaver();
          // Nur ein Fingertipp erzeugt danach noch einen Klick, der verschluckt werden muss.
          if (e.type !== "pointerdown") this._swallowClick = false;
        }
      };
      for (const type of ["pointerdown", "keydown", "wheel"]) frame.addEventListener(type, wake, true);
      frame.addEventListener("click", (e) => {
        if (this._swallowClick) {
          e.preventDefault();
          e.stopPropagation();
          this._swallowClick = false;
        }
      }, true);
    }
    root.appendChild(frame);
    this._built = true;
    // Neu aufgebaut (auch mitten im Gespräch): Das Popup ist neu, ein laufender Anruf wird
    // darin wieder angezeigt.
    this._sipView = null;
    sipBridge.later();
    this._updateClock();

    // Seitenwechsel: weich einblenden statt hart umschalten. Abschnitte unter dem ersten
    // Bildschirm bauen sich erst auf, wenn sie ins Bild kommen.
    if (!quiet) frame.classList.add("enter");
    if (quiet) {
      for (const sec of frame.querySelectorAll(".section")) sec.classList.add("in");
    } else if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          }
        },
        { root: frame.querySelector(".scroller"), threshold: 0.15 },
      );
      for (const sec of frame.querySelectorAll(".section")) io.observe(sec);
    } else {
      for (const sec of frame.querySelectorAll(".section")) sec.classList.add("in");
    }
    if (!quiet && reopenSheet && reopenSheet.path === location.pathname && Date.now() - reopenSheet.at < 15000) {
      const mode = reopenSheet.mode;
      reopenSheet = null;
      setTimeout(() => {
        if (!this.isConnected) return;
        if (mode === "notices") this._openNotices();
        else if (mode === "views") this._openViews();
        else if (mode === "leave") this._openLeave();
      }, 50);
    }
  }

  // Magnet und Übergänge (--p) eines Scrollers; die Energie-Seite nutzt dasselbe Verhalten.
  _wireScroll(frame, scroller, screen) {
    // Magnet: zwei Ruhelagen (Ansicht | Anfang der Steuerung). Eingerastet wird nur im
    // Bereich dazwischen, in Wischrichtung; innerhalb der Steuerung scrollt man frei bis
    // ganz unten. (CSS scroll-snap zog die hohe Steuerung immer wieder an ihren Anfang.)
    // --p (0…1) folgt dem Finger und treibt alle Übergänge.
    let raf = 0;
    let settled = 0;
    let idle = 0;
    const snap = () => {
      const h = screen.offsetHeight;
      const t = scroller.scrollTop;
      if (t <= 1 || t >= h - 1) {
        settled = t <= 1 ? 0 : h;
        return;
      }
      const goingDown = t > settled;
      const target = goingDown ? (t > h * SNAP_THRESHOLD ? h : 0) : t < h * (1 - SNAP_THRESHOLD) ? 0 : h;
      settled = target;
      scroller.scrollTo({ top: target, behavior: "smooth" });
    };
    scroller.addEventListener(
      "scroll",
      () => {
        clearTimeout(idle);
        idle = setTimeout(snap, SNAP_IDLE_MS);
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const p = Math.min(1, Math.max(0, scroller.scrollTop / (screen.offsetHeight * 0.7)));
          frame.style.setProperty("--p", p.toFixed(3));
          frame.classList.toggle("scrolled", scroller.scrollTop > 24);
        });
      },
      { passive: true },
    );
  }

  _buildTileGrid(cfgs) {
    const grid = el("div", "tiles");
    // Breite Kacheln (span) zählen mehrfach – vier Spalten bleiben die Obergrenze.
    const units = cfgs.reduce((n, cfg) => n + this._span(cfg), 0);
    grid.style.setProperty("--cols", String(Math.max(1, Math.min(units, 4))));
    cfgs.forEach((cfg, i) => {
      const tile = this._buildTile(cfg);
      const span = this._span(cfg);
      if (span > 1) tile.node.style.setProperty("--span", String(span));
      // Versatz fürs Einblenden: Kacheln erscheinen nacheinander, nicht alle auf einmal.
      tile.node.style.setProperty("--i", String(i));
      this._tiles.push(tile);
      grid.appendChild(tile.node);
    });
    return grid;
  }

  _span(cfg) {
    if (cfg.type === "fuel") return cfg.span || 4;
    return cfg.span || (["now_playing", "tv", "agenda", "energy"].includes(cfg.type) ? 2 : 1);
  }

  _buildTile(cfg) {
    const node = el("div", `tile ${cfg.type || "entity"}`);
    const name = el("div", "name");
    const state = el("div", "state");
    const text = el("div", "text");
    text.append(name, state);
    node.appendChild(text);
    const tile = { cfg, node, name, state };

    if (!TILE_TYPES.includes(cfg.type || "entity") && !cfg.entity) {
      tile.unknown = true;
      node.classList.add("missing");
      name.textContent = cfg.name || "Neue Kachel";
      state.textContent = "Seite neu laden – die Karte ist älter als diese Kachel";
      return tile;
    }

    switch (cfg.type) {
      case "lights": {
        const ic = el("button", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:ceiling-light-outline"));
        ic.addEventListener("click", (e) => {
          e.stopPropagation();
          this._toggleLights(cfg.entities);
        });
        const slider = el("input", "slider");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        // Während des Ziehens keine Updates von außen, sonst springt der Regler zurück.
        slider.addEventListener("pointerdown", () => (tile.dragging = true));
        slider.addEventListener("change", () => {
          tile.dragging = false;
          this._setBrightness(cfg.entities, Number(slider.value));
        });
        slider.addEventListener("click", (e) => e.stopPropagation());
        node.append(ic, slider);
        tile.slider = slider;
        // Tipp auf die Kachel: Liste der einzelnen Lichter dieses Raums.
        node.addEventListener("click", () => this._openLights(cfg));
        break;
      }
      case "climate": {
        const side = el("div", "side");
        const power = el("button", "power");
        power.setAttribute("aria-label", "Ein/Aus");
        power.appendChild(icon("mdi:power"));
        power.addEventListener("click", (e) => {
          e.stopPropagation();
          this._toggleClimate(cfg.entity);
        });
        const mode = el("button", "mode");
        mode.setAttribute("aria-label", "Einstellungen");
        tile.modeIcon = icon("mdi:fire");
        mode.appendChild(tile.modeIcon);
        mode.addEventListener("click", (e) => {
          e.stopPropagation();
          this._moreInfo(cfg.entity);
        });
        side.append(power, mode);
        node.appendChild(side);
        tile.power = power;
        node.addEventListener("click", () => this._moreInfo(cfg.entity));
        break;
      }
      case "camera": {
        const img = el("img", "cam");
        img.alt = "";
        node.prepend(img);
        const live = el("div", "live");
        live.append(el("span", "dot"), document.createTextNode("Live"));
        node.appendChild(live);
        tile.img = img;
        node.addEventListener("click", () => this._moreInfo(cfg.entity));
        break;
      }
      case "doorbell": {
        // Klingel: Ereignis-Entität (UniFi Protect/Access, Zustand = Zeitstempel des letzten
        // Klingelns). Antippen zeigt das Livebild, ohne dass jemand geklingelt hat.
        // Mit sip_extension zusätzlich Gegensprechen über SIP Core (siehe sipBridge).
        const ic = el("div", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:doorbell-video"));
        node.appendChild(ic);
        node.addEventListener("click", () => this._openDoorbell(cfg, false));
        break;
      }
      case "media": {
        // Lautsprecher/Raum: Cover als Kachelbild, Play/Pause, Lautstärke.
        const img = el("img", "cam");
        img.alt = "";
        node.prepend(img);
        const ic = el("button", "icon");
        ic.setAttribute("aria-label", "Wiedergabe/Pause");
        tile.playIcon = icon("mdi:play");
        ic.appendChild(tile.playIcon);
        ic.addEventListener("click", (e) => {
          e.stopPropagation();
          this._hass.callService("media_player", "media_play_pause", { entity_id: cfg.entity });
        });
        const slider = el("input", "slider");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.setAttribute("aria-label", "Lautstärke");
        slider.addEventListener("pointerdown", () => (tile.dragging = true));
        slider.addEventListener("change", () => {
          tile.dragging = false;
          this._hass.callService("media_player", "volume_set", {
            entity_id: cfg.entity,
            volume_level: Number(slider.value) / 100,
          });
        });
        slider.addEventListener("click", (e) => e.stopPropagation());
        // Lupe: Musik für genau diesen Raum suchen (Raum der Ansicht, sonst des Players).
        const find = el("button", "msearch");
        find.setAttribute("aria-label", "Musik für diesen Raum suchen");
        find.appendChild(icon("mdi:magnify"));
        find.addEventListener("click", (e) => {
          e.stopPropagation();
          this._openSearch(this._areaId() || this._entityArea(this._hass.entities && this._hass.entities[cfg.entity]));
        });
        node.append(ic, find, slider);
        tile.img = img;
        tile.slider = slider;
        // Läuft etwas: HA-Dialog (Lautstärke, Quelle). Sonst Suche für diesen Raum – auf dem
        // Handy ist die Lupe ausgeblendet, damit alle Kacheln dasselbe Muster haben.
        node.addEventListener("click", () => {
          const st = this._hass && this._hass.states[cfg.entity];
          const active = st && ["playing", "paused", "buffering"].includes(st.state);
          if (active) this._openMedia(cfg.entity);
          else this._openSearch(this._areaId() || this._entityArea(this._hass.entities && this._hass.entities[cfg.entity]));
        });
        break;
      }
      case "now_playing": {
        // Live-Karte: zeigt, was gerade läuft – egal wo es gestartet wurde (Tablet, Handy,
        // Spotify-App). Sie sucht sich selbst den aktiven Player.
        node.innerHTML = "";
        const cover = el("img", "np-cover");
        cover.alt = "";
        const info = el("div", "np-info");
        tile.player = el("div", "np-player");
        tile.title = el("div", "np-title");
        tile.artist = el("div", "np-artist");
        const progress = el("div", "np-progress");
        tile.elapsed = el("span", "", "");
        const bar = el("div", "np-bar");
        tile.bar = el("i");
        bar.appendChild(tile.bar);
        tile.duration = el("span", "", "");
        progress.append(tile.elapsed, bar, tile.duration);
        info.append(tile.player, tile.title, tile.artist, progress);
        const controls = el("div", "np-controls");
        const mk = (iconName, label, service, cls = "") => {
          const b = el("button", cls);
          b.setAttribute("aria-label", label);
          const ic = icon(iconName);
          b.appendChild(ic);
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (tile.entityId) this._hass.callService("media_player", service, { entity_id: tile.entityId });
          });
          controls.appendChild(b);
          return { b, ic };
        };
        // Raum-Knopf: Musik in einen anderen Raum schieben oder Räume dazunehmen.
        const roomBtn = el("button", "np-room");
        roomBtn.setAttribute("aria-label", "Raum wählen");
        roomBtn.appendChild(icon("mdi:speaker-multiple"));
        roomBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this._openRooms(tile.entityId);
        });
        controls.appendChild(roomBtn);
        tile.roomBtn = roomBtn;
        tile.prev = mk("mdi:skip-previous", "Zurück", "media_previous_track");
        tile.play = mk("mdi:play", "Wiedergabe/Pause", "media_play_pause", "np-play");
        tile.next = mk("mdi:skip-next", "Weiter", "media_next_track");
        node.append(cover, info, controls);
        tile.cover = cover;
        tile.progressEl = progress;
        // Läuft etwas: HA-Dialog (Lautstärke, Quelle, Gruppieren). Sonst Suche – für den
        // gezeigten Raum, wenn die Karte einen hat.
        node.addEventListener("click", () => {
          if (tile.entityId && tile.active) this._openMedia(tile.entityId);
          else this._openSearch(tile.areaId || this._areaId());
        });
        break;
      }
      case "tv": {
        // Fernseher: Bild der Sendung, Apps direkt starten (source_list), Ein/Aus, Lautstärke.
        // Zwei Zeilen: oben was läuft + Ein/Aus, unten App-Knöpfe über die volle Breite +
        // Lautstärke. Das Bild der Sendung liegt verschwommen dahinter.
        node.innerHTML = "";
        const art = el("img", "tv-bg");
        art.alt = "";
        const top = el("div", "tv-top");
        const info = el("div", "tv-info");
        tile.tvName = el("div", "np-player");
        tile.tvTitle = el("div", "np-title");
        info.append(tile.tvName, tile.tvTitle);
        const bottom = el("div", "tv-bottom");
        tile.apps = el("div", "tv-apps");
        const vol = el("div", "tv-controls");
        const mk = (parent, iconName, label, fn) => {
          const b = el("button");
          b.setAttribute("aria-label", label);
          b.appendChild(icon(iconName));
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            fn();
          });
          parent.appendChild(b);
          return b;
        };
        const call = (service, data = {}) =>
          this._hass.callService("media_player", service, { entity_id: cfg.entity, ...data });
        tile.vol = [
          mk(vol, "mdi:volume-minus", "Leiser", () => call("volume_down")),
          mk(vol, "mdi:volume-plus", "Lauter", () => call("volume_up")),
        ];
        const powerWrap = el("div", "tv-controls");
        tile.power = mk(powerWrap, "mdi:power", "Ein/Aus", () => call("toggle"));
        tile.power.classList.add("tv-power");
        top.append(info, powerWrap);
        bottom.append(tile.apps, vol);
        node.append(art, top, bottom);
        tile.art = art;
        tile.appsKey = "";
        node.addEventListener("click", () => this._moreInfo(cfg.entity));
        break;
      }
      case "agenda": {
        node.innerHTML = "";
        const head = el("div", "ag-head");
        tile.agTitle = el("div", "name", cfg.name || "Termine");
        head.append(tile.agTitle, icon(cfg.icon || "mdi:calendar-month-outline"));
        tile.list = el("div", "ag-list");
        node.append(head, tile.list);
        tile.fetched = 0;
        tile.calKey = "";
        break;
      }
      case "fuel": {
        // Spritpreise: Filter nach Sorte, je Tankstelle Preis und Verlauf als Minidiagramm,
        // günstigste zuerst.
        node.innerHTML = "";
        const head = el("div", "fu-head");
        head.append(el("div", "name", cfg.name || "Spritpreise"));
        const chips = el("div", "fu-filter");
        tile.kinds = FUEL_KINDS.filter((k) => cfg.stations.some((st) => st[k.key]));
        tile.kind = (tile.kinds.find((k) => k.key === cfg.default) || tile.kinds[0] || {}).key;
        tile.kindButtons = tile.kinds.map((k) => {
          const b = el("button", "fu-chip", k.label);
          b.addEventListener("click", () => {
            tile.kind = k.key;
            tile.fuelKey = "";
            this._updateFuel(tile);
          });
          chips.appendChild(b);
          return { key: k.key, b };
        });
        head.appendChild(chips);
        tile.list = el("div", "fu-list");
        node.append(head, tile.list);
        tile.fetched = 0;
        tile.history = {};
        tile.fuelKey = "";
        break;
      }
      case "energy": {
        // Energie: Solar groß, darunter Batterie, Haus, Netz, Wallbox. Werte kommen aus der
        // 1KOMMA5°-Integration (Heartbeat) bzw. dem Shelly im Erzeugungspfad. Nur Anzeige –
        // gesteuert wird von Heartbeat, ein zweiter Energiemanager würde dagegen arbeiten.
        node.innerHTML = "";
        // Kein eigener Titel – die Abschnittsüberschrift „Energie“ steht schon darüber.
        const head = el("div", "en-head");
        const big = el("button", "en-big");
        tile.enSolar = el("div", "en-value");
        big.append(icon("mdi:solar-power-variant-outline"), tile.enSolar, el("div", "en-label", "Solar jetzt"));
        // Mit HA-Energie öffnet ein Tipp die Energie-Seite, sonst wie bisher den Solar-Verlauf.
        big.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this._energyOn()) this._openEnergy();
          else this._moreInfo(cfg.solar);
        });
        node.addEventListener("click", () => {
          if (this._energyOn()) this._openEnergy();
        });
        tile.enPrice = el("button", "en-price");
        tile.enPrice.addEventListener("click", (e) => {
          e.stopPropagation();
          this._moreInfo(cfg.price);
        });
        head.append(big, tile.enPrice);
        tile.enStats = el("div", "en-stats");
        node.append(head, tile.enStats);
        tile.enKey = "";
        break;
      }
      case "toggle": {
        // Schalter (input_boolean/switch): Antippen schaltet direkt um – für Optionen wie
        // Bildschirmschoner oder Anwesenheits-Automatik.
        const ic = el("div", "icon");
        tile.icon = icon(cfg.icon || "mdi:toggle-switch-outline");
        ic.appendChild(tile.icon);
        node.appendChild(ic);
        node.addEventListener("click", () =>
          this._hass.callService("homeassistant", "toggle", { entity_id: cfg.entity }),
        );
        break;
      }
      case "views": {
        const ic = el("div", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:view-dashboard-outline"));
        node.appendChild(ic);
        node.addEventListener("click", () => this._openViews());
        break;
      }
      case "setup": {
        const ic = el("div", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:auto-fix"));
        node.appendChild(ic);
        node.addEventListener("click", () => this._openSetup());
        break;
      }
      case "automations": {
        const ic = el("div", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:robot-outline"));
        node.appendChild(ic);
        node.addEventListener("click", () => this._openAutomations(cfg));
        break;
      }
      case "weather": {
        // Wetter: Zustand, Temperatur, und ob in den nächsten Stunden Regen kommt.
        const ic = el("div", "icon");
        tile.icon = icon("mdi:weather-partly-cloudy");
        ic.appendChild(tile.icon);
        node.appendChild(ic);
        tile.rainText = "";
        tile.rainFetched = 0;
        node.addEventListener("click", () => this._moreInfo(cfg.entity));
        break;
      }
      case "tablet_room": {
        const ic = el("div", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:tablet"));
        node.appendChild(ic);
        node.addEventListener("click", () => this._openTabletRoom());
        break;
      }
      case "search": {
        const ic = el("div", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:magnify"));
        node.appendChild(ic);
        node.addEventListener("click", () => this._openSearch(this._areaId()));
        break;
      }
      case "service":
      case "account": {
        const ic = el("div", "icon");
        tile.icon = icon(cfg.icon || (cfg.type === "account" ? "mdi:account-switch-outline" : "mdi:link-variant"));
        ic.appendChild(tile.icon);
        node.appendChild(ic);
        node.addEventListener("click", () =>
          cfg.type === "account" ? this._switchUser(tile) : this._openService(tile),
        );
        break;
      }
      case "action": {
        // Skript oder Szene: Antippen löst aus.
        const ic = el("div", "icon");
        ic.appendChild(icon(cfg.icon || "mdi:play-circle-outline"));
        node.appendChild(ic);
        node.addEventListener("click", () => this._runAction(cfg.entity));
        break;
      }
      default: {
        // Schloss, Alarm, Rollladen, Sensor …: Antippen öffnet den HA-Dialog.
        // Schlösser und Alarm schalten nie direkt – ein Fehlgriff am Wandtablet
        // darf die Haustür nicht öffnen.
        const ic = el("div", "icon");
        tile.icon = icon(cfg.icon || "mdi:information-outline");
        // Mediaplayer: Cover des laufenden Titels/Films verschwommen als Kachel-Hintergrund.
        tile.thumb = el("img", "thumb");
        tile.thumb.alt = "";
        ic.append(tile.icon);
        node.prepend(tile.thumb);
        node.appendChild(ic);
        node.addEventListener("click", () => this._moreInfo(cfg.entity));
      }
    }
    return tile;
  }

  // ───────────── Aktualisierung (bei jedem hass-Update) ─────────────

  _update() {
    const c = this._config;
    const hass = this._hass;

    this._updateBackground();
    const name = (hass.config && hass.config.location_name) || "Zuhause";
    this._brand.textContent = (c.brand === undefined ? "{name}." : c.brand).replace("{name}", name);

    // Statuszeile: „21° · Angenehm“
    const tEntity = c.temperature && hass.states[c.temperature];
    let temp = NaN;
    if (tEntity) {
      temp = Number(
        tEntity.entity_id.startsWith("climate.")
          ? tEntity.attributes.current_temperature
          : tEntity.state,
      );
    }
    this._status.textContent = Number.isFinite(temp)
      ? `${Math.round(temp)}° · ${comfortLabel(temp)}`
      : "";

    this._renderChips();
    this._renderScenes();
    for (const tile of this._tiles) this._updateTile(tile);
    if (this._popupCard) this._popupCard.hass = hass;
    this._renderRooms();
    this._renderPlayer();
    this._renderLights();
    this._renderRoomsNav();
    this._renderEnergyLive();
    this._renderPeople();
  }

  _updateBackground() {
    // Läuft Musik, wird das Cover (weichgezeichnet) zum Hintergrund – wie bei Apple Music.
    // background_media: true = derselbe Player wie die Live-Karte; Liste = feste Auswahl.
    const bm = this._config.background_media;
    const pool = bm === true ? [this._pickPlayer()] : (bm || []).map((id) => this._hass.states[id]);
    const playing = pool.find((st) => st && st.state === "playing" && st.attributes.entity_picture);
    this._bg.classList.toggle("media", !!playing);
    if (playing) {
      const pic = playing.attributes.entity_picture;
      if (this._bgImg.getAttribute("src") !== pic) this._bgImg.src = pic;
      return;
    }
    const bg = this._config.background;
    if (!bg) {
      this._bgImg.removeAttribute("src");
      return;
    }
    if (bg.startsWith("camera.")) {
      const st = this._hass.states[bg];
      const pic = st && st.attributes.entity_picture;
      if (pic && !this._bgImg.src) this._bgImg.src = pic;
      return;
    }
    if (this._bgImg.getAttribute("src") !== bg) this._bgImg.src = bg;
  }

  _renderChips() {
    const hass = this._hass;
    const chips = [];
    // Hinweise (Zuhause): nur wenn es etwas gibt; rot bei Alarm.
    if (this._config.notices !== false && this._isHomeCard()) {
      const shown = this._notices().filter((n) => !n.ignored);
      if (shown.length) {
        const alarm = shown.some((n) => n.kind === "alarm");
        chips.push({
          id: "notices",
          kind: `entity notices${alarm ? " alarm" : ""}`,
          icon: alarm ? "mdi:alarm-light-outline" : "mdi:alert-circle-outline",
          title: `${shown.length} ${shown.length === 1 ? "Hinweis" : "Hinweise"}`,
          sub: shown[0].title,
        });
      }
    }
    for (const chipId of this._config.chips || []) {
      // „now_playing“ = der Player, den auch die Live-Karte zeigt – nur solange etwas spielt.
      let id = chipId;
      if (chipId === "now_playing") {
        const np = this._pickPlayer();
        if (!np || np.state !== "playing") continue;
        id = np.entity_id;
      }
      if (chipId === "offen") {
        // Was steht offen? Fenster, Türen, Tore. Nichts offen → kein Chip.
        const open = this._openThings();
        if (!open.length) continue;
        chips.push({
          id: "offen",
          kind: "entity open",
          icon: "mdi:window-open-variant",
          title: `${open.length} offen`,
          sub: open.map((st) => st.attributes.friendly_name).join(", "),
        });
        continue;
      }
      const st = hass.states[id];
      if (!st) continue;
      const domain = id.split(".")[0];
      if (domain === "media_player") {
        if (!["playing", "paused", "buffering"].includes(st.state)) continue;
        const a = st.attributes;
        // Titel vorn, Interpret und Raum dahinter. app_name ist bei Music Assistant nur
        // „Music Assistant Queue“ und sagt dem Bewohner nichts.
        chips.push({
          id,
          kind: "media",
          picture: a.entity_picture,
          icon: "mdi:music-note",
          title: a.media_title || a.friendly_name,
          sub: [a.media_artist, a.friendly_name].filter(Boolean).join(" · ") || hass.formatEntityState(st),
        });
      } else if (domain === "person") {
        chips.push({
          id,
          kind: "person",
          picture: st.attributes.entity_picture,
          initial: (st.attributes.friendly_name || "?").charAt(0),
          title: st.attributes.friendly_name,
          sub: hass.formatEntityState(st),
        });
      } else {
        // Wert vorn, Name klein dahinter: „54 ppm · CO₂ Wohnzimmer“.
        const ent = hass.entities && hass.entities[id];
        chips.push({
          id,
          kind: "entity",
          icon:
            st.attributes.icon ||
            (ent && ent.icon) ||
            DEVICE_CLASS_ICON[st.attributes.device_class] ||
            "mdi:circle-medium",
          title: hass.formatEntityState(st),
          sub: st.attributes.friendly_name,
        });
      }
    }

    // Nur neu zeichnen, wenn sich etwas geändert hat – sonst flackern Avatare.
    // Admins sehen, wenn zur Karte gehörende Funktionen noch fehlen – sonst weiß niemand,
    // dass es sie gibt.
    if (hass.user && hass.user.is_admin && this._config.setup_hint !== false) {
      this._ensureSetup();
      // Die Umstellung auf Räume aus HA ist ein Angebot, keine fehlende Funktion: Sie steht in der
      // Liste, zählt aber nicht mit – sonst bliebe der Chip an jedem alten Dashboard für immer.
      const open = setupCache ? setupCache.items.filter((i) => !i.done && i.id !== "rooms").length : 0;
      if (open) chips.push({ id: "setup", kind: "entity", icon: "mdi:auto-fix", title: `${open} offen`, sub: "Einrichtung" });
    }
    const key = JSON.stringify(chips);
    if (key === this._chipsKey) return;
    this._chipsKey = key;
    this._chips.innerHTML = "";
    for (const chip of chips) {
      // Antippbar: öffnet den HA-Dialog (Person: Standort/Verlauf, Musik: Lautstärke,
      // Quelle, Gruppieren, Sensor: Verlauf).
      const node = el("button", `chip ${chip.kind}`);
      node.addEventListener("click", () =>
        chip.id === "offen"
          ? this._openOpenThings()
          : chip.id === "setup"
            ? this._openSetup()
            : chip.id === "notices"
              ? this._openNotices()
              : this._openMedia(chip.id),
      );
      const av = el("div", "av");
      if (chip.picture) {
        const img = el("img");
        img.src = chip.picture;
        img.alt = "";
        av.appendChild(img);
      } else if (chip.icon) {
        av.appendChild(icon(chip.icon));
      } else {
        av.textContent = chip.initial;
      }
      const txt = el("div", "txt");
      txt.append(el("b", "", chip.title), el("span", "", chip.sub));
      node.append(av, txt);
      this._chips.appendChild(node);
    }
  }

  _updateTile(tile) {
    const hass = this._hass;
    const cfg = tile.cfg;
    if (tile.unknown) return;

    if (cfg.type === "lights") {
      const states = cfg.entities.map((id) => hass.states[id]).filter(Boolean);
      const on = states.filter((s) => s.state === "on");
      tile.name.textContent = cfg.name || "Licht";
      // Bis zu zwei Lichter beim Namen nennen – „2 an“ allein sagt nicht, welche.
      const names = on.map((st) => st.attributes.friendly_name || st.entity_id);
      tile.state.textContent = !on.length
        ? "Alle aus"
        : on.length <= 2 && states.length > 1
          ? `${names.join(", ")} an`
          : on.length === states.length && states.length > 1
            ? "Alle an"
            : `${on.length} von ${states.length} an`;
      tile.node.classList.toggle("on", on.length > 0);
      if (!tile.dragging) {
        const levels = on.map((s) => s.attributes.brightness ?? 255);
        const avg = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
        tile.slider.value = String(Math.round((avg / 255) * 100));
      }
      tile.slider.style.setProperty("--fill", `${tile.slider.value}%`);
      return;
    }

    if (cfg.type === "service" || cfg.type === "account") {
      this._updateServiceTile(tile);
      return;
    }
    if (cfg.type === "now_playing") {
      this._updateNowPlaying(tile);
      return;
    }
    if (cfg.type === "agenda") {
      this._updateAgenda(tile);
      return;
    }
    if (cfg.type === "energy") {
      this._updateEnergy(tile);
      return;
    }
    if (cfg.type === "fuel") {
      this._updateFuel(tile);
      return;
    }
    if (cfg.type === "views") {
      tile.name.textContent = cfg.name || "Ansichten";
      tile.state.textContent = `Energie ${this._viewOn("energy") ? "an" : "aus"} · Personen ${this._viewOn("people") ? "an" : "aus"}`;
      return;
    }
    if (cfg.type === "setup") {
      tile.name.textContent = cfg.name || "Einrichtung";
      if (!(hass.user && hass.user.is_admin)) {
        tile.state.textContent = "Nur mit Admin-Anmeldung";
        return;
      }
      this._ensureSetup();
      const open = setupCache ? setupCache.items.filter((i) => !i.done).length : null;
      tile.state.textContent =
        this._setupError ? "Prüfung fehlgeschlagen" : open == null ? "Wird geprüft …" : open ? `${open} offen` : "Alles eingerichtet";
      tile.node.classList.toggle("on", !!open);
      return;
    }
    if (cfg.type === "automations") {
      const all = Object.values(hass.states).filter((st) => st.entity_id.startsWith("automation.") && st.state !== "unavailable");
      const on = all.filter((st) => st.state === "on").length;
      tile.name.textContent = cfg.name || "Automationen";
      tile.state.textContent = all.length ? `${on} an · ${all.length - on} aus` : "Noch keine · Anlegen";
      return;
    }
    if (cfg.type === "weather") {
      this._updateWeather(tile);
      return;
    }
    if (cfg.type === "tablet_room") {
      const stored = this._tabletRoom();
      const wantedArea = this._tabletRoomArea();
      const rooms = this._rooms();
      // Ausgeblendeter Bereich: Name aus HA. Gespeicherter Name eines Raums aus nav (bis v1.5.0):
      // so wie er ist. Unbekannte ID (Bereich gelöscht) oder Name: nicht festgelegt statt der ID.
      const found = (wantedArea && rooms.find((r) => r.areaId === wantedArea)) || (stored && rooms.find((r) => r.name === stored));
      const area = wantedArea && (this._hass.areas || {})[wantedArea];
      const room = found ? found.name : area ? area.name : null;
      tile.name.textContent = cfg.name || "Tablet hängt in";
      tile.state.textContent = `${room || "Nicht festgelegt"} · nur dieses Gerät`;
      return;
    }
    if (cfg.type === "search") {
      tile.name.textContent = cfg.name || "Musik suchen";
      tile.state.textContent = cfg.state_text || "Titel, Alben, Playlists";
      return;
    }

    const st = hass.states[cfg.entity];
    if (!st) {
      tile.name.textContent = cfg.name || cfg.entity;
      tile.state.textContent = "Nicht gefunden";
      tile.node.classList.add("missing");
      return;
    }
    tile.node.classList.remove("missing");
    tile.name.textContent = cfg.name || st.attributes.friendly_name || cfg.entity;

    switch (cfg.type) {
      case "climate": {
        const off = st.state === "off";
        const target = st.attributes.temperature;
        tile.state.textContent = off
          ? "Aus"
          : [HVAC_LABEL[st.state] || hass.formatEntityState(st), target != null ? `${target}°` : null]
              .filter(Boolean)
              .join(" · ");
        tile.power.classList.toggle("active", off);
        tile.modeIcon.setAttribute("icon", HVAC_ICON[this._activeMode(st)] || "mdi:thermostat");
        break;
      }
      case "doorbell":
        this._updateDoorbell(tile, st);
        break;
      case "toggle":
        tile.state.textContent = st.state === "on" ? cfg.on_text || "An" : cfg.off_text || "Aus";
        tile.node.classList.toggle("on", st.state === "on");
        break;
      case "tv":
        this._updateTv(tile, st);
        break;
      case "media": {
        const a = st.attributes;
        const active = ["playing", "paused", "buffering"].includes(st.state);
        const track = [a.media_title, a.media_artist].filter(Boolean).join(" · ");
        tile.state.textContent = active && track ? track : hass.formatEntityState(st);
        tile.playIcon.setAttribute("icon", st.state === "playing" ? "mdi:pause" : "mdi:play");
        const pic = active ? a.entity_picture : null;
        if (pic) {
          if (tile.img.getAttribute("src") !== pic) tile.img.src = pic;
        } else {
          tile.img.removeAttribute("src");
        }
        tile.node.classList.toggle("has-art", !!pic);
        tile.node.classList.toggle("playing", st.state === "playing");
        // Ohne bekannte Lautstärke kein Regler auf einer erfundenen Null.
        tile.slider.hidden = a.volume_level == null;
        if (!tile.dragging && a.volume_level != null) {
          tile.slider.value = String(Math.round(a.volume_level * 100));
        }
        tile.slider.style.setProperty("--fill", `${tile.slider.value}%`);
        break;
      }
      case "camera":
        tile.state.textContent = "Live ansehen";
        if (!tile.img.src && st.attributes.entity_picture) tile.img.src = this._cameraUrl(st);
        break;
      case "action":
        // Ein Skript ist „aus“, solange es nicht läuft – das liest sich wie ein Fehler.
        tile.state.textContent = st.state === "on" ? "Läuft …" : cfg.state_text || "Antippen";
        break;
      default:
        tile.state.textContent = hass.formatEntityState(st);
        // Zeit-Helfer: „19:30“ statt „19:30:00“.
        if (st.entity_id.startsWith("input_datetime.") && st.attributes.has_time && !st.attributes.has_date) {
          tile.state.textContent = st.state.slice(0, 5);
        }
        if (tile.thumb && st.entity_id.startsWith("media_player.")) {
          const a = st.attributes;
          const active = ["playing", "paused", "buffering"].includes(st.state);
          const pic = active ? a.entity_picture : null;
          if (pic && tile.thumb.getAttribute("src") !== pic) tile.thumb.src = pic;
          if (!pic) tile.thumb.removeAttribute("src");
          tile.node.classList.toggle("has-thumb", !!pic);
          const track = [a.media_title, a.media_artist || a.media_series_title].filter(Boolean).join(" · ");
          if (active && track) tile.state.textContent = track;
        }
        tile.node.classList.toggle(
          "alert",
          st.state === "triggered" || st.state === "jammed" || ElvioRooms.isAlert(st.entity_id, st.attributes.device_class, st.state),
        );
        if (tile.icon && !cfg.icon) tile.icon.setAttribute("icon", this._defaultIcon(st));
    }
  }

  // Leistung in Watt, egal ob die Quelle W oder kW meldet. Unbekannt bleibt null –
  // nie eine erfundene Null.
  _watts(id) {
    const st = id && this._hass.states[id];
    if (!st) return null;
    const v = Number(st.state);
    if (!Number.isFinite(v)) return null;
    return st.attributes.unit_of_measurement === "kW" ? v * 1000 : v;
  }

  _updateEnergy(tile) {
    const cfg = tile.cfg;
    const hass = this._hass;
    const fmt = (w) =>
      Math.abs(w) < 1000
        ? `${Math.round(Math.abs(w))} W`
        : `${(Math.abs(w) / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} kW`;
    // Kleine Ströme sind Messrauschen, kein „lädt“/„Einspeisung“.
    const idle = 30;

    const solar = this._watts(cfg.solar);
    tile.enSolar.textContent = solar == null ? "–" : fmt(solar);
    tile.node.classList.toggle("sunny", solar != null && Math.abs(solar) > 1500);

    const priceSt = cfg.price && hass.states[cfg.price];
    const price = priceSt ? Number(priceSt.state) : NaN;
    tile.enPrice.textContent = Number.isFinite(price)
      ? `Strom ${Math.round(priceSt.attributes.unit_of_measurement === "ct/kWh" ? price : price * 100)} ct/kWh`
      : "";

    const stats = [];
    const socSt = cfg.battery && hass.states[cfg.battery];
    const soc = socSt ? Number(socSt.state) : NaN;
    if (Number.isFinite(soc)) {
      const inW = this._watts(cfg.battery_in) || 0;
      const outW = this._watts(cfg.battery_out) || 0;
      const sub = inW > idle ? `lädt ${fmt(inW)}` : outW > idle ? `liefert ${fmt(outW)}` : "ruht";
      const ic = soc >= 95 ? "mdi:battery" : `mdi:battery-${Math.max(10, Math.round(soc / 10) * 10)}`;
      stats.push({ id: cfg.battery, icon: ic, value: `${Math.round(soc)} %`, label: "Batterie", sub });
    }
    const home = this._watts(cfg.home);
    if (home != null) stats.push({ id: cfg.home, icon: "mdi:home-lightning-bolt-outline", value: fmt(home), label: "Haus", sub: "Verbrauch" });
    const gIn = this._watts(cfg.grid_in);
    const gOut = this._watts(cfg.grid_out);
    if (gIn != null || gOut != null) {
      const feeding = (gOut || 0) > idle && (gOut || 0) >= (gIn || 0);
      const w = feeding ? gOut : gIn || 0;
      stats.push({
        id: feeding ? cfg.grid_out : cfg.grid_in,
        icon: feeding ? "mdi:transmission-tower-import" : "mdi:transmission-tower-export",
        value: w > idle ? fmt(w) : "0 W",
        label: "Netz",
        sub: w <= idle ? "ausgeglichen" : feeding ? "Einspeisung" : "Bezug",
      });
    }
    const car = this._watts(cfg.wallbox);
    if (car != null) {
      const modeSt = cfg.wallbox_mode && hass.states[cfg.wallbox_mode];
      stats.push({
        id: cfg.wallbox_mode || cfg.wallbox,
        icon: car > idle ? "mdi:ev-station" : "mdi:ev-plug-type2",
        value: car > idle ? fmt(car) : "Bereit",
        label: "Wallbox",
        sub: modeSt ? hass.formatEntityState(modeSt) : car > idle ? "lädt" : "",
      });
    }

    // Nur neu bauen, wenn sich etwas geändert hat – sonst flackert die Kachel bei jedem Update.
    const key = JSON.stringify(stats);
    if (key === tile.enKey) return;
    tile.enKey = key;
    tile.enStats.innerHTML = "";
    tile.enStats.style.setProperty("--n", String(Math.max(1, stats.length)));
    for (const s of stats) {
      const b = el("button", "en-stat");
      const top = el("div", "en-stat-top");
      top.append(icon(s.icon), el("span", "", s.label));
      b.append(top, el("div", "en-stat-value", s.value), el("div", "en-stat-sub", s.sub));
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._moreInfo(s.id);
      });
      tile.enStats.appendChild(b);
    }
  }

  _updateDoorbell(tile, st) {
    const cfg = tile.cfg;
    const ts = Date.parse(st.state);
    const typeOk = !cfg.ring_types || cfg.ring_types.includes(st.attributes.event_type);
    const age = Number.isFinite(ts) ? Date.now() - ts : Infinity;
    const ringing = typeOk && age < RING_ACTIVE_MS;
    tile.state.textContent = ringing ? "Es klingelt" : "Ruhig";
    tile.node.classList.toggle("ringing", ringing);

    // Popup nur bei einem echten neuen Klingeln: der Zustand hat sich geändert, der
    // Zeitstempel ist frisch, und der vorige Zustand war nicht „unavailable“ – so sieht ein
    // Neustart des UniFi-Controllers aus, der ein frisches Schein-Ereignis liefert
    // (home-assistant/core#174923). „unknown“ bleibt erlaubt: das ist eine Klingel, die
    // noch nie geklingelt hat. Beim ersten Laden der Seite kein Popup.
    const prev = tile.lastState;
    tile.lastState = st.state;
    if (
      prev !== undefined &&
      prev !== st.state &&
      prev !== "unavailable" &&
      typeOk &&
      age < RING_FRESH_MS
    ) {
      this._openDoorbell(cfg, true);
    }
  }

  _defaultIcon(st) {
    const domain = st.entity_id.split(".")[0];
    if (domain === "lock") return st.state === "locked" ? "mdi:door-closed-lock" : "mdi:door-open";
    if (domain === "alarm_control_panel") {
      return st.state === "disarmed" ? "mdi:shield-off-outline" : "mdi:shield-check-outline";
    }
    if (domain === "cover") return st.state === "closed" ? "mdi:window-shutter" : "mdi:window-shutter-open";
    if (domain === "media_player") return "mdi:speaker";
    if (domain === "camera") return st.attributes.icon || "mdi:cctv";
    if (domain === "light") return st.attributes.icon || (st.state === "on" ? "mdi:lightbulb-on-outline" : "mdi:lightbulb-outline");
    return st.attributes.icon || ElvioRooms.stateIcon(st.entity_id, st.attributes.device_class, st.state) || "mdi:information-outline";
  }

  _activeMode(st) {
    if (st.state !== "off") return st.state;
    return (st.attributes.hvac_modes || []).find((m) => m !== "off");
  }

  _updateClock() {
    if (!this._clock) return;
    // „Es klingelt“ läuft nach RING_ACTIVE_MS ab, auch ohne neues hass-Update.
    if (this._hass && this._tiles) {
      for (const tile of this._tiles) {
        const st = tile.cfg.type === "doorbell" && this._hass.states[tile.cfg.entity];
        if (st) this._updateDoorbell(tile, st);
      }
    }
    this._clock.textContent = new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  }

  _cameraUrl(st) {
    const pic = st.attributes.entity_picture;
    return `${pic}${pic.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }

  _refreshCameras() {
    if (!this._hass || !this._tiles) return;
    for (const tile of this._tiles) {
      if (tile.cfg.type !== "camera") continue;
      const st = this._hass.states[tile.cfg.entity];
      if (st && st.attributes.entity_picture) tile.img.src = this._cameraUrl(st);
    }
    const bg = this._config.background;
    if (bg && bg.startsWith("camera.")) {
      const st = this._hass.states[bg];
      if (st && st.attributes.entity_picture) this._bgImg.src = this._cameraUrl(st);
    }
  }

  // ───────────── Live-Karte „Läuft gerade“ ─────────────

  // Kandidaten: alle Music-Assistant-Player (erkennbar an mass_player_type) plus die
  // in media_players genannten. Gewinner: was spielt, sonst was pausiert ist, sonst der
  // zuletzt benutzte – bei Gleichstand der jüngste Zeitstempel.
  _pickPlayer() {
    const hass = this._hass;
    const extra = this._config.media_players || [];
    const candidates = Object.values(hass.states).filter(
      (st) =>
        st.entity_id.startsWith("media_player.") &&
        (st.attributes.mass_player_type !== undefined || extra.includes(st.entity_id)),
    );
    const score = (st) => {
      if (st.state === "playing") return 3;
      if (st.state === "paused" || st.state === "buffering") return 2;
      // Music Assistant meldet pausierte Browser-Player als „idle“, der Titel bleibt stehen.
      if (st.state === "idle" && st.attributes.media_title) return 1;
      return 0;
    };
    const stamp = (st) =>
      Date.parse(st.attributes.media_position_updated_at || st.last_changed || 0) || 0;
    let best = null;
    for (const st of candidates) {
      const sc = score(st);
      if (sc === 0) continue;
      if (!best || sc > best.sc || (sc === best.sc && stamp(st) > stamp(best.st))) best = { st, sc };
    }
    return best ? best.st : null;
  }

  // ───────────── Offen: Fenster, Türen, Tore ─────────────

  _openThings() {
    const hass = this._hass;
    return Object.values(hass.states).filter((st) => {
      const dc = st.attributes.device_class;
      if (st.entity_id.startsWith("binary_sensor.")) {
        return ["door", "window", "garage_door", "opening"].includes(dc) && st.state === "on";
      }
      if (st.entity_id.startsWith("cover.")) {
        return ["garage", "door", "gate"].includes(dc) && st.state === "open";
      }
      return false;
    });
  }

  _openOpenThings() {
    this._editMode = "open";
    this._editActions.replaceChildren();
    this._editWrap.hidden = false;
    this._editMsg.hidden = true;
    this._editTitle.textContent = "Offen";
    this._editHint.textContent = "Fenster, Türen und Tore, die gerade offen stehen. Antippen zeigt den Verlauf.";
    const list = this._editList;
    list.innerHTML = "";
    for (const st of this._openThings()) {
      const row = el("button", "erow epick");
      const ic = el("div", "eicon");
      ic.appendChild(icon(this._defaultIcon(st)));
      const txt = el("div", "etext");
      txt.append(el("div", "sname", st.attributes.friendly_name), el("div", "ssub", this._hass.formatEntityState(st)));
      row.append(ic, txt);
      row.addEventListener("click", () => this._moreInfo(st.entity_id));
      list.appendChild(row);
    }
  }

  // ───────────── Wetter ─────────────

  _updateWeather(tile) {
    const hass = this._hass;
    const st = hass.states[tile.cfg.entity];
    if (!st) {
      tile.name.textContent = tile.cfg.name || "Wetter";
      tile.state.textContent = "Nicht gefunden";
      tile.node.classList.add("missing");
      return;
    }
    const COND = {
      "clear-night": ["Klar", "mdi:weather-night"], cloudy: ["Bewölkt", "mdi:weather-cloudy"], fog: ["Nebel", "mdi:weather-fog"],
      hail: ["Hagel", "mdi:weather-hail"], lightning: ["Gewitter", "mdi:weather-lightning"], "lightning-rainy": ["Gewitter", "mdi:weather-lightning-rainy"],
      partlycloudy: ["Teils bewölkt", "mdi:weather-partly-cloudy"], pouring: ["Starkregen", "mdi:weather-pouring"], rainy: ["Regen", "mdi:weather-rainy"],
      snowy: ["Schnee", "mdi:weather-snowy"], "snowy-rainy": ["Schneeregen", "mdi:weather-snowy-rainy"], sunny: ["Sonnig", "mdi:weather-sunny"],
      windy: ["Windig", "mdi:weather-windy"], "windy-variant": ["Windig", "mdi:weather-windy-variant"], exceptional: ["Unwetter", "mdi:alert-outline"],
    };
    const [label, ic] = COND[st.state] || [hass.formatEntityState(st), "mdi:weather-partly-cloudy"];
    tile.icon.setAttribute("icon", ic);
    const t = st.attributes.temperature;
    tile.name.textContent = tile.cfg.name || "Wetter";
    tile.state.textContent = [t != null ? `${Math.round(t)}°` : null, label, tile.rainText].filter(Boolean).join(" · ");
    // Stundenvorhersage alle 15 min: „Regen ab 15 Uhr“, sonst nichts.
    if (Date.now() - tile.rainFetched > 15 * 60 * 1000) {
      tile.rainFetched = Date.now();
      hass
        .callWS({
          type: "call_service", domain: "weather", service: "get_forecasts",
          service_data: { type: "hourly" }, target: { entity_id: st.entity_id }, return_response: true,
        })
        .then((res) => {
          const hours = ((res && res.response && res.response[st.entity_id]) || {}).forecast || [];
          const wet = hours.slice(0, 6).find((h) => (h.precipitation || 0) > 0 || (h.precipitation_probability || 0) >= 60);
          tile.rainText = wet ? `Regen ab ${new Date(wet.datetime).getHours()} Uhr` : "";
          this._updateWeather(tile);
        })
        .catch(() => {
          tile.rainText = ""; // ohne Stundenvorhersage (Anbieter kann es nicht) nur der Zustand
        });
    }
  }

  // ───────────── Automationen ─────────────
  // Jede Automation entsteht aus einer Vorlage (Blueprint) mit den Vorgaben aus tablet.yaml
  // und ist danach eine normale HA-Automation: hier ein/aus, bearbeiten in HA, Updates
  // von uns fassen sie nicht an.

  _openAutomations(cfg) {
    this._autoCfg = cfg;
    this._editMode = "automations";
    this._editWrap.hidden = false;
    this._editMsg.hidden = true;
    this._renderAutomations();
  }

  _renderAutomations() {
    const cfg = this._autoCfg;
    if (!cfg || this._editWrap.hidden) return;
    const hass = this._hass;
    const isAdmin = !!(hass.user && hass.user.is_admin);
    this._editTitle.textContent = cfg.name || "Automationen";
    this._editHint.textContent = isAdmin
      ? "Ein-/ausschalten hier; ändern oder neue bauen in Home Assistant (Einstellungen → Automationen)."
      : "Ein- und ausschalten. Ändern oder neue bauen geht mit Admin-Anmeldung.";
    const list = this._editList;
    list.innerHTML = "";
    const all = Object.values(hass.states)
      .filter((st) => st.entity_id.startsWith("automation.") && st.state !== "unavailable")
      .sort((a, b) => (a.attributes.friendly_name || "").localeCompare(b.attributes.friendly_name || "", "de"));
    const have = new Set(all.map((st) => st.attributes.id));
    this._editActions.replaceChildren();
    if (isAdmin) {
      const neu = el("button", "stextbtn", "Neue Automation");
      neu.addEventListener("click", () => this._goHa("/config/automation/edit/new"));
      this._editActions.appendChild(neu);
    }
    if (all.length) list.appendChild(el("div", "esub", "Eingerichtet"));
    for (const st of all) {
      const row = el("div", "erow");
      const ic = el("div", "eicon");
      ic.appendChild(icon(st.attributes.icon || "mdi:robot-outline"));
      const txt = el("div", "etext");
      const last = st.attributes.last_triggered ? `zuletzt ${this._ago(st.attributes.last_triggered)}` : "noch nie ausgelöst";
      txt.append(el("div", "sname", st.attributes.friendly_name), el("div", "ssub", st.state === "on" ? last : "Aus"));
      row.append(ic, txt);
      if (isAdmin && st.attributes.id) {
        const edit = el("button", "stextbtn emove", "Bearbeiten");
        edit.addEventListener("click", () => this._goHa(`/config/automation/edit/${st.attributes.id}`));
        row.appendChild(edit);
      }
      const sw = el("button", "lswitch");
      sw.classList.toggle("on", st.state === "on");
      sw.addEventListener("click", () =>
        hass.callService("automation", st.state === "on" ? "turn_off" : "turn_on", { entity_id: st.entity_id }),
      );
      row.appendChild(sw);
      list.appendChild(row);
    }
    const todo = (cfg.templates || []).filter((t) => !have.has(t.id));
    if (todo.length) {
      list.appendChild(el("div", "esub", "Vorlagen"));
      for (const t of todo) {
        const row = el("div", "erow");
        const ic = el("div", "eicon");
        ic.appendChild(icon(t.icon || "mdi:plus-circle-outline"));
        const txt = el("div", "etext");
        txt.append(el("div", "sname", t.name), el("div", "ssub", t.description || ""));
        row.append(ic, txt);
        if (isAdmin) {
          const b = el("button", "stextbtn", "Anlegen");
          b.addEventListener("click", () => this._createAutomation(t, b));
          row.appendChild(b);
        }
        list.appendChild(row);
      }
    }
  }

  _ago(iso) {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return "gerade eben";
    if (min < 60) return `vor ${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `vor ${h} h`;
    return `vor ${Math.round(h / 24)} Tagen`;
  }

  async _createAutomation(t, button) {
    this._editMsg.hidden = true;
    button.disabled = true;
    button.textContent = "Lege an …";
    try {
      await this._hass.callApi("POST", `config/automation/config/${t.id}`, {
        alias: t.name,
        description: t.description || "",
        use_blueprint: { path: t.blueprint, input: t.input || {} },
      });
      // HA lädt die Automationen neu; die Liste baut sich mit dem nächsten Zustand um.
    } catch (err) {
      button.disabled = false;
      button.textContent = "Anlegen";
      const msg = (err && (err.body && err.body.message)) || (err && err.message) || String(err);
      this._editMsg.textContent = `Nicht angelegt: ${msg}`;
      this._editMsg.hidden = false;
    }
  }

  _goHa(path) {
    this._editWrap.hidden = true;
    this._confirmPath = path;
    this._confirmWrap.hidden = false;
  }

  // ───────────── Einrichtung ─────────────

  _dashPath() {
    return (this._hass && this._hass.panelUrl) || location.pathname.split("/")[1] || "lovelace";
  }

  _ensureSetup() {
    if (setupCache || setupRunning || this._setupError) return;
    this._setupState().then(
      () => this._afterSetupCheck(),
      () => this._afterSetupCheck(),
    );
  }

  _afterSetupCheck() {
    this._chipsKey = "";
    if (this._built) this._update();
  }

  async _setupState(force = false) {
    const dash = this._dashPath();
    if (!force && setupCache && setupCache.dash === dash && Date.now() - setupCache.at < SETUP_TTL_MS) return setupCache.items;
    if (setupRunning) return setupRunning;
    setupRunning = this._collectSetup(dash)
      .then((items) => {
        setupCache = { at: Date.now(), dash, items };
        this._setupError = null;
        return items;
      })
      .catch((err) => {
        this._setupError = setupErrText(err);
        throw err;
      })
      .finally(() => {
        setupRunning = null;
      });
    return setupRunning;
  }

  async _collectSetup(dash) {
    const hass = this._hass;
    const ws = (msg) => hass.callWS(msg);
    const comps = hass.config.components || [];
    const urlPath = dash === "lovelace" ? null : dash;
    const items = [];

    const store = await extensionStore(ws, comps);
    const repos = store && store.repos;
    const repo = (name) => repos && repos.find((r) => String(r.full_name || "").toLowerCase() === name.toLowerCase());

    const card = repo(SETUP_CARD_REPO);
    if (card && card.installed_version) {
      const current = card.installed_version === card.available_version;
      items.push({
        id: "card",
        icon: "mdi:update",
        name: "Raumkarte aktuell",
        sub: current ? `Version ${card.installed_version}` : `${card.installed_version} → ${card.available_version}`,
        done: current,
        run: async (step) => {
          step("Lade neue Version …");
          await store.install(card);
          return "reload";
        },
      });
    }

    if (repos) {
      const km = repo(SETUP_KIOSK_REPO);
      const dashCfg = await ws({ type: "lovelace/config", url_path: urlPath });
      const hidden = !!(dashCfg && dashCfg.kiosk_mode && dashCfg.kiosk_mode.hide_sidebar);
      const installed = !!(km && km.installed_version);
      items.push({
        id: "kiosk",
        icon: "mdi:fullscreen",
        name: "Seitenleiste ausblenden",
        sub: "Nur in diesem Dashboard (kiosk-mode). Bearbeiten mit ?disable_km an der Adresse.",
        done: installed && hidden,
        run: async (step) => {
          if (!installed) {
            if (!km) throw new Error(`kiosk-mode steht nicht im ${store.name}-Katalog`);
            step("Installiere kiosk-mode …");
            await store.install(km);
          }
          if (!hidden) {
            step("Stelle das Dashboard um …");
            const c = await ws({ type: "lovelace/config", url_path: urlPath });
            c.kiosk_mode = { ...(c.kiosk_mode || {}), hide_sidebar: true, hide_header: true };
            await ws({ type: "lovelace/config/save", url_path: urlPath, config: c });
          }
          return "reload";
        },
      });
    }

    // Systemweite Startseite gibt es erst in neueren Versionen; fehlt der Befehl, entfällt der Punkt.
    let sys = null;
    try {
      sys = await ws({ type: "frontend/get_system_data", key: "core" });
    } catch (err) {
      if (!(err && err.code === "unknown_command")) throw err;
    }
    if (sys) {
      const cur = sys.value && sys.value.default_panel;
      items.push({
        id: "start",
        icon: "mdi:home-import-outline",
        name: "Startseite für alle",
        sub: cur === dash ? "Die App öffnet mit diesem Dashboard" : "Die App soll mit diesem Dashboard öffnen",
        done: cur === dash,
        run: async () => {
          const now = await ws({ type: "frontend/get_system_data", key: "core" });
          await ws({ type: "frontend/set_system_data", key: "core", value: { ...((now && now.value) || {}), default_panel: dash } });
        },
      });
    }

    if (comps.includes("hassio")) {
      const sup = (endpoint, method = "get", data) => ws({ type: "supervisor/api", endpoint, method, data, timeout: null });
      // Unbekanntes Add-on (Store ohne MA-Repository) wirft – das heißt schlicht „nicht installiert“.
      const info = await sup(`/addons/${SETUP_MA_SLUG}/info`).catch(() => null);
      const installed = !!(info && info.version);
      const started = installed && info.state === "started";
      const linked = comps.includes("music_assistant");
      items.push({
        id: "music",
        icon: "mdi:music-box-multiple-outline",
        name: "Music Assistant",
        sub: !installed
          ? "Musik auf allen Lautsprechern, Spotify & Co."
          : !started
            ? "Installiert, läuft aber nicht"
            : !linked
              ? "Läuft, ist aber nicht mit Home Assistant verbunden"
              : !info.ingress_panel
                ? "Läuft; Knopf „Musikdienste“ braucht den Eintrag in der Seitenleiste"
                : "Läuft und ist verbunden",
        done: started && linked && !!info.ingress_panel,
        run: async (step) => {
          if (!installed) {
            const store = await sup("/store/repositories");
            if (!(store || []).some((r) => r.source === SETUP_MA_STORE)) {
              step("Füge die Add-on-Quelle hinzu …");
              await sup("/store/repositories", "post", { repository: SETUP_MA_STORE });
            }
            step("Installiere Music Assistant … (einige Minuten)");
            await sup(`/store/addons/${SETUP_MA_SLUG}/install`, "post");
          }
          const now = await sup(`/addons/${SETUP_MA_SLUG}/info`);
          if (!now.ingress_panel) await sup(`/addons/${SETUP_MA_SLUG}/options`, "post", { ingress_panel: true });
          if (now.state !== "started") {
            step("Starte Music Assistant …");
            await sup(`/addons/${SETUP_MA_SLUG}/start`, "post");
          }
          if (!(hass.config.components || []).includes("music_assistant")) {
            step("Verbinde mit Home Assistant …");
            // Das Add-on meldet sich selbst an; die Meldung muss nur bestätigt werden.
            let flow = null;
            for (let i = 0; i < 30 && !flow; i++) {
              const flows = await ws({ type: "config_entries/flow/progress" });
              flow = flows.find((f) => f.handler === "music_assistant");
              if (!flow) await new Promise((r) => setTimeout(r, 3000));
            }
            if (!flow) throw new Error("Music Assistant läuft, hat sich aber nicht bei Home Assistant gemeldet. Unter Geräte & Dienste nachsehen.");
            const res = await hass.callApi("POST", `config/config_entries/flow/${flow.flow_id}`, {});
            if (res.type !== "create_entry") throw new Error(`Verbinden nicht abgeschlossen (${res.type}${res.reason ? ": " + res.reason : ""})`);
          }
          return "reload";
        },
      });
    }

    const stations = this._fuelStations();
    if (stations.length) {
      const have = Object.values(hass.states).some(
        (st) => st.entity_id.startsWith("automation.") && /^tanken_.+_guenstig$/.test(String(st.attributes.id || "")),
      );
      items.push({
        id: "fuel",
        icon: "mdi:gas-station-outline",
        name: "Push: günstig tanken",
        sub: have ? "Eingerichtet" : `${stations.length} Tankstellen gefunden – Meldung, wenn der Preis deutlich unter dem Wochenschnitt liegt`,
        done: have,
        form: true,
      });
    }

    // Energie: Verbraucher mit eigenem Energiezähler (z. B. Shelly-Kanäle) in HA-Energie
    // eintragen. Netzzähler und Solar nicht – dafür braucht es das passende Gerät.
    if (comps.includes("energy")) {
      const prefs = await ws({ type: "energy/get_prefs" }).catch(() => null);
      const cands = this._energyCandidates(prefs);
      const have = ElvioEnergy.normalize(prefs).devices.length;
      if (cands.length || have) {
        const names = cands.slice(0, 3).map((c) => c.name).join(", ");
        items.push({
          id: "energy",
          icon: "mdi:lightning-bolt-outline",
          name: "Energie einrichten",
          sub: cands.length
            ? `${cands.length} Verbraucher in HA-Energie eintragen (${names}${cands.length > 3 ? " …" : ""}) – für die Seite „Energie“`
            : `${have} Verbraucher eingetragen`,
          done: !cands.length,
          run: async (step) => {
            step("Trage Verbraucher ein …");
            const now = await ws({ type: "energy/get_prefs" }).catch(() => null);
            const add = this._energyCandidates(now);
            const keep = (now && now.device_consumption) || [];
            try {
              await ws({ type: "energy/save_prefs", device_consumption: [...keep, ...add] });
            } catch (err) {
              // Ältere HA-Versionen kennen die Leistung je Verbraucher (stat_rate) noch nicht.
              if (!/stat_rate|extra keys/i.test(String((err && err.message) || err))) throw err;
              await ws({ type: "energy/save_prefs", device_consumption: [...keep, ...add.map(({ stat_rate, ...d }) => d)] });
            }
            energyCache = null;
            this._ensureEnergy(true);
          },
        });
      }
    }

    // Altes Dashboard (Räume in nav): auf Räume aus HA umstellen. Prüft vor jedem Schreiben,
    // sichert das Dashboard und baut erst danach um.
    if (ElvioRooms.isLegacy(this._rawConfig.nav)) {
      items.push({
        id: "rooms",
        icon: "mdi:floor-plan",
        name: "Räume aus Home Assistant",
        sub: "Räume am Tablet verwalten (anlegen, umbenennen, Bild). Das Dashboard wird vorher gesichert. Bereiche, die bisher nicht am Tablet waren, werden ausgeblendet (im Raum-Blatt wieder einblendbar).",
        done: false,
        run: (step) => this._migrateRooms(step, dash),
      });
    }
    return items;
  }

  // Tankerkönig legt je Tankstelle ein Gerät mit Preis-Sensoren an (…_super, …_super_e10, …_diesel).
  _fuelStations() {
    const hass = this._hass;
    const byDevice = new Map();
    for (const e of Object.values(hass.entities || {})) {
      if (e.platform !== "tankerkoenig" || !e.entity_id.startsWith("sensor.") || !e.device_id) continue;
      const kind = /_super_e10$/.test(e.entity_id) ? "e10" : /_super$/.test(e.entity_id) ? "e5" : /_diesel$/.test(e.entity_id) ? "diesel" : null;
      if (!kind) continue;
      const dev = (hass.devices || {})[e.device_id] || {};
      const st = byDevice.get(e.device_id) || { name: dev.name_by_user || dev.name || e.device_id };
      st[kind] = e.entity_id;
      byDevice.set(e.device_id, st);
    }
    return [...byDevice.values()];
  }

  _openSetup() {
    this._editMode = "setup";
    this._editWrap.hidden = false;
    this._editMsg.hidden = true;
    this._editTitle.textContent = "Einrichtung";
    this._renderSetup();
    if (this._hass.user && this._hass.user.is_admin) {
      this._setupState(true).then(
        () => this._renderSetup(),
        () => this._renderSetup(),
      );
    }
  }

  _renderSetup() {
    if (this._editMode !== "setup" || this._editWrap.hidden) return;
    const isAdmin = !!(this._hass.user && this._hass.user.is_admin);
    this._editHint.textContent = isAdmin
      ? "Funktionen, die zur Raumkarte gehören. Jeder Schritt läuft nur, wenn du ihn antippst."
      : "Einrichten geht nur mit Admin-Anmeldung.";
    this._editActions.replaceChildren();
    const list = this._editList;
    list.innerHTML = "";
    if (!isAdmin) return;
    const again = el("button", "stextbtn", "Neu prüfen");
    again.addEventListener("click", () => this._openSetup());
    this._editActions.appendChild(again);
    // Eine Meldung aus einer früheren, fehlgeschlagenen Prüfung darf nicht stehen bleiben.
    this._editMsg.hidden = !this._setupError;
    if (this._setupError) this._editMsg.textContent = `Prüfung fehlgeschlagen: ${this._setupError}`;
    if (!setupCache) {
      list.appendChild(el("div", "ag-empty", "Wird geprüft …"));
      return;
    }
    for (const item of setupCache.items) {
      const row = el("div", "erow");
      const ic = el("div", "eicon");
      ic.appendChild(icon(item.icon));
      const txt = el("div", "etext");
      txt.append(el("div", "sname", item.name), el("div", "ssub", item.sub || ""));
      row.append(ic, txt);
      if (item.done) {
        const ok = el("div", "sdone");
        ok.appendChild(icon("mdi:check-circle"));
        row.appendChild(ok);
      } else {
        const b = el("button", "stextbtn", "Einrichten");
        b.addEventListener("click", () => (item.form ? this._renderFuelSetup() : this._runSetup(item, b, txt)));
        row.appendChild(b);
      }
      list.appendChild(row);
    }
    if (!setupCache.items.length) list.appendChild(el("div", "ag-empty", "Hier gibt es nichts einzurichten."));
  }

  async _runSetup(item, button, txt) {
    this._editMsg.hidden = true;
    button.disabled = true;
    const sub = txt.querySelector(".ssub");
    const step = (msg) => {
      button.textContent = "Läuft …";
      sub.textContent = msg;
    };
    step("Starte …");
    try {
      const res = await item.run(step);
      setupCache = null;
      if (res === "reload") {
        sub.textContent = "Fertig – die Seite lädt neu.";
        setTimeout(() => location.reload(), 1500);
        return;
      }
      await this._setupState(true);
      this._renderSetup();
      this._afterSetupCheck();
    } catch (err) {
      button.disabled = false;
      button.textContent = "Einrichten";
      sub.textContent = item.sub || "";
      this._editMsg.textContent = `${item.name}: ${setupErrText(err)}`;
      this._editMsg.hidden = false;
    }
  }

  async _migrateRooms(step, dash) {
    const hass = this._hass;
    const ws = (msg) => hass.callWS(msg);
    const urlPath = dash === "lovelace" ? null : dash;

    step("Prüfe das Dashboard …");
    const dashboards = await ws({ type: "lovelace/dashboards/list" });
    const meta = dashboards.find((d) => d.url_path === dash);
    // Das Standard-Dashboard steht nicht in der Liste (und lovelace/info nennt nur den Ressourcen-Modus);
    // dessen Modus steht im Panel von hass.
    const panel = (hass.panels || {})[dash];
    if ((meta && meta.mode === "yaml") || (panel && panel.config && panel.config.mode === "yaml")) throw new Error("YAML-Dashboard – bitte von Hand umstellen (README: Räume aus Home Assistant)");
    const config = await ws({ type: "lovelace/config", url_path: urlPath });
    const plan = ElvioRooms.migrationPlan(config, {
      resolveArea: (k) => this._resolveArea(k),
      entityArea: (id) => this._entityArea((hass.entities || {})[id]),
      // Was die Automatik im neuen Modus einsammelt (_areaEntities): nicht versteckt, nicht technisch, mit Zustand.
      isCollected: (id) => {
        const e = (hass.entities || {})[id];
        return !!(e && !e.hidden && !e.entity_category && hass.states[id]);
      },
      // Nur so einen Sensor nimmt HA als Temperatur eines Bereichs.
      isTemperatureSensor: (id) => {
        const st = hass.states[id];
        return String(id).startsWith("sensor.") && !!(st && st.attributes && st.attributes.device_class === "temperature");
      },
      areaName: (areaId) => {
        const a = (hass.areas || {})[areaId];
        return a ? a.name : undefined;
      },
    });
    if (plan.blocked.length) {
      throw new Error(`nicht umgestellt – ${plan.blocked.map((b) => `${b.room}: ${b.reason}`).join("; ")}`);
    }

    // Sicherung zuerst: Erst wenn die Kopie gespeichert ist, wird irgendetwas geändert.
    step("Sichere das Dashboard …");
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const taken = new Set(dashboards.map((d) => d.url_path));
    const stem = `${dash === "lovelace" ? "uebersicht" : dash}-sicherung-${stamp}`;
    let backup = stem;
    for (let i = 2; taken.has(backup); i++) backup = `${stem}-${i}`;
    const backupTitle = `${(meta && meta.title) || "Dashboard"} (Sicherung ${now.toLocaleDateString("de-DE")})`;
    const backupDash = await ws({
      type: "lovelace/dashboards/create",
      url_path: backup,
      title: backupTitle,
      icon: "mdi:content-save-outline",
      show_in_sidebar: false,
      require_admin: true,
      mode: "storage",
    });
    try {
      await ws({ type: "lovelace/config/save", url_path: backup, config });
    } catch (err) {
      // Eine leere Sicherung wäre trügerisch: lieber wieder entfernen.
      await ws({ type: "lovelace/dashboards/delete", dashboard_id: backupDash.id }).catch(() => null);
      throw err;
    }

    try {
      step("Übernehme die Räume …");
      for (const room of plan.rooms) {
        if (!room.areaId) {
          const made = await ws({
            type: "config/area_registry/create",
            name: room.name,
            icon: room.icon || undefined,
            picture: room.image || undefined,
            temperature_entity_id: room.temperature || undefined,
          });
          room.areaId = made.area_id;
          continue;
        }
        const { temperature_entity_id, ...patch } = ElvioRooms.areaPatch((hass.areas || {})[room.areaId] || {}, room);
        if (Object.keys(patch).length) await ws({ type: "config/area_registry/update", area_id: room.areaId, ...patch });
        // Geprüft ist vorher, dass es ein Temperatursensor ist. Lehnt HA ihn trotzdem ab, bricht die
        // Umstellung ab und die Meldung nennt die Sicherung – die Temperatur ginge sonst still verloren.
        if (temperature_entity_id) {
          await ws({ type: "config/area_registry/update", area_id: room.areaId, temperature_entity_id });
        }
      }

      const areas = await ws({ type: "config/area_registry/list" });
      const hide = ElvioRooms.areasToHide(areas, plan.rooms.map((r) => r.areaId), LABEL_HIDE.id);
      if (hide.length) {
        step("Blende Bereiche aus, die nicht am Tablet waren …");
        await this._ensureLabels();
        for (const a of areas.filter((x) => hide.includes(x.area_id))) {
          await ws({ type: "config/area_registry/update", area_id: a.area_id, labels: [...(a.labels || []), LABEL_HIDE.id] });
        }
      }

      step("Sortiere die Räume …");
      const all = areas.map((a) => a.area_id);
      await ws({ type: "config/area_registry/reorder", area_ids: ElvioRooms.orderFirst(all, plan.rooms.map((r) => r.areaId)) });

      step("Baue das Dashboard um …");
      await ws({ type: "lovelace/config/save", url_path: urlPath, config: plan.config });
    } catch (err) {
      throw new Error(
        `${setupErrText(err)} – die Sicherung liegt unter „${backupTitle}“ (Einstellungen → Dashboards). Bereiche sind evtl. schon ergänzt; erneut „Einrichten“ ist gefahrlos.`,
      );
    }
    return "reload";
  }

  _renderFuelSetup() {
    const hass = this._hass;
    this._editTitle.textContent = "Push: günstig tanken";
    this._editHint.textContent =
      "Meldung aufs Handy, wenn der günstigste Preis der Tankstellen mindestens 3 ct unter dem Schnitt der letzten 7 Tage liegt – höchstens einmal am Tag, 6–21 Uhr. Die erste kommt frühestens nach 2 Tagen.";
    this._editMsg.hidden = true;
    const list = this._editList;
    list.innerHTML = "";
    const chosen = { kinds: new Set(), targets: new Set() };
    const toggleRow = (label, sub, set, key) => {
      const row = el("div", "erow");
      const txt = el("div", "etext");
      txt.append(el("div", "sname", label), el("div", "ssub", sub || ""));
      const sw = el("button", "lswitch");
      sw.addEventListener("click", () => {
        if (set.has(key)) set.delete(key);
        else set.add(key);
        sw.classList.toggle("on", set.has(key));
      });
      row.append(txt, sw);
      list.appendChild(row);
    };
    const stations = this._fuelStations();
    list.appendChild(el("div", "esub", "Sorte"));
    for (const k of FUEL_KINDS) {
      if (stations.some((st) => st[k.key])) toggleRow(k.label, "", chosen.kinds, k.key);
    }
    list.appendChild(el("div", "esub", "Empfänger"));
    const targets = Object.keys((hass.services && hass.services.notify) || {}).filter((n) => n.startsWith("mobile_app_"));
    const devName = (svc) => {
      const slug = svc.replace(/^mobile_app_/, "");
      const dev = Object.values(hass.devices || {}).find(
        (d) => String(d.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") === slug,
      );
      return dev ? dev.name_by_user || dev.name : slug;
    };
    for (const t of targets) toggleRow(devName(t), t, chosen.targets, t);
    if (!targets.length) list.appendChild(el("div", "ag-empty", "Kein Handy mit der Home-Assistant-App gefunden."));
    this._editActions.replaceChildren();
    const back = el("button", "stextbtn emove", "Zurück");
    back.addEventListener("click", () => this._openSetup());
    const go = el("button", "stextbtn", "Anlegen");
    go.addEventListener("click", async () => {
      if (!chosen.kinds.size || !chosen.targets.size) {
        this._editMsg.textContent = "Bitte mindestens eine Sorte und einen Empfänger wählen.";
        this._editMsg.hidden = false;
        return;
      }
      this._editMsg.hidden = true;
      go.disabled = true;
      go.textContent = "Lege an …";
      try {
        await this._createFuelPush(stations, [...chosen.kinds], [...chosen.targets]);
        setupCache = null;
        this._openSetup();
      } catch (err) {
        go.disabled = false;
        go.textContent = "Anlegen";
        this._editMsg.textContent = `Nicht angelegt: ${setupErrText(err)}`;
        this._editMsg.hidden = false;
      }
    });
    this._editActions.append(back, go);
  }

  async _createFuelPush(stations, kinds, targets) {
    const hass = this._hass;
    const flow = async (handler, steps) => {
      let f = await hass.callApi("POST", "config/config_entries/flow", { handler });
      for (const data of steps) {
        if (f.type === "create_entry") break;
        f = await hass.callApi("POST", `config/config_entries/flow/${f.flow_id}`, data);
        if (f.errors && Object.keys(f.errors).length) throw new Error(`${handler}: ${JSON.stringify(f.errors)}`);
      }
      if (f.type !== "create_entry") throw new Error(`${handler}: nicht abgeschlossen (${f.type})`);
      const reg = await hass.callWS({ type: "config/entity_registry/list" });
      const ent = reg.find((e) => e.config_entry_id === f.result.entry_id);
      if (!ent) throw new Error(`${handler}: Sensor nicht gefunden`);
      return ent.entity_id;
    };
    for (const kind of kinds) {
      const label = (FUEL_KINDS.find((k) => k.key === kind) || {}).label || kind;
      const ids = stations.filter((st) => st[kind]);
      const list = ids.map((st) => `states('${st[kind]}')|float(none)`).join(", ");
      const cheap = await flow("template", [
        { next_step_id: "sensor" },
        {
          name: `Günstigster ${label}`,
          state: `{% set p = [${list}] | reject('none') | list %}{{ (p | min) if p | count > 0 else none }}`,
          unit_of_measurement: "€/L",
        },
      ]);
      const mean = await flow("statistics", [
        { name: `${label} Mittel 7 Tage`, entity_id: cheap },
        { state_characteristic: "mean" },
        { max_age: { days: 7, hours: 0, minutes: 0, seconds: 0 }, precision: 3, keep_last_sample: true },
      ]);
      const names = "{" + ids.map((st) => `'${st[kind]}': ${JSON.stringify(st.name)}`).join(", ") + "}";
      const id = `tanken_${kind}_guenstig`;
      await hass.callApi("POST", `config/automation/config/${id}`, {
        id,
        alias: `Tanken: ${label} günstig`,
        description: `Push, wenn ${label} mindestens 3 ct unter dem 7-Tage-Schnitt des günstigsten Preises liegt. Höchstens einmal am Tag, 6–21 Uhr, erst ab 2 Tagen Verlauf.`,
        mode: "single",
        triggers: [{ trigger: "state", entity_id: cheap }],
        conditions: [
          { condition: "time", after: "06:00:00", before: "21:00:00" },
          { condition: "template", value_template: `{{ (state_attr('${mean}','age_coverage_ratio') or 0) >= 0.3 }}` },
          {
            condition: "template",
            value_template: `{% set p = states('${cheap}')|float(none) %}{% set m = states('${mean}')|float(none) %}{{ p is not none and m is not none and p <= m - 0.03 }}`,
          },
          {
            condition: "template",
            value_template: "{% set l = this.attributes.last_triggered %}{{ l is none or as_local(l).date() < now().date() }}",
          },
        ],
        actions: [
          {
            variables: {
              preis: `{{ states('${cheap}')|float }}`,
              schnitt: `{{ states('${mean}')|float }}`,
              tankstelle: `{% set m = ${names} %}{% set ns = namespace(n='') %}{% for e, n in m.items() %}{% if states(e)|float(99) == states('${cheap}')|float %}{% set ns.n = ns.n ~ (', ' if ns.n else '') ~ n %}{% endif %}{% endfor %}{{ ns.n }}`,
            },
          },
          ...targets.map((t) => ({
            action: `notify.${t}`,
            continue_on_error: true,
            data: {
              title: `${label} günstig`,
              message: "{{ '%.3f'|format(preis)|replace('.',',') }} € bei {{ tankstelle }} – {{ ((schnitt - preis) * 100)|round(0)|int }} ct unter dem 7-Tage-Schnitt.",
              data: { url: `/${this._dashPath()}`, group: "tanken" },
            },
          })),
        ],
      });
    }
  }

  // ───────────── Raum des Tablets & Musik je Raum ─────────────

  _tabletRoom() {
    try {
      return window.localStorage.getItem(TABLET_ROOM_KEY) || null;
    } catch (err) {
      return null; // privates Fenster o. Ä.: dann eben ohne festen Raum
    }
  }

  // Gespeichert wird die Bereichs-ID (bleibt beim Umbenennen gleich). Ältere Einträge mit dem
  // Raumnamen werden weiter erkannt.
  _tabletRoomArea() {
    const v = this._tabletRoom();
    if (!v) return null;
    return this._hass.areas && this._hass.areas[v] ? v : this._resolveArea(v);
  }

  _setTabletRoom(value) {
    try {
      if (value) window.localStorage.setItem(TABLET_ROOM_KEY, value);
      else window.localStorage.removeItem(TABLET_ROOM_KEY);
    } catch (err) {
      this._editMsg.textContent = `Nicht gespeichert: ${err.message || err}`;
      this._editMsg.hidden = false;
      return;
    }
    this._editWrap.hidden = true;
    this._update();
  }

  _openTabletRoom() {
    this._editMode = "tablet_room";
    this._editActions.replaceChildren();
    this._editWrap.hidden = false;
    this._editMsg.hidden = true;
    this._editTitle.textContent = "Wo hängt dieses Tablet?";
    this._editHint.textContent =
      "Die Live-Karte bei Musik zeigt dann diesen Raum. Gilt nur für dieses Gerät, nicht für Handys oder andere Tablets.";
    const list = this._editList;
    list.innerHTML = "";
    const cur = this._tabletRoomArea();
    const rooms = this._rooms().filter((r) => r.areaId);
    for (const r of [...rooms, { areaId: null, name: null, icon: "mdi:cellphone" }]) {
      const row = el("button", "erow epick");
      const ic = el("div", "eicon");
      ic.appendChild(icon(r.icon || "mdi:door"));
      row.append(ic, el("div", "etext sname", r.name || "Nirgends (Handy, unterwegs)"));
      if ((r.areaId || null) === cur) {
        row.classList.add("current");
        row.appendChild(el("div", "ssub", "gewählt"));
      }
      row.addEventListener("click", () => this._setTabletRoom(r.areaId));
      list.appendChild(row);
    }
  }

  // Räume mit Lautsprecher: Player (Music Assistant oder media_players), deren HA-Bereich
  // zu einem Raum aus `nav` gehört. Je Raum der Player, auf dem am ehesten etwas läuft.
  _musicRooms() {
    const hass = this._hass;
    const extra = this._config.media_players || [];
    const players = Object.values(hass.states).filter(
      (st) =>
        st.entity_id.startsWith("media_player.") &&
        st.state !== "unavailable" &&
        (st.attributes.mass_player_type !== undefined || extra.includes(st.entity_id)),
    );
    const rank = (st) =>
      st.state === "playing" ? 3 : st.state === "paused" || st.state === "buffering" ? 2 : st.attributes.mass_player_type !== undefined ? 1 : 0;
    const out = [];
    for (const room of this._rooms()) {
      const areaId = room.areaId;
      if (!areaId) continue;
      const mine = players.filter((st) => this._entityArea(hass.entities && hass.entities[st.entity_id]) === areaId);
      if (!mine.length) continue;
      mine.sort((x, y) => rank(y) - rank(x));
      out.push({ name: room.name, icon: room.icon, areaId, st: mine[0] });
    }
    return out;
  }

  _updateNowPlaying(tile) {
    const rooms = this._musicRooms();
    const wanted = this._tabletRoomArea();
    const room = wanted ? rooms.find((r) => r.areaId === wanted) : null;
    // Raum des Tablets: dessen Player, auch wenn dort nichts läuft. Sonst wie bisher: was
    // gerade irgendwo läuft.
    const st = room ? room.st : this._pickPlayer();
    const shownRoom = room || rooms.find((r) => st && r.st.entity_id === st.entity_id) || null;
    tile.areaId = shownRoom ? shownRoom.areaId : null;
    this._renderRoomChips(rooms, shownRoom);
    tile.entityId = st ? st.entity_id : null;
    tile.active =
      !!st && (["playing", "paused", "buffering"].includes(st.state) || (st.state === "idle" && !!st.attributes.media_title));
    tile.node.classList.toggle("idle", !tile.active);
    if (!tile.active) {
      tile.player.textContent = shownRoom ? shownRoom.name : "Musik";
      tile.title.textContent = shownRoom ? "Hier läuft gerade nichts" : "Gerade läuft nichts";
      tile.artist.textContent = shownRoom ? "Antippen, um Musik für diesen Raum zu suchen" : "Antippen für Bibliothek & Suche";
      tile.cover.removeAttribute("src");
      tile.progressEl.hidden = true;
      return;
    }
    const a = st.attributes;
    const playing = st.state === "playing";
    tile.player.textContent = `${playing ? "Läuft" : "Pausiert"} · ${shownRoom ? shownRoom.name : a.friendly_name}`;
    tile.title.textContent = a.media_title || this._hass.formatEntityState(st);
    tile.artist.textContent = [a.media_artist, a.media_album_name].filter(Boolean).join(" · ");
    if (a.entity_picture) {
      if (tile.cover.getAttribute("src") !== a.entity_picture) tile.cover.src = a.entity_picture;
    } else {
      tile.cover.removeAttribute("src");
    }
    tile.play.ic.setAttribute("icon", playing ? "mdi:pause" : "mdi:play");
    // Räume wechseln geht nur mit Music-Assistant-Playern.
    tile.roomBtn.hidden = a.mass_player_type === undefined;
    // Vor/Zurück nur zeigen, wenn der Player es kann (supported_features: 16/32).
    const feat = a.supported_features || 0;
    tile.prev.b.hidden = !(feat & 16);
    tile.next.b.hidden = !(feat & 32);
    tile.progressEl.hidden = !(a.media_duration > 0);
    this._renderProgress(tile, st);
  }

  // Die anderen Räume als Chips (wie Personen/Musik auf „Zuhause“): Cover, wenn dort
  // etwas läuft, sonst Raumsymbol. Tipp öffnet den Player dieses Raums (Lautstärke, Quelle,
  // Gruppieren) – läuft dort nichts, die Suche für diesen Raum.
  _renderRoomChips(rooms, shownRoom) {
    if (!this._roomChips) return;
    const others = rooms
      .filter((r) => !shownRoom || r.name !== shownRoom.name)
      .map((r) => {
        const a = r.st.attributes;
        const on = ["playing", "paused", "buffering"].includes(r.st.state);
        return {
          name: r.name,
          entityId: r.st.entity_id,
          areaId: r.areaId,
          active: on,
          icon: r.icon || "mdi:speaker",
          picture: on ? a.entity_picture : null,
          sub: on ? [r.st.state === "playing" ? null : "Pausiert", a.media_title].filter(Boolean).join(" · ") : "Ruhig",
        };
      });
    const key = JSON.stringify(others);
    if (key === this._roomChipsKey) return;
    this._roomChipsKey = key;
    this._roomChips.innerHTML = "";
    this._roomChips.hidden = !others.length;
    for (const r of others) {
      const node = el("button", "chip room");
      const av = el("div", "av");
      if (r.picture) {
        const img = el("img");
        img.src = r.picture;
        img.alt = "";
        av.appendChild(img);
      } else {
        av.appendChild(icon(r.icon));
      }
      const txt = el("div", "txt");
      txt.append(el("b", "", r.name), el("span", "", r.sub));
      node.append(av, txt);
      node.addEventListener("click", () =>
        r.active ? this._openMedia(r.entityId) : this._openSearch(r.areaId),
      );
      this._roomChips.appendChild(node);
    }
  }

  _renderProgress(tile, st) {
    const a = st.attributes;
    const dur = Number(a.media_duration) || 0;
    if (!dur) return;
    let pos = Number(a.media_position) || 0;
    if (st.state === "playing" && a.media_position_updated_at) {
      pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    }
    pos = Math.max(0, Math.min(pos, dur));
    const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
    tile.elapsed.textContent = fmt(pos);
    tile.duration.textContent = fmt(dur);
    tile.bar.style.width = `${(pos / dur) * 100}%`;
  }

  _tickProgress() {
    this._tickPlayer();
    if (!this._hass || !this._tiles) return;
    for (const tile of this._tiles) {
      if (tile.cfg.type !== "now_playing" || !tile.entityId) continue;
      const st = this._hass.states[tile.entityId];
      if (st && st.state === "playing") this._renderProgress(tile, st);
    }
  }

  // ───────────── Fernseher ─────────────

  _updateTv(tile, st) {
    const a = st.attributes;
    const off = st.state === "off" || st.state === "standby";
    tile.tvName.textContent = tile.cfg.name || a.friendly_name;
    tile.tvTitle.textContent = off
      ? "Aus"
      : [a.media_title, a.media_series_title || a.app_name || a.source].filter(Boolean).join(" · ") ||
        this._hass.formatEntityState(st);
    tile.node.classList.toggle("off", off);
    tile.power.classList.toggle("on", !off);
    for (const b of tile.vol) b.hidden = off;
    const pic = off ? null : a.entity_picture;
    if (pic) {
      if (tile.art.getAttribute("src") !== pic) tile.art.src = pic;
    } else {
      tile.art.removeAttribute("src");
    }
    // App-Knöpfe auch im Aus-Zustand (viele Fernseher melden ihre Liste weiter): Tipp schaltet
    // ein und startet die App. Nur neu bauen, wenn sich Liste oder Quelle ändern (kein Flackern).
    const apps = tile.cfg.apps || a.source_list || [];
    const key = JSON.stringify([apps, off ? null : a.source]);
    if (key === tile.appsKey) return;
    tile.appsKey = key;
    tile.apps.innerHTML = "";
    for (const app of apps) {
      const chip = el("button", "schip", app);
      chip.classList.toggle("active", !off && app === a.source);
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        this._tvStart(tile.cfg.entity, app);
      });
      tile.apps.appendChild(chip);
    }
  }

  // Ist der Fernseher aus: erst einschalten, dann die App wählen, sobald er an ist (max. 20 s).
  async _tvStart(entity, source) {
    const isOff = () => {
      const s = this._hass && this._hass.states[entity];
      return !s || s.state === "off" || s.state === "standby" || s.state === "unavailable";
    };
    if (isOff()) {
      await this._hass.callService("media_player", "turn_on", { entity_id: entity });
      for (let i = 0; i < 40 && isOff(); i++) await new Promise((r) => setTimeout(r, 500));
      if (isOff()) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    this._hass.callService("media_player", "select_source", { entity_id: entity, source });
  }

  // ───────────── Termine ─────────────

  _updateAgenda(tile) {
    // Kalender-Entitäten melden nur den nächsten Termin; die Liste kommt über
    // calendar.get_events. Neu holen, wenn ein Kalender sich ändert oder die Zeit um ist.
    const calKey = tile.cfg.entities
      .map((id) => (this._hass.states[id] ? this._hass.states[id].last_changed : ""))
      .join("|");
    const due = Date.now() - tile.fetched > AGENDA_REFRESH_MS;
    if (tile.loading || (!due && calKey === tile.calKey)) return;
    tile.calKey = calKey;
    this._fetchAgenda(tile);
  }

  async _fetchAgenda(tile) {
    const cfg = tile.cfg;
    tile.loading = true;
    try {
      const res = await this._hass.callService(
        "calendar",
        "get_events",
        { start_date_time: new Date().toISOString(), duration: { days: cfg.days || 7 } },
        { entity_id: cfg.entities },
        false,
        true,
      );
      const resp = res.response || {};
      const events = [];
      cfg.entities.forEach((id, i) => {
        for (const ev of (resp[id] && resp[id].events) || []) {
          events.push({ ...ev, color: AGENDA_COLORS[i % AGENDA_COLORS.length], cal: id });
        }
      });
      events.sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
      this._renderAgenda(tile, events.slice(0, cfg.max || 4));
      tile.fetched = Date.now();
    } catch (err) {
      tile.list.innerHTML = "";
      tile.list.appendChild(el("div", "ag-empty", `Termine nicht ladbar: ${err.message || err.code || err}`));
      // Beim nächsten Update erneut versuchen, nicht erst in 5 Minuten.
      tile.fetched = 0;
    } finally {
      tile.loading = false;
    }
  }

  _renderAgenda(tile, events) {
    tile.list.innerHTML = "";
    if (!events.length) {
      tile.list.appendChild(el("div", "ag-empty", `Keine Termine in den nächsten ${tile.cfg.days || 7} Tagen`));
      return;
    }
    const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
    const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const ev of events) {
      // Ganztägige Termine kommen als reines Datum („2026-10-08“) ohne Uhrzeit.
      const allDay = !String(ev.start).includes("T");
      const start = allDay ? new Date(`${ev.start}T00:00:00`) : new Date(ev.start);
      const d0 = new Date(start);
      d0.setHours(0, 0, 0, 0);
      const diff = Math.round((d0 - today) / 86400000);
      const day = diff <= 0 ? "Heute" : diff === 1 ? "Morgen" : dayFmt.format(start);
      const row = el("div", "ag-row");
      const dot = el("span", "ag-dot");
      dot.style.background = ev.color;
      const when = el("div", "ag-when");
      when.append(el("b", "", day), el("span", "", allDay ? "Ganztägig" : timeFmt.format(start)));
      const what = el("div", "ag-what");
      what.append(el("div", "ag-title", ev.summary || "Termin"), el("div", "ag-sub", ev.location || ""));
      row.append(dot, when, what);
      tile.list.appendChild(row);
    }
  }

  // ───────────── Spritpreise ─────────────

  _updateFuel(tile) {
    if (!tile.loading && Date.now() - tile.fetched > FUEL_REFRESH_MS) this._fetchFuel(tile);
    const ids = tile.cfg.stations.map((st) => st[tile.kind]).filter(Boolean);
    // Nur neu zeichnen, wenn sich Sorte, ein Preis oder der Verlauf geändert hat – sonst
    // baut jede fremde Zustandsänderung die Liste neu auf.
    const key = [tile.kind, tile.fetched, ...ids.map((id) => (this._hass.states[id] || {}).state)].join("|");
    if (key === tile.fuelKey) return;
    tile.fuelKey = key;
    this._renderFuel(tile);
  }

  async _fetchFuel(tile) {
    const ids = tile.cfg.stations.flatMap((st) => FUEL_KINDS.map((k) => st[k.key]).filter(Boolean));
    tile.loading = true;
    try {
      const hours = tile.cfg.hours || 48;
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - hours * 3600000).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const history = {};
      for (const id of ids) {
        history[id] = (res[id] || [])
          .map((p) => ({ t: p.lu != null ? p.lu * 1000 : Date.parse(p.last_updated || p.last_changed), v: parseFloat(p.s) }))
          .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));
      }
      tile.history = history;
      tile.historyError = null;
    } catch (err) {
      // Ohne Verlauf bleibt die Liste mit den aktuellen Preisen stehen; der Fehler steht
      // sichtbar darunter, statt eine flache Linie vorzutäuschen.
      tile.history = {};
      tile.historyError = err.message || err.code || String(err);
    } finally {
      tile.fetched = Date.now();
      tile.loading = false;
      this._updateFuel(tile);
    }
  }

  _renderFuel(tile) {
    for (const { key, b } of tile.kindButtons) b.classList.toggle("active", key === tile.kind);
    const rows = tile.cfg.stations
      .map((st) => {
        const id = st[tile.kind];
        const s = id && this._hass.states[id];
        const v = s ? parseFloat(s.state) : NaN;
        return { name: st.name, id, v: Number.isFinite(v) ? v : null };
      })
      .filter((r) => r.id);
    rows.sort((a, b) => (a.v == null) - (b.v == null) || (a.v ?? 0) - (b.v ?? 0));
    const best = rows.find((r) => r.v != null);
    const fmt = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    tile.list.innerHTML = "";
    for (const r of rows) {
      const row = el("button", "fu-row");
      if (best && r.v != null && r.v === best.v) row.classList.add("best");
      row.addEventListener("click", () => this._moreInfo(r.id));
      row.appendChild(el("div", "fu-name", r.name || r.id));
      row.appendChild(this._sparkline(tile.history[r.id] || [], r.v));
      const price = el("div", "fu-price");
      // Unbekannter Preis bleibt leer statt „0,000 €“.
      price.textContent = r.v == null ? "–" : `${fmt.format(r.v)} €`;
      if (best && r.v != null && r.v > best.v) {
        price.appendChild(el("span", "fu-diff", `+${Math.round((r.v - best.v) * 100)} ct`));
      }
      row.appendChild(price);
      tile.list.appendChild(row);
    }
    if (!rows.length) tile.list.appendChild(el("div", "ag-empty", "Keine Preise für diese Sorte"));
    if (tile.historyError) tile.list.appendChild(el("div", "ag-empty", `Verlauf nicht ladbar: ${tile.historyError}`));
  }

  _sparkline(points, current) {
    const W = 96;
    const H = 26;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "fu-spark");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const pts = current == null ? points : [...points, { t: Date.now(), v: current }];
    if (pts.length < 2) return svg;
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t || t0 + 1;
    const vs = pts.map((p) => p.v);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const y = (v) => (hi === lo ? H / 2 : H - 2 - ((v - lo) / (hi - lo)) * (H - 4));
    // Treppenlinie: ein Preis gilt, bis der nächste kommt.
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].v).toFixed(1)}`;
    }
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  }

  // ───────────── Musiksuche (Music Assistant) ─────────────

  _maPlayers() {
    return Object.values(this._hass.states).filter(
      (st) => st.attributes.mass_player_type !== undefined && st.state !== "unavailable",
    );
  }

  // Die Dienste von Music Assistant brauchen die ID des Integrationseintrags. Ohne
  // Admin-Rechte ist die Liste der Einträge nicht lesbar – das Gerät eines MA-Players
  // nennt sie aber.
  // Über irgendeine MA-Entität, nicht nur laufende Player: Ist gerade kein Lautsprecher
  // erreichbar (in der Testinstanz z. B. der geschlossene Browser-Tab), ist MA trotzdem
  // verbunden – Suche und Bibliothek funktionieren, nur Abspielen braucht einen Lautsprecher.
  _maEntryId() {
    const hass = this._hass;
    for (const ent of Object.values(hass.entities || {})) {
      if (ent.platform !== "music_assistant") continue;
      const dev = ent.device_id && hass.devices && hass.devices[ent.device_id];
      if (dev && dev.config_entries && dev.config_entries.length) return dev.config_entries[0];
    }
    return null;
  }

  _buildSearch() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel");

    const head = el("div", "shead");
    const field = el("label", "sfield");
    field.appendChild(icon("mdi:magnify"));
    const input = el("input", "sinput");
    input.type = "search";
    input.placeholder = "Titel, Künstler, Album, Playlist …";
    input.setAttribute("enterkeyhint", "search");
    input.addEventListener("input", () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._runSearch(), SEARCH_DEBOUNCE_MS);
    });
    field.appendChild(input);
    head.append(field);

    const filters = el("div", "sfilters");
    this._searchFilter = "all";
    for (const f of SEARCH_FILTERS) {
      const chip = el("button", "schip", f.label);
      chip.dataset.key = f.key;
      chip.addEventListener("click", () => {
        this._searchFilter = f.key;
        this._renderFilterChips();
        this._runSearch();
      });
      filters.appendChild(chip);
    }

    const target = el("div", "starget");
    target.appendChild(el("span", "slabel", "Abspielen in"));
    this._searchTargets = el("div", "stargets");
    target.appendChild(this._searchTargets);

    this._searchResults = el("div", "sresults");
    panel.append(head, filters, target, this._searchResults, this._backButton(() => this._closeSearch()));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) this._closeSearch();
    });
    this._searchWrap = wrap;
    this._searchInput = input;
    this._searchFilters = filters;
    return wrap;
  }

  // areaId: aus einem Raum heraus gesucht → dessen Lautsprecher sind vorgewählt.
  _openSearch(areaId = null) {
    const players = this._maPlayers();
    const ids = players.map((p) => p.entity_id);
    const inRoom = areaId ? ids.filter((id) => this._entityArea(this._hass.entities[id]) === areaId) : [];
    // Auswahl bleibt zwischen zwei Suchen erhalten, solange die Lautsprecher noch da sind.
    const kept = (this._searchSel || []).filter((id) => ids.includes(id));
    if (inRoom.length) {
      this._searchSel = inRoom;
    } else if (!kept.length) {
      // Sonst: wo gerade etwas läuft, sonst der erste Lautsprecher.
      const now = this._pickPlayer();
      const first = now && ids.includes(now.entity_id) ? now.entity_id : ids[0];
      this._searchSel = first ? [first] : [];
    } else {
      this._searchSel = kept;
    }
    this._renderFilterChips();
    this._renderTargets();
    this._searchWrap.hidden = false;
    this._runSearch();
    setTimeout(() => this._searchInput.focus(), 50);
  }

  _closeSearch() {
    clearTimeout(this._searchTimer);
    this._searchWrap.hidden = true;
  }

  _renderFilterChips() {
    for (const chip of this._searchFilters.children) {
      chip.classList.toggle("active", chip.dataset.key === this._searchFilter);
    }
  }

  // Mehrere Räume antippen = gemeinsam abspielen. Der zuerst gewählte führt die Gruppe.
  _renderTargets() {
    this._searchTargets.innerHTML = "";
    const players = this._maPlayers();
    if (!players.length) {
      // Ohne Lautsprecher kann nichts spielen – sagen, woran es liegt und was hilft.
      this._searchTargets.appendChild(
        el("span", "smuted", "Kein Lautsprecher verbunden – Lautsprecher in Music Assistant freigeben (Dienste → Musik). Zum Testen: Music Assistant im Browser offen lassen, der Tab wird zum Lautsprecher."),
      );
      return;
    }
    const sel = this._searchSel || [];
    if (players.length > 1) {
      const all = el("button", "schip", "Alle");
      all.classList.toggle("active", sel.length === players.length);
      all.addEventListener("click", () => {
        const lead = sel[0] || players[0].entity_id;
        this._searchSel = [lead, ...players.map((p) => p.entity_id).filter((id) => id !== lead)];
        this._renderTargets();
      });
      this._searchTargets.appendChild(all);
    }
    for (const st of players) {
      const chip = el("button", "schip", this._playerLabel(st));
      chip.classList.toggle("active", sel.includes(st.entity_id));
      chip.addEventListener("click", () => {
        const cur = this._searchSel || [];
        // Der letzte gewählte Raum bleibt stehen – ohne Ziel ließe sich nichts abspielen.
        this._searchSel = cur.includes(st.entity_id)
          ? cur.length > 1 ? cur.filter((id) => id !== st.entity_id) : cur
          : [...cur, st.entity_id];
        this._renderTargets();
      });
      this._searchTargets.appendChild(chip);
    }
  }

  // Lautsprecher heißen nach ihrem Raum („Wohnbereich“), nicht nach dem Gerät („Sonos One 2“).
  // Stehen zwei im selben Raum, kommt der Gerätename dazu.
  _playerLabel(st) {
    const hass = this._hass;
    const areaId = this._entityArea(hass.entities && hass.entities[st.entity_id]);
    const area = areaId && hass.areas && hass.areas[areaId];
    const name = st.attributes.friendly_name || st.entity_id;
    if (!area) return name;
    const twins = this._maPlayers().filter(
      (p) => this._entityArea(hass.entities && hass.entities[p.entity_id]) === areaId,
    ).length;
    return twins > 1 ? `${area.name} · ${name}` : area.name;
  }

  async _runSearch(offset = 0) {
    const query = this._searchInput.value.trim();
    const entry = this._maEntryId();
    const box = this._searchResults;
    if (!entry) {
      box.innerHTML = "";
      box.appendChild(el("div", "smuted", "Music Assistant ist nicht verbunden."));
      return;
    }
    const filter = SEARCH_FILTERS.find((f) => f.key === this._searchFilter);
    const ticket = (this._searchTicket = (this._searchTicket || 0) + 1);
    if (offset === 0) {
      box.innerHTML = "";
      box.appendChild(el("div", "smuted", query ? "Suche …" : "Lade Bibliothek …"));
    }
    if (!query && filter.key === "all" && offset === 0) {
      await this._renderHome(entry, ticket);
      return;
    }
    try {
      let items;
      let more = false;
      if (query) {
        const res = await this._hass.callService(
          "music_assistant",
          "search",
          { config_entry_id: entry, name: query, media_type: filter.types, limit: SEARCH_LIMIT },
          undefined,
          false,
          true,
        );
        const r = res.response || {};
        items = filter.types.flatMap((t) => r[RESULT_KEYS[t]] || []);
      } else {
        // Ohne Suchbegriff: eigene Bibliothek (Playlists, bei Filter die gewählte Art),
        // seitenweise – eine große Sammlung wird nicht stillschweigend abgeschnitten.
        const type = filter.key === "all" ? "playlist" : filter.types[0];
        items = await this._library(entry, type, { limit: LIBRARY_PAGE, offset, order_by: "name" });
        more = items.length === LIBRARY_PAGE;
      }
      if (ticket !== this._searchTicket) return; // überholt von einer neueren Eingabe
      if (offset === 0) box.innerHTML = "";
      else box.querySelector(".smore")?.remove();
      if (!items.length && offset === 0) {
        box.appendChild(el("div", "smuted", query ? "Nichts gefunden." : "Bibliothek ist leer."));
        return;
      }
      if (offset === 0 && !query) box.appendChild(el("div", "ssection", filter.key === "all" ? "Meine Playlists" : `Meine ${filter.label}`));
      // Bei „Alles“ je Art eine Zwischenüberschrift, sonst gehen Playlists unter vielen Titeln unter.
      let lastType = null;
      for (const item of items) {
        if (query && filter.key === "all" && item.media_type !== lastType) {
          const f = SEARCH_FILTERS.find((x) => x.types.length === 1 && x.types[0] === item.media_type);
          if (f) box.appendChild(el("div", "ssection", f.label));
          lastType = item.media_type;
        }
        box.appendChild(this._resultRow(item));
      }
      if (more) {
        const btn = el("button", "smore", "Mehr laden");
        btn.addEventListener("click", () => this._runSearch(offset + LIBRARY_PAGE));
        box.appendChild(btn);
      }
    } catch (err) {
      if (ticket !== this._searchTicket) return;
      box.innerHTML = "";
      box.appendChild(el("div", "serror", `Suche fehlgeschlagen: ${err.message || err.code || err}`));
    }
  }

  async _library(entry, mediaType, opts) {
    const res = await this._hass.callService(
      "music_assistant",
      "get_library",
      { config_entry_id: entry, media_type: mediaType, ...opts },
      undefined,
      false,
      true,
    );
    return (res.response && res.response.items) || [];
  }

  // Von Music Assistant selbst erzeugte Playlists („Infinite Mix“, „500 Random tracks“ …)
  // tragen ein Bild aus dem eigenen Bildproxy; Playlists von Spotify, Apple Music & Co.
  // kommen mit Bildern ihrer Dienste. Die eigenen stehen vorn, die erzeugten am Ende.
  _isGenerated(item) {
    return String(item.image || "").includes("/imageproxy");
  }

  // Startseite wie bei Spotify/Apple Music: Reihen mit großen Covern.
  async _renderHome(entry, ticket) {
    const box = this._searchResults;
    try {
      const [recent, playlists, albums, artists] = await Promise.all([
        this._library(entry, "track", { limit: 16, order_by: "last_played_desc" }),
        this._library(entry, "playlist", { limit: 100, order_by: "last_played_desc" }),
        this._library(entry, "album", { limit: 20, order_by: "timestamp_added_desc" }),
        this._library(entry, "artist", { limit: 20, order_by: "last_played_desc" }),
      ]);
      if (ticket !== this._searchTicket) return;
      box.innerHTML = "";
      const own = playlists.filter((p) => !this._isGenerated(p));
      const generated = playlists.filter((p) => this._isGenerated(p));
      const rows = [
        { title: "Zuletzt gehört", items: recent, filter: "track" },
        { title: "Deine Playlists", items: own.slice(0, 30), filter: "playlist" },
        { title: "Alben", items: albums, filter: "album" },
        { title: "Künstler", items: artists, filter: "artist" },
        { title: "Automatische Mixe", items: generated, filter: null },
      ];
      let shown = 0;
      for (const row of rows) {
        if (!row.items.length) continue;
        shown += 1;
        const head = el("div", "shome-head");
        head.appendChild(el("div", "shome-title", row.title));
        if (row.filter) {
          const all = el("button", "shome-all", "Alle");
          all.addEventListener("click", () => {
            this._searchFilter = row.filter;
            this._renderFilterChips();
            this._runSearch();
          });
          head.appendChild(all);
        }
        const strip = el("div", "shome-strip");
        for (const item of row.items) strip.appendChild(this._resultCard(item));
        box.append(head, strip);
      }
      if (!shown) box.appendChild(el("div", "smuted", "Bibliothek ist leer – unter Dienste einen Musikdienst verbinden."));
    } catch (err) {
      if (ticket !== this._searchTicket) return;
      box.innerHTML = "";
      box.appendChild(el("div", "serror", `Bibliothek nicht ladbar: ${err.message || err.code || err}`));
    }
  }

  _resultCard(item) {
    const card = el("button", `scard ${item.media_type}`);
    const img = el("img", "scover");
    img.alt = "";
    if (item.image) img.src = item.image;
    const artists = (item.artists || []).map((a) => a.name).join(", ");
    card.append(img, el("div", "sname", item.name), el("div", "ssub", artists || TYPE_LABEL[item.media_type] || ""));
    card.addEventListener("click", () => this._playItem(item, card));
    return card;
  }

  _resultRow(item) {
    const row = el("button", "srow");
    const img = el("img", "sthumb");
    img.alt = "";
    if (item.image) img.src = item.image;
    const txt = el("div", "stext");
    const artists = (item.artists || []).map((a) => a.name).join(", ");
    const sub = [TYPE_LABEL[item.media_type], artists, item.album && item.album.name, item.owner]
      .filter(Boolean)
      .join(" · ");
    txt.append(el("div", "sname", item.name), el("div", "ssub", sub));
    const play = el("span", "splay");
    play.appendChild(icon("mdi:play"));
    row.append(img, txt, play);
    row.addEventListener("click", () => this._playItem(item, row));
    return row;
  }

  async _playItem(item, row) {
    const [lead, ...more] = this._searchSel || [];
    if (!lead) {
      // Kein stilles Nichts: am Titel sagen, warum nichts passiert.
      const sub = row.querySelector(".ssub");
      if (sub) sub.textContent = "Kein Lautsprecher – oben unter „Abspielen in“ nachsehen";
      this._searchTargets.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    row.classList.add("busy");
    try {
      await this._hass.callService(
        "music_assistant",
        "play_media",
        // Einzelner Titel oder Künstler: Radio-Modus, sonst ist nach dem Titel Schluss –
        // Music Assistant spielt danach passende Musik weiter. Alben/Playlists laufen durch.
        {
          media_id: item.uri,
          media_type: item.media_type,
          enqueue: "replace",
          radio_mode: item.media_type === "track" || item.media_type === "artist",
        },
        { entity_id: lead },
      );
      // Weitere Räume spielen synchron mit (wie „Dazu“ in der Raumwahl der Live-Karte).
      if (more.length) {
        await this._hass.callService("media_player", "join", { group_members: more }, { entity_id: lead });
      }
      // Live-Karte und Kacheln zeigen den neuen Titel von selbst – Fenster schließen.
      this._closeSearch();
    } catch (err) {
      row.classList.remove("busy");
      row.querySelector(".ssub").textContent = `Abspielen fehlgeschlagen: ${err.message || err.code || err}`;
    }
  }

  // ───────────── Räume (wo läuft die Musik) ─────────────

  _buildRooms() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel rpanel");
    const head = el("div", "shead");
    head.appendChild(el("div", "ptitle", "Wo soll es laufen?"));
    this._roomList = el("div", "sresults");
    panel.append(head, this._roomList, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._roomsWrap = wrap;
    return wrap;
  }

  _openRooms(sourceId) {
    this._roomSource = sourceId;
    this._roomsWrap.hidden = false;
    this._renderRooms();
  }

  _renderRooms() {
    if (!this._roomsWrap || this._roomsWrap.hidden) return;
    const hass = this._hass;
    const src = hass.states[this._roomSource];
    const members = (src && src.attributes.group_members) || [];
    this._roomList.innerHTML = "";
    for (const st of this._maPlayers()) {
      const isSrc = st.entity_id === this._roomSource;
      const joined = !isSrc && members.includes(st.entity_id);
      const row = el("div", `rrow${isSrc ? " current" : ""}${joined ? " joined" : ""}`);
      const txt = el("div", "stext");
      const a = st.attributes;
      const status = isSrc
        ? "Läuft hier"
        : joined
          ? "Spielt mit"
          : st.state === "playing"
            ? `Spielt: ${a.media_title || ""}`
            : hass.formatEntityState(st);
      txt.append(el("div", "sname", this._playerLabel(st)), el("div", "ssub", status));
      row.appendChild(txt);
      if (!isSrc && src) {
        // „Hierher“ verschiebt die Wiedergabe; „Dazu“ spielt zusätzlich in diesem Raum.
        const move = el("button", "schip", "Hierher");
        move.addEventListener("click", async () => {
          await hass.callService(
            "music_assistant",
            "transfer_queue",
            { source_player: this._roomSource, auto_play: true },
            { entity_id: st.entity_id },
          );
          this._roomSource = st.entity_id;
          this._renderRooms();
        });
        const join = el("button", "schip", joined ? "Entfernen" : "Dazu");
        join.addEventListener("click", () =>
          joined
            ? hass.callService("media_player", "unjoin", {}, { entity_id: st.entity_id })
            : hass.callService("media_player", "join", { group_members: [st.entity_id] }, { entity_id: this._roomSource }),
        );
        row.append(join, move);
      }
      this._roomList.appendChild(row);
    }
    if (this._roomList.children.length < 2) {
      this._roomList.appendChild(
        el("div", "smuted", "Weitere Lautsprecher erscheinen hier, sobald sie in Music Assistant verbunden sind."),
      );
    }
  }

  // ───────────── Player (eigenes Fenster statt HA-Dialog) ─────────────

  // Musik öffnet den eigenen Player; Fernseher und alles andere den HA-Dialog.
  _openMedia(entityId) {
    const st = this._hass && this._hass.states[entityId];
    const isTv = st && st.attributes.device_class === "tv";
    if (!st || isTv || !entityId.startsWith("media_player.")) return this._moreInfo(entityId);
    this._openPlayer(entityId);
  }

  _buildPlayer() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel ppanel");
    const p = {};
    p.room = el("div", "pl-room");
    p.cover = el("img", "pl-cover");
    p.cover.alt = "";
    p.title = el("div", "pl-title");
    p.artist = el("div", "pl-artist");
    const meta = el("div", "pl-meta");
    const metaText = el("div", "pl-metatext");
    metaText.append(p.title, p.artist);
    p.fav = el("button", "pl-fav");
    p.fav.setAttribute("aria-label", "Zu Favoriten");
    p.favIcon = icon("mdi:heart-outline");
    p.fav.appendChild(p.favIcon);
    p.fav.addEventListener("click", () => this._favoriteCurrent());
    meta.append(metaText, p.fav);
    // Fortschritt: antippen/ziehen springt an die Stelle (wenn der Player das kann).
    p.seek = el("input", "slider pl-seek");
    p.seek.type = "range";
    p.seek.min = "0";
    p.seek.max = "1000";
    p.seek.setAttribute("aria-label", "Position");
    p.seek.addEventListener("pointerdown", () => (p.seeking = true));
    p.seek.addEventListener("change", () => {
      p.seeking = false;
      const st = this._hass.states[this._playerId];
      const dur = st && Number(st.attributes.media_duration);
      if (dur) this._playerCall("media_seek", { seek_position: (Number(p.seek.value) / 1000) * dur });
    });
    const times = el("div", "pl-times");
    p.elapsed = el("span", "", "");
    p.duration = el("span", "", "");
    times.append(p.elapsed, p.duration);
    const ctr = el("div", "pl-controls");
    const btn = (name, label, fn, cls = "") => {
      const b = el("button", cls);
      b.setAttribute("aria-label", label);
      const i = icon(name);
      b.appendChild(i);
      b.addEventListener("click", fn);
      ctr.appendChild(b);
      return { b, i };
    };
    p.shuffle = btn("mdi:shuffle-variant", "Zufall", () => {
      const st = this._hass.states[this._playerId];
      this._playerCall("shuffle_set", { shuffle: !(st && st.attributes.shuffle) });
    }, "pl-mode");
    btn("mdi:skip-previous", "Zurück", () => this._playerCall("media_previous_track"));
    p.play = btn("mdi:play", "Wiedergabe/Pause", () => this._playerCall("media_play_pause"), "pl-play");
    btn("mdi:skip-next", "Weiter", () => this._playerCall("media_next_track"));
    p.repeat = btn("mdi:repeat", "Wiederholen", () => {
      const st = this._hass.states[this._playerId];
      const next = { off: "all", all: "one", one: "off" }[(st && st.attributes.repeat) || "off"];
      this._playerCall("repeat_set", { repeat: next });
    }, "pl-mode");
    const volRow = el("div", "pl-vol");
    p.vol = el("input", "slider");
    p.vol.type = "range";
    p.vol.min = "0";
    p.vol.max = "100";
    p.vol.setAttribute("aria-label", "Lautstärke");
    p.vol.addEventListener("pointerdown", () => (p.dragging = true));
    p.vol.addEventListener("change", () => {
      p.dragging = false;
      this._playerCall("volume_set", { volume_level: Number(p.vol.value) / 100 });
    });
    p.vol.addEventListener("input", () => p.vol.style.setProperty("--fill", `${p.vol.value}%`));
    volRow.append(icon("mdi:volume-low"), p.vol, icon("mdi:volume-high"));
    const actions = el("div", "pl-actions");
    const rooms = el("button", "schip", "Räume");
    rooms.addEventListener("click", () => this._openRooms(this._playerId));
    const find = el("button", "schip", "Suchen");
    find.addEventListener("click", () => {
      const e = this._hass.entities && this._hass.entities[this._playerId];
      this._openSearch(this._entityArea(e) || this._areaId());
    });
    actions.append(rooms, find);
    p.toast = el("div", "pl-toast");
    const body = el("div", "pl-body");
    body.append(p.room, p.cover, meta, p.seek, times, ctr, volRow, actions, p.toast);
    panel.append(body, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._playerWrap = wrap;
    this._pl = p;
    return wrap;
  }

  _openPlayer(entityId) {
    this._playerId = entityId;
    this._pl.toast.textContent = "";
    this._playerWrap.hidden = false;
    this._renderPlayer(true);
  }

  _playerCall(service, data = {}) {
    return this._hass.callService("media_player", service, { entity_id: this._playerId, ...data });
  }

  // Music Assistant legt je Player einen Knopf „Aktuellen Titel favorisieren“ an (gleiches Gerät).
  // Den drücken wir – MA trägt den Titel dann auch beim Dienst ein (Spotify: Lieblingssongs).
  _favoriteButton() {
    const ents = (this._hass && this._hass.entities) || {};
    const me = ents[this._playerId];
    if (!me || !me.device_id) return null;
    const hit = Object.values(ents).find(
      (e) => e.device_id === me.device_id && e.entity_id.startsWith("button.") &&
        /favorite|favori/i.test(`${e.translation_key || ""} ${e.entity_id}`),
    );
    return hit ? hit.entity_id : null;
  }

  async _favoriteCurrent() {
    const p = this._pl;
    const id = this._favoriteButton();
    const st = this._hass.states[this._playerId];
    if (!id || !st) return;
    const key = `${st.attributes.media_title}|${st.attributes.media_artist}`;
    try {
      await this._hass.callService("button", "press", { entity_id: id });
      this._favDone = this._favDone || new Set();
      this._favDone.add(key);
      p.toast.textContent = "Zu Favoriten hinzugefügt";
      this._renderPlayer();
    } catch (err) {
      p.toast.textContent = `Hat nicht geklappt: ${err.message || err.code || err}`;
    }
  }

  _renderPlayer(force) {
    if (!this._playerWrap || (this._playerWrap.hidden && !force)) return;
    const p = this._pl;
    const st = this._hass.states[this._playerId];
    if (!st) return;
    const a = st.attributes;
    p.room.textContent = this._playerLabel(st);
    p.title.textContent = a.media_title || "Nichts läuft";
    p.artist.textContent = [a.media_artist, a.media_album_name].filter(Boolean).join(" · ");
    const pic = a.entity_picture;
    if (pic) {
      if (p.cover.getAttribute("src") !== pic) p.cover.src = pic;
    } else p.cover.removeAttribute("src");
    p.play.i.setAttribute("icon", st.state === "playing" ? "mdi:pause" : "mdi:play");
    p.shuffle.b.classList.toggle("active", !!a.shuffle);
    p.repeat.b.classList.toggle("active", !!a.repeat && a.repeat !== "off");
    p.repeat.i.setAttribute("icon", a.repeat === "one" ? "mdi:repeat-once" : "mdi:repeat");
    const favId = this._favoriteButton();
    const key = `${a.media_title}|${a.media_artist}`;
    const faved = !!(this._favDone && this._favDone.has(key));
    p.fav.hidden = !favId || !a.media_title;
    p.fav.classList.toggle("on", faved);
    p.favIcon.setAttribute("icon", faved ? "mdi:heart" : "mdi:heart-outline");
    p.vol.parentElement.hidden = a.volume_level == null;
    if (!p.dragging && a.volume_level != null) p.vol.value = String(Math.round(a.volume_level * 100));
    p.vol.style.setProperty("--fill", `${p.vol.value}%`);
    this._tickPlayer();
  }

  _tickPlayer() {
    if (!this._playerWrap || this._playerWrap.hidden) return;
    const p = this._pl;
    const st = this._hass.states[this._playerId];
    if (!st) return;
    const a = st.attributes;
    const dur = Number(a.media_duration) || 0;
    let pos = Number(a.media_position) || 0;
    if (st.state === "playing" && a.media_position_updated_at) {
      pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    }
    pos = Math.max(0, Math.min(pos, dur));
    const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
    p.seek.hidden = !dur;
    p.elapsed.parentElement.hidden = !dur;
    if (!dur) return;
    p.elapsed.textContent = fmt(pos);
    p.duration.textContent = fmt(dur);
    if (!p.seeking) p.seek.value = String(Math.round((pos / dur) * 1000));
    p.seek.style.setProperty("--fill", `${(Number(p.seek.value) / 10).toFixed(1)}%`);
  }

  // ───────────── Dienste & Benutzer ─────────────

  _updateServiceTile(tile) {
    const cfg = tile.cfg;
    const hass = this._hass;
    if (tile.armed) return; // Nachfrage läuft, Text nicht überschreiben
    const isAdmin = !!(hass.user && hass.user.is_admin);

    if (cfg.type === "account") {
      tile.name.textContent = cfg.name || (hass.user ? hass.user.name : "Benutzer");
      tile.state.textContent = isAdmin ? "Admin · Benutzer wechseln" : "Benutzer wechseln";
      return;
    }

    tile.name.textContent = cfg.name || cfg.config_flow || cfg.path;
    const locked = !!(cfg.admin || cfg.config_flow) && !isAdmin;
    tile.node.classList.toggle("locked", locked);
    if (locked) {
      tile.state.textContent = "Nur mit Admin-Anmeldung";
      return;
    }
    if (cfg.status_domain) {
      // Zählt eingerichtete Entitäten, z. B. Kalender oder Fernseher (device_class: tv).
      const n = Object.values(hass.states).filter(
        (st) =>
          st.entity_id.startsWith(`${cfg.status_domain}.`) &&
          (!cfg.device_class || st.attributes.device_class === cfg.device_class),
      ).length;
      tile.state.textContent = n ? `${n} verbunden · Hinzufügen` : "Noch nicht verbunden · Verbinden";
      return;
    }
    tile.state.textContent = cfg.state_text || "Öffnen";
  }

  _openService(tile) {
    const cfg = tile.cfg;
    const isAdmin = !!(this._hass.user && this._hass.user.is_admin);
    if ((cfg.admin || cfg.config_flow) && !isAdmin) {
      // Ohne Admin-Rechte geht es nur über den Benutzerwechsel – mit Nachfrage.
      this._switchUser(tile);
      return;
    }
    if (cfg.url) {
      // Fremde Oberflächen (Music Assistant) als eigenes Fenster: in der HA-App der
      // eingebaute Browser mit „Fertig“, am Rechner ein Tab. Eingebettet ließen sie sich am
      // iPhone nicht sauber bedienen (Tastatur, Scrollen, eigene Anmeldung).
      window.open(cfg.url.replace("{host}", window.location.hostname), "_blank", "noopener");
    } else if (cfg.config_flow) {
      // Öffnet den Einrichtungsdialog der Integration direkt, ohne Suchen in den Einstellungen.
      this._navigate(`/config/integrations/dashboard/add?domain=${encodeURIComponent(cfg.config_flow)}`);
    } else {
      this._navigate(cfg.path);
    }
  }

  _switchUser(tile) {
    // Zwei Tipps wie beim Türöffner: Abmelden am Wandtablet passiert nicht aus Versehen.
    if (!tile.armed) {
      tile.armed = true;
      tile.node.classList.add("armed");
      tile.state.textContent = "Nochmal tippen: abmelden und Benutzer wählen";
      tile.armTimer = setTimeout(() => {
        tile.armed = false;
        tile.node.classList.remove("armed");
        this._updateServiceTile(tile);
      }, UNLOCK_CONFIRM_MS);
      return;
    }
    clearTimeout(tile.armTimer);
    // HA meldet ab und zeigt die Anmeldeseite mit Benutzerauswahl.
    this.dispatchEvent(new CustomEvent("hass-logout", { bubbles: true, composed: true }));
  }

  // Fenster schließen: „Zurück“ als reiner Text unten, kein X im Kasten.
  _backButton(onClick) {
    const b = el("button", "sback", "Zurück");
    b.addEventListener("click", onClick);
    return b;
  }

  _buildConfirmHa() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel cpanel");
    const box = el("div", "cbox");
    box.append(
      icon("mdi:home-assistant"),
      el("div", "ctitle", "Zur Home-Assistant-Oberfläche wechseln?"),
      el("div", "ctext", "Dort liegen Einstellungen und Geräte. Zurück zum Tablet geht es über das Menü links."),
    );
    const go = el("button", "pbtn unlock cgo", "Wechseln");
    go.addEventListener("click", () => {
      wrap.hidden = true;
      this._navigate(this._confirmPath || this._config.menu_path || "/");
      this._confirmPath = null;
    });
    box.appendChild(go);
    panel.append(box, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._confirmWrap = wrap;
    return wrap;
  }

  // ───────────── Navigation: Räume-Übersicht ─────────────

  _navItems() {
    const all = this._config.nav || [];
    if (!ElvioRooms.isLegacy(all)) {
      // Neuer Modus: „Räume“ direkt hinter dem ersten Eintrag (meist Zuhause).
      const base = ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path);
      const items = all.map((item) => ({ ...item, active: this._isCurrent(item.path) }));
      // Karten ohne nav (Beispiel bis v1.5.0) bleiben ohne Leiste – sonst stünde dort plötzlich
      // „Räume“ mit Verweisen auf eine Ansicht raum, die es in diesem Dashboard nicht gibt.
      if (all.length && this._rooms().length) {
        items.splice(Math.min(1, items.length), 0, { name: "Räume", icon: "mdi:floor-plan", rooms: true, active: this._isCurrent(base) });
      }
      return this._withPages(items);
    }
    const rooms = all.filter((i) => i.room);
    const items = [];
    let roomsAdded = false;
    for (const item of all) {
      if (item.room) {
        // Der Eintrag „Räume“ steht dort, wo der erste Raum stand.
        if (!roomsAdded) {
          items.push({
            name: "Räume",
            icon: "mdi:floor-plan",
            rooms: true,
            active: rooms.some((r) => this._isCurrent(r.path)),
          });
          roomsAdded = true;
        }
        continue;
      }
      items.push({ ...item, active: this._isCurrent(item.path) });
    }
    return this._withPages(items);
  }

  // Eigene Seiten hinter „Räume“ (sonst hinter dem ersten Eintrag): „Personen“ und „Energie“ –
  // je nur mit Daten, eingeschaltet (Kachel „Ansichten“) und nur in Karten mit Leiste.
  _withPages(items) {
    if (!items.length) return items;
    const pages = [];
    if (this._viewOn("people") && this._people().length) pages.push({ name: "Personen", icon: "mdi:account-group-outline", people: true, active: false });
    if (this._energyOn()) pages.push({ name: "Energie", icon: "mdi:lightning-bolt-outline", energy: true, active: false });
    const i = items.findIndex((x) => x.rooms);
    items.splice(i >= 0 ? i + 1 : Math.min(1, items.length), 0, ...pages);
    return items;
  }

  _navClick(item) {
    if (item.energy) return this._openEnergy();
    if (item.people) return this._openPeople();
    // Jeder andere Eintrag verlässt die eigenen Seiten – auch der der eigenen Ansicht.
    this._closeEnergy();
    this._closePeople();
    if (item.rooms) this._openRoomsNav();
    else this._navigate(item.path);
  }

  _markNav() {
    const page = this._energyWrap && !this._energyWrap.hidden ? "energy" : this._peopleWrap && !this._peopleWrap.hidden ? "people" : null;
    for (const { item, node } of this._navEls || []) node.classList.toggle("active", page ? !!item[page] : !!item.active);
  }

  // Ansichten ein/aus (Kachel „Ansichten“) stehen in der Dashboard-Konfiguration unter
  // elvio_views, z. B. { energy: false }. Ohne Eintrag ist alles an. Solange die Karte nicht
  // eingehängt ist, kennt sie das Dashboard nicht – dann gilt der letzte bekannte Stand.
  _viewPrefs() {
    const d = this._dashboardConfig();
    return d ? d.elvio_views || {} : null;
  }

  _viewOn(key) {
    const p = this._viewPrefs() || this._viewPrefsLast || {};
    return p[key] !== false;
  }

  _energyOn() {
    return !!this._energyNav && this._viewOn("energy");
  }

  _people(includeHidden = false) {
    const h = this._hass;
    return ElvioPeople.list({ states: h.states, entities: h.entities || {}, devices: h.devices || {}, hideLabel: LABEL_HIDE.id, includeHidden });
  }

  // Was die Leiste bestimmt; ändert es sich (Ansicht aus, letzte Person ausgeblendet …),
  // baut die Karte neu auf.
  _navSig() {
    const vp = this._viewPrefs();
    if (vp) this._viewPrefsLast = vp;
    return JSON.stringify([this._viewPrefsLast || {}, this._people().length > 0, this._energyOn()]);
  }

  // ───────────── Szenen ─────────────
  // Im Raum die Szenen seines Bereichs, auf Zuhause die ohne Bereich. Antippen aktiviert,
  // langes Drücken (Admin) öffnet das Szenen-Blatt, „+ Szene“ legt eine an.

  // Zuhause erkennt die Karte am ersten Leisten-Eintrag (gleicher Name wie der Titel);
  // scenes: true/false in der Karte überstimmt das.
  _isHomeCard() {
    const c = this._config;
    if (c.scenes === true) return true;
    if (c.scenes === false || this._areaId()) return false;
    const first = (c.nav || [])[0];
    return !!(first && first.name && first.name === c.title);
  }

  _scenesHere() {
    if (this._config.scenes === false) return null;
    const areaId = this._areaId() || null;
    if (!areaId && !this._isHomeCard()) return null;
    const hass = this._hass;
    const reg = hass.entities || {};
    const all = Object.values(hass.states).filter((st) => st.entity_id.startsWith("scene."));
    return { areaId, scenes: ElvioScenes.forArea(all, (id) => this._entityArea(reg[id]), areaId) };
  }

  _renderScenes() {
    const box = this._sceneChips;
    if (!box) return;
    const here = this._scenesHere();
    const admin = this._isAdmin();
    const list = here ? here.scenes : [];
    // Zuhause (Szenen ohne Bereich) bekommt vorn „Haus verlassen“ – für alle, nicht nur Admins.
    const leave = !!here && !here.areaId && this._config.leave !== false;
    const key = JSON.stringify([!!here, here && here.areaId, admin, leave, list.map((x) => [x.entity_id, x.attributes.friendly_name, x.attributes.icon])]);
    if (key === this._sceneKey) return;
    this._sceneKey = key;
    box.innerHTML = "";
    box.hidden = !here || (!list.length && !admin && !leave);
    if (box.hidden) return;
    if (leave) {
      const b = el("button", "chip scene leave");
      const av = el("div", "av");
      av.appendChild(icon("mdi:home-export-outline"));
      const txt = el("div", "txt");
      txt.appendChild(el("b", "", "Haus verlassen"));
      b.append(av, txt);
      b.addEventListener("click", () => this._openLeave());
      box.appendChild(b);
    }
    for (const sc of list) box.appendChild(this._sceneChip(sc, admin));
    if (admin) {
      const add = el("button", "chip scene sceneadd");
      const av = el("div", "av");
      av.appendChild(icon("mdi:plus"));
      const txt = el("div", "txt");
      txt.appendChild(el("b", "", "Szene"));
      add.append(av, txt);
      add.addEventListener("click", () => this._openSceneForm(null, here.areaId));
      box.appendChild(add);
    }
  }

  _sceneChip(sc, admin) {
    const b = el("button", "chip scene");
    const av = el("div", "av");
    av.appendChild(icon(sc.attributes.icon || "mdi:palette-outline"));
    const txt = el("div", "txt");
    txt.appendChild(el("b", "", sc.attributes.friendly_name || sc.entity_id));
    b.append(av, txt);
    // Langes Drücken öffnet das Blatt; ein Wisch durch die Reihe bricht es ab (pointercancel).
    let timer = 0;
    let long = false;
    const openForm = () => {
      if (long) return;
      long = true;
      clearTimeout(timer);
      this._openSceneForm(sc.entity_id);
    };
    b.addEventListener("pointerdown", () => {
      long = false;
      if (admin) timer = setTimeout(openForm, 550);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => clearTimeout(timer));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (admin) openForm();
    });
    b.addEventListener("click", () => {
      if (long) {
        long = false;
        return;
      }
      this._hass.callService("scene", "turn_on", { entity_id: sc.entity_id });
      b.classList.add("fired");
      setTimeout(() => b.classList.remove("fired"), 900);
    });
    return b;
  }

  // Das Blatt arbeitet auf Werten je Gerät (values): bei einer neuen Szene der Stand jetzt,
  // bei einer bestehenden das, was in ihr gespeichert ist. Gespeichert werden diese Werte –
  // die echten Lichter muss man dafür nicht hindrehen.
  _openSceneForm(entityId, areaId = null) {
    const hass = this._hass;
    const st = entityId ? hass.states[entityId] : null;
    const reg = hass.entities || {};
    this._sceneDraft = st
      ? {
          entityId,
          configId: st.attributes.id != null ? String(st.attributes.id) : null,
          name: st.attributes.friendly_name || "",
          icon: st.attributes.icon || "mdi:palette-outline",
          areaId: this._entityArea(reg[entityId]) || null,
          selected: new Set(st.attributes.entity_id || []),
          values: null,
        }
      : { entityId: null, configId: null, name: "", icon: "mdi:palette-outline", areaId, selected: null, values: null };
    const d = this._sceneDraft;
    if (!st) {
      const cand = this._sceneCandidates(areaId);
      d.selected = new Set(cand.lights);
      d.values = ElvioScenes.capture([...cand.lights, ...cand.others], hass.states);
    }
    this._sceneView = "main";
    this._sceneOthersOpen = false;
    this._editMode = "scene";
    this._editActions.replaceChildren();
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderSceneForm();
    // Bestehende Szene: gespeicherte Werte holen (YAML-Szenen haben keine – dann nur ansehen).
    if (st && d.configId) {
      hass.callApi("GET", `config/scene/config/${d.configId}`).then(
        (cfg) => {
          if (this._sceneDraft !== d) return;
          d.values = { ...ElvioScenes.capture([...d.selected], this._hass.states), ...((cfg && cfg.entities) || {}) };
          this._renderSceneForm();
        },
        (err) => this._roomFormError(`Szene nicht geladen: ${setupErrText(err)}`),
      );
    }
  }

  // Was in eine Szene kann: Lichter des Raums, dazu Steckdosen, Lüfter, Rollläden. Ohne
  // Bereich (Szene fürs ganze Haus) alles im Haus.
  _sceneCandidates(areaId) {
    const hass = this._hass;
    const ents = areaId
      ? this._areaEntities(areaId)
      : Object.values(hass.entities || {}).filter((e) => !e.hidden && !e.entity_category && hass.states[e.entity_id]);
    const ids = (re) =>
      ents
        .map((e) => e.entity_id)
        .filter((id) => re.test(id))
        .sort((a, b) => this._friendly(a).localeCompare(this._friendly(b), "de"));
    return { lights: ids(/^light\./), others: ids(/^(switch|fan|cover)\./) };
  }

  _renderSceneForm() {
    if (this._editMode !== "scene" || this._editWrap.hidden || !this._sceneDraft) return;
    const d = this._sceneDraft;
    const hass = this._hass;
    const list = this._editList;
    list.innerHTML = "";
    if (this._sceneView === "icon") return this._renderSceneIconPick();
    if (this._sceneView === "delete") return this._renderSceneDelete();
    const room = d.areaId ? ((hass.areas || {})[d.areaId] || {}).name || d.areaId : "Ganzes Haus";
    this._editTitle.textContent = d.entityId ? "Szene bearbeiten" : "Neue Szene";
    this._editHint.textContent = d.entityId
      ? `${room} · Gespeichert wird in Home Assistant.`
      : `${room} · Je Licht einstellen, wie es in der Szene sein soll – oder die Lichter hindrehen und „Jetzigen Stand übernehmen“.`;
    if (d.entityId && !d.configId) {
      list.appendChild(el("div", "ehint", "Diese Szene steht in der Konfiguration von Home Assistant (YAML) und lässt sich am Tablet nicht ändern."));
      return;
    }
    const name = el("input", "einput");
    name.value = d.name;
    name.placeholder = "Name, z. B. Abend";
    const chips = el("div", "echips");
    name.addEventListener("input", () => {
      d.name = name.value;
      for (const c of chips.children) c.classList.toggle("on", c.dataset.name === d.name.trim());
    });
    for (const p of ElvioScenes.presets()) {
      const b = el("button", "echip", p.name);
      b.dataset.name = p.name;
      b.classList.toggle("on", d.name.trim() === p.name);
      b.addEventListener("click", () => {
        d.name = p.name;
        d.icon = p.icon;
        this._renderSceneForm();
      });
      chips.appendChild(b);
    }
    list.append(el("div", "esub", "Name"), name, chips);
    const look = el("button", "erow epick");
    const ic = el("div", "eicon");
    ic.appendChild(icon(d.icon));
    look.append(ic, el("div", "etext sname", "Symbol"), el("div", "ssub", "Ändern"));
    look.addEventListener("click", () => {
      this._sceneView = "icon";
      this._renderSceneForm();
    });
    list.append(el("div", "esub", "Aussehen"), look);

    if (!d.values) {
      list.appendChild(el("div", "ag-empty", "Szene wird geladen …"));
      return;
    }
    const cand = this._sceneCandidates(d.areaId);
    // Geräte, die schon in der Szene stehen, aber woanders hängen, gehören trotzdem dazu.
    const extra = [...d.selected].filter((id) => !cand.lights.includes(id) && !cand.others.includes(id));
    const lights = [...cand.lights, ...extra.filter((id) => id.startsWith("light."))];
    const others = [...cand.others, ...extra.filter((id) => !id.startsWith("light."))];
    const reg = hass.entities || {};
    list.appendChild(el("div", "esub", "Licht"));
    if (!lights.length) list.appendChild(el("div", "ehint", "Hier gibt es keine Lichter."));
    for (const id of lights) list.appendChild(this._sceneRow(id, d, reg));
    if (others.length) {
      const open = this._sceneOthersOpen || others.some((id) => d.selected.has(id));
      list.appendChild(this._foldButton(`Steckdosen & Rollläden (${others.length})`, open, () => {
        this._sceneOthersOpen = !open;
        this._renderSceneForm();
      }));
      if (open) for (const id of others) list.appendChild(this._sceneRow(id, d, reg));
    }
    // Ausprobieren spielt die Einstellung ab, ohne zu speichern; „Stand übernehmen“ holt die
    // Werte von den echten Geräten (erst Lichter einstellen, dann übernehmen).
    const tools = el("div", "esctools");
    const tryIt = el("button", "stextbtn", "Ausprobieren");
    tryIt.addEventListener("click", () => {
      const entities = this._sceneEntities(d);
      if (Object.keys(entities).length) this._hass.callService("scene", "apply", { entities, transition: 1 });
    });
    const take = el("button", "stextbtn", "Jetzigen Stand übernehmen");
    take.addEventListener("click", () => {
      d.values = { ...d.values, ...ElvioScenes.capture([...lights, ...others], this._hass.states) };
      this._renderSceneForm();
    });
    tools.append(tryIt, take);
    list.appendChild(tools);
    const save = el("button", "pbtn unlock esave", d.entityId ? "Speichern" : "Szene speichern");
    save.addEventListener("click", () => this._saveScene(save));
    list.appendChild(save);
    if (d.entityId) {
      const del = el("button", "stextbtn edanger", "Szene löschen");
      del.addEventListener("click", () => {
        this._sceneView = "delete";
        this._renderSceneForm();
      });
      list.append(del);
    }
  }

  // Was die Szene speichert: die Werte der angehakten Geräte.
  _sceneEntities(d) {
    const out = {};
    for (const id of d.selected) {
      const v = d.values[id] || ElvioScenes.capture([id], this._hass.states)[id];
      if (v) out[id] = v;
    }
    return out;
  }

  // Eine Zeile im Szenen-Blatt: oben Gerät mit Schalter „in der Szene“, darunter (wenn drin)
  // An/Aus und je nach Lampe Helligkeit, Weißton, Farbe.
  _sceneRow(id, d, reg) {
    const hass = this._hass;
    const st = hass.states[id];
    const wrap = el("div", "escrow");
    const top = el("div", "erow");
    const i = el("div", "eicon");
    i.appendChild(icon(st ? st.attributes.icon || this._defaultIcon(st) : "mdi:help-circle-outline"));
    const area = !d.areaId ? this._entityArea(reg[id]) : null;
    const where = area ? ((hass.areas || {})[area] || {}).name : null;
    const t = el("div", "etext");
    t.append(el("div", "sname", this._friendly(id)), el("div", "ssub", [`jetzt ${ElvioScenes.describe(st)}`, where].filter(Boolean).join(" · ")));
    const sw = el("button", "lswitch");
    const inScene = d.selected.has(id);
    sw.classList.toggle("on", inScene);
    sw.setAttribute("aria-label", inScene ? "Aus der Szene nehmen" : "In die Szene nehmen");
    sw.addEventListener("click", () => {
      if (d.selected.has(id)) d.selected.delete(id);
      else d.selected.add(id);
      this._renderSceneForm();
    });
    top.append(i, t, sw);
    wrap.appendChild(top);
    if (!inScene) return wrap;

    const v = d.values[id] || ElvioScenes.capture([id], hass.states)[id] || { state: "off" };
    const domain = id.split(".")[0];
    const ctl = el("div", "esc-ctl");
    const set = (change) => {
      d.values[id] = domain === "light" ? ElvioScenes.edit(d.values[id] || v, change) : { ...(d.values[id] || v), ...change };
    };
    const isOn = domain === "cover" ? v.state !== "closed" : v.state === "on";
    const seg = el("div", "seg");
    for (const [label, state] of domain === "cover" ? [["Offen", "open"], ["Zu", "closed"]] : [["An", "on"], ["Aus", "off"]]) {
      const b = el("button", "", label);
      b.classList.toggle("on", (state === "on" || state === "open") === isOn);
      b.addEventListener("click", () => {
        set({ state });
        this._renderSceneForm();
      });
      seg.appendChild(b);
    }
    ctl.appendChild(seg);
    const range = (cls, min, max, value, fmt, apply) => {
      const box = el("label", `esc-range ${cls}`);
      const input = el("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.value = String(value);
      const out = el("span", "", fmt(value));
      input.addEventListener("input", () => (out.textContent = fmt(Number(input.value))));
      input.addEventListener("change", () => apply(Number(input.value)));
      box.append(input, out);
      return box;
    };
    if (domain === "light" && isOn) {
      const caps = ElvioScenes.lightCaps(st);
      if (caps.dim) ctl.appendChild(range("bri", 1, 100, ElvioScenes.pct(v.brightness), (x) => `${x} %`, (x) => set({ brightness: ElvioScenes.bri(x) })));
      if (caps.temp) {
        const k = v.color_temp_kelvin || Math.round((caps.temp.min + caps.temp.max) / 2);
        ctl.appendChild(range("temp", caps.temp.min, caps.temp.max, k, (x) => `${x} K`, (x) => set({ color_temp_kelvin: x })));
      }
      if (caps.color) {
        const dots = el("div", "esc-dots");
        for (const [name, hs] of SCENE_COLORS) {
          const dot = el("button", "esc-dot");
          dot.setAttribute("aria-label", name);
          dot.style.background = `hsl(${hs[0]}, ${hs[1]}%, 55%)`;
          dot.classList.toggle("on", v.color_mode === "hs" && Array.isArray(v.hs_color) && v.hs_color[0] === hs[0]);
          dot.addEventListener("click", () => {
            set({ hs_color: hs });
            this._renderSceneForm();
          });
          dots.appendChild(dot);
        }
        ctl.appendChild(dots);
      }
    }
    if (domain === "cover" && isOn) {
      ctl.appendChild(range("bri", 0, 100, v.current_position != null ? v.current_position : 100, (x) => `${x} %`, (x) => set({ state: "open", current_position: x })));
    }
    wrap.appendChild(ctl);
    return wrap;
  }

  _renderSceneIconPick() {
    const d = this._sceneDraft;
    this._editTitle.textContent = "Symbol wählen";
    this._editHint.textContent = "";
    const grid = el("div", "iconpick");
    for (const name of SCENE_ICONS) {
      const b = el("button", "ipick");
      b.classList.toggle("on", d.icon === name);
      b.setAttribute("aria-label", name.replace("mdi:", ""));
      b.appendChild(icon(name));
      b.addEventListener("click", () => {
        d.icon = name;
        this._sceneView = "main";
        this._renderSceneForm();
      });
      grid.appendChild(b);
    }
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._sceneView = "main";
      this._renderSceneForm();
    });
    this._editList.append(grid, back);
  }

  _renderSceneDelete() {
    const d = this._sceneDraft;
    this._editTitle.textContent = "Szene löschen";
    this._editHint.textContent = "";
    const box = el("div", "cbox");
    box.append(icon("mdi:delete-outline"), el("div", "ctitle", `„${d.name}“ löschen?`), el("div", "ctext", "Die Lichter bleiben, wie sie sind – nur die Szene verschwindet."));
    const go = el("button", "pbtn edangerbtn", "Löschen");
    go.addEventListener("click", () => this._deleteScene(go));
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._sceneView = "main";
      this._renderSceneForm();
    });
    box.append(go, back);
    this._editList.appendChild(box);
  }

  // Speichern wie der Szenen-Editor von HA (Szenen-Datei, HA lädt danach neu). Eine neue
  // Szene im Raum bekommt danach den Bereich – erst dann gibt es ihre Entität.
  async _saveScene(btn) {
    const d = this._sceneDraft;
    const name = d.name.trim();
    if (!name) return this._roomFormError("Bitte einen Namen eingeben.");
    const entities = this._sceneEntities(d);
    if (!Object.keys(entities).length) return this._roomFormError("Bitte mindestens ein Licht oder Gerät in die Szene nehmen.");
    this._editMsg.hidden = true;
    btn.disabled = true;
    const id = d.configId || String(Date.now());
    try {
      await this._hass.callApi("POST", `config/scene/config/${id}`, { id, name, icon: d.icon, entities });
      if (!d.entityId && d.areaId) {
        const eid = await this._waitForScene(id);
        if (!eid) throw new Error("Szene gespeichert, erscheint aber nicht – steht „scene: !include scenes.yaml“ in der configuration.yaml?");
        await this._hass.callWS({ type: "config/entity_registry/update", entity_id: eid, area_id: d.areaId });
      }
      this._sceneDraft = null;
      this._editWrap.hidden = true;
    } catch (err) {
      btn.disabled = false;
      this._roomFormError(`Nicht gespeichert: ${setupErrText(err)}`);
    }
  }

  async _waitForScene(configId) {
    for (let i = 0; i < 40; i++) {
      const st = Object.values(this._hass.states).find((x) => x.entity_id.startsWith("scene.") && String(x.attributes.id) === configId);
      if (st) return st.entity_id;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  async _deleteScene(btn) {
    btn.disabled = true;
    this._editMsg.hidden = true;
    try {
      await this._hass.callApi("DELETE", `config/scene/config/${this._sceneDraft.configId}`);
      this._sceneDraft = null;
      this._editWrap.hidden = true;
    } catch (err) {
      btn.disabled = false;
      this._roomFormError(`Nicht gelöscht: ${setupErrText(err)}`);
    }
  }

  // ───────────── Hinweise ─────────────

  // Hinweise jetzt (mit Ausgeblendeten, markiert). Neu gerechnet bei jedem neuen Zustand, sonst
  // höchstens einmal je Minute (die 5 Minuten bis „nicht erreichbar“ laufen auch ohne Änderung).
  _notices() {
    const hass = this._hass;
    const now = Date.now();
    const admin = this._isAdmin();
    if (admin && (!this._repairsAt || now - this._repairsAt > 10 * 60 * 1000)) {
      this._repairsAt = now;
      hass.callWS({ type: "repairs/list_issues" }).then(
        (r) => {
          const n = ((r && r.issues) || []).filter((i) => !i.ignored).length;
          if (n !== (this._repairsCount || 0)) {
            this._repairsCount = n;
            this._noticeCache = null;
          }
        },
        () => {},
      );
    }
    const c = this._noticeCache;
    if (c && c.states === hass.states && now - c.at < 60000) return c.list;
    const weather = (this._tiles || []).find((t) => t.cfg && t.cfg.type === "weather");
    const list = ElvioNotices.collect({
      states: hass.states, entities: hass.entities || {}, devices: hass.devices || {}, areas: hass.areas || {},
      now, ignore: this._noticeIgnore(), admin, rainText: (weather && weather.rainText) || "", repairs: this._repairsCount || 0,
    });
    this._noticeCache = { states: hass.states, at: now, list };
    return list;
  }

  _noticeIgnore() {
    const d = this._dashboardConfig();
    if (d) this._noticeCfgLast = d;
    const n = ((d || this._noticeCfgLast || {}).elvio_notices) || {};
    return Array.isArray(n.ignore) ? n.ignore : [];
  }

  _openNotices() {
    this._editMode = "notices";
    this._noticesKey = null;
    this._noticeCache = null;
    this._editActions.replaceChildren();
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderNotices();
  }

  _renderNotices(soft = false) {
    if (this._editMode !== "notices" || this._editWrap.hidden) return;
    const all = this._notices();
    const admin = this._isAdmin();
    const key = JSON.stringify([all, admin, !!this._noticesIgnoredOpen]);
    if (soft && key === this._noticesKey) return;
    this._noticesKey = key;
    const list = this._editList;
    list.innerHTML = "";
    const shown = all.filter((n) => !n.ignored);
    const hidden = all.filter((n) => n.ignored);
    this._editTitle.textContent = "Hinweise";
    this._editHint.textContent = shown.length ? "Was im Haus gerade nicht stimmt. Antippen zeigt mehr." : "";
    if (!shown.length) {
      const box = el("div", "cbox");
      box.append(icon("mdi:check-circle-outline"), el("div", "ctitle", "Alles in Ordnung"), el("div", "ctext", hidden.length ? `${hidden.length} ausgeblendet` : "Keine Hinweise."));
      list.appendChild(box);
    }
    const row = (n, isHidden) => {
      const r = this._infoRow(NOTICE_ICONS[n.kind] || "mdi:alert-circle-outline", n.title, n.sub, `notice ${n.kind}${isHidden ? " ignored" : ""}`);
      const t = r.querySelector(".etext");
      if (n.entity || n.path) {
        t.classList.add("elink");
        t.addEventListener("click", () => this._noticeGo(n));
      }
      if (admin) {
        const b = el("button", "stextbtn emove", isHidden ? "Wieder zeigen" : "Ausblenden");
        b.addEventListener("click", () => this._ignoreNotice(n.key, !isHidden, b));
        r.appendChild(b);
      }
      return r;
    };
    for (const n of shown) list.appendChild(row(n, false));
    if (hidden.length && admin) {
      const open = !!this._noticesIgnoredOpen;
      list.appendChild(this._foldButton(`Ausgeblendet (${hidden.length})`, open, () => {
        this._noticesIgnoredOpen = !open;
        this._renderNotices();
      }));
      if (open) for (const n of hidden) list.appendChild(row(n, true));
    }
  }

  _noticeGo(n) {
    this._editWrap.hidden = true;
    if (n.entity) this._moreInfo(n.entity);
    else if (n.path) {
      this._confirmPath = n.path;
      this._confirmWrap.hidden = false;
    }
  }

  // Ausblenden steht im Dashboard (elvio_notices.ignore) und gilt für alle Tablets damit.
  async _ignoreNotice(key, on, btn) {
    btn.disabled = true;
    this._editMsg.hidden = true;
    const dash = this._dashPath();
    const urlPath = dash === "lovelace" ? null : dash;
    try {
      const cfg = await this._hass.callWS({ type: "lovelace/config", url_path: urlPath });
      const cur = new Set(((cfg.elvio_notices || {}).ignore) || []);
      if (on) cur.add(key);
      else cur.delete(key);
      if (cur.size) cfg.elvio_notices = { ...(cfg.elvio_notices || {}), ignore: [...cur] };
      else delete cfg.elvio_notices;
      reopenSheet = { mode: "notices", path: location.pathname, at: Date.now() };
      await this._hass.callWS({ type: "lovelace/config/save", url_path: urlPath, config: cfg });
      this._noticeCfgLast = cfg;
      this._noticeCache = null;
      this._renderNotices();
    } catch (err) {
      reopenSheet = null;
      btn.disabled = false;
      this._roomFormError(`Nicht gespeichert: ${setupErrText(err)}`);
    }
  }

  // ───────────── Haus verlassen ─────────────

  _openLeave() {
    this._leaveView = "check";
    this._leaveDraft = null;
    this._leaveKey = null;
    this._editMode = "leave";
    this._editActions.replaceChildren();
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderLeave();
  }

  _leaveSettings() {
    const d = this._dashboardConfig();
    if (d) this._leaveCfgLast = d;
    return ElvioLeave.settings(d || this._leaveCfgLast || null);
  }

  // Eine Zeile ohne Bedienung: Symbol, Text, Zusatz.
  _infoRow(ic, title, sub, cls = "") {
    const r = el("div", `erow ${cls}`);
    const i = el("div", "eicon");
    i.appendChild(icon(ic));
    const t = el("div", "etext");
    t.append(el("div", "sname", title), el("div", "ssub", sub || ""));
    r.append(i, t);
    return r;
  }

  // Prüfliste: was offen ist, was ausgeht. soft: nur neu zeichnen, wenn sich etwas geändert hat
  // (wird bei jedem Update aufgerufen, damit die Liste stimmt).
  _renderLeave(soft = false) {
    if (this._editMode !== "leave" || this._editWrap.hidden) return;
    if (this._leaveView === "settings") {
      if (!soft) this._renderLeaveSettings();
      return;
    }
    const hass = this._hass;
    const settings = this._leaveSettings();
    const plan = ElvioLeave.plan(hass.states, settings);
    const open = this._openThings();
    const admin = this._isAdmin();
    const key = JSON.stringify([this._leaveView, plan, open.map((st) => st.entity_id), settings, admin]);
    if (soft && key === this._leaveKey) return;
    this._leaveKey = key;
    const list = this._editList;
    list.innerHTML = "";
    this._editTitle.textContent = "Haus verlassen";
    if (this._leaveView === "done") {
      this._editHint.textContent = "";
      const box = el("div", "cbox");
      box.append(icon("mdi:check-circle-outline"), el("div", "ctitle", "Erledigt"), el("div", "ctext", "Alles aus – bis später."));
      list.appendChild(box);
      return;
    }
    this._editHint.textContent = "Kurz prüfen, dann alles aus.";
    if (open.length) {
      list.appendChild(el("div", "esub", "Noch offen"));
      for (const st of open) {
        list.appendChild(this._infoRow(this._defaultIcon(st) === "mdi:information-outline" ? "mdi:door-open" : this._defaultIcon(st), st.attributes.friendly_name || st.entity_id, "offen – bitte schließen", "warn"));
      }
    }
    const names = (ids) => ids.map((id) => this._friendly(id));
    const short = (arr) => (arr.length > 4 ? `${arr.slice(0, 4).join(", ")} …` : arr.join(", "));
    list.appendChild(el("div", "esub", "Wird ausgeschaltet"));
    const n = plan.lights.length;
    list.appendChild(this._infoRow("mdi:lightbulb-group-outline", n ? `${n} ${n === 1 ? "Licht" : "Lichter"} an` : "Alle Lichter sind aus", short(names(plan.lights))));
    if (settings.switches.length) {
      const k = plan.switches.length;
      list.appendChild(
        this._infoRow("mdi:power-socket-de", k ? `${k} ${k === 1 ? "Steckdose" : "Steckdosen"} an` : "Gewählte Steckdosen sind aus", short(names(settings.switches))),
      );
    }
    if (settings.media) {
      list.appendChild(this._infoRow("mdi:music", plan.playing.length ? "Musik läuft – wird angehalten" : "Keine Musik an", short(names(plan.playing))));
    }
    if (settings.auto) list.appendChild(el("div", "ehint", "Automatisch: Ist 10 Minuten niemand zuhause, geht das von selbst."));
    const go = el("button", "pbtn unlock esave", "Alles aus");
    go.addEventListener("click", () => this._runLeave(go));
    list.appendChild(go);
    if (admin) {
      const set = el("button", "stextbtn emeta", "Einstellen");
      set.addEventListener("click", () => {
        this._leaveView = "settings";
        this._renderLeave();
      });
      list.appendChild(set);
    }
  }

  async _runLeave(btn) {
    const hass = this._hass;
    btn.disabled = true;
    this._editMsg.hidden = true;
    try {
      if (hass.states[`script.${LEAVE_SCRIPT}`]) {
        await hass.callService("script", "turn_on", { entity_id: `script.${LEAVE_SCRIPT}` });
      } else {
        // Noch nicht eingestellt: alle Lichter aus, laufende Musik anhalten.
        await hass.callService("light", "turn_off", { entity_id: "all" });
        const playing = ElvioLeave.plan(hass.states, { switches: [], media: true }).playing;
        if (playing.length) await hass.callService("media_player", "media_pause", { entity_id: playing }).catch(() => {});
      }
      this._leaveView = "done";
      this._renderLeave();
      setTimeout(() => {
        if (this._editMode === "leave" && this._leaveView === "done") this._editWrap.hidden = true;
      }, 2500);
    } catch (err) {
      btn.disabled = false;
      this._roomFormError(`Nicht ausgeführt: ${setupErrText(err)}`);
    }
  }

  _renderLeaveSettings() {
    const hass = this._hass;
    if (!this._leaveDraft) {
      const cur = this._leaveSettings();
      this._leaveDraft = { ...cur, switches: [...cur.switches] };
    }
    const d = this._leaveDraft;
    const list = this._editList;
    list.innerHTML = "";
    this._editTitle.textContent = "Haus verlassen einstellen";
    this._editHint.textContent = "Wird als Skript „Haus verlassen“ in Home Assistant gespeichert – auch per Sprache und in Automationen nutzbar.";
    const toggleRow = (ic, title, sub, on, flip) => {
      const r = this._infoRow(ic, title, sub);
      const sw = el("button", "lswitch");
      sw.classList.toggle("on", on);
      sw.addEventListener("click", () => {
        flip();
        this._renderLeaveSettings();
      });
      r.appendChild(sw);
      return r;
    };
    list.appendChild(el("div", "esub", "Steckdosen ausschalten"));
    const reg = hass.entities || {};
    const areaName = (id) => {
      const a = this._entityArea(reg[id]);
      return a ? ((hass.areas || {})[a] || {}).name || a : "Ohne Raum";
    };
    const sockets = Object.values(reg)
      .filter((e) => e.entity_id.startsWith("switch.") && !e.hidden && !e.entity_category && hass.states[e.entity_id])
      .filter((e) => !LEAVE_SKIP_PLATFORMS.includes(e.platform) || d.switches.includes(e.entity_id))
      .map((e) => e.entity_id)
      .filter((id) => !/^reserve/i.test(this._friendly(id)) || d.switches.includes(id))
      .sort((a, b) => areaName(a).localeCompare(areaName(b), "de") || this._friendly(a).localeCompare(this._friendly(b), "de"));
    const socketRow = (id) =>
      toggleRow("mdi:power-socket-de", this._friendly(id), areaName(id), d.switches.includes(id), () => {
        d.switches = d.switches.includes(id) ? d.switches.filter((x) => x !== id) : [...d.switches, id];
      });
    // Schalter in Räumen zuerst; ohne Raum eingeklappt (oft Technik oder noch nicht zugeordnet).
    const inRoom = sockets.filter((id) => this._entityArea(reg[id]));
    const homeless = sockets.filter((id) => !this._entityArea(reg[id]));
    if (!sockets.length) list.appendChild(el("div", "ehint", "Keine Steckdosen gefunden."));
    for (const id of inRoom) list.appendChild(socketRow(id));
    if (homeless.length) {
      const open = this._leaveHomelessOpen || homeless.some((id) => d.switches.includes(id));
      list.appendChild(this._foldButton(`Ohne Raum (${homeless.length})`, open, () => {
        this._leaveHomelessOpen = !open;
        this._renderLeaveSettings();
      }));
      if (open) for (const id of homeless) list.appendChild(socketRow(id));
    }
    list.appendChild(el("div", "esub", "Weiteres"));
    list.appendChild(toggleRow("mdi:music", "Musik anhalten", "Laufende Lautsprecher pausieren", d.media, () => (d.media = !d.media)));
    const nobody = this._people(true).every((p) => p.place.kind === "unknown");
    list.appendChild(
      toggleRow(
        "mdi:account-arrow-right-outline",
        "Automatisch, wenn alle weg sind",
        "Nach 10 Minuten ohne Person zuhause. Nur, wenn jeder Bewohner ein Handy mit Standort hat – sonst geht das Licht aus, während jemand ohne Handy da ist.",
        d.auto,
        () => (d.auto = !d.auto),
      ),
    );
    if (d.auto && nobody) list.appendChild(el("div", "ehint", "Gerade meldet kein Handy einen Standort – die Automatik greift erst, wenn das eingerichtet ist."));
    const save = el("button", "pbtn unlock esave", "Speichern");
    save.addEventListener("click", () => this._saveLeave(save));
    const cancel = el("button", "stextbtn emeta", "Abbrechen");
    cancel.addEventListener("click", () => {
      this._leaveDraft = null;
      this._leaveView = "check";
      this._renderLeave();
    });
    list.append(save, cancel);
  }

  // Skript (und ggf. Automation) in HA schreiben, zuletzt die Einstellung ins Dashboard –
  // danach lädt HA das Dashboard neu.
  async _saveLeave(btn) {
    const d = this._leaveDraft;
    const hass = this._hass;
    btn.disabled = true;
    this._editMsg.hidden = true;
    try {
      const players = Object.values(hass.states)
        .filter((st) => st.entity_id.startsWith("media_player.") && ((st.attributes.supported_features || 0) & 1))
        .map((st) => st.entity_id);
      await hass.callApi("POST", `config/script/config/${LEAVE_SCRIPT}`, ElvioLeave.script({ ...d, players }));
      const hasAuto = Object.values(hass.states).some((st) => st.entity_id.startsWith("automation.") && st.attributes.id === LEAVE_AUTOMATION);
      if (d.auto) await hass.callApi("POST", `config/automation/config/${LEAVE_AUTOMATION}`, ElvioLeave.automation());
      else if (hasAuto) await hass.callApi("DELETE", `config/automation/config/${LEAVE_AUTOMATION}`);
      const dash = this._dashPath();
      const urlPath = dash === "lovelace" ? null : dash;
      const cfg = await hass.callWS({ type: "lovelace/config", url_path: urlPath });
      cfg.elvio_leave = { switches: d.switches, media: d.media, auto: d.auto };
      reopenSheet = { mode: "leave", path: location.pathname, at: Date.now() };
      await hass.callWS({ type: "lovelace/config/save", url_path: urlPath, config: cfg });
      this._leaveCfgLast = cfg;
      this._leaveDraft = null;
      this._leaveView = "check";
      this._renderLeave();
    } catch (err) {
      btn.disabled = false;
      this._roomFormError(`Nicht gespeichert: ${setupErrText(err)}`);
    }
  }

  // ───────────── Personen-Seite ─────────────
  // Wer ist wo: je Person Ort und „seit“, Handys mit Akku; darunter die Karte von HA mit
  // allen, deren Handy eine Position meldet. Aufbau wie die Energie-Seite.

  _buildPeople(frame) {
    const scroller = el("div", "scroller pscroller");
    scroller.hidden = true;
    const screen = el("section", "screen");
    const hero = el("section", "hero");
    this._peopleStatus = el("div", "status");
    hero.append(this._peopleStatus, el("h1", "", "Personen"));
    this._peopleFirst = el("div", "tiles");
    const more = el("button", "more");
    more.append(icon("mdi:chevron-down"), document.createTextNode("Mehr"));
    more.addEventListener("click", () => scroller.scrollTo({ top: screen.offsetHeight, behavior: "smooth" }));
    this._peopleMore = more;
    screen.append(hero, this._peopleFirst, more);
    this._peopleSections = el("div", "sections");
    scroller.append(screen, this._peopleSections);
    this._wireScroll(frame, scroller, screen);
    this._peopleWrap = scroller;
    this._peopleMapEl = null;
    this._peopleMapKey = null;
    return scroller;
  }

  _openPeople(keep = false) {
    if (!this._peopleWrap) return;
    const wasOpen = !this._peopleWrap.hidden;
    if (this._energyWrap && !this._energyWrap.hidden) {
      this._energyWrap.hidden = true;
      clearInterval(this._energyTimer);
    }
    this._peopleWrap.hidden = false;
    this._scroller.hidden = true;
    if (this._roomsNavWrap) this._roomsNavWrap.hidden = true;
    if (!wasOpen && !keep) {
      this._peopleWrap.scrollTop = 0;
      this._frame.style.setProperty("--p", "0");
      this._frame.classList.remove("scrolled");
    }
    this._markNav();
    this._peopleSig = null;
    this._renderPeople();
  }

  _closePeople() {
    if (!this._peopleWrap || this._peopleWrap.hidden) return;
    this._peopleWrap.hidden = true;
    this._scroller.hidden = false;
    this._markNav();
    this._scroller.dispatchEvent(new Event("scroll"));
  }

  _renderPeople() {
    if (!this._peopleWrap || this._peopleWrap.hidden) return;
    if (this._peopleMapEl) this._peopleMapEl.hass = this._hass;
    const list = this._people();
    // „seit 14:05“ hängt an der Uhr: höchstens einmal je Minute neu zeichnen.
    const sig = JSON.stringify(list) + Math.floor(Date.now() / 60000);
    if (sig === this._peopleSig) return;
    this._peopleSig = sig;
    const n = list.length;
    this._peopleStatus.textContent = ElvioPeople.summary(list) || `${n} ${n === 1 ? "Person" : "Personen"}`;
    const first = this._peopleFirst;
    first.innerHTML = "";
    first.style.setProperty("--cols", String(Math.max(1, Math.min(4, n))));
    list.forEach((p, i) => {
      const t = this._personTile(p);
      t.style.setProperty("--i", String(i));
      first.appendChild(t);
    });
    if (!n) first.appendChild(this._energyNote("Keine Personen am Tablet. Personen legt man in HA unter Einstellungen → Personen an."));
    const withPos = list.filter((p) => p.position).map((p) => p.id);
    const key = `${n}|${withPos.join(",")}`;
    if (key !== this._peopleMapKey) {
      this._peopleMapKey = key;
      const secs = this._peopleSections;
      secs.innerHTML = "";
      this._peopleMapEl = null;
      if (n) {
        const b = el("section", "section in shown");
        b.appendChild(el("h2", "", "Karte"));
        const tile = el("div", "tile ewide pmap");
        if (withPos.length) this._mountPeopleMap(tile, withPos);
        else tile.appendChild(el("div", "state", "Noch keine Positionen. In der Home-Assistant-App am Handy den Standortzugriff auf „Immer“ stellen – dann erscheinen die Personen hier."));
        b.appendChild(tile);
        secs.appendChild(b);
      }
      this._peopleMore.hidden = !secs.children.length;
    }
  }

  // Die Karte von HA selbst (hui-map-card) – dunkel, ohne Verlauf.
  async _mountPeopleMap(box, ids) {
    try {
      const helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
      if (!helpers) throw new Error("Kartenbausteine von HA fehlen");
      // Das Zuhause als Bezugspunkt dazu; flach genug, dass die Personen-Kacheln sichtbar bleiben.
      const entities = this._hass.states["zone.home"] ? [...ids, "zone.home"] : ids;
      const card = await helpers.createCardElement({ type: "map", entities, theme_mode: "dark", hours_to_show: 0, aspect_ratio: "2" });
      card.hass = this._hass;
      if (!box.isConnected) return;
      this._peopleMapEl = card;
      box.replaceChildren(card);
    } catch (err) {
      box.replaceChildren(el("div", "state", `Karte nicht verfügbar: ${(err && err.message) || err}`));
    }
  }

  _personTile(p) {
    const node = el("div", `tile person ${p.place.kind}`);
    const top = el("div", "ptop");
    const av = el("div", "pav");
    if (p.picture) {
      const img = el("img");
      img.alt = "";
      img.src = p.picture;
      av.appendChild(img);
    } else {
      av.textContent = p.initial;
    }
    const who = el("div", "pwho");
    const when = p.place.kind === "unknown" ? "Standort in der HA-App auf „Immer“ stellen" : ElvioPeople.since(p.since, Date.now());
    who.append(el("div", "name", p.name), el("div", "state", when));
    top.append(av, who);
    node.append(top, el("div", "pplace", p.place.label));
    if (p.phones.length) {
      const phones = el("div", "pphones");
      for (const ph of p.phones) {
        const chip = el("span", "pphone");
        chip.classList.toggle("low", ph.low);
        const b = ph.battery;
        const ic = ph.charging ? "mdi:battery-charging" : b == null ? "mdi:cellphone" : b >= 95 ? "mdi:battery" : `mdi:battery-${Math.max(10, Math.round(b / 10) * 10)}`;
        const label = b == null ? ph.name : p.phones.length > 1 ? `${ph.name} ${b} %` : `${b} %`;
        chip.append(icon(ic), document.createTextNode(label));
        chip.title = ph.name;
        phones.appendChild(chip);
      }
      node.appendChild(phones);
    }
    node.addEventListener("click", () => this._moreInfo(p.id));
    return node;
  }

  // ───────────── Kachel „Ansichten“: Energie und Personen ein/aus ─────────────

  _openViews() {
    this._editMode = "views";
    this._editActions.replaceChildren();
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderViews();
  }

  _renderViews() {
    if (this._editMode !== "views" || this._editWrap.hidden) return;
    const admin = this._isAdmin();
    this._editTitle.textContent = "Ansichten";
    this._editHint.textContent = admin
      ? "Was in der Leiste steht. Gilt für dieses Dashboard auf allen Tablets."
      : "Ändern geht nur mit Admin-Anmeldung.";
    const list = this._editList;
    list.innerHTML = "";
    const row = (pic, name, sub, on, toggle) => {
      const r = el("div", "erow");
      const ic = el("div", "eicon");
      if (pic && pic.startsWith("mdi:")) ic.appendChild(icon(pic));
      else if (pic) {
        const img = el("img", "ethumb");
        img.alt = "";
        img.src = pic;
        ic.appendChild(img);
      } else ic.textContent = name.trim().charAt(0).toUpperCase();
      const t = el("div", "etext");
      t.append(el("div", "sname", name), el("div", "ssub", sub));
      const sw = el("button", "lswitch");
      sw.classList.toggle("on", on);
      sw.disabled = !admin;
      sw.setAttribute("aria-label", on ? `${name} ausblenden` : `${name} zeigen`);
      sw.addEventListener("click", () => toggle(!on, sw));
      r.append(ic, t, sw);
      return r;
    };
    list.appendChild(el("div", "esub", "In der Leiste"));
    const energy = !!(this._energyN && ElvioEnergy.hasData(this._energyN));
    list.appendChild(
      row("mdi:lightning-bolt-outline", "Energie", energy ? "Bezug, Einspeisung, Verbraucher" : "Erscheint, sobald in HA-Energie etwas eingetragen ist",
        this._viewOn("energy"), (on, sw) => this._setView("energy", on, sw)),
    );
    list.appendChild(
      row("mdi:account-group-outline", "Personen", "Wer ist wo, Handy-Akku, Karte", this._viewOn("people"), (on, sw) => this._setView("people", on, sw)),
    );
    const people = this._people(true);
    if (people.length) {
      list.appendChild(el("div", "esub", "Personen am Tablet"));
      for (const p of people) list.appendChild(row(p.picture, p.name, p.place.label, !p.hidden, (on, sw) => this._setPersonShown(p.id, on, sw)));
    }
  }

  // Schreibt elvio_views in die Konfiguration dieses Dashboards (nur Admins; YAML-Dashboards
  // lassen sich so nicht ändern – dann steht der Grund da).
  async _setView(key, on, sw) {
    this._editMsg.hidden = true;
    sw.disabled = true;
    const dash = this._dashPath();
    const urlPath = dash === "lovelace" ? null : dash;
    try {
      const cfg = await this._hass.callWS({ type: "lovelace/config", url_path: urlPath });
      const views = { ...(cfg.elvio_views || {}) };
      if (on) delete views[key];
      else views[key] = false;
      if (Object.keys(views).length) cfg.elvio_views = views;
      else delete cfg.elvio_views;
      reopenSheet = { mode: "views", path: location.pathname, at: Date.now() };
      await this._hass.callWS({ type: "lovelace/config/save", url_path: urlPath, config: cfg });
      this._viewPrefsLast = views;
      sw.classList.toggle("on", on);
    } catch (err) {
      this._editMsg.textContent = `Nicht gespeichert: ${setupErrText(err)}`;
      this._editMsg.hidden = false;
    } finally {
      sw.disabled = false;
    }
  }

  async _setPersonShown(id, on, sw) {
    this._editMsg.hidden = true;
    sw.disabled = true;
    try {
      await this._ensureLabels();
      const e = (this._hass.entities || {})[id] || {};
      const labels = (e.labels || []).filter((l) => l !== LABEL_HIDE.id);
      if (!on) labels.push(LABEL_HIDE.id);
      await this._hass.callWS({ type: "config/entity_registry/update", entity_id: id, labels });
    } catch (err) {
      this._editMsg.textContent = `Nicht gespeichert: ${setupErrText(err)}`;
      this._editMsg.hidden = false;
    } finally {
      sw.disabled = false;
    }
  }

  // ───────────── Energie-Seite ─────────────
  // Liest, was in HA-Energie eingetragen ist; jeder Teil erscheint nur mit Daten. Nur Anzeige.

  _ensureEnergy(force) {
    this._energyAt = Date.now();
    loadEnergyPrefs(this._hass, force).then((n) => this._applyEnergy(n), () => {});
  }

  // Neuer Stand aus HA-Energie: „Energie“ in der Leiste erscheint bzw. verschwindet sofort.
  _applyEnergy(n) {
    this._energyN = n;
    const has = ElvioEnergy.hasData(n);
    if (has === !!this._energyNav) return;
    this._energyNav = has;
    if (this._built && (this._config.nav || []).length) this._rebuildKeepingPlace();
  }

  _energyCandidates(prefs) {
    const hass = this._hass;
    const n = ElvioEnergy.normalize(prefs);
    const existing = [
      ...n.devices.map((d) => d.stat), ...n.gridIn, ...n.gridOut, ...n.solar, ...n.batteryIn, ...n.batteryOut, ...n.home,
    ];
    return ElvioEnergy.consumerCandidates({ entities: Object.values(hass.entities || {}), states: hass.states, devices: hass.devices || {}, existing });
  }

  // Die Energie-Seite ist eine eigene „Ansicht“ in der Karte: Kopfzeile und Hintergrund
  // bleiben, statt Titel und Kacheln der Ansicht stehen dort „Energie“ und ihre Kacheln – im
  // selben Aufbau (erster Bildschirm, darunter „Mehr“). Ein anderer Leisten-Eintrag schaltet zurück.
  _buildEnergy(frame) {
    const scroller = el("div", "scroller escroller");
    scroller.hidden = true;
    const screen = el("section", "screen");
    const hero = el("section", "hero");
    this._energyStatus = el("div", "status");
    const chips = el("div", "chips eperiods");
    for (const p of ENERGY_PERIODS) {
      const chip = el("button", "chip eper", p.label);
      chip.dataset.key = p.key;
      chip.addEventListener("click", () => {
        if (this._energyPeriod === p.key) return;
        this._energyPeriod = p.key;
        this._renderEnergy();
        this._loadEnergyData();
      });
      chips.appendChild(chip);
    }
    this._energyChips = chips;
    hero.append(this._energyStatus, el("h1", "", "Energie"), chips);
    this._energyMsg = el("div", "emsg");
    this._energyMsg.hidden = true;
    this._energyFirst = el("div", "tiles");
    const more = el("button", "more");
    more.append(icon("mdi:chevron-down"), document.createTextNode("Mehr"));
    more.addEventListener("click", () => scroller.scrollTo({ top: screen.offsetHeight, behavior: "smooth" }));
    this._energyMore = more;
    screen.append(hero, this._energyMsg, this._energyFirst, more);
    this._energySections = el("div", "sections");
    scroller.append(screen, this._energySections);
    this._wireScroll(frame, scroller, screen);
    this._energyWrap = scroller;
    return scroller;
  }

  _openEnergy(keep = false) {
    if (!this._energyWrap) return;
    const wasOpen = !this._energyWrap.hidden;
    if (this._peopleWrap) this._peopleWrap.hidden = true;
    this._energyWrap.hidden = false;
    this._scroller.hidden = true;
    if (this._roomsNavWrap) this._roomsNavWrap.hidden = true;
    if (!wasOpen) {
      this._energyShown = new Set();
      this._energyWrap.scrollTop = 0;
      this._frame.style.setProperty("--p", "0");
      this._frame.classList.remove("scrolled");
      this._energyConsAll = false;
    }
    this._markNav();
    this._energyPeriod = this._energyPeriod || "day";
    this._energyMsg.hidden = true;
    clearInterval(this._energyTimer);
    this._energyTimer = setInterval(() => this._loadEnergyData(), ENERGY_REFRESH_MS);
    this._renderEnergy();
    if (keep && this._energyN) {
      this._loadEnergyData();
      return;
    }
    loadEnergyPrefs(this._hass, true).then(
      (n) => {
        this._applyEnergy(n);
        this._renderEnergy();
        this._loadEnergyData();
      },
      (err) => this._energyError(err),
    );
  }

  _closeEnergy() {
    if (!this._energyWrap || this._energyWrap.hidden) return;
    this._energyWrap.hidden = true;
    this._scroller.hidden = false;
    clearInterval(this._energyTimer);
    this._markNav();
    // Übergänge wieder nach dem Stand der Ansicht.
    this._scroller.dispatchEvent(new Event("scroll"));
  }

  _energyError(err) {
    this._energyMsg.textContent = `Energie nicht geladen: ${(err && err.message) || err}`;
    this._energyMsg.hidden = false;
  }

  // Summen (statistic_during_period, genau bis jetzt) und Verlauf (statistics_during_period,
  // je Stunde/Tag/Monat) für den gewählten Zeitraum. Ein späteres Laden gewinnt.
  async _loadEnergyData() {
    const n = this._energyN;
    if (!n || !this._energyWrap || this._energyWrap.hidden || !ElvioEnergy.hasData(n)) return;
    const hass = this._hass;
    const period = this._energyPeriod;
    const range = ElvioEnergy.periodRange(period, Date.now());
    const buckets = ElvioEnergy.buckets(range);
    const token = (this._energyToken = (this._energyToken || 0) + 1);
    const span = { start_time: new Date(range.start).toISOString(), end_time: new Date(range.end).toISOString() };
    const units = { energy: "kWh" };
    const ids = [...new Set([
      ...n.gridIn, ...n.gridOut, ...n.solar, ...n.batteryIn, ...n.batteryOut, ...n.home, ...n.cost, ...n.compensation,
      ...n.devices.map((d) => d.stat),
    ])];
    const seriesIds = [...new Set([...n.gridIn, ...n.gridOut, ...n.solar, ...n.devices.filter((d) => !d.includedIn).map((d) => d.stat)])];
    try {
      const changes = {};
      await Promise.all(
        ids.map((id) =>
          hass
            .callWS({ type: "recorder/statistic_during_period", statistic_id: id, fixed_period: span, types: ["change"], units })
            .then(
              (r) => (changes[id] = r && Number.isFinite(r.change) ? r.change : null),
              () => (changes[id] = null),
            ),
        ),
      );
      const stats = seriesIds.length
        ? await hass.callWS({ type: "recorder/statistics_during_period", ...span, statistic_ids: seriesIds, period: range.bucket, types: ["change"], units })
        : {};
      if (token !== this._energyToken) return;
      this._energyData = { period, range, buckets, changes, stats };
      this._energyMsg.hidden = true;
      this._renderEnergy();
    } catch (err) {
      if (token === this._energyToken) this._energyError(err);
    }
  }

  _renderEnergy() {
    if (!this._energyWrap || this._energyWrap.hidden) return;
    for (const c of this._energyChips.children) c.classList.toggle("active", c.dataset.key === this._energyPeriod);
    const first = this._energyFirst;
    const secs = this._energySections;
    first.innerHTML = "";
    secs.innerHTML = "";
    this._energyFlow = null;
    this._energyConsW = [];
    this._energyNowVal = null;
    const row = (nodes) => {
      const units = nodes.reduce((a, x) => a + (Number(x.style.getPropertyValue("--span")) || 1), 0);
      first.style.setProperty("--cols", String(Math.max(1, Math.min(4, units))));
      nodes.forEach((x, i) => x.style.setProperty("--i", String(i)));
      first.append(...nodes);
    };
    const n = this._energyN;
    if (!n || !ElvioEnergy.hasData(n)) {
      const note = this._energyNote(n ? "In Home Assistant ist noch keine Energie eingetragen (Einstellungen → Dashboards → Energie)." : "Wird geladen …");
      if (n && this._isAdmin()) {
        const b = pillButton("mdi:auto-fix", "Einrichtung öffnen");
        b.addEventListener("click", () => this._openSetup());
        note.appendChild(b);
      }
      row([note]);
      this._energyMore.hidden = true;
      this._energyStatus.textContent = "";
      return;
    }
    const r = n.rates;
    const hasFlow = !!(r.grid.length || r.solar.length || r.battery.length || r.home.length);
    const d = this._energyData;
    const ready = !!(d && d.period === this._energyPeriod);
    const change = (id) => (ready && id in d.changes ? d.changes[id] : null);
    const t = ready ? ElvioEnergy.totals(n, change) : null;
    const rank = ready ? ElvioEnergy.ranking(n, change, (id) => this._watts(id), (id) => this._friendly(id)) : [];
    const totals = ready ? this._energyTotalTiles(n, t, rank) : [];
    const firstRow = [];
    if (hasFlow) {
      const ft = el("div", "tile eflowtile");
      ft.style.setProperty("--span", "2");
      ft.appendChild(this._energyFlowNode(n));
      firstRow.push(ft, ...totals.slice(0, 2));
    } else if (ready) {
      firstRow.push(...this._energyDeviceTiles(n, rank));
    }
    if (!ready) firstRow.push(this._energyNote("Werte werden geladen …"));
    row(firstRow);
    // Abschnitte blenden wie in den Ansichten beim Hineinscrollen ein – aber nur einmal je
    // Öffnen; das Nachladen alle 5 Minuten lässt Sichtbares stehen.
    const shown = (this._energyShown = this._energyShown || new Set());
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (!e.isIntersecting) continue;
                e.target.classList.add("in");
                shown.add(e.target.dataset.key);
                io.unobserve(e.target);
              }
            },
            { root: this._energyWrap, threshold: 0.15 },
          )
        : null;
    const section = (title, content, key = title) => {
      const b = el("section", "section");
      b.dataset.key = key;
      b.append(el("h2", "", title), content);
      secs.appendChild(b);
      if (shown.has(key)) b.classList.add("in", "shown");
      else if (io) io.observe(b);
      else b.classList.add("in");
    };
    if (ready) {
      const rest = totals.slice(hasFlow ? 2 : 0);
      if (hasFlow && rest.length) {
        const g = el("div", "tiles");
        g.style.setProperty("--cols", String(Math.min(4, rest.length)));
        g.append(...rest);
        section({ day: "Heute", week: "Diese Woche", month: "Dieser Monat", year: "Dieses Jahr" }[this._energyPeriod], g, "totals");
      }
      const chart = el("div", "tile ewide");
      chart.appendChild(this._energyChartNode(n, ElvioEnergy.series(n, d.stats, d.buckets), d.range));
      section("Verlauf", chart);
      if (rank.length) {
        const list = el("div", "tile ewide");
        list.appendChild(this._energyConsumersNode(rank));
        section("Verbraucher", list);
      }
    }
    this._energyMore.hidden = !secs.children.length;
    this._renderEnergyLive();
  }

  _energyNote(text) {
    const note = el("div", "tile enote");
    note.appendChild(el("div", "state", text));
    return note;
  }

  // Kachel mit Bezeichnung, großem Wert und Zusatz – im Stil der übrigen Kacheln.
  _energyTile(ic, label, value, sub, id) {
    const node = el("div", "tile etot");
    const text = el("div", "text");
    const val = el("div", "etot-val", value);
    text.append(el("div", "name", label), val, el("div", "state", sub || ""));
    const i = el("div", "icon");
    i.appendChild(icon(ic));
    node.append(text, i);
    if (id) node.addEventListener("click", () => this._moreInfo(id));
    else node.classList.add("static");
    return { node, val };
  }

  _energyTotalTiles(n, t, rank) {
    const cur = (this._hass.config && this._hass.config.currency) || "EUR";
    const money = (x) => (x == null ? null : x.toLocaleString("de-DE", { style: "currency", currency: cur }));
    const pct = (x) => `${Math.round(x * 100)} %`;
    const out = [];
    const add = (...a) => out.push(this._energyTile(...a).node);
    if (t.gridIn != null) add("mdi:transmission-tower-export", "Bezug", fmtKwh(t.gridIn), money(t.cost) || "aus dem Netz", n.gridIn[0]);
    if (t.gridOut != null) add("mdi:transmission-tower-import", "Einspeisung", fmtKwh(t.gridOut), money(t.compensation) || "ins Netz", n.gridOut[0]);
    if (t.solar != null) add("mdi:solar-power-variant-outline", "Solar", fmtKwh(t.solar), "erzeugt", n.solar[0]);
    if (t.home != null) add("mdi:home-lightning-bolt-outline", "Verbrauch", fmtKwh(t.home), "im Haus", n.home[0]);
    if (t.batteryIn != null || t.batteryOut != null) {
      add("mdi:home-battery-outline", "Batterie", `${fmtKwh(t.batteryIn || 0)} rein`, `${fmtKwh(t.batteryOut || 0)} raus`, n.batteryIn[0] || n.batteryOut[0]);
    }
    if (t.autarky != null) add("mdi:shield-home-outline", "Autarkie", pct(t.autarky), "selbst versorgt");
    if (t.selfUse != null) add("mdi:solar-power", "Eigenverbrauch", pct(t.selfUse), "Solarstrom selbst genutzt");
    return out;
  }

  // Ohne Zähler (nur Verbraucher eingetragen): Verbrauch im Zeitraum, Leistung jetzt und
  // der größte Verbraucher.
  _energyDeviceTiles(n, rank) {
    const top = n.devices.filter((d) => !d.includedIn).map((d) => d.stat);
    const sum = rank.filter((x) => top.includes(x.stat) && x.kwh != null).reduce((a, x) => a + x.kwh, 0);
    const word = { day: "heute", week: "diese Woche", month: "diesen Monat", year: "dieses Jahr" }[this._energyPeriod];
    const out = [this._energyTile("mdi:counter", "Verbrauch", fmtKwh(sum), `${top.length} Geräte ${word}`).node];
    if (n.devices.some((d) => d.rate)) {
      const now = this._energyTile("mdi:flash-outline", "Jetzt", "–", "alle Verbraucher");
      this._energyNowVal = now.val;
      out.push(now.node);
    }
    const best = rank.find((x) => x.kwh > 0);
    if (best) out.push(this._energyTile("mdi:trophy-outline", "Am meisten", fmtKwh(best.kwh), best.name, best.stat).node);
    return out;
  }

  // Fluss jetzt: Haus in der Mitte, Solar oben, Netz links, Batterie rechts. Die Linien
  // laufen in Richtung des Stroms.
  _energyFlowNode(n) {
    const r = n.rates;
    const box = el("div", "eflow");
    box.classList.toggle("nosolar", !r.solar.length);
    const first = (specs) => (specs[0] && (specs[0].plus[0] || specs[0].minus[0])) || null;
    const node = (key, ic, label, id) => {
      const b = el("button", `enode ${key}`);
      const c = el("div", "enode-ic");
      c.appendChild(icon(ic));
      const v = el("div", "enode-val", "–");
      const sub = el("div", "enode-sub", label);
      b.append(c, v, sub);
      if (id) b.addEventListener("click", () => this._moreInfo(id));
      box.appendChild(b);
      return { b, v, sub };
    };
    const line = (key) => {
      const l = el("div", `eline ${key}`);
      box.appendChild(l);
      return l;
    };
    const f = { home: node("home", "mdi:home-lightning-bolt-outline", "Haus", first(r.home)) };
    if (r.solar.length) {
      f.solar = node("solar", "mdi:solar-power-variant-outline", "Solar", first(r.solar));
      f.solarLine = line("l-solar");
    }
    if (r.grid.length) {
      f.grid = node("grid", "mdi:transmission-tower", "Netz", first(r.grid));
      f.gridLine = line("l-grid");
    }
    if (r.battery.length) {
      f.battery = node("battery", "mdi:home-battery-outline", "Batterie", first(r.battery));
      f.batteryLine = line("l-battery");
    }
    this._energyFlow = f;
    return box;
  }

  _renderEnergyLive() {
    if (!this._energyWrap || this._energyWrap.hidden || !this._energyN) return;
    const idle = 30;
    const show = (w) => (w == null ? "–" : fmtWatt(w));
    const f = this._energyFlow;
    if (f) {
      const live = ElvioEnergy.live(this._energyN, (id) => this._watts(id));
      f.home.v.textContent = show(live.home);
      if (f.solar) {
        f.solar.v.textContent = show(live.solar);
        f.solarLine.classList.toggle("on", (live.solar || 0) > idle);
      }
      if (f.grid) {
        const g = live.grid;
        const out = g != null && g < -idle;
        const inn = g != null && g > idle;
        f.grid.v.textContent = show(g == null ? null : Math.abs(g));
        f.grid.sub.textContent = out ? "Einspeisung" : inn ? "Bezug" : "Netz";
        f.grid.b.classList.toggle("out", out);
        f.gridLine.classList.toggle("out", out);
        f.gridLine.classList.toggle("on", out || inn);
        f.gridLine.classList.toggle("rev", out);
      }
      if (f.battery) {
        const b = live.battery;
        const dis = b != null && b > idle;
        const chg = b != null && b < -idle;
        f.battery.v.textContent = show(b == null ? null : Math.abs(b));
        f.battery.sub.textContent = dis ? "liefert" : chg ? "lädt" : "Batterie";
        f.batteryLine.classList.toggle("on", dis || chg);
        f.batteryLine.classList.toggle("rev", dis);
      }
    }
    for (const c of this._energyConsW || []) {
      const w = this._watts(c.rate);
      c.node.textContent = w != null && w > 1 ? `jetzt ${fmtWatt(w)}` : "";
    }
    // Statuszeile über dem Titel wie in den Ansichten: was das Haus jetzt braucht.
    const n = this._energyN;
    let status = "";
    if (n && ElvioEnergy.hasData(n)) {
      const live = ElvioEnergy.live(n, (id) => this._watts(id));
      let devW = null;
      for (const d of n.devices) {
        if (d.includedIn || !d.rate) continue;
        const w = this._watts(d.rate);
        if (w != null) devW = (devW || 0) + w;
      }
      if (live.home != null) status = `${fmtWatt(live.home)} im Haus`;
      else if (devW != null) status = `${fmtWatt(devW)} jetzt`;
      if (this._energyNowVal) this._energyNowVal.textContent = devW == null ? "–" : fmtWatt(devW);
    }
    this._energyStatus.textContent = status;
  }

  // Verlauf als Balken: Bezug nach oben, Einspeisung nach unten, Solar als Linie – eine Achse
  // (alles kWh). Ohne Zähler: Verbrauch der Geräte. Antippen zeigt die Werte des Balkens.
  _energyChartNode(n, rows, range) {
    const wrap = el("div", "echart");
    const series = (n.gridIn.length || n.gridOut.length || n.solar.length)
      ? [
          n.gridIn.length && { key: "gridIn", label: "Bezug", dir: 1 },
          n.gridOut.length && { key: "gridOut", label: "Einspeisung", dir: -1 },
          n.solar.length && { key: "solar", label: "Solar", line: true },
        ].filter(Boolean)
      : [{ key: "used", label: "Verbrauch", dir: 1 }];
    const upKeys = series.filter((x) => x.dir === 1 || x.line).map((x) => x.key);
    const up = Math.max(0, ...rows.flatMap((r) => upKeys.map((k) => r[k])));
    const down = series.some((x) => x.dir === -1) ? Math.max(0, ...rows.map((r) => r.gridOut)) : 0;
    if (up + down <= 0) {
      wrap.appendChild(el("div", "ag-empty", "Noch keine Werte in diesem Zeitraum."));
      return wrap;
    }
    const W = 720;
    const H = 180;
    const padT = 6;
    const padB = 6;
    const plot = H - padT - padB;
    const scale = plot / (up + down);
    const y0 = padT + up * scale;
    const step = W / rows.length;
    const bw = Math.max(2, Math.min(26, step * 0.6));
    const r4 = (h) => Math.min(4, bw / 2, h);
    const fx = (v) => v.toFixed(1);
    let bars = "";
    let hits = "";
    rows.forEach((row, i) => {
      const x = i * step + (step - bw) / 2;
      for (const sr of series) {
        if (sr.line) continue;
        const h = row[sr.key] * scale;
        if (h < 0.5) continue;
        const r = r4(h);
        const d = sr.dir === 1
          ? `M${fx(x)},${fx(y0)}V${fx(y0 - h + r)}Q${fx(x)},${fx(y0 - h)} ${fx(x + r)},${fx(y0 - h)}H${fx(x + bw - r)}Q${fx(x + bw)},${fx(y0 - h)} ${fx(x + bw)},${fx(y0 - h + r)}V${fx(y0)}Z`
          : `M${fx(x)},${fx(y0)}V${fx(y0 + h - r)}Q${fx(x)},${fx(y0 + h)} ${fx(x + r)},${fx(y0 + h)}H${fx(x + bw - r)}Q${fx(x + bw)},${fx(y0 + h)} ${fx(x + bw)},${fx(y0 + h - r)}V${fx(y0)}Z`;
        bars += `<path d="${d}" fill="${ENERGY_COLORS[sr.key]}"/>`;
      }
      hits += `<rect class="ehit" data-i="${i}" x="${fx(i * step)}" y="0" width="${fx(step)}" height="${H}"/>`;
    });
    let line = "";
    const solar = series.find((x) => x.line);
    if (solar) {
      const pts = rows.map((row, i) => `${fx(i * step + step / 2)},${fx(y0 - row.solar * scale)}`).join(" ");
      line = `<polyline points="${pts}" fill="none" stroke="${ENERGY_COLORS.solar}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    }
    const plotBox = el("div", "echart-plot");
    plotBox.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Verlauf ${series.map((x) => x.label).join(", ")}">` +
      `${hits}${bars}${line}<line x1="0" x2="${W}" y1="${fx(y0)}" y2="${fx(y0)}" stroke="rgba(255,255,255,.3)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
    const max = el("div", "echart-max", fmtKwh(up));
    plotBox.appendChild(max);
    // Beschriftung der Zeitachse als HTML, damit sie auf dem Handy lesbar bleibt.
    const axis = el("div", "echart-x");
    const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    rows.forEach((row, i) => {
      const d = new Date(row.t);
      let txt = null;
      if (range.bucket === "hour") txt = d.getHours() % 6 === 0 ? `${d.getHours()} Uhr` : null;
      else if (range.bucket === "month") txt = months[d.getMonth()];
      else if (range.period === "week") txt = days[d.getDay()];
      else txt = [1, 5, 10, 15, 20, 25, 30].includes(d.getDate()) ? `${d.getDate()}.` : null;
      if (!txt) return;
      const lab = el("span", "", txt);
      lab.style.left = `${((i + 0.5) / rows.length) * 100}%`;
      axis.appendChild(lab);
    });
    const read = el("div", "echart-read", "Balken antippen für die Werte");
    const legend = el("div", "echart-legend");
    for (const sr of series) {
      const it = el("span", "eleg");
      const sw = el("i", sr.line ? "line" : "");
      sw.style.background = ENERGY_COLORS[sr.key];
      it.append(sw, document.createTextNode(sr.label));
      legend.appendChild(it);
    }
    const when = (t) => {
      const d = new Date(t);
      if (range.bucket === "hour") return `${d.getHours()}–${d.getHours() + 1} Uhr`;
      if (range.bucket === "month") return d.toLocaleDateString("de-DE", { month: "long" });
      return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
    };
    plotBox.querySelectorAll(".ehit").forEach((hit) => {
      const pick = () => {
        plotBox.querySelectorAll(".ehit.sel").forEach((x) => x.classList.remove("sel"));
        hit.classList.add("sel");
        const row = rows[Number(hit.dataset.i)];
        read.textContent = `${when(row.t)} · ${series.map((x) => `${x.label} ${fmtKwh(row[x.key])}`).join(" · ")}`;
      };
      hit.addEventListener("click", pick);
      hit.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") pick();
      });
    });
    wrap.append(read, plotBox, axis);
    if (series.length > 1) wrap.appendChild(legend);
    return wrap;
  }

  _energyConsumersNode(rank) {
    const box = el("div", "econs");
    const max = Math.max(0, ...rank.map((x) => x.kwh || 0));
    const shown = this._energyConsAll ? rank : rank.slice(0, 10);
    for (const x of shown) {
      const row = el("button", "econ");
      const top = el("div", "econ-top");
      top.append(el("span", "econ-name", x.name), el("span", "econ-kwh", fmtKwh(x.kwh)));
      const bar = el("div", "econ-bar");
      const fill = el("div", "econ-fill");
      fill.style.width = max > 0 && x.kwh > 0 ? `${Math.max(1.5, (x.kwh / max) * 100)}%` : "0";
      bar.appendChild(fill);
      const w = el("div", "econ-w", "");
      row.append(top, bar, w);
      row.addEventListener("click", () => this._moreInfo(x.stat));
      box.appendChild(row);
      const dev = this._energyN.devices.find((d) => d.stat === x.stat);
      if (dev && dev.rate) this._energyConsW.push({ rate: dev.rate, node: w });
    }
    if (rank.length > shown.length) {
      const more = el("button", "stextbtn econ-more", `Alle ${rank.length} zeigen`);
      more.addEventListener("click", () => {
        this._energyConsAll = true;
        this._renderEnergy();
      });
      box.appendChild(more);
    }
    return box;
  }

  _buildRoomsNav() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel rpanel");
    const head = el("div", "shead");
    head.appendChild(el("div", "ptitle", "Räume"));
    // Räume verwalten: nur Admins (HA lässt Bereiche nur sie ändern) und nur, wenn die Räume
    // aus HA kommen – im Altmodus stehen sie in nav, ein Bereich änderte dort nichts.
    const actions = el("div", "sactions");
    this._roomsEditBtn = pillButton("mdi:pencil-outline", "Bearbeiten");
    this._roomsEditBtn.hidden = true;
    this._roomsEditBtn.addEventListener("click", () => {
      this._roomsEditing = !this._roomsEditing;
      this._roomCards = null;
      this._renderRoomsNav();
    });
    actions.appendChild(this._roomsEditBtn);
    head.appendChild(actions);
    this._roomsMsg = el("div", "emsg");
    this._roomsMsg.hidden = true;
    this._roomGrid = el("div", "roomgrid");
    panel.append(head, this._roomsMsg, this._roomGrid, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._roomsNavWrap = wrap;
    return wrap;
  }

  _openRoomsNav() {
    this._roomsNavWrap.hidden = false;
    this._roomsEditing = false;
    this._roomsMsg.hidden = true;
    this._roomCards = null;
    this._renderRoomsNav();
  }

  _renderRoomsNav() {
    if (!this._roomsNavWrap || this._roomsNavWrap.hidden) return;
    const hass = this._hass;
    const canEdit = this._isAdmin() && !ElvioRooms.isLegacy(this._config.nav);
    const editing = canEdit && !!this._roomsEditing;
    this._roomsEditBtn.hidden = !canEdit;
    setPill(this._roomsEditBtn, editing ? "mdi:check" : "mdi:pencil-outline", editing ? "Fertig" : "Bearbeiten");
    this._roomsEditBtn.classList.toggle("on", editing);
    if (!this._roomCards) {
      this._roomGrid.innerHTML = "";
      this._roomGrid.classList.toggle("editing", editing);
      const here = this._areaId();
      this._roomCards = [];
      const rooms = this._rooms({ includeHidden: editing });
      const groups = editing
        ? ElvioRooms.groupForEdit(rooms, Object.values(this._hass.floors || {}))
        : ElvioRooms.groupByFloor(rooms);
      const floorIds = groups.filter((g) => g.floorId).map((g) => g.floorId);
      for (const group of groups) {
        if (editing && group.floorId) this._roomGrid.appendChild(this._floorHeader(group, floorIds));
        else if (group.title) this._roomGrid.appendChild(el("div", "rgroup", group.title));
        group.rooms.forEach((room, i) => {
          // Im Bearbeiten-Modus ein div: Die Pfeile darin sind eigene Knöpfe.
          const card = el(editing ? "div" : "button", "roomcard");
          if (this._isCurrent(room.path) || (room.areaId && room.areaId === here)) card.classList.add("current");
          if (room.hidden) card.classList.add("hiddenroom");
          const img = el("img", "rc-img");
          img.alt = "";
          if (room.image) img.src = room.image;
          const txt = el("div", "rc-text");
          const status = el("div", "rc-status");
          txt.append(el("div", "rc-name", room.name), status);
          const ic = el("div", "rc-icon");
          ic.appendChild(icon(room.icon || "mdi:door"));
          card.append(img, txt, ic);
          if (editing) {
            card.addEventListener("click", () => this._openRoomForm(room.areaId));
            // Pfeile statt Ziehen: am Wandtablet treffsicherer. Nur innerhalb des Stockwerks.
            const moves = el("div", "rc-move");
            for (const [name, label, other] of [
              ["mdi:chevron-left", "Nach vorne", group.rooms[i - 1]],
              ["mdi:chevron-right", "Nach hinten", group.rooms[i + 1]],
            ]) {
              const b = el("button", "rc-arrow");
              b.setAttribute("aria-label", label);
              b.appendChild(icon(name));
              b.disabled = !other;
              b.addEventListener("click", (ev) => {
                ev.stopPropagation();
                if (other) this._swapRooms(room.areaId, other.areaId);
              });
              moves.appendChild(b);
            }
            card.appendChild(moves);
          } else {
            card.addEventListener("click", () => {
              this._roomsNavWrap.hidden = true;
              this._navigate(room.path);
            });
          }
          card.style.setProperty("--i", String(this._roomGrid.children.length));
          this._roomGrid.appendChild(card);
          this._roomCards.push({ room, status });
        });
        if (editing) {
          const add = el("button", "roomcard roomadd");
          add.append(icon("mdi:plus"), el("span", "", "Raum hinzufügen"));
          add.addEventListener("click", () => this._openRoomForm(null, group.floorId));
          this._roomGrid.appendChild(add);
        }
      }
      if (editing) {
        const addFloor = el("button", "roomcard roomadd flooradd");
        addFloor.append(icon("mdi:home-plus-outline"), el("span", "", "Stockwerk hinzufügen"));
        addFloor.addEventListener("click", () => this._openFloorForm(null));
        this._roomGrid.appendChild(addFloor);
      }
    }
    // Live-Status je Raum: Lichter an, Temperatur.
    for (const { room, status } of this._roomCards) {
      if (room.hidden) {
        status.textContent = "Am Tablet ausgeblendet";
        continue;
      }
      const parts = [];
      const lights = this._roomLightIds(room).map((id) => hass.states[id]).filter(Boolean);
      if (lights.length) {
        const on = lights.filter((l) => l.state === "on").length;
        parts.push(on ? `${on} ${on === 1 ? "Licht" : "Lichter"} an` : "Licht aus");
      }
      const t = room.temperature && hass.states[room.temperature];
      if (t) {
        const v = Number(t.entity_id.startsWith("climate.") ? t.attributes.current_temperature : t.state);
        if (Number.isFinite(v)) parts.push(`${Math.round(v)}°`);
      }
      status.textContent = parts.join(" · ");
    }
  }

  // Überschrift eines Stockwerks im Bearbeiten-Modus: Name, Pfeile (Reihenfolge), Stift.
  _floorHeader(group, floorIds) {
    const head = el("div", "rgroup rgroup-edit");
    head.appendChild(el("span", "rg-title", group.title));
    const actions = el("div", "rg-actions");
    const i = floorIds.indexOf(group.floorId);
    for (const [name, label, other] of [
      ["mdi:chevron-up", "Stockwerk nach oben", floorIds[i - 1]],
      ["mdi:chevron-down", "Stockwerk nach unten", floorIds[i + 1]],
    ]) {
      const b = el("button", "rc-arrow");
      b.setAttribute("aria-label", label);
      b.appendChild(icon(name));
      b.disabled = !other;
      b.addEventListener("click", () => other && this._swapFloors(group.floorId, other));
      actions.appendChild(b);
    }
    const edit = el("button", "rc-arrow");
    edit.setAttribute("aria-label", "Stockwerk bearbeiten");
    edit.appendChild(icon("mdi:pencil-outline"));
    edit.addEventListener("click", () => this._openFloorForm(group.floorId));
    actions.appendChild(edit);
    head.appendChild(actions);
    return head;
  }

  async _swapFloors(a, b) {
    this._roomsMsg.hidden = true;
    try {
      const list = await this._hass.callWS({ type: "config/floor_registry/list" });
      const ids = list.map((x) => x.floor_id);
      await this._hass.callWS({ type: "config/floor_registry/reorder", floor_ids: ElvioRooms.swap(ids, a, b) });
    } catch (err) {
      this._roomsMsg.textContent = `Nicht verschoben: ${setupErrText(err)}`;
      this._roomsMsg.hidden = false;
    }
  }

  // ───────────── Stockwerk-Blatt ─────────────
  // Wie das Raum-Blatt; aus dem Raum-Blatt geöffnet („+ Neues Stockwerk“) geht es danach
  // dorthin zurück, mit dem neuen Stockwerk ausgewählt.

  _openFloorForm(floorId, back = null) {
    const f = floorId && (this._hass.floors || {})[floorId];
    this._floorDraft = f
      ? { floorId, name: f.name, icon: f.icon || null, level: f.level ?? null }
      : { floorId: null, name: "", icon: null, level: null };
    this._floorBack = back;
    this._floorView = "main";
    this._editMode = "floor";
    this._editActions.replaceChildren();
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderFloorForm();
  }

  _floorIcon(f) {
    if (f.icon) return f.icon;
    const lv = f.level;
    if (lv == null) return "mdi:home-outline";
    return lv < 0 ? "mdi:home-floor-negative-1" : `mdi:home-floor-${Math.min(3, lv)}`;
  }

  _renderFloorForm() {
    if (this._editMode !== "floor" || this._editWrap.hidden || !this._floorDraft) return;
    const f = this._floorDraft;
    const list = this._editList;
    list.innerHTML = "";
    if (this._floorView === "icon") return this._renderFloorIconPick();
    if (this._floorView === "delete") return this._renderFloorDelete();
    this._editTitle.textContent = f.floorId ? "Stockwerk bearbeiten" : "Neues Stockwerk";
    this._editHint.textContent = "Gespeichert wird in Home Assistant – Updates ändern daran nichts.";
    const name = el("input", "einput");
    name.value = f.name;
    name.placeholder = "Name, z. B. Keller";
    name.addEventListener("input", () => {
      f.name = name.value;
      for (const c of chips.children) c.classList.toggle("on", c.dataset.name === ElvioRooms.floorKey(f.name));
    });
    // Vorlagen setzen Name, Symbol und Ebene (HA sortiert und zeigt Stockwerke danach).
    const chips = el("div", "echips");
    for (const p of FLOOR_PRESETS) {
      const b = el("button", "echip", p.name);
      b.dataset.name = ElvioRooms.floorKey(p.name);
      b.classList.toggle("on", ElvioRooms.floorKey(f.name) === b.dataset.name);
      b.addEventListener("click", () => {
        Object.assign(f, ElvioRooms.floorPreset(p.name));
        this._renderFloorForm();
      });
      chips.appendChild(b);
    }
    list.append(el("div", "esub", "Name"), name, chips);
    const row = el("button", "erow epick");
    const ic = el("div", "eicon");
    ic.appendChild(icon(this._floorIcon(f)));
    row.append(ic, el("div", "etext sname", "Symbol"), el("div", "ssub", "Ändern"));
    row.addEventListener("click", () => {
      this._floorView = "icon";
      this._renderFloorForm();
    });
    list.append(el("div", "esub", "Aussehen"), row);
    const save = el("button", "pbtn unlock esave", f.floorId ? "Speichern" : "Stockwerk anlegen");
    save.addEventListener("click", () => this._saveFloor(save));
    list.appendChild(save);
    if (f.floorId) {
      const del = el("button", "stextbtn edanger", "Stockwerk löschen");
      del.addEventListener("click", () => {
        this._floorView = "delete";
        this._renderFloorForm();
      });
      list.appendChild(del);
    }
    if (this._floorBack === "room") {
      const cancel = el("button", "stextbtn", "Abbrechen");
      cancel.addEventListener("click", () => this._afterFloorForm(null));
      list.appendChild(cancel);
    }
  }

  _renderFloorIconPick() {
    const f = this._floorDraft;
    this._editTitle.textContent = "Symbol wählen";
    this._editHint.textContent = "";
    const grid = el("div", "iconpick");
    for (const name of FLOOR_ICONS) {
      const b = el("button", "ipick");
      b.classList.toggle("on", this._floorIcon(f) === name);
      b.setAttribute("aria-label", name.replace("mdi:", ""));
      b.appendChild(icon(name));
      b.addEventListener("click", () => {
        f.icon = name;
        this._floorView = "main";
        this._renderFloorForm();
      });
      grid.appendChild(b);
    }
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._floorView = "main";
      this._renderFloorForm();
    });
    this._editList.append(grid, back);
  }

  _renderFloorDelete() {
    const f = this._floorDraft;
    const n = Object.values(this._hass.areas || {}).filter((a) => a.floor_id === f.floorId).length;
    this._editTitle.textContent = "Stockwerk löschen";
    this._editHint.textContent = "";
    const box = el("div", "cbox");
    box.append(
      icon("mdi:delete-outline"),
      el("div", "ctitle", `„${f.name}“ löschen?`),
      el(
        "div",
        "ctext",
        n
          ? `${n} ${n === 1 ? "Raum steht" : "Räume stehen"} dann unter „Weitere“ und ${n === 1 ? "lässt" : "lassen"} sich im Raum-Blatt einem anderen Stockwerk zuordnen. Die Räume selbst bleiben.`
          : "Diesem Stockwerk ist kein Raum zugeordnet.",
      ),
    );
    const go = el("button", "pbtn edangerbtn", "Löschen");
    go.addEventListener("click", () => this._deleteFloor(go));
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._floorView = "main";
      this._renderFloorForm();
    });
    box.append(go, back);
    this._editList.appendChild(box);
  }

  async _saveFloor(button) {
    const f = this._floorDraft;
    const name = f.name.trim();
    if (!name) return this._roomFormError("Bitte einen Namen eingeben.");
    this._editMsg.hidden = true;
    button.disabled = true;
    const data = { name, icon: f.icon || null, level: f.level ?? null };
    try {
      let floorId = f.floorId;
      if (floorId) await this._hass.callWS({ type: "config/floor_registry/update", floor_id: floorId, ...data });
      else floorId = (await this._hass.callWS({ type: "config/floor_registry/create", ...data })).floor_id;
      this._afterFloorForm(floorId);
    } catch (err) {
      button.disabled = false;
      this._roomFormError(`Nicht gespeichert: ${setupErrText(err)}`);
    }
  }

  async _deleteFloor(button) {
    this._editMsg.hidden = true;
    button.disabled = true;
    try {
      await this._hass.callWS({ type: "config/floor_registry/delete", floor_id: this._floorDraft.floorId });
      if (this._roomDraft && this._roomDraft.floorId === this._floorDraft.floorId) this._roomDraft.floorId = null;
      this._afterFloorForm(null);
    } catch (err) {
      button.disabled = false;
      this._roomFormError(`Nicht gelöscht: ${setupErrText(err)}`);
    }
  }

  // Zurück ins Raum-Blatt (mit dem neuen Stockwerk), sonst Blatt schließen.
  _afterFloorForm(floorId) {
    const back = this._floorBack;
    this._floorDraft = null;
    this._floorBack = null;
    if (back === "room" && this._roomDraft) {
      if (floorId) this._roomDraft.floorId = floorId;
      this._editMode = "room";
      this._roomFormView = "main";
      this._editMsg.hidden = true;
      this._renderRoomForm();
      return;
    }
    this._editWrap.hidden = true;
  }

  // Reihenfolge: HA verlangt beim Umsortieren immer alle Bereiche – frisch holen, zwei tauschen.
  async _swapRooms(a, b) {
    this._roomsMsg.hidden = true;
    try {
      const list = await this._hass.callWS({ type: "config/area_registry/list" });
      const ids = list.map((x) => x.area_id);
      await this._hass.callWS({ type: "config/area_registry/reorder", area_ids: ElvioRooms.swap(ids, a, b) });
    } catch (err) {
      this._roomsMsg.textContent = `Nicht verschoben: ${setupErrText(err)}`;
      this._roomsMsg.hidden = false;
    }
  }

  // ───────────── Raum-Blatt ─────────────
  // Der Entwurf liegt am Objekt, damit er einen Neuaufbau übersteht (jede Registry-Änderung
  // kann die Karte neu aufbauen, siehe _rebuildKeepingPlace).

  _openRoomForm(areaId, floorId = null) {
    const a = areaId && (this._hass.areas || {})[areaId];
    this._roomDraft = a
      ? {
          areaId,
          name: a.name,
          floorId: a.floor_id || null,
          icon: a.icon || "mdi:door",
          picture: a.picture || null,
          temperature: a.temperature_entity_id || null,
          shown: !(a.labels || []).includes(LABEL_HIDE.id),
          labels: a.labels || [],
        }
      : { areaId: null, name: "", floorId, icon: "mdi:door", picture: null, temperature: null, shown: true, labels: [] };
    this._roomFormView = "main";
    this._editMode = "room";
    this._editActions.replaceChildren();
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderRoomForm();
  }

  _roomFormError(text) {
    this._editMsg.textContent = text;
    this._editMsg.hidden = false;
  }

  _renderRoomForm() {
    if (this._editMode !== "room" || this._editWrap.hidden || !this._roomDraft) return;
    const d = this._roomDraft;
    const list = this._editList;
    list.innerHTML = "";
    if (this._roomFormView === "icon") return this._renderIconPick();
    if (this._roomFormView === "delete") return this._renderRoomDelete();
    if (this._roomFormView === "image") return this._renderImagePick();
    this._editTitle.textContent = d.areaId ? "Raum bearbeiten" : "Neuer Raum";
    this._editHint.textContent = "Gespeichert wird in Home Assistant – Updates ändern daran nichts.";

    const name = el("input", "einput");
    name.value = d.name;
    name.placeholder = "Name, z. B. Büro";
    name.addEventListener("input", () => (d.name = name.value));
    list.append(el("div", "esub", "Name"), name);

    const floors = Object.values(this._hass.floors || {});
    const floorChips = el("div", "echips");
    for (const f of [...floors, { floor_id: null, name: "Kein Stockwerk" }]) {
      const b = el("button", "echip", f.name);
      b.classList.toggle("on", (d.floorId || null) === (f.floor_id || null));
      b.addEventListener("click", () => {
        d.floorId = f.floor_id || null;
        this._renderRoomForm();
      });
      floorChips.appendChild(b);
    }
    // Fehlt das Stockwerk noch (z. B. „Keller“), gleich hier anlegen – danach geht es zurück.
    const newFloor = el("button", "echip enew");
    newFloor.append(icon("mdi:plus"), document.createTextNode("Neues Stockwerk"));
    newFloor.addEventListener("click", () => this._openFloorForm(null, "room"));
    floorChips.appendChild(newFloor);
    list.append(el("div", "esub", "Stockwerk"), floorChips);

    // Zeile, die eine Auswahl (Icon, Bild) öffnet.
    const pick = (label, view, preview) => {
      const row = el("button", "erow epick");
      const ic = el("div", "eicon");
      ic.appendChild(preview);
      row.append(ic, el("div", "etext sname", label), el("div", "ssub", "Ändern"));
      row.addEventListener("click", () => {
        this._roomFormView = view;
        this._renderRoomForm();
      });
      return row;
    };
    // Ohne eigenes Bild gilt das Ersatzbild aus dem Kartenpaket – dieselbe Regel wie am Tablet.
    const fallback = d.picture ? null : ElvioRooms.bundledImage({ area_id: d.areaId, name: d.name });
    const shown = d.picture || fallback;
    let preview = icon("mdi:image-off-outline");
    if (shown) {
      preview = el("img", "ethumb");
      preview.alt = "";
      preview.src = shown;
    }
    list.append(
      el("div", "esub", "Aussehen"),
      pick("Icon", "icon", icon(d.icon)),
      pick(d.picture ? "Bild" : fallback ? "Bild: automatisch" : "Bild: keins", "image", preview),
    );

    if (d.areaId) {
      const temps = this._temperatureSensors(d.areaId);
      if (temps.length) {
        const chips = el("div", "echips");
        for (const id of [...temps, null]) {
          const b = el("button", "echip", id ? this._friendly(id) : "Keine");
          b.classList.toggle("on", (d.temperature || null) === id);
          b.addEventListener("click", () => {
            d.temperature = id;
            this._renderRoomForm();
          });
          chips.appendChild(b);
        }
        list.append(el("div", "esub", "Temperatur"), chips);
      }
    }

    const show = el("div", "erow");
    const sw = el("button", "lswitch");
    sw.classList.toggle("on", d.shown);
    sw.setAttribute("aria-label", d.shown ? "Ausblenden" : "Am Tablet zeigen");
    sw.addEventListener("click", () => {
      d.shown = !d.shown;
      this._renderRoomForm();
    });
    show.append(el("div", "etext sname", "Am Tablet zeigen"), sw);
    list.appendChild(show);

    const save = el("button", "pbtn unlock esave", d.areaId ? "Speichern" : "Raum anlegen");
    save.addEventListener("click", () => this._saveRoom(save));
    list.appendChild(save);
    if (d.areaId) {
      const del = el("button", "stextbtn edanger", "Raum löschen");
      del.addEventListener("click", () => {
        this._roomFormView = "delete";
        this._renderRoomForm();
      });
      list.appendChild(del);
    }
  }

  // Temperatursensoren im Bereich (direkt oder über ihr Gerät) – Auswahl für die Statuszeile.
  _temperatureSensors(areaId) {
    const hass = this._hass;
    return Object.values(hass.entities || {})
      .filter((e) => e.entity_id.startsWith("sensor.") && this._entityArea(e) === areaId)
      .filter((e) => {
        const st = hass.states[e.entity_id];
        return st && st.attributes.device_class === "temperature";
      })
      .map((e) => e.entity_id);
  }

  _renderIconPick() {
    const d = this._roomDraft;
    this._editTitle.textContent = "Icon wählen";
    this._editHint.textContent = "";
    const grid = el("div", "iconpick");
    for (const name of ROOM_ICONS) {
      const b = el("button", "ipick");
      b.classList.toggle("on", d.icon === name);
      b.setAttribute("aria-label", name.replace("mdi:", ""));
      b.appendChild(icon(name));
      b.addEventListener("click", () => {
        d.icon = name;
        this._roomFormView = "main";
        this._renderRoomForm();
      });
      grid.appendChild(b);
    }
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._roomFormView = "main";
      this._renderRoomForm();
    });
    this._editList.append(grid, back);
  }

  _renderImagePick() {
    const d = this._roomDraft;
    this._editTitle.textContent = "Bild wählen";
    this._editHint.textContent = "Eigenes Foto: Am Tablet öffnet sich die Kamera oder die Fotos.";
    const grid = el("div", "imgpick");
    const choose = (url) => {
      d.picture = url;
      this._roomFormView = "main";
      this._renderRoomForm();
    };
    // label statt button: Ein Tipp öffnet die Dateiauswahl ohne eigenes Skript.
    const own = el("label", "impick imtext");
    const input = el("input");
    input.type = "file";
    input.accept = "image/*";
    const ownText = el("span", "", "Eigenes Foto");
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      // Leeren, damit dieselbe Datei nach einem Fehler erneut gewählt werden kann (sonst kein change).
      input.value = "";
      own.classList.add("busy");
      ownText.textContent = "Lade hoch …";
      try {
        const url = await this._uploadRoomPhoto(file);
        // Wurde inzwischen abgebrochen oder der Raum gewechselt, bleibt das Bild unberührt.
        if (this._roomFormView !== "image" || this._roomDraft !== d) return;
        choose(url);
      } catch (err) {
        if (this._roomFormView !== "image" || this._roomDraft !== d) return;
        own.classList.remove("busy");
        ownText.textContent = "Eigenes Foto";
        this._roomFormError(`Foto nicht hochgeladen: ${setupErrText(err)}`);
      }
    });
    own.append(input, icon("mdi:camera-outline"), ownText);
    const none = el("button", "impick imtext");
    none.classList.toggle("on", !d.picture);
    none.append(icon("mdi:image-off-outline"), el("span", "", "Kein Bild"));
    none.addEventListener("click", () => choose(null));
    grid.append(own, none);
    for (const name of BUNDLED_IMAGES) {
      const url = `${IMAGE_BASE}${name}.jpg`;
      const b = el("button", "impick");
      b.classList.toggle("on", d.picture === url);
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = url;
      b.appendChild(img);
      b.addEventListener("click", () => choose(url));
      grid.appendChild(b);
    }
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._roomFormView = "main";
      this._renderRoomForm();
    });
    this._editList.append(grid, back);
  }

  // Foto verkleinern (längste Kante ROOM_PHOTO_MAX) und über HAs Bild-Upload ablegen – derselbe
  // Weg wie Bereichsbilder in der HA-Oberfläche. Die Adresse lädt ohne Anmeldung, taugt also
  // als Hintergrund. Ein ersetztes Foto bleibt in HA liegen (Einstellungen → Bereiche zeigt es nicht mehr).
  async _uploadRoomPhoto(file) {
    // Handyfotos liegen oft quer und tragen die Drehung nur in den EXIF-Daten.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    // Das Bitmap hält viele Megapixel im Speicher: sofort nach dem Zeichnen freigeben.
    try {
      const scale = Math.min(1, ROOM_PHOTO_MAX / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      // JPEG kennt keine Transparenz: erst weiß füllen, sonst werden PNGs schwarz.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close();
    }
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild ließ sich nicht umwandeln"))), "image/jpeg", 0.85),
    );
    const form = new FormData();
    form.append("file", blob, "raum.jpg");
    const resp = await this._hass.fetchWithAuth("/api/image/upload", { method: "POST", body: form });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data || !data.id) throw new Error("Antwort ohne Bild-ID");
    return `/api/image/serve/${data.id}/original`;
  }

  _renderRoomDelete() {
    const d = this._roomDraft;
    const hass = this._hass;
    // Geräte des Bereichs plus Entitäten ohne Gerät, die direkt im Bereich stehen.
    const n =
      Object.values(hass.devices || {}).filter((x) => x.area_id === d.areaId).length +
      Object.values(hass.entities || {}).filter((e) => !e.device_id && e.area_id === d.areaId).length;
    this._editTitle.textContent = "Raum löschen";
    this._editHint.textContent = "";
    const box = el("div", "cbox");
    box.append(
      icon("mdi:delete-outline"),
      el("div", "ctitle", `„${d.name}“ löschen?`),
      el(
        "div",
        "ctext",
        n
          ? `${n} ${n === 1 ? "Gerät ist" : "Geräte sind"} dann ohne Raum und lassen sich unter „Geräte bearbeiten“ neu zuordnen.`
          : "Diesem Raum ist nichts zugeordnet.",
      ),
    );
    const go = el("button", "pbtn edangerbtn", "Löschen");
    go.addEventListener("click", () => this._deleteRoom(go));
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      this._roomFormView = "main";
      this._renderRoomForm();
    });
    box.append(go, back);
    this._editList.appendChild(box);
  }

  async _saveRoom(button) {
    const d = this._roomDraft;
    const name = d.name.trim();
    if (!name) return this._roomFormError("Bitte einen Namen eingeben.");
    this._editMsg.hidden = true;
    button.disabled = true;
    const labels = new Set(d.labels);
    if (d.shown) labels.delete(LABEL_HIDE.id);
    else labels.add(LABEL_HIDE.id);
    const data = { name, floor_id: d.floorId, icon: d.icon, picture: d.picture, labels: [...labels] };
    try {
      if (!d.shown) await this._ensureLabels();
      if (d.areaId) {
        await this._hass.callWS({ type: "config/area_registry/update", area_id: d.areaId, ...data, temperature_entity_id: d.temperature });
      } else {
        await this._hass.callWS({ type: "config/area_registry/create", ...data });
      }
      this._roomDraft = null;
      this._editWrap.hidden = true;
    } catch (err) {
      button.disabled = false;
      this._roomFormError(`Nicht gespeichert: ${setupErrText(err)}`);
    }
  }

  async _deleteRoom(button) {
    const d = this._roomDraft;
    button.disabled = true;
    try {
      await this._hass.callWS({ type: "config/area_registry/delete", area_id: d.areaId });
      this._roomDraft = null;
      this._editWrap.hidden = true;
      // Zeigt die Raum-Ansicht gerade diesen Raum, geht es zur Raumübersicht.
      if (this._rawConfig.area === "auto" && ElvioRooms.areaFromLocation(location.search) === d.areaId) {
        this._navigate(ElvioRooms.roomsBasePath(location.pathname, this._config.rooms_path));
      }
    } catch (err) {
      button.disabled = false;
      this._roomFormError(`Nicht gelöscht: ${setupErrText(err)}`);
    }
  }

  // ───────────── Lichter eines Raums ─────────────

  _buildLights() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel rpanel");
    const head = el("div", "shead");
    this._lightsTitle = el("div", "ptitle");
    const allOn = el("button", "stextbtn", "Alle an");
    allOn.addEventListener("click", () =>
      this._hass.callService("light", "turn_on", { entity_id: this._lightsCfg.entities }),
    );
    const allOff = el("button", "stextbtn", "Alle aus");
    allOff.addEventListener("click", () =>
      this._hass.callService("light", "turn_off", { entity_id: this._lightsCfg.entities }),
    );
    const actions = el("div", "sactions");
    actions.append(allOn, allOff);
    head.append(this._lightsTitle, actions);
    this._lightsList = el("div", "sresults");
    panel.append(head, this._lightsList, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._lightsWrap = wrap;
    return wrap;
  }

  _openLights(cfg) {
    this._lightsCfg = cfg;
    this._lightsRows = null;
    this._lightsWrap.hidden = false;
    this._renderLights();
  }

  _renderLights() {
    if (!this._lightsWrap || this._lightsWrap.hidden) return;
    const hass = this._hass;
    const cfg = this._lightsCfg;
    // Titel = Raumname („Wohnzimmer“); nur ohne Raum steht der Kachelname.
    this._lightsTitle.textContent = this._config.title || cfg.name || "Licht";
    // Zeilen einmal bauen, danach nur Werte setzen – sonst springt ein Regler beim Ziehen.
    if (!this._lightsRows) {
      this._lightsList.innerHTML = "";
      this._lightsRows = cfg.entities.map((id) => {
        const row = el("div", "lrow");
        const top = el("div", "ltop");
        const name = el("button", "lname");
        name.addEventListener("click", () => this._moreInfo(id));
        const title = el("div", "sname");
        const sub = el("div", "ssub");
        name.append(title, sub);
        const slider = el("input", "lslider");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        const r = { id, row, title, sub, slider, dragging: false };
        slider.addEventListener("pointerdown", () => (r.dragging = true));
        slider.addEventListener("change", () => {
          r.dragging = false;
          this._setBrightness([id], Number(slider.value));
        });
        const sw = el("button", "lswitch");
        sw.setAttribute("aria-label", "Ein/Aus");
        sw.addEventListener("click", () => this._hass.callService("light", "toggle", { entity_id: id }));
        r.sw = sw;
        top.append(name, sw);
        // Farbtöne: Weißtöne und Farben nur, wenn die Lampe sie kann (beim ersten Aufbau
        // bekannt; supported_color_modes ändert sich zur Laufzeit nicht).
        const colors = el("div", "lcolors");
        const modes = (this._hass.states[id] && this._hass.states[id].attributes.supported_color_modes) || [];
        if (modes.includes("color_temp")) {
          for (const [label, k] of [["Warm", 2700], ["Neutral", 4000], ["Kalt", 6000]]) {
            const b = el("button", "lcolor ltemp", label);
            b.addEventListener("click", () =>
              this._hass.callService("light", "turn_on", { entity_id: id, color_temp_kelvin: k }),
            );
            colors.appendChild(b);
          }
        }
        if (modes.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m))) {
          for (const rgb of [[255, 120, 60], [255, 190, 90], [120, 220, 120], [80, 150, 255], [190, 110, 255]]) {
            const b = el("button", "lcolor ldot");
            b.style.background = `rgb(${rgb.join(",")})`;
            b.setAttribute("aria-label", "Farbe");
            b.addEventListener("click", () =>
              this._hass.callService("light", "turn_on", { entity_id: id, rgb_color: rgb }),
            );
            colors.appendChild(b);
          }
        }
        row.append(top, slider);
        if (colors.children.length) row.appendChild(colors);
        row.style.setProperty("--i", String(this._lightsList.children.length));
        this._lightsList.appendChild(row);
        return r;
      });
    }
    for (const r of this._lightsRows) {
      const st = hass.states[r.id];
      if (!st) {
        r.title.textContent = r.id;
        r.sub.textContent = "Nicht gefunden";
        r.row.classList.add("missing");
        continue;
      }
      const on = st.state === "on";
      const pct = on ? Math.round(((st.attributes.brightness ?? 255) / 255) * 100) : 0;
      r.title.textContent = st.attributes.friendly_name || r.id;
      r.sub.textContent = on ? `An · ${pct} %` : "Aus";
      r.row.classList.toggle("on", on);
      r.sw.classList.toggle("on", on);
      // Nicht dimmbare Lichter haben keinen Regler.
      const modes = st.attributes.supported_color_modes || [];
      r.slider.hidden = modes.length === 1 && modes[0] === "onoff";
      if (!r.dragging) r.slider.value = String(pct);
      r.slider.style.setProperty("--fill", `${r.slider.value}%`);
    }
  }

  // ───────────── Geräte eines Raums bearbeiten (Admin) ─────────────

  _buildEdit() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel rpanel");
    const head = el("div", "shead");
    this._editTitle = el("div", "ptitle");
    const pair = el("button", "stextbtn", "Neues Gerät koppeln");
    pair.addEventListener("click", () => {
      // Koppeln (Zigbee, Matter, WLAN …) läuft in der HA-Oberfläche; danach dem Raum
      // zuordnen, dann erscheint es hier unter „Ohne Raum“ oder direkt im Raum.
      wrap.hidden = true;
      this._confirmPath = "/config/integrations/dashboard";
      this._confirmWrap.hidden = false;
    });
    // Hinzufügen: Kameras, Sensoren und Geräte aus dem ganzen Haus in diesen Raum holen.
    const add = pillButton("mdi:plus", "Hinzufügen");
    add.addEventListener("click", () => this._openAdd());
    const actions = el("div", "sactions");
    actions.append(add, pair);
    head.append(this._editTitle, actions);
    this._editActions = actions;
    this._editAddBtn = add;
    this._editPairBtn = pair;
    this._editHint = el("div", "ehint", "Was hier an ist, erscheint am Tablet. Gespeichert wird in Home Assistant – Updates ändern daran nichts.");
    this._editMsg = el("div", "emsg");
    this._editMsg.hidden = true;
    this._editList = el("div", "sresults");
    panel.append(head, this._editHint, this._editMsg, this._editList, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._editWrap = wrap;
    return wrap;
  }

  _openEdit() {
    this._editMode = "devices";
    this._editActions.replaceChildren(this._editAddBtn, this._editPairBtn);
    this._editWrap.hidden = false;
    this._renderEdit();
  }

  _renderEdit() {
    const hass = this._hass;
    const areaId = this._areaId();
    if (!areaId) return;
    this._editHint.textContent = "Was hier an ist, erscheint am Tablet. Gespeichert wird in Home Assistant – Updates ändern daran nichts.";
    this._editTitle.textContent = `Geräte · ${this._config.title}`;
    const placed = this._placedIds();
    const list = this._editList;
    list.innerHTML = "";
    const order = (e) => [AUTO_DOMAINS.includes(e.entity_id.split(".")[0]) ? 0 : 1, this._friendly(e.entity_id)];
    const entities = this._areaEntities(areaId).sort((a, b) => {
      const [x1, y1] = order(a);
      const [x2, y2] = order(b);
      return x1 - x2 || y1.localeCompare(y2, "de");
    });
    if (!entities.length) {
      list.appendChild(el("div", "ehint", "Diesem Raum ist noch nichts zugeordnet. Mit „+ Hinzufügen“ holst du Kameras, Sensoren und Geräte her."));
    }
    // Messwerte und Technik (Leistung, Energie, Eingänge …) eingeklappt, solange sie nicht
    // am Tablet stehen – sonst stehen allein für einen Aktor mit vier Kanälen 16 Zeilen da.
    const tech = [];
    for (const e of entities) {
      const shown = this._isShown(e, placed);
      if (!shown && !ElvioRooms.isUseful(e.entity_id, this._deviceClass(e.entity_id))) tech.push(e);
      else list.appendChild(this._editRow(e, shown, placed));
    }
    if (tech.length) {
      list.appendChild(this._foldButton(`Messwerte & Technik (${tech.length})`, !!this._editTechOpen, () => {
        this._editTechOpen = !this._editTechOpen;
        this._renderEdit();
      }));
      if (this._editTechOpen) for (const e of tech) list.appendChild(this._editRow(e, false, placed));
    }
    // Neu gekoppelte Geräte ohne Raum: mit einem Tipp in diesen Raum holen.
    // Eingeklappt: Mehrkanal-Aktoren bringen je Kanal ein eigenes Gerät mit, das wären
    // schnell zwanzig Zeilen. Alles andere holt „+ Hinzufügen“.
    const homeless = this._unassignedDevices();
    if (homeless.length) {
      list.appendChild(this._foldButton(`Ohne Raum (${homeless.length})`, !!this._editHomelessOpen, () => {
        this._editHomelessOpen = !this._editHomelessOpen;
        this._renderEdit();
      }));
    }
    if (homeless.length && this._editHomelessOpen) {
      for (const dev of homeless) {
        const row = el("div", "erow");
        const ic = el("div", "eicon");
        ic.appendChild(icon("mdi:devices"));
        const txt = el("div", "etext");
        txt.append(el("div", "sname", dev.name_by_user || dev.name || "Gerät"), el("div", "ssub", [dev.manufacturer, dev.model].filter(Boolean).join(" · ")));
        const b = el("button", "stextbtn", "Hierher");
        b.addEventListener("click", () => this._assignDevice(dev.id, areaId));
        row.append(ic, txt, b);
        list.appendChild(row);
      }
    }
  }

  _editRow(e, shown, placed) {
    const hass = this._hass;
    const row = el("div", "erow");
    const st = hass.states[e.entity_id];
    const ic = el("div", "eicon");
    ic.appendChild(icon(e.icon || (st && st.attributes.icon) || this._defaultIcon(st)));
    const txt = el("div", "etext");
    txt.append(el("div", "sname", this._friendly(e.entity_id)), el("div", "ssub", hass.formatEntityState(st)));
    const move = el("button", "stextbtn emove", "Verschieben");
    move.addEventListener("click", () => this._openMove(e));
    const sw = el("button", "lswitch");
    sw.classList.toggle("on", shown);
    sw.setAttribute("aria-label", shown ? "Ausblenden" : "Am Tablet zeigen");
    sw.addEventListener("click", () => this._setShown(e, !shown, placed));
    row.append(ic, txt, move, sw);
    return row;
  }

  _foldButton(text, open, onClick) {
    const b = el("button", "esub efold");
    b.append(icon(open ? "mdi:chevron-down" : "mdi:chevron-right"), document.createTextNode(text));
    b.addEventListener("click", onClick);
    return b;
  }

  _deviceClass(id) {
    const st = this._hass.states[id];
    return st ? st.attributes.device_class : undefined;
  }

  // ───────────── Hinzufügen: Kameras, Sensoren, Geräte aus dem ganzen Haus ─────────────
  // Zwei Schritte im selben Blatt: Gerät suchen, dann seine Funktionen anhaken. Der Stand
  // liegt in _addState, damit er einen Neuaufbau der Karte (Registry geändert) übersteht.

  _openAdd() {
    this._addState = { kind: "all", query: "", key: null, selected: null, techOpen: false };
    this._showAdd();
  }

  _showAdd() {
    this._editMode = "add";
    // „Abbrechen“ geht einen Schritt zurück; „Zurück“ unten schließt wie überall das Blatt.
    const back = el("button", "stextbtn", "Abbrechen");
    back.addEventListener("click", () => {
      const s = this._addState;
      if (s && s.key) {
        s.key = null;
        s.selected = null;
        this._renderAdd();
      } else {
        this._addState = null;
        this._openEdit();
      }
    });
    this._editActions.replaceChildren(back);
    this._editMsg.hidden = true;
    this._editWrap.hidden = false;
    this._renderAdd();
  }

  // Alles, was sich diesem Raum hinzufügen lässt: je Gerät eine Zeile, Entitäten ohne Gerät
  // (z. B. Vorlagen-Sensoren) einzeln. Ohne Systemgeräte (Sonne, Backup …) und Technik.
  _addCandidates() {
    const hass = this._hass;
    const areaId = this._areaId();
    const devs = hass.devices || {};
    const groups = new Map();
    for (const e of Object.values(hass.entities || {})) {
      if (e.hidden || e.entity_category || !hass.states[e.entity_id] || !ElvioRooms.isPickable(e.entity_id)) continue;
      const d = e.device_id ? devs[e.device_id] : null;
      if (d && (d.disabled_by || d.entry_type === "service")) continue;
      const key = d ? `d:${d.id}` : `e:${e.entity_id}`;
      if (!groups.has(key)) groups.set(key, { key, device: d || null, entities: [] });
      groups.get(key).entities.push(e);
    }
    const out = [];
    for (const g of groups.values()) {
      const areas = [...new Set(g.entities.map((e) => this._entityArea(e) || null))];
      const here = areas.length === 1 && areas[0] === areaId;
      const names = areas
        .map((a) => (a === areaId ? "hier" : a ? (hass.areas[a] && hass.areas[a].name) || a : "Ohne Raum"))
        .sort((x, y) => (x === "Ohne Raum" ? -1 : y === "Ohne Raum" ? 1 : x.localeCompare(y, "de")));
      const d = g.device;
      // Teilgeräte (Kanäle eines Aktors, Kameras am Rekorder) heißen oft gleich („Reserve O3“):
      // das übergeordnete Gerät (z. B. „EG-A4“) unterscheidet sie.
      const via = d && d.via_device_id && devs[d.via_device_id];
      out.push({
        ...g,
        name: d ? d.name_by_user || d.name || "Gerät" : this._friendly(g.entities[0].entity_id),
        parent: via ? via.name_by_user || via.name || null : null,
        offline: g.entities.every((e) => hass.states[e.entity_id].state === "unavailable"),
        kind: ElvioRooms.deviceKind(g.entities.map((e) => ({ entity_id: e.entity_id, device_class: this._deviceClass(e.entity_id) }))),
        where: here ? "Schon hier" : names.join(" · "),
        rank: areas.includes(null) ? 0 : here ? 2 : 1,
      });
    }
    return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "de"));
  }

  _renderAdd() {
    const s = this._addState;
    if (!s || !this._areaId()) return;
    if (s.key) {
      this._renderAddDevice();
      return;
    }
    this._editTitle.textContent = `Hinzufügen · ${this._config.title}`;
    this._editHint.textContent = "Kameras, Sensoren und Geräte aus dem ganzen Haus. Antippen zeigt, was davon hier erscheinen soll.";
    const list = this._editList;
    list.innerHTML = "";
    const top = el("div", "eaddhead");
    const field = el("label", "sfield");
    field.appendChild(icon("mdi:magnify"));
    const input = el("input", "sinput");
    input.type = "search";
    input.placeholder = "Gerät oder Raum suchen …";
    input.value = s.query;
    input.addEventListener("input", () => {
      s.query = input.value;
      this._renderAddResults();
    });
    field.appendChild(input);
    const filters = el("div", "sfilters");
    for (const f of ADD_FILTERS) {
      const chip = el("button", "schip", f.label);
      chip.classList.toggle("active", s.kind === f.key);
      chip.addEventListener("click", () => {
        s.kind = f.key;
        for (const c of filters.children) c.classList.toggle("active", c === chip);
        this._renderAddResults();
      });
      filters.appendChild(chip);
    }
    top.append(field, filters);
    this._addResults = el("div", "eaddlist");
    list.append(top, this._addResults);
    this._renderAddResults();
  }

  _renderAddResults() {
    const s = this._addState;
    const box = this._addResults;
    if (!s || !box) return;
    const q = s.query.trim().toLowerCase();
    const cands = this._addCandidates().filter(
      (c) => (s.kind === "all" || c.kind === s.kind) && (!q || `${c.name} ${c.where} ${c.parent || ""}`.toLowerCase().includes(q)),
    );
    box.innerHTML = "";
    if (!cands.length) box.appendChild(el("div", "smuted", q ? "Nichts gefunden." : "Hier gibt es nichts hinzuzufügen."));
    for (const c of cands) {
      const row = el("button", "erow epick");
      const ic = el("div", "eicon");
      ic.appendChild(icon(KIND_ICONS[c.kind] || "mdi:devices"));
      const txt = el("div", "etext");
      const sub = [c.where, c.parent, c.offline ? "nicht erreichbar" : null].filter(Boolean).join(" · ");
      txt.append(el("div", "sname", c.name), el("div", "ssub", sub));
      row.append(ic, txt, icon("mdi:chevron-right"));
      row.addEventListener("click", () => {
        s.key = c.key;
        s.selected = null;
        s.techOpen = false;
        this._renderAddDevice();
      });
      box.appendChild(row);
    }
  }

  _renderAddDevice() {
    const s = this._addState;
    const hass = this._hass;
    const areaId = this._areaId();
    const c = this._addCandidates().find((x) => x.key === s.key);
    if (!c) {
      s.key = null;
      this._renderAdd();
      return;
    }
    const placed = this._placedIds();
    // Vorauswahl: was schon hier ist, so wie es am Tablet steht; aus „Ohne Raum“ das
    // Sinnvolle; was in einem anderen Raum steht, bleibt dort, bis man es anhakt.
    if (!s.selected) {
      s.selected = new Set(
        c.entities
          .filter((e) => {
            const a = this._entityArea(e);
            if (a === areaId) return this._isShown(e, placed);
            return !a && ElvioRooms.preselect(e.entity_id, this._deviceClass(e.entity_id), c.kind);
          })
          .map((e) => e.entity_id),
      );
    }
    const room = this._config.title;
    const d = c.device;
    const devArea = d && d.area_id ? (hass.areas[d.area_id] && hass.areas[d.area_id].name) || d.area_id : null;
    this._editTitle.textContent = c.name;
    this._editHint.textContent = !d || d.area_id === areaId
      ? `Angehakt erscheint in ${room}.`
      : !d.area_id
        ? `Angehakt erscheint in ${room}. Das Gerät hat noch keinen Raum und kommt ganz hierher.`
        : `Angehakt erscheint in ${room}. Das Gerät bleibt in ${devArea}, nur das Angehakte kommt her.`;
    const list = this._editList;
    list.innerHTML = "";
    // Kurze Namen: „Klingel Bewegung“ → „Bewegung“, wenn das Gerät „Klingel“ heißt.
    const short = (id) => {
      const full = this._friendly(id);
      return d && full.startsWith(`${c.name} `) ? full.slice(c.name.length + 1) : full;
    };
    const row = (e) => {
      const st = hass.states[e.entity_id];
      const r = el("div", "erow");
      const ic = el("div", "eicon");
      ic.appendChild(icon(e.icon || st.attributes.icon || this._defaultIcon(st)));
      const a = this._entityArea(e);
      const where = a && a !== areaId ? `in ${(hass.areas[a] && hass.areas[a].name) || a}` : null;
      const txt = el("div", "etext");
      txt.append(el("div", "sname", short(e.entity_id)), el("div", "ssub", [hass.formatEntityState(st), where].filter(Boolean).join(" · ")));
      const sw = el("button", "lswitch");
      const sync = () => {
        const on = s.selected.has(e.entity_id);
        sw.classList.toggle("on", on);
        sw.setAttribute("aria-label", on ? "Nicht hinzufügen" : "Hinzufügen");
      };
      sw.addEventListener("click", () => {
        if (s.selected.has(e.entity_id)) s.selected.delete(e.entity_id);
        else s.selected.add(e.entity_id);
        sync();
      });
      sync();
      r.append(ic, txt, sw);
      return r;
    };
    const useful = (e) => s.selected.has(e.entity_id) || ElvioRooms.isUseful(e.entity_id, this._deviceClass(e.entity_id));
    const sorted = [...c.entities].sort((a, b) => short(a.entity_id).localeCompare(short(b.entity_id), "de"));
    const main = sorted.filter(useful);
    const tech = sorted.filter((e) => !useful(e));
    for (const e of main) list.appendChild(row(e));
    if (tech.length) {
      list.appendChild(this._foldButton(`Messwerte & Technik (${tech.length})`, s.techOpen, () => {
        s.techOpen = !s.techOpen;
        this._renderAddDevice();
      }));
      if (s.techOpen) for (const e of tech) list.appendChild(row(e));
    }
    const save = el("button", "pbtn unlock esave", "Hinzufügen");
    save.addEventListener("click", () => this._saveAdd(save));
    list.appendChild(save);
  }

  async _saveAdd(btn) {
    const s = this._addState;
    const c = s && this._addCandidates().find((x) => x.key === s.key);
    if (!c) return;
    const plan = ElvioRooms.addPlan({
      device: c.device ? { id: c.device.id, area_id: c.device.area_id || null } : null,
      entities: c.entities.map((e) => ({ entity_id: e.entity_id, area_id: e.area_id || null, labels: e.labels || [] })),
      selected: [...s.selected],
      areaId: this._areaId(),
      placed: [...this._placedIds()],
    });
    btn.disabled = true;
    btn.textContent = "Speichert …";
    this._editMsg.hidden = true;
    try {
      if (plan.entities.some((x) => x.labels)) await this._ensureLabels();
      if (plan.device) await this._hass.callWS({ type: "config/device_registry/update", ...plan.device });
      for (const x of plan.entities) await this._hass.callWS({ type: "config/entity_registry/update", ...x });
      this._addState = null;
      this._openEdit();
    } catch (err) {
      // Nichts zurückdrehen: Gespeichertes steht in HA richtig, ein zweiter Versuch holt den
      // Rest nach (der Plan rechnet nur noch die fehlenden Änderungen).
      this._editMsg.textContent = `Nicht vollständig gespeichert: ${err.message || err}`;
      this._editMsg.hidden = false;
      btn.disabled = false;
      btn.textContent = "Erneut versuchen";
    }
  }

  // Geräte ohne Raum, die etwas Bedienbares haben (keine Systemgeräte wie Sonne oder Backup).
  _unassignedDevices() {
    const hass = this._hass;
    const devs = hass.devices || {};
    const byDevice = {};
    for (const e of Object.values(hass.entities || {})) {
      if (!e.device_id || e.hidden || e.entity_category || e.area_id) continue;
      if (!AUTO_DOMAINS.includes(e.entity_id.split(".")[0])) continue;
      byDevice[e.device_id] = true;
    }
    return Object.keys(byDevice)
      .map((id) => devs[id])
      .filter((d) => d && !d.area_id && !d.disabled_by && d.entry_type !== "service");
  }

  async _ensureLabels() {
    if (this._labelsReady) return;
    const list = await this._hass.callWS({ type: "config/label_registry/list" });
    for (const want of [LABEL_SHOW, LABEL_HIDE]) {
      if (list.some((l) => l.label_id === want.id)) continue;
      const made = await this._hass.callWS({ type: "config/label_registry/create", name: want.name, icon: want.icon });
      // Vergibt HA eine andere ID (Name schon belegt), fände die Karte das Label nie wieder.
      if (made.label_id !== want.id) throw new Error(`Label „${want.name}“ hat die ID ${made.label_id} statt ${want.id}`);
    }
    this._labelsReady = true;
  }

  async _setShown(e, show, placed) {
    this._editMsg.hidden = true;
    try {
      await this._ensureLabels();
      // Nur die Abweichung vom Normalfall wird gespeichert.
      const byDefault = placed.has(e.entity_id) || AUTO_DOMAINS.includes(e.entity_id.split(".")[0]);
      const labels = ElvioRooms.shownLabels(e.labels, show, byDefault);
      await this._hass.callWS({ type: "config/entity_registry/update", entity_id: e.entity_id, labels });
    } catch (err) {
      this._editMsg.textContent = `Nicht gespeichert: ${err.message || err}`;
      this._editMsg.hidden = false;
    }
  }

  // Räume, in die man verschieben kann: die Räume des Tablets, die einen HA-Bereich haben.
  _moveTargets() {
    return this._rooms()
      .filter((r) => r.areaId)
      .map((r) => ({ name: r.name, icon: r.icon, areaId: r.areaId }));
  }

  _openMove(e) {
    const here = this._areaId();
    const list = this._editList;
    list.innerHTML = "";
    this._editTitle.textContent = `${this._friendly(e.entity_id)} verschieben`;
    const go = (areaId) => this._moveEntity(e, areaId).then(() => this._renderEdit());
    for (const r of this._moveTargets()) {
      const row = el("button", "erow epick");
      const ic = el("div", "eicon");
      ic.appendChild(icon(r.icon || "mdi:door"));
      row.append(ic, el("div", "etext sname", r.name));
      if (r.areaId === here) {
        row.classList.add("current");
        row.appendChild(el("div", "ssub", "hier"));
      } else {
        row.addEventListener("click", () => go(r.areaId));
      }
      list.appendChild(row);
    }
    const none = el("button", "erow epick");
    const ic = el("div", "eicon");
    ic.appendChild(icon("mdi:map-marker-off-outline"));
    none.append(ic, el("div", "etext sname", "Ohne Raum"));
    none.addEventListener("click", () => go(null));
    list.appendChild(none);
    const cancel = el("button", "stextbtn", "Abbrechen");
    cancel.addEventListener("click", () => this._renderEdit());
    list.appendChild(cancel);
  }

  // Verschieben heißt: das ganze Gerät zieht um (alle seine Funktionen), eine eigene
  // Raumzuordnung dieser einen Funktion wird aufgehoben, damit sie dem Gerät folgt.
  // „Nicht am Tablet“ fällt weg – wer etwas in einen Raum holt, will es dort sehen.
  async _moveEntity(e, areaId) {
    this._editMsg.hidden = true;
    try {
      const labels = (e.labels || []).filter((l) => l !== LABEL_HIDE.id);
      if (e.device_id) {
        await this._hass.callWS({ type: "config/device_registry/update", device_id: e.device_id, area_id: areaId });
        await this._hass.callWS({ type: "config/entity_registry/update", entity_id: e.entity_id, area_id: null, labels });
      } else {
        await this._hass.callWS({ type: "config/entity_registry/update", entity_id: e.entity_id, area_id: areaId, labels });
      }
      return true;
    } catch (err) {
      this._editMsg.textContent = `Nicht verschoben: ${err.message || err}`;
      this._editMsg.hidden = false;
      return false;
    }
  }

  async _assignDevice(deviceId, areaId) {
    this._editMsg.hidden = true;
    try {
      await this._hass.callWS({ type: "config/device_registry/update", device_id: deviceId, area_id: areaId });
    } catch (err) {
      this._editMsg.textContent = `Nicht gespeichert: ${err.message || err}`;
      this._editMsg.hidden = false;
    }
  }

  // ───────────── Bildschirmschoner & Nachtmodus ─────────────
  // (Bestätigungsfenster zählt als offen, siehe busy in _checkSaver.)

  _buildSaver() {
    const saver = el("div", "saver");
    saver.hidden = true;
    this._saverImgs = [el("img", "sv-img"), el("img", "sv-img")];
    for (const img of this._saverImgs) img.alt = "";
    this._saverClock = el("div", "sv-clock");
    this._saverDate = el("div", "sv-date");
    this._saverInfo = el("div", "sv-info");
    const text = el("div", "sv-text");
    text.append(this._saverClock, this._saverDate, this._saverInfo);
    saver.append(...this._saverImgs, el("div", "sv-shade"), text);
    this._saver = saver;
    return saver;
  }

  _saverEnabled() {
    const cfg = this._config.screensaver;
    if (!cfg || !this._hass) return false;
    // Mit Schalter-Entität gilt deren Zustand; ohne Schalter ist der Schoner immer an.
    if (cfg.entity) return this._hass.states[cfg.entity] && this._hass.states[cfg.entity].state === "on";
    return true;
  }

  _isNight() {
    const cfg = this._config.screensaver || {};
    if (!cfg.night_from || !cfg.night_to) return false;
    const ne = cfg.night_entity && this._hass.states[cfg.night_entity];
    if (cfg.night_entity && (!ne || ne.state !== "on")) return false;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => {
      const [h, m] = String(t).split(":").map(Number);
      return h * 60 + (m || 0);
    };
    const from = toMin(cfg.night_from);
    const to = toMin(cfg.night_to);
    return from > to ? mins >= from || mins < to : mins >= from && mins < to;
  }

  _checkSaver() {
    if (!this._saver) return;
    if (!this._saverEnabled()) {
      if (!this._saver.hidden) this._hideSaver();
      return;
    }
    // Offene Fenster (Klingel, Suche, Räume) nicht überdecken.
    const busy = [this._popup, this._searchWrap, this._roomsWrap, this._lightsWrap, this._roomsNavWrap, this._editWrap, this._confirmWrap].some(
      (w) => w && !w.hidden,
    );
    const idle = Date.now() - this._lastActive > (this._config.screensaver.after || 120) * 1000;
    if (this._saver.hidden && idle && !busy) this._showSaver();
    if (!this._saver.hidden) this._renderSaver();
  }

  _showSaver() {
    this._saver.hidden = false;
    this._swallowClick = true;
    this._saverIndex = -1;
    this._nextSaverPhoto();
    clearInterval(this._saverPhotoTimer);
    this._saverPhotoTimer = setInterval(() => this._nextSaverPhoto(), SAVER_PHOTO_MS);
    this._renderSaver();
  }

  _hideSaver() {
    this._saver.hidden = true;
    clearInterval(this._saverPhotoTimer);
  }

  _nextSaverPhoto() {
    const imgs = this._config.screensaver.images || [];
    if (!imgs.length) return;
    this._saverIndex = (this._saverIndex + 1) % imgs.length;
    // Zwei Ebenen im Wechsel: die neue blendet über der alten ein.
    const [a, b] = this._saverImgs;
    const next = a.classList.contains("show") ? b : a;
    const prev = next === a ? b : a;
    next.src = imgs[this._saverIndex];
    next.classList.add("show");
    prev.classList.remove("show");
  }

  _renderSaver() {
    const night = this._isNight();
    this._saver.classList.toggle("night", night);
    const now = new Date();
    this._saverClock.textContent = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(now);
    this._saverDate.textContent = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(now);
    const parts = [];
    const t = this._config.temperature && this._hass.states[this._config.temperature];
    if (t) {
      const v = Number(t.entity_id.startsWith("climate.") ? t.attributes.current_temperature : t.state);
      if (Number.isFinite(v)) parts.push(`${Math.round(v)}°`);
    }
    const np = this._pickPlayer();
    if (!night && np && np.state === "playing" && np.attributes.media_title) {
      parts.push(`♪ ${[np.attributes.media_title, np.attributes.media_artist].filter(Boolean).join(" · ")}`);
    }
    this._saverInfo.textContent = parts.join("   ");
  }

  // ───────────── Klingel-Popup ─────────────

  _buildPopup() {
    const popup = el("div", "popup");
    popup.hidden = true;
    const panel = el("div", "panel");
    const head = el("div", "phead");
    this._popupTitle = el("div", "ptitle");
    this._popupSub = el("div", "psub");
    const titles = el("div");
    titles.append(this._popupTitle, this._popupSub);
    const close = el("button", "pclose");
    close.setAttribute("aria-label", "Schließen");
    close.appendChild(icon("mdi:close"));
    close.addEventListener("click", () => this._closeDoorbell());
    head.append(titles, close);
    this._popupVideo = el("div", "pvideo");
    this._popupActions = el("div", "pactions");
    panel.append(head, this._popupVideo, this._popupActions);
    popup.appendChild(panel);
    // Tipp neben das Fenster schließt es – nicht während eines Gesprächs (Fehlgriff).
    popup.addEventListener("click", (e) => {
      if (e.target === popup && !this._sipView) this._closeDoorbell();
    });
    this._popup = popup;
    this._popupCamFor = undefined;
    return popup;
  }

  // Klingeln weckt das Tablet aus dem Bildschirmschoner. Den Schoner beendet hier das
  // Klingeln, nicht ein Tipp – also darf auch kein Tipp verschluckt werden, sonst ginge der
  // erste Tipp auf „Annehmen“ bzw. „Tür öffnen“ ins Leere.
  _wakeForDoorbell() {
    this._lastActive = Date.now();
    if (this._saver && !this._saver.hidden) {
      this._hideSaver();
      this._swallowClick = false;
    }
  }

  async _openDoorbell(cfg, rang) {
    this._wakeForDoorbell();
    // Läuft schon ein Gespräch über SIP, bleibt dessen Ansicht mit ihren Knöpfen stehen.
    if (this._sipView) return;
    clearTimeout(this._popupTimer);
    clearTimeout(this._sipEndTimer);
    this._popupTitle.textContent = rang ? "Es klingelt" : cfg.name || "Klingel";
    this._popupSub.textContent = rang
      ? `${cfg.name || "Klingel"} · ${this._clock ? this._clock.textContent : ""}`
      : "Livebild";
    this._popup.classList.remove("sip", "talking");
    this._popup.classList.toggle("rang", rang);
    this._popup.hidden = false;

    await this._popupCamera(cfg, false);
    // Inzwischen kam der Anruf über SIP: dessen Knöpfe gelten.
    if (this._sipView) return;

    this._popupActions.innerHTML = "";
    if (cfg.unlock) this._popupActions.appendChild(this._buildUnlockButton(cfg.unlock));
    const dismiss = el("button", "pbtn", "Schließen");
    dismiss.addEventListener("click", () => this._closeDoorbell());
    this._popupActions.appendChild(dismiss);

    // Ein vergessenes Popup soll nicht stundenlang den Stream offen halten.
    this._popupTimer = setTimeout(() => this._closeDoorbell(), POPUP_AUTO_CLOSE_MS);
  }

  // Livebild über HAs eigene picture-entity-Karte: sie kann alle Stream-Arten
  // (WebRTC, HLS, Standbild), die die Kamera-Integration liefert. reuse: läuft dieselbe
  // Kamera schon, bleibt der Stream stehen (Klingeln → Anruf ohne Ruckeln).
  async _popupCamera(cfg, reuse) {
    const cam = cfg.camera || null;
    if (reuse && this._popupCamFor === cam) return;
    const token = (this._popupCamToken = (this._popupCamToken || 0) + 1);
    this._popupCamFor = cam;
    this._popupVideo.innerHTML = "";
    this._popupCard = null;
    if (!cam) {
      this._popupVideo.appendChild(el("div", "pnovideo", "Keine Kamera hinterlegt"));
      return;
    }
    const helpers = await window.loadCardHelpers();
    // Inzwischen geschlossen oder eine andere Kamera gewählt.
    if (token !== this._popupCamToken) return;
    const card = helpers.createCardElement({
      type: "picture-entity",
      entity: cam,
      camera_view: "live",
      show_name: false,
      show_state: false,
      tap_action: { action: "none" },
    });
    card.hass = this._hass;
    this._popupCard = card;
    this._popupVideo.appendChild(card);
  }

  // ───────────── Gegensprechen (SIP) im Klingel-Popup ─────────────

  // Klingel-Kacheln dieser Karte mit sip_extension (Rohkonfiguration: auch wenn die
  // Klingel-Entität gerade ausgeblendet ist).
  _sipTiles() {
    const c = this._rawConfig || {};
    return [...(c.tiles || []), ...(c.sections || []).flatMap((s) => (s && s.tiles) || [])].filter(
      (t) => t && t.type === "doorbell" && t.sip_extension != null && t.sip_extension !== "",
    );
  }

  // Konfiguration des ganzen Dashboards (alle Ansichten): von der Karte aufwärts bis zu
  // dem Element, das sie hält (hui-view / hui-root haben `lovelace`).
  _dashboardConfig() {
    let node = this;
    for (let i = 0; node && i < 60; i++) {
      if (node.lovelace && node.lovelace.config) return node.lovelace.config;
      node = node.parentNode || node.host;
    }
    return null;
  }

  // Anruf zeigen bzw. auf den neuen Stand bringen. state = callState von SIP Core.
  _sipShow(call, state) {
    if (!this._popup) return;
    if (!this._sipView || this._sipView.call !== call) this._sipOpen(call);
    this._sipRender(state);
  }

  _sipOpen(call) {
    this._wakeForDoorbell();
    // Ein Gespräch darf länger dauern als POPUP_AUTO_CLOSE_MS; es endet mit dem Auflegen.
    clearTimeout(this._popupTimer);
    clearTimeout(this._sipEndTimer);
    const wasOpen = !this._popup.hidden;
    this._popup.hidden = false;
    this._popup.classList.add("sip");
    this._popupCamera(call.cfg, wasOpen);
    // Tür-öffnen-Knopf einmal je Anruf: Nachfrage und „Geöffnet“ überstehen den Wechsel
    // von „Es klingelt“ zu „Im Gespräch“.
    this._sipView = {
      call,
      phase: null,
      unlock: call.cfg.unlock ? this._buildUnlockButton(call.cfg.unlock) : null,
      mic: null,
      ptt: null,
    };
  }

  _sipRender(state) {
    const v = this._sipView;
    const name = v.call.cfg.name || "Klingel";
    // JsSIP zählt schon „angenommen“ (STATUS_ANSWERED, Mikrofonabfrage läuft noch) als
    // verbunden. „Im Gespräch“ erst, wenn die eigene Spur dran und die Antwort raus ist.
    const status = v.call.session.status;
    const live = state === "connected" && (status === SIP_STATUS_WAITING_FOR_ACK || status === SIP_STATUS_CONFIRMED);
    const phase = live ? "talk" : state === "incoming" ? "ring" : "connecting";
    if (phase === "ring") {
      this._popupTitle.textContent = "Es klingelt";
      this._popupSub.textContent = `${name} · ${this._clock ? this._clock.textContent : ""}`;
    } else if (phase === "connecting") {
      this._popupTitle.textContent = "Verbinde …";
      this._popupSub.textContent = name;
    } else {
      this._popupTitle.textContent = "Im Gespräch";
      this._popupSub.textContent = `${name} · ${window.sipCore ? window.sipCore.callDuration : ""}`;
    }
    this._popup.classList.toggle("rang", phase === "ring");
    this._popup.classList.toggle("talking", phase === "talk");
    if (phase !== v.phase) {
      v.phase = phase;
      this._sipActions();
    } else if (phase === "talk") {
      this._sipMicState();
    }
  }

  // Knöpfe je Phase. Feste Plätze: Auflegen links, Tür öffnen in der Mitte, Annehmen bzw.
  // Mikro rechts – ein doppelter Tipp auf „Annehmen“ trifft danach nicht „Auflegen“.
  _sipActions() {
    const v = this._sipView;
    const call = v.call;
    const box = this._popupActions;
    box.innerHTML = "";
    v.mic = null;
    v.ptt = null;
    const button = (cls, iconName, text) => {
      const b = el("button", `pbtn ${cls}`);
      b._icon = icon(iconName);
      b._label = el("span", "", text);
      b.append(b._icon, b._label);
      return b;
    };

    const hangup = button("hangup", "mdi:phone-hangup", v.phase === "ring" ? "Ablehnen" : "Auflegen");
    hangup.addEventListener("click", () => {
      hangup.disabled = true;
      sipBridge.hangup(call);
    });
    box.appendChild(hangup);
    if (v.unlock) box.appendChild(v.unlock);

    if (v.phase === "ring") {
      const accept = button("accept", "mdi:phone", "Annehmen");
      accept.addEventListener("click", () => {
        accept.disabled = true;
        accept._label.textContent = "Verbinde …";
        sipBridge.answer(call);
      });
      box.appendChild(accept);
    } else if (v.phase === "connecting") {
      // Platzhalter an der Stelle von „Annehmen“: ein zweiter Tipp landet hier und nicht
      // auf dem Mikro-Knopf, der gleich an dieser Stelle erscheint.
      const wait = button("accept", "mdi:phone", "Verbinde …");
      wait.disabled = true;
      box.appendChild(wait);
    } else if (v.phase === "talk") {
      if (call.cfg.sip_push_to_talk) {
        v.ptt = this._buildPtt(call);
        box.appendChild(v.ptt);
      }
      v.mic = button("mic", "mdi:microphone", "Mikro an");
      v.mic.addEventListener("click", () => sipBridge.toggleMic(call));
      box.appendChild(v.mic);
      this._sipMicState();
    }
  }

  // Gedrückt halten = sprechen. Pointer-Capture: Loslassen zählt auch neben dem Knopf.
  _buildPtt(call) {
    const b = el("button", "pbtn ptt");
    b.append(icon("mdi:account-voice"), el("span", "", "Halten zum Sprechen"));
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try {
        b.setPointerCapture(e.pointerId);
      } catch (err) {
        // ohne Capture: pointerup am Knopf reicht
      }
      sipBridge.setPtt(call, true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      b.addEventListener(type, () => sipBridge.setPtt(call, false));
    }
    // Langes Drücken öffnet am Tablet sonst das Kontextmenü.
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }

  _sipMicState() {
    const v = this._sipView;
    if (!v || !v.mic) return;
    const on = v.call.micOn;
    v.mic.classList.toggle("muted", !on);
    v.mic._icon.setAttribute("icon", on ? "mdi:microphone" : "mdi:microphone-off");
    v.mic._label.textContent = on ? "Mikro an" : "Mikro aus";
    if (v.ptt) v.ptt.classList.toggle("active", v.call.ptt);
  }

  // Anruf vorbei (aufgelegt, abgelehnt, Tür hat aufgelegt): kurz sagen, dann schließen.
  _sipEnded(call) {
    const v = this._sipView;
    if (!v || v.call !== call) return;
    this._sipView = null;
    const noMic = call.cause === "User Denied Media Access";
    this._popup.classList.remove("rang", "talking");
    this._popupTitle.textContent = noMic ? "Kein Mikrofon" : v.phase === "talk" ? "Gespräch beendet" : "Anruf beendet";
    // JsSIP meldet jeden Mikrofon-Fehler so (verweigert, belegt, nicht vorhanden, kein HTTPS).
    this._popupSub.textContent = noMic ? "Mikrofon nicht freigegeben, belegt oder nicht vorhanden" : call.cfg.name || "Klingel";
    this._popupActions.innerHTML = "";
    clearTimeout(this._sipEndTimer);
    this._sipEndTimer = setTimeout(() => this._closeDoorbell(), noMic ? SIP_ERROR_HOLD_MS : SIP_END_HOLD_MS);
  }

  _buildUnlockButton(entityId) {
    // Zwei Tipps: der erste fragt nach, erst der zweite öffnet. Ein Fehlgriff oder ein
    // Kind am Tablet öffnet die Tür nicht.
    const btn = el("button", "pbtn unlock");
    const label = el("span", "", "Tür öffnen");
    btn.append(icon("mdi:door-open"), label);
    let armed = false;
    let timer;
    btn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        btn.classList.add("confirm");
        label.textContent = "Wirklich öffnen?";
        timer = setTimeout(() => {
          armed = false;
          btn.classList.remove("confirm");
          label.textContent = "Tür öffnen";
        }, UNLOCK_CONFIRM_MS);
        return;
      }
      clearTimeout(timer);
      armed = false;
      const domain = entityId.split(".")[0];
      if (domain === "lock") {
        this._hass.callService("lock", "unlock", { entity_id: entityId });
      } else {
        this._hass.callService(domain, "press", { entity_id: entityId });
      }
      btn.classList.remove("confirm");
      btn.classList.add("done");
      btn.disabled = true;
      label.textContent = "Geöffnet";
    });
    return btn;
  }

  // Schließt nur das Fenster. Ein SIP-Gespräch beenden die Knöpfe Ablehnen/Auflegen;
  // währenddessen gibt es weder „×“ noch Tipp-daneben-zu.
  _closeDoorbell() {
    clearTimeout(this._popupTimer);
    clearTimeout(this._sipEndTimer);
    this._sipView = null;
    if (this._popup) {
      this._popup.hidden = true;
      this._popup.classList.remove("sip", "talking");
    }
    // Karte entfernen beendet den Stream; ein noch ladendes Livebild verfällt.
    this._popupCamToken = (this._popupCamToken || 0) + 1;
    this._popupCamFor = undefined;
    if (this._popupVideo) this._popupVideo.innerHTML = "";
    this._popupCard = null;
  }

  // ───────────── Aktionen ─────────────

  _toggleLights(entities) {
    const anyOn = entities.some((id) => this._hass.states[id]?.state === "on");
    this._hass.callService("light", anyOn ? "turn_off" : "turn_on", { entity_id: entities });
  }

  _setBrightness(entities, pct) {
    if (pct === 0) {
      this._hass.callService("light", "turn_off", { entity_id: entities });
    } else {
      this._hass.callService("light", "turn_on", { entity_id: entities, brightness_pct: pct });
    }
  }

  _toggleClimate(entityId) {
    const st = this._hass.states[entityId];
    if (!st) return;
    const mode = st.state === "off" ? this._activeMode(st) : "off";
    if (!mode) return;
    this._hass.callService("climate", "set_hvac_mode", { entity_id: entityId, hvac_mode: mode });
  }

  _runAction(entityId) {
    const domain = entityId.split(".")[0];
    this._hass.callService(domain, "turn_on", { entity_id: entityId });
  }

  _moreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
    );
  }

  _isCurrent(path) {
    return path && window.location.pathname === path;
  }

  _navigate(path) {
    if (!path) return;
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }
}

const STYLE = `
:host { display: block; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }

.frame {
  /* Sichere Ränder des Geräts (iPhone: Statusleiste oben, Home-Balken unten). */
  --sat: env(safe-area-inset-top, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --hh: calc(76px + var(--sat)); /* Höhe der Kopfzeile – Abstand und Ausblendkante der Steuerung */
  position: fixed; inset: 0; z-index: 5; overflow: hidden;
  color: #fff; background: #3a3530;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.bg { position: absolute; inset: 0;
  background: radial-gradient(120% 90% at 70% 30%, #8a7a66 0%, #4d443b 45%, #262220 100%); }
.bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  filter: blur(calc(var(--p, 0) * 14px)); transform: scale(calc(1 + var(--p, 0) * .06)); will-change: filter, transform; }
.dim { position: absolute; inset: 0; pointer-events: none; background: rgba(14,12,10,.5); opacity: var(--p, 0); }
.bg-img:not([src]) { display: none; }
.shade { position: absolute; inset: 0;
  background:
    linear-gradient(90deg, rgba(0,0,0,.42) 0%, rgba(0,0,0,.12) 50%, rgba(0,0,0,0) 100%),
    linear-gradient(0deg, rgba(0,0,0,.22) 0%, rgba(0,0,0,0) 35%),
    /* Leicht warm abgedunkelt: auch taghelle Fotos wirken abends ruhig statt grell. */
    linear-gradient(rgba(28,18,10,.22), rgba(28,18,10,.22)); }

header { position: absolute; top: 0; left: 0; right: 0; z-index: 3;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  padding: calc(32px + var(--sat)) 8% 14px; transition: background .3s, padding .3s; }
.frame.scrolled header { padding-top: calc(18px + var(--sat)); }

.scroller { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain; scrollbar-width: none; }
/* Was unter der Kopfzeile durchscrollt, blendet weich aus, statt an der Schrift zu kleben. */
.frame.scrolled .scroller {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, transparent var(--hh), #000 calc(var(--hh) + 56px));
  mask-image: linear-gradient(to bottom, transparent 0, transparent var(--hh), #000 calc(var(--hh) + 56px)); }
.scroller::-webkit-scrollbar { display: none; }
.screen { position: relative; min-height: 100%; display: flex; flex-direction: column;
  padding: 0 8% 5vh; }
.left { display: flex; align-items: center; }
.brand { font-size: 15px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }
nav.top { display: flex; gap: 36px; }
nav.top .link { font-size: 15px; font-weight: 500; opacity: .82; padding-bottom: 4px;
  border-bottom: 2px solid transparent; }
nav.top .link.active { opacity: 1; border-bottom-color: rgba(255,255,255,.85); }
.right { justify-self: end; display: flex; align-items: center; gap: 10px; }
.clock { font-size: 15px; font-weight: 500; letter-spacing: .02em; }
.mark { display: grid; place-items: center; }
.mark img { width: 20px; height: 20px; object-fit: contain; opacity: .8;
  filter: drop-shadow(0 1px 6px rgba(0,0,0,.25)); }

/* Titel sitzt direkt über den Kacheln, das Foto bleibt oben frei – sonst schwebt er
   verloren in der Bildmitte, auf dem Handy besonders. */
.hero { margin-top: auto; max-width: 46%; transform-origin: left bottom;
  opacity: calc(1 - var(--p, 0) * 1.3);
  transform: translateY(calc(var(--p, 0) * -70px)) scale(calc(1 - var(--p, 0) * .08)); }
.status { font-size: 15px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; min-height: 18px; }
h1 { margin: 6px 0 16px; font-size: clamp(56px, 7.5vw, 104px); font-weight: 700;
  letter-spacing: -.035em; line-height: .95; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; max-width: 420px; }
.chip { display: flex; align-items: center; gap: 9px; min-width: 0; max-width: 100%; height: 40px;
  padding: 0 14px 0 6px; border-radius: 14px;
  background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.16);
  backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%);
  font-size: 12px; line-height: 1.15; }
.chip { cursor: pointer; text-align: left; color: inherit; font: inherit; }
.chip:active { transform: scale(.97); }
.chip .av { width: 28px; height: 28px; border-radius: 9px; overflow: hidden; flex: none;
  display: grid; place-items: center; background: rgba(255,255,255,.14);
  font-weight: 600; --mdc-icon-size: 17px; }
.chip.person .av { border-radius: 50%; }
.chip .av img { width: 100%; height: 100%; object-fit: cover; }
.chip .txt { min-width: 0; }
.chip b, .chip span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip b { font-weight: 600; }
.chip span { opacity: .7; font-size: 11px; }
.chip.media { max-width: 300px; }
/* Räume nebeneinander, bei vielen waagerecht scrollbar statt umzubrechen. */
.chips.roomchips { flex-wrap: nowrap; overflow-x: auto; max-width: none; margin-top: 8px;
  scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.chips.roomchips::-webkit-scrollbar { display: none; }
.chips.roomchips[hidden] { display: none; }
.chip.room { flex: none; max-width: 220px; }
/* Die Raum-Reihe darf über die halbe Breite des Titelblocks hinaus; rechts läuft sie weich
   aus, damit man sieht, dass es weitergeht. */
.hero:has(.roomchips) { max-width: none; }
.chips.roomchips { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 48px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 48px), transparent); padding-right: 48px; }

.screen > .tiles { padding-top: 28px;
  opacity: calc(1 - var(--p, 0) * 1.5); transform: translateY(calc(var(--p, 0) * -40px)); }
.tiles { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 12px; }
.tiles > .tile { grid-column: span var(--span, 1); }
/* Kacheln einer Reihe sind immer gleich hoch – die höchste gibt das Maß vor. */
.tiles { align-items: stretch; }
.more { align-self: center; display: flex; align-items: center; gap: 4px; margin: 14px 0 -2vh;
  font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; opacity: .75;
  --mdc-icon-size: 18px; animation: nudge 2.4s ease-in-out infinite;
  visibility: visible; opacity: calc(.75 - var(--p, 0) * 2); }
@keyframes nudge { 0%,100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
.sections { min-height: 100%; padding: calc(var(--hh) + 64px) 8% 64px; display: flex; flex-direction: column; gap: 32px;
  opacity: calc(var(--p, 0) * 1.4 - .2); transform: translateY(calc((1 - var(--p, 0)) * 48px)); }
.section h2 { margin: 0 0 14px 4px; font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
.tile { position: relative; min-height: 128px; border-radius: 22px;
  /* Safari schneidet weichgezeichnete Kinder sonst nicht an der Rundung ab. */
  clip-path: inset(0 round 22px); padding: 0 64px 0 26px;
  display: flex; flex-direction: column; justify-content: center; overflow: hidden; cursor: pointer;
  background: rgba(255,255,255,.17);
  backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%);
  transition: background .35s, color .35s; }
/* Rand als oberste Schicht: Safari schneidet Kinder (Cover, Kamera) in den Ecken nur
   rechteckig, sie übermalten den echten border in der Rundung. */
.tile::before { content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none;
  border-radius: inherit; border: 1px solid rgba(255,255,255,.22); }
.tile:active { transform: scale(.985); }
.text { position: relative; z-index: 1; }
/* Namen dürfen zwei Zeilen haben („Esstisch Ecke“ statt „Esstisch E…“), erst danach „…“. */
.name { font-size: 15px; font-weight: 500; line-height: 1.25; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  -webkit-hyphens: auto; hyphens: auto; overflow-wrap: break-word; }
.state { font-size: 12px; opacity: .72; margin-top: 3px; }
.icon { position: absolute; right: 24px; top: 50%; transform: translateY(-50%); z-index: 1;
  --mdc-icon-size: 22px; opacity: .9; }
.tile.on { background: rgba(255,255,255,.66); color: #262626; }
.tile.alert { background: rgba(196,45,45,.7); }
.tile.missing { opacity: .5; }

.tile.lights { justify-content: flex-start; padding-top: 30px; }
/* Einzeilig, sonst läuft „Wohnzimmer, Esstisch an“ in den Regler. */
.tile.lights .state, .tile.media .state { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile.lights .icon { top: 30px; transform: none; }
.slider { position: absolute; left: 26px; right: 26px; bottom: 24px; margin: 0; height: 18px;
  -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; }
.slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px;
  background: linear-gradient(90deg, currentColor 0 var(--fill), rgba(127,127,127,.35) var(--fill) 100%); }
.slider::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(127,127,127,.35); }
.slider::-moz-range-progress { height: 4px; border-radius: 2px; background: currentColor; }
.slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; margin-top: -7px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.slider::-moz-range-thumb { width: 18px; height: 18px; border: 0; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); }

.side { position: absolute; right: 0; top: 0; bottom: 0; width: 46px; display: flex; flex-direction: column; }
.side button { flex: 1; display: grid; place-items: center; --mdc-icon-size: 16px; opacity: .85; }
.side .power.active { background: rgba(255,255,255,.22); }

.tile.camera { padding-right: 26px; justify-content: flex-end; padding-bottom: 20px; }
.cam { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cam:not([src]) { display: none; }
.tile.camera::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 65%); }
.live { position: absolute; top: 14px; right: 16px; z-index: 1; display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600; letter-spacing: .04em; padding: 3px 9px; border-radius: 999px;
  background: rgba(0,0,0,.35); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #ff453a; }

.tile.ringing { background: rgba(255,255,255,.7); color: #262626; animation: ring 1.6s ease-in-out infinite; }
@keyframes ring { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,.55); } 50% { box-shadow: 0 0 0 10px rgba(255,255,255,0); } }

/* Über allen Fenstern (.ssheet: Suche, Räume, Player … z-index 10), unter dem Bildschirmschoner
   (30, den das Klingeln ausblendet): Wer klingelt, verdrängt jedes offene Fenster. */
.popup { position: absolute; inset: 0; z-index: 20; display: grid; place-items: center;
  padding: calc(24px + var(--sat)) 24px calc(24px + var(--sab));
  background: rgba(10,10,10,.45); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.popup[hidden] { display: none; }
.panel { width: min(900px, 100%); border-radius: 28px; padding: 22px; color: #fff;
  background: rgba(40,36,32,.72); border: 1px solid rgba(255,255,255,.16); }
.phead { display: flex; align-items: center; justify-content: space-between; margin: 0 4px 16px; }
.ptitle { font-size: 26px; font-weight: 700; letter-spacing: -.02em; }
.popup.rang .ptitle::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 10px;
  border-radius: 50%; background: #ff453a; vertical-align: middle; }
.psub { font-size: 13px; opacity: .7; margin-top: 2px; }
.pclose { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255,255,255,.12); }
.pvideo { border-radius: 18px; overflow: hidden; background: #000; aspect-ratio: 16 / 9; }
.pvideo > * { display: block; height: 100%; --ha-card-border-radius: 0; --ha-card-border-width: 0; }
.pnovideo { display: grid; place-items: center; height: 100%; opacity: .6; }
.pactions { display: flex; gap: 12px; margin-top: 16px; }
.pbtn { flex: 1; height: 60px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
  gap: 10px; font-size: 17px; font-weight: 600; background: rgba(255,255,255,.14); --mdc-icon-size: 24px; }
.pbtn.unlock { background: rgba(255,255,255,.9); color: #1f1f1f; }
.pbtn.unlock.confirm { background: #f5a524; color: #1f1f1f; }
.pbtn.unlock.done { background: #34c759; color: #fff; }
/* Gegensprechen (SIP): während des Anrufs kein „×“ – Ablehnen/Auflegen beendet ihn. */
.popup.sip .pclose { visibility: hidden; }
.popup.talking .ptitle::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 10px;
  border-radius: 50%; background: #34c759; vertical-align: middle; }
.pbtn.accept { background: #34c759; color: #fff; animation: ring 1.6s ease-in-out infinite; }
.pbtn.hangup { background: #ff453a; color: #fff; }
.pbtn.accept:disabled, .pbtn.hangup:disabled { opacity: .6; animation: none; }
.pbtn.mic.muted { background: #f5a524; color: #1f1f1f; }
.pbtn.ptt { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.pbtn.ptt.active { background: #34c759; color: #fff; }

.bg.media .bg-img { filter: blur(48px) saturate(150%) brightness(.8); transform: scale(1.25); }

.tile.media { justify-content: flex-start; padding-top: 30px; padding-right: 112px; }
.tile.media .icon { top: 26px; transform: none; width: 36px; height: 36px; border-radius: 50%;
  display: grid; place-items: center; background: rgba(255,255,255,.18); }
.tile.media .msearch { position: absolute; top: 26px; right: 68px; z-index: 1; width: 36px; height: 36px;
  border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.18);
  --mdc-icon-size: 20px; }
.tile.media .cam { inset: -24px; width: calc(100% + 48px); height: calc(100% + 48px);
  filter: blur(18px) brightness(.55) saturate(1.3); }
.tile.media.has-art::after { content: none; position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(0,0,0,.6) 0%, rgba(0,0,0,.15) 100%); }
.tile.media .state { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slider { z-index: 1; }
.slider[hidden] { display: none; }
.tile.locked .state { opacity: .55; }
.tile.armed { background: rgba(245,165,36,.82); color: #1f1f1f; }


.tile.now_playing { flex-direction: row; align-items: center; justify-content: flex-start; gap: 18px;
  padding: 14px 16px 14px 14px; }
.np-cover { width: 100px; height: 100px; flex: none; border-radius: 14px; object-fit: cover;
  background: rgba(255,255,255,.14); }
.np-cover:not([src]) { visibility: hidden; }
.tile.now_playing.idle .np-cover { display: none; }
/* Läuft im gezeigten Raum nichts, gibt es nichts zu steuern – Tipp öffnet die Suche. */
.tile.now_playing.idle .np-controls { display: none; }
.np-info { flex: 1; min-width: 0; }
.np-player { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .7;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-title { margin-top: 3px; font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-artist { margin-top: 1px; font-size: 13px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-progress { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 11px;
  font-variant-numeric: tabular-nums; opacity: .85; }
.np-progress[hidden] { display: none; }
.np-bar { flex: 1; height: 3px; border-radius: 2px; overflow: hidden; background: rgba(255,255,255,.28); }
.np-bar i { display: block; height: 100%; width: 0; background: #fff; transition: width .9s linear; }
.np-controls { display: flex; align-items: center; gap: 4px; flex: none; }
.np-controls button { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  --mdc-icon-size: 24px; }
.np-controls button[hidden] { display: none; }
.np-controls .np-play { width: 48px; height: 48px; background: rgba(255,255,255,.92); color: #1f1f1f; }

.tile > .thumb { display: none; position: absolute; inset: -24px; width: calc(100% + 48px); height: calc(100% + 48px);
  object-fit: cover; filter: blur(18px) brightness(.55) saturate(1.3);
  box-shadow: 0 4px 14px rgba(0,0,0,.25); }
.tile.has-thumb > .thumb { display: block; }
.tile.has-thumb .state { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tile.tv { flex-direction: column; align-items: stretch; justify-content: space-between; gap: 12px;
  padding: 16px 14px 14px 20px; }
.tv-bg { position: absolute; inset: -24px; width: calc(100% + 48px); height: calc(100% + 48px); object-fit: cover;
  filter: blur(18px) brightness(.5) saturate(1.3); }
.tv-bg:not([src]) { display: none; }
.tv-top, .tv-bottom { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.tv-top { align-items: flex-start; }
.tv-info { flex: 1; min-width: 0; }
/* Viele Apps: seitlich wischen; der Rand blendet weich aus statt hart abzuschneiden. */
.tv-apps { flex: 1; min-width: 0; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent);
  mask-image: linear-gradient(90deg, #000 85%, transparent); padding-right: 24px; }
.tv-apps::-webkit-scrollbar { display: none; }
.tv-apps .schip { height: 32px; padding: 0 14px; font-size: 12px; text-transform: capitalize; }
.tv-controls { display: flex; align-items: center; gap: 4px; flex: none; }
.tv-controls button { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center;
  --mdc-icon-size: 22px; }
.tv-controls button[hidden] { display: none; }
.tv-controls .tv-power { background: rgba(255,255,255,.14); }
.tv-controls .tv-power.on { background: rgba(255,255,255,.92); color: #1f1f1f; }

.tile.agenda { justify-content: flex-start; padding: 18px 20px 16px; cursor: default; }
.pillbtn { flex: none; display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px 0 14px;
  border-radius: 999px; font-size: 15px; font-weight: 600; white-space: nowrap; color: #fff;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.26); --mdc-icon-size: 20px;
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.pillbtn[hidden] { display: none; }
.pillbtn:active { transform: scale(.97); }
.pillbtn.on { background: rgba(255,255,255,.92); color: #1f1f1f; border-color: transparent; }
header .pillbtn { height: 36px; padding: 0 14px 0 11px; font-size: 14px; --mdc-icon-size: 18px;
  background: rgba(0,0,0,.28); border-color: rgba(255,255,255,.3); }
.scroller[hidden] { display: none; }
/* Blätter mit langen Listen: Eingabefeld und Chips nicht zusammendrücken, die Liste scrollt. */
.sresults > * { flex-shrink: 0; }
.chips.scenechips { flex-wrap: nowrap; overflow-x: auto; max-width: none; margin-top: 10px; scrollbar-width: none;
  -webkit-overflow-scrolling: touch; }
.chips.scenechips::-webkit-scrollbar { display: none; }
.chips.scenechips[hidden] { display: none; }
.hero:has(.scenechips:not([hidden])) { max-width: none; }
.chip.scene { flex: none; padding-right: 16px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  transition: background .25s, color .25s; }
.chip.scene b { font-size: 13px; }
.chip.scene.fired { background: rgba(255,255,255,.9); color: #1f1f1f; }
.chip.sceneadd { background: none; border-style: dashed; }
.chip.leave { background: rgba(255,255,255,.2); }
.erow.warn .eicon { background: rgba(196,45,45,.6); }
.chip.notices .av { background: rgba(245,165,36,.45); }
.chip.notices.alarm { background: rgba(196,45,45,.8); border-color: transparent; }
.erow.notice .eicon { background: rgba(245,165,36,.3); }
.erow.notice.alarm .eicon { background: rgba(196,45,45,.75); }
.erow.notice.updates .eicon, .erow.notice.repairs .eicon { background: rgba(255,255,255,.12); }
.erow.notice.ignored { opacity: .6; }
.etext.elink { cursor: pointer; }
.escrow { border-bottom: 1px solid rgba(255,255,255,.08); }
.escrow > .erow { border-bottom: 0; }
.esc-ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 0 0 14px 48px; }
.esc-ctl:empty { display: none; }
.seg { display: inline-flex; padding: 3px; border-radius: 999px; background: rgba(255,255,255,.1); }
.seg button { height: 30px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 600; }
.seg button.on { background: rgba(255,255,255,.9); color: #1f1f1f; }
.esc-range { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 10px; }
.esc-range input { flex: 1; min-width: 0; accent-color: #f5b450; height: 28px; }
.esc-range.temp input { accent-color: #ffe0b0; }
.esc-range span { flex: none; width: 58px; font-size: 12px; opacity: .8; text-align: right; font-variant-numeric: tabular-nums; }
.esc-dots { display: flex; flex-wrap: wrap; gap: 8px; }
.esc-dot { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); }
.esc-dot.on { border-color: #fff; }
.esctools { display: flex; justify-content: center; gap: 28px; margin-top: 18px; }
.tile.person { justify-content: flex-start; gap: 10px; padding: 20px 20px 18px; min-height: 160px; }
.ptop { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pav { width: 46px; height: 46px; flex: none; border-radius: 50%; overflow: hidden; display: grid; place-items: center;
  background: rgba(255,255,255,.2); font-size: 18px; font-weight: 650; }
.pav img { width: 100%; height: 100%; object-fit: cover; }
.tile.person.home .pav { box-shadow: 0 0 0 2px rgba(255,255,255,.9); }
.pwho { min-width: 0; }
.pplace { margin-top: auto; font-size: 24px; font-weight: 650; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile.person.unknown .pplace { font-size: 18px; opacity: .65; }
.pphones { display: flex; flex-wrap: wrap; gap: 6px; }
.pphone { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: 999px;
  background: rgba(255,255,255,.14); font-size: 12px; font-weight: 600; --mdc-icon-size: 15px; white-space: nowrap; }
.pphone.low { background: rgba(196,45,45,.75); }
.tile.pmap { padding: 0; min-height: 340px; cursor: default; justify-content: stretch; }
.tile.pmap:active { transform: none; }
.tile.pmap > .state { padding: 22px 24px; font-size: 14px; opacity: .85; }
.tile.pmap > :not(.state) { flex: 1; display: block; min-height: 340px; }
.chip.eper { padding: 0 16px; font-size: 13px; font-weight: 600; }
.chip.eper.active { background: rgba(255,255,255,.9); color: #1f1f1f; border-color: transparent; }
.screen > .emsg { margin-top: 18px; }
.tile.etot { justify-content: flex-end; padding: 22px 60px 20px 24px; }
.tile.etot .icon { top: 24px; transform: none; }
.etot-val { margin-top: 4px; font-size: 28px; font-weight: 650; letter-spacing: -.02em; white-space: nowrap; }
.tile.static, .tile.ewide, .tile.eflowtile, .tile.enote { cursor: default; }
.tile.static:active, .tile.ewide:active, .tile.eflowtile:active, .tile.enote:active { transform: none; }
.tile.eflowtile { padding: 18px 12px 14px; justify-content: center; }
.tile.ewide { padding: 22px 24px; justify-content: flex-start; }
.tile.enote { padding: 22px 24px; gap: 14px; align-items: flex-start; }
.tile.enote .state { font-size: 14px; opacity: .85; }
.econ:last-child { border-bottom: 0; }
.section.shown h2, .section.shown .tile { opacity: 1; animation: none; }
.eflow { display: grid; grid-template-columns: 1fr minmax(36px, 1.3fr) 1fr minmax(36px, 1.3fr) 1fr;
  grid-template-rows: auto 36px auto; grid-template-areas: ". . solar . ." ". . lsolar . ." "grid lgrid home lbatt batt";
  justify-items: center; padding: 6px 0 4px; }
.eflow.nosolar { grid-template-rows: 0 0 auto; }
.eflow > .enode, .eflow > .eline { align-self: start; }
.enode { all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0;
  text-align: center; --c: rgba(255,255,255,.5); }
.enode-ic { width: 62px; height: 62px; border-radius: 50%; display: grid; place-items: center; margin-bottom: 4px;
  background: rgba(255,255,255,.08); border: 2px solid var(--c); --mdc-icon-size: 28px; }
.enode-val { font-size: 18px; font-weight: 650; white-space: nowrap; }
.enode-sub { font-size: 12px; opacity: .7; white-space: nowrap; }
.enode.home { grid-area: home; --c: rgba(255,255,255,.85); }
.enode.solar { grid-area: solar; --c: #d95926; }
.enode.grid { grid-area: grid; --c: #3987e5; }
.enode.grid.out { --c: #199e70; }
.enode.battery { grid-area: batt; --c: rgba(255,255,255,.55); }
.eline { position: relative; width: 100%; height: 3px; margin-top: 31px; border-radius: 2px; overflow: hidden;
  background: rgba(255,255,255,.12); --c: rgba(255,255,255,.7); }
.eline.l-grid { grid-area: lgrid; --c: #3987e5; }
.eline.l-grid.out { --c: #199e70; }
.eline.l-battery { grid-area: lbatt; }
.eflow > .eline.l-solar { grid-area: lsolar; width: 3px; height: 100%; margin-top: 0; align-self: stretch; --c: #d95926; }
.eline.on::before { content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(90deg, var(--c) 0 8px, transparent 8px 16px); background-size: 16px 100%;
  animation: eflowx .8s linear infinite; }
.eline.l-solar.on::before { background: repeating-linear-gradient(180deg, var(--c) 0 8px, transparent 8px 16px);
  background-size: 100% 16px; animation-name: eflowy; }
.eline.rev::before { animation-direction: reverse; }
@keyframes eflowx { to { background-position: 16px 0; } }
@keyframes eflowy { to { background-position: 0 16px; } }
@media (prefers-reduced-motion: reduce) { .eline.on::before { animation: none; } }
.etotals { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.etile { all: unset; cursor: pointer; min-width: 0; padding: 12px 14px; border-radius: 16px; background: rgba(255,255,255,.08); }
.etile:active { transform: scale(.97); }
.etile-val { margin-top: 6px; font-size: 20px; font-weight: 650; white-space: nowrap; }
.echart { display: flex; flex-direction: column; gap: 8px; }
.echart-read { font-size: 13px; opacity: .8; min-height: 18px; }
.echart-plot { position: relative; height: 180px; }
.echart-plot svg { width: 100%; height: 100%; display: block; overflow: visible; }
.echart-plot path, .echart-plot polyline, .echart-plot line { pointer-events: none; }
.echart-max { position: absolute; top: -4px; left: 0; font-size: 11px; opacity: .55; pointer-events: none; }
.ehit { fill: transparent; cursor: pointer; }
.ehit.sel { fill: rgba(255,255,255,.07); }
.echart-x { position: relative; height: 16px; font-size: 11px; opacity: .6; }
.echart-x span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.echart-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; opacity: .85; }
.eleg { display: inline-flex; align-items: center; gap: 6px; }
.eleg i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.eleg i.line { width: 14px; height: 2px; border-radius: 1px; }
.econs { display: flex; flex-direction: column; }
.econ { all: unset; cursor: pointer; display: block; padding: 10px 2px; border-bottom: 1px solid rgba(255,255,255,.08); }
.econ-top { display: flex; justify-content: space-between; gap: 12px; font-size: 15px; }
.econ-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.econ-kwh { flex: none; font-weight: 600; }
.econ-bar { margin-top: 6px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
.econ-fill { height: 100%; border-radius: 3px; background: #3987e5; }
.econ-w { margin-top: 4px; font-size: 12px; opacity: .65; }
.econ-w:empty { display: none; }
.econ-more { align-self: center; margin-top: 10px; }
.ehint { font-size: 13px; opacity: .7; margin: -4px 0 14px; }
.emsg { font-size: 13px; margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; background: rgba(196,45,45,.5); }
.erow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.08); }
.eicon { width: 36px; height: 36px; border-radius: 12px; flex: none; display: grid; place-items: center;
  background: rgba(255,255,255,.1); --mdc-icon-size: 20px; }
.etext { flex: 1; min-width: 0; }
.stextbtn.emove { font-size: 13px; font-weight: 500; opacity: .55; padding: 6px 4px; }
.epick { width: 100%; text-align: left; color: inherit; font: inherit; background: none; border: 0;
  border-bottom: 1px solid rgba(255,255,255,.08); cursor: pointer; }
.epick.current { opacity: .5; cursor: default; }
.efold { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; --mdc-icon-size: 18px; }
.eaddhead { flex: none; margin-bottom: 6px; }
.eaddhead .sfilters { margin-top: 12px; }
.eaddlist { display: flex; flex-direction: column; }
.epick > ha-icon { flex: none; opacity: .5; }
.esub { margin: 22px 0 4px; font-size: 13px; font-weight: 600; opacity: .75; text-transform: uppercase; letter-spacing: .06em; }
.tile.energy { justify-content: flex-start; padding: 18px 20px 16px; cursor: default; gap: 10px; }
.tile.energy.sunny { background: linear-gradient(135deg, rgba(255,196,84,.32), rgba(255,255,255,.14) 60%); }
.en-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; }
.en-price { all: unset; cursor: pointer; font-size: 12px; opacity: .72; white-space: nowrap; }
.en-big { all: unset; cursor: pointer; display: flex; align-items: baseline; gap: 10px; min-width: 0; --mdc-icon-size: 22px; }
.en-big ha-icon { align-self: center; opacity: .9; }
.en-value { white-space: nowrap; font-size: 34px; font-weight: 600; letter-spacing: -.02em; line-height: 1; }
.en-label { font-size: 13px; opacity: .72; white-space: nowrap; }
.en-stats { display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 8px; }
.en-stat { all: unset; cursor: pointer; min-width: 0; padding: 10px 12px; border-radius: 14px;
  background: rgba(255,255,255,.1); display: flex; flex-direction: column; gap: 2px; }
.en-stat:active { transform: scale(.97); }
.en-stat-top { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .8; --mdc-icon-size: 16px; }
.en-stat-value { font-size: 17px; font-weight: 600; white-space: nowrap; }
.en-stat-sub { font-size: 11px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 13px; }
.ag-head { display: flex; align-items: center; justify-content: space-between; --mdc-icon-size: 20px; opacity: .95; }
.ag-list { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.ag-row { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ag-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ag-when { width: 92px; flex: none; display: flex; flex-direction: column; font-size: 12px; line-height: 1.25; }
.ag-when span { opacity: .7; }
.ag-what { flex: 1; min-width: 0; }
.ag-title { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ag-sub { font-size: 12px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ag-sub:empty { display: none; }
.ag-empty { font-size: 13px; opacity: .65; padding: 6px 0; }
.tile.fuel { justify-content: flex-start; padding: 18px 20px 14px; cursor: default; }
.fu-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.fu-filter { display: flex; gap: 6px; }
.fu-chip { font: inherit; font-size: 13px; color: inherit; border: 0; border-radius: 999px; padding: 6px 12px; background: rgba(255,255,255,.12); cursor: pointer; }
.fu-chip.active { background: rgba(255,255,255,.9); color: #1b1b1f; font-weight: 600; }
.fu-list { display: flex; flex-direction: column; margin-top: 10px; }
.fu-row { font: inherit; color: inherit; background: none; border: 0; text-align: left; cursor: pointer; display: grid; grid-template-columns: minmax(0, 1fr) 96px 104px; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid rgba(255,255,255,.1); }
.fu-row:first-child { border-top: 0; }
.fu-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fu-spark { width: 96px; height: 26px; overflow: visible; }
.fu-spark path { fill: none; stroke: currentColor; stroke-width: 1.6; opacity: .7; stroke-linejoin: round; }
.fu-price { font-size: 15px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; display: flex; flex-direction: column; align-items: flex-end; }
.fu-diff { font-size: 11px; font-weight: 400; opacity: .6; }
.fu-row.best .fu-name, .fu-row.best .fu-price { color: #9be08a; }
.fu-row.best .fu-spark path { stroke: #9be08a; opacity: 1; }

.saver { position: absolute; inset: 0; z-index: 30; background: #000; overflow: hidden; }
.saver[hidden] { display: none; }
.sv-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0;
  transition: opacity 2.5s ease; animation: kenburns 40s ease-in-out infinite alternate; }
.sv-img.show { opacity: 1; }
@keyframes kenburns { from { transform: scale(1.04) translate(0, 0); } to { transform: scale(1.14) translate(-2%, -1%); } }
.sv-shade { position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.05) 55%, rgba(0,0,0,.25) 100%); }
.sv-text { position: absolute; left: 8%; bottom: calc(9% + var(--sab)); }
.sv-clock { font-size: clamp(88px, 13vw, 168px); font-weight: 200; letter-spacing: -.04em; line-height: 1; }
.sv-date { margin-top: 6px; font-size: 22px; font-weight: 500; opacity: .85; }
.sv-info { margin-top: 10px; max-width: 84vw; font-size: 16px; opacity: .75; white-space: pre;
  overflow: hidden; text-overflow: ellipsis; }
/* Nachts: nur eine gedimmte Uhr auf Schwarz, keine Fotos. */
.saver.night .sv-img, .saver.night .sv-shade { display: none; }
.saver.night .sv-text { left: 50%; bottom: 50%; transform: translate(-50%, 50%); text-align: center; opacity: .32; }
.saver.night .sv-clock { font-size: clamp(72px, 10vw, 128px); }

/* Fenster ohne Kasten: abgedunkelter, unscharfer Hintergrund, Inhalt direkt darauf. */
.ssheet { position: absolute; inset: 0; z-index: 10; display: flex; justify-content: center; padding: 0;
  background: rgba(8,7,6,.62); backdrop-filter: blur(30px) saturate(120%); -webkit-backdrop-filter: blur(30px) saturate(120%);
  animation: sheetIn .25s ease; }
@keyframes sheetIn { from { opacity: 0; } to { opacity: 1; } }
.ssheet[hidden] { display: none; }
.spanel { width: min(760px, 100%); min-width: 0; height: 100%; display: flex; flex-direction: column;
  padding: calc(var(--hh) + 20px) 32px 24px; }
.sback { align-self: center; flex: none; margin-top: auto; padding: 34px 32px calc(14px + var(--sab)); font-size: 16px; font-weight: 600;
  letter-spacing: .02em; opacity: .8; }
.sback:active { opacity: .5; }
.sactions { display: flex; align-items: center; gap: 20px; }
.cbox { margin: auto 0 0; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px;
  --mdc-icon-size: 44px; animation: riseIn .55s cubic-bezier(.2,.75,.25,1) backwards; }
.ctitle { font-size: 26px; font-weight: 700; letter-spacing: -.01em; max-width: 520px; }
.ctext { font-size: 15px; opacity: .7; max-width: 440px; line-height: 1.45; }
.cgo { flex: none; width: min(320px, 100%); margin-top: 12px; }
.stextbtn { font-size: 15px; font-weight: 600; opacity: .8; padding: 6px 0; }
.stextbtn:active { opacity: .5; }
.shead { display: flex; gap: 12px; align-items: center; }
.sfield { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 18px; border-radius: 999px;
  background: rgba(255,255,255,.12); --mdc-icon-size: 22px; }
.sinput { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: #fff; font: inherit; font-size: 17px; }
.sinput::placeholder { color: rgba(255,255,255,.55); }
.sfilters, .stargets { display: flex; gap: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.sfilters { margin-top: 14px; }
.starget { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.slabel { flex: none; font-size: 12px; opacity: .65; }
.schip { flex: none; height: 34px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.14); }
.schip.active { background: rgba(255,255,255,.9); color: #1f1f1f; }
.sresults { flex: 1; overflow-y: auto; margin-top: 14px; display: flex; flex-direction: column; gap: 4px;
  scrollbar-width: none; }
.ssection { margin: 6px 4px 6px; font-size: 13px; font-weight: 600; opacity: .7; }
.srow { display: flex; align-items: center; gap: 14px; padding: 8px; border-radius: 14px; text-align: left; }
.srow:active, .srow.busy { background: rgba(255,255,255,.1); }
.sthumb { width: 52px; height: 52px; flex: none; border-radius: 10px; object-fit: cover; background: rgba(255,255,255,.1); }
.stext { flex: 1; min-width: 0; }
.sname { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ssub { margin-top: 2px; font-size: 12px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.splay { width: 36px; height: 36px; flex: none; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255,255,255,.14); --mdc-icon-size: 20px; }
.smuted, .serror { padding: 24px 8px; text-align: center; opacity: .6; }
.serror { color: #ffb4a8; opacity: 1; }
.shome-head { display: flex; align-items: baseline; justify-content: space-between; margin: 14px 4px 10px; }
.shome-head:first-child { margin-top: 2px; }
.shome-title { font-size: 19px; font-weight: 700; letter-spacing: -.01em; }
.shome-all { font-size: 13px; font-weight: 600; opacity: .7; }
.shome-strip { flex: none; display: flex; gap: 14px; overflow-x: auto; padding: 0 4px 6px;
  scroll-snap-type: x proximity; scrollbar-width: none; }
.shome-strip::-webkit-scrollbar { display: none; }
.scard { flex: none; width: 148px; text-align: left; scroll-snap-align: start; }
.scover { width: 148px; height: 148px; border-radius: 12px; object-fit: cover; display: block;
  background: rgba(255,255,255,.1); box-shadow: 0 6px 18px rgba(0,0,0,.25); }
.scard.artist .scover { border-radius: 50%; }
.scard .sname { margin-top: 8px; font-size: 14px; }
.scard:active .scover, .scard.busy .scover { transform: scale(.97); opacity: .8; }
.np-room { --mdc-icon-size: 22px; }
.np-room[hidden] { display: none; }
.rpanel .ptitle { flex: 1; font-size: 30px; }
.rpanel .shead { margin-bottom: 18px; }
.rrow { display: flex; align-items: center; gap: 10px; padding: 10px 8px; border-radius: 14px; }
.rrow.current { background: rgba(255,255,255,.1); }
.rrow .schip { height: 36px; }
.roomgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;
  margin-top: 14px; overflow-y: auto; }
.roomcard { position: relative; height: 132px; border-radius: 18px; overflow: hidden; text-align: left;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); }
.roomcard.current { border-color: rgba(255,255,255,.7); }
.rgroup { grid-column: 1 / -1; margin: 10px 2px 0; font-size: 13px; font-weight: 600; opacity: .75;
  text-transform: uppercase; letter-spacing: .06em; }
.rgroup:first-child { margin-top: 0; }
.roomgrid.editing .roomcard { cursor: pointer; }
.roomcard.hiddenroom .rc-img { filter: grayscale(1) brightness(.5); }
.roomcard.hiddenroom .rc-text { opacity: .6; }
.rc-move { position: absolute; top: 10px; right: 10px; z-index: 2; display: flex; gap: 6px; }
.rc-arrow { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(0,0,0,.45); --mdc-icon-size: 20px; }
.rc-arrow:disabled { opacity: .25; cursor: default; }
.roomadd { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  border-style: dashed; font-size: 14px; font-weight: 600; --mdc-icon-size: 26px; }
.roomadd::after { display: none; }
.rgroup.rgroup-edit { display: flex; align-items: center; gap: 10px; margin-top: 18px; opacity: 1; }
.rgroup.rgroup-edit:first-child { margin-top: 0; }
.rg-title { flex: 1; min-width: 0; opacity: .75; }
.rg-actions { display: flex; gap: 6px; }
.rg-actions .rc-arrow { width: 32px; height: 32px; background: rgba(255,255,255,.12); }
.roomadd.flooradd { grid-column: 1 / -1; height: 64px; flex-direction: row; margin-top: 10px; }
.echip.enew { display: inline-flex; align-items: center; gap: 6px; background: none; border: 1px dashed rgba(255,255,255,.4);
  --mdc-icon-size: 18px; }
.einput { width: 100%; height: 48px; padding: 0 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,.2);
  background: rgba(255,255,255,.08); color: inherit; font: inherit; font-size: 16px; outline: none; }
.einput:focus { border-color: rgba(255,255,255,.6); }
.echips { display: flex; flex-wrap: wrap; gap: 8px; }
.echip { height: 38px; padding: 0 16px; border-radius: 999px; background: rgba(255,255,255,.1); font-size: 14px; }
.echip.on { background: rgba(255,255,255,.9); color: #1f1f1f; }
.esave { flex: none; margin-top: 24px; }
.stextbtn.edanger { color: #ff6b61; margin-top: 14px; align-self: center; }
.pbtn.edangerbtn { flex: none; width: 100%; background: #ff453a; color: #fff; }
.iconpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 10px; margin-bottom: 16px; }
.ipick { height: 64px; border-radius: 16px; display: grid; place-items: center; background: rgba(255,255,255,.08);
  --mdc-icon-size: 28px; }
.ipick.on { background: rgba(255,255,255,.9); color: #1f1f1f; }
.ethumb { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; }
.imgpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
.impick { position: relative; height: 96px; border-radius: 14px; overflow: hidden; background: rgba(255,255,255,.08);
  border: 2px solid transparent; cursor: pointer; }
.impick img { width: 100%; height: 100%; object-fit: cover; display: block; }
.impick.on { border-color: rgba(255,255,255,.9); }
.impick.imtext { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  font-size: 14px; font-weight: 600; --mdc-icon-size: 26px; }
.impick input { display: none; }
.impick.busy { opacity: .6; pointer-events: none; }
.rc-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: brightness(.82) saturate(1.05); }
.rc-img:not([src]) { display: none; }
.roomcard::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(0,0,0,.65) 0%, rgba(0,0,0,.1) 70%); }
.rc-text { position: absolute; left: 16px; bottom: 14px; right: 50px; z-index: 1; }
.rc-name { font-size: 17px; font-weight: 600; }
.rc-status { margin-top: 2px; font-size: 12px; opacity: .8; min-height: 14px; }
.rc-icon { position: absolute; right: 14px; bottom: 14px; z-index: 1; --mdc-icon-size: 20px; opacity: .85; }
.tab-label { display: none; }
.shead .schip { flex: none; }
.lrow { display: flex; flex-direction: column; gap: 14px; padding: 20px 4px;
  border-bottom: 1px solid rgba(255,255,255,.1); }
.lrow:last-child { border-bottom: 0; }
.ltop { display: flex; align-items: center; gap: 14px; }
.lname { flex: 1; min-width: 0; text-align: left; }
.lname .sname { font-size: 18px; }
.lname .ssub { font-size: 13px; margin-top: 3px; }
.lslider { width: 100%; -webkit-appearance: none; appearance: none; height: 22px; background: transparent; }
.lcolors { display: flex; gap: 10px; flex-wrap: wrap; }
.lcolor { height: 32px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.ltemp { padding: 0 14px; background: rgba(255,255,255,.12); }
.ldot { width: 32px; border: 2px solid rgba(255,255,255,.35); }
.lslider[hidden] { display: none; }
.lslider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px;
  background: linear-gradient(90deg, #f5b450 0 var(--fill), rgba(255,255,255,.2) var(--fill) 100%); }
.lslider::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -8px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.lslider::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,.2); }
.lslider::-moz-range-progress { height: 4px; border-radius: 2px; background: #f5b450; }
.lswitch { flex: none; width: 50px; height: 30px; border-radius: 999px; position: relative;
  background: rgba(255,255,255,.18); transition: background .2s; }
.lswitch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
  background: #fff; transition: transform .2s; }
.lswitch.on { background: #f5b450; }
.sdone { flex: none; color: #9be08a; --mdc-icon-size: 24px; }
.lswitch.on::after { transform: translateX(20px); }
.smore { align-self: center; margin: 8px 0 4px; height: 40px; padding: 0 18px; border-radius: 999px;
  background: rgba(255,255,255,.12); font-size: 13px; }

.tabbar { display: none; }

/* ── Bewegung: ruhig und kurz, eine Kurve für alles ── */
@keyframes riseIn {
  from { opacity: 0; transform: translateY(16px); filter: blur(6px); }
  to { opacity: 1; transform: none; filter: none; }
}
@keyframes softIn { from { opacity: 0; } to { opacity: 1; } }
.frame.enter .bg { animation: softIn .9s ease-out backwards; }
.frame.enter header { animation: softIn .7s ease-out .1s backwards; }
.frame.enter .hero > * { animation: riseIn .8s cubic-bezier(.2,.75,.25,1) backwards; }
.frame.enter .hero > :nth-child(1) { animation-delay: .12s; }
.frame.enter .hero > :nth-child(2) { animation-delay: .18s; }
.frame.enter .hero > :nth-child(3) { animation-delay: .26s; }
.frame.enter .screen > .tiles > .tile {
  animation: riseIn .75s cubic-bezier(.2,.75,.25,1) backwards;
  animation-delay: calc(.3s + var(--i, 0) * 60ms); }
.frame.enter .more { animation: softIn .6s ease-out .7s backwards; }
.section h2, .section .tile { opacity: 0; }
.section.in h2 { animation: riseIn .6s cubic-bezier(.2,.75,.25,1) forwards; }
.section.in .tile { animation: riseIn .65s cubic-bezier(.2,.75,.25,1) forwards;
  animation-delay: calc(.08s + var(--i, 0) * 50ms); }
.ssheet:not([hidden]) .roomcard,
.ssheet:not([hidden]) .lrow {
  animation: riseIn .55s cubic-bezier(.2,.75,.25,1) backwards;
  animation-delay: calc(.06s + var(--i, 0) * 45ms); }
/* Player: Cover, Titel mit Herz, Fortschritt, Steuerung, Lautstärke – mittig, eine Spalte. */
.ppanel .pl-body { flex: 1; min-height: 0; width: min(440px, 100%); align-self: center; overflow-y: auto;
  display: flex; flex-direction: column; align-items: center; gap: 14px; scrollbar-width: none; }
.pl-room { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
.pl-cover { width: min(340px, 72vw, 40vh); aspect-ratio: 1; flex: none; border-radius: 22px; object-fit: cover;
  background: rgba(255,255,255,.12); box-shadow: 0 24px 60px rgba(0,0,0,.45); }
.pl-cover:not([src]) { visibility: hidden; }
.pl-meta { width: 100%; display: flex; align-items: center; gap: 14px; margin-top: 6px; }
.pl-metatext { flex: 1; min-width: 0; }
.pl-title { font-size: 22px; font-weight: 700; letter-spacing: -.01em; line-height: 1.2; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.pl-artist { font-size: 15px; opacity: .7; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-fav { flex: none; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255,255,255,.12); --mdc-icon-size: 24px; }
.pl-fav.on { background: rgba(255,255,255,.92); color: #e0245e; }
.pl-fav[hidden] { display: none; }
.ppanel .slider { position: static; width: 100%; }
.pl-times { width: 100%; display: flex; justify-content: space-between; font-size: 12px; opacity: .7; margin-top: -10px;
  font-variant-numeric: tabular-nums; }
.pl-seek[hidden], .pl-times[hidden], .pl-vol[hidden] { display: none; }
.pl-controls { width: 100%; display: flex; align-items: center; justify-content: space-between; }
.pl-controls button { width: 50px; height: 50px; border-radius: 50%; display: grid; place-items: center; --mdc-icon-size: 30px; }
.pl-controls .pl-play { width: 74px; height: 74px; background: rgba(255,255,255,.92); color: #1f1f1f; --mdc-icon-size: 36px; }
.pl-controls .pl-mode { --mdc-icon-size: 22px; opacity: .5; }
.pl-controls .pl-mode.active { opacity: 1; background: rgba(255,255,255,.16); }
.pl-vol { width: 100%; display: flex; align-items: center; gap: 12px; --mdc-icon-size: 20px; }
.pl-vol .slider { flex: 1; min-width: 0; }
.pl-actions { display: flex; gap: 10px; }
.pl-toast { min-height: 18px; font-size: 13px; opacity: .75; }

@media (prefers-reduced-motion: reduce) {
  .frame *, .frame { animation: none !important; transition: none !important; }
  .section h2, .section .tile { opacity: 1; }
}

@media (max-width: 760px) {
  header { padding: calc(18px + var(--sat)) 20px 0; }
  header { grid-template-columns: 1fr auto; }
  nav.top, .clock { display: none; }
  .mark img { width: 18px; height: 18px; }
  .ssheet { padding: 0; }
  .sv-text { left: 20px; bottom: 12%; }
  .sv-clock { font-size: 84px; }
  .sv-date { font-size: 18px; }
  .scard { width: 124px; }
  .scover { width: 124px; height: 124px; }
  .spanel { padding: calc(var(--hh) + 12px) 18px 18px; }
  .rpanel .ptitle { font-size: 26px; }
  .brand { font-size: 13px; }
  .frame { --hh: calc(56px + var(--sat)); }
  .frame.scrolled header { padding-top: calc(12px + var(--sat)); }
  .screen { padding: 0 12px calc(156px + var(--sab)); }
  .hero { max-width: none; padding: 0 4px; }
  .screen > .tiles { padding-top: 22px; }
  h1 { font-size: 46px; margin: 4px 0 12px; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  /* Breite Kacheln füllen auf dem Handy die ganze Zeile (2 Spalten). */
  .tiles > .tile[style*="--span"] { grid-column: span 2; }
  .more { margin: 14px 0 -60px; }
  .sections { padding: calc(var(--hh) + 40px) 12px calc(120px + var(--sab)); gap: 26px; }
  .tile.now_playing { gap: 12px; padding: 12px; }
  .np-cover { width: 76px; height: 76px; border-radius: 12px; }
  .np-title { font-size: 15px; }
  .np-controls button { width: 34px; height: 34px; }
  .np-controls .np-play { width: 42px; height: 42px; }
  .tile.tv { gap: 10px; padding: 14px 12px 12px 16px; }
  .tv-controls button { width: 34px; height: 34px; }
  .tile { min-height: 124px; padding-left: 20px; }
  /* Musik-Kachel wie die Licht-Kachel: Text oben links, ein Knopf oben rechts, Regler unten.
     Die Lupe entfällt – ein Tipp auf die Kachel öffnet die Suche, solange nichts läuft. */
  .tile.media { padding: 26px 60px 0 20px; }
  .tile.media .icon { top: 20px; right: 14px; }
  .tile.media .msearch { display: none; }
  .tile.tv { min-height: 124px; }
  .en-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile.etot { padding: 20px 48px 18px 20px; }
  .etot-val { font-size: 22px; }
  .tile.ewide { padding: 18px 16px; }
  .en-value { font-size: 28px; }
  .tile.lights { padding-top: 26px; }
  .slider { left: 20px; right: 20px; }
  .tabbar { position: absolute; z-index: 3; left: 50%; bottom: calc(14px + var(--sab)); transform: translateX(-50%);
    display: flex; gap: 6px; padding: 6px 10px; border-radius: 999px;
    background: rgba(255,255,255,.17); border: 1px solid rgba(255,255,255,.22);
    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }
  .roomgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .roomcard { height: 112px; }
  .tab { width: min(64px, calc((100vw - 64px) / var(--n))); height: 52px; flex-direction: column; gap: 2px;
    --mdc-icon-size: 22px !important; display: grid; place-items: center; border-radius: 999px;
    --mdc-icon-size: 24px; opacity: .8; }
  .tab.active { opacity: 1; background: rgba(255,255,255,.2); }
  .tab { display: flex !important; align-items: center; justify-content: center; }
  .tab-label { display: block; font-size: 10px; font-weight: 500; letter-spacing: .01em; }
  .popup { padding: 12px; }
  .panel { padding: 16px; border-radius: 24px; }
  .ptitle { font-size: 22px; }
  .pactions { flex-direction: column; gap: 10px; }
  /* Untereinander darf flex: 1 die Höhe nicht wegnehmen – feste, gut treffbare Knöpfe. */
  .pactions .pbtn { flex: none; height: 60px; }
}
`;

customElements.define("elvio-room-card", ElvioRoomCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "elvio-room-card",
  name: "Elvio Raumkarte",
  description: "Vollbild-Raumansicht fürs Wandtablet",
});
