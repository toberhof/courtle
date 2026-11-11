# Spec / User Story: 001 — Banner für Teamkasse & Motivations-Status im Spieler-Guthaben ein-/ausblendbar machen

- **ID**: `001`
- **Slug**: `balance-banner-toggles`
- **Branch**: `feat/001-balance-banner-toggles`
- **Status**: `backlog`
- **Ziel-Modell (Builder)**: `flash`
- **Erstellt am**: 2026-11-11

---

## 1. User Story & Ziel

**Als** Admin
**möchte ich** in den Admin-Einstellungen unter „Darstellung“ separat steuern können, ob im Spieler-Guthaben-View (`#view-my-transactions`) das Banner für die **Teamkasse** (`#my-group-pool`) und das **Motivations-/Budget-Status-Banner** (`#my-runway-indicator`) angezeigt oder ausgeblendet werden,
**damit** ich die Guthaben-Ansicht für mein Team flexibel entschlacken oder bei Bedarf nur die Timeline anzeigen lassen kann.

### Akzeptanzkriterien (AC)
- [ ] AC 1: In `#view-settings` → Tab `Allgemein` (`#settings-panel-general`) → Sektion `Darstellung` (`settings.section_display`) existieren zwei neue Toggle-Switches im bestehenden `.settings-row`-Design mit `.switch` / `.switch-slider` und Auto-Save (`onchange="settingsAutoSave()"`):
  1. `#disp-show-team-pool` („Teamkasse im Spieler-Guthaben anzeigen“)
  2. `#disp-show-runway-banner` („Motivations-Banner im Spieler-Guthaben anzeigen“)
- [ ] AC 2: Beide Einstellungen sind standardmäßig aktiviert (`'1'` bzw. `!== '0'`), sodass bestehende Installationen und Tests ohne Konfigurationsänderung beide Banner wie gewohnt anzeigen.
- [ ] AC 3: `PUT /api.php/config` akzeptiert und validiert `show_team_pool` und `show_runway_banner` (jeweils nur `'0'` oder `'1'`).
- [ ] AC 4: Ist `show_team_pool === '0'`, wird `#my-group-pool` in `renderMyTransactions()` ausgeblendet (`style.display = 'none'`, `innerHTML = ''`). Ist die Einstellung aktiv (`!== '0'`), wird `#my-group-pool` normal gerendert (`style.display = ''`).
- [ ] AC 5: Ist `show_runway_banner === '0'`, wird `#my-runway-indicator` in `renderMyTransactions()` ausgeblendet (`style.display = 'none'`, `innerHTML = ''`). Ist die Einstellung aktiv (`!== '0'`), wird `#my-runway-indicator` normal gerendert (`style.display = ''`).
- [ ] AC 6: Alle neuen UI-Texte sind vollständig in `i18n.js` für alle 6 Sprachen (`de`, `en`, `es`, `it`, `fr`, `pt`) hinterlegt.
- [ ] AC 7: Ein E2E-Test in `tests/ui-flows.spec.js` prüft das Aus- und Wiedereinblenden beider Banner über die Admin-Einstellungen.

---

## 2. Betroffene Dateien & Rollen-Guides

Vor der Umsetzung müssen vom Builder folgende Rollen-Dateien gelesen werden:
- [ ] `agents/backend.md` (für `api.php`)
- [ ] `agents/frontend.md` (für `app.js` / `index.html`)
- [ ] `agents/pwa_ux.md` & `agents/styleguide.md` (für Design-Einhaltung & Terminologie)
- [ ] `agents/testing.md` (für E2E-Verifikation)

**Zu ändernde Dateien:**
- `api.php` (`handle_config_set()`, Zeilen ca. 1698–1746)
- `index.html` (`#settings-panel-general`, Sektion `Darstellung`, Zeilen ca. 586–618)
- `app.js` (`renderMyTransactions()` Zeilen ca. 4608–4686, `renderSettings()` Zeilen ca. 5301–5315, `saveSettings()` Zeilen ca. 5392–5420)
- `i18n.js` (4 neue Keys in allen 6 Sprachblöcken `de`, `en`, `es`, `it`, `fr`, `pt`)
- `tests/ui-flows.spec.js` (Test 19 erweitern, Zeilen ca. 985–1012)

---

## 3. Konkreter Bauplan (Zero-Ambiguity)

