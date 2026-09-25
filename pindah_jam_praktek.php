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

try {
    $statement = get_db('rme')->prepare("
        SELECT
            dokter.no_dr AS dokter_id,
            dokter.nama2 AS nama_dokter,
            praktek.jam1,
            praktek.jam2,
            praktek.cjam1,
            praktek.cjam2,
            praktek.ctanggal
        FROM pendaftaran.praktek AS praktek
        INNER JOIN pendaftaran.dokter_spesialis AS dokter_spesialis
            ON praktek.dokter_spesialis_id = dokter_spesialis.id
        INNER JOIN rsiklaten.dokter AS dokter
            ON dokter_spesialis.dokter_id = dokter.no_dr
        WHERE praktek.ctanggal LIKE ?
        ORDER BY dokter.nama2 ASC, praktek.jam1 ASC
    ");

    $statement->execute(['%' . $date . '%']);
    $rows = $statement->fetchAll();
} catch (Throwable $e) {
    $error = $e->getMessage();
}
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pindah Jam Praktek</title>

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
                    <a class="nav-link" href="dokter_ijin.php">Dokter Ijin</a>
                    <a class="nav-link active fw-semibold" href="pindah_jam_praktek.php">Pindah Jam Praktek</a>
                </div>
            </div>
        </div>
    </nav>

    <main class="container py-4">
        <div class="d-flex flex-column flex-lg-row justify-content-between align-items-lg-end gap-3 mb-3">
            <div>
                <span class="badge text-bg-info-subtle text-info-emphasis mb-2">PINDAH JAM PRAKTEK</span>
                <h1 class="h3 mb-1">Pindah Jam Praktek</h1>
                <p class="text-secondary mb-0">Daftar dokter yang mengalami perubahan jam praktek pada tanggal yang dipilih.</p>
            </div>

            <form method="get" id="movedPracticeFilterForm">
                <label class="form-label small text-secondary mb-1" for="movedPracticeDate">Tanggal</label>
                <div class="input-group">
                    <input
                        type="text"
                        class="form-control"
                        id="movedPracticeDate"
                        name="tanggal"
                        value="<?= e($displayDate) ?>"
                        placeholder="DD-MM-YYYY"
                        autocomplete="off"
                    >
                    <button class="btn btn-outline-secondary" id="movedPracticeDateButton" type="button" aria-label="Pilih tanggal">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    </button>
                </div>
            </form>
        </div>

        <div class="row g-3 mb-3">
            <div class="col-md-6">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body py-3">
                        <div class="text-secondary small">TANGGAL</div>
                        <div class="h5 fw-bold mb-0"><?= e(indoDate($date)) ?></div>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body py-3">
                        <div class="text-secondary small">TOTAL PINDAH JAM</div>
                        <div class="h3 fw-bold mb-0"><?= count($rows) ?></div>
                    </div>
                </div>
            </div>
        </div>

        <?php if ($error !== ''): ?>
            <div class="alert alert-danger">
                <div class="fw-semibold mb-1">Gagal mengambil data pindah jam praktek.</div>
                <div><?= e($error) ?></div>
            </div>
        <?php endif; ?>

        <div class="card shadow-sm border-0">
            <div class="card-body">
                <div class="table-responsive">
                    <table id="movedPracticeTable" class="table table-striped table-hover align-middle w-100">
                        <thead>
                            <tr>
                                <th>No</th>
                                <th>Kode Dokter</th>
                                <th>Dokter</th>
                                <th>Jam Praktek</th>
                                <th>Jam Realisasi</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($rows as $index => $row): ?>
                                <tr>
                                    <td><?= $index + 1 ?></td>
                                    <td><?= e((string) ($row['dokter_id'] ?? '')) ?></td>
                                    <td><?= e((string) ($row['nama_dokter'] ?? '')) ?></td>
                                    <td>
                                        <?= e((string) ($row['jam1'] ?? '-')) ?> - <?= e((string) ($row['jam2'] ?? '-')) ?>
                                    </td>
                                    <td>
                                        <?= e((string) ($row['cjam1'] ?? '-')) ?> - <?= e((string) ($row['cjam2'] ?? '-')) ?>
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
            const movedPracticeDate = document.getElementById('movedPracticeDate');
            const movedPracticeDateButton = document.getElementById('movedPracticeDateButton');
            const movedPracticeFilterForm = document.getElementById('movedPracticeFilterForm');

            const movedPracticeDatePicker = flatpickr(movedPracticeDate, {
                dateFormat: 'd-m-Y',
                defaultDate: movedPracticeDate.value,
                allowInput: true,
                locale: 'id',
                disableMobile: true,
                onChange: function () {
                    movedPracticeFilterForm.submit();
                }
            });

            movedPracticeDateButton.addEventListener('click', function () {
                movedPracticeDatePicker.open();
            });

            movedPracticeDate.addEventListener('change', function () {
                movedPracticeFilterForm.submit();
            });

            new DataTable('#movedPracticeTable', {
                responsive: true,
                pageLength: 25,
                order: [[2, 'asc']],
                language: {
                    search: 'Cari:',
                    lengthMenu: 'Tampilkan _MENU_ data',
                    info: 'Menampilkan _START_ sampai _END_ dari _TOTAL_ data',
                    infoEmpty: 'Tidak ada data',
                    zeroRecords: 'Data tidak ditemukan',
                    emptyTable: 'Tidak ada dokter yang pindah jam praktek pada tanggal ini',
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
