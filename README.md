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

Weitere Kacheln lassen sich unter `sections` gruppieren (`title` + `tiles`).

### Tipp fürs Wandtablet

Die Karte legt sich über Kopf- und Seitenleiste. Wer sie ganz ausblenden will, nimmt dazu
[kiosk-mode](https://github.com/NemesisRE/kiosk-mode) (ebenfalls über HACS).
