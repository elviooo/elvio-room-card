# Räume aus Home Assistant – Design

Stand: 16.11.2026 · Branch `feat/raeume-aus-ha` · Ziel-Version v1.6.0

## Ziel

Räume am Tablet sollen sich ohne YAML verwalten lassen: hinzufügen, umbenennen, löschen,
sortieren, Icon und Bild wählen (auch ein eigenes Foto), am Tablet aus- und einblenden.

Heute ist ein Raum ein Eintrag in `nav` mit eigener Ansicht. Die `nav`-Liste steht in jeder
Ansicht des Dashboards erneut (in der Test-Installation 13-mal), ein neuer Raum heißt Handarbeit in der
Konfiguration.

## Entscheidungen

- **Variante A:** Räume sind die Bereiche (Areas) in Home Assistant. Ein Dashboard braucht nur
  noch eine gemeinsame Ansicht `raum`; welcher Raum gezeigt wird, steht in der Adresse.
- **Nur mit Admin-Anmeldung.** HA erlaubt Änderungen an Bereichen nur Admins. Eine eigene
  Integration, die das stellvertretend für Nicht-Admins erledigt, ist ausdrücklich nicht Teil
  dieses Vorhabens.
- Alte Dashboards (Räume in `nav`) laufen unverändert weiter; Umstellen per Einrichtungspunkt.

## Nicht-Ziele

- Umbenennen von Geräten/Entitäten am Tablet, Einstellungen des Bildschirmschoners.
- Stockwerke anlegen oder sortieren (bleibt in HA).
- Eigene Ansichten einzelner Räume im neuen Modus (siehe Abschnitt 2).
- Bedienung ohne Admin-Anmeldung.

## Voraussetzungen (in der Test-Installation geprüft, HA 2026.11.1)

- Bereichs-Registry hat `name`, `icon`, `picture`, `floor_id`, `labels`,
  `temperature_entity_id`, `humidity_entity_id`.
- `config/area_registry/reorder` (`area_ids`) und `config/floor_registry/reorder` existieren.
- HA behält `?bereich=…` in der Adresse einer Dashboard-Ansicht. Wechselt nur der Query-Teil,
  bleibt dieselbe Karten-Instanz bestehen (sie muss selbst neu zeichnen). Eine unbekannte
  Ansicht leitet HA auf die erste Ansicht um – deshalb eine feste Ansicht `raum`.

## 1. Raumquelle

**Modus:** Stehen in `nav` Einträge mit `room: true`, gilt das bisherige Verhalten
(„Altmodus“). Sonst gilt der neue Modus: Räume = Bereiche.

**Sichtbar** ist jeder Bereich ohne das Label `nicht_am_tablet` (dasselbe Label, das die Karte
schon für Geräte nutzt).

| Raum-Eigenschaft | Quelle | Ersatz, wenn leer |
|---|---|---|
| Name | `area.name` | – |
| Icon | `area.icon` | `mdi:door` |
| Bild | `area.picture` | Bild aus dem Kartenpaket, wenn ein Slug des Bereichsnamens oder die `area_id` einem Dateinamen in `bilder/` entspricht (Umlaute in beiden Schreibweisen: „Gäste-Bad“ → `gaeste_bad`/`gaste_bad` → `gaeste_bad.jpg`), sonst ruhiger Verlauf. Basis-URL als Konstante `IMAGE_BASE`, fest auf einen Tag mit diesen Bildern (`@v1.3.0`), nicht `@main` |
| Temperatur | `area.temperature_entity_id` | keine Anzeige |
| Lichter / Geräte | wie heute: Entitäten des Bereichs (direkt oder über ihr Gerät) | – |

**Reihenfolge:** nach Stockwerk in der Reihenfolge der Floor-Registry, darin nach der
Reihenfolge der Bereichs-Registry. Bereiche ohne Stockwerk am Ende.

**Raumübersicht:** gruppiert nach Stockwerk mit Überschrift (Stockwerksname aus HA);
ohne Stockwerk: Überschrift „Weitere“. Gibt es nur eine Gruppe, entfällt die Überschrift.

## 2. Navigation und Raum-Ansicht

Dashboard im neuen Modus:

