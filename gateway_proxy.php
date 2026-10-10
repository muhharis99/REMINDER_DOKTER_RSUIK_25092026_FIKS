<?php

declare(strict_types=1);

require_once __DIR__ . '/functions.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function gatewayProxyJson(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function gatewayProxySameOrigin(): bool
{
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') {
        return true;
    }

    $originHost = parse_url($origin, PHP_URL_HOST);
    $requestHost = parse_url('http://' . (string) ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);

    return is_string($originHost) &&
        is_string($requestHost) &&
        strcasecmp($originHost, $requestHost) === 0;
}

function gatewayProxyRequest(string $method, string $path, ?array $payload = null): array
{
    $config = $GLOBALS['wa_gateway'] ?? [];
    $baseUrl = rtrim((string) ($config['internal_url'] ?? ''), '/');
    $apiToken = trim((string) ($config['api_token'] ?? ''));

    if ($baseUrl === '' || $apiToken === '') {
        return ['configuration_error' => 'Gateway internal URL atau WA_API_TOKEN belum dikonfigurasi.'];
    }

    $url = $baseUrl . $path;
    $body = $payload === null
        ? null
        : json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . $apiToken,
    ];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_POSTFIELDS => $body,
        ]);
        $raw = curl_exec($curl);
        $error = curl_error($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);

        if ($raw === false) {
            return ['transport_error' => $error !== '' ? $error : 'Gateway tidak dapat dihubungi.'];
        }
    } else {
        $options = [
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'content' => $body ?? '',
                'timeout' => 45,
                'ignore_errors' => true,
            ],
        ];
        $context = stream_context_create($options);
        $raw = @file_get_contents($url, false, $context);
        $status = 0;

        foreach (($http_response_header ?? []) as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $header, $matches)) {
                $status = (int) $matches[1];
                break;
            }
        }

        if ($raw === false || $status === 0) {
            return ['transport_error' => 'Gateway tidak dapat dihubungi atau respons tidak diketahui.'];
        }
    }

    $decoded = json_decode((string) $raw, true);
    if (!is_array($decoded)) {
        $decoded = ['success' => false, 'message' => 'Gateway mengembalikan respons yang tidak valid.'];
    }

    return [
        'http_status' => $status,
        'json' => $decoded,
    ];
}

