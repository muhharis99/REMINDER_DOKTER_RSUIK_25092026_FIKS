<?php
declare(strict_types=1);
?><!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>QR WhatsApp Gateway - DokterReminder</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #f5f7f9; }
        .qr-image { width: 280px; max-width: 100%; height: auto; image-rendering: pixelated; }
    </style>
</head>
<body>
<main class="container py-5">
    <div class="row justify-content-center">
        <div class="col-12 col-md-8 col-lg-6">
            <div class="card shadow-sm border-0">
                <div class="card-body p-4 p-lg-5 text-center">
                    <span class="badge text-bg-success-subtle text-success mb-3">DOKTER REMINDER</span>
                    <h1 class="h4 mb-2">Koneksi WhatsApp</h1>
                    <p id="qrStatus" class="text-secondary">Memeriksa status gateway…</p>
                    <div id="qrContainer" class="d-none my-4">
                        <img id="qrImage" class="qr-image border rounded bg-white p-2" alt="QR Code WhatsApp yang masih berlaku">
                    </div>
                    <div id="qrHelp" class="small text-secondary mb-3">QR hanya ditampilkan melalui dashboard PHP yang terhubung ke gateway terautentikasi.</div>
                    <button id="refreshQr" class="btn btn-outline-success btn-sm" type="button">Periksa Lagi</button>
                    <a class="btn btn-success btn-sm ms-2" href="index.php">Kembali ke Dashboard</a>
                </div>
            </div>
        </div>
    </div>
</main>
<script>
(() => {
    const statusNode = document.getElementById('qrStatus');
    const imageNode = document.getElementById('qrImage');
    const containerNode = document.getElementById('qrContainer');
    const helpNode = document.getElementById('qrHelp');
    const refreshNode = document.getElementById('refreshQr');
    let inFlight = false;
    let lastQr = '';

    async function refreshQr() {
        if (inFlight) return;
        inFlight = true;
        try {
            const response = await fetch('gateway_proxy.php?action=qr', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || data.message || 'Gateway belum dapat diperiksa.');
            }

            if (data.ready) {
                statusNode.textContent = 'WhatsApp terhubung dan siap digunakan.';
                statusNode.className = 'text-success fw-semibold';
                containerNode.classList.add('d-none');
                helpNode.textContent = 'Sesi WhatsApp aktif. QR tidak diperlukan.';
            } else if (data.hasQr && typeof data.qr === 'string' && data.qr.startsWith('data:image/png;base64,')) {
                statusNode.textContent = 'Pindai QR melalui WhatsApp > Perangkat tertaut.';
                statusNode.className = 'text-success fw-semibold';
                if (lastQr !== data.qr) {
                    imageNode.src = data.qr;
                    lastQr = data.qr;
                }
                containerNode.classList.remove('d-none');
                helpNode.textContent = 'Gunakan QR terbaru. QR dapat kedaluwarsa; halaman ini memeriksa pembaruan secara otomatis.';
            } else {
                statusNode.textContent = 'Status gateway: ' + String(data.state || 'BELUM SIAP');
                statusNode.className = 'text-secondary';
                containerNode.classList.add('d-none');
                helpNode.textContent = data.error ? String(data.error) : 'Menunggu QR dari gateway…';
            }
        } catch (error) {
            statusNode.textContent = 'Tidak dapat memeriksa gateway.';
            statusNode.className = 'text-danger fw-semibold';
            containerNode.classList.add('d-none');
            helpNode.textContent = error.message || 'Periksa konfigurasi gateway, token, dan log service.';
        } finally {
            inFlight = false;
        }
    }

    refreshNode.addEventListener('click', refreshQr);
    refreshQr();
    window.setInterval(refreshQr, 3000);
})();
</script>
</body>
</html>
