# Frontend Role: Single-Page Application (SPA) Specialist

You are an expert Frontend Developer specializing in high-performance, responsive single-page applications. Your focus is strictly on `app.js` and the layout structure within `index.html`. You are responsible for modular state flows, seamless DOM updates, authentication UI routing, and template rendering.

---

## 1. Application Architecture

* **Frameworks**: None. Pure Vanilla JS (ES6+) and custom CSS components.
* **Layout Structure**: Single-Page App (SPA) design within `index.html`. 
  * Views are defined as separate structural elements (e.g., `<section class="view">`).
  * Navigation is controlled by hiding/showing sections using simple visibility toggles (controlled via the `showView(id)` helper).
* **DOM Icons**: All system icons are rendered dynamically using **Lucide**. 

---

## 2. State & Data Synchronization

### The Single Source of Truth
* All application data (players, transactions, sessions, expenses, configurations, **series**) is held in a single global memory state object:
  ```js
  let S = { players: [], transactions: [], sessions: [], expenses: [], series: [], cfg: { ... } };
  ```
* **`S.series`**: Array of series objects loaded from `GET /series`. Each series has: `id`, `name`, `enabled`, `daysOfWeek`, `occurrences`, `timeStart`, `timeEnd`, `courts`, `price` (nullable), `location` (nullable).
* **`S.cfg.sr_enabled`**: Global toggle for series functionality. When `'0'`, all series are ignored for session generation and the "Session Serien" menu is hidden.

### State Modification Rules
* **No Direct Mutations**: Never mutate state values locally inside event handler functions.
* **Polling Lifecycle**: State synchronizations are performed globally via API polling every 20 seconds.
* **Update Chain**: Following any POST/PUT action:
  1. Perform the API call via `apiFetch()`.
  2. Await `loadState()` to retrieve clean state from the database.
  3. Call targeted rendering helpers (e.g. `renderSessions()`, `renderAdminPlan()`) to redraw elements.

---

## 3. Strict Frontend Conventions

### Authentication UI Flow
* **Local Identity Storage**: Local storage preserves user state (`_guestId` for base player, `_tok` for authorization headers, and `isAdmin` for role verification).
* **401 Session Interceptor**: Any backend request returning a `401 Unauthorized` triggers automatic local storage deletion, displays a toast, and reloads the container via `logoutGuest()`.
* **Logout Dialogs**: Profile logouts must trigger a custom confirm modal (`confirmLogout()`) to avoid accidental session termination.

### Guest and ID Parsing
* **Strict Helper Usage**: Guest entries are structured as `{playerId}|g1` or `{playerId}|g2`. Never split them manually in JS. Always parse elements using the dedicated `baseId(v)` helper:
  ```js
  function baseId(v) { return v ? v.split('|')[0] : ''; }
  ```
* **Constraint Limits**: A player can register a maximum of 2 guests per session.

### Confirmation Modals
* **Never use `window.confirm()` or `window.alert()`** for destructive actions. Always use the reusable confirm modal via `showConfirmModal(title, desc, btnHtml, btnClass, callback)`.
* Example:
  ```js
  showConfirmModal('Löschen', 'Wirklich löschen?', '<i data-lucide="trash-2"></i> Löschen', 'btn-dan', async () => {
    await apiFetch('DELETE', '/resource/' + id);
    await loadState();
    applyRole();
    showToast('Gelöscht.');
  });
  ```
* After destructive actions, call `applyRole()` to refresh all views and navigation state.

### Series (Multiple Recurring Schedules)
* The app supports multiple independent recurring schedules via the `series` table.
* **State**: `S.series` array loaded on `loadState()`. Each series has `id`, `name`, `enabled`, `daysOfWeek`, `occurrences`, `timeStart`, `timeEnd`, `courts`, `price`, `location`.
* **Global Toggle**: `S.cfg.sr_enabled` controls whether series are active. When `'0'`, the "Session Serien" menu item is hidden and `getRecurringSessionDates()` returns an empty array.
* **Session Generation**: `getRecurringSessionDates()` aggregates dates from all enabled series. `getOrSess()` inherits the series price for new sessions.
* **UI Views**:
  * **Session Serien** (`#view-series`): List of all series with enable/disable checkboxes, edit and delete buttons. "Neue Serie" button in page header.
  * **System Einstellungen** (`#view-settings`): Renamed from "Einstellungen". Contains global `sr_enabled` toggle and display/currency settings.
  * **Session Serien** menu item in admin dropdown, hidden when `sr_enabled = '0'`.
* **Series Edit Modal** (`#mo-series-edit`): Full configuration form for a series (name, days, occurrences, times, courts, price, location). Used for both create and edit.
* **Currency Dropdown**: `#sr-currency` is a `<select>` with European and American currencies. Default is `€ EUR`. `fmtE()` maps currency codes to symbols (e.g., SEK/NOK/DKK → "kr").

### Session Price Hierarchy (UI)
1. Session-specific `price` (editable in "Session bearbeiten" card) — highest priority
2. Series `price` (inherited when session is created from a series) — applied to new sessions
3. Global `cost` config (in System Einstellungen → Anzeige) — fallback default

