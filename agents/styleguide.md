# Courtle UI Style Guide — Navigation, Action Buttons & Terminologie

Dieser Style Guide definiert das verbindliche Regelwerk für alle interaktiven Bedienelemente (Navigation vs. Actions) sowie das Wording rund um Courts in **Courtle**.

---

## 1. Verbindliche Terminologie: „Court“ statt „Platz“ / „Spielfeld“

Da die App **Courtle** heißt, sprechen wir in der gesamten Anwendung und in allen Übersetzungen (`i18n.js`, `index.html`, `app.js`) konsequent von **Court** bzw. **Court-Kosten**:

| Alt (Veraltet) | Neu (Verbindlich) | Kontext |
| :--- | :--- | :--- |
| *Platzkosten* | **Court-Kosten** | Teamkasse, KPI-Karten, Filter-Pills, Buttons, Modals, Abrechnung |
| *Platzkosten erfassen / bearbeiten* | **Court-Kosten erfassen / bearbeiten** | Action-Button & Modal-Titel (`#mo-expense`, `#mo-edit-expense`) |
| *Zeit & Spielfelder* | **Zeit & Courts** | Serien-Konfiguration (`series.section_time_courts`) |
| *Spielfelder gruppieren* | **Courts gruppieren** | Anzeige-Einstellungen (`settings.group_courts_title`) |
| *Kostenbeitrag pro Platz* | **Kostenbeitrag pro Slot** | Session-Preisbeschreibung (`session.price_desc`) |

---

## 2. Grundprinzip: Navigation vs. Action

Jedes klickbare Element in Courtle gehört funktional und visuell in genau **eine** von zwei Kategorien. Ein Element darf niemals das visuelle Design der jeweils anderen Kategorie annehmen.

- **Kategorie A: Navigation & Filter**: Wechselt nur Ort, Tab, Datum oder Filter. Verändert **keine** Daten und öffnet **kein** Aktions-/Erfassungs-Modal.
- **Kategorie B: Action Buttons**: Löst eine Aktion aus, öffnet ein Aktions-/Erfassungs-Modal oder verändert/löscht Daten in der DB.

---

## 3. Kategorie A: Navigation & Ansichten-Steuerung

> **Goldene Regel für Navigation:** Nav-Elemente wechseln lediglich den sichtbaren Bereich, den Tab, das Datum oder den Listenfilter. Sie nutzen **niemals** eine massiv gefüllte Primärfläche (`background: var(--pri); color: #fff`), damit sie nie mit primären Action-Buttons (`.btn-pri`) verwechselt werden.

### A1. Hauptnavigation (`.nav-btn`, `.nav-dd-item`, `.bnav-btn`)
* **Aufgabe**: Wechsel zwischen den Hauptansichten der App (Sessions, Buchungen, Guthaben, Admin-Bereiche, Profil).
* **Inaktiv**: Transparenter Hintergrund, gedämpfte Textfarbe (`color: var(--txm)`).
* **Aktiv**: Zartes Smaragd-Highlight (`background: var(--prhl); color: var(--pri); font-weight: 700`) ohne Rahmen.

### A2. Ansichts-Tabs (`.seg-tabs` > `.seg-tab`)
* **Aufgabe**: Umschalten zwischen gleichrangigen Unteransichten innerhalb einer Seite:
  * *Abrechnung*: `Offen` | `Abgerechnet`
  * *Sessionplaner*: `Belegung` | `Verlauf`
  * *Spieler*: `Guthaben` | `Aktivität`
  * *Transaktionen*: `Teamkasse` | `Spielerkonten`
  * *Einstellungen*: `Allgemein` | `Sessions`
* **Container (`.seg-tabs`)**: Dezente, leicht vertiefte Mulde (`background: oklch(from var(--tx) l c h / .06); padding: 3px; border-radius: var(--r-md); border: 1px solid var(--bor)`).
* **Inaktiver Tab (`.seg-tab`)**: Transparent (`color: var(--txm); font-weight: 600`).
* **Aktiver Tab (`.seg-tab.active`)**: **Erhabene Surface-Karte** (`background: var(--sur); color: var(--pri); border-color: var(--bor); box-shadow: var(--sh-sm); font-weight: 700`).
* **Abgrenzung**: Durch die helle Karten-Optik auf grauer Mulde ist sofort erkennbar, dass es sich um einen Tab-Umschalter und *nicht* um einen Action-Button handelt.

