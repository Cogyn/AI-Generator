# AI Structure Generator – MVP Plan

## Vision

Ein iteratives, zustandsbasiertes Generierungssystem für 3D-Strukturen.
Die KI erzeugt nicht alles auf einmal, sondern arbeitet schrittweise –
jeder Schritt baut auf dem bisherigen Zustand auf.

## MVP-Scope

- **Primitives:** Nur Cubes (Position, Größe, Rotation, Farbe, ID, Tags)
- **Scene:** Flache Liste von Primitives mit Metadaten, persistiert in localStorage
- **Workflow:** Prompt → Plan → iterative Bauschritte → 3D-Preview
- **KI-Rollen:** Planner, Builder, Critic (via OpenAI API)
- **Frontend:** Vite + Three.js WebGL-Renderer
- **Hosting:** GitHub Pages (auto-deploy via GitHub Actions)
- **API Key:** Im Browser via localStorage gespeichert

## Architektur

```
User Prompt (Browser)
    ↓
[Planner]  →  Ziel & Schrittplan (OpenAI API)
    ↓
[Builder]  →  Nächstes Primitive erzeugen (OpenAI API)
    ↓
[Constraints]  →  Validieren (lokal)
    ↓
[Scene State]  ←  Primitive hinzufügen (localStorage)
    ↓
[Critic]  →  Zustand bewerten (OpenAI API)
    ↓
[Three.js]  →  3D Preview live im Browser
    ↓
Nächste Iteration oder Fertig
```

## Tech Stack

| Was | Womit |
|---|---|
| Language | TypeScript |
| Bundler | Vite |
| 3D Engine | Three.js |
| KI | OpenAI API (GPT-4o-mini / GPT-4o / GPT-4.1) |
| Hosting | GitHub Pages |
| CI/CD | GitHub Actions |
| Persistenz | localStorage |

## Zentrale Module

| Modul | Verantwortung |
|---|---|
| `core/types.ts` | Alle Interfaces und Datenstrukturen |
| `core/scene.ts` | Scene State: CRUD + localStorage |
| `core/constraints.ts` | Validierung (Overlap, Bounds) |
| `ai/roles.ts` | KI-Rollen: Planner, Builder, Critic |
| `ai/prompt.ts` | System-Prompts für jede Rolle |
| `ai/client.ts` | Claude API Client + Settings |
| `generator/pipeline.ts` | Iterative Pipeline-Orchestrierung |
| `renderer/preview.ts` | Three.js 3D-Renderer |
| `main.ts` | UI-Logik + Event-Handling |

## Development

```bash
npm install          # Dependencies
npm run dev          # Lokaler Dev-Server (mit API-Proxy)
npm run build        # Production Build
npm run deploy       # Manuell auf GitHub Pages deployen
git push origin main # Auto-Deploy via GitHub Actions
```

Die OpenAI API erlaubt direkte Browser-Calls (CORS), daher kein Proxy nötig.
Der API Key wird im Browser im localStorage gespeichert.

## Offene Fragen

- Soll der User zwischen Schritten eingreifen können?
  → Aktuell: auto-run + manueller "Nächster Schritt"-Button.
- Wie viele Schritte pro Objekt sind sinnvoll?
  → Default Max 10, konfigurierbar.
- Später Claude API als Alternative?
  → Möglich, Client-Modul ist austauschbar.

## Spätere Erweiterungen

- Weitere Primitives (Cylinder, Sphere, Plane)
- OpenSCAD-Export / STL-Export
- Referenzbilder als Input (Vision-Modell)
- Undo/Redo auf Scene State
- Komplexere Constraints (Symmetrie, Stabilität)
- Multi-Objekt-Szenen
- Materialeigenschaften & Texturen
- Scene-Sharing via URL
