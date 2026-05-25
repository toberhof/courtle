# Courtle REST API Reference

This document provides a comprehensive reference for the Courtle REST API. All endpoints are hosted under `api.php`.

## Authentication & Authorization

Courtle uses a custom database-driven token authentication mechanism:
* **Session Tokens:** Generated upon a successful login (`POST /auth`) using cryptographically secure random bytes (`bin2hex(random_bytes(16))`).
* **Header:** Authenticated requests must include the token in the custom HTTP header:
  ```http
  X-Token: <your_session_token>
  ```
* **Privileges:** Certain administrative endpoints require the token to belong to an admin player.

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth` | — | Login (PIN verification) |
| DELETE | `/auth` | Token | Logout (invalidates current session token) |
| GET | `/players` | — | Player list with names, balances, and contact details |
| POST | `/players` | Admin | Create a new player |
| PUT | `/players/:id` | Token | Update player details (PIN, contact, etc.) |
| DELETE | `/players/:id` | Admin | Delete a player |
| GET | `/sessions` | — | All sessions with active courts, slot allocations, and waitlists |
| PUT | `/sessions/:date` | Admin | Update session configuration (date, times, courts, custom price, etc.) |
| POST | `/sessions/:date/book` | Token | Book an available slot (atomic & race-condition safe) |
| POST | `/sessions/:date/leave` | Token | Leave a booked slot and auto-promote waitlisted players |
| POST | `/sessions/:date/join-waitlist` | Token | Join the waitlist for a full session |
| GET | `/series` | Admin | List all recurring session series |
| POST | `/series` | Admin | Create a new recurring series |
| PUT | `/series/:id` | Admin | Update a recurring series |
| DELETE | `/series/:id` | Admin | Delete a recurring series |
| POST | `/charge` | Admin | Charge participants for a session and record financial transactions |
| GET | `/config` | — | Public app configuration (team name, grouping toggles, currencies, etc.) |
| PUT | `/config` | Admin | Save system-wide and display configuration settings |
| GET | `/manifest` | — | Dynamically generated PWA web manifest reflecting current team name |
| GET | `/session-history` | Admin | Session audit log (bookings, leaves, promotions) |
| GET | `/export` | Admin | Full database export as a secure JSON backup |
| POST | `/import` | Admin | Full database restore from a JSON backup (overwrites active database) |
| POST | `/system/init` | Admin | Manually trigger SQLite database migrations |