### A3. Filter-Pills (`.player-filter-pills` > `.pf-pill`)
* **Aufgabe**: Filtern einer bestehenden Liste ohne Seitenwechsel (*Alle*, *Im Minus*, *Guthaben* bzw. *Alle*, *Einzahlungen*, *Court-Kosten*).
* **Form**: Kompakte, voll abgerundete Kapselform (`border-radius: var(--r-full); font-size: var(--text-xs); padding: 4px 10px`).
* **Inaktiv**: `background: var(--sur); border: 1px solid var(--bor); color: var(--txm)`.
* **Aktiv**: Soft-Tint passend zur Filterkategorie (`var(--prhl)` / `var(--suchl)` / `var(--errhl)`) mit farbigem Rahmen und Text.

### A4. Kontext-Sprünge / View-Links (`.btn-nav`)
* **Aufgabe**: Springt von einer Karte oder Zeile direkt in eine andere Ansicht (z. B. `Im Planer öffnen` in der Abrechnungsliste, `In Abrechnung ansehen` im Sessionplaner, `Serie einrichten` im Empty State).
* **Design**: Flacher Ghost-/Link-Stil mit Pfeil-Icon (`arrow-up-right` oder `arrow-right`), ohne Button-Kasten im Ruhezustand (`background: transparent; border: 1px solid transparent; color: var(--pri); font-weight: 600`), bei Hover dezentes Highlight (`background: var(--prhl)`).

---

## 4. Kategorie B: Action Buttons (`.btn`)

> **Goldene Regel für Actions:** Jeder Button, der ein Erfassungs-Modal öffnet, Daten verändert oder einen Prozess auslöst, nutzt das `.btn`-Klassensystem (`border-radius: var(--r-md)`, `font-weight: 700`, physisches Klick-Feedback `transform: scale(.95)`).

### Größen-Hierarchie
1. **`.btn` (Standard, `min-height: 40px`)**: Ausschließlich für abschließende Haupt-CTAs in Modals (`Speichern`, `Abrechnung abschließen`, `Anmelden`) sowie zentrale Vollbreiten-Aktionen.
2. **`.btn-sm` (Kompakt, `min-height: 34px`)**: Verbindlicher Standard für **alle** Seiten-Header-Buttons, Session-Karten-Aktionen, Drawer-Aktionen und Tabellenzeilen.
3. **`.btn-icon-sm` / `.fin-act-btn` (`32×32px` quadratisch)**: Verbindlicher Standard für reine Icon-Aktionen in Listen und Karten (z. B. `pencil` zum Bearbeiten, `trash-2` zum Löschen).
4. **`.btn-xs` (`min-height: 24px`)**: Nur für Mini-Inline-Badges (z. B. Reaktivieren in Spieler-Zeilen).

---

### Farb-Semantik der Action Buttons

#### B1. Primäre Direkt-Action (`.btn-pri` — Solid Emerald)
* **Wann verwenden**: Für Aktionen mit **unmittelbarer, verbindlicher Wirkung** für den Nutzer oder als finaler Bestätigungsschritt:
  * **Spieler-Dashboard**: `Jetzt buchen` (`session.book_slot`) auf einer freien Session.
  * **Abrechnung**: `Prüfen & Abrechnen` (Batch-Abrechnung starten).
  * **Modals**: Primärer Submit-Button im Modal-Footer (`Speichern`, `Weiter`, `Jetzt abrechnen`).
* **Design**: Vollflächig `background: var(--pri); color: var(--txi)` mit leichtem Schwebe-Effekt (`translateY(-1px)`) und Smaragd-Schatten bei Hover.

#### B2. Erstellende Header-Actions & Positive Konto-Actions (`.btn-ok` — Soft Emerald / Green Glass)
* **Wann verwenden**:
  1. **Alle Erfassungs-Buttons in Seiten-Headern** (öffnen ein Modal zum Anlegen neuer Einträge):
     * `+ Einzahlung` & `+ Court-Kosten` (in *Finanzen & Transaktionen*)
     * `+ Hinzufügen` (in *Spieler & Guthaben*)
     * `+ Neue Session` (im *Sessionplaner*)
     * `+ Neue Serie` (in *Session Serien*)
  2. **Positive Wiederherstellungs- & Auflade-Aktionen**:
     * `Guthaben aufladen` (im Spieler-Profil / Drawer)
     * `Reaktivieren` (sowohl für abgesagte Sessions im Planer als auch für deaktivierte Spieler)
