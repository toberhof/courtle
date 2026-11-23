<?php
// ═══════════════════════════════════════════════
//  Courtle – API Backend
//  PHP 8.4 + SQLite (PDO)
// ═══════════════════════════════════════════════

// Optional environment bootstrap (allows custom storage routing, proxies, or subpath setups)
if (file_exists(__DIR__ . '/core/bootstrap.php')) {
    require_once __DIR__ . '/core/bootstrap.php';
}

if (!defined('DB_PATH')) {
    define('DB_PATH', getenv('COURTLE_DB_PATH') ?: (getenv('DB_PATH') ?: '/var/www/courtle_data/courtle.db'));
}
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
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { 
    http_response_code(204); 
    exit; 
}

function courtle_client_ip(): string {
    // 1. Cloudflare sends the verified visitor IP in CF-Connecting-IP
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $ip = trim($_SERVER['HTTP_CF_CONNECTING_IP']);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }

    // 2. Traefik / Nginx / Reverse Proxies often pass X-Real-IP
    if (!empty($_SERVER['HTTP_X_REAL_IP'])) {
        $ip = trim($_SERVER['HTTP_X_REAL_IP']);
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return $ip;
        }
    }

    // 3. X-Forwarded-For (client, proxy1, proxy2...)
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        // Scan left-to-right for the first public/non-private IP
        foreach ($parts as $p) {
            $p = trim($p);
            if (filter_var($p, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return $p;
            }
        }
        // If all in chain are private, take the first valid IP
        foreach ($parts as $p) {
            $p = trim($p);
            if (filter_var($p, FILTER_VALIDATE_IP)) {
                return $p;
            }
        }
    }

    // 4. Fallback to REMOTE_ADDR
    $remote = trim($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
    return filter_var($remote, FILTER_VALIDATE_IP) ? $remote : '127.0.0.1';
}

function is_internal_ip(string $ip): bool {
    if ($ip === '127.0.0.1' || $ip === '::1') return false; // Allow localhost for local dev/testing
    // Check if IP is in private or reserved network ranges (e.g. 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
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
    if (!$hasTables) {
        init_db($pdo);
    } else {
        $ver = (int)$pdo->query("SELECT value FROM config WHERE key='schema_version'")->fetchColumn();
        if ($ver < 2) {
            migrate_v2_sessions($pdo);
        }
    }
    $ver = (int)$pdo->query("SELECT value FROM config WHERE key='schema_version'")->fetchColumn();
    if ($ver < 3) {
        migrate_v3_tx_session_link($pdo);
    }
    $ver = (int)$pdo->query("SELECT value FROM config WHERE key='schema_version'")->fetchColumn();
    if ($ver < 4) {
        migrate_v4_expenses_session_link($pdo);
    }
    $ver = (int)$pdo->query("SELECT value FROM config WHERE key='schema_version'")->fetchColumn();
    if ($ver < 5) {
        migrate_v5_expense_sessions($pdo);
    }
    $ver = (int)$pdo->query("SELECT value FROM config WHERE key='schema_version'")->fetchColumn();
    if ($ver < 6) {
        migrate_v6_player_notify_email($pdo);
    }
    $ver = (int)$pdo->query("SELECT value FROM config WHERE key='schema_version'")->fetchColumn();
    if ($ver < 7) {
        migrate_v7_player_notify_billing_deposit($pdo);
    }
    return $pdo;
}

// ── System & DB Init ──
function handle_system_init(): void {
    require_auth(true); // Nur Admins dürfen das!
    $db = db();
    init_db($db);
    migrate_v2_sessions($db);
    migrate_v3_tx_session_link($db);
    migrate_v4_expenses_session_link($db);
    migrate_v5_expense_sessions($db);
    migrate_v6_player_notify_email($db);
    migrate_v7_player_notify_billing_deposit($db);
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
    
    @unlink(dirname(DB_PATH) . '/test-emails.jsonl');
    
    json_out(['status' => 'success', 'message' => 'Database successfully reset.']);
}

