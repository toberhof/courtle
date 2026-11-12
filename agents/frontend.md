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

## 4. Local Development Workflow & Build Synchronization

* **No Build Step**: Direct, fully editable vanilla files. Changes take effect immediately upon saving.
* **Docker Dev Environment**: Use `docker compose -f docker-compose.dev.yml up --build` for local testing. The dev compose file bind-mounts the entire project directory into the container for live reload (no rebuild needed). A named volume preserves the `vendor/` directory (lucide.js, fonts) from the Dockerfile build step.
* **Production Docker**: `docker-compose.yml` is for releases only — do not modify it for development purposes.
* **Build Cache & Invalidation (`./scripts/sync-build.sh`)**:
  * Before any Git push, all **6 build locations** must be synchronized to the exact same integer value (use `./scripts/sync-build.sh --check` to verify, or `./scripts/sync-build.sh` to increment atomically):
    1. `const CLIENT_BUILD = X;` (and `// built:X`) at the top of `app.js`
    2. `<!--built:X-->` HTML comment in `index.html` (which PHP reads for `X-Courtle-Build` and `server_build`)
    3. `style.css?build=X` in `index.html`
    4. `i18n.js?build=X` in `index.html`
    5. `app.js?build=X` in `index.html`
    6. `(build X)` footer label in `index.html`
  * **Edge & Proxy Caching Warning**: Never push a new `<!--built:X-->` without simultaneously updating `CLIENT_BUILD = X` in `app.js`. If `CLIENT_BUILD` lags behind, Cloudflare and browsers will cache the JS file under that build query while the API reports a higher build number, resulting in an infinite "Update available" loop.
  * **Cache Busting Recovery**: If a build was deployed with a mismatch and Cloudflare/browsers cached `app.js?build=X` with the old `CLIENT_BUILD`, do NOT redeploy with the same `X`. Instead, jump to an unused build number (e.g. `./scripts/sync-build.sh $((X + 5))`) across all 6 locations so edge proxies request a fresh URL.

---

## 5. Session Planner UI Structure & Centralized Billing

### Modern Session Planner (`view-admin-plan`)
The session planner focuses purely on session organization (dates, times, courts, player bookings, waitlist). The `planDate` global variable tracks the currently selected session (`planPrev()`, `planNext()`, `planGoToUpcoming()`, `planGoToDate(date)`).

1. **Interactive Date Strip & Top Bar** (`#session-selector-box`):
   - Two-row `.plan-nav-box`:
     - Top bar (`.plan-top-bar`) with section label (`planner.select_session_label`) and right-aligned quick controls: "Nächste" button (`#plan-jump-upcoming-btn` jumping directly to the next upcoming session), date picker dialog (`#plan-date-picker`), and `+ Neue Session` (`.btn-ok.btn-sm`).
     - Full-width horizontal scrollable `.plan-strip` below so mobile and desktop both get 100% viewport width for scrolling through `.plan-chip` cards.
   - `.plan-chip` cards display weekday + month, large day number, session start time (`.pc-time` to distinguish multiple sessions on the same day), and live status badge (`✓` charged, `€` awaiting billing, `filled/total`, or `✕` cancelled), with `data-date` and `data-id` attributes.
   - Clickable "HEUTE" visual anchor marking the boundary between past and future sessions.
2. **Unified Session Header & Integrated Details Drawer** (`#admin-plan-header-dynamic`):
   - Session title with series indicator (`planner.from_series`) and live `.status-pill` badge (Offen, Wartet auf Abrechnung, Abgerechnet, Abgesagt).
   - Inline metadata chips (`.plan-meta-item` with `display: inline-flex`): Date, time span, slot price, occupancy, and conditional location/note chips (shown only when non-empty).
   - Focused action bar: Context-aware action button ("Zur Abrechnung" / "In Abrechnung ansehen" / "Reaktivieren") and "Details bearbeiten" drawer toggle (`#plan-edit-toggle-btn`).
   - **Integrated Edit Drawer** (`#session-details-box.plan-edit-drawer`): Folds directly into the bottom of the header card with a responsive multi-column `.plan-edit-grid`, debounced auto-save with inline checkmark feedback (`.save-indicator`), and automatic locking when a session has already been charged.
3. **Section Tabs** (`#plan-tabs`):
   - **Belegung** (`#plan-card-slots` & `#plan-waitlist-admin`): Visual court cards with slot chips, court names, `+ Court` button, and waitlist management directly underneath.
   - **Verlauf** (`#plan-history`): Audit activity log loaded on demand.

