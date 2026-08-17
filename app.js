// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
// built:416
const CLIENT_BUILD = 416;
let S = {
  players: [],
  transactions: [],
  sessions: [],
  expenses: [],
  cfg: {
    cost: 16,
    courts: 2,
    yearly: 3000,
    weeks: 6,
    pin: '1234',
    srinterval: '1',
    srdays: '2',
    sroccurrences: '6',
    srtimestart: '19:00',
    srtimeend: '21:00'
  }
};
window.S = S;
let isAdmin = localStorage.getItem('isAdmin') === '1';
Object.defineProperty(window, 'isAdmin', {
  get: () => isAdmin,
  set: (val) => { isAdmin = val; }
});


// ════════════════════════════════════════
// API
// ════════════════════════════════════════
const API = '/api.php';
let _token = localStorage.getItem('_tok') || '';
let _sessionExpiredHandled = false;
let planDate; // current date in admin session planner

if (!localStorage.getItem('isAdmin') && localStorage.getItem('_tok_user_backup')) {
  _token = localStorage.getItem('_tok_user_backup');
  localStorage.setItem('_tok', _token);
  localStorage.removeItem('_tok_user_backup');
}

const PUBLIC_API_PATHS = [];

async function apiFetch(method, path, body, sendToken = true) {
  // 1. Header dynamisch vorbereiten
  const headers = { 'Content-Type': 'application/json' };
  
  // Nur X-Token hinzufügen, wenn:
  // - ein Token existiert und nicht leer ist
  // - sendToken nicht explizit auf false gesetzt
  // - der Pfad nicht in der Liste der öffentlichen Endpoints steht (die nie 401 brauchen)
  const isPublicPath = !sendToken || PUBLIC_API_PATHS.some(p => path === p || path.startsWith(p + '?') || path.startsWith(p + '/'));
  if (_token && _token !== '' && !isPublicPath) {
    headers['X-Token'] = _token;
  }

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  try {
    const r = await fetch(API + path, opts);
    const json = await r.json().catch(() => ({}));

    // Fehlerbehandlung: Sitzung abgelaufen (401)
    // Wir triggern das automatische Logout nur, wenn wir einen Token gesendet hatten.
    if (r.status === 401 && headers['X-Token']) {
      console.debug('apiFetch 401:', method, path, 'Token gesendet');
      if (!_sessionExpiredHandled) {
        _sessionExpiredHandled = true;
        showToast(t('toast.session_expired'));
        
        // Bereinigt isAdmin, guestId und alle Token
        logoutGuest();

        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
      throw new Error('SESSION_EXPIRED');
    }

    if (!r.ok) throw new Error(json.error || r.statusText);
    const serverBuild = r.headers.get('X-Courtle-Build');
    if (serverBuild) checkAppBuild(serverBuild);

    const dbInit = r.headers.get('X-DB-Init');
    if (dbInit) {
      showToast('✅ DB wurde automatisch migriert / geheilt.');
    }
    return json;

  } catch(e) {
    const excludeMessages = ['Failed to fetch', 'Nicht autorisiert.', 'SESSION_EXPIRED', 'Falscher PIN.', 'Zu viele Fehlversuche'];
    if (!excludeMessages.some(m => e.message?.includes(m))) {
      showToast('⚠️ ' + e.message);
    }
    throw e;
  }
}

async function persistSession(sess, interactionPids = []) {
  try {
    await apiFetch('PUT', '/sessions/' + sess.date, {
      courts: sess.courts,
      disabledCourts: sess.disabledCourts || [],
      courtNames: sess.courtNames || [],
      waitlist: sess.waitlist || [],
      interaction_pids: interactionPids,
      note: sess.note ?? '',
      timeStart: sess.timeStart ?? null,
      timeEnd:   sess.timeEnd   ?? null,
    });
    const idx = S.sessions.findIndex(s => s.date === sess.date);
    if (idx >= 0) S.sessions[idx] = sess; else S.sessions.push(sess);
  } catch(e) {
    throw e; // ← weiterwerfen damit Aufrufer (leaveSession etc.) reagieren kann
  }
}

let guestId = null;
Object.defineProperty(window, 'guestId', {
  get: () => guestId,
  set: (val) => { guestId = val; }
});
let userPinBuf = '';
let editPid = null;
let txPid = null;
let slotCtx = null;
let iconTarget = null;
let activitySortColumn = 'lastInteraction';
let activitySortAsc = false;
let playerSearchQuery = '';
let playerSortOption = 'name_asc';
let expandedSessionGroups = {};
let pinBuf = '';
let signupCtx = null;
let _lastScrollTime = 0;

// ── Language Modal ──
function openLanguageModal() {
  if (!guestId) { showToast(t('toast.no_profile')); return; }
  const me = S.players.find(p => p.id == guestId);
  const lang = me?.language || '';
  document.querySelectorAll('#mo-language input[name="lang"]').forEach(r => {
    r.checked = r.value === lang;
  });
  openMo('mo-language');
}
async function saveLanguage() {
  const selected = document.querySelector('#mo-language input[name="lang"]:checked');
  if (!selected) return;
  const lang = selected.value || null;
  closeMo('mo-language');
  setLocale(lang);
  showToast(t('language.saved'));
}

// Swipe state
const SWIPE_VIEWS = ['sessions', 'my-history', 'my-transactions'];
let swipeIndex = 0;
let _swipeStartX = 0;
let _swipeStartY = 0;
let _swipeDeltaX = 0;
let _swipeDirection = null;
let _touchActive = false;

// Helper: Get display name for a player ID (handles guest IDs like "player123|g1")
function getDisplayName(id, playerMap) {
  if (!id) return '?';
  const pm = playerMap || new Map(S.players.map(p => [p.id, p]));
  if (id.includes('|g')) {
    const baseId = id.split('|')[0];
    const basePlayer = pm.get(baseId);
    return basePlayer ? `${basePlayer.name} (${t('misc.guest')})` : '?';
  }
  const player = pm.get(id);
  return player ? player.name : '?';
}

// ── SWIPE HELPERS ──
function isMobileSwipe() { return window.innerWidth <= 640; }
function syncSwipeHeight() {
  var wrap = document.getElementById('swipe-wrap');
  if (!wrap || !wrap.classList.contains('swipe-active')) return;
  var track = document.getElementById('swipe-track');
  if (!track) return;
  var views = track.children;
  var active = views[swipeIndex];
  if (active) track.style.height = active.offsetHeight + 'px';
}
function updateSwipePosition(idx, animate) {
  const track = document.getElementById('swipe-track');
  if (!track) return;
  const clamped = Math.max(0, Math.min(idx, SWIPE_VIEWS.length - 1));
  track.classList.toggle('dragging', !animate);
  track.style.transform = 'translateX(-' + (clamped * 100) + '%)';
  swipeIndex = clamped;
  syncSwipeHeight();
}
function initSwipe() {
  const wrap = document.getElementById('swipe-wrap');
  if (!wrap) return;

  wrap.addEventListener('touchstart', function(e) {
    if (!isMobileSwipe() || !wrap.classList.contains('swipe-active')) return;
    _touchActive = true;
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
    _swipeDirection = null;
    _swipeDeltaX = 0;
  }, { passive: true });

  wrap.addEventListener('touchmove', function(e) {
    if (!isMobileSwipe() || !wrap.classList.contains('swipe-active')) return;
    const dx = e.touches[0].clientX - _swipeStartX;
    const dy = e.touches[0].clientY - _swipeStartY;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

    if (_swipeDirection === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      _swipeDirection = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }

    if (_swipeDirection !== 'h') return;
    if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 10) return;

    e.preventDefault();
    _swipeDeltaX = dx;

    const track = document.getElementById('swipe-track');
    const wrapW = wrap.offsetWidth;
    const basePct = -swipeIndex * 100;
    var dragPct = (dx / wrapW) * 100;
    if ((swipeIndex === 0 && dx > 0) || (swipeIndex === SWIPE_VIEWS.length - 1 && dx < 0)) {
      dragPct *= 0.3;
    }
    track.classList.add('dragging');
    track.style.transform = 'translateX(' + (basePct + dragPct) + '%)';
  }, { passive: false });

  wrap.addEventListener('touchend', function(e) {
    if (!isMobileSwipe() || !wrap.classList.contains('swipe-active')) return;

    const dx = e.changedTouches[0].clientX - _swipeStartX;
    const dy = e.changedTouches[0].clientY - _swipeStartY;

    if (_swipeDirection !== 'h') {
      _lastScrollTime = Date.now();
      return;
    }

    if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 10) {
      _lastScrollTime = Date.now();
      return;
    }

    const threshold = wrap.offsetWidth * 0.25;
    let newIdx = swipeIndex;
    if (dx < -threshold && swipeIndex < SWIPE_VIEWS.length - 1) {
      newIdx = swipeIndex + 1;
    } else if (dx > threshold && swipeIndex > 0) {
      newIdx = swipeIndex - 1;
    }

    if (newIdx === swipeIndex) {
      updateSwipePosition(swipeIndex, true);
      return;
    }

    swipeIndex = newIdx;
    updateSwipePosition(swipeIndex, true);

    const vn = SWIPE_VIEWS[swipeIndex];
    showView(vn);
    setTimeout(function() {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
        _touchActive = false;
    }, 400);
  }, { passive: true });

  wrap.addEventListener('touchcancel', function() {
    _touchActive = false;
  }, { passive: true });
}


// ════════════════════════════════════════
// DATE HELPERS
// ════════════════════════════════════════
function toDS(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Compute recurrence from new config fields (fallbacks applied)
function getRecurrenceConfig() {
  // Sessions ahead in Wochen-Option deaktiviert. Nutze stattdessen die Anzahl der Termine aus sr-occurrences.
  const interval = 1; // ignore srinterval
  const occurrences = parseInt(S.cfg.sroccurrences || '6', 10);
  const daysOfWeek = String(S.cfg.srdays || '2')
    .split(',')
    .map(v => parseInt(v, 10))
    .filter(v => !Number.isNaN(v));

  return {
    frequency: 'weekly',
    interval: interval,
    days_of_week: daysOfWeek.length ? daysOfWeek : [2],
    start_date: toDS(new Date()),
    occurrences: Number.isNaN(occurrences) ? 6 : occurrences,
    session_time_start: S.cfg.srtimestart || '19:00',
    session_time_end: S.cfg.srtimeend || '21:00'
  };
}

function generateSeriesDates(series) {
  const dates = [];
  const today = toDS(new Date());
  const dayMap = series.daysOfWeek || [2];
  const occurrences = series.occurrences || 6;
  const d = new Date();

  let count = 0;
  const maxIterations = occurrences * 7 * 2;
  let iter = 0;

  while (count < occurrences && iter < maxIterations) {
    if (dayMap.includes(d.getDay())) {
      const ds = toDS(d);
      if (ds >= today) {
        dates.push(ds);
        count++;
      }
    }
    d.setDate(d.getDate() + 1);
    iter++;
  }
  return dates.sort();
}

function getRecurringSessionDates() {
  if (S.cfg.sr_enabled === '0' || !S.series) return [];
  const allDates = new Set();
  for (const series of S.series) {
    if (!series.enabled) continue;
    for (const d of generateSeriesDates(series)) {
      allDates.add(d);
    }
  }
  return [...allDates].sort();
}

// Get the next upcoming session date (respects scheduler enable/disable)
function getNextSessionDate() {
  const allDates = getAllSessionDates();
  const today = toDS(new Date());
  return allDates.find(d => d >= today) || allDates[allDates.length - 1] || toDS(new Date());
}

// Alias for clarity
function getUpcomingSession() {
  return getNextSessionDate();
}

// Get all session dates: DB sessions + recurring if enabled (excludes cancelled)
function getAllSessionDates() {
  if (!S.sessions || !S.sessions.length) return [];
  const cancelledDates = new Set(
    S.sessions.filter(s => s.cancelled).map(s => s.date)
  );
  const recurring = getRecurringSessionDates().filter(d => !cancelledDates.has(d));
  const dbDates = S.sessions
    .filter(s => !s.cancelled)
    .map(s => s.date);
  return [...new Set([...dbDates, ...recurring])].sort();
}

// Get all session dates for admin (includes cancelled)
function getAllSessionDatesAdmin() {
  if (!S.sessions || !S.sessions.length) return [];
  const dbDates = S.sessions.map(s => s.date);
  const recurring = getRecurringSessionDates();
  return [...new Set([...dbDates, ...recurring])].sort();
}

function fmtD(d) { return fmtDate(d); }
function fmtDL(d) { return fmtDateLong(d); }
function fmtDTF(d) { return fmtDateTimeFull(d); }
function fmtDTS(d) { return fmtDateTimeHistory(d); }
function fmtDT(d) { return fmtDateTime(d); }
function getOrSess(date) {
  if (!S.sessions) return null;
  let s = S.sessions.find(x => x.date === date);
  if (!s) {
    let seriesPrice = null;
    if (S.series && S.cfg.sr_enabled !== '0') {
      for (const series of S.series) {
        if (!series.enabled) continue;
        if (generateSeriesDates(series).includes(date)) {
          if (series.price !== null && series.price !== undefined) {
            seriesPrice = parseFloat(series.price);
            break;
          }
        }
      }
    }
    s = { date, courts: Array(S.cfg.courts).fill(null).map(() => [null,null,null,null]), charged: false, waitlist: [], disabledCourts: [], note: '', timeStart: null, timeEnd: null, cancelled: false, location: S.cfg.srlocation ?? null, price: seriesPrice, name: null };
    S.sessions.push(s);
  }
  // Fehlende Courts auffüllen
  while (s.courts && s.courts.length < S.cfg.courts) s.courts.push([null, null, null, null]);
  // Fehlende Slots innerhalb vorhandener Courts auffüllen
  if (s.courts) for (var ci = 0; ci < s.courts.length; ci++) while (s.courts[ci].length < 4) s.courts[ci].push(null);
  if (!s.waitlist) s.waitlist = [];
  if (!s.disabledCourts) s.disabledCourts = [];
  if (!s.courtNames) s.courtNames = [];
  if (s.cancelled === undefined) s.cancelled = false;
  return s;
}

function getSessionName(date) {
  if (S.sessions) {
    const sess = S.sessions.find(s => s.date === date);
    if (sess && sess.name && sess.name.trim() !== '') {
      return sess.name;
    }
  }
  if (S.series && S.cfg.sr_enabled !== '0') {
    for (const series of S.series) {
      if (!series.enabled) continue;
      if (generateSeriesDates(series).includes(date)) {
        if (series.name && series.name.trim() !== '') {
          return series.name;
        }
      }
    }
  }
  return (S.cfg.team_name || '').trim() || 'Courtle';
}

function getSessionTime(date) {
  const sess = S.sessions?.find(s => s.date === date);
  let start = sess?.timeStart;
  let end   = sess?.timeEnd;

  if ((!start || !end) && S.series && S.cfg.sr_enabled !== '0') {
    const dObj = new Date(date + 'T00:00:00');
    const dayOfWeek = dObj.getDay();
    for (const series of S.series) {
      if (!series.enabled) continue;
      const days = series.daysOfWeek || [2];
      if (days.includes(dayOfWeek) || generateSeriesDates(series).includes(date)) {
        if (!start) start = series.timeStart;
        if (!end) end = series.timeEnd;
        break;
      }
    }
  }

  if (!start) start = String(S.cfg.srtimestart ?? '19:00');
  if (!end)   end   = String(S.cfg.srtimeend   ?? '21:00');

  const fmt = t => t.length === 4
      ? t.slice(0,2) + ':' + t.slice(2)
      : t;
  return { start: fmt(start), end: fmt(end) };
}

function getCourtLabel(dateOrSess, ci) {
  let sess = typeof dateOrSess === 'string' ? S.sessions?.find(s => s.date === dateOrSess) : dateOrSess;
  let customName = sess?.courtNames?.[ci];
  if (!customName && S.series && S.cfg.sr_enabled !== '0') {
    const date = typeof dateOrSess === 'string' ? dateOrSess : dateOrSess?.date;
    if (date) {
      const dObj = new Date(date + 'T00:00:00');
      const dayOfWeek = dObj.getDay();
      for (const series of S.series) {
        if (!series.enabled) continue;
        const days = series.daysOfWeek || [2];
        if (days.includes(dayOfWeek) || generateSeriesDates(series).includes(date)) {
          if (series.courtNames?.[ci]) {
            customName = series.courtNames[ci];
            break;
          }
        }
      }
    }
  }
  if (customName && String(customName).trim() !== '') {
    const trimmed = String(customName).trim();
    if (/^\d+$/.test(trimmed)) {
      return `${t('session.court')} ${trimmed}`;
    }
    return trimmed;
  }
  return `${t('session.court')} ${ci + 1}`;
}

// ════════════════════════════════════════
// USER PIN
// ════════════════════════════════════════
function upk(k) {
  if (userPinBuf.length >= 4) return;
  userPinBuf += k;
  updateUserDots();
  if (userPinBuf.length === 4) setTimeout(checkUserPin, 80);
}
function updel() { userPinBuf = userPinBuf.slice(0, -1); updateUserDots(); }
function upclr() { userPinBuf = ''; updateUserDots(); }
function updateUserDots(err) {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('upd' + i);
    d.className = 'pdot' + (err ? ' err' : (i < userPinBuf.length ? ' on' : ''));
  }
}

async function checkUserPin() {
  const p = S.players.find(x => x.id == pendingGuestId);
  if (!p) return;

  try {
    const res = await apiFetch('POST', '/auth', { player_id: pendingGuestId, pin: userPinBuf });
    
    // 1. Berechtigungen setzen
    _token = res.token;
    localStorage.setItem('_tok', _token);
    guestId = pendingGuestId;
    localStorage.setItem('_guestId', guestId);
    isAdmin = !!res.admin; 
    if (isAdmin) localStorage.setItem('isAdmin', '1');
    resetInstallBanner();

    // 2. UI schalten
    document.getElementById('upin-overlay').classList.remove('open');
    applyRole(false);     
    syncGuestIdentity();  
    
    // LANDING PAGE: Admin und User landen jetzt beide bei den Spieltagen
    showView('sessions'); 
    
    showToast(t('toast.welcome', { name: p.name }));

    // 3. Daten im Hintergrund laden
    await loadState(); 
    
    // 4. Anzeige aktualisieren
    if (isAdmin) {
        renderAll();
    } else {
        syncGuestIdentity();
        renderSessions();
    }

    userPinBuf = '';
    pendingGuestId = null;
  } catch(e) {
    // Fehler-Reset
    updateUserDots(true);
    userPinBuf = '';

    setTimeout(() => {
      updateUserDots(); 
      const errorMsg = e.message === 'Unauthorized.' || e.message === 'Invalid PIN.'
        ? t('toast.pin_wrong') + ' ❌'
        : (e.message || t('toast.login_failed'));
      showToast(errorMsg);
    }, 500);
  }
}

let adminPinTarget = null;
function openAdminSetPin(pid) {
  const p = S.players.find(x => x.id === pid);
  if (!p) return;
  adminPinTarget = pid;
  document.getElementById('masp-sub').textContent = t('players.new_pin_for').replace('{name}', p.name);
  document.getElementById('masp-pin').value = '';
  openMo('mo-admin-set-pin');
  setTimeout(() => document.getElementById('masp-pin').focus(), 100);
}
async function saveAdminSetPin() {
  if (!adminPinTarget) return;
  const p = S.players.find(x => x.id === adminPinTarget);
  if (!p) return;
  const newPin = document.getElementById('masp-pin').value.trim();
  if (!/^\d{4}$/.test(newPin)) { showToast(t('toast.pin_must_4')); return; }
  try {
    await apiFetch('PUT', '/players/' + adminPinTarget, { pin: newPin });
    closeMo('mo-admin-set-pin');
    showToast(t('toast.pin_saved', { name: p.name }));
    adminPinTarget = null;
  } catch(e) {}
}

// ════════════════════════════════════════
// OWN USER PIN CHANGE
// ════════════════════════════════════════
function openChangeUserPinModal() {
  if (!guestId) { showToast('Bitte zuerst Profil wählen.'); return; }
  document.getElementById('cup-old').value = '';
  document.getElementById('cup-new1').value = '';
  document.getElementById('cup-new2').value = '';
  openMo('mo-user-pin');
  setTimeout(() => document.getElementById('cup-old').focus(), 100);
}
async function saveOwnPin() {
  if (!guestId) { showToast('Kein Profil aktiv.'); return; }
  const p = S.players.find(x => x.id == guestId);
  if (!p) return;

  const oldPin = document.getElementById('cup-old').value.trim();
  const new1 = document.getElementById('cup-new1').value.trim();
  const new2 = document.getElementById('cup-new2').value.trim();

  // Validierung
  if (!/^\d{4}$/.test(oldPin)) { showToast('Bitte aktuellen PIN eingeben (4 Ziffern).'); return; }
  if (!/^\d{4}$/.test(new1) || !/^\d{4}$/.test(new2)) { showToast('Neuer PIN muss genau 4 Ziffern haben.'); return; }
  if (new1 !== new2) { showToast('Neuer PIN stimmt nicht überein.'); return; }

  try {
    // KORREKTUR 1: Die URL ist nur /players/ID (ohne /pin)
    // KORREKTUR 2: Der Key heißt "pin" (statt "new_pin")
    await apiFetch('PUT', '/players/' + guestId, { 
      old_pin: oldPin, 
      pin: new1 
    });

    closeMo('mo-user-pin');
    
    // Felder leeren
    document.getElementById('cup-old').value = '';
    document.getElementById('cup-new1').value = '';
    document.getElementById('cup-new2').value = '';
    
    showToast(t('toast.pin_changed'));
  } catch(e) {
    // Fehlermeldung vom Server anzeigen (z.B. "PIN falsch")
    showToast(e.message || t('toast.pin_change_error'));
  }
}

// ════════════════════════════════════════
// OWN USER CONTACT (E-MAIL) CHANGE
// ════════════════════════════════════════
function openChangeUserContactModal() {
  if (!guestId) { showToast('Bitte zuerst Profil wählen.'); return; }
  const p = S.players.find(x => x.id == guestId);
  document.getElementById('cuc-contact').value = p ? (p.contact || '') : '';
  openMo('mo-user-contact');
  setTimeout(() => document.getElementById('cuc-contact').focus(), 100);
}
async function saveOwnContact() {
  if (!guestId) { showToast('Kein Profil aktiv.'); return; }
  const contact = document.getElementById('cuc-contact').value.trim();
  if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) { showToast('Bitte gültige E-Mail-Adresse eingeben.'); return; }
  try {
    await apiFetch('PUT', '/players/' + guestId, { contact: contact || null });
    closeMo('mo-user-contact');
    showToast(t('toast.email_saved'));
    await loadState();
  } catch(e) {}
}

// ════════════════════════════════════════
// ICON PICKER
// ════════════════════════════════════════
const ICONS = ['user','cat','dog','fish','bird','rabbit','turtle','snail','bug','panda','squirrel','rat','mouse','paw-print','birdhouse','shell','palmtree','gift','target','swords','flame','zap','flag','leaf','droplet','snowflake','feather','wind','moon','star','cloud','heart','key','bell','music','glasses','compass','skull','rocket','clover'];