function handle_test_emails(): void {
    if (strpos(DB_PATH, 'test') === false) {
        err('Only allowed in test environments.', 403);
    }
    $file = dirname(DB_PATH) . '/test-emails.jsonl';
    if (!file_exists($file)) {
        json_out([]);
    }
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $emails = [];
    foreach ($lines as $line) {
        $decoded = json_decode($line, true);
        if (is_array($decoded)) {
            $emails[] = $decoded;
        }
    }
    json_out($emails);
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
        admin INTEGER DEFAULT 0,
        notify_email INTEGER DEFAULT 0,
        notify_charge INTEGER DEFAULT 0,
        notify_deposit INTEGER DEFAULT 0
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY, 
        player_id TEXT NOT NULL, 
        credit INTEGER NOT NULL, 
        amount REAL NOT NULL, 
        date TEXT NOT NULL, 
        created_at TEXT NOT NULL, 
        note TEXT,
        session_id TEXT DEFAULT NULL
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
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
        name TEXT DEFAULT NULL,
        court_names TEXT,
        billing_deferred INTEGER DEFAULT 0
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS courts (
        session_id TEXT NOT NULL, 
        court_index INTEGER NOT NULL, 
        slot_index INTEGER NOT NULL, 
        player_id TEXT, 
        PRIMARY KEY(session_id, court_index, slot_index)
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY, 
        amount REAL NOT NULL, 
        date TEXT NOT NULL, 
        note TEXT NOT NULL DEFAULT '', 
        created_at TEXT NOT NULL,
        session_id TEXT DEFAULT NULL,
        paid_by TEXT DEFAULT NULL
    )");

    $db->exec("CREATE TABLE IF NOT EXISTS expense_sessions (
        expense_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY (expense_id, session_id)
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_expense_sessions_session ON expense_sessions(session_id)");
    
    $db->exec("CREATE TABLE IF NOT EXISTS session_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        session_id TEXT,
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
        "ALTER TABLE series ADD COLUMN court_names TEXT",
        "ALTER TABLE transactions ADD COLUMN session_id TEXT DEFAULT NULL",
        "ALTER TABLE sessions ADD COLUMN billing_deferred INTEGER DEFAULT 0"
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
    
    $db->exec("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_transactions_session ON transactions(session_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_courts_session ON courts(session_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_session_history_session ON session_history(session_id)");
    // Ensure existing sessions without explicit time_start get populated from config/series
    try {
        $defaultStart = $db->query("SELECT value FROM config WHERE key='srtimestart'")->fetchColumn() ?: '19:00';
        $defaultEnd   = $db->query("SELECT value FROM config WHERE key='srtimeend'")->fetchColumn() ?: '21:00';
        $db->prepare("UPDATE sessions SET time_start = ? WHERE time_start IS NULL OR time_start = ''")->execute([$defaultStart]);
        $db->prepare("UPDATE sessions SET time_end = ? WHERE time_end IS NULL OR time_end = ''")->execute([$defaultEnd]);
    } catch (Throwable $e) {}

    $db->prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('schema_version', '2')")->execute();
}

function uuid_v4(): string {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40); // set version to 0100 (v4)
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80); // set bits 6-7 to 10
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function is_uuid(string $str): bool {
    return (bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $str);
}

function migrate_v4_expenses_session_link(PDO $db): void {
    try { $db->exec("ALTER TABLE expenses ADD COLUMN session_id TEXT DEFAULT NULL"); } catch (Throwable $e) {}
    try { $db->exec("ALTER TABLE expenses ADD COLUMN paid_by TEXT DEFAULT NULL"); } catch (Throwable $e) {}
    $db->exec("CREATE INDEX IF NOT EXISTS idx_expenses_session ON expenses(session_id)");
    $db->prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('billing_rounding', 'exact')")->execute();
    $db->prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', '4')")->execute();
}

function migrate_v5_expense_sessions(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS expense_sessions (
        expense_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY (expense_id, session_id)
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_expense_sessions_session ON expense_sessions(session_id)");
    $db->exec("INSERT OR IGNORE INTO expense_sessions (expense_id, session_id)
               SELECT id, session_id FROM expenses WHERE session_id IS NOT NULL AND session_id != ''");
    $db->prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', '5')")->execute();
}

function migrate_v6_player_notify_email(PDO $db): void {
    try { $db->exec("ALTER TABLE players ADD COLUMN notify_email INTEGER DEFAULT 0"); } catch (Throwable $e) {}
    $db->prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', '6')")->execute();
}

function migrate_v7_player_notify_billing_deposit(PDO $db): void {
    try { $db->exec("ALTER TABLE players ADD COLUMN notify_charge INTEGER DEFAULT 0"); } catch (Throwable $e) {}
    try { $db->exec("ALTER TABLE players ADD COLUMN notify_deposit INTEGER DEFAULT 0"); } catch (Throwable $e) {}
    $db->prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', '7')")->execute();
}

function migrate_v3_tx_session_link(PDO $db): void {
    try { $db->exec("ALTER TABLE transactions ADD COLUMN session_id TEXT DEFAULT NULL"); } catch (Throwable $e) { /* exists */ }
    $db->exec("CREATE INDEX IF NOT EXISTS idx_transactions_session ON transactions(session_id)");

    $db->exec('BEGIN IMMEDIATE');
    try {
        $sessions = $db->query("SELECT id, date, time_start FROM sessions WHERE charged=1")->fetchAll();
        $byDate = [];
        foreach ($sessions as $s) { $byDate[$s['date']][] = $s; }

        $sel = $db->prepare("SELECT id, note FROM transactions WHERE session_id IS NULL AND date = ? AND (note LIKE ? OR note LIKE ?)");
        $upd = $db->prepare("UPDATE transactions SET session_id = ? WHERE id = ?");
        foreach ($byDate as $date => $list) {
            $sel->execute([$date, "Session $date%", "Direct payment $date%"]);
            $cands = $sel->fetchAll();
            if (count($list) === 1) {
                foreach ($cands as $c) { $upd->execute([$list[0]['id'], $c['id']]); }
                continue;
            }
            // Several charged sessions on the same date: match by "(HH:MM)" / "(HHMM)" label, only if unambiguous
            foreach ($cands as $c) {
                $matches = [];
                foreach ($list as $s) {
                    $ts = (string)($s['time_start'] ?? '');
                    if ($ts === '') continue;
                    $alt = strpos($ts, ':') !== false ? str_replace(':', '', $ts) : substr($ts, 0, 2) . ':' . substr($ts, 2);
                    if (strpos((string)$c['note'], "($ts)") !== false || strpos((string)$c['note'], "($alt)") !== false) {
                        $matches[] = $s['id'];
                    }
                }
                if (count($matches) === 1) { $upd->execute([$matches[0], $c['id']]); }
            }
        }
        $db->prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', '3')")->execute();
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
}

function migrate_v2_sessions(PDO $db): void {
    // Check if sessions table has id column
    $cols = $db->query("PRAGMA table_info(sessions)")->fetchAll();
    $hasId = false;
    foreach ($cols as $col) {
        if ($col['name'] === 'id') {
            $hasId = true;
            break;
        }
    }
    if ($hasId) {
        // Backfill time_start / time_end if any sessions exist without time
        try {
            $defaultStart = $db->query("SELECT value FROM config WHERE key='srtimestart'")->fetchColumn() ?: '19:00';
            $defaultEnd   = $db->query("SELECT value FROM config WHERE key='srtimeend'")->fetchColumn() ?: '21:00';
            $db->prepare("UPDATE sessions SET time_start = ? WHERE time_start IS NULL OR time_start = ''")->execute([$defaultStart]);
            $db->prepare("UPDATE sessions SET time_end = ? WHERE time_end IS NULL OR time_end = ''")->execute([$defaultEnd]);
        } catch (Throwable $e) {}
        $db->prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', '2')")->execute();
        return;
    }

    // Check if session_history has session_id column
    $histCols = $db->query("PRAGMA table_info(session_history)")->fetchAll();
    $histHasSessionId = false;
    foreach ($histCols as $col) {
        if ($col['name'] === 'session_id') {
            $histHasSessionId = true;
            break;
        }
    }
    if (!$histHasSessionId) {
        try {
            $db->exec("ALTER TABLE session_history ADD COLUMN session_id TEXT");
        } catch (Throwable $e) {}
    }

    $db->exec("PRAGMA foreign_keys = OFF;");
    $db->beginTransaction();
    try {
        $db->exec("CREATE TABLE sessions_new (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
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
            name TEXT DEFAULT NULL,
            court_names TEXT,
            billing_deferred INTEGER DEFAULT 0
        )");

        $db->exec("CREATE TABLE courts_new (
            session_id TEXT NOT NULL,
            court_index INTEGER NOT NULL,
            slot_index INTEGER NOT NULL,
            player_id TEXT,
            PRIMARY KEY(session_id, court_index, slot_index)
        )");

        $oldSessions = $db->query("SELECT * FROM sessions")->fetchAll();
        $insSess = $db->prepare("INSERT INTO sessions_new 
            (id, date, charged, disabled_courts, waitlist, note, time_start, time_end, cancelled, location, price, cancel_hours, name, court_names)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $insCourts = $db->prepare("INSERT OR IGNORE INTO courts_new (session_id, court_index, slot_index, player_id) VALUES (?,?,?,?)");
        $updHist = $db->prepare("UPDATE session_history SET session_id = ? WHERE session_date = ?");

        $defaultStart = $db->query("SELECT value FROM config WHERE key='srtimestart'")->fetchColumn() ?: '19:00';
        $defaultEnd   = $db->query("SELECT value FROM config WHERE key='srtimeend'")->fetchColumn() ?: '21:00';

        foreach ($oldSessions as $s) {
            $uuid = uuid_v4();
            $date = $s['date'];
            $timeStart = !empty($s['time_start']) ? $s['time_start'] : $defaultStart;
            $timeEnd   = !empty($s['time_end'])   ? $s['time_end']   : $defaultEnd;
            $insSess->execute([
                $uuid,
                $date,
                (int)($s['charged'] ?? 0),
                $s['disabled_courts'] ?? '[]',
                $s['waitlist'] ?? '[]',
                $s['note'] ?? '',
                $timeStart,
                $timeEnd,
                (int)($s['cancelled'] ?? 0),
                $s['location'] ?? null,
                isset($s['price']) && $s['price'] !== null ? (float)$s['price'] : null,
                isset($s['cancel_hours']) && $s['cancel_hours'] !== null ? (float)$s['cancel_hours'] : null,
                $s['name'] ?? null,
                $s['court_names'] ?? null
            ]);

            // In old courts table, the column was session_date
            $stmtSlots = $db->prepare("SELECT court_index, slot_index, player_id FROM courts WHERE session_date = ?");
            $stmtSlots->execute([$date]);
            foreach ($stmtSlots->fetchAll() as $slot) {
                $insCourts->execute([$uuid, (int)$slot['court_index'], (int)$slot['slot_index'], $slot['player_id']]);
            }

            $updHist->execute([$uuid, $date]);
        }

        $db->exec("DROP TABLE sessions;");
        $db->exec("ALTER TABLE sessions_new RENAME TO sessions;");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);");

        $db->exec("DROP TABLE courts;");
        $db->exec("ALTER TABLE courts_new RENAME TO courts;");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_courts_session ON courts(session_id);");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_session_history_session ON session_history(session_id);");

        $db->prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', '2')")->execute();

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    } finally {
        $db->exec("PRAGMA foreign_keys = ON;");
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
    return '418';
}

function json_out(mixed $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
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

function get_session_row(PDO $db, string $idOrDate): ?array {
    // 1. Direct match by UUID / id
    $stmt = $db->prepare("SELECT * FROM sessions WHERE id = ?");
    $stmt->execute([$idOrDate]);
    $row = $stmt->fetch();
    if ($row) return $row;

    // 2. Fallback match by date (for legacy clients)
    $stmt = $db->prepare("SELECT * FROM sessions WHERE date = ? ORDER BY time_start ASC, id ASC LIMIT 1");
    $stmt->execute([$idOrDate]);
    return $stmt->fetch() ?: null;
}

// ── Session History Helper ──
function log_session_history($db, $session_id, $player_id, $action, $court_index, $slot_index, $performed_by, $details_json = null, $session_date = null) {
    if (!$session_date) {
        $stmt = $db->prepare("SELECT date FROM sessions WHERE id = ?");
        $stmt->execute([$session_id]);
        $session_date = $stmt->fetchColumn() ?: date('Y-m-d');
    }
    $sql = "INSERT INTO session_history (session_id, session_date, player_id, action, court_index, slot_index, timestamp, performed_by, details) VALUES (?,?,?,?,?,?,?,?,?)";
    $stmt = $db->prepare($sql);
    if (!$stmt) return;
    $stmt->execute([$session_id, $session_date, $player_id, $action, $court_index, $slot_index, date('c'), $performed_by, $details_json]);
}

// Get performer ID (always valid player ID or 'unknown')
function get_performer_id(): string {
    $token = $_SERVER['HTTP_X_TOKEN'] ?? '';
    if (!$token) return 'unknown';
    $player_id = token_player($token);
    return $player_id ?? 'unknown';  // Always returns player ID (or unknown)
}

function get_all_series_for_date(PDO $db, string $date): array {
    $srEnabled = $db->query("SELECT value FROM config WHERE key='sr_enabled'")->fetchColumn();
    if ($srEnabled === '0') return [];

    $stmt = $db->query("SELECT * FROM series WHERE enabled = 1 ORDER BY time_start ASC, id ASC");
    $series = $stmt->fetchAll();
    $today = date('Y-m-d');
    $res = [];
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
        if ($found) $res[] = $s;
    }
    return $res;
}

function get_series_for_date(PDO $db, string $date, ?string $timeStart = null): ?array {
    $seriesList = get_all_series_for_date($db, $date);
    if (empty($seriesList)) return null;
    if ($timeStart !== null) {
        foreach ($seriesList as $s) {
            if (($s['time_start'] ?? null) === $timeStart) return $s;
        }
    }
    return $seriesList[0] ?? null;
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

// ── Email Notifications (Resend) ──
function get_app_instance_url(): string {
    $envUrl = trim((string)(getenv('APP_URL') ?: ''));
    if ($envUrl !== '') {
        return rtrim($envUrl, '/');
    }
    $host = trim((string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '') return '';
    $proto = trim((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    if ($proto !== '') {
        $scheme = strtolower(explode(',', $proto)[0]);
    } else {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    }
    return $scheme . '://' . $host;
}

function build_waitlist_promotion_email(string $lang, array $data): array {
    $templates = [
        'de' => [
            'subject' => 'Du bist nachgerückt: {session} ({date})',
            'title' => 'Platz frei geworden!',
            'greeting' => 'Hallo {player},',
            'body' => 'gute Nachrichten: Du bist von der Warteliste nachgerückt und hast jetzt einen festen Platz.',
            'subject_guest' => 'Dein Gast ist nachgerückt: {session} ({date})',
            'title_guest' => 'Platz für deinen Gast frei geworden!',
            'body_guest' => 'gute Nachrichten: Dein Gast ist von der Warteliste nachgerückt und hat jetzt einen festen Platz.',
            'subject_guests' => 'Deine Gäste sind nachgerückt: {session} ({date})',
            'title_guests' => 'Plätze für deine Gäste frei geworden!',
            'body_guests' => 'gute Nachrichten: Deine {count} Gäste sind von der Warteliste nachgerückt und haben jetzt feste Plätze.',
            'lbl_session' => 'Termin',
            'lbl_date' => 'Datum',
            'lbl_time' => 'Uhrzeit',
            'lbl_location' => 'Ort',
            'lbl_court' => 'Court',
            'cta' => 'Zur App',
            'footer' => 'Du erhältst diese Nachricht, weil du E-Mail-Benachrichtigungen in deinem Profil aktiviert hast.',
        ],
        'en' => [
            'subject' => 'You got a spot: {session} ({date})',
            'title' => 'You moved up from the waitlist!',
            'greeting' => 'Hi {player},',
            'body' => 'good news: a spot opened up and you have been moved from the waitlist onto a court.',
            'subject_guest' => 'Your guest got a spot: {session} ({date})',
            'title_guest' => 'Your guest moved up from the waitlist!',
            'body_guest' => 'good news: a spot opened up and your guest has been moved from the waitlist onto a court.',
            'subject_guests' => 'Your guests got spots: {session} ({date})',
            'title_guests' => 'Your guests moved up from the waitlist!',
            'body_guests' => 'good news: spots opened up and your {count} guests have been moved from the waitlist onto a court.',
            'lbl_session' => 'Session',
            'lbl_date' => 'Date',
            'lbl_time' => 'Time',
            'lbl_location' => 'Location',
            'lbl_court' => 'Court',
            'cta' => 'Open App',
            'footer' => 'You are receiving this email because email notifications are enabled in your profile.',
        ],
        'es' => [
            'subject' => 'Tienes plaza: {session} ({date})',
            'title' => '¡Has subido desde la lista de espera!',
            'greeting' => 'Hola {player},',
            'body' => 'buenas noticias: se ha liberado una plaza y has pasado de la lista de espera a la pista.',
            'subject_guest' => 'Tu invitado tiene plaza: {session} ({date})',
            'title_guest' => '¡Tu invitado ha subido desde la lista de espera!',
            'body_guest' => 'buenas noticias: se ha liberado una plaza y tu invitado ha pasado de la lista de espera a la pista.',
            'subject_guests' => 'Tus invitados tienen plaza: {session} ({date})',
            'title_guests' => '¡Tus invitados han subido desde la lista de espera!',
            'body_guests' => 'buenas noticias: se han liberado plazas y tus {count} invitados han pasado de la lista de espera a la pista.',
            'lbl_session' => 'Sesión',
            'lbl_date' => 'Fecha',
            'lbl_time' => 'Horario',
            'lbl_location' => 'Lugar',
            'lbl_court' => 'Pista',
            'cta' => 'Abrir App',
            'footer' => 'Recibes este correo porque tienes activadas las notificaciones por correo en tu perfil.',
        ],
        'it' => [
            'subject' => 'Posto confermato: {session} ({date})',
            'title' => 'Sei salito dalla lista d\'attesa!',
            'greeting' => 'Ciao {player},',
            'body' => 'buone notizie: si è liberato un posto e sei stato spostato dalla lista d\'attesa in campo.',
            'subject_guest' => 'Posto confermato per il tuo ospite: {session} ({date})',
            'title_guest' => 'Il tuo ospite è salito dalla lista d\'attesa!',
            'body_guest' => 'buone notizie: si è liberato un posto e il tuo ospite è stato spostato dalla lista d\'attesa in campo.',
            'subject_guests' => 'Posti confermati per i tuoi ospiti: {session} ({date})',
            'title_guests' => 'I tuoi ospiti sono saliti dalla lista d\'attesa!',
            'body_guests' => 'buone notizie: si sono liberati dei posti e i tuoi {count} ospiti sono stati spostati dalla lista d\'attesa in campo.',
            'lbl_session' => 'Sessione',
            'lbl_date' => 'Data',
            'lbl_time' => 'Orario',
            'lbl_location' => 'Luogo',
            'lbl_court' => 'Campo',
            'cta' => 'Apri App',
            'footer' => 'Ricevi questa email perché hai attivato le notifiche email nel tuo profilo.',
        ],
        'fr' => [
            'subject' => 'Place confirmée : {session} ({date})',
            'title' => 'Vous avez quitté la liste d\'attente !',
            'greeting' => 'Bonjour {player},',
            'body' => 'bonne nouvelle : une place s\'est libérée et vous êtes passé de la liste d\'attente au terrain.',
            'subject_guest' => 'Place confirmée pour votre invité : {session} ({date})',
            'title_guest' => 'Votre invité a quitté la liste d\'attente !',
            'body_guest' => 'bonne nouvelle : une place s\'est libérée et votre invité est passé de la liste d\'attente au terrain.',
            'subject_guests' => 'Places confirmées pour vos invités : {session} ({date})',
            'title_guests' => 'Vos invités ont quitté la liste d\'attente !',
            'body_guests' => 'bonne nouvelle : des places se sont libérées et vos {count} invités sont passés de la liste d\'attente au terrain.',
            'lbl_session' => 'Session',
            'lbl_date' => 'Date',
            'lbl_time' => 'Horaire',
            'lbl_location' => 'Lieu',
            'lbl_court' => 'Court',
            'cta' => 'Ouvrir l\'app',
            'footer' => 'Vous recevez cet e-mail car les notifications par e-mail sont activées dans votre profil.',
        ],
        'pt' => [
            'subject' => 'Vaga confirmada: {session} ({date})',
            'title' => 'Você saiu da lista de espera!',
            'greeting' => 'Olá {player},',
            'body' => 'boas notícias: abriu uma vaga e você avançou da lista de espera para a quadra.',
            'subject_guest' => 'Vaga confirmada para seu convidado: {session} ({date})',
            'title_guest' => 'Seu convidado saiu da lista de espera!',
            'body_guest' => 'boas notícias: abriu uma vaga e seu convidado avançou da lista de espera para a quadra.',
            'subject_guests' => 'Vagas confirmadas para seus convidados: {session} ({date})',
            'title_guests' => 'Seus convidados saíram da lista de espera!',
            'body_guests' => 'boas notícias: abriram vagas e seus {count} convidados avançaram da lista de espera para a quadra.',
            'lbl_session' => 'Sessão',
            'lbl_date' => 'Data',
            'lbl_time' => 'Horário',
            'lbl_location' => 'Local',
            'lbl_court' => 'Quadra',
            'cta' => 'Abrir App',
            'footer' => 'Você está recebendo este e-mail porque as notificações por e-mail estão ativadas no seu perfil.',
        ],
    ];

    $t = $templates[$lang] ?? $templates['de'];
    $club = (string)($data['club_name'] ?: 'Courtle');
    $sessionName = (string)($data['session_name'] ?: 'Session');
    $rawDate = (string)($data['date'] ?? '');
    $ts = $rawDate !== '' ? strtotime($rawDate) : false;
    $formattedDate = $ts !== false ? date('d.m.Y', $ts) : $rawDate;
    $timeRange = trim((string)($data['time_start'] ?? ''));
    if (!empty($data['time_end'])) {
        $timeRange .= ($timeRange !== '' ? ' – ' : '') . $data['time_end'];
    }
    $location = trim((string)($data['location'] ?? ''));
    $courtLabel = trim((string)($data['court_label'] ?? ''));
    $appUrl = trim((string)($data['app_url'] ?? ''));
    $playerName = (string)($data['player_name'] ?? '');

    $guestCount = (int)($data['guest_count'] ?? 0);
    $includesSelf = !empty($data['includes_self']) || $guestCount === 0;
    if (!$includesSelf && $guestCount > 1) {
        $subjectTpl = $t['subject_guests'];
        $titleText = $t['title_guests'];
        $bodyTpl = $t['body_guests'];
    } elseif (!$includesSelf && $guestCount === 1) {
        $subjectTpl = $t['subject_guest'];
        $titleText = $t['title_guest'];
        $bodyTpl = $t['body_guest'];
    } else {
        $subjectTpl = $t['subject'];
        $titleText = $t['title'];
        $bodyTpl = $t['body'];
    }

    $subject = strtr($subjectTpl, [
        '{session}' => $sessionName,
        '{date}' => $formattedDate,
    ]);
    $greeting = strtr($t['greeting'], ['{player}' => $playerName]);
    $bodyText = strtr($bodyTpl, ['{count}' => (string)$guestCount]);

    $e = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');

    $rows = [];
    $rows[] = [$t['lbl_session'], $sessionName];
    $rows[] = [$t['lbl_date'], $formattedDate];
    if ($timeRange !== '') $rows[] = [$t['lbl_time'], $timeRange];
    if ($location !== '') $rows[] = [$t['lbl_location'], $location];
    if ($courtLabel !== '') $rows[] = [$t['lbl_court'], $courtLabel];

    $tableRowsHtml = '';
    $textDetails = [];
    foreach ($rows as [$label, $val]) {
        $tableRowsHtml .= '<tr>'
            . '<td style="padding:6px 12px 6px 0;color:#64748b;font-size:14px;white-space:nowrap;">' . $e($label) . '</td>'
            . '<td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">' . $e($val) . '</td>'
            . '</tr>';
        $textDetails[] = $label . ': ' . $val;
    }

    $ctaHtml = '';
    $ctaText = '';
    if ($appUrl !== '') {
        $ctaHtml = '<div style="margin-top:24px;">'
            . '<a href="' . $e($appUrl) . '" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">'
            . $e($t['cta'])
            . '</a></div>';
        $ctaText = "\n\n" . $t['cta'] . ': ' . $appUrl;
    }

    $html = '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#0f172a;">'
        . '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">'
        . '<div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">' . $e($club) . '</div>'
        . '<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;">' . $e($titleText) . '</h1>'
        . '<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">' . $e($greeting) . '</p>'
        . '<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">' . $e($bodyText) . '</p>'
        . '<table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:8px 0;">'
        . $tableRowsHtml
        . '</table>'
        . $ctaHtml
        . '<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#64748b;">' . $e($t['footer']) . '</p>'
        . '</div></body></html>';

    $text = $titleText . "\n\n"
        . $greeting . "\n"
        . $bodyText . "\n\n"
        . implode("\n", $textDetails)
        . $ctaText . "\n\n"
        . $t['footer'];

    return ['subject' => $subject, 'html' => $html, 'text' => $text];
}

function format_resend_from(string $rawFrom, string $senderName): string {
    $rawFrom = trim($rawFrom);
    if ($rawFrom === '') return '';
    if (preg_match('/<([^<>]+)>/', $rawFrom, $m)) {
        $email = trim($m[1]);
    } else {
        $email = $rawFrom;
    }
    if ($email === '') return '';

    $cleanName = trim(str_replace(["\r", "\n", '<', '>', '"'], '', $senderName));
    if ($cleanName === '') {
        $cleanName = 'Courtle';
    }
    if (preg_match('/[,;:()]/', $cleanName)) {
        $cleanName = '"' . $cleanName . '"';
    }
    return $cleanName . ' <' . $email . '>';
}

function is_resend_configured(): bool {
    $apiKey = trim((string)(getenv('RESEND_API_KEY') ?: ''));
    $rawFrom = trim((string)(getenv('RESEND_FROM') ?: ''));
    $isTestEnv = strpos(DB_PATH, 'test') !== false;
    if ($isTestEnv && ($apiKey === '' || $apiKey === 'test-mock')) {
        return true;
    }
    return $apiKey !== '' && format_resend_from($rawFrom, 'Courtle') !== '';
}

function send_resend_email(string $to, string $subject, string $html, string $text, string $senderName = 'Courtle'): bool {
    $apiKey = trim((string)(getenv('RESEND_API_KEY') ?: ''));
    $rawFrom = trim((string)(getenv('RESEND_FROM') ?: ''));
    $replyTo = trim((string)(getenv('RESEND_REPLY_TO') ?: ''));

    $isTestEnv = strpos(DB_PATH, 'test') !== false;
    if ($isTestEnv && ($apiKey === '' || $apiKey === 'test-mock')) {
        $from = format_resend_from($rawFrom !== '' ? $rawFrom : 'noreply@test.local', $senderName);
        $payload = [
            'from' => $from,
            'to' => [$to],
            'subject' => $subject,
            'html' => $html,
            'text' => $text,
            'sent_at' => date('c'),
        ];
        if ($replyTo !== '') {
            $payload['reply_to'] = $replyTo;
        }
        $file = dirname(DB_PATH) . '/test-emails.jsonl';
        @file_put_contents($file, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        return true;
    }

    $from = format_resend_from($rawFrom, $senderName);
    if ($apiKey === '' || $from === '') {
        if ($apiKey !== '' && $from === '') {
            error_log('Resend skipped: RESEND_FROM is not configured.');
        }
        return false;
    }

    $payload = [
        'from' => $from,
        'to' => [$to],
        'subject' => $subject,
        'html' => $html,
        'text' => $text,
    ];
    if ($replyTo !== '') {
        $payload['reply_to'] = $replyTo;
    }

    if (!function_exists('curl_init')) {
        error_log('Resend error: PHP curl extension is not available.');
        return false;
    }

    $ch = curl_init('https://api.resend.com/emails');
    if ($ch === false) {
        error_log('Resend error: curl_init failed.');
        return false;
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    $resp = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($resp === false || $httpCode >= 400) {
        error_log("Resend API error (HTTP $httpCode): " . ($curlErr ?: (string)$resp));
        return false;
    }
    return true;
}

function notify_waitlist_promotions(PDO $db, string $sessId, array $promotions): void {
    try {
        if (empty($promotions)) return;

        $seenRaw = [];
        $groupedPromotions = [];
        foreach ($promotions as $promo) {
            $rawPid = (string)($promo['player_id'] ?? '');
            if ($rawPid === '' || isset($seenRaw[$rawPid])) continue;
            $seenRaw[$rawPid] = true;
            $baseId = explode('|', $rawPid)[0];
            $isGuest = str_contains($rawPid, '|');
            if (!isset($groupedPromotions[$baseId])) {
                $groupedPromotions[$baseId] = [
                    'self' => false,
                    'guests' => 0,
                    'court_index' => $promo['court_index'] ?? null,
                ];
            }
            if ($isGuest) {
                $groupedPromotions[$baseId]['guests']++;
            } else {
                $groupedPromotions[$baseId]['self'] = true;
            }
            if ($groupedPromotions[$baseId]['court_index'] === null && isset($promo['court_index'])) {
                $groupedPromotions[$baseId]['court_index'] = $promo['court_index'];
            }
        }
        if (empty($groupedPromotions)) return;

        $sStmt = $db->prepare("SELECT * FROM sessions WHERE id=?");
        $sStmt->execute([$sessId]);
        $sess = $sStmt->fetch();
        if (!$sess) return;

        $cfgRows = $db->query("SELECT key, value FROM config WHERE key IN ('language','team_name','srlocation','srtimestart','srtimeend')")->fetchAll(PDO::FETCH_KEY_PAIR);
        $defaultLang = in_array($cfgRows['language'] ?? '', ['de', 'en', 'es', 'it', 'fr', 'pt'], true) ? $cfgRows['language'] : 'de';
        $teamName = trim((string)($cfgRows['team_name'] ?? '')) ?: 'Courtle';

        $date = (string)$sess['date'];
        $series = get_series_for_date($db, $date, $sess['time_start'] ?? null) ?? get_series_by_weekday($db, $date);

        $sessionName = trim((string)($sess['name'] ?? ''));
        if ($sessionName === '' && $series && !empty($series['name'])) {
            $sessionName = (string)$series['name'];
        }
        if ($sessionName === '') {
            $sessionName = 'Session';
        }

        $timeStart = trim((string)($sess['time_start'] ?? ''));
        if ($timeStart === '' && $series && !empty($series['time_start'])) $timeStart = (string)$series['time_start'];
        if ($timeStart === '') $timeStart = (string)($cfgRows['srtimestart'] ?? '');

        $timeEnd = trim((string)($sess['time_end'] ?? ''));
        if ($timeEnd === '' && $series && !empty($series['time_end'])) $timeEnd = (string)$series['time_end'];
        if ($timeEnd === '') $timeEnd = (string)($cfgRows['srtimeend'] ?? '');

        $location = trim((string)($sess['location'] ?? ''));
        if ($location === '' && $series && !empty($series['location'])) $location = (string)$series['location'];
        if ($location === '') $location = trim((string)($cfgRows['srlocation'] ?? ''));

        $sessCourtNames = json_decode((string)($sess['court_names'] ?? '[]'), true);
        if (!is_array($sessCourtNames)) $sessCourtNames = [];
        $seriesCourtNames = ($series && !empty($series['court_names'])) ? json_decode((string)$series['court_names'], true) : [];
        if (!is_array($seriesCourtNames)) $seriesCourtNames = [];

        $appUrl = get_app_instance_url();
        $pStmt = $db->prepare("SELECT id, name, contact, language, COALESCE(notify_email, 0) AS notify_email FROM players WHERE id=?");

        foreach ($groupedPromotions as $playerId => $promoInfo) {
            $courtIndex = $promoInfo['court_index'];
            $pStmt->execute([$playerId]);
            $player = $pStmt->fetch();
            if (!$player || (int)($player['notify_email'] ?? 0) !== 1) continue;

            $email = trim((string)($player['contact'] ?? ''));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;

            $lang = in_array($player['language'] ?? '', ['de', 'en', 'es', 'it', 'fr', 'pt'], true)
                ? $player['language']
                : $defaultLang;

            $courtLabel = '';
            if ($courtIndex !== null) {
                $ci = (int)$courtIndex;
                $customName = isset($sessCourtNames[$ci]) ? trim((string)$sessCourtNames[$ci]) : '';
                if ($customName === '' && isset($seriesCourtNames[$ci])) {
                    $customName = trim((string)$seriesCourtNames[$ci]);
                }
                if ($customName !== '') {
                    $courtLabel = ctype_digit($customName) ? ('Court ' . $customName) : $customName;
                } else {
                    $courtLabel = 'Court ' . ($ci + 1);
                }
            }

            $mail = build_waitlist_promotion_email($lang, [
                'player_name' => (string)$player['name'],
                'session_name' => $sessionName,
                'date' => $date,
                'time_start' => $timeStart,
                'time_end' => $timeEnd,
                'location' => $location,
                'court_label' => $courtLabel,
                'app_url' => $appUrl,
                'club_name' => $teamName,
                'includes_self' => $promoInfo['self'],
                'guest_count' => $promoInfo['guests'],
            ]);

            send_resend_email($email, $mail['subject'], $mail['html'], $mail['text'], $teamName);
        }
    } catch (Throwable $e) {
        error_log('Waitlist promotion notification error: ' . $e->getMessage());
    }
}

function format_currency_amount(float $amount, string $currency, string $lang, bool $showPlus = false): string {
    $symMap = ['EUR' => '€', 'USD' => '$', 'GBP' => '£', 'CHF' => 'CHF', 'SEK' => 'kr', 'NOK' => 'kr', 'DKK' => 'kr'];
    $sym = $symMap[$currency] ?? ($currency !== '' ? $currency : '€');
    $dec = ($lang === 'en') ? '.' : ',';
    $rounded = round($amount, 2);
    if (abs($rounded) < 0.005) $rounded = 0.0;
    $sign = $rounded < 0 ? '-' : ($showPlus && $rounded > 0 ? '+' : '');
    return $sign . number_format(abs($rounded), 2, $dec, '') . ' ' . $sym;
}

function get_player_balance(PDO $db, string $playerId): float {
    $stmt = $db->prepare("SELECT COALESCE(SUM(CASE WHEN credit=1 THEN amount ELSE -amount END), 0) FROM transactions WHERE player_id=?");
    $stmt->execute([$playerId]);
    return round((float)$stmt->fetchColumn(), 2);
}

function render_courtle_email_card(array $p): array {
    $e = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
    $tableRowsHtml = '';
    $textDetails = [];
    foreach ($p['rows'] as [$label, $val]) {
        $tableRowsHtml .= '<tr>'
            . '<td style="padding:6px 12px 6px 0;color:#64748b;font-size:14px;white-space:nowrap;">' . $e($label) . '</td>'
            . '<td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">' . $e($val) . '</td>'
            . '</tr>';
        $textDetails[] = $label . ': ' . $val;
    }

    $ctaHtml = '';
    $ctaText = '';
    if (!empty($p['app_url'])) {
        $ctaHtml = '<div style="margin-top:24px;">'
            . '<a href="' . $e($p['app_url']) . '" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">'
            . $e($p['cta'])
            . '</a></div>';
        $ctaText = "\n\n" . $p['cta'] . ': ' . $p['app_url'];
    }

    $html = '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#0f172a;">'
        . '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">'
        . '<div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">' . $e($p['club']) . '</div>'
        . '<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;">' . $e($p['title']) . '</h1>'
        . '<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">' . $e($p['greeting']) . '</p>'
        . '<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">' . $e($p['body']) . '</p>'
        . '<table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:8px 0;">'
        . $tableRowsHtml
        . '</table>'
        . $ctaHtml
        . '<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#64748b;">' . $e($p['footer']) . '</p>'
        . '</div></body></html>';

    $text = $p['title'] . "\n\n"
        . $p['greeting'] . "\n"
        . $p['body'] . "\n\n"
        . implode("\n", $textDetails)
        . $ctaText . "\n\n"
        . $p['footer'];

    return ['subject' => $p['subject'], 'html' => $html, 'text' => $text];
}

function build_session_charge_email(string $lang, array $data): array {
    $templates = [
        'de' => [
            'subject' => 'Abrechnung: {session} ({date})',
            'title' => 'Session abgerechnet',
            'greeting' => 'Hallo {player},',
            'body' => 'deine Teilnahme an der folgenden Session wurde abgerechnet.',
            'lbl_session' => 'Termin',
            'lbl_date' => 'Datum',
            'lbl_time' => 'Uhrzeit',
            'lbl_slots' => 'Plätze',
            'lbl_type' => 'Abrechnungsart',
            'lbl_debit' => 'Betrag',
            'lbl_direct' => 'Direkt gezahlt',
            'lbl_outlay' => 'Auslage erstattet',
            'lbl_balance' => 'Neuer Kontostand',
            'type_balance' => 'Abrechnung über Guthaben',
            'type_direct' => 'Direktzahlung vor Ort',
            'type_partial_direct' => 'Teilweise Direktzahlung / Guthaben',
            'type_outlay' => 'Auslage (Erstattung)',
            'cta' => 'Zur App',
            'footer' => 'Du erhältst diese Nachricht, weil du E-Mail-Benachrichtigungen für Abrechnungen aktiviert hast.',
        ],
        'en' => [
            'subject' => 'Session charged: {session} ({date})',
            'title' => 'Session charged',
            'greeting' => 'Hi {player},',
            'body' => 'your participation in the following session has been charged.',
            'lbl_session' => 'Session',
            'lbl_date' => 'Date',
            'lbl_time' => 'Time',
            'lbl_slots' => 'Spots',
            'lbl_type' => 'Billing type',
            'lbl_debit' => 'Amount',
            'lbl_direct' => 'Paid directly',
            'lbl_outlay' => 'Outlay reimbursed',
            'lbl_balance' => 'New balance',
            'type_balance' => 'Charged to account balance',
            'type_direct' => 'Direct payment on site',
            'type_partial_direct' => 'Partial direct payment / balance',
            'type_outlay' => 'Outlay reimbursement',
            'cta' => 'Open App',
            'footer' => 'You are receiving this email because you enabled session billing notifications.',
        ],
        'es' => [
            'subject' => 'Sesión cobrada: {session} ({date})',
            'title' => 'Sesión cobrada',
            'greeting' => 'Hola {player},',
            'body' => 'se ha cobrado tu participación en la siguiente sesión.',
            'lbl_session' => 'Sesión',
            'lbl_date' => 'Fecha',
            'lbl_time' => 'Horario',
            'lbl_slots' => 'Plazas',
            'lbl_type' => 'Tipo de cobro',
            'lbl_debit' => 'Importe',
            'lbl_direct' => 'Pago directo',
            'lbl_outlay' => 'Gasto reembolsado',
            'lbl_balance' => 'Nuevo saldo',
            'type_balance' => 'Cargo en saldo',
            'type_direct' => 'Pago directo en el lugar',
            'type_partial_direct' => 'Pago directo parcial / saldo',
            'type_outlay' => 'Reembolso de gasto',
            'cta' => 'Abrir App',
            'footer' => 'Recibes este correo porque activaste las notificaciones de cobro de sesiones.',
        ],
        'it' => [
            'subject' => 'Sessione addebitata: {session} ({date})',
            'title' => 'Sessione addebitata',
            'greeting' => 'Ciao {player},',
            'body' => 'la tua partecipazione alla seguente sessione è stata addebitata.',
            'lbl_session' => 'Sessione',
            'lbl_date' => 'Data',
            'lbl_time' => 'Orario',
            'lbl_slots' => 'Posti',
            'lbl_type' => 'Tipo di addebito',
            'lbl_debit' => 'Importo',
            'lbl_direct' => 'Pagato direttamente',
            'lbl_outlay' => 'Anticipo rimborsato',
            'lbl_balance' => 'Nuovo saldo',
            'type_balance' => 'Addebito sul saldo',
            'type_direct' => 'Pagamento diretto sul posto',
            'type_partial_direct' => 'Pagamento diretto parziale / saldo',
            'type_outlay' => 'Rimborso anticipo',
            'cta' => 'Apri App',
            'footer' => 'Ricevi questa email perché hai attivato le notifiche per gli addebiti delle sessioni.',
        ],
        'fr' => [
            'subject' => 'Session facturée : {session} ({date})',
            'title' => 'Session facturée',
            'greeting' => 'Bonjour {player},',
            'body' => 'votre participation à la session suivante a été facturée.',
            'lbl_session' => 'Session',
            'lbl_date' => 'Date',
            'lbl_time' => 'Horaire',
            'lbl_slots' => 'Places',
            'lbl_type' => 'Mode de facturation',
            'lbl_debit' => 'Montant',
            'lbl_direct' => 'Payé sur place',
            'lbl_outlay' => 'Avance remboursée',
            'lbl_balance' => 'Nouveau solde',
            'type_balance' => 'Débit sur le solde',
            'type_direct' => 'Paiement direct sur place',
            'type_partial_direct' => 'Paiement direct partiel / solde',
            'type_outlay' => 'Remboursement d\'avance',
            'cta' => 'Ouvrir l\'app',
            'footer' => 'Vous recevez cet e-mail car vous avez activé les notifications de facturation.',
        ],
        'pt' => [
            'subject' => 'Sessão faturada: {session} ({date})',
            'title' => 'Sessão faturada',
            'greeting' => 'Olá {player},',
            'body' => 'sua participação na seguinte sessão foi faturada.',
            'lbl_session' => 'Sessão',
            'lbl_date' => 'Data',
            'lbl_time' => 'Horário',
            'lbl_slots' => 'Vagas',
            'lbl_type' => 'Tipo de cobrança',
            'lbl_debit' => 'Valor',
            'lbl_direct' => 'Pago diretamente',
            'lbl_outlay' => 'Despesa reembolsada',
            'lbl_balance' => 'Novo saldo',
            'type_balance' => 'Débito no saldo',
            'type_direct' => 'Pagamento direto no local',
            'type_partial_direct' => 'Pagamento direto parcial / saldo',
            'type_outlay' => 'Reembolso de despesa',
            'cta' => 'Abrir App',
            'footer' => 'Você está recebendo este e-mail porque ativou as notificações de cobrança de sessões.',
        ],
    ];

    $t = $templates[$lang] ?? $templates['de'];
    $club = (string)($data['club_name'] ?: 'Courtle');
    $sessionName = (string)($data['session_name'] ?: 'Session');
    $rawDate = (string)($data['date'] ?? '');
    $ts = $rawDate !== '' ? strtotime($rawDate) : false;
    $formattedDate = $ts !== false ? date('d.m.Y', $ts) : $rawDate;
    $timeRange = trim((string)($data['time_start'] ?? ''));
    if (!empty($data['time_end'])) {
        $timeRange .= ($timeRange !== '' ? ' – ' : '') . $data['time_end'];
    }
    $currency = (string)($data['currency'] ?? '€');
    $billingTypeKey = 'type_' . ($data['billing_type'] ?? 'balance');
    $billingTypeLabel = $t[$billingTypeKey] ?? $t['type_balance'];

    $rows = [];
    $rows[] = [$t['lbl_session'], $sessionName];
    $rows[] = [$t['lbl_date'], $formattedDate];
    if ($timeRange !== '') $rows[] = [$t['lbl_time'], $timeRange];
    if (!empty($data['slots'])) $rows[] = [$t['lbl_slots'], (string)(int)$data['slots']];
    $rows[] = [$t['lbl_type'], $billingTypeLabel];
    if ((float)($data['debit'] ?? 0) > 0) {
        $rows[] = [$t['lbl_debit'], format_currency_amount(-(float)$data['debit'], $currency, $lang)];
    }
    if ((float)($data['direct_paid'] ?? 0) > 0) {
        $rows[] = [$t['lbl_direct'], format_currency_amount((float)$data['direct_paid'], $currency, $lang, true)];
    }
    if ((float)($data['outlay_credit'] ?? 0) > 0) {
        $rows[] = [$t['lbl_outlay'], format_currency_amount((float)$data['outlay_credit'], $currency, $lang, true)];
    }
    $rows[] = [$t['lbl_balance'], format_currency_amount((float)($data['new_balance'] ?? 0), $currency, $lang)];

    return render_courtle_email_card([
        'club' => $club,
        'subject' => strtr($t['subject'], ['{session}' => $sessionName, '{date}' => $formattedDate]),
        'title' => $t['title'],
        'greeting' => strtr($t['greeting'], ['{player}' => (string)($data['player_name'] ?? '')]),
        'body' => $t['body'],
        'rows' => $rows,
        'app_url' => trim((string)($data['app_url'] ?? '')),
        'cta' => $t['cta'],
        'footer' => $t['footer'],
    ]);
}

function build_deposit_email(string $lang, array $data): array {
    $templates = [
        'de' => [
            'subject' => 'Einzahlung verbucht ({amount})',
            'title' => 'Einzahlung eingegangen',
            'greeting' => 'Hallo {player},',
            'body' => 'auf deinem Konto wurde eine Einzahlung verbucht.',
            'lbl_amount' => 'Einzahlung',
            'lbl_date' => 'Datum',
            'lbl_note' => 'Notiz',
            'lbl_balance' => 'Neuer Kontostand',
            'cta' => 'Zur App',
            'footer' => 'Du erhältst diese Nachricht, weil du E-Mail-Benachrichtigungen für Einzahlungen aktiviert hast.',
        ],
        'en' => [
            'subject' => 'Deposit credited ({amount})',
            'title' => 'Deposit received',
            'greeting' => 'Hi {player},',
            'body' => 'a deposit has been credited to your account.',
            'lbl_amount' => 'Deposit',
            'lbl_date' => 'Date',
            'lbl_note' => 'Note',
            'lbl_balance' => 'New balance',
            'cta' => 'Open App',
            'footer' => 'You are receiving this email because you enabled deposit notifications.',
        ],
        'es' => [
            'subject' => 'Depósito registrado ({amount})',
            'title' => 'Depósito recibido',
            'greeting' => 'Hola {player},',
            'body' => 'se ha registrado un depósito en tu cuenta.',
            'lbl_amount' => 'Depósito',
            'lbl_date' => 'Fecha',
            'lbl_note' => 'Nota',
            'lbl_balance' => 'Nuevo saldo',
            'cta' => 'Abrir App',
            'footer' => 'Recibes este correo porque activaste las notificaciones de depósitos.',
        ],
        'it' => [
            'subject' => 'Ricarica registrata ({amount})',
            'title' => 'Ricarica ricevuta',
            'greeting' => 'Ciao {player},',
            'body' => 'è stato accreditato un versamento sul tuo conto.',
            'lbl_amount' => 'Importo',
            'lbl_date' => 'Data',
            'lbl_note' => 'Nota',
            'lbl_balance' => 'Nuovo saldo',
            'cta' => 'Apri App',
            'footer' => 'Ricevi questa email perché hai attivato le notifiche per i versamenti.',
        ],
        'fr' => [
            'subject' => 'Dépôt crédité ({amount})',
            'title' => 'Dépôt reçu',
            'greeting' => 'Bonjour {player},',
            'body' => 'un dépôt a été crédité sur votre compte.',
            'lbl_amount' => 'Dépôt',
            'lbl_date' => 'Date',
            'lbl_note' => 'Note',
            'lbl_balance' => 'Nouveau solde',
            'cta' => 'Ouvrir l\'app',
            'footer' => 'Vous recevez cet e-mail car vous avez activé les notifications de dépôt.',
        ],
        'pt' => [
            'subject' => 'Depósito creditado ({amount})',
            'title' => 'Depósito recebido',
            'greeting' => 'Olá {player},',
            'body' => 'um depósito foi creditado na sua conta.',
            'lbl_amount' => 'Depósito',
            'lbl_date' => 'Data',
            'lbl_note' => 'Nota',
            'lbl_balance' => 'Novo saldo',
            'cta' => 'Abrir App',
            'footer' => 'Você está recebendo este e-mail porque ativou as notificações de depósito.',
        ],
    ];

    $t = $templates[$lang] ?? $templates['de'];
    $club = (string)($data['club_name'] ?: 'Courtle');
    $currency = (string)($data['currency'] ?? '€');
    $amountStr = format_currency_amount((float)($data['amount'] ?? 0), $currency, $lang, true);
    $rawDate = (string)($data['date'] ?? '');
    $ts = $rawDate !== '' ? strtotime($rawDate) : false;
    $formattedDate = $ts !== false ? date('d.m.Y', $ts) : $rawDate;
    $note = trim((string)($data['note'] ?? ''));

    $rows = [
        [$t['lbl_amount'], $amountStr],
        [$t['lbl_date'], $formattedDate],
    ];
    if ($note !== '') $rows[] = [$t['lbl_note'], $note];
    $rows[] = [$t['lbl_balance'], format_currency_amount((float)($data['new_balance'] ?? 0), $currency, $lang)];

    return render_courtle_email_card([
        'club' => $club,
        'subject' => strtr($t['subject'], ['{amount}' => $amountStr]),
        'title' => $t['title'],
        'greeting' => strtr($t['greeting'], ['{player}' => (string)($data['player_name'] ?? '')]),
        'body' => $t['body'],
        'rows' => $rows,
        'app_url' => trim((string)($data['app_url'] ?? '')),
        'cta' => $t['cta'],
        'footer' => $t['footer'],
    ]);
}

function notify_session_charges(PDO $db, array $chargeBatches): void {
    try {
        if (empty($chargeBatches)) return;
        $cfgRows = $db->query("SELECT key, value FROM config WHERE key IN ('language','team_name','currency','srtimestart','srtimeend')")->fetchAll(PDO::FETCH_KEY_PAIR);
        $defaultLang = in_array($cfgRows['language'] ?? '', ['de', 'en', 'es', 'it', 'fr', 'pt'], true) ? $cfgRows['language'] : 'de';
        $teamName = trim((string)($cfgRows['team_name'] ?? '')) ?: 'Courtle';
        $currency = trim((string)($cfgRows['currency'] ?? '')) ?: '€';
        $appUrl = get_app_instance_url();

        $sStmt = $db->prepare("SELECT * FROM sessions WHERE id=?");
        $pStmt = $db->prepare("SELECT id, name, contact, language, COALESCE(notify_charge, 0) AS notify_charge FROM players WHERE id=?");

        foreach ($chargeBatches as $batch) {
            $sessId = (string)($batch['session_id'] ?? '');
            $playerBilling = $batch['player_billing'] ?? [];
            if ($sessId === '' || empty($playerBilling)) continue;

            $sStmt->execute([$sessId]);
            $sess = $sStmt->fetch();
            if (!$sess) continue;

            $date = (string)$sess['date'];
            $series = get_series_for_date($db, $date, $sess['time_start'] ?? null) ?? get_series_by_weekday($db, $date);
            $sessionName = trim((string)($sess['name'] ?? ''));
            if ($sessionName === '' && $series && !empty($series['name'])) $sessionName = (string)$series['name'];
            if ($sessionName === '') $sessionName = 'Session';

            $timeStart = trim((string)($sess['time_start'] ?? ''));
            if ($timeStart === '' && $series && !empty($series['time_start'])) $timeStart = (string)$series['time_start'];
            if ($timeStart === '') $timeStart = (string)($cfgRows['srtimestart'] ?? '');

            $timeEnd = trim((string)($sess['time_end'] ?? ''));
            if ($timeEnd === '' && $series && !empty($series['time_end'])) $timeEnd = (string)$series['time_end'];
            if ($timeEnd === '') $timeEnd = (string)($cfgRows['srtimeend'] ?? '');

            foreach ($playerBilling as $pid => $info) {
                $pStmt->execute([$pid]);
                $player = $pStmt->fetch();
                if (!$player || (int)($player['notify_charge'] ?? 0) !== 1) continue;

                $email = trim((string)($player['contact'] ?? ''));
                if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;

                $lang = in_array($player['language'] ?? '', ['de', 'en', 'es', 'it', 'fr', 'pt'], true)
                    ? $player['language']
                    : $defaultLang;

                $debit = (float)($info['debit'] ?? 0);
                $directPaid = (float)($info['direct_paid'] ?? 0);
                $outlayCredit = (float)($info['outlay_credit'] ?? 0);
                if ($outlayCredit > 0) {
                    $billingType = 'outlay';
                } elseif ($debit > 0 && abs($directPaid - $debit) < 0.005) {
                    $billingType = 'direct';
                } elseif ($directPaid > 0) {
                    $billingType = 'partial_direct';
                } else {
                    $billingType = 'balance';
                }

                $newBalance = get_player_balance($db, (string)$pid);
                $mail = build_session_charge_email($lang, [
                    'player_name' => (string)$player['name'],
                    'session_name' => $sessionName,
                    'date' => $date,
                    'time_start' => $timeStart,
                    'time_end' => $timeEnd,
                    'slots' => (int)($info['slots'] ?? 0),
                    'debit' => $debit,
                    'direct_paid' => $directPaid,
                    'outlay_credit' => $outlayCredit,
                    'billing_type' => $billingType,
                    'new_balance' => $newBalance,
                    'currency' => $currency,
                    'app_url' => $appUrl,
                    'club_name' => $teamName,
                ]);
                send_resend_email($email, $mail['subject'], $mail['html'], $mail['text'], $teamName);
            }
        }
    } catch (Throwable $e) {
        error_log('Session charge notification error: ' . $e->getMessage());
    }
}

function notify_deposit_received(PDO $db, string $playerId, float $amount, string $date, ?string $note): void {
    try {
        $pStmt = $db->prepare("SELECT id, name, contact, language, COALESCE(notify_deposit, 0) AS notify_deposit FROM players WHERE id=?");
        $pStmt->execute([$playerId]);
        $player = $pStmt->fetch();
        if (!$player || (int)($player['notify_deposit'] ?? 0) !== 1) return;

        $email = trim((string)($player['contact'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) return;

        $cfgRows = $db->query("SELECT key, value FROM config WHERE key IN ('language','team_name','currency')")->fetchAll(PDO::FETCH_KEY_PAIR);
        $defaultLang = in_array($cfgRows['language'] ?? '', ['de', 'en', 'es', 'it', 'fr', 'pt'], true) ? $cfgRows['language'] : 'de';
        $teamName = trim((string)($cfgRows['team_name'] ?? '')) ?: 'Courtle';
        $currency = trim((string)($cfgRows['currency'] ?? '')) ?: '€';
        $lang = in_array($player['language'] ?? '', ['de', 'en', 'es', 'it', 'fr', 'pt'], true)
            ? $player['language']
            : $defaultLang;

        $newBalance = get_player_balance($db, $playerId);
        $mail = build_deposit_email($lang, [
            'player_name' => (string)$player['name'],
            'amount' => $amount,
            'date' => $date,
            'note' => $note ?? '',
            'new_balance' => $newBalance,
            'currency' => $currency,
            'app_url' => get_app_instance_url(),
            'club_name' => $teamName,
        ]);
        send_resend_email($email, $mail['subject'], $mail['html'], $mail['text'], $teamName);
    } catch (Throwable $e) {
        error_log('Deposit notification error: ' . $e->getMessage());
    }
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
if (!isset($_SERVER['REQUEST_METHOD'])) return;
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
            $resource === 'charge'   && $method === 'DELETE' && $id => handle_charge_revert($id),
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

            // ── Healthcheck (public) ──
            $resource === 'health' && $method === 'GET'          => json_out(['status' => 'ok', 'app' => 'courtle', 'timestamp' => time()]),

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
            $resource === 'test-emails' && $method === 'GET' => handle_test_emails(),

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
    $ip = courtle_client_ip();
    $canLock = !is_internal_ip($ip);
    $key = $ip . ':' . $pid;

    // Get current attempts record
    $stmt = $db->prepare("SELECT attempts, locked_since FROM login_attempts WHERE ip = ?");
    $stmt->execute([$key]);
    $attempt = $stmt->fetch();

    if ($attempt) {
        $attempts = (int)$attempt['attempts'];
        $lockedSince = $attempt['locked_since'] ?? null;

        // Check if currently locked (skip if internal proxy IP)
        if ($canLock && $attempts >= 3 && $lockedSince !== null) {
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
        // Set lock when attempts reach 3, 6, 9, ... (every 3rd attempt, but never on internal proxies)
        if ($canLock && $newAttempts % 3 === 0) {
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
    $rows = db()->query("SELECT id, name, contact, created_at, last_login, last_interaction, admin, emoji, active, language, theme, COALESCE(notify_email, 0) AS notify_email, COALESCE(notify_charge, 0) AS notify_charge, COALESCE(notify_deposit, 0) AS notify_deposit FROM players ORDER BY name")->fetchAll();
    
    // Attach balance
    foreach ($rows as &$p) {
        $p['notify_email'] = (int)($p['notify_email'] ?? 0);
        $p['notify_charge'] = (int)($p['notify_charge'] ?? 0);
        $p['notify_deposit'] = (int)($p['notify_deposit'] ?? 0);
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
    $emoji = isset($b['emoji']) && !empty($b['emoji']) ? (string)$b['emoji'] : null;

    if ($count == 0) {
        // First player ever - no auth required, auto-make admin
        $id = gid();
        $pin_hash = isset($b['pin']) && $b['pin'] ? password_hash($b['pin'], PASSWORD_DEFAULT) : null;
        $stmt = $db->prepare("INSERT INTO players (id,name,contact,pin_hash,created_at,admin,emoji) VALUES (?,?,?,?,?,1,?)");
        $stmt->execute([$id, $b['name'], $b['contact'] ?? null, $pin_hash, date('c'), $emoji]);
        json_out(['id' => $id, 'name' => $b['name'], 'admin' => true], 201);
    } else {
        // Normal flow - require admin
        require_auth(true);
        $id = gid();
        $pin_hash = isset($b['pin']) && $b['pin'] ? password_hash($b['pin'], PASSWORD_DEFAULT) : null;
        $admin_flag = isset($b['admin']) && $b['admin'] ? 1 : 0;
        $stmt = $db->prepare("INSERT INTO players (id,name,contact,pin_hash,created_at,admin,emoji) VALUES (?,?,?,?,?,?,?)");
        $stmt->execute([$id, $b['name'], $b['contact'] ?? null, $pin_hash, date('c'), $admin_flag, $emoji]);
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
    if (array_key_exists('contact', $b) && $b['contact'] === null) {
        $db->prepare("UPDATE players SET contact=NULL WHERE id=?")->execute([$id]);
    }
    $notifyKeys = ['notify_email', 'notify_charge', 'notify_deposit'];
    $hasAnyNotifyKey = false;
    foreach ($notifyKeys as $nk) {
        if (array_key_exists($nk, $b)) {
            $hasAnyNotifyKey = true;
            break;
        }
    }
    if (array_key_exists('contact', $b)) {
        $effectiveContact = trim((string)($b['contact'] ?? ''));
    } else {
        $cStmt = $db->prepare("SELECT contact FROM players WHERE id=?");
        $cStmt->execute([$id]);
        $effectiveContact = trim((string)($cStmt->fetchColumn() ?? ''));
    }
    if ($hasAnyNotifyKey) {
        foreach ($notifyKeys as $nk) {
            if (!array_key_exists($nk, $b)) continue;
            $want = !empty($b[$nk]) ? 1 : 0;
            if ($want === 1 && ($effectiveContact === '' || !filter_var($effectiveContact, FILTER_VALIDATE_EMAIL))) {
                err('Valid email address required for notifications.', 400);
            }
            $db->prepare("UPDATE players SET $nk=? WHERE id=?")->execute([$want, $id]);
        }
    } elseif (array_key_exists('contact', $b) && $effectiveContact === '') {
        $db->prepare("UPDATE players SET notify_email=0, notify_charge=0, notify_deposit=0 WHERE id=?")->execute([$id]);
    }
    if (array_key_exists('emoji', $b)) $db->prepare("UPDATE players SET emoji=? WHERE id=?")->execute([$b['emoji'], $id]);
    if (array_key_exists('language', $b)) {
        $lang = $b['language'];
        if ($lang === null || $lang === '') {
            $db->prepare("UPDATE players SET language=NULL WHERE id=?")->execute([$id]);
        } elseif (in_array($lang, ['de', 'en', 'es', 'it', 'fr', 'pt'], true)) {
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
    $wlSessions = $db->query("SELECT id, waitlist FROM sessions")->fetchAll();
    foreach ($wlSessions as $s) {
        $wl = json_decode($s['waitlist'], true) ?? [];
        $changed = false;
        foreach ($wl as $k => $v) {
            $base = explode('|', $v)[0];
            if ($base === $id) { unset($wl[$k]); $changed = true; }
        }
        if ($changed) {
            $wl = array_values($wl);
            $db->prepare("UPDATE sessions SET waitlist=? WHERE id=?")->execute([json_encode($wl), $s['id']]);
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
    $db = db();
    $id = gid();
    $isCredit = !empty($b['credit']) ? 1 : 0;
    $amount = (float)$b['amount'];
    $txDate = $b['date'] ?? date('Y-m-d');
    $note = $b['note'] ?? null;
    $stmt = $db->prepare("INSERT INTO transactions (id,player_id,credit,amount,date,created_at,note) VALUES (?,?,?,?,?,?,?)");
    $stmt->execute([$id, $b['player_id'], $isCredit, $amount, $txDate, date('c'), $note]);
    if ($isCredit === 1 && $amount > 0) {
        notify_deposit_received($db, (string)$b['player_id'], $amount, (string)$txDate, $note !== null ? (string)$note : null);
    }
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
    // public endpoint (unless total_privacy_mode is active)
    $db   = db();
    $totalPrivacy = $db->query("SELECT value FROM config WHERE key='total_privacy_mode'")->fetchColumn() === '1';
    if ($totalPrivacy && !token_valid()) {
        json_out([]);
    }
    $rows = $db->query("SELECT * FROM sessions ORDER BY date ASC, time_start ASC, id ASC")->fetchAll();
    $out  = [];
    foreach ($rows as $s) {
        $courts_raw = $db->prepare("SELECT court_index, slot_index, player_id FROM courts WHERE session_id=? ORDER BY court_index, slot_index");
        $courts_raw->execute([$s['id']]);
        $slots = $courts_raw->fetchAll();
        // Rebuild courts array
        $courts = [];
        foreach ($slots as $sl) {
            $courts[$sl['court_index']][$sl['slot_index']] = $sl['player_id'];
        }
        ksort($courts);
        foreach ($courts as &$c) ksort($c);
        
        $maxCourtIdx = !empty($courts) ? max(array_keys($courts)) + 1 : 0;
        $numCourts = max($maxCourtIdx, intval($db->query("SELECT value FROM config WHERE key='courts'")->fetchColumn() ?: 2));
        $fullCourts = [];
        for ($ci = 0; $ci < $numCourts; $ci++) {
            for ($si = 0; $si < 4; $si++) {
                $fullCourts[$ci][$si] = $courts[$ci][$si] ?? null;
            }
        }
        $out[] = [
            'id'             => $s['id'],
            'date'           => $s['date'],
            'charged'        => (bool)$s['charged'],
            'disabledCourts' => json_decode($s['disabled_courts'], true) ?: [],
            'waitlist'       => json_decode($s['waitlist'], true) ?: [],
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
            'billingDeferred'=> (bool)($s['billing_deferred'] ?? 0),
        ];
    }
    json_out($out);
}

// ── Series ──
function handle_series_list(): void {
    // public endpoint (unless total_privacy_mode is active)
    $db   = db();
    $totalPrivacy = $db->query("SELECT value FROM config WHERE key='total_privacy_mode'")->fetchColumn() === '1';
    if ($totalPrivacy && !token_valid()) {
        json_out([]);
    }
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

function handle_session_update(string $idOrDate): void {
    require_auth(true);
    $b  = body();
    $db = db();

    $sess = get_session_row($db, $idOrDate);
    $sessId = $sess ? $sess['id'] : (is_uuid($idOrDate) ? $idOrDate : uuid_v4());
    $sessDate = $sess ? $sess['date'] : ($b['date'] ?? (preg_match('/^\d{4}-\d{2}-\d{2}$/', $idOrDate) ? $idOrDate : date('Y-m-d')));

    // Charged-Check vor allen Mutationen
    if ($sess && $sess['charged']) {
        $hasMutations = isset($b['timeStart']) || isset($b['timeEnd']) || isset($b['newDate'])
            || isset($b['disabledCourts']) || isset($b['waitlist']) || isset($b['note'])
            || isset($b['location']) || isset($b['courts']) || isset($b['cancelled']) || isset($b['price'])
            || isset($b['name']) || isset($b['courtNames']) || isset($b['billingDeferred']);
        if ($hasMutations) {
            err('This session has already been charged. No more changes are possible.', 403);
        }
    }

    if (isset($b['newDate'])) {
        $newDate = $b['newDate'];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $newDate)) err('Invalid date format.', 400);
        if ($sess && $sess['charged']) err('Session has already been charged. Cannot move.', 403);

        $db->beginTransaction();
        $db->prepare("UPDATE sessions SET date=? WHERE id=?")->execute([$newDate, $sessId]);
        $db->prepare("UPDATE session_history SET session_date=? WHERE session_id=?")->execute([$newDate, $sessId]);
        $db->commit();
        $sessDate = $newDate;
    }

    // Upsert session row if not exists
    if (!$sess) {
        $db->prepare("INSERT INTO sessions (id, date, charged, disabled_courts, waitlist, note, time_start, time_end, cancelled, location, price, cancel_hours, name, court_names, billing_deferred)
            VALUES (?, ?, 0, '[]', '[]', '', ?, ?, 0, ?, ?, ?, ?, ?, ?)")
           ->execute([
               $sessId,
               $sessDate,
               $b['timeStart'] ?? null,
               $b['timeEnd'] ?? null,
               $b['location'] ?? null,
               isset($b['price']) && $b['price'] !== null ? (float)$b['price'] : null,
               isset($b['cancelHours']) && $b['cancelHours'] !== null ? (float)$b['cancelHours'] : null,
               $b['name'] ?? null,
               isset($b['courtNames']) && is_array($b['courtNames']) ? json_encode(array_values($b['courtNames'])) : '[]',
               !empty($b['billingDeferred']) ? 1 : 0
           ]);
    }

    if (isset($b['timeStart'])) {
        $db->prepare("UPDATE sessions SET time_start=? WHERE id=?")->execute([$b['timeStart'], $sessId]);
    }
    if (isset($b['timeEnd'])) {
        $db->prepare("UPDATE sessions SET time_end=? WHERE id=?")->execute([$b['timeEnd'], $sessId]);
    }

    $performed_by = get_performer_id();

    // Get current session data for comparison
    $stmt = $db->prepare("SELECT disabled_courts, waitlist FROM sessions WHERE id=?");
    $stmt->execute([$sessId]);
    $current = $stmt->fetch();
    $old_disabled = $current ? (json_decode($current['disabled_courts'], true) ?: []) : [];
    $old_waitlist = $current ? (json_decode($current['waitlist'], true) ?: []) : [];

    // Log court cancellations
    if (isset($b['disabledCourts'])) {
        $new_disabled = $b['disabledCourts'];
        $cancelled = array_diff($new_disabled, $old_disabled);
        foreach ($cancelled as $ci) {
            log_session_history($db, $sessId, null, 'court_cancelled', $ci, null, $performed_by, null, $sessDate);
        }
        $db->prepare("UPDATE sessions SET disabled_courts=? WHERE id=?")->execute([json_encode($b['disabledCourts']), $sessId]);
    }

    // Log waitlist changes
    $waitlistLeft = [];
    if (isset($b['waitlist'])) {
        $new_waitlist = $b['waitlist'];
        $joined = array_diff($new_waitlist, $old_waitlist);
        foreach ($joined as $pid) {
            log_session_history($db, $sessId, $pid, 'waitlist_join', null, null, $performed_by, null, $sessDate);
        }
        $left = array_diff($old_waitlist, $new_waitlist);
        $waitlistLeft = $left;
        foreach ($left as $pid) {
            log_session_history($db, $sessId, $pid, 'waitlist_leave', null, null, $performed_by, null, $sessDate);
        }
        $db->prepare("UPDATE sessions SET waitlist=? WHERE id=?")->execute([json_encode($b['waitlist']), $sessId]);
    }

    if (isset($b['note'])) {
        $db->prepare("UPDATE sessions SET note=? WHERE id=?")->execute([$b['note'], $sessId]);
    }
    if (isset($b['location'])) {
        $db->prepare("UPDATE sessions SET location=? WHERE id=?")->execute([$b['location'], $sessId]);
    }
    if (isset($b['price'])) {
        $db->prepare("UPDATE sessions SET price=? WHERE id=?")->execute([$b['price'] === null ? null : (float)$b['price'], $sessId]);
    }
    if (isset($b['cancelHours'])) {
        $db->prepare("UPDATE sessions SET cancel_hours=? WHERE id=?")->execute([$b['cancelHours'] === null || $b['cancelHours'] === '' ? null : (float)$b['cancelHours'], $sessId]);
    }
    if (isset($b['name'])) {
        $db->prepare("UPDATE sessions SET name=? WHERE id=?")->execute([$b['name'] === '' || $b['name'] === null ? null : $b['name'], $sessId]);
    }
    if (isset($b['courtNames'])) {
        $db->prepare("UPDATE sessions SET court_names=? WHERE id=?")->execute([is_array($b['courtNames']) ? json_encode(array_values($b['courtNames'])) : null, $sessId]);
    }

    $manualPromotions = [];
    if (isset($b['courts'])) {
        // Get old courts for comparison
        $stmt_old = $db->prepare("SELECT court_index, slot_index, player_id FROM courts WHERE session_id=?");
        $stmt_old->execute([$sessId]);
        $old_slots = [];
        $oldCourtPids = [];
        foreach ($stmt_old->fetchAll() as $row) {
            $key = $row['court_index'] . '|' . $row['slot_index'];
            $old_slots[$key] = $row['player_id'];
            if (!empty($row['player_id'])) {
                $oldCourtPids[(string)$row['player_id']] = true;
            }
        }

        $db->prepare("DELETE FROM courts WHERE session_id=?")->execute([$sessId]);
        $stmt = $db->prepare("INSERT INTO courts (session_id, court_index, slot_index, player_id) VALUES (?,?,?,?)");
        $newCourtSlots = [];

        foreach ($b['courts'] as $ci => $slots) {
            foreach ($slots as $si => $pid) {
                $stmt->execute([$sessId, $ci, $si, $pid ?: null]);
                if ($pid) {
                    $newCourtSlots[(string)$pid] = (int)$ci;
                }

                $key = $ci . '|' . $si;
                $old_pid = $old_slots[$key] ?? null;

                if ($old_pid !== $pid) {
                    if ($old_pid && !$pid) {
                        $base = explode('|', $old_pid)[0];
                        log_session_history($db, $sessId, $base, 'leave', $ci, $si, $performed_by, null, $sessDate);
                    } elseif (!$old_pid && $pid) {
                        $base = explode('|', $pid)[0];
                        $isGuest = str_contains($pid, '|');
                        $details = $isGuest ? json_encode(['guest' => true, 'full_id' => $pid]) : null;
                        log_session_history($db, $sessId, $base, 'book', $ci, $si, $performed_by, $details, $sessDate);
                    } elseif ($old_pid && $pid && $old_pid !== $pid) {
                        $base_old = explode('|', $old_pid)[0];
                        log_session_history($db, $sessId, $base_old, 'leave', $ci, $si, $performed_by, null, $sessDate);
                        $base_new = explode('|', $pid)[0];
                        $isGuest = str_contains($pid, '|');
                        $details = $isGuest ? json_encode(['guest' => true, 'full_id' => $pid]) : null;
                        log_session_history($db, $sessId, $base_new, 'book', $ci, $si, $performed_by, $details, $sessDate);
                    }
                }
            }
        }

        if (!empty($waitlistLeft)) {
            foreach ($waitlistLeft as $pid) {
                $pidStr = (string)$pid;
                if ($pidStr !== '' && !isset($oldCourtPids[$pidStr]) && isset($newCourtSlots[$pidStr])) {
                    $manualPromotions[] = ['player_id' => $pidStr, 'court_index' => $newCourtSlots[$pidStr]];
                }
            }
        }
    }

    if (isset($b['interaction_pids'])) {
        $now = date('c');
        foreach ($b['interaction_pids'] as $pid) {
            $base = explode('|', $pid)[0];
            $db->prepare("UPDATE players SET last_interaction=? WHERE id=?")->execute([$now, $base]);
        }
    }

    if (isset($b['cancelled'])) {
        $db->prepare("UPDATE sessions SET cancelled=? WHERE id=?")->execute([$b['cancelled'] ? 1 : 0, $sessId]);
    }

    if (isset($b['billingDeferred'])) {
        $db->prepare("UPDATE sessions SET billing_deferred=? WHERE id=?")->execute([$b['billingDeferred'] ? 1 : 0, $sessId]);
    }

    if (!empty($manualPromotions)) {
        notify_waitlist_promotions($db, $sessId, $manualPromotions);
    }

    json_out(['ok' => true, 'id' => $sessId, 'date' => $sessDate]);
}

function handle_session_delete(string $idOrDate): void {
    require_auth(true);
    $db = db();

    $sess = get_session_row($db, $idOrDate);
    if (!$sess) err('Session not found.', 404);
    if (!$sess['cancelled']) err('Only cancelled sessions can be deleted.', 400);
    if ($sess['charged']) err('Already charged sessions cannot be deleted.', 400);

    $sessId = $sess['id'];
    $db->prepare("DELETE FROM courts WHERE session_id=?")->execute([$sessId]);
    $db->prepare("DELETE FROM session_history WHERE session_id=?")->execute([$sessId]);
    $db->prepare("DELETE FROM sessions WHERE id=?")->execute([$sessId]);

    json_out(['ok' => true]);
}

// ── Expenses ──
function get_expense_sessions_map(PDO $db): array {
    $map = [];
    $rows = $db->query("SELECT expense_id, session_id FROM expense_sessions")->fetchAll();
    foreach ($rows as $r) {
        $map[$r['expense_id']][] = $r['session_id'];
    }
    return $map;
}

function sync_expense_sessions(PDO $db, string $expenseId, array $sessionIds): array {
    $clean = array_values(array_unique(array_filter(array_map('strval', $sessionIds), fn($s) => $s !== '')));
    $db->prepare("DELETE FROM expense_sessions WHERE expense_id=?")->execute([$expenseId]);
    if ($clean) {
        $ins = $db->prepare("INSERT OR IGNORE INTO expense_sessions (expense_id, session_id) VALUES (?, ?)");
        foreach ($clean as $sid) {
            $ins->execute([$expenseId, $sid]);
        }
    }
    return $clean;
}

function handle_expenses_list(): void {
    require_auth();
    $db = db();
    $rows = $db->query("SELECT * FROM expenses ORDER BY date DESC")->fetchAll();
    $map = get_expense_sessions_map($db);
    foreach ($rows as &$row) {
        $ids = $map[$row['id']] ?? [];
        if (!empty($row['session_id']) && !in_array($row['session_id'], $ids, true)) {
            $ids[] = $row['session_id'];
        }
        $row['session_ids'] = array_values(array_unique($ids));
    }
    unset($row);
    json_out($rows);
}

function handle_expense_create(): void {
    require_auth(true);
    $b = body();
    if (empty($b['amount'])) err('Amount is required.');
    $id = gid();
    $paidBy = !empty($b['paid_by']) ? (string)$b['paid_by'] : null;
    $sessionIds = [];
    if (isset($b['session_ids']) && is_array($b['session_ids'])) {
        $sessionIds = $b['session_ids'];
    } elseif (!empty($b['session_id'])) {
        $sessionIds = [(string)$b['session_id']];
    }
    $cleanPre = array_values(array_unique(array_filter(array_map('strval', $sessionIds), fn($s) => $s !== '')));
    $legacySessionId = count($cleanPre) === 1 ? $cleanPre[0] : (!empty($b['session_id']) ? (string)$b['session_id'] : null);

    $db = db();
    $db->exec('BEGIN IMMEDIATE');
    try {
        $stmt = $db->prepare("INSERT INTO expenses (id, amount, date, note, created_at, session_id, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, (float)$b['amount'], $b['date'] ?? date('Y-m-d'), $b['note'] ?? '', date('c'), $legacySessionId, $paidBy]);
        $cleanIds = sync_expense_sessions($db, $id, $cleanPre);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
    json_out(['id' => $id, 'session_ids' => $cleanIds], 201);
}

function handle_expense_update(string $id): void {
    require_auth(true);
    $b = body();
    $amt = (float)($b['amount'] ?? 0);
    if ($amt <= 0) err('Invalid amount.');
    $paidBy = array_key_exists('paid_by', $b) ? (!empty($b['paid_by']) ? (string)$b['paid_by'] : null) : null;

    $db = db();
    $db->exec('BEGIN IMMEDIATE');
    try {
        $stmt = $db->prepare("UPDATE expenses SET amount=?, date=?, note=?, paid_by=? WHERE id=?");
        $stmt->execute([$amt, $b['date'] ?? date('Y-m-d'), $b['note'] ?? '', $paidBy, $id]);
        if (array_key_exists('session_ids', $b) && is_array($b['session_ids'])) {
            $cleanIds = sync_expense_sessions($db, $id, $b['session_ids']);
            $legacySessionId = count($cleanIds) === 1 ? $cleanIds[0] : null;
            $db->prepare("UPDATE expenses SET session_id=? WHERE id=?")->execute([$legacySessionId, $id]);
        }
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
    json_out(['ok' => true]);
}

function handle_expense_delete(string $id): void {
    require_auth(true);
    $db = db();
    $db->exec('BEGIN IMMEDIATE');
    try {
        $db->prepare("DELETE FROM expense_sessions WHERE expense_id=?")->execute([$id]);
        $db->prepare("DELETE FROM expenses WHERE id=?")->execute([$id]);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
    json_out(['ok' => true]);
}

function compute_individual_slot_shares(float $totalPrice, array $slotsByPid, string $roundingMode, ?string $paidByPid): array {
    $totalSlots = array_sum(array_map('count', $slotsByPid));
    if ($totalSlots <= 0) return [];

    // Convert to integer cents to avoid floating point imprecision
    $totalCents = (int)round($totalPrice * 100);
    $slotShares = [];

    if ($roundingMode === 'exact') {
        $baseCents = intdiv($totalCents, $totalSlots);
        $remCents  = $totalCents % $totalSlots;

        $slotOrder = [];
        // If paidByPid is among participants, prioritize their slot(s) for the extra cent
        if ($paidByPid && isset($slotsByPid[$paidByPid])) {
            foreach ($slotsByPid[$paidByPid] as $sid) $slotOrder[] = $sid;
        }
        foreach ($slotsByPid as $pid => $slotIds) {
            if ($pid === $paidByPid) continue;
            foreach ($slotIds as $sid) $slotOrder[] = $sid;
        }

        for ($i = 0; $i < count($slotOrder); $i++) {
            $extra = ($i < $remCents) ? 1 : 0;
            $slotShares[$slotOrder[$i]] = round(($baseCents + $extra) / 100, 2);
        }
    } elseif ($roundingMode === 'ceil') {
        $slotCents = (int)ceil($totalCents / $totalSlots);
        foreach ($slotsByPid as $slotIds) {
            foreach ($slotIds as $sid) {
                $slotShares[$sid] = round($slotCents / 100, 2);
            }
        }
    } else { // 'round' (standard commercial rounding)
        $slotCents = (int)round($totalCents / $totalSlots);
        foreach ($slotsByPid as $slotIds) {
            foreach ($slotIds as $sid) {
                $slotShares[$sid] = round($slotCents / 100, 2);
            }
        }
    }

    return $slotShares;
}

function compute_slot_shares(float $totalPrice, array $counts, string $roundingMode, ?string $paidByPid): array {
    $slotsByPid = [];
    foreach ($counts as $pid => $n) {
        $slotsByPid[$pid] = [];
        for ($i = 0; $i < $n; $i++) {
            $slotsByPid[$pid][] = "$pid#$i";
        }
    }
    $slotShares = compute_individual_slot_shares($totalPrice, $slotsByPid, $roundingMode, $paidByPid);
    $shares = [];
    foreach ($slotsByPid as $pid => $slotIds) {
        $shares[$pid] = round(array_sum(array_map(fn($sid) => $slotShares[$sid] ?? 0.0, $slotIds)), 2);
    }
    return $shares;
}

// ── Charge ──
function charge_session(PDO $db, array $sess, array $paidPids, string $now, string $performedBy, ?float $totalPriceOverride = null, ?string $paidByPlayerId = null, bool $recordTeamExpense = false, ?string $linkExpenseId = null, ?array $paidSlots = null): array {
    if ($sess['charged']) throw new RuntimeException('Already charged.');
    if (!empty($sess['cancelled'])) throw new RuntimeException('Cancelled sessions cannot be charged.');

    $sessId = $sess['id'];
    $date = $sess['date'];

    $courts_stmt = $db->prepare("SELECT court_index, player_id FROM courts WHERE session_id=? AND player_id IS NOT NULL");
    $courts_stmt->execute([$sessId]);
    $slots = $courts_stmt->fetchAll();

    // Group by baseId, preserving individual slot IDs (main + |g1, |g2)
    $counts = [];
    $slotsByPid = [];
    foreach ($slots as $sl) {
        $slotId = $sl['player_id'];
        $base = explode('|', $slotId)[0];
        $counts[$base] = ($counts[$base] ?? 0) + 1;
        $slotsByPid[$base][] = $slotId;
    }
    foreach ($slotsByPid as $base => &$slotIds) {
        usort($slotIds, function ($a, $b) use ($base) {
            if ($a === $base) return -1;
            if ($b === $base) return 1;
            return strcmp($a, $b);
        });
    }
    unset($slotIds);

    $totalSlots = array_sum($counts);
    if ($totalSlots <= 0) throw new RuntimeException('Session has no booked slots.');

    $cost = (float)($db->query("SELECT value FROM config WHERE key='cost'")->fetchColumn() ?? 10);
    if ($sess['price'] !== null) $cost = (float)$sess['price'];

    $roundingMode = $db->query("SELECT value FROM config WHERE key='billing_rounding'")->fetchColumn() ?: 'exact';
    if (!in_array($roundingMode, ['exact', 'ceil', 'round'], true)) $roundingMode = 'exact';

    $isCustomPrice = ($totalPriceOverride !== null && $totalPriceOverride >= 0);
    $totalPrice = $isCustomPrice ? (float)$totalPriceOverride : ($cost * $totalSlots);

    // Compute per-slot and player debit amounts
    $slotShares = [];
    $playerDebits = [];
    if ($isCustomPrice) {
        $slotShares = compute_individual_slot_shares($totalPrice, $slotsByPid, $roundingMode, $paidByPlayerId);
        foreach ($slotsByPid as $pid => $slotIds) {
            $playerDebits[$pid] = round(array_sum(array_map(fn($sid) => $slotShares[$sid] ?? 0.0, $slotIds)), 2);
        }
        // Persist new per-slot price on the session
        $avgSlotPrice = round($totalPrice / $totalSlots, 2);
        $db->prepare("UPDATE sessions SET price=? WHERE id=?")->execute([$avgSlotPrice, $sessId]);
    } else {
        foreach ($slotsByPid as $pid => $slotIds) {
            $n = count($slotIds);
            $playerDebits[$pid] = round($cost * $n, 2);
            foreach ($slotIds as $sid) {
                $slotShares[$sid] = round($cost, 2);
            }
        }
    }

    $tx = $db->prepare("INSERT INTO transactions (id,player_id,credit,amount,date,created_at,note,session_id) VALUES (?,?,?,?,?,?,?,?)");
    $timeLabel = $sess['time_start'] ? " ({$sess['time_start']})" : "";
    $total = 0.0;
    $direct = 0.0;
    $playerBilling = [];
    foreach ($counts as $pid => $n) {
        $amt  = $playerDebits[$pid] ?? 0.0;
        $note = $n > 1 ? "Session $date$timeLabel (+" . ($n-1) . " Guest)" : "Session $date$timeLabel";
        // 1. Charge (debit)
        $tx->execute([gid(), $pid, 0, $amt, $date, $now, $note, $sessId]);
        $total += $amt;
        $directForPid = 0.0;
        // 2. Direct payment (counter-booking) for players/guests who paid on site
        if ($paidSlots !== null) {
            $paidForPid = array_values(array_filter($slotsByPid[$pid], fn($sid) => in_array($sid, $paidSlots, true)));
            if (count($paidForPid) > 0) {
                $directAmt = count($paidForPid) === count($slotsByPid[$pid])
                    ? $amt
                    : round(array_sum(array_map(fn($sid) => $slotShares[$sid] ?? 0.0, $paidForPid)), 2);
                $directNote = count($paidForPid) < $n
                    ? "Direct payment $date$timeLabel (" . count($paidForPid) . "/$n)"
                    : "Direct payment $date$timeLabel";
                $tx->execute([gid(), $pid, 1, $directAmt, $date, $now, $directNote, $sessId]);
                $direct += $directAmt;
                $directForPid = $directAmt;
            }
        } elseif (in_array($pid, $paidPids, true)) {
            $tx->execute([gid(), $pid, 1, $amt, $date, $now, "Direct payment $date$timeLabel", $sessId]);
            $direct += $amt;
            $directForPid = $amt;
        }
        $playerBilling[(string)$pid] = [
            'slots' => (int)$n,
            'debit' => $amt,
            'direct_paid' => $directForPid,
            'outlay_credit' => 0.0,
        ];
    }

    // 3. Player outlay reimbursement or team expense
    if (!empty($paidByPlayerId)) {
        // Find player name for note
        $pNameStmt = $db->prepare("SELECT name FROM players WHERE id=?");
        $pNameStmt->execute([$paidByPlayerId]);
        $pName = $pNameStmt->fetchColumn() ?: 'Spieler';
        
        $reimburseAmt = round($totalPrice, 2);
        // Credit on player's account
        $tx->execute([gid(), $paidByPlayerId, 1, $reimburseAmt, $date, $now, "Auslage Session $date$timeLabel", $sessId]);
        if (!isset($playerBilling[$paidByPlayerId])) {
            $playerBilling[$paidByPlayerId] = ['slots' => 0, 'debit' => 0.0, 'direct_paid' => 0.0, 'outlay_credit' => 0.0];
        }
        $playerBilling[$paidByPlayerId]['outlay_credit'] += $reimburseAmt;
        // Expense record
        $expId = gid();
        $expStmt = $db->prepare("INSERT INTO expenses (id, amount, date, note, created_at, session_id, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $expStmt->execute([$expId, $reimburseAmt, $date, "Session $date$timeLabel (Auslage: $pName)", $now, $sessId, $paidByPlayerId]);
        $db->prepare("INSERT OR IGNORE INTO expense_sessions (expense_id, session_id) VALUES (?, ?)")->execute([$expId, $sessId]);
    } elseif ($recordTeamExpense) {
        $expAmt = round($totalPrice, 2);
        $expId = gid();
        $expStmt = $db->prepare("INSERT INTO expenses (id, amount, date, note, created_at, session_id, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $expStmt->execute([$expId, $expAmt, $date, "Session $date$timeLabel", $now, $sessId, null]);
        $db->prepare("INSERT OR IGNORE INTO expense_sessions (expense_id, session_id) VALUES (?, ?)")->execute([$expId, $sessId]);
    } elseif (!empty($linkExpenseId)) {
        $chkExp = $db->prepare("SELECT id FROM expenses WHERE id=?");
        $chkExp->execute([$linkExpenseId]);
        if ($chkExp->fetchColumn()) {
            $db->prepare("INSERT OR IGNORE INTO expense_sessions (expense_id, session_id) VALUES (?, ?)")->execute([$linkExpenseId, $sessId]);
        }
    }

    $db->prepare("UPDATE sessions SET charged=1, billing_deferred=0 WHERE id=?")->execute([$sessId]);
    log_session_history($db, $sessId, null, 'charged', null, null, $performedBy,
        json_encode([
            'players' => count($counts),
            'slots' => array_sum($counts),
            'amount' => $total,
            'total_price' => $totalPrice,
            'direct' => $direct,
            'paid_pids' => array_values($paidPids),
            'paid_slots' => $paidSlots !== null ? array_values($paidSlots) : null,
            'paid_by_player_id' => $paidByPlayerId,
            'record_team_expense' => $recordTeamExpense,
            'link_expense_id' => $linkExpenseId
        ]), $date);

    return [
        'session_id' => $sessId,
        'players' => count($counts),
        'slots' => array_sum($counts),
        'amount' => $total,
        '_notify' => ['session_id' => $sessId, 'player_billing' => $playerBilling],
    ];
}

function handle_charge(): void {
    require_auth(true);
    $b = body();

    // New format: {items:[{id, paid_pids:[]}]}  |  Legacy: {id|date, paid_pids:[]}
    $items = $b['items'] ?? null;
    if (!is_array($items)) {
        $idOrDate = $b['id'] ?? $b['date'] ?? '';
        if (!$idOrDate) err('Session ID or Date is required.');
        $items = [['id' => $idOrDate, 'paid_pids' => $b['paid_pids'] ?? []]];
    }
    if (!$items) err('No sessions given.');

    $db = db();
    $now = date('c');
    $by = get_performer_id();
    $results = [];
    $notifyBatches = [];
    $db->exec('BEGIN IMMEDIATE');
    try {
        foreach ($items as $it) {
            $id = (string)($it['id'] ?? '');
            if ($id === '') throw new RuntimeException('Session ID is required.');
            $sess = get_session_row($db, $id);
            if (!$sess) throw new RuntimeException("Session not found: $id");
            $paid = array_map('strval', is_array($it['paid_pids'] ?? null) ? $it['paid_pids'] : []);
            $paidSlots = array_key_exists('paid_slots', $it) && is_array($it['paid_slots'])
                ? array_map('strval', $it['paid_slots'])
                : null;
            
            $totalPrice = isset($it['total_price']) && $it['total_price'] !== '' && $it['total_price'] !== null ? (float)$it['total_price'] : null;
            $paidByPlayerId = !empty($it['paid_by_player_id']) ? (string)$it['paid_by_player_id'] : null;
            $recordTeamExpense = !empty($it['record_team_expense']);
            $linkExpenseId = !empty($it['link_expense_id']) ? (string)$it['link_expense_id'] : null;

            $res = charge_session($db, $sess, $paid, $now, $by, $totalPrice, $paidByPlayerId, $recordTeamExpense, $linkExpenseId, $paidSlots);
            if (!empty($res['_notify'])) {
                $notifyBatches[] = $res['_notify'];
                unset($res['_notify']);
            }
            $results[] = $res;
        }
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        err($e->getMessage(), 400);
    }
    if (!empty($notifyBatches)) {
        notify_session_charges($db, $notifyBatches);
    }
    $payload = ['ok' => true, 'results' => $results,
        'charged' => array_sum(array_column($results, 'players')), 'slots' => array_sum(array_column($results, 'slots'))];
    json_out($payload);
}

function handle_charge_revert(string $idOrDate): void {
    require_auth(true);
    $db = db();
    $db->exec('BEGIN IMMEDIATE');
    try {
        $sess = get_session_row($db, $idOrDate);
        if (!$sess) { $db->exec('ROLLBACK'); err('Session not found.', 404); }
        if (!$sess['charged']) { $db->exec('ROLLBACK'); err('Session is not charged.', 400); }
        $sessId = $sess['id'];

        $q = $db->prepare("SELECT credit, amount FROM transactions WHERE session_id=?");
        $q->execute([$sessId]);
        $rows = $q->fetchAll();
        if (!$rows) { $db->exec('ROLLBACK'); err('Legacy charge cannot be reverted automatically.', 409); }

        $debit = 0.0; $direct = 0.0;
        foreach ($rows as $r) { if ($r['credit']) $direct += (float)$r['amount']; else $debit += (float)$r['amount']; }

        $db->prepare("DELETE FROM transactions WHERE session_id=?")->execute([$sessId]);
        $autoExps = $db->prepare("SELECT id FROM expenses WHERE session_id=?");
        $autoExps->execute([$sessId]);
        foreach ($autoExps->fetchAll(PDO::FETCH_COLUMN) as $expId) {
            $cntStmt = $db->prepare("SELECT COUNT(*) FROM expense_sessions WHERE expense_id=? AND session_id != ?");
            $cntStmt->execute([$expId, $sessId]);
            if ((int)$cntStmt->fetchColumn() === 0) {
                $db->prepare("DELETE FROM expense_sessions WHERE expense_id=?")->execute([$expId]);
                $db->prepare("DELETE FROM expenses WHERE id=?")->execute([$expId]);
            } else {
                $db->prepare("DELETE FROM expense_sessions WHERE expense_id=? AND session_id=?")->execute([$expId, $sessId]);
                $db->prepare("UPDATE expenses SET session_id=NULL WHERE id=?")->execute([$expId]);
            }
        }
        $db->prepare("UPDATE sessions SET charged=0 WHERE id=?")->execute([$sessId]);
        log_session_history($db, $sessId, null, 'charge_reverted', null, null, get_performer_id(),
            json_encode(['amount' => $debit, 'direct' => $direct, 'deleted' => count($rows)]), $sess['date']);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        try { $db->exec('ROLLBACK'); } catch (Throwable $e2) {}
        throw $e;
    }
    json_out(['ok' => true, 'deleted' => count($rows)]);
}

function handle_config_get(): void {
    // public endpoint
    $rows = db()->query("SELECT key, value FROM config WHERE key != 'admin_pin_hash'")->fetchAll();
    $out = [];
    foreach ($rows as $r) $out[$r['key']] = $r['value'];
    $out['server_build'] = get_server_build();
    $out['email_notifications_configured'] = is_resend_configured();
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
        'total_privacy_mode',
        'team_name',
        'cancel_hours',
        'show_cancel_deadline',
        'show_team_pool',
        'show_runway_banner',
        'system_language',
        'time_format',
        'date_format',
        'auto_compact_slots',
        'billing_rounding',
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
        if ($k === 'show_team_pool' && !in_array($v, ['0', '1'], true)) continue;
        if ($k === 'show_runway_banner' && !in_array($v, ['0', '1'], true)) continue;
        if ($k === 'currency' && (mb_strlen($v) < 1 || mb_strlen($v) > 5)) continue;
        if ($k === 'system_language' && $v !== '' && !in_array($v, ['de', 'en', 'es', 'it', 'fr', 'pt'], true)) continue;
        if ($k === 'time_format' && !in_array($v, ['24h', '12h'], true)) continue;
        if ($k === 'date_format' && !in_array($v, ['dmy', 'mdy', 'ymd'], true)) continue;
        if ($k === 'billing_rounding' && !in_array($v, ['exact', 'ceil', 'round'], true)) continue;
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
                'src' => '/courtle-icon.svg?v=4',
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
        'players'         => $db->query("SELECT * FROM players")->fetchAll(),
        'transactions'    => $db->query("SELECT * FROM transactions")->fetchAll(),
        'sessions'        => $db->query("SELECT * FROM sessions")->fetchAll(),
        'courts'          => $db->query("SELECT * FROM courts")->fetchAll(),
        'expenses'        => $db->query("SELECT * FROM expenses")->fetchAll(),
        'expense_sessions'=> $db->query("SELECT * FROM expense_sessions")->fetchAll(),
        'session_history' => $db->query("SELECT * FROM session_history")->fetchAll(),
        'config'          => $db->query("SELECT key,value FROM config")->fetchAll(),
    ]);
}

function handle_import(): void {
    require_auth(true);
    $b  = body();
    $db = db();

    $db->beginTransaction();
    $db->exec("DELETE FROM courts; DELETE FROM sessions; DELETE FROM transactions; DELETE FROM expense_sessions; DELETE FROM expenses; DELETE FROM players;");
    $db->exec("DELETE FROM config");

    foreach (($b['players'] ?? []) as $p) {
        $db->prepare("INSERT OR IGNORE INTO players (id,name,contact,pin_hash,created_at,last_login,last_interaction,admin,active,notify_email,notify_charge,notify_deposit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $p['id'],
                $p['name'],
                $p['contact'] ?? null,
                $p['pin_hash'] ?? null,
                $p['created_at'] ?? date('c'),
                $p['last_login'] ?? null,
                $p['last_interaction'] ?? null,
                !empty($p['admin']) ? 1 : 0,
                !array_key_exists('active', $p) ? 1 : ($p['active'] ? 1 : 0),
                !empty($p['notify_email']) ? 1 : 0,
                !empty($p['notify_charge']) ? 1 : 0,
                !empty($p['notify_deposit']) ? 1 : 0
            ]);
    }
    foreach (($b['transactions'] ?? []) as $t) {
        $db->prepare("INSERT OR IGNORE INTO transactions (id,player_id,credit,amount,date,created_at,note,session_id) VALUES (?,?,?,?,?,?,?,?)")
           ->execute([$t['id'], $t['player_id'], (int)$t['credit'], (float)$t['amount'], $t['date'], $t['created_at'] ?? date('c'), $t['note'] ?? null, $t['session_id'] ?? null]);
    }
    foreach (($b['sessions'] ?? []) as $s) {
        $sessId = $s['id'] ?? uuid_v4();
        $db->prepare("INSERT OR IGNORE INTO sessions (id,date,charged,disabled_courts,waitlist,note,time_start,time_end,cancelled,location,price,cancel_hours,name,court_names,billing_deferred) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $sessId,
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
                $s['name'] ?? null,
                $s['court_names'] ?? '[]',
                !empty($s['billing_deferred']) ? 1 : 0
            ]);
    }
    foreach (($b['courts'] ?? []) as $c) {
        $sid = $c['session_id'] ?? $c['session_date'] ?? null;
        if ($sid) {
            $db->prepare("INSERT OR IGNORE INTO courts (session_id,court_index,slot_index,player_id) VALUES (?,?,?,?)")
                ->execute([$sid, (int)$c['court_index'], (int)$c['slot_index'], $c['player_id'] ?: null]);
        }
    }
    foreach (($b['expenses'] ?? []) as $ex) {
        $db->prepare("INSERT OR IGNORE INTO expenses (id,amount,date,note,created_at,session_id,paid_by) VALUES (?,?,?,?,?,?,?)")
            ->execute([
                $ex['id'],
                (float)$ex['amount'],
                $ex['date'],
                $ex['note'] ?? '',
                $ex['created_at'] ?? date('c'),
                $ex['session_id'] ?? null,
                $ex['paid_by'] ?? null
            ]);
        if (!empty($ex['session_id'])) {
            $db->prepare("INSERT OR IGNORE INTO expense_sessions (expense_id, session_id) VALUES (?, ?)")
                ->execute([$ex['id'], $ex['session_id']]);
        }
    }
    foreach (($b['expense_sessions'] ?? []) as $es) {
        if (!empty($es['expense_id']) && !empty($es['session_id'])) {
            $db->prepare("INSERT OR IGNORE INTO expense_sessions (expense_id, session_id) VALUES (?, ?)")
                ->execute([$es['expense_id'], $es['session_id']]);
        }
    }
    foreach (($b['session_history'] ?? []) as $sh) {
        $sid = $sh['session_id'] ?? null;
        $db->prepare("INSERT OR IGNORE INTO session_history (id,session_id,session_date,player_id,action,court_index,slot_index,timestamp,performed_by,details) VALUES (?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $sh['id'],
                $sid,
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
    // Backfill time_start / time_end for imported sessions if empty
    $defaultStart = $db->query("SELECT value FROM config WHERE key='srtimestart'")->fetchColumn() ?: '19:00';
    $defaultEnd   = $db->query("SELECT value FROM config WHERE key='srtimeend'")->fetchColumn() ?: '21:00';
    $db->prepare("UPDATE sessions SET time_start = ? WHERE time_start IS NULL OR time_start = ''")->execute([$defaultStart]);
    $db->prepare("UPDATE sessions SET time_end = ? WHERE time_end IS NULL OR time_end = ''")->execute([$defaultEnd]);

    $db->commit();
    json_out(['ok' => true]);
}

function handle_session_book(string $idOrDate): void {
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

    $sess = get_session_row($db, $idOrDate);
    if ($sess && $sess['charged']) err('This session has already been charged.', 403);
    if ($sess && $sess['cancelled']) err('This session is cancelled.', 403);

    $date = $sess ? $sess['date'] : ($b['date'] ?? (preg_match('/^\d{4}-\d{2}-\d{2}$/', $idOrDate) ? $idOrDate : date('Y-m-d')));
    $sessId = $sess ? $sess['id'] : (is_uuid($idOrDate) ? $idOrDate : uuid_v4());

    // If session does not exist yet in DB, validate that it is an allowed upcoming series date
    if (!$sess && !token_valid(true)) {
        $today = date('Y-m-d');
        if ($date < $today) {
            err('Cannot book past dates.', 400);
        }
        $series = get_series_for_date($db, $date, $b['timeStart'] ?? null);
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
    
    if (!$sess) {
        $timeStart = $b['timeStart'] ?? ($series['time_start'] ?? null);
        $timeEnd = $b['timeEnd'] ?? ($series['time_end'] ?? null);
        $loc = $b['location'] ?? ($series['location'] ?? null);
        $pr = isset($b['price']) && $b['price'] !== null ? (float)$b['price'] : (isset($series['price']) && $series['price'] !== null ? (float)$series['price'] : null);
        $ch = isset($b['cancelHours']) && $b['cancelHours'] !== null ? (float)$b['cancelHours'] : (isset($series['cancel_hours']) && $series['cancel_hours'] !== null ? (float)$series['cancel_hours'] : null);
        $name = $b['name'] ?? ($series['name'] ?? null);
        $hasCustomCourtNames = isset($b['courtNames']) && is_array($b['courtNames']) && count(array_filter($b['courtNames'], fn($v) => trim((string)$v) !== '')) > 0;
        $cn = $hasCustomCourtNames ? json_encode(array_values($b['courtNames'])) : ($series['court_names'] ?? '[]');

        $db->prepare("INSERT INTO sessions (id, date, charged, disabled_courts, waitlist, note, time_start, time_end, cancelled, location, price, cancel_hours, name, court_names, billing_deferred)
            VALUES (?, ?, 0, '[]', '[]', '', ?, ?, 0, ?, ?, ?, ?, ?, 0)")
           ->execute([$sessId, $date, $timeStart, $timeEnd, $loc, $pr, $ch, $name, $cn]);
    }

    $stmt = $db->prepare("SELECT player_id FROM courts WHERE session_id=? AND court_index=? AND slot_index=?");
    $stmt->execute([$sessId, $ci, $si]);
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
        $db->prepare("UPDATE courts SET player_id=? WHERE session_id=? AND court_index=? AND slot_index=?")->execute([$pid, $sessId, $ci, $si]);
    } else {
        $db->prepare("INSERT INTO courts (session_id, court_index, slot_index, player_id) VALUES (?,?,?,?)")->execute([$sessId, $ci, $si, $pid]);
    }
    
    $db->exec('COMMIT');
    
    // Log the booking (use base ID for foreign key constraint)
    $performed_by = get_performer_id();
    $details = $isGuest ? json_encode(['guest' => true, 'full_id' => $pid]) : null;
    log_session_history($db, $sessId, $base, 'book', $ci, $si, $performed_by, $details, $date);
    
    $db->prepare("UPDATE players SET last_interaction=? WHERE id=?")->execute([date('c'), $base]);
    
    json_out(['ok' => true, 'id' => $sessId]);
}


function handle_session_leave(string $idOrDate): void {
    require_auth();
    $db = db();
    $b = body();
    
    $baseId = $b['player_id'] ?? null; 
    $ci = $b['court_index'] ?? null;   
    $si = $b['slot_index'] ?? null;
    
    // Nur für sich selbst abmelden (oder Admin)
    $isAdmin = token_valid(true);
    $callerId = token_player($_SERVER['HTTP_X_TOKEN'] ?? '');
    $targetBase = $baseId ? explode('|', $baseId)[0] : null;
    // Bei gezielter Slot-Abmeldung (Fall 1) prüfen wir den tatsächlichen Slot-Inhaber in der DB;
    // bei allgemeiner Abmeldung (Fall 2) muss player_id direkt zum Caller passen.
    if (!$isAdmin && ($ci === null || $si === null) && (!$targetBase || $callerId !== $targetBase)) {
        err('You can only remove yourself.', 403);
    }
    
    $performed_by = get_performer_id();
    
    // Transaktion mit IMMEDIATE-Lock, um Race-Conditions in der Waitlist-Promotion zu vermeiden
    $db->exec('BEGIN IMMEDIATE');
    
    $sess = get_session_row($db, $idOrDate);
    if (!$sess) { $db->exec('ROLLBACK'); err('Session not found.', 404); }
    if ($sess['charged']) { $db->exec('ROLLBACK'); err('Already charged.', 403); }

    $sessId = $sess['id'];
    $date = $sess['date'];

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
        $stmt = $db->prepare("SELECT player_id FROM courts WHERE session_id=? AND court_index=? AND slot_index=?");
        $stmt->execute([$sessId, $ci, $si]);
        $slot_data = $stmt->fetch();
        if ($slot_data && $slot_data['player_id']) {
            $slotOwnerBase = explode('|', (string)$slot_data['player_id'])[0];
            if (!$isAdmin && (!$callerId || $callerId !== $slotOwnerBase)) {
                $db->exec('ROLLBACK');
                err('You can only remove yourself.', 403);
            }
            $freed_slots[] = [
                'court_index' => $ci, 
                'slot_index' => $si,
                'player_id' => $slot_data['player_id']
            ];
        } elseif (!$isAdmin && $targetBase && $callerId !== $targetBase) {
            $db->exec('ROLLBACK');
            err('You can only remove yourself.', 403);
        }
        $db->prepare("UPDATE courts SET player_id = NULL WHERE session_id=? AND court_index=? AND slot_index=?")->execute([$sessId, $ci, $si]);
    } 
    // Fall 2: Kompletten Spieler (inkl. Gäste) vom ganzen Tag abmelden -> UPDATE auf NULL
    elseif ($baseId) {
        $stmt = $db->prepare("SELECT court_index, slot_index, player_id FROM courts WHERE session_id=? AND (player_id=? OR player_id=? OR player_id=?)");
        $stmt->execute([$sessId, $baseId, $baseId . '|g1', $baseId . '|g2']);
        $freed_slots = $stmt->fetchAll();
        
        $db->prepare("UPDATE courts SET player_id = NULL WHERE session_id=? AND (player_id=? OR player_id=? OR player_id=?)")->execute([$sessId, $baseId, $baseId . '|g1', $baseId . '|g2']);
        
        // War der User auf der Warteliste?
        $waitlist = json_decode($sess['waitlist'] ?? '[]', true) ?: [];
        if (in_array($baseId, $waitlist)) {
            $waitlist = array_values(array_filter($waitlist, fn($x) => $x !== $baseId));
            $db->prepare("UPDATE sessions SET waitlist=? WHERE id=?")->execute([json_encode($waitlist), $sessId]);
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
            log_session_history($db, $sessId, $log_player_id, 'leave', $slot['court_index'], $slot['slot_index'], $performed_by, null, $date);
        }
    }

    // 🏆 Auto-Nachrücken (Compaction) oder Standard-Warteliste
    $autoCompact = $db->query("SELECT value FROM config WHERE key='auto_compact_slots'")->fetchColumn() === '1';
    $promotedPlayers = [];

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
        $stmtP = $db->prepare("SELECT player_id FROM courts WHERE session_id=? AND player_id IS NOT NULL AND player_id != '' ORDER BY court_index ASC, slot_index ASC");
        $stmtP->execute([$sessId]);
        $activePlayers = $stmtP->fetchAll(PDO::FETCH_COLUMN);

        // Warteliste frisch aus DB lesen
        $wlStmt = $db->prepare("SELECT waitlist FROM sessions WHERE id=?");
        $wlStmt->execute([$sessId]);
        $waitlist = json_decode($wlStmt->fetchColumn() ?: '[]', true) ?: [];

        // Falls Kapazität frei und Warteliste gefüllt ist, nachrücken lassen
        $promotedIdxMap = [];
        while (count($activePlayers) < $totalActiveCapacity && !empty($waitlist)) {
            $next_player = array_shift($waitlist);
            $activePlayers[] = $next_player;
            $promotedIdxMap[$next_player] = true;
            log_session_history($db, $sessId, $next_player, 'promoted', null, null, $performed_by, json_encode(['from_waitlist' => true]), $date);
        }
        $db->prepare("UPDATE sessions SET waitlist=? WHERE id=?")->execute([json_encode(array_values($waitlist)), $sessId]);

        // Courts leeren und lückenlos von oben nach unten (Court 0 Slot 0 ...) neu auffüllen
        $db->prepare("DELETE FROM courts WHERE session_id=?")->execute([$sessId]);
        $ins = $db->prepare("INSERT INTO courts (session_id, court_index, slot_index, player_id) VALUES (?,?,?,?)");
        $pIdx = 0;
        foreach ($activeCourtIndices as $cIdx) {
            for ($sIdx = 0; $sIdx < 4; $sIdx++) {
                if (isset($activePlayers[$pIdx])) {
                    $pid = $activePlayers[$pIdx];
                    $ins->execute([$sessId, $cIdx, $sIdx, $pid]);
                    if (isset($promotedIdxMap[$pid])) {
                        $promotedPlayers[] = ['player_id' => $pid, 'court_index' => $cIdx];
                    }
                    $pIdx++;
                }
            }
        }
    } else {
        // Standard ohne Nachrücken: Nachrücker von der Warteliste direkt in die freigewordenen Slots
        $wlStmt = $db->prepare("SELECT waitlist FROM sessions WHERE id=?");
        $wlStmt->execute([$sessId]);
        $waitlist = json_decode($wlStmt->fetchColumn() ?: '[]', true) ?: [];
        
        if (!empty($waitlist) && !empty($freed_slots)) {
            foreach ($freed_slots as $slot) {
                if (empty($waitlist)) break;
                $next_player = array_shift($waitlist);
                $db->prepare("UPDATE courts SET player_id = ? WHERE session_id=? AND court_index=? AND slot_index=?")
                   ->execute([$next_player, $sessId, $slot['court_index'], $slot['slot_index']]);
                $promotedPlayers[] = ['player_id' => $next_player, 'court_index' => $slot['court_index']];
                // Log the promotion
                log_session_history($db, $sessId, $next_player, 'promoted', $slot['court_index'], $slot['slot_index'], $performed_by, json_encode(['from_waitlist' => true]), $date);
            }
            $db->prepare("UPDATE sessions SET waitlist=? WHERE id=?")->execute([json_encode(array_values($waitlist)), $sessId]);
        }
    }
    
    $db->exec('COMMIT');
    
    if (!empty($promotedPlayers)) {
        notify_waitlist_promotions($db, $sessId, $promotedPlayers);
    }
    
    if ($baseId) {
        $db->prepare("UPDATE players SET last_interaction=? WHERE id=?")->execute([date('c'), $baseId]);
    }
    
    json_out(['ok' => true]);
}

function handle_session_join_waitlist(string $idOrDate): void {
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
    
    $sess = get_session_row($db, $idOrDate);
    $date = $sess ? $sess['date'] : ($b['date'] ?? (preg_match('/^\d{4}-\d{2}-\d{2}$/', $idOrDate) ? $idOrDate : date('Y-m-d')));
    $sessId = $sess ? $sess['id'] : (is_uuid($idOrDate) ? $idOrDate : uuid_v4());

    if ($sess) {
        if ($sess['charged']) err('This session has already been charged.', 403);
        if ($sess['cancelled']) err('This session is cancelled.', 403);
    } elseif (!token_valid(true)) {
        $today = date('Y-m-d');
        if ($date < $today) {
            err('Cannot join waitlist for past dates.', 400);
        }
        $series = get_series_for_date($db, $date, $b['timeStart'] ?? null);
        if (!$series) {
            err('Session date is not part of an active series.', 400);
        }
    }

    $db->exec('BEGIN IMMEDIATE');
    
    if (!$sess) {
        $timeStart = $b['timeStart'] ?? ($series['time_start'] ?? null);
        $timeEnd = $b['timeEnd'] ?? ($series['time_end'] ?? null);
        $loc = $b['location'] ?? ($series['location'] ?? null);
        $pr = isset($b['price']) && $b['price'] !== null ? (float)$b['price'] : (isset($series['price']) && $series['price'] !== null ? (float)$series['price'] : null);
        $ch = isset($b['cancelHours']) && $b['cancelHours'] !== null ? (float)$b['cancelHours'] : (isset($series['cancel_hours']) && $series['cancel_hours'] !== null ? (float)$series['cancel_hours'] : null);
        $name = $b['name'] ?? ($series['name'] ?? null);
        $hasCustomCourtNames = isset($b['courtNames']) && is_array($b['courtNames']) && count(array_filter($b['courtNames'], fn($v) => trim((string)$v) !== '')) > 0;
        $cn = $hasCustomCourtNames ? json_encode(array_values($b['courtNames'])) : ($series['court_names'] ?? '[]');

        $db->prepare("INSERT INTO sessions (id, date, charged, disabled_courts, waitlist, note, time_start, time_end, cancelled, location, price, cancel_hours, name, court_names, billing_deferred)
            VALUES (?, ?, 0, '[]', '[]', '', ?, ?, 0, ?, ?, ?, ?, ?, 0)")
           ->execute([$sessId, $date, $timeStart, $timeEnd, $loc, $pr, $ch, $name, $cn]);
    }

    $stmt = $db->prepare("SELECT waitlist FROM sessions WHERE id=?");
    $stmt->execute([$sessId]);
    $sessRow = $stmt->fetch();
    if (!$sessRow) { $db->exec('ROLLBACK'); err('Session not found.', 404); }
    
    $waitlist = json_decode($sessRow['waitlist'] ?? '[]', true) ?: [];
    if (in_array($player_id, $waitlist)) {
        $db->exec('ROLLBACK');
        err('Already on waitlist.');
    }
    
    $waitlist[] = $player_id;
    $db->prepare("UPDATE sessions SET waitlist=? WHERE id=?")->execute([json_encode($waitlist), $sessId]);
    
    $db->exec('COMMIT');
    
    log_session_history($db, $sessId, $player_id, 'waitlist_join', null, null, $performed_by, null, $date);
    
    json_out(['ok' => true, 'id' => $sessId]);
}

// ── Session History ──
function handle_session_history_get(): void {
    require_auth(true); // Admin only
    $sessionId = $_GET['session_id'] ?? $_GET['id'] ?? '';
    $date = $_GET['date'] ?? '';
    $db = db();
    
    if ($sessionId) {
        $stmt = $db->prepare("
            SELECT sh.*, 
                   p.name as player_name, 
                   p2.name as performed_by_name
            FROM session_history sh 
            LEFT JOIN players p ON sh.player_id = p.id 
            LEFT JOIN players p2 ON sh.performed_by = p2.id 
            WHERE sh.session_id = ? 
            ORDER BY sh.timestamp DESC
        ");
        $stmt->execute([$sessionId]);
    } elseif ($date) {
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
