# Spec / User Story: 002 — Sessions aus dem Abrechnungsscreen zurückstellen (Stummschalten)

- **ID**: `002`
- **Slug**: `defer-billing-sessions`
- **Branch**: `feat/002-defer-billing-sessions`
- **Status**: `done`
- **Ziel-Modell (Builder)**: `flash`
- **Erstellt am**: 2026-11-12

---

## 1. User Story & Ziel

**Als** Admin
**möchte ich** in der Abrechnungsübersicht (`#view-billing`) zur Abrechnung anstehende Sessions mit einem Klick zurückstellen (Erinnerung stummschalten) können,
**damit** sie aus der aktiven Liste „Offen“ und dem Badge-Zähler der Navigation verschwinden, ich aber in einem separaten Tab „Zurückgestellt“ den Überblick behalte und sie jederzeit später abrechnen oder wieder vorlegen kann.

### Akzeptanzkriterien (AC)
- [x] **AC 1: Neuer Tab „Zurückgestellt“ in der Abrechnung**: In `#view-billing` gibt es neben „Offen (X)“ und „Abgerechnet“ einen dritten Tab „Zurückgestellt (Y)“ (`#billing-tab-deferred`).
- [x] **AC 2: Badge-Zähler schließt zurückgestellte Sessions aus**: Der Zähler in der Navigation (`#nav-billing-count` und `#bnav-billing-count`) zählt ausschließlich noch nicht zurückgestellte, offene Sessions (`!s.charged && !s.cancelled && !s.billingDeferred && sessionEndDate(s) < now && Object.keys(sessionChargeMap(s)).length > 0`).
- [x] **AC 3: Zurückstellen-Aktion in „Offen“**: Jedes Element in der Liste „Offen“ hat neben „Prüfen & Abrechnen“ und „Im Planer öffnen“ einen Button „Zurückstellen“ (`.btn.btn-sec.btn-sm` mit Lucide-Icon `clock`). Klick sendet `PUT /api.php/sessions/:id` mit `{ billingDeferred: true }`, aktualisiert den State und zeigt einen Erfolgs-Toast.
- [x] **AC 4: Ansicht im Tab „Zurückgestellt“**:
  - Zeigt alle beendeten, unberechneten Sessions mit `billingDeferred === true`.
  - Jedes Element zeigt Titel, Datum/Zeit, Metadaten (Slots/Spieler), Gesamtsumme, eine neutrale Badge „Zurückgestellt“ sowie die Buttons:
    - „Prüfen & Abrechnen“ (`openBillingModal([s.id])`)
    - „Wieder vorlegen“ (`deferBillingSession(s.id, false)` mit Lucide-Icon `rotate-ccw`)
    - „Im Planer öffnen“ (`openBillingInPlanner(s.id)`)
  - Ist die Liste leer, wird ein Empty State mit Icon `clock`, Titel und Hinweistext angezeigt.
  - Der Batch-Footer (`#billing-footer`) ist im Tab „Zurückgestellt“ ausgeblendet (`hidden = true`).
- [x] **AC 5: Backend-Persistenz & Migration**:
  - SQLite-Tabelle `sessions` erhält die neue Spalte `billing_deferred INTEGER DEFAULT 0`.
  - Idempotente Migration in `api.php` (`$migrations` Array).
  - `GET /api.php/sessions` liefert `'billingDeferred' => (bool)($s['billing_deferred'] ?? 0)`.
  - `PUT /api.php/sessions/:id` akzeptiert `billingDeferred` (Boolean) für Admins und persisted dies.
  - Beim erfolgreichen Abrechnen (`charge_session`) wird `billing_deferred` wieder auf `0` zurückgesetzt.
- [x] **AC 6: Status im Session-Planer (`view-admin-plan`)**:
  - Im horizontalen Date-Strip erhält ein zurückgestelltes Datum den Chip-Status `st-deferred` (Badge `⏸`).
  - In der Header-Card wird für zurückgestellte Sessions der Status `planner.status_deferred` („Abrechnung zurückgestellt“) angezeigt.
  - Ist eine Session zurückgestellt, bietet der Planer-Header einen Button „Wieder vorlegen“ an.
