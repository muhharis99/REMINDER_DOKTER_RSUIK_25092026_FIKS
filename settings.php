<?php

declare(strict_types=1);

require_once __DIR__ . '/functions.php';

$pdo = db();
$saved = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    foreach (['nama_rs', 'template'] as $key) {
        $statement = $pdo->prepare("
            INSERT INTO settings (
                `key`,
                `value`
            ) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
                `value` = VALUES(`value`)
        ");

        $statement->execute([
            $key,
            $_POST[$key] ?? ''
        ]);
    }

    $saved = true;
}
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Template Pesan</title>

    <link
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css"
        rel="stylesheet"
    >

    <link rel="stylesheet" href="assets/style.css">
</head>
<body class="bg-body-tertiary">
    <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
        <div class="container py-2">
            <a class="navbar-brand fw-bold text-success" href="index.php">
                <?= e(APP_NAME) ?>
            </a>

            <button
                class="navbar-toggler"
                type="button"
                data-bs-toggle="collapse"
                data-bs-target="#mainNavbar"
            >
                <span class="navbar-toggler-icon"></span>
            </button>

            <div class="collapse navbar-collapse" id="mainNavbar">
                <div class="navbar-nav ms-auto">
                    <a class="nav-link" href="index.php">Dashboard</a>
                    <a class="nav-link" href="master.php">Master Data</a>
                    <a class="nav-link active fw-semibold" href="settings.php">Template</a>
                    <a class="nav-link" href="report.php">Report</a>
                </div>
            </div>
        </div>
    </nav>

    <main class="container py-4 py-lg-5 page-narrow">
        <div class="mb-4">
            <span class="badge text-bg-success-subtle text-success mb-2">KONFIGURASI</span>
            <h1 class="h3 mb-1">Template WhatsApp</h1>
            <p class="text-secondary mb-0">
                Pesan ini dipakai saat sistem membuat dan memperbarui reminder.
            </p>
        </div>

        <?php if ($saved): ?>
            <div class="alert alert-success alert-dismissible fade show" role="alert">
                Pengaturan berhasil disimpan.
                <button
                    type="button"
                    class="btn-close"
                    data-bs-dismiss="alert"
                ></button>
            </div>
        <?php endif; ?>

        <div class="card shadow-sm border-0">
            <div class="card-body p-4">
                <form method="post">
                    <div class="mb-4">
                        <label class="form-label fw-semibold" for="hospitalName">
                            Nama rumah sakit
                        </label>
                        <input
                            class="form-control"
                            id="hospitalName"
                            name="nama_rs"
                            value="<?= e(setting('nama_rs', 'RS Sehat Sentosa')) ?>"
                            required
                        >
                    </div>

                    <div class="mb-3">
                        <label class="form-label fw-semibold" for="messageTemplate">
                            Template pesan
                        </label>
                        <textarea
                            class="form-control font-monospace"
                            id="messageTemplate"
                            name="template"
                            rows="18"
                            required
                        ><?= e(setting('template', DEFAULT_TEMPLATE)) ?></textarea>
                    </div>

                    <div class="alert alert-light border small">
                        <div class="fw-semibold mb-2">Variabel yang dapat digunakan</div>
                        <div class="d-flex flex-wrap gap-2">
                            <code>{{nama_dokter}}</code>
                            <code>{{spesialis}}</code>
                            <code>{{tanggal}}</code>
                            <code>{{hari}}</code>
                            <code>{{nama_poli}}</code>
                            <code>{{jam_mulai}}</code>
                            <code>{{jam_selesai}}</code>
                            <code>{{lokasi}}</code>
                            <code>{{nama_rs}}</code>
                            <code>{{inden}}</code>
                        </div>
                    </div>

                    <div class="d-flex justify-content-end gap-2">
                        <a class="btn btn-light" href="index.php">
                            Kembali
                        </a>
                        <button class="btn btn-success" type="submit">
                            Simpan Template
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"></script>
    <script src="assets/back-to-top.js"></script>
</body>
</html>