function openIconPickerModal(pid) {
  const target = pid || guestId;
  if (!target) { showToast('Bitte zuerst Profil wählen.'); return; }
  iconTarget = target;
  const p = S.players.find(x => x.id == target);
  const current = p?.emoji || '';
  const sub = document.getElementById('emoji-subtitle');
  sub.textContent = p && pid ? `Icon für ${esc(p.name)} ändern` : 'Wähle ein Icon für deinen Avatar.';
  const grid = document.getElementById('emoji-grid');
  grid.innerHTML = ICONS.map(name => `<button type="button" class="${name === current ? 'sel' : ''}" onclick="selectPlayerIcon('${name}')"><i data-lucide="${name}" style="width:20px;height:20px"></i></button>`).join('');
  openMo('mo-emoji');
  if (window.lucide) lucide.createIcons();
}
async function selectPlayerIcon(name) {
  const target = iconTarget || guestId;
  if (!target) return;
  try {
    await apiFetch('PUT', '/players/' + target, { emoji: name });
    const p = S.players.find(x => x.id == target);
    if (p) p.emoji = name;
    closeMo('mo-emoji');
    showToast(t('toast.icon_saved'));
    if (isAdmin) { renderAll(); } else { renderSessions(); }
    const p2 = S.players.find(x => x.id == (iconTarget || guestId));
    if (p2) updateProfileIcon(p2);
   } catch(e) { showToast(e.message || t('toast.error')); }
 }
 async function resetPlayerIcon() {
  const target = iconTarget || guestId;
  if (!target) return;
  try {
    await apiFetch('PUT', '/players/' + target, { emoji: null });
    const p = S.players.find(x => x.id == target);
    if (p) p.emoji = null;
    closeMo('mo-emoji');
    showToast(t('toast.icon_reset'));
    if (isAdmin) { renderAll(); } else { renderSessions(); }
    const p2 = S.players.find(x => x.id == (iconTarget || guestId));
    if (p2) updateProfileIcon(p2);
   } catch(e) { showToast(e.message || t('toast.icon_reset_error')); }
 }

 function updateProfileIcon(p) {
  const iconEl = document.getElementById('profile-dd-icon');
  if (iconEl) iconEl.setAttribute('data-lucide', playerIcon(p));
  const bnav = document.getElementById('bnav-profile');
  if (bnav) {
    const i = bnav.querySelector('i[data-lucide]');
    if (i) i.setAttribute('data-lucide', playerIcon(p));
  }
  if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════
// PIN 
// ════════════════════════════════════════

function applyRole(shouldRender = true) {
  const adminDD = document.getElementById('admin-nav-dd');
  if (isAdmin) {
    if (adminDD) adminDD.style.display = '';
    if (!planDate) planDate = getUpcomingSession();
    if (shouldRender) renderAll();
    const seriesNav = document.getElementById('nav-series');
    if (seriesNav) seriesNav.style.display = S.cfg.sr_enabled !== '0' ? '' : 'none';
    const bnavSeries = document.getElementById('bnav-series');
    if (bnavSeries) bnavSeries.style.display = S.cfg.sr_enabled !== '0' ? '' : 'none';
    const btnNewSeries = document.getElementById('btn-new-series');
    if (btnNewSeries) btnNewSeries.style.display = S.cfg.sr_enabled !== '0' ? '' : 'none';
  } else {
    if (adminDD) adminDD.style.display = 'none';
    closeNavDD();
    if (shouldRender) renderSessions();
  }
  lucide.createIcons();
}

// ════════════════════════════════════════
// WELCOME MODAL + GUEST IDENTITY
// ════════════════════════════════════════
function logoutGuest() {
  console.debug('logoutGuest() aufgerufen', new Error().stack);
  // 1. Identität und Token im Speicher löschen
  guestId = null;
  _token = '';
  isAdmin = false;
  _sessionExpiredHandled = false;

  // 2. WICHTIG: PIN-Puffer und vorgemerkte ID leeren
  // Das verhindert, dass beim nächsten Login noch alte Ziffern im Speicher hängen.
  pendingGuestId = null; 
  userPinBuf = ''; 

  // 3. Browser-Speicher (LocalStorage) bereinigen
  localStorage.removeItem('_guestId');
  localStorage.removeItem('_tok');
  localStorage.removeItem('isAdmin');
  localStorage.removeItem('_tok_user_backup');

  // 4. Benutzeroberfläche aktualisieren
  closeProfileDD();
  closeProfileMenu();
  applyRole();          // Versteckt Admin-Inhalte sofort[cite: 6]
  syncGuestIdentity();  // Setzt "Wer bist du?" und das Menü zurück
  showView('sessions'); // Wechselt zur öffentlichen Ansicht[cite: 6]
  
    showToast(t('toast.logged_out'));
  window.location.reload();
}

function openWelcomeModal() {
  const grid = document.getElementById('player-pick-grid');
  const activePlayers = S.players.filter(p => p.active !== false);
  if (!activePlayers.length) { checkFirstSetup(); return; }
  grid.innerHTML = activePlayers.map(p => {
    const active = p.id == guestId ? ' active' : '';
    return `<button class="player-pick-btn${active}" onclick="selectGuest('${p.id}')">
      <div class="av" style="width:32px;height:32px;font-size:var(--text-sm);flex-shrink:0"><i data-lucide="${playerIcon(p)}" style="width:16px;height:16px"></i></div>
      <div style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
      </div>
    </button>`;
  }).join('');
  document.getElementById('welcome-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  lucide.createIcons();
}
function closeWelcomeModal(didSelect) {
  document.getElementById('welcome-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
function selectGuest(pid) {
  const p = S.players.find(x => x.id === pid);
  if (!p) return;
  // If player has no PIN set yet, just log in directly (first time)
  // Otherwise open user PIN dialog
  pendingGuestId = pid;
  closeWelcomeModal(false);
  openUserPinModal(p);
}

// ── First-Setup (0 Spieler in DB) ──
function checkFirstSetup() {
  try {
    if (!window._stateLoaded || !S.players || S.players.length > 0) return;
    var el = document.getElementById('setup-overlay');
    if (!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    var nameEl = document.getElementById('setup-name');
    if (nameEl) nameEl.focus();
    lucide.createIcons();
  } catch(e) { console.error('checkFirstSetup:', e); }
}
async function setupFirstAdmin() {
  const teamName = document.getElementById('setup-teamname').value.trim();
  const name = document.getElementById('setup-name').value.trim();
  const pin = document.getElementById('setup-pin').value;
  const pin2 = document.getElementById('setup-pin2').value;
  const errEl = document.getElementById('setup-err');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Bitte Admin-Name eingeben.'; return; }
  if (pin.length !== 4 || pin !== pin2) { errEl.textContent = 'PIN muss 4 Ziffern sein und übereinstimmen.'; return; }
  try {
    const res = await apiFetch('POST', '/players', { name, pin });
    const login = await apiFetch('POST', '/auth', { player_id: res.id, pin: pin });
    _token = login.token;
    if (teamName) await apiFetch('PUT', '/config', { team_name: teamName });
    localStorage.setItem('_tok', _token);
    guestId = res.id;
    localStorage.setItem('_guestId', guestId);
    isAdmin = true;
    localStorage.setItem('isAdmin', '1');
    document.getElementById('setup-overlay').classList.remove('open');
    document.body.style.overflow = '';
    applyRole(false);
    await loadState();
    syncGuestIdentity();
    renderAll();
    showView('sessions');
  } catch(e) {
     errEl.textContent = e.message || t('toast.session_create_error');
  }
}

let pendingGuestId = null;

function openUserPinModal(player) {
  userPinBuf = '';
  // Wir merken uns den Player, aber wir klicken kein Textfeld an!
  window.currentPinPlayer = player; 
  
  document.getElementById('upin-title').textContent = t('login.greeting', { name: player.name });
  document.getElementById('upin-sub').textContent = t('login.enter_pin');
  document.getElementById('upin-mode').textContent = player.pin ? '' : 'set';
  document.getElementById('upin-err').textContent = '';
  
  updateUserDots();
  document.getElementById('upin-overlay').classList.add('open');
  lucide.createIcons();
}
function closeUserPinModal() {
  document.getElementById('upin-overlay').classList.remove('open');
  pendingGuestId = null;
  userPinBuf = '';
}


window.addEventListener('keydown', (e) => {
    const userOverlay = document.getElementById('upin-overlay');
    const isUserOpen = userOverlay && userOverlay.classList.contains('open');

    if (!isUserOpen) return;

    if (e.key >= '0' && e.key <= '9') {
        upk(e.key);
    }
    else if (e.key === 'Backspace') {
        updel();
    }
    else if (e.key === 'Escape') {
        closeUserPinModal();
    }
});


function getBalanceTier(balance) {
  if (balance < 0)   return { icon: 'frown',     cssClass: 'tier-neg' };
  if (balance === 0) return { icon: 'credit-card', cssClass: 'tier-default' };

  const uniqueBalances = [...new Set(S.players.map(p => bal(p.id)))]
    .filter(b => b > 0)
    .sort((a, b) => b - a);
  const rank1 = uniqueBalances[0] || null;
  const rank2 = uniqueBalances[1] || null;

  if (balance === rank1) return { icon: 'crown', cssClass: 'tier-gold-crown' };
  if (balance === rank2) return { icon: 'trophy', cssClass: 'tier-silver-crown' };

  if (balance < 50)  return { icon: 'hand-coins',  cssClass: 'tier-default' };
  if (balance < 100) return { icon: 'coins',       cssClass: 'tier-default' };
  if (balance < 200) return { icon: 'zap',         cssClass: 'tier-default' };
  if (balance < 300) return { icon: 'award',       cssClass: 'tier-default' };
  return                  { icon: 'landmark', cssClass: 'tier-default' };
}

function syncGuestIdentity() {
  const bar = document.getElementById('guest-bal-bar');
  const navBadge = document.getElementById('navbar-balance-badge');
  const navBadgeAmt = document.getElementById('navbar-balance-amount');
  const gbbAmt = document.getElementById('gbb-amount');
  
  // Menü-Elemente abgreifen
  const navMyHist = document.getElementById('nav-my-history');
  const navMyTx = document.getElementById('nav-my-transactions');
  const bnavMyHist = document.getElementById('bnav-my-history');
  const bnavMyTx = document.getElementById('bnav-my-transactions');
  const bnavAdmin = document.getElementById('bnav-admin-dd');
  const bnavProfile = document.getElementById('bnav-profile');
  const profileDD = document.getElementById('profile-nav-dd');
  const profileDDLabel = document.getElementById('profile-dd-label');

  if (guestId) {
    const p = S.players.find(x => x.id == guestId);
    if (p) {
      const b = bal(p.id);
      const tier = getBalanceTier(b);
      if (gbbAmt) {
          gbbAmt.textContent = fmtE(b);
          gbbAmt.className = 'gbb-amount ' + (b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos');
      }
      // Show balance in navbar badge
      if (navBadge) {
        navBadge.classList.remove('hidden');
        navBadge.classList.remove('tier-neg', 'tier-zero', 'tier-base', 'tier-bronze', 'tier-silver', 'tier-gold', 'tier-platinum', 'tier-gold-crown', 'tier-silver-crown', 'tier-default');
        navBadge.classList.add(tier.cssClass);
      }
      if (navBadgeAmt) {
        navBadgeAmt.textContent = fmtE(b);
        navBadgeAmt.className = 'navbar-balance-amount ' + (b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos');
      }
      // Update balance tier icon
      const iconEl = document.getElementById('navbar-balance-icon');
      if (iconEl) {
        iconEl.setAttribute('data-lucide', tier.icon);
        if (window.lucide) lucide.createIcons();
      }
      
      if (bar) bar.classList.remove('hidden');
      
      // Desktop Profil-Dropdown
      if (profileDD) profileDD.style.display = '';
      if (profileDDLabel) {
        profileDDLabel.textContent = esc(p.name);
        profileDDLabel.removeAttribute('data-i18n');
      }
      const profileIcon = document.getElementById('profile-dd-icon');
      if (profileIcon) profileIcon.setAttribute('data-lucide', playerIcon(p));
      
      // Mobile Profil-Button: Login/Name
      if (bnavProfile) {
        bnavProfile.onclick = toggleProfileMenu;
        bnavProfile.innerHTML = '<i data-lucide="' + playerIcon(p) + '" style="width:22px;height:22px"></i><span id="bnav-profile-label">' + esc(p.name) + '</span>';
      }
      
      // Menüpunkte EINBLENDEN
      if (navMyHist) navMyHist.style.display = '';
      if (navMyTx) navMyTx.style.display = '';
      if (bnavMyHist) bnavMyHist.classList.remove('hidden');
      if (bnavMyTx) bnavMyTx.classList.remove('hidden');
      if (bnavAdmin) bnavAdmin.classList.toggle('hidden', !isAdmin);

      // Swipe aktivieren (nur beim ersten Mal, nicht bei jedem Re-Render)
      if (isMobileSwipe()) {
        const wr = document.getElementById('swipe-wrap');
        if (wr && !wr.classList.contains('swipe-active')) {
          wr.style.display = '';
          wr.classList.add('swipe-active');
          swipeIndex = 0;
          updateSwipePosition(0, false);
        }
      }
      
      lucide.createIcons();
      return;
    } else {
      // guestId is set but player not found — stale session, clear it
      console.warn('syncGuestIdentity: guestId', guestId, 'not found in S.players, clearing stale session');
      guestId = null;
      _token = '';
      localStorage.removeItem('_guestId');
      localStorage.removeItem('_tok');
      localStorage.removeItem('_tok_user_backup');
      isAdmin = false;
      localStorage.removeItem('isAdmin');
    }
  }
  
  // FALLBACK: Wenn kein User eingeloggt ist (Logout-Zustand)
  if (bar) bar.classList.add('hidden');
  if (navBadge) navBadge.classList.add('hidden');

  // Desktop Profil-Dropdown: "Login" anzeigen
  if (profileDD) profileDD.style.display = '';
  if (profileDDLabel) profileDDLabel.textContent = 'Login';

  // Mobile Profil-Button: Login + Welcome-Modal
  if (bnavProfile) {
    bnavProfile.onclick = openWelcomeModal;
    bnavProfile.innerHTML = '<i data-lucide="user"></i><span id="bnav-profile-label">Login</span>';
  }

  // NEU: Menüpunkte beim Logout explizit AUSBLENDEN
  if (navMyHist) navMyHist.style.display = 'none';
  if (navMyTx) navMyTx.style.display = 'none';
  if (bnavMyHist) bnavMyHist.classList.add('hidden');
  if (bnavMyTx) bnavMyTx.classList.add('hidden');
  if (bnavAdmin) bnavAdmin.classList.add('hidden');
  lucide.createIcons();

  // Swipe deaktivieren
  const wr = document.getElementById('swipe-wrap');
  if (wr) wr.classList.remove('swipe-active');
  swipeIndex = 0;
}


// ════════════════════════════════════════
// SESSIONS VIEW (public)
// ════════════════════════════════════════
// SESSIONS VIEW — public
// Rendert die Sessions-Liste im Dashboard
function renderSessions() {
  const container = document.getElementById('sessions-container');
  if (!container) return;

  // Alle Termine: DB-Sessions + berechnete Serientermine zusammenführen (cancelled ausschließen)
  const cancelledDates = new Set(
    S.sessions.filter(s => s.cancelled).map(s => s.date)
  );
  const dbDates = S.sessions.filter(s => !s.cancelled).map(s => s.date);
  const calculated = getCalculatedSessions().filter(d => !cancelledDates.has(d));
  const allDates = [...new Set([...dbDates, ...calculated])];

  if (allDates.length === 0) {
    container.innerHTML = `<div class="p8 txcenter txm">${t('session.no_sessions')}</div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Sortieren: nur zukünftige Termine rendern (vergangene ausblenden)
  const today = toDS(new Date());
  const future = allDates.filter(d => d >= today).sort((a, b) => a.localeCompare(b));
  const sorted = [...future];

  const nextSession = getNextSessionDate();

  const html = sorted.map(date => {
    try {
      return buildSessionCard(date, date === nextSession);
    } catch (e) {
      console.error(`Error rendering card for ${date}:`, e);
      return '';
    }
  }).join('');

  const playerHash = S.players.map(p => p.emoji || '').join('');
  const hash = JSON.stringify([guestId, playerHash, sorted.map(d => {
    const s = getOrSess(d);
    return [d, s.courts, s.waitlist, s.note, s.location, s.charged, s.disabledCourts, s.cancelled, s.courtNames];
  })]);
  if (window._lastSessionHash === hash) return;
  window._lastSessionHash = hash;
  container.innerHTML = html || `<div class="p8 txcenter txm">${t('session.no_sessions')}</div>`;
  if (window.lucide) lucide.createIcons();
  syncSwipeHeight();
}

function buildSessionCard(date, isNextSession = false) {
  const sess = getOrSess(date);
  if (!sess.disabledCourts) sess.disabledCourts = [];
  const activeCourts = sess.courts.filter((_, i) => !sess.disabledCourts.includes(i));
  const allSlots = activeCourts.flat();
  const total = allSlots.length;
  const filled = allSlots.filter(Boolean).length;
  const meIn = guestId && allSlots.some(v => v && (v === guestId || v.startsWith(guestId + '|')));
  const meWl = guestId && sess.waitlist.includes(guestId);
  const past = new Date(date + 'T23:59:59') < new Date();
  const playerMap = new Map(S.players.map(p => [p.id, p]));
  const privacy = S.cfg.privacy_mode === '1' && !guestId;

  // Extract calendar ticket details
  const dObj = new Date(date + 'T00:00:00');
  const weekday = dObj.toLocaleDateString(getLocale(), { weekday: 'short' }).toUpperCase();
  const dayNum = dObj.toLocaleDateString(getLocale(), { day: 'numeric' });
  const monthStr = dObj.toLocaleDateString(getLocale(), { month: 'short' }).toUpperCase().replace('.', '');

  // ── Build slot display (grouped or flat) ──
  const groupCourts = S.cfg.display_court_grouping !== '0';
  let slotChips = groupCourts ? '' : '<div class="admin-slots-grid">';
  sess.courts.forEach((slots, ci) => {
    if (sess.disabledCourts.includes(ci)) return;
    if (groupCourts) {
      slotChips += `<div class="court-container">
        <div class="court-header">
           <span class="court-title"><i data-lucide="map-pin"></i> ${esc(getCourtLabel(sess, ci))}</span>
        </div>
        <div class="court-slots-grid">`;
    }
    slots.forEach((pid, si) => {
      if (pid) {
        const isGuest = pid.includes('|');
        const isMyGuest = isGuest && pid.startsWith(guestId + '|');
        const p = playerMap.get(isGuest ? pid.split('|')[0] : pid);
        const isMe = pid === guestId || isMyGuest;
        const filledCls = isMe ? 'me' : 'filled';
        slotChips += `<div class="admin-slot ${filledCls}">
          <div class="av" style="width:32px;height:32px;font-size:var(--text-sm)">${privacy ? '<i data-lucide="hat-glasses" style="width:16px;height:16px"></i>' : (p ? `<i data-lucide="${playerIcon(p, isGuest)}" style="width:16px;height:16px"></i>` : '?')}</div>
          <span class="slot-name">${privacy ? t('session.booked') : (p ? (isGuest ? t('session.guest') + ` (` + esc(p.name) + `)` : esc(p.name)) : '?')}${privacy ? '' : (isGuest ? '' : (isMe ? ` <span style="opacity:.6;font-size:var(--text-xs)">${t('misc.you')}</span>` : ''))}${isMyGuest ? ` <button onclick="removeGuestSlot('${date}',${ci},${si})" style="background:none;border:none;color:var(--err);cursor:pointer;padding:0 2px;font-size:10px" title="${t('misc.guest')} entfernen">×</button>` : ''}</span>
        </div>`;
      } else {
        const mySlotCount = sess.courts.flat().filter(v => v && baseId(v) === guestId).length;
        const canBook = guestId && !meWl && !past && mySlotCount < 3;
        if (canBook) {
          slotChips += `<div class="admin-slot" onclick="guestAssign('${date}',${ci},${si})">
            <i data-lucide="user-plus" style="width:16px;height:16px;flex-shrink:0;color:var(--txf)"></i>
            <span class="slot-ph">${mySlotCount > 0 ? t('session.book_guest') : t('session.book_slot')}</span>
          </div>`;
        } else {
          slotChips += `<div class="admin-slot" style="cursor:default;pointer-events:none">
            <i data-lucide="circle-dashed" style="width:16px;height:16px;flex-shrink:0;color:var(--txf)"></i>
            <span class="slot-ph" style="color:var(--txf)">${t('session.free')}</span>
          </div>`;
        }
      }
    });
    if (groupCourts) {
      slotChips += `</div>
      </div>`;
    }
  });
  if (!groupCourts) {
    slotChips += `</div>`;
  }

  // ── Waitlist chips ──
  let wlHtml = '';
  if (sess.waitlist.length > 0) {
    const chips = sess.waitlist.map(pid => {
      const bid = baseId(pid);
      const isGuest = pid.includes('|');
      const p = playerMap.get(bid);
      const isMe = pid === guestId;
      const isMyGuest = isGuest && bid === guestId;
      const canRemove = (isMe || isMyGuest) && !past && !sess.charged;
      return `<div class="slot-chip wl${isMe ? ' me' : ''}" style="padding:var(--sp2) var(--sp3)">
        <div class="slot-av">${privacy ? '<i data-lucide="hat-glasses" style="width:14px;height:14px"></i>' : (p ? `<i data-lucide="${playerIcon(p, isGuest)}" style="width:14px;height:14px"></i>` : '?')}</div>
        <span>${privacy ? t('session.booked') : (p ? (isGuest ? t('session.guest') + ` (` + esc(p.name) + `)` : esc(p.name)) : '?')}${privacy ? '' : (isGuest ? '' : (isMe ? ` <span style="opacity:.6;font-size:var(--text-xs)">${t('misc.you')}</span>` : ''))}</span>
        ${canRemove ? `<button class="btn-xs btn-dan" style="margin-left:auto;border-radius:var(--r-sm)" onclick="removeFromWaitlist('${date}','${pid}')"><i data-lucide="x" style="width:10px;height:10px"></i></button>` : ''}
      </div>`;
    }).join('');
    wlHtml = `<div class="wl-section"><div class="wl-title">${t('session.waitlist')} (${sess.waitlist.length})</div><div class="wl-list">${chips}</div></div>`;
  }

  // ── Action button ──
  let actionBtn = '';
  if (!past && guestId) {
    if (meIn) {
      const abmeldenBtn = sess.charged ? '' : `<button class="btn btn-dan btn-sm" onclick="openLeaveConfirm('${date}')"><i data-lucide="log-out"></i> ${t('session.leave')}</button>`;
      const myWlGuests = sess.waitlist.filter(pid => pid.includes('|') && baseId(pid) === guestId).length;
      const freeSlots = total - filled;
      const guestWlBtn = !sess.charged && myWlGuests < 2
        ? `<button class="btn btn-sm btn-sec" onclick="guestJoinWaitlist('${date}')"><i data-lucide="user-plus"></i> ${freeSlots > 0 ? t('session.book_guest_btn') : t('session.book_guest_wl')}</button>`
        : '';
      actionBtn = `<div class="flex g2 items-c wrap">${guestWlBtn}${abmeldenBtn}</div>`;
    } else if (meWl) {
      const myWlGuests = sess.waitlist.filter(pid => pid.includes('|') && baseId(pid) === guestId).length;
      const addGuestWlBtn = myWlGuests < 2 ? `<button class="btn btn-sm btn-sec" onclick="guestJoinWaitlist('${date}')"><i data-lucide="user-plus"></i> ${t('session.book_guest_wl')}</button>` : '';
      actionBtn = `<div class="flex g2 items-c wrap">
        ${addGuestWlBtn}
        <button class="btn btn-dan btn-sm" onclick="removeFromWaitlist('${date}','${guestId}')"><i data-lucide="x"></i> ${t('session.leave')}</button>
      </div>`;
    } else if (filled < total) {
      const mySlots = sess.courts.flat().filter(v => v && baseId(v) === guestId).length;
      const addGuestBtn = mySlots > 0 && mySlots < 3 ? `<button class="btn btn-sm btn-sec" onclick="guestAssignAny('${date}')"><i data-lucide="user-plus"></i> ${t('session.book_guest_btn')}</button>` : '';
      actionBtn = `<div class="flex g2 items-c wrap"><button class="btn btn-pri btn-sm" onclick="guestAssignAny('${date}')"><i data-lucide="user-plus"></i> ${t('session.book_slot')}</button>${addGuestBtn}</div>`;
    } else {
      actionBtn = `<div class="flex g2 items-c wrap">
        <button class="btn btn-gld btn-sm" onclick="joinWaitlist('${date}')"><i data-lucide="list-plus"></i> ${t('session.join_waitlist')}</button>
      </div>`;
    }
  } else if (!guestId && !past) {
    actionBtn = `<span class="txxs txm">↑ ${t('session.login_first')}</span>`;
  }

  const chargedBadge = sess.charged ? `<span class="badge bg-neu">${t('session.charged')}</span>` : '';

  const teamBtn = isNextSession && filled >= 2
    ? `<button class="btn btn-sec" onclick="openTeamRandomizer('${date}')" data-i18n-title="teams.title"><i data-lucide="shuffle" style="width:16px;height:16px"></i> ${t('session.shuffle_teams')}</button>`
    : '';

  const { start, end } = getSessionTime(date);

  const cardCls = (isNextSession ? 'sc next-up' : 'sc') + (groupCourts ? ' courts-grouped' : '');

  const detailsHtml = [];
  if (sess.location && !privacy) detailsHtml.push(`<div class="sc-location"><i data-lucide="map-pin" style="width:12px;height:12px;flex-shrink:0"></i>${esc(sess.location)}</div>`);
  if (sess.note) detailsHtml.push(`<div class="sc-comment"><i data-lucide="message-square" style="width:12px;height:12px;flex-shrink:0"></i>${esc(sess.note)}</div>`);

  const hasDetails = detailsHtml.length > 0;

  const sessionCost = (sess.price !== null && sess.price !== undefined) ? sess.price : S.cfg.cost;
  const priceBubbleHtml = sessionCost ? `<div class="sc-price-bubble">${fmtE(sessionCost)}</div>` : '';

  let calClass = 'cal-none';
  if (guestId) {
    if (meIn) {
      calClass = 'cal-in';
    } else if (meWl) {
      calClass = 'cal-wl';
    }
  }

  return `<div class="${cardCls}">
    <div class="sc-head-ticket">
      <div class="sc-cal-col">
        <div class="cal-ticket">
          <div class="cal-wkdy ${calClass}">${esc(weekday)}</div>
          <div class="cal-day">${esc(dayNum)}</div>
          <div class="cal-month">${esc(monthStr)}</div>
        </div>
        ${priceBubbleHtml}
      </div>
      <div class="sc-content-col">
        <div class="sc-content-top">
          <div class="sc-date">${esc(getSessionName(date))}</div>
          <div class="sc-time-details">${fmtTime(start)}–${fmtTime(end)}</div>
        </div>
        <div class="sc-head-actions">${chargedBadge}${actionBtn}</div>
      </div>
    </div>
    ${hasDetails ? `<div class="sc-details">${detailsHtml.join('')}</div>` : ''}
    <div class="sc-body">
      ${slotChips}
      ${teamBtn ? `<div style="margin-top:var(--sp3);text-align:center">${teamBtn}</div>` : ''}
      ${wlHtml}
    </div>
  </div>`;
}

// ── Guest helpers ──
function baseId(v) { return v ? v.split('|')[0] : null; }

function getLastParticipationDate(playerId) {
  if (!S.sessions || !S.sessions.length) return null;
  const today = toDS(new Date());
  const sortedSessions = [...S.sessions]
    .filter(s => s.date < today && !s.cancelled)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const s of sortedSessions) {
    if (!s.courts) continue;
    const activeCourts = s.disabledCourts 
      ? s.courts.filter((_, i) => !s.disabledCourts.includes(i))
      : s.courts;
    const wasInSession = activeCourts.flat().some(v => v && baseId(v) === playerId);
    if (wasInSession) return s.date;
  }
  return null;
}

function formatCancelHours(hours) {
  if (hours === null || hours === undefined) return '';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h + ':' + String(m).padStart(2, '0');
}

function parseCancelHours(str) {
  if (!str || str.trim() === '') return null;
  const parts = str.trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
  return h + m / 60;
}

function getEffectiveCancelHours(date) {
  const sess = S.sessions?.find(s => s.date === date);
  if (sess && sess.cancelHours !== null && sess.cancelHours !== undefined) return parseFloat(sess.cancelHours);
  if (S.series && S.cfg.sr_enabled !== '0') {
    const dObj = new Date(date + 'T00:00:00');
    const dayOfWeek = dObj.getDay();
    for (const series of S.series) {
      if (!series.enabled) continue;
      const days = series.daysOfWeek || [2];
      if (days.includes(dayOfWeek) || generateSeriesDates(series).includes(date)) {
        if (series.cancelHours !== null && series.cancelHours !== undefined) return parseFloat(series.cancelHours);
      }
    }
  }
  return parseFloat(S.cfg.cancel_hours) || 7;
}

function getCancelDeadline(date) {
  const hours = getEffectiveCancelHours(date);
  const { start } = getSessionTime(date);
  const [h, m] = start.split(':').map(Number);
  const sessionDate = new Date(date + 'T00:00:00');
  sessionDate.setHours(h, m, 0, 0);
  return new Date(sessionDate.getTime() - hours * 3600000);
}

function isWithinCancelWindow(date) {
  return new Date() < getCancelDeadline(date);
}

async function guestAssign(date, ci, si) {
  if (!guestId) { showToast('Bitte zuerst Profil wählen.'); return; }
  const sess = getOrSess(date);
  const mySlots = sess.courts.flat().filter(v => v && baseId(v) === guestId);
  if (mySlots.length >= 3) { showToast('Max. 2 Gäste erlaubt.'); return; }
  
  const isGuest = mySlots.length > 0;
  let usePid = guestId;
  if (isGuest) {
    const gn = mySlots.length; 
    usePid = guestId + '|g' + gn;
  }
  
  try {
    // 1. Dem Server den exakten Befehl geben
    await apiFetch('POST', `/sessions/${date}/book`, {
      court_index: ci,
      slot_index: si,
      player_id: usePid
    });
    
    // 2. Den "echten" Zustand vom Server laden (falls wir überschrieben wurden)
    await loadState();
    renderSessions();
    if (isAdmin) renderAdminPlan();
    showToast(isGuest ? t('toast.guest_booked') : t('toast.slot_booked'));
    
  } catch(e) {
    // Falls jemand anderes Millisekunden schneller war:
    await loadState(); 
    renderSessions();
    showToast('❌ ' + (e.message || 'Buchung fehlgeschlagen.'));
  }
}

async function guestAssignAny(date) {
  if (!guestId) { showToast('Bitte Namen auswählen.'); return; }
  const sess = getOrSess(date);
  for (let ci = 0; ci < sess.courts.length; ci++) {
    if (sess.disabledCourts && sess.disabledCourts.includes(ci)) continue;
    for (let si = 0; si < sess.courts[ci].length; si++) {
      if (!sess.courts[ci][si]) { await guestAssign(date, ci, si); return; }
    }
  }
  showToast('Kein freier Slot.');
}
async function removeGuestSlot(date, ci, si) {
  try {
    // Nur diesen einen spezifischen Slot räumen
    await apiFetch('POST', `/sessions/${date}/leave`, {
      court_index: ci,
      slot_index: si
    });
    
    await loadState();
    renderSessions();
    if (isAdmin) renderAdminPlan();
  } catch(e) {
    showToast('Fehler beim Entfernen des Gastes.');
  }
}

async function leaveSession(date) {
  try {
    // Backend den kompletten Leave-Vorgang inkl. Warteliste managen lassen
    await apiFetch('POST', `/sessions/${date}/leave`, {
      player_id: guestId
    });
    
    await loadState();
    renderSessions();
    if (isAdmin) renderAdminPlan();
    showToast(t('toast.left_session'));
  } catch(e) {
    await loadState();
    renderSessions();
    if (isAdmin) renderAdminPlan();
    
    showToast(e.message ? '❌ ' + e.message : 'Abmelden fehlgeschlagen.');
  }
}

async function joinWaitlist(date) {
  if (!guestId) { showToast('Bitte Namen auswählen.'); return; }
  const sess = getOrSess(date);
  if (sess.waitlist.includes(guestId)) { showToast('Bereits auf Warteliste.'); return; }
  try {
    await apiFetch('POST', `/sessions/${date}/join-waitlist`, {
      player_id: guestId
    });
    await loadState();
    renderSessions();
    showToast(t('toast.on_waitlist'));
  } catch(e) {
    showToast('Warteliste fehlgeschlagen.');
  }
}

async function removeFromWaitlist(date, pid) {
  try {
    await apiFetch('POST', `/sessions/${date}/leave`, {
      player_id: pid
    });
    await loadState();
    renderSessions();
    showToast('Von Warteliste entfernt.');
  } catch(e) {
    showToast('Abmelden von Warteliste fehlgeschlagen.');
  }
}

async function guestJoinWaitlist(date) {
  if (!guestId) { showToast('Bitte Namen auswählen.'); return; }
  const sess = getOrSess(date);
  const total = sess.courts.filter((_,i) => !sess.disabledCourts.includes(i)).flat().length;
  const filled = sess.courts.flat().filter(Boolean).length;
  if (filled < total) { await guestAssignAny(date); return; }
  const myWlEntries = sess.waitlist.filter(pid => baseId(pid) === guestId);
  const guestEntries = myWlEntries.filter(pid => pid.includes('|'));
  if (guestEntries.length >= 2) { showToast('Max. 2 Gäste auf Warteliste erlaubt.'); return; }
  const g1Taken = sess.waitlist.includes(guestId + '|g1');
  const newId = g1Taken ? guestId + '|g2' : guestId + '|g1';
  if (sess.waitlist.includes(newId)) { showToast('Gast bereits auf Warteliste.'); return; }
  try {
    await apiFetch('POST', `/sessions/${date}/join-waitlist`, { player_id: newId });
    await loadState();
    renderSessions();
    lucide.createIcons();
    showToast('Gast auf Warteliste gesetzt.');
  } catch(e) {
    showToast(e.message || t('session.waitlist_failed'));
  }
}

// ════════════════════════════════════════
// ADMIN – ALL RENDER
// ════════════════════════════════════════
function renderAll() {
  renderKPIs();
  renderExpenses();
  renderPlayerActivityTable();
  renderAdminPlan();
  renderPlayers();
  renderHistory();
  renderMyHistory();
  renderMyTransactions();
  renderSeries();
  syncSettings();
  syncGuestIdentity();
  renderSessions();
  lucide.createIcons();
  syncSwipeHeight();
}

// ════════════════════════════════════════
// EXPENSES (AUSGABEN)
// ════════════════════════════════════════
function renderExpenses() {
  const el = document.getElementById('expenses-container');
  if (!el) return;
  if (!S.expenses || !S.expenses.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1"><i data-lucide="credit-card"></i><h3>${t('dashboard.no_expenses')}</h3></div>`;
    return;
  }
  const sorted = [...S.expenses].sort((a,b) => b.date.localeCompare(a.date));
  
  el.innerHTML = sorted.map(ex => {
    const dObj = new Date(ex.date + 'T00:00:00');
    const monthStr = dObj.toLocaleDateString('de-DE', { month: 'short' }).toUpperCase().replace('.', '');
    const dayNum = dObj.toLocaleDateString('de-DE', { day: 'numeric' });
    
    return `<div class="expense-card">
      <div class="expense-date-badge">
        <div class="month">${esc(monthStr)}</div>
        <div class="day">${esc(dayNum)}</div>
      </div>
      <div class="expense-card-details">
        <div class="expense-card-note">${esc(ex.note || t('nav.expenses'))}</div>
        <div class="expense-card-meta">${fmtD(ex.date)}</div>
      </div>
      <div class="expense-card-right">
        <div class="expense-card-amount">– ${fmtE(ex.amount)}</div>
        <div class="expense-card-actions">
          <button class="btn btn-sec btn-sm" onclick="editExpense('${ex.id}')" style="width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;min-height:34px"><i data-lucide="edit-2" style="width:14px;height:14px"></i></button>
          <button class="btn btn-dan btn-sm" onclick="deleteExpense('${ex.id}')" style="width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;min-height:34px"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function openExpenseModal() {
  document.getElementById('ex-amount').value = '';
  document.getElementById('ex-date').value = toDS(new Date());
  document.getElementById('ex-note').value = '';
  openMo('mo-expense');
  setTimeout(() => document.getElementById('ex-amount').focus(), 100);
}
async function saveExpense() {
  const amt = parseFloat(document.getElementById('ex-amount').value);
  if (!amt || amt <= 0) { showToast('Gültigen Betrag eingeben.'); return; }
  const date = document.getElementById('ex-date').value || toDS(new Date());
  const note = document.getElementById('ex-note').value.trim();
  try {
    const res = await apiFetch('POST', '/expenses', { amount: amt, date, note });
    if (!S.expenses) S.expenses = [];
    S.expenses.push({ id: res.id, amount: amt, date, note, createdAt: new Date().toISOString() });
    closeMo('mo-expense');
    renderAll();
    showToast(t('toast.expense_saved'));
  } catch (e) {
    console.error('saveExpense error', e);
  }
}

let expenseToDelete = null;
let editExpenseId = null;

function editExpense(exId) {
  const ex = S.expenses.find(x => x.id === exId);
  if (!ex) return;
  editExpenseId = exId;
  document.getElementById('eex-amount').value = ex.amount;
  document.getElementById('eex-date').value = ex.date;
  document.getElementById('eex-note').value = ex.note || '';
  openMo('mo-edit-expense');
  setTimeout(() => document.getElementById('eex-amount').focus(), 100);
}

async function saveEditedExpense() {
  if (!editExpenseId) return;
  const amt = parseFloat(document.getElementById('eex-amount').value);
  if (!amt || amt <= 0) { showToast('Gültigen Betrag eingeben.'); return; }
  const date = document.getElementById('eex-date').value || toDS(new Date());
  const note = document.getElementById('eex-note').value.trim();
  try {
    await apiFetch('PUT', '/expenses/' + editExpenseId, { amount: amt, date, note });
    const idx = S.expenses.findIndex(x => x.id === editExpenseId);
    if (idx >= 0) {
      S.expenses[idx] = { ...S.expenses[idx], amount: amt, date, note };
    }
    editExpenseId = null;
    closeMo('mo-edit-expense');
    renderAll();
    showToast(t('toast.expense_updated'));
  } catch (e) {
    console.error('saveEditedExpense error', e);
  }
}

function deleteExpense(exId) {
  expenseToDelete = exId;
  openMo('mo-del-expense');
}

async function confirmDeleteExpense() {
  if (expenseToDelete === null) return;
  try {
    await apiFetch('DELETE', '/expenses/' + expenseToDelete);
    if (!S.expenses) S.expenses = [];
    S.expenses = S.expenses.filter(x => x.id !== expenseToDelete);
    expenseToDelete = null;
    closeMo('mo-del-expense');
    renderAll();
    showToast(t('toast.expense_deleted'));
  } catch (e) {
    console.error('confirmDeleteExpense error', e);
  }
}


// ════════════════════════════════════════
// ADMIN – KPIs
// ════════════════════════════════════════
function bal(pid) {
  // Falls es ein Gast-Slot ist (z.B. "123|g1"), nimm die ID des Hauptspielers
  const rawId = pid.includes('|') ? pid.split('|')[0] : pid;
  
  // Finde den Spieler in der Liste
  const p = S.players.find(x => x.id === rawId);
  
  // Gib direkt das vom Server gelieferte Guthaben zurück
  return p && p.balance !== undefined ? parseFloat(p.balance) : 0;
}
function renderKPIs() {
  const paid = S.transactions.filter(t => t.credit).reduce((s, t) => s + t.amount, 0);
  const exp = (S.expenses || []).reduce((s, x) => s + x.amount, 0);
  const cf = paid - exp;
  const totalBal = S.transactions.reduce((s, t) => s + (t.credit ? t.amount : -t.amount), 0);

   const kpis = [
     { l: t('dashboard.kpi_expenses'), v: fmtE(exp), c: 'neg', s: t('dashboard.kpi_expenses_sub') },
     { l: t('dashboard.kpi_payments'), v: fmtE(paid), c: 'pos', s: t('dashboard.kpi_payments_sub') },
     { l: t('dashboard.kpi_cashflow'), v: fmtE(cf), c: cf < 0 ? 'neg' : cf === 0 ? '' : 'pos', s: cf < 0 ? t('dashboard.kpi_cashflow_advance') : t('dashboard.kpi_cashflow_covered') },
     { l: t('dashboard.kpi_total_balance'), v: fmtE(totalBal), c: totalBal >= 0 ? 'pos' : 'neg', s: t('dashboard.kpi_total_balance_sub') },
   ];
  document.getElementById('kpi-container').innerHTML = kpis.map(k =>
    `<div class="kpi"><div class="kpi-lbl">${k.l}</div><div class="kpi-val ${k.c}">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
}
function renderPlayerActivityTable() {
  const el = document.getElementById('balance-table');
  if (!el) return;
  const activePlayers = S.players.filter(p => p.active !== false);
  if (!activePlayers.length) { el.innerHTML = ''; return; }

  const sorted = [...activePlayers].sort((a, b) => {
    let valA, valB;
    if (activitySortColumn === 'name') {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
    } else if (activitySortColumn === 'lastInteraction') {
      valA = a.lastInteraction || '';
      valB = b.lastInteraction || '';
    } else if (activitySortColumn === 'lastLogin') {
      valA = a.lastLogin || '';
      valB = b.lastLogin || '';
    } else if (activitySortColumn === 'lastParticipation') {
      valA = getLastParticipationDate(a.id) || '';
      valB = getLastParticipationDate(b.id) || '';
    }
    if (valA < valB) return activitySortAsc ? -1 : 1;
    if (valA > valB) return activitySortAsc ? 1 : -1;
    return 0;
  });

  const arrow = activitySortAsc ? '↑' : '↓';

  el.innerHTML = `<div class="tw"><table class="dt"><thead><tr>
       <th onclick="sortActivityTable('name')">${t('players.name_sort')} ${activitySortColumn === 'name' ? arrow : ''}</th>
       <th onclick="sortActivityTable('lastLogin')">${t('players.login_sort')} ${activitySortColumn === 'lastLogin' ? arrow : ''}</th>
       <th onclick="sortActivityTable('lastInteraction')">${t('players.activity_sort')} ${activitySortColumn === 'lastInteraction' ? arrow : ''}</th>
       <th onclick="sortActivityTable('lastParticipation')">${t('players.last_participation')} ${activitySortColumn === 'lastParticipation' ? arrow : ''}</th>
     </tr></thead><tbody>
    ${sorted.map(p => {
      const partDate = getLastParticipationDate(p.id);
      return `<tr>
        <td class="fw6">${esc(p.name)}</td>
        <td class="txm txxs">${p.lastLogin ? fmtDTS(p.lastLogin) : '–'}</td>
        <td class="txm txxs">${p.lastInteraction ? fmtDTS(p.lastInteraction) : '–'}</td>
        <td class="txm txxs">${partDate ? fmtD(partDate) : '–'}</td>
      </tr>`;}).join('')}
  </tbody></table></div>`;
}

function sortActivityTable(column) {
  if (activitySortColumn === column) {
    activitySortAsc = !activitySortAsc;
  } else {
    activitySortColumn = column;
    activitySortAsc = true;
  }
  renderPlayerActivityTable();
  lucide.createIcons();
}

// ════════════════════════════════════════
// ADMIN – SESSION PLANNER
// ════════════════════════════════════════
function renderAdminPlan() {
  if (!S.sessions) return;
  if (!planDate) {
    const dates = getAllSessionDatesAdmin();
    const today = toDS(new Date());
    planDate = dates.find(d => d >= today) || dates[0] || today;
  }
  const allDates = getAllSessionDatesAdmin();
  if (!allDates.includes(planDate) && allDates.length > 0) {
    planDate = allDates[0];
  }

  // Check session state from DB directly (before getOrSess modifies it)
  const rawSess = S.sessions?.find(s => s.date === planDate);
  const isCancelled = rawSess?.cancelled ?? false;

  const sess = getOrSess(planDate);
  if (!sess) return;
  if (!sess.disabledCourts) sess.disabledCourts = [];
  const sessTime = getSessionTime(planDate);
  const cancelBtn = !sess.charged
    ? (isCancelled
        ? '<button class="btn btn-ok btn-sm" onclick="toggleSessionCancel()"><i data-lucide="rotate-ccw"></i> ' + t('session.reactivate') + '</button>'
        : '<button class="btn btn-dan btn-sm" onclick="toggleSessionCancel()"><i data-lucide="x-circle"></i> ' + t('session.cancel') + '</button>')
    : '';

  // Build session selector dropdown
  const today = toDS(new Date());
  const upcomingDates = allDates.filter(d => d >= today);
  const pastDates = allDates.filter(d => d < today);
  let sessionOptions = upcomingDates.map(d => {
    const selected = d === planDate ? ' selected' : '';
    const label = `${fmtDL(d)} (${getSessionName(d)})`;
    const sess = S.sessions?.find(s => s.date === d);
    const badge = sess?.charged ? ' ✓' : (sess?.cancelled ? ' ✕' : '');
    return `<option value="${d}"${selected}>${label}${badge}</option>`;
  }).join('');
  if (pastDates.length > 0) {
    if (upcomingDates.length > 0) sessionOptions += `<optgroup label="${t('session.past_sessions')}">`;
    sessionOptions += pastDates.map(d => {
      const selected = d === planDate ? ' selected' : '';
      const label = `${fmtDL(d)} (${getSessionName(d)})`;
      const sess = S.sessions?.find(s => s.date === d);
      const badge = sess?.charged ? ' ✓' : (sess?.cancelled ? ' ✕' : '');
      return `<option value="${d}"${selected}>${label}${badge}</option>`;
    }).join('');
    if (upcomingDates.length > 0) sessionOptions += '</optgroup>';
  }

  document.getElementById('admin-plan-header-dynamic').innerHTML = '';

  // Session selector card
  let selectorBox = document.getElementById('session-selector-box');
  if (!selectorBox) {
    selectorBox = document.createElement('div');
    selectorBox.id = 'session-selector-box';
    selectorBox.className = 'card mb4';
    document.getElementById('admin-plan-header-dynamic').parentNode.insertBefore(selectorBox, document.getElementById('admin-plan-header-dynamic').nextSibling);
  }
  selectorBox.innerHTML = `
    <div class="flex items-c just-b mb4">
      <h3 class="sec-title" style="margin-bottom:0">${t('session.select')}</h3>
      <button class="btn btn-pri btn-sm" onclick="openAddSessionModal()"><i data-lucide="calendar-plus"></i> ${t('session.new')}</button>
    </div>
    <p class="txxs tx-m" style="margin-top:var(--sp2)">${t('session.edit_info')}</p>
    <div class="session-selector-bar" style="margin-top:var(--sp3)">
      <select id="session-selector" class="fi" style="flex:1;font-size:var(--text-sm)" onchange="planGoToDate(this.value)">
        ${sessionOptions}
      </select>
    </div>
    <div class="flex items-c just-b" style="margin-top:var(--sp3)">
      <div class="flex g2">
        <button class="btn btn-sec btn-sm" onclick="planPrev()"><i data-lucide="chevron-left"></i></button>
        <button class="btn btn-sec btn-sm" onclick="planGoToUpcoming()" title="${t('session.next')}"><i data-lucide="clock"></i></button>
        <button class="btn btn-sec btn-sm" onclick="planNext()"><i data-lucide="chevron-right"></i></button>
      </div>
      
    </div>
    `;

  // Session Details card (inserted after selector box)
  let detailsBox = document.getElementById('session-details-box');
  if (!detailsBox) {
    detailsBox = document.createElement('div');
    detailsBox.id = 'session-details-box';
    detailsBox.className = 'card mb4';
    selectorBox.parentNode.insertBefore(detailsBox, selectorBox.nextSibling);
  }
  detailsBox.innerHTML = `
    <h3 class="sec-title">${t('session.edit')}</h3>
    <div style="display:flex;align-items:center;gap:var(--sp2);margin-top:var(--sp3);flex-wrap:nowrap;">
      <span class="tx-sm tx-m">${t('session.date')}:</span>
      <input type="date" class="fi" style="font-size:var(--text-sm)"
             value="${planDate}"
             onchange="planDetailChange('date', this.value)">
    </div>
    <p class="txxs tx-m" style="margin:2px 0 0 0">${t('session.date_hint')}</p>
    <div style="display:flex;align-items:center;gap:var(--sp2);margin-top:var(--sp2);flex-wrap:nowrap;">
      <span class="tx-sm tx-m">${t('session.time')}:</span>
      <input type="time" class="fi" style="max-width:110px;font-size:var(--text-sm);"
             value="${sessTime.start}"
             onchange="planDetailChange('timeStart', this.value)">
      <span class="tx-sm tx-m">–</span>
      <input type="time" class="fi" style="max-width:110px;font-size:var(--text-sm);"
             value="${sessTime.end}"
             onchange="planDetailChange('timeEnd', this.value)">
    </div>
    <div style="display:flex;align-items:center;gap:var(--sp2);margin-top:var(--sp2);flex-wrap:wrap">
      <span class="tx-sm tx-m">${t('session.name')}:</span>
      <input type="text" id="plan-name-input" class="fi" placeholder="${esc(getSessionName(planDate))}"
         style="flex:1;min-width:200px;font-size:var(--text-sm)"
         value="${esc(sess.name || '')}"
         onchange="planDetailChange('name', this.value)">
    </div>
    <div style="display:flex;align-items:center;gap:var(--sp2);margin-top:var(--sp2);flex-wrap:wrap">
      <span class="tx-sm tx-m">${t('session.address')}</span>
      <input type="text" class="fi" placeholder="${esc(S.cfg.srlocation || t('session.address_placeholder'))}"
         style="flex:1;min-width:200px;font-size:var(--text-sm)"
         value="${esc(sess.location || '')}"
         onchange="planDetailChange('location', this.value)">
    </div>
    <div style="display:flex;align-items:center;gap:var(--sp2);margin-top:var(--sp2);flex-wrap:wrap;">
      <span class="tx-sm tx-m">${t('session.comment')}:</span>
      <input type="text" id="plan-note-input" class="fi" placeholder="${t('session.comment_placeholder')}"
         style="flex:1;min-width:200px;font-size:var(--text-sm)"
         value="${esc(sess.note || '')}"
         onchange="planDetailChange('note', this.value)">
    </div>
    <div style="display:flex;align-items:center;gap:var(--sp2);margin-top:var(--sp2);flex-wrap:nowrap;">
      <span class="tx-sm tx-m">${t('session.price')}:</span>
      <input type="number" id="plan-price-input" class="fi" placeholder="${S.cfg.sr_cost || S.cfg.cost || 16}"
         style="max-width:120px;font-size:var(--text-sm)"
         value="${sess.price !== null && sess.price !== undefined ? sess.price : ''}"
         onchange="planDetailChange('price', this.value)">
    </div>
    <p class="txxs tx-m" style="margin:2px 0 0 var(--sp2)">${t('session.per_slot')}</p>
    <div style="display:flex;align-items:center;gap:var(--sp2);margin-top:var(--sp2);flex-wrap:nowrap;">
      <span class="tx-sm tx-m">${t('session.cancel_deadline')}:</span>
      <input type="text" id="plan-cancel-hours" class="fi" placeholder="7:00"
         style="max-width:100px;font-size:var(--text-sm)"
         value="${sess.cancelHours !== null && sess.cancelHours !== undefined ? formatCancelHours(sess.cancelHours) : ''}"
         onchange="planDetailChange('cancelHours', parseCancelHours(this.value))">
    </div>
    <p class="txxs tx-m" style="margin:2px 0 0 var(--sp2)">${t('session.cancel_deadline_hint')}</p>
    <div class="flex g2 wrap" style="margin-top:var(--sp3)">
      <button class="btn btn-pri btn-sm" onclick="savePlanDetails()"><i data-lucide="save"></i> ${t('misc.save')}</button>
      ${cancelBtn}
      ${isCancelled && !sess.charged ? '<button class="btn btn-dan btn-sm" onclick="deleteSession()"><i data-lucide="trash-2"></i> ' + t('misc.delete') + '</button>' : ''}
    </div>
  `;

  const activeCourts = sess.courts.filter((_, i) => !sess.disabledCourts.includes(i));
  const allPids = [...new Set(activeCourts.flat().filter(Boolean))];
  const total = activeCourts.length * 4;
  const filled = allPids.length;
  document.getElementById('plan-slots-meta').textContent = `${filled} / ${total} ${t('session.slots_meta')} · ${activeCourts.length} ${t('session.court_s')} ${sess.disabledCourts.length > 0 ? `(${sess.disabledCourts.length} ${t('session.disabled')})` : ''}`;
  const playerMap = new Map(S.players.map(p => [p.id, p]));

  // Unified slot editor grouped visually by court
  let html = '';
  sess.courts.forEach((slots, ci) => {
    const isDisabled = sess.disabledCourts.includes(ci);
    const customName = (sess.courtNames && sess.courtNames[ci]) ? sess.courtNames[ci] : '';
    html += `<div class="court-sep just-b" style="align-items:center;margin-top:var(--sp4);margin-bottom:var(--sp2);gap:var(--sp2)">
      <div class="flex items-c g2" style="flex:1;min-width:0;flex-wrap:wrap">
        <i data-lucide="map-pin" style="width:14px;height:14px;color:var(--pri);flex-shrink:0"></i>
        <span style="font-weight:700;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--txm)">${t('session.court')} ${ci + 1}</span>
        <input type="text"
               id="court-name-input-${ci}"
               class="fi court-name-input"
               style="max-width:170px;padding:2px 8px;font-size:var(--text-xs);font-weight:600;height:28px"
               placeholder="${t('session.court_number_placeholder')}"
               value="${esc(customName)}"
               onchange="changeCourtName('${planDate}', ${ci}, this.value)"
               title="${t('session.court_numbers')}"
               ${sess.charged ? 'disabled' : ''}>
        ${isDisabled ? '<span class="badge bg-err">' + t('session.cancelled') + '</span>' : ''}
      </div>
      <div class="flex items-c g2" style="flex-shrink:0">
        ${!sess.charged ? `<button class="btn btn-xs ${isDisabled ? 'btn-ok' : 'btn-dan'}" onclick="toggleCourt('${planDate}', ${ci})">${isDisabled ? t('session.activate') : t('session.deactivate')}</button>` : ''}
        ${isDisabled && !sess.charged ? `<button class="btn btn-xs btn-dan" onclick="deleteCourt('${planDate}', ${ci})"><i data-lucide="trash-2"></i></button>` : ''}
      </div>
    </div>`;

    if (isDisabled) {
      html += `<div class="txsm txm mb4">${t('session.court_cancelled_info')}</div>`;
    } else {
      html += `<div class="admin-slots-grid">`;
    slots.forEach((pid, si) => {
      const rawId = pid ? pid.split('|')[0] : null;
      const p = rawId ? playerMap.get(rawId) : null;
      const guestLabel = pid && pid.includes('|') ? ` (${t('misc.guest')})` : '';
      if (p) {
        html += `<div class="admin-slot filled" onclick="${sess.charged ? '' : `openSlotModal('${planDate}',${ci},${si})`}">
          <div class="av" style="width:32px;height:32px;font-size:var(--text-sm)"><i data-lucide="${playerIcon(p)}" style="width:16px;height:16px"></i></div>
          <span class="slot-name">${esc(p.name)}${guestLabel}</span>
        </div>`;
      } else {
        html += `<div class="admin-slot" onclick="${sess.charged ? '' : `openSlotModal('${planDate}',${ci},${si})`}">
          <i data-lucide="user-plus" style="width:16px;height:16px;color:var(--txf)"></i>
          <span class="slot-ph">${t('session.choose_player')}</span>
        </div>`;
      }
    });
    html += `</div>`;
    } // end else
  });
  document.getElementById('plan-slots-editor').innerHTML = html;

  // Waitlist admin panel
  const wlEl = document.getElementById('plan-waitlist-admin');
  const adminWlBtn = `<button class="btn btn-sec btn-sm" style="margin-top:var(--sp3)" onclick="adminAddToWaitlist('${planDate}')"><i data-lucide="list-plus"></i> ${t('session.waitlist_add')}</button>`;
  if (sess.waitlist.length) {
    wlEl.innerHTML = `<h3 class="sec-title">${t('session.waitlist')}</h3>
    <div class="wl-list">${sess.waitlist.map((pid, i) => {
      const displayName = getDisplayName(pid, playerMap);
      const rawPid = pid.includes('|') ? pid.split('|')[0] : pid;
      const wlP = playerMap.get(rawPid);
      return `<div class="slot-chip wl" style="padding:var(--sp2) var(--sp3)">
        <span style="font-size:var(--text-xs);color:var(--txm);font-weight:700;min-width:16px">${i + 1}.</span>
        <div class="slot-av"><i data-lucide="${playerIcon(wlP || displayName.replace(` (${t('misc.guest')})`, ''))}" style="width:14px;height:14px"></i></div>
        <span>${esc(displayName)}</span>
        <button class="btn-xs btn-ok" style="margin-left:auto;border-radius:var(--r-sm)" onclick="promoteWaitlist('${planDate}',${i})"><i data-lucide="arrow-up" style="width:10px;height:10px"></i> ${t('session.waitlist_promote')}</button>
        <button class="btn-xs btn-dan" style="border-radius:var(--r-sm)" onclick="removeWaitlist('${planDate}',${i})"><i data-lucide="x" style="width:10px;height:10px"></i></button>
      </div>`;
    }).join('')}</div>${adminWlBtn}`;
  } else {
    wlEl.innerHTML = `<h3 class="sec-title" style="margin-bottom:var(--sp2)">${t('session.waitlist')}</h3><p class="txsm txm">${t('session.no_entries')}</p>${adminWlBtn}`;
  }

  // Summary
  const sumEl = document.getElementById('plan-summary');
  const chargeBtn = !sess.charged && allPids.length > 0
    ? '<button class="btn btn-pri btn-sm" style="margin-top:var(--sp3)" onclick="openChargeModal()"><i data-lucide="credit-card"></i> ' + t('session.billing_charge') + '</button>'
    : '';
   if (!allPids.length) { sumEl.innerHTML = `<h3 class="sec-title">${t('session.billing_preview')}</h3><p class="txsm txm">${t('session.billing_no_players')}</p>${chargeBtn}`; }
   else {
     const chargeMap = getChargeMap(sess);
     sumEl.innerHTML = `<h3 class="sec-title">${t('session.billing_preview')}</h3>
     <div class="tw"><table class="dt"><thead><tr><th>${t('session.billing_player')}</th><th>${t('session.billing_balance')}</th><th>${t('session.billing_after')}</th></tr></thead><tbody>
    ${Object.entries(chargeMap).map(([pid, n]) => {
      const name = getDisplayName(pid, playerMap);
      const b = bal(pid);
      const amt = S.cfg.cost * n;
      const after = b - amt;
      const guestInfo = n > 1 ? `<span style="opacity:.6;font-size:var(--text-xs)"> +${n-1} ${t('misc.guest')}</span>` : '';
      return `<tr><td class="fw6">${esc(name)}${guestInfo}</td>
        <td style="color:${b<0?'var(--err)':b===0?'var(--txm)':'var(--suc)'}">${fmtE(b)}</td>
        <td style="color:${after<0?'var(--err)':after===0?'var(--txm)':'var(--suc)'}">${fmtE(after)}</td>
      </tr>`;}).join('')}
    </tbody></table></div>
    ${chargeBtn}`;
  }
  renderSessionHistory(planDate);
  lucide.createIcons();
}


async function renderSessionHistory(date) {
  const el = document.getElementById('plan-history-content');
  if (!el) return;
  el.innerHTML = '<div class="txsm txm">' + t('session.history_loading') + '</div>';
  try {
    const data = await apiFetch('GET', '/session-history?date=' + date);
    if (!data.length) {
      el.innerHTML = '<div class="empty"><i data-lucide="clock"></i><p>' + t('session.history_no_activity') + '</p></div>';
      lucide.createIcons();
      return;
    }

    const badgeCfg = {
      book:            { label: t('session.booked'),        cls: 'bg-ok'  },
      leave:           { label: t('history.leave'),     cls: 'bg-err' },
      waitlist_join:   { label: t('session.waitlist'),     cls: 'bg-gld' },
      waitlist_leave:  { label: t('history.waitlist_leave'),   cls: 'bg-err' },
      promoted:        { label: t('history.promoted'),  cls: 'bg-ok'  },
      court_cancelled:{ label: t('session.court_cancelled'),cls: 'bg-neu' },
    };

    el.innerHTML = data.map(h => {
      const cfg = badgeCfg[h.action] ?? { label: h.action, cls: 'bg-sec' };
      const displayName = getDisplayName(h.player_id) || h.player_name || '?';
      const isGuest = h.player_id?.includes('|');
      const rawPid = h.player_id?.includes('|') ? h.player_id.split('|')[0] : h.player_id;
      const hp = rawPid ? S.players.find(x => x.id === rawPid) : null;

      const guestTag = isGuest ? `<span style="opacity:.6;font-size:var(--text-xs)">${t('misc.guest')}</span>` : '';

      const isCourtCancel = h.action === 'court_cancelled';
      const nameDisplay = isCourtCancel
        ? `<span class="tx-m tx-sm">${t('session.court')} ${(h.court_index ?? 0) + 1}</span>`
        : `<span class="fw6">${esc(displayName)}</span>${guestTag}`;

      const performerName = h.performed_by_name || (h.performed_by === 'admin' ? 'Admin' : '');
      const baseDisplayName = displayName.replace(` (${t('misc.guest')})`, '');
      const performerPart = (performerName && performerName !== baseDisplayName)
        ? t('history.by', { name: performerName }) : '';

      const dt = new Date(h.timestamp);
      const pad = n => String(n).padStart(2, '0');
      const time = `${pad(dt.getDate())}.${pad(dt.getMonth()+1)} - ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

      const metaParts = [performerPart, time].filter(Boolean).join(' · ');

      return `
      <div class="hi" style="align-items:center;gap:var(--sp3)">
        <div class="slot-av" style="width:32px;height:32px;font-size:var(--text-xs);flex-shrink:0">${isCourtCancel ? '🏟' : `<i data-lucide="${playerIcon(hp || displayName.replace(` (${t('misc.guest')})`, ''))}" style="width:16px;height:16px"></i>`}</div>
        <div class="hi-meta" style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--sp2)">
            <div style="display:flex;align-items:center;gap:var(--sp2);flex-wrap:wrap">
              ${nameDisplay}
            </div>
            <span class="badge ${cfg.cls}" style="flex-shrink:0">${esc(cfg.label)}</span>
          </div>
          <div class="hi-date" style="margin-top:2px">${metaParts}</div>
        </div>
      </div>`;
    }).join('');

    lucide.createIcons();
  } catch(e) {
    el.innerHTML = '<div class="txsm txm" style="color:var(--err)">' + t('session.history_error') + '</div>';
  }
}


async function changeCourtName(date, ci, val) {
  const sess = getOrSess(date);
  if (!sess.courtNames) sess.courtNames = [];
  while (sess.courtNames.length < sess.courts.length) {
    sess.courtNames.push('');
  }
  sess.courtNames[ci] = val.trim();
  const inMemory = S.sessions?.find(s => s.date === date);
  if (inMemory) {
    inMemory.courtNames = [...sess.courtNames];
  }
  try {
    await apiFetch('PUT', '/sessions/' + date, { courtNames: sess.courtNames });
    renderSessions();
    showToast(t('toast.saved'));
  } catch(e) {
    showToast('⚠️ ' + e.message);
  }
}

let courtToCancel = null;
async function toggleCourt(date, ci) {
  const sess = getOrSess(date);
  if (sess.charged) return;
  if (sess.disabledCourts.includes(ci)) {
    sess.disabledCourts = sess.disabledCourts.filter(x => x !== ci);
    await persistSession(sess);
    renderAdminPlan(); renderSessions();
    showToast(t('toast.court_activated', { n: ci + 1 }));
  } else {
    courtToCancel = { date, ci };
    document.getElementById('mo-del-court-title').textContent = t('court.cancel_title');
    openMo('mo-del-court');
  }
}

async function confirmCancelCourt() {
  if (!courtToCancel) return;
  const { date, ci } = courtToCancel;
  const sess = getOrSess(date);
  sess.disabledCourts.push(ci);
  sess.courts[ci] = [null, null, null, null];
  courtToCancel = null;
  await persistSession(sess);
  closeMo('mo-del-court');
  renderAdminPlan(); renderSessions();
  showToast(t('toast.court_cancelled', { n: ci + 1 }));
}

async function deleteCourt(date, ci) {
  if (!confirm(t('session.confirm_delete_court').replace('{n}', ci + 1))) return;
  const sess = getOrSess(date);
  sess.courts.splice(ci, 1);
  if (sess.courtNames && sess.courtNames.length > ci) {
    sess.courtNames.splice(ci, 1);
  }
  sess.disabledCourts = sess.disabledCourts.filter(i => i !== ci).map(i => i > ci ? i - 1 : i);
  await persistSession(sess);
  renderAdminPlan(); renderSessions();
  showToast(t('toast.court_deleted', { n: ci + 1 }));
}

async function toggleSessionCancel() {
  const rawSess = S.sessions.find(s => s.date === planDate);
  const isCancelled = rawSess?.cancelled || false;
  const newCancelled = !isCancelled;
  try {
    await apiFetch('PUT', '/sessions/' + planDate, { cancelled: newCancelled });
    await loadState();
    renderAdminPlan();
    renderSessions();
    lucide.createIcons();
    showToast(newCancelled ? t('toast.session_cancelled') : t('toast.session_reactivated'));
  } catch(e) {}
}

async function deleteSession() {
  showConfirmModal(
    t('misc.delete'),
    t('confirm.delete_session'),
    '<i data-lucide="trash-2"></i> ' + t('misc.delete'),
    'btn-dan',
    async () => {
      try {
        await apiFetch('DELETE', '/sessions/' + planDate);
        await loadState();
        const dates = getAllSessionDatesAdmin();
        const today = toDS(new Date());
        planDate = dates.find(d => d >= today) || dates[0] || today;
        renderAdminPlan();
        renderSessions();
        lucide.createIcons();
        showToast(t('toast.session_deleted'));
      } catch(e) {
        showToast(e.message || t('session.delete_failed'));
      }
    }
  );
}

async function addCourtToSessionFromBtn() { addCourtToSession(planDate); }

async function addCourtToSession(date) {
  const sess = getOrSess(date);
  if (sess.charged) { showToast(t('misc.already_charged')); return; }
  if (sess.courts.length >= 6) { showToast(t('misc.max_courts')); return; }
  sess.courts.push([null, null, null, null]);
  await persistSession(sess);
  renderAdminPlan(); renderSessions();
  showToast(t('toast.court_added', { n: sess.courts.length }));
}

function openAddSessionModal() {
  const today = toDS(new Date());
  const { start, end } = getSessionTime(today);
  document.getElementById('add-sess-date').value  = today;
  document.getElementById('add-sess-start').value = start;
  document.getElementById('add-sess-end').value   = end;
  openMo('mo-add-session');
}

async function saveAddSession() {
  const date  = document.getElementById('add-sess-date').value;
  const start = document.getElementById('add-sess-start').value.replace(':', '');
  const end   = document.getElementById('add-sess-end').value.replace(':', '');

  if (!date) { showToast(t('toast.date_required')); return; }

  const exists = S.sessions.find(s => s.date === date);
  if (exists) {
      showToast(t('toast.session_exists'));
      closeMo('mo-add-session');
      planDate = date;
      showView('admin-plan');
      renderAdminPlan();
      return;
  }

  try {
      await apiFetch('PUT', '/sessions/' + date, {
          courts:         Array(S.cfg.courts).fill([null,null,null,null]),
          disabledCourts: [],
          waitlist:       [],
          note:           '',
          timeStart:      start,
          timeEnd:        end,
      });
      await loadState();
      closeMo('mo-add-session');
      planDate = date;
      showView('admin-plan');
      renderAdminPlan();
      showToast(t('toast.session_created'));
  } catch(e) {
      showToast(e.message || t('toast.session_create_error'));
  }
}



function planGoToDate(date) {
  planDate = date;
  renderAdminPlan();
}

function planPrev() {
  const dates = getAllSessionDatesAdmin();
  const idx = dates.indexOf(planDate);
  planDate = idx > 0 ? dates[idx - 1] : (dates[0] || toDS(new Date()));
  renderAdminPlan();
}
function planNext() {
  const dates = getAllSessionDatesAdmin();
  const idx = dates.indexOf(planDate);
  planDate = idx >= 0 && idx < dates.length - 1 ? dates[idx + 1] : (dates[dates.length - 1] || toDS(new Date()));
  renderAdminPlan();
}
function planGoToUpcoming() {
  const today = toDS(new Date());
  const dates = getAllSessionDatesAdmin();
  const upcoming = dates.find(d => d >= today);
  planDate = upcoming || dates[dates.length - 1] || toDS(new Date());
  renderAdminPlan();
}

async function promoteWaitlist(date, idx) {
  const sess = getOrSess(date);
  const pid = sess.waitlist[idx];
  let placed = false;
  for (let ci = 0; ci < sess.courts.length && !placed; ci++) {
    if (sess.disabledCourts.includes(ci)) continue;
    for (let si = 0; si < sess.courts[ci].length && !placed; si++)
      if (!sess.courts[ci][si]) { sess.courts[ci][si] = pid; placed = true; }
  }
  if (!placed) { showToast('Kein freier Slot vorhanden.'); return; }
  sess.waitlist.splice(idx, 1);
  await persistSession(sess);
  renderAdminPlan(); renderSessions();
  const p = S.players.find(x => x.id === pid);
  showToast((p ? p.name : '?') + ' eingeteilt.');
}
async function removeWaitlist(date, idx) {
  const sess = getOrSess(date);
  sess.waitlist.splice(idx, 1);
  await persistSession(sess);
  renderAdminPlan(); renderSessions(); lucide.createIcons();
}

// ── Admin Slot Modal ──
function openSlotModal(date, ci, si) {
  slotCtx = { date, ci, si };
  document.getElementById('mo-slot-title').textContent = `${getCourtLabel(date, ci)} – ${t('session.position')} ${si + 1}`;
  const danBtn = document.getElementById('mo-slot').querySelector('.btn-dan');
  if (danBtn) danBtn.style.display = '';
  const sess = getOrSess(date);
  const allSlots = sess.courts.flat();
  const curVal = sess.courts[ci][si];
  const list = document.getElementById('mo-slot-list');
  list.innerHTML = S.players.filter(p => p.active !== false).map(p => {
    const b = bal(p.id);
    // Is this player's main slot taken (in a different slot than current)?
    const mainTaken = allSlots.some(v => v === p.id && v !== curVal);
    // How many guest slots does this player have?
    const guestSlots = allSlots.filter(v => v && v.startsWith(p.id + '|') && v !== curVal);
    const canGuest = !mainTaken ? guestSlots.length < 2 : guestSlots.length < 2;
    const g1Taken = allSlots.some(v => v === p.id + '|g1' && v !== curVal);
    const g2Taken = allSlots.some(v => v === p.id + '|g2' && v !== curVal);
    const gTag = !g1Taken ? p.id + '|g1' : p.id + '|g2';
    const sel = curVal === p.id;
    const selGuest = curVal === p.id + '|g1' || curVal === p.id + '|g2';
    const canAddGuest = canGuest && !g1Taken || !g2Taken;
    const guestAvail = !(g1Taken && g2Taken);
    return `<div style="display:flex;gap:6px;align-items:stretch;margin-bottom:4px">
      ${!mainTaken || sel ? `<button class="btn ${sel ? 'btn-pri' : 'btn-sec'} btn-full" onclick="assignSlot('${p.id}')" style="justify-content:space-between;flex:1">
        <span style="display:flex;align-items:center;gap:var(--sp2)"><div class="av" style="width:28px;height:28px;font-size:var(--text-xs)"><i data-lucide="${playerIcon(p)}" style="width:14px;height:14px"></i></div>${esc(p.name)}</span>
        <span style="font-size:var(--text-xs);color:${b < 0 ? 'var(--err)' : 'var(--suc)'}">${fmtE(b)}</span>
      </button>` : `<div class="btn btn-sec btn-full" style="justify-content:space-between;flex:1;opacity:.5;cursor:default">
        <span style="display:flex;align-items:center;gap:var(--sp2)"><div class="av" style="width:28px;height:28px;font-size:var(--text-xs)"><i data-lucide="${playerIcon(p)}" style="width:14px;height:14px"></i></div>${esc(p.name)} <span style="font-size:var(--text-xs);opacity:.6">(bereits gebucht)</span></span>
        <span style="font-size:var(--text-xs);color:${b < 0 ? 'var(--err)' : 'var(--suc)'}">${fmtE(b)}</span>
      </div>`}
      ${guestAvail ? `<button class="btn ${selGuest ? 'btn-pri' : 'btn-sec'}" onclick="assignSlot('${gTag}')" title="Gast buchen" style="padding:0 10px;white-space:nowrap;font-size:var(--text-xs)">+Gast</button>` : ''}
    </div>`;
  }).join('');
  openMo('mo-slot'); lucide.createIcons();
}
async function assignSlot(pid) {
  const sess = getOrSess(slotCtx.date);
  sess.courts[slotCtx.ci][slotCtx.si] = pid;
  await persistSession(sess);
  closeMo('mo-slot');
  renderAdminPlan(); renderSessions(); lucide.createIcons();
}
async function clearSlot() {
  const sess = getOrSess(slotCtx.date);
  sess.courts[slotCtx.ci][slotCtx.si] = null;
  await persistSession(sess);
  closeMo('mo-slot');
  renderAdminPlan(); renderSessions(); lucide.createIcons();
}

// ── Charge ──
function getChargeMap(sess) {
  // Returns map of baseId -> slotCount (main + guests)
  const activeCourts = sess.courts.filter((_, i) => !sess.disabledCourts.includes(i));
  const counts = {};
  activeCourts.flat().filter(Boolean).forEach(v => {
    const base = v.split('|')[0];
    counts[base] = (counts[base] || 0) + 1;
  });
  return counts;
}
function openChargeModal() {
  const sess = getOrSess(planDate);
  if (sess.charged) { showToast('Bereits abgerechnet.'); return; }
  const counts = getChargeMap(sess);
  const baseIds = Object.keys(counts);
  if (!baseIds.length) { showToast(t('session.billing_no_players')); return; }
  const totalSlots = Object.values(counts).reduce((a, b) => a + b, 0);
  const sessionCost = (sess.price !== null && sess.price !== undefined) ? sess.price : S.cfg.cost;
  document.getElementById('mo-charge-desc').textContent = `${baseIds.length} ${t('players.title').toLowerCase()} (${totalSlots} ${t('session.slots').toLowerCase()}) am ${fmtDL(planDate)} · ${fmtE(sessionCost)} ${t('session.per_slot')}`;

  document.getElementById('mo-charge-list').innerHTML = `<div class="tw"><table class="dt"><thead><tr><th>${t('players.title')}</th><th>${t('session.slots')}</th><th>${t('session.amount')}</th><th style="text-align:center">${t('session.paid')}</th></tr></thead><tbody>
    ${baseIds.map(pid => {
      const p = S.players.find(x => x.id === pid);
      const n = counts[pid];
      const amt = sessionCost * n;
      const guestInfo = n > 1 ? ` <span style="opacity:.6;font-size:var(--text-xs)">(+${n-1} ${t('misc.guest')})</span>` : '';
      return `<tr>
                <td>${esc(p ? p.name : '?')}${guestInfo}</td>
                <td style="text-align:center">${n}</td>
                <td>– ${fmtE(amt)}</td>
                <td style="text-align:center">
                  <input type="checkbox" class="paid-check" data-pid="${pid}" style="width:18px;height:18px;cursor:pointer;">
                </td>
              </tr>`;
    }).join('')}
  </tbody></table></div>`;
  openMo('mo-charge');
}
let isCharging = false; // Unsere unsichtbare Schranke für die Abrechnung

async function doCharge() {
  if (isCharging) return; // Wenn er schon arbeitet, Klick ignorieren
  isCharging = true;      // Schranke zu!

  // NEU: Alle angehakten Checkboxen finden und die IDs (PIDs) sammeln
  const paidChecks = document.querySelectorAll('.paid-check:checked');
  const paidPids = Array.from(paidChecks).map(cb => cb.dataset.pid);

  try {
    // Die Liste der "schon bezahlten" Spieler (paid_pids) an die API mitsenden
    await apiFetch('POST', '/charge', { 
      date: planDate,
      paid_pids: paidPids 
    });
    
    await loadState();
    closeMo('mo-charge');
    renderAll();
    showToast(t('toast.charged'));
  } catch(e) {
    showToast('Fehler beim Abrechnen: ' + (e.message || ''));
  }
  
  isCharging = false; // Ganz am Ende: Schranke wieder auf!
}

// ════════════════════════════════════════
// ADMIN – PLAYERS
// ════════════════════════════════════════
window.handlePlayerSearch = function(val) {
  playerSearchQuery = val;
  renderPlayers();
  lucide.createIcons();
};

window.handlePlayerSort = function(val) {
  playerSortOption = val;
  renderPlayers();
  lucide.createIcons();
};

function renderPlayers() {
  const g = document.getElementById('players-grid');
  if (!g) return;

  const searchInput = document.getElementById('player-search');
  if (searchInput) searchInput.value = playerSearchQuery;
  const sortSelect = document.getElementById('player-sort');
  if (sortSelect) sortSelect.value = playerSortOption;

  let activePlayers = S.players.filter(p => p.active !== false);
  const inactivePlayers = S.players.filter(p => p.active === false);

  if (!activePlayers.length && !inactivePlayers.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><i data-lucide="users"></i><h3>${t('players.no_players')}</h3><p>${t('players.add_first')}</p><button class="btn btn-pri" onclick="openAddPlayer()"><i data-lucide="user-plus"></i> ${t('players.add')}</button></div>`;
    return;
  }

  if (playerSearchQuery) {
    const query = playerSearchQuery.toLowerCase().trim();
    activePlayers = activePlayers.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.contact && p.contact.toLowerCase().includes(query))
    );
  }

  activePlayers.sort((a, b) => {
    let valA, valB;
    if (playerSortOption.startsWith('name')) {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
      const asc = playerSortOption === 'name_asc';
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else if (playerSortOption.startsWith('balance')) {
      valA = bal(a.id);
      valB = bal(b.id);
      const asc = playerSortOption === 'balance_asc';
      return asc ? valA - valB : valB - valA;
    }
    return 0;
  });

  let html = activePlayers.map(p => {
    const b = bal(p.id); 
    const cls = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';
    const txn = S.transactions.filter(t => t.playerId === p.id).length;
    const adminBadge = p.admin ? ` <span class="badge bg-pri" style="font-size:var(--text-xs);margin-left:6px">${t('misc.admin')}</span>` : '';
    return `<div class="pc">
      <div class="pc-head"><div class="av" onclick="openIconPickerModal('${p.id}')" style="cursor:pointer;transition:transform .15s" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform=''"><i data-lucide="${playerIcon(p)}" style="width:22px;height:22px"></i></div>
        <div><div class="pc-name" style="display:flex;align-items:center">${esc(p.name)}${adminBadge}</div><div class="pc-meta">${p.contact ? esc(p.contact) : txn + ' ' + t('transactions.title').toLowerCase()}</div></div></div>
      <div class="pc-bal-row">
        <div><div class="label">${t('players.balance')}</div><div class="pc-bal ${cls}">${fmtE(b)}</div></div>
      </div>
      <div class="pc-acts">
        <button class="btn btn-sm btn-ok" onclick="openTx('${p.id}')" title="${t('players.charge')}" style="width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;min-height:34px"><i data-lucide="dollar-sign" style="width:14px;height:14px"></i></button>
        <button class="btn btn-sm btn-sec" onclick="openEditPlayer('${p.id}')" title="Bearbeiten" style="width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;min-height:34px"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
        <button class="btn btn-sm btn-sec" onclick="openAdminSetPin('${p.id}')" title="PIN manuell vergeben" style="width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;min-height:34px"><i data-lucide="key-round" style="width:14px;height:14px"></i></button>
        <button class="btn btn-sm btn-dan" onclick="deletePlayer('${p.id}')" title="Deaktivieren" style="width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;min-height:34px"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
      </div>
    </div>`;
  }).join('');

  if (inactivePlayers.length) {
    html += `<hr style="margin:var(--sp5) 0;border:none;border-top:1px solid var(--b3);grid-column:1/-1"><div class="flex items-c just-b" style="margin-bottom:var(--sp3);grid-column:1/-1"><h3 style="margin:0;font-size:var(--text-sm);opacity:.6">${t('players.deleted')}</h3><span style="font-size:var(--text-xs);opacity:.4">${inactivePlayers.length} ${t('players.deleted_count')}</span></div>`;
    html += inactivePlayers.map(p => {
      const b = bal(p.id); const cls = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';
      return `<div class="pc" style="opacity:.5;grid-column:1/-1">
        <div class="pc-head" style="justify-content:space-between">
          <div class="flex items-c" style="gap:var(--sp3);min-width:0">
            <div class="av" style="opacity:.5;flex-shrink:0"><i data-lucide="${playerIcon(p)}" style="width:22px;height:22px"></i></div>
            <div><div class="pc-name">${esc(p.name)}</div><div class="pc-meta">${t('players.balance')}: <span class="${cls}">${fmtE(b)}</span></div></div>
          </div>
          <button class="btn btn-sm btn-pri" onclick="reactivatePlayer('${p.id}')" style="flex-shrink:0"><i data-lucide="rotate-ccw"></i> ${t('players.reactivate')}</button>
          <button class="btn btn-sm btn-dan" onclick="purgePlayer('${p.id}')" style="flex-shrink:0"><i data-lucide="trash-2"></i> ${t('players.purge')}</button>
        </div>
      </div>`;
    }).join('');
  }

  g.innerHTML = html;
}

function openAddPlayer() {
  editPid = null;
  document.getElementById('mo-player-title').textContent = t('players.add_title');
  document.getElementById('save-p-btn').textContent = t('players.save_add');
  document.getElementById('p-name').value = '';
  document.getElementById('p-contact').value = '';
  
  // NEU: Admin-Checkbox anzeigen (nur für bestehende Admins)
  const adminWrap = document.getElementById('p-admin-wrap');
  if (adminWrap) {
    adminWrap.style.display = isAdmin ? 'block' : 'none';
    document.getElementById('p-admin').checked = false;
  }
  
  openMo('mo-player'); setTimeout(() => document.getElementById('p-name').focus(), 100);
}

function openEditPlayer(id) {
  const p = S.players.find(x => x.id === id); if (!p) return;
  editPid = id;
  document.getElementById('mo-player-title').textContent = t('players.edit');
  document.getElementById('save-p-btn').textContent = t('misc.save');
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-contact').value = p.contact || '';
  
  // NEU: Admin-Checkbox füllen & anzeigen (nur für bestehende Admins)
  const adminWrap = document.getElementById('p-admin-wrap');
  if (adminWrap) {
    adminWrap.style.display = isAdmin ? 'block' : 'none';
    document.getElementById('p-admin').checked = !!p.admin;
  }

  openMo('mo-player');
}

async function savePlayer() {
  const name = document.getElementById('p-name').value.trim();
  const contact = document.getElementById('p-contact').value.trim();
  
  // NEU: Checkbox-Wert auslesen
  const adminCb = document.getElementById('p-admin');
  const makeAdmin = adminCb ? adminCb.checked : false;

  if (!name) { showToast('Bitte Namen eingeben.'); return; }
  try {
    if (editPid) {
      await apiFetch('PUT', '/players/' + editPid, { name, contact, admin: makeAdmin });
      showToast(t('toast.player_updated'));
    } else {
      await apiFetch('POST', '/players', { name, contact, admin: makeAdmin });
      showToast(t('toast.player_added'));
    }
    await loadState();
    closeMo('mo-player');
    renderAll();
  } catch(e) {}
}
async function deletePlayer(id) {
   const p = S.players.find(x => x.id === id);
   const name = p ? p.name : t('players.name');
   showConfirmModal(
     t('confirm.delete_player'),
     t('confirm.delete_player_desc').replace('{name}', name),
     '<i data-lucide="user-x"></i> ' + t('confirm.deactivate'),
     'btn-dan',
    async () => {
      try {
        await apiFetch('DELETE', '/players/' + id);
        if (guestId === id) { guestId = null; sessionStorage.removeItem('_guestId'); syncGuestIdentity(); }
        await loadState();
        renderAll();
        showToast('Deaktiviert.');
      } catch(e) {}
    }
  );
}

async function reactivatePlayer(id) {
  const p = S.players.find(x => x.id === id);
  const name = p ? p.name : t('players.name');
  showConfirmModal(
    t('confirm.reactivate'),
    t('confirm.reactivate_desc').replace('{name}', name),
    '<i data-lucide="rotate-ccw"></i> ' + t('players.reactivate'),
    'btn-pri',
    async () => {
      try {
        await apiFetch('PUT', '/players/' + id, { active: true });
        await loadState();
        renderAll();
        showToast('Reaktiviert.');
      } catch(e) {}
    }
  );
}

async function purgePlayer(id) {
  const p = S.players.find(x => x.id === id);
  const name = p ? p.name : t('players.name');
  showConfirmModal(
    t('confirm.purge'),
    t('confirm.purge_desc').replace('{name}', name),
    '<i data-lucide="trash-2"></i> ' + t('confirm.continue'),
    'btn-dan',
    () => {
      showConfirmModal(
        t('confirm.purge_final'),
        t('confirm.purge_final_desc').replace('{name}', name),
        '<i data-lucide="trash-2"></i> ' + t('confirm.purge_final_btn'),
        'btn-dan',
        async () => {
          try {
            await apiFetch('DELETE', '/players/' + id + '/purge');
            if (guestId === id) { guestId = null; sessionStorage.removeItem('_guestId'); syncGuestIdentity(); }
            await loadState();
            renderAll();
            showToast('Dauerhaft gelöscht.');
          } catch(e) {}
        }
      );
    }
  );
}

// ════════════════════════════════════════
// ADMIN – TRANSACTIONS
// ════════════════════════════════════════
function openTx(pid) {
  txPid = pid;
  const p = S.players.find(x => x.id === pid);
  document.getElementById('mo-tx-title').textContent = `${p.name} – ${t('transactions.title')}`;
  document.getElementById('mo-tx-sub').textContent = `${t('transactions.current_balance')}: ${fmtE(bal(pid))}`;
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value = '';
  openMo('mo-tx'); setTimeout(() => document.getElementById('tx-amount').focus(), 100);
}
async function doTx(credit) {
  const amt = parseFloat(document.getElementById('tx-amount').value);
  if (!amt || amt <= 0) { showToast('Gültigen Betrag eingeben.'); return; }
  const note = document.getElementById('tx-note').value.trim();
  try {
    await apiFetch('POST', '/transactions', { player_id: txPid, credit, amount: amt, note });
    await loadState();
    closeMo('mo-tx');
    renderAll();
    const p = S.players.find(x => x.id === txPid);
    showToast((credit ? t('toast.credit') : t('toast.debit')).replace('{amount}', fmtE(amt)).replace('{name}', p ? ' ' + p.name : ''));
  } catch(e) {}
}


// ════════════════════════════════════════
//  BUCHUNGEN (GUEST)
// ════════════════════════════════════════
function renderMyHistory() {
  if (!guestId) return;
  const today = new Date().toISOString().slice(0,10);
  const dates = getRecurringSessionDates();

  // All sessions: from state + future dates
  const allDates = [...new Set([
    ...S.sessions.map(s => s.date),
    ...dates
  ])].sort();

  // Sessions where I (or my guests) are booked
  function mySessionEntry(date) {
    const sess = S.sessions.find(s => s.date === date);
    if (!sess) return null;
    const mySlots = sess.courts.flat().filter(v => v && baseId(v) === guestId);
    const onWl = sess.waitlist.some(pid => baseId(pid) === guestId);
    if (!mySlots.length && !onWl) return null;
    return { date, sess, mySlots, onWl };
  }

  const upcoming = allDates.filter(d => d >= today).map(mySessionEntry).filter(Boolean);
  const past     = allDates.filter(d => d < today).map(mySessionEntry).filter(Boolean).reverse();

  // Transactions
  const txs = [...S.transactions].filter(t => t.playerId === guestId).sort((a,b) => b.createdAt.localeCompare(a.createdAt));

function sessionCard(entry) {
  const { date, sess, mySlots, onWl } = entry;
  const isPast = date < today;
  const guestCount = mySlots.filter(v => v.includes('|')).length;
  const selfIn = mySlots.some(v => !v.includes('|'));
  const tags = [];
  if (selfIn) tags.push(`<span class="badge bg-me">${isPast ? t('session.played') : t('session.you_play')}</span>`);
  if (guestCount) tags.push(`<span class="badge bg-sec">${guestCount} ${t('misc.guest')}${guestCount > 1 ? (getLocale() === 'de' ? 'e' : '') : ''}</span>`);
  if (onWl && !selfIn) tags.push(`<span class="badge bg-gld">${t('session.waitlist')}</span>`);
  if (sess.charged) tags.push(`<span class="badge bg-neu">${t('session.charged')}</span>`);

  const { start, end } = getSessionTime(date);
  const eventName = getSessionName(date);

  const dObj = new Date(date + 'T00:00:00');
  const weekday = dObj.toLocaleDateString(getLocale(), { weekday: 'short' }).toUpperCase().replace('.', '');
  const dayNum = dObj.toLocaleDateString(getLocale(), { day: 'numeric' });
  const monthStr = dObj.toLocaleDateString(getLocale(), { month: 'short' }).toUpperCase().replace('.', '');

  const sessionCost = (sess.price !== null && sess.price !== undefined) ? sess.price : S.cfg.cost;
  const priceDiffers = sessionCost != S.cfg.cost;

  const slotCount = mySlots.length;
  const totalPrice = slotCount * sessionCost;

  const hasDetails = sess.location || sess.note || priceDiffers || (!isPast && !sess.charged && !sess.cancelled);

  const detailsHtml = [];
  if (sess.location) detailsHtml.push(`<div class="bk-location"><i data-lucide="map-pin" style="width:12px;height:12px;flex-shrink:0"></i>${esc(sess.location)}</div>`);
  if (sess.note) detailsHtml.push(`<div class="bk-comment"><i data-lucide="message-square" style="width:12px;height:12px;flex-shrink:0"></i>${esc(sess.note)}</div>`);
  if (priceDiffers) detailsHtml.push(`<div class="bk-price"><i data-lucide="tag" style="width:12px;height:12px;flex-shrink:0"></i>${fmtE(sessionCost)} ${t('session.per_slot')}</div>`);
  if (!isPast && !sess.charged && !sess.cancelled) {
    const deadline = getCancelDeadline(date);
    const within = isWithinCancelWindow(date);
    const deadlineStr = fmtDateTime(deadline);
    detailsHtml.push(`<div class="bk-deadline${within ? '' : ' warning'}"><i data-lucide="clock" style="width:12px;height:12px;flex-shrink:0"></i>${t('session.cancel_deadline_text').replace('{deadline}', deadlineStr)}</div>`);
  }

  const wlOnly = onWl && !selfIn;
  return `<div class="bk">
    <div class="bk-head-ticket">
      <div class="bk-cal-col">
        <div class="bk-cal-ticket">
          <div class="bk-wkdy${wlOnly ? ' bk-wl' : ''}">${esc(weekday)}</div>
          <div class="bk-day">${esc(dayNum)}</div>
          <div class="bk-month">${esc(monthStr)}</div>
        </div>
        ${wlOnly ? `<div class="bk-price-bubble wl">${t('session.waitlist_short')}</div>` : `<div class="bk-price-bubble">${fmtE(totalPrice)}</div>`}
      </div>
      <div class="bk-content-col">
        <div class="bk-content-top">
          <div class="bk-title">${esc(eventName)}</div>
          <div class="bk-time">${start}–${end}</div>
        </div>
        <div class="bk-head-actions">
          ${!isPast ? `<button class="btn btn-sec btn-sm" onclick="downloadSessionCalendar('${date}')"><i data-lucide="calendar-plus"></i> ${t('session.add_to_calendar')}</button>` : ''}
          ${!sess.charged && isWithinCancelWindow(date) ? `<button class="btn btn-dan btn-sm" onclick="openLeaveConfirm('${date}')"><i data-lucide="log-out"></i> ${t('session.leave')}</button>` : ''}
        </div>
      </div>
    </div>
    ${hasDetails ? `<div class="bk-details">${detailsHtml.join('')}</div>` : ''}
  </div>`;
}

  // Upcoming sessions
  const upEl = document.getElementById('my-bookings-upcoming');
  if (upcoming.length) {
    upEl.innerHTML = `<div class="hl">${upcoming.map(sessionCard).join('')}</div>`;
  } else {
    upEl.innerHTML = `<p style="color:var(--txm);font-size:var(--text-sm);margin-bottom:var(--sp3)">${t('session.no_upcoming')}</p>`;
  }

  // Past sessions
  const pastEl = document.getElementById('my-bookings-past');
  if (past.length) {
    pastEl.innerHTML = `<h2 style="font-size:var(--text-base);font-weight:700;margin-bottom:var(--sp3);margin-top:var(--sp5);color:var(--tx)">${t('my_history.past')}</h2>
      <div class="hl">${past.map(sessionCard).join('')}</div>`;
  } else {
    pastEl.innerHTML = '';
  }
  syncSwipeHeight();
}
// ════════════════════════════════════════
// Transaktionen (GUEST)
// ════════════════════════════════════════

let showAllTransactions = false;

function toggleHistoryView() {
  showAllTransactions = !showAllTransactions;
  renderMyTransactions();
}

function calculateFutureRunway() {
  const today = new Date().toISOString().slice(0, 10);
  const futureBookedSessions = S.sessions
    .filter(s => s.date >= today)
    .filter(s => {
      const mySlots = s.courts.flat().filter(v => v && baseId(v) === guestId);
      return mySlots.length > 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date)); // Sort ascending for running balance calculation

  let runningBalance = bal(guestId);
  let coveredCount = 0;
  const bookings = [];

  for (const s of futureBookedSessions) {
    const mySlots = s.courts.flat().filter(v => v && baseId(v) === guestId);
    const slotCount = mySlots.length;
    const sessionCost = (s.price !== null && s.price !== undefined) ? parseFloat(s.price) : parseFloat(S.cfg.cost || 16);
    const totalCost = slotCount * sessionCost;
    
    const isCovered = (totalCost === 0) || (runningBalance >= totalCost);
    if (isCovered) {
      coveredCount++;
    }
    runningBalance -= totalCost;

    bookings.push({
      date: s.date,
      sess: s,
      slotCount,
      sessionCost,
      totalCost,
      isCovered,
      resultingBalance: runningBalance
    });
  }

  return {
    bookings,
    coveredCount,
    hasUncovered: bookings.some(b => !b.isCovered),
    remainingBalance: runningBalance
  };
}

function formatTxNotePlain(tx) {
  if (!tx || !tx.note) return '';
  const note = tx.note.trim();
  const mPay = note.match(/^(?:Direct payment|Direktzahlung|Pago directo|Pagamento diretto|Paiement direct|Pagamento direto)\s+(\d{4}-\d{2}-\d{2})$/i);
  if (mPay) {
    const date = mPay[1];
    return t('transactions.direct_payment_for_session').replace('{session}', fmtD(date));
  }
  const mSess = note.match(/^(?:Session|Spieltag|Sesión|Sessione|Sessão)\s+(\d{4}-\d{2}-\d{2})(?:\s*\(\+(\d+)\s+[a-zA-ZäöüßÄÖÜ]+\))?$/i);
  if (mSess) {
    const date = mSess[1];
    const guests = mSess[2] ? parseInt(mSess[2], 10) : 0;
    let text = `${t('session.session')} ${fmtD(date)}`;
    if (guests > 0) {
      const label = guests > 1 ? t('my_history.guests') : t('session.guest');
      text += ` (+${guests} ${label})`;
    }
    return text;
  }
  return tx.note;
}

function formatTxNoteHtml(tx) {
  if (!tx || !tx.note) {
    return esc(tx.credit ? t('transactions.credit_type') : t('session.session'));
  }
  const note = tx.note.trim();
  const mPay = note.match(/^(?:Direct payment|Direktzahlung|Pago directo|Pagamento diretto|Paiement direct|Pagamento direto)\s+(\d{4}-\d{2}-\d{2})$/i);
  if (mPay) {
    const date = mPay[1];
    const plainText = t('transactions.direct_payment_for_session').replace('{session}', fmtD(date));
    return esc(plainText);
  }
  const mSess = note.match(/^(?:Session|Spieltag|Sesión|Sessione|Sessão)\s+(\d{4}-\d{2}-\d{2})(?:\s*\(\+(\d+)\s+[a-zA-ZäöüßÄÖÜ]+\))?$/i);
  if (mSess) {
    const date = mSess[1];
    const guests = mSess[2] ? parseInt(mSess[2], 10) : 0;
    let text = `${esc(t('session.session'))} ${esc(fmtD(date))}`;
    if (guests > 0) {
      const label = guests > 1 ? t('my_history.guests') : t('session.guest');
      text += ` (+${guests} ${esc(label)})`;
    }
    return `<span class="tx-session-link" onclick="navigateToSession('${date}')">${text}</span>`;
  }
  return esc(tx.note);
}

function navigateToSession(date) {
  if (isAdmin) {
    planGoToDate(date);
    showView('admin-plan');
  } else {
    openSessionDetailsModal(date);
  }
}

function openSessionDetailsModal(date) {
  const sess = getOrSess(date);
  if (!sess) return;
  
  if (!sess.disabledCourts) sess.disabledCourts = [];
  const activeCourts = sess.courts.filter((_, i) => !sess.disabledCourts.includes(i));
  const allSlots = activeCourts.flat();
  const playerMap = new Map(S.players.map(p => [p.id, p]));
  const privacy = S.cfg.privacy_mode === '1' && !guestId;
  const meIn = guestId && allSlots.some(v => v && (v === guestId || v.startsWith(guestId + '|')));
  const meWl = guestId && sess.waitlist.includes(guestId);

  const dObj = new Date(date + 'T00:00:00');
  const weekday = dObj.toLocaleDateString(getLocale(), { weekday: 'short' }).toUpperCase();
  const dayNum = dObj.toLocaleDateString(getLocale(), { day: 'numeric' });
  const monthStr = dObj.toLocaleDateString(getLocale(), { month: 'short' }).toUpperCase().replace('.', '');
  
  let calClass = 'cal-none';
  if (guestId) {
    if (meIn) {
      calClass = 'cal-in';
    } else if (meWl) {
      calClass = 'cal-wl';
    }
  }
  
  const { start, end } = getSessionTime(date);
  const sessionCost = (sess.price !== null && sess.price !== undefined) ? sess.price : S.cfg.cost;
  const priceBubbleHtml = sessionCost ? `<div class="sc-price-bubble">${fmtE(sessionCost)}</div>` : '';

  let statusBadgeHtml = '';
  if (sess.cancelled) {
    statusBadgeHtml = `<span class="badge bg-dan" style="margin-left:0">${t('session.cancelled_badge')}</span>`;
  } else if (sess.charged) {
    statusBadgeHtml = `<span class="badge bg-neu" style="margin-left:0">${t('session.charged')}</span>`;
  } else if (window._dbSessionDates && window._dbSessionDates.has(date)) {
    statusBadgeHtml = `<span class="badge bg-ok" style="margin-left:0">${t('session.saved_db')}</span>`;
  } else {
    statusBadgeHtml = `<span class="badge bg-pri" style="margin-left:0">${t('session.planned_badge')}</span>`;
  }

  const detailsHtml = [];
  if (sess.location && !privacy) detailsHtml.push(`<div class="sc-location" style="display:flex;align-items:center;gap:var(--sp1);font-size:var(--text-xs);color:var(--txm)"><i data-lucide="map-pin" style="width:12px;height:12px;flex-shrink:0"></i>${esc(sess.location)}</div>`);
  if (sess.note) detailsHtml.push(`<div class="sc-comment" style="display:flex;align-items:center;gap:var(--sp1);font-size:var(--text-xs);color:var(--txm)"><i data-lucide="message-square" style="width:12px;height:12px;flex-shrink:0"></i>${esc(sess.note)}</div>`);

  const groupCourts = S.cfg.display_court_grouping !== '0';
  let slotChips = groupCourts ? '' : '<div class="admin-slots-grid">';
  sess.courts.forEach((slots, ci) => {
    if (sess.disabledCourts.includes(ci)) return;
    if (groupCourts) {
      slotChips += `<div class="court-container">
        <div class="court-header">
           <span class="court-title"><i data-lucide="map-pin" style="width:12px;height:12px"></i> ${esc(getCourtLabel(sess, ci))}</span>
        </div>
        <div class="court-slots-grid">`;
    }
    slots.forEach((pid, si) => {
      if (pid) {
        const isGuest = pid.includes('|');
        const isMyGuest = isGuest && pid.startsWith(guestId + '|');
        const p = playerMap.get(isGuest ? pid.split('|')[0] : pid);
        const isMe = pid === guestId || isMyGuest;
        const filledCls = isMe ? 'me' : 'filled';
        slotChips += `<div class="admin-slot ${filledCls}">
          <div class="av" style="width:32px;height:32px;font-size:var(--text-sm)">${privacy ? '<i data-lucide="hat-glasses" style="width:16px;height:16px"></i>' : (p ? `<i data-lucide="${playerIcon(p, isGuest)}" style="width:16px;height:16px"></i>` : '?')}</div>
          <span class="slot-name">${privacy ? t('session.booked') : (p ? (isGuest ? t('session.guest') + ` (` + esc(p.name) + `)` : esc(p.name)) : '?')}${privacy ? '' : (isGuest ? '' : (isMe ? ` <span style="opacity:.6;font-size:var(--text-xs)">${t('misc.you')}</span>` : ''))}</span>
        </div>`;
      } else {
        slotChips += `<div class="admin-slot" style="cursor:default;pointer-events:none">
          <i data-lucide="circle-dashed" style="width:16px;height:16px;flex-shrink:0;color:var(--txf)"></i>
          <span class="slot-ph" style="color:var(--txf)">${t('session.free')}</span>
        </div>`;
      }
    });
    if (groupCourts) {
      slotChips += `</div>
      </div>`;
    }
  });
  if (!groupCourts) {
    slotChips += `</div>`;
  }

  let wlHtml = '';
  if (sess.waitlist.length > 0) {
    const chips = sess.waitlist.map(pid => {
      const bid = baseId(pid);
      const isGuest = pid.includes('|');
      const p = playerMap.get(bid);
      const isMe = pid === guestId;
      return `<div class="slot-chip wl${isMe ? ' me' : ''}" style="padding:var(--sp2) var(--sp3)">
        <div class="slot-av">${privacy ? '<i data-lucide="hat-glasses" style="width:14px;height:14px"></i>' : (p ? `<i data-lucide="${playerIcon(p, isGuest)}" style="width:14px;height:14px"></i>` : '?')}</div>
        <span>${privacy ? t('session.booked') : (p ? (isGuest ? t('session.guest') + ` (` + esc(p.name) + `)` : esc(p.name)) : '?')}${privacy ? '' : (isGuest ? '' : (isMe ? ` <span style="opacity:.6;font-size:var(--text-xs)">${t('misc.you')}</span>` : ''))}</span>
      </div>`;
    }).join('');
    wlHtml = `<div class="wl-section" style="margin-top:var(--sp3)"><div class="wl-title" style="margin-bottom:var(--sp2)">${t('session.waitlist')} (${sess.waitlist.length})</div><div class="wl-list">${chips}</div></div>`;
  }

  const bodyHtml = `
    <div class="sc" style="border:none;box-shadow:none;background:none;backdrop-filter:none;-webkit-backdrop-filter:none;padding:0;margin:0">
      <div class="sc-head-ticket" style="margin-bottom:var(--sp2)">
        <div class="sc-cal-col">
          <div class="cal-ticket">
            <div class="cal-wkdy ${calClass}">${esc(weekday)}</div>
            <div class="cal-day">${esc(dayNum)}</div>
            <div class="cal-month">${esc(monthStr)}</div>
          </div>
        </div>
        <div class="sc-content-col" style="flex-grow:1">
          <div class="sc-content-top" style="display:flex;flex-direction:column;gap:2px">
            <div class="sc-date" style="font-size:var(--text-md);font-weight:700;line-height:1.2">${esc(getSessionName(date))}</div>
            <div class="sc-time-details" style="font-size:var(--text-sm);color:var(--txf);line-height:1.2">${fmtTime(start)}–${fmtTime(end)}</div>
            ${sessionCost ? `<div style="margin-top:1px"><span class="sc-price-bubble" style="display:inline-block;box-shadow:none">${fmtE(sessionCost)}</span></div>` : ''}
          </div>
        </div>
      </div>
      ${detailsHtml.length > 0 ? `<div class="sc-details" style="margin-bottom:var(--sp2);background:rgba(255,255,255,0.04);padding:var(--sp1_5) var(--sp2_5);border-radius:var(--r-md);display:flex;flex-direction:column;gap:4px">${detailsHtml.join('')}</div>` : ''}
      <div class="sc-body" style="padding:0">
        ${slotChips}
        ${wlHtml}
      </div>
    </div>
  `;

  document.getElementById('mo-sd-body').innerHTML = bodyHtml;
  openMo('mo-session-details');
  if (window.lucide) lucide.createIcons();
}

function renderMyTransactions() {
  const el = document.getElementById('my-timeline-container');
  if (!el || !guestId) { if (el) el.innerHTML = ''; return; }

  // 1. GAMIFICATION STATUS CARD (Section 1)
  const currentBalance = bal(guestId);
  const defaultCost = parseFloat(S.cfg.cost) || 16.00;
  const runway = calculateFutureRunway();
  const totalBookings = runway.bookings.length;
  const coveredBookings = runway.coveredCount;

  const GAMIFICATION_TIERS = [
    { tier: 'STAGE_1_MINUS', label: t('gamification.stage_1_minus_label'), label_color: 'label-red',    title: t('gamification.stage_1_minus_title'), description: t('gamification.stage_1_minus_desc'), icon: 'frown',       animation: 'pulse' },
    { tier: 'STAGE_1_ZERO',  label: t('gamification.stage_1_zero_label'),  label_color: 'label-gray',   title: t('gamification.stage_1_zero_title'),  description: t('gamification.stage_1_zero_desc'),  icon: 'credit-card', animation: 'none' },
    { tier: 'STAGE_2',       label: t('gamification.stage_2_label'),       label_color: 'label-orange', title: t('gamification.stage_2_title'),       description: t('gamification.stage_2_desc'),       icon: 'hand-coins',  animation: 'none' },
    { tier: 'STAGE_3',       label: t('gamification.stage_3_label'),       label_color: 'label-amber',  title: t('gamification.stage_3_title'),       description: t('gamification.stage_3_desc'),       icon: 'coins',       animation: 'none' },
    { tier: 'STAGE_4',       label: t('gamification.stage_4_label'),       label_color: 'label-yellow', title: t('gamification.stage_4_title'),       description: t('gamification.stage_4_desc'),       icon: 'zap',         animation: 'none' },
    { tier: 'STAGE_5',       label: t('gamification.stage_5_label'),       label_color: 'label-blue',   title: t('gamification.stage_5_title'),       description: t('gamification.stage_5_desc'),       icon: 'award',    animation: 'none' },
    { tier: 'STAGE_6',       label: t('gamification.stage_6_label'),       label_color: 'label-emerald', title: t('gamification.stage_6_title'),       description: t('gamification.stage_6_desc'),       icon: 'landmark', animation: 'none' },
    { tier: 'STAGE_7_SECOND', label: t('gamification.stage_7_second_label'), label_color: 'label-silver', title: t('gamification.stage_7_second_title'), description: t('gamification.stage_7_second_desc'), icon: 'trophy', animation: 'silver-sweep' },
    { tier: 'STAGE_8_LEADER', label: t('gamification.stage_6_leader_label'), label_color: 'label-purple', title: t('gamification.stage_6_leader_title'), description: t('gamification.stage_6_leader_desc'), icon: 'crown-gold', animation: 'shine-sweep' },
  ];

  function getGamificationTier(balance) {
    const uniqueBalances = [...new Set(S.players.map(p => bal(p.id)))]
      .filter(b => b > 0)
      .sort((a, b) => b - a);
    const rank1 = uniqueBalances[0] || null;
    const rank2 = uniqueBalances[1] || null;

    return GAMIFICATION_TIERS.find(t => {
      if (balance < 0) return t.tier === 'STAGE_1_MINUS';
      if (balance === 0) return t.tier === 'STAGE_1_ZERO';
      if (balance === rank1) return t.tier === 'STAGE_8_LEADER';
      if (balance === rank2) return t.tier === 'STAGE_7_SECOND';
      if (balance >= 300) return t.tier === 'STAGE_6';
      if (balance >= 200) return t.tier === 'STAGE_5';
      if (balance >= 100) return t.tier === 'STAGE_4';
      if (balance >= 50) return t.tier === 'STAGE_3';
      return t.tier === 'STAGE_2';
    });
  }

  const indicatorEl = document.getElementById('my-runway-indicator');
  if (indicatorEl) {
    const tier = getGamificationTier(currentBalance);
    let description = tier.description;

    indicatorEl.className = `sc runway-card mb6 runway-${tier.animation}`;

    const visualTierMap = {
      'STAGE_1_MINUS': '0',
      'STAGE_1_ZERO': '1',
      'STAGE_2': '2',
      'STAGE_3': '2',
      'STAGE_4': '3',
      'STAGE_5': '3',
      'STAGE_6': '3',
      'STAGE_7_SECOND': '4',
      'STAGE_8_LEADER': '4'
    };
    const visualTier = visualTierMap[tier.tier] || '2';

    indicatorEl.innerHTML = `
      <div class="runway-card-content" style="flex-direction: column; align-items: stretch; gap: var(--sp3);">
        <!-- Top Row: Label & H2 Title stacked vertically, larger Icon on the right -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
          <div style="display: flex; flex-direction: column; gap: 10px; align-items: flex-start;">
            <div class="runway-status-badge ${tier.label_color}" style="margin: 0;">
              <span>${tier.label}</span>
            </div>
            <h2 class="runway-title" style="margin: 0;">
              ${tier.title}
            </h2>
          </div>

          <div class="runway-visual tier-${visualTier}" style="width: 48px; height: 48px; flex-shrink: 0; margin: 0;">
            <div class="runway-badge-glow"></div>
            <div class="runway-badge-icon-wrapper ${tier.icon === 'crown-gold' ? 'icon-gold' : tier.icon === 'trophy' ? 'icon-shiny-silver' : tier.icon !== 'frown' ? 'icon-silver' : ''}">
              <i data-lucide="${tier.icon === 'crown-gold' || tier.icon === 'crown-silver' ? 'crown' : tier.icon}" class="runway-large-icon" style="width: 24px; height: 24px;"></i>
            </div>
          </div>
        </div>

        <!-- Description running left-to-right full-width below -->
        <p class="runway-subtext" style="margin: 0; width: 100%;">
          ${description}
        </p>

        <!-- Progress Section running left-to-right full-width below -->
        ${totalBookings > 0 ? `
        <div class="runway-progress-section" style="width: 100%; margin: 0;">
          <div class="runway-progress-bar-bg">
            <div class="runway-progress-bar-fill" style="width:${(coveredBookings / totalBookings) * 100}%"></div>
          </div>
          <p class="runway-progress-text" style="margin: var(--sp1) 0 0 0;">${t('runway.progress_text').replace('{covered}', coveredBookings).replace('{total}', totalBookings)}</p>
          ${runway.remainingBalance > 0 ? `<p class="runway-covered-text" style="margin: var(--sp1) 0 0 0;">${t('runway.text_covered').replace('{additional}', Math.floor(runway.remainingBalance / defaultCost))}</p>` : ''}
        </div>
        ` : ''}
      </div>
    `;
  }

  // 2. GROUP POOL (Section 2)
  const totalDeposits = (S.players || []).reduce((sum, p) => sum + parseFloat(p.totalDeposits || 0), 0);
  const totalExpenses = (S.expenses || []).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  const teamKasse = totalDeposits - totalExpenses;
  const poolEl = document.getElementById('my-group-pool');
  if (poolEl) {
    poolEl.innerHTML = `
      <div class="group-pool-text" style="width: 100%; text-align: center; font-size: var(--text-lg); font-weight: 800; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp1);">
        <div style="display: flex; align-items: center; justify-content: center; gap: var(--sp2);">
          <i data-lucide="piggy-bank" style="color: var(--pri); width: 20px; height: 20px;"></i>
          <span>${t('timeline.team_kasse')}</span>
          <strong style="font-size: var(--text-lg); color: ${teamKasse >= 0 ? '#007a5a' : 'var(--err)'}">${fmtE(teamKasse)}</strong>
        </div>
        <div style="font-size: var(--text-xs); color: var(--txm); font-weight: 500; max-width: 440px; line-height: 1.4; margin-top: var(--sp1);">
          ${t('timeline.team_kasse_desc')}
        </div>
      </div>
    `;
  }

  // 3. FINANCIAL TIMELINE (Section 3)
  const today = new Date().toISOString().slice(0, 10);
  const timelineRows = [];

  // Build the unified chronologically sorted future events list (ascending: closest first, to compute running balance forward)
  const futureEvents = runway.bookings.map(b => ({
    date: b.date,
    amount: b.totalCost,
    isBooking: true,
    booking: b
  })).sort((a, b) => a.date.localeCompare(b.date));

  // Compute forward running balance
  let fBalance = bal(guestId);
  for (const ev of futureEvents) {
    fBalance -= ev.amount;
    ev.resultingBalance = fBalance;
  }

  // Sort future events descending for timeline presentation (furthest first down to today)
  const sortedFutureEvents = [...futureEvents].sort((a, b) => b.date.localeCompare(a.date));

  for (const ev of sortedFutureEvents) {
    const b = ev.booking;
    timelineRows.push(`
      <div class="timeline-row future ${b.isCovered ? '' : 'uncovered'}">
        <div class="timeline-amount-col">
          <div class="timeline-date">${fmtD(b.date)}</div>
          <div class="timeline-balance-left">
            ${t('timeline.balance_after')} ${fmtE(ev.resultingBalance)}
          </div>
        </div>
        <div class="timeline-node">
          <div class="timeline-dot"></div>
        </div>
        <div class="timeline-meta">
          <div class="timeline-amount ${b.isCovered ? '' : 'uncovered'}">
            –${fmtE(b.totalCost)}
          </div>
          <div class="timeline-tag ${b.isCovered ? 'covered' : 'uncovered'}">
            ${b.isCovered ? `<i data-lucide="check" class="icon-inline"></i> ${t('timeline.covered')}` : `<i data-lucide="alert-triangle" class="icon-inline"></i> ${t('timeline.uncovered')}`}
          </div>
        </div>
      </div>
    `);
  }

  // HEUTE (Today Anchor)
  const pastTxs = [...(S.transactions || [])]
    .filter(tx => (tx.playerId || tx.player_id) == guestId)
    .sort((a, b) => (b.createdAt || b.created_at || '').localeCompare(a.createdAt || a.created_at || ''));

  const hasPast = pastTxs.length > 0;

  timelineRows.push(`
    <div class="timeline-row today ${hasPast ? 'today-transition' : ''}">
      <div class="timeline-amount-col">
        <div class="timeline-tag today">
          <i data-lucide="calendar" class="icon-inline"></i> ${t('timeline.today')}
        </div>
        <div class="timeline-amount" style="color: var(--pri);">
          ${fmtE(bal(guestId))}
        </div>
      </div>
      <div class="timeline-node">
        <div class="timeline-dot"></div>
      </div>
      <div class="timeline-meta">
        <div class="timeline-tx-info">
          <span class="tx-type-icon credit">
            <i data-lucide="wallet"></i>
          </span>
          <span class="tx-note">${t('transactions.current_balance')}</span>
        </div>
      </div>
    </div>
  `);

  // VERGANGENHEIT (Past Transactions)
  // Compute historic running balances backward starting from current player balance
  let backwardBalance = bal(guestId);
  const txsWithBalances = pastTxs.map(tx => {
    const resBal = backwardBalance;
    backwardBalance = tx.credit ? (backwardBalance - tx.amount) : (backwardBalance + tx.amount);
    return {
      ...tx,
      resultingBalance: resBal
    };
  });

  const visibleTxsCount = showAllTransactions ? txsWithBalances.length : Math.min(3, txsWithBalances.length);
  const visibleTxs = txsWithBalances.slice(0, visibleTxsCount);

  for (let i = 0; i < visibleTxs.length; i++) {
    const tx = visibleTxs[i];
    const isLast = i === visibleTxs.length - 1;
    const amountClass = tx.credit ? 'positive' : 'negative';
    const sign = tx.credit ? '+' : '–';
    const rowClass = tx.credit ? 'credit' : '';
    
    timelineRows.push(`
      <div class="timeline-row past ${rowClass} ${isLast ? 'last-item' : ''}">
        <div class="timeline-amount-col">
          <div class="timeline-date">${fmtD(tx.createdAt || tx.date)}</div>
          <div class="timeline-balance-left">
            ${t('timeline.balance_after')} ${fmtE(tx.resultingBalance)}
          </div>
        </div>
        <div class="timeline-node">
          <div class="timeline-dot"></div>
        </div>
        <div class="timeline-meta">
          <div class="timeline-amount ${amountClass}">
            ${sign}${fmtE(tx.amount)}
          </div>
          <div class="timeline-tx-info">
            <span class="tx-type-icon ${tx.credit ? 'credit' : 'debit'}">
              <i data-lucide="${tx.credit ? 'arrow-down-left' : 'arrow-up-right'}"></i>
            </span>
            <span class="tx-note">${formatTxNoteHtml(tx)}</span>
          </div>
        </div>
      </div>
    `);
  }

  el.innerHTML = timelineRows.join('');

  if (!showAllTransactions && pastTxs.length > 3) {
    el.classList.add('fading-bottom');
  } else {
    el.classList.remove('fading-bottom');
  }

  // Handle footer action button visibility and text
  const footerEl = document.getElementById('my-timeline-footer');
  const btnToggleText = document.getElementById('btn-toggle-history-text');
  if (footerEl) {
    if (pastTxs.length > 3) {
      footerEl.style.display = 'flex';
      if (btnToggleText) {
        btnToggleText.textContent = showAllTransactions 
          ? t('timeline.collapse')
          : t('timeline.load_more');
      }
    } else {
      footerEl.style.display = 'none';
    }
  }

  lucide.createIcons();
  syncSwipeHeight();
}

// ════════════════════════════════════════
// MY HISTORY (GUEST)
// ════════════════════════════════════════

function downloadMyTransactionsCSV() {
  const txs = [...(S.transactions || [])]
    .filter(t => (t.playerId || t.player_id) == guestId)
    .sort((a, b) => (b.createdAt || b.created_at || '').localeCompare(a.createdAt || a.created_at || ''));
  const rows = [[t('transactions.csv_date'), t('transactions.csv_type'), t('transactions.csv_amount'), t('transactions.csv_note')]];
  for (const t of txs) {
    const typ = t.credit ? t('transactions.credit_type') : t('transactions.debit_type');
    const betrag = (t.credit ? '+' : '-') + ' ' + Math.abs(t.amount).toFixed(2).replace('.', localeUsesComma() ? ',' : '.') + ' ' + (S.cfg.currency || '€');
    const plainNote = formatTxNotePlain(t);
    rows.push([t.date, typ, betrag, (plainNote || '').replace(/;/g, ',')]);
  }
  const csv = '\uFEFF' + rows.map(r => r.join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const p = S.players.find(x => x.id == guestId);
  a.download = 'transaktionen-' + (p ? p.name : '') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function downloadSessionCalendar(date) {
  const title = getSessionName(date);
  const { start: startTime, end: endTime } = getSessionTime(date);
  const sess = getOrSess(date);
  const startHHMM = startTime.replace(':', '');
  const endHHMM   = endTime.replace(':', '');
  const start = date.replace(/-/g, '') + 'T' + startHHMM + '00';
  const end = date.replace(/-/g, '') + 'T' + endHHMM + '00';
  const now = new Date();
  const dtstamp = formatICSDatetime(now);
  const uid = `${date}-${guestId || 'guest'}@courtle.local`;
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'PRODID:-//Courtle//DE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=Europe/Berlin:${start}`,
    `DTEND;TZID=Europe/Berlin:${end}`,
    `SUMMARY:${title}`,
  ];
  if (sess.location) {
    icsLines.push(`LOCATION:${sess.location.replace(/,/g, '\\,')}`);
  }
  icsLines.push('END:VEVENT', 'END:VCALENDAR');
  const ics = icsLines.join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `courtle-session-${date}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function formatICSDatetime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth()+1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

// ════════════════════════════════════════
// ADMIN – HISTORY
// ════════════════════════════════════════
function downloadHistoryCSV() {
  const sel = document.getElementById('hist-filter');
  let txs = [...S.transactions].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (sel && sel.value) txs = txs.filter(t => t.playerId === sel.value);

  const rows = [[t('transactions.csv_date'), t('transactions.csv_player'), t('transactions.csv_type'), t('transactions.csv_amount'), t('transactions.csv_note')]];
  for (const t of txs) {
    const p = t.playerId === '_deleted_' ? null : S.players.find(x => x.id === t.playerId);
    const pname = p ? p.name : t('misc.deleted');
    const typ = t.credit ? t('transactions.credit_type') : t('transactions.debit_type');
    const betrag = (t.credit ? '+' : '-') + ' ' + Math.abs(t.amount).toFixed(2).replace('.', localeUsesComma() ? ',' : '.') + ' ' + (S.cfg.currency || '€');
    const plainNote = formatTxNotePlain(t);
    rows.push([
      t.date,
      pname,
      typ,
      betrag,
      (plainNote || '').replace(/;/g, ','),
    ]);
  }

  const csv = '\uFEFF' + rows.map(r => r.join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'courtle-verlauf' + (sel && sel.value ? '-' + (S.players.find(p => p.id === sel.value)?.name || '') : '') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function getSessionChargeDate(tx) {
  if (!tx.note) return null;
  if (tx.note.startsWith("Session ") || tx.note.startsWith("Direct payment ")) {
    const match = tx.note.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }
  return null;
}

window.toggleSessionGroup = function(date) {
  expandedSessionGroups[date] = !expandedSessionGroups[date];
  const card = document.getElementById('group-card-' + date);
  if (card) {
    card.classList.toggle('expanded', expandedSessionGroups[date]);
  }
};

function renderHistory() {
  const sel = document.getElementById('hist-filter');
  if (!sel) return; // Falls das Dropdown im HTML fehlt, brich hier sicher ab

  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle Spieler</option>' + S.players.filter(p => p.active !== false).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = cur;

  let txs = [...S.transactions].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (sel.value) txs = txs.filter(t => t.playerId === sel.value);
  
  const el = document.getElementById('history-list');
  if (!el) return;

  if (!txs.length) { 
    el.innerHTML = `<div class="empty"><i data-lucide="clock"></i><h3>Keine Transaktionen</h3><p>Noch keine Buchungen vorhanden.</p></div>`; 
    lucide.createIcons();
    return; 
  }

  // Group session charges by date
  const sessionGroups = {};
  const manualTxs = [];

  txs.forEach(tx => {
    const sessDate = getSessionChargeDate(tx);
    if (sessDate) {
      if (!sessionGroups[sessDate]) {
        sessionGroups[sessDate] = {
          date: sessDate,
          transactions: [],
          totalAmount: 0,
          totalCredits: 0,
          timestamp: tx.createdAt || (sessDate + 'T23:59:59')
        };
      }
      sessionGroups[sessDate].transactions.push(tx);
      if (tx.credit) {
        sessionGroups[sessDate].totalCredits += tx.amount;
      } else {
        sessionGroups[sessDate].totalAmount += tx.amount;
      }
      if ((tx.createdAt || '') > sessionGroups[sessDate].timestamp) {
        sessionGroups[sessDate].timestamp = tx.createdAt;
      }
    } else {
      manualTxs.push(tx);
    }
  });

  // Combine and sort chronologically descending
  const combined = [
    ...Object.values(sessionGroups).map(g => ({ isGroup: true, date: g.date, data: g, timestamp: g.timestamp })),
    ...manualTxs.map(t => ({ isGroup: false, date: t.date, data: t, timestamp: t.createdAt || (t.date + 'T00:00:00') }))
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  el.className = 'history-list';
  el.innerHTML = combined.map(item => {
    const dObj = new Date(item.date + 'T00:00:00');
    const monthStr = dObj.toLocaleDateString('de-DE', { month: 'short' }).toUpperCase().replace('.', '');
    const dayNum = dObj.toLocaleDateString('de-DE', { day: 'numeric' });

    if (item.isGroup) {
      const group = item.data;
      const isExpanded = !!expandedSessionGroups[group.date];
      
      return `<div class="grouped-session-card ${isExpanded ? 'expanded' : ''}" id="group-card-${group.date}">
        <div class="grouped-session-header" onclick="toggleSessionGroup('${group.date}')" style="padding: var(--sp4) var(--sp5); display: flex; align-items: center; gap: var(--sp4);">
          <div class="expense-date-badge" style="background: var(--suroff); border: 1px solid oklch(from var(--tx) l c h / .10);">
            <div class="month" style="background: var(--pri); color: #fff;">${esc(monthStr)}</div>
            <div class="day">${esc(dayNum)}</div>
          </div>
          <div class="expense-card-details" style="flex: 1; display: flex; flex-direction: column; gap: 3px; text-align: left;">
            <div class="expense-card-note" style="display: flex; align-items: center; gap: var(--sp2);">
              <i data-lucide="clipboard-list" style="width: 16px; height: 16px; color: var(--pri); flex-shrink: 0;"></i>
              <span>Abrechnung Session ${fmtD(group.date)}</span>
            </div>
            <div class="expense-card-meta">
              <span>${group.transactions.filter(t => !t.credit).length} Spieler</span>
              <span>·</span>
              <span>${group.transactions.filter(t => t.credit).length} Barzahler</span>
            </div>
          </div>
          <div class="expense-card-right" style="flex-direction: row; align-items: center; gap: var(--sp3);">
            <div class="expense-card-amount db" style="color: var(--err)">– ${fmtE(group.totalAmount)}</div>
            <div class="grouped-session-toggle" style="color: var(--txm);"><i data-lucide="chevron-down" style="width: 16px; height: 16px;"></i></div>
          </div>
        </div>
        <div class="grouped-session-details">
          <div class="grouped-session-list">
            ${group.transactions.map(t => {
              const tp = t.playerId === '_deleted_' ? null : S.players.find(x => x.id === t.playerId);
              const tpname = tp ? esc(tp.name) : t('misc.deleted');
              return `<div class="grouped-session-row">
                <div class="grouped-session-player">
                  <i data-lucide="${t.credit ? 'arrow-up-right' : 'arrow-down-left'}" style="width: 14px; height: 14px; color: ${t.credit ? 'var(--pri)' : 'var(--txm)'}; flex-shrink: 0;"></i>
                  <span>${tpname} <span style="font-size: 10px; color: var(--txm); font-weight: normal;">(${t.credit ? 'Barzahlung' : 'Abbuchung'})</span></span>
                </div>
                <div class="grouped-session-row-right">
                  <span class="grouped-session-row-amount ${t.credit ? 'cr' : 'db'}">${t.credit ? '+' : '–'} ${fmtE(t.amount)}</span>
                  ${isAdmin ? `<button class="btn btn-xs btn-sec" onclick="openEditTx('${t.id}')" style="padding: 2px 6px; min-height: 24px; display: flex; align-items: center; justify-content: center;"><i data-lucide="pencil" style="width: 10px; height: 10px;"></i></button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
    } else {
      const tx = item.data;
      const p = tx.playerId === '_deleted_' ? null : S.players.find(x => x.id === tx.playerId);
      const pname = p ? esc(p.name) : t('misc.deleted');
      const textType = tx.credit ? t('transactions.credit_type') : t('transactions.debit_type');
      
      return `<div class="history-card">
        <div class="expense-date-badge">
          <div class="month">${esc(monthStr)}</div>
          <div class="day">${esc(dayNum)}</div>
        </div>
        <div class="history-card-details">
          <div class="history-card-note">${pname}</div>
          <div class="history-card-meta">${tx.note ? esc(tx.note) : textType}</div>
        </div>
        <div class="history-card-right" style="flex-direction: row; align-items: center; gap: var(--sp3);">
          <div class="expense-card-amount ${tx.credit ? 'cr' : 'db'}" style="font-size: 1.1rem; font-weight: 750; color: var(${tx.credit ? '--suc' : '--err'}); font-variant-numeric: tabular-nums lining-nums; white-space: nowrap;">
            ${tx.credit ? '+' : '–'} ${fmtE(tx.amount)}
          </div>
          ${isAdmin ? `
            <div class="history-card-actions">
              <button class="btn btn-sec btn-sm" onclick="openEditTx('${tx.id}')" style="width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;min-height:34px"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
            </div>
          ` : ''}
        </div>
      </div>`;
    }
  }).join('');
  
  lucide.createIcons();
}

// ════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════
function syncSettings() {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    setVal('s-weeks',  S.cfg.weeks);

    const rc = getRecurrenceConfig(); // Legacy-Fallback
    // SR-Interval deaktiviert -> feste 1
    setVal('sr-interval', '1');
    setVal('sr-occurrences', S.cfg.sroccurrences || rc.occurrences || 6);
    setVal('sr-time-start',  S.cfg.srtimestart   || rc.session_time_start || '19:00');
    setVal('sr-time-end',    S.cfg.srtimeend     || rc.session_time_end   || '21:00');
    setVal('sr-cost',       S.cfg.cost           || 16);
    setVal('sr-currency',   S.cfg.currency       || '€');
    setVal('sr-courts',     S.cfg.courts         || 2);
    setVal('sr-location',   S.cfg.srlocation     || '');
    const sysEnabled = document.getElementById('sys-series-enabled');
    if (sysEnabled) sysEnabled.checked = S.cfg.sr_enabled !== '0';

    const dispCourt = document.getElementById('disp-court-grouping');
    if (dispCourt) dispCourt.checked = S.cfg.display_court_grouping !== '0';
    const privMode = document.getElementById('disp-privacy-mode');
    if (privMode) privMode.checked = S.cfg.privacy_mode === '1';
    const showDeadline = document.getElementById('disp-show-cancel-deadline');
    if (showDeadline) showDeadline.checked = S.cfg.show_cancel_deadline !== '0';
    const autoCompact = document.getElementById('sys-auto-compact-slots');
    if (autoCompact) autoCompact.checked = S.cfg.auto_compact_slots === '1';
    const teamName = document.getElementById('disp-team-name');
    if (teamName) teamName.value = S.cfg.team_name || '';
    const sysLang = document.getElementById('sys-language');
    if (sysLang) sysLang.value = S.cfg.system_language || '';
    const timeFmt = document.getElementById('disp-time-format');
    if (timeFmt) timeFmt.value = S.cfg.time_format || '24h';
    const dateFmt = document.getElementById('disp-date-format');
    if (dateFmt) dateFmt.value = S.cfg.date_format || 'dmy';
    const sysCancelHours = document.getElementById('sys-cancel-hours');
    const sysCancelMinutes = document.getElementById('sys-cancel-minutes');
    if (sysCancelHours && sysCancelMinutes) {
        const v = parseFloat(S.cfg.cancel_hours);
        if (v) {
            const h = Math.floor(v);
            const m = Math.round((v - h) * 60);
            const roundedM = Math.round(m / 15) * 15;
            sysCancelHours.value = Math.min(240, h);
            sysCancelMinutes.value = Math.min(45, roundedM);
        } else {
            sysCancelHours.value = 7;
            sysCancelMinutes.value = 0;
        }
    }

    // Wochentage aus srdays (z.B. "2" oder "1,2") oder Legacy daysofweek
    const savedDays = S.cfg.srdays
        ? S.cfg.srdays.split(',').filter(d => d !== '').map(Number)
        : (rc.daysofweek ? [rc.daysofweek].flat() : [2]);

    for (let i = 0; i < 7; i++) {
        const cb = document.querySelector(`#sr-days-container input[value="${i}"]`);
        if (cb) cb.checked = savedDays.includes(i);
    }
}

async function saveSystemSettings() {
    const hoursRaw = document.getElementById('sys-cancel-hours').value;
    const minutesRaw = document.getElementById('sys-cancel-minutes').value;
    const h = parseInt(hoursRaw, 10) || 0;
    const m = parseInt(minutesRaw, 10) || 0;
    const cancelHours = Math.max(0, Math.min(240, h + m / 60));
    const settings = {
        sr_enabled: document.getElementById('sys-series-enabled').checked ? '1' : '0',
        cancel_hours: String(cancelHours),
        team_name: document.getElementById('disp-team-name').value.trim(),
        auto_compact_slots: document.getElementById('sys-auto-compact-slots')?.checked ? '1' : '0',
    };
    try {
        await apiFetch('PUT', '/config', settings);
        await loadState();
        applyTeamName();
        applyRole();
        showToast('Einstellungen gespeichert.');
    } catch(e) {
        showToast(t('toast.series_save_error').replace('{msg}', e.message));
    }
}

// ════════════════════════════════════════
// SERIES
// ════════════════════════════════════════
function renderSeries() {
  const el = document.getElementById('series-list');
  if (!el) return;
  if (!S.series || !S.series.length) {
    el.innerHTML = '<div class="card"><p class="txsm txm">' + t('series.no_series') + '</p></div>';
    return;
  }
  const dayNames = ['So','Mo','Di','Mi','Do','Fr','Sa'];
  el.innerHTML = S.series.map(s => {
    const days = s.daysOfWeek.map(d => dayNames[d]).join(', ');
    const priceLabel = s.price !== null && s.price !== undefined ? `${fmtE(s.price)} ${t('session.per_slot')}` : t('session.default_price');
    const cancelLabel = s.cancelHours !== null && s.cancelHours !== undefined ? ` · Abmeldung bis ${formatCancelHours(s.cancelHours)} vorher` : '';
    const courtNamesLabel = s.courtNames && s.courtNames.length ? ` · Courts: ${s.courtNames.join(', ')}` : '';
    return `<div class="card mb3">
      <div class="flex items-c just-b">
        <div class="flex items-c g2">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleSeriesEnabled(${s.id}, this.checked)" style="width:20px;height:20px;cursor:pointer">
          <strong>${esc(s.name || 'Unbenannt')}</strong>
        </div>
        <span class="badge ${s.enabled ? 'bg-ok' : 'bg-m'}">${s.enabled ? t('series.active', 'Aktiv') : t('series.inactive', 'Inaktiv')}</span>
      </div>
      <div class="txsm txm" style="margin-top:8px">
        <div>${days} · ${s.timeStart}–${s.timeEnd} · ${s.courts} ${t('session.court_s', 'Court(s)')}${courtNamesLabel} · ${t('series.occurrences_count', '{count} Termine').replace('{count}', s.occurrences)}${cancelLabel}</div>
        <div>${priceLabel}${s.location ? ' · ' + esc(s.location) : ''}</div>
      </div>
      <div class="flex g2 items-c" style="margin-top:var(--sp3)">
        <button class="btn btn-sec btn-sm" onclick="openSeriesEdit(${s.id})"><i data-lucide="pencil" style="width:14px;height:14px"></i> ${t('series.edit')}</button>
        <button class="btn btn-dan btn-sm" onclick="deleteSeries(${s.id})"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
      </div>
    </div>`;
  }).join('');
  lucide.createIcons();
}

async function openAddSeries() {
  document.getElementById('mo-series-title').textContent = t('series.new');
  document.getElementById('series-edit-id').value = '';
  document.getElementById('series-edit-name').value = '';
  document.getElementById('series-edit-occurrences').value = 6;
  document.getElementById('series-edit-time-start').value = '19:00';
  document.getElementById('series-edit-time-end').value = '21:00';
  document.getElementById('series-edit-courts').value = 2;
  document.getElementById('series-edit-price').value = '';
  document.getElementById('series-edit-cancel-hours').value = '';
  document.getElementById('series-edit-court-names').value = '';
  document.getElementById('series-edit-location').value = '';
  document.querySelectorAll('#series-edit-days input').forEach(cb => cb.checked = false);
  document.querySelector('#series-edit-days input[value="2"]').checked = true;
  openMo('mo-series-edit');
}

function openSeriesEdit(id) {
  const s = S.series.find(x => x.id === id);
  if (!s) return;
  document.getElementById('mo-series-title').textContent = t('series.edit', 'Serie bearbeiten');
  document.getElementById('series-edit-id').value = s.id;
  document.getElementById('series-edit-name').value = s.name || '';
  document.getElementById('series-edit-occurrences').value = s.occurrences || 6;
  document.getElementById('series-edit-time-start').value = s.timeStart || '19:00';
  document.getElementById('series-edit-time-end').value = s.timeEnd || '21:00';
  document.getElementById('series-edit-courts').value = s.courts || 2;
  document.getElementById('series-edit-price').value = s.price !== null && s.price !== undefined ? s.price : '';
  document.getElementById('series-edit-cancel-hours').value = s.cancelHours !== null && s.cancelHours !== undefined ? formatCancelHours(s.cancelHours) : '';
  document.getElementById('series-edit-court-names').value = (s.courtNames || []).join(', ');
  document.getElementById('series-edit-location').value = s.location || '';
  document.querySelectorAll('#series-edit-days input').forEach(cb => {
    cb.checked = (s.daysOfWeek || []).includes(parseInt(cb.value));
  });
  openMo('mo-series-edit');
}

async function saveSeriesEdit() {
  const id = document.getElementById('series-edit-id').value;
  const selectedDays = Array.from(
    document.querySelectorAll('#series-edit-days input:checked')
  ).map(cb => parseInt(cb.value));
  if (selectedDays.length === 0) {
    showToast('Bitte mindestens einen Wochentag auswählen.');
    return;
  }
  const courtNamesRaw = document.getElementById('series-edit-court-names').value.trim();
  const courtNames = courtNamesRaw ? courtNamesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const body = {
    name: document.getElementById('series-edit-name').value.trim(),
    daysOfWeek: selectedDays,
    occurrences: parseInt(document.getElementById('series-edit-occurrences').value) || 6,
    timeStart: document.getElementById('series-edit-time-start').value || '19:00',
    timeEnd: document.getElementById('series-edit-time-end').value || '21:00',
    courts: parseInt(document.getElementById('series-edit-courts').value) || 2,
    price: document.getElementById('series-edit-price').value ? parseFloat(document.getElementById('series-edit-price').value) : null,
    cancelHours: document.getElementById('series-edit-cancel-hours').value ? parseCancelHours(document.getElementById('series-edit-cancel-hours').value) : null,
    courtNames: courtNames,
    location: document.getElementById('series-edit-location').value.trim() || null,
  };
  try {
    if (id) {
      await apiFetch('PUT', '/series/' + id, body);
    } else {
      await apiFetch('POST', '/series', body);
    }
    await loadState();
    applyRole();
    closeMo('mo-series-edit');
    showToast(id ? 'Serie aktualisiert.' : 'Serie erstellt.');
  } catch(e) { showToast(e.message); }
}

async function toggleSeriesEnabled(id, enabled) {
  try {
    await apiFetch('PUT', '/series/' + id, { enabled });
    await loadState();
    renderSeries();
    renderSessions();
    showToast(enabled ? 'Serie aktiviert.' : 'Serie deaktiviert.');
  } catch(e) { showToast(e.message); }
}

async function deleteSeries(id) {
  showConfirmModal(t('series.delete'), t('series.confirm_delete'), '<i data-lucide="trash-2"></i> ' + t('misc.delete'), 'btn-dan', async () => {
    try {
      await apiFetch('DELETE', '/series/' + id);
      await loadState();
      applyRole();
      showToast('Serie gelöscht.');
    } catch(e) { showToast(e.message); }
  });
}

async function exportData() {
  try {
    const data = await apiFetch('GET', '/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `courtle-export-${toDS(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    showToast('Export fehlgeschlagen: ' + e.message);
  }
}
async function importData(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      await apiFetch('POST', '/import', data);
      await loadState();
      renderAll();
      showToast('Import erfolgreich.');
    } catch {
      showToast('Import fehlgeschlagen.');
    }
  };
  r.readAsText(f);
}

// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════
const DD_VIEWS = ['dashboard','admin-plan','players','expenses','history','series','settings'];
const DD_LABELS = {'dashboard':'nav.overview','admin-plan':'nav.session_plan','players':'nav.players','expenses':'nav.expenses','history':'nav.history','series':'nav.series','settings':'nav.settings'};

function showView(name) {
  closeMobileAdminMenu();
  // NEU: Sicherheits-Check
  const adminViews = ['dashboard', 'admin-plan', 'players', 'expenses', 'history', 'series', 'settings'];
  if (adminViews.includes(name) && !isAdmin) {
    name = 'sessions'; // Falls kein Admin, leite um auf Spieltage
  } // <--- DIESE KLAMMER HAT GEFEHLT!

  const wrap = document.getElementById('swipe-wrap');
  const inSwipe = wrap && wrap.classList.contains('swipe-active') && isMobileSwipe() && SWIPE_VIEWS.includes(name);

  if (SWIPE_VIEWS.includes(name)) {
    if (wrap) wrap.style.display = '';

    if (inSwipe) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-btn, .nav-dd-item, .nav-dropdown-trigger').forEach(function(b) { b.classList.remove('active'); });
      const idx = SWIPE_VIEWS.indexOf(name);
      if (idx >= 0) updateSwipePosition(idx, true);
      const nb = document.getElementById('nav-' + name);
      if (nb) nb.classList.add('active');
      document.querySelectorAll('.bnav-btn').forEach(function(b) { b.classList.remove('active'); });
      var bnb = document.getElementById('bnav-' + name);
      if (bnb) bnb.classList.add('active');
      if (name === 'my-history') renderMyHistory();
      if (name === 'my-transactions') renderMyTransactions();
      lucide.createIcons();
      void document.documentElement.offsetHeight;
      setTimeout(function() {
        window.scrollTo(0, 0);
      }, 400);
      return;
    }
  } else {
    if (wrap) wrap.style.display = 'none';
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .nav-dd-item, .nav-dropdown-trigger').forEach(b => b.classList.remove('active'));

  const v = document.getElementById('view-' + name);
  if (v) v.classList.add('active');
  
  window.scrollTo(0, 0);
  
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');

  // Update admin dropdown trigger active state
  var adminTrig = document.getElementById('nav-dd-trigger');
  if (adminTrig) adminTrig.classList.toggle('active', DD_VIEWS.includes(name));

  // Bottom-Nav active state
  document.querySelectorAll('.bnav-btn').forEach(function(b) { b.classList.remove('active'); });
  var bnb = document.getElementById('bnav-' + name);
  if (bnb) bnb.classList.add('active');
  if (DD_VIEWS.includes(name)) {
    var adminBnav = document.getElementById('bnav-admin-dd');
    if (adminBnav) adminBnav.classList.add('active');
  }
  closeMobileAdminMenu();
  closeProfileMenu();
  closeProfileDD();
 
  // Render view-specific content
  if (name === 'my-history')      renderMyHistory();
  if (name === 'my-transactions') renderMyTransactions();
  
  lucide.createIcons();
} // <--- Und hier muss die Funktion natürlich auch enden

// ════════════════════════════════════════
// NAV DROPDOWN
// ════════════════════════════════════════
function toggleNavDD() {
  const menu = document.getElementById('nav-dd-menu');
  const caret = document.getElementById('nav-dd-caret');
  const open = menu.classList.toggle('open');
  if (caret) caret.style.transform = open ? 'rotate(180deg)' : '';
}
function closeNavDD() {
  const menu = document.getElementById('nav-dd-menu');
  const caret = document.getElementById('nav-dd-caret');
  if (menu) menu.classList.remove('open');
  if (caret) caret.style.transform = '';
}
function toggleProfileDD() {
  if (!guestId) { openWelcomeModal(); return; }
  const menu = document.getElementById('profile-dd-menu');
  const caret = document.getElementById('profile-dd-caret');
  const open = menu.classList.toggle('open');
  if (caret) caret.style.transform = open ? 'rotate(180deg)' : '';
}
function closeProfileDD() {
  const menu = document.getElementById('profile-dd-menu');
  const caret = document.getElementById('profile-dd-caret');
  if (menu) menu.classList.remove('open');
  if (caret) caret.style.transform = '';
}

// ════════════════════════════════════════
// BOTTOM NAV (mobile)
// ════════════════════════════════════════
function toggleMobileAdminMenu() {
  closeProfileMenu();
  var menu = document.getElementById('bnav-admin-menu');
  if (menu) menu.classList.toggle('open');
  syncBnavBackdrop();
}
function closeMobileAdminMenu() {
  var menu = document.getElementById('bnav-admin-menu');
  if (menu) menu.classList.remove('open');
  syncBnavBackdrop();
}
function toggleProfileMenu() {
  if (Date.now() - _lastScrollTime < 500) return;
  closeMobileAdminMenu();
  var menu = document.getElementById('bnav-profile-menu');
  if (menu) menu.classList.toggle('open');
  syncBnavBackdrop();
}
function closeProfileMenu() {
  var menu = document.getElementById('bnav-profile-menu');
  if (menu) menu.classList.remove('open');
  syncBnavBackdrop();
}
function syncBnavBackdrop() {
  var backdrop = document.getElementById('bnav-backdrop');
  if (!backdrop) return;
  var adminOpen = document.getElementById('bnav-admin-menu')?.classList.contains('open');
  var profileOpen = document.getElementById('bnav-profile-menu')?.classList.contains('open');
  backdrop.classList.toggle('open', adminOpen || profileOpen);
}
function confirmLogout() {
  closeProfileMenu();
  closeProfileDD();
  showConfirmModal(t('leave.title'), t('leave.desc'), t('leave.confirm'), 'btn-dan', function() {
    logoutGuest();
  });
}

// ════════════════════════════════════════
// MODALS
// ════════════════════════════════════════
let pendingConfirmCallback = null;

function openMo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
  lucide.createIcons();
}
function closeMo(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  if (!document.querySelector('.mo.open, .welcome-overlay.open, .pin-modal-overlay.open')) {
    document.body.style.overflow = '';
  }
}

function showConfirmModal(title, desc, btnHtml, btnClass, callback) {
  document.getElementById('mo-confirm-title').textContent = title;
  document.getElementById('mo-confirm-desc').textContent = desc;
  const btn = document.getElementById('mo-confirm-btn');
  btn.innerHTML = btnHtml;
  btn.className = 'btn ' + (btnClass || 'btn-dan');
  pendingConfirmCallback = callback;
  openMo('mo-confirm');
}

function confirmModalAction() {
  closeMo('mo-confirm');
  const cb = pendingConfirmCallback;
  pendingConfirmCallback = null;
  if (cb) cb();
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('mo')) closeMo(e.target.id);
  if (e.target.classList.contains('pin-modal-overlay')) closePinModal();
  if (e.target.classList.contains('welcome-overlay')) closeWelcomeModal(false);
  // Close nav dropdown if clicked outside
  const dd = document.getElementById('nav-dropdown-wrap') || document.querySelector('.nav-dropdown');
  if (dd && !dd.contains(e.target)) closeNavDD();
  // Close profile menu if clicked outside
  const pm = document.getElementById('bnav-profile-menu');
  const pb = document.getElementById('bnav-profile');
  if (pm && pm.classList.contains('open') && !pm.contains(e.target) && pb && !pb.contains(e.target)) closeProfileMenu();
  // Close desktop profile dropdown if clicked outside
  const pdd = document.getElementById('profile-nav-dd');
  if (pdd && pdd.querySelector('.nav-dd-menu.open') && !pdd.contains(e.target)) closeProfileDD();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.mo.open').forEach(m => closeMo(m.id));
    closePinModal();
    closeUserPinModal();
  }
});

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
let tt;
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3000); }


async function loadState() {
  try {
    const keys = ['players', 'sessions', 'config', 'series'];
    const requests = [
      apiFetch('GET', '/players'),
      apiFetch('GET', '/sessions'),
      apiFetch('GET', '/config'),
      apiFetch('GET', '/series')
    ];

    if (_token) {
      keys.push('transactions');
      requests.push(apiFetch('GET', '/transactions'));
      
      keys.push('expenses');
      requests.push(apiFetch('GET', '/expenses'));
    }

    const results = await Promise.all(requests);
    const data = {};
    keys.forEach((key, index) => {
      data[key] = results[index];
    });

    const { players, sessions, config, transactions, series, expenses } = data;

    // Spieler-Daten
    S.players = players.map(p => ({ 
      ...p, 
      admin: p.admin === 1, 
      active: p.active !== 0,
      totalDeposits: parseFloat(p.total_deposits || 0),
      lastLogin: p.last_login,
      lastInteraction: p.last_interaction
    }));

    // Sessions & Config
    S.sessions = Array.isArray(sessions) ? sessions : [];
    window._dbSessionDates = new Set(S.sessions.map(s => s.date));
    S.cfg = { ...S.cfg, ...config };
    if (config && config.server_build) checkAppBuild(config.server_build);
    S.series = Array.isArray(series) ? series : [];
    applyTeamName();
    
    // Transaktionen MAPPING (Der wichtigste Teil für die Guthaben)
    if (transactions) {
      S.transactions = transactions.map(t => ({
        id: t.id,
        playerId: t.player_id,   // Wir machen aus player_id -> playerId[cite: 2]
        credit: !!t.credit,
        amount: parseFloat(t.amount),
        date: t.date,
        createdAt: t.created_at,
        note: t.note || ''
      }));
    }

    if (expenses) {
      S.expenses = expenses.map(e => ({ ...e, amount: parseFloat(e.amount) }));
    } else {
      S.expenses = [];
    }

    if (guestId) {
      const me = S.players.find(p => p.id == guestId);
      if (me) isAdmin = !!me.admin;
    }
    window._stateLoaded = true;
  } catch(e) {
    showToast(t('toast.load_failed').replace('{msg}', e.message || t('toast.server_error')));
    console.error('loadState error:', e);
    throw e;
  }
}


// ════════════════════════════════════════
// THEME
// ════════════════════════════════════════
function resolveTheme(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
}
function themeInit() {
  applyThemeUI('auto');
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleTheme();
    });
  });
}
function applyThemeUI(themeMode) {
  document.documentElement.setAttribute('data-theme-mode', themeMode);
  const resolved = resolveTheme(themeMode);
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelectorAll('[data-theme-toggle]').forEach(el => setThemeIcon(el, themeMode));
  const mt = document.querySelector('meta[name="theme-color"]');
  if (mt) mt.content = resolved === 'dark' ? '#1c1b19' : '#f9f8f5';
  lucide.createIcons();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme-mode') || 'auto';
  const next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
  applyThemeUI(next);
  if (window.guestId && window.apiFetch) {
    window.apiFetch('PUT', '/players/' + window.guestId, { theme: next === 'auto' ? null : next }).catch(() => {});
  }
  if (window.S && window.S.players && window.guestId) {
    const me = window.S.players.find(p => p.id == window.guestId);
    if (me) me.theme = next === 'auto' ? null : next;
  }
}
function setThemeIcon(btn, themeMode) {
  if (!btn) return;
  const isMenuItem = btn.id === 'desktop-theme-toggle' || btn.id === 'mobile-theme-toggle' || btn.classList.contains('nav-dd-item') || btn.closest('#bnav-profile-menu');
  if (isMenuItem) {
    const icons = { auto: 'monitor', dark: 'moon', light: 'sun' };
    const labels = { auto: t('theme.auto'), dark: t('theme.dark'), light: t('theme.light') };
    const mode = themeMode === 'auto' || themeMode === 'dark' || themeMode === 'light' ? themeMode : 'auto';
    const dots = ['auto', 'dark', 'light'].map(m =>
      `<span class="ts-dot${m === mode ? ' active' : ''}"></span>`
    ).join('');
    btn.innerHTML = `<span class="theme-btn-inner"><span class="theme-btn-left"><i data-lucide="${icons[mode]}" style="width:16px;height:16px"></i><span>${labels[mode]}</span></span><span class="theme-indicator">${dots}</span></span>`;
  } else {
    const effective = resolveTheme(themeMode);
    btn.innerHTML = effective === 'dark'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function fmtE(v) {
  const cur = S.cfg.currency || '€';
  const sym = { SEK: 'kr', NOK: 'kr', DKK: 'kr' }[cur] || cur;
  const usesComma = ['de', 'es', 'it', 'fr'].includes(getLocale());
  const abs = Math.abs(v);
  const formatted = abs.toFixed(2).replace('.', usesComma ? ',' : '.');
  const sign = v < 0 ? (usesComma ? '–' : '-') : '';
  return sign + formatted + '\u00A0' + sym;
}
function playerIcon(v, isGuest) {
  if (isGuest) return 'user-star';
  if (v && typeof v === 'object' && v.emoji && ICONS.includes(v.emoji)) return v.emoji;
  return 'user';
}

// ════════════════════════════════════════
// beforeinstallprompt – early-capture im <head>, hier nur Boot-Check
// ════════════════════════════════════════
if (window.__pip) { console.log('[BANNER] __pip detected at boot, calling showAndroidInstallBanner'); showAndroidInstallBanner(); }

// ════════════════════════════════════════
// PULL-TO-REFRESH (iOS PWA)
// ════════════════════════════════════════
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
let _ptrStart = 0, _ptrPulling = false;

document.addEventListener('touchstart', e => {
  if (!isStandalone() || !isIOS()) return;
  _ptrStart = e.touches[0].clientY;
  _ptrPulling = false;
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!_ptrStart) return;
  const dy = e.touches[0].clientY - _ptrStart;
  if (dy > 0 && window.scrollY === 0) {
    _ptrPulling = true;
    const el = document.getElementById('ptr-indicator');
    if (el) { el.classList.remove('ptr-hidden'); el.classList.add('ptr-visible'); el.classList.remove('ptr-loading'); }
  }
}, { passive: true });

document.addEventListener('touchend', async () => {
  if (!_ptrPulling) { _ptrStart = 0; return; }
  const el = document.getElementById('ptr-indicator');
  if (el) el.classList.add('ptr-loading');
  await loadState();
  renderSessions();
  lucide.createIcons();
  if (typeof renderAdminPlan === 'function') renderAdminPlan();
  if (el) { el.classList.remove('ptr-visible', 'ptr-loading'); el.classList.add('ptr-hidden'); }
  _ptrStart = 0; _ptrPulling = false;
}, { passive: true });

let _adminWlDate = null;

function renderAdminWlList() {
  if (!_adminWlDate) return;
  const sess = getOrSess(_adminWlDate);
  const alreadyWl = new Set(sess.waitlist);
  const list = document.getElementById('mo-slot-list');
  list.innerHTML = S.players.filter(p => p.active !== false).map(p => {
    const onWl = alreadyWl.has(p.id);
    const g1Taken = alreadyWl.has(p.id + '|g1');
    const g2Taken = alreadyWl.has(p.id + '|g2');
    const guestAvail = !(g1Taken && g2Taken);
    const gTag = !g1Taken ? p.id + '|g1' : p.id + '|g2';
    const b = bal(p.id);
    return `<div style="display:flex;gap:6px;align-items:stretch;margin-bottom:4px">
      <button class="btn ${onWl ? 'btn-pri' : 'btn-sec'} btn-full" style="justify-content:space-between;flex:1${onWl ? ';opacity:.65;cursor:default' : ''}"
        ${onWl ? 'disabled' : `onclick="adminDoAddWl('${_adminWlDate}','${p.id}')"` }>
        <span style="display:flex;align-items:center;gap:var(--sp2)">
          <div class="av" style="width:28px;height:28px;font-size:var(--text-xs)"><i data-lucide="${playerIcon(p)}" style="width:14px;height:14px"></i></div>
          ${esc(p.name)}${onWl ? ' <span style="font-size:var(--text-xs);opacity:.7">(auf Liste)</span>' : ''}
        </span>
        <span style="font-size:var(--text-xs);color:${b < 0 ? 'var(--err)' : 'var(--suc)'}">${ fmtE(b) }</span>
      </button>
      ${guestAvail ? `<button class="btn btn-sec" onclick="adminDoAddWl('${_adminWlDate}','${gTag}')" title="${t('session.guest_to_waitlist')}" style="padding:0 10px;white-space:nowrap;font-size:var(--text-xs)">+${t('misc.guest')}</button>` : ''}
    </div>`;
  }).join('');
  lucide.createIcons();
}

async function adminAddToWaitlist(date) {
  document.getElementById('mo-slot-title').textContent = t('session.add_to_waitlist');
  const danBtn = document.getElementById('mo-slot').querySelector('.btn-dan');
  if (danBtn) danBtn.style.display = 'none';
  _adminWlDate = date;
  renderAdminWlList();
  openMo('mo-slot');
  lucide.createIcons();
}

function dismissInstallBanner() {
  const el = document.getElementById('install-banner');
  if (el) {
    el.classList.add('hidden');
    el.classList.remove('is-android', 'is-ios');
  }
  try { localStorage.setItem('_pwaBannerDismissed', '1'); } catch(e) {}
}

function resetInstallBanner() {
  try { localStorage.removeItem('_pwaBannerDismissed'); } catch(e) {}
}

async function installPWA() {
  if (!window.__pip) return;
  console.log('[PWA] calling prompt');
  window.__pip.prompt();
  const choice = await window.__pip.userChoice;
  console.log('[PWA] userChoice', choice);
  window.__pip = null;
}

function showAndroidInstallBanner() {
  if (!window.__pip) { console.log('[BANNER] blocked – no __pip'); return; }
  console.log('[BANNER] showAndroidInstallBanner entered',{
    __pip: !!window.__pip,
    dismissed: !!localStorage.getItem('_pwaBannerDismissed'),
    standalone: isStandalone(),
    isIOS: isIOS(),
    ua: navigator.userAgent
  });
  if (localStorage.getItem('_pwaBannerDismissed')) { console.log('[BANNER] blocked by dismiss flag'); return; }
  if (isStandalone()) { console.log('[BANNER] blocked by standalone'); return; }
  const el = document.getElementById('install-banner');
  if (el) {
    console.log('[BANNER] element found, current classes:', el.className);
    el.classList.remove('hidden');
    el.classList.add('is-android');
    console.log('[BANNER] classes after update:', el.className);
    setTimeout(() => {
      console.log('[BANNER] delayed check (100ms) – classes:', el.className, 'display:', getComputedStyle(el).display);
    }, 100);
  } else {
    console.error('[BANNER] element #install-banner not found in DOM');
  }
}

function checkIOSInstallBanner() {
  if (!isIOS() || isStandalone() || localStorage.getItem('_pwaBannerDismissed')) return;
  const el = document.getElementById('install-banner');
  if (el) { el.classList.add('is-ios'); setTimeout(() => el.classList.remove('hidden'), 3000); }
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    console.log('[SW] ready',{
      scope: reg.scope,
      active: reg.active?.state,
      controller: navigator.serviceWorker.controller
    });
  } catch(e) {
    console.error('[SW] ready failed', e);
  }
}