- [x] **AC 7: Vollständige i18n-Übersetzungen**: Alle neuen UI-Strings sind in allen 6 Sprachen (`de`, `en`, `es`, `it`, `fr`, `pt`) in `i18n.js` vorhanden.
- [x] **AC 8: E2E-Test**: Ein Playwright-Test verifiziert den gesamten Ablauf (Offen → Zurückstellen → Badge sinkt → Tab Zurückgestellt → Wieder vorlegen → Badge steigt).

---

## 2. Betroffene Dateien & Rollen-Guides

Vor der Umsetzung müssen vom Builder folgende Rollen-Dateien gelesen werden:
- [x] `agents/backend.md` (für `api.php` SQLite Migrations & Endpoints)
- [x] `agents/frontend.md` (für `app.js` / `index.html`)
- [x] `agents/styleguide.md` (für `.btn-sec.btn-sm`, `.seg-tab`, `.badge.bg-neu`)
- [x] `agents/testing.md` (für Playwright-E2E-Tests)

**Zu ändernde Dateien:**
- `api.php` (DB-Schema Zeilen ca. 188, 271, 459, 1151, 1261, 1285, 1409, 1597, 1845, 1964, 2209)
- `index.html` (`#view-billing` Zeilen ca. 243–246)
- `style.css` (Zeilen ca. 3115, 3130)
- `app.js` (Billing-Logik Zeilen ca. 3229–3400, Planer-Status Zeilen ca. 2470–2575)
- `i18n.js` (Neue Keys in `de`, `en`, `es`, `it`, `fr`, `pt`)
- `tests/ui-flows.spec.js` (Neuer Test nach Test 25)

---

## 3. Konkreter Bauplan (Zero-Ambiguity)

### 3.1 Datenbank & Backend (`api.php`)

#### 1. Schema-Definition (`init_db`)
In `api.php` bei `CREATE TABLE IF NOT EXISTS sessions` (ca. Zeile 188) und `CREATE TABLE sessions_new` (ca. Zeile 459) als letzte Spalte vor der schließenden Klammer ergänzen:
```sql
        billing_deferred INTEGER DEFAULT 0
```

#### 2. Migration
In `$migrations` (ca. Zeile 271–295) anhängen:
```php
        "ALTER TABLE sessions ADD COLUMN billing_deferred INTEGER DEFAULT 0",
```

#### 3. `handle_sessions_list()` (ca. Zeile 1151–1168)
Im zurückgegebenen Session-Array ergänzen:
```php
            'billingDeferred'=> (bool)($s['billing_deferred'] ?? 0),
```

#### 4. `handle_session_update()` (ca. Zeilen 1251–1413)
- In der Prüfung auf Mutationen bei bereits abgerechneten Sessions (ca. Zeile 1265) `|| isset($b['billingDeferred'])` ergänzen.
- Beim Upsert neuer Sessions (ca. Zeile 1285 `INSERT INTO sessions`) `billing_deferred` in die Spaltenliste und `!empty($b['billingDeferred']) ? 1 : 0` in die Parameter aufnehmen.
- Beim Update bestehender Sessions (ca. Zeile 1409):
```php
    if (isset($b['billingDeferred'])) {
        $db->prepare("UPDATE sessions SET billing_deferred=? WHERE id=?")->execute([$b['billingDeferred'] ? 1 : 0, $sessId]);
    }
```

#### 5. `charge_session()` (ca. Zeile 1597)
Beim Abrechnen die Session aktualisieren:
```php
    $db->prepare("UPDATE sessions SET charged=1, billing_deferred=0 WHERE id=?")->execute([$sessId]);
```

