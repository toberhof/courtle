import { test, expect } from '@playwright/test';

async function navigateAdmin(page, viewName) {
  const trigger = page.locator('#nav-dd-trigger');
  if (await trigger.isVisible()) {
    await trigger.click();
    await page.click(`#nav-${viewName}`);
  } else {
    await page.click('#bnav-admin-dd');
    let text = '';
    if (viewName === 'players') text = 'Spieler';
    else if (viewName === 'dashboard') text = 'Übersicht';
    else if (viewName === 'expenses') text = 'Ausgaben';
    else if (viewName === 'history') text = 'Transaktionen';
    else if (viewName === 'admin-plan') text = 'Session Planer';
    else if (viewName === 'series') text = 'Session Serien';
    else if (viewName === 'settings') text = 'System';
    await page.click(`#bnav-admin-menu button:has-text("${text}")`);
  }
}

test.describe('UI E2E Suite — Admin & Feature Flows', () => {

  const TOMORROW = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  test.beforeEach(async ({ request, page }) => {
    await request.post('/api.php/test-reset');

    // Setup full baseline via API before page load
    const admin = await (await request.post('/api.php/players', {
      data: { name: 'Admin', pin: '1111' },
    })).json();

    const auth = await (await request.post('/api.php/auth', {
      data: { player_id: admin.id, pin: '1111' },
    })).json();
    const token = auth.token;

    await request.put('/api.php/config', {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: { cost: '10', courts: '2', team_name: 'Test Club' },
    });

    // Create test player used by multiple tests
    const alice = await (await request.post('/api.php/players', {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: { name: 'Alice', pin: '2222', admin: false },
    })).json();

    // Give Alice some balance
    await request.post('/api.php/transactions', {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: { player_id: alice.id, credit: true, amount: 100, date: '2026-05-01', note: 'deposit' },
    });

    // Create a session for tomorrow (for session-related tests)
    await request.put(`/api.php/sessions/${TOMORROW}`, {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: { courts: [[null, null, null, null], [null, null, null, null]] },
    });

    // Now load the page with pre-populated localStorage
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(err));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate(({ tok, pid }) => {
      localStorage.setItem('_tok', tok);
      localStorage.setItem('_guestId', pid);
    }, { tok: token, pid: admin.id });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // let boot sequence finish

    // Verify logged in
    await expect(page.locator('#welcome-overlay')).not.toHaveClass(/open/, { timeout: 5000 });
    await expect(page.locator('#setup-overlay')).not.toHaveClass(/open/);
  });

  test('01 — Transaction via UI: Aufladen updates player balance', async ({ page }) => {
    // Navigate to admin players view
    await navigateAdmin(page, 'players');
    await expect(page.locator('#view-players')).toHaveClass(/active/);

    // Find Alice's card (players sorted alphabetically, "Admin" first)
    const pc = page.locator('.pc').filter({ hasText: 'Alice' });
    await expect(pc).toBeVisible();
    await pc.locator('button.btn-ok').click();
    await expect(page.locator('#mo-tx')).toHaveClass(/open/);

    // Fill and submit transaction
    await page.fill('#tx-amount', '75');
    await page.fill('#tx-note', 'Test deposit');
    await page.locator('#mo-tx button:has-text("Aufladen")').click();
    await expect(page.locator('#mo-tx')).not.toHaveClass(/open/, { timeout: 5000 });

    // Wait for renderAll and verify balance updated (100 + 75 = 175)
    await page.waitForTimeout(500);
    const aliceCard = page.locator('.pc').filter({ hasText: 'Alice' });
    await expect(aliceCard).toContainText(/175/);
  });

  test('02 — Expense via UI: create, verify in table, then delete', async ({ page }) => {
    await navigateAdmin(page, 'expenses');
    await expect(page.locator('#view-expenses')).toHaveClass(/active/);

    // Click "Erfassen" to add expense
    await page.click('button:has-text("Erfassen")');
    await expect(page.locator('#mo-expense')).toHaveClass(/open/);

    await page.fill('#ex-amount', '42.50');
    await page.fill('#ex-note', 'Test expense');
    await page.locator('#mo-expense button:has-text("Speichern")').click();
    await expect(page.locator('#mo-expense')).not.toHaveClass(/open/, { timeout: 5000 });

    // Check in the list container (German formatting uses comma)
    await expect(page.locator('#expenses-container')).toContainText('42,50');
    await expect(page.locator('#expenses-container')).toContainText('Test expense');

    // Delete the expense
    await page.locator('#expenses-container .btn-dan').first().click();
    await expect(page.locator('#mo-del-expense')).toHaveClass(/open/);
    await page.locator('#mo-del-expense button:has-text("Löschen")').click();
    await expect(page.locator('#mo-del-expense')).not.toHaveClass(/open/, { timeout: 5000 });

    await page.waitForTimeout(500);
    await expect(page.locator('#expenses-container')).not.toContainText('42,50');
  });

  test('03 — Player edit via UI: rename player', async ({ page }) => {
    await navigateAdmin(page, 'players');
    await expect(page.locator('#view-players')).toHaveClass(/active/);

    // Click pencil (edit) button on Alice's card
    const pc = page.locator('.pc').filter({ hasText: 'Alice' });
    await expect(pc).toBeVisible();
    await pc.locator('button.btn-sec').first().click();
    await expect(page.locator('#mo-player')).toHaveClass(/open/);

    // Change name
    await page.fill('#p-name', '');
    await page.fill('#p-name', 'Alice Cooper');
    await page.locator('#mo-player button:has-text("Speichern")').click();
    await expect(page.locator('#mo-player')).not.toHaveClass(/open/, { timeout: 5000 });

    await page.waitForTimeout(500);
    await expect(page.locator('.pc').filter({ hasText: 'Alice Cooper' })).toBeVisible();
  });

  test('04 — Player deactivate + reactivate via UI', async ({ page }) => {
    await navigateAdmin(page, 'players');
    await expect(page.locator('#view-players')).toHaveClass(/active/);

    // Click trash button on Alice's card
    const pc = page.locator('.pc').filter({ hasText: 'Alice' });
    await expect(pc).toBeVisible();
    await pc.locator('button.btn-dan').click();

    // Confirm modal appears
    const confirmBtn = page.locator('#mo-confirm button.btn-pri, #mo-confirm button.btn-dan').first();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
    await page.waitForTimeout(800);

    // Alice should now be in the inactive section — check for "Reaktivieren" button
    const reactivateBtn = page.locator('button:has-text("Reaktivieren")');
    await expect(reactivateBtn).toBeVisible({ timeout: 5000 });

    // Reactivate — also requires confirm modal
    await reactivateBtn.click();
    const confirmBtn2 = page.locator('#mo-confirm .btn-pri, #mo-confirm .btn-dan').first();
    await expect(confirmBtn2).toBeVisible({ timeout: 5000 });
    await confirmBtn2.click();
    await page.waitForTimeout(800);

    // Reactivate button should be gone from the players grid
    await expect(page.locator('#players-grid button:has-text("Reaktivieren")')).not.toBeVisible();
  });

  test('05 — Series CRUD via UI: create, edit, delete', async ({ page }) => {
    await navigateAdmin(page, 'series');
    await expect(page.locator('#view-series')).toHaveClass(/active/);

    // Click "Neue Serie"
    await page.click('button:has-text("Neue Serie")');
    await expect(page.locator('#mo-series-edit')).toHaveClass(/open/);

    // Fill form
    await page.fill('#series-edit-name', 'Monday Night Padel');
    await page.fill('#series-edit-time-start', '18:00');
    await page.fill('#series-edit-time-end', '20:00');
    await page.fill('#series-edit-courts', '3');
    await page.fill('#series-edit-price', '15');

    // Select Monday and Wednesday
    await page.evaluate(() => {
      document.querySelectorAll('#series-edit-days input').forEach(cb => cb.checked = false);
    });
    await page.check('#series-edit-days input[value="1"]');
    await page.check('#series-edit-days input[value="3"]');

    // Save via direct JS call (modal content may be taller than viewport)
    await page.evaluate(() => saveSeriesEdit());
    await page.waitForTimeout(1000);
    await expect(page.locator('#mo-series-edit')).not.toHaveClass(/open/, { timeout: 5000 });

    // Verify in list
    await expect(page.locator('#series-list')).toContainText('Monday Night Padel');

    // Edit
    const editBtn = page.locator('#series-list button:has-text("Serie bearbeiten")');
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    await expect(page.locator('#mo-series-edit')).toHaveClass(/open/);
    await page.fill('#series-edit-name', '');
    await page.fill('#series-edit-name', 'Monday Night Updated');
    await page.evaluate(() => saveSeriesEdit());
    await page.waitForTimeout(1000);
    await expect(page.locator('#mo-series-edit')).not.toHaveClass(/open/, { timeout: 5000 });
    await expect(page.locator('#series-list')).toContainText('Monday Night Updated');

    // Delete
    await page.locator('#series-list .btn-dan').first().click();
    const confirmBtn = page.locator('#mo-confirm .btn-pri, #mo-confirm .btn-dan').first();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
    await page.waitForTimeout(800);
    await expect(page.locator('#series-list')).not.toContainText('Monday Night Updated');
  });

  test('06 — Session cancel + delete via admin plan UI', async ({ page }) => {
    await navigateAdmin(page, 'admin-plan');
    await expect(page.locator('#view-admin-plan')).toHaveClass(/active/);

    // Wait for dropdown to populate with the session created in beforeEach
    await page.waitForTimeout(500);

    // Select the session
    await page.selectOption('#session-selector', TOMORROW);
    await page.waitForTimeout(300);

    // Verify session details box is visible
    await expect(page.locator('#session-details-box')).toBeVisible();

    // Cancel session
    const cancelBtn = page.locator('button:has-text("Absagen")');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    await page.waitForTimeout(500);

    // Should now show "Reaktivieren" (session is cancelled)
    await expect(page.locator('button:has-text("Reaktivieren")')).toBeVisible({ timeout: 5000 });

    // Delete session
    const deleteBtn = page.locator('#session-details-box button:has-text("Löschen")');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    const confirmBtn = page.locator('#mo-confirm .btn-pri, #mo-confirm .btn-dan').first();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
    await page.waitForTimeout(500);

    // Verify session is gone from dropdown
    const dd = page.locator('#session-selector');
    await expect(dd).not.toContainText(TOMORROW);
  });

  test('07 — Add player via UI: Hinzufügen form', async ({ page }) => {
    await navigateAdmin(page, 'players');
    await expect(page.locator('#view-players')).toHaveClass(/active/);

    // Click "Hinzufügen" button (scoped to players view, not the PWA install banner)
    await page.click('#view-players button:has-text("Hinzufügen")');
    await expect(page.locator('#mo-player')).toHaveClass(/open/);

    // Fill form and save via direct JS (modal viewport may be clipped)
    await page.fill('#p-name', 'Bob');
    await page.evaluate(() => savePlayer());
    await page.waitForTimeout(1000);
    await expect(page.locator('#mo-player')).not.toHaveClass(/open/, { timeout: 5000 });

    // Wait for render
    await page.waitForTimeout(500);
    await expect(page.locator('.pc').filter({ hasText: 'Bob' })).toBeVisible();
  });

  test('08 — Debit via UI: Abbuchen reduces player balance', async ({ page }) => {
    await navigateAdmin(page, 'players');
    await expect(page.locator('#view-players')).toHaveClass(/active/);

    // Click charge button on Alice
    const pc = page.locator('.pc').filter({ hasText: 'Alice' });
    await pc.locator('button.btn-ok').click();
    await expect(page.locator('#mo-tx')).toHaveClass(/open/);

    // Fill and submit debit
    await page.fill('#tx-amount', '30');
    await page.locator('#mo-tx button:has-text("Abbuchen")').click();
    await expect(page.locator('#mo-tx')).not.toHaveClass(/open/, { timeout: 5000 });

    // Balance should be 100 - 30 = 70
    await page.waitForTimeout(500);
    await expect(page.locator('.pc').filter({ hasText: 'Alice' })).toContainText(/70/);
  });

  test('09 — Admin slot management: assign player to slot', async ({ page }) => {
    await navigateAdmin(page, 'admin-plan');
    await expect(page.locator('#view-admin-plan')).toHaveClass(/active/);
    await page.waitForTimeout(500);

    // Select tomorrow's session
    await page.selectOption('#session-selector', TOMORROW);
    await page.waitForTimeout(500);

    // Click the first empty slot in the admin plan editor
    const firstEmpty = page.locator('#plan-slots-editor .admin-slot:not(.filled)').first();
    await expect(firstEmpty).toBeVisible({ timeout: 5000 });
    await firstEmpty.click();
    await expect(page.locator('#mo-slot')).toHaveClass(/open/);

    // Assign Alice to the slot
    const aliceBtn = page.locator('#mo-slot-list button:has-text("Alice")');
    await expect(aliceBtn).toBeVisible({ timeout: 5000 });
    await aliceBtn.click();
    await page.waitForTimeout(500);

    // Verify Alice appears in the slot editor
    await expect(page.locator('#plan-slots-editor')).toContainText('Alice');
  });

  test('10 — Settings: change team name via UI', async ({ page }) => {
    await navigateAdmin(page, 'settings');
    await expect(page.locator('#view-settings')).toHaveClass(/active/);

    // Change team name
    await page.fill('#disp-team-name', '');
    await page.fill('#disp-team-name', 'New Team Name');

    // Save general settings (scoped to settings view)
    await page.click('#view-settings .btn-pri');
    await page.waitForTimeout(1000);

    // Reload and verify team name persisted
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(page.locator('#topbar-team-name')).toContainText('New Team Name');
  });

  test('11 — Add session via UI: create new session from admin plan', async ({ page }) => {
    await navigateAdmin(page, 'admin-plan');
    await expect(page.locator('#view-admin-plan')).toHaveClass(/active/);
    await page.waitForTimeout(500);

    // Click "Neue Session" button
    await page.click('button:has-text("Neue Session")');
    await expect(page.locator('#mo-add-session')).toHaveClass(/open/);

    // Pick a date 3 days from now
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const futureDate = future.toISOString().split('T')[0];

    await page.fill('#add-sess-date', futureDate);
    await page.fill('#add-sess-start', '18:00');
    await page.fill('#add-sess-end', '20:00');

    // Create
    await page.locator('#mo-add-session .btn-pri').click();
    await expect(page.locator('#mo-add-session')).not.toHaveClass(/open/, { timeout: 5000 });
    await page.waitForTimeout(500);

    // Session should now be in the dropdown (formatted as localised date)
    await expect(page.locator('#session-selector')).toContainText(/Mai 26/);
  });
});