### 3.1 Datenbank & Backend (`api.php`)
- **DB-Migration (`init_db`)**: Keine Schema-Migration nötig, da `config` eine generische Key-Value-Tabelle (`key TEXT PRIMARY KEY, value TEXT`) ist und `S.cfg.show_team_pool !== '0'` sowie `S.cfg.show_runway_banner !== '0'` im Frontend ohne DB-Eintrag automatisch auf `'1'` (aktiv) zurückfallen.
- **Endpoint / Route**: `PUT /api.php/config` (`handle_config_set()` in `api.php`, ab Zeile 1694)
  - Auth-Prüfung: `require_auth(true);` (bereits vorhanden)
  - In `$allowed` (ca. Zeile 1718 nach `'show_cancel_deadline',`) ergänzen:
    ```php
            'show_cancel_deadline',
            'show_team_pool',
            'show_runway_banner',
    ```
  - In der Validierungsschleife (ca. Zeile 1738 nach `if ($k === 'show_cancel_deadline' && !in_array($v, ['0', '1'], true)) continue;`) ergänzen:
    ```php
            if ($k === 'show_cancel_deadline' && !in_array($v, ['0', '1'], true)) continue;
            if ($k === 'show_team_pool' && !in_array($v, ['0', '1'], true)) continue;
            if ($k === 'show_runway_banner' && !in_array($v, ['0', '1'], true)) continue;
    ```

### 3.2 Lokalisierung (`i18n.js`)
Alle 4 neuen Keys **müssen** in allen 6 Sprachen (`de`, `en`, `es`, `it`, `fr`, `pt`) direkt unter `"settings.show_cancel_deadline_hint"` eingetragen werden:

1. **Deutsch (`de`, ca. Zeile 338)**:
```javascript
      "settings.show_cancel_deadline": "Abmeldefrist in Session-Cards anzeigen",
      "settings.show_cancel_deadline_hint": "Zeigt die Abmeldefrist in der Session-Übersicht. Folgt dem Datenschutz-Modus.",
      "settings.show_team_pool": "Teamkasse im Spieler-Guthaben anzeigen",
      "settings.show_team_pool_hint": "Zeigt das Teamkasse-Banner in der Guthaben-Ansicht der Spieler.",
      "settings.show_runway_banner": "Motivations-Banner im Spieler-Guthaben anzeigen",
      "settings.show_runway_banner_hint": "Zeigt das Status- und Budget-Banner zum Kontostand in der Guthaben-Ansicht der Spieler.",
```

2. **Englisch (`en`, ca. Zeile 1175)**:
```javascript
      "settings.show_cancel_deadline": "Show cancellation deadline in session cards",
      "settings.show_cancel_deadline_hint": "Shows the cancellation deadline in the session overview. Follows privacy mode.",
      "settings.show_team_pool": "Show team cash pool in player balance view",
      "settings.show_team_pool_hint": "Shows the team cash pool banner in the players' balance view.",
      "settings.show_runway_banner": "Show motivational budget banner in player balance view",
      "settings.show_runway_banner_hint": "Shows the balance status and motivational budget banner in the players' balance view.",
```

3. **Spanisch (`es`, ca. Zeile 1958)**:
```javascript
      "settings.show_cancel_deadline": "Mostrar plazo de cancelación en las tarjetas de sesión",
      "settings.show_cancel_deadline_hint": "Muestra el plazo de cancelación en la vista general de sesiones. Sigue el modo de privacidad.",
      "settings.show_team_pool": "Mostrar fondo del equipo en la vista de saldo",
      "settings.show_team_pool_hint": "Muestra el banner del fondo del equipo en la vista de saldo de los jugadores.",
      "settings.show_runway_banner": "Mostrar banner motivacional de presupuesto en la vista de saldo",
      "settings.show_runway_banner_hint": "Muestra el banner de estado y presupuesto en la vista de saldo de los jugadores.",
```

4. **Italienisch (`it`, ca. Zeile 2741)**:
```javascript
      "settings.show_cancel_deadline": "Mostra termine di cancellazione nelle card delle sessioni",
      "settings.show_cancel_deadline_hint": "Mostra il termine di cancellazione nella panoramica delle sessioni. Segue la modalità privacy.",
      "settings.show_team_pool": "Mostra cassa comune nella vista saldo giocatore",
      "settings.show_team_pool_hint": "Mostra il banner della cassa comune nella vista saldo dei giocatori.",
      "settings.show_runway_banner": "Mostra banner motivazionale del budget nella vista saldo",
      "settings.show_runway_banner_hint": "Mostra il banner di stato e budget nella vista saldo dei giocatori.",
```

5. **Französisch (`fr`, ca. Zeile 3524)**:
```javascript
      "settings.show_cancel_deadline": "Afficher le délai d'annulation sur les fiches",
      "settings.show_cancel_deadline_hint": "Affiche le délai d'annulation dans l'aperçu. Respecte le mode confidentialité.",
      "settings.show_team_pool": "Afficher la caisse d'équipe dans la vue solde joueur",
      "settings.show_team_pool_hint": "Affiche la bannière de la caisse d'équipe dans la vue du solde des joueurs.",
      "settings.show_runway_banner": "Afficher la bannière de motivation du budget dans la vue solde",
      "settings.show_runway_banner_hint": "Affiche la bannière de statut et de budget dans la vue du solde des joueurs.",
```

