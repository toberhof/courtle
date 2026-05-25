# Courtle Design System & Styling Guide

Welcome to the **Courtle Design System**! This document provides an in-depth reference for the visual identity, UI/UX structure, and CSS tokens that define the user experience of Courtle.

Courtle is crafted as a premium, athletic-themed Progressive Web Application (PWA) with a single-page architecture. It balances modern glassmorphic surfaces with classic sports-club branding, using fluid typography and automatic system-preferred light/dark theme modes.

---

## 1. Design Principles

Every interface element in Courtle is built on four core design tenets:
1. **Athletic Premium Identity**: Uses curated, rich color palettes (deep forest greens, rust oranges, warm off-whites, and charcoal) and elegant typography to avoid cheap or generic looks.
2. **Glassmorphic Depth**: Utilizes modern backdrop filters (`backdrop-filter: blur()`), fine semi-opaque borders, and high-fidelity shadows to create a layered, tactical feel.
3. **Tactile & Fluid Interactions**: Interactive elements respond to touch and hover with custom cubic-bezier transitions (`var(--tr)`) and translation lifts. Mobile navigation features custom physics-based horizontal swipe gestures.
4. **Resilience & Responsiveness**: Adapts seamlessly from a compact PWA on an iOS or Android home screen to a spacious web dashboard, using fluid sizing rules and native CSS clamping.

---

## 2. Typography

Courtle combines a striking serif display typeface for accent headings with a highly readable geometric sans-serif for content and user interfaces.

* **Display Font**: `'Instrument Serif', Georgia, serif`
  * *Purpose*: Main title banners, brand text, and premium headings. Gives a classic, prestigious sports club character.
* **Body Font**: `'DM Sans', system-ui, sans-serif`
  * *Purpose*: UI components, slot names, form controls, tables, and metadata. Provides clean geometric alignment and maximum legibility.

### Fluid Font Sizing
Sizes scale dynamically between viewport constraints using CSS `clamp()` functions to prevent overflow on small screens while remaining proportional on larger ones:

| Token | CSS Value | Visual Guide |
| :--- | :--- | :--- |
| `--text-xs` | `clamp(.75rem, .7rem + .25vw, .875rem)` | Tiny metadata, badge labels, secondary hints |
| `--text-sm` | `clamp(.875rem, .8rem + .35vw, 1rem)` | Buttons, form labels, slot details, navigation items |
| `--text-base`| `clamp(1rem, .95rem + .25vw, 1.125rem)`| Body text, default inputs, standard headings |
| `--text-lg` | `clamp(1.125rem, 1rem + .75vw, 1.5rem)` | Section headers (`.sec-title`), modal titles |
| `--text-xl` | `clamp(1.5rem, 1.2rem + 1.25vw, 2.25rem)`| Major page headers (`.page-title`), KPI numbers |

---

## 3. The Spacing Scale

Layout gaps, margins, and paddings strictly follow a 12-point modular scale. Avoid arbitrary spacing values to ensure consistent vertical and horizontal rhythm.

* `var(--sp1)` = `0.25rem` (4px) — Tiny details, badge margins, checkbox gaps
* `var(--sp2)` = `0.5rem` (8px) — Button internal padding, small slot margins
* `var(--sp3)` = `0.75rem` (12px) — Card sub-gaps, list separations, compact headers
* `var(--sp4)` = `1.0rem` (16px) — Standard outer margin, inner card paddings, grid gutters
* `var(--sp5)` = `1.25rem` (20px) — Regular card paddings, session card internal spacing
* `var(--sp6)` = `1.5rem` (24px) — Large card paddings, header sections
* `var(--sp8)` = `2.0rem` (32px) — Major section breaks, setup card paddings
* `var(--sp10)` = `2.5rem` (40px)
* `var(--sp12)` = `3.0rem` (48px)
* `var(--sp16)` = `4.0rem` (64px) — Hero illustrations, empty state banners

---

## 4. Color Palette & Theming

