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
// Fortschrittsbalken der Live-Karte läuft lokal weiter – HA meldet die Position nur bei
// Sprüngen (Pause, Titelwechsel), nicht jede Sekunde.
const PROGRESS_TICK_MS = 1000;
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_LIMIT = 12;
const LIBRARY_PAGE = 40;
// Termine: neu laden alle 5 Minuten oder sobald sich ein Kalender ändert.
const AGENDA_REFRESH_MS = 5 * 60 * 1000;
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
      if (tile.type === "automations" && !Array.isArray(tile.templates)) {
        throw new Error(`Automationen-Kachel braucht templates: ${JSON.stringify(tile)}`);
      }
      if (!["lights", "service", "account", "now_playing", "search", "agenda", "energy", "tablet_room", "automations"].includes(tile.type) && !tile.entity) {
        throw new Error(`Kachel ohne Entität: ${JSON.stringify(tile)}`);
      }
      if (tile.type === "service" && !tile.path && !tile.config_flow && !tile.url) {
        throw new Error(`Dienst-Kachel braucht path, url oder config_flow: ${JSON.stringify(tile)}`);
      }
      if (tile.unlock && !/^(button|input_button|lock)\./.test(tile.unlock)) {
        throw new Error(`unlock muss button.*, input_button.* oder lock.* sein: ${tile.unlock}`);
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
    // Geräte, Räume oder Labels geändert (Kunde hat etwas gekoppelt oder am Tablet
    // ein-/ausgeblendet): Ansicht neu zusammenstellen. Nur dann – Zustandsänderungen
    // tauschen diese Objekte nicht aus.
    const regChanged =
      !prev || hass.entities !== prev.entities || hass.devices !== prev.devices || hass.areas !== prev.areas;
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
    // Offenes Bearbeiten-Blatt zeigt sofort den neuen Stand (auch wenn sich die Ansicht
    // selbst nicht geändert hat, z. B. ein ausgeblendeter Sensor zieht um).
    if (this._editWrap && !this._editWrap.hidden) {
      if (regChanged && this._editMode === "devices") this._renderEdit();
      if (this._editMode === "automations") this._renderAutomations();
    }
  }

  // Neu aufbauen, ohne dass der Nutzer es merkt: Scrollstand und offenes Bearbeiten-Blatt
  // bleiben, keine Einblend-Animation.
  _rebuildKeepingPlace() {
    const top = this._scroller ? this._scroller.scrollTop : 0;
    const editing = this._editWrap && !this._editWrap.hidden && this._editMode === "devices";
    this._build(true);
    this._update();
    this._scroller.scrollTop = top;
    if (editing) this._openEdit();
  }

  // ───────────── Räume aus HA-Bereichen ─────────────

  // Bereich dieser Ansicht: `area:` in der Konfiguration, sonst der gleichnamige Raum aus
  // `nav` (Titel „Wohnbereich“ → Bereich „Wohnbereich“). Ohne Treffer: keine Automatik.
  _areaId(cfg = this._rawConfig) {
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
    const c = this._rawConfig;
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
      if (others.length) sections.push({ title: "Weitere Geräte", tiles: others.map((id) => this._autoTile(id)) });
    }
    tiles = tiles.filter(filled);
    sections = sections
      .map((sec) => ({ ...sec, tiles: sec.tiles.filter(filled) }))
      .filter((sec) => sec.tiles.length);
    return { ...c, tiles, sections };
  }

  _autoTile(id) {
    const domain = id.split(".")[0];
    if (domain === "light") return { type: "lights", entities: [id], name: this._friendly(id) };
    if (domain === "media_player") return { type: "media", entity: id };
    if (domain === "camera") return { type: "camera", entity: id };
    if (domain === "climate") return { type: "climate", entity: id };
    if (domain === "switch" || domain === "fan") return { type: "toggle", entity: id, icon: domain === "fan" ? "mdi:fan" : "mdi:power-socket-de" };
    return { type: "entity", entity: id };
  }

  _friendly(id) {
    const st = this._hass.states[id];
    return (st && st.attributes.friendly_name) || id;
  }

  // Lichter eines Raums für die Räume-Übersicht: eingetragene + dem Bereich zugeordnete.
  _roomLightIds(room) {
    const ids = new Set(room.lights || []);
    const areaId = this._resolveArea(room.area || room.name);
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
  }

  disconnectedCallback() {
    clearInterval(this._clockTimer);
    clearInterval(this._cameraTimer);
    clearInterval(this._progressTimer);
    clearInterval(this._saverTimer);
    clearInterval(this._saverPhotoTimer);
    this._closeDoorbell();
  }

  // ───────────── Aufbau (einmal je Konfiguration) ─────────────

  _build(quiet = false) {
    const c = this._config;
    const root = this.shadowRoot;
    root.innerHTML = "";
    root.appendChild(el("style", "", STYLE));

    const frame = el("div", "frame");
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
    const nav = el("nav", "top");
    for (const item of navItems) {
      const link = el("button", "link", item.name);
      if (item.active) link.classList.add("active");
      link.addEventListener("click", () => (item.rooms ? this._openRoomsNav() : this._navigate(item.path)));
      nav.appendChild(link);
    }
    this._clock = el("div", "clock");
    const right = el("div", "right");
    // Geräte bearbeiten: oben neben der Uhr, damit es in jedem Raum ohne Scrollen erreichbar
    // ist. Nur in Räumen mit HA-Bereich und nur für Admins – nur sie dürfen Labels und
    // Bereiche in HA ändern. Am Wandtablet: Dienste → Benutzer wechseln.
    if (this._areaId() && this._hass.user && this._hass.user.is_admin) {
      const edit = el("button", "editbtn");
      edit.setAttribute("aria-label", "Geräte bearbeiten");
      edit.appendChild(icon("mdi:pencil-outline"));
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
    hero.append(this._status, el("h1", "", c.title), this._chips);
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

    const main = [scroller];

    // Leiste unten (nur Handy)
    const tabbar = el("nav", "tabbar");
    tabbar.style.setProperty("--n", String(navItems.length || 1));
    for (const item of navItems) {
      const b = el("button", "tab");
      b.setAttribute("aria-label", item.name);
      b.appendChild(icon(item.icon || "mdi:circle-outline"));
      b.appendChild(el("span", "tab-label", item.name));
      if (item.active) b.classList.add("active");
      b.addEventListener("click", () => (item.rooms ? this._openRoomsNav() : this._navigate(item.path)));
      tabbar.appendChild(b);
    }

    frame.append(header, ...main, tabbar, this._buildPopup(), this._buildSearch(), this._buildRooms(), this._buildLights(), this._buildRoomsNav(), this._buildEdit(), this._buildConfirmHa());
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
        node.addEventListener("click", () => this._moreInfo(cfg.entity));
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
          if (tile.entityId && tile.active) this._moreInfo(tile.entityId);
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
        big.addEventListener("click", () => this._moreInfo(cfg.solar));
        tile.enPrice = el("button", "en-price");
        tile.enPrice.addEventListener("click", () => this._moreInfo(cfg.price));
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
    for (const tile of this._tiles) this._updateTile(tile);
    if (this._popupCard) this._popupCard.hass = hass;
    this._renderRooms();
    this._renderLights();
    this._renderRoomsNav();
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
    const key = JSON.stringify(chips);
    if (key === this._chipsKey) return;
    this._chipsKey = key;
    this._chips.innerHTML = "";
    for (const chip of chips) {
      // Antippbar: öffnet den HA-Dialog (Person: Standort/Verlauf, Musik: Lautstärke,
      // Quelle, Gruppieren, Sensor: Verlauf).
      const node = el("button", `chip ${chip.kind}`);
      node.addEventListener("click", () => (chip.id === "offen" ? this._openOpenThings() : this._moreInfo(chip.id)));
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
      const room = this._tabletRoom();
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
        tile.node.classList.toggle("alert", st.state === "triggered" || st.state === "jammed");
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
    return st.attributes.icon || "mdi:information-outline";
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

  // ───────────── Raum des Tablets & Musik je Raum ─────────────

  _tabletRoom() {
    try {
      return window.localStorage.getItem(TABLET_ROOM_KEY) || null;
    } catch (err) {
      return null; // privates Fenster o. Ä.: dann eben ohne festen Raum
    }
  }

  _setTabletRoom(name) {
    try {
      if (name) window.localStorage.setItem(TABLET_ROOM_KEY, name);
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
    const cur = this._tabletRoom();
    const rooms = (this._config.nav || []).filter((r) => r.room);
    for (const r of [...rooms, { name: null, icon: "mdi:cellphone" }]) {
      const row = el("button", "erow epick");
      const ic = el("div", "eicon");
      ic.appendChild(icon(r.icon || "mdi:door"));
      row.append(ic, el("div", "etext sname", r.name || "Nirgends (Handy, unterwegs)"));
      if ((r.name || null) === cur) {
        row.classList.add("current");
        row.appendChild(el("div", "ssub", "gewählt"));
      }
      row.addEventListener("click", () => this._setTabletRoom(r.name));
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
    for (const room of (this._config.nav || []).filter((r) => r.room)) {
      const areaId = this._resolveArea(room.area || room.name);
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
    const wanted = this._tabletRoom();
    const room = wanted ? rooms.find((r) => r.name === wanted) : null;
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
        r.active ? this._moreInfo(r.entityId) : this._openSearch(r.areaId),
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
    // App-Knöpfe nur neu bauen, wenn sich Liste oder aktive Quelle ändern (kein Flackern).
    const apps = off ? [] : (tile.cfg.apps || a.source_list || []);
    const key = JSON.stringify([apps, a.source]);
    if (key === tile.appsKey) return;
    tile.appsKey = key;
    tile.apps.innerHTML = "";
    for (const app of apps) {
      const chip = el("button", "schip", app);
      chip.classList.toggle("active", app === a.source);
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        this._hass.callService("media_player", "select_source", { entity_id: tile.cfg.entity, source: app });
      });
      tile.apps.appendChild(chip);
    }
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
    return items;
  }

  _buildRoomsNav() {
    const wrap = el("div", "ssheet");
    wrap.hidden = true;
    const panel = el("div", "spanel rpanel");
    const head = el("div", "shead");
    head.appendChild(el("div", "ptitle", "Räume"));
    this._roomGrid = el("div", "roomgrid");
    panel.append(head, this._roomGrid, this._backButton(() => (wrap.hidden = true)));
    wrap.appendChild(panel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.hidden = true;
    });
    this._roomsNavWrap = wrap;
    return wrap;
  }

  _openRoomsNav() {
    this._roomsNavWrap.hidden = false;
    this._roomCards = null;
    this._renderRoomsNav();
  }

  _renderRoomsNav() {
    if (!this._roomsNavWrap || this._roomsNavWrap.hidden) return;
    const hass = this._hass;
    const rooms = (this._config.nav || []).filter((i) => i.room);
    if (!this._roomCards) {
      this._roomGrid.innerHTML = "";
      this._roomCards = rooms.map((room) => {
        const card = el("button", "roomcard");
        if (this._isCurrent(room.path)) card.classList.add("current");
        const img = el("img", "rc-img");
        img.alt = "";
        if (room.image) img.src = room.image;
        const txt = el("div", "rc-text");
        const name = el("div", "rc-name", room.name);
        const status = el("div", "rc-status");
        txt.append(name, status);
        const ic = el("div", "rc-icon");
        ic.appendChild(icon(room.icon || "mdi:door"));
        card.append(img, txt, ic);
        card.addEventListener("click", () => {
          this._roomsNavWrap.hidden = true;
          this._navigate(room.path);
        });
        card.style.setProperty("--i", String(this._roomGrid.children.length));
        this._roomGrid.appendChild(card);
        return { room, status };
      });
    }
    // Live-Status je Raum: Lichter an, Temperatur.
    for (const { room, status } of this._roomCards) {
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
    const actions = el("div", "sactions");
    actions.appendChild(pair);
    head.append(this._editTitle, actions);
    this._editActions = actions;
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
    this._editActions.replaceChildren(this._editPairBtn);
    this._editWrap.hidden = false;
    this._renderEdit();
  }

  _renderEdit() {
    const hass = this._hass;
    const areaId = this._areaId();
    if (!areaId) return;
    this._editHint.textContent = "Was hier an ist, erscheint am Tablet. Gespeichert wird in Home Assistant – Updates ändern daran nichts.";
    this._editTitle.textContent = `Geräte · ${this._rawConfig.title}`;
    const placed = this._placedIds();
    const list = this._editList;
    list.innerHTML = "";
    const order = (e) => [AUTO_DOMAINS.includes(e.entity_id.split(".")[0]) ? 0 : 1, this._friendly(e.entity_id)];
    const entities = this._areaEntities(areaId).sort((a, b) => {
      const [x1, y1] = order(a);
      const [x2, y2] = order(b);
      return x1 - x2 || y1.localeCompare(y2, "de");
    });
    if (!entities.length) list.appendChild(el("div", "ehint", "Diesem Raum ist in Home Assistant noch nichts zugeordnet."));
    for (const e of entities) {
      const shown = this._isShown(e, placed);
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
      list.appendChild(row);
    }
    // Neu gekoppelte Geräte ohne Raum: mit einem Tipp in diesen Raum holen.
    const homeless = this._unassignedDevices();
    if (homeless.length) {
      list.appendChild(el("div", "esub", "Ohne Raum"));
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
      const labels = new Set(e.labels || []);
      labels.delete(LABEL_SHOW.id);
      labels.delete(LABEL_HIDE.id);
      // Nur die Abweichung vom Normalfall wird gespeichert.
      const byDefault = placed.has(e.entity_id) || AUTO_DOMAINS.includes(e.entity_id.split(".")[0]);
      if (show && !byDefault) labels.add(LABEL_SHOW.id);
      if (!show && byDefault) labels.add(LABEL_HIDE.id);
      await this._hass.callWS({ type: "config/entity_registry/update", entity_id: e.entity_id, labels: [...labels] });
    } catch (err) {
      this._editMsg.textContent = `Nicht gespeichert: ${err.message || err}`;
      this._editMsg.hidden = false;
    }
  }

  // Räume, in die man verschieben kann: die Räume des Tablets, die einen HA-Bereich haben.
  _moveTargets() {
    return (this._config.nav || [])
      .filter((r) => r.room)
      .map((r) => ({ name: r.name, icon: r.icon, areaId: this._resolveArea(r.area || r.name) }))
      .filter((r) => r.areaId);
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
    // Tipp neben das Fenster schließt es.
    popup.addEventListener("click", (e) => {
      if (e.target === popup) this._closeDoorbell();
    });
    this._popup = popup;
    return popup;
  }

  async _openDoorbell(cfg, rang) {
    // Klingeln weckt das Tablet aus dem Bildschirmschoner.
    this._lastActive = Date.now();
    if (this._saver && !this._saver.hidden) this._hideSaver();
    clearTimeout(this._popupTimer);
    this._popupTitle.textContent = rang ? "Es klingelt" : cfg.name || "Klingel";
    this._popupSub.textContent = rang
      ? `${cfg.name || "Klingel"} · ${this._clock ? this._clock.textContent : ""}`
      : "Livebild";
    this._popup.classList.toggle("rang", rang);
    this._popup.hidden = false;

    // Livebild über HAs eigene picture-entity-Karte: sie kann alle Stream-Arten
    // (WebRTC, HLS, Standbild), die die Kamera-Integration liefert.
    this._popupVideo.innerHTML = "";
    this._popupCard = null;
    if (cfg.camera) {
      const helpers = await window.loadCardHelpers();
      const card = helpers.createCardElement({
        type: "picture-entity",
        entity: cfg.camera,
        camera_view: "live",
        show_name: false,
        show_state: false,
        tap_action: { action: "none" },
      });
      card.hass = this._hass;
      this._popupCard = card;
      this._popupVideo.appendChild(card);
    } else {
      this._popupVideo.appendChild(el("div", "pnovideo", "Keine Kamera hinterlegt"));
    }

    this._popupActions.innerHTML = "";
    if (cfg.unlock) this._popupActions.appendChild(this._buildUnlockButton(cfg.unlock));
    const dismiss = el("button", "pbtn", "Schließen");
    dismiss.addEventListener("click", () => this._closeDoorbell());
    this._popupActions.appendChild(dismiss);

    // Ein vergessenes Popup soll nicht stundenlang den Stream offen halten.
    this._popupTimer = setTimeout(() => this._closeDoorbell(), POPUP_AUTO_CLOSE_MS);
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

  _closeDoorbell() {
    clearTimeout(this._popupTimer);
    if (this._popup) this._popup.hidden = true;
    // Karte entfernen beendet den Stream.
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
.name { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

.popup { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center;
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
.editbtn { display: grid; place-items: center; padding: 4px; background: none; border: 0; color: inherit;
  cursor: pointer; opacity: .7; --mdc-icon-size: 18px; filter: drop-shadow(0 1px 6px rgba(0,0,0,.25)); }
.editbtn:active { transform: scale(.97); }
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
.sactions { display: flex; gap: 22px; }
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
  .tile { min-height: 116px; padding-left: 20px; }
  /* Musik-Kachel: zwei Knöpfe passen nicht neben den Namen – Knöpfe oben, Text darunter. */
  .tile.media { padding: 70px 20px 52px; }
  .tile.media .icon { top: 16px; right: 14px; }
  .tile.media .msearch { top: 16px; right: 56px; }
  .en-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