// ════════════════════════════════════════
// START
// ════════════════════════════════════════
themeInit();
registerSW();
checkIOSInstallBanner();
(async () => {
  try {
    await loadState();
  } catch(e) {
    console.error('loadState fehlgeschlagen:', e);
  }
  const savedGuest = localStorage.getItem('_guestId');
  if (savedGuest && S.players.find(p => p.id == savedGuest)) {
    guestId = savedGuest;
  } else if (_token) {
    try {
      const me = await apiFetch('GET', '/me', undefined, true);
      if (me && me.player_id && S.players.find(p => p.id == me.player_id)) {
        guestId = me.player_id;
        localStorage.setItem('_guestId', guestId);
      }
    } catch(e) {
      console.warn('[BOOT] /me failed, token may be invalid:', e.message);
    }
  }
  if (guestId) {
    const me = S.players.find(p => p.id == guestId);
    if (me) isAdmin = !!me.admin;
  }
  applyRole();
  syncGuestIdentity();
  // Load saved theme preference
  if (guestId) {
    const me = S.players.find(p => p.id == guestId);
    if (me && me.theme) applyThemeUI(me.theme);
  }
  renderSessions();
  lucide.createIcons();
  if (typeof applyTranslations === 'function') applyTranslations();
  console.log('[SW] boot check – controller:', navigator.serviceWorker.controller);
  console.log('[PWA] boot',{
    hasDeferredInstallPrompt: !!window.__pip,
    controller: !!navigator.serviceWorker?.controller
  });
  checkFirstSetup();
  window.addEventListener('scroll', closeMobileAdminMenu, { passive: true });
  if (!guestId) setTimeout(openWelcomeModal, 350);

  // Simple polling for live refresh
  setInterval(async () => {
    try {
      const [sessions, players] = await Promise.all([
        apiFetch('GET', '/sessions'),
        apiFetch('GET', '/players')
      ]);
      const raw = JSON.stringify(sessions.map(s => [s.date, s.courts, s.waitlist, s.disabledCourts, s.cancelled, s.note, s.location]));
      if (raw === window._lastPollRaw && JSON.stringify(players) === window._lastPollPlayers) return;
      window._lastPollRaw = raw;
      window._lastPollPlayers = JSON.stringify(players);
      S.players = players.map(p => ({ 
        ...p, 
        admin: p.admin === 1, 
        active: p.active !== 0,
        totalDeposits: parseFloat(p.total_deposits || 0),
        lastLogin: p.last_login,
        lastInteraction: p.last_interaction
      }));
      S.sessions = sessions.map(s => ({
        date: s.date,
        charged: !!s.charged,
        disabledCourts: s.disabledCourts || [],
        waitlist: s.waitlist || [],
        courts: s.courts || [],
        note: s.note || '',
        cancelled: !!s.cancelled,
        timeStart: s.timeStart || null,
        timeEnd: s.timeEnd || null,
        location: s.location || null
      }));
      window._dbSessionDates = new Set(S.sessions.map(s => s.date));
      renderSessions();
      if (isAdmin && document.getElementById('view-admin-plan').classList.contains('open')) {
        renderAdminPlan();
      }
    } catch(e) {
      // Ignore errors to avoid spam
    }
  }, 20000); // Poll every 20 seconds
})();