### Centralized Admin Billing (`view-billing`)
Dedicated financial management view for settling played sessions:
- **Badge Counter**: Appears dynamically on the "Abrechnung" navigation menu item whenever completed, uncharged sessions require settlement.
- **"Offen" Tab**: Clean worklist of all past uncharged sessions with selectable checkboxes, total calculations, and batch-settlement button.
- **Two-Step Settlement Modal** (`#mo-billing`):
  1. *Review step*: Shows participants per session with individual "Direkt bezahlt" checkboxes (for cash payments without deducting account balances).
  2. *Confirmation step*: Aggregated balance delta table (balance before → debit → direct payment → balance after) with negative balance warnings.
- **"Abgerechnet" Tab & Reverts**: Lists settled sessions with ability to revert settlements (`DELETE /charge/{id}`) to restore player balances atomically.

---

## 6. Dashboard Session Cards, Internationalization & Financial Timeline

### Dashboard Session Cards & Turf Court Structure
The public/player dashboard displays upcoming sessions as stylized sports-themed "match tickets" (`.sc`) with glassmorphism:
1. **Card Container** (`.sc`): Uses backdrop-filter blur, CSS custom properties, and translation lifts (`translateY(-3px)`) on hover. The *next upcoming session* (`.sc.next-up`) features a glowing border accent (`--pri`).
2. **Digital Ticket Header** (`.sc-head-ticket`):
   - **Calendar Badge** (`.cal-ticket`): Compact simulated ticket showing bold uppercase weekday (`.cal-wkdy`), large day number (`.cal-day`), and muted month abbreviation (`.cal-month`).
   - **Ticket Details** (`.ticket-details`): Renders session title, custom time spans, location info, and admin organizer notes.
3. **Grouped Court Container** (`.court-container`):
   - Active when "Courts gruppieren" (`display_court_grouping`) is enabled.
   - **Court Layout**: Distinct court cards containing a court header (`.court-header`) showing court numbers/names and a `map-pin` icon.
   - **Glassmorphic Slot Chips** (`.admin-slot`): Backdrop-blurred floating buttons distinguishing vacant slots (dashed borders, hover plus icons), filled slots (avatar chips with semi-bold player names), and personal reservations (`.admin-slot.me` with primary borders).

### Internationalization (`i18n.js`)
* All user-facing text, labels, badges, titles, and descriptions must strictly use `t(key, fallback)` or `data-i18n`. Never hardcode natural language strings in `app.js` or `index.html`.
* Always define translations for all 6 supported languages (`de`, `en`, `es`, `it`, `fr`, `pt`) inside `I18N` in `i18n.js`.
* **Dynamic Content Interpolation**: Use placeholder replacements on the returned translation string (e.g., `t('runway.text_uncovered').replace('{covered}', covered).replace('{total}', total)`).

### Personal Financial Timeline & Gamified Runway (`view-my-transactions`)
1. **Team-Kasse Pot Card** (`#my-group-pool`): Displays the centralized team-level pool calculation (`totalDeposits - totalExpenses`) using a `piggy-bank` icon, localized across all 6 languages.
2. **Gamified Safety Runway Card** (`#my-runway-indicator`):
   - Calculates future runway based on current player balance and upcoming booked sessions across 5 tiers:
     - `tier_0` (Critical): Insufficient balance to cover current bookings. Orange warning colors, alert icon, and progress bar showing `covered / total` bookings.
     - `tier_1` (Ready): Safe standby (no future bookings, positive balance).
     - `tier_2` (Starter): All booked sessions covered.
     - `tier_3` (Pro): All booked sessions covered plus 1–3 additional sessions safe.
     - `tier_4` (Legend): All booked sessions covered plus 4+ additional sessions safe. Golden glowing card with micro-animations (`runway-float`, `runway-pulse-rot`).
3. **Continuous Timeline Card**:
   - Displays a vertical dotted chronological flow.
   - **HEUTE (Today)**: Prominent, solid colored anchor showing current absolute balance.
   - **Future entries (above HEUTE)**: Booked upcoming sessions in ascending order, displaying slot cost (`–X.XX €`), forward-running balance (`Saldo danach: Y.YY €`), and a pill badge (`Covered` green checkmark or `Uncovered` orange warning).
   - **Past transactions (below HEUTE)**: Historical payments (positive, green, `plus` icon) and billed session deductions (negative, muted gray) in descending order with pagination.
   - **Timeline Row Spacing**: `.timeline-row` uses `min-height: 100px` (up from 68px) to give entries breathing room. **Do not use `padding` on `.timeline-row`** — the connector line (`::before` on `.timeline-node`) uses `top: 0; bottom: 0` and would not span into the padding area. To adjust spacing, change `min-height` instead.
   - **CSV Download**: Discreet, text-only link at the bottom of the timeline list to download the player's personal transaction history.

---

## 7. First-Setup Overlay & State Loading

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
