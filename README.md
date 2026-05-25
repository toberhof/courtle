<div align="center">
  <img src="courtle-icon-512.png" width="80" alt="Courtle logo">
  <h1>Courtle</h1>
  <p><em>Open-source PWA for recreational sports groups. Book. Play. Split. — End the group chat chaos.</em></p>
</div>

---

**Courtle** is an open-source PWA designed to eliminate the administrative friction of private sports groups. It automates match schedules, cost splitting, and waitlists for all court-based sports — including Padel, Pickleball, Tennis, Badminton & Squash.

## The Problem

Running a recurring sports group with friends is surprisingly complex:

- Chat threads to figure out who's playing each week
- Manual tracking of who brought guests (and who pays for them)
- Spreadsheets or mental math for session costs and balances
- No good way to handle waitlists when sessions fill up
- Everyone asking "what do I owe?"

## The Solution

Courtle replaces the chaos with a clean, self-hosted web app. Players identify themselves with a 4-digit PIN, book into available slots, bring guests, and get automatically billed per session. The admin gets a dashboard for managing players, courts, expenses, and settlements.

## How It Works (Zero to Play in 2 Minutes)

1. **Spin Up Your Instance:** Set up Courtle via Docker in seconds. The first launch guides you through a 2-minute setup to define your Team Name and create the first admin player.
2. **Share the Link:** Send the web address to your friends. No App Store downloads, passwords, or emails required. Players pick their name, choose a 4-digit PIN, and are ready to go.
3. **Schedule & Play:** Create sessions, book slots, manage waitlists, and split court costs instantly and transparently with one click.

## Features

- **Premium Sports Theme & Visual Courts** — dynamic glassmorphic session cards, digital calendar ticket badges, and interactive, physical-themed sports turf layouts when court grouping is enabled
- **Continuous Financial Timeline & Gamified Runway** — a seamless, continuous financial timeline with a prominent "HEUTE" (Today) anchor, a unified cash flow calculation displaying remaining balances, and a beautifully gamified runway card with 5 safety levels (Critical, Ready, Starter, Pro, Legend) and rewarding animations
- **Unified Premium Button Design** — cohesive, glassmorphic, and highly interactive translucent buttons across all player modals, administrative cards, planning views, and waitlist tables, with dynamic scale-down active transitions and hover glows
- **Multiple recurring schedules** — configure independent series with custom weekdays, times, courts, and prices; toggle each series individually or disable all globally
- **Per-session price override** — set a custom price per slot for any session; falls back to series price or global default
- **Recurring scheduling** — configure weekdays, time, and number of future sessions; dates auto-generate from active series
- **Multi-court support** — configurable number of courts, each with 4 slots
- **Guest system** — each player brings up to 2 guests; costs bill to the main player
- **Waitlist** — players join when full; auto-promoted when slots free up
- **Balance tracking** — deposits and session charges per player, running balance visible
- **Session charging** — admin bills all participants in one click; charges recorded as transactions
- **Yearly fee tracking** — optional annual fee per player, tracked alongside session charges
- **Expense tracking** — admin logs court rental invoices
- **Court Mixer (Team Randomizer)** — Fair matchmaking and court distribution; shuffle booked players into balanced teams using a smart randomizing algorithm
- **Dark/light theme** — follows system preference (no local storage persistence)
- **Privacy mode** — hide player names from non-admin session view
- **Display settings** — toggle court grouping, customize team name, select currency
- **Zero-Config PIN Login & PWA** — 4-digit PIN per player; no passwords, emails, or app store downloads required. Home-screen installable in seconds.
- **Admin roles** — granular admin privileges for managing the group
- **Session history log** — full audit trail of bookings, cancellations, and waitlist promotions

## PWA