6. **Portugiesisch (`pt`, ca. Zeile 4313)**:
```javascript
      "settings.show_cancel_deadline": "Mostrar prazo de cancelamento nos cartões",
      "settings.show_cancel_deadline_hint": "Mostra o prazo de cancelamento na visão geral. Segue o modo de privacidade.",
      "settings.show_team_pool": "Mostrar caixa da equipe na visão de saldo do jogador",
      "settings.show_team_pool_hint": "Mostra o banner do caixa da equipe na visão de saldo dos jogadores.",
      "settings.show_runway_banner": "Mostrar banner motivacional de orçamento na visão de saldo",
      "settings.show_runway_banner_hint": "Mostra o banner de status e orçamento na visão de saldo dos jogadores.",
```

### 3.3 HTML & Styles (`index.html`, `style.css`)
- **DOM-Struktur (`index.html`)**:
  - In `#settings-panel-general` innerhalb der Sektion `<!-- Section: Darstellung (Display Options) -->` (`.settings-group`, direkt nach dem `.settings-row`-Block von `#disp-show-cancel-deadline` bei Zeile 616) folgende zwei `.settings-row`-Blöcke einfügen:
  ```html
        <div class="settings-row">
          <div class="settings-label">
            <label class="settings-title" for="disp-show-team-pool" data-i18n="settings.show_team_pool">Teamkasse im Spieler-Guthaben anzeigen</label>
            <p class="settings-desc" data-i18n="settings.show_team_pool_hint">Zeigt das Teamkasse-Banner in der Guthaben-Ansicht der Spieler.</p>
          </div>
          <div class="settings-control">
            <label class="switch">
              <input type="checkbox" id="disp-show-team-pool" checked onchange="settingsAutoSave()">
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-label">
            <label class="settings-title" for="disp-show-runway-banner" data-i18n="settings.show_runway_banner">Motivations-Banner im Spieler-Guthaben anzeigen</label>
            <p class="settings-desc" data-i18n="settings.show_runway_banner_hint">Zeigt das Status- und Budget-Banner zum Kontostand in der Guthaben-Ansicht der Spieler.</p>
          </div>
          <div class="settings-control">
            <label class="switch">
              <input type="checkbox" id="disp-show-runway-banner" checked onchange="settingsAutoSave()">
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>
  ```
- **CSS-Regeln (`style.css`)**:
  - Keine neuen CSS-Klassen erforderlich; es werden die bestehenden Design-System-Klassen `.settings-row`, `.settings-label`, `.settings-title`, `.settings-desc`, `.settings-control`, `.switch` und `.switch-slider` verwendet.

### 3.4 Frontend-Logik (`app.js`)
- **State (`S.cfg`)**:
  - `S.cfg.show_team_pool` (`'1'` oder `'0'`, Default bei Nichtvorhandensein: `'1'` über `!== '0'`)
  - `S.cfg.show_runway_banner` (`'1'` oder `'0'`, Default bei Nichtvorhandensein: `'1'` über `!== '0'`)
- **1. `renderMyTransactions()` in `app.js` (Zeilen ca. 4608–4686)**:
  - Beim Rendern von `#my-runway-indicator` (ab Zeile 4608) prüfen, ob `S.cfg.show_runway_banner === '0'`:
    ```javascript
      const indicatorEl = document.getElementById('my-runway-indicator');
      if (indicatorEl) {
        if (S.cfg.show_runway_banner === '0') {
          indicatorEl.style.display = 'none';
          indicatorEl.innerHTML = '';
        } else {
          indicatorEl.style.display = '';
          const tier = getGamificationTier(currentBalance);
          let description = tier.description;
          // ... bestehender Code für indicatorEl.className und indicatorEl.innerHTML unverändert ...
        }
      }
    ```
  - Beim Rendern von `#my-group-pool` (ab Zeile 4672) prüfen, ob `S.cfg.show_team_pool === '0'`:
    ```javascript
      const poolEl = document.getElementById('my-group-pool');
      if (poolEl) {
        if (S.cfg.show_team_pool === '0') {
          poolEl.style.display = 'none';
          poolEl.innerHTML = '';
        } else {
          poolEl.style.display = '';
          poolEl.innerHTML = `
            <div class="group-pool-text" style="width: 100%; text-align: center; font-size: var(--text-lg); font-weight: 800; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp1);">
              <div style="display: flex; align-items: center; justify-content: center; gap: var(--sp2);">
                <i data-lucide="piggy-bank" style="color: var(--pri); width: 20px; height: 20px;"></i>
                <span>${t('timeline.team_kasse')}</span>
                <strong style="font-size: var(--text-lg); color: ${teamKasse >= 0 ? '#007a5a' : 'var(--err)'}">${fmtE(teamKasse)}</strong>
              </div>
              <div style="font-size: var(--text-xs); color: var(--txm); font-weight: 500; max-width: 440px; line-height: 1.4; margin-top: var(--sp1);">
                ${t('timeline.team_kasse_desc')}
              </div>
            </div>
          `;
        }
      }
    ```