async function adminDoAddWl(date, pid) {
  const sess = getOrSess(date);
  if (sess.waitlist.includes(pid)) { showToast('Bereits auf Warteliste.'); return; }
  sess.waitlist.push(pid);
  await persistSession(sess);
  // Refresh the list in-place so the admin can add more entries without reopening
  renderAdminWlList();
  renderAdminPlan();
  const rawId = pid.includes('|') ? pid.split('|')[0] : pid;
  const p = S.players.find(x => x.id === rawId);
  const isGuest = pid.includes('|');
  showToast((p ? p.name : '?') + (isGuest ? ` (${t('misc.guest')})` : '') + ' ' + t('session.added_to_waitlist'));
}


let _planDetailChanges = {};

function planDetailChange(field, value) {
  _planDetailChanges[field] = value;
}

async function savePlanDetails() {
  if (Object.keys(_planDetailChanges).length === 0) {
    showToast('Keine Änderungen.');
    return;
  }

  try {
    const updates = {};
    if (_planDetailChanges.date) {
      const newDate = _planDetailChanges.date;
      const isInDB = window._dbSessionDates?.has(newDate) ?? false;
      const dbSess = isInDB ? S.sessions.find(s => s.date === newDate) : null;
      if (isInDB && !dbSess?.cancelled) {
        showToast('Zieldatum existiert bereits.');
        return;
      }
      updates.newDate = newDate;
    }
    if (_planDetailChanges.timeStart) updates.timeStart = _planDetailChanges.timeStart;
    if (_planDetailChanges.timeEnd) updates.timeEnd = _planDetailChanges.timeEnd;
    if (_planDetailChanges.note !== undefined) updates.note = _planDetailChanges.note;
    if (_planDetailChanges.location !== undefined) updates.location = _planDetailChanges.location;
    if (_planDetailChanges.price !== undefined) {
      updates.price = _planDetailChanges.price === '' ? null : parseFloat(_planDetailChanges.price);
    }
    if (_planDetailChanges.cancelHours !== undefined) {
      updates.cancelHours = _planDetailChanges.cancelHours === null ? null : _planDetailChanges.cancelHours;
    }
    if (_planDetailChanges.name !== undefined) {
      updates.name = _planDetailChanges.name === '' ? null : _planDetailChanges.name;
    }
    if (_planDetailChanges.courtNames !== undefined) {
      updates.courtNames = _planDetailChanges.courtNames;
    }

    await apiFetch('PUT', '/sessions/' + planDate, updates);
    await loadState();
    _planDetailChanges = {};

    const dates = getAllSessionDatesAdmin();
    const today = toDS(new Date());
    if (updates.newDate) {
      planDate = updates.newDate;
    }
    renderAdminPlan();
    renderSessions();
    lucide.createIcons();
    showToast('Änderungen gespeichert.');
  } catch(e) {
    showToast(e.message || t('misc.save_failed'));
  }
}


