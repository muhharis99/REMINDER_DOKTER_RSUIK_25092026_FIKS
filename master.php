<?php

declare(strict_types=1);

require_once __DIR__ . '/functions.php';

$pdo = get_db('rsi_byl');
$notice = '';
$noticeType = 'success';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    try {
        if ($action === 'save_contact') {
            $doctorCode = trim($_POST['dokter_kd'] ?? '');
            $phone = trim($_POST['no_hp'] ?? '');

            if ($doctorCode === '') {
                throw new RuntimeException('Dokter wajib dipilih.');
            }

            if ($phone === '') {
                throw new RuntimeException('Nomor WhatsApp wajib diisi.');
            }

            $check = $pdo->prepare("
                SELECT kd_dr
                FROM kontak_dokter
                WHERE kd_dr = ?
                LIMIT 1
            ");

            $check->execute([$doctorCode]);

            if ($check->fetchColumn()) {
                $statement = $pdo->prepare("
                    UPDATE kontak_dokter
                    SET no_hp = ?
                    WHERE kd_dr = ?
                ");

                $statement->execute([
                    $phone,
                    $doctorCode
                ]);
            } else {
                $statement = $pdo->prepare("
                    INSERT INTO kontak_dokter (
                        kd_dr,
                        no_hp
                    ) VALUES (?, ?)
                ");

                $statement->execute([
                    $doctorCode,
                    $phone
                ]);
            }

            $notice = 'Nomor WhatsApp dokter berhasil disimpan.';
        }

        if ($action === 'disable_contact') {
            $doctorCode = trim($_POST['dokter_kd'] ?? '');

            if ($doctorCode === '') {
                throw new RuntimeException('Kode dokter tidak valid.');
            }

            $statement = $pdo->prepare("
                UPDATE kontak_dokter
                SET no_hp = '0'
                WHERE kd_dr = ?
            ");

            $statement->execute([$doctorCode]);
            $notice = 'Nomor WhatsApp dokter dinonaktifkan.';
        }
    } catch (Throwable $e) {
        $notice = $e->getMessage();
        $noticeType = 'danger';
    }
}

$doctors = $pdo->query("
    SELECT
        md.dokter_kd,
        md.dokter_nama,
        COALESCE(kd.no_hp, '') AS no_hp
    FROM master_dokter md
    LEFT JOIN kontak_dokter kd
        ON kd.kd_dr = md.dokter_kd
    ORDER BY md.dokter_nama ASC
")->fetchAll();

$policies = $pdo->query("
    SELECT
        poli_kd,
        poli_nama
    FROM master_poli
    ORDER BY poli_nama ASC
")->fetchAll();

$schedules = $pdo->query("
    SELECT
        djk.tanggal,
        djk.hari,
        dj.dokter_kd,
        md.dokter_nama,
        dj.poli_kd,
        mp.poli_nama,
        dj.jam_mulai,
        dj.jam_selesai,
        djk.kuota_all,
        djk.aktif,
        COALESCE(kd.no_hp, '') AS no_hp
    FROM dokter_jadwal_kuota djk
    LEFT JOIN dokter_jadwal dj
        ON dj.id = djk.dokter_jadwal_id
    LEFT JOIN master_dokter md
        ON md.dokter_kd = dj.dokter_kd
    LEFT JOIN master_poli mp
        ON mp.poli_kd = dj.poli_kd
    LEFT JOIN kontak_dokter kd
        ON kd.kd_dr = dj.dokter_kd
    WHERE djk.tanggal >= CURDATE()
    ORDER BY
        djk.tanggal ASC,
        dj.jam_mulai ASC
    LIMIT 500
")->fetchAll();
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Master Data</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.datatables.net/v/bs5/dt-3.0.2/r-4.0.2/datatables.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2-bootstrap-5-theme@1.3.0/dist/select2-bootstrap-5-theme.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css" rel="stylesheet">
    <link rel="stylesheet" href="assets/style.css">
</head>
<body class="bg-body-tertiary">
    <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
        <div class="container py-2">
            <a class="navbar-brand fw-bold text-success" href="index.php"><?= e(APP_NAME) ?></a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNavbar">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="mainNavbar">
                <div class="navbar-nav ms-auto">
                    <a class="nav-link" href="index.php">Dashboard</a>
                    <a class="nav-link active fw-semibold" href="master.php">Master Data</a>
                    <a class="nav-link" href="settings.php">Template</a>
                    <a class="nav-link" href="report.php">Report</a>
                </div>
            </div>
        </div>
    </nav>

    <main class="container py-4">
        <div class="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 mb-3">
            <div>
                <span class="badge text-bg-success-subtle text-success mb-2">ADMINISTRASI</span>
                <h1 class="h3 mb-1">Master Data</h1>
                <p class="text-secondary mb-0">Kelola nomor WhatsApp dokter, jadwal praktik, dan master poli.</p>
            </div>
            <button class="btn btn-success" type="button" data-bs-toggle="modal" data-bs-target="#contactModal">Tambah / Ubah Nomor WhatsApp</button>
        </div>

        <?php if ($notice !== ''): ?>
            <div class="alert alert-<?= e($noticeType) ?> alert-dismissible fade show" role="alert">
                <?= e($notice) ?>
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        <?php endif; ?>

        <div class="row g-3 mb-3">
            <div class="col-md-4"><div class="card shadow-sm border-0 h-100"><div class="card-body py-3"><div class="text-secondary small">TOTAL DOKTER</div><div class="h3 fw-bold mb-0"><?= count($doctors) ?></div></div></div></div>
            <div class="col-md-4"><div class="card shadow-sm border-0 h-100"><div class="card-body py-3"><div class="text-secondary small">TOTAL POLI</div><div class="h3 fw-bold mb-0"><?= count($policies) ?></div></div></div></div>
            <div class="col-md-4"><div class="card shadow-sm border-0 h-100"><div class="card-body py-3"><div class="text-secondary small">JADWAL MENDATANG</div><div class="h3 fw-bold mb-0"><?= count($schedules) ?></div></div></div></div>
        </div>

        <div class="card shadow-sm border-0">
            <div class="card-header bg-white p-0">
                <ul class="nav nav-tabs border-0 px-3 pt-3" id="masterTabs" role="tablist">
                    <li class="nav-item" role="presentation"><button class="nav-link active" id="doctor-tab" data-bs-toggle="tab" data-bs-target="#doctor-pane" type="button" role="tab">Dokter & WhatsApp</button></li>
                    <li class="nav-item" role="presentation"><button class="nav-link" id="schedule-tab" data-bs-toggle="tab" data-bs-target="#schedule-pane" type="button" role="tab">Jadwal Praktik</button></li>
                    <li class="nav-item" role="presentation"><button class="nav-link" id="poli-tab" data-bs-toggle="tab" data-bs-target="#poli-pane" type="button" role="tab">Master Poli</button></li>
                </ul>
            </div>
            <div class="card-body">
                <div class="tab-content" id="masterTabsContent">
                    <div class="tab-pane fade show active" id="doctor-pane" role="tabpanel">
                        <div class="mb-3"><h2 class="h5 mb-1">Dokter & Nomor WhatsApp</h2><p class="text-secondary small mb-0">Nomor ini dipakai oleh sistem reminder.</p></div>
                        <div class="table-responsive">
                            <table id="doctorTable" class="table table-striped table-hover align-middle w-100">
                                <thead><tr><th>Kode</th><th>Nama Dokter</th><th>Nomor WhatsApp</th><th>Status</th><th>Aksi</th></tr></thead>
                                <tbody>
                                    <?php foreach ($doctors as $doctor): ?>
                                        <?php $phone = trim((string) $doctor['no_hp']); $isActive = $phone !== '' && $phone !== '0'; ?>
                                        <tr>
                                            <td><?= e($doctor['dokter_kd']) ?></td>
                                            <td><?= e($doctor['dokter_nama']) ?></td>
                                            <td><?= e($isActive ? $phone : '-') ?></td>
                                            <td><?php if ($isActive): ?><span class="badge text-bg-success">Aktif</span><?php else: ?><span class="badge text-bg-secondary">Belum Ada</span><?php endif; ?></td>
                                            <td>
                                                <div class="d-flex flex-wrap gap-2">
                                                    <button type="button" class="btn btn-sm btn-outline-primary js-edit-contact" data-bs-toggle="modal" data-bs-target="#contactModal" data-doctor-code="<?= e($doctor['dokter_kd']) ?>" data-phone="<?= e($isActive ? $phone : '') ?>">Edit</button>
                                                    <?php if ($isActive): ?>
                                                        <form method="post">
                                                            <input type="hidden" name="action" value="disable_contact">
                                                            <input type="hidden" name="dokter_kd" value="<?= e($doctor['dokter_kd']) ?>">
                                                            <button type="submit" class="btn btn-sm btn-outline-danger" onclick="return confirm('Nonaktifkan nomor WhatsApp dokter ini?')">Nonaktifkan</button>
                                                        </form>
                                                    <?php endif; ?>
                                                </div>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="tab-pane fade" id="schedule-pane" role="tabpanel">
                        <div class="mb-3"><h2 class="h5 mb-1">Jadwal Praktik</h2><p class="text-secondary small mb-0">Data jadwal dokter yang akan datang.</p></div>
                        <div class="row g-2 align-items-end mb-3">
                            <div class="col-md-4">
                                <label class="form-label" for="filterDoctor">Dokter</label>
                                <select id="filterDoctor" class="form-select select2-schedule-filter" data-placeholder="Semua Dokter">
                                    <option value=""></option>
                                    <?php foreach ($doctors as $doctor): ?><option value="<?= e($doctor['dokter_nama']) ?>"><?= e($doctor['dokter_nama']) ?></option><?php endforeach; ?>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label" for="filterPoli">Poli</label>
                                <select id="filterPoli" class="form-select select2-schedule-filter" data-placeholder="Semua Poli">
                                    <option value=""></option>
                                    <?php foreach ($policies as $policy): ?><option value="<?= e($policy['poli_nama']) ?>"><?= e($policy['poli_nama']) ?></option><?php endforeach; ?>
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label" for="filterDate">Jadwal</label>
                                <div class="input-group">
                                    <input type="text" id="filterDate" class="form-control" placeholder="DD-MM-YYYY" autocomplete="off">
                                    <button type="button" id="openScheduleCalendar" class="btn btn-outline-secondary" aria-label="Buka kalender">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                    </button>
                                </div>
                            </div>
                            <div class="col-md-1 d-grid"><button type="button" id="resetScheduleFilter" class="btn btn-outline-secondary">Reset</button></div>
                        </div>
                        <div class="table-responsive">
                            <table id="scheduleTable" class="table table-striped table-hover align-middle w-100">
                                <thead><tr><th>Tanggal</th><th>Hari</th><th>Dokter</th><th>Poli</th><th>Jam</th><th>Kuota</th><th>WhatsApp</th><th>Status</th></tr></thead>
                                <tbody>
                                    <?php foreach ($schedules as $schedule): ?>
                                        <?php $scheduleDate = date('d-m-Y', strtotime($schedule['tanggal'])); ?>
                                        <tr>
                                            <td data-order="<?= e($schedule['tanggal']) ?>"><?= e($scheduleDate) ?></td>
                                            <td><?= e($schedule['hari']) ?></td>
                                            <td><?= e($schedule['dokter_nama']) ?></td>
                                            <td><?= e($schedule['poli_nama']) ?></td>
                                            <td><?= e($schedule['jam_mulai']) ?> - <?= e($schedule['jam_selesai']) ?></td>
                                            <td><?= e((string) $schedule['kuota_all']) ?></td>
                                            <td><?= e($schedule['no_hp'] ?: '-') ?></td>
                                            <td><?php if ((string) $schedule['aktif'] === '1'): ?><span class="badge text-bg-success">Aktif</span><?php else: ?><span class="badge text-bg-secondary">Nonaktif</span><?php endif; ?></td>
                                        </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="tab-pane fade" id="poli-pane" role="tabpanel">
                        <div class="mb-3"><h2 class="h5 mb-1">Master Poli</h2><p class="text-secondary small mb-0">Referensi poli yang tersedia.</p></div>
                        <div class="table-responsive">
                            <table id="poliTable" class="table table-striped table-hover align-middle w-100">
                                <thead><tr><th>Kode Poli</th><th>Nama Poli</th></tr></thead>
                                <tbody><?php foreach ($policies as $policy): ?><tr><td><?= e($policy['poli_kd']) ?></td><td><?= e($policy['poli_nama']) ?></td></tr><?php endforeach; ?></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <div class="modal fade" id="contactModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered"><div class="modal-content"><form method="post">
            <input type="hidden" name="action" value="save_contact">
            <div class="modal-header"><h2 class="modal-title fs-5">Nomor WhatsApp Dokter</h2><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
                <div class="mb-3">
                    <label class="form-label" for="doctorSelect">Dokter</label>
                    <select class="form-select" id="doctorSelect" name="dokter_kd" required>
                        <option value="">Pilih dokter</option>
                        <?php foreach ($doctors as $doctor): ?><option value="<?= e($doctor['dokter_kd']) ?>"><?= e($doctor['dokter_kd']) ?> - <?= e($doctor['dokter_nama']) ?></option><?php endforeach; ?>
                    </select>
                </div>
                <div><label class="form-label" for="phoneInput">Nomor WhatsApp</label><input class="form-control" id="phoneInput" name="no_hp" placeholder="Contoh: 081234567890" required><div class="form-text">Nomor 08xx akan dinormalisasi menjadi 62xx saat dikirim.</div></div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Batal</button><button type="submit" class="btn btn-success">Simpan</button></div>
        </form></div></div>
    </div>

    <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.datatables.net/v/bs5/dt-3.0.2/r-4.0.2/datatables.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
    <script src="https://npmcdn.com/flatpickr/dist/l10n/id.js"></script>
    <script src="assets/back-to-top.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', function () {
            const language = {search: 'Cari:', lengthMenu: 'Tampilkan _MENU_ data', info: 'Menampilkan _START_ sampai _END_ dari _TOTAL_ data', infoEmpty: 'Tidak ada data', zeroRecords: 'Data tidak ditemukan', emptyTable: 'Belum ada data', paginate: {first: 'Awal', last: 'Akhir', next: 'Berikutnya', previous: 'Sebelumnya'}};
            const doctorTable = new DataTable('#doctorTable', {responsive: true, pageLength: 10, lengthMenu: [10, 25, 50, 100], order: [[1, 'asc']], language});
            const scheduleTable = new DataTable('#scheduleTable', {responsive: true, pageLength: 10, lengthMenu: [10, 25, 50, 100], order: [[0, 'asc'], [4, 'asc']], language});
            const poliTable = new DataTable('#poliTable', {responsive: true, pageLength: 10, lengthMenu: [10, 25, 50, 100], order: [[1, 'asc']], language});
            $('.select2-schedule-filter').each(function () { const select = $(this); select.select2({theme: 'bootstrap-5', width: '100%', placeholder: select.data('placeholder'), allowClear: true, language: {noResults: function () { return 'Data tidak ditemukan'; }}}); });
            document.querySelectorAll('[data-bs-toggle="tab"]').forEach(function (tabButton) { tabButton.addEventListener('shown.bs.tab', function () { doctorTable.columns.adjust(); scheduleTable.columns.adjust(); poliTable.columns.adjust(); }); });
            const filterDoctor = document.getElementById('filterDoctor');
            const filterPoli = document.getElementById('filterPoli');
            const filterDate = document.getElementById('filterDate');
            const resetScheduleFilter = document.getElementById('resetScheduleFilter');
            const openScheduleCalendar = document.getElementById('openScheduleCalendar');
            function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
            function applyScheduleFilters() {
                const doctor = filterDoctor.value;
                const poli = filterPoli.value;
                const date = filterDate.value.trim();
                scheduleTable.column(2).search(doctor ? '^' + escapeRegex(doctor) + '$' : '', true, false);
                scheduleTable.column(3).search(poli ? '^' + escapeRegex(poli) + '$' : '', true, false);
                scheduleTable.column(0).search(date ? '^' + escapeRegex(date) + '$' : '', true, false);
                scheduleTable.draw();
            }
            const scheduleDatePicker = flatpickr(filterDate, {locale: 'id', dateFormat: 'd-m-Y', allowInput: true, clickOpens: true, onChange: applyScheduleFilters, onClose: applyScheduleFilters});
            openScheduleCalendar.addEventListener('click', function () { scheduleDatePicker.open(); });
            filterDoctor.addEventListener('change', applyScheduleFilters);
            filterPoli.addEventListener('change', applyScheduleFilters);
            filterDate.addEventListener('input', applyScheduleFilters);
            resetScheduleFilter.addEventListener('click', function () { $('#filterDoctor').val(null).trigger('change.select2'); $('#filterPoli').val(null).trigger('change.select2'); scheduleDatePicker.clear(); scheduleTable.columns().search(''); scheduleTable.search(''); scheduleTable.draw(); });
            const doctorSelect = document.getElementById('doctorSelect');
            const phoneInput = document.getElementById('phoneInput');
            const contactModal = document.getElementById('contactModal');
            contactModal.addEventListener('show.bs.modal', function (event) { const button = event.relatedTarget; if (!button || !button.classList.contains('js-edit-contact')) { doctorSelect.value = ''; phoneInput.value = ''; return; } doctorSelect.value = button.dataset.doctorCode || ''; phoneInput.value = button.dataset.phone || ''; });
        });
    </script>
</body>
</html>
