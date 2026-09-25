<?php

declare(strict_types=1);

require_once __DIR__ . '/functions.php';

$rawDate = trim($_GET['tanggal'] ?? date('d-m-Y'));
$dateObject = DateTime::createFromFormat('d-m-Y', $rawDate);

if (!$dateObject || $dateObject->format('d-m-Y') !== $rawDate) {
    $legacyDate = DateTime::createFromFormat('Y-m-d', $rawDate);

    if ($legacyDate && $legacyDate->format('Y-m-d') === $rawDate) {
        $dateObject = $legacyDate;
    } else {
        $dateObject = new DateTime();
    }
}

$date = $dateObject->format('Y-m-d');
$displayDate = $dateObject->format('d-m-Y');
$rows = [];
$error = '';
$doctorNames = [];

try {
    $leaveStatement = get_db('rme')->prepare("
        SELECT
            a.id,
            a.nomor,
            a.jenis,
            a.dokter_id,
            a.dokter_spesialis_id,
            a.kopilot,
            a.dpjp,
            a.praktek,
            a.visit,
            a.konsul,
            a.cetak,
            a.registered
        FROM (
            SELECT *
            FROM surat_ijin
            ORDER BY id DESC
        ) a
        WHERE a.praktek LIKE ?
            AND a.deleted IS NULL
        ORDER BY a.id DESC
    ");

    $leaveStatement->execute(['%' . $date . '%']);
    $rows = $leaveStatement->fetchAll();

    $doctorIds = [];

    foreach ($rows as $row) {
        foreach (['dokter_id', 'kopilot', 'dpjp'] as $field) {
            $doctorId = trim((string) ($row[$field] ?? ''));

            if ($doctorId !== '' && $doctorId !== '0') {
                $doctorIds[$doctorId] = $doctorId;
            }
        }
    }

    if ($doctorIds) {
        $doctorIds = array_values($doctorIds);
        $placeholders = implode(',', array_fill(0, count($doctorIds), '?'));
        $doctorStatement = get_db('rsi_byl')->prepare("
            SELECT
                dokter_kd,
                dokter_nama
            FROM master_dokter
            WHERE dokter_kd IN ({$placeholders})
        ");
        $doctorStatement->execute($doctorIds);

        foreach ($doctorStatement->fetchAll() as $doctorRow) {
            $doctorNames[(string) $doctorRow['dokter_kd']] = (string) $doctorRow['dokter_nama'];
        }
    }
} catch (Throwable $e) {
    $error = $e->getMessage();
}
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Dokter Ijin</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.datatables.net/v/bs5/dt-3.0.2/r-4.0.2/datatables.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css" rel="stylesheet">
    <link rel="stylesheet" href="assets/style.css">
</head>
<body class="bg-body-tertiary">
    <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
        <div class="container py-2">
            <a class="navbar-brand fw-bold text-success" href="index.php">Dokter Reminder RSU Islam Klaten</a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNavbar">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="mainNavbar">
                <div class="navbar-nav ms-auto">
                    <a class="nav-link" href="index.php">Dashboard</a>
                    <a class="nav-link" href="master.php">Master Data</a>
                    <a class="nav-link" href="settings.php">Template</a>
                    <a class="nav-link" href="report.php">Report</a>
                    <a class="nav-link active fw-semibold" href="dokter_ijin.php">Dokter Ijin</a>
                </div>
            </div>
        </div>
    </nav>

    <main class="container py-4">
        <div class="d-flex flex-column flex-lg-row justify-content-between align-items-lg-end gap-3 mb-3">
            <div>
                <span class="badge text-bg-warning-subtle text-warning-emphasis mb-2">IJIN DOKTER</span>
                <h1 class="h3 mb-1">Dokter Ijin</h1>
                <p class="text-secondary mb-0">Daftar dokter yang memiliki ijin praktek pada tanggal yang dipilih.</p>
            </div>

            <form method="get" id="leaveFilterForm">
                <label class="form-label small text-secondary mb-1" for="leaveDate">Tanggal Praktek</label>
                <div class="input-group">
                    <input
                        type="text"
                        class="form-control"
                        id="leaveDate"
                        name="tanggal"
                        value="<?= e($displayDate) ?>"
                        placeholder="DD-MM-YYYY"
                        autocomplete="off"
                    >
                    <button class="btn btn-outline-secondary" id="leaveDateButton" type="button" aria-label="Pilih tanggal">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    </button>
                </div>
            </form>
        </div>

        <div class="row g-3 mb-3">
            <div class="col-md-6">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body py-3">
                        <div class="text-secondary small">TANGGAL PRAKTEK</div>
                        <div class="h5 fw-bold mb-0"><?= e(indoDate($date)) ?></div>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body py-3">
                        <div class="text-secondary small">TOTAL DATA IJIN</div>
                        <div class="h3 fw-bold mb-0"><?= count($rows) ?></div>
                    </div>
                </div>
            </div>
        </div>

        <?php if ($error !== ''): ?>
            <div class="alert alert-danger">
                Gagal mengambil data dokter ijin: <?= e($error) ?>
            </div>
        <?php endif; ?>

        <div class="card shadow-sm border-0">
            <div class="card-body">
                <div class="table-responsive">
                    <table id="leaveTable" class="table table-striped table-hover align-middle w-100">
                        <thead>
                            <tr>
                                <th>No</th>
                                <th>Kode Dokter</th>
                                <th>Nama Dokter</th>
                                <th>Kopilot</th>
                                <th>DPJP</th>
                                <th>Konsul</th>
                                <th>Praktek</th>
                                <th>Visit</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($rows as $index => $row): ?>
                                <?php
                                $doctorId = trim((string) ($row['dokter_id'] ?? ''));
                                $copilotId = trim((string) ($row['kopilot'] ?? ''));
                                $dpjpId = trim((string) ($row['dpjp'] ?? ''));
                                $doctorName = $doctorNames[$doctorId] ?? $doctorId;
                                $copilotName = $copilotId !== '' && $copilotId !== '0'
                                    ? ($doctorNames[$copilotId] ?? $copilotId)
                                    : '-';
                                $dpjpName = $dpjpId !== '' && $dpjpId !== '0'
                                    ? ($doctorNames[$dpjpId] ?? $dpjpId)
                                    : '-';
                                $consultation = match ((string) ($row['konsul'] ?? '')) {
                                    '1' => 'Ya',
                                    '2' => 'Tidak',
                                    default => '-'
                                };
                                $approved = !empty($row['cetak']);
                                ?>
                                <tr>
                                    <td><?= $index + 1 ?></td>
                                    <td><?= e($doctorId) ?></td>
                                    <td><?= e($doctorName) ?></td>
                                    <td><?= e($copilotName) ?></td>
                                    <td><?= e($dpjpName) ?></td>
                                    <td><?= e($consultation) ?></td>
                                    <td><?= nl2br(e(str_replace(',', "\n", (string) ($row['praktek'] ?? '-')))) ?></td>
                                    <td><?= nl2br(e(str_replace(',', "\n", (string) ($row['visit'] ?? '-')))) ?></td>
                                    <td>
                                        <span class="badge <?= $approved ? 'text-bg-success' : 'text-bg-warning' ?>">
                                            <?= $approved ? 'DISETUJUI' : 'PENDING' ?>
                                        </span>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </main>

    <footer class="border-top bg-white py-4 text-center text-secondary small mt-4">
        DokterReminder · PHP Native + MySQL + whatsapp-web.js
    </footer>

    <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.datatables.net/v/bs5/dt-3.0.2/r-4.0.2/datatables.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
    <script src="https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/id.js"></script>
    <script src="assets/back-to-top.js"></script>

    <script>
        document.addEventListener('DOMContentLoaded', function () {
            const leaveDate = document.getElementById('leaveDate');
            const leaveDateButton = document.getElementById('leaveDateButton');
            const leaveFilterForm = document.getElementById('leaveFilterForm');

            const leaveDatePicker = flatpickr(leaveDate, {
                dateFormat: 'd-m-Y',
                defaultDate: leaveDate.value,
                allowInput: true,
                locale: 'id',
                disableMobile: true,
                onChange: function () {
                    leaveFilterForm.submit();
                }
            });

            leaveDateButton.addEventListener('click', function () {
                leaveDatePicker.open();
            });

            leaveDate.addEventListener('change', function () {
                leaveFilterForm.submit();
            });

            new DataTable('#leaveTable', {
                responsive: true,
                pageLength: 25,
                order: [[0, 'asc']],
                language: {
                    search: 'Cari:',
                    lengthMenu: 'Tampilkan _MENU_ data',
                    info: 'Menampilkan _START_ sampai _END_ dari _TOTAL_ data',
                    infoEmpty: 'Tidak ada data',
                    zeroRecords: 'Data tidak ditemukan',
                    emptyTable: 'Tidak ada dokter ijin pada tanggal ini',
                    paginate: {
                        first: 'Awal',
                        last: 'Akhir',
                        next: 'Berikutnya',
                        previous: 'Sebelumnya'
                    }
                }
            });
        });
    </script>
</body>
</html>
