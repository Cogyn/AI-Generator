# AI Structure Generator – Projektplan

## Vision

Ein iteratives, zustandsbasiertes Generierungssystem für 3D-Strukturen.
Mehrere KI-Builder arbeiten kollektiv an verschiedenen Bereichen einer Szene –
koordiniert durch einen Planner, validiert durch Boundary-Checks und einen Global Critic.

---

## Architektur-Übersicht

### Phase 1: Lineare Pipeline (MVP, implementiert)

```
User Prompt
    ↓
[Planner]  →  Schrittplan
    ↓
[Builder]  →  Ein Primitive pro Schritt (mit Retry bei Overlap)
    ↓
[Constraints]  →  Overlap / Bounds prüfen
    ↓
[Critic]  →  Schritt bewerten
    ↓
[Three.js]  →  Live 3D Preview
    ↓
Nächster Schritt oder Fertig
```

### Phase 2: Parallele / Kollektive Pipeline (Grundgerüst, neu)

```
User Prompt
    ↓
[Planner]  →  Ziel & Stilrichtung analysieren
    ↓
[Partitioner]  →  Szene in WorkRegions aufteilen
    ↓
[Coordinator]  →  BuilderTasks erzeugen
    ↓
┌──────────┬──────────┬──────────┐
│ Builder  │ Builder  │ Builder  │  (parallel oder sequentiell)
│ Region A │ Region B │ Region C │
│ + lokaler│ + lokaler│ + lokaler│
│   Kontext│   Kontext│   Kontext│
│ + Bound. │ + Bound. │ + Bound. │
│   Context│   Context│   Context│
└────┬─────┴────┬─────┴────┬─────┘
     ↓          ↓          ↓
[Merger]  →  Regionale Ergebnisse zusammenführen
    ↓
[BoundaryValidator]  →  Übergänge zwischen Regionen prüfen
    ↓
[GlobalCritic]  →  Gesamtszene bewerten (Stil, Kohärenz, Qualität)
    ↓
[Scene State]  →  Finaler globaler Zustand
```

---

## Kernprinzip: Lokaler Kontext mit Boundary-Awareness

Jeder Builder erhält:

| Kontextebene | Was der Builder sieht |
|---|---|
| **Lokal** | Nur Primitives in seiner eigenen Region |
| **Boundary** | Primitives nahe der Grenze zu Nachbarregionen |
| **Global** | Stilrichtung, Farbpalette, Zielformulierung |

Builder sehen **nicht** die gesamte Szene. Das ermöglicht:
- Parallelisierung (kein globaler Lock)
- Fokussierte, kleinere Prompts
- Weniger Token-Verbrauch pro Call
- Skalierung auf komplexere Szenen

### Risiko: Rein isolierte Builder

Komplett isolierte Builder ohne Boundary-Kontext erzeugen Lücken, Stilbrüche
und nicht-zusammenhängende Strukturen. Deshalb:
- Jeder Builder bekommt Primitives nahe der Regionengrenze als Kontext
- GlobalStyleDirectives sorgen für einheitlichen Stil
- Nach dem Merge prüft der BoundaryValidator die Übergänge
- Der GlobalCritic bewertet die Gesamtszene

### Grenzen des Ansatzes

- Schwierig bei Objekten die keine räumliche Trennung erlauben (z.B. ein einzelnes verschränktes Netz)
- Boundary-Kontext ist ein Kompromiss – zu wenig = Lücken, zu viel = kein Parallelitätsgewinn
- Sinnvoll ab ~10+ Primitives pro Szene, darunter ist lineare Pipeline effizienter

---

## Module