#### 6. Dynamic Session Inserts (Backup-Restore, Booking & Waitlist)
- `handle_system_restore` (ca. Zeile 1845): In `INSERT OR IGNORE INTO sessions` Spalte `billing_deferred` mit Default `0` aufnehmen.
- `handle_session_book` (ca. Zeile 1964): In `INSERT INTO sessions` Spalte `billing_deferred` mit `0` aufnehmen.
- `handle_session_join_waitlist` (ca. Zeile 2209): In `INSERT INTO sessions` Spalte `billing_deferred` mit `0` aufnehmen.

---

### 3.2 HTML (`index.html`)

In `index.html` in `#view-billing` (ca. Zeilen 243–246) den neuen Tab einfügen:

```html
    <div class="seg-tabs mb4" role="tablist">
      <button class="seg-tab active" id="billing-tab-open" role="tab" aria-selected="true" onclick="setBillingTab('open')"></button>
      <button class="seg-tab" id="billing-tab-deferred" role="tab" aria-selected="false" onclick="setBillingTab('deferred')"></button>
      <button class="seg-tab" id="billing-tab-charged" role="tab" aria-selected="false" onclick="setBillingTab('charged')"></button>
    </div>
```

---

### 3.3 CSS (`style.css`)

In `style.css` nach den Definitionen für `.plan-chip.st-charged` (ca. Zeile 3115) und `.status-pill.st-charged` (ca. Zeile 3128) ergänzen:

```css
.plan-chip.st-deferred .pc-badge{background:oklch(from var(--txm) l c h / .15);color:var(--txm)}
.status-pill.st-deferred{background:oklch(from var(--txm) l c h / .12);color:var(--txm)}
.status-pill.st-deferred::before{background:var(--txm)}
```

---

### 3.4 Lokalisierung (`i18n.js`)

In allen 6 Sprachen in `i18n.js` folgende 9 Keys ergänzen (unter `billing.` bzw. `planner.`):

#### 1. Deutsch (`de`):
```javascript
      "billing.tab_deferred": "Zurückgestellt",
      "billing.defer": "Zurückstellen",
      "billing.undefer": "Wieder vorlegen",
      "billing.badge_deferred": "Zurückgestellt",
      "billing.deferred_empty_title": "Keine zurückgestellten Sessions",
      "billing.deferred_empty_text": "Sessions, deren Abrechnungserinnerung stummgeschaltet wurde, erscheinen hier.",
      "billing.toast_deferred": "Session von der Abrechnung zurückgestellt",
      "billing.toast_undeferred": "Session wieder zur Abrechnung vorgelegt",
      "planner.status_deferred": "Abrechnung zurückgestellt",
```

#### 2. Englisch (`en`):
```javascript
      "billing.tab_deferred": "Deferred",
      "billing.defer": "Defer",
      "billing.undefer": "Restore to open",
      "billing.badge_deferred": "Deferred",
      "billing.deferred_empty_title": "No deferred sessions",
      "billing.deferred_empty_text": "Sessions whose billing reminder was dismissed or put on hold appear here.",
      "billing.toast_deferred": "Session deferred from billing",
      "billing.toast_undeferred": "Session restored to open billing",
      "planner.status_deferred": "Billing deferred",
```

#### 3. Spanisch (`es`):
```javascript
      "billing.tab_deferred": "Pospuestas",
      "billing.defer": "Posponer",
      "billing.undefer": "Reactivar",
      "billing.badge_deferred": "Pospuesta",
      "billing.deferred_empty_title": "No hay sesiones pospuestas",
      "billing.deferred_empty_text": "Las sesiones cuyo recordatorio de facturación se haya pospuesto aparecerán aquí.",
      "billing.toast_deferred": "Sesión pospuesta de la facturación",
      "billing.toast_undeferred": "Sesión restaurada a la facturación abierta",
      "planner.status_deferred": "Facturación pospuesta",
```

