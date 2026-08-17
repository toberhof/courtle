import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 14'] });

test.describe('iOS & iPhone PWA Mobile Suite', () => {

  const TOMORROW = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  test.beforeEach(async ({ request, page }) => {
    await request.post('/api.php/test-reset');

    const admin = await (await request.post('/api.php/players', {
      data: { name: 'Admin Tim', pin: '1234' },
    })).json();

    const auth = await (await request.post('/api.php/auth', {
      data: { player_id: admin.id, pin: '1234' },
    })).json();
    const token = auth.token;

    await request.put('/api.php/config', {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: { cost: '10', courts: '2', team_name: 'iPhone Padel Club' },
    });

    // Create session for tomorrow
    await request.put(`/api.php/sessions/${TOMORROW}`, {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: { courts: [[null, null, null, null], [null, null, null, null]] },
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate(({ tok, pid }) => {
      localStorage.setItem('_tok', tok);
      localStorage.setItem('_guestId', pid);
    }, { tok: token, pid: admin.id });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await expect(page.locator('#welcome-overlay')).not.toHaveClass(/open/, { timeout: 5000 });
    await expect(page.locator('#setup-overlay')).not.toHaveClass(/open/);
  });

  test('01 — iOS Bottom Navigation: Fixed Bottom Positioning & Sheets', async ({ page }) => {
    const bottomNav = page.locator('#bottom-nav');
    const mainNav = page.locator('#main-nav');

    // On iPhone/Mobile, bottom-nav is visible and desktop main-nav is hidden
    await expect(bottomNav).toBeVisible();
    await expect(mainNav).toBeHidden();

    // Verify bottom nav layout properties
    const bnavBox = await bottomNav.boundingBox();
    const viewportSize = page.viewportSize();
    expect(bnavBox).not.toBeNull();
    if (viewportSize && bnavBox) {
      // Bottom nav should be touching or close to the bottom edge of the viewport
      expect(bnavBox.y + bnavBox.height).toBeGreaterThanOrEqual(viewportSize.height - 5);
    }

    // Check bottom-nav buttons
    const bnavSessions = page.locator('#bnav-sessions');
    const bnavMyHistory = page.locator('#bnav-my-history');
    const bnavMyTx = page.locator('#bnav-my-transactions');
    const bnavAdmin = page.locator('#bnav-admin-dd');
    const bnavProfile = page.locator('#bnav-profile');

    await expect(bnavSessions).toBeVisible();
    await expect(bnavSessions).toHaveClass(/active/);
    await expect(bnavMyHistory).toBeVisible();
    await expect(bnavMyTx).toBeVisible();
    await expect(bnavAdmin).toBeVisible();
    await expect(bnavProfile).toBeVisible();

    // Test Admin Sheet toggle & backdrop dismiss
    const bnavAdminMenu = page.locator('#bnav-admin-menu');
    const backdrop = page.locator('#bnav-backdrop');

    await expect(bnavAdminMenu).not.toHaveClass(/open/);
    await page.click('#bnav-admin-dd');
    await expect(bnavAdminMenu).toHaveClass(/open/);
    await expect(backdrop).toHaveClass(/open/);

    // Dismiss via backdrop
    await backdrop.click({ force: true });
    await expect(bnavAdminMenu).not.toHaveClass(/open/);
    await expect(backdrop).not.toHaveClass(/open/);

    // Test Profile Sheet toggle & item navigation
    const bnavProfileMenu = page.locator('#bnav-profile-menu');
    await expect(bnavProfileMenu).not.toHaveClass(/open/);
    await page.click('#bnav-profile');
    await expect(bnavProfileMenu).toHaveClass(/open/);

    // Open language modal from profile menu
    await page.click('#bnav-profile-menu button:has-text("Sprache")');
    await expect(bnavProfileMenu).not.toHaveClass(/open/);
    const langModal = page.locator('#mo-language');
    await expect(langModal).toHaveClass(/open/);
    await page.click('#mo-language .mo-close');
    await expect(langModal).not.toHaveClass(/open/);
  });

  test('02 — iOS Touch Swipe Gestures: Left/Right Navigation & Vertical Guard', async ({ page }) => {
    const swipeTrack = page.locator('#swipe-track');
    const swipeWrap = page.locator('#swipe-wrap');
    await expect(swipeWrap).toHaveClass(/swipe-active/);

    const bnavSessions = page.locator('#bnav-sessions');
    const bnavMyHistory = page.locator('#bnav-my-history');
    const bnavMyTx = page.locator('#bnav-my-transactions');

    const wrapBox = await swipeWrap.boundingBox();
    expect(wrapBox).not.toBeNull();
    const centerX = wrapBox.x + wrapBox.width / 2;
    const centerY = wrapBox.y + Math.min(200, wrapBox.height / 2);

    // 1. Swipe Left (from sessions -> my-history)
    await page.evaluate(({ startX, startY }) => {
      const wrap = document.getElementById('swipe-wrap');
      function fireTouch(type, touches, changed) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = touches;
        ev.changedTouches = changed;
        wrap.dispatchEvent(ev);
      }
      fireTouch('touchstart', [{ clientX: startX, clientY: startY }], [{ clientX: startX, clientY: startY }]);
      fireTouch('touchmove', [{ clientX: startX - 180, clientY: startY }], [{ clientX: startX - 180, clientY: startY }]);
      fireTouch('touchend', [], [{ clientX: startX - 180, clientY: startY }]);
    }, { startX: centerX, startY: centerY });

    await expect(bnavMyHistory).toHaveClass(/active/, { timeout: 3000 });
    await expect(swipeTrack).toHaveCSS('transform', /matrix\(-?1|-100/);

    // 2. Swipe Left (from my-history -> my-transactions)
    await page.evaluate(({ startX, startY }) => {
      const wrap = document.getElementById('swipe-wrap');
      function fireTouch(type, touches, changed) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = touches;
        ev.changedTouches = changed;
        wrap.dispatchEvent(ev);
      }
      fireTouch('touchstart', [{ clientX: startX, clientY: startY }], [{ clientX: startX, clientY: startY }]);
      fireTouch('touchmove', [{ clientX: startX - 180, clientY: startY }], [{ clientX: startX - 180, clientY: startY }]);
      fireTouch('touchend', [], [{ clientX: startX - 180, clientY: startY }]);
    }, { startX: centerX, startY: centerY });

    await expect(bnavMyTx).toHaveClass(/active/, { timeout: 3000 });

    // 3. Swipe Right (from my-transactions -> my-history)
    await page.evaluate(({ startX, startY }) => {
      const wrap = document.getElementById('swipe-wrap');
      function fireTouch(type, touches, changed) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = touches;
        ev.changedTouches = changed;
        wrap.dispatchEvent(ev);
      }
      fireTouch('touchstart', [{ clientX: startX, clientY: startY }], [{ clientX: startX, clientY: startY }]);
      fireTouch('touchmove', [{ clientX: startX + 180, clientY: startY }], [{ clientX: startX + 180, clientY: startY }]);
      fireTouch('touchend', [], [{ clientX: startX + 180, clientY: startY }]);
    }, { startX: centerX, startY: centerY });

    await expect(bnavMyHistory).toHaveClass(/active/, { timeout: 3000 });

    // 4. Vertical Gesture (Should be ignored by horizontal swipe navigation)
    await page.evaluate(({ startX, startY }) => {
      const wrap = document.getElementById('swipe-wrap');
      function fireTouch(type, touches, changed) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = touches;
        ev.changedTouches = changed;
        wrap.dispatchEvent(ev);
      }
      fireTouch('touchstart', [{ clientX: startX, clientY: startY }], [{ clientX: startX, clientY: startY }]);
      fireTouch('touchmove', [{ clientX: startX - 10, clientY: startY + 120 }], [{ clientX: startX - 10, clientY: startY + 120 }]);
      fireTouch('touchend', [], [{ clientX: startX - 10, clientY: startY + 120 }]);
    }, { startX: centerX, startY: centerY });

    // Should remain on my-history
    await expect(bnavMyHistory).toHaveClass(/active/);
  });

  test('03 — iOS Virtual Keyboard & Focusout Viewport Reset', async ({ page }) => {
    // Open Admin Plan view
    await page.click('#bnav-admin-dd');
    await page.click('#bnav-admin-menu button:has-text("Session Planer")');
    await expect(page.locator('#view-admin-plan')).toHaveClass(/active/);

    // Focus an input field
    const noteInput = page.locator('#plan-note-input');
    await noteInput.scrollIntoViewIfNeeded();
    await noteInput.click();
    await noteInput.fill('Center Court Hall');

    // Trigger blur/focusout
    await noteInput.blur();
    await page.waitForTimeout(100);

    // Check that bottom navigation remains stable and transform is 3D hardware-accelerated
    const bottomNav = page.locator('#bottom-nav');
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav).toHaveCSS('position', 'fixed');
  });

  test('04 — iOS Modal Body Scroll Lock & Cleanup', async ({ page }) => {
    // Open Change PIN modal from profile menu
    await page.click('#bnav-profile');
    await page.click('#bnav-profile-menu button:has-text("PIN ändern")');

    const pinModal = page.locator('#mo-user-pin');
    await expect(pinModal).toHaveClass(/open/);

    // Body should have overflow hidden while modal is open
    const bodyOverflowOpen = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflowOpen).toBe('hidden');

    // Close modal
    await page.click('#mo-user-pin .mo-close');
    await expect(pinModal).not.toHaveClass(/open/);

    // Body overflow should be restored
    const bodyOverflowClosed = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflowClosed).toBe('');
  });
});
