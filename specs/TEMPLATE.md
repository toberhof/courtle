# Spec / User Story: NNN — [Kurztitel]

- **ID**: `NNN`
- **Slug**: `kurz-slug`
- **Branch**: `feat/NNN-kurz-slug`
- **Status**: `ready` | `in_progress` | `done`
- **Ziel-Modell (Builder)**: `flash` (oder `flash_lite` für triviale Änderungen)
- **Erstellt am**: YYYY-MM-DD

---

## 1. User Story & Ziel

**Als** [Spieler / Admin / System]
**möchte ich** [Funktion / Verhalten],
**damit** [Nutzen / Mehrwert].

### Akzeptanzkriterien (AC)
- [ ] AC 1: ...
- [ ] AC 2: ...
- [ ] AC 3: ...

---

## 2. Betroffene Dateien & Rollen-Guides

Vor der Umsetzung müssen vom Builder folgende Rollen-Dateien gelesen werden:
- [ ] `agents/backend.md` (falls `api.php` betroffen)
- [ ] `agents/frontend.md` (falls `app.js` / `index.html` betroffen)
- [ ] `agents/pwa_ux.md` & `agents/styleguide.md` (falls `style.css` / UI-Buttons betroffen)
- [ ] `agents/testing.md` (immer für Verifikation)

**Zu ändernde Dateien:**
- `api.php` (Zeilen ca. X–Y)
- `app.js` (Funktionen `foo()`, `bar()`, Zeilen ca. X–Y)
- `index.html` (Sektion / Modal `#...`, Zeilen ca. X–Y)
- `style.css` (Klassen `.xyz`, Zeilen ca. X–Y)
- `i18n.js` (Neue Keys für alle 6 Sprachen)

---

## 3. Konkreter Bauplan (Zero-Ambiguity)

### 3.1 Datenbank & Backend (`api.php`)
*Falls keine Backend-Änderungen nötig sind: „Keine Änderungen an `api.php`.“*
- **DB-Migration (`initDB`)**:
  ```sql
  -- Exaktes SQL oder ALTER TABLE Statement
  ```
- **Endpoint / Route**:
  - Methode & Pfad: `POST /api.php/...`
  - Auth-Prüfung: `requireAdmin()` / `requireUser()`
  - Request-Payload & Response-Format:
  ```php
  // Konkreter Code-Entwurf oder Ankerpunkt in api.php
  ```

### 3.2 Lokalisierung (`i18n.js`)
Alle neuen Strings **müssen** in allen 6 Sprachen (`de`, `en`, `es`, `it`, `fr`, `pt`) exakt mit diesen Keys eingetragen werden:
```javascript
// Key: 'section.key_name'
// de: '...'
// en: '...'
// es: '...'
// it: '...'
// fr: '...'
// pt: '...'
```

### 3.3 HTML & Styles (`index.html`, `style.css`)
- **DOM-Struktur (`index.html`)**:
  - Wo einfügen (Anker-Element + Zeilennummer):
  - Zu verwendende Button-/UI-Klassen gemäß `agents/styleguide.md` (z. B. `.btn-ok.btn-sm`, `.btn-sec`, `.seg-tab`):
  ```html
  <!-- Exaktes HTML-Snippet -->
  ```
- **CSS-Regeln (`style.css`)**:
  ```css
  /* Exakte CSS-Ergänzungen (nutze CSS-Variablen wie var(--sur), var(--pri), var(--tr)) */
  ```

### 3.4 Frontend-Logik (`app.js`)
- **State (`S`)**: Welche Felder in `S` genutzt oder erweitert werden.
- **Funktionen (Anker + exakte Logik)**:
  ```javascript
  // Konkrete Implementierungsvorgabe für die Funktionen in app.js
  ```

---

## 4. Test- & Verifikationsplan

### 4.1 Automatisierte Tests (Playwright)
- **Bestehende Tests prüfen** (auszuführen im Ordner `tests/`):
  ```bash
  npx playwright test basic-flows.spec.js --project=chromium
  ```
- **Neuer / erweiterter E2E-Test**:
  - Datei: `tests/...`
  - Was getestet wird: ...

### 4.2 Abschluss-Checkliste für den Builder
- [ ] Alle Akzeptanzkriterien aus Abschnitt 1 erfüllt?
- [ ] Keine `console.log` oder `var_dump` Debug-Reste im Code?
- [ ] Alle neuen UI-Texte über `t('key')` bzw. `data-i18n` in allen 6 Sprachen vorhanden?
- [ ] Gezielter Playwright-Test läuft grün ohne Console-Errors?
- [ ] Spec-Status oben auf `done` gesetzt und Datei von `specs/backlog/` nach `specs/done/` verschoben?