Courtle supports a dark and light theme that syncs automatically with system-level preferences (`prefers-color-scheme`). Theme variables are implemented directly on `:root` and `[data-theme="dark"]` scopes.

```mermaid
graph TD
    subgraph Color Tokens
        pri[Primary Forest Green]
        suc[Success Lime Green]
        war[Warning Rust Orange]
        err[Error Berry Purple]
        gld[Gold / Waitlist]
    end
    subgraph UI Theme Modes
        light[Light Theme: #f7f6f2 warm gray base]
        dark[Dark Theme: #171614 rich charcoal base]
    end
    light --> Color Tokens
    dark --> Color Tokens
```

### 4.1 System Palette Tokens

| CSS Variable | Light Theme Value (Default) | Dark Theme Value | UI / Visual Purpose |
| :--- | :--- | :--- | :--- |
| **`--bg`** | `#f7f6f2` (Warm Sand/Gray) | `#171614` (Deep Charcoal) | Core application viewport background |
| **`--sur`** | `#f9f8f5` (Warm Cream) | `#1c1b19` (Rich Dark Gray) | Standard container cards, dialogs, dropdowns |
| **`--sur2`** | `#fbfbf9` | `#201f1d` | Alternating rows, input backgrounds |
| **`--suroff`**| `#f0ede9` (Soft Gray) | `#1d1c1a` | Off-surface blocks, headers, inactive items |
| **`--suroff2`**| `#edeae5` | `#22211f` | Hover overlays and secondary borders |
| **`--div`** | `#dcd9d5` | `#262523` | Divider lines and grid separators |
| **`--bor`** | `#d4d1ca` | `#393836` | Dynamic borders and active control outlines |

### 4.2 Semantic State Colors

Rather than using generic primary colors, Courtle features harmonious tone ranges:

* **Primary (`--pri`)**: Used for primary brand elements, secure buttons, selected tabs, and active calendar tags.
  * Light Mode: `#007a5a` (Classic Forest Green) | Dark Mode: `#42a38a` (Emerald/Teal Green)
  * Highlight backgrounds: `--prhl` (`#cde0d6` in light, `#2a3d36` in dark)
* **Success (`--suc`)**: Used for credit transactions, positive KPI values, and fully loaded session indicators.
  * Light Mode: `#437a22` (Olive Green) | Dark Mode: `#6daa45` (Herb/Lime Green)
  * Highlight: `--suchl` (`#d4dfcc` in light, `#3a4435` in dark)
* **Warning (`--war`)**: Used for caution states, approaching deadlines, and near-empty slots.
  * Light Mode: `#964219` (Rust Terracotta) | Dark Mode: `#bb653b` (Amber Clay)
  * Highlight: `--warhl` (`#ddcfc6` in light, `#564942` in dark)
* **Error (`--err`)**: Used for debits, destructive actions, storniert indicators, and negative balances.
  * Light Mode: `#a12c7b` (Berry Purple) | Dark Mode: `#d163a7` (Mauve Orchid)
  * Highlight: `--errhl` (`#e0ced7` in light, `#4c3d46` in dark)
* **Gold (`--gld`)**: Reserved exclusively for waitlist chips and user-specific VIP/personal bookings.
  * Light Mode: `#d19900` (Athletic Gold) | Dark Mode: `#e8af34` (Amber Gold)
  * Highlight: `--gldhl` (`#e9e0c6` in light, `#4d4332` in dark)

---

## 5. Visual Styling Foundations

### 5.1 Glassmorphism & Overlays
Modals (`.mo`), PIN pads (`.pin-modal-overlay`), and bottom sheets use soft backdrop blurs to preserve depth:
```css
backdrop-filter: blur(6px);
-webkit-backdrop-filter: blur(6px);
background: oklch(.1 0 0 / .5);
```
Borders are given high-definition, transparent stroke definitions to dynamically adapt over complex backgrounds without stark lines:
```css
border: 1px solid oklch(from var(--tx) l c h / .08);
```

