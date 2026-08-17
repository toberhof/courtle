<?php
// ═══════════════════════════════════════════════
//  Courtle – API Backend
//  PHP 8.2 + SQLite (PDO)
// ═══════════════════════════════════════════════

define('DB_PATH', getenv('COURTLE_DB_PATH') ?: (getenv('DB_PATH') ?: '/var/www/courtle_data/courtle.db'));
define('SESSION_LIFETIME', 3600 * 24 * 30);
date_default_timezone_set(getenv('COURTLE_TIMEZONE') ?: (getenv('TZ') ?: 'Europe/Berlin'));
$allowed_origins = ['*'];

// Proxy-Check für Cloudflare & Traefik
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}

// ── CORS + Headers ──
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = $allowed_origins ?? ['*'];
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
} elseif ($allowedOrigins === ['*']) {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Token');
header('Access-Control-Expose-Headers: X-DB-Init');

// Preflight-Anfragen (OPTIONS) sofort beantworten
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { 
    http_response_code(204); 
    exit; 
}
// ── DB Connection ──
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    if (is_dir($dir) && !is_writable($dir)) @chmod($dir, 0750);
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys=ON;');
    if (strpos(DB_PATH, 'test') !== false) {
        $pdo->exec('PRAGMA journal_mode=TRUNCATE;');
    } else {
        $pdo->exec('PRAGMA journal_mode=WAL;');
    }
    // Sicheres Init: prüft ob Tabellen existieren (auch bei Race-Condition)
    $hasTables = $pdo->query("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='config'")->fetchColumn();
    if (!$hasTables) init_db($pdo);
    return $pdo;
}

// ── System & DB Init ──
function handle_system_init(): void {
    require_auth(true); // Nur Admins dürfen das!
    $db = db();
    init_db($db);
    json_out(['ok' => true, 'message' => 'Datenbank-Struktur erfolgreich geprüft und aktualisiert.']);
}

function handle_test_reset(): void {
    // Only allow in test environments (where database filename contains 'test')
    if (strpos(DB_PATH, 'test') === false) {
        err('Only allowed in test environments.', 403);
    }
    
    // Clear all tables to force recreation even on persistent connections
    try {
        $db = db();
        $db->exec("PRAGMA foreign_keys = OFF");
        $tables = $db->query("SELECT name FROM sqlite_master WHERE type='table'")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($tables as $table) {
            if ($table === 'sqlite_sequence') continue;
            $db->exec("DROP TABLE IF EXISTS `$table`");
        }
        $db->exec("PRAGMA foreign_keys = ON");
    } catch (Throwable $e) {}
    
    json_out(['status' => 'success', 'message' => 'Database successfully reset.']);
}

