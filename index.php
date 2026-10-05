<?php

declare(strict_types=1);

ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/functions.php';

$rawDate = trim($_GET['jadwal'] ?? $_GET['tanggal'] ?? date('d-m-Y'));
$doctorFilter = trim($_GET['dokter'] ?? '');
$poliFilter = trim($_GET['poli'] ?? '');

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

ensureReminders($date);

$pdo = db();
$pdoRsi = get_db('rsi_byl');

$doctorOptions = $pdoRsi->query("
    SELECT
        dokter_kd,
        dokter_nama
    FROM master_dokter
    ORDER BY dokter_nama ASC
")->fetchAll();

$poliOptions = $pdoRsi->query("
    SELECT
        poli_kd,
        poli_nama
    FROM master_poli
    ORDER BY poli_nama ASC
")->fetchAll();

$filterQuery = http_build_query([
    'jadwal' => $displayDate,
    'dokter' => $doctorFilter,
    'poli' => $poliFilter
]);

if (isset($_GET['action'], $_GET['id'])) {
    $id = (int) $_GET['id'];
    $action = $_GET['action'];

    if (in_array($action, ['opened', 'sent', 'failed'], true)) {
        $status = strtoupper($action);

        if ($action === 'opened') {
            $sql = "
                UPDATE reminders
                SET
                    status = ?,
                    opened_at = ?
                WHERE id = ?
            ";

            $params = [
                $status,
                date('Y-m-d H:i:s'),
                $id
            ];
        } elseif ($action === 'sent') {
            $sql = "
                UPDATE reminders
                SET
                    status = ?,
                    sent_at = ?
                WHERE id = ?
            ";

            $params = [
                $status,
                date('Y-m-d H:i:s'),
                $id
            ];
        } else {
            $sql = "
                UPDATE reminders
                SET status = ?
                WHERE id = ?
            ";

            $params = [
                $status,
                $id
            ];
        }

        $pdo->prepare($sql)->execute($params);
        logAction($id, $status);
    }

    header('Location: index.php?' . $filterQuery);
    exit;
}

$rows = schedulesFor($date);

$rows = array_values(
    array_filter(
        $rows,
        function (array $row) use ($doctorFilter, $poliFilter): bool {
            if ($doctorFilter !== '' && ($row['kode_dokter'] ?? '') !== $doctorFilter) {
                return false;
            }

            if ($poliFilter !== '' && ($row['nama_poli'] ?? '') !== $poliFilter) {
                return false;
            }

            return true;
        }
    )
);

$byDoctor = [];

foreach ($rows as $row) {
    $doctorId = $row['doctor_id'];

    if (!isset($byDoctor[$doctorId])) {
        $byDoctor[$doctorId] = [
            'schedules' => [],
            'reminder' => null
        ];
    }

    $byDoctor[$doctorId]['schedules'][] = $row;
}

$reminderStmt = $pdo->prepare("
    SELECT *
    FROM reminders
    WHERE doctor_id = ?
        AND tanggal = ?
        AND reminder_type = ?
    LIMIT 1
");

foreach ($byDoctor as $doctorId => &$doctorGroup) {
    $reminderStmt->execute([
        $doctorId,
        $date,
        'HARI_INI'
    ]);

    $doctorGroup['reminder'] = $reminderStmt->fetch() ?: null;
}

unset($doctorGroup);

$totalDoctors = count($byDoctor);
$totalSchedules = count($rows);

$counts = [
    'SENT' => 0,
    'FAILED' => 0,
    'READY' => 0,
    'OPENED' => 0
];

foreach ($byDoctor as $group) {
    $status = $group['reminder']['status'] ?? 'READY';

    if (!isset($counts[$status])) {
        $counts[$status] = 0;
    }

    $counts[$status]++;
}

$nextSql = "
    SELECT
        dj.*,
        mp.poli_nama AS lokasi,
        md.dokter_nama,
        mp.poli_nama,
        djk.tanggal
    FROM dokter_jadwal dj
    JOIN master_dokter md
        ON md.dokter_kd = dj.dokter_kd
    JOIN dokter_jadwal_kuota djk
        ON djk.dokter_jadwal_id = dj.id
    LEFT JOIN master_poli mp
        ON mp.poli_kd = dj.poli_kd
    WHERE djk.tanggal > ?
        AND djk.aktif = '1'
";

$nextParams = [$date];

if ($doctorFilter !== '') {
    $nextSql .= " AND dj.dokter_kd = ?\n";
    $nextParams[] = $doctorFilter;
}

if ($poliFilter !== '') {
    $nextSql .= " AND mp.poli_nama = ?\n";
    $nextParams[] = $poliFilter;
}

$nextSql .= "
    ORDER BY
        djk.tanggal ASC,
        dj.jam_mulai ASC
    LIMIT 1
";

$nextStmt = $pdoRsi->prepare($nextSql);
$nextStmt->execute($nextParams);
$next = $nextStmt->fetch() ?: null;
$encodedFilterQuery = htmlspecialchars($filterQuery, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e(APP_NAME) ?></title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
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
                    <a class="nav-link active fw-semibold" href="index.php">Dashboard</a>
                    <a class="nav-link" href="master.php">Master Data</a>
                    <a class="nav-link" href="settings.php">Template</a>
                    <a class="nav-link" href="report.php">Report</a>
                </div>
            </div>
        </div>
    </nav>

    <main class="container py-4 py-lg-5">
        <div class="row g-3 align-items-end mb-4">
            <div class="col-12 col-xl-4">
                <span class="badge text-bg-success-subtle text-success mb-2">DAILY OPERATIONS</span>
                <h1 class="h3 mb-1">Reminder Jadwal Dokter</h1>
                <p class="text-secondary mb-0"><?= e(indoDate($date)) ?></p>
            </div>

            <div class="col-12 col-xl-8">
                <form method="get" class="row g-2 justify-content-xl-end">
                    <div class="col-12 col-md-4 col-xl-3">
                        <label class="form-label small text-secondary mb-1" for="doctorFilter">Dokter</label>
                        <select class="form-select select2-filter" id="doctorFilter" name="dokter" data-placeholder="Semua Dokter">
                            <option value=""></option>
                            <?php foreach ($doctorOptions as $doctorOption): ?>
                                <option value="<?= e($doctorOption['dokter_kd']) ?>" <?= $doctorFilter === $doctorOption['dokter_kd'] ? 'selected' : '' ?>><?= e($doctorOption['dokter_nama']) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>

                    <div class="col-12 col-md-4 col-xl-3">
                        <label class="form-label small text-secondary mb-1" for="poliFilter">Poli</label>
                        <select class="form-select select2-filter" id="poliFilter" name="poli" data-placeholder="Semua Poli">
                            <option value=""></option>
                            <?php foreach ($poliOptions as $poliOption): ?>
                                <option value="<?= e($poliOption['poli_nama']) ?>" <?= $poliFilter === $poliOption['poli_nama'] ? 'selected' : '' ?>><?= e($poliOption['poli_nama']) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>

                    <div class="col-12 col-md-4 col-xl-3">
                        <label class="form-label small text-secondary mb-1" for="scheduleDate">Jadwal</label>
                        <div class="input-group">
                            <input class="form-control" id="scheduleDate" type="text" name="jadwal" value="<?= e($displayDate) ?>" placeholder="DD-MM-YYYY" autocomplete="off">
                            <button class="btn btn-outline-secondary" id="scheduleDateButton" type="button" aria-label="Pilih tanggal">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            </button>
                        </div>
                    </div>

                    <div class="col-12 col-xl-auto d-flex gap-2 align-items-end">
                        <button class="btn btn-success" type="submit">Tampilkan</button>
                        <a class="btn btn-outline-secondary" href="index.php">Reset</a>
                    </div>
                </form>
            </div>
        </div>

        <div class="card shadow-sm border-0 mb-4">
            <div class="card-body d-flex flex-column flex-md-row align-items-md-center gap-3">
                <span id="gatewayDot" class="gateway-dot"></span>
                <div class="flex-grow-1">
                    <div class="fw-semibold" id="gatewayStatus">Memeriksa WhatsApp Gateway...</div>
                    <div class="text-secondary small">Gateway digunakan untuk mengirim pesan langsung tanpa membuka WhatsApp Web.</div>
                </div>
                <a id="gatewayLink" class="btn btn-outline-success btn-sm" href="#" target="_blank">Buka QR / Status</a>
            </div>
        </div>

        <div class="row g-3 mb-4">
            <div class="col-6 col-lg"><div class="card shadow-sm border-0 h-100"><div class="card-body"><div class="text-secondary small">DOKTER PRAKTIK</div><div class="display-6 fw-bold"><?= $totalDoctors ?></div></div></div></div>
            <div class="col-6 col-lg"><div class="card shadow-sm border-0 h-100"><div class="card-body"><div class="text-secondary small">JADWAL PRAKTIK</div><div class="display-6 fw-bold"><?= $totalSchedules ?></div></div></div></div>
            <div class="col-6 col-lg"><div class="card shadow-sm border-0 h-100"><div class="card-body"><div class="text-secondary small">SUDAH DIKIRIM</div><div class="display-6 fw-bold text-success"><?= $counts['SENT'] ?></div></div></div></div>
            <div class="col-6 col-lg"><div class="card shadow-sm border-0 h-100"><div class="card-body"><div class="text-secondary small">BELUM DIKIRIM</div><div class="display-6 fw-bold text-warning"><?= ($counts['READY'] ?? 0) + ($counts['OPENED'] ?? 0) ?></div></div></div></div>
            <div class="col-6 col-lg"><div class="card shadow-sm border-0 h-100"><div class="card-body"><div class="text-secondary small">GAGAL</div><div class="display-6 fw-bold text-danger"><?= $counts['FAILED'] ?></div></div></div></div>
        </div>

        <?php if ($next): ?>
            <div class="alert alert-success-subtle border-success-subtle mb-4">
                Jadwal berikutnya: <strong><?= e($next['dokter_nama']) ?></strong> · <?= e($next['poli_nama']) ?> · <?= e(indoDate($next['tanggal'])) ?> <?= e($next['jam_mulai']) ?>
            </div>
        <?php endif; ?>

        <div class="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 mb-3">
            <div>
                <h2 class="h5 mb-1">Jadwal Dokter</h2>
                <p class="text-secondary small mb-0"><?= $totalDoctors ?> dokter · <?= $totalSchedules ?> sesi</p>
            </div>

            <div class="d-flex flex-wrap align-items-center gap-3">
                <div class="form-check mb-0">
                    <input
                        class="form-check-input"
                        type="checkbox"
                        id="selectAllDoctors"
                        checked
                    >
                    <label class="form-check-label fw-semibold" for="selectAllDoctors">
                        Pilih Semua Dokter
                    </label>
                </div>

                <span class="text-secondary small" id="selectedDoctorsSummary">
                    <?= $totalDoctors ?> dokter dipilih
                </span>

                <button
                    type="button"
                    class="btn btn-success btn-sm"
                    id="sendSelectedDoctors"
                    <?= $totalDoctors > 0 ? '' : 'disabled' ?>
                >
                    Kirim WhatsApp Terpilih
                </button>
            </div>
        </div>

        <div class="row g-3">
            <?php if (empty($byDoctor)): ?>
                <div class="col-12"><div class="alert alert-light border text-center py-4">Tidak ada jadwal yang sesuai dengan filter.</div></div>
            <?php endif; ?>

            <?php foreach ($byDoctor as $group): ?>
                <?php
                $schedules = $group['schedules'];
                $reminder = $group['reminder'];

                if (empty($schedules)) {
                    continue;
                }

                $doctor = $schedules[0];
                $status = $reminder['status'] ?? 'READY';
                $phoneRaw = $doctor['no_whatsapp'] ?? '';
                $phone = normalizePhone($phoneRaw);
                $message = $reminder['message'] ?? '';

                $statusClass = match ($status) {
                    'SENT' => 'text-bg-success',
                    'FAILED' => 'text-bg-danger',
                    'OPENED' => 'text-bg-primary',
                    default => 'text-bg-secondary'
                };
                ?>

                <?php
                $hasBulkSendData = $reminder && $phone !== '' && $message !== '';
                ?>
                <div class="col-12 col-lg-6">
                    <div class="card shadow-sm border-0 h-100">
                        <div class="card-body d-flex flex-column">
                            <div class="d-flex justify-content-between gap-3 mb-3">
                                <div class="d-flex gap-3 align-items-start">
                                    <div class="form-check pt-1">
                                        <input
                                            class="form-check-input js-doctor-select"
                                            type="checkbox"
                                            value="<?= e((string) ($doctor['doctor_id'] ?? '')) ?>"
                                            data-phone="<?= e($phone) ?>"
                                            data-message="<?= e($message) ?>"
                                            data-reminder-id="<?= (int) ($reminder['id'] ?? 0) ?>"
                                            data-doctor-name="<?= e($doctor['nama_dokter']) ?>"
                                            <?= $hasBulkSendData ? 'checked' : 'disabled' ?>
                                            aria-label="Pilih <?= e($doctor['nama_dokter']) ?>"
                                        >
                                    </div>
                                    <div>
                                        <h3 class="h5 mb-1"><?= e($doctor['nama_dokter']) ?></h3>
                                        <div class="text-secondary small"><?= e($phoneRaw ?: '-') ?></div>
                                    </div>
                                </div>
                                <span class="badge <?= e($statusClass) ?> align-self-start"><?= e($status) ?></span>
                            </div>

                            <div class="list-group list-group-flush mb-3">
                                <?php foreach ($schedules as $schedule): ?>
                                    <div class="list-group-item px-0">
                                        <div class="d-flex justify-content-between gap-3">
                                            <div>
                                                <div class="fw-semibold"><?= e($schedule['nama_poli']) ?></div>
                                                <div class="text-secondary small"><?= e($schedule['lokasi']) ?></div>
                                            </div>
                                            <div class="fw-semibold text-nowrap"><?= e($schedule['jam_mulai']) ?> - <?= e($schedule['jam_selesai']) ?></div>
                                        </div>
                                    </div>
                                <?php endforeach; ?>
                            </div>

                            <?php if ($reminder): ?>
                                <div class="d-flex flex-wrap gap-2 mt-auto">
                                    <a class="btn btn-outline-secondary btn-sm" target="_blank" href="preview.php?id=<?= (int) $reminder['id'] ?>">Preview</a>
                                    <?php if ($phone !== '' && $message !== ''): ?>
                                        <button type="button" class="btn btn-success btn-sm js-whatsapp" data-phone="<?= e($phone) ?>" data-message="<?= e($message) ?>" data-reminder-id="<?= (int) $reminder['id'] ?>" data-doctor-name="<?= e($doctor['nama_dokter']) ?>"><?= $status === 'SENT' ? 'Kirim Ulang WhatsApp' : 'Kirim WhatsApp' ?></button>
                                    <?php else: ?>
                                        <span class="text-danger small align-self-center">Nomor WhatsApp tidak tersedia</span>
                                    <?php endif; ?>
                                </div>
                            <?php endif; ?>
                        </div>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>
    </main>

    <footer class="border-top bg-white py-4 text-center text-secondary small">
        <?= e(APP_NAME) ?> · PHP Native + MySQL + whatsapp-web.js
    </footer>

    <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
    <script src="https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/id.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="assets/back-to-top.js"></script>

    <script>
        const gatewayBaseUrl = 'http://' + window.location.hostname + ':3210';
        const gatewayLink = document.getElementById('gatewayLink');
        const gatewayStatus = document.getElementById('gatewayStatus');
        const gatewayDot = document.getElementById('gatewayDot');
        const scheduleDate = document.getElementById('scheduleDate');
        const scheduleDateButton = document.getElementById('scheduleDateButton');

        gatewayLink.href = gatewayBaseUrl + '/';

        const scheduleDatePicker = flatpickr(scheduleDate, {
            dateFormat: 'd-m-Y',
            defaultDate: scheduleDate.value,
            allowInput: true,
            locale: 'id',
            disableMobile: true
        });

        scheduleDateButton.addEventListener('click', function () {
            scheduleDatePicker.open();
        });

        async function refreshGatewayStatus() {
            try {
                const response = await fetch(gatewayBaseUrl + '/status', { cache: 'no-store' });
                const data = await response.json();

                if (data.ready) {
                    gatewayStatus.textContent = 'WhatsApp Gateway READY';
                    gatewayDot.className = 'gateway-dot ready';
                    return;
                }

                if (data.hasQr) {
                    gatewayStatus.textContent = 'QR tersedia - scan WhatsApp terlebih dahulu';
                    gatewayDot.className = 'gateway-dot';
                    return;
                }

                gatewayStatus.textContent = 'WhatsApp Gateway: ' + (data.state || 'belum siap');
                gatewayDot.className = 'gateway-dot';
            } catch (error) {
                gatewayStatus.textContent = 'WhatsApp Gateway tidak aktif. Jalankan: npm start';
                gatewayDot.className = 'gateway-dot error';
            }
        }

        document.addEventListener('DOMContentLoaded', function () {
            $('.select2-filter').each(function () {
                const select = $(this);

                select.select2({
                    theme: 'bootstrap-5',
                    width: '100%',
                    placeholder: select.data('placeholder'),
                    allowClear: true,
                    language: {
                        noResults: function () {
                            return 'Data tidak ditemukan';
                        }
                    }
                });
            });

            refreshGatewayStatus();
            setInterval(refreshGatewayStatus, 5000);

            const selectAllDoctors = document.getElementById('selectAllDoctors');
            const selectedDoctorsSummary = document.getElementById('selectedDoctorsSummary');
            const sendSelectedDoctors = document.getElementById('sendSelectedDoctors');

            function doctorCheckboxes() {
                return Array.from(document.querySelectorAll('.js-doctor-select'));
            }

            function updateDoctorSelectionState() {
                const checkboxes = doctorCheckboxes();
                const enabledCheckboxes = checkboxes.filter(function (checkbox) {
                    return !checkbox.disabled;
                });
                const checkedCheckboxes = enabledCheckboxes.filter(function (checkbox) {
                    return checkbox.checked;
                });

                if (enabledCheckboxes.length === 0) {
                    selectAllDoctors.checked = false;
                    selectAllDoctors.indeterminate = false;
                    selectedDoctorsSummary.textContent = '0 dokter dipilih';
                    sendSelectedDoctors.disabled = true;
                    return;
                }

                selectAllDoctors.checked = checkedCheckboxes.length === enabledCheckboxes.length;
                selectAllDoctors.indeterminate =
                    checkedCheckboxes.length > 0 &&
                    checkedCheckboxes.length < enabledCheckboxes.length;

                selectedDoctorsSummary.textContent =
                    checkedCheckboxes.length + ' dokter dipilih';

                sendSelectedDoctors.disabled = checkedCheckboxes.length === 0;
            }

            selectAllDoctors.addEventListener('change', function () {
                doctorCheckboxes().forEach(function (checkbox) {
                    if (!checkbox.disabled) {
                        checkbox.checked = selectAllDoctors.checked;
                    }
                });

                updateDoctorSelectionState();
            });

            doctorCheckboxes().forEach(function (checkbox) {
                checkbox.addEventListener('change', updateDoctorSelectionState);
            });

            async function updateReminderStatus(reminderId, action) {
                if (!reminderId) {
                    return;
                }

                const response = await fetch(
                    'index.php?<?= $encodedFilterQuery ?>' +
                    '&action=' + encodeURIComponent(action) +
                    '&id=' + encodeURIComponent(reminderId),
                    {
                        method: 'GET',
                        cache: 'no-store',
                        redirect: 'follow'
                    }
                );

                if (!response.ok) {
                    throw new Error('Status reminder gagal diperbarui.');
                }
            }

            sendSelectedDoctors.addEventListener('click', async function () {
                const selected = doctorCheckboxes().filter(function (checkbox) {
                    return !checkbox.disabled && checkbox.checked;
                }).map(function (checkbox) {
                    return {
                        phone: checkbox.dataset.phone || '',
                        message: checkbox.dataset.message || '',
                        reminderId: checkbox.dataset.reminderId || '',
                        doctorName: checkbox.dataset.doctorName || 'dokter'
                    };
                });

                if (!selected.length) {
                    await Swal.fire({
                        icon: 'warning',
                        title: 'Belum ada dokter dipilih',
                        text: 'Centang minimal satu dokter terlebih dahulu.',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#198754'
                    });
                    return;
                }

                try {
                    const gatewayStatusResponse = await fetch(
                        gatewayBaseUrl + '/status',
                        { cache: 'no-store' }
                    );
                    const gatewayStatus = await gatewayStatusResponse.json();

                    if (!gatewayStatusResponse.ok || !gatewayStatus.ready) {
                        await Swal.fire({
                            icon: 'warning',
                            title: 'WhatsApp Belum Terhubung',
                            text:
                                gatewayStatus.error ||
                                'WhatsApp Gateway belum READY. Tunggu sampai status WhatsApp Terhubung lalu coba lagi.',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#198754'
                        });
                        return;
                    }
                } catch (statusError) {
                    await Swal.fire({
                        icon: 'error',
                        title: 'Gateway Tidak Dapat Dihubungi',
                        text: 'WhatsApp Gateway tidak dapat dihubungi. Pastikan server.js sedang berjalan.',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#dc3545'
                    });
                    return;
                }

                const previewNames = selected
                    .slice(0, 10)
                    .map(function (item) {
                        return '• ' + item.doctorName;
                    })
                    .join('<br>');

                const moreText = selected.length > 10
                    ? '<br>dan ' + (selected.length - 10) + ' dokter lainnya.'
                    : '';

                const confirmation = await Swal.fire({
                    icon: 'question',
                    title: 'Kirim WhatsApp Terpilih?',
                    html:
                        'Sebanyak <strong>' + selected.length + ' dokter</strong> akan dikirimi reminder.' +
                        '<div class="text-start mt-3">' + previewNames + moreText + '</div>',
                    showCancelButton: true,
                    confirmButtonText: 'Ya, Kirim Semua',
                    cancelButtonText: 'Tidak',
                    confirmButtonColor: '#198754',
                    cancelButtonColor: '#6c757d',
                    reverseButtons: true,
                    focusCancel: true
                });

                if (!confirmation.isConfirmed) {
                    return;
                }

                this.disabled = true;
                selectAllDoctors.disabled = true;
                doctorCheckboxes().forEach(function (checkbox) {
                    checkbox.disabled = true;
                });

                let successCount = 0;
                let failedItems = [];
                let gatewayInterrupted = false;
                let gatewayInterruptedMessage = '';

                Swal.fire({
                    title: 'Mengirim WhatsApp',
                    html: 'Mengirim <strong>0</strong> dari <strong>' + selected.length + '</strong> dokter...',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: function () {
                        Swal.showLoading();
                    }
                });

                for (let index = 0; index < selected.length; index++) {
                    const item = selected[index];

                    Swal.update({
                        html:
                            'Mengirim <strong>' + (index + 1) + '</strong> dari <strong>' +
                            selected.length + '</strong> dokter...<br><small>' +
                            item.doctorName + '</small>'
                    });

                    try {
                        const response = await fetch(gatewayBaseUrl + '/send', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                phone: item.phone,
                                message: item.message
                            })
                        });

                        const result = await response.json();

                        if (response.status === 503) {
                            gatewayInterrupted = true;
                            gatewayInterruptedMessage =
                                result.message ||
                                'WhatsApp Gateway terputus saat proses pengiriman.';
                            break;
                        }

                        if (!response.ok || !result.success) {
                            throw new Error(
                                result.message || 'Gagal mengirim WhatsApp.'
                            );
                        }

                        await updateReminderStatus(item.reminderId, 'sent');
                        successCount++;
                    } catch (error) {
                        failedItems.push({
                            name: item.doctorName,
                            reason: error.message || 'Gagal mengirim WhatsApp.'
                        });

                        try {
                            await updateReminderStatus(item.reminderId, 'failed');
                        } catch (statusError) {
                            console.error(statusError);
                        }
                    }
                }

                const failedText = failedItems.length
                    ? '<div class="text-start mt-3"><strong>Gagal:</strong><br>' +
                        failedItems.map(function (item) {
                            return '• ' + item.name + ' — ' + item.reason;
                        }).join('<br>') +
                        '</div>'
                    : '';

                await Swal.fire({
                    icon: gatewayInterrupted
                        ? 'warning'
                        : (failedItems.length === 0 ? 'success' : 'warning'),
                    title: gatewayInterrupted
                        ? 'Gateway Terputus'
                        : (failedItems.length === 0 ? 'Semua Berhasil' : 'Pengiriman Selesai'),
                    html:
                        '<strong>' + successCount + '</strong> dokter berhasil dikirimi reminder.' +
                        (failedItems.length
                            ? '<br><strong>' + failedItems.length + '</strong> dokter gagal.' + failedText
                            : '') +
                        (gatewayInterrupted
                            ? '<br><br><strong>' + gatewayInterruptedMessage + '</strong>' +
                              '<br>Dokter yang belum diproses tetap dapat dikirim ulang setelah gateway READY.'
                            : ''),
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#198754'
                });

                window.location.reload();
            });

            document.querySelectorAll('.js-whatsapp').forEach(function (button) {
                button.addEventListener('click', async function () {
                    const phone = this.dataset.phone;
                    const message = this.dataset.message;
                    const reminderId = this.dataset.reminderId;
                    const doctorName = this.dataset.doctorName || 'dokter';
                    const originalText = this.textContent;

                    if (!phone || !message || !reminderId) {
                        await Swal.fire({
                            icon: 'warning',
                            title: 'Data belum lengkap',
                            text: 'Data WhatsApp belum lengkap.',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#198754'
                        });
                        return;
                    }

                    const confirmation = await Swal.fire({
                        icon: 'question',
                        title: 'Kirim WhatsApp?',
                        html: 'Apakah reminder benar akan dikirim ke <strong>' + doctorName + '</strong><br>Nomor: <strong>' + phone + '</strong>?',
                        showCancelButton: true,
                        confirmButtonText: 'Ya, Kirim',
                        cancelButtonText: 'Tidak',
                        confirmButtonColor: '#198754',
                        cancelButtonColor: '#6c757d',
                        reverseButtons: true,
                        focusCancel: true
                    });

                    if (!confirmation.isConfirmed) {
                        return;
                    }

                    this.disabled = true;
                    this.textContent = 'Mengirim...';

                    Swal.fire({
                        title: 'Mengirim WhatsApp',
                        text: 'Mohon tunggu...',
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                        didOpen: function () {
                            Swal.showLoading();
                        }
                    });

                    try {
                        const response = await fetch(gatewayBaseUrl + '/send', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ phone, message })
                        });

                        const result = await response.json();

                        if (response.status === 503) {
                            await Swal.fire({
                                icon: 'warning',
                                title: 'WhatsApp Belum Terhubung',
                                text: result.message || 'WhatsApp Gateway belum READY. Tunggu sampai terhubung lalu kirim ulang.',
                                confirmButtonText: 'OK',
                                confirmButtonColor: '#198754'
                            });
                            return;
                        }

                        if (!response.ok || !result.success) {
                            throw new Error(result.message || 'Gagal mengirim WhatsApp.');
                        }

                        await Swal.fire({
                            icon: 'success',
                            title: 'Berhasil',
                            text: 'WhatsApp berhasil dikirim ke ' + phone + '.',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#198754'
                        });

                        window.location.href = 'index.php?<?= $encodedFilterQuery ?>' + '&action=sent&id=' + encodeURIComponent(reminderId);
                    } catch (error) {
                        await Swal.fire({
                            icon: 'error',
                            title: 'Gagal Mengirim',
                            text: error.message || 'Gagal menghubungi WhatsApp Gateway.',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#dc3545'
                        });

                        window.location.href = 'index.php?<?= $encodedFilterQuery ?>' + '&action=failed&id=' + encodeURIComponent(reminderId);
                    } finally {
                        this.disabled = false;
                        this.textContent = originalText;
                    }
                });
            });

            updateDoctorSelectionState();
        });
    </script>
</body>
</html>
