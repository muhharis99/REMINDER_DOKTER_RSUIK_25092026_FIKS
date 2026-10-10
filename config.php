<?php

declare(strict_types=1);

/**
 * Runtime database settings are intentionally not hard-coded in this tracked file.
 * Configure them through environment variables or an ignored config.local.php.
 */
$readEnv = static function (string $name, ?string $default = null): ?string {
    $value = getenv($name);
    return $value === false ? $default : $value;
};

$databases = [
    'local' => [
        'host' => $readEnv('DB_LOCAL_HOST'),
        'port' => (int) ($readEnv('DB_LOCAL_PORT', '3306') ?: '3306'),
        'user' => $readEnv('DB_LOCAL_USER'),
        'pass' => $readEnv('DB_LOCAL_PASS', ''),
        'name' => $readEnv('DB_LOCAL_NAME')
    ],
    'rsiklaten' => [
        'host' => $readEnv('DB_RSIKLATEN_HOST'),
        'port' => (int) ($readEnv('DB_RSIKLATEN_PORT', '3306') ?: '3306'),
        'user' => $readEnv('DB_RSIKLATEN_USER'),
        'pass' => $readEnv('DB_RSIKLATEN_PASS', ''),
        'name' => $readEnv('DB_RSIKLATEN_NAME')
    ],
    'rsi_byl' => [
        'host' => $readEnv('DB_RSI_BYL_HOST'),
        'port' => (int) ($readEnv('DB_RSI_BYL_PORT', '3306') ?: '3306'),
        'user' => $readEnv('DB_RSI_BYL_USER'),
        'pass' => $readEnv('DB_RSI_BYL_PASS', ''),
        'name' => $readEnv('DB_RSI_BYL_NAME')
    ],
    'rme' => [
        'host' => $readEnv('DB_RME_HOST'),
        'port' => (int) ($readEnv('DB_RME_PORT', '3306') ?: '3306'),
        'user' => $readEnv('DB_RME_USER'),
        'pass' => $readEnv('DB_RME_PASS', ''),
        'name' => $readEnv('DB_RME_NAME')
    ],
];

$wa_gateway = [
    'internal_url' => $readEnv('WA_GATEWAY_INTERNAL_URL', 'http://127.0.0.1:3210'),
    'api_token' => $readEnv('WA_API_TOKEN', ''),
    'callback_token' => $readEnv('WA_CALLBACK_TOKEN', '')
];

$localConfigPath = __DIR__ . '/config.local.php';
if (is_file($localConfigPath)) {
    $localConfig = require $localConfigPath;
    if (is_array($localConfig)) {
        if (isset($localConfig['databases']) && is_array($localConfig['databases'])) {
            $databases = array_replace_recursive($databases, $localConfig['databases']);
        }
        if (isset($localConfig['wa_gateway']) && is_array($localConfig['wa_gateway'])) {
            $wa_gateway = array_replace($wa_gateway, $localConfig['wa_gateway']);
        }
    }
}

const APP_NAME = 'DokterReminder';

const DEFAULT_TEMPLATE = "Assalamualaikum, {{nama_dokter}}.\n\nMengingatkan bahwa Anda memiliki jadwal praktik:\n\n📅 {{tanggal}}\n🏥 {{nama_rs}}\n🩺 Poli: {{nama_poli}}\n🕐 Jam: {{jam_mulai}} - {{jam_selesai}}\n📍 Lokasi: {{lokasi}}\n\nJumlah Inden Pasien : {{inden}}\n\nApakah ada perubahan Jadwal atau Pembatasan Kuota dokter?\n\nTerima kasih.\nWassalamualaikum, Wr.Wb";

date_default_timezone_set('Asia/Jakarta');

$protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$base_url = $protocol . '://' . $host . rtrim(dirname($_SERVER['PHP_SELF'] ?? '/'), '/\\\\');
