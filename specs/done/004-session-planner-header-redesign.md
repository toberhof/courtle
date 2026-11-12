# Spec / User Story: 004 — Sessionplaner-Header als edle 2-Zonen-Card & Vollbreiten-Tabs

- **ID**: `004`
- **Slug**: `session-planner-header-redesign`
- **Branch**: `feat/004-session-planner-header-redesign`
- **Status**: `done`
- **Ziel-Modell (Builder)**: `flash`
- **Erstellt am**: 2026-11-12

---

## 1. User Story & Ziel

**Als** Admin im Sessionplaner (`#view-admin-plan`)
**möchte ich** die Session-Kopfzeile (`#admin-plan-header-dynamic`) als edle, klar gegliederte **2-Zonen-Card** (oben: Titel + Status-Pill + kompakte Meta-Chips; unten: durch eine feine Linie abgetrennte, einzeilige Action-Toolbar) sowie den Tab-Umschalter (`Belegung | Verlauf`, `#plan-tabs`) als **vollbreite 50/50 Segmented Control mit Icons** sehen,
**damit** die Buttons auf Mobile nicht mehr unschön in mehrere Zeilen umbrechen und der mittlere Bereich genauso hochwertig und aufgeräumt wirkt wie der Rest der App.

### Akzeptanzkriterien (AC)
- [x] **AC 1: 2-Zonen-Aufbau der Session-Header-Card (`#admin-plan-header-dynamic`)**:
  - **Zone 1 (Oben — `.plan-header-top`)**:
    - **Titel-Zeile (`.plan-title-row`)**: Links Session-Titel (`<h2 class="sec-title">`), optionales Serien-Badge (`repeat`) und Speicher-Indikator (`#plan-save-indicator`); rechtsbündig der Status-Pill (`.status-pill`).
    - **Meta-Zeile (`.plan-meta-row`)**: Direkt unter der Titel-Zeile (noch **vor** der Trennlinie!). Die Meta-Einträge (`.plan-meta-item` für Datum, Uhrzeit, optional Ort, Slot-Preis, Belegung und optional Notiz) werden als edle, kompakte Glas-/Surface-Chips (`background: var(--suroff)`, dezenter Rahmen, `border-radius: var(--r-md)`) dargestellt.
  - **Zone 2 (Unten — `.plan-action-bar`)**:
    - Durch eine feine horizontale Linie (`border-top: 1px solid var(--bor)`) sauber von Zone 1 getrennt.
    - **Links (`.plan-actions-left`)**: Primäre Kontext-Action mit Icon + Text (`Abrechnen` `.btn-gld.btn-sm` bzw. `.btn-sec.btn-sm`, `Reaktivieren` `.btn-ok.btn-sm`, `In Abrechnung ansehen` `.btn-nav`) sowie ggf. Zurückstellen-Button (`deferBillingSession`).
    - **Rechts (`.plan-actions-right`, `margin-inline-start: auto`)**: Verwaltungs-Actions rechtsbündig auf einer einzigen Zeile als kompakte Icon-Buttons (`.btn-icon-sm`, `34×34px`, mit `title` und `aria-label`):
      - `#plan-edit-toggle-btn` (`.btn.btn-icon-sm.btn-sec`, Icon `sliders-horizontal`, aktiv `.active-toggle`)
      - `#plan-cancel-btn` (`.btn.btn-icon-sm.btn-dan`, Icon `x-circle`, wenn nicht abgesagt & nicht abgerechnet)
      - `#plan-delete-btn` (`.btn.btn-icon-sm.btn-dan`, Icon `trash-2`, wenn abgesagt)
    - Auf Desktop/breiten Cards (`@container plan-header (inline-size > 520px)`) darf `#plan-edit-toggle-btn` optional zusätzlich den Text `Details bearbeiten` (`.plan-btn-label`) einblenden; auf schmalen Viewports bleibt er ein kompakter Icon-Button, sodass die Action-Toolbar garantiert einzeilig bleibt.