```yaml
views:
  - title: Zuhause
    path: zuhause
    type: panel
    cards: [{<<: *basis, title: Zuhause, tiles: [...]}]
  - title: Raum
    path: raum
    type: panel
    cards:
      - <<: *basis
        title: Raum
        area: auto
        tiles: [{type: lights, name: Licht, entities: []}]
  - title: Einstellungen
    path: einstellungen
    type: panel
    cards: [{<<: *basis, title: Einstellungen, tiles: [{type: setup}, ...]}]
```

`nav` enthält nur noch Nicht-Raum-Einträge (Zuhause, Einstellungen).

- **Adresse eines Raums:** `<dashboard>/raum?bereich=<area_id>`. Die Basis (`/<dashboard>/raum`)
  leitet die Karte aus dem aktuellen Pfad ab; überschreibbar mit `rooms_path`.
- **`area: auto`:** Die Karte liest `bereich` aus `location.search`, setzt Titel, Hintergrund,
  Temperatur und Bereich aus dem Raum und baut sich bei `location-changed`/`popstate` neu auf,
  wenn sich der Bereich geändert hat (mit derselben Einblendung wie ein Ansichtswechsel).
- **Fehlt `bereich` oder ist er unbekannt/ausgeblendet:** Raumübersicht öffnen.
- **Leiste:** Der Eintrag „Räume“ steht direkt hinter dem ersten `nav`-Eintrag.
- **Mitziehen:** „Verschieben nach…“ (`_moveTargets`), „Wo hängt dieses Tablet?“ (speichert
  künftig die `area_id`; ein gespeicherter Name wird weiter über `_resolveArea` erkannt),
  Musik-Räume (`_musicRooms`) und Licht-Status je Raum (`_roomLightIds`) nutzen die neue
  Raumliste. (Die Licht-Kachel auf Zuhause sammelt heute keine Raum-Lichter und bleibt so.)

## 3. Räume verwalten

Nur für Admins sichtbar (`hass.user.is_admin`). Ohne Admin ändert sich nichts.

- **Einstieg:** „Bearbeiten“ oben in der Raumübersicht.
- **Bearbeiten-Modus:** je Stockwerk am Ende „+ Raum hinzufügen“; an jedem Raum Pfeile
  „nach vorne“/„nach hinten“ (`config/area_registry/reorder` mit der kompletten neuen
  Reihenfolge); Tipp auf einen Raum öffnet das Raum-Blatt.
- **Raum-Blatt** (neu und ändern, Stil der bestehenden Blätter):

| Feld | Bedienung | Schreibt |
|---|---|---|
| Name | Textfeld, Pflicht | `name` |
| Stockwerk | Auswahl aus der Floor-Registry, „Kein Stockwerk“ | `floor_id` |
| Icon | Raster mit ca. 30 kuratierten Raum-Icons | `icon` |
| Bild | Galerie (Bilder aus `bilder/`), „Eigenes Foto“, „Kein Bild“ | `picture` |
| Temperatur | Auswahl aus `sensor.*` mit `device_class: temperature` im Bereich, „Keine“ | `temperature_entity_id` |
| Am Tablet zeigen | Schalter | Label `nicht_am_tablet` (Label bei Bedarf anlegen wie heute) |
| Raum löschen | nur beim Ändern; Rückfrage mit Zahl der betroffenen Geräte | `config/area_registry/delete` |

- **Eigenes Foto:** `<input type="file" accept="image/*">` (am Tablet Kamera oder Fotos),
  im Browser per Canvas auf max. 1920 px Kantenlänge verkleinert (JPEG), hochgeladen über HAs
  Bild-Upload (`POST /api/image/upload`), `picture` = Serve-URL des Bildes
  (`/api/image/serve/<id>/original`). Damit erscheint das Foto auch in HA am Bereich.
- **Gelöschte Räume:** Geräte landen unter „Ohne Raum“ im bestehenden Geräte-Editor.
- **Fehler** (doppelter Name, Verbindung, fehlende Rechte) erscheinen im Blatt als
  „Nicht gespeichert: …“; nichts wird halb gespeichert, was sich vermeiden lässt (Upload vor
  dem Speichern, Speichern als ein `update`-Aufruf).

