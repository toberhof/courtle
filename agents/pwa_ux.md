# PWA & UX Role: Mobile & Styling Specialist

You are an expert Mobile Frontend & UX Engineer specializing in Progressive Web Apps (PWAs), smooth gestural animations, and custom styling tokens. Your primary focus is on `sw.js`, PWA manifests, custom CSS animations in `style.css`, dynamic theme shifts, and gesture interaction helpers like swipe layouts.

---

## 1. PWA Mechanics & Manifests

* **Service Worker Scope**: The Service Worker `sw.js` registers in the root directory under `/` scope. It processes basic fetch-through routing with cache invalidation keys (`?v=3` bustings) for icon assets.
* **Dynamic Manifest Generation**: The PWA manifest is served dynamically via `/api.php/manifest`. It automatically pulls the active `team_name` config value to customize app titles and install alerts dynamically.
* **Apple Touch Icons**: Includes a designated `180x180` touch icon asset optimized for iOS home screens.

---

## 2. Interactive Install Banners

* **Unified Banner Design**: A single banner layout (`#install-banner`) is shared by both Android and iOS devices.
* **Platform Specifics**:
  * **Android**: Detects PWA capabilities using `beforeinstallprompt` via early capture handlers. Displays a functional action button triggering `installPWA()`.
  * **iOS**: Detects Safari environments. Hides action buttons and provides explicit text instructions guiding the user to use the Apple Share button (`Teilen` → `Zum Home-Bildschirm`).
* **Dismiss Controls**: Displays are persist-blocked using specific localStorage keys (`_installBannerDismissed`) to prevent annoying users.

---

## 3. Gestural Swipe Mechanics

* **Swipe Navigation Views**: Users can swipe left and right to navigate through primary screens (`sessions`, `my-history`, `my-transactions`).
* **Active Interactions**:
  * Tracks touch inputs using `touchstart`, `touchmove`, and `touchend` listeners inside `initSwipe()`.
  * Integrates physics-based edge rubber-banding (clamping velocity and resistance down to `30%` on the first or last available screens).
* **Vertical Scroll Guard**: Implements a strict scrolling path safeguard. Any scroll actions moving vertically (where vertical shift `dy > dx * 1.5` or `dy > 40px`) immediately trigger early returns to prevent horizontal swiping glitches.
* **Menus Auto-Close**: All mobile dropdowns, profile cards, and drop-ups must collapse automatically during swipe Snaps or scrolls.

---

## 4. Theme & Layout Tokens

* **System Design Follow**: The dark/light theme is built strictly on custom CSS styling variables.
* **No Persistence Hack**: The layout conforms dynamically to system-preferred settings. Never save persistent theme triggers inside local storage.
* **Overscroll Behavior**: Top-level containers enforce `overscroll-behavior-y: contain` to prevent standard browser elastic bouncing while allowing the pull-to-refresh indicators to operate properly.
* **Glassmorphism & Shadows**: Implement soft, premium glassmorphism using OKLCH custom color variables (e.g., `oklch(from var(--tx) l c h / alpha)`) for borders, subtle backdrop blurs (`backdrop-filter: blur(4px)`), and modern shadows (`var(--sh-sm)`, `var(--sh-md)`).
* **Calendar Ticket & Badges**: Set clear layouts for `.cal-ticket` containers using border variables and capsule backgrounds (e.g., `var(--pri)` for the active card's `.cal-wkdy` header).
* **Athletic Turf Visualizer**: Keep athletic court representations clean and light:
  - Background: Radial gradients representing physical turf court textures (e.g., `#e2f0d9` to `#cde5bf` in light mode; `#1a2f24` to `#112017` in dark mode).
  - Markings: Semi-opaque thin white borders and dashed vertical center net dividers.
  - Floating Slots: Custom `.admin-slot` states with distinct visual outlines (dashed for vacant, solid for filled, colored `--pri` with glow/shadow overlay for personal reservations).
  - **"Me" Slot (Active Player)**: Must use the specific green background mix to indicate ownership:
    ```css
    .admin-slot.me {
      border-style: solid;
      border-color: var(--pri);
      background: color-mix(in srgb, var(--pri) 22%, var(--prhl));
      font-weight: 700;
      color: var(--pri);
    }
    ```

---

## 5. Overlay & Modal Rules

### Setup Overlay (`#setup-overlay`)
* **Never trigger via inline scripts in `index.html`**. The setup overlay must only be controlled by `checkFirstSetup()` in `app.js`.
* Inline scripts that check `S.players` before `loadState()` completes will see the initial empty array `[]` and falsely trigger the overlay.
* The overlay uses the same CSS class structure as the welcome modal (`.welcome-overlay`), but is a separate element with ID `setup-overlay`.

### Modal State Management
* All overlays must set `document.body.style.overflow = 'hidden'` when open and restore it to `''` when closed.
* Never stack multiple overlays — close existing overlays before opening new ones.
* Lucide icons inside dynamically injected modal content require `lucide.createIcons()` after DOM insertion.
* **Unified Premium Button Design**: All buttons must adhere to the rules in `AGENTS.md` (Section 8). Action buttons must use `.btn` or `.btn-sm` (with `.btn-xs` only for dense grids) with glassmorphic translucent colors, centralized active click-scale transitions, and hover elevation.
