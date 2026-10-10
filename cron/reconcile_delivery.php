<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/functions.php';

// A missing callback is not proof of delivery failure; mark the attempt UNKNOWN,
// never FAILED, to prevent an automatic duplicate send.
$pdo = db();
$pdo->beginTransaction();

try {
    $stale = $pdo->query("
        SELECT id
        FROM reminders
        WHERE status = 'PROCESSING'
          AND delivery_started_at IS NOT NULL
          AND delivery_started_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        FOR UPDATE
    ")->fetchAll(PDO::FETCH_COLUMN);

    if ($stale) {
        $placeholders = implode(',', array_fill(0, count($stale), '?'));
        $update = $pdo->prepare("
            UPDATE reminders
            SET status = 'UNKNOWN',
                delivery_error = 'Callback gateway tidak diterima dalam 10 menit; periksa riwayat WhatsApp sebelum mencoba lagi.',
                delivery_updated_at = NOW()
            WHERE id IN ($placeholders)
              AND status = 'PROCESSING'
        ");
        $update->execute(array_map('intval', $stale));

        foreach ($stale as $id) {
            logAction((int) $id, 'UNKNOWN');
        }
    }

    $pdo->commit();
    echo sprintf("Rekonsiliasi selesai. Reminder menjadi UNKNOWN: %d\n", count($stale));
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('Delivery reconciliation failed: ' . $error->getMessage());
    fwrite(STDERR, "Rekonsiliasi gagal; periksa log aplikasi.\n");
    exit(1);
}
