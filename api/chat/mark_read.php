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

if (!chatDoctorById($doctorId)) {
    chatJson([
        'success' => false,
        'message' => 'Dokter tidak ditemukan.'
    ], 404);
}

try {
    $statement = db()->prepare("
        UPDATE whatsapp_messages
        SET read_at = ?
        WHERE doctor_id = ?
            AND direction = 'IN'
            AND read_at IS NULL
    ");

    $statement->execute([
        date('Y-m-d H:i:s'),
        $doctorId
    ]);

    chatJson([
        'success' => true,
        'updated' => $statement->rowCount()
    ]);
} catch (Throwable $e) {
    error_log('Gagal menandai chat dokter sudah dibaca: ' . $e->getMessage());

    chatJson([
        'success' => false,
        'message' => 'Status baca gagal diperbarui.'
    ], 500);
}
