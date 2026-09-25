<?php

declare(strict_types=1);

ini_set('memory_limit', '256M');
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/functions.php';

$autoload = __DIR__ . '/vendor/autoload.php';

if (!is_file($autoload)) {
    http_response_code(500);
    exit('mPDF belum terpasang. Jalankan: composer install');
}

require_once $autoload;

try {
    $startDate = trim($_GET['start_date'] ?? date('Y-m-01'));
    $endDate = trim($_GET['end_date'] ?? date('Y-m-d'));
    $status = trim($_GET['status'] ?? '');

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate)) {
        $startDate = date('Y-m-01');
    }

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate)) {
        $endDate = date('Y-m-d');
    }

    $allowedStatuses = [
        '',
        'PENDING',
        'READY',
        'OPENED',
        'SENT',
        'FAILED'
    ];

    if (!in_array($status, $allowedStatuses, true)) {
        $status = '';
    }

    $sql = "
        SELECT
            id,
            doctor_id,
            tanggal,
            reminder_type,
            status,
            sent_at,
            created_at
        FROM reminders
        WHERE tanggal BETWEEN ? AND ?
    ";

    $params = [
        $startDate,
        $endDate
    ];

    if ($status !== '') {
        $sql .= " AND status = ?";
        $params[] = $status;
    }

    $sql .= " ORDER BY tanggal ASC, created_at ASC";

    $statement = db()->prepare($sql);
    $statement->execute($params);
    $rows = $statement->fetchAll();

    $doctorIds = [];

    foreach ($rows as $row) {
        $doctorIds[(string) $row['doctor_id']] = true;
    }

    $doctorNames = [];

    if ($doctorIds) {
        $ids = array_keys($doctorIds);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $doctorStatement = get_db('rsi_byl')->prepare("
            SELECT
                dokter_kd,
                dokter_nama
            FROM master_dokter
            WHERE dokter_kd IN ($placeholders)
        ");
        $doctorStatement->execute($ids);

        foreach ($doctorStatement->fetchAll() as $doctor) {
            $doctorNames[(string) $doctor['dokter_kd']] = (string) $doctor['dokter_nama'];
        }
    }

    $total = count($rows);
    $sent = 0;
    $ready = 0;
    $failed = 0;

    foreach ($rows as $row) {
        if ($row['status'] === 'SENT') {
            $sent++;
        } elseif ($row['status'] === 'READY') {
            $ready++;
        } elseif ($row['status'] === 'FAILED') {
            $failed++;
        }
    }

    $hospitalName = setting('nama_rs', 'RSU ISLAM KLATEN');
    $statusLabel = $status === '' ? 'Semua Status' : $status;
    $tempDir = sys_get_temp_dir() . '/dokter-reminder-mpdf';

    if (!is_dir($tempDir)) {
        if (!mkdir($tempDir, 0777, true) && !is_dir($tempDir)) {
            throw new RuntimeException('Folder temporary mPDF tidak dapat dibuat: ' . $tempDir);
        }
    }

    if (!is_writable($tempDir)) {
        throw new RuntimeException('Folder temporary mPDF tidak writable: ' . $tempDir);
    }

    $mpdf = new \Mpdf\Mpdf([
        'format' => 'A4-L',
        'margin_left' => 10,
        'margin_right' => 10,
        'margin_top' => 14,
        'margin_bottom' => 14,
        'tempDir' => $tempDir,
        'simpleTables' => true,
        'packTableData' => true
    ]);

    $mpdf->SetTitle('Report Reminder WhatsApp');
    $mpdf->SetAuthor($hospitalName);
    $mpdf->SetFooter('{PAGENO} / {nbpg}');

    $html = '
    <style>
        body {
            font-family: sans-serif;
            font-size: 10pt;
            color: #1f2937;
        }

        .header {
            text-align: center;
            margin-bottom: 14px;
        }

        .header h1 {
            margin: 0 0 4px 0;
            font-size: 16pt;
        }

        .header p {
            margin: 2px 0;
            color: #4b5563;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        .summary {
            margin: 10px 0 14px 0;
        }

        .summary td {
            width: 25%;
            border: 1px solid #d1d5db;
            padding: 7px 9px;
            text-align: center;
        }

        .summary .label {
            font-size: 8pt;
            color: #6b7280;
        }

        .summary .value {
            margin-top: 3px;
            font-size: 15pt;
            font-weight: bold;
        }

        .data-table th {
            background: #0d6e4f;
            color: #ffffff;
            border: 1px solid #0d6e4f;
            padding: 6px;
            font-size: 8.5pt;
        }

        .data-table td {
            border: 1px solid #d1d5db;
            padding: 5px 6px;
            font-size: 8.5pt;
        }

        .text-center {
            text-align: center;
        }
    </style>

    <div class="header">
        <h1>REPORT REMINDER WHATSAPP DOKTER</h1>
        <p>' . e($hospitalName) . '</p>
        <p>
            Periode ' . e(date('d-m-Y', strtotime($startDate))) . '
            s/d ' . e(date('d-m-Y', strtotime($endDate))) . '
            | Status: ' . e($statusLabel) . '
        </p>
    </div>

    <table class="summary">
        <tr>
            <td><div class="label">TOTAL</div><div class="value">' . $total . '</div></td>
            <td><div class="label">SENT</div><div class="value">' . $sent . '</div></td>
            <td><div class="label">READY</div><div class="value">' . $ready . '</div></td>
            <td><div class="label">FAILED</div><div class="value">' . $failed . '</div></td>
        </tr>
    </table>

    <table class="data-table">
        <thead>
            <tr>
                <th width="4%">No</th>
                <th width="10%">Tanggal</th>
                <th width="30%">Dokter</th>
                <th width="12%">Jenis</th>
                <th width="10%">Status</th>
                <th width="17%">Dibuat</th>
                <th width="17%">Terkirim</th>
            </tr>
        </thead>
        <tbody>';

    if (!$rows) {
        $html .= '<tr><td colspan="7" class="text-center">Tidak ada data.</td></tr>';
    } else {
        foreach ($rows as $index => $row) {
            $doctorId = (string) $row['doctor_id'];
            $doctorName = $doctorNames[$doctorId] ?? $doctorId;
            $createdAt = $row['created_at']
                ? date('d-m-Y H:i:s', strtotime($row['created_at']))
                : '-';
            $sentAt = $row['sent_at']
                ? date('d-m-Y H:i:s', strtotime($row['sent_at']))
                : '-';

            $html .= '
                <tr>
                    <td class="text-center">' . ($index + 1) . '</td>
                    <td>' . e(date('d-m-Y', strtotime($row['tanggal']))) . '</td>
                    <td>' . e($doctorName) . '</td>
                    <td>' . e($row['reminder_type']) . '</td>
                    <td class="text-center">' . e($row['status']) . '</td>
                    <td>' . e($createdAt) . '</td>
                    <td>' . e($sentAt) . '</td>
                </tr>';
        }
    }

    $html .= '
        </tbody>
    </table>';

    $mpdf->WriteHTML($html);

    unset($html, $rows, $doctorNames, $doctorIds);

    $fileName = 'report-reminder-' . $startDate . '-sampai-' . $endDate . '.pdf';

    $mpdf->Output($fileName, 'I');
    exit;
} catch (Throwable $e) {
    http_response_code(500);

    echo '<!doctype html>';
    echo '<html lang="id">';
    echo '<head>';
    echo '<meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>Error Report PDF</title>';
    echo '<style>';
    echo 'body{font-family:Arial,sans-serif;background:#f3f4f6;padding:30px;color:#1f2937;}';
    echo '.box{max-width:900px;margin:auto;background:#fff;padding:24px;border-radius:10px;border:1px solid #e5e7eb;}';
    echo 'h1{font-size:20px;margin-top:0;color:#b91c1c;}';
    echo 'pre{white-space:pre-wrap;word-break:break-word;background:#f9fafb;padding:15px;border-radius:8px;}';
    echo '</style>';
    echo '</head>';
    echo '<body>';
    echo '<div class="box">';
    echo '<h1>Report PDF gagal dibuat</h1>';
    echo '<pre>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</pre>';
    echo '<div>File: ' . htmlspecialchars($e->getFile(), ENT_QUOTES, 'UTF-8') . '</div>';
    echo '<div>Line: ' . (int) $e->getLine() . '</div>';
    echo '</div>';
    echo '</body>';
    echo '</html>';
}
