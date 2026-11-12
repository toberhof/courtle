# Spec / User Story: 003 — Player Cards auf kompakte Bubbles reduzieren & PIN/Icon im Bearbeiten-Modal integrieren

- **ID**: `003`
- **Slug**: `compact-player-cards`
- **Branch**: `feat/003-compact-player-cards`
- **Status**: `done`
- **Ziel-Modell (Builder)**: `flash`
- **Erstellt am**: 2026-11-12

---

## 1. User Story & Ziel

**Als** Admin
**möchte ich** in der Spieler-Verwaltung (`#view-players` → Tab `Verwaltung`) extrem kompakte Player-Cards („Bubbles“) sehen, die ohne ausklappbaren Drawer auskommen und nur noch je einen textlosen Icon-Button für „Bearbeiten“ und „Löschen/Deaktivieren“ besitzen,
**damit** ich eine aufgeräumte, schnelle Übersicht habe und Details wie PIN- und Icon-Änderungen zentral und sauber gebündelt im Bearbeiten-Modal (`#mo-player`) durchführen kann.

### Akzeptanzkriterien (AC)
- [x] **AC 1: Kompakte Player-Card (Bubble)**:
  - In `renderPlayers()` wird jede aktive Spieler-Card (`.pc`) als flache, kompakte Zeile/Bubble ohne Drawer gerendert (`.pc-row`).
  - Es gibt keinen Aufklapp-Pfeil (`.pc-chev`) und keinen Drawer (`.pc-drawer`) mehr.
  - Das Element zeigt von links nach rechts:
    1. Avatar `.av.pc-av` mit aktuellem Icon
    2. Name `.pc-name` (inkl. `.badge.bg-pri` bei Admins) und optionalem Kontakt (`.pc-meta`)
    3. Rechte Aktions-Gruppe `.pc-right`:
       - Button **Bearbeiten**: Nur Icon `.btn.btn-icon-sm.btn-sec` mit Lucide `pencil`, `title="Bearbeiten"` und `aria-label="Bearbeiten"`. Klick öffnet `openEditPlayer(p.id)`.
       - Button **Löschen/Deaktivieren**: Nur Icon `.btn.btn-icon-sm.btn-dan` mit Lucide `trash-2`, `title="Deaktivieren"` und `aria-label="Deaktivieren"`. Klick öffnet `deletePlayer(p.id)`.
    - Klick auf Avatar oder Name/Info öffnet ebenfalls direkt `openEditPlayer(p.id)`.
- [x] **AC 2: Icon-Auswahl im Bearbeiten-Modal (`#mo-player`)**:
  - Im Modal `#mo-player` wird über dem Namen eine Icon-Sektion angezeigt:
    - Vorschau des aktuellen Avatars (`.av.pc-av` mit 44px).
    - Button „Icon wählen“ (`.btn.btn-sec.btn-sm` mit Lucide `smile`).
    - Klick auf Avatar oder Button öffnet den Icon-Picker (`#mo-emoji`) mit erhöhtem `z-index`, sodass er modal über `#mo-player` liegt.
    - Nach Auswahl im Icon-Picker aktualisiert sich die Vorschau in `#mo-player` und wird beim Klick auf „Speichern“ gespeichert.
- [x] **AC 3: PIN-Vergabe/-Änderung im Bearbeiten-Modal (`#mo-player`)**:
  - `#mo-player` enthält ein PIN-Eingabefeld (`#p-pin`, `type="password"`, `inputmode="numeric"`, `maxlength="4"`, `placeholder="••••"`).
  - Bei bestehenden Spielern (`openEditPlayer`): Hinweistext `#p-pin-hint`: *„4-stellige Zahlen-PIN. Leer lassen, um bestehende PIN beizubehalten.“*
  - Bei neuen Spielern (`openAddPlayer`): Hinweistext `#p-pin-hint`: *„4-stellige Zahlen-PIN (optional)“*.
  - `savePlayer()` validiert bei Eingabe eine exakt 4-stellige Zahl (`/^\d{4}$/`). Wenn valide, wird `pin` im API-Payload mitgesendet.
