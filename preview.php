<?php

declare(strict_types=1);

require_once __DIR__ . '/functions.php';

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;

function preview_escape($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

if ($id <= 0) {
    http_response_code(400);
    exit('ID reminder tidak valid.');
}

try {
    $statement = db()->prepare("
        SELECT *
        FROM reminders
        WHERE id = ?
        LIMIT 1
    ");

    $statement->execute([$id]);
    $reminder = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$reminder) {
        http_response_code(404);
        exit('Reminder tidak ditemukan.');
    }
} catch (Throwable $e) {
    http_response_code(500);
    exit('Preview gagal dimuat: ' . preview_escape($e->getMessage()));
}

$doctorId = trim((string) ($reminder['doctor_id'] ?? ''));
$date = trim((string) ($reminder['tanggal'] ?? ''));
$message = (string) ($reminder['message'] ?? '');
$isLeave = false;
$hasActiveSchedule = false;
$notice = '';

if ($doctorId !== '' && $date !== '') {
    $leaveCodes = doctorLeaveCodes($date);
    $isLeave = isset($leaveCodes[$doctorId]);

    if ($isLeave) {
        $notice = 'Dokter tercatat izin pada tanggal ini. Reminder tidak perlu dikirim.';
    } else {
        try {
            $scheduleRows = schedulesFor($date);
            $doctorSchedules = array_values(
                array_filter(
                    $scheduleRows,
                    static function (array $row) use ($doctorId): bool {
                        return (string) ($row['doctor_id'] ?? '') === $doctorId;
                    }
                )
            );

            if ($doctorSchedules) {
                $hasActiveSchedule = true;
                $message = buildReminderMessage(
                    $doctorSchedules[0],
                    $doctorSchedules,
                    $date
                );

                if ((string) ($reminder['message'] ?? '') !== $message) {
                    $updateStatement = db()->prepare("
                        UPDATE reminders
                        SET message = ?
                        WHERE id = ?
                    ");

                    $updateStatement->execute([
                        $message,
                        $id
                    ]);
                }
            } else {
                $notice = 'Jadwal dokter tidak lagi aktif pada tanggal ini. Reminder tidak perlu dikirim.';
            }
        } catch (Throwable $e) {
            $notice = 'Gagal memvalidasi ulang jadwal terbaru: ' . $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Preview Pesan</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">

    <style>
        html,
        body {
            margin: 0;
            padding: 0;
            background: #ffffff;
        }

        body {
            font-size: 14px;
        }

        .preview-wrapper {
            padding: 20px;
        }

        .message-preview {
            white-space: normal;
            line-height: 1.65;
            color: #212529;
        }

        .alert {
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="preview-wrapper">
        <?php if ($notice !== ''): ?>
            <div class="alert <?= $isLeave ? 'alert-warning' : 'alert-secondary' ?>">
                <?= preview_escape($notice) ?>
            </div>
        <?php elseif ($hasActiveSchedule): ?>
            <div class="message-preview">
                <?= nl2br(preview_escape($message)) ?>
            </div>
        <?php else: ?>
            <div class="alert alert-secondary">
                Preview pesan tidak tersedia.
            </div>
        <?php endif; ?>
    </div>
</body>
</html>
