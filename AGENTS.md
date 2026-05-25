# AGENTS.md — Courtle Entry Point

Welcome to Courtle! This is the central developer reference for the project. To provide AI assistants (agents) with an optimal and focused context, detailed development guidelines have been split into modular role descriptions.

---

## 1. Directory Structure

```
/
├── agents/                 # Modular role instructions for AI agents
│   ├── backend.md          # SQLite, PDO & REST API guidelines
│   ├── frontend.md         # app.js & Vanilla SPA frontend guidelines
│   ├── pwa_ux.md           # PWA manifest, service worker, swipe & CSS guidelines
│   └── testing.md          # Playwright E2E & Visual Regression guidelines
├── api.php                 # REST API — all endpoints + DB migrations + auth
├── app.js                  # SPA Frontend — state, rendering, booking logic
├── index.html              # Only HTML page (SPA), all modals inline
├── style.css               # CSS variables, dark/light theme, components
├── sw.js                   # Service worker (fetch-through, no-cache)
├── courtle-icon.svg        # SVG icon (favicon, manifest)
├── courtle-icon-180.png    # Apple touch icon
├── courtle-icon-192.png    # PWA icon (192×192)
├── courtle-icon-512.png    # PWA icon (512×512)
├── Dockerfile              # php:8.2-apache + SQLite + vendored assets
├── docker-compose.yml      # Release/production only — do not modify for development
├── docker-compose.dev.yml  # Local development with live reload bind mounts
├── docker-compose.test.yml # Test environment
├── docker-entrypoint.sh    # Entrypoint: set permissions, start Apache
├── courtle.conf            # Apache RemoteIP configuration for reverse proxies
├── AGENTS.md               # Developer reference & entry point (this file)
├── README.md
├── LICENSE                 # EUPL-1.2
├── .gitignore
├── .dockerignore
└── data/                   # SQLite database (gitignored, persisted via volume)
    └── courtle.db          # Main database file (WAL mode)
```

---

## 2. Modular Developer Roles