// ════════════════════════════════════════
// TEAM RANDOMIZER
// ════════════════════════════════════════
let _teamDate = null;

function openTeamRandomizer(date) {
  _teamDate = date;
  shuffleTeams();
  openMo('mo-teams');
}

function shuffleTeams() {
  const sess = S.sessions.find(s => s.date === _teamDate);
  if (!sess) return;

  // Collect all players in session (including guests)
  const playerIds = sess.courts.flat().filter(Boolean);
  // Shuffle
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);

  // Group into courts (4 players each = 2 teams of 2)
  const courts = sess.courts.filter((_, i) => !sess.disabledCourts.includes(i));
  const numCourts = Math.min(courts.length, Math.floor(shuffled.length / 2));

  // Distribute players across courts evenly
  const distributed = Array.from({length: numCourts}, () => []);
  shuffled.forEach((pid, i) => {
    if (i < numCourts * 4) distributed[i % numCourts].push(pid);
  });

  function playerLabel(pid) {
    const bid = baseId(pid);
    const p = S.players.find(x => x.id === bid);
    const name = p ? esc(p.name) : '?';
    const isGuest = pid.includes('|');
    return `<div style="background:var(--sur);border:1px solid var(--div);border-radius:var(--r-md);padding:var(--sp1) var(--sp3);font-size:var(--text-sm);white-space:nowrap">
      ${name}${isGuest ? ` <span style="opacity:.55;font-size:var(--text-xs)">(${t('misc.guest')})</span>` : ''}
    </div>`;
  }

  const courtColors = ['var(--pri)', 'var(--suc)', '#e07b39', '#9b59b6'];

  const body = document.getElementById('mo-teams-body');
  body.innerHTML = distributed.map((players, ci) => {
    const teamA = players.filter((_, i) => i % 2 === 0);
    const teamB = players.filter((_, i) => i % 2 === 1);
    return `<div style="border:1px solid var(--div);border-radius:var(--r-lg);overflow:hidden">
      <div style="background:${courtColors[ci % courtColors.length]};color:#fff;padding:var(--sp2) var(--sp4);font-weight:600;font-size:var(--text-sm)">
        ${t('session.court')} ${ci + 1}
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:start;gap:var(--sp3);padding:var(--sp4)">
        <div style="display:flex;flex-direction:column;gap:var(--sp2)">${teamA.map(playerLabel).join('')}</div>
        <div style="color:var(--txm);font-weight:700;padding-top:var(--sp2)">vs</div>
        <div style="display:flex;flex-direction:column;gap:var(--sp2)">${teamB.map(playerLabel).join('')}</div>
      </div>
    </div>`;
  }).join('');

  if (distributed.length === 0) {
    body.innerHTML = '<p style="color:var(--txm);text-align:center">' + t('teams.no_players') + '</p>';
  }
  lucide.createIcons();
}