- [x] **AC 4: Speichern & API-Aufruf**:
  - `savePlayer()` sendet bei `editPid`: `PUT /players/:id` mit `{ name, contact, admin, emoji, pin }` (wobei `pin` nur gesendet wird, wenn ausgefüllt, und `emoji` das ausgewählte Icon ist).
  - `savePlayer()` sendet bei Neuerstellung: `POST /players` mit `{ name, contact, admin, emoji, pin }`.
  - In `api.php`: `handle_player_create()` übernimmt optional übergebenes `emoji`.
- [x] **AC 5: Vollständige i18n-Übersetzungen**: Alle neuen und angepassten UI-Texte sind in allen 6 Sprachen (`de`, `en`, `es`, `it`, `fr`, `pt`) in `i18n.js` vorhanden.
- [x] **AC 6: E2E-Tests aktualisieren & erweitern**:
  - `tests/ui-flows.spec.js` Tests 03 und 04 anpassen (kein Klick auf `.pc-row` zum Drawer-Öffnen mehr nötig, Buttons direkt auf der Card klickbar).
  - Test für PIN- und Icon-Änderung im `#mo-player` Modal ergänzen.

---

## 2. Betroffene Dateien & Rollen-Guides

Vor der Umsetzung müssen vom Builder folgende Rollen-Dateien gelesen werden:
- [x] `agents/frontend.md` (für `app.js` / `index.html`)
- [x] `agents/styleguide.md` (für `.btn-icon-sm`, `.pc`, Barrierefreiheit via `title` / `aria-label`)
- [x] `agents/backend.md` (für `api.php` `handle_player_create()`)
- [x] `agents/testing.md` (für Playwright-E2E-Tests)

**Zu ändernde Dateien:**
- `app.js` (Funktionen `renderPlayers()`, `openEditPlayer()`, `openAddPlayer()`, `savePlayer()`, `selectPlayerIcon()`)
- `index.html` (`#mo-player` Sektion, `#mo-emoji` Z-Index/DOM-Reihenfolge)
- `style.css` (`#mo-emoji` `z-index: 1050`, `.pc-right` Button-Abstände)
- `api.php` (`handle_player_create()` Zeilen ca. 949–960)
- `i18n.js` (Keys für PIN-Hints und Icon-Button in allen 6 Sprachen)
- `tests/ui-flows.spec.js` (Tests 03 und 04 anpassen, neuen Test ergänzen)

---

## 3. Konkreter Bauplan (Zero-Ambiguity)

### 3.1 Backend (`api.php`)

In `api.php` `handle_player_create()` (ca. Zeilen 948–960) sicherstellen, dass auch beim Anlegen ein optionales `emoji` in die DB geschrieben wird:

```php
    $emoji = isset($b['emoji']) && !empty($b['emoji']) ? (string)$b['emoji'] : null;

    if ($count == 0) {
        $id = gid();
        $pin_hash = isset($b['pin']) && $b['pin'] ? password_hash($b['pin'], PASSWORD_DEFAULT) : null;
        $stmt = $db->prepare("INSERT INTO players (id,name,contact,pin_hash,created_at,admin,emoji) VALUES (?,?,?,?,?,1,?)");
        $stmt->execute([$id, $b['name'], $b['contact'] ?? null, $pin_hash, date('c'), $emoji]);
        json_out(['id' => $id, 'name' => $b['name'], 'admin' => true], 201);
    } else {
        require_auth(true);
        $id = gid();
        $pin_hash = isset($b['pin']) && $b['pin'] ? password_hash($b['pin'], PASSWORD_DEFAULT) : null;
        $admin_flag = isset($b['admin']) && $b['admin'] ? 1 : 0;
        $stmt = $db->prepare("INSERT INTO players (id,name,contact,pin_hash,created_at,admin,emoji) VALUES (?,?,?,?,?,?,?)");
        $stmt->execute([$id, $b['name'], $b['contact'] ?? null, $pin_hash, date('c'), $admin_flag, $emoji]);
        json_out(['id' => $id, 'name' => $b['name']], 201);
    }
```

---

### 3.2 HTML (`index.html`)

In `index.html` das Modal `#mo-player` (ca. Zeilen 1182–1200) um die Icon-Vorschau und das PIN-Feld erweitern:

