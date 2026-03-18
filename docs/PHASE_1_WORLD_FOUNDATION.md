# Phase 1: World Foundation

## Ziel

Aufbau eines zentralen World-State-Systems als Fundament fuer KI-gesteuerte Weltbearbeitung. Das System ergaenzt das bestehende Scene/Primitive-System und bietet:

- **Explizite Kontrolle:** Edit/Lock/AI-Flags pro Region und Objekt
- **Hierarchische Regionen:** Parent/Child-Beziehungen, raeumliche Begrenzung via AABB
- **Object Registry:** Eindeutige IDs, Kategorien, Transforms, Zustandsverwaltung
- **Relationen:** Semantische Beziehungen zwischen Objekten (on_top_of, near, etc.)
- **Serialisierung:** JSON Import/Export mit Validierung und Referenz-Integritaetspruefung

## Implementierte Dateien

| Datei | Beschreibung |
|-------|-------------|
| `src/world/types.ts` | Alle TypeScript-Interfaces (WorldState, Region, WorldObject, etc.) |
| `src/world/world-state.ts` | WorldState Manager – create, get, set, add/remove mit immutable updates |
| `src/world/region-manager.ts` | Region CRUD, Queries, Lock/Edit/AI-Steuerung |
| `src/world/object-registry.ts` | Object CRUD, Filter, Relations, Transform-Updates |
| `src/world/serialization.ts` | JSON Export (Maps→Records), Import (Records→Maps), Validation |
| `src/world/debug.ts` | Formatierte Console-Ausgaben fuer Inspektion |
| `src/world/seed.ts` | Testwelt mit Regionen, Objekten und Relationen |
| `src/world/index.ts` | Re-exports aller public APIs |

## Design-Entscheidungen

- **Immutable Updates:** Alle Mutations-Funktionen geben neuen State zurueck (wie bestehendes `scene.ts`)
- **Maps intern, Records extern:** `Map<string, T>` fuer schnellen Zugriff, Konvertierung zu `Record<string, T>` bei JSON-Serialisierung
- **Vec3/AABB aus core/types.ts:** Wiederverwendung bestehender Geometrie-Typen
- **Modul-Level State:** Optionaler globaler State via `getWorldState()`/`setWorldState()` fuer einfache Nutzung

## Was bewusst NICHT Teil von Phase 1 ist

- **Terrain-Generierung:** Heightmaps, Noise-basierte Landschaften
- **Asset-Management:** Laden/Verwalten von 3D-Modellen, Texturen
- **Constraint-System:** Automatische raeumliche Constraints, Physik-Regeln
- **Animation:** Keyframes, Bewegungspfade, zeitbasierte Zustandsaenderungen
- **Undo/Redo:** History-basiertes Rueckgaengig-System (Eintraege werden geloggt, aber nicht angewendet)
- **Multi-User:** Gleichzeitige Bearbeitung durch mehrere Nutzer/Agenten

## Warum diese Grundlage noetig ist

Spaetere Phasen (KI-Agent-Steuerung, Constraint-Solving, Asset-Pipeline) brauchen ein klar definiertes State-Modell mit:

1. **Eindeutigen Identifikatoren** fuer jedes Objekt und jede Region
2. **Zugriffssteuerung** damit KI nur erlaubte Bereiche bearbeitet
3. **Serialisierbarem State** fuer Persistenz, Debugging und Reproduzierbarkeit
4. **Referenz-Integritaet** damit keine verwaisten Objekte oder ungueltige Relationen entstehen
