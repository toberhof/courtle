import { test, expect } from '@playwright/test';

test.describe('API Handler Integration Suite', () => {

  // Shared state helpers
  let adminToken, adminId, player1Id, player2Id, player3Id, today, sessionDate;

  test.beforeEach(async ({ request }) => {
    await request.post('/api.php/test-reset');
  });

  test('01 — Logout (DELETE /auth) + GET /me — token invalidation', async ({ request }) => {
    // Setup: create admin player
    const setupRes = await request.post('/api.php/players', {
      data: { name: 'Admin', pin: '1111' },
    });
    expect(setupRes.status()).toBe(201);
    const admin = await setupRes.json();

    // Login
    const authRes = await request.post('/api.php/auth', {
      data: { player_id: admin.id, pin: '1111' },
    });
    const auth = await authRes.json();
    expect(auth.token).toBeDefined();

    // GET /me with valid token
    const meRes = await request.get('/api.php/me', {
      headers: { 'X-Token': auth.token },
    });
    expect(meRes.status()).toBe(200);
    const me = await meRes.json();
    expect(me.player_id).toBe(admin.id);
    expect(me.admin).toBe(true);

    // Logout
    const logoutRes = await request.delete('/api.php/auth', {
      headers: { 'X-Token': auth.token },
    });
    expect(logoutRes.status()).toBe(200);

    // GET /me with same token — must be 401
    const meAfterRes = await request.get('/api.php/me', {
      headers: { 'X-Token': auth.token },
    });
    expect(meAfterRes.status()).toBe(401);
  });

  test('02 — Transactions CRUD — create, list, update, delete', async ({ request }) => {
    // Setup admin + player
    const setupRes = await request.post('/api.php/players', {
      data: { name: 'Admin', pin: '1111' },
    });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', {
      data: { player_id: admin.id, pin: '1111' },
    });
    const auth = await authRes.json();

    const pRes = await request.post('/api.php/players', {
      headers: { 'Content-Type': 'application/json', 'X-Token': auth.token },
      data: { name: 'Alice', pin: '2222', admin: false },
    });
    const player = await pRes.json();
    const token = { 'X-Token': auth.token };

    // Create a deposit
    const createRes = await request.post('/api.php/transactions', {
      headers: { ...token, 'Content-Type': 'application/json' },
      data: { player_id: player.id, credit: true, amount: 50.00, date: '2026-05-01', note: 'Initial deposit' },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeDefined();

    // List transactions (admin sees all)
    const listRes = await request.get('/api.php/transactions', { headers: token });
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].amount).toBe(50);
    expect(list[0].credit).toBe(1);

    // Update transaction
    const updateRes = await request.put(`/api.php/transactions/${created.id}`, {
      headers: { ...token, 'Content-Type': 'application/json' },
      data: { amount: 75.00, note: 'Updated deposit', date: '2026-05-02' },
    });
    expect(updateRes.status()).toBe(200);

    // Verify update
    const list2Res = await request.get('/api.php/transactions', { headers: token });
    const list2 = await list2Res.json();
    const updatedTx = list2.find(t => t.id === created.id);
    expect(updatedTx.amount).toBe(75);
    expect(updatedTx.note).toBe('Updated deposit');

    // Player sees own transactions only
    const pAuth = await request.post('/api.php/auth', { data: { player_id: player.id, pin: '2222' } });
    const pToken = (await pAuth.json()).token;
    const playerTxRes = await request.get('/api.php/transactions', {
      headers: { 'X-Token': pToken },
    });
    const playerTx = await playerTxRes.json();
    expect(playerTx.length).toBe(1);
    expect(playerTx[0].player_id).toBe(player.id);

    // Delete transaction
    const delRes = await request.delete(`/api.php/transactions/${created.id}`, { headers: token });
    expect(delRes.status()).toBe(200);

    const list3Res = await request.get('/api.php/transactions', { headers: token });
    const list3 = await list3Res.json();
    expect(list3.length).toBe(0);
  });

  test('03 — Expenses CRUD — create, list, update, delete', async ({ request }) => {
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const token = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    // Create expense
    const createRes = await request.post('/api.php/expenses', {
      headers: token,
      data: { amount: 120.00, date: '2026-05-10', note: 'New net' },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();

    // List expenses
    const listRes = await request.get('/api.php/expenses', { headers: token });
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].amount).toBe(120);

    // Update expense
    const updateRes = await request.put(`/api.php/expenses/${created.id}`, {
      headers: token,
      data: { amount: 150.00, date: '2026-05-11', note: 'New net (updated)' },
    });
    expect(updateRes.status()).toBe(200);

    const list2Res = await request.get('/api.php/expenses', { headers: token });
    const list2 = await list2Res.json();
    expect(list2[0].amount).toBe(150);

    // Delete expense
    const delRes = await request.delete(`/api.php/expenses/${created.id}`, { headers: token });
    expect(delRes.status()).toBe(200);

    const list3Res = await request.get('/api.php/expenses', { headers: token });
    expect((await list3Res.json()).length).toBe(0);
  });

  test('04 — Leave + Waitlist Auto-Promotion — player leaves, waitlist fills freed slot', async ({ request }) => {
    // Setup admin + config
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const adminHeaders = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    await request.put('/api.php/config', { headers: adminHeaders, data: { cost: '10', courts: '1' } });

    // Create 3 players
    const p1 = await (await request.post('/api.php/players', { headers: adminHeaders, data: { name: 'Anna', pin: '1111', admin: false } })).json();
    const p2 = await (await request.post('/api.php/players', { headers: adminHeaders, data: { name: 'Ben', pin: '1111', admin: false } })).json();
    const p3 = await (await request.post('/api.php/players', { headers: adminHeaders, data: { name: 'Clara', pin: '1111', admin: false } })).json();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    // Create session with 1 court (4 slots)
    await request.put(`/api.php/sessions/${date}`, {
      headers: adminHeaders,
      data: { cancel_hours: 0, courts: [[null, null, null, null]] },
    });

    // Anna books court 0 slot 0
    const bookRes = await request.post(`/api.php/sessions/${date}/book`, {
      headers: adminHeaders,
      data: { court_index: 0, slot_index: 0, player_id: p1.id },
    });
    expect(bookRes.ok()).toBe(true);

    // Fill slots 1 and 2 with Anna too
    await request.post(`/api.php/sessions/${date}/book`, {
      headers: adminHeaders,
      data: { court_index: 0, slot_index: 1, player_id: p1.id },
    });
    await request.post(`/api.php/sessions/${date}/book`, {
      headers: adminHeaders,
      data: { court_index: 0, slot_index: 2, player_id: p1.id },
    });

    // Ben and Clara join waitlist
    const aRes2 = await request.post('/api.php/auth', { data: { player_id: p2.id, pin: '1111' } });
    const t2 = (await aRes2.json()).token;
    const aRes3 = await request.post('/api.php/auth', { data: { player_id: p3.id, pin: '1111' } });
    const t3 = (await aRes3.json()).token;

    await request.post(`/api.php/sessions/${date}/join-waitlist`, {
      headers: { 'X-Token': t2, 'Content-Type': 'application/json' },
      data: { player_id: p2.id },
    });
    await request.post(`/api.php/sessions/${date}/join-waitlist`, {
      headers: { 'X-Token': t3, 'Content-Type': 'application/json' },
      data: { player_id: p3.id },
    });

    // Anna leaves one slot — Ben should be auto-promoted into it
    const leaveRes = await request.post(`/api.php/sessions/${date}/leave`, {
      headers: adminHeaders,
      data: { player_id: p1.id, court_index: 0, slot_index: 0 },
    });
    expect(leaveRes.ok()).toBe(true);

    // Verify Ben is now in court 0 slot 0
    const sessionsRes = await request.get('/api.php/sessions');
    const session = (await sessionsRes.json()).find(s => s.date === date);
    expect(session.courts[0][0]).toBe(p2.id);

    // Verify waitlist no longer contains Ben
    expect(session.waitlist).not.toContain(p2.id);
    expect(session.waitlist).toContain(p3.id);
  });

  test('05 — Charge Session — billing deducts balances correctly', async ({ request }) => {
    // Setup
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const token = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    await request.put('/api.php/config', { headers: token, data: { cost: '10', courts: '2' } });

    const pRes = await request.post('/api.php/players', { headers: token, data: { name: 'Alice', pin: '2222', admin: false } });
    const alice = await pRes.json();
    const pRes2 = await request.post('/api.php/players', { headers: token, data: { name: 'Bob', pin: '3333', admin: false } });
    const bob = await pRes2.json();

    // Add deposits
    await request.post('/api.php/transactions', {
      headers: token,
      data: { player_id: alice.id, credit: true, amount: 100, date: '2026-05-01', note: 'deposit' },
    });
    await request.post('/api.php/transactions', {
      headers: token,
      data: { player_id: bob.id, credit: true, amount: 50, date: '2026-05-01', note: 'deposit' },
    });

    // Create session
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    await request.put(`/api.php/sessions/${date}`, {
      headers: token,
      data: { courts: [[null, null, null, null], [null, null, null, null]] },
    });

    // Alice books 2 slots, Bob books 1 slot
    await request.post(`/api.php/sessions/${date}/book`, {
      headers: { 'X-Token': auth.token, 'Content-Type': 'application/json' },
      data: { court_index: 0, slot_index: 0, player_id: alice.id },
    });
    await request.post(`/api.php/sessions/${date}/book`, {
      headers: { 'X-Token': auth.token, 'Content-Type': 'application/json' },
      data: { court_index: 0, slot_index: 1, player_id: alice.id },
    });
    await request.post(`/api.php/sessions/${date}/book`, {
      headers: { 'X-Token': auth.token, 'Content-Type': 'application/json' },
      data: { court_index: 0, slot_index: 2, player_id: bob.id },
    });

    // Charge session
    const chargeRes = await request.post('/api.php/charge', {
      headers: token,
      data: { date },
    });
    expect(chargeRes.status()).toBe(200);
    const charge = await chargeRes.json();
    expect(charge.charged).toBe(2);  // Alice & Bob
    expect(charge.slots).toBe(3);

    // Verify session is charged
    const sessionsRes = await request.get('/api.php/sessions');
    const sessions = await sessionsRes.json();
    const session = sessions.find(s => s.date === date);
    expect(session.charged).toBe(true);

    // Try charging again — must fail
    const chargeAgainRes = await request.post('/api.php/charge', {
      headers: token,
      data: { date },
    });
    expect(chargeAgainRes.status()).toBe(400);

    // Verify balances: Alice had 100 - 20 (2×10), Bob had 50 - 10 (1×10)
    const playersRes = await request.get('/api.php/players');
    const players = await playersRes.json();
    const aliceData = players.find(p => p.id === alice.id);
    const bobData = players.find(p => p.id === bob.id);
    expect(aliceData.balance).toBe(80);
    expect(bobData.balance).toBe(40);
  });

  test('06 — Player Soft-Delete & Purge', async ({ request }) => {
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const token = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    const pRes = await request.post('/api.php/players', { headers: token, data: { name: 'Alice', pin: '2222', admin: false } });
    const alice = await pRes.json();

    // Create a session and book Alice
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];
    await request.put(`/api.php/sessions/${date}`, {
      headers: token,
      data: { courts: [[alice.id, null, null, null], [null, null, null, null]] },
    });

    // Soft-delete Alice
    const delRes = await request.delete(`/api.php/players/${alice.id}`, { headers: token });
    expect(delRes.status()).toBe(200);

    // Alice should have active=0 and her court slot should be cleared
    const playersRes = await request.get('/api.php/players');
    const players = await playersRes.json();
    const aliceAfter = players.find(p => p.id === alice.id);
    expect(aliceAfter.active).toBe(0);

    const sessionsRes = await request.get('/api.php/sessions');
    const session = (await sessionsRes.json()).find(s => s.date === date);
    expect(session.courts[0][0]).toBeNull();

    // Reactivate Alice
    const reactivateRes = await request.put(`/api.php/players/${alice.id}`, {
      headers: token,
      data: { active: true },
    });
    expect(reactivateRes.status()).toBe(200);

    const playersRes2 = await request.get('/api.php/players');
    expect((await playersRes2.json()).find(p => p.id === alice.id).active).toBe(1);

    // Give Alice a transaction then purge
    await request.post('/api.php/transactions', {
      headers: token,
      data: { player_id: alice.id, credit: true, amount: 100, date: '2026-05-01' },
    });

    // Hard purge
    const purgeRes = await request.delete(`/api.php/players/${alice.id}/purge`, { headers: token });
    expect(purgeRes.status()).toBe(200);

    // Alice should be completely gone
    const playersRes3 = await request.get('/api.php/players');
    expect((await playersRes3.json()).find(p => p.id === alice.id)).toBeUndefined();

    // Transaction should be reassigned to _deleted_
    const txRes = await request.get('/api.php/transactions', { headers: token });
    const txs = await txRes.json();
    expect(txs[0].player_id).toBe('_deleted_');
  });

  test('07 — Series CRUD — create, list, update, delete', async ({ request }) => {
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const token = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    // Create series
    const createRes = await request.post('/api.php/series', {
      headers: token,
      data: {
        name: 'Mixed Monday',
        daysOfWeek: [1],
        occurrences: 8,
        timeStart: '18:00',
        timeEnd: '20:00',
        courts: 3,
        price: 12.50,
        location: 'Center Court',
        cancelHours: 24,
      },
    });
    expect(createRes.status()).toBe(200);
    const created = await createRes.json();
    expect(created.id).toBeGreaterThan(0);

    // List series
    const listRes = await request.get('/api.php/series', { headers: token });
    const list = await listRes.json();
    const series = list.find(s => s.id === created.id);
    expect(series).toBeDefined();
    expect(series.name).toBe('Mixed Monday');
    expect(series.daysOfWeek).toEqual([1]);
    expect(series.occurrences).toBe(8);
    expect(series.price).toBe(12.5);

    // Update series
    const updateRes = await request.put(`/api.php/series/${created.id}`, {
      headers: token,
      data: { name: 'Mixed Monday Updated', occurrences: 10, enabled: false },
    });
    expect(updateRes.status()).toBe(200);

    const list2Res = await request.get('/api.php/series', { headers: token });
    const updated = (await list2Res.json()).find(s => s.id === created.id);
    expect(updated.name).toBe('Mixed Monday Updated');
    expect(updated.enabled).toBe(false);
    expect(updated.occurrences).toBe(10);

    // Delete series
    const delRes = await request.delete(`/api.php/series/${created.id}`, { headers: token });
    expect(delRes.status()).toBe(200);

    const list3Res = await request.get('/api.php/series', { headers: token });
    expect((await list3Res.json()).find(s => s.id === created.id)).toBeUndefined();
  });

  test('08 — Session Delete — cancel then delete a session', async ({ request }) => {
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const token = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    // Create session
    await request.put(`/api.php/sessions/${date}`, {
      headers: token,
      data: { courts: [[null, null, null, null]] },
    });

    // Verify session exists
    let sessionsRes = await request.get('/api.php/sessions');
    let sessions = await sessionsRes.json();
    expect(sessions.find(s => s.date === date)).toBeDefined();

    // Cancel session
    const cancelRes = await request.put(`/api.php/sessions/${date}`, {
      headers: token,
      data: { cancelled: true },
    });
    expect(cancelRes.status()).toBe(200);

    sessionsRes = await request.get('/api.php/sessions');
    sessions = await sessionsRes.json();
    expect(sessions.find(s => s.date === date).cancelled).toBe(true);

    // Delete cancelled session
    const delRes = await request.delete(`/api.php/sessions/${date}`, { headers: token });
    expect(delRes.status()).toBe(200);

    sessionsRes = await request.get('/api.php/sessions');
    sessions = await sessionsRes.json();
    expect(sessions.find(s => s.date === date)).toBeUndefined();

    // Try deleting non-existent session
    const delFakeRes = await request.delete('/api.php/sessions/2099-01-01', { headers: token });
    expect(delFakeRes.status()).toBe(404);
  });

  test('09 — Session History — audit log after booking, leave, and charge', async ({ request }) => {
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const token = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    await request.put('/api.php/config', { headers: token, data: { cost: '10' } });

    const pRes = await request.post('/api.php/players', { headers: token, data: { name: 'Alice', pin: '2222', admin: false } });
    const alice = await pRes.json();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    await request.put(`/api.php/sessions/${date}`, {
      headers: token,
      data: { courts: [[null, null, null, null]] },
    });

    // Book Alice
    await request.post(`/api.php/sessions/${date}/book`, {
      headers: token,
      data: { court_index: 0, slot_index: 0, player_id: alice.id },
    });

    // Check history (by date)
    let historyRes = await request.get(`/api.php/session-history?date=${date}`, { headers: token });
    let history = await historyRes.json();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some(h => h.action === 'book' && h.player_id === alice.id)).toBe(true);

    // Alice leaves
    await request.post(`/api.php/sessions/${date}/leave`, {
      headers: token,
      data: { player_id: alice.id },
    });

    historyRes = await request.get(`/api.php/session-history?date=${date}`, { headers: token });
    history = await historyRes.json();
    expect(history.some(h => h.action === 'leave' && h.player_id === alice.id)).toBe(true);

    // Get all history (no date filter)
    const allHistoryRes = await request.get('/api.php/session-history', { headers: token });
    const allHistory = await allHistoryRes.json();
    expect(allHistory.length).toBeGreaterThanOrEqual(2);

    // History filtered by date includes player_name
    expect(history[0].player_name).toBe('Alice');
  });

  test('10 — Admin edits player — PIN, admin status, name, deactivation', async ({ request }) => {
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const authRes = await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } });
    const auth = await authRes.json();
    const token = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    const pRes = await request.post('/api.php/players', { headers: token, data: { name: 'Alice', pin: '2222', admin: false } });
    const alice = await pRes.json();

    // Update name
    let updateRes = await request.put(`/api.php/players/${alice.id}`, {
      headers: token,
      data: { name: 'Alice Cooper' },
    });
    expect(updateRes.status()).toBe(200);

    let playersRes = await request.get('/api.php/players');
    let players = await playersRes.json();
    expect(players.find(p => p.id === alice.id).name).toBe('Alice Cooper');

    // Promote to admin
    updateRes = await request.put(`/api.php/players/${alice.id}`, {
      headers: token,
      data: { admin: true },
    });
    expect(updateRes.status()).toBe(200);

    // Verify admin status via login
    const aliceAuth = await request.post('/api.php/auth', { data: { player_id: alice.id, pin: '2222' } });
    const aliceData = await aliceAuth.json();
    expect(aliceData.admin).toBe(true);

    // Change PIN
    updateRes = await request.put(`/api.php/players/${alice.id}`, {
      headers: token,
      data: { pin: '9999' },
    });
    expect(updateRes.status()).toBe(200);

    const oldAuth = await request.post('/api.php/auth', { data: { player_id: alice.id, pin: '2222' } });
    expect(oldAuth.status()).toBe(401);

    const newAuth = await request.post('/api.php/auth', { data: { player_id: alice.id, pin: '9999' } });
    expect(newAuth.status()).toBe(200);

    // Deactivate player
    updateRes = await request.put(`/api.php/players/${alice.id}`, {
      headers: token,
      data: { active: false },
    });
    expect(updateRes.status()).toBe(200);

    playersRes = await request.get('/api.php/players');
    players = await playersRes.json();
    expect(players.find(p => p.id === alice.id).active).toBe(0);
  });

  test('13 — Series Public Access and Non-Admin Booking Validation', async ({ request }) => {
    // 1. Setup Admin & Player
    const adminRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await adminRes.json();
    const adminAuth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const adminToken = { 'X-Token': adminAuth.token, 'Content-Type': 'application/json' };

    const playerRes = await request.post('/api.php/players', { headers: adminToken, data: { name: 'Bob', pin: '2222' } });
    const bob = await playerRes.json();
    const bobAuth = await (await request.post('/api.php/auth', { data: { player_id: bob.id, pin: '2222' } })).json();
    const bobToken = { 'X-Token': bobAuth.token, 'Content-Type': 'application/json' };

    // 2. Public GET /series without any token
    const publicSeriesRes = await request.get('/api.php/series');
    expect(publicSeriesRes.status()).toBe(200);
    const initialSeries = await publicSeriesRes.json();
    expect(Array.isArray(initialSeries)).toBe(true);

    // 3. Create a series for tomorrow's day of week (occurrences: 2, courts: 2)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.getDay();
    const tomorrowDS = tomorrow.toISOString().slice(0, 10);

    const createSeriesRes = await request.post('/api.php/series', {
      headers: adminToken,
      data: {
        name: 'Weekly Match',
        daysOfWeek: [tomorrowDay],
        occurrences: 2,
        timeStart: '18:00',
        timeEnd: '20:00',
        courts: 2,
      }
    });
    expect(createSeriesRes.status()).toBe(200);

    // 4. Bob (non-admin) books tomorrow's date (valid series date, not in DB yet)
    const validBookRes = await request.post(`/api.php/sessions/${tomorrowDS}/book`, {
      headers: bobToken,
      data: { court_index: 0, slot_index: 0, player_id: bob.id }
    });
    expect(validBookRes.status()).toBe(200);
    const validBookJson = await validBookRes.json();
    expect(validBookJson.ok).toBe(true);

    // 5. Bob tries to book an invalid future date (e.g. 100 days from now, outside occurrences)
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 100);
    const farFutureDS = farFuture.toISOString().slice(0, 10);

    const invalidDateRes = await request.post(`/api.php/sessions/${farFutureDS}/book`, {
      headers: bobToken,
      data: { court_index: 0, slot_index: 0, player_id: bob.id }
    });
    expect(invalidDateRes.status()).toBe(400);

    // 6. Bob tries to book an invalid court index (e.g. court 5 when max is 2) on a new series date
    const nextWeek = new Date(tomorrow);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekDS = nextWeek.toISOString().slice(0, 10);

    const invalidCourtRes = await request.post(`/api.php/sessions/${nextWeekDS}/book`, {
      headers: bobToken,
      data: { court_index: 5, slot_index: 0, player_id: bob.id }
    });
    expect(invalidCourtRes.status()).toBe(400);
  });

  test('14 — Custom Court Names & Auto-Compaction on Leave', async ({ request }) => {
    // 1. Setup Admin & Players
    const adminRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await adminRes.json();
    const adminAuth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const adminToken = { 'X-Token': adminAuth.token, 'Content-Type': 'application/json' };

    // Enable auto_compact_slots in config
    await request.put('/api.php/config', {
      headers: adminToken,
      data: { auto_compact_slots: '1', courts: '2' }
    });

    const players = [];
    const tokens = [];
    for (let i = 1; i <= 6; i++) {
      const pRes = await request.post('/api.php/players', { headers: adminToken, data: { name: `P${i}`, pin: `${i}${i}${i}${i}` } });
      const p = await pRes.json();
      players.push(p);
      const auth = await (await request.post('/api.php/auth', { data: { player_id: p.id, pin: `${i}${i}${i}${i}` } })).json();
      tokens.push({ 'X-Token': auth.token, 'Content-Type': 'application/json' });
    }

    const testDate = '2026-11-20';

    // 2. Set custom court names on session
    const updateRes = await request.put(`/api.php/sessions/${testDate}`, {
      headers: adminToken,
      data: {
        courtNames: ['Court 3', 'Court 7'],
        timeStart: '18:00',
        timeEnd: '20:00'
      }
    });
    expect(updateRes.status()).toBe(200);

    const sessionsRes = await request.get('/api.php/sessions');
    const sessions = await sessionsRes.json();
    const sess = sessions.find(s => s.date === testDate);
    expect(sess).toBeTruthy();
    expect(sess.courtNames).toEqual(['Court 3', 'Court 7']);

    // 3. Book P1, P2, P3, P4 on Court 0, and P5 on Court 1
    await request.post(`/api.php/sessions/${testDate}/book`, { headers: tokens[0], data: { court_index: 0, slot_index: 0, player_id: players[0].id } });
    await request.post(`/api.php/sessions/${testDate}/book`, { headers: tokens[1], data: { court_index: 0, slot_index: 1, player_id: players[1].id } });
    await request.post(`/api.php/sessions/${testDate}/book`, { headers: tokens[2], data: { court_index: 0, slot_index: 2, player_id: players[2].id } });
    await request.post(`/api.php/sessions/${testDate}/book`, { headers: tokens[3], data: { court_index: 0, slot_index: 3, player_id: players[3].id } });
    await request.post(`/api.php/sessions/${testDate}/book`, { headers: tokens[4], data: { court_index: 1, slot_index: 0, player_id: players[4].id } });

    // 4. P2 leaves -> Auto-compaction should shift P3, P4, P5 up, leaving Court 0 full and Court 1 empty
    const leaveRes = await request.post(`/api.php/sessions/${testDate}/leave`, {
      headers: tokens[1],
      data: { player_id: players[1].id }
    });
    expect(leaveRes.status()).toBe(200);

    const afterLeaveRes = await request.get('/api.php/sessions');
    const afterLeaveSess = (await afterLeaveRes.json()).find(s => s.date === testDate);
    expect(afterLeaveSess.courts[0]).toEqual([players[0].id, players[2].id, players[3].id, players[4].id]);
    expect(afterLeaveSess.courts[1]).toEqual([null, null, null, null]);

    // 5. Add P6 to waitlist
    const wlRes = await request.post(`/api.php/sessions/${testDate}/join-waitlist`, {
      headers: tokens[5],
      data: { player_id: players[5].id }
    });
    expect(wlRes.status()).toBe(200);

    // 6. P3 leaves -> P4, P5 shift up, and P6 from waitlist fills the 4th slot
    await request.post(`/api.php/sessions/${testDate}/leave`, {
      headers: tokens[2],
      data: { player_id: players[2].id }
    });

    const finalRes = await request.get('/api.php/sessions');
    const finalSess = (await finalRes.json()).find(s => s.date === testDate);
    expect(finalSess.courts[0]).toEqual([players[0].id, players[3].id, players[4].id, players[5].id]);
    expect(finalSess.waitlist).toEqual([]);
  });

  test('15 — Guest Booking, Access Control & Targeted Removal', async ({ request }) => {
    const adminRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await adminRes.json();
    const adminAuth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const adminToken = { 'X-Token': adminAuth.token, 'Content-Type': 'application/json' };

    const p1Res = await request.post('/api.php/players', { headers: adminToken, data: { name: 'Alice', pin: '2222' } });
    const alice = await p1Res.json();
    const aliceAuth = await (await request.post('/api.php/auth', { data: { player_id: alice.id, pin: '2222' } })).json();
    const aliceToken = { 'X-Token': aliceAuth.token, 'Content-Type': 'application/json' };

    const p2Res = await request.post('/api.php/players', { headers: adminToken, data: { name: 'Bob', pin: '3333' } });
    const bob = await p2Res.json();
    const bobAuth = await (await request.post('/api.php/auth', { data: { player_id: bob.id, pin: '3333' } })).json();
    const bobToken = { 'X-Token': bobAuth.token, 'Content-Type': 'application/json' };

    const testDate = '2026-12-01';
    await request.put(`/api.php/sessions/${testDate}`, {
      headers: adminToken,
      data: { courts: [[null, null, null, null], [null, null, null, null]] }
    });

    // Alice books for herself (slot 0) and a guest (slot 1)
    const b1 = await request.post(`/api.php/sessions/${testDate}/book`, {
      headers: aliceToken,
      data: { court_index: 0, slot_index: 0, player_id: alice.id }
    });
    expect(b1.status()).toBe(200);

    const guestPid = `${alice.id}|Gast Max`;
    const b2 = await request.post(`/api.php/sessions/${testDate}/book`, {
      headers: aliceToken,
      data: { court_index: 0, slot_index: 1, player_id: guestPid }
    });
    expect(b2.status()).toBe(200);

    // Bob tries to remove Alice's guest -> 403 Forbidden
    const bobLeaveGuest = await request.post(`/api.php/sessions/${testDate}/leave`, {
      headers: bobToken,
      data: { court_index: 0, slot_index: 1, player_id: guestPid }
    });
    expect(bobLeaveGuest.status()).toBe(403);

    // Alice removes her guest specifically via court_index and slot_index
    const aliceLeaveGuest = await request.post(`/api.php/sessions/${testDate}/leave`, {
      headers: aliceToken,
      data: { court_index: 0, slot_index: 1, player_id: guestPid }
    });
    expect(aliceLeaveGuest.status()).toBe(200);

    // Verify slot 1 is now empty while Alice (slot 0) remains
    const sessRes = await request.get('/api.php/sessions');
    const sess = (await sessRes.json()).find(s => s.date === testDate);
    expect(sess.courts[0][0]).toBe(alice.id);
    expect(sess.courts[0][1]).toBeNull();
  });

  test('16 — Cancellation Deadline Enforcement & Admin Override', async ({ request }) => {
    const adminRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await adminRes.json();
    const adminAuth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const adminToken = { 'X-Token': adminAuth.token, 'Content-Type': 'application/json' };

    const pRes = await request.post('/api.php/players', { headers: adminToken, data: { name: 'Alice', pin: '2222' } });
    const alice = await pRes.json();
    const aliceAuth = await (await request.post('/api.php/auth', { data: { player_id: alice.id, pin: '2222' } })).json();
    const aliceToken = { 'X-Token': aliceAuth.token, 'Content-Type': 'application/json' };

    // Create session today with timeStart 1 hour from now, and cancel_hours: 4.0 (deadline was 3 hours ago)
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const targetHour = Math.min(23, now.getHours() + 1);
    const timeStart = `${String(targetHour).padStart(2, '0')}:00`;

    await request.put(`/api.php/sessions/${today}`, {
      headers: adminToken,
      data: {
        courts: [[alice.id, null, null, null]],
        timeStart,
        cancelHours: 4.0 // deadline expired 3 hours ago
      }
    });

    // Alice tries to leave -> 403 Forbidden ("Abmeldefrist abgelaufen")
    const leaveRes = await request.post(`/api.php/sessions/${today}/leave`, {
      headers: aliceToken,
      data: { player_id: alice.id }
    });
    expect(leaveRes.status()).toBe(403);
    const leaveErr = await leaveRes.json();
    expect(leaveErr.error).toContain('Abmeldefrist');

    // Admin overrides by updating session courts directly
    const adminOverrideRes = await request.put(`/api.php/sessions/${today}`, {
      headers: adminToken,
      data: { courts: [[null, null, null, null]] }
    });
    expect(adminOverrideRes.status()).toBe(200);

    const checkRes = await request.get('/api.php/sessions');
    const checkSess = (await checkRes.json()).find(s => s.date === today);
    expect(checkSess.courts[0][0]).toBeNull();
  });

  test('17 — Waitlist Multi-User Management & Removal', async ({ request }) => {
    const adminRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await adminRes.json();
    const adminAuth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const adminToken = { 'X-Token': adminAuth.token, 'Content-Type': 'application/json' };

    const p1 = await (await request.post('/api.php/players', { headers: adminToken, data: { name: 'P1', pin: '1001' } })).json();
    const p2 = await (await request.post('/api.php/players', { headers: adminToken, data: { name: 'P2', pin: '1002' } })).json();
    const p3 = await (await request.post('/api.php/players', { headers: adminToken, data: { name: 'P3', pin: '1003' } })).json();

    const t1 = { 'X-Token': (await (await request.post('/api.php/auth', { data: { player_id: p1.id, pin: '1001' } })).json()).token, 'Content-Type': 'application/json' };
    const t2 = { 'X-Token': (await (await request.post('/api.php/auth', { data: { player_id: p2.id, pin: '1002' } })).json()).token, 'Content-Type': 'application/json' };
    const t3 = { 'X-Token': (await (await request.post('/api.php/auth', { data: { player_id: p3.id, pin: '1003' } })).json()).token, 'Content-Type': 'application/json' };

    const futureDate = '2026-12-15';
    // Full court
    await request.put(`/api.php/sessions/${futureDate}`, {
      headers: adminToken,
      data: { courts: [['dummy1', 'dummy2', 'dummy3', 'dummy4']] }
    });

    // P1, P2, P3 join waitlist
    await request.post(`/api.php/sessions/${futureDate}/join-waitlist`, { headers: t1, data: { player_id: p1.id } });
    await request.post(`/api.php/sessions/${futureDate}/join-waitlist`, { headers: t2, data: { player_id: p2.id } });
    await request.post(`/api.php/sessions/${futureDate}/join-waitlist`, { headers: t3, data: { player_id: p3.id } });

    let sess = (await (await request.get('/api.php/sessions')).json()).find(s => s.date === futureDate);
    expect(sess.waitlist).toEqual([p1.id, p2.id, p3.id]);

    // P2 leaves waitlist via leave endpoint
    await request.post(`/api.php/sessions/${futureDate}/leave`, { headers: t2, data: { player_id: p2.id } });

    sess = (await (await request.get('/api.php/sessions')).json()).find(s => s.date === futureDate);
    expect(sess.waitlist).toEqual([p1.id, p3.id]);

    // P1 leaves waitlist
    await request.post(`/api.php/sessions/${futureDate}/leave`, { headers: t1, data: { player_id: p1.id } });

    sess = (await (await request.get('/api.php/sessions')).json()).find(s => s.date === futureDate);
    expect(sess.waitlist).toEqual([p3.id]);
  });

  test('18 — Server Build Header & Config Version Delivery', async ({ request }) => {
    const configRes = await request.get('/api.php/config');
    expect(configRes.headers()['x-courtle-build']).toBeDefined();
    const config = await configRes.json();
    expect(config.server_build).toBeDefined();
    expect(parseInt(config.server_build, 10)).toBeGreaterThan(0);
  });

  test('19 — Database Export & Import — full state backup and restoration', async ({ request }) => {
    // 0. Setup admin player
    const admin = await (await request.post('/api.php/players', {
      data: { name: 'Admin', pin: '1111' },
    })).json();
    const auth = await (await request.post('/api.php/auth', {
      data: { player_id: admin.id, pin: '1111' },
    })).json();
    const token = auth.token;

    // 1. Unauthenticated / non-admin access should be denied
    const denied = await request.get('/api.php/export');
    expect(denied.status()).toBe(401);

    // 2. Perform export as admin
    const exportRes = await request.get('/api.php/export', {
      headers: { 'X-Token': token },
    });
    expect(exportRes.status()).toBe(200);
    const dump = await exportRes.json();
    expect(Array.isArray(dump.players)).toBe(true);
    expect(Array.isArray(dump.transactions)).toBe(true);
    expect(Array.isArray(dump.sessions)).toBe(true);
    expect(dump.players.length).toBeGreaterThan(0);

    const originalNames = dump.players.map(p => p.name);

    // 3. Create a temporary player
    await request.post('/api.php/players', {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: { name: 'TempPlayerToDelete', pin: '9999' },
    });

    const playersBefore = await (await request.get('/api.php/players')).json();
    expect(playersBefore.some(p => p.name === 'TempPlayerToDelete')).toBe(true);

    // 4. Import the original dump back
    const importRes = await request.post('/api.php/import', {
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      data: dump,
    });
    expect(importRes.status()).toBe(200);
    const importJson = await importRes.json();
    expect(importJson.ok).toBe(true);

    // 5. Verify database was restored and TempPlayerToDelete is gone
    const playersAfter = await (await request.get('/api.php/players')).json();
    expect(playersAfter.some(p => p.name === 'TempPlayerToDelete')).toBe(false);
    expect(playersAfter.map(p => p.name)).toEqual(expect.arrayContaining(originalNames));
  });

  test('Billing — batch charge, atomicity, direct payment and revert', async ({ request }) => {
    const admin = await (await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } })).json();
    const auth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const H = { 'X-Token': auth.token, 'Content-Type': 'application/json' };
    await request.put('/api.php/config', { headers: H, data: { cost: '10', courts: '1' } });
    const alice = await (await request.post('/api.php/players', { headers: H, data: { name: 'Alice', pin: '2222', admin: false } })).json();
    const bob = await (await request.post('/api.php/players', { headers: H, data: { name: 'Bob', pin: '3333', admin: false } })).json();

    const mk = async (date) => {
      const r = await (await request.put('/api.php/sessions/new', { headers: H, data: { date, courts: [[null,null,null,null]], timeStart: '1900', timeEnd: '2100' } })).json();
      const id = r.id || date;
      await request.post(`/api.php/sessions/${id}/book`, { headers: H, data: { court_index: 0, slot_index: 0, player_id: alice.id } });
      await request.post(`/api.php/sessions/${id}/book`, { headers: H, data: { court_index: 0, slot_index: 1, player_id: bob.id } });
      return id;
    };
    const s1 = await mk('2099-01-05');
    const s2 = await mk('2099-01-07');
    const bal = async (pid) => (await (await request.get('/api.php/players', { headers: H })).json()).find(p => p.id === pid).balance;

    // Atomic: charge s1 alone, then batch [s2, s1] must fail and leave s2 uncharged
    expect((await request.post('/api.php/charge', { headers: H, data: { items: [{ id: s1, paid_pids: [] }] } })).status()).toBe(200);
    const bad = await request.post('/api.php/charge', { headers: H, data: { items: [{ id: s2, paid_pids: [] }, { id: s1, paid_pids: [] }] } });
    expect(bad.status()).toBe(400);
    const sess = await (await request.get('/api.php/sessions', { headers: H })).json();
    expect(sess.find(s => s.id === s2).charged).toBe(false);

    // Revert s1, then batch charge both; Bob pays directly for s2 only
    expect((await request.delete(`/api.php/charge/${s1}`, { headers: H })).status()).toBe(200);
    const ok = await request.post('/api.php/charge', { headers: H, data: { items: [{ id: s1, paid_pids: [] }, { id: s2, paid_pids: [bob.id] }] } });
    expect(ok.status()).toBe(200);
    expect(await bal(alice.id)).toBe(-20);
    expect(await bal(bob.id)).toBe(-10); // 2x10 debit, 1x10 direct payment

    // Revert s2: Bob back to -10 + 0 (only s1 debit remains), history logged
    expect((await request.delete(`/api.php/charge/${s2}`, { headers: H })).status()).toBe(200);
    expect(await bal(bob.id)).toBe(-10);
    expect(await bal(alice.id)).toBe(-10);
    expect((await request.delete(`/api.php/charge/${s2}`, { headers: H })).status()).toBe(400); // not charged anymore
    const hist = await (await request.get(`/api.php/session-history?session_id=${s2}`, { headers: H })).json();
    expect(hist.map(h => h.action)).toEqual(expect.arrayContaining(['charged', 'charge_reverted']));
  });

  test('Billing — TC-API-01: Fair division of custom total price', async ({ request }) => {
    const admin = await (await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } })).json();
    const auth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const H = { 'X-Token': auth.token, 'Content-Type': 'application/json' };
    const pA = await (await request.post('/api.php/players', { headers: H, data: { name: 'PlayerA', pin: '2222' } })).json();
    const pB = await (await request.post('/api.php/players', { headers: H, data: { name: 'PlayerB', pin: '3333' } })).json();
    const pC = await (await request.post('/api.php/players', { headers: H, data: { name: 'PlayerC', pin: '4444' } })).json();

    const r = await (await request.put('/api.php/sessions/new', { headers: H, data: { date: '2099-02-01', courts: [[null,null,null,null]], timeStart: '1900', timeEnd: '2100' } })).json();
    const sid = r.id;
    // pA has 2 slots (1 self + 1 guest), pB has 1 slot, pC has 1 slot = 4 slots total
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 0, player_id: pA.id } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 1, player_id: `${pA.id}|g1` } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 2, player_id: pB.id } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 3, player_id: pC.id } });

    // Charge with total_price: 60.00 -> 15.00 / slot
    const chargeRes = await request.post('/api.php/charge', {
      headers: H,
      data: { items: [{ id: sid, total_price: 60, paid_pids: [] }] }
    });
    expect(chargeRes.status()).toBe(200);

    const players = await (await request.get('/api.php/players', { headers: H })).json();
    expect(players.find(p => p.id === pA.id).balance).toBe(-30);
    expect(players.find(p => p.id === pB.id).balance).toBe(-15);
    expect(players.find(p => p.id === pC.id).balance).toBe(-15);

    const sess = (await (await request.get('/api.php/sessions', { headers: H })).json()).find(s => s.id === sid);
    expect(sess.price).toBe(15);
  });

  test('Billing — TC-API-02 & TC-API-05: Splitwise rounding, player outlay and atomic revert', async ({ request }) => {
    const admin = await (await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } })).json();
    const auth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const H = { 'X-Token': auth.token, 'Content-Type': 'application/json' };
    await request.put('/api.php/config', { headers: H, data: { billing_rounding: 'exact' } });

    const pA = await (await request.post('/api.php/players', { headers: H, data: { name: 'Lukas', pin: '2222' } })).json();
    const pB = await (await request.post('/api.php/players', { headers: H, data: { name: 'PlayerB', pin: '3333' } })).json();
    const pC = await (await request.post('/api.php/players', { headers: H, data: { name: 'PlayerC', pin: '4444' } })).json();

    const r = await (await request.put('/api.php/sessions/new', { headers: H, data: { date: '2099-02-05', courts: [[null,null,null,null]], timeStart: '1900', timeEnd: '2100' } })).json();
    const sid = r.id;
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 0, player_id: pA.id } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 1, player_id: pB.id } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 2, player_id: pC.id } });

    // 40.00 split across 3 slots with paid_by_player_id = Lukas (pA)
    const chargeRes = await request.post('/api.php/charge', {
      headers: H,
      data: {
        items: [{
          id: sid,
          total_price: 40,
          paid_by_player_id: pA.id
        }]
      }
    });
    expect(chargeRes.status()).toBe(200);

    const players = await (await request.get('/api.php/players', { headers: H })).json();
    // In exact mode with pA as payer: pA gets -13.34 debit + 40.00 credit = +26.66
    expect(players.find(p => p.id === pA.id).balance).toBe(26.66);
    expect(players.find(p => p.id === pB.id).balance).toBe(-13.33);
    expect(players.find(p => p.id === pC.id).balance).toBe(-13.33);

    // Sum of net balances across participants = 26.66 - 13.33 - 13.33 = 0.00 !
    const netSum = players.filter(p => [pA.id, pB.id, pC.id].includes(p.id)).reduce((acc, p) => acc + p.balance, 0);
    expect(Math.abs(netSum)).toBeLessThan(0.001);

    // Verify expense created with session_id
    const expenses = await (await request.get('/api.php/expenses', { headers: H })).json();
    const exp = expenses.find(e => e.sessionId === sid || e.session_id === sid);
    expect(exp).toBeDefined();
    expect(parseFloat(exp.amount)).toBe(40);
    expect(exp.paidBy || exp.paid_by).toBe(pA.id);

    // Revert charge (TC-API-05)
    const rev = await request.delete(`/api.php/charge/${sid}`, { headers: H });
    expect(rev.status()).toBe(200);

    const playersAfter = await (await request.get('/api.php/players', { headers: H })).json();
    expect(playersAfter.find(p => p.id === pA.id).balance).toBe(0);
    expect(playersAfter.find(p => p.id === pB.id).balance).toBe(0);
    expect(playersAfter.find(p => p.id === pC.id).balance).toBe(0);

    const expensesAfter = await (await request.get('/api.php/expenses', { headers: H })).json();
    expect(expensesAfter.some(e => (e.sessionId || e.session_id) === sid)).toBe(false);
  });

  test('Billing — TC-API-03 & TC-API-04: Rounding modes (ceil, round) and team single expense', async ({ request }) => {
    const admin = await (await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } })).json();
    const auth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const H = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    const pA = await (await request.post('/api.php/players', { headers: H, data: { name: 'P1', pin: '2222' } })).json();
    const pB = await (await request.post('/api.php/players', { headers: H, data: { name: 'P2', pin: '3333' } })).json();
    const pC = await (await request.post('/api.php/players', { headers: H, data: { name: 'P3', pin: '4444' } })).json();

    const makeSess = async (d) => {
      const r = await (await request.put('/api.php/sessions/new', { headers: H, data: { date: d, courts: [[null,null,null,null]], timeStart: '1900', timeEnd: '2100' } })).json();
      const sid = r.id;
      await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 0, player_id: pA.id } });
      await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 1, player_id: pB.id } });
      await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 2, player_id: pC.id } });
      return sid;
    };

    // 1. Ceil mode
    await request.put('/api.php/config', { headers: H, data: { billing_rounding: 'ceil' } });
    const sCeil = await makeSess('2099-03-01');
    await request.post('/api.php/charge', { headers: H, data: { items: [{ id: sCeil, total_price: 40 }] } });

    let players = await (await request.get('/api.php/players', { headers: H })).json();
    expect(players.find(p => p.id === pA.id).balance).toBe(-13.34);
    expect(players.find(p => p.id === pB.id).balance).toBe(-13.34);
    expect(players.find(p => p.id === pC.id).balance).toBe(-13.34);

    // 2. Round mode + record_team_expense (TC-API-04)
    await request.put('/api.php/config', { headers: H, data: { billing_rounding: 'round' } });
    const sRound = await makeSess('2099-03-02');
    await request.post('/api.php/charge', {
      headers: H,
      data: {
        items: [{
          id: sRound,
          total_price: 40,
          record_team_expense: true
        }]
      }
    });

    players = await (await request.get('/api.php/players', { headers: H })).json();
    // delta from sRound was 13.33 each
    expect(players.find(p => p.id === pA.id).balance).toBe(-26.67);
    expect(players.find(p => p.id === pB.id).balance).toBe(-26.67);
    expect(players.find(p => p.id === pC.id).balance).toBe(-26.67);

    // Check team expense record created
    const expenses = await (await request.get('/api.php/expenses', { headers: H })).json();
    const exp = expenses.find(e => (e.sessionId || e.session_id) === sRound);
    expect(exp).toBeDefined();
    expect(parseFloat(exp.amount)).toBe(40);
    expect(exp.paidBy || exp.paid_by).toBeNull();
  });

  test('Billing — individual guest direct payment (paid_slots)', async ({ request }) => {
    const setupRes = await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } });
    const admin = await setupRes.json();
    const auth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const H = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    await request.put('/api.php/config', { headers: H, data: { cost: '10', courts: '1' } });
    const alice = await (await request.post('/api.php/players', { headers: H, data: { name: 'Alice', pin: '2222' } })).json();
    const bob = await (await request.post('/api.php/players', { headers: H, data: { name: 'Bob', pin: '3333' } })).json();

    const sRes = await (await request.put('/api.php/sessions/new', {
      headers: H,
      data: { date: '2099-04-01', courts: [[null, null, null, null]], timeStart: '18:00', timeEnd: '20:00' }
    })).json();
    const sid = sRes.id;

    // Alice books herself + 2 guests; Bob books himself
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 0, player_id: alice.id } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 1, player_id: `${alice.id}|g1` } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 2, player_id: `${alice.id}|g2` } });
    await request.post(`/api.php/sessions/${sid}/book`, { headers: H, data: { court_index: 0, slot_index: 3, player_id: bob.id } });

    // Only Guest 1 of Alice paid directly
    const chargeRes = await request.post('/api.php/charge', {
      headers: H,
      data: { items: [{ id: sid, total_price: 40, paid_slots: [`${alice.id}|g1`] }] }
    });
    expect(chargeRes.ok()).toBeTruthy();

    const players = await (await request.get('/api.php/players', { headers: H })).json();
    // Alice: -30 (3 slots) + 10 (1 guest direct) = -20; Bob: -10
    expect(players.find(p => p.id === alice.id).balance).toBe(-20);
    expect(players.find(p => p.id === bob.id).balance).toBe(-10);
  });

  test('Waitlist promotion — email notifications opt-in, language, and compaction', async ({ request }) => {
    const admin = await (await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } })).json();
    const auth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const H = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    await request.put('/api.php/config', { headers: H, data: { courts: '1', cancel_hours: '0', team_name: 'Padel-Frechen' } });

    const p1 = await (await request.post('/api.php/players', { headers: H, data: { name: 'Player1', pin: '1001' } })).json();
    const p2 = await (await request.post('/api.php/players', { headers: H, data: { name: 'Player2', pin: '1002' } })).json();
    const p3 = await (await request.post('/api.php/players', { headers: H, data: { name: 'Player3', pin: '1003' } })).json();
    const p4 = await (await request.post('/api.php/players', { headers: H, data: { name: 'Player4', pin: '1004' } })).json();
    const wlOptedIn = await (await request.post('/api.php/players', { headers: H, data: { name: 'WaitlistYes', pin: '1005' } })).json();
    const wlOptedOut = await (await request.post('/api.php/players', { headers: H, data: { name: 'WaitlistNo', pin: '1006' } })).json();

    // 1. Default notify_email is 0
    let players = await (await request.get('/api.php/players', { headers: H })).json();
    expect(players.find(p => p.id === wlOptedIn.id).notify_email).toBe(0);

    // 2. Enabling notify_email without valid email returns 400
    const badOptIn = await request.put(`/api.php/players/${wlOptedIn.id}`, {
      headers: H,
      data: { notify_email: 1 }
    });
    expect(badOptIn.status()).toBe(400);

    // 3. Set email + opt-in + English profile language on wlOptedIn
    const goodOptIn = await request.put(`/api.php/players/${wlOptedIn.id}`, {
      headers: H,
      data: { contact: 'yes@example.com', notify_email: 1, language: 'en' }
    });
    expect(goodOptIn.ok()).toBeTruthy();

    // Set email on wlOptedOut, keep notify_email = 0
    await request.put(`/api.php/players/${wlOptedOut.id}`, {
      headers: H,
      data: { contact: 'no@example.com', notify_email: 0 }
    });

    players = await (await request.get('/api.php/players', { headers: H })).json();
    expect(players.find(p => p.id === wlOptedIn.id).notify_email).toBe(1);
    expect(players.find(p => p.id === wlOptedOut.id).notify_email).toBe(0);

    // 4. Create session and fill 4 slots + 2 waitlist entries
    const sRes = await (await request.put('/api.php/sessions/new', {
      headers: H,
      data: {
        date: '2099-05-01',
        name: 'Friday Event',
        location: 'Hall A',
        timeStart: '18:00',
        timeEnd: '20:00',
        courts: [[p1.id, p2.id, p3.id, p4.id]]
      }
    })).json();
    const sid = sRes.id;

    // Join waitlist: wlOptedOut first, then wlOptedIn
    await request.post(`/api.php/sessions/${sid}/join-waitlist`, { headers: H, data: { player_id: wlOptedOut.id } });
    await request.post(`/api.php/sessions/${sid}/join-waitlist`, { headers: H, data: { player_id: wlOptedIn.id } });

    // p1 leaves -> wlOptedOut promoted (notify_email=0 -> NO email sent)
    const leave1 = await request.post(`/api.php/sessions/${sid}/leave`, { headers: H, data: { player_id: p1.id } });
    expect(leave1.ok()).toBeTruthy();

    let emails = await (await request.get('/api.php/test-emails')).json();
    expect(emails.length).toBe(0);

    // p2 leaves -> wlOptedIn promoted (notify_email=1, language='en' -> email sent in English)
    const leave2 = await request.post(`/api.php/sessions/${sid}/leave`, { headers: H, data: { player_id: p2.id } });
    expect(leave2.ok()).toBeTruthy();

    emails = await (await request.get('/api.php/test-emails')).json();
    expect(emails.length).toBe(1);
    expect(emails[0].from).toBe('Padel-Frechen <noreply@test.local>');
    expect(emails[0].to).toEqual(['yes@example.com']);
    expect(emails[0].subject).not.toContain('[Padel-Frechen]');
    expect(emails[0].subject).toMatch(/^You got a spot: Friday Event/);
    expect(emails[0].text).toContain('Hall A');
    expect(emails[0].text).toContain('18:00');
    // Root app instance URL only (no deep-link path/query)
    expect(emails[0].text).toMatch(/https?:\/\/[^/\s]+$/m);

    // 5. Also verify auto_compact_slots = 1 triggers promotion email
    await request.put('/api.php/config', { headers: H, data: { auto_compact_slots: '1' } });
    const sRes2 = await (await request.put('/api.php/sessions/new', {
      headers: H,
      data: {
        date: '2099-05-02',
        name: 'Compact Event',
        timeStart: '19:00',
        timeEnd: '21:00',
        courts: [[p1.id, p2.id, p3.id, p4.id]]
      }
    })).json();
    await request.post(`/api.php/sessions/${sRes2.id}/join-waitlist`, { headers: H, data: { player_id: wlOptedIn.id } });
    const leave3 = await request.post(`/api.php/sessions/${sRes2.id}/leave`, { headers: H, data: { player_id: p3.id } });
    expect(leave3.ok()).toBeTruthy();

    emails = await (await request.get('/api.php/test-emails')).json();
    expect(emails.length).toBe(2);
    expect(emails[1].subject).toContain('Compact Event');

    // 6. Guest on waitlist notifies host player
    await request.post(`/api.php/sessions/${sRes2.id}/join-waitlist`, {
      headers: H,
      data: { player_id: `${wlOptedIn.id}|g1` }
    });
    const leave4 = await request.post(`/api.php/sessions/${sRes2.id}/leave`, {
      headers: H,
      data: { player_id: p4.id }
    });
    expect(leave4.ok()).toBeTruthy();

    emails = await (await request.get('/api.php/test-emails')).json();
    expect(emails.length).toBe(3);
    expect(emails[2].to).toEqual(['yes@example.com']);
    expect(emails[2].subject).toContain('Your guest got a spot: Compact Event');
  });

  test('Billing & deposit email notifications — opt-in, billing type, and new balance', async ({ request }) => {
    const admin = await (await request.post('/api.php/players', { data: { name: 'Admin', pin: '1111' } })).json();
    const auth = await (await request.post('/api.php/auth', { data: { player_id: admin.id, pin: '1111' } })).json();
    const H = { 'X-Token': auth.token, 'Content-Type': 'application/json' };

    await request.put('/api.php/config', { headers: H, data: { cost: '10', courts: '1', team_name: 'Padel-Frechen', currency: 'EUR' } });

    const pBal = await (await request.post('/api.php/players', { headers: H, data: { name: 'BalanceUser', pin: '2001' } })).json();
    const pDir = await (await request.post('/api.php/players', { headers: H, data: { name: 'DirectUser', pin: '2002' } })).json();
    const pOut = await (await request.post('/api.php/players', { headers: H, data: { name: 'OutlayUser', pin: '2003' } })).json();
    const pOff = await (await request.post('/api.php/players', { headers: H, data: { name: 'OptOutUser', pin: '2004' } })).json();

    // 1. Default flags are 0
    let players = await (await request.get('/api.php/players', { headers: H })).json();
    expect(players.find(p => p.id === pBal.id).notify_charge).toBe(0);
    expect(players.find(p => p.id === pBal.id).notify_deposit).toBe(0);

    // 2. Enabling notify_charge / notify_deposit without email returns 400
    expect((await request.put(`/api.php/players/${pBal.id}`, { headers: H, data: { notify_charge: 1 } })).status()).toBe(400);
    expect((await request.put(`/api.php/players/${pBal.id}`, { headers: H, data: { notify_deposit: 1 } })).status()).toBe(400);

    // 3. Configure opt-ins
    await request.put(`/api.php/players/${pBal.id}`, {
      headers: H,
      data: { contact: 'bal@example.com', notify_charge: 1, notify_deposit: 1, language: 'de' }
    });
    await request.put(`/api.php/players/${pDir.id}`, {
      headers: H,
      data: { contact: 'dir@example.com', notify_charge: 1, notify_deposit: 0, language: 'en' }
    });
    await request.put(`/api.php/players/${pOut.id}`, {
      headers: H,
      data: { contact: 'out@example.com', notify_charge: 1, notify_deposit: 0, language: 'de' }
    });
    await request.put(`/api.php/players/${pOff.id}`, {
      headers: H,
      data: { contact: 'off@example.com', notify_charge: 0, notify_deposit: 0 }
    });

    // 4. Deposit (credit=1) -> sends email to pBal, not to pOff; manual debit (credit=0) sends nothing
    await request.post('/api.php/transactions', {
      headers: H,
      data: { player_id: pBal.id, credit: 1, amount: 50, date: '2099-06-01', note: 'Bank transfer' }
    });
    await request.post('/api.php/transactions', {
      headers: H,
      data: { player_id: pOff.id, credit: 1, amount: 50, date: '2099-06-01' }
    });
    await request.post('/api.php/transactions', {
      headers: H,
      data: { player_id: pBal.id, credit: 0, amount: 5, date: '2099-06-01', note: 'Manual debit' }
    });

    let emails = await (await request.get('/api.php/test-emails')).json();
    expect(emails.length).toBe(1);
    expect(emails[0].from).toBe('Padel-Frechen <noreply@test.local>');
    expect(emails[0].to).toEqual(['bal@example.com']);
    expect(emails[0].subject).toContain('Einzahlung verbucht (+50,00 €)');
    expect(emails[0].text).toContain('Bank transfer');
    expect(emails[0].text).toContain('Neuer Kontostand: 50,00 €');

    // 5. Session charge: pBal (balance -> 45 - 10 = 35), pDir (direct payment -> 0), pOff (opted out), pOut (outlay -> +40)
    const sRes = await (await request.put('/api.php/sessions/new', {
      headers: H,
      data: {
        date: '2099-06-02',
        name: 'Evening Match',
        timeStart: '18:00',
        timeEnd: '20:00',
        courts: [[pBal.id, pDir.id, pOut.id, pOff.id]]
      }
    })).json();

    const chargeRes = await request.post('/api.php/charge', {
      headers: H,
      data: {
        items: [{
          id: sRes.id,
          paid_pids: [pDir.id],
          paid_by_player_id: pOut.id
        }]
      }
    });
    expect(chargeRes.ok()).toBeTruthy();

    emails = await (await request.get('/api.php/test-emails')).json();
    // 1 deposit + 3 opted-in charged players (pBal, pDir, pOut) = 4
    expect(emails.length).toBe(4);

    const balMail = emails.find(e => e.to[0] === 'bal@example.com' && e.subject.includes('Evening Match'));
    expect(balMail).toBeTruthy();
    expect(balMail.text).toContain('Abrechnung über Guthaben');
    expect(balMail.text).toContain('Neuer Kontostand: 35,00 €');

    const dirMail = emails.find(e => e.to[0] === 'dir@example.com');
    expect(dirMail).toBeTruthy();
    expect(dirMail.text).toContain('Direct payment on site');
    expect(dirMail.text).toContain('New balance: 0.00 €');

    const outMail = emails.find(e => e.to[0] === 'out@example.com');
    expect(outMail).toBeTruthy();
    expect(outMail.text).toContain('Auslage (Erstattung)');
    expect(outMail.text).toContain('Neuer Kontostand: 30,00 €');
  });
});