```html
<!-- Add/Edit Player -->
<div class="mo" id="mo-player">
  <div class="mo-box">
    <div class="mo-head"><h2 class="mo-title" id="mo-player-title" data-i18n="players.add_title">Spieler</h2><button class="mo-close btn-icon" onclick="closeMo('mo-player')"><i data-lucide="x"></i></button></div>
    
    <!-- Icon / Avatar Selector -->
    <div class="fg" style="margin-bottom:var(--sp4)">
      <label class="fl" data-i18n="players.icon">Icon</label>
      <div class="flex items-c g3">
        <div class="av pc-av" id="p-avatar-preview" style="cursor:pointer;width:44px;height:44px" onclick="openIconPickerForEditPlayer()" title="Icon wählen">
          <i data-lucide="user" id="p-avatar-preview-icon" style="width:20px;height:20px"></i>
        </div>
        <button type="button" class="btn btn-sec btn-sm" onclick="openIconPickerForEditPlayer()">
          <i data-lucide="smile"></i> <span data-i18n="players.change_icon">Icon wählen</span>
        </button>
      </div>
    </div>

    <div class="fg"><label class="fl" data-i18n="players.name">Name</label><input type="text" id="p-name" class="fi" data-i18n-placeholder="players.name_placeholder" placeholder="Max Mustermann"></div>
    <div class="fg"><label class="fl" data-i18n="players.contact">Kontakt (optional)</label><input type="text" id="p-contact" class="fi" data-i18n-placeholder="players.contact_placeholder" placeholder="max@mail.de"></div>
    
    <!-- PIN Field -->
    <div class="fg" id="p-pin-wrap">
      <label class="fl" data-i18n="players.pin">PIN (4-stellig)</label>
      <input type="password" id="p-pin" class="fi" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="new-password">
      <span class="settings-desc" id="p-pin-hint" data-i18n="players.pin_edit_hint" style="margin-top:4px">4-stellige Zahlen-PIN. Leer lassen, um bestehende PIN beizubehalten.</span>
    </div>

    <div class="fg" id="p-admin-wrap" style="display:none; margin-top:var(--sp2);">
      <label class="fl" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="p-admin" style="width:16px; height:16px;"> 
        <span data-i18n="players.admin_cb">Dieser Spieler bekommt Admin-Rechte</span>
      </label>
    </div>

    <div class="mo-foot">
      <button class="btn btn-sec" onclick="closeMo('mo-player')" data-i18n="players.cancel">Abbrechen</button>
      <button class="btn btn-pri" onclick="savePlayer()" id="save-p-btn" data-i18n="players.save_edit">Speichern</button>
    </div>
  </div>
</div>
```

---

### 3.3 CSS (`style.css`)

In `style.css` (ca. Zeile 1170 oder bei Modals):
Damit `#mo-emoji` modal sauber über `#mo-player` aufpoppen kann:
```css
#mo-emoji {
  z-index: 1050;
}
```

Für die kompakte Player-Bubble:
```css
.pc-row-clickable {
  cursor: pointer;
}
.pc-right .btn-icon-sm {
  width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
  border-radius: var(--r-md);
}
```

---

### 3.4 Lokalisierung (`i18n.js`)

In allen 6 Sprachen in `i18n.js` folgende Keys ergänzen / vereinheitlichen:

#### 1. Deutsch (`de`):
```javascript
      "players.icon": "Icon",
      "players.change_icon": "Icon wählen",
      "players.pin": "PIN (4-stellig)",
      "players.pin_edit_hint": "4-stellige Zahlen-PIN. Leer lassen, um bestehende PIN beizubehalten.",
      "players.pin_add_hint": "4-stellige Zahlen-PIN (optional)",
```

#### 2. Englisch (`en`):
```javascript
      "players.icon": "Icon",
      "players.change_icon": "Choose icon",
      "players.pin": "PIN (4 digits)",
      "players.pin_edit_hint": "4-digit numeric PIN. Leave blank to keep current PIN.",
      "players.pin_add_hint": "4-digit numeric PIN (optional)",
```

#### 3. Spanisch (`es`):
```javascript
      "players.icon": "Icono",
      "players.change_icon": "Elegir icono",
      "players.pin": "PIN (4 dígitos)",
      "players.pin_edit_hint": "PIN numérico de 4 dígitos. Dejar en blanco para mantener el actual.",
      "players.pin_add_hint": "PIN numérico de 4 dígitos (opcional)",
```

