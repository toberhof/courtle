import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFile = path.resolve(__dirname, 'courtle_test_data', 'test-courtle.db');

test.describe('Courtle E2E Integration Suite', () => {
  
  // Clean up the test database before running each test case
  test.beforeEach(async ({ request }) => {
    // Synchronously reset the SQLite DB inside the container (zero Docker mount sync latency)
    await request.post('/api.php/test-reset');
  });

  test('Should handle initial admin setup and log in successfully', async ({ page }) => {
    // 1. Capture console errors and logs immediately
    const consoleErrors = [];
    page.on('pageerror', (err) => {
      console.error('[BROWSER RUNTIME ERROR]', err.stack || err);
      consoleErrors.push(err);
    });
    page.on('console', (msg) => {
      console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
    });

    // 2. Open the homepage
    await page.goto('/');

    // 3. Setup overlay should open automatically since the database is empty
    const setupOverlay = page.locator('#setup-overlay');
    await expect(setupOverlay).toHaveClass(/open/);

    // Wait for the browser's initial focus loop/settle to avoid focus stealing race conditions
    await page.waitForTimeout(500);

    // 4. Fill out the Ersteinrichtung wizard
    await page.fill('#setup-teamname', 'Padel Champions');
    await page.fill('#setup-name', 'Super Admin');
    await page.fill('#setup-pin', '1337');
    await page.fill('#setup-pin2', '1337');

    // 5. Submit the setup form — triggers 3 sequential API calls:
    //    POST /players → POST /auth → PUT /config (team name)
    //    Use Promise.all so we capture the PUT /config response before asserting.
    //    This is deterministic even on cold Docker starts where the first request can take 4-5s.
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'PUT'),
      page.click('#setup-overlay button:has-text("Speichern")', { force: true }),
    ]);

    // 6. Ensure setup overlay closes
    await expect(setupOverlay).not.toHaveClass(/open/, { timeout: 10000 });

    // 7. Verify the team name is updated in the UI
    const headerTitle = page.locator('#topbar-team-name');
    await expect(headerTitle).toContainText('Padel Champions');

    // 8. Assert that no JavaScript runtime errors occurred in the console
    expect(consoleErrors).toHaveLength(0);
  });

  test('Should allow a player to log out and log back in using the PIN Keypad', async ({ page }) => {
    // 1. Setup the initial state (Run initial setup)
    await page.goto('/');
    
    // Wait for setup overlay and settle focus
    const setupOverlay = page.locator('#setup-overlay');
    await expect(setupOverlay).toHaveClass(/open/);
    await page.waitForTimeout(500);

    await page.fill('#setup-teamname', 'Padel Champions');
    await page.fill('#setup-name', 'Super Admin');
    await page.fill('#setup-pin', '1337');
    await page.fill('#setup-pin2', '1337');
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'PUT'),
      page.click('#setup-overlay button:has-text("Speichern")', { force: true }),
    ]);

    // Verify setup is complete and logged in
    await expect(setupOverlay).not.toHaveClass(/open/, { timeout: 10000 });
    // 2. Clear localStorage to simulate a fresh load (requires user to log back in)
    await page.evaluate(() => {
      localStorage.clear();
      window.location.reload();
    });

    // 3. Welcome overlay should be open because players exist in the DB but no session is active
    const welcomeOverlay = page.locator('#welcome-overlay');
    await expect(welcomeOverlay).toHaveClass(/open/);

    // 4. Select the player "Super Admin" from the grid
    const playerPickGrid = page.locator('#player-pick-grid');
    await expect(playerPickGrid).toBeVisible();
    await page.click('#player-pick-grid button:has-text("Super Admin")');

    // 5. Welcome modal should close, and user PIN keypad overlay should open
    await expect(welcomeOverlay).not.toHaveClass(/open/);
    const pinOverlay = page.locator('#upin-overlay');
    await expect(pinOverlay).toHaveClass(/open/);

    // Verify personalized greeting
    await expect(page.locator('#upin-title')).toContainText('Hallo, Super Admin!');

    // 6. Enter PIN '1337' using the custom keypad buttons
    const key1 = page.locator('.pkey', { hasText: '1' }).first();
    const key3 = page.locator('.pkey', { hasText: '3' }).first();
    const key7 = page.locator('.pkey', { hasText: '7' }).first();

    await key1.click();
    await key3.click();
    await key3.click();
    await key7.click();

    // 7. Verify successful login: the PIN overlay should close
    await expect(pinOverlay).not.toHaveClass(/open/);

    // Check that we are back in the logged-in state
    await expect(page.locator('#profile-dd-label:visible, #bnav-profile-label:visible')).toContainText('Super Admin');
  });

  test('Should create 15 random users, login with 3, book sessions and waitlist', async ({ page }) => {
    // 1. Capture console errors
    const consoleErrors = [];
    page.on('pageerror', (err) => {
      consoleErrors.push(err);
    });

    // 2. Initial setup
    await page.goto('/');
    const setupOverlay = page.locator('#setup-overlay');
    await expect(setupOverlay).toHaveClass(/open/);
    await page.waitForTimeout(500);

    await page.fill('#setup-teamname', 'Padel Champions');
    await page.fill('#setup-name', 'Super Admin');
    await page.fill('#setup-pin', '1337');
    await page.fill('#setup-pin2', '1337');

    // Capture admin token from auth response during setup
    let adminToken = '';
    let adminId = '';
    page.on('response', async (response) => {
      if (response.url().includes('/auth') && response.request().method() === 'POST') {
        try {
          const body = await response.json();
          if (body.token && body.admin) {
            adminToken = body.token;
            adminId = body.player_id;
          }
        } catch (e) {}
      }
    });

    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'PUT'),
      page.click('#setup-overlay button:has-text("Speichern")', { force: true }),
    ]);
    await expect(setupOverlay).not.toHaveClass(/open/, { timeout: 10000 });

    // Wait a moment to ensure we captured the admin token
    await page.waitForTimeout(200);
    expect(adminToken).not.toBe('');

    // 3. Create 15 random users via API using admin token
    const firstNames = ['Anna', 'Ben', 'Clara', 'David', 'Eva', 'Felix', 'Gina', 'Hugo', 'Ida', 'Jan', 'Klara', 'Leo', 'Mia', 'Nico', 'Olga'];
    const createdPlayers = [];

    for (let i = 0; i < 15; i++) {
      const name = firstNames[i];
      const pin = String(1000 + i).padStart(4, '0');
      const response = await page.request.post('/api.php/players', {
        headers: { 'Content-Type': 'application/json', 'X-Token': adminToken },
        data: { name, pin, admin: false },
      });
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe(name);
      createdPlayers.push({ id: body.id, name, pin });
    }

    // Verify all 16 players exist (1 admin + 15 new)
    const playersResponse = await page.request.get('/api.php/players');
    const players = await playersResponse.json();
    expect(players.length).toBe(16);

    // 4. Login with first 3 users and book sessions
    const loginUsers = createdPlayers.slice(0, 3);
    const tokens = [];

    for (const user of loginUsers) {
      const authResponse = await page.request.post('/api.php/auth', {
        headers: { 'Content-Type': 'application/json' },
        data: { player_id: user.id, pin: user.pin },
      });
      const authBody = await authResponse.json();
      expect(authBody.token).toBeDefined();
      expect(authBody.player_id).toBe(user.id);
      tokens.push({ ...user, token: authBody.token });
    }

    // 5. Get config to determine number of courts
    const configResponse = await page.request.get('/api.php/config');
    const config = await configResponse.json();
    const numCourts = parseInt(config.courts || '2', 10);

    // Create upcoming sessions using admin API (session scheduler may not have run)
    const today = new Date();
    const sessionDates = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i + 1);
      const ds = d.toISOString().split('T')[0];
      sessionDates.push(ds);

      // Create session via PUT /sessions/{date} with empty courts
      const createResponse = await page.request.put(`/api.php/sessions/${ds}`, {
        headers: { 'Content-Type': 'application/json', 'X-Token': adminToken },
        data: { courts: Array(numCourts).fill(null).map(() => [null, null, null, null]) },
      });
      expect(createResponse.ok()).toBe(true);
    }

    // Get sessions to verify they exist
    const sessionsResponse = await page.request.get('/api.php/sessions');
    const sessions = await sessionsResponse.json();
    const upcomingSessions = sessions.filter(s => sessionDates.includes(s.date) && !s.cancelled).sort((a, b) => a.date.localeCompare(b.date));
    expect(upcomingSessions.length).toBeGreaterThan(0);

    // 6. Book slots for first 2 users on the first upcoming session
    const firstSessionDate = upcomingSessions[0].date;

    // User 1 books court 0, slot 0
    const bookResponse1 = await page.request.post(`/api.php/sessions/${firstSessionDate}/book`, {
      headers: { 'Content-Type': 'application/json', 'X-Token': tokens[0].token },
      data: { court_index: 0, slot_index: 0, player_id: tokens[0].id },
    });
    expect(bookResponse1.ok()).toBe(true);

    // User 2 books court 0, slot 1
    const bookResponse2 = await page.request.post(`/api.php/sessions/${firstSessionDate}/book`, {
      headers: { 'Content-Type': 'application/json', 'X-Token': tokens[1].token },
      data: { court_index: 0, slot_index: 1, player_id: tokens[1].id },
    });
    expect(bookResponse2.ok()).toBe(true);

    // Verify bookings by fetching session again
    const sessionAfterBooking = await page.request.get('/api.php/sessions');
    const sessionsList = await sessionAfterBooking.json();
    const bookedSession = sessionsList.find(s => s.date === firstSessionDate);
    expect(bookedSession.courts[0][0]).toBe(tokens[0].id);
    expect(bookedSession.courts[0][1]).toBe(tokens[1].id);

    // 7. Fill remaining slots on first session to force waitlist
    // Fill remaining slots with users 4-7 (using admin token to book for them)
    const fillUsers = createdPlayers.slice(3, 7);
    for (let i = 0; i < fillUsers.length; i++) {
      const ci = Math.floor((i + 2) / 4);
      const si = (i + 2) % 4;
      if (ci < numCourts) {
        const fillResponse = await page.request.post(`/api.php/sessions/${firstSessionDate}/book`, {
          headers: { 'Content-Type': 'application/json', 'X-Token': adminToken },
          data: { court_index: ci, slot_index: si, player_id: fillUsers[i].id },
        });
        expect(fillResponse.ok()).toBe(true);
      }
    }

    // 8. User 3 joins waitlist (session should be full now)
    const waitlistResponse = await page.request.post(`/api.php/sessions/${firstSessionDate}/join-waitlist`, {
      headers: { 'Content-Type': 'application/json', 'X-Token': tokens[2].token },
      data: { player_id: tokens[2].id },
    });
    expect(waitlistResponse.ok()).toBe(true);

    // Verify waitlist
    const sessionWithWaitlist = await page.request.get('/api.php/sessions');
    const sessionsWithWl = await sessionWithWaitlist.json();
    const sessionWithWl = sessionsWithWl.find(s => s.date === firstSessionDate);
    expect(sessionWithWl.waitlist).toContain(tokens[2].id);

    // 9. Additional users join waitlist
    const waitlistUsers = createdPlayers.slice(7, 10);
    for (const wlUser of waitlistUsers) {
      const wlAuthResponse = await page.request.post('/api.php/auth', {
        headers: { 'Content-Type': 'application/json' },
        data: { player_id: wlUser.id, pin: wlUser.pin },
      });
      const wlAuth = await wlAuthResponse.json();

      const wlResponse = await page.request.post(`/api.php/sessions/${firstSessionDate}/join-waitlist`, {
        headers: { 'Content-Type': 'application/json', 'X-Token': wlAuth.token },
        data: { player_id: wlUser.id },
      });
      expect(wlResponse.ok()).toBe(true);
    }

    // Verify all waitlist users
    const finalSessionCheck = await page.request.get('/api.php/sessions');
    const finalSessions = await finalSessionCheck.json();
    const finalSession = finalSessions.find(s => s.date === firstSessionDate);
    for (const wlUser of waitlistUsers) {
      expect(finalSession.waitlist).toContain(wlUser.id);
    }

    // 10. Book user 1 on a second upcoming session (if available)
    if (upcomingSessions.length > 1) {
      const secondSessionDate = upcomingSessions[1].date;
      const bookResponse3 = await page.request.post(`/api.php/sessions/${secondSessionDate}/book`, {
        headers: { 'Content-Type': 'application/json', 'X-Token': tokens[0].token },
        data: { court_index: 0, slot_index: 0, player_id: tokens[0].id },
      });
      expect(bookResponse3.ok()).toBe(true);

      // User 2 joins waitlist on second session
      const wlResponse2 = await page.request.post(`/api.php/sessions/${secondSessionDate}/join-waitlist`, {
        headers: { 'Content-Type': 'application/json', 'X-Token': tokens[1].token },
        data: { player_id: tokens[1].id },
      });
      expect(wlResponse2.ok()).toBe(true);
    }

    // 11. Assert that no JavaScript runtime errors occurred
    expect(consoleErrors).toHaveLength(0);
  });

  test('Should show correct navigation bar based on viewport (responsive / PWA) and allow full navigation', async ({ page, isMobile }) => {
    // 1. Setup the initial state so we get past the setup screen
    await page.goto('/');

    const setupOverlay = page.locator('#setup-overlay');
    await expect(setupOverlay).toHaveClass(/open/);
    await page.waitForTimeout(500);

    await page.fill('#setup-teamname', 'Padel Champions');
    await page.fill('#setup-name', 'Super Admin');
    await page.fill('#setup-pin', '1337');
    await page.fill('#setup-pin2', '1337');
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'PUT'),
      page.click('#setup-overlay button:has-text("Speichern")', { force: true }),
    ]);
    await page.waitForLoadState('networkidle');

    // Verify setup is complete and logged in
    await expect(setupOverlay).not.toHaveClass(/open/, { timeout: 10000 });

    // 2. Assert navigation bar visibility depending on the viewport & perform view switching checks
    if (isMobile) {
      // On mobile views, the bottom navigation navbar is visible, and the desktop sidebar/navbar is hidden
      await expect(page.locator('#bottom-nav')).toBeVisible();
      await expect(page.locator('#main-nav')).toBeHidden();

      // Check Mobile (PWA) Navigation Tabs:
      // On mobile (viewport ≤ 640px), the app activates swipe mode (#swipe-wrap.swipe-active).
      // In swipe mode, showView() translates #swipe-track via CSS transform instead of toggling
      // .active on the view element. The bnav button itself receives .active instead.
      // SWIPE_VIEWS order: ['sessions'=0, 'my-history'=1, 'my-transactions'=2]

      // Click 'Buchungen' tab (my-history) → swipe index 1 → translateX(-100%)
      await page.click('#bnav-my-history');
      await expect(page.locator('#bnav-my-history')).toHaveClass(/active/);
      await expect(page.locator('#swipe-track')).toHaveCSS('transform', /matrix\(-?1|-100/);

      // Click 'Transaktionen' tab (my-transactions) → swipe index 2 → translateX(-200%)
      await page.click('#bnav-my-transactions');
      await expect(page.locator('#bnav-my-transactions')).toHaveClass(/active/);

      // Click 'Sessions' tab (sessions) → swipe index 0 → translateX(0%)
      await page.click('#bnav-sessions');
      await expect(page.locator('#bnav-sessions')).toHaveClass(/active/);

      // Click Admin menu to toggle mobile admin sheet
      const bnavAdminMenu = page.locator('#bnav-admin-menu');
      await expect(bnavAdminMenu).not.toHaveClass(/open/);
      await page.click('#bnav-admin-dd');
      await expect(bnavAdminMenu).toHaveClass(/open/);

      // Click 'Spieler' from the admin list
      await page.click('#bnav-admin-menu button:has-text("Spieler")');
      await expect(page.locator('#view-players')).toHaveClass(/active/);
      // Sheet should auto-close
      await expect(bnavAdminMenu).not.toHaveClass(/open/);

      // Open profile menu sheet
      const bnavProfileMenu = page.locator('#bnav-profile-menu');
      await expect(bnavProfileMenu).not.toHaveClass(/open/);
      await page.click('#bnav-profile');
      await expect(bnavProfileMenu).toHaveClass(/open/);

      // Click backdrop to close profile menu
      await page.click('#bnav-backdrop', { force: true });
      await expect(bnavProfileMenu).not.toHaveClass(/open/);

    } else {
      // On desktop views, the bottom navigation navbar is hidden, and the desktop sidebar/navbar is visible
      await expect(page.locator('#bottom-nav')).toBeHidden();
      await expect(page.locator('#main-nav')).toBeVisible();

      // Check Desktop Navigation Tabs:
      // Click 'Buchungen' tab (my-history)
      await page.click('#nav-my-history');
      await expect(page.locator('#view-my-history')).toHaveClass(/active/);

      // Click 'Transaktionen' tab (my-transactions)
      await page.click('#nav-my-transactions');
      await expect(page.locator('#view-my-transactions')).toHaveClass(/active/);

      // Click 'Sessions' tab (sessions)
      await page.click('#nav-sessions');
      await expect(page.locator('#view-sessions')).toHaveClass(/active/);

      // Toggle Admin dropdown
      const navDDMenu = page.locator('#nav-dd-menu');
      await expect(navDDMenu).not.toHaveClass(/open/);
      await page.click('#nav-dd-trigger');
      await expect(navDDMenu).toHaveClass(/open/);

      // Click 'Spieler'
      await page.click('#nav-players');
      await expect(page.locator('#view-players')).toHaveClass(/active/);
      // Dropdown should auto-close
      await expect(navDDMenu).not.toHaveClass(/open/);

      // Toggle Profile dropdown
      const profileDDMenu = page.locator('#profile-dd-menu');
      await expect(profileDDMenu).not.toHaveClass(/open/);
      await page.click('#profile-dd-trigger');
      await expect(profileDDMenu).toHaveClass(/open/);
    }
  });

  test('Should change language to English, persist it, and load in English upon reload', async ({ page, isMobile }) => {
    // 1. Initial setup
    await page.goto('/');
    const setupOverlay = page.locator('#setup-overlay');
    await expect(setupOverlay).toHaveClass(/open/);
    await page.waitForTimeout(500);

    await page.fill('#setup-teamname', 'Padel Champions');
    await page.fill('#setup-name', 'Super Admin');
    await page.fill('#setup-pin', '1337');
    await page.fill('#setup-pin2', '1337');
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'PUT'),
      page.click('#setup-overlay button.welcome-skip', { force: true }),
    ]);
    await expect(setupOverlay).not.toHaveClass(/open/, { timeout: 10000 });

    if (isMobile) {
      // Mobile Navigation & Profile Menu
      await page.click('#bnav-profile');
      const langBtn = page.locator('#bnav-profile-menu button[onclick*="openLanguageModal"]');
      await langBtn.click();
    } else {
      // Desktop Navigation & Profile Menu
      await page.click('#profile-dd-trigger');
      const langBtn = page.locator('#profile-dd-menu button[onclick*="openLanguageModal"]');
      await langBtn.click();
    }

    // 4. Verify language modal is open
    const langModal = page.locator('#mo-language');
    await expect(langModal).toHaveClass(/open/);

    // 5. Select "English" radio and save
    await page.click('#mo-language input[value="en"]');
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/players/') && resp.request().method() === 'PUT'),
      page.click('#mo-language button.btn-pri'),
    ]);

    // 6. Verify UI changed to English: "Buchungen" -> "Bookings"
    const bookingsNav = page.locator(isMobile ? '#bnav-my-history' : '#nav-my-history');
    await expect(bookingsNav).toContainText('Bookings');

    // 7. Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 8. Verify the page still loads in English
    const bookingsNavReloaded = page.locator(isMobile ? '#bnav-my-history' : '#nav-my-history');
    await expect(bookingsNavReloaded).toContainText('Bookings');
  });
});

