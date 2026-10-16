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
| `doorbell` | `entity` (Klingel-Ereignis), optional `camera`, `unlock` (`button.*`, `input_button.*` oder `lock.*`) |
| `agenda` | `entities` (Kalender), optional `days`, `max` |
| `energy` | `solar` |
| `service` | `path`, `url` oder `config_flow` |
| `now_playing`, `search`, `tablet_room` | – |
| `automations` | `templates` |
| `fuel` | `stations` (Liste mit `name`, `e5`, `e10`, `diesel` – Preis-Sensoren, z. B. Tankerkönig), optional `default` (`e5`/`e10`/`diesel`), `hours` (Verlauf, Standard 48) |
| `setup` | – (nur für Admins bedienbar, siehe „Einrichtung auf Knopfdruck“) |

Weitere Kacheln lassen sich unter `sections` gruppieren (`title` + `tiles`).

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