- [x] **AC 2: Vollbreite Segmented Control (`#plan-tabs`) mit Icons**:
  - `#plan-tabs` erhält die zusätzliche Klasse `seg-tabs-full` (`display: grid; grid-template-columns: 1fr 1fr; width: 100%`).
  - Beide Tabs teilen sich die volle Breite zu je 50 % und zeigen vor dem Label ein passendes Lucide-Icon:
    - `#plan-tab-slots`: `<i data-lucide="layout-grid"></i> <span data-i18n="planner.tab_slots">Belegung</span>`
    - `#plan-tab-history`: `<i data-lucide="history"></i> <span data-i18n="planner.tab_history">Verlauf</span>`
- [x] **AC 3: Bestehende und neue E2E-Tests grün**:
  - Alle bestehenden Playwright-Tests in `tests/ui-flows.spec.js` (insb. Test 06 & Test 18) und `tests/ios-pwa.spec.js` (Test 03) laufen grün.

---

## 2. Betroffene Dateien & Rollen-Guides

Vor der Umsetzung müssen vom Builder folgende Rollen-Dateien gelesen werden:
- [x] `agents/frontend.md` (für `app.js` / `index.html`)
- [x] `agents/pwa_ux.md` & `agents/styleguide.md` (für `.btn-icon-sm`, `.seg-tabs`, Glas-/Surface-Styling)
- [x] `agents/testing.md` (immer für Verifikation)

**Zu ändernde Dateien:**
- `index.html` (Zeilen ca. 256–264: `#plan-tabs`)
- `app.js` (Funktion `renderAdminPlan()`, Zeilen ca. 2583–2630)
- `style.css` (Zeilen ca. 3140–3225: `.seg-tabs-full`, `.plan-header-top`, `.plan-title-row`, `.plan-meta-row`, `.plan-meta-item`, `.plan-action-bar`)
- `tests/ui-flows.spec.js` (Prüfung & ggf. Ergänzung für neuen Header-Aufbau)

---

## 3. Konkreter Bauplan (Zero-Ambiguity)

### 3.1 Datenbank & Backend (`api.php`)
Keine Änderungen an `api.php`.

### 3.2 Lokalisierung (`i18n.js`)
Keine neuen Übersetzungs-Keys erforderlich — alle benötigten Keys (`planner.edit_details`, `session.cancel`, `misc.delete`, `session.reactivate`, `session.billing_charge`, `planner.tab_slots`, `planner.tab_history`) existieren bereits in allen 6 Sprachen.

### 3.3 HTML & Styles (`index.html`, `style.css`)

#### 1. DOM-Struktur in `index.html` (Zeilen 256–264)
Ersetze den `#plan-tabs`-Block in `index.html` durch die vollbreite Variante mit Lucide-Icons:

```html
    <!-- 2. Session Header, Status & Collapsible Details Card -->
    <div id="admin-plan-header-dynamic" class="card mb4"></div>

    <!-- 3. Section Tabs (Belegung / Verlauf) -->
    <div class="seg-tabs seg-tabs-full mb4" id="plan-tabs" role="tablist">
      <button class="seg-tab active" id="plan-tab-slots" role="tab" aria-selected="true" onclick="setPlanTab('slots')"><i data-lucide="layout-grid"></i> <span data-i18n="planner.tab_slots">Belegung</span></button>
      <button class="seg-tab" id="plan-tab-history" role="tab" aria-selected="false" onclick="setPlanTab('history')"><i data-lucide="history"></i> <span data-i18n="planner.tab_history">Verlauf</span></button>
    </div>
```

#### 2. CSS-Regeln in `style.css` (ca. Zeilen 3140–3225)
1. Direkt nach `.seg-tabs` (ca. Zeile 3141) ergänzen:
```css
.seg-tabs-full{display:grid;grid-template-columns:1fr 1fr;width:100%}
```