### 5.2 Dynamic Shadows
Shadows leverage native OKLCH parameters to remain soft, avoiding flat black smudges in light mode while transitioning to deep shadows in dark mode:
* **Light Theme**:
  * `--sh-sm`: `0 1px 2px oklch(.2 .01 80/.06)`
  * `--sh-md`: `0 4px 12px oklch(.2 .01 80/.08)`
  * `--sh-lg`: `0 12px 32px oklch(.2 .01 80/.12)`
* **Dark Theme**:
  * `--sh-sm`: `0 1px 2px oklch(0 0 0/.2)`
  * `--sh-md`: `0 4px 12px oklch(0 0 0/.3)`
  * `--sh-lg`: `0 12px 32px oklch(0 0 0/.4)`

---

## 6. Key Components

### 6.1 Session Match Tickets (`.sc`)
Upcoming bookings and available playdays are displayed as stylized physical sports tickets:
* **Layout Structure**: Consists of a header card (`.sc-head-ticket`) and a main court details body (`.sc-body`).
* **Hover State**: Elevates on hover (`translateY(-3px)`) with a custom shadow transition and a soft emerald border highlight (`oklch(from var(--pri) l c h / .25)`).
* **Next Up Glow (`.sc.next-up`)**: The immediate next upcoming session card features an additional `4px` top border accent utilizing the primary brand color (`var(--pri)`) and an active glowing boundary drop shadow (`oklch(from var(--pri) l c h / .08)`).
* **Calendar Ticket Badge (`.cal-ticket`)**:
  * A simulated retro ticket calendar widget on the left side of the card header.
  * Shows weekday (`.cal-wkdy`) as an uppercase capsule tag, day number (`.cal-day`), and month text (`.cal-month`).
  * On `.sc.next-up`, the `.cal-wkdy` capsule turns into an active `--pri` accent color with inverted white text.

```
┌──────────────────────────────────────────────┐
│  WEEKDAY  │  Session Name / Date             │
│  ──────── │  Start Time - End Time           │
│    DAY    │  Location Marker                 │
│  ──────── │                                  │
│   MONTH   │  [Abgerechnet] [Slot sichern]    │
├───────────┴──────────────────────────────────┤
│  [ Court 1 ]          [ Court 2 ]            │
│  ┌──────────────┐     ┌──────────────┐       │
│  │ Occupied [✓] │     │ Vacant   [+] │       │
│  └──────────────┘     └──────────────┘       │
└──────────────────────────────────────────────┘
```

### 6.2 Grouped Court Container (`.court-container`)
When court grouping is active (`display_court_grouping` enabled), the session matches are organized into distinct, elegant court cards:
* **Court Header (`.court-header`)**: Includes a subtle map-pin icon and court name badge (`Court 1`, `Court 2`), providing clear orientation.
* **Court Grid (`.court-slots-grid`)**: A flex or grid layout that hosts the dynamic slot allocation chips in a structured layout.
* **Glassmorphic Floating Slots (`.admin-slot`)**:
  * Glass backdrop (`oklch(from var(--sur) l c h / .85)` with `backdrop-filter: blur(4px)`).
  * **Vacant Slots**: Soft dashed outline and a user-plus icon, indicating a slot can be booked.
  * **Filled Slots**: Solid borders with high-contrast text, featuring custom player details and dynamic avatar icons.
  * **Personal Bookings (`.me`)**: Highlighted with primary colors and active typography, allowing immediate visibility of the player's own bookings.

---

## 7. Responsive Shell & Gesture Mechanics

Courtle implements a mobile-first, app-shell framework:

```
┌──────────────────────────────────────────────┐
│  [Logo] COURTLE              [Theme Toggle]  │  ◄ Sticky Topbar (56px)
├──────────────────────────────────────────────┤
│  Dein Guthaben: 24,00 € 🤑                   │  ◄ Guest Balance Bar (40px)
├──────────────────────────────────────────────┤
│                                              │
│               [ SWIPE TRACK ]                │
│                                              │
│  ◄ Bevorstehende Sessions (Active View)  ►   │  ◄ Body Viewports (Swipe wrap)
│                                              │
├──────────────────────────────────────────────┤
│  [Sessions]  [Buchungen]  [Admin]  [Profile] │  ◄ Mobile Bottom Nav (56px)
└──────────────────────────────────────────────┘
```

