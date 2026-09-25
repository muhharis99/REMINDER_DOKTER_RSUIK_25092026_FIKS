<?php

declare(strict_types=1);

require_once __DIR__ . '/functions.php';
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Chat Dokter</title>

    <link
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css"
        rel="stylesheet"
    >
    <link rel="stylesheet" href="assets/style.css">
    <link rel="stylesheet" href="assets/chat-dokter.css">
</head>
<body class="bg-body-tertiary page-chat-dokter">
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
                    <a class="nav-link" href="settings.php">Template</a>
                    <a class="nav-link" href="report.php">Report</a>
                </div>
            </div>
        </div>
    </nav>

    <main class="container-fluid px-3 px-lg-4 py-3 chat-page" id="doctorChatApp">
        <div class="d-flex justify-content-between align-items-center gap-3 mb-3 chat-page-heading">
            <div>
                <span class="badge text-bg-success-subtle text-success mb-2">WHATSAPP</span>
                <h1 class="h3 mb-1">Chat Dokter</h1>
                <p class="text-secondary mb-0">Percakapan dua arah dokter melalui gateway WhatsApp existing.</p>
            </div>
            <div class="text-end">
                <div class="small text-secondary">Status Gateway</div>
                <span class="badge text-bg-secondary" id="gatewayStatus">Memeriksa...</span>
            </div>
        </div>

        <div class="card border-0 shadow-sm chat-shell">
            <div class="row g-0 h-100">
                <aside class="col-12 col-lg-4 col-xl-3 chat-sidebar border-end">
                    <div class="p-3 border-bottom bg-white chat-search-box">
                        <label class="form-label fw-semibold" for="doctorSearch">Cari dokter</label>
                        <input
                            type="search"
                            class="form-control"
                            id="doctorSearch"
                            placeholder="Nama, kode, atau nomor WhatsApp"
                            autocomplete="off"
                        >
                    </div>

                    <div class="chat-contact-list" id="conversationList">
                        <div class="p-4 text-center text-secondary small">Memuat daftar dokter...</div>
                    </div>
                </aside>

                <section class="col-12 col-lg-8 col-xl-9 chat-main">
                    <div class="chat-empty h-100" id="chatEmptyState">
                        <div class="text-center text-secondary">
                            <h2 class="h5 mb-2">Pilih dokter untuk melihat percakapan.</h2>
                            <div>Pilih salah satu dokter dari daftar di sebelah kiri.</div>
                        </div>
                    </div>

                    <div class="chat-active h-100 d-none" id="chatActiveState">
                        <header class="chat-header border-bottom bg-white p-3">
                            <div class="d-flex justify-content-between align-items-center gap-3">
                                <div>
                                    <h2 class="h5 mb-1" id="chatDoctorName">-</h2>
                                    <div class="small text-secondary">
                                        <span id="chatDoctorCode">-</span>
                                        <span class="mx-1">•</span>
                                        <span id="chatDoctorPhone">-</span>
                                    </div>
                                </div>
                                <span class="badge text-bg-light border text-secondary" id="chatLiveLabel">Polling 3 detik</span>
                            </div>
                        </header>

                        <div class="chat-messages" id="chatMessages">
                            <div class="chat-empty-message text-center text-secondary small">
                                Belum ada percakapan dengan dokter ini.
                            </div>
                        </div>

                        <form class="chat-composer border-top bg-white p-3" id="chatSendForm" data-swal-confirmation="off">
                            <div class="input-group">
                                <textarea
                                    class="form-control"
                                    id="chatMessageInput"
                                    rows="2"
                                    maxlength="5000"
                                    placeholder="Ketik pesan WhatsApp..."
                                    required
                                ></textarea>
                                <button class="btn btn-success px-4" type="submit" id="chatSendButton">
                                    Kirim
                                </button>
                            </div>
                        </form>
                    </div>
                </section>
            </div>
        </div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="assets/back-to-top.js"></script>
    <script src="assets/chat-dokter.js"></script>
</body>
</html>
