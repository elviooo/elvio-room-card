# Tablet-Dashboard mit Claude einrichten

Diese Anleitung richtet sich an einen KI-Assistenten (z. B. Claude) mit Zugriff auf
Home Assistant über einen Connector (MCP). Ziel: aus den echten Räumen und Geräten der
Installation ein fertiges Dashboard mit der **elvio Room Card** bauen.

## Regeln für den Assistenten

- **Nur Entitäten verwenden, die du über den Connector gesehen hast.** Keine IDs raten oder
  aus Beispielen übernehmen. Fehlt etwas, lass die Kachel weg und sag es.
- **Keine Geräte schalten**, keine Automationen, Szenen oder Einstellungen ändern. Die Aufgabe
  ist nur das Dashboard.
- Kannst du über den Connector selbst ein Dashboard speichern, frag vorher und lege ein
  **neues** Dashboard an. Ein bestehendes überschreibst du nie. Sonst gibst du die YAML aus
  und erklärst das Einfügen (siehe Schritt 4).
- Schreib für Laien: kurze Sätze, keine Fachbegriffe ohne Erklärung.

## Schritt 1: Voraussetzungen klären

1. **Karte installiert?** Frag den Nutzer, ob „elvio Room Card“ als installiert angezeigt wird –
   ab Home Assistant 2026.11 im eingebauten Marketplace (Seitenleiste), davor in HACS. Falls
   nicht: Installation wie im README beschrieben, danach den Browser neu laden.
2. **Sieht der Connector alles?** Der offizielle Home-Assistant-Connector zeigt nur Geräte, die
   für Sprachassistenten freigegeben sind. Wirken Räume leer oder fehlen offensichtliche Lampen,
   bitte den Nutzer: Einstellungen → Sprachassistenten → Reiter „Freigeben“ → die
   Geräte freigeben, die aufs Tablet sollen.

## Schritt 2: Bestand lesen

Über den Connector Räume (Bereiche) und Entitäten mit ihrem Raum auslesen. Sinnvoll für
das Dashboard sind vor allem:

| Domain | Kachel |
|---|---|
| `light.*` | gesammelt in einer `lights`-Kachel je Raum |
| `climate.*` | `climate` |
| `cover.*`, `lock.*`, `fan.*`, `vacuum.*`, `switch.*` | `entity` (Standardkachel) |
| `media_player.*` (Fernseher) | `tv` |
| `media_player.*` (Lautsprecher) | `media` oder `now_playing` |
| `camera.*` | `camera` |
| `scene.*`, `script.*` | `action` |
| `weather.*` | `weather` |
| `calendar.*` | `agenda` (Liste unter `entities`) |
| `person.*` | als Chip oben (`chips`) |
| `sensor.*` Temperatur | `temperature:` der Karte (Zuhause); Raumtemperatur als Temperatursensor am Bereich in HA |

Zeig dem Nutzer vor dem Bauen kurz, was du gefunden hast (Räume und Anzahl Geräte), und frag,
ob Räume wegfallen oder anders heißen sollen. Umbenennen und Weglassen passiert in HA an den Bereichen (Name bzw. Label „Nicht am Tablet“), nicht in der YAML.

## Schritt 3: YAML bauen

Aufbau: eine Ansicht „Zuhause“ als Übersicht, eine Ansicht „Raum“ (`path: raum`, `area: auto`)
für alle Räume und eine Ansicht „Einstellungen“. Räume sind die Bereiche in HA – sie stehen
**nicht** in `nav`; Icon, Bild und Temperatur des Raums gehören an den Bereich. Jede Ansicht ist
`type: panel` mit genau **einer** `custom:elvio-room-card`. Gemeinsame Einstellungen stehen
einmal oben als YAML-Anker (`&basis`) und werden mit `<<: *basis` übernommen.

```yaml
basis: &basis
  type: custom:elvio-room-card
  brand: "{name}."                 # {name} = Name des Zuhauses aus HA (Einstellungen → System → Allgemein)
  menu_path: /lovelace/0           # Tipp auf den Schriftzug führt (nach Nachfrage) in die normale Oberfläche
  nav:                             # Leiste mit den Ansichten; „Räume“ erscheint automatisch hinter dem ersten Eintrag
    - {name: Zuhause, path: /DASHBOARD-URL/zuhause, icon: mdi:home-outline}
    - {name: Einstellungen, path: /DASHBOARD-URL/einstellungen, icon: mdi:cog-outline}

views:
  - title: Zuhause
    path: zuhause
    type: panel
    cards:
      - <<: *basis
        title: Zuhause
        chips: [person.BEISPIEL, offen]   # "offen" = offene Fenster/Türen, nur sichtbar wenn etwas offen ist
        tiles:
          - {type: lights, name: Licht, entities: [light.BEISPIEL]}
        sections:
          - title: Szenen
            tiles:
              - {type: action, entity: scene.BEISPIEL, icon: mdi:weather-night}

  - title: Raum
    path: raum
    type: panel
    cards:
      - <<: *basis
        title: Raum
        area: auto                       # Raum aus der Adresse (…/raum?bereich=<id>)
        tiles:
          - {type: lights, name: Licht, entities: []}

  - title: Einstellungen
    path: einstellungen
    type: panel
    cards:
      - <<: *basis
        title: Einstellungen
        tiles:
          - {type: setup}
          - {type: views}
```