let pendingLeaveDate = null;

function openLeaveConfirm(date) {
  if (!isWithinCancelWindow(date)) {
    const deadline = getCancelDeadline(date);
    const deadlineStr = fmtDateTime(deadline);
    showToast(t('toast.leave_failed') + ' (' + t('session.cancel_deadline') + ' ' + t('session.until') + ': ' + deadlineStr + ')');
    return;
  }
  pendingLeaveDate = date;
  const sess = getOrSess(date);
  const hasWL = sess.waitlist && sess.waitlist.length > 0;
  const deadline = getCancelDeadline(date);
  const deadlineStr = fmtDateTime(deadline);
  let msg;
  if (hasWL) {
    const nextId = sess.waitlist[0];
    const nextP = S.players.find(x => x.id === nextId);
    const nextName = nextP ? nextP.name : 'Unbekannt';
    const nameTag = '<strong style="font-size:1.15em">' + esc(nextName) + '</strong>';
    document.getElementById('mo-leave-desc').innerHTML = (t('leave.warn').replace('%%N%%', nameTag) + '<br><br><span style="font-size:0.9em;opacity:0.7">' + t('session.leave') + ' ' + t('session.possible') + ' ' + t('session.until') + ': ' + esc(deadlineStr) + '</span>');
    openMo('mo-leave-confirm');
    return;
  } else {
    msg = t('leave.desc') + '\n\n' + t('session.leave') + ' ' + t('session.possible') + ' ' + t('session.until') + ': ' + deadlineStr;
  }
  document.getElementById('mo-leave-desc').textContent = msg;
  openMo('mo-leave-confirm');
}