## 4. Umstellung bestehender Dashboards

Neuer Punkt in der Kachel `setup`: **„Räume aus Home Assistant“**. Offen, solange `nav`
Raum-Einträge hat. Ausführen (Admin, Schritte sichtbar wie bei den anderen Punkten):

1. **Prüfen (ohne Schreiben):** Plan berechnen. Hat eine Raum-Ansicht Kacheln, die die
   Automatik nicht ohnehin zeigt (Entität aus anderem Bereich, `sections`, andere Typen als
   die automatisch gesammelten), wird **abgebrochen** – mit Raum und Grund. Nichts geändert.
2. **Sichern:** aktuelle Konfiguration als neues Dashboard „<Titel> (Sicherung TT.MM.JJJJ)“,
   nicht in der Seitenleiste, nur für Admins. Erst danach wird weiter geschrieben.
3. **Bereiche ergänzen:** je `nav`-Raum den Bereich finden (`_resolveArea`), fehlt er:
   anlegen. Icon, Bild (`image`) und Temperatur (`temperature`) nur dort schreiben, wo der
   Bereich noch nichts hat.
4. **Reihenfolge:** Bereiche in der `nav`-Reihenfolge, übrige dahinter.
5. **Dashboard umbauen:** Raum-Ansichten entfernen, Ansicht `raum` (wie in Abschnitt 2)
   hinter der ersten Ansicht einfügen, in allen Karten `nav` auf die Nicht-Raum-Einträge
   kürzen. Zuhause, Einstellungen und alle anderen Einstellungen bleiben unverändert.

YAML-Dashboards (nicht speicherbar) bekommen statt Schritt 5 einen Hinweis.

## 5. Testen und Freigabe

**Automatische Tests** (`node --test`, keine Abhängigkeiten, Ordner `test/`):
Raumliste (Sichtbarkeit, Reihenfolge, Gruppen), Bild-Ersatz, `bereich` aus der Adresse,
Umstellungsplan inklusive Abbruchgründen. Die Logik liegt dafür in reinen Funktionen
(`ElvioRooms`). Die Tests laden die unveränderte Datei in einer Node-VM mit Platzhaltern für
`HTMLElement`, `customElements` und `window`; die Datei bekommt keinen Node-Code.

**Lokale Sichtung vor jeder Veröffentlichung:**
1. Lokaler Server auf dem Mac liefert die Repo-Version als `elvio-room-card-dev`
   (Elementname beim Ausliefern ersetzt).
2. In der Test-Installation: verstecktes Test-Dashboard „Tablet Test“ (Kopie des echten mit
   `custom:elvio-room-card-dev`) und eine Ressource auf den lokalen Server. Das echte Tablet
   bleibt auf v1.5.0. Am Tablet selbst schlägt nur das Laden der lokalen Ressource fehl
   (Konsole), sichtbar ändert sich nichts.
3. Dort alle Abläufe testen, auch die Umstellung; danach Sichtung durch Julian.

Nebenwirkung: Die Umstellung im Test schreibt Icons, Bilder und Reihenfolge in die echten
Bereiche. Das alte Dashboard liest diese Felder nicht.

**Freigabe** (jeder Schritt nach OK): Branch nach `main`, README und
EINRICHTEN-MIT-CLAUDE.md anpassen, Tag `v1.6.0`, Push → Test-Installation auf v1.6.0 und Umstellung
am echten Dashboard → Test-Dashboard und Entwickler-Ressource entfernen.

## Geklärt in der Test-Installation (16.11.2026)

- `config/area_registry/reorder` verlangt alle Bereichs-IDs genau einmal; eine Teil-Liste
  wird abgelehnt („must contain all existing area IDs exactly once“).
- `POST /api/image/upload` (Multipart-Feld `file`, über `hass.fetchWithAuth`) antwortet mit
  `{id, name, content_type, filesize, uploaded_at}`. `/api/image/serve/<id>/original` lädt
  ohne Anmeldung (HTTP 200). Löschen: WebSocket `image/delete` mit `image_id`.
- `hass.areas` und `hass.floors` enthalten die vollständigen Registry-Einträge in
  Registry-Reihenfolge.