* **Design**: Dezenter grüner Glas-Look (`background: oklch(from var(--suc) l c h / .08); color: var(--suc); border: 1px solid oklch(from var(--suc) l c h / .2)`), der bei Hover vollflächig grün (`var(--suc)`, weiße Schrift) aufleuchtet.

#### B3. Passive Spieler-Actions & Neutrale Sekundär-Actions (`.btn-sec` — Neutral Glass)
* **Wann verwenden**:
  1. **Passive Spieler-Actions auf Session-Karten** (betreffen den Spieler nicht unmittelbar/sofort als eigene Direktbuchung):
     * `Gast hinzufügen` (`+ Gast` / `+ Gast (Warteliste)`)
     * `Auf Warteliste` (`joinWaitlist` — wenn alle Plätze belegt sind)
     * `Teams auslosen` (`openTeamRandomizer`) auf der Session-Karte
     * `Mix!` (`#btn-shuffle-teams`) im Court Mixer Modal (temporäres In-Modal-Werkzeug, speichert keine Daten in der DB)
  2. **Neutrale Verwaltungs- & Bearbeitungs-Aktionen**:
     * `Details bearbeiten` (Sessionplaner), `Bearbeiten` / Stift-Icon (`pencil`)
     * `+ Court` hinzufügen (Sessionplaner)
     * `Prüfen` (Einzel-Session in der Abrechnungsliste öffnen)
     * `CSV Export`, `Passwort-Reset`, `Avatar ändern`
     * `Abbrechen` / `Schließen` in Modals
* **Design**: Ruhiges, neutrales Grau-Glas (`background: oklch(from var(--tx) l c h / .04); color: var(--tx); border: 1px solid var(--bor)`).

#### B4. Hinweis-Action für ausstehende Abrechnung (`.btn-gld` — Soft Gold)
* **Wann verwenden**:
  * Im *Sessionplaner*, wenn eine gespielte Session in der Vergangenheit liegt und noch abgerechnet werden muss (`Abrechnen` bei Status *Wartet auf Abrechnung*).
* **Design**: Sanfter Gold-/Amber-Ton (`background: oklch(from var(--gld) l c h / .08); color: var(--gld); border: 1px solid oklch(from var(--gld) l c h / .25)`), korrespondiert mit dem gelben Status-Badge `€ Wartet auf Abrechnung`.

#### B5. Destruktive Actions (`.btn-dan` — Soft Crimson / Deeskalierte Icons)
* **Wann verwenden**: Für alle löschenden, stornierenden oder abmeldenden Aktionen:
  * `Abmelden` (von Session oder Warteliste auf dem Dashboard und in der Timeline)
  * `Session absagen` (im Sessionplaner)
  * `Löschen` / Papierkorb-Icon (`trash-2`) bei Transaktionen, Court-Kosten und Serien
  * `Zurücknehmen` (bereits abgerechnete Session stornieren)
  * `Deaktivieren` (Spieler-Account)
* **Design (60-30-10 Regel & Semantische Signalwirkung)**:
  * **Persönliche Abmelde- & Storno-Buttons (`.btn.btn-dan`)**: Erhalten einen **sanften, transluzenten Crimson-Tint** (`background: oklch(from var(--err) l c h / .07); color: var(--err); border: 1px solid oklch(from var(--err) l c h / .20)`). Dadurch sticht der Abmelde-Button für den Spieler klar, aber unaufdringlich heraus (*Affordance*), ohne mit der 60-30-10 Hierarchie des primären grünen Buchungs-CTAs zu kollidieren.
  * **Repetitive Zeilen-Icons in Tabellen (`.fin-act-btn.btn-dan`)**: Im Ruhezustand neutral grau (`background: oklch(from var(--tx) l c h / .04); color: var(--txm); border: 1px solid var(--bor)`), um bei 50 Zeilen kein rotes Rauschen zu erzeugen. Erst bei Hover/Active leuchtet das Icon rot auf.
  * **Haupt-Aktion im Confirm-Modal**: In Modal-Footern (`#mo-confirm-btn`) direkt als deutlicher roter Warn-Button (`background: oklch(from var(--err) l c h / .12); color: var(--err)`), bei Hover vollflächig `var(--err)` mit weißer Schrift.

