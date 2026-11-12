// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
// built:491
const CLIENT_BUILD = 491;
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
    srtimeend: '21:00',
    total_privacy_mode: '0'
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
// API endpoint (supports custom base paths, subpaths, and reverse proxies)
const API = ((window.__COURTLE_BASE__ || window.__TENANT__?.basePath || '') + '/api.php').replace('//', '/');
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
    const id = sess.id || sess.date;
    const res = await apiFetch('PUT', '/sessions/' + id, {
      id: sess.id,
      date: sess.date,
      courts: sess.courts,
      disabledCourts: sess.disabledCourts || [],
      courtNames: sess.courtNames || [],
      waitlist: sess.waitlist || [],
      interaction_pids: interactionPids,
      note: sess.note ?? '',
      timeStart: sess.timeStart ?? null,
      timeEnd:   sess.timeEnd   ?? null,
      location:  sess.location  ?? null,
      price:     sess.price     ?? null,
      name:      sess.name      ?? null,
    });
    if (res && res.id) sess.id = res.id;
    const idx = S.sessions.findIndex(s => (s.id && s.id === sess.id) || (s.date === sess.date && s.id === sess.id));
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
let editPlayerEmoji = null;
let txPid = null;
let slotCtx = null;
let iconTarget = null;
let activitySortOption = 'interaction_desc';
let activitySearchQuery = '';
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

function getAllUpcomingSessions() {
  if (S.cfg.total_privacy_mode === '1' && !guestId) {
    return [];
  }
  const today = toDS(new Date());
  const sessions = [];
  const coveredKeys = new Set();

  // 1. Existing DB sessions
  if (S.sessions && S.sessions.length) {
    for (const s of S.sessions) {
      if (s.date >= today && !s.cancelled) {
        sessions.push(s);
        const effectiveTime = (s.timeStart || getSessionTime(s).start || '').replace(':','');
        coveredKeys.add(`${s.date}_${effectiveTime}`);
      }
    }
  }

  // 2. Series virtual upcoming sessions
  if (S.cfg.sr_enabled !== '0' && S.series && S.series.length) {
    for (const series of S.series) {
      if (!series.enabled) continue;
      const dates = generateSeriesDates(series);
      for (const d of dates) {
        if (d >= today) {
          const sTime = (series.timeStart || S.cfg.srtimestart || '19:00').replace(':','');
          const isCancelled = S.sessions?.some(s => s.date === d && s.cancelled && (s.timeStart || getSessionTime(s).start || '').replace(':','') === sTime);
          if (isCancelled) continue;

          const key = `${d}_${sTime}`;
          if (!coveredKeys.has(key)) {
            sessions.push({
              id: `series_${series.id}_${d}`,
              seriesId: series.id,
              date: d,
              courts: Array(series.courts || S.cfg.courts || 2).fill(null).map(() => [null,null,null,null]),
              charged: false,
              waitlist: [],
              disabledCourts: [],
              courtNames: series.courtNames ? [...series.courtNames] : [],
              note: '',
              timeStart: series.timeStart || null,
              timeEnd: series.timeEnd || null,
              cancelled: false,
              location: series.location || S.cfg.srlocation || null,
              price: series.price !== null && series.price !== undefined ? parseFloat(series.price) : null,
              cancelHours: series.cancelHours !== null && series.cancelHours !== undefined ? parseFloat(series.cancelHours) : null,
              name: series.name || null
            });
            coveredKeys.add(key);
          }
        }
      }
    }
  }

  return sessions.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    return (a.timeStart || '').localeCompare(b.timeStart || '');
  });
}

function getAllSessionsAdmin() {
  const sessions = [];
  const coveredKeys = new Set();

  // 1. All DB sessions
  if (S.sessions && S.sessions.length) {
    for (const s of S.sessions) {
      sessions.push(s);
      const effectiveTime = (s.timeStart || getSessionTime(s).start || '').replace(':','');
      coveredKeys.add(`${s.date}_${effectiveTime}`);
    }
  }

  // 2. Series virtual upcoming sessions
  const today = toDS(new Date());
  if (S.cfg.sr_enabled !== '0' && S.series && S.series.length) {
    for (const series of S.series) {
      if (!series.enabled) continue;
      for (const d of generateSeriesDates(series)) {
        if (d >= today) {
          const sTime = (series.timeStart || S.cfg.srtimestart || '19:00').replace(':','');
          const key = `${d}_${sTime}`;
          if (!coveredKeys.has(key)) {
            sessions.push({
              id: `series_${series.id}_${d}`,
              seriesId: series.id,
              date: d,
              courts: Array(series.courts || S.cfg.courts || 2).fill(null).map(() => [null,null,null,null]),
              charged: false,
              waitlist: [],
              disabledCourts: [],
              courtNames: series.courtNames ? [...series.courtNames] : [],
              note: '',
              timeStart: series.timeStart || null,
              timeEnd: series.timeEnd || null,
              cancelled: false,
              location: series.location || S.cfg.srlocation || null,
              price: series.price !== null && series.price !== undefined ? parseFloat(series.price) : null,
              cancelHours: series.cancelHours !== null && series.cancelHours !== undefined ? parseFloat(series.cancelHours) : null,
              name: series.name || null
            });
            coveredKeys.add(key);
          }
        }
      }
    }
  }

  return sessions.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    return (a.timeStart || '').localeCompare(b.timeStart || '');
  });
}

// Get the next upcoming session (respects scheduler enable/disable)
function getNextSession() {
  const all = getAllUpcomingSessions();
  return all[0] || null;
}

function getNextSessionDate() {
  const next = getNextSession();
  return next ? next.date : toDS(new Date());
}

// Alias for clarity
function getUpcomingSession() {
  const next = getNextSession();
  return next ? (next.id || next.date) : toDS(new Date());
}

// Get all session dates: DB sessions + recurring if enabled (excludes cancelled) - kept for legacy callers
function getAllSessionDates() {
  const all = getAllUpcomingSessions();
  return [...new Set(all.map(s => s.date))].sort();
}

// Get all session dates for admin (includes cancelled) - kept for legacy callers
function getAllSessionDatesAdmin() {
  const all = getAllSessionsAdmin();
  return [...new Set(all.map(s => s.date))].sort();
}

function fmtD(d) { return fmtDate(d); }
function fmtDL(d) { return fmtDateLong(d); }
function fmtDTF(d) { return fmtDateTimeFull(d); }
function fmtDTS(d) { return fmtDateTimeHistory(d); }
function fmtDT(d) { return fmtDateTime(d); }

function getOrSess(idOrDate) {
  if (!S.sessions) return null;
  // 1. Direct match by id
  let s = S.sessions.find(x => x.id === idOrDate);
  // 2. Direct match by date
  if (!s) s = S.sessions.find(x => x.date === idOrDate);

  if (!s) {
    let date = idOrDate;
    let seriesMatch = null;

    if (typeof idOrDate === 'string' && idOrDate.startsWith('series_')) {
      const parts = idOrDate.split('_');
      const seriesId = parseInt(parts[1], 10);
      date = parts.slice(2).join('_');
      seriesMatch = S.series?.find(sr => sr.id === seriesId);
    } else if (S.series && S.cfg.sr_enabled !== '0') {
      for (const series of S.series) {
        if (!series.enabled) continue;
        if (generateSeriesDates(series).includes(date)) {
          seriesMatch = series;
          break;
        }
      }
    }

    const seriesPrice = (seriesMatch && seriesMatch.price !== null && seriesMatch.price !== undefined) ? parseFloat(seriesMatch.price) : null;
    const seriesCourts = (seriesMatch && seriesMatch.courts) ? parseInt(seriesMatch.courts, 10) : S.cfg.courts;

    s = {
      id: seriesMatch ? `series_${seriesMatch.id}_${date}` : date,
      date: date,
      courts: Array(seriesCourts || 2).fill(null).map(() => [null,null,null,null]),
      charged: false,
      waitlist: [],
      disabledCourts: [],
      courtNames: seriesMatch?.courtNames ? [...seriesMatch.courtNames] : [],
      note: '',
      timeStart: seriesMatch?.timeStart || null,
      timeEnd: seriesMatch?.timeEnd || null,
      cancelled: false,
      location: seriesMatch?.location || S.cfg.srlocation || null,
      price: seriesPrice,
      cancelHours: seriesMatch?.cancelHours !== null && seriesMatch?.cancelHours !== undefined ? parseFloat(seriesMatch.cancelHours) : null,
      name: seriesMatch?.name || null
    };
    S.sessions.push(s);
  }

  // Fehlende Courts auffüllen
  const minCourts = s.courts?.length || S.cfg.courts || 2;
  while (s.courts && s.courts.length < minCourts) s.courts.push([null, null, null, null]);
  if (s.courts) {
    for (var ci = 0; ci < s.courts.length; ci++) {
      while (s.courts[ci].length < 4) s.courts[ci].push(null);
    }
  }
  if (!s.waitlist) s.waitlist = [];
  if (!s.disabledCourts) s.disabledCourts = [];
  if (!s.courtNames) s.courtNames = [];
  if (s.cancelled === undefined) s.cancelled = false;
  return s;
}

