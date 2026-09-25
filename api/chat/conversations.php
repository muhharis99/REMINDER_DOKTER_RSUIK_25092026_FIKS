<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/chat_functions.php';

try {
    $messages = db()->query("
        SELECT wm.*
        FROM whatsapp_messages wm
        INNER JOIN (
            SELECT doctor_id, MAX(id) AS max_id
            FROM whatsapp_messages
            WHERE doctor_id IS NOT NULL
            GROUP BY doctor_id
        ) latest ON latest.max_id = wm.id
        ORDER BY wm.id DESC
        LIMIT 200
    ")->fetchAll();

    $unreadRows = db()->query("
        SELECT doctor_id, COUNT(*) AS unread_count
        FROM whatsapp_messages
        WHERE direction = 'IN'
            AND read_at IS NULL
            AND doctor_id IS NOT NULL
        GROUP BY doctor_id
    ")->fetchAll();

    $lastByDoctor = [];
    $unreadByDoctor = [];

    foreach ($messages as $row) {
        $lastByDoctor[(string) $row['doctor_id']] = $row;
    }

    foreach ($unreadRows as $row) {
        $unreadByDoctor[(string) $row['doctor_id']] = (int) $row['unread_count'];
    }

    $conversations = [];

    foreach (chatDoctorDirectory() as $doctorId => $doctor) {
        $last = $lastByDoctor[$doctorId] ?? null;

        $conversations[] = [
            'doctor_id' => $doctorId,
            'name' => $doctor['name'],
            'phone' => $doctor['phone'],
            'phone_raw' => $doctor['phone_raw'],
            'last_message' => $last['message'] ?? '',
            'last_direction' => $last['direction'] ?? '',
            'last_time' => $last ? chatFormatTime($last['created_at'] ?? '') : '',
            'last_id' => $last ? (int) $last['id'] : 0,
            'unread_count' => $unreadByDoctor[$doctorId] ?? 0
        ];
    }

    usort(
        $conversations,
        static function (array $a, array $b): int {
            if ($a['last_id'] === $b['last_id']) {
                return strcasecmp($a['name'], $b['name']);
            }

            return $b['last_id'] <=> $a['last_id'];
        }
    );

    chatJson([
        'success' => true,
        'conversations' => $conversations
    ]);
} catch (Throwable $e) {
    error_log('Gagal membaca conversation chat dokter: ' . $e->getMessage());

    chatJson([
        'success' => false,
        'message' => 'Data chat belum siap. Jalankan migration whatsapp_messages terlebih dahulu.'
    ], 500);
}