#### 4. Italienisch (`it`):
```javascript
      "billing.tab_deferred": "Sospese",
      "billing.defer": "Sospendi",
      "billing.undefer": "Ripristina",
      "billing.badge_deferred": "Sospesa",
      "billing.deferred_empty_title": "Nessuna sessione sospesa",
      "billing.deferred_empty_text": "Le sessioni il cui promemoria di fatturazione è stato sospeso compaiono qui.",
      "billing.toast_deferred": "Sessione sospesa dalla fatturazione",
      "billing.toast_undeferred": "Sessione ripristinata nella fatturazione aperta",
      "planner.status_deferred": "Fatturazione sospesa",
```

#### 5. Französisch (`fr`):
```javascript
      "billing.tab_deferred": "Reportées",
      "billing.defer": "Reporter",
      "billing.undefer": "Restaurer",
      "billing.badge_deferred": "Reportée",
      "billing.deferred_empty_title": "Aucune session reportée",
      "billing.deferred_empty_text": "Les sessions dont le rappel de facturation a été mis en attente apparaissent ici.",
      "billing.toast_deferred": "Session reportée de la facturation",
      "billing.toast_undeferred": "Session restaurée pour la facturation",
      "planner.status_deferred": "Facturation reportée",
```

#### 6. Portugiesisch (`pt`):
```javascript
      "billing.tab_deferred": "Adiada",
      "billing.defer": "Adiar",
      "billing.undefer": "Restaurar",
      "billing.badge_deferred": "Adiada",
      "billing.deferred_empty_title": "Nenhuma sessão adiada",
      "billing.deferred_empty_text": "As sessões cujo lembrete de cobrança foi adiado aparecem aqui.",
      "billing.toast_deferred": "Sessão adiada da cobrança",
      "billing.toast_undeferred": "Sessão restaurada para cobrança aberta",
      "planner.status_deferred": "Cobrança adiada",
```

---

### 3.5 Frontend-Logik (`app.js`)

#### 1. Filterfunktionen & Tab-State (ca. Zeilen 3229–3265)
```javascript
let billingTab = 'open'; // 'open' | 'deferred' | 'charged'

function getOpenBillingSessions() {
  const now = new Date();
  return (S.sessions || [])
    .filter(s => !s.charged && !s.cancelled && !s.billingDeferred && sessionEndDate(s) < now && Object.keys(sessionChargeMap(s)).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timeStart || '').localeCompare(b.timeStart || ''));
}

function getDeferredBillingSessions() {
  const now = new Date();
  return (S.sessions || [])
    .filter(s => !s.charged && !s.cancelled && s.billingDeferred && sessionEndDate(s) < now && Object.keys(sessionChargeMap(s)).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timeStart || '').localeCompare(b.timeStart || ''));
}
```

#### 2. `renderBilling()` (ca. Zeilen 3295–3380)
- Tab-Buttons synchronisieren:
```javascript
  const openList = getOpenBillingSessions();
  const deferredList = getDeferredBillingSessions();
  const chargedList = getChargedSessions();
  const tabOpen = document.getElementById('billing-tab-open');
  const tabDef = document.getElementById('billing-tab-deferred');
  const tabCh = document.getElementById('billing-tab-charged');
  if (tabOpen) {
    tabOpen.textContent = `${t('billing.tab_open')} (${openList.length})`;
    tabOpen.classList.toggle('active', billingTab === 'open');
    tabOpen.setAttribute('aria-selected', billingTab === 'open');
  }
  if (tabDef) {
    tabDef.textContent = `${t('billing.tab_deferred')} (${deferredList.length})`;
    tabDef.classList.toggle('active', billingTab === 'deferred');
    tabDef.setAttribute('aria-selected', billingTab === 'deferred');
  }
  if (tabCh) {
    tabCh.textContent = t('billing.tab_charged');
    tabCh.classList.toggle('active', billingTab === 'charged');
    tabCh.setAttribute('aria-selected', billingTab === 'charged');
  }
```