### 7.1 View Stacking (Desktop vs. Mobile)
* **Desktop Layout**: Navigation is anchored in the sticky header topbar (`.topbar` at `56px` height). Content displays inside a centered `.main` container (clamped to a max-width of `960px`).
* **Mobile Layout (<= 640px)**: The header navigation wraps into a bottom navigation panel (`.bottom-nav`), providing thumb-friendly buttons. Safe areas (`env(safe-area-inset-bottom)`) are automatically added to avoid conflicts with device home indicators.

### 7.2 Gestural Swipe Architecture
On mobile touchscreens, users can swipe left or right to slide between screens:
* **Physics-based Elasticity**: Touch listeners (`touchstart`, `touchmove`, `touchend`) track swipe velocity and drag offsets. Reaching the first or last available screen applies an edge elastic resistance factor (clamped down to `30%` drag transmission).
* **Vertical Scroll Guard**: A strict scrolling angle safeguard is implemented. Vertical drags (where vertical shift `dy > dx * 1.5` or `dy > 40px`) immediately break execution, preventing erratic horizontal page shifting while scrolling down lists.

---

## 8. Accessibility & Color Contrast Safeguards (a11y)

To ensure Courtle remains highly accessible to all players, including those with visual or situational impairments, all developers must strictly adhere to the following accessibility parameters:

### 8.1 WCAG 2.1 Contrast Thresholds
Due to Courtle’s rich sports gradients and semi-transparent borders, color styling must be validated using standard WCAG 2.1 formulas:
* **Standard UI Text**: Must achieve a minimum **4.5:1 contrast ratio** against its surrounding surface background (`--sur`, `--sur2`, or `--suroff`).
* **Interactive Controls & Graphical Markers**: Any functional border, active icon state, or indicator must secure at least a **3.0:1 contrast ratio**.

### 8.2 Non-Color Semantic Indicators
Never rely solely on color to convey a system state, transactional direction, or slot availability:
* **Slot Allocation**: Vacant slots must display a geometric dashed border and a `+` symbol (or dynamic helper phrase), whereas filled slots feature a solid card avatar and the player's name.
* **Transaction Indicators**: Success or debit statements must contain leading mathematical signs (e.g., `+ 16,00 €` or `– 16,00 €`) alongside the default red/green coloring to clarify balance history for colorblind users.

### 8.3 Screen Reader & Target Support
* **ARIA Labels**: All icon-only interactive items (such as the `.mo-close` close buttons, `.btn-icon` controls, and dynamic theme shifts) must feature descriptive `aria-label` or `title` attributes (e.g., `aria-label="Modal schließen"`).
* **Minimum Tap Target Sizes**: Mobile buttons and active navigation links (`.bnav-btn`, `.admin-slot`, `.btn`) must have an active hit target size of **at least 44 × 44 pixels** to align with physical motor coordination guidelines.

---

## 9. Performance & DOM Rendering Optimization (LCP/INP)

Because Courtle is a pure single-page application that renders dynamic interfaces on the client side, keeping Interaction to Next Paint (INP) and Largest Contentful Paint (LCP) scores low is vital for a native-app-like feel.

### 9.1 Efficient DOM Traversal & Target Updates
Avoid redrawing massive parent DOM blocks with `.innerHTML` whenever minor children properties change:
* **Avoid General Redraws**: Do not call complete renderer functions (e.g., `renderAll()`) for minor localized state shifts (like toggling a single loader spinner or highlighting a selected profile card).
* **Targeted Node Access**: Query the target element directly (e.g., `document.getElementById(...)`) and modify only the necessary classes (`classList.add`) or text attributes (`textContent` or `innerText`).
* **Icon Recovery**: Remember that any replacement of `.innerHTML` strips away vector icons. You must trigger a localized `lucide.createIcons()` immediately after inner HTML modification to rebuild the graphics.