function confirmLeave() {
  closeMo('mo-leave-confirm');
  if (pendingLeaveDate) {
    leaveSession(pendingLeaveDate);
    renderMyHistory();
    pendingLeaveDate = null;
  }
}

let editTxId = null;

function openEditTx(id) {
  const t = S.transactions.find(x => x.id === id);
  if (!t) return;
  editTxId = id;
  const p = t.playerId === '_deleted_' ? null : S.players.find(x => x.id === t.playerId);
  document.getElementById('mo-edit-tx-sub').textContent = (p ? p.name : '(gelöscht)') + ' — ' + (t.credit ? 'Einzahlung' : 'Abrechnung');
  document.getElementById('etx-amount').value = t.amount;
  document.getElementById('etx-note').value = t.note || '';
  document.getElementById('etx-date').value = t.date;
  openMo('mo-edit-tx');
}

let isSavingTx = false; // NEU: Unsere unsichtbare Schranke

async function saveEditTx() {
  // Wenn die Schranke unten ist (isSavingTx = true), ignoriere den Klick!
  if (isSavingTx) return; 
  
  isSavingTx = true; // Schranke schließen!

  const amt = parseFloat(document.getElementById('etx-amount').value);
  if (!amt || amt <= 0) { 
    showToast('Ungültiger Betrag.'); 
    isSavingTx = false; // Schranke wieder öffnen, weil wir abbrechen
    return; 
  }
  
  const note = document.getElementById('etx-note').value.trim();
  const date = document.getElementById('etx-date').value;
  
  try {
    await apiFetch('PUT', '/transactions/' + editTxId, { amount: amt, note, date });
    await loadState();
    closeMo('mo-edit-tx');
    renderHistory();
    showToast(t('toast.tx_saved'));
  } catch(e) { 
    showToast(t('toast.save_error')); 
  }

  isSavingTx = false; // Am ganz am Ende: Schranke wieder öffnen!
}

