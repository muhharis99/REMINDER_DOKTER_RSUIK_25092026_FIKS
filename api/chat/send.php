<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/chat_functions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    chatJson([
        'success' => false,
        'message' => 'Method tidak diizinkan.'
    ], 405);
}

$payload = json_decode((string) file_get_contents('php://input'), true);
$doctorId = trim((string) ($payload['doctor_id'] ?? ''));
$message = trim((string) ($payload['message'] ?? ''));
$doctor = chatDoctorById($doctorId);

if (!$doctor) {
    chatJson([
        'success' => false,
        'message' => 'Dokter tidak ditemukan.'
    ], 404);
}

if ($message === '') {
    chatJson([
        'success' => false,
        'message' => 'Pesan WhatsApp tidak boleh kosong.'
    ], 422);
}

if (strlen($message) > 20000) {
    chatJson([
        'success' => false,
        'message' => 'Pesan terlalu panjang.'
    ], 422);
}

try {
    $gateway = chatGatewayRequest('/send', [
        'phone' => $doctor['phone'],
        'doctor_id' => $doctorId,
        'message' => $message
    ]);

    $messageId = trim((string) ($gateway['messageId'] ?? ''));
    $createdAt = date('Y-m-d H:i:s');

    $statement = db()->prepare("
        INSERT INTO whatsapp_messages (
            message_id,
            doctor_id,
            phone,
            direction,
            message_type,
            message,
            status,
            sent_at,
            created_at
        ) VALUES (?, ?, ?, 'OUT', 'text', ?, 'SENT', ?, ?)
    ");

    $statement->execute([
        $messageId !== '' ? $messageId : null,
        $doctorId,
        $doctor['phone'],
        $message,
        $createdAt,
        $createdAt
    ]);

    chatJson([
        'success' => true,
        'message' => 'Pesan WhatsApp berhasil dikirim.',
        'id' => (int) db()->lastInsertId(),
        'message_id' => $messageId
    ]);
} catch (RuntimeException $e) {
    error_log('Gateway chat dokter gagal: ' . $e->getMessage());

    chatJson([
        'success' => false,
        'message' => $e->getMessage()
    ], 500);
} catch (Throwable $e) {
    error_log('Gagal menyimpan chat dokter keluar: ' . $e->getMessage());

    chatJson([
        'success' => false,
        'message' => 'Pesan terkirim tetapi pencatatan chat gagal. Periksa log server sebelum mengirim ulang.'
    ], 500);
}
