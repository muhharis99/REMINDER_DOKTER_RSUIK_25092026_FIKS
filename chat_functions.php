<?php

declare(strict_types=1);

require_once __DIR__ . '/db.php';

function chatEnsureSchema(): void
{
    static $ready = false;

    if ($ready) {
        return;
    }

    db()->exec("
        CREATE TABLE IF NOT EXISTS whatsapp_messages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            message_id VARCHAR(255) NULL,
            doctor_id VARCHAR(50) NULL,
            phone VARCHAR(30) NOT NULL,
            direction ENUM('IN', 'OUT') NOT NULL,
            message_type VARCHAR(30) NOT NULL DEFAULT 'text',
            message TEXT NULL,
            status VARCHAR(30) NULL,
            sent_at DATETIME NULL,
            received_at DATETIME NULL,
            read_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_message_id (message_id),
            KEY idx_phone (phone),
            KEY idx_doctor_id (doctor_id),
            KEY idx_created_at (created_at),
            KEY idx_chat_phone_id (phone, id),
            KEY idx_chat_unread (doctor_id, direction, read_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $ready = true;
}

function chatNormalizePhone(string $value): string
{
    $phone = preg_replace('/\D+/', '', $value);

    if (strpos($phone, '0') === 0) {
        $phone = '62' . substr($phone, 1);
    }

    return $phone;
}

function chatJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function chatDoctorDirectory(): array
{
    static $directory = null;

    if ($directory !== null) {
        return $directory;
    }

    $statement = get_db('rsi_byl')->query("
        SELECT
            kd.kd_dr AS dokter_kd,
            md.dokter_nama,
            kd.no_hp
        FROM kontak_dokter kd
        LEFT JOIN master_dokter md
            ON md.dokter_kd = kd.kd_dr
        WHERE kd.no_hp IS NOT NULL
            AND kd.no_hp != ''
            AND kd.no_hp != '0'
        ORDER BY
            COALESCE(NULLIF(md.dokter_nama, ''), kd.kd_dr) ASC
    ");

    $directory = [];

    foreach ($statement->fetchAll() as $row) {
        $doctorId = trim((string) ($row['dokter_kd'] ?? ''));
        $phoneRaw = trim((string) ($row['no_hp'] ?? ''));
        $phone = chatNormalizePhone($phoneRaw);
        $name = trim((string) ($row['dokter_nama'] ?? ''));

        if ($doctorId === '' || $phone === '') {
            continue;
        }

        if ($name === '') {
            $name = $doctorId === 'S666'
                ? 'Muhammad Haris'
                : $doctorId;
        }

        $directory[$doctorId] = [
            'doctor_id' => $doctorId,
            'name' => $name,
            'phone_raw' => $phoneRaw,
            'phone' => $phone
        ];
    }

    return $directory;
}

function chatDoctorById(string $doctorId): ?array
{
    $doctorId = trim($doctorId);

    if ($doctorId === '') {
        return null;
    }

    $directory = chatDoctorDirectory();

    return $directory[$doctorId] ?? null;
}

function chatDoctorByPhone(string $phone): ?array
{
    $phone = chatNormalizePhone($phone);

    if ($phone === '') {
        return null;
    }

    foreach (chatDoctorDirectory() as $doctor) {
        if ($doctor['phone'] === $phone) {
            return $doctor;
        }
    }

    return null;
}

function chatFormatTime(?string $dateTime): string
{
    $dateTime = trim((string) $dateTime);

    if ($dateTime === '') {
        return '';
    }

    $timestamp = strtotime($dateTime);

    if ($timestamp === false) {
        return $dateTime;
    }

    if (date('Y-m-d', $timestamp) === date('Y-m-d')) {
        return date('H:i', $timestamp);
    }

    return date('d-m-Y H:i', $timestamp);
}

function chatGatewayUrl(): string
{
    $configured = trim((string) getenv('WA_GATEWAY_URL'));

    if ($configured !== '') {
        return rtrim($configured, '/');
    }

    return 'http://127.0.0.1:3210';
}

function chatGatewayRequest(string $path, array $payload): array
{
    $url = chatGatewayUrl() . '/' . ltrim($path, '/');
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if (!function_exists('curl_init')) {
        throw new RuntimeException('Ekstensi PHP cURL belum aktif.');
    }

    $curl = curl_init($url);

    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json'
        ],
        CURLOPT_POSTFIELDS => $body
    ]);

    $responseBody = curl_exec($curl);
    $curlError = curl_error($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);

    if ($responseBody === false) {
        throw new RuntimeException($curlError !== '' ? $curlError : 'Gateway WhatsApp tidak dapat dihubungi.');
    }

    $result = json_decode($responseBody, true);

    if (!is_array($result)) {
        throw new RuntimeException('Respons gateway WhatsApp tidak valid.');
    }

    if ($status < 200 || $status >= 300 || empty($result['success'])) {
        throw new RuntimeException((string) ($result['message'] ?? 'Pesan WhatsApp gagal dikirim.'));
    }

    return $result;
}

function chatIncomingRequestAllowed(): bool
{
    $remote = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    $server = trim((string) ($_SERVER['SERVER_ADDR'] ?? ''));

    return in_array($remote, ['127.0.0.1', '::1'], true) ||
        ($server !== '' && $remote === $server);
}

chatEnsureSchema();
