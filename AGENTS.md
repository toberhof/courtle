# AGENTS.md — Courtle

Vanilla PHP 8.4 + SQLite backend (`api.php`) and vanilla JS SPA (`app.js`/`index.html`), served via Docker/Apache. No build step or bundler; edits are live on refresh.

## Quick commands

- Dev (live reload, port 8080): `mkdir -p data && docker compose -f docker-compose.dev.yml up --build`
- Production compose (`docker-compose.yml`, port 8012) is release-only; don't edit it for dev.
- PHP lint: `php -l api.php`
- Build-number check: `./scripts/sync-build.sh --check`
- Increment build numbers: `./scripts/sync-build.sh` (or `./scripts/sync-build.sh <N>`)
- E2E tests (auto-builds test container, port 8081): `cd tests && npm install && npx playwright test`
- Targeted tests: `npx playwright test ui-flows.spec.js --project=chromium`, `npx playwright test --project=chromium`, `npx playwright test ios-pwa.spec.js --project=ios`

Full E2E suite takes 6–7 min across 5 browsers; prefer targeted runs. Tests run sequentially with one worker because SQLite locks.

## Architecture

- `api.php`: all REST routes, auth (`X-Token`), DB init/migrations. DB path from `COURTLE_DB_PATH` (default `/var/www/courtle_data/courtle.db`).
- `index.html`: single page, all modals inline. `app.js`: global state `S`, rendering, booking. `i18n.js`: translations. `style.css`: themes/components.
- `sw.js`: fetch-through service worker, no cache.
- Migrations live in `init_db()`/`migrate_v*()`; `schema_version` in `config`. Add new migrations in both `db()` and `handle_system_init()`.
- State changes: never mutate `S` directly in handlers; call API → `loadState()` → render helpers.
- Admin endpoints require an admin token.

## Conventions that differ from defaults

- i18n: all user-facing text via `t(key, fallback)`; add keys for `de`, `en`, `es`, `it`, `fr`, `pt` in `i18n.js`.
- SQL: prepared statements with `?` bindings only.
- Build numbers: before any push, all 6 locations (`CLIENT_BUILD`, `// built:X`, `<!--built:X-->`, `style.css?build`, `i18n.js?build`, `app.js?build`, footer `(build X)`) must match. Use `sync-build.sh`. Never push a new `<!--built:X-->` without updating `CLIENT_BUILD` (causes update loop). If a mismatch was deployed, jump to an unused number (`+5`/`+10`), don't reuse.
- Git push only on explicit user request.
- This repo is source of truth for core files (`api.php`, `app.js`, `style.css`, `index.html`, `courtle.conf`, `Dockerfile`); downstream variants pull from here.
- UI wording: use "Court"/"Court-Kosten", not "Platz"/"Spielfeld". Navigation vs. action buttons differ; see `agents/styleguide.md`.
- Role guides: read the relevant file in `agents/` before changes (`backend.md`, `frontend.md`, `pwa_ux.md`, `styleguide.md`, `testing.md`).

## Testing quirks

- Playwright `webServer` rebuilds the test container; `reuseExistingServer` is true locally, false in CI.
- Test DB resets via `POST /api.php/test-reset` (only allowed when `DB_PATH` contains "test").
- Test DB uses `PRAGMA journal_mode=TRUNCATE`; production/dev uses WAL.
- DB path for tests: `./tests/courtle_test_data`, env `COURTLE_DB_PATH=/var/www/courtle_data/test-courtle.db`.

## Spec-driven workflow

- Specs: `specs/backlog/NNN-slug.md` → implement on `feat/NNN-slug`, verify with Playwright, move to `specs/done/`, commit (no push).
- Skills: `.agents/skills/spec-architect`, `.agents/skills/spec-builder`, `.opencode/skills/e2e-test`.

## Generated/ignored

- `data/`, `vendor/`, `.opencode/`, `tests/courtle_test_data/`, and `docker-compose.dev.yml`/`docker-compose.test.yml` are gitignored. `vendor/` (Lucide, fonts) is populated during Docker build.