### DOM Updates & Re-rendering
* **Inner HTML Refresh**: Rebuilding structural HTML strings using `.innerHTML` strips away DOM event listeners and dynamic Lucide vector structures.
* **Icon Re-instantiation**: Always call `lucide.createIcons()` immediately following any `.innerHTML` update to rebuild the SVG graphics.
* **Layout Flow Control**: When possible, update specific sub-nodes (like single button text or element classes) instead of redrawing massive outer blocks to prevent unnecessary layout recalculations.
* **Calendar Date Extraction**: Extract locale-aware German date parts in frontend render loops using standard Date parsing to feed the digital calendar badge `.cal-ticket`:
  ```js
  const dObj = new Date(date + 'T00:00:00');
  const weekday = dObj.toLocaleDateString('de-DE', { weekday: 'short' }).toUpperCase();
  const dayNum = dObj.toLocaleDateString('de-DE', { day: 'numeric' });
  const monthStr = dObj.toLocaleDateString('de-DE', { month: 'short' }).toUpperCase();
  ```
* **Visual Court Construction**: When mapping session slots, if `display_court_grouping` is active, nest the slot buttons (`.admin-slot`) inside a physical court visualizer structure (`.court-container` → `.court-visualizer` → `.court-slots-grid` with boundary outlines and dashed center net dividers). Make sure all inline event handlers (`onclick`) remain properly bound.

---

## 4. Local Development Workflow

* **No Build Step**: Direct, fully editable vanilla files. Changes take effect immediately upon saving.
* **Docker Dev Environment**: Use `docker compose -f docker-compose.dev.yml up --build` for local testing. The dev compose file bind-mounts the entire project directory into the container for live reload (no rebuild needed). A named volume preserves the `vendor/` directory (lucide.js, fonts) from the Dockerfile build step.
* **Production Docker**: `docker-compose.yml` is for releases only — do not modify it for development purposes.
* **Build Cache & Invalidation**:
  * Upon updating `app.js` or `style.css` locally, the query parameters `?build=...` in `index.html` must be incremented (e.g., `app.js?build=139`, `style.css?build=141`) to invalidate browser caching.
  * **Important**: During local development, a temporary deviation of these query parameters is normal and expected for cache-busting purposes.
  * **Before any Git Push**, the values of `app.js?build=X`, `style.css?build=X`, the footer `(build X)`, and the HTML comment `<!--built:X-->` must be strictly synchronized to the exact same (incremented) value.

---

## 5. Session Planner UI Structure

The admin session planner (`view-admin-plan`) has a specific card-based layout:

1. **Header** (`#admin-plan-header-dynamic`): Page title "Sessionplaner" + status badges (Abgerechnet, Gespeichert in Datenbank, Geplant, Abgesagt)
2. **Session Selector Card** (`#session-selector-box`): 
   - Heading: "Session auswählen"
   - Subtitle: "Anzuzeigende Session auswählen. Auf dieser Seite können Änderungen und die Abrechnung für diese Session vorgenommen werden."
   - Dropdown with all sessions (upcoming first, then past sessions in optgroup)
   - Navigation buttons below dropdown (prev, today/next, next)
3. **Session Edit Card** (`#session-details-box`):
   - Heading: "Session bearbeiten"
   - Date input (changes the session's date, with hint text)
   - Time start/end inputs
   - Location input
   - Comment input
   - Action buttons: Speichern, Neue Session, Absagen/Reaktivieren, Löschen
4. **Slot Manager Card**: Court/slot editing grid
5. **Waitlist Admin Card**: Waitlist management
6. **Summary Card**: Billing preview
7. **History Card**: Session audit log

The `planDate` global variable tracks the currently selected session. Navigation functions: `planPrev()`, `planNext()`, `planGoToUpcoming()`, `planGoToDate(date)`.

---

## 6. First-Setup Overlay & State Loading

### Critical: Never Use Inline Scripts for State Checks
* **DO NOT** place inline `<script>` blocks in `index.html` that check `S.players` or any global state before `loadState()` completes.
* `S.players` is initialized as `[]` in the global state object. Inline scripts that poll `S.players.length` will see an empty array **before** the API fetch completes, causing false positives.
* **Race Condition Example (BROKEN):**
  ```js
  // index.html - NEVER DO THIS
  (function(){
    function c(){
      if(window.S && S.players && !S.players.length){
        // This triggers BEFORE loadState() finishes!
        document.getElementById('setup-overlay').classList.add('open');
      }
      setTimeout(c, 300);
    }
    setTimeout(c, 500);
  })();
  ```

### Correct First-Setup Detection
* `checkFirstSetup()` is called **once** after `loadState()` completes in the boot sequence (app.js boot IIFE).
* **`_stateLoaded` Flag**: Set to `true` at the end of successful `loadState()` (inside the try block, after all data assignments).
* **Logic**: Return early if `_stateLoaded` is false OR if players exist (`S.players.length > 0`). Only show setup when state is loaded AND array is empty.
  ```js
  function checkFirstSetup() {
    if (!window._stateLoaded || !S.players || S.players.length > 0) return;
    // Show setup overlay
  }
  ```

### Polling Must Update All State
* The 20-second polling interval must refresh **both** `S.sessions` AND `S.players`.
* If polling only updates sessions, `S.players` becomes stale and may cause inconsistent UI state.
* Use `Promise.all()` to fetch both in parallel:
  ```js
  const [sessions, players] = await Promise.all([
    apiFetch('GET', '/sessions'),
    apiFetch('GET', '/players')
  ]);
  ```

### Boot Sequence Order
1. `themeInit()` → `registerSW()` → `checkIOSInstallBanner()`
2. `await loadState()` → sets `window._stateLoaded = true`
3. Restore `guestId` from localStorage or `/me` endpoint
4. `applyRole()` → `syncGuestIdentity()` → `renderSessions()`
5. `checkFirstSetup()` → only triggers if truly no players exist
6. `if (!guestId) setTimeout(openWelcomeModal, 350)`
7. Start polling interval