#### 4. Italienisch (`it`):
```javascript
      "players.icon": "Icona",
      "players.change_icon": "Scegli icona",
      "players.pin": "PIN (4 cifre)",
      "players.pin_edit_hint": "PIN numerico a 4 cifre. Lascia vuoto per mantenere quello attuale.",
      "players.pin_add_hint": "PIN numerico a 4 cifre (opzionale)",
```

#### 5. Französisch (`fr`):
```javascript
      "players.icon": "Icône",
      "players.change_icon": "Choisir l'icône",
      "players.pin": "Code PIN (4 chiffres)",
      "players.pin_edit_hint": "Code PIN à 4 chiffres. Laisser vide pour conserver le code actuel.",
      "players.pin_add_hint": "Code PIN à 4 chiffres (facultatif)",
```

#### 6. Portugiesisch (`pt`):
```javascript
      "players.icon": "Ícone",
      "players.change_icon": "Escolher ícone",
      "players.pin": "PIN (4 dígitos)",
      "players.pin_edit_hint": "PIN numérico de 4 dígitos. Deixe em branco para manter o atual.",
      "players.pin_add_hint": "PIN numérico de 4 dígitos (opcional)",
```

---

### 3.5 Frontend-Logik (`app.js`)

#### 1. Variable für temporäres Icon im Modal
Oben bei den Player-Variablen (ca. Zeile 4130) definieren:
```javascript
let editPlayerEmoji = null;
```

#### 2. `renderPlayers()` (ca. Zeilen 3937–3969)
Ersetze das bisherige Mapping der aktiven Spieler durch die kompakte Bubble ohne Drawer und ohne Chevron:

```javascript
  let html = activePlayers.map(p => {
    const adminBadge = p.admin ? ` <span class="badge bg-pri" style="font-size:10px;padding:1px 6px">${t('misc.admin')}</span>` : '';

    return `<div class="pc">
      <div class="pc-row">
        <div class="av pc-av pc-row-clickable" onclick="openEditPlayer('${p.id}')" title="${esc(t('players.edit'))}">
          <i data-lucide="${playerIcon(p)}" style="width:18px;height:18px"></i>
        </div>
        <div class="pc-info pc-row-clickable" onclick="openEditPlayer('${p.id}')">
          <div class="pc-name">${esc(p.name)}${adminBadge}</div>
          ${p.contact ? `<div class="pc-meta">${esc(p.contact)}</div>` : ''}
        </div>
        <div class="pc-right">
          <button class="btn btn-icon-sm btn-sec" onclick="openEditPlayer('${p.id}')" type="button" title="${esc(t('players.edit'))}" aria-label="${esc(t('players.edit'))}"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          <button class="btn btn-icon-sm btn-dan" onclick="deletePlayer('${p.id}')" type="button" title="${esc(t('players.deactivate'))}" aria-label="${esc(t('players.deactivate'))}"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
```

#### 3. `openEditPlayer(id)` & `openAddPlayer()` anpassen (ca. Zeilen 4132–4150)
```javascript
function updateEditPlayerAvatarPreview(emojiName) {
  editPlayerEmoji = emojiName || null;
  const iconEl = document.getElementById('p-avatar-preview-icon');
  if (iconEl) {
    iconEl.setAttribute('data-lucide', emojiName || 'user');
    if (window.lucide) lucide.createIcons();
  }
}

function openEditPlayer(id) {
  const p = S.players.find(x => x.id === id); if (!p) return;
  editPid = id;
  document.getElementById('mo-player-title').textContent = t('players.edit');
  document.getElementById('save-p-btn').textContent = t('misc.save');
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-contact').value = p.contact || '';
  document.getElementById('p-pin').value = '';
  document.getElementById('p-pin-hint').textContent = t('players.pin_edit_hint');

  updateEditPlayerAvatarPreview(p.emoji || 'user');

  const adminWrap = document.getElementById('p-admin-wrap');
  if (adminWrap) {
    adminWrap.style.display = isAdmin ? 'block' : 'none';
    document.getElementById('p-admin').checked = !!p.admin;
  }

  openMo('mo-player');
}