2. Im Bereich `/* ── Modern Planner (Phases 3, 4, 5) ── */` (ca. Zeilen 3215–3224) die bisherigen `.plan-meta-row` / `.plan-meta-item` Regeln durch das neue 2-Zonen-Layout mit Container Query ersetzen:
```css
#admin-plan-header-dynamic{container:plan-header / inline-size}
.plan-header-top{display:flex;flex-direction:column;gap:var(--sp2_5, 10px)}
.plan-title-row{display:flex;align-items:center;justify-content:space-between;gap:var(--sp2);flex-wrap:wrap}
.plan-title-left{display:flex;align-items:center;gap:var(--sp2);min-width:0;flex-wrap:wrap}
.plan-meta-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.plan-meta-item{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:var(--r-md);background:var(--suroff);border:1px solid oklch(from var(--tx) l c h / .06);font-size:var(--text-xs);font-weight:600;color:var(--txm);line-height:1.25}
.plan-meta-item i,.plan-meta-item svg{width:13px;height:13px;flex-shrink:0;color:var(--pri); opacity:.85}
.plan-meta-item.plan-meta-note i,.plan-meta-item.plan-meta-note svg{color:var(--war);opacity:1}
.plan-action-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--sp2);margin-top:var(--sp3);padding-top:var(--sp3);border-top:1px solid var(--bor)}
.plan-actions-left{display:flex;align-items:center;gap:var(--sp2);flex-wrap:wrap;min-width:0}
.plan-actions-right{display:flex;align-items:center;gap:var(--sp2);margin-inline-start:auto;flex-shrink:0}
.plan-actions-right .btn-icon-sm{width:34px;height:34px;min-height:34px;padding:0;border-radius:var(--r-md);display:inline-flex;align-items:center;justify-content:center}
.plan-actions-right .plan-btn-label{display:none}
@container plan-header (inline-size > 520px){
  .plan-actions-right #plan-edit-toggle-btn{width:auto;padding:0 var(--sp3);gap:6px}
  .plan-actions-right .plan-btn-label{display:inline}
}
```

### 3.4 Frontend-Logik (`app.js`)

In `app.js` innerhalb von `renderAdminPlan(keepDetailsOpen)` (ca. Zeilen 2600–2628) den oberen Teil von `headBox.innerHTML` (vor `<div class="plan-edit-drawer" id="session-details-box" ...>`) wie folgt ersetzen:

```javascript
  // 3. Unified Header + Metadata + Collapsible Edit Drawer Card (2-Zone Layout)
  if (headBox) {
    headBox.innerHTML = `
      <div class="plan-header-top">
        <div class="plan-title-row">
          <div class="plan-title-left">
            <h2 class="sec-title" style="margin-bottom:0">${esc(getSessionName(sess))}</h2>
            ${sess.seriesId ? `<span class="badge bg-sec" title="${esc(t('planner.from_series'))}"><i data-lucide="repeat" style="width:12px;height:12px"></i></span>` : ''}
            <span class="save-indicator" id="plan-save-indicator"><i data-lucide="check"></i> ${t('planner.saved')}</span>
          </div>
          <span class="status-pill ${statusClass}">${statusLabel}</span>
        </div>

        <div class="plan-meta-row">
          <span class="plan-meta-item"><i data-lucide="calendar"></i> <span>${esc(fmtDL(sess.date))}</span></span>
          <span class="plan-meta-item"><i data-lucide="clock"></i> <span>${sessTime.start}–${sessTime.end}</span></span>
          ${effectiveLoc ? `<span class="plan-meta-item"><i data-lucide="map-pin"></i> <span>${esc(effectiveLoc)}</span></span>` : ''}
          <span class="plan-meta-item"><i data-lucide="tag"></i> <span>${fmtE(sessCost)} / Slot</span></span>
          <span class="plan-meta-item"><i data-lucide="users"></i> <span>${filled} / ${total} ${t('session.slots_meta')}</span></span>
          ${sess.note ? `<span class="plan-meta-item plan-meta-note"><i data-lucide="message-square"></i> <span>${esc(sess.note)}</span></span>` : ''}
        </div>
      </div>

      <div class="plan-action-bar">
        <div class="plan-actions-left">
          ${primaryActionBtn}
          ${sess.billingDeferred ? `<button class="btn btn-sec btn-sm" onclick="deferBillingSession('${sessId}', false)" type="button"><i data-lucide="rotate-ccw"></i> <span>${t('billing.undefer')}</span></button>` : ''}
          ${isAwaiting ? `<button class="btn btn-sec btn-sm" onclick="deferBillingSession('${sessId}', true)" type="button"><i data-lucide="clock"></i> <span>${t('billing.defer')}</span></button>` : ''}
        </div>
        <div class="plan-actions-right">
          <button class="btn btn-sec btn-icon-sm ${showDetails ? 'active-toggle' : ''}" id="plan-edit-toggle-btn" onclick="togglePlanDetails()" type="button" title="${esc(t('planner.edit_details'))}" aria-label="${esc(t('planner.edit_details'))}">
            <i data-lucide="sliders-horizontal"></i>
            <span class="plan-btn-label">${t('planner.edit_details')}</span>
          </button>
          ${!isCancelled && !sess.charged ? `<button class="btn btn-dan btn-icon-sm" id="plan-cancel-btn" onclick="toggleSessionCancel()" type="button" title="${esc(t('session.cancel'))}" aria-label="${esc(t('session.cancel'))}"><i data-lucide="x-circle"></i></button>` : ''}
          ${isCancelled ? `<button class="btn btn-dan btn-icon-sm" id="plan-delete-btn" onclick="deleteSession()" type="button" title="${esc(t('misc.delete'))}" aria-label="${esc(t('misc.delete'))}"><i data-lucide="trash-2"></i></button>` : ''}
        </div>
      </div>

      <div class="plan-edit-drawer" id="session-details-box" ${showDetails ? '' : 'hidden'}>
```

*(Wichtig: Der gesamte Inhalt ab `<div class="plan-edit-drawer" id="session-details-box" ...>` bis zum Ende von `headBox.innerHTML` bleibt unverändert erhalten!)*

---

## 4. Test- & Verifikationsplan

### 4.1 Automatisierte Tests (Playwright)
- **Gezielte Tests ausführen** (im Ordner `tests/`):
  ```bash
  npx playwright test ui-flows.spec.js --project=chromium
  npx playwright test ios-pwa.spec.js --project=ios
  ```
- **Prüfpunkte in `tests/ui-flows.spec.js`**:
  - Test `06 — Session details: edit time, note, location + cancel & delete session` prüft `#plan-edit-toggle-btn`, `#plan-cancel-btn`, `Reaktivieren` und `#plan-delete-btn`.
  - Test `18 — Charge session from Sessionplaner ("Zur Abrechnung" button)` prüft den `Abrechnen`-Button in `#admin-plan-header-dynamic`.
  - Zusätzlich in Test `06` verifizieren, dass `.plan-header-top`, `.plan-action-bar` und `#plan-tabs.seg-tabs-full` sichtbar sind.

### 4.2 Abschluss-Checkliste für den Builder
- [x] Alle Akzeptanzkriterien aus Abschnitt 1 erfüllt?
- [x] Keine `console.log` oder `var_dump` Debug-Reste im Code?
- [x] Gezielte Playwright-Tests (`ui-flows.spec.js` und `ios-pwa.spec.js`) laufen grün ohne Console-Errors?
- [x] `./scripts/sync-build.sh` ausgeführt und alle 6 Build-Nummern synchronisiert?
- [x] Spec-Status oben auf `done` gesetzt und Datei von `specs/backlog/` nach `specs/done/` verschoben?