- In `billingTab === 'open'`:
In `bi-actions` (ca. Zeile 3340) den Zurückstellen-Button einfügen:
```html
<div class="bi-actions">
  <button class="btn btn-sec btn-sm" onclick="openBillingModal(['${s.id}'])">${t('billing.review')}</button>
  <button class="btn btn-sec btn-sm" onclick="deferBillingSession('${s.id}', true)"><i data-lucide="clock"></i> ${t('billing.defer')}</button>
  <button class="btn-nav" onclick="openBillingInPlanner('${s.id}')"><i data-lucide="arrow-up-right"></i> ${t('billing.open_in_planner')}</button>
</div>
```

- Fall `billingTab === 'deferred'`:
```javascript
  } else if (billingTab === 'deferred') {
    footer.hidden = true;
    if (!deferredList.length) {
      root.innerHTML = `<div class="empty"><i data-lucide="clock"></i><h3>${t('billing.deferred_empty_title')}</h3><p class="txsm">${t('billing.deferred_empty_text')}</p></div>`;
    } else {
      root.innerHTML = `<div class="billing-list">
        ${deferredList.map(s => {
          const tot = billingSessionTotals(s);
          return `<div class="billing-item">
            <div class="bi-main">
              <div class="bi-title">${esc(getSessionName(s))} <span class="badge bg-neu">${t('billing.badge_deferred')}</span></div>
              <div class="bi-meta">${billingSessionHeader(s)}</div>
              <div class="bi-meta">${t('billing.session_meta').replace('{slots}', tot.slots).replace('{players}', tot.players)}</div>
              <div class="bi-actions">
                <button class="btn btn-pri btn-sm" onclick="openBillingModal(['${s.id}'])">${t('billing.review')}</button>
                <button class="btn btn-sec btn-sm" onclick="deferBillingSession('${s.id}', false)"><i data-lucide="rotate-ccw"></i> ${t('billing.undefer')}</button>
                <button class="btn-nav" onclick="openBillingInPlanner('${s.id}')"><i data-lucide="arrow-up-right"></i> ${t('billing.open_in_planner')}</button>
              </div>
            </div>
            <div class="bi-sum">${fmtE(tot.sum)}</div>
          </div>`;
        }).join('')}
      </div>`;
    }
  }
```

#### 3. Neue Hilfsfunktion `deferBillingSession()` (in `app.js` bei den Billing-Funktionen einfügen):
```javascript
async function deferBillingSession(sessionId, deferred) {
  try {
    await apiFetch('PUT', '/sessions/' + sessionId, { billingDeferred: deferred });
    await loadState();
    renderBilling();
    renderAdminPlan();
    renderSessions();
    lucide.createIcons();
    showToast(deferred ? t('billing.toast_deferred') : t('billing.toast_undeferred'));
  } catch(e) {
    showToast(t('billing.error'));
  }
}
```

#### 4. Session Planer Integration (`app.js`)
- In `renderAdminPlan()` (ca. Zeilen 2470–2510):
  - `const isAwaiting = !sess.charged && !isCancelled && !sess.billingDeferred && isEnded && filled > 0;`
  - In der Status-Zuweisung:
    ```javascript
    if (isCancelled) {
      statusClass = 'st-cancelled';
      statusLabel = t('planner.status_cancelled');
    } else if (sess.charged) {
      statusClass = 'st-charged';
      statusLabel = t('planner.status_charged');
    } else if (sess.billingDeferred) {
      statusClass = 'st-deferred';
      statusLabel = t('planner.status_deferred');
    } else if (isAwaiting) {
      statusClass = 'st-awaiting';
      statusLabel = t('planner.status_awaiting');
    }
    ```
  - In `makeChip(s)`:
    ```javascript
    const sAwaiting = !s.charged && !s.cancelled && !s.billingDeferred && sEnded && sFilled > 0;
    let chipClass = 'st-open';
    let bText = `${sFilled}/${sTotalSlots}`;
    if (s.cancelled) { chipClass = 'st-cancelled'; bText = '✕'; }
    else if (s.charged) { chipClass = 'st-charged'; bText = '✓'; }
    else if (s.billingDeferred) { chipClass = 'st-deferred'; bText = '⏸'; }
    else if (sAwaiting) { chipClass = 'st-awaiting'; bText = '€'; }
    ```
  - In der Buttonleiste des Planer-Headers (ca. Zeile 2593) bei beendeten, unberechneten Sessions:
    Falls `sess.billingDeferred`:
    `<button class="btn btn-sec btn-sm" onclick="deferBillingSession('${sessId}', false)"><i data-lucide="rotate-ccw"></i> ${t('billing.undefer')}</button>`
    Falls `isAwaiting`:
    `<button class="btn btn-sec btn-sm" onclick="deferBillingSession('${sessId}', true)"><i data-lucide="clock"></i> ${t('billing.defer')}</button>`

