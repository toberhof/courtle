<div align="center">
  <img src="courtle-icon-512.png" width="80" alt="Courtle logo">
  <h1>Courtle</h1>
  <p><em>Open-source PWA for recreational sports groups. Book. Play. Split. — End the group chat chaos.</em></p>
</div>

---

**Courtle** is an open-source Progressive Web App (PWA) designed to eliminate the administrative friction of private sports groups. It automates match schedules, cost splitting, and waitlists for all court-based sports — including Padel, Pickleball, Tennis, Badminton & Squash.

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

## Core Features

- **Premium Sports Theme & Visual Courts** — dynamic glassmorphic session cards, digital calendar ticket badges, and interactive, physical-themed sports turf layouts when court grouping is enabled.
- **Continuous Financial Timeline & Gamified Runway** — a seamless, continuous financial timeline with a prominent "HEUTE" (Today) anchor, a unified cash flow calculation displaying remaining balances, and a beautifully gamified runway card with 5 safety levels (Critical, Ready, Starter, Pro, Legend) and rewarding animations.
- **Unified Premium Button Design** — cohesive, glassmorphic, and highly interactive translucent buttons across all player modals, administrative cards, planning views, and waitlist tables, with dynamic scale-down active transitions and hover glows.
- **Full Internationalization (i18n)** — completely localized in 6 languages: German (`de`), English (`en`), Spanish (`es`), Italian (`it`), French (`fr`), and Portuguese (`pt`), with automated language detection and in-app switching.
- **Waitlist & Guest Automations** — players join a waitlist when sessions are full and are auto-promoted when slots free up. Players can easily bring guests billed directly to their account.
- **Centralized Team Fund (Team-Kasse)** — automatically calculates the overall team fund pool based on player deposits minus real court rental expenses (`totalDeposits - totalExpenses`), displayed as a localized piggy-bank status card.
- **Flexible Scheduling & Price Overrides** — configure multiple recurring series with custom weekdays, court counts, and times, or override slot prices on any individual session with one click.
- **Zero-Config PIN Login & PWA** — 4-digit PIN per player; no passwords, emails, or app store downloads required. Home-screen installable in seconds.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | PHP 8.2, SQLite via PDO |
| **Frontend** | Vanilla JavaScript (no frameworks) |
| **Styling** | Vanilla CSS, HSL/OKLCH themes |
| **Icons** | [Lucide](https://lucide.dev) (locally vendored) |
| **Fonts** | DM Sans (locally vendored) |
| **Deployment** | Docker (`php:8.2-apache`), docker-compose |
| **License** | EUPL-1.2 |

---

## Quick Start (Docker)

To start a local or production instance in seconds:

```bash
git clone https://github.com/toberhof/courtle.git
cd courtle
docker compose up -d
```

Open **http://localhost:8012** (or the port configured in your `docker-compose.yml`) to perform the initial setup.

---

## Documentation

For advanced details, developer workflows, and architecture, refer to our dedicated guides:

* **[Production Deployment & Coolify Guide (DEPLOY.md)](DEPLOY.md)** — Persistence, configuration, reverse proxy setup, and deploying to hosting platforms.
* **[Development & Architecture Guide (docs/DEVELOPMENT.md)](docs/DEVELOPMENT.md)** — Native manual setup without Docker, development workflow, and internal folder structure.
* **[REST API Reference (docs/API.md)](docs/API.md)** — Detailed list of all REST API endpoints and token-based authentication.

---

## License

This project is licensed under the **[EUPL-1.2](./LICENSE)** (European Union Public Licence) — a copyleft license compatible with AGPL/GPL. If you modify and distribute or communicate this work to the public (including as a remote network service), you must make your modified source code available under the same licence.