---

## 5. Einheitlicher Modal-Aufbau

Alle Modals in Courtle folgen einer strikt standardisierten Struktur:
1. **Modal-Header (`.mo-head`)**:
   - `display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp5)`
   - Enthält `<h2 class="mo-title">` links und `<button class="mo-close btn-icon" onclick="closeMo(...)"><i data-lucide="x"></i></button>` rechts. Keine absoluten Positionierungen verwenden.
2. **Untertitel**: Direkt unter dem Header platziert als `<p class="txsm txm mb4">`.
3. **Modal-Footer (`.mo-foot`)**:
   - Rechtsbündige Buttons mit `display: flex; justify-content: flex-end; gap: var(--sp2)`.
   - Abbrechen / Schließen: `.btn.btn-sec` (`min-height: 40px`).
   - Verbindlicher Abschluss (Submit, Speichern, Buchen, Abrechnen): `.btn.btn-pri` (`min-height: 40px`, Solid Emerald) bzw. `.btn.btn-dan` (Löschen).
   - Nicht-persistente In-Modal-Werkzeuge (z. B. `Mix!` im Court Mixer): `.btn.btn-sec` (`min-height: 40px`, Neutral Glass), da keine Daten in der DB gespeichert werden.

---

## 6. Matchup & Court Mixer Komponenten-Pattern

Für Spielpaarungen und Court-Zuteilungen (z. B. im Court Mixer):
- **Court-Karte (`.court-mixer-card`)**: Helle Surface-Karte (`var(--sur)`), dezenter Rahmen (`var(--bor)`), stark abgerundet (`var(--r-xl)`).
- **Kopfzeile (`.court-mixer-head`)**: Leicht abgesetzter Hintergrund (`var(--suroff)`), Court-Name mit `map-pin`-Icon (`.court-mixer-title`) und Spieleranzahl-Badge (`.badge.bg-neu`).
- **Match-Gitter (`.court-mixer-match`)**: Dreispaltiges Layout `Team 1 (1fr)` | `VS (.court-mixer-vs)` | `Team 2 (1fr)`.
- **Spieler-Chip (`.court-mixer-player`)**:
  - Enthält Spieler-Avatar (`.av` mit dem gewählten Spieler-Icon) und Name.
  - Eigener Spieler (`.court-mixer-player.me`): Subtiler Smaragd-Akzent (`color-mix(in srgb, var(--pri) 12%, var(--sur2))`), grüner Rand (`var(--pri)`) und grüner Avatar-Kreis.
- **Pausierende Spieler / Bank (`.court-mixer-bench`)**:
  - Wenn mehr Spieler als Plätze vorhanden sind (z. B. 5 Spieler auf 1 Court), erscheinen überschüssige Spieler in einer gestrichelten Bank-Box (`.court-mixer-bench`) mit Uhr-Icon.

---

## 7. Mobile-First Card Patterns statt starrer HTML-Tabellen

Auf Viewports unter 640px Breite dürfen mehrspaltige Datentabellen (`.dt`) niemals ungebrochen eingesetzt werden:
- **Spieler-Aktivität (`.act-card`)**: Karten mit Spieler-Avatar links und responsivem 3er-Metrik-Grid (`LOGIN`, `AKTIVITÄT`, `GESPIELT`) darunter.
- **Abrechnungs-Prüfung (`.billing-p-row`)**: Flexible Zeilen mit Spielername, Slot-Count, Betrag und Direkt-bezahlt-Pill.
- **Abrechnungs-Bestätigung (`.billing-delta-row`)**: Zweizeilige Saldo-Karten (`Spielername` links, Vorher-Nachher-Saldo `12,00 € → -4,00 € ⚠` rechts, Berechnungsdetails dezent darunter).
- **Mix-Aktion (`.court-mixer-foot`)**:
  - Zentrierter Aktionsbereich (`display: flex; justify-content: center`). Da der Header bereits den Standard-Schließen-Button (`.mo-close`) enthält, entfällt ein redundanter Schließen-Button im Footer, und der Mix-Button (`.btn.btn-sec`) sitzt prominent in der Mitte.