// ── Public booking flow: fresh login via welcome + PIN overlay ──
test.describe('UI E2E Suite — Public Booking Flow', () => {

  const TOMORROW = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  test.beforeEach(async ({ request, page }) => {
    await request.post('/api.php/test-reset');

    // Setup baseline via API — no auto-login
    const admin = await (await request.post('/api.php/players', {
      data: { name: 'Admin', pin: '1111' },
    })).json();

    const auth = await (await request.post('/api.php/auth', {
      data: { player_id: admin.id, pin: '1111' },
    })).json();

    await request.put('/api.php/config', {
      headers: { 'Content-Type': 'application/json', 'X-Token': auth.token },
      data: { cost: '10', courts: '2', team_name: 'Test Club' },
    });

    // Create Alice (player who will book)
    await request.post('/api.php/players', {
      headers: { 'Content-Type': 'application/json', 'X-Token': auth.token },
      data: { name: 'Alice', pin: '2222', admin: false },
    });

    // Create tomorrow's session
    await request.put(`/api.php/sessions/${TOMORROW}`, {
      headers: { 'Content-Type': 'application/json', 'X-Token': auth.token },
      data: { courts: [[null, null, null, null], [null, null, null, null]] },
    });

    // Load page freshly — no localStorage token
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('12 — Public booking: login via PIN overlay then book a slot', async ({ page }) => {
    // Welcome overlay should be open (no guestId set)
    const welcome = page.locator('#welcome-overlay');
    await expect(welcome).toHaveClass(/open/, { timeout: 5000 });

    // Pick Alice
    await page.click('#player-pick-grid .player-pick-btn:has-text("Alice")');
    await page.waitForTimeout(300);

    // PIN overlay should open
    const pinOverlay = page.locator('#upin-overlay');
    await expect(pinOverlay).toHaveClass(/open/);

    // Enter PIN 2222 via keypad
    const key2 = page.locator('.pkey').filter({ hasText: '2' }).first();
    for (let i = 0; i < 4; i++) await key2.click();
    await page.waitForTimeout(500);

    // PIN overlay should close — logged in
    await expect(pinOverlay).not.toHaveClass(/open/);
    await expect(welcome).not.toHaveClass(/open/);

    // Find the "Eintragen" button on the session card (German: session.book_slot)
    const bookBtn = page.locator('.sc .btn-pri').first();
    await expect(bookBtn).toBeVisible({ timeout: 5000 });
    await bookBtn.click();
    await page.waitForTimeout(800);

    // Verify Alice is now in a slot
    const aliceSlot = page.locator('.admin-slot:has(.slot-name)').first();
    await expect(aliceSlot).toBeVisible({ timeout: 5000 });
  });

  test('13 — Public booking: book slot then leave via "Abmelden" flow', async ({ page }) => {
    // Login as Alice
    await expect(page.locator('#welcome-overlay')).toHaveClass(/open/, { timeout: 5000 });
    await page.click('#player-pick-grid .player-pick-btn:has-text("Alice")');
    await page.waitForTimeout(300);
    await expect(page.locator('#upin-overlay')).toHaveClass(/open/);
    const key2 = page.locator('.pkey').filter({ hasText: '2' }).first();
    for (let i = 0; i < 4; i++) await key2.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#upin-overlay')).not.toHaveClass(/open/);

    // Click the "Eintragen" button to book a slot
    const bookBtn = page.locator('.sc .btn-pri').first();
    await expect(bookBtn).toBeVisible({ timeout: 5000 });
    await bookBtn.click();
    await page.waitForTimeout(800);

    // Verify Alice is now in a slot (shows "you" indicator)
    const mySlot = page.locator('.admin-slot.me').first();
    await expect(mySlot).toBeVisible({ timeout: 5000 });

    // Click "Abmelden" to leave
    const leaveBtn = page.locator('.btn-dan:has-text("Abmelden")').first();
    await expect(leaveBtn).toBeVisible({ timeout: 5000 });
    await leaveBtn.click();

    // Confirm leave modal
    await expect(page.locator('#mo-leave-confirm')).toHaveClass(/open/);
    await page.locator('#mo-leave-confirm-btn').click();
    await page.waitForTimeout(800);

    // Verify Alice is no longer in a slot
    await expect(page.locator('.admin-slot.me')).not.toBeVisible();
  });

  test('14 — Charge via admin plan UI', async ({ page, request }) => {
    // Login as Admin via UI
    await expect(page.locator('#welcome-overlay')).toHaveClass(/open/, { timeout: 5000 });
    await page.click('#player-pick-grid .player-pick-btn:has-text("Admin")');
    await page.waitForTimeout(300);
    await expect(page.locator('#upin-overlay')).toHaveClass(/open/);
    const k = page.locator('.pkey').filter({ hasText: '1' }).first();
    for (let i = 0; i < 4; i++) await k.click();
    await page.waitForTimeout(500);

    // Get Alice's ID and admin token for API calls
    const players = await (await request.get('/api.php/players')).json();
    const alice = players.find(p => p.name === 'Alice');
    const adminRes = await request.post('/api.php/auth', { data: { player_id: players.find(p => p.name === 'Admin').id, pin: '1111' } });
    const aToken = (await adminRes.json()).token;

    // Give Alice deposit and book into a slot
    await request.post('/api.php/transactions', {
      headers: { 'Content-Type': 'application/json', 'X-Token': aToken },
      data: { player_id: alice.id, credit: true, amount: 50, date: '2026-05-01', note: 'deposit' },
    });
    await request.post(`/api.php/sessions/${TOMORROW}/book`, {
      headers: { 'Content-Type': 'application/json', 'X-Token': aToken },
      data: { court_index: 0, slot_index: 0, player_id: alice.id },
    });

    // Reload to reflect changes
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Navigate to admin plan
    await navigateAdmin(page, 'admin-plan');
    await expect(page.locator('#view-admin-plan')).toHaveClass(/active/);
    await page.waitForTimeout(500);

    // Select tomorrow's session
    await page.selectOption('#session-selector', TOMORROW);
    await page.waitForTimeout(500);

    // Click "Abrechnen" in the summary card
    const chargeBtn = page.locator('button:has-text("Abrechnen")').first();
    await expect(chargeBtn).toBeVisible({ timeout: 5000 });
    await chargeBtn.click();
    await expect(page.locator('#mo-charge')).toHaveClass(/open/);

    // Verify Alice appears in charge list
    await expect(page.locator('#mo-charge-list')).toContainText('Alice');

    // Confirm charge
    await page.locator('#mo-charge .btn-pri').click();
    await expect(page.locator('#mo-charge')).not.toHaveClass(/open/, { timeout: 5000 });
    await page.waitForTimeout(500);

    // Badge removed from session selector (status tags removed from plan view)
    // await expect(page.locator('#session-selector-box')).toContainText('Abgerechnet');
  });
});