function init_db(PDO $db): void {
    // 1. KERN-TABELLEN (Sicher dank IF NOT EXISTS - überschreibt keine Daten!)
    $db->exec("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)");
    
    $db->exec("CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, 
        name TEXT NOT NULL, 
        contact TEXT, 
        pin_hash TEXT, 
        created_at TEXT NOT NULL, 
        last_login TEXT, 
        last_interaction TEXT, 
        admin INTEGER DEFAULT 0
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY, 
        player_id TEXT NOT NULL, 
        credit INTEGER NOT NULL, 
        amount REAL NOT NULL, 
        date TEXT NOT NULL, 
        created_at TEXT NOT NULL, 
        note TEXT
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS sessions (
        date TEXT PRIMARY KEY,
        charged INTEGER DEFAULT 0,
        disabled_courts TEXT DEFAULT '[]',
        waitlist TEXT DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        time_start TEXT,
        time_end TEXT,
        cancelled INTEGER DEFAULT 0,
        location TEXT DEFAULT NULL,
        price REAL DEFAULT NULL,
        cancel_hours REAL DEFAULT NULL,
        name TEXT DEFAULT NULL
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS courts (
        session_date TEXT NOT NULL, 
        court_index INTEGER NOT NULL, 
        slot_index INTEGER NOT NULL, 
        player_id TEXT, 
        PRIMARY KEY(session_date, court_index, slot_index)
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY, 
        amount REAL NOT NULL, 
        date TEXT NOT NULL, 
        note TEXT NOT NULL DEFAULT '', 
        created_at TEXT NOT NULL
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS session_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        session_date TEXT NOT NULL, 
        player_id TEXT, 
        action TEXT NOT NULL, 
        court_index INTEGER, 
        slot_index INTEGER, 
        timestamp TEXT NOT NULL, 
        performed_by TEXT, 
        details TEXT
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        enabled INTEGER DEFAULT 1,
        days_of_week TEXT NOT NULL DEFAULT '[2]',
        occurrences INTEGER DEFAULT 6,
        time_start TEXT NOT NULL DEFAULT '19:00',
        time_end TEXT NOT NULL DEFAULT '21:00',
        courts INTEGER DEFAULT 2,
        price REAL DEFAULT NULL,
        location TEXT DEFAULT NULL,
        cancel_hours REAL DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    
    // Login sessions (separated from config table)
    $db->exec("CREATE TABLE IF NOT EXISTS login_sessions (
        token TEXT PRIMARY KEY,
        admin INTEGER NOT NULL DEFAULT 0,
        exp INTEGER NOT NULL,
        player_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
    )");
    
    // Rate limiting tables
    $db->exec("CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT PRIMARY KEY,
        attempts INTEGER DEFAULT 0,
        last_attempt INTEGER,
        locked_since INTEGER
    )");
    
    // Index for faster expired session cleanup
    $db->exec("CREATE INDEX IF NOT EXISTS idx_login_sessions_exp ON login_sessions(exp)");

    // 2. MIGRATIONEN (Fehlende Spalten bei älteren Datenbanken nachrüsten)
    $migrations = [
        "ALTER TABLE sessions ADD COLUMN note TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE players ADD COLUMN last_login TEXT",
        "ALTER TABLE players ADD COLUMN admin INTEGER DEFAULT 0",
        "ALTER TABLE players ADD COLUMN last_interaction TEXT",
        "ALTER TABLE transactions ADD COLUMN note TEXT",
        "ALTER TABLE sessions ADD COLUMN time_start TEXT",
        "ALTER TABLE sessions ADD COLUMN time_end TEXT",
        "ALTER TABLE sessions ADD COLUMN cancelled INTEGER DEFAULT 0",
        "ALTER TABLE sessions ADD COLUMN location TEXT DEFAULT NULL",
        "ALTER TABLE login_attempts ADD COLUMN locked_since INTEGER",
        "ALTER TABLE players ADD COLUMN emoji TEXT",
        "ALTER TABLE players ADD COLUMN active INTEGER DEFAULT 1",
        "ALTER TABLE sessions ADD COLUMN price REAL DEFAULT NULL",
        "ALTER TABLE sessions ADD COLUMN cancel_hours REAL DEFAULT NULL",
        "ALTER TABLE series ADD COLUMN cancel_hours REAL DEFAULT NULL",
        "ALTER TABLE sessions ADD COLUMN name TEXT DEFAULT NULL",
        "ALTER TABLE players ADD COLUMN language TEXT DEFAULT NULL",
        "ALTER TABLE players ADD COLUMN theme TEXT DEFAULT 'auto'",
        "ALTER TABLE sessions ADD COLUMN court_names TEXT",
        "ALTER TABLE series ADD COLUMN court_names TEXT"
    ];

    foreach ($migrations as $sql) {
        try { $db->exec($sql); } catch (Throwable $e) { /* Spalte existiert bereits, alles gut. */ }
    }

    // Migrate existing session data from config to login_sessions (idempotent)
    $session_stmt = $db->query("SELECT key, value FROM config WHERE key LIKE '_session_%'");
    $existing_sessions = $session_stmt->fetchAll();
    foreach ($existing_sessions as $row) {
        $token = substr($row['key'], strlen('_session_'));
        if (empty($token)) continue;
        
        $data = json_decode($row['value'], true);
        if (!$data) continue;
        
        $admin = !empty($data['admin']) ? 1 : 0;
        $exp = (int)($data['exp'] ?? 0);
        $player_id = $data['player_id'] ?? null;
        
        $insert_stmt = $db->prepare("INSERT OR IGNORE INTO login_sessions (token, admin, exp, player_id) VALUES (?, ?, ?, ?)");
        $insert_stmt->execute([$token, $admin, $exp, $player_id]);
        
        $db->prepare("DELETE FROM config WHERE key=?")->execute([$row['key']]);
    }
    
    // Clean up expired login sessions
    $db->exec("DELETE FROM login_sessions WHERE exp < " . time());
    
    // Migrate legacy sr_* config to first series (idempotent)
    $srDays = $db->query("SELECT value FROM config WHERE key='srdays'")->fetchColumn();
    $srOcc = $db->query("SELECT value FROM config WHERE key='sroccurrences'")->fetchColumn();
    $srTs = $db->query("SELECT value FROM config WHERE key='srtimestart'")->fetchColumn();
    $srTe = $db->query("SELECT value FROM config WHERE key='srtimeend'")->fetchColumn();
    $srCourts = $db->query("SELECT value FROM config WHERE key='courts'")->fetchColumn();
    $srCost = $db->query("SELECT value FROM config WHERE key='sr_cost'")->fetchColumn();
    $srLoc = $db->query("SELECT value FROM config WHERE key='srlocation'")->fetchColumn();
    $hasSeries = $db->query("SELECT COUNT(*) FROM series")->fetchColumn();
    if ($hasSeries == 0 && ($srDays || $srOcc || $srTs)) {
        $days = $srDays ? json_encode(array_map('intval', explode(',', $srDays))) : '[2]';
        $occ = (int)($srOcc ?: 6);
        $ts = $srTs ?: '19:00';
        $te = $srTe ?: '21:00';
        $co = (int)($srCourts ?: 2);
        $pr = $srCost !== false && $srCost !== '' ? (float)$srCost : null;
        $loc = $srLoc ?: null;
        $db->prepare("INSERT INTO series (name, days_of_week, occurrences, time_start, time_end, courts, price, location) VALUES (?,?,?,?,?,?,?,?)")
           ->execute(['Standard-Serie', $days, $occ, $ts, $te, $co, $pr, $loc]);
    }
}

// ── Helpers ──
function get_server_build(): string {
    static $build = null;
    if ($build !== null) return $build;
    $indexPath = __DIR__ . '/index.html';
    if (file_exists($indexPath)) {
        $content = file_get_contents($indexPath, false, null, 0, 400);
        if (preg_match('/<!--built:(\d+)-->/', $content, $m)) {
            $build = $m[1];
            return $build;
        }
    }
    return '416';
}

function json_out(mixed $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Courtle-Build: ' . get_server_build());
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function err(string $msg, int $code = 400): never { json_out(['error' => $msg], $code); }
function body(): array {
    $raw = file_get_contents('php://input');
    return $raw ? (json_decode($raw, true) ?? []) : [];
}
function gid(): string { return bin2hex(random_bytes(8)); }

// ── Session History Helper ──
function log_session_history($db, $session_date, $player_id, $action, $court_index, $slot_index, $performed_by, $details_json = null) {
    $sql = "INSERT INTO session_history (session_date, player_id, action, court_index, slot_index, timestamp, performed_by, details) VALUES (?,?,?,?,?,?,?,?)";
    $stmt = $db->prepare($sql);
    if (!$stmt) return;
    $stmt->execute([$session_date, $player_id, $action, $court_index, $slot_index, date('c'), $performed_by, $details_json]);
}

// Get performer ID (always valid player ID or 'unknown')
function get_performer_id(): string {
    $token = $_SERVER['HTTP_X_TOKEN'] ?? '';
    if (!$token) return 'unknown';
    $player_id = token_player($token);
    return $player_id ?? 'unknown';  // Always returns player ID (or unknown)
}

function get_series_for_date(PDO $db, string $date): ?array {
    $srEnabled = $db->query("SELECT value FROM config WHERE key='sr_enabled'")->fetchColumn();
    if ($srEnabled === '0') return null;

    $stmt = $db->query("SELECT * FROM series WHERE enabled = 1 ORDER BY id ASC");
    $series = $stmt->fetchAll();
    $today = date('Y-m-d');
    foreach ($series as $s) {
        $days = json_decode($s['days_of_week'], true) ?? [2];
        $occ = (int)($s['occurrences'] ?: 6);
        $d = new DateTime();
        $found = false;
        $count = 0;
        $iter = 0;
        $maxIter = $occ * 7 * 2;
        while ($count < $occ && $iter < $maxIter) {
            if (in_array((int)$d->format('w'), $days)) {
                $ds = $d->format('Y-m-d');
                if ($ds >= $today) {
                    if ($ds === $date) {
                        $found = true;
                        break;
                    }
                    $count++;
                }
            }
            $d->modify('+1 day');
            $iter++;
        }
        if ($found) return $s;
    }
    return null;
}

function get_series_by_weekday(PDO $db, string $date): ?array {
    $srEnabled = $db->query("SELECT value FROM config WHERE key='sr_enabled'")->fetchColumn();
    if ($srEnabled === '0') return null;

    $stmt = $db->query("SELECT * FROM series WHERE enabled = 1 ORDER BY id ASC");
    $series = $stmt->fetchAll();
    $w = (int)date('w', strtotime($date));
    foreach ($series as $s) {
        $days = json_decode($s['days_of_week'], true) ?? [2];
        if (in_array($w, $days, true)) {
            return $s;
        }
    }
    return null;
}

function get_effective_cancel_hours(PDO $db, string $date, ?float $sessionHours): float {
    if ($sessionHours !== null) return (float)$sessionHours;
    $series = get_series_for_date($db, $date) ?? get_series_by_weekday($db, $date);
    if ($series && $series['cancel_hours'] !== null) return (float)$series['cancel_hours'];
    $val = $db->query("SELECT value FROM config WHERE key='cancel_hours'")->fetchColumn();
    return $val !== false && $val !== '' ? (float)$val : 7.0;
}

function get_effective_time_start(PDO $db, string $date, ?string $sessionTimeStart): string {
    if ($sessionTimeStart && trim($sessionTimeStart) !== '') return $sessionTimeStart;
    $series = get_series_for_date($db, $date) ?? get_series_by_weekday($db, $date);
    if ($series && $series['time_start']) return $series['time_start'];
    $val = $db->query("SELECT value FROM config WHERE key='srtimestart'")->fetchColumn();
    return $val ?: '19:00';
}

// ── Auth ──
function token_valid(bool $require_admin = false): bool {
    $token = $_SERVER['HTTP_X_TOKEN'] ?? '';
    if (!$token) return false;
    $db = db();
    $stmt = $db->prepare("SELECT admin, exp FROM login_sessions WHERE token=?");
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) return false;
    if ($row['exp'] < time()) {
        $db->prepare("DELETE FROM login_sessions WHERE token=?")->execute([$token]);
        return false;
    }
    if ($require_admin && !$row['admin']) return false;
    return true;
}
function token_player(string $token): ?string {
    $db = db();
    $stmt = $db->prepare("SELECT player_id FROM login_sessions WHERE token=?");
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    return $row ? $row['player_id'] : null;
}
function require_auth(bool $admin = false): void {
    if (!token_valid($admin)) err('Unauthorized.', 401);
}

// ── Router ──
$method = $_SERVER['REQUEST_METHOD'];
$path   = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
// Strip base path if needed (e.g. /padel/api.php/players → players)
$path = preg_replace('#^.*api\.php/?#', '', $path);
$parts = explode('/', $path);
$resource = $parts[0] ?? '';
$id = $parts[1] ?? null;

$maxRetries = 1;
for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
    ob_start();
    try {
        match(true) {
            // ── Auth ──
            $resource === 'auth' && $method === 'POST' => handle_auth(),
            $resource === 'auth' && $method === 'DELETE' => handle_logout(),
            $resource === 'me' && $method === 'GET' => handle_me(),

            // ── Players (admin only write, all read) ──
            $resource === 'players' && $method === 'GET' && !$id  => handle_players_list(),
            $resource === 'players' && $method === 'POST'         => handle_player_create(),
            $resource === 'players' && $method === 'PUT'    && $id  => handle_player_update($id),
            $resource === 'players' && $method === 'DELETE' && $id && ($parts[2] ?? '') === 'purge' => handle_player_purge($id),
            $resource === 'players' && $method === 'DELETE' && $id => handle_player_delete($id),

            // ── Transactions ──
            $resource === 'transactions' && $method === 'GET'    => handle_tx_list(),
            $resource === 'transactions' && $method === 'POST' && !$id => handle_tx_create(),
            $resource === 'transactions' && $method === 'PUT'    && $id => handle_tx_update($id),
            $resource === 'transactions' && $method === 'DELETE' && $id => handle_tx_delete($id),

            // ── Expenses ──
            $resource === 'expenses' && $method === 'GET'        => handle_expenses_list(),
            $resource === 'expenses' && $method === 'POST' && !$id => handle_expense_create(),
            $resource === 'expenses' && $method === 'PUT'  && $id => handle_expense_update($id),
            $resource === 'expenses' && $method === 'DELETE' && $id => handle_expense_delete($id),

            // ── Sessions ──
            $resource === 'sessions' && $method === 'GET'        => handle_sessions_list(),
            $resource === 'sessions' && $method === 'PUT'  && $id => handle_session_update($id),
            $resource === 'sessions' && $method === 'DELETE' && $id => handle_session_delete($id),
            $resource === 'charge'   && $method === 'POST'       => handle_charge(),
            $resource === 'sessions' && $method === 'POST' && ($parts[2] ?? '') === 'book' => handle_session_book($id),
            $resource === 'sessions' && $method === 'POST' && ($parts[2] ?? '') === 'leave' => handle_session_leave($id),
            $resource === 'sessions' && $method === 'POST' && ($parts[2] ?? '') === 'join-waitlist' => handle_session_join_waitlist($id),

            // ── Session History ──
            $resource === 'session-history' && $method === 'GET' => handle_session_history_get(),

            // ── Series ──
            $resource === 'series' && $method === 'GET'        => handle_series_list(),
            $resource === 'series' && $method === 'POST' && !$id => handle_series_create(),
            $resource === 'series' && $method === 'PUT'  && $id => handle_series_update($id),
            $resource === 'series' && $method === 'DELETE' && $id => handle_series_delete($id),

            // ── PWA Manifest (public) ──
            $resource === 'manifest' && $method === 'GET'        => handle_manifest(),

            // ── Config ──
            $resource === 'config' && $method === 'GET'          => handle_config_get(),
            $resource === 'config' && $method === 'PUT'          => handle_config_set(),
            $resource === 'config' && $method === 'POST'         => handle_config_set(),

            // ── State dump (migration import) ──
            $resource === 'import' && $method === 'POST'         => handle_import(),
            $resource === 'export' && $method === 'GET'          => handle_export(),

            // ── System ──
            $resource === 'system' && $method === 'POST' && $id === 'init' => handle_system_init(),

            // ── Test-Reset (E2E only) ──
            $resource === 'test-reset' && $method === 'POST' => handle_test_reset(),

            default => err('Unknown endpoint.', 404)
            
        };
    } catch (Throwable $e) {
        ob_end_clean();
        if ($attempt < $maxRetries) {
            error_log('DB-Retry: ' . $e->getMessage());
            init_db(db());
            header('X-DB-Init: 1');
            continue;
        }
        error_log('Unhandled error: ' . $e->__toString());
        err('Internal server error. Please contact the administrator.', 500);
    }
}

// ════════════════════════════════════════════════
// HANDLERS
// ════════════════════════════════════════════════

// ── Auth ──
function handle_auth(): void {
    $b = body();
    $pin = $b['pin'] ?? '';
    $pid = $b['player_id'] ?? null;
    $db  = db();

    if (!$pid) err('player_id is required.');

    // Rate limiting: check login attempts
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $key = $ip . ':' . $pid;

    // Get current attempts record
    $stmt = $db->prepare("SELECT attempts, locked_since FROM login_attempts WHERE ip = ?");
    $stmt->execute([$key]);
    $attempt = $stmt->fetch();

    if ($attempt) {
        $attempts = (int)$attempt['attempts'];
        $lockedSince = $attempt['locked_since'] ?? null;

        // Check if currently locked
        if ($attempts >= 3 && $lockedSince !== null) {
            $lockoutSeconds = 5 * pow(2, floor($attempts / 3) - 1) * 60; // in seconds
            $elapsed = time() - $lockedSince;

            if ($elapsed < $lockoutSeconds) {
                $remainingMinutes = ceil(($lockoutSeconds - $elapsed) / 60);
                err("Zu viele Fehlversuche. Bitte in $remainingMinutes Minute(n) erneut versuchen.", 429);
            }
            // Lock expired, continue (attempts stay for next level)
        }
    }

    // Get player with admin flag
    $stmt = $db->prepare("SELECT pin_hash, admin FROM players WHERE id=?");
    $stmt->execute([$pid]);
    $player = $stmt->fetch();
    if (!$player) err('Player not found.', 404);

    // Verify PIN
    if ($player['pin_hash'] && !password_verify($pin, $player['pin_hash'])) {
        // Increment attempts
        $currentAttempts = $attempt ? (int)$attempt['attempts'] : 0;
        $newAttempts = $currentAttempts + 1;

        $lockedSince = null;
        // Set lock when attempts reach 3, 6, 9, ... (every 3rd attempt)
        if ($newAttempts % 3 === 0) {
            $lockedSince = time();
        }

        if ($currentAttempts === 0) {
            $db->prepare("INSERT INTO login_attempts (ip, attempts, last_attempt, locked_since) VALUES (?, ?, ?, ?)")
               ->execute([$key, $newAttempts, time(), $lockedSince]);
        } else {
            $db->prepare("UPDATE login_attempts SET attempts = ?, last_attempt = ?, locked_since = ? WHERE ip = ?")
               ->execute([$newAttempts, time(), $lockedSince, $key]);
        }

        err('Invalid PIN.', 401);
    }

    // Successful login - delete attempts record (complete reset)
    $db->prepare("DELETE FROM login_attempts WHERE ip = ?")->execute([$key]);

    // Create session - admin status comes from player record
    $token = bin2hex(random_bytes(16));
    $exp   = time() + SESSION_LIFETIME;
    $isAdmin = ($player['admin'] ?? 0) == 1;

    $stmt = $db->prepare("INSERT OR REPLACE INTO login_sessions (token, admin, exp, player_id) VALUES (?, ?, ?, ?)");
    $stmt->execute([$token, $isAdmin ? 1 : 0, $exp, $pid]);

    // Update last login
    $db->prepare("UPDATE players SET last_login=? WHERE id=?")->execute([date('c'), $pid]);

    json_out(['token' => $token, 'admin' => $isAdmin, 'exp' => $exp, 'player_id' => $pid]);
}

function handle_logout(): void {
    $token = $_SERVER['HTTP_X_TOKEN'] ?? '';
    if ($token) {
        db()->prepare("DELETE FROM login_sessions WHERE token=?")->execute([$token]);
    }
    json_out(['ok' => true]);
}

function handle_me(): void {
    require_auth();
    $token = $_SERVER['HTTP_X_TOKEN'] ?? '';
    $pid = token_player($token);
    $isAdmin = token_valid(true);
    json_out(['player_id' => $pid, 'admin' => $isAdmin]);
}

// ── Players ──
function handle_players_list(): void {
    // public endpoint
    $rows = db()->query("SELECT id, name, contact, created_at, last_login, last_interaction, admin, emoji, active, language, theme FROM players ORDER BY name")->fetchAll();
    
    // Attach balance
    foreach ($rows as &$p) {
        $stmt = db()->prepare("SELECT SUM(CASE WHEN credit=1 THEN amount ELSE -amount END) FROM transactions WHERE player_id=?");
        $stmt->execute([$p['id']]);
        $p['balance'] = (float)($stmt->fetchColumn() ?? 0);

        $stmtDeposits = db()->prepare("SELECT SUM(amount) FROM transactions WHERE player_id=? AND credit=1");
        $stmtDeposits->execute([$p['id']]);
        $p['total_deposits'] = (float)($stmtDeposits->fetchColumn() ?? 0);
    }
    
    json_out($rows);
}

function handle_player_create(): void {
    $b = body();
    if (empty($b['name'])) err('Name is required.');
    if (mb_strlen($b['name']) > 100) err('Name too long.');
    if (isset($b['pin']) && $b['pin'] !== '' && (strlen($b['pin']) !== 4 || !ctype_digit($b['pin']))) err('PIN must be 4 digits.');
    
    $db = db();
    
    // HENNE-EI: Check if DB is empty
    $count = $db->query("SELECT COUNT(*) FROM players")->fetchColumn();
    
    if ($count == 0) {
        // First player ever - no auth required, auto-make admin
        $id = gid();
        $pin_hash = isset($b['pin']) && $b['pin'] ? password_hash($b['pin'], PASSWORD_DEFAULT) : null;
        $stmt = $db->prepare("INSERT INTO players (id,name,contact,pin_hash,created_at,admin) VALUES (?,?,?,?,?,1)");
        $stmt->execute([$id, $b['name'], $b['contact'] ?? null, $pin_hash, date('c')]);
        json_out(['id' => $id, 'name' => $b['name'], 'admin' => true], 201);
    } else {
        // Normal flow - require admin
        require_auth(true);
        $id = gid();
        $pin_hash = isset($b['pin']) && $b['pin'] ? password_hash($b['pin'], PASSWORD_DEFAULT) : null;
        $admin_flag = isset($b['admin']) && $b['admin'] ? 1 : 0;
        $stmt = $db->prepare("INSERT INTO players (id,name,contact,pin_hash,created_at,admin) VALUES (?,?,?,?,?,?)");
        $stmt->execute([$id, $b['name'], $b['contact'] ?? null, $pin_hash, date('c'), $admin_flag]);
        json_out(['id' => $id, 'name' => $b['name']], 201);
    }
}

function handle_player_update(string $id): void {
    // 1. Prüfen, ob der User überhaupt eingeloggt ist
    require_auth(); 
    $db = db();
    $b = body();
    
    // 2. Berechtigung: Admin ODER der User selbst
    $isAdmin = token_valid(true); 
    $token = $_SERVER['HTTP_X_TOKEN'] ?? '';
    $currentPlayerId = token_player($token);

    if (!$isAdmin && $currentPlayerId !== $id) {
        err('Not authorized to modify this profile.', 403);
    }

    // --- PIN ÄNDERN ---
    if (isset($b['pin']) && !empty($b['pin'])) {
        if (strlen($b['pin']) !== 4 || !ctype_digit($b['pin'])) err('PIN must be 4 digits.');

        // SECURITY: If not admin, old PIN must be correct!
        if (!$isAdmin) {
            if (empty($b['old_pin'])) {
                err('Please enter your current PIN to confirm.', 400);
            }
            
            // Get old hash from DB
            $stmt = $db->prepare("SELECT pin_hash FROM players WHERE id=?");
            $stmt->execute([$id]);
            $currentHash = $stmt->fetchColumn();
            
            // Verify password
            if (!$currentHash || !password_verify($b['old_pin'], $currentHash)) {
                err('Current PIN is incorrect.', 401);
            }
        }

        // Neue PIN hashen und speichern
        $hash = password_hash($b['pin'], PASSWORD_DEFAULT);
        $db->prepare("UPDATE players SET pin_hash=? WHERE id=?")->execute([$hash, $id]);
    }
    
    // --- ANDERE FELDER ---
    if (isset($b['name'])) {
        if (mb_strlen($b['name']) > 100) err('Name too long.');
        $db->prepare("UPDATE players SET name=? WHERE id=?")->execute([$b['name'], $id]);
    }
    if (isset($b['contact'])) $db->prepare("UPDATE players SET contact=? WHERE id=?")->execute([$b['contact'], $id]);
    if (array_key_exists('emoji', $b)) $db->prepare("UPDATE players SET emoji=? WHERE id=?")->execute([$b['emoji'], $id]);
    if (array_key_exists('language', $b)) {
        $lang = $b['language'];
        if ($lang === null || $lang === '') {
            $db->prepare("UPDATE players SET language=NULL WHERE id=?")->execute([$id]);
        } elseif (in_array($lang, ['de', 'en', 'es', 'it', 'fr'], true)) {
            $db->prepare("UPDATE players SET language=? WHERE id=?")->execute([$lang, $id]);
        }
    }
    if (array_key_exists('theme', $b)) {
        $theme = $b['theme'];
        if ($theme === null || $theme === '' || $theme === 'auto') {
            $db->prepare("UPDATE players SET theme=NULL WHERE id=?")->execute([$id]);
        } elseif (in_array($theme, ['dark', 'light'], true)) {
            $db->prepare("UPDATE players SET theme=? WHERE id=?")->execute([$theme, $id]);
        }
    }
    
    // --- ADMIN STATUS ÄNDERN ---
    // Nur echte Admins dürfen den Admin-Status anderer ändern
    if ($isAdmin && isset($b['admin'])) {
        $db->prepare("UPDATE players SET admin=? WHERE id=?")->execute([$b['admin'] ? 1 : 0, $id]);
    }

    // --- REAKTIVIEREN ---
    if ($isAdmin && isset($b['active'])) {
        $db->prepare("UPDATE players SET active=? WHERE id=?")->execute([$b['active'] ? 1 : 0, $id]);
    }
    
    json_out(['ok' => true]);
}

function handle_player_delete(string $id): void {
    require_auth(true);
    $db = db();
    $db->prepare("UPDATE courts SET player_id=NULL WHERE player_id=? OR player_id=? OR player_id=?")->execute([$id, $id.'|g1', $id.'|g2']);
    // Wartelisten-Einträge entfernen
    $wlSessions = $db->query("SELECT date, waitlist FROM sessions")->fetchAll();
    foreach ($wlSessions as $s) {
        $wl = json_decode($s['waitlist'], true) ?? [];
        $changed = false;
        foreach ($wl as $k => $v) {
            $base = explode('|', $v)[0];
            if ($base === $id) { unset($wl[$k]); $changed = true; }
        }
        if ($changed) {
            $wl = array_values($wl);
            $db->prepare("UPDATE sessions SET waitlist=? WHERE date=?")->execute([json_encode($wl), $s['date']]);
        }
    }
    $db->prepare("UPDATE players SET active=0 WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

function handle_player_purge(string $id): void {
    require_auth(true);
    $db = db();
    $db->prepare("UPDATE courts SET player_id=NULL WHERE player_id=? OR player_id=? OR player_id=?")->execute([$id, $id.'|g1', $id.'|g2']);
    $db->prepare("UPDATE transactions SET player_id='_deleted_' WHERE player_id=? OR player_id=? OR player_id=?")
        ->execute([$id, $id.'|g1', $id.'|g2']);
    $db->prepare("DELETE FROM players WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

// ── Transactions ──
function handle_tx_list(): void {
    require_auth();
    $token = $_SERVER['HTTP_X_TOKEN'] ?? '';
    $db    = db();
    
    // Prüfen, ob der Token zu einem Admin gehört
    if (token_valid(true)) { 
        // Admin: Darf alles sehen
        $stmt = $db->query("SELECT * FROM transactions ORDER BY created_at DESC");
    } else {
        // Normaler Spieler: Nur eigene Transaktionen
        $pid = token_player($token);
        $stmt = $db->prepare("SELECT * FROM transactions WHERE player_id=? ORDER BY created_at DESC");
        $stmt->execute([$pid]);
    }
    
    json_out($stmt->fetchAll());
}

function handle_tx_create(): void {
    require_auth(true);
    $b = body();
    if (empty($b['player_id']) || !isset($b['amount'])) err('Fields are missing.');
    $id = gid();
    $stmt = db()->prepare("INSERT INTO transactions (id,player_id,credit,amount,date,created_at,note) VALUES (?,?,?,?,?,?,?)");
    $stmt->execute([$id, $b['player_id'], $b['credit'] ? 1 : 0, (float)$b['amount'],
        $b['date'] ?? date('Y-m-d'), date('c'), $b['note'] ?? null]);
    json_out(['id' => $id], 201);
}

// ── Sessions ──
function handle_tx_update(?string $id): void {
    require_auth(true);
    if (!$id) err('Missing ID.');
    $b = body();
    $amt = (float)($b['amount'] ?? 0);
    if ($amt <= 0) err('Invalid amount.');
    $stmt = db()->prepare("UPDATE transactions SET amount=?, note=?, date=? WHERE id=?");
    $stmt->execute([$amt, $b['note'] ?? null, $b['date'] ?? date('Y-m-d'), $id]);
    json_out(['ok' => true]);
}

function handle_tx_delete(?string $id): void {
    require_auth(true);
    if (!$id) err('Missing ID.');
    db()->prepare("DELETE FROM transactions WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

function handle_sessions_list(): void {
    // public endpoint
    $db   = db();
    $rows = $db->query("SELECT * FROM sessions")->fetchAll();
    $out  = [];
    foreach ($rows as $s) {
        $courts_raw = $db->prepare("SELECT court_index, slot_index, player_id FROM courts WHERE session_date=? ORDER BY court_index, slot_index");
        $courts_raw->execute([$s['date']]);
        $slots = $courts_raw->fetchAll();
        // Rebuild courts array
        $courts = [];
        foreach ($slots as $sl) {
            $courts[$sl['court_index']][$sl['slot_index']] = $sl['player_id'];
        }
        ksort($courts);
        foreach ($courts as &$c) ksort($c);
        // Vollständiges N×4-Array bauen (fehlende Slots mit null auffüllen)
        $numCourts = intval($db->query("SELECT value FROM config WHERE key='courts'")->fetchColumn() ?: 2);
        $fullCourts = [];
        for ($ci = 0; $ci < $numCourts; $ci++) {
            for ($si = 0; $si < 4; $si++) {
                $fullCourts[$ci][$si] = $courts[$ci][$si] ?? null;
            }
        }
        $out[] = [
            'date'           => $s['date'],
            'charged'        => (bool)$s['charged'],
            'disabledCourts' => json_decode($s['disabled_courts'], true),
            'waitlist'       => json_decode($s['waitlist'], true),
            'courts'         => array_values(array_map('array_values', $fullCourts)),
            'note'           => $s['note'] ?? '',
            'timeStart'      => $s['time_start'] ?? null,
            'timeEnd'        => $s['time_end']   ?? null,
            'cancelled'      => (bool)($s['cancelled'] ?? 0),
            'location'       => $s['location'] ?? null,
            'price'          => isset($s['price']) && $s['price'] !== null ? (float)$s['price'] : null,
            'cancelHours'    => isset($s['cancel_hours']) && $s['cancel_hours'] !== null ? (float)$s['cancel_hours'] : null,
            'name'           => $s['name'] ?? null,
            'courtNames'     => json_decode($s['court_names'] ?? '[]', true) ?: [],
        ];
    }
    json_out($out);
}

// ── Series ──
function handle_series_list(): void {
    // public endpoint
    $db   = db();
    $rows = $db->query("SELECT * FROM series ORDER BY id ASC")->fetchAll();
    $out  = [];
    foreach ($rows as $r) {
        $out[] = [
            'id'           => (int)$r['id'],
            'name'         => $r['name'] ?? '',
            'enabled'      => (bool)$r['enabled'],
            'daysOfWeek'   => json_decode($r['days_of_week'], true) ?? [2],
            'occurrences'  => (int)$r['occurrences'],
            'timeStart'    => $r['time_start'] ?? '19:00',
            'timeEnd'      => $r['time_end']   ?? '21:00',
            'courts'       => (int)$r['courts'],
            'price'        => isset($r['price']) && $r['price'] !== null ? (float)$r['price'] : null,
            'location'     => $r['location'] ?? null,
            'cancelHours'  => isset($r['cancel_hours']) && $r['cancel_hours'] !== null ? (float)$r['cancel_hours'] : null,
            'createdAt'    => $r['created_at'],
            'courtNames'   => json_decode($r['court_names'] ?? '[]', true) ?: [],
        ];
    }
    json_out($out);
}

function handle_series_create(): void {
    require_auth(true);
    $b  = body();
    $db = db();
    $name = $b['name'] ?? 'Neue Serie';
    $days = $b['daysOfWeek'] ?? [2];
    $occ  = (int)($b['occurrences'] ?? 6);
    $ts   = $b['timeStart'] ?? '19:00';
    $te   = $b['timeEnd']   ?? '21:00';
    $co   = (int)($b['courts'] ?? 2);
    $pr   = isset($b['price']) && $b['price'] !== '' ? (float)$b['price'] : null;
    $loc  = $b['location'] ?? null;
    $ch   = isset($b['cancelHours']) && $b['cancelHours'] !== '' ? (float)$b['cancelHours'] : null;
    $cn   = isset($b['courtNames']) && is_array($b['courtNames']) ? json_encode(array_values($b['courtNames'])) : null;
    $db->prepare("INSERT INTO series (name, days_of_week, occurrences, time_start, time_end, courts, price, location, cancel_hours, court_names) VALUES (?,?,?,?,?,?,?,?,?,?)")
       ->execute([$name, json_encode($days), $occ, $ts, $te, $co, $pr, $loc, $ch, $cn]);
    json_out(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

function handle_series_update(int $id): void {
    require_auth(true);
    $b  = body();
    $db = db();
    $fields = [];
    $params = [];
    if (isset($b['name'])) { $fields[] = 'name=?'; $params[] = $b['name']; }
    if (isset($b['enabled'])) { $fields[] = 'enabled=?'; $params[] = $b['enabled'] ? 1 : 0; }
    if (isset($b['daysOfWeek'])) { $fields[] = 'days_of_week=?'; $params[] = json_encode($b['daysOfWeek']); }
    if (isset($b['occurrences'])) { $fields[] = 'occurrences=?'; $params[] = (int)$b['occurrences']; }
    if (isset($b['timeStart'])) { $fields[] = 'time_start=?'; $params[] = $b['timeStart']; }
    if (isset($b['timeEnd'])) { $fields[] = 'time_end=?'; $params[] = $b['timeEnd']; }
    if (isset($b['courts'])) { $fields[] = 'courts=?'; $params[] = (int)$b['courts']; }
    if (isset($b['price'])) { $fields[] = 'price=?'; $params[] = ($b['price'] === null || $b['price'] === '') ? null : (float)$b['price']; }
    if (isset($b['location'])) { $fields[] = 'location=?'; $params[] = $b['location']; }
    if (isset($b['cancelHours'])) { $fields[] = 'cancel_hours=?'; $params[] = ($b['cancelHours'] === null || $b['cancelHours'] === '') ? null : (float)$b['cancelHours']; }
    if (isset($b['courtNames'])) { $fields[] = 'court_names=?'; $params[] = is_array($b['courtNames']) ? json_encode(array_values($b['courtNames'])) : null; }
    if (empty($fields)) json_out(['ok' => true]);
    $params[] = $id;
    $db->prepare("UPDATE series SET " . implode(',', $fields) . " WHERE id=?")->execute($params);
    json_out(['ok' => true]);
}

function handle_series_delete(int $id): void {
    require_auth(true);
    $db = db();
    $db->prepare("DELETE FROM series WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

        function handle_session_update(string $date): void {
    require_auth(true);
    $b  = body();
    $db = db();

    // Charged-Check vor allen Mutationen
    $stmt = $db->prepare("SELECT charged FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $row = $stmt->fetch();
    if ($row && $row['charged']) {
        // Nur blocken wenn tatsächlich was geändert werden soll (reine GET-artige Aufrufe ignorieren)
        $hasMutations = isset($b['timeStart']) || isset($b['timeEnd']) || isset($b['newDate'])
            || isset($b['disabledCourts']) || isset($b['waitlist']) || isset($b['note'])
            || isset($b['location']) || isset($b['courts']) || isset($b['cancelled']) || isset($b['price'])
            || isset($b['name']);
        if ($hasMutations) {
            err('This session has already been charged. No more changes are possible.', 403);
        }
    }

    if (isset($b['timeStart'])) {
        $db->prepare("UPDATE sessions SET time_start=? WHERE date=?")
           ->execute([$b['timeStart'], $date]);
    }
    if (isset($b['timeEnd'])) {
        $db->prepare("UPDATE sessions SET time_end=? WHERE date=?")
           ->execute([$b['timeEnd'], $date]);
    }
    if (isset($b['newDate'])) {
        $newDate = $b['newDate'];
        if ($newDate === $date) json_out(['ok' => true]);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $newDate)) err('Invalid date format.', 400);

        $stmt = $db->prepare("SELECT charged FROM sessions WHERE date=? AND (cancelled IS NULL OR cancelled = 0)");
        $stmt->execute([$newDate]);
        if ($stmt->fetch()) err('Target date already exists.', 400);

        $stmt = $db->prepare("SELECT charged FROM sessions WHERE date=?");
        $stmt->execute([$date]);
        $row = $stmt->fetch();
        if ($row && $row['charged']) err('Session has already been charged. Cannot move.', 403);

        $db->exec('PRAGMA foreign_keys=OFF');
        $db->beginTransaction();
        $db->prepare("UPDATE courts SET session_date=? WHERE session_date=?")->execute([$newDate, $date]);
        $db->prepare("UPDATE session_history SET session_date=? WHERE session_date=?")->execute([$newDate, $date]);
        $db->prepare("UPDATE sessions SET date=? WHERE date=?")->execute([$newDate, $date]);
        $db->prepare("INSERT OR IGNORE INTO sessions (date, charged, disabled_courts, waitlist, note, cancelled) VALUES (?, 0, '[]', '[]', '', 1)")
           ->execute([$date]);
        $db->commit();
        $db->exec('PRAGMA foreign_keys=ON');
        json_out(['ok' => true, 'newDate' => $newDate]);
    }

    // Get performer ID (handles both player and admin sessions)
    $performed_by = get_performer_id();

    // Get current session data for comparison
    $stmt = $db->prepare("SELECT disabled_courts, waitlist FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $current = $stmt->fetch();
    $old_disabled = $current ? json_decode($current['disabled_courts'], true) : [];
    $old_waitlist = $current ? json_decode($current['waitlist'], true) : [];
    
    // Upsert session row
    $db->prepare("INSERT OR IGNORE INTO sessions (date) VALUES (?)")->execute([$date]);
    
    // Log court cancellations
    if (isset($b['disabledCourts'])) {
        $new_disabled = $b['disabledCourts'];
        $cancelled = array_diff($new_disabled, $old_disabled);
        foreach ($cancelled as $ci) {
            log_session_history($db, $date, null, 'court_cancelled', $ci, null, $performed_by);
        }
        $db->prepare("UPDATE sessions SET disabled_courts=? WHERE date=?")->execute([json_encode($b['disabledCourts']), $date]);
    }
    
    // Log waitlist changes
    if (isset($b['waitlist'])) {
        $new_waitlist = $b['waitlist'];
        // Find joined (in new but not in old)
        $joined = array_diff($new_waitlist, $old_waitlist);
        foreach ($joined as $pid) {
            log_session_history($db, $date, $pid, 'waitlist_join', null, null, $performed_by);
        }
        // Find left (in old but not in new)
        $left = array_diff($old_waitlist, $new_waitlist);
        foreach ($left as $pid) {
            log_session_history($db, $date, $pid, 'waitlist_leave', null, null, $performed_by);
        }
        $db->prepare("UPDATE sessions SET waitlist=? WHERE date=?")->execute([json_encode($b['waitlist']), $date]);
    }
    if (isset($b['note'])) {
        $db->prepare("UPDATE sessions SET note=? WHERE date=?")->execute([$b['note'], $date]);
    }
    if (isset($b['location'])) {
        $db->prepare("UPDATE sessions SET location=? WHERE date=?")->execute([$b['location'], $date]);
    }
    if (isset($b['price'])) {
        $db->prepare("UPDATE sessions SET price=? WHERE date=?")->execute([$b['price'] === null ? null : (float)$b['price'], $date]);
    }
    if (isset($b['cancelHours'])) {
        $db->prepare("UPDATE sessions SET cancel_hours=? WHERE date=?")->execute([$b['cancelHours'] === null || $b['cancelHours'] === '' ? null : (float)$b['cancelHours'], $date]);
    }
    if (isset($b['name'])) {
        $db->prepare("UPDATE sessions SET name=? WHERE date=?")->execute([$b['name'] === '' || $b['name'] === null ? null : $b['name'], $date]);
    }
    if (isset($b['courtNames'])) {
        $db->prepare("UPDATE sessions SET court_names=? WHERE date=?")->execute([is_array($b['courtNames']) ? json_encode(array_values($b['courtNames'])) : null, $date]);
    }
    if (isset($b['courts'])) {
        // Get old courts for comparison
        $stmt_old = $db->prepare("SELECT court_index, slot_index, player_id FROM courts WHERE session_date=?");
        $stmt_old->execute([$date]);
        $old_slots = [];
        foreach ($stmt_old->fetchAll() as $row) {
            $key = $row['court_index'] . '|' . $row['slot_index'];
            $old_slots[$key] = $row['player_id'];
        }
        
        // Replace all court slots
        $db->prepare("DELETE FROM courts WHERE session_date=?")->execute([$date]);
        $stmt = $db->prepare("INSERT INTO courts (session_date, court_index, slot_index, player_id) VALUES (?,?,?,?)");
        
        foreach ($b['courts'] as $ci => $slots) {
            foreach ($slots as $si => $pid) {
                $stmt->execute([$date, $ci, $si, $pid ?: null]);
                
                // Log changes
                $key = $ci . '|' . $si;
                $old_pid = $old_slots[$key] ?? null;
                
                if ($old_pid !== $pid) {
                    if ($old_pid && !$pid) {
                        // Slot was cleared (removal)
                        $base = explode('|', $old_pid)[0];
                        log_session_history($db, $date, $base, 'leave', $ci, $si, $performed_by);
                    } elseif (!$old_pid && $pid) {
                        // Slot was filled (new booking)
                        $base = explode('|', $pid)[0];
                        $isGuest = str_contains($pid, '|');
                        $details = $isGuest ? json_encode(['guest' => true, 'full_id' => $pid]) : null;
                        log_session_history($db, $date, $base, 'book', $ci, $si, $performed_by, $details);
                    } elseif ($old_pid && $pid && $old_pid !== $pid) {
                        // Slot changed from one player to another (remove old, add new)
                        $base_old = explode('|', $old_pid)[0];
                        log_session_history($db, $date, $base_old, 'leave', $ci, $si, $performed_by);
                        $base_new = explode('|', $pid)[0];
                        $isGuest = str_contains($pid, '|');
                        $details = $isGuest ? json_encode(['guest' => true, 'full_id' => $pid]) : null;
                        log_session_history($db, $date, $base_new, 'book', $ci, $si, $performed_by, $details);
                    }
                }
            }
        }
    }
    if (isset($b['interaction_pids'])) {
        $now = date('c');
        foreach ($b['interaction_pids'] as $pid) {
            $base = explode('|', $pid)[0];
            $db->prepare("UPDATE players SET last_interaction=? WHERE id=?")
            ->execute([$now, $base]);
        }
    }
    if (isset($b['cancelled'])) {
        if ($b['cancelled']) {
            $db->prepare("INSERT OR REPLACE INTO sessions (date, charged, disabled_courts, waitlist, note, cancelled) VALUES (?, 0, '[]', '[]', '', 1)")
               ->execute([$date]);
        } else {
            $db->prepare("UPDATE sessions SET cancelled=0 WHERE date=?")
               ->execute([$date]);
        }
        json_out(['ok' => true]);
    }
    json_out(['ok' => true]);
}

function handle_session_delete(string $date): void {
    require_auth(true);
    $db = db();

    $stmt = $db->prepare("SELECT charged, cancelled FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $row = $stmt->fetch();

    if (!$row) err('Session not found.', 404);
    if (!$row['cancelled']) err('Only cancelled sessions can be deleted.', 400);
    if ($row['charged']) err('Already charged sessions cannot be deleted.', 400);

    $db->prepare("DELETE FROM courts WHERE session_date=?")->execute([$date]);
    $db->prepare("DELETE FROM session_history WHERE session_date=?")->execute([$date]);
    $db->prepare("DELETE FROM sessions WHERE date=?")->execute([$date]);

    json_out(['ok' => true]);
}

// ── Expenses ──
function handle_expenses_list(): void {
    require_auth();
    $stmt = db()->query("SELECT * FROM expenses ORDER BY date DESC");
    json_out($stmt->fetchAll());
}

function handle_expense_create(): void {
    require_auth(true);
    $b = body();
    if (empty($b['amount'])) err('Amount is required.');
    $id = gid();
    $stmt = db()->prepare("INSERT INTO expenses (id, amount, date, note, created_at) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$id, (float)$b['amount'], $b['date'] ?? date('Y-m-d'), $b['note'] ?? '', date('c')]);
    json_out(['id' => $id], 201);
}

function handle_expense_update(string $id): void {
    require_auth(true);
    $b = body();
    $amt = (float)($b['amount'] ?? 0);
    if ($amt <= 0) err('Invalid amount.');
    $stmt = db()->prepare("UPDATE expenses SET amount=?, date=?, note=? WHERE id=?");
    $stmt->execute([$amt, $b['date'] ?? date('Y-m-d'), $b['note'] ?? '', $id]);
    json_out(['ok' => true]);
}

function handle_expense_delete(string $id): void {
    require_auth(true);
    db()->prepare("DELETE FROM expenses WHERE id=?")->execute([$id]);
    json_out(['ok' => true]);
}

// ── Charge ──
function handle_charge(): void {
    require_auth(true);
    $b    = body();
    $date = $b['date'] ?? '';
    // NEU: Wir holen uns die Liste der Barzahler aus dem Request
    $paidPids = $b['paid_pids'] ?? []; 
    
    if (!$date) err('Date is required.');
    $db   = db();

    $stmt = $db->prepare("SELECT charged FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $row = $stmt->fetch();
    if ($row && $row['charged']) err('Already charged.');

    $courts_stmt = $db->prepare("SELECT court_index, player_id FROM courts WHERE session_date=? AND player_id IS NOT NULL");
    $courts_stmt->execute([$date]);
    $slots = $courts_stmt->fetchAll();

    // Group by baseId
    $counts = [];
    foreach ($slots as $sl) {
        $parts = explode('|', $sl['player_id']);
        $base  = $parts[0];
        $counts[$base] = ($counts[$base] ?? 0) + 1;
    }

    $cost = (float)($db->query("SELECT value FROM config WHERE key='cost'")->fetchColumn() ?? 10);
    $now  = date('c');
    
    // Session-specific price override
    $stmt_price = $db->prepare("SELECT price FROM sessions WHERE date=?");
    $stmt_price->execute([$date]);
    $row_price = $stmt_price->fetch();
    if ($row_price && $row_price['price'] !== null) {
        $cost = (float)$row_price['price'];
    }
    
    // Vorbereitetes Statement für Transaktionen
    $tx = $db->prepare("INSERT INTO transactions (id,player_id,credit,amount,date,created_at,note) VALUES (?,?,?,?,?,?,?)");
    
    foreach ($counts as $pid => $n) {
        $amt  = $cost * $n;
        $note = $n > 1 ? "Session $date (+" . ($n-1) . " Guest)" : "Session $date";
        
        // 1. Abrechnung (Abbuchung)
        $tx->execute([gid(), $pid, 0, $amt, $date, $now, $note]);
        
        // 2. Falls Spieler in der 'paid_pids' Liste: Barzahlung/Gegenbuchung
        if (in_array($pid, $paidPids)) {
            $tx->execute([gid(), $pid, 1, $amt, $date, $now, "Direct payment $date"]);
        }
    }
    
    $db->prepare("UPDATE sessions SET charged=1 WHERE date=?")->execute([$date]);
    json_out(['ok' => true, 'charged' => count($counts), 'slots' => array_sum($counts)]);
}

// ── Config ──
function handle_config_get(): void {
    // public endpoint
    $rows = db()->query("SELECT key, value FROM config WHERE key != 'admin_pin_hash'")->fetchAll();
    $out = [];
    foreach ($rows as $r) $out[$r['key']] = $r['value'];
    $out['server_build'] = get_server_build();
    json_out($out);
}

function handle_config_set(): void {
    require_auth(true);
    $b  = body();
    $db = db();
    $allowed = [
        'currency',
        'cost',
        'courts',
        'weeks',
        'yearly',
        'pin',
        'srinterval',
        'srdays',
        'sroccurrences',
        'srtimestart',
        'srtimeend',
        'sr_enabled',
        'srlocation',
        'sr_cost',
        'display_court_grouping',
        'privacy_mode',
        'team_name',
        'cancel_hours',
        'show_cancel_deadline',
        'system_language',
        'time_format',
        'date_format',
        'auto_compact_slots',
    ];
    foreach ($b as $k => $v) {
        if (!in_array($k, $allowed, true)) continue;
        if (is_array($v) || is_object($v)) {
            $v = json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        $v = (string)$v;
        if ($k === 'courts' && ((int)$v < 1 || (int)$v > 20)) continue;
        if ($k === 'cost' && ((float)$v <= 0 || (float)$v > 999)) continue;
        if ($k === 'sr_cost' && $v !== '' && ((float)$v <= 0 || (float)$v > 999)) continue;
        if ($k === 'yearly' && ((float)$v < 0)) continue;
        if ($k === 'weeks' && ((int)$v < 1 || (int)$v > 52)) continue;
        if ($k === 'sroccurrences' && ((int)$v < 1 || (int)$v > 52)) continue;
        if ($k === 'cancel_hours' && ((float)$v < 0 || (float)$v > 168)) continue;
        if ($k === 'show_cancel_deadline' && !in_array($v, ['0', '1'], true)) continue;
        if ($k === 'currency' && (mb_strlen($v) < 1 || mb_strlen($v) > 5)) continue;
        if ($k === 'system_language' && $v !== '' && !in_array($v, ['de', 'en', 'es', 'it', 'fr', 'pt'], true)) continue;
        if ($k === 'time_format' && !in_array($v, ['24h', '12h'], true)) continue;
        if ($k === 'date_format' && !in_array($v, ['dmy', 'mdy', 'ymd'], true)) continue;
        $db->prepare("INSERT OR REPLACE INTO config VALUES (?,?)")->execute([$k, $v]);
    }
    json_out(['ok' => true]);
}

// ── PWA Manifest ──
function handle_manifest(): void {
    header('Cache-Control: no-cache');
    $db = db();
    $teamName = $db->query("SELECT value FROM config WHERE key='team_name'")->fetchColumn();
    $name = $teamName && trim($teamName) !== '' ? trim($teamName) : 'Courtle';
    json_out([
        'name' => $name,
        'short_name' => $name,
        'description' => 'Court booking app',
        'start_url' => '/',
        'scope' => '/',
        'display' => 'standalone',
        'orientation' => 'portrait',
        'background_color' => '#f7f6f2',
        'theme_color' => '#1c1b19',
        'icons' => [
            [
                'src' => '/courtle-icon.svg?v=3',
                'sizes' => 'any',
                'type' => 'image/svg+xml',
                'purpose' => 'any',
            ],
            [
                'src' => '/courtle-icon-180.png?v=3',
                'sizes' => '180x180',
                'type' => 'image/png',
                'purpose' => 'any maskable',
            ],
            [
                'src' => '/courtle-icon-192.png?v=3',
                'sizes' => '192x192',
                'type' => 'image/png',
                'purpose' => 'any maskable',
            ],
            [
                'src' => '/courtle-icon-512.png?v=3',
                'sizes' => '512x512',
                'type' => 'image/png',
                'purpose' => 'any maskable',
            ],
        ],
        'categories' => ['sports', 'utilities'],
        'lang' => 'de',
    ]);
}

// ── Export / Import (Migration) ──
function handle_export(): void {
    require_auth(true);
    $db = db();
    json_out([
        'players'        => $db->query("SELECT * FROM players")->fetchAll(),
        'transactions'   => $db->query("SELECT * FROM transactions")->fetchAll(),
        'sessions'       => $db->query("SELECT * FROM sessions")->fetchAll(),
        'courts'         => $db->query("SELECT * FROM courts")->fetchAll(),
        'expenses'       => $db->query("SELECT * FROM expenses")->fetchAll(),
        'session_history'=> $db->query("SELECT * FROM session_history")->fetchAll(),
        'config'         => $db->query("SELECT key,value FROM config")->fetchAll(),
    ]);
}

function handle_import(): void {
    require_auth(true);
    $b  = body();
    $db = db();

    $db->beginTransaction();
    $db->exec("DELETE FROM courts; DELETE FROM sessions; DELETE FROM transactions; DELETE FROM expenses; DELETE FROM players;");
    $db->exec("DELETE FROM config");

    foreach (($b['players'] ?? []) as $p) {
        $db->prepare("INSERT OR IGNORE INTO players (id,name,contact,pin_hash,created_at,last_login,last_interaction,admin,active) VALUES (?,?,?,?,?,?,?,?,?)")
            ->execute([
                $p['id'],
                $p['name'],
                $p['contact'] ?? null,
                $p['pin_hash'] ?? null,
                $p['created_at'] ?? date('c'),
                $p['last_login'] ?? null,
                $p['last_interaction'] ?? null,
                !empty($p['admin']) ? 1 : 0,
                !array_key_exists('active', $p) ? 1 : ($p['active'] ? 1 : 0)
            ]);
    }
    foreach (($b['transactions'] ?? []) as $t) {
        $db->prepare("INSERT OR IGNORE INTO transactions (id,player_id,credit,amount,date,created_at,note) VALUES (?,?,?,?,?,?,?)")
           ->execute([$t['id'], $t['player_id'], (int)$t['credit'], (float)$t['amount'], $t['date'], $t['created_at'] ?? date('c'), $t['note'] ?? null]);
    }
    foreach (($b['sessions'] ?? []) as $s) {
        $db->prepare("INSERT OR IGNORE INTO sessions (date,charged,disabled_courts,waitlist,note,time_start,time_end,cancelled,location,price,cancel_hours,name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $s['date'],
                !empty($s['charged']) ? 1 : 0,
                $s['disabled_courts'] ?? '[]',
                $s['waitlist'] ?? '[]',
                $s['note'] ?? '',
                $s['time_start'] ?? null,
                $s['time_end'] ?? null,
                !empty($s['cancelled']) ? 1 : 0,
                $s['location'] ?? null,
                isset($s['price']) && $s['price'] !== null ? (float)$s['price'] : null,
                isset($s['cancel_hours']) && $s['cancel_hours'] !== null ? (float)$s['cancel_hours'] : null,
                $s['name'] ?? null
            ]);
    }
    foreach (($b['courts'] ?? []) as $c) {
        $db->prepare("INSERT OR IGNORE INTO courts (session_date,court_index,slot_index,player_id) VALUES (?,?,?,?)")
            ->execute([$c['session_date'], (int)$c['court_index'], (int)$c['slot_index'], $c['player_id'] ?: null]);
    }
    foreach (($b['expenses'] ?? []) as $ex) {
        $db->prepare("INSERT OR IGNORE INTO expenses (id,amount,date,note,created_at) VALUES (?,?,?,?,?)")
            ->execute([
                $ex['id'],
                (float)$ex['amount'],
                $ex['date'],
                $ex['note'] ?? '',
                $ex['created_at'] ?? date('c')
            ]);
    }
    foreach (($b['session_history'] ?? []) as $sh) {
        $db->prepare("INSERT OR IGNORE INTO session_history (id,session_date,player_id,action,court_index,slot_index,timestamp,performed_by,details) VALUES (?,?,?,?,?,?,?,?,?)")
            ->execute([
                $sh['id'],
                $sh['session_date'],
                $sh['player_id'],
                $sh['action'],
                $sh['court_index'],
                $sh['slot_index'],
                $sh['timestamp'],
                $sh['performed_by'],
                $sh['details']
            ]);
    }
    foreach (($b['config'] ?? []) as $c) {
        $db->prepare("INSERT OR REPLACE INTO config VALUES (?,?)")->execute([$c['key'], (string)$c['value']]);
    }
    $db->commit();
    json_out(['ok' => true]);
}

function handle_session_book(string $date): void {
    require_auth();
    $db = db();
    $b = body();
    
    $ci = $b['court_index'] ?? null;
    $si = $b['slot_index'] ?? null;
    $pid = $b['player_id'] ?? null;
    
    if ($ci === null || $si === null || !$pid) err('Missing data.');
    
    // Nur für sich selbst buchen (oder Admin)
    $callerId = token_player($_SERVER['HTTP_X_TOKEN'] ?? '');
    $targetBase = explode('|', $pid)[0];
    if (!token_valid(true) && $callerId !== $targetBase) {
        err('You can only book for yourself.', 403);
    }

    $stmt = $db->prepare("SELECT charged, cancelled FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $row = $stmt->fetch();
    if ($row && $row['charged']) err('This session has already been charged.', 403);
    if ($row && $row['cancelled']) err('This session is cancelled.', 403);

    // If session does not exist yet in DB, validate that it is an allowed upcoming series date
    if (!$row && !token_valid(true)) {
        $today = date('Y-m-d');
        if ($date < $today) {
            err('Cannot book past dates.', 400);
        }
        $series = get_series_for_date($db, $date);
        if (!$series) {
            err('Session date is not part of an active series.', 400);
        }
        $allowedCourts = (int)($series['courts'] ?? ($db->query("SELECT value FROM config WHERE key='courts'")->fetchColumn() ?: 2));
        if ($ci < 0 || $ci >= $allowedCourts) {
            err('Invalid court index.', 400);
        }
    }

    // Transaktion mit IMMEDIATE-Lock: SELECT + INSERT/UPDATE atomar, keine TOCTOU-Race-Condition
    $db->exec('BEGIN IMMEDIATE');
    
    $db->prepare("INSERT OR IGNORE INTO sessions (date) VALUES (?)")->execute([$date]);

    $stmt = $db->prepare("SELECT player_id FROM courts WHERE session_date=? AND court_index=? AND slot_index=?");
    $stmt->execute([$date, $ci, $si]);
    $existing = $stmt->fetch();
    
    if ($existing && !empty($existing['player_id'])) {
        $db->exec('ROLLBACK');
        err('Too late! Someone else grabbed this court at exactly this second.', 409);
    }
    
    // Extract base player ID (handle guest IDs like playerId|g1)
    $base = explode('|', $pid)[0];
    $isGuest = str_contains($pid, '|');
    
    // Court sichern! (Entweder Reihe auf den Spieler updaten oder neu anlegen)
    if ($existing) {
        $db->prepare("UPDATE courts SET player_id=? WHERE session_date=? AND court_index=? AND slot_index=?")->execute([$pid, $date, $ci, $si]);
    } else {
        $db->prepare("INSERT INTO courts (session_date, court_index, slot_index, player_id) VALUES (?,?,?,?)")->execute([$date, $ci, $si, $pid]);
    }
    
    $db->exec('COMMIT');
    
    // Log the booking (use base ID for foreign key constraint)
    $performed_by = get_performer_id();
    $details = $isGuest ? json_encode(['guest' => true, 'full_id' => $pid]) : null;
    log_session_history($db, $date, $base, 'book', $ci, $si, $performed_by, $details);
    
    $db->prepare("UPDATE players SET last_interaction=? WHERE id=?")->execute([date('c'), $base]);
    
    json_out(['ok' => true]);
}


function handle_session_leave(string $date): void {
    require_auth();
    $db = db();
    $b = body();
    
    $baseId = $b['player_id'] ?? null; 
    $ci = $b['court_index'] ?? null;   
    $si = $b['slot_index'] ?? null;
    
    // Nur für sich selbst abmelden (oder Admin)
    $callerId = token_player($_SERVER['HTTP_X_TOKEN'] ?? '');
    $targetBase = $baseId ? explode('|', $baseId)[0] : null;
    if (!token_valid(true) && (!$targetBase || $callerId !== $targetBase)) {
        err('You can only remove yourself.', 403);
    }
    
    $performed_by = get_performer_id();
    
    // Transaktion mit IMMEDIATE-Lock, um Race-Conditions in der Waitlist-Promotion zu vermeiden
    $db->exec('BEGIN IMMEDIATE');
    
    $stmt = $db->prepare("SELECT * FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $sess = $stmt->fetch();
    if ($sess && $sess['charged']) { $db->exec('ROLLBACK'); err('Already charged.', 403); }

    // Cancel deadline check (only for non-admins)
    if (!token_valid(true)) {
        $cancelHours = isset($sess['cancel_hours']) && $sess['cancel_hours'] !== null ? (float)$sess['cancel_hours'] : null;
        $effectiveHours = get_effective_cancel_hours($db, $date, $cancelHours);
        $timeStart = get_effective_time_start($db, $date, $sess['time_start'] ?? null);
        $timeFormatted = strlen($timeStart) === 4 ? substr($timeStart, 0, 2) . ':' . substr($timeStart, 2) : $timeStart;
        $sessionTimestamp = strtotime($date . ' ' . $timeFormatted);
        $deadline = $sessionTimestamp - ($effectiveHours * 3600);
        if (time() >= $deadline) {
            $db->exec('ROLLBACK');
            $deadlineStr = date('d.m.Y H:i', $deadline);
            err("Abmeldefrist abgelaufen. Abmeldung war nur bis $deadlineStr möglich.", 403);
        }
    }
    
    $freed_slots = [];
    
    // Fall 1: Nur einen gezielten Slot leeren (z.B. Gast entfernen) -> UPDATE auf NULL
    if ($ci !== null && $si !== null) {
        $stmt = $db->prepare("SELECT player_id FROM courts WHERE session_date=? AND court_index=? AND slot_index=?");
        $stmt->execute([$date, $ci, $si]);
        $slot_data = $stmt->fetch();
        if ($slot_data && $slot_data['player_id']) {
            $freed_slots[] = [
                'court_index' => $ci, 
                'slot_index' => $si,
                'player_id' => $slot_data['player_id']
            ];
        }
        $db->prepare("UPDATE courts SET player_id = NULL WHERE session_date=? AND court_index=? AND slot_index=?")->execute([$date, $ci, $si]);
    } 
    // Fall 2: Kompletten Spieler (inkl. Gäste) vom ganzen Tag abmelden -> UPDATE auf NULL
    elseif ($baseId) {
        $stmt = $db->prepare("SELECT court_index, slot_index, player_id FROM courts WHERE session_date=? AND (player_id=? OR player_id=? OR player_id=?)");
        $stmt->execute([$date, $baseId, $baseId . '|g1', $baseId . '|g2']);
        $freed_slots = $stmt->fetchAll();
        
        $db->prepare("UPDATE courts SET player_id = NULL WHERE session_date=? AND (player_id=? OR player_id=? OR player_id=?)")->execute([$date, $baseId, $baseId . '|g1', $baseId . '|g2']);
        
        // War der User auf der Warteliste?
        $waitlist = json_decode($sess['waitlist'] ?? '[]', true);
        if (in_array($baseId, $waitlist)) {
            $waitlist = array_values(array_filter($waitlist, fn($x) => $x !== $baseId));
            $db->prepare("UPDATE sessions SET waitlist=? WHERE date=?")->execute([json_encode($waitlist), $date]);
            $sess['waitlist'] = json_encode($waitlist);
        }
    } else {
        $db->exec('ROLLBACK');
        err('Missing data.');
    }

    // Log the cancellations (use base ID for foreign key constraint)
    foreach ($freed_slots as $slot) {
        $log_player_id = $baseId ?? ($slot['player_id'] ? explode('|', $slot['player_id'])[0] : null);
        if ($log_player_id) {
            log_session_history($db, $date, $log_player_id, 'leave', $slot['court_index'], $slot['slot_index'], $performed_by);
        }
    }

    // 🏆 Auto-Nachrücken (Compaction) oder Standard-Warteliste
    $autoCompact = $db->query("SELECT value FROM config WHERE key='auto_compact_slots'")->fetchColumn() === '1';

    if ($autoCompact) {
        $disabledCourts = json_decode($sess['disabled_courts'] ?? '[]', true) ?: [];
        $numCourts = (int)($db->query("SELECT value FROM config WHERE key='courts'")->fetchColumn() ?: 2);

        // Aktive Courts in Reihenfolge ermitteln
        $activeCourtIndices = [];
        for ($cIdx = 0; $cIdx < $numCourts; $cIdx++) {
            if (!in_array($cIdx, $disabledCourts, true)) {
                $activeCourtIndices[] = $cIdx;
            }
        }
        $totalActiveCapacity = count($activeCourtIndices) * 4;

        // Alle verbleibenden Spieler in bisheriger Reihenfolge holen
        $stmtP = $db->prepare("SELECT player_id FROM courts WHERE session_date=? AND player_id IS NOT NULL AND player_id != '' ORDER BY court_index ASC, slot_index ASC");
        $stmtP->execute([$date]);
        $activePlayers = $stmtP->fetchAll(PDO::FETCH_COLUMN);

        // Warteliste frisch aus DB lesen
        $wlStmt = $db->prepare("SELECT waitlist FROM sessions WHERE date=?");
        $wlStmt->execute([$date]);
        $waitlist = json_decode($wlStmt->fetchColumn() ?: '[]', true) ?: [];

        // Falls Kapazität frei und Warteliste gefüllt ist, nachrücken lassen
        while (count($activePlayers) < $totalActiveCapacity && !empty($waitlist)) {
            $next_player = array_shift($waitlist);
            $activePlayers[] = $next_player;
            log_session_history($db, $date, $next_player, 'promoted', null, null, $performed_by, json_encode(['from_waitlist' => true]));
        }
        $db->prepare("UPDATE sessions SET waitlist=? WHERE date=?")->execute([json_encode(array_values($waitlist)), $date]);

        // Courts leeren und lückenlos von oben nach unten (Court 0 Slot 0 ...) neu auffüllen
        $db->prepare("DELETE FROM courts WHERE session_date=?")->execute([$date]);
        $ins = $db->prepare("INSERT INTO courts (session_date, court_index, slot_index, player_id) VALUES (?,?,?,?)");
        $pIdx = 0;
        foreach ($activeCourtIndices as $cIdx) {
            for ($sIdx = 0; $sIdx < 4; $sIdx++) {
                if (isset($activePlayers[$pIdx])) {
                    $ins->execute([$date, $cIdx, $sIdx, $activePlayers[$pIdx]]);
                    $pIdx++;
                }
            }
        }
    } else {
        // Standard ohne Nachrücken: Nachrücker von der Warteliste direkt in die freigewordenen Slots
        $wlStmt = $db->prepare("SELECT waitlist FROM sessions WHERE date=?");
        $wlStmt->execute([$date]);
        $waitlist = json_decode($wlStmt->fetchColumn() ?: '[]', true) ?: [];
        
        if (!empty($waitlist) && !empty($freed_slots)) {
            foreach ($freed_slots as $slot) {
                if (empty($waitlist)) break;
                $next_player = array_shift($waitlist);
                $db->prepare("UPDATE courts SET player_id = ? WHERE session_date=? AND court_index=? AND slot_index=?")
                   ->execute([$next_player, $date, $slot['court_index'], $slot['slot_index']]);
                // Log the promotion
                log_session_history($db, $date, $next_player, 'promoted', $slot['court_index'], $slot['slot_index'], $performed_by, json_encode(['from_waitlist' => true]));
            }
            $db->prepare("UPDATE sessions SET waitlist=? WHERE date=?")->execute([json_encode(array_values($waitlist)), $date]);
        }
    }
    
    $db->exec('COMMIT');
    
    if ($baseId) {
        $db->prepare("UPDATE players SET last_interaction=? WHERE id=?")->execute([date('c'), $baseId]);
    }
    
    json_out(['ok' => true]);
}

function handle_session_join_waitlist(string $date): void {
    require_auth();
    $db = db();
    $b = body();
    
    $player_id = $b['player_id'] ?? null;
    if (!$player_id) err('Missing player_id.');
    
    // Nur sich selbst auf Warteliste setzen (oder Admin)
    $callerId = token_player($_SERVER['HTTP_X_TOKEN'] ?? '');
    $targetBase = explode('|', $player_id)[0];
    if (!token_valid(true) && $callerId !== $targetBase) {
        err('You can only add yourself to the waitlist.', 403);
    }
    
    $performed_by = get_performer_id();
    
    $stmt = $db->prepare("SELECT charged, cancelled, waitlist FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $sess = $stmt->fetch();

    if ($sess) {
        if ($sess['charged']) err('This session has already been charged.', 403);
        if ($sess['cancelled']) err('This session is cancelled.', 403);
    } elseif (!token_valid(true)) {
        $today = date('Y-m-d');
        if ($date < $today) {
            err('Cannot join waitlist for past dates.', 400);
        }
        $series = get_series_for_date($db, $date);
        if (!$series) {
            err('Session date is not part of an active series.', 400);
        }
    }

    $db->exec('BEGIN IMMEDIATE');
    
    $db->prepare("INSERT OR IGNORE INTO sessions (date) VALUES (?)")->execute([$date]);

    $stmt = $db->prepare("SELECT waitlist FROM sessions WHERE date=?");
    $stmt->execute([$date]);
    $sess = $stmt->fetch();
    if (!$sess) { $db->exec('ROLLBACK'); err('Session not found.', 404); }
    
    $waitlist = json_decode($sess['waitlist'] ?? '[]', true);
    if (in_array($player_id, $waitlist)) {
        $db->exec('ROLLBACK');
        err('Already on waitlist.');
    }
    
    $waitlist[] = $player_id;
    $db->prepare("UPDATE sessions SET waitlist=? WHERE date=?")->execute([json_encode($waitlist), $date]);
    
    $db->exec('COMMIT');
    
    log_session_history($db, $date, $player_id, 'waitlist_join', null, null, $performed_by);
    
    json_out(['ok' => true]);
}

// ── Session History ──
function handle_session_history_get(): void {
    require_auth(true); // Admin only
    $date = $_GET['date'] ?? '';
    $db = db();
    
    if ($date) {
        $stmt = $db->prepare("
            SELECT sh.*, 
                   p.name as player_name, 
                   p2.name as performed_by_name
            FROM session_history sh 
            LEFT JOIN players p ON sh.player_id = p.id 
            LEFT JOIN players p2 ON sh.performed_by = p2.id 
            WHERE sh.session_date = ? 
            ORDER BY sh.timestamp DESC
        ");
        $stmt->execute([$date]);
    } else {
        $stmt = $db->query("
            SELECT sh.*, 
                   p.name as player_name, 
                   p2.name as performed_by_name
            FROM session_history sh 
            LEFT JOIN players p ON sh.player_id = p.id 
            LEFT JOIN players p2 ON sh.performed_by = p2.id 
            ORDER BY sh.timestamp DESC LIMIT 100
        ");
    }
    
    json_out($stmt->fetchAll());
}