---

## 4. Test- & Verifikationsplan

### 4.1 Automatisierte Tests (Playwright)
In `tests/ui-flows.spec.js` einen neuen Test `26 — Billing view: defer session, verify badge decrement, verify deferred tab, undefer` nach Test 25 hinzufügen:

```javascript
  test('26 — Billing view: defer session, verify badge decrement, verify deferred tab, undefer', async ({ page, request }) => {
    const H = { 'Content-Type': 'application/json', 'X-Token': aToken };
    const players = await (await request.get('/api.php/players')).json();
    const alice = players.find(p => p.name === 'Alice');
    
    // Create 2 past sessions with booking
    const mk = async (date) => {
      const r = await (await request.put('/api.php/sessions/new', { headers: H, data: { date, courts: [[null,null,null,null]], timeStart: '1900', timeEnd: '2100' } })).json();
      const id = r.id || date;
      await request.post(`/api.php/sessions/${id}/book`, { headers: H, data: { court_index: 0, slot_index: 0, player_id: alice.id } });
      return id;
    };
    const s1 = await mk('2020-04-10');
    const s2 = await mk('2020-04-12');

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Badge shows 2 open sessions
    await expect(page.locator('#nav-billing-count')).toHaveText('2');
    await navigateAdmin(page, 'billing');
    await expect(page.locator('#view-billing')).toHaveClass(/active/);
    await expect(page.locator('#billing-content .billing-item')).toHaveCount(2);

    // Defer the first session
    const firstItem = page.locator('#billing-content .billing-item').first();
    const deferBtn = firstItem.locator('button', { hasText: 'Zurückstellen' });
    await expect(deferBtn).toBeVisible();
    await deferBtn.click();

    // Verify badge decreased to 1 and only 1 open session remains
    await expect(page.locator('#nav-billing-count')).toHaveText('1');
    await expect(page.locator('#billing-content .billing-item')).toHaveCount(1);

    // Switch to "Zurückgestellt" tab
    await page.click('#billing-tab-deferred');
    await expect(page.locator('#billing-content .billing-item')).toHaveCount(1);
    await expect(page.locator('#billing-content .billing-item .badge')).toContainText('Zurückgestellt');

    // Undefer
    const undeferBtn = page.locator('#billing-content .billing-item button', { hasText: 'Wieder vorlegen' });
    await expect(undeferBtn).toBeVisible();
    await undeferBtn.click();

    // Verify deferred tab is now empty
    await expect(page.locator('#billing-content .empty')).toBeVisible();

    // Verify badge is back to 2
    await expect(page.locator('#nav-billing-count')).toHaveText('2');

    // Switch back to "Offen" tab and verify 2 items
    await page.click('#billing-tab-open');
    await expect(page.locator('#billing-content .billing-item')).toHaveCount(2);
  });
```

### 4.2 Test-Ausführung
```bash
npx playwright test ui-flows.spec.js --project=chromium
```

---

## 5. Build-Synchronisation

Vor dem Commit / PR müssen die Build-Nummern synchronisiert werden:
```bash
./scripts/sync-build.sh
```