| Modul | Status | Verantwortung |
|---|---|---|
| `core/types.ts` | **aktiv** | Alle Interfaces (Scene, Primitive, Partition, Task, etc.) |
| `core/scene.ts` | **aktiv** | Scene CRUD + localStorage |
| `core/constraints.ts` | **aktiv** | Overlap / Bounds (generisch für alle Primitive-Typen) |
| `ai/client.ts` | **aktiv** | OpenAI API Client |
| `ai/roles.ts` | **aktiv** | Planner, Builder, Critic (lineare Pipeline) |
| `ai/prompt.ts` | **aktiv** | System-Prompts (lineare Pipeline) |
| `generator/pipeline.ts` | **aktiv** | Lineare Pipeline + Extend |
| `generator/parallel/partitioner.ts` | **Gerüst** | Aufgabe in Regionen zerlegen |
| `generator/parallel/coordinator.ts` | **Gerüst** | BuilderTasks erstellen & orchestrieren |
| `generator/parallel/region-builder.ts` | **Gerüst** | Builder pro Region |
| `generator/parallel/merger.ts` | **Gerüst** | Ergebnisse zusammenführen, Konflikte erkennen |
| `generator/parallel/boundary-validator.ts` | **Gerüst** | Übergänge zwischen Regionen prüfen |
| `generator/parallel/global-critic.ts` | **Gerüst** | Gesamtszene bewerten |
| `generator/parallel/pipeline.ts` | **Gerüst** | Orchestrierung der parallelen Pipeline |
| `renderer/preview.ts` | **aktiv** | Three.js Renderer |
| `main.ts` | **aktiv** | UI + Event-Handling |

---

## Primitive-System

| Typ | Status | Properties |
|---|---|---|
| `cube` | **aktiv** | position, size [w,h,d], rotation, color, tags |
| `sphere` | **vorbereitet** | position, radius, rotation, color, tags |
| `cylinder` | **vorbereitet** | position, radiusTop, radiusBottom, height, rotation, color, tags |
| `polyhedron` | geplant | – |
| `mesh-patch` | geplant | – |

Alle Primitives teilen `PrimitiveBase` (id, type, position, rotation, color, tags).
`getPrimitiveExtents()` liefert die AABB-Ausdehnung für jeden Typ.

---

## Datenfluss: Parallele Pipeline im Detail

```
1. User Prompt + existierende Scene
    ↓
2. Partitioner fragt LLM:
   "Zerlege dieses Objekt in 2-4 räumliche Regionen"
   → ScenePartition { regions[], assignments[], styleDirectives }
    ↓
3. Coordinator erstellt BuilderTasks:
   - Pro Region: lokales Ziel, Bounds, erlaubte Primitive-Typen
   - Pro Region: BoundaryContext (Nachbar-Primitives nahe der Grenze)
   - Global: StyleDirectives (Farben, Stil, Gesamtziel)
    ↓
4. Builder pro Region (parallel oder sequentiell):
   - Erhält nur eigene Region + Boundary + Style
   - Erzeugt N Primitives innerhalb der Region-Bounds
   - Gibt BuilderResult zurück (kein globaler Write)
    ↓
5. Merger:
   - Sammelt alle BuilderResults
   - Prüft Cross-Region Overlaps
   - Fügt konfliktfreie Primitives in Scene ein
   - Listet MergeConflicts auf
    ↓
6. BoundaryValidator:
   - Prüft Übergänge: Lücken? Stilbrüche?
    ↓
7. GlobalCritic:
   - Bewertet Gesamtszene vs. Ziel
   - Gibt QualityScore (0-1) + Issues zurück
    ↓
8. Scene State speichern
```

---

## Tech Stack

| Was | Womit |
|---|---|
| Language | TypeScript |
| Bundler | Vite |
| 3D Engine | Three.js |
| KI | OpenAI API (GPT-4o / GPT-5.x) |
| Hosting | GitHub Pages |
| CI/CD | GitHub Actions |
| Persistenz | localStorage |

---

## Development

```bash
npm install          # Dependencies
npm run dev          # Lokaler Dev-Server
npm run build        # Production Build
git push origin main # Auto-Deploy via GitHub Actions
```

---

## Nächste Implementierungsschritte

1. **Renderer für Sphere + Cylinder** – Three.js Meshes für die neuen Primitive-Typen
2. **Parallele Pipeline in UI einbinden** – Button/Toggle für parallelen Modus
3. **RepairAgent** – Automatische Korrektur von Merge-Konflikten und Boundary-Gaps
4. **Partitioner-Qualität verbessern** – Bessere Prompts, Fallback-Strategien
5. **Parallele Ausführung aktivieren** – `Promise.all()` statt sequentiell, Performance messen