function persistGatewayDeliveryResult(PDO $pdo, string $requestId, array $result): bool
{
    $status = strtoupper((string) ($result['status'] ?? ''));
    if (!in_array($status, ['SENT', 'FAILED', 'UNKNOWN'], true)) {
        return false;
    }

    $find = $pdo->prepare('SELECT id, status FROM reminders WHERE gateway_request_id = ? LIMIT 1');
    $find->execute([$requestId]);
    $row = $find->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        return false;
    }

    $currentStatus = strtoupper((string) $row['status']);
    if ($currentStatus === $status) {
        return true;
    }

    if (!in_array($currentStatus, ['PROCESSING', 'UNKNOWN'], true)) {
        return false;
    }

    $ack = isset($result['ack']) && is_numeric($result['ack'])
        ? max(0, min(255, (int) $result['ack']))
        : null;
    $messageId = isset($result['message_id'])
        ? substr(trim((string) $result['message_id']), 0, 255)
        : null;
    $error = isset($result['error'])
        ? substr(trim((string) $result['error']), 0, 450)
        : null;

    $update = $pdo->prepare("
        UPDATE reminders
        SET status = ?,
            sent_at = CASE WHEN ? = 'SENT' THEN COALESCE(sent_at, NOW()) ELSE NULL END,
            gateway_message_id = ?,
            gateway_ack = ?,
            delivery_error = ?,
            delivery_updated_at = NOW()
        WHERE gateway_request_id = ?
          AND status IN ('PROCESSING', 'UNKNOWN')
    ");
    $update->execute([$status, $status, $messageId ?: null, $ack, $error ?: null, $requestId]);

    if ($update->rowCount() > 0) {
        logAction((int) $row['id'], $status);
        return true;
    }

    return false;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$action = strtolower(trim((string) ($_GET['action'] ?? '')));

if ($method === 'GET' && $action === 'qr') {
    $result = gatewayProxyRequest('GET', '/qr');
    if (isset($result['configuration_error']) || isset($result['transport_error'])) {
        gatewayProxyJson(503, [
            'success' => false,
            'ready' => false,
            'hasQr' => false,
            'state' => 'GATEWAY_UNAVAILABLE',
            'error' => 'Status QR gateway tidak dapat diambil. Periksa konfigurasi service.',
        ]);
    }

    gatewayProxyJson((int) $result['http_status'], (array) $result['json']);
}

if ($method === 'GET' && $action === 'status') {
    $result = gatewayProxyRequest('GET', '/status');
    if (isset($result['configuration_error']) || isset($result['transport_error'])) {
        gatewayProxyJson(503, [
            'success' => false,
            'ready' => false,
            'state' => 'GATEWAY_UNAVAILABLE',
            'error' => 'WhatsApp Gateway tidak dapat dihubungi.',
        ]);
    }

    gatewayProxyJson((int) $result['http_status'], (array) $result['json']);
}

if ($method === 'GET' && $action === 'delivery') {
    $reminderId = filter_var($_GET['reminder_id'] ?? null, FILTER_VALIDATE_INT);
    if (!$reminderId || $reminderId < 1) {
        gatewayProxyJson(422, ['success' => false, 'message' => 'ID reminder tidak valid.']);
    }

    try {
        $pdo = db();
        $statement = $pdo->prepare("
            SELECT id, status, gateway_request_id, gateway_ack,
                   gateway_message_id, delivery_error, delivery_updated_at
            FROM reminders
            WHERE id = ?
            LIMIT 1
        ");
        $statement->execute([$reminderId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            gatewayProxyJson(404, ['success' => false, 'message' => 'Reminder tidak ditemukan.']);
        }

        $requestId = (string) ($row['gateway_request_id'] ?? '');
        if (in_array(strtoupper((string) $row['status']), ['PROCESSING', 'UNKNOWN'], true) && $requestId !== '') {
            $gatewayStatus = gatewayProxyRequest('GET', '/send-status/' . rawurlencode($requestId));
            if (!isset($gatewayStatus['configuration_error']) && !isset($gatewayStatus['transport_error']) &&
                isset($gatewayStatus['json']['status']) &&
                in_array(strtoupper((string) $gatewayStatus['json']['status']), ['SENT', 'FAILED', 'UNKNOWN'], true)) {
                persistGatewayDeliveryResult($pdo, $requestId, (array) $gatewayStatus['json']);
                $statement->execute([$reminderId]);
                $row = $statement->fetch(PDO::FETCH_ASSOC) ?: $row;
            }
        }

        gatewayProxyJson(200, [
            'success' => true,
            'reminder_id' => (int) $row['id'],
            'status' => strtoupper((string) $row['status']),
            'request_id' => $requestId !== '' ? $requestId : null,
            'ack' => isset($row['gateway_ack']) ? (int) $row['gateway_ack'] : null,
            'message_id' => $row['gateway_message_id'] ?: null,
            'error' => $row['delivery_error'] ?: null,
            'updated_at' => $row['delivery_updated_at'] ?: null,
        ]);
    } catch (Throwable $error) {
        error_log('Gateway delivery status query failed: ' . $error->getMessage());
        gatewayProxyJson(500, ['success' => false, 'message' => 'Status pengiriman belum dapat dibaca.']);
    }
}

if ($method !== 'POST' || $action !== 'send') {
    gatewayProxyJson(404, ['success' => false, 'message' => 'Endpoint tidak ditemukan.']);
}

if (!gatewayProxySameOrigin()) {
    gatewayProxyJson(403, ['success' => false, 'message' => 'Permintaan lintas-origin ditolak.']);
}

$contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
if (strpos($contentType, 'application/json') !== 0) {
    gatewayProxyJson(415, ['success' => false, 'message' => 'Gunakan Content-Type application/json.']);
}

$rawBody = file_get_contents('php://input');
$input = json_decode($rawBody ?: '', true);
if (!is_array($input)) {
    gatewayProxyJson(400, ['success' => false, 'message' => 'Body JSON tidak valid.']);
}

$reminderId = filter_var($input['reminder_id'] ?? null, FILTER_VALIDATE_INT);
$allowResend = ($input['allow_resend'] ?? false) === true;
if (!$reminderId || $reminderId < 1) {
    gatewayProxyJson(422, ['success' => false, 'message' => 'ID reminder tidak valid.']);
}

try {
    $pdo = db();
    $find = $pdo->prepare("
        SELECT id, tanggal, doctor_id, message, status, gateway_request_id
        FROM reminders
        WHERE id = ?
        LIMIT 1
    ");
    $find->execute([$reminderId]);
    $reminder = $find->fetch(PDO::FETCH_ASSOC);

    if (!$reminder) {
        gatewayProxyJson(404, ['success' => false, 'message' => 'Reminder tidak ditemukan.']);
    }

    $status = strtoupper((string) $reminder['status']);
    if ($status === 'PROCESSING') {
        gatewayProxyJson(202, [
            'success' => true,
            'queued' => true,
            'idempotent' => true,
            'request_id' => $reminder['gateway_request_id'] ?: null,
            'reminder_id' => (int) $reminderId,
            'status' => 'PROCESSING',
            'message' => 'Reminder sedang diproses. Jangan mengirim ulang.',
        ]);
    }
    if ($status === 'UNKNOWN') {
        gatewayProxyJson(409, [
            'success' => false,
            'status' => 'UNKNOWN',
            'message' => 'Hasil pengiriman sebelumnya belum pasti. Periksa riwayat WhatsApp sebelum mengirim ulang.',
        ]);
    }
    if ($status === 'SENT' && !$allowResend) {
        gatewayProxyJson(409, [
            'success' => false,
            'status' => 'SENT',
            'message' => 'Reminder sudah tercatat terkirim. Gunakan tindakan kirim ulang yang dikonfirmasi jika memang diperlukan.',
        ]);
    }

    $scheduleRows = schedulesFor((string) $reminder['tanggal']);
    $matchingDoctor = null;
    foreach ($scheduleRows as $schedule) {
        if ((string) ($schedule['doctor_id'] ?? '') === (string) $reminder['doctor_id']) {
            $matchingDoctor = $schedule;
            break;
        }
    }

    if (!$matchingDoctor) {
        gatewayProxyJson(422, [
            'success' => false,
            'message' => 'Jadwal dokter tidak lagi tersedia untuk reminder ini; data tidak dikirim.',
        ]);
    }

    $phone = normalizePhone((string) ($matchingDoctor['no_whatsapp'] ?? ''));
    $message = trim((string) ($reminder['message'] ?? ''));
    if (!preg_match('/^62\d{8,15}$/', $phone)) {
        gatewayProxyJson(422, ['success' => false, 'message' => 'Nomor WhatsApp dokter tidak valid.']);
    }
    if ($message === '') {
        gatewayProxyJson(422, ['success' => false, 'message' => 'Isi reminder kosong.']);
    }

    $random = random_bytes(16);
    $random[6] = chr((ord($random[6]) & 0x0f) | 0x40);
    $random[8] = chr((ord($random[8]) & 0x3f) | 0x80);
    $hex = bin2hex($random);
    $requestId = sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 12, 4),
        substr($hex, 16, 4),
        substr($hex, 20, 12)
    );

    $pdo->beginTransaction();
    $lock = $pdo->prepare("SELECT status FROM reminders WHERE id = ? FOR UPDATE");
    $lock->execute([$reminderId]);
    $locked = $lock->fetch(PDO::FETCH_ASSOC);
    if (!$locked) {
        $pdo->rollBack();
        gatewayProxyJson(404, ['success' => false, 'message' => 'Reminder tidak ditemukan.']);
    }

    $lockedStatus = strtoupper((string) $locked['status']);
    if ($lockedStatus === 'PROCESSING' || $lockedStatus === 'UNKNOWN' ||
        ($lockedStatus === 'SENT' && !$allowResend)) {
        $pdo->rollBack();
        gatewayProxyJson(409, [
            'success' => false,
            'status' => $lockedStatus,
            'message' => 'Status reminder berubah saat diproses. Muat ulang dashboard sebelum melanjutkan.',
        ]);
    }

    $update = $pdo->prepare("
        UPDATE reminders
        SET status = 'PROCESSING',
            gateway_request_id = ?,
            gateway_message_id = NULL,
            gateway_ack = NULL,
            delivery_error = NULL,
            delivery_started_at = NOW(),
            delivery_updated_at = NOW(),
            sent_at = NULL
        WHERE id = ?
    ");
    $update->execute([$requestId, $reminderId]);
    $pdo->commit();
    logAction((int) $reminderId, 'PROCESSING');

    $gatewayResult = gatewayProxyRequest('POST', '/send', [
        'request_id' => $requestId,
        'reminder_id' => (int) $reminderId,
        'doctor_id' => (string) $reminder['doctor_id'],
        'phone' => $phone,
        'message' => $message,
    ]);

    if (isset($gatewayResult['configuration_error'])) {
        $configurationError = 'Konfigurasi autentikasi gateway belum lengkap.';
        $update = $pdo->prepare("
            UPDATE reminders
            SET status = 'FAILED',
                delivery_error = ?,
                delivery_updated_at = NOW()
            WHERE id = ?
              AND gateway_request_id = ?
              AND status = 'PROCESSING'
        ");
        $update->execute([$configurationError, $reminderId, $requestId]);
        if ($update->rowCount() > 0) {
            logAction((int) $reminderId, 'FAILED');
        }

        gatewayProxyJson(503, [
            'success' => false,
            'queued' => false,
            'status' => 'FAILED',
            'request_id' => $requestId,
            'reminder_id' => (int) $reminderId,
            'message' => $configurationError,
        ]);
    }

    if (isset($gatewayResult['transport_error'])) {
        // Do not mark FAILED: the gateway may have accepted the request before the connection broke.
        gatewayProxyJson(202, [
            'success' => true,
            'queued' => true,
            'status' => 'PROCESSING',
            'unknown' => true,
            'request_id' => $requestId,
            'reminder_id' => (int) $reminderId,
            'message' => 'Respons gateway belum diketahui. Status sedang direkonsiliasi; jangan mengirim ulang.',
        ]);
    }

    $httpStatus = (int) $gatewayResult['http_status'];
    $gatewayBody = (array) $gatewayResult['json'];
    if ($httpStatus !== 202 || empty($gatewayBody['success'])) {
        $errorMessage = substr(trim((string) ($gatewayBody['message'] ?? 'Gateway menolak permintaan.')), 0, 450);
        $update = $pdo->prepare("
            UPDATE reminders
            SET status = 'FAILED',
                delivery_error = ?,
                delivery_updated_at = NOW()
            WHERE id = ?
              AND gateway_request_id = ?
              AND status = 'PROCESSING'
        ");
        $update->execute([$errorMessage ?: 'Gateway menolak permintaan.', $reminderId, $requestId]);
        if ($update->rowCount() > 0) {
            logAction((int) $reminderId, 'FAILED');
        }

        gatewayProxyJson($httpStatus >= 400 && $httpStatus < 600 ? $httpStatus : 502, [
            'success' => false,
            'queued' => false,
            'status' => 'FAILED',
            'request_id' => $requestId,
            'reminder_id' => (int) $reminderId,
            'message' => $errorMessage ?: 'Gateway menolak permintaan.',
        ]);
    }

    gatewayProxyJson(202, [
        'success' => true,
        'queued' => true,
        'status' => 'PROCESSING',
        'request_id' => $requestId,
        'reminder_id' => (int) $reminderId,
        'message' => 'Gateway menerima permintaan; menunggu konfirmasi hasil pengiriman.',
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('Gateway send proxy failed: ' . $error->getMessage());
    gatewayProxyJson(500, [
        'success' => false,
        'message' => 'Pengiriman belum dapat diproses. Periksa konfigurasi gateway dan migrasi database.',
    ]);
}
