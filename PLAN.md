# CLAUDE.md

## Projektziel

Dieses Projekt ist kein klassischer Text-zu-3D-Generator.

Es wird ein kontrollierbares World-Generation-System für:
- detaillierte Terrainwelten,
- logisches natürliches Placement,
- Infrastruktur wie Wege, Straßen, Brücken und Übergänge,
- Landmarken, Reliefs, Naturwunder,
- selektive lokale KI-Bearbeitung,
- spätere Animationen und zeitliche Zustände.

Der Kern des Projekts ist:
**KI plant und beschreibt. Das Programm baut, prüft, repariert und speichert.**

KI soll nicht rohe Meshdaten oder Vertexlisten erzeugen.
Stattdessen arbeitet sie mit:
- PlanObjects,
- Regionen,
- Objektlisten,
- Asset-Referenzen,
- Constraint-Specs,
- strukturierten Metriken.

## Architekturprinzipien

1. Der globale World State ist die zentrale Wahrheit.
2. Regionen/Patches sind lokale Bearbeitungsräume.
3. Jedes Objekt existiert explizit in einer Object Registry.
4. Objektbeziehungen müssen nachvollziehbar modelliert werden.
5. KI darf nur markierte Regionen/Objekte verändern.
6. Gelockte oder manuell überschriebene Elemente dürfen nicht still verändert werden.
7. Lokale Bearbeitung ist wichtiger als globale Komplettregeneration.
8. Kostenminimierung ist Pflicht.
9. Strukturierte Daten sind wichtiger als freie Textmagie.
10. Erst Fundament, dann Komplexität.

## Langfristige Systembestandteile

Das Projekt soll schrittweise diese Bausteine bekommen:

- World State
- Region-/Patch-System
- Object Registry
- Asset Registry
- Constraint-Spec-System
- Placement Solver
- Validatoren
- Repair-System
- Terrain-Generator
- Infrastruktur-Generator
- User-Interaktionssystem
- Selektive KI-Bearbeitung
- Später: Animation / Timeline / Ereignisse

## Objektmodell

Objekte sind immer explizit registrierte Einheiten mit:
- id
- name
- type
- category
- subtype
- region_id
- parent_id
- anchor_id
- editable
- locked
- ai_allowed
- manual_override
- transform
- state
- tags
- constraints

Objektbeziehungen sollen vorbereitet und später ausgebaut werden:
- on_top_of
- under
- inside
- attached_to
- near
- connected_to

Warum:
Nur so können User und System nachvollziehen,
- was existiert,
- was verändert werden darf,
- welche Regeln gelten,
- was lokal bearbeitet oder repariert werden soll.

## Regionen

Regionen sind lokale Bearbeitungsbereiche.

Jede Region braucht mindestens:
- region_id
- name
- type
- bounds
- object_ids
- editable
- locked
- ai_allowed
- tags
- metadata

Ziel:
Spätere KI-Bearbeitung soll gezielt nur auf ausgewählte Regionen wirken können.

## KI-Rolle im Projekt

KI ist in diesem Projekt kein freier Geometrie-Generator.

KI-Aufgaben:
- Nutzerintention verstehen
- Ziele strukturieren
- PlanObjects erzeugen
- Objekte kategorisieren
- Asset-/Objektvorschläge machen
- Constraint-Specs formulieren
- Reparaturvorschläge machen
- Lokale Bearbeitungsaufgaben definieren

Programm-Aufgaben:
- World State verwalten
- Regionen verwalten
- Objekte registrieren
- Platzierung berechnen
- Constraints lösen
- Kollisionen prüfen
- Support prüfen
- Übergänge prüfen
- reparieren
- serialisieren
- editierbare Zustände speichern

## Kostenregeln

Kosten müssen aktiv minimiert werden.

Daher:
- keine raw Vertices/Faces an KI
- keine unnötigen Vollbild-Screenshots
- keine Full-World-Kontexte bei lokalen Änderungen
- stattdessen:
  - Region Summaries
  - Objektlisten
  - Asset-Referenzen
  - Constraint-Specs
  - strukturierte Metriken

Lokale Bearbeitung hat Vorrang vor globaler Neuerzeugung.

## User-Interaktion

Das System soll später starke User-Kontrolle erlauben:
- Regionen auswählen
- einzelne Objekte auswählen
- Objekte sperren/freigeben
- nur markierte Bereiche von KI bearbeiten lassen
- manuelle Overrides setzen
- lokale Reparaturen anfordern
- Änderungen nachvollziehen

Wenn User-Edits existieren, müssen diese respektiert werden.

## Entwicklungsstrategie

Immer phasenweise arbeiten.

Regel:
- Erst eine Phase stabil machen.
- Dann nächste Phase anfangen.
- Wenn Ergebnisse nicht den Anforderungen entsprechen, in der aktuellen Phase bleiben und dort nachbessern.

Keine Scheinfortschritte.
Keine Features halb einbauen.
Keine Komplexität vorziehen, wenn das Fundament noch nicht sitzt.

## Implementierungsstil

- modular
- klar getrennte Verantwortlichkeiten
- strukturierte Datenmodelle
- nachvollziehbare Manager/Registries
- kleine, belastbare Schritte
- lieber vorbereitet als pseudokomplex
- keine unnötige Magie

## Bevorzugte Arbeitsweise in Claude Code

- Erst analysieren.
- Dann Datenmodell und Verantwortlichkeiten festlegen.
- Danach implementieren.
- Dokumentation parallel aktualisieren.
- Am Ende klar sagen:
  - was fertig ist,
  - was noch fehlt,
  - was bewusst nicht Teil der aktuellen Phase ist.

## Spätere Subagents

Das Projekt soll später gut zu spezialisierten Rollen passen, z. B.:
- planner
- object-spec-builder
- asset-selector
- constraint-agent
- repair-agent
- docs-agent

Subagents sollen spezialisierte Aufgaben übernehmen und Kontext sauber trennen.
