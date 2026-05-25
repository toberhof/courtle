# Courtle Development & Architecture Guide

Welcome! This document covers the internal structure, development environment, manual setup procedures, and application configuration details of **Courtle**.

---

## 1. Project Structure

Courtle follows a direct, vanilla philosophy: no complex build steps, compilers, or bundlers. The files edited in your environment take effect in the browser immediately.

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
    └── courtle.db          # SQLite main database
```

---

## 2. Local Development Workflow (Docker)

To run the local development environment with bind-mounted files for live reload:

```bash
mkdir -p data
docker compose -f docker-compose.dev.yml up --build
```

Open **http://localhost:8080** in your browser.
* **Live Reload:** Since the source files are bind-mounted into `/var/www/html` in the dev container, any changes to `app.js`, `style.css`, or `index.html` take effect immediately upon refreshing the page.
* **Volume Persistence:** A named volume (`courtle_vendor`) preserves the `vendor/` directory (fonts and Lucide JS) from the Dockerfile build step.

---

## 3. Manual Setup (Without Docker)

If you prefer to run Courtle natively without Docker, ensure you have **PHP 8.2+** with the `pdo_sqlite` and `sqlite3` extensions installed.

1. Create a `data/` directory in the project root:
   ```bash
   mkdir data
   ```
2. Start the built-in PHP development server:
   ```bash
   php -S 0.0.0.0:8080
   ```
3. Or configure a full web server (Apache, nginx, Caddy) pointing at the repository root. Ensure write permissions are granted to the webserver user (`www-data` or equivalent) for the `data/` directory.

---

## 4. Docker Container Architecture

* **Base Image:** `php:8.2-apache`
* **Apache Modules:** `mod_rewrite` is enabled to support clean API routing; `mod_remoteip` is enabled to preserve client IP addresses when behind reverse proxies.
* **Local Assets:** Fonts and Lucide JS are downloaded and vendored during the Docker build stage. **No external CDNs** are contacted by the client at runtime, maximizing privacy and offline reliability.
* **Permissions:** The entrypoint script (`docker-entrypoint.sh`) ensures that the database storage path is writable by `www-data` before dropping privileges.

---

## 5. In-App Configuration Details

Courtle is fully configured through its administrative graphical interfaces. No environment file configuration is needed.

### System Einstellungen (System Settings)
Accessible to administrators only, this panel controls:
* **Global Series Toggle:** Globally enable or disable all recurring session schedules.
* **Display Settings:** Customize the Team Name, toggle Court Grouping, choose the default currency symbol, and configure regional date/time formats.
* **Privacy Mode:** When active, hides player names from non-logged-in visitors, displaying slots simply as "Gebucht" (Booked).
* **Standard Price:** The default fallback price per slot if no overrides are defined.

### Session Serien (Session Series)
Define repeating session schedules:
* Create independent series with custom names, times, active weekdays, court counts, location notes, and prices.
* Toggle individual series on or off dynamically.

### Sessionplaner (Session Planner)
Allows precise administrative control over individual sessions:
* Move session dates, adjust times, and write specific comments.
* Override slot pricing for individual sessions.
* Manually assign, swap, or remove players in the interactive court grid.
* Settle up and bill all players with a single click.
