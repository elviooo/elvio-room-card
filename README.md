# elvio Room Card

Raumkarte für Home Assistant, gebaut fürs Wandtablet: Vollbild-Hintergrund, großer Titel,
Chips und Milchglas-Kacheln für Licht, Heizung, Schlösser, Klingel, Musik, Termine und mehr.
Eine einzige JavaScript-Datei, keine weiteren Abhängigkeiten.

## Installation über HACS

[![In HACS öffnen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=elviooo&repository=elvio-room-card&category=plugin)

1. Auf den Knopf oben klicken, einmal die Adresse der eigenen Home-Assistant-Instanz angeben.
2. In HACS **Herunterladen** wählen und den Browser neu laden.

HACS trägt die Ressource selbst ein. Ohne den Knopf: HACS → ⋮ → *Benutzerdefinierte
Repositories* → `https://github.com/elviooo/elvio-room-card`, Typ **Dashboard**.

## Mit einem KI-Assistenten einrichten

Wer Claude (oder einen anderen Assistenten) mit Home-Assistant-Connector nutzt, gibt ihm
[EINRICHTEN-MIT-CLAUDE.md](EINRICHTEN-MIT-CLAUDE.md). Er liest Räume und Geräte aus und baut
das Dashboard daraus.

## Verwendung

Die Karte ist für Ansichten im Panel-Modus gedacht (eine Karte füllt die ganze Fläche):

```yaml
views:
  - title: Zuhause
    path: zuhause
    type: panel
    cards:
      - type: custom:elvio-room-card
        title: Zuhause
        brand: "{name}."          # {name} = Name des Zuhauses aus HA
        menu_path: /lovelace/0     # Tipp auf den Schriftzug führt (nach Nachfrage) hierhin
        background: /local/hintergrund/zuhause.jpg   # optional, sonst ruhiger Verlauf
        temperature: climate.wohnzimmer
        tiles:
          - {type: climate, entity: climate.wohnzimmer, name: Heizung}
          - {type: entity, entity: lock.haustuer}
          - {type: lights, name: Licht, entities: [light.wohnzimmer, light.kueche]}
```

Pflicht sind `title` und mindestens eine Kachel unter `tiles`. Die Entitäten-IDs müssen an
die eigene Installation angepasst werden.

### Kacheltypen

| `type` | Braucht |
|---|---|
| `entity`, `climate`, `tv`, `action` | `entity` |
| `lights` | `entities` (Liste von Lichtern) |
| `doorbell` | `entity` (Klingel-Ereignis), optional `camera`, `unlock` (`button.*`, `input_button.*` oder `lock.*`), `sip_extension` (Gegensprechen, siehe unten) |
| `agenda` | `entities` (Kalender), optional `days`, `max` |
| `energy` | `solar` |
| `service` | `path`, `url` oder `config_flow` |
| `now_playing`, `search`, `tablet_room` | – |
| `automations` | `templates` |
| `fuel` | `stations` (Liste mit `name`, `e5`, `e10`, `diesel` – Preis-Sensoren, z. B. Tankerkönig), optional `default` (`e5`/`e10`/`diesel`), `hours` (Verlauf, Standard 48) |
| `setup` | – (nur für Admins bedienbar, siehe „Einrichtung auf Knopfdruck“) |

Weitere Kacheln lassen sich unter `sections` gruppieren (`title` + `tiles`).

**Anordnung:** `now_playing`, `tv`, `agenda` und `energy` sind doppelt breit, `fuel` ganz breit.
Auf dem Handy hat die Fläche zwei Spalten. Damit keine halben Reihen entstehen, schmale Kacheln
paarweise vor die breiten setzen; bei ungerader Zahl der letzten schmalen `span: 2` geben.

**Player:** Musik-Kachel, Live-Karte und Musik-Chips öffnen einen eigenen Player (Cover,
Spulen, Zufall, Wiederholen, Lautstärke, Räume, Suche). Das Herz drückt den Knopf
„Aktuellen Titel favorisieren“, den Music Assistant je Player anlegt – der Titel landet
damit auch beim Dienst (Spotify: Lieblingssongs). Fernseher öffnen weiter den HA-Dialog.

**Fernseher:** Die App-Knöpfe erscheinen auch im ausgeschalteten Zustand; ein Tipp schaltet ein
und startet die App.

**Ausstieg (`menu_path`):** immer auf ein normales Lovelace-Dashboard zeigen lassen, nicht auf
`/home/overview`. kiosk-mode blendet die Seitenleiste sonst auch dort weiter aus, und unter iOS
lässt sich das Menü nicht öffnen.

## Räume aus Home Assistant

Ab v1.6.0 sind Räume die **Bereiche** in Home Assistant. Name, Icon, Bild, Temperatursensor,
Stockwerk und Reihenfolge stehen im Bereich; das Dashboard braucht nur noch drei Ansichten:

```yaml
basis: &basis
  type: custom:elvio-room-card
  brand: "{name}."
  menu_path: /lovelace/0
  nav:
    - {name: Zuhause, path: /dashboard-tablet/zuhause, icon: mdi:home-outline}
    - {name: Einstellungen, path: /dashboard-tablet/einstellungen, icon: mdi:cog-outline}

views:
  - {title: Zuhause, path: zuhause, type: panel, cards: [{<<: *basis, title: Zuhause, tiles: [...]}]}
  - title: Raum
    path: raum
    type: panel
    cards:
      - <<: *basis
        title: Raum
        area: auto                       # Raum kommt aus der Adresse: …/raum?bereich=<id>
        tiles: [{type: lights, name: Licht, entities: []}]
  - {title: Einstellungen, path: einstellungen, type: panel, cards: [{<<: *basis, title: Einstellungen, tiles: [{type: setup}]}]}
```

- **Leiste:** „Räume“ erscheint hinter dem ersten Eintrag; die Übersicht gruppiert nach Stockwerk.
- **Räume verwalten** (nur mit Admin-Anmeldung): Raumübersicht → **Bearbeiten**. Raum
  hinzufügen, umbenennen, Stockwerk, Icon, Bild (Galerie oder eigenes Foto), Temperatur,
  „Am Tablet zeigen“, Reihenfolge (Pfeile), löschen. Gespeichert wird in HA.
- **Geräte hinzufügen** (nur mit Admin-Anmeldung): im Raum oben der Stift → **+ Hinzufügen**.
  Sucht im ganzen Haus (Filter: Kameras & Klingeln, Sensoren, Schalter & Steckdosen, Licht,
  Sonstiges); Antippen zeigt die Funktionen des Geräts zum Anhaken. Sinnvolles ist vorausgewählt
  (Kamera, Bewegung, Tür/Fenster, Temperatur, Rauch …), Messwerte wie Leistung oder Energie
  nicht. Ein Gerät ohne Raum kommt ganz in den Raum, eines aus einem anderen Raum nur mit den
  angehakten Funktionen (Mehrkanal-Aktoren: jeder Ausgang in seinem Raum). Im Raum stehen
  hinzugefügte Dinge unter „Weitere Geräte“, „Kameras“ und „Sensoren“. Gilt auch für Zonen wie
  Garten oder Einfahrt – in HA ebenfalls Bereiche.
- **Bild ohne eigene Wahl:** passt der Name zu einem Bild im Repo (`bilder/`), wird es genommen.
- **Ausblenden:** Label „Nicht am Tablet“ am Bereich.
- **Karten ohne `nav`** bekommen wie bisher keine Leiste und damit auch keinen Eintrag „Räume“.
- **`rooms_path`** (optional): andere Adresse der Raum-Ansicht als `/<dashboard>/raum`.
- **Alte Dashboards** (Räume mit `room: true` in `nav`) laufen unverändert. Umstellen per
  Einrichtungspunkt „Räume aus Home Assistant“: sichert das Dashboard als verstecktes
  Dashboard „… (Sicherung Datum)“, übernimmt Icon/Bild/Temperatur in die Bereiche und baut auf
  die Ansicht `raum` um. Hat eine Raum-Ansicht Kacheln, die die Karte nicht von selbst zeigt,
  wird nichts geändert und der Grund genannt. Bereiche, die bisher kein Raum in `nav` waren,
  bekommen das Label „Nicht am Tablet“ – das Tablet zeigt danach dieselben Räume wie vorher
  (im Raum-Blatt wieder einblendbar). YAML-Dashboards nach dem Beispiel oben von Hand umstellen.
- **Zurück zum alten Dashboard:** Sicherung öffnen (Einstellungen → Dashboards → „… (Sicherung
  Datum)“) → ⋮ → Raw-Konfigurationseditor → alles kopieren; im Tablet-Dashboard (`?disable_km`
  an der Adresse) ebenso den Raw-Konfigurationseditor öffnen, alles ersetzen, speichern. Icon,
  Bild, Reihenfolge und Labels der Bereiche bleiben; das alte Dashboard liest sie nicht.
- Getestet mit Home Assistant 2026.11 (Stockwerke, Bereichs-Reihenfolge und Temperatursensor
  am Bereich brauchen eine aktuelle Version).

## Energie

Ist in Home Assistant unter **Einstellungen → Dashboards → Energie** etwas eingetragen, steht in
der Leiste der Eintrag **„Energie“** (hinter „Räume“); ein Tipp auf die Kachel `energy` öffnet
dieselbe Seite. Keine eigene Ansicht nötig, alte Dashboards eingeschlossen. Jeder Teil erscheint
nur, wenn es die Daten gibt:

- **Jetzt:** Haus in der Mitte, Solar, Netz und Batterie drumherum, mit Watt und Fließrichtung
  (Leistungssensoren aus den Energie-Einstellungen).
- **Heute · Woche · Monat · Jahr:** Bezug und Einspeisung, Solar, Batterie rein/raus,
  Verbrauch, Autarkie, Eigenverbrauch, Kosten und Vergütung, wenn ein Preis hinterlegt ist.
- **Verlauf:** Balken je Stunde, Tag oder Monat – Bezug nach oben, Einspeisung nach unten,
  Solar als Linie. Ohne Netzzähler der Verbrauch der eingetragenen Geräte.
- **Verbraucher:** die Geräte aus den Energie-Einstellungen nach Verbrauch, mit Leistung jetzt.

Nur Anzeige – gesteuert wird nichts. Verbraucher einzeln einzutragen erspart der
Einrichtungspunkt „Energie einrichten“.

## Gegensprechen über SIP Core

Mit [SIP Core](https://github.com/TECH7Fox/sipcore-hass-integration) (HACS, getestet mit
v5.1.2) läuft das Gespräch mit der Türsprechstelle im Klingel-Popup der Karte: **Annehmen**,
**Ablehnen** bzw. **Auflegen**, **Mikro an/aus**, auf Wunsch eine Sprechtaste, dazu wie
bisher **Tür öffnen** (zwei Tipps). Den Ton spielt SIP Core ab.

```yaml
- type: doorbell
  name: Haustür
  entity: input_text.klingel        # wie bisher (Klingel-Ereignis)
  camera: camera.haustuer
  unlock: button.haustuer_oeffnen
  sip_extension: "900"              # Nebenstelle, von der die Tür anruft
  # sip_push_to_talk: true          # Mikro startet aus, Knopf „Halten zum Sprechen“
```

| Option | Bedeutung |
|---|---|
| `sip_extension` | Ruft diese Nebenstelle an, öffnet sich das Popup – in jeder Ansicht des Dashboards, auch aus dem Bildschirmschoner der Karte. Andere Anrufer bleiben bei SIP Core. In Anführungszeichen schreiben (`"008"` bleibt sonst nicht `008`). |
| `sip_answer_dtmf` | Optional: Taste(n), die nach dem Annehmen an die Tür gehen, z. B. `"1"`, falls die Türstation das Gespräch erst danach freigibt. Ohne Angabe geht keine Taste raus. `*` ist gesperrt (öffnet bei UniFi Access die Tür). **Vorher am Gerät prüfen, dass die Taste nicht das Schloss schaltet.** |
| `sip_dtmf_mode` | `info` (Standard, SIP INFO wie die DTMF-Knöpfe von SIP Core) oder `rfc2833`. Gilt nur für den Weg Browser → Telefonanlage; wie Asterisk die Taste an die Tür weitergibt, bestimmt dort der `dtmf_mode` der Tür-Nebenstelle. |
| `sip_push_to_talk` | `true`: Mikro startet aus, zusätzlich „Halten zum Sprechen“ |

Das Popup erscheint nur, wenn SIP Core am Tablet angemeldet ist. Bei ausgeschaltetem
Display oder im Hintergrund kann der Browser die Verbindung kappen (siehe SIP Core); dann
erreicht der Anruf das Tablet nicht.

Damit nicht zusätzlich das Popup von SIP Core aufgeht: Einstellungen → Geräte & Dienste →
SIP Core → **Konfigurieren**, beim Benutzer des Tablets eine Ausnahme eintragen und das
Tablet danach neu laden:

```yaml
users:
  - ha_username: Tablet             # HA-Benutzer, mit dem das Tablet angemeldet ist
    extension: "100"
    password: "…"                   # unverändert lassen
    overrides:
      popup_config:
        auto_open: false
```

`auto_open: false` öffnet das SIP-Core-Popup nicht mehr von selbst (der Telefon-Knopf in der
Kopfzeile bleibt). Statt `overrides` beim Benutzer wirkt `popup_config.auto_open: false`
oben in der Konfiguration für alle Geräte.

Ohne SIP Core oder ohne `sip_extension` bleibt die Kachel, wie sie war. Selbst bei der Tür
anrufen (ohne dass jemand klingelt) gibt es nicht.

## Einrichtung auf Knopfdruck

Manches gehört zur Karte, muss aber außerhalb installiert werden. Die Kachel `setup` (am
besten in einer Ansicht „Einstellungen“) prüft das und richtet es auf Knopfdruck ein:

| Punkt | Was passiert |
|---|---|
| Raumkarte aktuell | Neue Version über HACS laden |
| Seitenleiste ausblenden | [kiosk-mode](https://github.com/NemesisRE/kiosk-mode) über HACS installieren, Kopf- und Seitenleiste in diesem Dashboard ausblenden (`?disable_km` zum Bearbeiten) |
| Startseite für alle | Dieses Dashboard öffnet beim Start der App |
| Räume aus Home Assistant | Nur bei alten Dashboards: sichern, Räume in die Bereiche übernehmen, auf die Ansicht `raum` umbauen |
| Energie einrichten | Verbraucher mit eigenem Energiezähler (z. B. benannte Shelly-Kanäle, ohne Reserven und Einspeise-Zähler) mit ihrer Leistung in HA-Energie eintragen; Bestehendes bleibt |
| Music Assistant | Add-on installieren, starten, mit Home Assistant verbinden (nur Home Assistant OS) |
| Push: günstig tanken | Nur mit Tankerkönig: Sorte und Empfänger wählen, Sensoren und Automation werden angelegt |

```yaml
- {type: setup}
```

Fehlt etwas, zeigt die Karte Admins oben einen Hinweis „2 offen“ (abschalten mit
`setup_hint: false`). Ohne Admin-Anmeldung sieht man davon nichts, und nichts wird ungefragt
installiert.

## Entwicklung

```bash
node --test                    # reine Logik (Node ≥ 20, keine Pakete)
HA_URL=http://<ha-adresse>:8123 node tools/dev-server.mjs   # HA über http://localhost:8765 + Entwicklerkarte
```

Der Entwickler-Proxy zeigt Home Assistant unter `http://localhost:8765` und liefert dazu
`/elvio-dev/elvio-room-card-dev.js` aus dem Repo (Elementname `elvio-room-card-dev`). In HA die
Ressource `/elvio-dev/elvio-room-card-dev.js` (Typ Modul, relative Adresse) eintragen und im
Test-Dashboard `type: custom:elvio-room-card-dev` verwenden; die installierte Karte bleibt
unberührt, am Tablet liefert HA für die Ressource nur 404. Über den Proxy einmal bei HA anmelden. Anderer lokaler Port: `PORT=8766` davorsetzen.