- **2. `renderSettings()` in `app.js` (ca. Zeile 5310 nach `showDeadline`)**:
  ```javascript
    const showDeadline = document.getElementById('disp-show-cancel-deadline');
    if (showDeadline) showDeadline.checked = S.cfg.show_cancel_deadline !== '0';
    const showTeamPool = document.getElementById('disp-show-team-pool');
    if (showTeamPool) showTeamPool.checked = S.cfg.show_team_pool !== '0';
    const showRunwayBanner = document.getElementById('disp-show-runway-banner');
    if (showRunwayBanner) showRunwayBanner.checked = S.cfg.show_runway_banner !== '0';
  ```
- **3. `saveSettings()` in `app.js` (ca. Zeile 5403 & Zeile 5417)**:
  - Im `settings`-Payload-Objekt nach `show_cancel_deadline` ergänzen:
    ```javascript
        show_cancel_deadline: document.getElementById('disp-show-cancel-deadline')?.checked ? '1' : '0',
        show_team_pool: document.getElementById('disp-show-team-pool')?.checked ? '1' : '0',
        show_runway_banner: document.getElementById('disp-show-runway-banner')?.checked ? '1' : '0',
    ```
  - Nach `if (typeof renderSessions === 'function') renderSessions();` (ca. Zeile 5416) ergänzen:
    ```javascript
        if (typeof renderMyTransactions === 'function') renderMyTransactions();
    ```

---

## 4. Test- & Verifikationsplan

### 4.1 Automatisierte Tests (Playwright)
- **Gezielter Testbefehl** (auszuführen im Ordner `tests/`):
  ```bash
  npx playwright test ui-flows.spec.js --project=chromium
  ```
- **Erweiterter E2E-Test**:
  - Datei: `tests/ui-flows.spec.js`
  - Anker: Test `'19 — Bilanz: Team-Kasse Card, Runway Indicator and CSV Export'` (Zeilen ca. 986–1011).
  - Was getestet wird:
    1. Standardmäßig sind `#my-group-pool` und `#my-runway-indicator` in `#view-my-transactions` sichtbar (bestehende Assertions).
    2. Da Alice in Test 19 als Admin-Spielerin eingeloggt ist (`admin: 1`), navigiere über `await page.evaluate(() => showView('settings'));` zu `#view-settings`.
    3. Deaktiviere `#disp-show-team-pool` per Klick auf das zugehörige `.switch`-Label (`await page.locator('label.switch:has(#disp-show-team-pool)').click();`) und warte auf den gespeicherten State (`await expect(page.locator('#settings-save-pill')).toHaveClass(/show/);`).
    4. Navigiere zurück zu `#view-my-transactions` (`await page.evaluate(() => showView('my-transactions'));`) und prüfe: `#my-group-pool` ist `not.toBeVisible()`, `#my-runway-indicator` ist `toBeVisible()`.
    5. Navigiere zu `#view-settings`, deaktiviere zusätzlich `#disp-show-runway-banner` (`await page.locator('label.switch:has(#disp-show-runway-banner)').click();`), wechsle zu `#view-my-transactions` und prüfe: sowohl `#my-group-pool` als auch `#my-runway-indicator` sind `not.toBeVisible()`.
    6. Aktiviere beide Toggles in `#view-settings` wieder und prüfe in `#view-my-transactions`, dass beide Banner wieder `toBeVisible()` sind.

### 4.2 Abschluss-Checkliste für den Builder
- [ ] Alle Akzeptanzkriterien aus Abschnitt 1 erfüllt?
- [ ] `php -l api.php` ohne Syntaxfehler?
- [ ] Keine `console.log` oder `var_dump` Debug-Reste im Code?
- [ ] Alle neuen UI-Texte über `t('key')` bzw. `data-i18n` in allen 6 Sprachen vorhanden?
- [ ] Gezielter Playwright-Test (`npx playwright test ui-flows.spec.js --project=chromium`) läuft grün ohne Console-Errors?
- [ ] Spec-Status oben auf `done` gesetzt und Datei von `specs/backlog/001-balance-banner-toggles.md` nach `specs/done/001-balance-banner-toggles.md` verschoben?