`DASHBOARD-URL` ist der Pfad des neuen Dashboards (steht nach dem Anlegen in der Adresszeile,
z. B. `dashboard-tablet`). Alle `BEISPIEL`-Werte durch echte IDs ersetzen.

### Was die Karte von selbst macht

Mit `area:` (oder, nur alte Dashboards mit Räumen in `nav`: wenn der Ansichtstitel einem Raum in `nav` mit `room: true` entspricht)
holt die Karte neue Geräte des Raums **automatisch** dazu: Lichter in die Licht-Kachel, Kameras
unter „Kameras“, Sensoren und Melder unter „Sensoren“, alles andere unter „Weitere Geräte“.
Geräte lassen sich in HA mit den Labels **„Am Tablet“** bzw. **„Nicht am Tablet“** gezielt ein-
oder ausblenden – am Tablet geht das mit Admin-Anmeldung über den Stift im Raum (dort auch
„+ Hinzufügen“ für Kameras, Sensoren und Geräte aus anderen Räumen). Du musst also nicht jedes
Gerät einzeln eintragen; die wichtigsten reichen.

### Referenz

Pflicht je Karte: `title` und mindestens eine Kachel in `tiles`.

**Karte:** `title`, `brand`, `menu_path`, `area` (`auto` = Raum aus der Adresse), `nav`, `rooms_path`, `chips`, `tiles`, `sections`
(`title` + `tiles`), `temperature`, `background` (Bild-URL wie `/local/…jpg` oder `camera.*`),
`logo`, `media_players` (zusätzliche Player), `screensaver` (`after` Sekunden, `images`,
`entity`, `night_entity`, `night_from`, `night_to`).

**Kachel (allgemein):** `type`, `entity`, `name`, `icon`, `span` (Breite 1 oder 2).

| `type` | Braucht / kann |
|---|---|
| `entity` (Standard), `climate`, `toggle`, `camera`, `media`, `weather`, `action` | `entity` |
| `tv` | `entity`, optional `apps: [Netflix, YouTube]` |
| `lights` | `entities` |
| `doorbell` | `entity` (Klingel-Ereignis), optional `camera`, `camera_crop` (z. B. `{top: 20}`: oben 20 % des Livebilds weglassen, siehe README „Bildausschnitt der Klingel“), `unlock` (`button.*`, `input_button.*`, `lock.*`), `ring_types`; mit SIP Core `sip_extension` (Nebenstelle der Tür in Anführungszeichen → Gegensprechen im Popup), optional `sip_answer_dtmf` (Taste nach dem Annehmen, ohne Angabe keine; nie eine Türöffner-Taste), `sip_dtmf_mode` (`info`/`rfc2833`), `sip_push_to_talk` – siehe README „Gegensprechen über SIP Core“ |
| `agenda` | `entities` (Kalender), optional `days`, `max` |
| `energy` | `solar`, optional `price`, `home`, `grid_in`, `grid_out`, `battery`, `battery_in`, `battery_out`, `wallbox` |
| `service` | `path`, `url` oder `config_flow`; optional `state_text` |
| `now_playing`, `search`, `tablet_room` | – |
| `automations` | `templates` |
| `fuel` | `stations` (Liste mit `name`, `e5`, `e10`, `diesel` – Preis-Sensoren, z. B. Tankerkönig), optional `default` (`e5`/`e10`/`diesel`), `hours` (Verlauf, Standard 48) |
| `setup` | – |
| `views` | – (Ansichten „Personen“/„Energie“ ein/aus, Personen ausblenden) |

## Schritt 4: Einfügen (wenn der Connector keine Dashboards speichern kann)

Dem Nutzer Schritt für Schritt erklären:

1. Einstellungen → Dashboards → **Dashboard hinzufügen** → „Neues Dashboard von Grund auf“ →
   Name z. B. „Tablet“. Die Adresse merken (z. B. `dashboard-tablet`). Steht in `nav` ein
   anderer Pfad, vorher in der YAML anpassen.
2. Dashboard öffnen → Stift oben rechts → ⋮ → **Raw-Konfigurationseditor** → alles löschen →
   YAML einfügen → **Speichern** → Bearbeiten schließen.
3. Erscheint „Custom element doesn't exist: elvio-room-card“, ist die Karte nicht installiert
   oder der Browser hält den alten Stand: Seite neu laden (in der App: Einstellungen →
   Companion App → Frontend-Cache leeren).

## Schritt 5: Zusatzfunktionen einrichten

Immer eine Ansicht „Einstellungen“ mit den Kacheln `{type: setup}`, `{type: views}` und
`{type: automations, name: Automationen, templates: []}` anlegen (alle Automationen ein/aus,
für Admins Bearbeiten und Neu). Dort richtet der
Nutzer mit einem Tipp ein, was außerhalb der Karte installiert werden muss: Music Assistant,
Seitenleiste ausblenden (kiosk-mode), Startseite für alle, Karten-Update, Tank-Push, Energie
(Verbraucher in HA-Energie eintragen). Weise den Nutzer darauf hin; installiere diese Dinge nicht
selbst über den Connector, ohne zu fragen.

Die Seite **„Energie“** braucht keine eigene Ansicht: Sobald in HA-Energie (Einstellungen →
Dashboards → Energie) etwas eingetragen ist, steht sie in der Leiste, und die Kachel `energy`
öffnet sie per Tipp. Netzzähler, Solar und Batterie trägt man in HA-Energie ein (mit
Leistungssensor für die Live-Werte), nicht in der YAML.