function openAddPlayer() {
  editPid = null;
  document.getElementById('mo-player-title').textContent = t('players.add_title');
  document.getElementById('save-p-btn').textContent = t('players.save_add');
  document.getElementById('p-name').value = '';
  document.getElementById('p-contact').value = '';
  document.getElementById('p-pin').value = '';
  document.getElementById('p-pin-hint').textContent = t('players.pin_add_hint');

  updateEditPlayerAvatarPreview('user');

  const adminWrap = document.getElementById('p-admin-wrap');
  if (adminWrap) {
    adminWrap.style.display = isAdmin ? 'block' : 'none';
    document.getElementById('p-admin').checked = false;
  }

  openMo('mo-player');
}

function openIconPickerForEditPlayer() {
  const current = editPlayerEmoji || (editPid ? (S.players.find(x => x.id === editPid)?.emoji || '') : '');
  const sub = document.getElementById('emoji-subtitle');
  if (sub) sub.textContent = t('icon.subtitle');
  const grid = document.getElementById('emoji-grid');
  if (grid) {
    grid.innerHTML = ICONS.map(name => `<button type="button" class="${name === current ? 'sel' : ''}" onclick="selectIconForEditPlayer('${name}')"><i data-lucide="${name}" style="width:20px;height:20px"></i></button>`).join('');
  }
  openMo('mo-emoji');
  if (window.lucide) lucide.createIcons();
}

function selectIconForEditPlayer(name) {
  updateEditPlayerAvatarPreview(name);
  closeMo('mo-emoji');
}
```

#### 4. `savePlayer()` anpassen (ca. Zeilen 4200–4220)
```javascript
async function savePlayer() {
  const name = document.getElementById('p-name').value.trim();
  const contact = document.getElementById('p-contact').value.trim();
  const pin = document.getElementById('p-pin').value.trim();
  
  const adminCb = document.getElementById('p-admin');
  const makeAdmin = adminCb ? adminCb.checked : false;

  if (!name) { showToast(t('players.name_required', 'Bitte Namen eingeben.')); return; }
  if (pin && (!/^\d{4}$/.test(pin))) {
    showToast(t('toast.pin_must_4'));
    return;
  }

  const payload = {
    name,
    contact,
    admin: makeAdmin,
    emoji: editPlayerEmoji || null
  };
  if (pin) {
    payload.pin = pin;
  }

  try {
    if (editPid) {
      await apiFetch('PUT', '/players/' + editPid, payload);
      showToast(t('toast.player_updated'));
    } else {
      await apiFetch('POST', '/players', payload);
      showToast(t('toast.player_added'));
    }
    await loadState();
    closeMo('mo-player');
    renderAll();
  } catch(e) {
    showToast(e.message || t('toast.error'));
  }
}
```

---

## 4. Test- & Verifikationsplan

### 4.1 Playwright Test-Anpassungen (`tests/ui-flows.spec.js`)

In `tests/ui-flows.spec.js`:

1. **Test 03 (`Player edit via UI`)**:
   - Da kein Drawer mehr existiert, entfällt `await pc.locator('.pc-row').click();`.
   - Der Edit-Button wird direkt aufgerufen:
     ```javascript
     const pc = page.locator('.pc').filter({ hasText: 'Alice' });
     await expect(pc).toBeVisible();
     await pc.locator('button.btn-sec').first().click();
     await expect(page.locator('#mo-player')).toHaveClass(/open/);
     ```

2. **Test 04 (`Player deactivate + reactivate via UI`)**:
   - Ebenfalls `await pc.locator('.pc-row').click();` entfernen.
   - Delete-Button direkt anklicken:
     ```javascript
     const pc = page.locator('.pc').filter({ hasText: 'Alice' });
     await expect(pc).toBeVisible();
     await pc.locator('button.btn-dan').first().click();
     ```

3. **Neuer Test (`Player edit modal: change PIN and choose icon`)**:
   - Öffnet Edit-Modal für einen Spieler.
   - Ändert PIN auf `'5678'`.
   - Öffnet Icon-Picker über `#p-avatar-preview` oder „Icon wählen“, wählt `rocket`.
   - Speichert ab.
   - Verifiziert, dass die Player-Card das neue Icon (`rocket`) anzeigt und der Login mit der neuen PIN funktioniert.

### 4.2 Test-Ausführung
```bash
npx playwright test ui-flows.spec.js --project=chromium
```

---

## 5. Build-Synchronisation

Vor dem Commit müssen alle 6 Build-Nummern synchronisiert werden:
```bash
./scripts/sync-build.sh
```
