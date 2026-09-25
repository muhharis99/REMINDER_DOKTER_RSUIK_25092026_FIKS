<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

$_pdo_connections = [];

function syncDefaultReminderTemplate(PDO $pdo): void
{
    static $synced = false;

    if ($synced) {
        return;
    }

    $synced = true;

    try {
        $statement = $pdo->prepare(
            "SELECT `value` FROM settings WHERE `key` = 'template' LIMIT 1"
        );
        $statement->execute();
        $template = (string) ($statement->fetchColumn() ?: '');

        if ($template === '') {
            $insert = $pdo->prepare("
                INSERT INTO settings (`key`, `value`)
                VALUES ('template', ?)
            ");
            $insert->execute([DEFAULT_TEMPLATE]);
            return;
        }

        $hasPatientCount = strpos($template, '{{jumlah_pasien}}') !== false ||
            stripos($template, 'Jumlah Pasien') !== false;
        $hasIndenCount = strpos($template, '{{inden}}') !== false;
        $hasQuotaQuestion = stripos(
            $template,
            'Apakah ada perubahan Jadwal atau Pembatasan Kuota dokter?'
        ) !== false;

        if ($hasPatientCount || !$hasIndenCount || !$hasQuotaQuestion) {
            $update = $pdo->prepare("
                UPDATE settings
                SET `value` = ?
                WHERE `key` = 'template'
            ");
            $update->execute([DEFAULT_TEMPLATE]);
        }
    } catch (Throwable $e) {
        error_log(
            'Gagal menyinkronkan template reminder database: ' . $e->getMessage()
        );
    }
}

function get_db(string $name = 'local'): PDO
{
    global $_pdo_connections;

    $name = strtolower($name);
    $databases = $GLOBALS['databases'];

    if (isset($_pdo_connections[$name])) {
        return $_pdo_connections[$name];
    }

    if (!isset($databases[$name])) {
        throw new Exception(
            "Database configuration '$name' not found. Available: " .
            implode(', ', array_keys($databases))
        );
    }

    $config = $databases[$name];
    $host = $config['host'];
    $port = $config['port'] ?? 3306;
    $dbname = $config['name'];
    $user = $config['user'];
    $pass = $config['pass'] ?? '';
    $dsn = "mysql:host=$host;port=$port;dbname=$dbname;charset=utf8mb4";

    try {
        $_pdo_connections[$name] = new PDO(
            $dsn,
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_TIMEOUT => 5,
                PDO::ATTR_EMULATE_PREPARES => false
            ]
        );

        if ($name === 'local') {
            syncDefaultReminderTemplate($_pdo_connections[$name]);
        }
    } catch (PDOException $e) {
        error_log(
            "Database connection error for '$name' ($host:$port): " .
            $e->getMessage()
        );

        throw $e;
    }

    return $_pdo_connections[$name];
}

function db(): PDO
{
    return get_db('local');
}

function ext_db(): PDO
{
    return get_db('rsiklaten');
}
