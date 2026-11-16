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
| Music Assistant | Add-on installieren, starten, mit Home Assistant verbinden (nur Home Assistant OS) |
| Push: günstig tanken | Nur mit Tankerkönig: Sorte und Empfänger wählen, Sensoren und Automation werden angelegt |

```yaml
- {type: setup}
```

Fehlt etwas, zeigt die Karte Admins oben einen Hinweis „2 offen“ (abschalten mit
`setup_hint: false`). Ohne Admin-Anmeldung sieht man davon nichts, und nichts wird ungefragt
installiert.
