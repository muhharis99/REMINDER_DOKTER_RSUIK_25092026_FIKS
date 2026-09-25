<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/chat_functions.php';

$doctorId = trim((string) ($_GET['doctor_id'] ?? ''));
$afterId = max(0, (int) ($_GET['after_id'] ?? 0));
$doctor = chatDoctorById($doctorId);

if (!$doctor) {
    chatJson([
        'success' => false,
        'message' => 'Dokter tidak ditemukan.'
    ], 404);
}

try {
    if ($afterId > 0) {
        $statement = db()->prepare("
            SELECT *
            FROM whatsapp_messages
            WHERE doctor_id = ?
                AND id > ?
            ORDER BY id ASC
            LIMIT 200
        ");
        $statement->execute([$doctorId, $afterId]);
        $rows = $statement->fetchAll();
    } else {
        $statement = db()->prepare("
            SELECT *
            FROM (
                SELECT *
                FROM whatsapp_messages
                WHERE doctor_id = ?
                ORDER BY id DESC
                LIMIT 200
            ) recent
            ORDER BY id ASC
        ");
        $statement->execute([$doctorId]);
        $rows = $statement->fetchAll();
    }

    $messages = [];

    foreach ($rows as $row) {
        $messages[] = [
            'id' => (int) $row['id'],
            'message_id' => (string) ($row['message_id'] ?? ''),
            'direction' => (string) $row['direction'],
            'message_type' => (string) $row['message_type'],
            'message' => (string) ($row['message'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'time' => chatFormatTime((string) ($row['created_at'] ?? ''))
        ];
    }

    chatJson([
        'success' => true,
        'doctor' => $doctor,
        'messages' => $messages
    ]);
} catch (Throwable $e) {
    error_log('Gagal membaca pesan chat dokter: ' . $e->getMessage());

    chatJson([
        'success' => false,
        'message' => 'Pesan chat gagal dibaca.'
    ], 500);
}