### 9.2 CSS Containment & Virtual Acceleration
When rendering a long historical list of bookings or sessions:
* **Containment Directives**: Apply `content-visibility: auto` to off-screen session cards (`.sc`) or table elements to let the browser bypass layout and paint computations for off-screen blocks.
* **Intrinsic Sizing**: Supplement containment properties with `contain-intrinsic-size: 150px` (or approximate block heights) to prevent scrollbar jumping while scrolling.

```css
/* Optimization rule for off-screen match cards */
.sc {
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;
}
```

---

## 10. Gesture Collision & Interaction Boundaries

To support gestural physics-based swiping without breaking standard mobile interactions (like scrollable select list elements or vertical list scrolling):

### 10.1 Collision Safeguards
* **Contextual Invalidation**: Disable the horizontal swipe listener entirely when touch actions originate inside scrollable widgets (e.g., the `.player-pick-grid-wrap` container, long custom tables, or open dropdown selections).
* **Pointer Isolation**: Modals (`.mo`) and overlays must enforce `pointer-events: auto` to absorb dragging and tapping actions, preventing underlying swipe track movements.

### 10.2 Viewport Edge Exclusions
* **OS Navigation Prevention**: To prevent swipe tracks from interfering with system-level edge gestures (like Safari's back/forward swipe or Android's system back drag), touch inputs within `16px` of the left or right viewport edges must be ignored.
  ```js
  // Check in touchstart event handler
  if (e.touches[0].clientX < 16 || e.touches[0].clientX > window.innerWidth - 16) {
    return; // Ignore system back-navigation swipe zones
  }
  ```

---

## 11. Motion, Animation & Transition Safeguards

A premium design feels fluid and smooth. Dynamic motion must remain physically convincing and light.

### 11.1 The "No-Layout-Transition" Rule
Never apply CSS transitions to properties that alter the document structure or trigger layout calculations (which cause heavy paint cascades and stuttering):
* **Prohibited Transition targets**: `width`, `height`, `margin`, `padding`, `top`, `bottom`, `left`, `right`, `font-size`.
* **Approved Transition targets**: `transform`, `opacity`, `color`, `background-color`, `border-color`, `box-shadow`.
* **Targeted Transitions Enforced**: Never use `transition: all`. Define specific transition properties to maintain optimal frame rates:
  ```css
  /* Correct implementation */
  .btn {
    transition: color var(--tr), background-color var(--tr), border-color var(--tr), box-shadow var(--tr);
  }
  ```

### 11.2 Theme Shifting Smoothness
To prevent jarring flashes of color when switching between Light and Dark modes:
* **Global Transition Target**: Apply a global background and color transition rule on body elements when the theme shifts, ensuring a smooth, cohesive shift across the entire canvas.
  ```css
  body {
    transition: background-color var(--tr), color var(--tr);
  }
  ```

---

## 12. Best Practices for Developers

When extending the Courtle styling codebase, follow these rules:

1. **Prefer Variables Over Hardcoded Colors**: Always pull values from defined CSS variables (e.g. `color: var(--txm)` instead of `#7a7974`). This ensures dark/light compliance is inherited automatically without broken elements.
2. **Utilize Fluid Clamps**: Do not write media queries for intermediate adjustments. Use responsive helper classes or layout grids (`kpi-grid`, `pg`, `slots-grid`).
3. **Respect Safe Areas**: When adding floating overlays or sticky footers, always pad for device notches using standard variables: `padding-bottom: env(safe-area-inset-bottom, 0px)`.
4. **Invalidate Browser Cache**: When modifying `style.css` or `app.js`, remember to increment the query parameters (`style.css?build=X`, `app.js?build=X`) in `index.html`, the footer build label, and the HTML comment `<!--built:X-->` before any Git push to enforce immediate browser updates.