function getSessionName(dateOrId) {
  const sess = typeof dateOrId === 'object' ? dateOrId : (S.sessions?.find(s => s.id === dateOrId || s.date === dateOrId));
  if (sess && sess.name && sess.name.trim() !== '') {
    return sess.name;
  }
  const date = typeof dateOrId === 'object' ? dateOrId.date : dateOrId;
  if (S.series && S.cfg.sr_enabled !== '0' && date) {
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

function getSessionTime(dateOrId) {
  const sess = typeof dateOrId === 'object' ? dateOrId : (S.sessions?.find(s => s.id === dateOrId || s.date === dateOrId));
  let start = sess?.timeStart;
  let end   = sess?.timeEnd;
  const date = typeof dateOrId === 'object' ? dateOrId.date : dateOrId;

  if ((!start || !end) && S.series && S.cfg.sr_enabled !== '0' && date) {
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

  const fmt = t => (t && t.length === 4)
      ? t.slice(0,2) + ':' + t.slice(2)
      : (t || '');
  return { start: fmt(start), end: fmt(end) };
}

function getCourtLabel(dateOrSess, ci) {
  let sess = typeof dateOrSess === 'string' ? (S.sessions?.find(s => s.id === dateOrSess || s.date === dateOrSess)) : dateOrSess;
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

function openLoginModal() {
  openWelcomeModal();
}
window.openLoginModal = openLoginModal;

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

  if (S.cfg.total_privacy_mode === '1' && !guestId) {
    const hash = `total_privacy_${guestId || 'guest'}`;
    if (window._lastSessionHash === hash) return;
    window._lastSessionHash = hash;
    container.innerHTML = `
      <div class="card p8 txcenter" style="max-width:440px;margin:var(--sp6) auto">
        <div style="font-size:2.5rem;margin-bottom:var(--sp3)"><i data-lucide="shield-alert" style="width:48px;height:48px;color:var(--txm)"></i></div>
        <h3 class="mb2">${t('settings.total_privacy_title', 'Datenschutz aktiv')}</h3>
        <p class="txsm txm mb5">${t('settings.total_privacy_desc', 'Termine sind nur für angemeldete Spieler sichtbar. Bitte melde dich an, um die Sessions zu sehen.')}</p>
        <button class="btn btn-pri btn-sm" onclick="openWelcomeModal()"><i data-lucide="log-in"></i> <span>${t('nav.login', 'Anmelden')}</span></button>
      </div>`;
    if (window.lucide) lucide.createIcons();
    syncSwipeHeight();
    return;
  }

  const upcomingSessions = getAllUpcomingSessions();

  if (upcomingSessions.length === 0) {
    container.innerHTML = `<div class="p8 txcenter txm">${t('session.no_sessions')}</div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const nextSession = getNextSession();

  const html = upcomingSessions.map(sess => {
    try {
      const isNext = nextSession && ((sess.id && sess.id === nextSession.id) || (sess.date === nextSession.date && (sess.timeStart || '') === (nextSession.timeStart || '')));
      return buildSessionCard(sess, isNext);
    } catch (e) {
      console.error(`Error rendering card for session:`, e);
      return '';
    }
  }).join('');

  const playerHash = S.players.map(p => p.emoji || '').join('');
  const hash = JSON.stringify([guestId, S.cfg.total_privacy_mode, playerHash, upcomingSessions.map(s => {
    return [s.id || s.date, s.date, s.timeStart, s.courts, s.waitlist, s.note, s.location, s.charged, s.disabledCourts, s.cancelled, s.courtNames];
  })]);
  if (window._lastSessionHash === hash) return;
  window._lastSessionHash = hash;
  container.innerHTML = html || `<div class="p8 txcenter txm">${t('session.no_sessions')}</div>`;
  if (window.lucide) lucide.createIcons();
  syncSwipeHeight();
}

function buildSessionCard(dateOrSess, isNextSession = false) {
  const sess = typeof dateOrSess === 'object' ? dateOrSess : getOrSess(dateOrSess);
  const date = sess.date;
  const sessId = sess.id || sess.date;
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
          <span class="slot-name">${privacy ? t('session.booked') : (p ? (isGuest ? t('session.guest') + ` (` + esc(p.name) + `)` : esc(p.name)) : '?')}${privacy ? '' : (isGuest ? '' : (isMe ? ` <span style="opacity:.6;font-size:var(--text-xs)">${t('misc.you')}</span>` : ''))}${isMyGuest ? ` <button onclick="removeGuestSlot('${sessId}',${ci},${si})" style="background:none;border:none;color:var(--err);cursor:pointer;padding:0 2px;font-size:10px" title="${t('misc.guest')} entfernen">×</button>` : ''}</span>
        </div>`;
      } else {
        const mySlotCount = sess.courts.flat().filter(v => v && baseId(v) === guestId).length;
        const canBook = guestId && !meWl && !past && mySlotCount < 3;
        if (canBook) {
          slotChips += `<div class="admin-slot" onclick="guestAssign('${sessId}',${ci},${si})">
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
        ${canRemove ? `<button class="btn-xs btn-dan" style="margin-left:auto;border-radius:var(--r-sm)" onclick="removeFromWaitlist('${sessId}','${pid}')"><i data-lucide="x" style="width:10px;height:10px"></i></button>` : ''}
      </div>`;
    }).join('');
    wlHtml = `<div class="wl-section"><div class="wl-title">${t('session.waitlist')} (${sess.waitlist.length})</div><div class="wl-list">${chips}</div></div>`;
  }

  // ── Action button ──
  let actionBtn = '';
  if (!past && guestId) {
    if (meIn) {
      const abmeldenBtn = sess.charged ? '' : `<button class="btn btn-dan btn-sm" onclick="openLeaveConfirm('${sessId}')"><i data-lucide="log-out"></i> ${t('session.leave')}</button>`;
      const myWlGuests = sess.waitlist.filter(pid => pid.includes('|') && baseId(pid) === guestId).length;
      const freeSlots = total - filled;
      const guestWlBtn = !sess.charged && myWlGuests < 2
        ? `<button class="btn btn-sm btn-sec" onclick="guestJoinWaitlist('${sessId}')"><i data-lucide="user-plus"></i> ${freeSlots > 0 ? t('session.book_guest_btn') : t('session.book_guest_wl')}</button>`
        : '';
      actionBtn = `<div class="flex g2 items-c wrap">${guestWlBtn}${abmeldenBtn}</div>`;
    } else if (meWl) {
      const myWlGuests = sess.waitlist.filter(pid => pid.includes('|') && baseId(pid) === guestId).length;
      const addGuestWlBtn = myWlGuests < 2 ? `<button class="btn btn-sm btn-sec" onclick="guestJoinWaitlist('${sessId}')"><i data-lucide="user-plus"></i> ${t('session.book_guest_wl')}</button>` : '';
      actionBtn = `<div class="flex g2 items-c wrap">
        ${addGuestWlBtn}
        <button class="btn btn-dan btn-sm" onclick="removeFromWaitlist('${sessId}','${guestId}')"><i data-lucide="x"></i> ${t('session.leave')}</button>
      </div>`;
    } else if (filled < total) {
      const mySlots = sess.courts.flat().filter(v => v && baseId(v) === guestId).length;
      const addGuestBtn = mySlots > 0 && mySlots < 3 ? `<button class="btn btn-sm btn-sec" onclick="guestAssignAny('${sessId}')"><i data-lucide="user-plus"></i> ${t('session.book_guest_btn')}</button>` : '';
      actionBtn = `<div class="flex g2 items-c wrap"><button class="btn btn-pri btn-sm" onclick="guestAssignAny('${sessId}')"><i data-lucide="user-plus"></i> ${t('session.book_slot')}</button>${addGuestBtn}</div>`;
    } else {
      actionBtn = `<div class="flex g2 items-c wrap">
        <button class="btn btn-sec btn-sm" onclick="joinWaitlist('${sessId}')"><i data-lucide="list-plus"></i> ${t('session.join_waitlist')}</button>
      </div>`;
    }
  } else if (!guestId && !past) {
    actionBtn = `<span class="txxs txm">↑ ${t('session.login_first')}</span>`;
  }

  const chargedBadge = sess.charged ? `<span class="badge bg-neu">${t('session.charged')}</span>` : '';

  const teamBtn = isNextSession && filled >= 2
    ? `<button class="btn btn-sec btn-sm" onclick="openTeamRandomizer('${sessId}')" data-i18n-title="teams.title"><i data-lucide="shuffle"></i> ${t('session.shuffle_teams')}</button>`
    : '';

  const { start, end } = getSessionTime(sess);

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
          <div class="sc-date">${esc(getSessionName(sess))}</div>
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

function getEffectiveCancelHours(dateOrSess) {
  const sess = typeof dateOrSess === 'object' ? dateOrSess : (S.sessions?.find(s => s.id === dateOrSess || s.date === dateOrSess));
  if (sess && sess.cancelHours !== null && sess.cancelHours !== undefined) return parseFloat(sess.cancelHours);
  const date = typeof dateOrSess === 'object' ? dateOrSess.date : dateOrSess;
  if (S.series && S.cfg.sr_enabled !== '0' && date) {
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

function getCancelDeadline(dateOrSess) {
  const sess = typeof dateOrSess === 'object' ? dateOrSess : (S.sessions?.find(s => s.id === dateOrSess || s.date === dateOrSess));
  const date = sess ? sess.date : dateOrSess;
  const hours = getEffectiveCancelHours(sess || date);
  const { start } = getSessionTime(sess || date);
  const [h, m] = start.split(':').map(Number);
  const sessionDate = new Date(date + 'T00:00:00');
  sessionDate.setHours(h, m, 0, 0);
  return new Date(sessionDate.getTime() - hours * 3600000);
}

function isWithinCancelWindow(dateOrSess) {
  return new Date() < getCancelDeadline(dateOrSess);
}

async function guestAssign(idOrDate, ci, si) {
  if (!guestId) { showToast('Bitte zuerst Profil wählen.'); return; }
  const sess = getOrSess(idOrDate);
  const mySlots = sess.courts.flat().filter(v => v && baseId(v) === guestId);
  if (mySlots.length >= 3) { showToast('Max. 2 Gäste erlaubt.'); return; }
  
  const isGuest = mySlots.length > 0;
  let usePid = guestId;
  if (isGuest) {
    const gn = mySlots.length; 
    usePid = guestId + '|g' + gn;
  }
  
  try {
    const id = sess.id || sess.date;
    await apiFetch('POST', `/sessions/${id}/book`, {
      court_index: ci,
      slot_index: si,
      player_id: usePid,
      date: sess.date,
      timeStart: sess.timeStart,
      timeEnd: sess.timeEnd,
      location: sess.location,
      price: sess.price,
      cancelHours: sess.cancelHours,
      name: sess.name,
      courtNames: sess.courtNames
    });
    
    await loadState();
    renderSessions();
    if (isAdmin) renderAdminPlan();
    showToast(isGuest ? t('toast.guest_booked') : t('toast.slot_booked'));
    
  } catch(e) {
    await loadState(); 
    renderSessions();
    showToast('❌ ' + (e.message || 'Buchung fehlgeschlagen.'));
  }
}

async function guestAssignAny(idOrDate) {
  if (!guestId) { showToast('Bitte Namen auswählen.'); return; }
  const sess = getOrSess(idOrDate);
  for (let ci = 0; ci < sess.courts.length; ci++) {
    if (sess.disabledCourts && sess.disabledCourts.includes(ci)) continue;
    for (let si = 0; si < sess.courts[ci].length; si++) {
      if (!sess.courts[ci][si]) { await guestAssign(sess.id || idOrDate, ci, si); return; }
    }
  }
  showToast('Kein freier Slot.');
}
async function removeGuestSlot(idOrDate, ci, si) {
  try {
    const sess = getOrSess(idOrDate);
    const id = sess.id || sess.date;
    await apiFetch('POST', `/sessions/${id}/leave`, {
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

async function leaveSession(idOrDate) {
  try {
    const sess = getOrSess(idOrDate);
    const id = sess.id || sess.date;
    await apiFetch('POST', `/sessions/${id}/leave`, {
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

async function joinWaitlist(idOrDate) {
  if (!guestId) { showToast('Bitte Namen auswählen.'); return; }
  const sess = getOrSess(idOrDate);
  if (sess.waitlist.includes(guestId)) { showToast('Bereits auf Warteliste.'); return; }
  try {
    const id = sess.id || sess.date;
    await apiFetch('POST', `/sessions/${id}/join-waitlist`, {
      player_id: guestId,
      date: sess.date,
      timeStart: sess.timeStart,
      timeEnd: sess.timeEnd,
      location: sess.location,
      price: sess.price,
      cancelHours: sess.cancelHours,
      name: sess.name,
      courtNames: sess.courtNames
    });
    await loadState();
    renderSessions();
    showToast(t('toast.on_waitlist'));
  } catch(e) {
    showToast('Warteliste fehlgeschlagen.');
  }
}

async function removeFromWaitlist(idOrDate, pid) {
  try {
    const sess = getOrSess(idOrDate);
    const id = sess.id || sess.date;
    await apiFetch('POST', `/sessions/${id}/leave`, {
      player_id: pid
    });
    await loadState();
    renderSessions();
    showToast('Von Warteliste entfernt.');
  } catch(e) {
    showToast('Abmelden von Warteliste fehlgeschlagen.');
  }
}

async function guestJoinWaitlist(idOrDate) {
  if (!guestId) { showToast('Bitte Namen auswählen.'); return; }
  const sess = getOrSess(idOrDate);
  const total = sess.courts.filter((_,i) => !sess.disabledCourts.includes(i)).flat().length;
  const filled = sess.courts.flat().filter(Boolean).length;
  if (filled < total) { await guestAssignAny(sess.id || idOrDate); return; }
  const myWlEntries = sess.waitlist.filter(pid => baseId(pid) === guestId);
  const guestEntries = myWlEntries.filter(pid => pid.includes('|'));
  if (guestEntries.length >= 2) { showToast('Max. 2 Gäste auf Warteliste erlaubt.'); return; }
  const g1Taken = sess.waitlist.includes(guestId + '|g1');
  const newId = g1Taken ? guestId + '|g2' : guestId + '|g1';
  if (sess.waitlist.includes(newId)) { showToast('Gast bereits auf Warteliste.'); return; }
  try {
    const id = sess.id || sess.date;
    await apiFetch('POST', `/sessions/${id}/join-waitlist`, {
      player_id: newId,
      date: sess.date,
      timeStart: sess.timeStart,
      timeEnd: sess.timeEnd,
      location: sess.location,
      price: sess.price,
      cancelHours: sess.cancelHours,
      name: sess.name,
      courtNames: sess.courtNames
    });
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
  renderBilling();
  renderPlayers();
  renderPlayerBalances();
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
// EXPENSES (AUSGABEN / PLATZKOSTEN & TEAMKASSE LEDGER)
// ════════════════════════════════════════
function renderExpenses() {
  const el = document.getElementById('expenses-container');
  if (!el) return;

  const expenses = (S.expenses || []).map(ex => ({
    type: 'expense',
    id: ex.id,
    date: ex.date,
    amount: ex.amount,
    note: ex.note || '',
    paidBy: ex.paidBy,
    sessionId: ex.sessionId,
    timestamp: ex.date + 'T12:00:00'
  }));

  const deposits = (S.transactions || []).filter(tx => tx.credit).map(tx => {
    const p = (S.players || []).find(x => x.id === tx.playerId);
    const formattedNote = formatTxNotePlain(tx);
    return {
      type: 'credit',
      id: tx.id,
      date: tx.date,
      amount: tx.amount,
      note: formattedNote,
      playerName: p ? p.name : t('misc.deleted'),
      playerId: tx.playerId,
      sessionId: tx.sessionId,
      timestamp: tx.createdAt || (tx.date + 'T12:00:00')
    };
  });

  const cntAll = document.getElementById('fin-cnt-team-all');
  const cntCred = document.getElementById('fin-cnt-team-credits');
  const cntExp = document.getElementById('fin-cnt-team-expenses');
  if (cntAll) cntAll.textContent = expenses.length + deposits.length;
  if (cntCred) cntCred.textContent = deposits.length;
  if (cntExp) cntExp.textContent = expenses.length;

  let items = [];
  if (teamFilter === 'expenses') {
    items = expenses;
  } else if (teamFilter === 'credits') {
    items = deposits;
  } else {
    items = [...expenses, ...deposits];
  }

  items.sort((a, b) => b.date.localeCompare(a.date) || (b.timestamp || '').localeCompare(a.timestamp || ''));

  if (!items.length) {
    el.innerHTML = `<div class="empty"><i data-lucide="receipt"></i><h3>${t('finances.no_movements', 'Keine Buchungen vorhanden')}</h3></div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const loc = getLocale();
  el.className = 'expense-list';
  el.innerHTML = items.map(it => {
    const dObj = new Date(it.date + 'T00:00:00');
    const monthStr = dObj.toLocaleDateString(loc, { month: 'short' }).toUpperCase().replace('.', '');
    const dayNum = dObj.toLocaleDateString(loc, { day: 'numeric' });

    if (it.type === 'expense') {
      const expTitle = it.note || t('history.filter_expenses', 'Court-Kosten');
      let badgesHtml = `<span class="badge bg-err" style="font-size:10px;padding:1px 6px">${esc(t('history.filter_expenses', 'Court-Kosten'))}</span>`;
      if (it.paidBy) {
        const p = S.players.find(x => x.id === it.paidBy);
        badgesHtml += `<span class="badge bg-pri" style="font-size:10px;padding:1px 6px"><i data-lucide="user" style="width:10px;height:10px"></i> ${esc(p ? p.name : t('billing.outlay_badge', 'Auslage'))}</span>`;
      }
      const metaSource = it.paidBy ? t('billing.outlay_badge', 'Auslage') : t('billing.paid_by_team', 'Teamkasse');
      return `<div class="expense-card">
        <div class="expense-date-badge">
          <div class="month">${esc(monthStr)}</div>
          <div class="day">${esc(dayNum)}</div>
        </div>
        <div class="expense-card-details">
          <div class="expense-card-note"><span>${esc(expTitle)}</span>${badgesHtml}</div>
          <div class="expense-card-meta">${fmtD(it.date)} · ${esc(metaSource)}</div>
        </div>
        <div class="expense-card-right">
          <div class="expense-card-amount db">– ${fmtE(it.amount)}</div>
          <div class="expense-card-actions">
            <button class="btn btn-sec btn-sm fin-act-btn" onclick="editExpense('${it.id}')" type="button" title="${esc(t('common.edit', 'Bearbeiten'))}"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
            <button class="btn btn-dan btn-sm fin-act-btn" onclick="deleteExpense('${it.id}')" type="button" title="${esc(t('common.delete', 'Löschen'))}"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </div>
        </div>
      </div>`;
    } else {
      const isDefaultNote = !it.note || it.note.toLowerCase() === t('transactions.credit_type').toLowerCase();
      const metaStr = isDefaultNote ? fmtD(it.date) : `${fmtD(it.date)} · ${esc(it.note)}`;
      return `<div class="expense-card">
        <div class="expense-date-badge">
          <div class="month">${esc(monthStr)}</div>
          <div class="day">${esc(dayNum)}</div>
        </div>
        <div class="expense-card-details">
          <div class="expense-card-note">
            <span>${esc(it.playerName)}</span>
            <span class="badge bg-ok" style="font-size:10px;padding:1px 6px">${esc(t('transactions.credit_type'))}</span>
          </div>
          <div class="expense-card-meta">${metaStr}</div>
        </div>
        <div class="expense-card-right">
          <div class="expense-card-amount cr">+ ${fmtE(it.amount)}</div>
          <div class="expense-card-actions">
            <button class="btn btn-sec btn-sm fin-act-btn" onclick="openEditTx('${it.id}')" type="button" title="${esc(t('common.edit', 'Bearbeiten'))}"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          </div>
        </div>
      </div>`;
    }
  }).join('');
}
function populateExpensePayerSelect(selId, selectedPid = '') {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const opts = [`<option value="">${t('billing.paid_by_team', 'Teamkasse')}</option>`];
  const activePlayers = (S.players || []).filter(p => p.active !== false);
  if (activePlayers.length) {
    opts.push(`<optgroup label="${t('billing.paid_by_player_group', 'Auslage durch Spieler')}">`);
    activePlayers.forEach(p => {
      opts.push(`<option value="${p.id}" ${p.id === selectedPid ? 'selected' : ''}>${esc(p.name)}</option>`);
    });
    opts.push('</optgroup>');
  }
  sel.innerHTML = opts.join('');
  sel.value = selectedPid || '';
}

function openExpenseModal() {
  document.getElementById('ex-amount').value = '';
  document.getElementById('ex-date').value = toDS(new Date());
  document.getElementById('ex-note').value = '';
  populateExpensePayerSelect('ex-paid-by', '');
  openMo('mo-expense');
  setTimeout(() => document.getElementById('ex-amount').focus(), 100);
}
async function saveExpense() {
  const amt = parseFloat(document.getElementById('ex-amount').value);
  if (!amt || amt <= 0) { showToast('Gültigen Betrag eingeben.'); return; }
  const date = document.getElementById('ex-date').value || toDS(new Date());
  const note = document.getElementById('ex-note').value.trim();
  const paidBy = document.getElementById('ex-paid-by')?.value || null;
  try {
    const res = await apiFetch('POST', '/expenses', { amount: amt, date, note, paid_by: paidBy });
    if (!S.expenses) S.expenses = [];
    S.expenses.push({ id: res.id, amount: amt, date, note, paidBy, createdAt: new Date().toISOString() });
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
  populateExpensePayerSelect('eex-paid-by', ex.paidBy || '');
  openMo('mo-edit-expense');
  setTimeout(() => document.getElementById('eex-amount').focus(), 100);
}

async function saveEditedExpense() {
  if (!editExpenseId) return;
  const amt = parseFloat(document.getElementById('eex-amount').value);
  if (!amt || amt <= 0) { showToast('Gültigen Betrag eingeben.'); return; }
  const date = document.getElementById('eex-date').value || toDS(new Date());
  const note = document.getElementById('eex-note').value.trim();
  const paidBy = document.getElementById('eex-paid-by')?.value || null;
  try {
    await apiFetch('PUT', '/expenses/' + editExpenseId, { amount: amt, date, note, paid_by: paidBy });
    const idx = S.expenses.findIndex(x => x.id === editExpenseId);
    if (idx >= 0) {
      S.expenses[idx] = { ...S.expenses[idx], amount: amt, date, note, paidBy };
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
  const kpiEl = document.getElementById('kpi-container');
  if (!kpiEl) return;

  if (finDimension === 'team') {
    // Außenverhältnis (Teamkasse / Betreiber-Zahlungen)
    const totalPaid = (S.transactions || []).filter(t => t.credit).reduce((s, t) => s + t.amount, 0);
    const exp = (S.expenses || []).reduce((s, x) => s + x.amount, 0);
    const cf = totalPaid - exp;

    const expensesKpis = [
      { l: t('dashboard.kpi_payments'), v: '+' + fmtE(totalPaid), c: 'pos', s: t('dashboard.kpi_payments_sub') },
      { l: t('history.kpi_expenses', 'Court-Kosten'), v: '–' + fmtE(exp), c: 'neg', s: t('expenses.kpi_sub') },
      { l: t('history.kpi_team_kasse', 'Echte Teamkasse'), v: fmtE(cf), c: cf < 0 ? 'neg' : cf === 0 ? '' : 'pos', s: cf < 0 ? t('dashboard.kpi_cashflow_advance') : t('dashboard.kpi_cashflow_covered') },
    ];

    kpiEl.innerHTML = expensesKpis.map(k =>
      `<div class="kpi"><div class="kpi-lbl">${k.l}</div><div class="kpi-val ${k.c}">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
  } else {
    // Innenverhältnis (Spieler-Guthaben / Session-Verbrauch)
    const sel = document.getElementById('hist-filter');
    const filterPid = sel ? sel.value : '';
    const filteredPlayer = filterPid ? S.players.find(p => p.id === filterPid) : null;
    const txSource = filterPid ? (S.transactions || []).filter(t => t.playerId === filterPid) : (S.transactions || []);

    const paid = txSource.filter(t => t.credit).reduce((s, t) => s + t.amount, 0);
    const debits = txSource.filter(t => !t.credit).reduce((s, t) => s + t.amount, 0);
    const netBal = paid - debits;

    let historyKpis;
    if (filteredPlayer) {
      historyKpis = [
        { l: t('dashboard.kpi_payments'), v: '+' + fmtE(paid), c: 'pos', s: esc(filteredPlayer.name) },
        { l: t('history.kpi_debits'), v: '–' + fmtE(debits), c: 'neg', s: t('history.kpi_debits_sub') },
        { l: t('dashboard.kpi_total_balance'), v: fmtE(netBal), c: netBal >= 0 ? 'pos' : 'neg', s: t('transactions.current_balance') },
      ];
    } else {
      const circulating = (S.players || []).filter(p => p.active !== false && p.balance > 0).reduce((s, p) => s + p.balance, 0);
      const debts = (S.players || []).filter(p => p.active !== false && p.balance < 0).reduce((s, p) => s + p.balance, 0);
      historyKpis = [
        { l: t('finances.kpi_circulating', 'Guthaben im Umlauf'), v: '+' + fmtE(circulating), c: 'pos', s: t('finances.kpi_circulating_sub', 'Guthaben aller Spieler') },
        { l: t('history.kpi_debits'), v: '–' + fmtE(debits), c: 'neg', s: t('history.kpi_debits_sub') },
        { l: t('finances.kpi_debts', 'Offene Spielerschulden'), v: fmtE(debts), c: debts < 0 ? 'neg' : '', s: t('finances.kpi_debts_sub', 'Negative Spielersalden') },
      ];
    }

    kpiEl.innerHTML = historyKpis.map(k =>
      `<div class="kpi"><div class="kpi-lbl">${k.l}</div><div class="kpi-val ${k.c}">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
  }
}
let activityViewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('courtle_act_mode')) || 'table';

window.setActivityViewMode = function(mode) {
  activityViewMode = mode;
  try { localStorage.setItem('courtle_act_mode', mode); } catch (_) {}
  renderPlayerActivityTable();
  if (window.lucide) lucide.createIcons();
};

function getActivityStatus(p) {
  const latestStr = p.lastInteraction || p.lastLogin;
  if (!latestStr) return 'inactive';
  const normalized = latestStr.includes('T') ? latestStr : latestStr.replace(' ', 'T');
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) return 'inactive';
  const diffDays = (Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 2) return 'online';
  if (diffDays <= 14) return 'recent';
  return 'inactive';
}

function formatActivityCell(d, isDateOnly = false) {
  if (!d) return '<span class="txm" style="opacity:.45">–</span>';
  let dt;
  if (d instanceof Date) {
    dt = d;
  } else {
    const normalized = d.includes('T') ? d : d.replace(' ', 'T');
    dt = new Date(normalized);
  }
  if (Number.isNaN(dt.getTime())) return `<span class="act-tbl-val">${esc(String(d))}</span>`;

  const now = new Date();
  const diffMs = now.getTime() - dt.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let relText = '';
  let relClass = '';

  if (diffHours < 1) {
    relText = t('misc.just_now', 'Gerade');
    relClass = 'act-pill-fresh';
  } else if (diffHours < 24 && dt.getDate() === now.getDate()) {
    relText = t('misc.today', 'Heute');
    relClass = 'act-pill-fresh';
  } else if (diffDays === 1 || (diffHours < 48 && (now.getDate() - dt.getDate() === 1 || (now.getDate() === 1 && dt.getDate() > 27)))) {
    relText = t('misc.yesterday', 'Gestern');
    relClass = 'act-pill-recent';
  } else if (diffDays < 7) {
    relText = `vor ${diffDays} T.`;
    relClass = 'act-pill-recent';
  } else {
    relText = fmtD(dt);
    relClass = 'act-pill-older';
  }

  const timeStr = isDateOnly ? '' : fmtTime(dt);

  return `
    <div class="act-cell-wrap">
      <span class="act-pill ${relClass}">${esc(relText)}</span>
      ${timeStr ? `<span class="act-cell-sub">${esc(timeStr)}</span>` : ''}
    </div>
  `;
}

window.handleActivitySearch = function(val) {
  activitySearchQuery = val;
  renderPlayerActivityTable();
  if (window.lucide) lucide.createIcons();
};

window.handleActivitySort = function(val) {
  activitySortOption = val;
  renderPlayerActivityTable();
  if (window.lucide) lucide.createIcons();
};

function renderPlayerActivityTable() {
  const targets = [
    document.getElementById('balance-table'),
    document.getElementById('players-activity-table')
  ].filter(Boolean);
  if (!targets.length) return;
  const activePlayers = (S.players || []).filter(p => p.active !== false);
  if (!activePlayers.length) {
    targets.forEach(el => { el.innerHTML = `<div class="empty"><i data-lucide="users"></i><p>${t('players.no_players')}</p></div>`; });
    if (window.lucide) lucide.createIcons();
    return;
  }

  let filtered = [...activePlayers];
  if (activitySearchQuery) {
    const q = activitySearchQuery.toLowerCase().trim();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || (p.contact && p.contact.toLowerCase().includes(q)));
  }

  filtered.sort((a, b) => {
    switch (activitySortOption) {
      case 'interaction_asc':
        return (a.lastInteraction || '').localeCompare(b.lastInteraction || '');
      case 'login_desc':
        return (b.lastLogin || '').localeCompare(a.lastLogin || '');
      case 'login_asc':
        return (a.lastLogin || '').localeCompare(b.lastLogin || '');
      case 'participation_desc': {
        const pA = getLastParticipationDate(a.id) || '';
        const pB = getLastParticipationDate(b.id) || '';
        return pB.localeCompare(pA);
      }
      case 'participation_asc': {
        const pA = getLastParticipationDate(a.id) || '';
        const pB = getLastParticipationDate(b.id) || '';
        return pA.localeCompare(pB);
      }
      case 'name_desc':
        return b.name.localeCompare(a.name);
      case 'name_asc':
        return a.name.localeCompare(b.name);
      case 'interaction_desc':
      default:
        return (b.lastInteraction || '').localeCompare(a.lastInteraction || '');
    }
  });

  const toolbarHtml = `
    <div class="player-controls-compact mb4">
      <div class="player-search-row">
        <div class="search-wrap" style="flex:1;min-width:140px;position:relative">
          <i data-lucide="search" style="width:15px;height:15px;position:absolute;left:var(--sp3);top:50%;transform:translateY(-50%);color:var(--txm)"></i>
          <input type="text" class="fi" style="padding-left:34px;font-size:var(--text-sm)" placeholder="${esc(t('players.search', 'Spieler suchen...'))}" value="${esc(activitySearchQuery)}" oninput="handleActivitySearch(this.value)">
        </div>
        <div class="sort-wrap flex items-c g2">
          <div class="sort-select-wrap">
            <select class="sort-select" onchange="handleActivitySort(this.value)">
              <option value="interaction_desc" ${activitySortOption === 'interaction_desc' ? 'selected' : ''}>${t('players.activity_sort', 'Aktivität')} ↓</option>
              <option value="interaction_asc" ${activitySortOption === 'interaction_asc' ? 'selected' : ''}>${t('players.activity_sort', 'Aktivität')} ↑</option>
              <option value="login_desc" ${activitySortOption === 'login_desc' ? 'selected' : ''}>${t('players.login_sort', 'Login')} ↓</option>
              <option value="login_asc" ${activitySortOption === 'login_asc' ? 'selected' : ''}>${t('players.login_sort', 'Login')} ↑</option>
              <option value="participation_desc" ${activitySortOption === 'participation_desc' ? 'selected' : ''}>${t('players.last_participation', 'Gespielt')} ↓</option>
              <option value="participation_asc" ${activitySortOption === 'participation_asc' ? 'selected' : ''}>${t('players.last_participation', 'Gespielt')} ↑</option>
              <option value="name_asc" ${activitySortOption === 'name_asc' ? 'selected' : ''}>${t('players.name_sort', 'Name')} A–Z</option>
              <option value="name_desc" ${activitySortOption === 'name_desc' ? 'selected' : ''}>${t('players.name_sort', 'Name')} Z–A</option>
            </select>
            <i data-lucide="chevron-down" class="sort-select-arrow"></i>
          </div>
          <div class="seg-tabs act-view-toggle" role="tablist">
            <button type="button" class="seg-tab ${activityViewMode === 'table' ? 'active' : ''}" onclick="setActivityViewMode('table')" title="${esc(t('misc.table_view', 'Tabelle'))}"><i data-lucide="table-properties" style="width:14px;height:14px"></i></button>
            <button type="button" class="seg-tab ${activityViewMode === 'cards' ? 'active' : ''}" onclick="setActivityViewMode('cards')" title="${esc(t('misc.card_view', 'Karten'))}"><i data-lucide="layout-grid" style="width:14px;height:14px"></i></button>
          </div>
        </div>
      </div>
    </div>
  `;

  if (!filtered.length) {
    targets.forEach(el => { el.innerHTML = toolbarHtml + `<div class="empty"><i data-lucide="search-x"></i><p>${t('players.search_empty', 'Keine passenden Spieler gefunden.')}</p></div>`; });
    if (window.lucide) lucide.createIcons();
    return;
  }

  const getSortIcon = (col) => {
    if (col === 'name') {
      if (activitySortOption === 'name_asc') return ' ↑';
      if (activitySortOption === 'name_desc') return ' ↓';
    } else if (col === 'lastLogin') {
      if (activitySortOption === 'login_asc') return ' ↑';
      if (activitySortOption === 'login_desc') return ' ↓';
    } else if (col === 'interaction') {
      if (activitySortOption === 'interaction_asc') return ' ↑';
      if (activitySortOption === 'interaction_desc') return ' ↓';
    } else if (col === 'lastParticipation') {
      if (activitySortOption === 'participation_asc') return ' ↑';
      if (activitySortOption === 'participation_desc') return ' ↓';
    }
    return '';
  };

  const isSorted = (col) => {
    if (col === 'name') return activitySortOption.startsWith('name');
    if (col === 'lastLogin') return activitySortOption.startsWith('login');
    if (col === 'interaction') return activitySortOption.startsWith('interaction');
    if (col === 'lastParticipation') return activitySortOption.startsWith('participation');
    return false;
  };

  let contentHtml = '';

  if (activityViewMode === 'cards') {
    // ── CARDS VIEW ──
    const cards = filtered.map(p => {
      const partDate = getLastParticipationDate(p.id);
      const adminBadge = p.admin ? ` <span class="badge bg-pri" style="font-size:10px;padding:1px 6px">${t('misc.admin')}</span>` : '';
      const status = getActivityStatus(p);
      const latestRel = p.lastInteraction ? formatActivityCell(p.lastInteraction) : (p.lastLogin ? formatActivityCell(p.lastLogin) : '');
      return `
        <div class="act-modern-card">
          <div class="act-modern-card-head">
            <div class="flex items-c g2" style="min-width:0">
              <div class="act-av-wrap" onclick="event.stopPropagation();openIconPickerModal('${p.id}')" title="${esc(t('players.icon_short'))}">
                <div class="av pc-av" style="width:34px;height:34px;min-width:34px">
                  <i data-lucide="${playerIcon(p)}" style="width:16px;height:16px"></i>
                </div>
                <span class="act-status-dot ${status}"></span>
              </div>
              <div style="min-width:0">
                <div class="act-card-name">${esc(p.name)}${adminBadge}</div>
                ${p.contact ? `<div class="txxs txm">${esc(p.contact)}</div>` : ''}
              </div>
            </div>
            <div class="act-head-rel" style="flex-shrink:0">
              ${latestRel}
            </div>
          </div>
          <div class="act-modern-card-metrics">
            <div class="act-mcm-item">
              <span class="act-mcm-lbl">${t('players.last_login', 'Login')}</span>
              <span class="act-mcm-val">${p.lastLogin ? fmtDTS(p.lastLogin) : '–'}</span>
            </div>
            <div class="act-mcm-item">
              <span class="act-mcm-lbl">${t('players.last_activity', 'Aktivität')}</span>
              <span class="act-mcm-val">${p.lastInteraction ? fmtDTS(p.lastInteraction) : '–'}</span>
            </div>
            <div class="act-mcm-item">
              <span class="act-mcm-lbl">${t('players.last_participation', 'Gespielt')}</span>
              <span class="act-mcm-val">${partDate ? fmtD(partDate) : '–'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    contentHtml = `<div class="act-card-list">${cards}</div>`;
  } else {
    // ── STICKY TABLE VIEW ──
    const rowsHtml = filtered.map(p => {
      const partDate = getLastParticipationDate(p.id);
      const adminBadge = p.admin ? ` <span class="badge bg-pri" style="font-size:10px;padding:1px 6px">${t('misc.admin')}</span>` : '';
      const status = getActivityStatus(p);
      return `
        <tr>
          <td class="act-col-sticky">
            <div class="flex items-c g2">
              <div class="act-av-wrap" onclick="openIconPickerModal('${p.id}')" title="${esc(t('players.icon_short'))}">
                <div class="av pc-av" style="width:28px;height:28px;min-width:28px">
                  <i data-lucide="${playerIcon(p)}" style="width:14px;height:14px"></i>
                </div>
                <span class="act-status-dot ${status}"></span>
              </div>
              <div style="min-width:0;overflow:hidden">
                <div style="font-weight:600;display:flex;align-items:center;gap:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}${adminBadge}</div>
                ${p.contact ? `<div class="txxs txm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.contact)}</div>` : ''}
              </div>
            </div>
          </td>
          <td>${formatActivityCell(p.lastLogin)}</td>
          <td>${formatActivityCell(p.lastInteraction)}</td>
          <td>${formatActivityCell(partDate, true)}</td>
        </tr>
      `;
    }).join('');

    contentHtml = `
      <div class="act-table-wrap">
        <div class="act-table-scroll">
          <table class="act-table">
            <thead>
              <tr>
                <th class="act-col-sticky ${isSorted('name') ? 'act-th-sorted' : ''}" onclick="sortActivityTable('name')" style="cursor:pointer;user-select:none">
                  ${t('transactions.player', 'Spieler')}${getSortIcon('name')}
                </th>
                <th class="${isSorted('lastLogin') ? 'act-th-sorted' : ''}" onclick="sortActivityTable('lastLogin')" style="cursor:pointer;user-select:none">
                  ${t('players.last_login', 'Letzter Login')}${getSortIcon('lastLogin')}
                </th>
                <th class="${isSorted('interaction') ? 'act-th-sorted' : ''}" onclick="sortActivityTable('interaction')" style="cursor:pointer;user-select:none">
                  ${t('players.last_activity', 'Letzte Aktivität')}${getSortIcon('interaction')}
                </th>
                <th class="${isSorted('lastParticipation') ? 'act-th-sorted' : ''}" onclick="sortActivityTable('lastParticipation')" style="cursor:pointer;user-select:none">
                  ${t('players.last_participation', 'Letzte Teilnahme')}${getSortIcon('lastParticipation')}
                </th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  targets.forEach(el => { el.innerHTML = toolbarHtml + contentHtml; });
  if (window.lucide) lucide.createIcons();
}

function sortActivityTable(column) {
  if (column === 'name') {
    activitySortOption = activitySortOption === 'name_asc' ? 'name_desc' : 'name_asc';
  } else if (column === 'lastLogin') {
    activitySortOption = activitySortOption === 'login_desc' ? 'login_asc' : 'login_desc';
  } else if (column === 'lastParticipation') {
    activitySortOption = activitySortOption === 'participation_desc' ? 'participation_asc' : 'participation_desc';
  } else {
    activitySortOption = activitySortOption === 'interaction_desc' ? 'interaction_asc' : 'interaction_desc';
  }
  renderPlayerActivityTable();
  if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════
// ADMIN – SESSION PLANNER (MODERN)
// ════════════════════════════════════════
let planTab = 'slots';
let planDetailsOpen = false;
let _planSaveTimeout = null;

function setPlanTab(tab) {
  if (tab === 'waitlist') tab = 'slots';
  planTab = tab;
  ['slots', 'history'].forEach(tKey => {
    const btn = document.getElementById('plan-tab-' + tKey);
    if (btn) {
      btn.classList.toggle('active', tKey === tab);
      btn.setAttribute('aria-selected', tKey === tab ? 'true' : 'false');
    }
  });
  const cSlots = document.getElementById('plan-card-slots');
  const cWl = document.getElementById('plan-waitlist-admin');
  const cHist = document.getElementById('plan-history');
  if (cSlots) cSlots.style.display = tab === 'slots' ? '' : 'none';
  if (cWl) cWl.style.display = tab === 'slots' ? '' : 'none';
  if (cHist) {
    cHist.style.display = tab === 'history' ? '' : 'none';
    if (tab === 'history' && planDate) renderSessionHistory(planDate);
  }
}

function scrollPlanStrip(delta) {
  const el = document.getElementById('plan-strip');
  if (el) el.scrollBy({ left: delta * 240, behavior: 'smooth' });
}

function planGoToDateClosest(dateStr) {
  if (!dateStr) return;
  const all = getAllSessionsAdmin();
  if (!all.length) return;
  let target = all.find(s => s.date === dateStr);
  if (!target) {
    target = all.find(s => s.date >= dateStr) || all[all.length - 1];
  }
  if (target) {
    const targetId = target.id || target.date;
    const curSess = getOrSess(planDate);
    const curDate = curSess ? curSess.date : planDate;
    if (targetId === planDate || target.date === curDate) return;
    planDate = targetId;
    setTimeout(() => {
      renderAdminPlan();
    }, 80);
  }
}

function togglePlanDetails() {
  planDetailsOpen = !planDetailsOpen;
  const box = document.getElementById('session-details-box');
  const btn = document.getElementById('plan-edit-toggle-btn');
  if (box) box.hidden = !planDetailsOpen;
  if (btn) btn.classList.toggle('active-toggle', planDetailsOpen);
}

let _planDetailChanges = {};

function planDetailChange(field, value) {
  _planDetailChanges[field] = value;
}

function planDetailAutoSave(field, value) {
  planDetailChange(field, value);
  if (_planSaveTimeout) clearTimeout(_planSaveTimeout);
  _planSaveTimeout = setTimeout(() => {
    savePlanDetailsSilent();
  }, 400);
}

async function savePlanDetailsSilent() {
  if (Object.keys(_planDetailChanges).length === 0) return true;
  const ind = document.getElementById('plan-save-indicator');
  try {
    const updates = {};
    if (_planDetailChanges.date) updates.newDate = _planDetailChanges.date;
    if (_planDetailChanges.timeStart) updates.timeStart = _planDetailChanges.timeStart;
    if (_planDetailChanges.timeEnd) updates.timeEnd = _planDetailChanges.timeEnd;
    if (_planDetailChanges.note !== undefined) updates.note = _planDetailChanges.note;
    if (_planDetailChanges.location !== undefined) updates.location = _planDetailChanges.location;
    if (_planDetailChanges.price !== undefined) updates.price = _planDetailChanges.price === '' ? null : parseFloat(_planDetailChanges.price);
    if (_planDetailChanges.cancelHours !== undefined) updates.cancelHours = _planDetailChanges.cancelHours === null ? null : _planDetailChanges.cancelHours;
    if (_planDetailChanges.name !== undefined) updates.name = _planDetailChanges.name === '' ? null : _planDetailChanges.name;
    if (_planDetailChanges.courtNames !== undefined) updates.courtNames = _planDetailChanges.courtNames;

    const sess = getOrSess(planDate);
    const targetId = sess?.id || planDate;
    const res = await apiFetch('PUT', '/sessions/' + targetId, updates);
    await loadState();
    _planDetailChanges = {};
    if (res && res.id) planDate = res.id;

    renderAdminPlan(true);
    renderSessions();
    lucide.createIcons();
    const newInd = document.getElementById('plan-save-indicator');
    if (newInd) {
      newInd.classList.add('show');
      setTimeout(() => newInd.classList.remove('show'), 2000);
    }
    return true;
  } catch (e) {
    showToast('⚠️ ' + (e.message || t('misc.save_failed')));
    return false;
  }
}

async function savePlanDetails() {
  if (_planSaveTimeout) {
    clearTimeout(_planSaveTimeout);
    _planSaveTimeout = null;
  }
  if (Object.keys(_planDetailChanges).length > 0) {
    const ok = await savePlanDetailsSilent();
    if (!ok) return;
  } else {
    const newInd = document.getElementById('plan-save-indicator');
    if (newInd) {
      newInd.classList.add('show');
      setTimeout(() => newInd.classList.remove('show'), 2000);
    }
  }
  showToast(t('toast.changes_saved'));
}

let _planStripAnimateNext = true;

function renderAdminPlan(keepDetailsOpen) {
  if (!S.sessions) return;
  const allSessions = getAllSessionsAdmin();
  const selBox = document.getElementById('session-selector-box');
  const headBox = document.getElementById('admin-plan-header-dynamic');

  const activeEl = document.activeElement;
  const activeId = (activeEl && headBox && headBox.contains(activeEl) && activeEl.id) ? activeEl.id : null;
  const selStart = (activeEl && typeof activeEl.selectionStart === 'number') ? activeEl.selectionStart : null;
  const selEnd = (activeEl && typeof activeEl.selectionEnd === 'number') ? activeEl.selectionEnd : null;

  if (allSessions.length === 0) {
    if (selBox) selBox.innerHTML = '<div class="plan-strip" id="plan-strip" role="listbox"></div>';
    if (headBox) {
      headBox.innerHTML = `
        <div style="padding:var(--sp8) var(--sp4);text-align:center">
          <i data-lucide="calendar" style="width:48px;height:48px;color:var(--txm);margin-bottom:var(--sp3)"></i>
          <h2 class="sec-title">${t('planner.empty_title')}</h2>
          <p class="txsm txm mb4">${t('planner.empty_text')}</p>
          <div class="flex just-c g2">
            <button class="btn btn-ok btn-sm" onclick="openAddSessionModal()"><i data-lucide="plus"></i> ${t('session.new')}</button>
            <button class="btn-nav" onclick="showView('series')"><i data-lucide="repeat"></i> ${t('planner.setup_series')}</button>
          </div>
        </div>`;
    }
    const cSlots = document.getElementById('plan-card-slots');
    const cWl = document.getElementById('plan-waitlist-admin');
    const cHist = document.getElementById('plan-history');
    const tabs = document.getElementById('plan-tabs');
    if (cSlots) cSlots.style.display = 'none';
    if (cWl) cWl.style.display = 'none';
    if (cHist) cHist.style.display = 'none';
    if (tabs) tabs.style.display = 'none';
    lucide.createIcons();
    return;
  }

  const tabs = document.getElementById('plan-tabs');
  if (tabs) tabs.style.display = '';

  const today = toDS(new Date());
  if (!planDate) {
    const upcoming = allSessions.find(s => s.date >= today);
    planDate = upcoming ? (upcoming.id || upcoming.date) : (allSessions[0].id || allSessions[0].date);
  }

  let currentSess = allSessions.find(s => (s.id && s.id === planDate) || s.date === planDate);
  if (!currentSess && allSessions.length > 0) {
    currentSess = allSessions[0];
    planDate = currentSess.id || currentSess.date;
  }

  const rawSess = S.sessions?.find(s => (s.id && s.id === planDate) || s.date === planDate);
  const sess = getOrSess(planDate);
  if (!sess) return;
  const isCancelled = rawSess?.cancelled ?? sess?.cancelled ?? false;
  if (!sess.disabledCourts) sess.disabledCourts = [];
  const sessTime = getSessionTime(sess);
  const sessCost = getSessionCost(sess);
  const sessId = sess.id || sess.date;

  const activeCourts = sess.courts.filter((_, i) => !sess.disabledCourts.includes(i));
  const allPids = [...new Set(activeCourts.flat().filter(Boolean))];
  const total = activeCourts.length * 4;
  const filled = allPids.length;
  const isEnded = sessionEndDate(sess) < new Date();
  const isAwaiting = !sess.charged && !isCancelled && !sess.billingDeferred && isEnded && filled > 0;

  let statusClass = 'st-open';
  let statusLabel = t('planner.status_open');
  if (isCancelled) {
    statusClass = 'st-cancelled';
    statusLabel = t('planner.status_cancelled');
  } else if (sess.charged) {
    statusClass = 'st-charged';
    statusLabel = t('planner.status_charged');
  } else if (sess.billingDeferred) {
    statusClass = 'st-deferred';
    statusLabel = t('planner.status_deferred');
  } else if (isAwaiting) {
    statusClass = 'st-awaiting';
    statusLabel = t('planner.status_awaiting');
  }

  // 1. Horizontal Date Strip (with start time on each chip for multi-session days)
  const upcomingSessions = allSessions.filter(s => s.date >= today);
  const pastSessions = allSessions.filter(s => s.date < today);
  const locale = I18N.current === 'de' ? 'de-DE' : 'en-US';

  function makeChip(s) {
    const sId = s.id || s.date;
    const isSel = (s.id === planDate || s.date === planDate);
    const sCounts = sessionChargeMap(s);
    const sActiveCourts = (s.courts || []).filter((_, i) => !(s.disabledCourts || []).includes(i));
    const sTotalSlots = (sActiveCourts.length || (s.courts ? s.courts.length : 2)) * 4;
    const sFilled = Object.values(sCounts).reduce((a, b) => a + b, 0);
    const sEnded = sessionEndDate(s) < new Date();
    const sAwaiting = !s.charged && !s.cancelled && !s.billingDeferred && sEnded && sFilled > 0;

    let chipClass = 'st-open';
    let bText = `${sFilled}/${sTotalSlots}`;
    if (s.cancelled) { chipClass = 'st-cancelled'; bText = '✕'; }
    else if (s.charged) { chipClass = 'st-charged'; bText = '✓'; }
    else if (s.billingDeferred) { chipClass = 'st-deferred'; bText = '⏸'; }
    else if (sAwaiting) { chipClass = 'st-awaiting'; bText = '€'; }

    const dObj = new Date(s.date + 'T00:00:00');
    const wkdy = dObj.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '');
    const dayNum = dObj.getDate();
    const mStr = dObj.toLocaleDateString(locale, { month: 'short' }).replace('.', '');
    const { start } = getSessionTime(s);
    const timeLabel = start ? fmtTime(start) : '';

    return `<button class="plan-chip ${chipClass} ${isSel ? 'active' : ''}" data-date="${s.date}" data-id="${sId}" onclick="planGoToDate('${sId}')" type="button" role="option" aria-selected="${isSel ? 'true' : 'false'}">
      <span class="pc-top">${wkdy} · ${mStr}</span>
      <span class="pc-day">${dayNum}</span>
      ${timeLabel ? `<span class="pc-time">${timeLabel}</span>` : ''}
      <span class="pc-badge">${bText}</span>
    </button>`;
  }

  let chipsHtml = '';
  if (pastSessions.length > 0) {
    chipsHtml += pastSessions.map(makeChip).join('');
  }
  if (pastSessions.length > 0 && upcomingSessions.length > 0) {
    chipsHtml += `<button type="button" class="plan-today-marker" onclick="planGoToUpcoming()" title="${esc(t('session.next'))}">HEUTE</button>`;
  }
  if (upcomingSessions.length > 0) {
    chipsHtml += upcomingSessions.map(makeChip).join('');
  }

  const nextUpcoming = upcomingSessions[0] || allSessions[allSessions.length - 1];
  const nextUpcomingId = nextUpcoming ? (nextUpcoming.id || nextUpcoming.date) : null;
  const isAtUpcoming = nextUpcomingId && (planDate === nextUpcomingId || planDate === nextUpcoming.date);

  if (selBox) {
    selBox.innerHTML = `
      <div class="plan-nav-box">
        <div class="plan-top-bar">
          <span class="plan-top-label"><i data-lucide="calendar-days"></i> ${t('planner.select_session_label')}</span>
          <div class="plan-top-actions">
            <button class="btn btn-sec btn-sm" id="plan-jump-upcoming-btn" onclick="planGoToUpcoming()" title="${esc(t('planner.jump_upcoming_title'))}" type="button">
              <i data-lucide="calendar-arrow-up"></i> <span>${t('planner.jump_upcoming')}</span>
            </button>
            <div class="btn btn-sec btn-sm" id="plan-date-picker-wrap" style="position:relative;overflow:hidden;cursor:pointer;margin:0;display:inline-flex;align-items:center;justify-content:center" title="${esc(t('planner.jump_to_date'))}">
              <i data-lucide="calendar-search"></i>
              <input type="date" id="plan-date-picker" value="${sess.date}" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:2;margin:0;padding:0;border:none;pointer-events:auto" onchange="planGoToDateClosest(this.value)">
            </div>
            <button class="btn btn-ok btn-sm" onclick="openAddSessionModal()" type="button"><i data-lucide="plus"></i> <span data-i18n="session.new">${t('session.new')}</span></button>
          </div>
        </div>
        <div class="plan-strip-wrap">
          <button class="plan-strip-nav" onclick="scrollPlanStrip(-1)" type="button" aria-label="Links scrollen">‹</button>
          <div class="plan-strip" id="plan-strip" role="listbox">
            ${chipsHtml}
          </div>
          <button class="plan-strip-nav" onclick="scrollPlanStrip(1)" type="button" aria-label="Rechts scrollen">›</button>
        </div>
      </div>
    `;
  }

  // 2. Primary action button in header
  let primaryActionBtn = '';
  if (isCancelled) {
    primaryActionBtn = `<button class="btn btn-ok btn-sm" onclick="toggleSessionCancel()"><i data-lucide="rotate-ccw"></i> ${t('session.reactivate')}</button>`;
  } else if (sess.charged) {
    primaryActionBtn = `<button class="btn-nav" onclick="setBillingTab('charged');showView('billing')"><i data-lucide="arrow-up-right"></i> ${t('planner.view_in_billing')}</button>`;
  } else if (isAwaiting) {
    primaryActionBtn = `<button class="btn btn-pri btn-sm" onclick="openBillingModal(['${sessId}'])"><i data-lucide="receipt"></i> ${t('session.billing_charge')}</button>`;
  } else if (filled > 0) {
    primaryActionBtn = `<button class="btn btn-sec btn-sm" onclick="openBillingModal(['${sessId}'])"><i data-lucide="credit-card"></i> ${t('session.billing_charge')}</button>`;
  }

  if (keepDetailsOpen) planDetailsOpen = true;
  const showDetails = planDetailsOpen || isCancelled;
  const effectiveLoc = (sess.location || S.cfg.srlocation || '').trim();
  const cancelActionLabel = isCancelled ? t('session.reactivate') : t('session.cancel');

  // 3. Unified Header + Metadata + Collapsible Edit Drawer Card
  if (headBox) {
    headBox.innerHTML = `
      <div class="flex items-c just-b wrap g2">
        <div class="flex items-c g2 wrap">
          <h2 class="sec-title" style="margin-bottom:0">${esc(getSessionName(sess))}</h2>
          ${sess.seriesId ? `<span class="badge bg-sec" title="${esc(t('planner.from_series'))}"><i data-lucide="repeat" style="width:12px;height:12px"></i></span>` : ''}
          <span class="status-pill ${statusClass}">${statusLabel}</span>
          <span class="save-indicator" id="plan-save-indicator"><i data-lucide="check"></i> ${t('planner.saved')}</span>
        </div>
        <div class="flex items-c g2 wrap">
          ${primaryActionBtn}
          ${sess.billingDeferred ? `<button class="btn btn-sec btn-sm" onclick="deferBillingSession('${sessId}', false)"><i data-lucide="rotate-ccw"></i> ${t('billing.undefer')}</button>` : ''}
          ${isAwaiting ? `<button class="btn btn-sec btn-sm" onclick="deferBillingSession('${sessId}', true)"><i data-lucide="clock"></i> ${t('billing.defer')}</button>` : ''}
          ${!isCancelled && !sess.charged ? `<button class="btn btn-dan btn-sm" id="plan-cancel-btn" onclick="toggleSessionCancel()"><i data-lucide="x-circle"></i> ${t('session.cancel')}</button>` : ''}
          ${isCancelled ? `<button class="btn btn-dan btn-sm" id="plan-delete-btn" onclick="deleteSession()"><i data-lucide="trash-2"></i> ${t('misc.delete')}</button>` : ''}
          <button class="btn btn-sec btn-sm ${showDetails ? 'active-toggle' : ''}" id="plan-edit-toggle-btn" onclick="togglePlanDetails()"><i data-lucide="sliders-horizontal"></i> <span>${t('planner.edit_details')}</span></button>
        </div>
      </div>

      <div class="plan-meta-row">
        <span class="plan-meta-item"><i data-lucide="calendar"></i> <span>${esc(fmtDL(sess.date))}</span></span>
        <span class="plan-meta-item"><i data-lucide="clock"></i> <span>${sessTime.start}–${sessTime.end}</span></span>
        ${effectiveLoc ? `<span class="plan-meta-item"><i data-lucide="map-pin"></i> <span>${esc(effectiveLoc)}</span></span>` : ''}
        <span class="plan-meta-item"><i data-lucide="tag"></i> <span>${fmtE(sessCost)} / Slot</span></span>
        <span class="plan-meta-item"><i data-lucide="users"></i> <span>${filled} / ${total} ${t('session.slots_meta')}</span></span>
        ${sess.note ? `<span class="plan-meta-item"><i data-lucide="message-square"></i> <span>${esc(sess.note)}</span></span>` : ''}
      </div>

      <div class="plan-edit-drawer" id="session-details-box" ${showDetails ? '' : 'hidden'}>
        ${sess.charged ? `<p class="txxs txm mb3">${t('planner.locked_charged')}</p>` : ''}
        
        <div class="settings-group-title">
          <i data-lucide="calendar" style="width:14px;height:14px"></i>
          <span>${t('planner.edit_details', 'Details bearbeiten')}</span>
        </div>

        <div class="settings-group mb3">
          <div class="settings-row">
            <div class="settings-meta">
              <label class="settings-title" for="plan-date-input">${t('session.date')}</label>
              <div class="settings-desc">${t('session.date_desc', 'Datum des Spieltags')}</div>
            </div>
            <div class="settings-control">
              <div class="ios-input-wrap plan-edit-control">
                <i data-lucide="calendar"></i>
                <input type="date" id="plan-date-input"
                       value="${sess.date}"
                       ${sess.charged ? 'disabled' : ''}
                       onchange="planDetailAutoSave('date', this.value)">
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-meta">
              <label class="settings-title">${t('session.time')}</label>
              <div class="settings-desc">${t('session.time_desc', 'Start- und Endzeit')}</div>
            </div>
            <div class="settings-control">
              <div class="ios-time-picker plan-edit-control">
                <i data-lucide="clock"></i>
                <input type="time" id="plan-time-start"
                       value="${sessTime.start}"
                       ${sess.charged ? 'disabled' : ''}
                       onchange="planDetailAutoSave('timeStart', this.value)">
                <span class="tx-m" style="padding:0 4px">–</span>
                <input type="time" id="plan-time-end"
                       value="${sessTime.end}"
                       ${sess.charged ? 'disabled' : ''}
                       onchange="planDetailAutoSave('timeEnd', this.value)">
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-meta">
              <label class="settings-title" for="plan-name-input">${t('session.name')}</label>
              <div class="settings-desc">${t('session.name_desc', 'Name oder Thema der Session')}</div>
            </div>
            <div class="settings-control">
              <div class="ios-input-wrap plan-edit-control">
                <i data-lucide="tag"></i>
                <input type="text" id="plan-name-input" placeholder="${esc(getSessionName(sess))}"
                       value="${esc(sess.name || '')}"
                       ${sess.charged ? 'disabled' : ''}
                       oninput="planDetailAutoSave('name', this.value)"
                       onchange="planDetailAutoSave('name', this.value)">
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-meta">
              <label class="settings-title" for="plan-location-input">${t('session.address')}</label>
              <div class="settings-desc">${t('session.address_desc', 'Veranstaltungsort oder Halle')}</div>
            </div>
            <div class="settings-control">
              <div class="ios-input-wrap plan-edit-control">
                <i data-lucide="map-pin"></i>
                <input type="text" id="plan-location-input" placeholder="${esc(S.cfg.srlocation || t('session.address_placeholder'))}"
                       value="${esc(sess.location || '')}"
                       ${sess.charged ? 'disabled' : ''}
                       oninput="planDetailAutoSave('location', this.value)"
                       onchange="planDetailAutoSave('location', this.value)">
              </div>
            </div>
          </div>
        </div>

        <div class="settings-group-title">
          <i data-lucide="sliders" style="width:14px;height:14px"></i>
          <span>${t('session.conditions_notes', 'Konditionen & Notizen')}</span>
        </div>

        <div class="settings-group mb3">
          <div class="settings-row">
            <div class="settings-meta">
              <label class="settings-title" for="plan-price-input">${t('session.price')} (${t('session.per_slot')})</label>
              <div class="settings-desc">${t('session.price_desc', 'Kostenbeitrag pro Platz')}</div>
            </div>
            <div class="settings-control">
              <div class="ios-input-wrap plan-edit-control">
                <i data-lucide="euro"></i>
                <input type="number" id="plan-price-input" placeholder="${S.cfg.sr_cost || S.cfg.cost || 16}" step="0.5"
                       value="${sess.price !== null && sess.price !== undefined ? sess.price : ''}"
                       ${sess.charged ? 'disabled' : ''}
                       oninput="planDetailAutoSave('price', this.value)"
                       onchange="planDetailAutoSave('price', this.value)">
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-meta">
              <label class="settings-title" for="plan-cancel-hours">${t('session.cancel_deadline')}</label>
              <div class="settings-desc">${t('session.cancel_deadline_desc', 'Kostenfreie Absagefrist')}</div>
            </div>
            <div class="settings-control">
              <div class="ios-input-wrap plan-edit-control">
                <i data-lucide="hourglass"></i>
                <input type="text" id="plan-cancel-hours" placeholder="7:00"
                       value="${sess.cancelHours !== null && sess.cancelHours !== undefined ? formatCancelHours(sess.cancelHours) : ''}"
                       ${sess.charged ? 'disabled' : ''}
                       onchange="planDetailAutoSave('cancelHours', parseCancelHours(this.value))">
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-meta">
              <label class="settings-title" for="plan-note-input">${t('session.comment')}</label>
              <div class="settings-desc">${t('session.comment_desc', 'Zusätzliche Infos für Mitspieler')}</div>
            </div>
            <div class="settings-control">
              <div class="ios-input-wrap plan-edit-control">
                <i data-lucide="message-square"></i>
                <input type="text" id="plan-note-input" placeholder="${t('session.comment_placeholder')}"
                       value="${esc(sess.note || '')}"
                       ${sess.charged ? 'disabled' : ''}
                       oninput="planDetailAutoSave('note', this.value)"
                       onchange="planDetailAutoSave('note', this.value)">
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 4. Slot Editor
  document.getElementById('plan-slots-meta').textContent = `${filled} / ${total} ${t('session.slots_meta')} · ${activeCourts.length} ${t('session.court_s')} ${sess.disabledCourts.length > 0 ? `(${sess.disabledCourts.length} ${t('session.disabled')})` : ''}`;
  const playerMap = new Map(S.players.map(p => [p.id, p]));

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
               onchange="changeCourtName('${sessId}', ${ci}, this.value)"
               title="${t('session.court_numbers')}"
               ${sess.charged ? 'disabled' : ''}>
        ${isDisabled ? '<span class="badge bg-err">' + t('session.cancelled') + '</span>' : ''}
      </div>
      <div class="flex items-c g2" style="flex-shrink:0">
        ${!sess.charged ? `<button class="btn btn-xs ${isDisabled ? 'btn-ok' : 'btn-dan'}" onclick="toggleCourt('${sessId}', ${ci})">${isDisabled ? t('session.activate') : t('session.deactivate')}</button>` : ''}
        ${isDisabled && !sess.charged ? `<button class="btn btn-xs btn-dan" onclick="deleteCourt('${sessId}', ${ci})"><i data-lucide="trash-2"></i></button>` : ''}
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
          html += `<div class="admin-slot filled" onclick="${sess.charged ? '' : `openSlotModal('${sessId}',${ci},${si})`}">
            <div class="av" style="width:32px;height:32px;font-size:var(--text-sm)"><i data-lucide="${playerIcon(p)}" style="width:16px;height:16px"></i></div>
            <span class="slot-name">${esc(p.name)}${guestLabel}</span>
          </div>`;
        } else {
          html += `<div class="admin-slot" onclick="${sess.charged ? '' : `openSlotModal('${sessId}',${ci},${si})`}">
            <i data-lucide="user-plus" style="width:16px;height:16px;color:var(--txf)"></i>
            <span class="slot-ph">${t('session.choose_player')}</span>
          </div>`;
        }
      });
      html += `</div>`;
    }
  });
  document.getElementById('plan-slots-editor').innerHTML = html;

  // 5. Waitlist panel
  const wlEl = document.getElementById('plan-waitlist-admin');
  const wlCountEl = document.getElementById('plan-tab-wl-count');
  if (wlCountEl) wlCountEl.textContent = sess.waitlist.length > 0 ? `(${sess.waitlist.length})` : '';
  const adminWlBtn = `<button class="btn btn-sec btn-sm" style="margin-top:var(--sp3)" onclick="adminAddToWaitlist('${sessId}')"><i data-lucide="list-plus"></i> ${t('session.waitlist_add')}</button>`;
  if (sess.waitlist.length) {
    wlEl.innerHTML = `<h3 class="sec-title">${t('session.waitlist')} <span class="badge bg-gld" style="margin-left:4px;padding:1px 6px;font-size:10px">${sess.waitlist.length}</span></h3>
    <div class="wl-list">${sess.waitlist.map((pid, i) => {
      const displayName = getDisplayName(pid, playerMap);
      const rawPid = pid.includes('|') ? pid.split('|')[0] : pid;
      const wlP = playerMap.get(rawPid);
      return `<div class="slot-chip wl" style="padding:var(--sp2) var(--sp3)">
        <span style="font-size:var(--text-xs);color:var(--txm);font-weight:700;min-width:16px">${i + 1}.</span>
        <div class="slot-av"><i data-lucide="${playerIcon(wlP || displayName.replace(` (${t('misc.guest')})`, ''))}" style="width:14px;height:14px"></i></div>
        <span>${esc(displayName)}</span>
        <button class="btn-xs btn-ok" style="margin-left:auto;border-radius:var(--r-sm)" onclick="promoteWaitlist('${sessId}',${i})"><i data-lucide="arrow-up" style="width:10px;height:10px"></i> ${t('session.waitlist_promote')}</button>
        <button class="btn-xs btn-dan" style="border-radius:var(--r-sm)" onclick="removeWaitlist('${sessId}',${i})"><i data-lucide="x" style="width:10px;height:10px"></i></button>
      </div>`;
    }).join('')}</div>${adminWlBtn}`;
  } else {
    wlEl.innerHTML = `<h3 class="sec-title" style="margin-bottom:var(--sp2)">${t('session.waitlist')}</h3><p class="txsm txm">${t('session.no_entries')}</p>${adminWlBtn}`;
  }

  // 6. Update active tab views
  setPlanTab(planTab);

  // Auto-scroll active chip horizontally inside plan-strip (avoids vertical window scrolling on iOS)
  const animateScroll = _planStripAnimateNext;
  _planStripAnimateNext = false;

  setTimeout(() => {
    const strip = document.getElementById('plan-strip');
    const activeChip = strip?.querySelector('.plan-chip.active');
    if (strip && activeChip) {
      const targetLeft = activeChip.offsetLeft - (strip.clientWidth - activeChip.offsetWidth) / 2;
      strip.scrollTo({ left: Math.max(0, targetLeft), behavior: animateScroll ? 'smooth' : 'auto' });
    }
  }, animateScroll ? 100 : 20);

  lucide.createIcons();

  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (selStart !== null && selEnd !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(selStart, selEnd); } catch(_) {}
      }
    }
  }
}

async function renderSessionHistory(dateOrId) {
  const el = document.getElementById('plan-history-content');
  if (!el) return;
  el.innerHTML = '<div class="txsm txm">' + t('session.history_loading') + '</div>';
  try {
    const sess = getOrSess(dateOrId);
    const id = sess?.id || dateOrId;
    const date = sess?.date || dateOrId;
    const data = await apiFetch('GET', `/session-history?session_id=${id}&date=${date}`);
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
      charged:         { label: t('billing.history_charged'),  cls: 'bg-neu' },
      charge_reverted: { label: t('billing.history_reverted'), cls: 'bg-gld' },
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
  const sess = getOrSess(planDate);
  const rawSess = S.sessions.find(s => (s.id && s.id === planDate) || s.date === planDate);
  const isCancelled = rawSess?.cancelled || sess?.cancelled || false;
  const newCancelled = !isCancelled;
  const targetId = sess?.id || rawSess?.id || planDate;
  try {
    await apiFetch('PUT', '/sessions/' + targetId, { cancelled: newCancelled });
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
        const sess = getOrSess(planDate);
        const targetId = sess?.id || planDate;
        await apiFetch('DELETE', '/sessions/' + targetId);
        await loadState();
        const all = getAllSessionsAdmin();
        const today = toDS(new Date());
        const target = all.find(s => s.date >= today) || all[0];
        planDate = target ? (target.id || target.date) : today;
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

  const exists = S.sessions.find(s => s.date === date && (s.timeStart || '').replace(':','') === start);
  if (exists) {
      showToast(t('toast.session_exists'));
      closeMo('mo-add-session');
      planDate = exists.id || exists.date;
      showView('admin-plan');
      renderAdminPlan();
      return;
  }

  try {
      const res = await apiFetch('PUT', '/sessions/new', {
          date:           date,
          courts:         Array(parseInt(S.cfg.courts, 10) || 2).fill(null).map(() => [null, null, null, null]),
          disabledCourts: [],
          waitlist:       [],
          note:           '',
          timeStart:      start,
          timeEnd:        end,
      });
      await loadState();
      closeMo('mo-add-session');
      planDate = res?.id || date;
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
  const all = getAllSessionsAdmin();
  const idx = all.findIndex(s => (s.id && s.id === planDate) || s.date === planDate);
  const target = idx > 0 ? all[idx - 1] : all[0];
  if (target) planDate = target.id || target.date;
  renderAdminPlan();
}
function planNext() {
  const all = getAllSessionsAdmin();
  const idx = all.findIndex(s => (s.id && s.id === planDate) || s.date === planDate);
  const target = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : all[all.length - 1];
  if (target) planDate = target.id || target.date;
  renderAdminPlan();
}
function planGoToUpcoming() {
  const today = toDS(new Date());
  const all = getAllSessionsAdmin();
  const upcoming = all.find(s => s.date >= today);
  const target = upcoming || all[all.length - 1];
  if (target) planDate = target.id || target.date;
  _planStripAnimateNext = true;
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
  const foot = document.getElementById('mo-slot').querySelector('.mo-foot');
  if (foot) foot.style.display = '';
  const sess = getOrSess(date);
  const allSlots = sess.courts.flat();
  const curVal = sess.courts[ci][si];
  const list = document.getElementById('mo-slot-list');
  const players = S.players.filter(p => p.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
  list.innerHTML = players.map(p => {
    const b = bal(p.id);
    // Is this player's main slot taken (in a different slot than current)?
    const mainTaken = allSlots.some(v => v === p.id && v !== curVal);
    // How many guest slots does this player have?
    const guestSlots = allSlots.filter(v => v && v.startsWith(p.id + '|') && v !== curVal);
    const canGuest = guestSlots.length < 2;
    const g1Taken = allSlots.some(v => v === p.id + '|g1' && v !== curVal);
    const g2Taken = allSlots.some(v => v === p.id + '|g2' && v !== curVal);
    const gTag = !g1Taken ? p.id + '|g1' : p.id + '|g2';
    const sel = curVal === p.id;
    const selGuest = curVal === p.id + '|g1' || curVal === p.id + '|g2';
    const guestAvail = canGuest && (!g1Taken || !g2Taken);
    const isBooked = mainTaken && !sel;
    const balClass = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';

    return `<div class="slot-pick-row">
      <button type="button" class="slot-player-btn ${sel ? 'is-current' : ''} ${isBooked ? 'is-booked' : ''}"
        ${isBooked ? 'disabled' : `onclick="assignSlot('${p.id}')"`}>
        <div class="av" style="width:34px;height:34px;font-size:var(--text-sm);flex-shrink:0">
          <i data-lucide="${playerIcon(p)}" style="width:16px;height:16px"></i>
        </div>
        <div class="slot-player-info">
          <div class="slot-player-name">${esc(p.name)}</div>
          <div class="slot-player-meta">
            <span class="slot-player-bal ${balClass}">${fmtE(b)}</span>
            ${isBooked ? `<span class="slot-player-tag"><i data-lucide="check" style="width:10px;height:10px"></i> ${t('slot.booked')}</span>` : ''}
            ${sel ? `<span class="slot-player-tag is-assigned"><i data-lucide="check-circle-2" style="width:10px;height:10px"></i> ${t('slot.assigned_here')}</span>` : ''}
          </div>
        </div>
      </button>
      <button type="button" class="slot-guest-btn ${selGuest ? 'is-current' : ''} ${!guestAvail ? 'disabled' : ''}"
        ${guestAvail ? `onclick="assignSlot('${gTag}')"` : 'disabled'}
        title="${guestAvail ? t('slot.book_guest') : t('slot.guest_max')}">
        <i data-lucide="user-plus" style="width:14px;height:14px"></i>
        <span>${t('slot.guest')}</span>
      </button>
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
// ════════════════════════════════════════
// BILLING (ABRECHNUNG)
// ════════════════════════════════════════
let billingTab = 'open';
let billingDeselected = new Set();
let billingChargedLimit = 20;
let isCharging = false;
let billingModal = { ids: [], paid: {}, step: 1 };

function getSessionCost(sess) {
  const v = (sess.price !== null && sess.price !== undefined) ? parseFloat(sess.price) : parseFloat(S.cfg.cost);
  return isNaN(v) ? 0 : v;
}

function sessionChargeMap(sess) {
  return getChargeMap({ courts: sess.courts || [], disabledCourts: sess.disabledCourts || [] });
}

function sessionEndDate(s) {
  const { start, end } = getSessionTime(s);
  const toMin = x => { const [h, m] = (x || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const d = new Date(s.date + 'T00:00:00');
  let endMin = end ? toMin(end) : 23 * 60 + 59;
  if (start && end && endMin <= toMin(start)) endMin += 24 * 60; // overnight session
  d.setMinutes(endMin);
  return d;
}

function getOpenBillingSessions() {
  const now = new Date();
  return (S.sessions || [])
    .filter(s => !s.charged && !s.cancelled && !s.billingDeferred && sessionEndDate(s) < now && Object.keys(sessionChargeMap(s)).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timeStart || '').localeCompare(b.timeStart || ''));
}

function getDeferredBillingSessions() {
  const now = new Date();
  return (S.sessions || [])
    .filter(s => !s.charged && !s.cancelled && s.billingDeferred && sessionEndDate(s) < now && Object.keys(sessionChargeMap(s)).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timeStart || '').localeCompare(b.timeStart || ''));
}

function getChargedSessions() {
  return (S.sessions || [])
    .filter(s => s.charged)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.timeStart || '').localeCompare(a.timeStart || ''));
}

function billingSessionTotals(sess) {
  const counts = sessionChargeMap(sess);
  const slots = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, slots, players: Object.keys(counts).length, sum: slots * getSessionCost(sess) };
}

function updateBillingBadge() {
  const n = isAdmin ? getOpenBillingSessions().length : 0;
  ['nav-billing-count', 'bnav-billing-count'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n;
    el.hidden = n === 0;
  });
  return n;
}

function setBillingTab(tab) {
  billingTab = tab;
  renderBilling();
}

async function deferBillingSession(sessionId, deferred) {
  try {
    await apiFetch('PUT', '/sessions/' + sessionId, { billingDeferred: deferred });
    await loadState();
    renderBilling();
    renderAdminPlan();
    renderSessions();
    lucide.createIcons();
    showToast(deferred ? t('billing.toast_deferred') : t('billing.toast_undeferred'));
  } catch(e) {
    showToast(t('billing.error'));
  }
}

function billingSessionHeader(s) {
  const { start, end } = getSessionTime(s);
  const time = start && end ? ` · ${fmtTime(start)}–${fmtTime(end)}` : '';
  return `${esc(fmtDL(s.date))}${time}`;
}

function renderBilling() {
  const open = updateBillingBadge();
  const root = document.getElementById('billing-content');
  if (!root) return;
  const openList = getOpenBillingSessions();
  const deferredList = getDeferredBillingSessions();
  const chargedList = getChargedSessions();
  const tabOpen = document.getElementById('billing-tab-open');
  const tabDef = document.getElementById('billing-tab-deferred');
  const tabCh = document.getElementById('billing-tab-charged');
  if (tabOpen) {
    tabOpen.textContent = `${t('billing.tab_open')} (${openList.length})`;
    tabOpen.classList.toggle('active', billingTab === 'open');
    tabOpen.setAttribute('aria-selected', billingTab === 'open');
  }
  if (tabDef) {
    tabDef.textContent = `${t('billing.tab_deferred')} (${deferredList.length})`;
    tabDef.classList.toggle('active', billingTab === 'deferred');
    tabDef.setAttribute('aria-selected', billingTab === 'deferred');
  }
  if (tabCh) {
    tabCh.textContent = t('billing.tab_charged');
    tabCh.classList.toggle('active', billingTab === 'charged');
    tabCh.setAttribute('aria-selected', billingTab === 'charged');
  }

  const intro = document.getElementById('billing-intro');
  if (intro) {
    intro.innerHTML = localStorage.getItem('courtle_billing_intro_seen') ? '' : `
      <div class="card mb4">
        <h3 class="sec-title" style="margin-bottom:var(--sp2)">${t('billing.intro_title')}</h3>
        <p class="txsm txm mb4">${t('billing.intro_text')}</p>
        <button class="btn btn-sec btn-sm" onclick="dismissBillingIntro()">${t('billing.intro_dismiss')}</button>
      </div>`;
  }

  const footer = document.getElementById('billing-footer');
  if (billingTab === 'open') {
    if (!openList.length) {
      root.innerHTML = `<div class="empty"><i data-lucide="party-popper"></i><h3>${t('billing.empty_title')}</h3><p class="txsm">${t('billing.empty_text')}</p></div>`;
      footer.hidden = true;
    } else {
      const selected = openList.filter(s => !billingDeselected.has(s.id));
      const allSel = selected.length === openList.length;
      root.innerHTML = `<div class="billing-list">
        <label class="flex items-c g2 txsm fw6" style="cursor:pointer"><input type="checkbox" style="width:20px;height:20px" ${allSel ? 'checked' : ''} onchange="toggleBillingAll(this.checked)"> ${t('billing.select_all')}</label>
        ${openList.map(s => {
          const tot = billingSessionTotals(s);
          const sel = !billingDeselected.has(s.id);
          return `<div class="billing-item ${sel ? 'sel' : ''}">
            <input type="checkbox" ${sel ? 'checked' : ''} onchange="toggleBillingItem('${s.id}', this.checked)" aria-label="${esc(getSessionName(s))}">
            <div class="bi-main">
              <div class="bi-title">${esc(getSessionName(s))}</div>
              <div class="bi-meta">${billingSessionHeader(s)}</div>
              <div class="bi-meta">${t('billing.session_meta').replace('{slots}', tot.slots).replace('{players}', tot.players)}</div>
              <div class="bi-actions">
                <button class="btn btn-sec btn-sm" onclick="openBillingModal(['${s.id}'])">${t('billing.review')}</button>
                <button class="btn btn-sec btn-sm" onclick="deferBillingSession('${s.id}', true)"><i data-lucide="clock"></i> ${t('billing.defer')}</button>
                <button class="btn-nav" onclick="openBillingInPlanner('${s.id}')"><i data-lucide="arrow-up-right"></i> ${t('billing.open_in_planner')}</button>
              </div>
            </div>
            <div class="bi-sum">${fmtE(tot.sum)}</div>
          </div>`;
        }).join('')}
      </div>`;
      const sum = selected.reduce((a, s) => a + billingSessionTotals(s).sum, 0);
      document.getElementById('billing-footer-sum').textContent = t('billing.selected_summary').replace('{n}', selected.length).replace('{sum}', fmtE(sum));
      document.getElementById('billing-footer-btn').disabled = selected.length === 0;
      footer.hidden = false;
    }
  } else if (billingTab === 'deferred') {
    footer.hidden = true;
    if (!deferredList.length) {
      root.innerHTML = `<div class="empty"><i data-lucide="clock"></i><h3>${t('billing.deferred_empty_title')}</h3><p class="txsm">${t('billing.deferred_empty_text')}</p></div>`;
    } else {
      root.innerHTML = `<div class="billing-list">
        ${deferredList.map(s => {
          const tot = billingSessionTotals(s);
          return `<div class="billing-item">
            <div class="bi-main">
              <div class="bi-title">${esc(getSessionName(s))} <span class="badge bg-neu">${t('billing.badge_deferred')}</span></div>
              <div class="bi-meta">${billingSessionHeader(s)}</div>
              <div class="bi-meta">${t('billing.session_meta').replace('{slots}', tot.slots).replace('{players}', tot.players)}</div>
              <div class="bi-actions">
                <button class="btn btn-pri btn-sm" onclick="openBillingModal(['${s.id}'])">${t('billing.review')}</button>
                <button class="btn btn-sec btn-sm" onclick="deferBillingSession('${s.id}', false)"><i data-lucide="rotate-ccw"></i> ${t('billing.undefer')}</button>
                <button class="btn-nav" onclick="openBillingInPlanner('${s.id}')"><i data-lucide="arrow-up-right"></i> ${t('billing.open_in_planner')}</button>
              </div>
            </div>
            <div class="bi-sum">${fmtE(tot.sum)}</div>
          </div>`;
        }).join('')}
      </div>`;
    }
  } else {
    footer.hidden = true;
    if (!chargedList.length) {
      root.innerHTML = `<div class="empty"><i data-lucide="receipt"></i><p class="txsm">${t('billing.charged_empty')}</p></div>`;
    } else {
      const shown = chargedList.slice(0, billingChargedLimit);
      root.innerHTML = `<div class="billing-list">${shown.map(s => {
        const txs = (S.transactions || []).filter(x => x.sessionId === s.id);
        const legacy = txs.length === 0;
        const sum = legacy ? billingSessionTotals(s).sum : txs.filter(x => !x.credit).reduce((a, x) => a + x.amount, 0);
        return `<div class="billing-item">
          <div class="bi-main">
            <div class="bi-title">${esc(getSessionName(s))} <span class="badge bg-neu">${t('session.charged')}</span></div>
            <div class="bi-meta">${billingSessionHeader(s)}</div>
            <div class="bi-actions">
              <button class="btn btn-dan btn-sm" ${legacy ? `disabled title="${esc(t('billing.legacy_no_revert'))}"` : ''} onclick="revertBilling('${s.id}')"><i data-lucide="undo-2"></i> ${t('billing.revert')}</button>
            </div>
            ${legacy ? `<div class="bi-meta" style="margin-top:var(--sp1)">${t('billing.legacy_no_revert')}</div>` : ''}
          </div>
          <div class="bi-sum">${fmtE(sum)}</div>
        </div>`;
      }).join('')}
      ${chargedList.length > shown.length ? `<button class="btn btn-sec btn-sm" onclick="billingChargedLimit+=20;renderBilling()">…</button>` : ''}
      </div>`;
    }
  }
  lucide.createIcons();
}

function dismissBillingIntro() {
  localStorage.setItem('courtle_billing_intro_seen', '1');
  renderBilling();
}

function toggleBillingItem(id, checked) {
  if (checked) billingDeselected.delete(id); else billingDeselected.add(id);
  renderBilling();
}
function toggleBillingAll(checked) {
  const ids = getOpenBillingSessions().map(s => s.id);
  billingDeselected = checked ? new Set() : new Set(ids);
  renderBilling();
}
function openBillingInPlanner(id) {
  planDate = id;
  showView('admin-plan');
  renderAdminPlan();
}
function openBillingModalForSelection() {
  const ids = getOpenBillingSessions().filter(s => !billingDeselected.has(s.id)).map(s => s.id);
  if (ids.length) openBillingModal(ids);
}

// Legacy entry point (planner): charge the currently selected session
function openChargeModal() {
  const sess = getOrSess(planDate);
  if (sess.charged) { showToast(t('misc.already_charged')); return; }
  openBillingModal([sess.id || planDate]);
}

function computeSessionSlotShares(totalPrice, counts, roundingMode, paidByPid) {
  const totalSlots = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalSlots <= 0) return {};

  const totalCents = Math.round(totalPrice * 100);
  const shares = {};

  if (roundingMode === 'exact') {
    const baseCents = Math.floor(totalCents / totalSlots);
    const remCents = totalCents % totalSlots;

    const slotOwners = [];
    if (paidByPid && counts[paidByPid]) {
      for (let i = 0; i < counts[paidByPid]; i++) slotOwners.push(paidByPid);
    }
    Object.entries(counts).forEach(([pid, n]) => {
      if (pid === paidByPid) return;
      for (let i = 0; i < n; i++) slotOwners.push(pid);
    });

    const assignedCents = {};
    for (let i = 0; i < slotOwners.length; i++) {
      const pid = slotOwners[i];
      const extra = i < remCents ? 1 : 0;
      assignedCents[pid] = (assignedCents[pid] || 0) + baseCents + extra;
    }
    Object.keys(counts).forEach(pid => {
      shares[pid] = (assignedCents[pid] || 0) / 100;
    });
  } else if (roundingMode === 'ceil') {
    const slotCents = Math.ceil(totalCents / totalSlots);
    Object.entries(counts).forEach(([pid, n]) => {
      shares[pid] = (slotCents * n) / 100;
    });
  } else { // 'round'
    const slotCents = Math.round(totalCents / totalSlots);
    Object.entries(counts).forEach(([pid, n]) => {
      shares[pid] = (slotCents * n) / 100;
    });
  }

  return shares;
}

function openBillingModal(ids) {
  const sessions = ids.map(id => (S.sessions || []).find(s => s.id === id)).filter(Boolean);
  if (!sessions.length) return;
  if (!sessions.some(s => Object.keys(sessionChargeMap(s)).length)) { showToast(t('session.billing_no_players')); return; }
  
  const totalPriceMap = {};
  const payerMap = {};
  sessions.forEach(s => {
    const tot = billingSessionTotals(s);
    totalPriceMap[s.id] = tot.sum;
    payerMap[s.id] = 'team_abo'; // default
  });

  billingModal = { ids: sessions.map(s => s.id), paid: {}, totalPrice: totalPriceMap, payer: payerMap, step: 1 };
  renderBillingModal();
  openMo('mo-billing');
}

function billingPlayerName(pid, n) {
  const p = S.players.find(x => x.id === pid);
  const guests = n > 1 ? ` <span style="opacity:.6;font-size:var(--text-xs)">(+${n - 1} ${t('misc.guest')})</span>` : '';
  return esc(p ? p.name : '?') + guests;
}

function onBillingPriceInput(sid, val) {
  const num = parseFloat(val);
  billingModal.totalPrice[sid] = !isNaN(num) && num >= 0 ? num : 0;
  updateBillingBlockLive(sid);
}

function onBillingPayerChange(sid, payerVal) {
  billingModal.payer[sid] = payerVal;
  updateBillingBlockLive(sid);
}

function getBillingPayerPlayerId(sid) {
  const p = billingModal.payer ? billingModal.payer[sid] : null;
  if (p && p.startsWith('player:')) return p.slice(7);
  return null;
}

function updateBillingBlockLive(sid) {
  const s = S.sessions.find(x => x.id === sid);
  if (!s) return;
  const tot = billingSessionTotals(s);
  const curTot = billingModal.totalPrice[sid] !== undefined ? billingModal.totalPrice[sid] : tot.sum;
  const rounding = S.cfg.billing_rounding || 'exact';
  const paidByPid = getBillingPayerPlayerId(sid);
  const shares = computeSessionSlotShares(curTot, tot.counts, rounding, paidByPid);

  const slotCost = tot.slots > 0 ? (curTot / tot.slots) : 0;
  const hintEl = document.getElementById(`billing-price-hint-${sid}`);
  if (hintEl) {
    hintEl.textContent = t('billing.per_slot_label', '÷ {slots} Slots = {cost} / Slot')
      .replace('{slots}', tot.slots)
      .replace('{cost}', fmtE(slotCost));
  }
  const sumEl = document.getElementById(`billing-summary-sum-${sid}`);
  if (sumEl) {
    sumEl.textContent = fmtE(curTot);
  }

  // Update rows in review list
  Object.entries(tot.counts).forEach(([pid, n]) => {
    const amtEl = document.getElementById(`billing-amt-${sid}-${pid}`);
    if (amtEl) amtEl.textContent = fmtE(shares[pid] || 0);
  });
}

function renderBillingModal() {
  const sessions = billingModal.ids.map(id => S.sessions.find(s => s.id === id)).filter(Boolean);
  const body = document.getElementById('mo-billing-body');
  const foot = document.getElementById('mo-billing-foot');
  document.getElementById('mo-billing-title').textContent = `${t('billing.title')} · ${billingModal.step}/2 ${billingModal.step === 1 ? t('billing.step_review') : t('billing.step_confirm')}`;

  const rounding = S.cfg.billing_rounding || 'exact';

  if (billingModal.step === 1) {
    body.innerHTML = sessions.map(s => {
      const tot = billingSessionTotals(s);
      const curTot = billingModal.totalPrice[s.id] !== undefined ? billingModal.totalPrice[s.id] : tot.sum;
      const payerVal = billingModal.payer[s.id] || 'team_abo';
      const paidByPid = getBillingPayerPlayerId(s.id);
      const shares = computeSessionSlotShares(curTot, tot.counts, rounding, paidByPid);
      const slotCost = tot.slots > 0 ? (curTot / tot.slots) : 0;

      // Build payer select
      const activePlayers = (S.players || []).filter(p => p.active !== false);
      const participantPids = Object.keys(tot.counts);
      const sortedPlayers = [...activePlayers].sort((a, b) => {
        const aPart = participantPids.includes(a.id);
        const bPart = participantPids.includes(b.id);
        if (aPart && !bPart) return -1;
        if (!aPart && bPart) return 1;
        return a.name.localeCompare(b.name);
      });

      const payerOpts = [
        `<option value="team_abo" ${payerVal === 'team_abo' ? 'selected' : ''}>${t('billing.paid_by_team_abo', 'Teamkasse · Abo (bereits erfasst)')}</option>`,
        `<option value="team_single" ${payerVal === 'team_single' ? 'selected' : ''}>${t('billing.paid_by_team_single', 'Teamkasse · Einzelbuchung (neu als Ausgabe)')}</option>`,
        `<optgroup label="${t('billing.paid_by_player_group', 'Auslage durch Spieler')}">`,
        ...sortedPlayers.map(p => `<option value="player:${p.id}" ${payerVal === 'player:' + p.id ? 'selected' : ''}>${esc(p.name)}</option>`),
        `</optgroup>`
      ].join('');

      const rows = Object.entries(tot.counts).map(([pid, n]) => {
        const isPaid = !!billingModal.paid[s.id + ':' + pid];
        const slotLabel = n > 1 ? `${n} Slots` : `1 Slot`;
        return `
          <div class="billing-p-row ${isPaid ? 'is-direct' : ''}" id="billing-p-row-${s.id}-${pid}">
            <div class="billing-p-info">
              <span class="billing-p-name">${billingPlayerName(pid, n)}</span>
              <span class="billing-p-slots-badge">${slotLabel}</span>
            </div>
            <div class="billing-p-right">
              <span class="billing-p-amt" id="billing-amt-${s.id}-${pid}">${fmtE(shares[pid] || 0)}</span>
              <label class="billing-direct-toggle" title="${esc(t('billing.direct_paid_hint'))}">
                <input type="checkbox" ${isPaid ? 'checked' : ''} onchange="billingModal.paid['${s.id}:${pid}']=this.checked;document.getElementById('billing-p-row-${s.id}-${pid}')?.classList.toggle('is-direct', this.checked)">
                <span>${t('billing.direct_paid')}</span>
              </label>
            </div>
          </div>
        `;
      }).join('');

      return `<details class="billing-block" ${sessions.length === 1 ? 'open' : ''}>
        <summary><span>${esc(getSessionName(s))} · ${billingSessionHeader(s)}</span><span id="billing-summary-sum-${s.id}">${fmtE(curTot)}</span></summary>
        
        <div class="billing-session-ctrls">
          <div class="billing-ctrl-group">
            <label class="fl billing-ctrl-label">
              <i data-lucide="tag"></i>
              <span>${t('billing.total_session_price', 'Session-Gesamtpreis')}</span>
            </label>
            <div class="billing-price-box">
              <div class="billing-price-input-wrap">
                <input type="number" class="fi billing-total-price-input" step="0.01" min="0" value="${curTot.toFixed(2)}" oninput="onBillingPriceInput('${s.id}', this.value)">
                <span class="billing-price-cur">€</span>
              </div>
              <div class="billing-slot-badge" id="billing-price-hint-${s.id}">
                ${t('billing.per_slot_label', '÷ {slots} Slots = {cost} / Slot').replace('{slots}', tot.slots).replace('{cost}', fmtE(slotCost))}
              </div>
            </div>
          </div>
          <div class="billing-ctrl-group">
            <label class="fl billing-ctrl-label">
              <i data-lucide="wallet"></i>
              <span>${t('billing.paid_by', 'Bezahlt von')}</span>
            </label>
            <div class="billing-select-wrap">
              <select class="fi billing-payer-select" onchange="onBillingPayerChange('${s.id}', this.value)">
                ${payerOpts}
              </select>
              <i data-lucide="chevron-down" class="billing-select-arrow"></i>
            </div>
          </div>
        </div>

        <div style="padding:var(--sp3) var(--sp4)">
          <div class="billing-review-list">${rows}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:var(--sp2);flex-wrap:wrap;gap:var(--sp2)">
            <button class="btn btn-sec btn-xs" onclick="billingMarkAllPaid('${s.id}')">${t('billing.all_direct_paid')}</button>
          </div>
        </div>
      </details>`;
    }).join('') + `<p class="txxs txm mt2">ⓘ ${t('billing.direct_paid_hint')}</p>`;
    foot.innerHTML = `<button class="btn btn-sec" onclick="closeMo('mo-billing')">${t('modal.cancel')}</button>
      <button class="btn btn-pri" onclick="billingModal.step=2;renderBillingModal()">${t('billing.next')}</button>`;
  } else {
    const per = {};
    let totalSlots = 0, totalDebit = 0, totalDirect = 0;
    sessions.forEach(s => {
      const tot = billingSessionTotals(s);
      const curTot = billingModal.totalPrice[s.id] !== undefined ? billingModal.totalPrice[s.id] : tot.sum;
      const paidByPid = getBillingPayerPlayerId(s.id);
      const shares = computeSessionSlotShares(curTot, tot.counts, rounding, paidByPid);

      Object.entries(tot.counts).forEach(([pid, n]) => {
        const amt = shares[pid] || 0;
        per[pid] = per[pid] || { debit: 0, direct: 0, outlay: 0 };
        per[pid].debit += amt;
        totalSlots += n;
        totalDebit += amt;
        if (billingModal.paid[s.id + ':' + pid]) {
          per[pid].direct += amt;
          totalDirect += amt;
        }
      });

      // If outlay by player
      if (paidByPid) {
        per[paidByPid] = per[paidByPid] || { debit: 0, direct: 0, outlay: 0 };
        per[paidByPid].outlay += curTot;
      }
    });

    const rows = Object.entries(per).map(([pid, v]) => {
      const now = bal(pid);
      const after = now - v.debit + v.direct + v.outlay;
      
      const metaParts = [`${t('billing.debit')}: –${fmtE(v.debit)}`];
      if (v.direct) metaParts.push(`${t('billing.direct')}: +${fmtE(v.direct)}`);
      if (v.outlay) metaParts.push(`<span class="badge bg-pri" style="font-size:10px">+${fmtE(v.outlay)} ${t('billing.outlay_badge', 'Auslage')}</span>`);

      return `
        <div class="billing-delta-row">
          <div class="billing-delta-top">
            <span class="billing-delta-name">${billingPlayerName(pid, 1)}</span>
            <div class="billing-delta-flow">
              <span class="txm">${fmtE(now)}</span>
              <span class="txm">→</span>
              <span class="billing-delta-after ${after < 0 ? 'neg' : ''}">${fmtE(after)}${after < 0 ? ` <span title="${esc(t('billing.negative_warning'))}">⚠</span>` : ''}</span>
            </div>
          </div>
          <div class="billing-delta-meta">
            ${metaParts.join(' · ')}
          </div>
        </div>
      `;
    }).join('');

    body.innerHTML = `<p class="txsm txm mb3">${t('billing.summary_text').replace('{n}', sessions.length).replace('{slots}', totalSlots).replace('{sum}', fmtE(totalDebit)).replace('{direct}', fmtE(totalDirect))}</p>
      <div class="billing-confirm-list">${rows}</div>`;
    foot.innerHTML = `<button class="btn btn-sec" onclick="billingModal.step=1;renderBillingModal()">${t('billing.back')}</button>
      <button class="btn btn-pri" onclick="doCharge()"><i data-lucide="credit-card"></i> ${t('billing.finish')}</button>`;
  }
  lucide.createIcons();
}

function billingMarkAllPaid(sid) {
  const s = S.sessions.find(x => x.id === sid);
  if (!s) return;
  const pids = Object.keys(sessionChargeMap(s));
  const all = pids.every(pid => billingModal.paid[sid + ':' + pid]);
  pids.forEach(pid => { billingModal.paid[sid + ':' + pid] = !all; });
  renderBillingModal();
  document.querySelectorAll('#mo-billing-body details').forEach(d => d.open = true);
}

async function doCharge() {
  if (isCharging) return;
  isCharging = true;
  try {
    const items = billingModal.ids.map(id => {
      const s = S.sessions.find(x => x.id === id);
      const pids = Object.keys(sessionChargeMap(s)).filter(pid => billingModal.paid[id + ':' + pid]);
      const curTot = billingModal.totalPrice && billingModal.totalPrice[id] !== undefined ? billingModal.totalPrice[id] : null;
      const payerVal = billingModal.payer ? billingModal.payer[id] : 'team_abo';
      const paidByPlayerId = payerVal && payerVal.startsWith('player:') ? payerVal.slice(7) : null;
      const recordTeamExpense = payerVal === 'team_single';

      return {
        id,
        paid_pids: pids,
        total_price: curTot,
        paid_by_player_id: paidByPlayerId,
        record_team_expense: recordTeamExpense
      };
    });
    await apiFetch('POST', '/charge', { items });
    await loadState();
    closeMo('mo-billing');
    items.forEach(i => billingDeselected.delete(i.id));
    renderAll();
    showToast(t('billing.toast_done').replace('{n}', items.length));
  } catch (e) {
    showToast('⚠️ ' + (e.message || t('billing.error')));
  }
  isCharging = false;
}

function revertBilling(id) {
  const s = (S.sessions || []).find(x => x.id === id);
  if (!s) return;
  const sum = (S.transactions || []).filter(x => x.sessionId === id && !x.credit).reduce((a, x) => a + x.amount, 0);
  const desc = t('billing.revert_confirm').replace('{session}', `${getSessionName(s)} ${fmtDL(s.date)}`).replace('{sum}', fmtE(sum));
  showConfirmModal(t('billing.revert_title'), desc, '<i data-lucide="undo-2"></i> ' + t('billing.revert'), 'btn-dan', async () => {
    try {
      await apiFetch('DELETE', '/charge/' + id);
      await loadState();
      renderAll();
      showToast(t('billing.toast_reverted'));
    } catch (e) {
      showToast('⚠️ ' + (e.message || t('billing.error')));
    }
  });
}

// ════════════════════════════════════════
// ADMIN – PLAYERS
// ════════════════════════════════════════
let playersTab = 'manage';
let playerBalanceFilter = 'all';
let playerManageFilter = 'active';
let expandedPlayerId = null;
let expandedBalancePlayerId = null;
let playerBalanceSearchQuery = '';
let playerBalanceSortOption = 'name_asc';

function setPlayersTab(tab) {
  if (tab === 'balance' || tab === 'list') {
    playersTab = 'balance';
  } else if (tab === 'activity') {
    playersTab = 'activity';
  } else {
    playersTab = 'manage';
  }
  const btnManage = document.getElementById('players-tab-manage');
  const btnBalance = document.getElementById('players-tab-balance');
  const btnActivity = document.getElementById('players-tab-activity');
  const pManage = document.getElementById('players-panel-manage');
  const pBalance = document.getElementById('players-panel-balance');
  const pActivity = document.getElementById('players-panel-activity');
  const headerAction = document.getElementById('players-header-action');

  if (btnManage) {
    btnManage.classList.toggle('active', playersTab === 'manage');
    btnManage.setAttribute('aria-selected', playersTab === 'manage' ? 'true' : 'false');
  }
  if (btnBalance) {
    btnBalance.classList.toggle('active', playersTab === 'balance');
    btnBalance.setAttribute('aria-selected', playersTab === 'balance' ? 'true' : 'false');
  }
  if (btnActivity) {
    btnActivity.classList.toggle('active', playersTab === 'activity');
    btnActivity.setAttribute('aria-selected', playersTab === 'activity' ? 'true' : 'false');
  }
  if (pManage) pManage.style.display = playersTab === 'manage' ? '' : 'none';
  if (pBalance) pBalance.style.display = playersTab === 'balance' ? '' : 'none';
  if (pActivity) pActivity.style.display = playersTab === 'activity' ? '' : 'none';

  if (headerAction) {
    if (playersTab === 'balance') {
      headerAction.innerHTML = `<button class="btn btn-ok btn-sm" onclick="openTx()" type="button"><i data-lucide="plus-circle"></i> <span>${t('nav.quick_topup')}</span></button>`;
    } else if (playersTab === 'activity') {
      headerAction.innerHTML = '';
    } else {
      headerAction.innerHTML = `<button class="btn btn-ok btn-sm" onclick="openAddPlayer()" type="button"><i data-lucide="user-plus"></i> <span>${t('players.add')}</span></button>`;
    }
  }

  if (playersTab === 'balance') {
    renderPlayerBalances();
  } else if (playersTab === 'activity') {
    renderPlayerActivityTable();
  } else {
    renderPlayers();
  }
  if (window.lucide) lucide.createIcons();
}

function openPlayersTab(tab) {
  setPlayersTab(tab);
  showView('players');
}

function setPlayerBalanceFilter(filter) {
  playerBalanceFilter = filter;
  renderPlayerBalances();
  if (window.lucide) lucide.createIcons();
}

function togglePlayerDrawer(pid) {
  expandedPlayerId = expandedPlayerId === pid ? null : pid;
  renderPlayers();
  renderPlayerBalances();
  if (window.lucide) lucide.createIcons();
}

function togglePlayerBalanceDrawer(pid) {
  expandedBalancePlayerId = expandedBalancePlayerId === pid ? null : pid;
  renderPlayerBalances();
  if (window.lucide) lucide.createIcons();
}

function openPlayerFullHistory(pid) {
  const sel = document.getElementById('hist-filter');
  showView('history');
  setFinDimension('players');
  if (sel) {
    sel.value = pid;
    renderHistory();
  }
}

window.handlePlayerSearch = function(val) {
  playerSearchQuery = val;
  renderPlayers();
  renderPlayerBalances();
  if (window.lucide) lucide.createIcons();
};

window.handlePlayerSort = function(val) {
  playerSortOption = val;
  renderPlayers();
  renderPlayerBalances();
  if (window.lucide) lucide.createIcons();
};

window.handlePlayerBalanceSearch = function(val) {
  playerBalanceSearchQuery = val;
  renderPlayerBalances();
  if (window.lucide) lucide.createIcons();
};

window.handlePlayerBalanceSort = function(val) {
  playerBalanceSortOption = val;
  renderPlayerBalances();
  if (window.lucide) lucide.createIcons();
};

// TAB 1: VERWALTUNG & AKTIVITÄT
function renderPlayers() {
  const g = document.getElementById('players-grid');
  if (!g) return;

  const searchInput = document.getElementById('player-search');
  if (searchInput) searchInput.value = playerSearchQuery;
  const sortSelect = document.getElementById('player-sort');
  if (sortSelect) sortSelect.value = playerSortOption;

  const allActive = (S.players || []).filter(p => p.active !== false);
  let activePlayers = [...allActive];
  const inactivePlayers = (S.players || []).filter(p => p.active === false);

  if (!activePlayers.length && !inactivePlayers.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><i data-lucide="users"></i><h3>${t('players.no_players')}</h3><p>${t('players.add_first')}</p><button class="btn btn-pri" onclick="openAddPlayer()"><i data-lucide="user-plus"></i> ${t('players.add')}</button></div>`;
    if (window.lucide) lucide.createIcons();
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
    switch (playerSortOption) {
      case 'name_desc':
        return b.name.localeCompare(a.name);
      case 'name_asc':
        return a.name.localeCompare(b.name);
      case 'interaction_asc':
        return (a.lastInteraction || '').localeCompare(b.lastInteraction || '');
      case 'login_desc':
        return (b.lastLogin || '').localeCompare(a.lastLogin || '');
      case 'login_asc':
        return (a.lastLogin || '').localeCompare(b.lastLogin || '');
      case 'participation_desc': {
        const pA = getLastParticipationDate(a.id) || '';
        const pB = getLastParticipationDate(b.id) || '';
        return pB.localeCompare(pA);
      }
      case 'participation_asc': {
        const pA = getLastParticipationDate(a.id) || '';
        const pB = getLastParticipationDate(b.id) || '';
        return pA.localeCompare(pB);
      }
      case 'interaction_desc':
      default:
        return (b.lastInteraction || '').localeCompare(a.lastInteraction || '');
    }
  });

  let html = activePlayers.map(p => {
    const adminBadge = p.admin ? ` <span class="badge bg-pri" style="font-size:10px;padding:1px 6px">${t('misc.admin')}</span>` : '';

    return `<div class="pc pc-clickable" onclick="openEditPlayer('${p.id}')">
      <div class="pc-row">
        <div class="av pc-av" title="${esc(t('players.edit'))}">
          <i data-lucide="${playerIcon(p)}" style="width:18px;height:18px"></i>
        </div>
        <div class="pc-info">
          <div class="pc-name">${esc(p.name)}${adminBadge}</div>
          ${p.contact ? `<div class="pc-meta">${esc(p.contact)}</div>` : ''}
        </div>
        <div class="pc-right" onclick="event.stopPropagation()">
          <button class="btn btn-icon-sm btn-dan" onclick="deletePlayer('${p.id}')" type="button" title="${esc(t('players.deactivate'))}" aria-label="${esc(t('players.deactivate'))}"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');

  if (inactivePlayers.length) {
    html += `<hr style="margin:var(--sp5) 0;border:none;border-top:1px solid var(--b3);grid-column:1/-1"><div class="flex items-c just-b" style="margin-bottom:var(--sp3);grid-column:1/-1"><h3 style="margin:0;font-size:var(--text-sm);opacity:.6">${t('players.deleted')}</h3><span style="font-size:var(--text-xs);opacity:.4">${inactivePlayers.length} ${t('players.deleted_count')}</span></div>`;
    html += inactivePlayers.map(p => {
      const b = bal(p.id); const cls = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';
      return `<div class="pc" style="opacity:.5;grid-column:1/-1">
        <div class="pc-row">
          <div class="av pc-av" style="opacity:.5"><i data-lucide="${playerIcon(p)}" style="width:18px;height:18px"></i></div>
          <div class="pc-info"><div class="pc-name">${esc(p.name)}</div><div class="pc-meta">${t('players.balance')}: <span class="${cls}">${fmtE(b)}</span></div></div>
          <div class="pc-right">
            <button class="btn btn-xs btn-ok" onclick="reactivatePlayer('${p.id}')" type="button"><i data-lucide="rotate-ccw"></i> ${t('players.reactivate')}</button>
            <button class="btn btn-xs btn-dan" onclick="purgePlayer('${p.id}')" type="button"><i data-lucide="trash-2"></i> ${t('players.purge')}</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  g.innerHTML = html;
}

// TAB 2: GUTHABEN & TRANSAKTIONEN
function renderPlayerBalances() {
  const g = document.getElementById('players-balance-grid');
  if (!g) return;

  const searchInput = document.getElementById('player-balance-search');
  if (searchInput) searchInput.value = playerBalanceSearchQuery;
  const sortSelect = document.getElementById('player-balance-sort');
  if (sortSelect) sortSelect.value = playerBalanceSortOption;

  const allActive = (S.players || []).filter(p => p.active !== false);
  let activePlayers = [...allActive];

  const pillsEl = document.getElementById('player-filter-pills');
  if (pillsEl) {
    const negCount = allActive.filter(p => bal(p.id) < 0).length;
    const posCount = allActive.filter(p => bal(p.id) > 0).length;
    pillsEl.innerHTML = `
      <button type="button" class="pf-pill ${playerBalanceFilter === 'all' ? 'active' : ''}" onclick="setPlayerBalanceFilter('all')">${t('players.filter_all')} <span>${allActive.length}</span></button>
      <button type="button" class="pf-pill pf-neg ${playerBalanceFilter === 'neg' ? 'active' : ''}" onclick="setPlayerBalanceFilter('neg')">${t('players.filter_neg')} <span>${negCount}</span></button>
      <button type="button" class="pf-pill pf-pos ${playerBalanceFilter === 'pos' ? 'active' : ''}" onclick="setPlayerBalanceFilter('pos')">${t('players.filter_pos')} <span>${posCount}</span></button>
    `;
  }

  if (!activePlayers.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><i data-lucide="users"></i><h3>${t('players.no_players')}</h3><p>${t('players.add_first')}</p><button class="btn btn-pri" onclick="openAddPlayer()"><i data-lucide="user-plus"></i> ${t('players.add')}</button></div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (playerBalanceFilter === 'neg') {
    activePlayers = activePlayers.filter(p => bal(p.id) < 0);
  } else if (playerBalanceFilter === 'pos') {
    activePlayers = activePlayers.filter(p => bal(p.id) > 0);
  }

  if (playerBalanceSearchQuery) {
    const query = playerBalanceSearchQuery.toLowerCase().trim();
    activePlayers = activePlayers.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.contact && p.contact.toLowerCase().includes(query))
    );
  }

  activePlayers.sort((a, b) => {
    let valA, valB;
    if (playerBalanceSortOption.startsWith('name')) {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
      const asc = playerBalanceSortOption === 'name_asc';
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else if (playerBalanceSortOption.startsWith('balance')) {
      valA = bal(a.id);
      valB = bal(b.id);
      const asc = playerBalanceSortOption === 'balance_asc';
      return asc ? valA - valB : valB - valA;
    }
    return 0;
  });

  let html = activePlayers.map(p => {
    const b = bal(p.id); 
    const cls = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';
    const isExpanded = expandedBalancePlayerId === p.id;
    const adminBadge = p.admin ? ` <span class="badge bg-pri" style="font-size:10px;padding:1px 6px">${t('misc.admin')}</span>` : '';
    const lastPart = getLastParticipationDate(p.id);
    const metaStr = lastPart ? esc(t('players.last_played').replace('{date}', fmtD(lastPart))) : '';

    let drawerHtml = '';
    if (isExpanded) {
      const playerTxs = [...(S.transactions || [])]
        .filter(tx => tx.playerId === p.id)
        .sort((a, bTx) => (bTx.createdAt || bTx.date || '').localeCompare(a.createdAt || a.date || ''))
        .slice(0, 5);

      const txRows = playerTxs.length
        ? playerTxs.map(tx => {
            const noteText = typeof formatTxNotePlain === 'function'
              ? formatTxNotePlain(tx)
              : (tx.note || (tx.credit ? t('transactions.credit_type') : t('transactions.debit_type')));
            return `<div class="pc-tx-row">
              <span class="pc-tx-date">${fmtD(tx.date)}</span>
              <span class="pc-tx-note">${esc(noteText || (tx.credit ? t('transactions.credit_type') : t('transactions.debit_type')))}</span>
              <span class="pc-tx-amt ${tx.credit ? 'cr' : 'db'}">${tx.credit ? '+' : '–'} ${fmtE(tx.amount)}</span>
              <button class="btn btn-xs btn-sec" onclick="event.stopPropagation();openEditTx('${tx.id}')" type="button" title="${esc(t('transactions.edit'))}"><i data-lucide="pencil" style="width:11px;height:11px"></i></button>
            </div>`;
          }).join('')
        : `<div class="txxs txm">${t('transactions.no_transactions')}</div>`;

      drawerHtml = `<div class="pc-drawer" onclick="event.stopPropagation()">
        <div class="pc-drawer-history">
          <div class="pc-drawer-hist-head">
            <span class="label" style="font-size:10px">${t('players.recent_tx')}</span>
            ${playerTxs.length ? `<button class="pc-hist-link" onclick="openPlayerFullHistory('${p.id}')" type="button">${t('players.view_all_tx')} →</button>` : ''}
          </div>
          <div class="pc-tx-list">${txRows}</div>
        </div>
      </div>`;
    }

    return `<div class="pc ${isExpanded ? 'expanded' : ''}">
      <div class="pc-row" onclick="togglePlayerBalanceDrawer('${p.id}')">
        <div class="av pc-av">
          <i data-lucide="${playerIcon(p)}" style="width:18px;height:18px"></i>
        </div>
        <div class="pc-info">
          <div class="pc-name">${esc(p.name)}${adminBadge}</div>
          ${metaStr ? `<div class="pc-meta">${metaStr}</div>` : ''}
        </div>
        <div class="pc-right">
          <div class="pc-bal ${cls}">${fmtE(b)}</div>
          <button class="btn btn-sm btn-sec pc-topup-btn" onclick="event.stopPropagation();openTx('${p.id}')" title="${esc(t('players.charge'))}" type="button">
            <i data-lucide="plus" style="width:15px;height:15px"></i>
          </button>
          <span class="pc-chev ${isExpanded ? 'open' : ''}"><i data-lucide="chevron-down" style="width:16px;height:16px"></i></span>
        </div>
      </div>
      ${drawerHtml}
    </div>`;
  }).join('');

  g.innerHTML = html;
}

function updateEditPlayerAvatarPreview(emojiName) {
  editPlayerEmoji = emojiName || null;
  const iconEl = document.getElementById('p-avatar-preview-icon');
  if (iconEl) {
    iconEl.setAttribute('data-lucide', emojiName || 'user');
    if (window.lucide) lucide.createIcons();
  }
}

function openEditPlayer(id) {
  const p = S.players.find(x => x.id === id); if (!p) return;
  editPid = id;
  document.getElementById('mo-player-title').textContent = t('players.edit');
  document.getElementById('save-p-btn').textContent = t('misc.save');
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-contact').value = p.contact || '';
  document.getElementById('p-pin').value = '';
  document.getElementById('p-pin-hint').textContent = t('players.pin_edit_hint');

  updateEditPlayerAvatarPreview(p.emoji || 'user');

  const adminWrap = document.getElementById('p-admin-wrap');
  if (adminWrap) {
    adminWrap.style.display = isAdmin ? 'block' : 'none';
    document.getElementById('p-admin').checked = !!p.admin;
  }

  openMo('mo-player');
}

function openAddPlayer() {
  editPid = null;
  document.getElementById('mo-player-title').textContent = t('players.add_title');
  document.getElementById('save-p-btn').textContent = t('players.save_add');
  document.getElementById('p-name').value = '';
  document.getElementById('p-contact').value = '';
  document.getElementById('p-pin').value = '';
  document.getElementById('p-pin-hint').textContent = t('players.pin_add_hint');

  updateEditPlayerAvatarPreview('user');

  const adminWrap = document.getElementById('p-admin-wrap');
  if (adminWrap) {
    adminWrap.style.display = isAdmin ? 'block' : 'none';
    document.getElementById('p-admin').checked = false;
  }

  openMo('mo-player');
  setTimeout(() => { const el = document.getElementById('p-name'); if (el) el.focus(); }, 100);
}

function openIconPickerForEditPlayer() {
  const current = editPlayerEmoji || (editPid ? (S.players.find(x => x.id === editPid)?.emoji || '') : '');
  const sub = document.getElementById('emoji-subtitle');
  if (sub) sub.textContent = t('icon.subtitle');
  const grid = document.getElementById('emoji-grid');
  if (grid) {
    grid.innerHTML = ICONS.map(name => `<button type="button" class="${name === current ? 'sel' : ''}" onclick="selectIconForEditPlayer('${name}')"><i data-lucide="${name}" style="width:20px;height:20px"></i></button>`).join('');
  }
  openMo('mo-emoji');
  if (window.lucide) lucide.createIcons();
}

function selectIconForEditPlayer(name) {
  updateEditPlayerAvatarPreview(name);
  closeMo('mo-emoji');
}

async function savePlayer() {
  const name = document.getElementById('p-name').value.trim();
  const contact = document.getElementById('p-contact').value.trim();
  const pin = document.getElementById('p-pin').value.trim();
  
  const adminCb = document.getElementById('p-admin');
  const makeAdmin = adminCb ? adminCb.checked : false;

  if (!name) { showToast(t('toast.name_required', 'Bitte Namen eingeben.')); return; }
  if (pin && (!/^\d{4}$/.test(pin))) {
    showToast(t('toast.pin_must_4'));
    return;
  }

  const payload = {
    name,
    contact,
    admin: makeAdmin,
    emoji: editPlayerEmoji || null
  };
  if (pin) {
    payload.pin = pin;
  }

  try {
    if (editPid) {
      await apiFetch('PUT', '/players/' + editPid, payload);
      showToast(t('toast.player_updated'));
    } else {
      await apiFetch('POST', '/players', payload);
      showToast(t('toast.player_added'));
    }
    await loadState();
    closeMo('mo-player');
    renderAll();
  } catch(e) {
    showToast(e.message || t('toast.error'));
  }
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
// ADMIN – TRANSACTIONS & PLAYER PICKER
// ════════════════════════════════════════
let isSwitchingTxPlayer = false;

function openPlayerPickerForTx(isSwitch = false) {
  isSwitchingTxPlayer = isSwitch;
  if (isSwitch) {
    closeMo('mo-tx');
  }
  const searchInput = document.getElementById('tx-picker-search');
  if (searchInput) searchInput.value = '';
  renderTxPlayerPicker();
  openMo('mo-pick-player');
  setTimeout(() => searchInput && searchInput.focus(), 100);
}

function renderTxPlayerPicker(filterText = '') {
  const grid = document.getElementById('tx-picker-grid');
  if (!grid) return;
  const q = (filterText || '').toLowerCase().trim();
  const activePlayers = (S.players || [])
    .filter(p => p.active !== false)
    .filter(p => !q || (p.name || '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!activePlayers.length) {
    grid.innerHTML = `<div class="txsm txm" style="grid-column:1/-1;text-align:center;padding:var(--sp4)">${t('history.no_transactions')}</div>`;
    return;
  }

  grid.innerHTML = activePlayers.map(p => {
    const b = bal(p.id);
    const cls = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';
    const isCurrent = p.id === txPid;
    return `<button type="button" class="player-pick-btn ${isCurrent ? 'active' : ''}" onclick="selectTxPlayer('${p.id}')">
      <div class="av" style="width:34px;height:34px;font-size:var(--text-sm);flex-shrink:0">
        <i data-lucide="${playerIcon(p)}" style="width:18px;height:18px"></i>
      </div>
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
        <div style="font-size:11px;color:var(--txm);margin-top:1px">
          ${t('players.balance')}: <span class="${cls}" style="font-weight:700">${fmtE(b)}</span>
        </div>
      </div>
    </button>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function filterTxPlayerPicker(val) {
  renderTxPlayerPicker(val);
}

function selectTxPlayer(pid) {
  closeMo('mo-pick-player');
  openTx(pid);
}

function openTx(pid) {
  const activePlayers = (S.players || []).filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  if (!activePlayers.length) return;

  // Wenn keine pid angegeben: erst den modernen Name-Picker öffnen!
  if (!pid) {
    openPlayerPickerForTx(false);
    return;
  }

  const targetPid = activePlayers.some(p => p.id === pid) ? pid : activePlayers[0].id;
  txPid = targetPid;

  const sel = document.getElementById('tx-player-select');
  if (sel) {
    sel.innerHTML = activePlayers.map(p => `<option value="${p.id}">${esc(p.name)} (${fmtE(bal(p.id))})</option>`).join('');
    sel.value = targetPid;
  }
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value = '';
  syncTxModalForPlayer(targetPid);
  openMo('mo-tx');
  setTimeout(() => document.getElementById('tx-amount').focus(), 100);
}

function onTxPlayerChange(pid) {
  txPid = pid;
  syncTxModalForPlayer(pid);
}

function syncTxModalForPlayer(pid) {
  const p = S.players.find(x => x.id === pid);
  if (!p) return;
  const b = bal(pid);
  const cls = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';

  document.getElementById('mo-tx-title').textContent = `${p.name} – ${t('transactions.title')}`;
  const subEl = document.getElementById('mo-tx-sub');
  if (subEl) subEl.textContent = `${t('transactions.current_balance')}: ${fmtE(b)}`;

  // Modern Selected Player Card aktualisieren
  const avEl = document.getElementById('tx-sel-player-av');
  if (avEl) avEl.innerHTML = `<i data-lucide="${playerIcon(p)}" style="width:18px;height:18px"></i>`;
  const nameEl = document.getElementById('tx-sel-player-name');
  if (nameEl) nameEl.textContent = p.name;
  const balEl = document.getElementById('tx-sel-player-bal');
  if (balEl) {
    balEl.innerHTML = `${t('transactions.current_balance')}: <span class="${cls}" style="font-weight:700">${fmtE(b)}</span>`;
  }
  const sel = document.getElementById('tx-player-select');
  if (sel) sel.value = pid;

  const amtBox = document.getElementById('tx-quick-amounts');
  if (amtBox) {
    const chips = [];
    if (b < 0) {
      const deficit = Math.abs(b);
      chips.push(`<button type="button" class="tx-chip tx-chip-settle" onclick="setTxAmount(${deficit})">${t('transactions.settle_deficit').replace('{amount}', '+' + fmtE(deficit))}</button>`);
    }
    [20, 30, 50, 100].forEach(v => {
      chips.push(`<button type="button" class="tx-chip" onclick="setTxAmount(${v})">+${v} ${S.cfg.currency || '€'}</button>`);
    });
    amtBox.innerHTML = chips.join('');
  }

  const noteBox = document.getElementById('tx-quick-notes');
  if (noteBox) {
    const notes = [
      t('transactions.quick_note_paypal'),
      t('transactions.quick_note_cash'),
      t('transactions.quick_note_bank'),
    ];
    noteBox.innerHTML = notes.map(n => `<button type="button" class="tx-chip" onclick="setTxNote('${esc(n)}')">${esc(n)}</button>`).join('');
  }
  if (window.lucide) lucide.createIcons();
}

function setTxAmount(val) {
  const el = document.getElementById('tx-amount');
  if (el) {
    el.value = Number(val.toFixed ? val.toFixed(2) : val);
    el.focus();
  }
}

function setTxNote(val) {
  const el = document.getElementById('tx-note');
  if (el) el.value = val;
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

  // Sessions where I (or my guests) are booked
  function mySessionEntry(sess) {
    if (!sess) return null;
    const mySlots = (sess.courts || []).flat().filter(v => v && baseId(v) === guestId);
    const onWl = (sess.waitlist || []).some(pid => baseId(pid) === guestId);
    if (!mySlots.length && !onWl) return null;
    return { id: sess.id || sess.date, date: sess.date, sess, mySlots, onWl };
  }

  const allKnownSessions = [...(S.sessions || [])].sort((a, b) => {
    const c = a.date.localeCompare(b.date);
    if (c !== 0) return c;
    return (a.timeStart || '').localeCompare(b.timeStart || '');
  });

  const upcoming = allKnownSessions.filter(s => s.date >= today).map(mySessionEntry).filter(Boolean);
  const past     = allKnownSessions.filter(s => s.date < today).map(mySessionEntry).filter(Boolean).filter(e => e.mySlots.length > 0).reverse();

  // Transactions
  const txs = [...S.transactions].filter(t => t.playerId === guestId).sort((a,b) => b.createdAt.localeCompare(a.createdAt));

function sessionCard(entry) {
  const { date, sess, mySlots, onWl } = entry;
  const sessId = sess.id || date;
  const isPast = date < today;
  const guestCount = mySlots.filter(v => v.includes('|')).length;
  const selfIn = mySlots.some(v => !v.includes('|'));

  let statusBadge = '';
  if (sess.cancelled) {
    statusBadge = `<span class="badge bg-err">${t('session.cancelled_badge')}</span>`;
  } else if (sess.charged) {
    statusBadge = `<span class="badge bg-neu"><i data-lucide="check" style="width:11px;height:11px"></i> ${t('session.charged')}</span>`;
  } else if (isPast) {
    statusBadge = `<span class="badge bg-war"><i data-lucide="clock" style="width:11px;height:11px"></i> ${t('planner.status_awaiting')}</span>`;
  }

  const { start, end } = getSessionTime(sess);
  const eventName = getSessionName(sess);

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
    const deadline = getCancelDeadline(sess);
    const within = isWithinCancelWindow(sess);
    const deadlineStr = fmtDateTime(deadline);
    detailsHtml.push(`<div class="bk-deadline${within ? '' : ' warning'}"><i data-lucide="clock" style="width:12px;height:12px;flex-shrink:0"></i>${t('session.cancel_deadline_text').replace('{deadline}', deadlineStr)}</div>`);
  }

  const wlOnly = onWl && !selfIn;
  return `<div class="bk${sess.charged ? ' charged' : ''}">
    <div class="bk-head-ticket">
      <div class="bk-cal-col">
        <div class="bk-cal-ticket">
          <div class="bk-wkdy${wlOnly ? ' bk-wl' : ''}">${esc(weekday)}</div>
          <div class="bk-day">${esc(dayNum)}</div>
          <div class="bk-month">${esc(monthStr)}</div>
        </div>
        ${wlOnly ? `<div class="bk-price-bubble wl">${t('session.waitlist_short')}</div>` : `<div class="bk-price-bubble${sess.charged ? ' charged' : ''}">${fmtE(totalPrice)}</div>`}
      </div>
      <div class="bk-content-col">
        <div class="bk-content-top">
          <div class="bk-title">${esc(eventName)}</div>
          <div class="bk-time">${start}–${end}</div>
        </div>
        <div class="bk-head-actions">
          ${statusBadge}
          ${guestCount ? `<span class="badge bg-sec">${guestCount} ${t('misc.guest')}${guestCount > 1 ? (getLocale() === 'de' ? 'e' : '') : ''}</span>` : ''}
          ${!isPast ? `<button class="btn btn-sec btn-sm" onclick="downloadSessionCalendar('${sessId}')"><i data-lucide="calendar-plus"></i> ${t('session.add_to_calendar')}</button>` : ''}
          ${!sess.charged && isWithinCancelWindow(sess) ? `<button class="btn btn-dan btn-sm" onclick="openLeaveConfirm('${sessId}')"><i data-lucide="log-out"></i> ${t('session.leave')}</button>` : ''}
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
  lucide.createIcons();
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
  if (!tx || !tx.note || tx.note === 'transactions.deposit') return '';
  const note = tx.note.trim();
  const mPay = note.match(/^(?:Direct payment|Direktzahlung|Pago directo|Pagamento diretto|Paiement direct|Pagamento direto)\s+(\d{4}-\d{2}-\d{2})(?:\s*\([^)]+\))?$/i);
  if (mPay) {
    const date = mPay[1];
    return t('transactions.direct_payment_for_session').replace('{session}', fmtD(date));
  }
  const mSess = note.match(/^(?:Session|Spieltag|Sesión|Sessione|Sessão)\s+(\d{4}-\d{2}-\d{2})(?:\s*\([^)]+\))*$/i);
  if (mSess) {
    const date = mSess[1];
    const guestMatch = note.match(/\(\+(\d+)\s+[a-zA-ZäöüßÄÖÜ]+\)/);
    const guests = guestMatch ? parseInt(guestMatch[1], 10) : 0;
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
  if (!tx || !tx.note || tx.note === 'transactions.deposit') {
    return esc(tx?.credit ? t('transactions.credit_type') : t('session.session'));
  }
  const note = tx.note.trim();
  const mPay = note.match(/^(?:Direct payment|Direktzahlung|Pago directo|Pagamento diretto|Paiement direct|Pagamento direto)\s+(\d{4}-\d{2}-\d{2})(?:\s*\([^)]+\))?$/i);
  if (mPay) {
    const date = mPay[1];
    const plainText = t('transactions.direct_payment_for_session').replace('{session}', fmtD(date));
    return esc(plainText);
  }
  const mSess = note.match(/^(?:Session|Spieltag|Sesión|Sessione|Sessão)\s+(\d{4}-\d{2}-\d{2})(?:\s*\([^)]+\))*$/i);
  if (mSess) {
    const date = mSess[1];
    const guestMatch = note.match(/\(\+(\d+)\s+[a-zA-ZäöüßÄÖÜ]+\)/);
    const guests = guestMatch ? parseInt(guestMatch[1], 10) : 0;
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
  if (S.cfg.total_privacy_mode === '1' && !guestId) {
    openWelcomeModal();
    return;
  }
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
  if (indicatorEl && S.cfg.show_runway_banner === '0') {
    indicatorEl.style.display = 'none';
    indicatorEl.innerHTML = '';
  } else if (indicatorEl) {
    indicatorEl.style.display = '';
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
  if (poolEl && S.cfg.show_team_pool === '0') {
    poolEl.style.display = 'none';
    poolEl.innerHTML = '';
  } else if (poolEl) {
    poolEl.style.display = '';
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

function downloadSessionCalendar(dateOrId) {
  const sess = getOrSess(dateOrId);
  const date = sess ? sess.date : dateOrId;
  const sessId = sess ? (sess.id || sess.date) : date;
  const title = getSessionName(sess || date);
  const { start: startTime, end: endTime } = getSessionTime(sess || date);
  const startHHMM = startTime.replace(':', '');
  const endHHMM   = endTime.replace(':', '');
  const start = date.replace(/-/g, '') + 'T' + startHHMM + '00';
  const end = date.replace(/-/g, '') + 'T' + endHHMM + '00';
  const now = new Date();
  const dtstamp = formatICSDatetime(now);
  const uid = `${sessId}-${guestId || 'guest'}@courtle.local`;
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
  if (sess && sess.location) {
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

let finDimension = 'team'; // 'team' | 'players'
let teamFilter = 'all'; // 'all' | 'credits' | 'expenses'
let historyTypeFilter = 'all'; // 'all' | 'credits' | 'debits'

function syncFinDimensionUI() {
  const isTeam = finDimension === 'team';

  const tabTeam = document.getElementById('fin-tab-team');
  const tabPlayers = document.getElementById('fin-tab-players');
  if (tabTeam) {
    tabTeam.classList.toggle('active', isTeam);
    tabTeam.setAttribute('aria-selected', isTeam ? 'true' : 'false');
  }
  if (tabPlayers) {
    tabPlayers.classList.toggle('active', !isTeam);
    tabPlayers.setAttribute('aria-selected', !isTeam ? 'true' : 'false');
  }

  const subTitle = document.getElementById('fin-view-subtitle');
  if (subTitle) {
    subTitle.innerText = t(isTeam ? 'finances.subtitle_team' : 'finances.subtitle_players');
  }

  const teamTabs = document.getElementById('team-type-tabs');
  const playerTabs = document.getElementById('history-type-tabs');
  const rightControls = document.getElementById('fin-controls-right');
  if (teamTabs) teamTabs.style.display = isTeam ? 'flex' : 'none';
  if (playerTabs) playerTabs.style.display = !isTeam ? 'flex' : 'none';
  if (rightControls) rightControls.style.display = !isTeam ? 'flex' : 'none';

  const btnExp = document.getElementById('hist-btn-add-expense');
  const btnTx = document.getElementById('hist-btn-add-tx');
  if (btnExp) btnExp.style.display = '';
  if (btnTx) btnTx.style.display = '';

  const expContainer = document.getElementById('expenses-container');
  const histList = document.getElementById('history-list');
  if (expContainer) expContainer.style.display = isTeam ? 'flex' : 'none';
  if (histList) histList.style.display = !isTeam ? 'flex' : 'none';
}

function setFinDimension(dim) {
  finDimension = dim === 'players' ? 'players' : 'team';
  syncFinDimensionUI();
  renderKPIs();
  renderHistory();
  if (window.lucide) lucide.createIcons();
}

function setTeamFilter(filter) {
  teamFilter = filter;
  ['all', 'credits'].forEach(k => {
    const btn = document.getElementById('hist-tab-team-' + k);
    if (btn) {
      const active = k === filter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  });
  const expBtn = document.getElementById('hist-tab-expenses');
  if (expBtn) {
    const active = filter === 'expenses';
    expBtn.classList.toggle('active', active);
    expBtn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  setFinDimension('team');
}

function setHistoryTypeFilter(type) {
  if (type === 'expenses') {
    setTeamFilter('expenses');
    return;
  }
  historyTypeFilter = type;
  ['all', 'credits', 'debits'].forEach(k => {
    const btn = document.getElementById('hist-tab-' + k);
    if (btn) {
      const active = k === type;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  });
  setFinDimension('players');
}

function renderHistory() {
  syncFinDimensionUI();
  const isTeam = finDimension === 'team';

  const sel = document.getElementById('hist-filter');
  const el = document.getElementById('history-list');
  const expContainer = document.getElementById('expenses-container');

  // Always keep player filter options and counts up to date
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${esc(t('players.csv_all'))}</option>` + S.players.filter(p => p.active !== false).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    sel.value = cur;
  }

  let baseTxs = [...(S.transactions || [])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (sel && sel.value) baseTxs = baseTxs.filter(tx => tx.playerId === sel.value);

  const cntHistAll = document.getElementById('fin-cnt-hist-all');
  const cntHistCred = document.getElementById('fin-cnt-hist-credits');
  const cntHistDeb = document.getElementById('fin-cnt-hist-debits');
  const credCount = baseTxs.filter(tx => tx.credit).length;
  const debCount = baseTxs.filter(tx => !tx.credit).length;
  if (cntHistAll) cntHistAll.textContent = baseTxs.length;
  if (cntHistCred) cntHistCred.textContent = credCount;
  if (cntHistDeb) cntHistDeb.textContent = debCount;

  if (isTeam) {
    if (expContainer) renderExpenses();
    renderKPIs();
    if (window.lucide) lucide.createIcons();
    return;
  }

  renderKPIs();

  let txs = baseTxs;
  if (historyTypeFilter === 'credits') {
    txs = txs.filter(tx => tx.credit);
  } else if (historyTypeFilter === 'debits') {
    txs = txs.filter(tx => !tx.credit);
  }
  
  if (!el) return;

  if (!txs.length) { 
    el.innerHTML = `<div class="empty"><i data-lucide="clock"></i><h3>${esc(t('history.no_transactions'))}</h3></div>`; 
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
    ...manualTxs.map(tx => ({ isGroup: false, date: tx.date, data: tx, timestamp: tx.createdAt || (tx.date + 'T00:00:00') }))
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const loc = getLocale();
  el.className = 'history-list';
  el.innerHTML = combined.map(item => {
    const dObj = new Date(item.date + 'T00:00:00');
    const monthStr = dObj.toLocaleDateString(loc, { month: 'short' }).toUpperCase().replace('.', '');
    const dayNum = dObj.toLocaleDateString(loc, { day: 'numeric' });

    if (item.isGroup) {
      const group = item.data;
      const isExpanded = !!expandedSessionGroups[group.date];
      const hasDebits = group.totalAmount > 0;
      const hasCredits = group.totalCredits > 0;
      let groupAmtHtml = '';
      if (hasDebits && hasCredits) {
        groupAmtHtml = `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
          <div class="expense-card-amount db">– ${fmtE(group.totalAmount)}</div>
          <div class="expense-card-amount cr" style="font-size:10px">+ ${fmtE(group.totalCredits)}</div>
        </div>`;
      } else if (hasDebits) {
        groupAmtHtml = `<div class="expense-card-amount db">– ${fmtE(group.totalAmount)}</div>`;
      } else {
        groupAmtHtml = `<div class="expense-card-amount cr">+ ${fmtE(group.totalCredits)}</div>`;
      }
      
      const debitPlayersCount = group.transactions.filter(tx => !tx.credit).length;
      const directCount = group.transactions.filter(tx => tx.credit).length;
      const metaParts = [];
      if (debitPlayersCount) metaParts.push(`${debitPlayersCount} ${t('view.players')}`);
      if (directCount) metaParts.push(`${directCount} ${t('billing.direct_paid')}`);

      return `<div class="grouped-session-card ${isExpanded ? 'expanded' : ''}" id="group-card-${group.date}">
        <div class="grouped-session-header" onclick="toggleSessionGroup('${group.date}')">
          <div class="expense-date-badge">
            <div class="month">${esc(monthStr)}</div>
            <div class="day">${esc(dayNum)}</div>
          </div>
          <div class="expense-card-details">
            <div class="expense-card-note">
              <span>${esc(t('session.session'))} ${fmtD(group.date)}</span>
              <span class="badge bg-neu" style="font-size:10px;padding:1px 6px">${esc(t('transactions.debit_type'))}</span>
            </div>
            <div class="expense-card-meta">${esc(metaParts.join(' · '))}</div>
          </div>
          <div class="expense-card-right">
            ${groupAmtHtml}
            <div class="grouped-session-toggle"><i data-lucide="chevron-down" style="width:16px;height:16px"></i></div>
          </div>
        </div>
        <div class="grouped-session-details">
          <div class="grouped-session-list">
            ${group.transactions.map(tx => {
              const tp = tx.playerId === '_deleted_' ? null : S.players.find(x => x.id === tx.playerId);
              const tpname = tp ? esc(tp.name) : t('misc.deleted');
              return `<div class="grouped-session-row">
                <div class="grouped-session-player">
                  <i data-lucide="${tx.credit ? 'arrow-up-right' : 'arrow-down-left'}" style="width:13px;height:13px;color:${tx.credit ? 'var(--suc)' : 'var(--txm)'};flex-shrink:0"></i>
                  <span>${tpname} <span style="font-size:10px;color:var(--txm);font-weight:normal">(${esc(tx.credit ? t('billing.direct_paid') : t('transactions.debit_type'))})</span></span>
                </div>
                <div class="grouped-session-row-right">
                  <span class="grouped-session-row-amount ${tx.credit ? 'cr' : 'db'}">${tx.credit ? '+' : '–'} ${fmtE(tx.amount)}</span>
                  ${isAdmin ? `<button class="btn btn-xs btn-sec" onclick="openEditTx('${tx.id}')" type="button" style="padding:2px 6px;min-height:24px"><i data-lucide="pencil" style="width:10px;height:10px"></i></button>` : ''}
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
      const plainNote = formatTxNotePlain(tx);
      const isDefaultNote = !plainNote || plainNote.toLowerCase() === textType.toLowerCase();
      const metaStr = isDefaultNote ? fmtD(tx.date) : `${fmtD(tx.date)} · ${esc(plainNote)}`;
      
      return `<div class="history-card">
        <div class="expense-date-badge">
          <div class="month">${esc(monthStr)}</div>
          <div class="day">${esc(dayNum)}</div>
        </div>
        <div class="history-card-details">
          <div class="history-card-note">
            <span>${pname}</span>
            <span class="badge ${tx.credit ? 'bg-ok' : 'bg-err'}" style="font-size:10px;padding:1px 6px">${esc(textType)}</span>
          </div>
          <div class="history-card-meta">${metaStr}</div>
        </div>
        <div class="history-card-right">
          <div class="expense-card-amount ${tx.credit ? 'cr' : 'db'}">
            ${tx.credit ? '+' : '–'} ${fmtE(tx.amount)}
          </div>
          ${isAdmin ? `
            <div class="history-card-actions">
              <button class="btn btn-sec btn-sm fin-act-btn" onclick="openEditTx('${tx.id}')" type="button" title="${esc(t('common.edit', 'Bearbeiten'))}"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
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
// ════════════════════════════════════════
let settingsTab = 'general';

function setSettingsTab(tab) {
  settingsTab = tab === 'sessions' ? 'sessions' : tab === 'backup' ? 'backup' : 'general';
  const btnGen = document.getElementById('settings-tab-general');
  const btnSess = document.getElementById('settings-tab-sessions');
  const btnBack = document.getElementById('settings-tab-backup');
  const pGen = document.getElementById('settings-panel-general');
  const pSess = document.getElementById('settings-panel-sessions');
  const pBack = document.getElementById('settings-panel-backup');

  if (btnGen) {
    btnGen.classList.toggle('active', settingsTab === 'general');
    btnGen.setAttribute('aria-selected', settingsTab === 'general');
  }
  if (btnSess) {
    btnSess.classList.toggle('active', settingsTab === 'sessions');
    btnSess.setAttribute('aria-selected', settingsTab === 'sessions');
  }
  if (btnBack) {
    btnBack.classList.toggle('active', settingsTab === 'backup');
    btnBack.setAttribute('aria-selected', settingsTab === 'backup');
  }
  if (pGen) pGen.style.display = settingsTab === 'general' ? '' : 'none';
  if (pSess) pSess.style.display = settingsTab === 'sessions' ? '' : 'none';
  if (pBack) pBack.style.display = settingsTab === 'backup' ? '' : 'none';

  if (window.lucide) lucide.createIcons();
}

function syncSettings(force = false) {
    const settingsView = document.getElementById('view-settings');
    const isSettingsActive = settingsView && settingsView.classList.contains('active');
    if (!force && isSettingsActive && document.activeElement && settingsView.contains(document.activeElement)) {
        return; // Don't disrupt active user editing
    }
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && (force || document.activeElement !== el)) el.value = val;
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
    const costCur = document.getElementById('settings-cost-currency');
    if (costCur) costCur.textContent = S.cfg.currency || '€';

    const sysEnabled = document.getElementById('sys-series-enabled');
    if (sysEnabled) sysEnabled.checked = S.cfg.sr_enabled !== '0';

    const dispCourt = document.getElementById('disp-court-grouping');
    if (dispCourt) dispCourt.checked = S.cfg.display_court_grouping !== '0';
    const sysRounding = document.getElementById('sys-billing-rounding');
    if (sysRounding) sysRounding.value = S.cfg.billing_rounding || 'exact';
    const privMode = document.getElementById('disp-privacy-mode');
    if (privMode) privMode.checked = S.cfg.privacy_mode === '1';
    const totalPrivMode = document.getElementById('disp-total-privacy-mode');
    if (totalPrivMode) totalPrivMode.checked = S.cfg.total_privacy_mode === '1';
    const showDeadline = document.getElementById('disp-show-cancel-deadline');
    if (showDeadline) showDeadline.checked = S.cfg.show_cancel_deadline !== '0';
    const showTeamPool = document.getElementById('disp-show-team-pool');
    if (showTeamPool) showTeamPool.checked = S.cfg.show_team_pool !== '0';
    const showRunwayBanner = document.getElementById('disp-show-runway-banner');
    if (showRunwayBanner) showRunwayBanner.checked = S.cfg.show_runway_banner !== '0';
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

let _settingsSaveTimeout = null;
let _settingsBadgeTimeout = null;

function settingsAutoSaveDebounced() {
  if (_settingsSaveTimeout) clearTimeout(_settingsSaveTimeout);
  _settingsSaveTimeout = setTimeout(() => {
    settingsAutoSave();
  }, 450);
}

async function settingsAutoSave() {
  if (_settingsSaveTimeout) {
    clearTimeout(_settingsSaveTimeout);
    _settingsSaveTimeout = null;
  }
  await saveSettings(true);
}

function stepNumber(id, delta, min = 1, max = 20) {
  const el = document.getElementById(id);
  if (!el) return;
  let val = parseInt(el.value, 10) || min;
  val = Math.max(min, Math.min(max, val + delta));
  el.value = val;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function stepCost(delta) {
  const el = document.getElementById('sr-cost');
  if (!el) return;
  let val = parseFloat(el.value) || 16;
  val = Math.max(1, Math.min(999, Math.round((val + delta) * 2) / 2));
  el.value = val;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function saveSettings(silent = false) {
    const hoursRaw = document.getElementById('sys-cancel-hours')?.value;
    const minutesRaw = document.getElementById('sys-cancel-minutes')?.value;
    const h = parseInt(hoursRaw, 10) || 0;
    const m = parseInt(minutesRaw, 10) || 0;
    const cancelHours = Math.max(0, Math.min(240, h + m / 60));
    const costVal = parseFloat(document.getElementById('sr-cost')?.value);
    const courtsVal = parseInt(document.getElementById('sr-courts')?.value, 10);
    const settings = {
        sr_enabled: document.getElementById('sys-series-enabled')?.checked ? '1' : '0',
        cancel_hours: String(cancelHours),
        team_name: document.getElementById('disp-team-name')?.value.trim() || '',
        auto_compact_slots: document.getElementById('sys-auto-compact-slots')?.checked ? '1' : '0',
        cost: !isNaN(costVal) && costVal >= 0 ? costVal : 16,
        courts: !isNaN(courtsVal) && courtsVal >= 1 ? courtsVal : 2,
        billing_rounding: document.getElementById('sys-billing-rounding')?.value || 'exact',
        display_court_grouping: document.getElementById('disp-court-grouping')?.checked ? '1' : '0',
        privacy_mode: document.getElementById('disp-privacy-mode')?.checked ? '1' : '0',
        total_privacy_mode: document.getElementById('disp-total-privacy-mode')?.checked ? '1' : '0',
        show_cancel_deadline: document.getElementById('disp-show-cancel-deadline')?.checked ? '1' : '0',
        show_team_pool: document.getElementById('disp-show-team-pool')?.checked ? '1' : '0',
        show_runway_banner: document.getElementById('disp-show-runway-banner')?.checked ? '1' : '0',
        currency: document.getElementById('sr-currency')?.value.trim() || '€',
        system_language: document.getElementById('sys-language')?.value || '',
        time_format: document.getElementById('disp-time-format')?.value || '24h',
        date_format: document.getElementById('disp-date-format')?.value || 'dmy',
    };
    try {
        await apiFetch('PUT', '/config', settings);
        await loadState();
        applyTeamName();
        applyTranslations();
        applyRole();
        window._lastSessionHash = null;
        if (typeof renderSessions === 'function') renderSessions();
        if (typeof renderMyTransactions === 'function') renderMyTransactions();
        if (isAdmin && typeof renderBilling === 'function') renderBilling();

        const badge = document.getElementById('settings-save-pill');
        if (badge) {
          badge.classList.add('show');
          if (_settingsBadgeTimeout) clearTimeout(_settingsBadgeTimeout);
          _settingsBadgeTimeout = setTimeout(() => {
            badge.classList.remove('show');
          }, 1800);
        }
        if (!silent) {
          showToast(t('settings.saved', 'Einstellungen gespeichert.'));
        }
    } catch(e) {
        showToast('⚠️ ' + (e.message || t('misc.save_failed', 'Speichern fehlgeschlagen.')));
    }
}

async function saveSystemSettings() {
    return saveSettings();
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
    return `<div class="card mb3" style="position:relative">
      <div class="flex items-c just-b g3" style="margin-bottom:var(--sp2)">
        <div style="min-width:0;flex:1">
          <div class="flex items-c g2" style="flex-wrap:wrap">
            <strong style="font-size:var(--text-base)">${esc(s.name || 'Unbenannt')}</strong>
            <span class="status-pill ${s.enabled ? 'st-open' : 'st-cancelled'}" style="font-size:11px;padding:2px 8px">
              ${s.enabled ? t('series.auto_gen_active') : t('series.auto_gen_paused')}
            </span>
          </div>
          <div class="txxs txm" style="margin-top:3px">
            ${s.enabled ? t('series.auto_gen_active_desc') : t('series.auto_gen_paused_desc')}
          </div>
        </div>
        <label class="switch" style="flex-shrink:0" title="${s.enabled ? t('series.auto_gen_active') : t('series.auto_gen_paused')}">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleSeriesEnabled(${s.id}, this.checked)">
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="txsm txm" style="margin-top:8px;padding-top:8px;border-top:1px solid oklch(from var(--tx) l c h / .07)">
        <div>${days} · ${s.timeStart}–${s.timeEnd} · ${s.courts} ${t('session.court_s', 'Court(s)')}${courtNamesLabel} · ${t('series.occurrences_count', '{count} Termine').replace('{count}', s.occurrences)}${cancelLabel}</div>
        <div>${priceLabel}${s.location ? ' · ' + esc(s.location) : ''}</div>
      </div>
      <div class="flex g2 items-c" style="margin-top:var(--sp3)">
        <button class="btn btn-sec btn-sm" onclick="openSeriesEdit(${s.id})"><i data-lucide="pencil" style="width:14px;height:14px"></i> ${t('series.edit')}</button>
        <button class="btn btn-dan btn-sm fin-act-btn" onclick="deleteSeries(${s.id})"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
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
  document.getElementById('series-edit-courts').value = parseInt(S.cfg.courts, 10) || 2;
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
  document.getElementById('series-edit-courts').value = s.courts || parseInt(S.cfg.courts, 10) || 2;
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
const DD_VIEWS = ['admin-plan','players','expenses','billing','history','series','settings','backup'];
const DD_LABELS = {'admin-plan':'nav.session_plan','players':'nav.players','expenses':'nav.expenses','billing':'nav.billing','history':'nav.history','series':'nav.series','settings':'nav.settings','backup':'nav.backup'};

function showView(name) {
  closeMobileAdminMenu();
  if (name === 'dashboard') name = 'history';
  if (name === 'expenses') {
    setHistoryTypeFilter('expenses');
    name = 'history';
  }
  // NEU: Sicherheits-Check
  const adminViews = ['admin-plan', 'players', 'billing', 'history', 'series', 'settings', 'backup'];
  if (adminViews.includes(name) && !isAdmin) {
    name = 'sessions'; // Falls kein Admin, leite um auf Spieltage
  } // <--- DIESE KLAMMER HAT GEFEHLT!

  const wrap = document.getElementById('swipe-wrap');
  const inSwipe = wrap && wrap.classList.contains('swipe-active') && isMobileSwipe() && SWIPE_VIEWS.includes(name);

  if (SWIPE_VIEWS.includes(name)) {
    if (wrap) wrap.style.display = '';

    if (inSwipe) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      var targetView = document.getElementById('view-' + name);
      if (targetView) targetView.classList.add('active');
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

  if (name === 'backup') {
    showView('settings');
    setSettingsTab('backup');
    return;
  }
  if (name === 'players') {
    renderPlayers();
    renderPlayerBalances();
    renderPlayerActivityTable();
  }
  const v = document.getElementById('view-' + name);
  if (v) v.classList.add('active');
  
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
  
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
  if (name === 'billing')         renderBilling();
  if (name === 'admin-plan') {
    _planStripAnimateNext = true;
    renderAdminPlan();
    setTimeout(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }, 50);
  }
  if (name === 'settings') {
    syncSettings();
    setSettingsTab(settingsTab);
  }
  
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
        note: t.note || '',
        sessionId: t.session_id || null
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
function isIOS() { 
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); 
}
function isStandalone() { 
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || window.location.search.includes('pwa=1'); 
}

let _ptrStartX = 0;
let _ptrStartY = 0;
let _ptrDistance = 0;
let _ptrDirection = null; // null | 'h' | 'v'
let _ptrActive = false;
let _ptrArmed = false;
let _ptrLoading = false;
const PTR_THRESHOLD = 64; // px damped pull needed to arm refresh
const PTR_MAX = 78;       // max damped visual travel

const IGNORED_PTR_SELECTORS = [
  '.plan-strip',
  '.plan-nav-box',
  '#session-selector-box',
  '.player-pick-grid-wrap',
  '.mo-backdrop',
  '.modal',
  '.mo-box',
  '.tw',
  '.table-wrap',
  'input',
  'textarea',
  'select',
  'button'
].join(',');

function _resetPtr(animate) {
  _ptrActive = false;
  _ptrArmed = false;
  _ptrDistance = 0;
  _ptrDirection = null;
  const el = document.getElementById('ptr-indicator');
  if (!el) return;
  el.classList.remove('ptr-pulling', 'ptr-ready');
  if (animate) {
    el.classList.add('ptr-closing');
    setTimeout(() => {
      el.classList.remove('ptr-closing');
      el.style.transform = '';
      el.style.opacity = '';
      const arrow = el.querySelector('.ptr-arrow');
      if (arrow) arrow.style.transform = '';
    }, 250);
  } else {
    el.style.transform = '';
    el.style.opacity = '';
    const arrow = el.querySelector('.ptr-arrow');
    if (arrow) arrow.style.transform = '';
  }
}

document.addEventListener('touchstart', e => {
  if (_ptrLoading) return;
  if (!isStandalone() || !isIOS()) return;

  // Must be scrolled to top of page
  if (window.scrollY > 5) return;

  // Ignore touches starting inside horizontal scrollers, modals, or form controls
  if (e.target.closest(IGNORED_PTR_SELECTORS)) return;

  // Never trigger if any modal overlay is active
  if (document.querySelector('.modal.open, .mo-backdrop.open')) return;

  _ptrStartX = e.touches[0].clientX;
  _ptrStartY = e.touches[0].clientY;
  _ptrDistance = 0;
  _ptrDirection = null;
  _ptrActive = true;
  _ptrArmed = false;
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!_ptrActive || _ptrLoading) return;

  const touch = e.touches[0];
  const dx = touch.clientX - _ptrStartX;
  const dy = touch.clientY - _ptrStartY;

  // Lock gesture direction once finger moves enough
  if (_ptrDirection === null) {
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      if (Math.abs(dx) >= Math.abs(dy) * 0.75 || dy < 0) {
        // Horizontal, diagonal, or upward swipe -> disable PTR for this gesture
        _ptrActive = false;
        return;
      }
      _ptrDirection = 'v';
    } else {
      return;
    }
  }

  if (_ptrDirection !== 'v') return;

  // Cancel immediately if page has scrolled down
  if (window.scrollY > 0 || dy <= 0) {
    _resetPtr(false);
    return;
  }

  // Prevent native viewport rubber-band bounce while pulling our indicator
  if (e.cancelable) {
    e.preventDefault();
  }

  // Physics damping: smooth rubber-band resistance
  const damped = Math.min(PTR_MAX, Math.pow(dy, 0.8) * 1.45);
  _ptrDistance = damped;

  const el = document.getElementById('ptr-indicator');
  if (!el) return;

  const progress = Math.min(1, damped / PTR_THRESHOLD);
  el.classList.add('ptr-pulling');
  el.classList.remove('ptr-closing');

  const currentY = -45 + (damped * 1.05);
  el.style.transform = `translate(-50%, ${currentY}px) scale(${0.85 + (progress * 0.15)})`;
  el.style.opacity = String(Math.min(1, progress * 1.3));

  const arrow = el.querySelector('.ptr-arrow');
  if (damped >= PTR_THRESHOLD) {
    if (!_ptrArmed) {
      _ptrArmed = true;
      el.classList.add('ptr-ready');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
    }
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  } else {
    if (_ptrArmed) {
      _ptrArmed = false;
      el.classList.remove('ptr-ready');
    }
    if (arrow) arrow.style.transform = `rotate(${progress * 180}deg)`;
  }
}, { passive: false });

document.addEventListener('touchend', async () => {
  if (!_ptrActive || _ptrLoading) return;
  const wasArmed = _ptrArmed;
  _ptrActive = false;

  const el = document.getElementById('ptr-indicator');
  if (el) el.classList.remove('ptr-pulling');

  if (wasArmed) {
    _ptrLoading = true;
    if (el) {
      el.classList.remove('ptr-ready');
      el.classList.add('ptr-loading');
      el.style.transform = '';
      el.style.opacity = '';
    }

    try {
      await loadState();
      if (isAdmin) {
        renderAll();
      } else {
        renderSessions();
        renderMyHistory();
        renderMyTransactions();
        lucide.createIcons();
        syncSwipeHeight();
      }
    } catch (err) {
      console.warn('[PTR] Refresh failed:', err);
    }

    if (el) {
      el.classList.remove('ptr-loading');
      el.classList.add('ptr-closing');
      setTimeout(() => {
        el.classList.remove('ptr-closing');
        el.style.transform = '';
        el.style.opacity = '';
        const arrow = el.querySelector('.ptr-arrow');
        if (arrow) arrow.style.transform = '';
      }, 300);
    }
    _ptrLoading = false;
    _ptrArmed = false;
  } else {
    if (el) {
      el.classList.add('ptr-closing');
      setTimeout(() => {
        el.classList.remove('ptr-closing', 'ptr-ready');
        el.style.transform = '';
        el.style.opacity = '';
        const arrow = el.querySelector('.ptr-arrow');
        if (arrow) arrow.style.transform = '';
      }, 250);
    }
  }

  _ptrDistance = 0;
  _ptrDirection = null;
}, { passive: true });

document.addEventListener('touchcancel', () => {
  if (!_ptrLoading) {
    _resetPtr(true);
  }
}, { passive: true });

let _adminWlDate = null;

function renderAdminWlList() {
  if (!_adminWlDate) return;
  const sess = getOrSess(_adminWlDate);
  const alreadyWl = new Set(sess.waitlist);
  const list = document.getElementById('mo-slot-list');
  const players = S.players.filter(p => p.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
  list.innerHTML = players.map(p => {
    const onWl = alreadyWl.has(p.id);
    const g1Taken = alreadyWl.has(p.id + '|g1');
    const g2Taken = alreadyWl.has(p.id + '|g2');
    const guestAvail = !(g1Taken && g2Taken);
    const gTag = !g1Taken ? p.id + '|g1' : p.id + '|g2';
    const b = bal(p.id);
    const balClass = b < 0 ? 'neg' : b === 0 ? 'zero' : 'pos';

    return `<div class="slot-pick-row">
      <button type="button" class="slot-player-btn ${onWl ? 'is-booked' : ''}"
        ${onWl ? 'disabled' : `onclick="adminDoAddWl('${_adminWlDate}','${p.id}')"`}>
        <div class="av" style="width:34px;height:34px;font-size:var(--text-sm);flex-shrink:0">
          <i data-lucide="${playerIcon(p)}" style="width:16px;height:16px"></i>
        </div>
        <div class="slot-player-info">
          <div class="slot-player-name">${esc(p.name)}</div>
          <div class="slot-player-meta">
            <span class="slot-player-bal ${balClass}">${fmtE(b)}</span>
            ${onWl ? `<span class="slot-player-tag"><i data-lucide="clock" style="width:10px;height:10px"></i> ${t('slot.on_waitlist')}</span>` : ''}
          </div>
        </div>
      </button>
      <button type="button" class="slot-guest-btn ${!guestAvail ? 'disabled' : ''}"
        ${guestAvail ? `onclick="adminDoAddWl('${_adminWlDate}','${gTag}')"` : 'disabled'}
        title="${guestAvail ? t('session.guest_to_waitlist') : t('slot.guest_max')}">
        <i data-lucide="user-plus" style="width:14px;height:14px"></i>
        <span>${t('slot.guest')}</span>
      </button>
    </div>`;
  }).join('');
  lucide.createIcons();
}

async function adminAddToWaitlist(date) {
  document.getElementById('mo-slot-title').textContent = t('session.add_to_waitlist');
  const danBtn = document.getElementById('mo-slot').querySelector('.btn-dan');
  if (danBtn) danBtn.style.display = 'none';
  const foot = document.getElementById('mo-slot').querySelector('.mo-foot');
  if (foot) foot.style.display = 'none';
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
  window.addEventListener('scroll', () => {
    // Only close if user actually scrolled away from top
    if (window.scrollY > 30) closeMobileAdminMenu();
  }, { passive: true });
  if (!guestId) setTimeout(openWelcomeModal, 350);

  // Simple polling for live refresh
  setInterval(async () => {
    try {
      const [sessions, players] = await Promise.all([
        apiFetch('GET', '/sessions'),
        apiFetch('GET', '/players')
      ]);
      const raw = JSON.stringify(sessions.map(s => [s.id, s.date, s.timeStart, s.courts, s.waitlist, s.disabledCourts, s.cancelled, s.note, s.location, s.price, s.name]));
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
        id: s.id,
        date: s.date,
        charged: !!s.charged,
        disabledCourts: s.disabledCourts || [],
        waitlist: s.waitlist || [],
        courts: s.courts || [],
        note: s.note || '',
        cancelled: !!s.cancelled,
        timeStart: s.timeStart || null,
        timeEnd: s.timeEnd || null,
        location: s.location || null,
        price: s.price !== null && s.price !== undefined ? parseFloat(s.price) : null,
        cancelHours: s.cancelHours !== null && s.cancelHours !== undefined ? parseFloat(s.cancelHours) : null,
        name: s.name || null,
        courtNames: s.courtNames || []
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
  const sess = S.sessions.find(s => s.id === _teamDate || s.date === _teamDate);
  if (!sess) return;

  const body = document.getElementById('mo-teams-body');
  if (!body) return;

  // Collect all players in session (including guests)
  const playerIds = sess.courts.flat().filter(Boolean);
  if (playerIds.length === 0) {
    body.innerHTML = `<p class="txsm txm" style="text-align:center;padding:var(--sp6) 0">${t('teams.no_players')}</p>`;
    return;
  }

  // Shuffle
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);

  // Active courts (not disabled)
  const activeCourtIndices = sess.courts
    .map((_, i) => i)
    .filter(i => !sess.disabledCourts.includes(i));

  // Determine how many courts we can fill (up to 4 players per court)
  let numCourts = 1;
  if (shuffled.length >= 4) {
    numCourts = Math.min(activeCourtIndices.length, Math.floor(shuffled.length / 4));
  }
  const playingCount = Math.min(shuffled.length, numCourts * 4);
  const activePlayers = shuffled.slice(0, playingCount);
  const benchPlayers = shuffled.slice(playingCount);

  // Distribute playing players across courts
  const distributed = Array.from({ length: numCourts }, () => []);
  activePlayers.forEach((pid, i) => {
    distributed[i % numCourts].push(pid);
  });

  function playerLabel(pid) {
    const bid = baseId(pid);
    const p = S.players.find(x => x.id === bid);
    const name = p ? esc(p.name) : '?';
    const isGuest = pid.includes('|');
    const isMe = guestId && (pid === guestId || (isGuest && pid.startsWith(guestId + '|')));
    const iconName = p ? playerIcon(p, isGuest) : 'user';
    const displayName = isGuest ? `${t('session.guest')} (${name})` : name;

    return `<div class="court-mixer-player ${isMe ? 'me' : ''}">
      <div class="av" style="width:22px;height:22px;font-size:10px;flex-shrink:0"><i data-lucide="${iconName}" style="width:12px;height:12px"></i></div>
      <span class="court-mixer-player-name">${displayName}</span>
    </div>`;
  }

  body.innerHTML = distributed.map((players, ci) => {
    const actualCourtIndex = activeCourtIndices[ci] ?? ci;
    const courtName = getCourtLabel(sess, actualCourtIndex);
    const teamA = players.filter((_, i) => i % 2 === 0);
    const teamB = players.filter((_, i) => i % 2 === 1);
    return `<div class="court-mixer-card">
      <div class="court-mixer-head">
        <span class="court-mixer-title"><i data-lucide="map-pin" style="width:12px;height:12px"></i> ${esc(courtName)}</span>
      </div>
      <div class="court-mixer-match">
        <div class="court-mixer-pair">${teamA.map(playerLabel).join('')}</div>
        ${teamB.length > 0 ? `
          <div class="court-mixer-divider">
            <span class="court-mixer-vs-pill">${t('teams.vs', 'vs')}</span>
          </div>
          <div class="court-mixer-pair">${teamB.map(playerLabel).join('')}</div>
        ` : ''}
      </div>
    </div>`;
  }).join('') + (benchPlayers.length > 0 ? `
    <div class="court-mixer-bench">
      <div class="court-mixer-bench-title"><i data-lucide="clock" style="width:12px;height:12px"></i> ${t('teams.bench', 'Pausiert / Nächste Runde')} (${benchPlayers.length})</div>
      <div class="court-mixer-bench-list">${benchPlayers.map(playerLabel).join('')}</div>
    </div>
  ` : '');

  lucide.createIcons();
}

let pendingLeaveId = null;

function openLeaveConfirm(idOrDate) {
  const sess = getOrSess(idOrDate);
  if (!sess) return;
  if (!isWithinCancelWindow(sess)) {
    const deadline = getCancelDeadline(sess);
    const deadlineStr = fmtDateTime(deadline);
    showToast(t('toast.leave_failed') + ' (' + t('session.cancel_deadline') + ' ' + t('session.until') + ': ' + deadlineStr + ')');
    return;
  }
  pendingLeaveId = sess.id || sess.date;
  const hasWL = sess.waitlist && sess.waitlist.length > 0;
  const deadline = getCancelDeadline(sess);
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
  if (pendingLeaveId) {
    leaveSession(pendingLeaveId);
    renderMyHistory();
    pendingLeaveId = null;
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
    renderAll();
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
    return saveSettings();
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
      if (['date', 'time', 'datetime-local', 'month', 'color'].includes(e.target.type)) return;
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
