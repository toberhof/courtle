# Courtle — Spec-Driven Development (`specs/`)

In diesem Verzeichnis liegen alle ausgearbeiteten User Stories & technischen Baupläne (Specs) nach dem **Architect / Builder**-Prinzip:

- **`specs/TEMPLATE.md`**: Vorlage für neue User Stories (Zero-Ambiguity-Format).
- **`specs/backlog/`**: Fertig spezifizierte, noch offene User Stories (`NNN-slug.md`), bereit zur Umsetzung durch ein günstiges Builder-Modell (`flash` / `flash_lite`).
- **`specs/done/`**: Bereits umgesetzte, getestete und abgeschlossene User Stories als technische Historie.

---

## Workflow im Überblick

### Phase 1: Architektur & Bauplan (mit Argon)
1. Besprich deine Idee oder Anforderung mit **Argon**.
2. Argon nutzt den Skill `.agents/skills/spec-architect/SKILL.md`, analysiert die Codebase (`api.php`, `app.js`, `index.html`, `style.css`, `i18n.js`) und erstellt eine präzise Spec unter `specs/backlog/NNN-slug.md`.
3. Sobald du zufrieden bist, hast du **zwei Optionen** für die Umsetzung:

### Phase 2: Umsetzung & Test (mit günstigem Builder-Modell)

#### Option A: Direkt aus dem Argon-Chat delegieren (Automatisch im Hintergrund)
Sage zu Argon einfach:
> *„Setze Spec `NNN` jetzt per Subagent um.“*

Argon startet daraufhin einen isolierten Subagenten (`Model: "flash"` oder `"flash_lite"`, `Workspace: "share"`), der in einer eigenen Git-Working-Copy den Branch `feat/NNN-slug` anlegt, die Spec abarbeitet, Playwright-Tests ausführt und das Ergebnis zurückmeldet.

#### Option B: In einer neuen Konversation starten (Manuell)
1. Öffne eine **neue Konversation** und wähle ein schnelles/günstiges Modell (z. B. **Flash**).
2. Schreibe einfach:
   > *„Setze die nächste Spec aus `specs/backlog/` um.“* (oder nenne die konkrete Nummer, z. B. `001`).
3. Das Modell lädt automatisch `.agents/skills/spec-builder/SKILL.md`, erstellt den Feature-Branch `feat/NNN-slug`, implementiert den Bauplan Schritt für Schritt, führt die Playwright-Tests aus und verschiebt die erledigte Spec nach `specs/done/`.

---

## Build-Counter Synchronisation (`scripts/sync-build.sh`)

Während auf Feature-Branches (`feat/NNN-...`) entwickelt wird, muss die Build-Nummer noch nicht zwingend bei jedem Zwischenschritt hochgezählt werden (um Merge-Konflikte zwischen parallelen Branches zu vermeiden).
Vor einem Merge auf `main` oder einem Release-Commit synchronisiert das Skript alle 6 Pflicht-Stellen automatisch:

```bash
# Prüfen, ob alle 6 Stellen in app.js und index.html synchron sind:
./scripts/sync-build.sh --check

# Build-Nummer um +1 erhöhen und an allen 6 Stellen synchron schreiben:
./scripts/sync-build.sh

# Auf eine gezielte Build-Nummer setzen (z. B. +5 für Cache-Busting):
./scripts/sync-build.sh 475
```
