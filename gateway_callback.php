<?php

declare(strict_types=1);

require_once __DIR__ . '/functions.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function gatewayCallbackJson(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    gatewayCallbackJson(405, ['success' => false, 'message' => 'Method tidak diizinkan.']);
}

$config = $GLOBALS['wa_gateway'] ?? [];
$expectedToken = trim((string) ($config['callback_token'] ?? ''));
$authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
$suppliedToken = str_starts_with($authorization, 'Bearer ')
    ? trim(substr($authorization, 7))
    : '';

if ($expectedToken === '' || $suppliedToken === '' ||
    !hash_equals($expectedToken, $suppliedToken)) {
    gatewayCallbackJson(401, ['success' => false, 'message' => 'Autentikasi callback tidak valid.']);
}

$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) {
    gatewayCallbackJson(400, ['success' => false, 'message' => 'Body JSON tidak valid.']);
}

$requestId = strtolower(trim((string) ($input['request_id'] ?? '')));
$status = strtoupper(trim((string) ($input['status'] ?? '')));
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $requestId) ||
    !in_array($status, ['SENT', 'FAILED', 'UNKNOWN'], true)) {
    gatewayCallbackJson(422, ['success' => false, 'message' => 'Request ID atau status tidak valid.']);
}

$ack = isset($input['ack']) && is_numeric($input['ack'])
    ? max(0, min(255, (int) $input['ack']))
    : null;
$messageId = isset($input['message_id'])
    ? substr(trim((string) $input['message_id']), 0, 255)
    : null;
$errorMessage = isset($input['error'])
    ? substr(trim((string) $input['error']), 0, 450)
    : null;

try {
    $pdo = db();
    $find = $pdo->prepare('SELECT id, status FROM reminders WHERE gateway_request_id = ? LIMIT 1');
    $find->execute([$requestId]);
    $row = $find->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        gatewayCallbackJson(404, ['success' => false, 'message' => 'Request ID tidak ditemukan.']);
    }

    $currentStatus = strtoupper((string) $row['status']);
    if ($currentStatus === $status) {
        gatewayCallbackJson(200, ['success' => true, 'idempotent' => true]);
    }

    if (!in_array($currentStatus, ['PROCESSING', 'UNKNOWN'], true)) {
        gatewayCallbackJson(409, ['success' => false, 'message' => 'Status final sudah tercatat dan tidak ditimpa.']);
    }

    $update = $pdo->prepare("
        UPDATE reminders
        SET status = ?,
            sent_at = CASE WHEN ? = 'SENT' THEN NOW() ELSE NULL END,
            gateway_message_id = ?,
            gateway_ack = ?,
            delivery_error = ?,
            delivery_updated_at = NOW()
        WHERE id = ?
          AND gateway_request_id = ?
          AND status IN ('PROCESSING', 'UNKNOWN')
    ");
    $update->execute([
        $status,
        $status,
        $messageId ?: null,
        $ack,
        $errorMessage ?: null,
        (int) $row['id'],
        $requestId
    ]);

    if ($update->rowCount() > 0) {
        logAction((int) $row['id'], $status);
    }

    gatewayCallbackJson(200, ['success' => true, 'updated' => $update->rowCount() > 0]);
} catch (Throwable $error) {
    error_log('Gateway callback persistence failed: ' . $error->getMessage());
    gatewayCallbackJson(500, ['success' => false, 'message' => 'Hasil callback belum dapat disimpan.']);
}