- **Mobile-first** — optimized for iOS Safari, touch-friendly UI
- **Home screen installable** — manifest served dynamically from `/api.php/manifest` (reflects team name)
- **Install banner** — unified banner for Android (`beforeinstallprompt`) and iOS (Share button guide)
- **Service worker** — basic fetch-through service worker for offline-capable install
- **Apple touch icon** — 180×180 PNG included
- **Theme color** and viewport locked (no pinch-zoom)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | PHP 8.2, SQLite via PDO |
| Frontend | Vanilla JavaScript (no framework) |
| Styling | CSS custom properties, dark/light themes |
| Icons | [Lucide](https://lucide.dev) (vendored, no CDN at runtime) |
| Fonts | DM Sans + Instrument Serif (vendored, no CDN at runtime) |
| Deployment | Docker (`php:8.2-apache`), docker-compose |
| License | EUPL-1.2 |

No build step. No package manager. Edit a file and refresh the browser.

## Quick Start (Docker)

For external users or quick local runs:

```bash
git clone https://github.com/your-org/courtle.git
cd courtle
docker compose up -d
```

Open **http://localhost:8012** (or the port configured in your `docker-compose.yml`).

**First run** creates an empty database automatically. You'll be guided through the initial setup (team name + first admin player).

### Local Development

For active development with live reload:

```bash
mkdir -p data
docker compose -f docker-compose.dev.yml up --build
```

Open **http://localhost:8080**. Source files are bind-mounted — changes take effect immediately without rebuilding. The `vendor/` directory (lucide.js, fonts) is preserved via a named volume.

---

## Production Deployment & Coolify

For advanced deployment instructions, persistence details, configuration options, and step-by-step guides for platforms like **Coolify**, check out our **[Deployment Guide (DEPLOY.md)](DEPLOY.md)**.


## Manual Setup

PHP 8.2+ with `pdo_sqlite` and `sqlite3` extensions required.

```bash
php -S 0.0.0.0:8080
```

Or point any web server (Apache, nginx, Caddy) at the project root.

## Project Structure

```
├── api.php                 # REST API — all endpoints + DB migrations + auth
├── app.js                  # SPA frontend — state, rendering, booking logic
├── index.html              # Single HTML page, all modals inline
├── style.css               # CSS variables, dark/light themes, responsive layout
├── sw.js                   # Service worker (fetch-through, no-cache)
├── courtle-icon.svg        # SVG icon (favicon, manifest)
├── courtle-icon-180.png    # Apple touch icon
├── courtle-icon-192.png    # PWA icon (192×192)
├── courtle-icon-512.png    # PWA icon (512×512)
├── Dockerfile              # php:8.2-apache + SQLite + vendored fonts & icons
├── docker-compose.yml      # Production/release only
├── docker-compose.dev.yml  # Local development with live reload
├── docker-compose.test.yml # Test environment
├── docker-entrypoint.sh    # Entrypoint: sets permissions, starts Apache
├── courtle.conf            # Apache remoteip config for reverse proxies
├── AGENTS.md               # Developer reference (internal)
├── .gitignore
├── .dockerignore
├── LICENSE                 # EUPL-1.2
└── data/                   # SQLite database (gitignored, created at runtime)
    └── courtle.db
```

### Key Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth` | — | Login (PIN) |
| DELETE | `/auth` | Token | Logout |
| GET | `/players` | — | Player list with balances |
| POST | `/players` | Admin | Create player |
| PUT | `/players/:id` | Token | Update player |
| DELETE | `/players/:id` | Admin | Delete player |
| GET | `/sessions` | — | All sessions with courts & waitlists |
| PUT | `/sessions/:date` | Admin | Update session (date, time, note, price, courts, etc.) |
| POST | `/sessions/:date/book` | Token | Book a slot (race-condition safe) |
| POST | `/sessions/:date/leave` | Token | Leave session, promote waitlist |
| POST | `/sessions/:date/join-waitlist` | Token | Join waitlist |
| GET | `/series` | Admin | List all recurring series |
| POST | `/series` | Admin | Create a new series |
| PUT | `/series/:id` | Admin | Update a series |
| DELETE | `/series/:id` | Admin | Delete a series |
| POST | `/charge` | Admin | Charge session, create transactions |
| GET | `/config` | — | App configuration |
| PUT | `/config` | Admin | Save configuration |
| GET | `/manifest` | — | PWA manifest (dynamic, uses team_name) |
| GET | `/session-history` | Admin | Audit log |
| GET | `/export` | Admin | Full database export (JSON) |
| POST | `/import` | Admin | Full database import |
| POST | `/system/init` | Admin | Run DB migrations |

### Docker Details

- Base image: `php:8.2-apache`
- `mod_rewrite` enabled for API routing
- `mod_remoteip` enabled for reverse proxy support
- SQLite + PDO compiled in
- Fonts and Lucide JS downloaded at build time (no CDN at runtime)
- Container runs as `www-data`
- No external config file required — all settings are in-app
- Entrypoint (`docker-entrypoint.sh`) ensures database directory permissions
- **Development**: `docker-compose.dev.yml` bind-mounts source files for live reload; `vendor/` preserved via named volume
- **Production**: `docker-compose.yml` is for releases only — use `docker-compose.dev.yml` for local development

### App-Level Configuration

Access the **System Einstellungen** view (admin only) to configure:

- **Global series toggle** — enable/disable all recurring series at once
- **Display settings** — team name, court grouping, privacy mode, currency (dropdown with European/American currencies)
- **Standard price per slot** — fallback default for sessions without a series or session-specific price

Access the **Session Serien** view (admin only) to manage recurring schedules:

- **Multiple series** — each with custom name, weekdays, occurrences, times, courts, optional price override, optional location
- **Individual toggle** — enable/disable each series independently
- **Edit & delete** — full configuration via modal dialog; delete with confirmation

Access the **Sessionplaner** (admin only) to manage individual sessions:

- **Session selector** — dropdown to switch between upcoming and past sessions, with navigation buttons
- **Per-session price** — override the series or global price for any specific session
- **Session details** — edit date (moves session to new date, preserving bookings), time, location, notes
- **New session** — create ad-hoc sessions outside of any series
- **Slot management** — assign/remove players per court and slot
- **Waitlist** — manage waitlist entries, promote to available slots
- **Billing** — preview and execute session charges

## License

[EUPL-1.2](./LICENSE) — copyleft license. If you modify and distribute or communicate this work to the public (including as a remote network service), you must make your modified source code available under the same licence.
