---
name: spec-builder
description: >-
  Führt eine fertig ausgearbeitete User Story / Spezifikation aus specs/backlog/NNN-slug.md Schritt für Schritt auf einem eigenen Feature-Branch aus, testet sie mit Playwright und schließt die Story in specs/done/ ab. Nutze diesen Skill immer dann, wenn eine Spec aus specs/backlog/ implementiert werden soll.
---

# Courtle Spec Builder (`spec-builder`)

Du bist der **Spec Builder** für Courtle. Deine Aufgabe ist es, einen fertig ausgearbeiteten Bauplan aus `specs/backlog/` präzise, schnell und ohne Abweichungen in funktionierenden, getesteten Code umzusetzen.

---

## 1. Vorbereitung & Branch-Isolation

1. **Spec auswählen**:
   - Hat der User eine bestimmte Spec genannt (z. B. `001` oder `specs/backlog/001-xyz.md`), lies diese Datei.
   - Hat der User nur gesagt *„Setze die nächste Spec aus dem Backlog um“*, suche die Datei mit der niedrigsten Nummer in `specs/backlog/` (ignoriere `.gitkeep`) und lies sie komplett.
2. **Pflicht-Guides lesen**:
   - Lies die in Abschnitt 2 der Spec angehakten Rollen-Dateien in `agents/` (`backend.md`, `frontend.md`, `pwa_ux.md`, `styleguide.md`, `testing.md`).
3. **Feature-Branch erstellen / wechseln**:
   - Prüfe mit `git status` und `git branch --show-current` den aktuellen Stand.
   - Erstelle bzw. wechsle auf den in der Spec definierten Branch (`feat/NNN-slug`):
     ```bash
     git checkout -b feat/NNN-slug || git checkout feat/NNN-slug
     ```

---

## 2. Striktes Umsetzungs-Protokoll

Arbeite Abschnitt 3 der Spec (`Konkreter Bauplan`) Punkt für Punkt ab:

1. **Keine Improvisation**: Halte dich exakt an die vorgegebenen Dateipfade, Funktionsnamen, SQL-Migrationen und CSS-Klassen aus der Spec.
2. **6-Sprachen-Pflicht (`i18n.js`)**:
   - Keine hartcodierten Texte in `app.js` oder `index.html`!
   - Trage alle in der Spec definierten Keys für `de`, `en`, `es`, `it`, `fr` und `pt` in `i18n.js` ein.
3. **Code-Hygiene**:
   - Erhalte bestehende Kommentare und Formatierungen.
   - Hinterlasse keine Debug-Ausgaben (`console.log`, `var_dump`, ` error_log`).
4. **Build-Nummer (`CLIENT_BUILD`) auf Feature-Branches**:
   - Für lokales Browser-Cache-Busting oder falls die Spec es explizit fordert, kannst du `./scripts/sync-build.sh` ausführen.
   - Prüfe in jedem Fall mit `./scripts/sync-build.sh --check`, dass `CLIENT_BUILD` in `app.js` und `<!--built:X-->` in `index.html` niemals voneinander abweichen (sonst schlagen E2E-Tests wegen der Update-Schleife fehl!).

---

## 3. Verifikation & Tests

1. **Syntax-Checks (Schnellprüfung)**:
   - Falls `api.php` geändert wurde: `php -l api.php` (oder im Test-Container).
   - Prüfe Build-Synchronität: `./scripts/sync-build.sh --check`
2. **Gezielte Playwright-Tests ausführen**:
   - Führe die in Abschnitt 4 der Spec angegebenen schnellen Playwright-Befehle im Verzeichnis `tests/` aus (immer mit `--project=chromium` oder `--project=ios` für schnelle Feedback-Zyklen, sofern nicht anders gefordert):
     ```bash
     cd tests && npx playwright test <spec-file> --project=chromium
     ```
   - Falls ein Test fehlschlägt: Analysiere den Fehler, behebe die Ursache im Code und führe den gezielten Test erneut aus, bis er grün ist.

---

## 4. Abschluss & Archivierung

Sobald alle Akzeptanzkriterien erfüllt und die Tests grün sind:

1. **Spec als erledigt markieren & nach `specs/done/` verschieben**:
   - Setze in der Spec-Datei den Status oben auf `done` und hake die Checklisten-Punkte (`[x]`) ab.
   - Verschiebe die Datei mit `git mv`:
     ```bash
     git mv specs/backlog/NNN-slug.md specs/done/NNN-slug.md
     ```
2. **Sauberer Feature-Commit (KEIN Push!)**:
   - Committe die Änderungen auf dem Feature-Branch `feat/NNN-slug` mit einer klaren Commit-Message (z. B. `feat(NNN): <Kurztitel>`).
   - **WICHTIG**: Führe **niemals** automatisch `git push` aus!
3. **Abschlussbericht**:
   - Melde kurz und übersichtlich zurück:
     - Welcher Branch (`feat/NNN-slug`) erstellt und committed wurde
     - Welche Dateien angepasst wurden
     - Welche Playwright-Tests erfolgreich durchgelaufen sind
     - Wie der Branch bei Bedarf gemerged werden kann (`git checkout main && git merge feat/NNN-slug && ./scripts/sync-build.sh`)