// Schritt 1: Nur das Bestätigungs-Modal öffnen
function deleteEditTx() {
  // Das Bearbeitungs-Modal schließen, damit es nicht im Weg ist
  closeMo('mo-edit-tx'); 
  // Das schicke neue Bestätigungs-Modal öffnen
  openMo('mo-delete-tx-confirm');
}

// Schritt 2: Das eigentliche Löschen nach dem Klick im neuen Modal
async function confirmDeleteTx() {
  if (!editTxId) return; // Sicherheitscheck
  
  try {
    // API-Aufruf zum Löschen
    await apiFetch('DELETE', '/transactions/' + editTxId);
    
    // Daten neu laden und UI aufräumen
    await loadState();
    closeMo('mo-delete-tx-confirm');
    renderHistory();
    renderAll(); // Aktualisiert auch die KPIs und Spielerlisten
    
    showToast('✅ Transaktion wurde gelöscht.');
  } catch(e) { 
    showToast('❌ Fehler beim Löschen: ' + (e.message || 'Serverfehler')); 
  }
}

function applyTeamName() {
    const name = S.cfg.team_name && S.cfg.team_name.trim() ? S.cfg.team_name.trim() : '';
    document.title = name ? `${name} | Courtle` : 'Courtle';
    const hero = document.getElementById('welcome-hero');
    if (hero) hero.textContent = name.toUpperCase();
    const topbar = document.getElementById('topbar-team-name');
    if (topbar) topbar.textContent = name;
    const mt = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (mt) mt.content = name || 'Courtle';
}

// Display Settings
async function saveDisplaySettings() {
    const settings = {
        display_court_grouping: document.getElementById('disp-court-grouping').checked ? '1' : '0',
        privacy_mode: document.getElementById('disp-privacy-mode').checked ? '1' : '0',
        show_cancel_deadline: document.getElementById('disp-show-cancel-deadline').checked ? '1' : '0',
        currency:      document.getElementById('sr-currency').value.trim() || '€',
        cost:          parseFloat(document.getElementById('sr-cost').value) || 16,
        system_language: document.getElementById('sys-language').value || null,
        time_format:   document.getElementById('disp-time-format').value || '24h',
        date_format:   document.getElementById('disp-date-format').value || 'dmy',
    };
    try {
        await apiFetch('PUT', '/config', settings);
        showToast(t('toast.display_saved'));
        await loadState();
        applyTranslations();
        // Null the session hash so the re-render actually runs (settings change affects layout)
        window._lastSessionHash = null;
        if (typeof renderSessions === 'function') renderSessions();
        if (isAdmin && typeof renderAll === 'function') renderAll();
    } catch(e) {
        showToast(t('toast.save_error') + ' ' + e.message);
    }
}

// Berechnet die zukünftigen Termine basierend auf dem Zeitplan.
function getCalculatedSessions() { return getRecurringSessionDates(); }

// Init swipe (script is defer, so DOM is ready)
initSwipe();

// Bei resize/orientation change: View neu rendern, Swipe ↔ Desktop umschalten
window.addEventListener('resize', function() {
  var wrap = document.getElementById('swipe-wrap');
  if (!wrap) return;
  if (_touchActive) return;
  if (isMobileSwipe()) {
    if (guestId && !wrap.classList.contains('swipe-active')) {
      wrap.classList.add('swipe-active');
      swipeIndex = 0;
      updateSwipePosition(0, false);
    }
  } else {
    wrap.classList.remove('swipe-active');
    var track = document.getElementById('swipe-track');
    if (track) track.style.height = '';
    // Swipe-Modus nutzt kein .view.active → nach Umschalten wiederherstellen
    var curView = document.getElementById('view-' + (SWIPE_VIEWS[swipeIndex] || 'sessions'));
    if (curView) curView.classList.add('active');
  }
  if (isAdmin) renderAll(); else renderSessions();
});

// iOS WebKit / PWA Viewport & Virtual Keyboard Reset
// Prevents position:fixed elements from being stuck halfway up the screen after keyboard dismiss
if (typeof window !== 'undefined') {
  document.addEventListener('focusout', function(e) {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      setTimeout(function() {
        if (!document.activeElement || !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          window.scrollTo(window.scrollX, window.scrollY);
        }
      }, 50);
    }
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function() {
      var bnav = document.getElementById('bottom-nav');
      if (bnav) {
        bnav.style.transform = 'translate3d(0,0,0)';
      }
    }, { passive: true });
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          regs.forEach(function(r) { r.update().catch(function() {}); });
        }).catch(function() {});
      }
      if (typeof loadState === 'function') {
        loadState().catch(function() {});
      }
    }
  });

  window.addEventListener('pageshow', function(e) {
    if (e.persisted && typeof loadState === 'function') {
      loadState().catch(function() {});
    }
  });
}

// ════════════════════════════════════════
// APP UPDATE & BUILD SYNC
// ════════════════════════════════════════
let _updatePromptShown = false;

function checkAppBuild(serverBuild) {
  const sb = parseInt(serverBuild, 10);
  if (!isNaN(sb) && sb > CLIENT_BUILD) {
    promptAppUpdate(sb);
  }
}

function promptAppUpdate(newBuild) {
  if (_updatePromptShown || document.getElementById('courtle-update-banner')) return;
  _updatePromptShown = true;
  const banner = document.createElement('div');
  banner.id = 'courtle-update-banner';
  banner.className = 'courtle-update-banner';
  banner.innerHTML = `
    <div class="courtle-update-banner-icon">
      <i data-lucide="sparkles" style="width:14px;height:14px"></i>
    </div>
    <div class="courtle-update-banner-title">
      ${t('update.banner_title', 'Neues Update verfügbar')}
    </div>
    <div class="courtle-update-banner-actions">
      <button class="btn btn-pri btn-xs" onclick="forceAppUpdate()">${t('update.now', 'Jetzt aktualisieren')}</button>
      <button class="courtle-update-banner-close" onclick="dismissAppUpdate()" title="${t('update.dismiss', 'Später')}">
        <i data-lucide="x" style="width:14px;height:14px"></i>
      </button>
    </div>
  `;
  document.body.appendChild(banner);
  if (window.lucide) lucide.createIcons();
}

function dismissAppUpdate() {
  const banner = document.getElementById('courtle-update-banner');
  if (banner) {
    banner.classList.add('dismissing');
    setTimeout(() => banner.remove(), 250);
  }
}

async function forceAppUpdate() {
  const banner = document.getElementById('courtle-update-banner');
  if (banner) {
    banner.innerHTML = `<span style="display:flex;align-items:center;gap:6px"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i> ${t('update.checking')}</span>`;
    if (window.lucide) lucide.createIcons();
  }
  showToast(t('update.checking'));
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        await reg.update().catch(() => {});
        await reg.unregister().catch(() => {});
      }
    }
  } catch(e) {
    console.error('Update cache error:', e);
  }
  const cleanUrl = window.location.origin + window.location.pathname + '?_t=' + Date.now();
  window.location.replace(cleanUrl);
}