Before making changes to the codebase, please read the corresponding role file in the [agents/](file:///Users/thomas/Developer/Projects/courtle/agents/) directory to ensure exact adherence to conventions:

* **Database & API Development**: Read [agents/backend.md](file:///Users/thomas/Developer/Projects/courtle/agents/backend.md)
* **Frontend SPA & JavaScript Development**: Read [agents/frontend.md](file:///Users/thomas/Developer/Projects/courtle/agents/frontend.md)
* **PWA, CSS & Mobile Gestures Development**: Read [agents/pwa_ux.md](file:///Users/thomas/Developer/Projects/courtle/agents/pwa_ux.md)
* **Integration & E2E Testing**: Read [agents/testing.md](file:///Users/thomas/Developer/Projects/courtle/agents/testing.md)

---

## 3. Local Development Workflow

* **No Build Step**: Direct, fully editable vanilla files. Changes take effect in the browser immediately upon saving.
* **Docker Dev Environment**: Use `docker compose -f docker-compose.dev.yml up --build` for local testing. The dev compose file bind-mounts the entire project directory into the container for live reload (no rebuild needed). A named volume preserves the `vendor/` directory (lucide.js, fonts) from the Dockerfile build step.
* **Production Docker**: `docker-compose.yml` is for releases only — do not modify it for development purposes.
* **Git Push**: Git pushes must **only** be performed upon explicit user request (never automatically).
* **Build Cache & Invalidation**:
  * Upon updating `app.js` or `style.css` locally, the query parameters `?build=...` in `index.html` must be incremented (e.g., `app.js?build=139`, `style.css?build=141`) to invalidate browser caching.
  * **Important**: During local development, a temporary deviation of these query parameters is normal and expected for cache-busting purposes.
  * **Before any Git Push**, the values of `app.js?build=X`, `style.css?build=X`, the footer `(build X)`, and the HTML comment `<!--built:X-->` must be strictly synchronized to the exact same (incremented) value.

---

## 4. Session Planner UI Structure

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

## 5. Dashboard Session Cards & Turf Court Structure

The public/player dashboard displays upcoming sessions as stylized sports-themed "match tickets" (`.sc`) with rich glassmorphism:

1. **Card Container** (`.sc`): Uses backdrop-filter blur, CSS custom properties, and standard translation lifts (`translateY(-3px)`) on hover. If it represents the *next upcoming session* (`.sc.next-up`), it features a glowing border accent (`--pri`).
2. **Digital Ticket Header** (`.sc-head-ticket`):
   - **Calendar Badge** (`.cal-ticket`): A compact, simulated ticket showing a bold uppercase weekday (`.cal-wkdy`), large day number (`.cal-day`), and a muted month abbreviation (`.cal-month`).
   - **Ticket Details** (`.ticket-details`): Renders session title, custom time spans, location info, and admin organizer notes.
3. **Grouped Court Container** (`.court-container`):
   - Active when "Spielfelder gruppieren" (`display_court_grouping`) is enabled.
   - **Court Layout**: Organized into distinct court cards containing a court header (`.court-header`) showing court numbers and a `map-pin` icon.
   - **Glassmorphic Slot Chips** (`.admin-slot`): Backdrop-blurred floating buttons. Distinguishes vacant slots (dashed borders, hover plus icons), filled slots (avatar chips with semi-bold player names), and personal reservations (`.admin-slot.me` with golden/primary borders).

---

## 6. Internationalization (i18n)

All user-facing text, labels, badges, titles, and descriptions must strictly use the custom `t(key, fallback)` function for localization. Do not hardcode natural language strings directly in `app.js` or `index.html`.
* **Adding New Features**: When introducing new features, views, dynamic cards, or timeline entries, always define the translations for all supported languages (`de`, `en`, `es`, `it`, `fr`, `pt`) within the `I18N` catalog in `i18n.js`.
* **Dynamic Content Interpolation**: For dynamic values inside localized strings (such as dynamic counts or balances), use string replacements on the returned translation string (e.g. `t('runway.text_uncovered').replace('{covered}', covered).replace('{total}', total)`).

---

## 7. Personal Financial Timeline & Gamified Runway

The personal financial timeline ("Bilanz" view) features a specific, continuous layout and dynamic cashflow calculations:

1. **Team-Kasse Pot Card** (`#my-group-pool`): Displays the centralized team-level pool calculation (`totalDeposits - totalExpenses`) using a `piggy-bank` icon, with a description explaining it represents all player deposits minus real court booking expenses. Fully localized across all 6 languages.
2. **Gamified Safety Runway Card** (`#my-runway-indicator`):
   - Calculates future runway based on current player balance and upcoming booked sessions.
   - Evaluates player safety into 5 tiers:
     - `tier_0` (Critical): Insufficient balance to cover current bookings. Orange warning colors, alert icon, and a progress bar showing covered / total bookings.
     - `tier_1` (Ready): Safe standby (no future bookings, positive balance).
     - `tier_2` (Starter): All booked sessions covered.
     - `tier_3` (Pro): All booked sessions covered plus 1-3 additional sessions safe.
     - `tier_4` (Legend): All booked sessions covered plus 4+ additional sessions safe. Golden glowing card with rich micro-animations (`runway-float`, `runway-pulse-rot`).
3. **Continuous Timeline Card**:
   - Displays a vertical dotted chronological flow.
   - **HEUTE (Today)**: A prominent, solid colored anchor showing the current absolute balance.
   - **Future entries (above HEUTE)**: Booked upcoming sessions in ascending order, displaying slot cost (`–X.XX €`), remaining forward-running balance after booking (`Saldo danach: Y.YY €`), and a pill badge indicating either `Covered` (green checkmark) or `Uncovered` (orange warning).
   - **Past transactions (below HEUTE)**: All historical payments (positive, green, with a `plus` icon) and billed session deductions (negative, muted gray) in descending order, with full pagination support.
   - Timeline row spacing: `.timeline-row` uses `min-height: 100px` (up from 68px) to give entries breathing room. Do not use `padding` on `.timeline-row` — the connector line (`::before` on `.timeline-node`) uses `top: 0; bottom: 0` and would not span into the padding area. To adjust spacing, change `min-height` instead.
  - **CSV Download**: A discreet, text-only link positioned at the very bottom of the timeline list to download the player's personal transaction history.

---

## 8. Unified Premium Button Design

All user-facing action buttons (including administrative views, planning panels, waitlist tables, player profile panels, and overlays/modals) must strictly adhere to the unified glassmorphic button styling system:

1. **Button Classes & Sizes**:
   - `.btn`: Standard layout, padded using HSL/OKLCH curated background highlights. Defaults to `font-weight: 700`.
   - `.btn-sm`: Compact actions (e.g. session card bookings and waitlist actions). Uses `min-height: 34px`, `font-size: var(--text-xs)`, and `padding: var(--sp1) var(--sp4)`.
   - `.btn-xs`: Extremely compact elements (e.g., table slot tag modifiers). Uses `padding: 2px var(--sp2)` and `font-size: var(--text-xs)`.
2. **Interactive States**:
   - Click/Active: Features a responsive scale reduction (`transform: scale(.95)`) to feel alive and physical.
   - Transitions: Always use the centralized `var(--tr)` timing variable for all color, shadow, background, and transform modifications.
3. **Glassmorphic Variants**:
   - **Primary (`.btn-pri`)**: Solid primary color background featuring an elegant translation lift (`translateY(-1px)`) and a soft primary glow-shadow on hover.
   - **Secondary (`.btn-sec`)**: Elegant translucent backdrop blur highlight (`oklch(from var(--tx) l c h / .04)`) shifting to primary emerald green upon hover.
   - **Danger (`.btn-dan`)**: Soft crimson warning tint shifting to full crimson on hover.
   - **Success (`.btn-ok`)**: Soft emerald success tint shifting to forest green on hover.
   - **Gold (`.btn-gld`)**: Soft golden tint shifting to deep amber on hover.
