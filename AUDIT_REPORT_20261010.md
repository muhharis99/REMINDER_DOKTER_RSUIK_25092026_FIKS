# Laporan Audit Teknis — DokterReminder RSUI Klaten

Tanggal audit: 10 Oktober 2026  
Branch kerja: `audit/fix-send-status-20261010`  
Pull request: [#1 — Audit dan perbaikan awal](https://github.com/muhharis99/REMINDER_DOKTER_RSUIK_25092026_FIKS/pull/1)  
Branch `main`: tidak diubah dan belum di-merge.

## A. Ringkasan

Audit dilakukan pada source repository PHP native + MariaDB/MySQL/PDO + Node.js `whatsapp-web.js`. Perbaikan sekarang mencakup jalur pengiriman yang terautentikasi, ID korelasi dan deduplikasi, callback status, polling dashboard, status `UNKNOWN` untuk hasil ambigu, perlindungan QR, konfigurasi lokal tanpa kredensial hard-coded, migrasi database terpisah, regresi tests, dan GitHub Actions.

**Yang sudah dibuktikan:** GitHub Actions berhasil menjalankan `npm ci`, pemeriksaan sintaks Node.js, pemeriksaan regresi, dan lint sintaks PHP pada beberapa commit audit. Setelah perubahan terakhir, workflow otomatis berjalan ulang pada head terbaru; lihat tautan Actions di PR untuk hasil akhir. Setelah perubahan dokumentasi dan migrasi SQL kecil berikutnya, workflow kembali dijalankan pada head terbaru; lihat tautan Actions di PR untuk hasil head terbaru.

**Yang belum dibuktikan:** koneksi database rumah sakit yang sebenarnya, scan QR pada perangkat, pemulihan sesi live, pengiriman ke nomor uji, cron di server, dan pengujian beban/jaringan. Tidak ada migrasi yang dijalankan dan tidak ada pesan produksi yang dikirim dari proses audit ini.

## B. Daftar temuan

| No. | Tingkat | File/modul | Akar masalah / bukti | Dampak | Status |
|---|---|---|---|---|---|
| 1 | High | `server.js` | Handler `message_ack` memanggil `ackLabel(ack)`, tetapi helper tidak didefinisikan pada kode awal. | Pemrosesan ACK dapat gagal dengan `ReferenceError`. | **Diperbaiki**; helper dipisahkan ke `lib/gateway-utils.js` dan dicakup test. |
| 2 | High | `server.js`, `gateway_callback.php`, `gateway_proxy.php`, `index.php` | Endpoint kirim mengembalikan HTTP 202 sebelum hasil background diketahui, dan hasil ACK awal tidak disinkronkan ke DB. | Status dashboard bisa menyimpang dari hasil gateway. | **Alur callback + polling ditambahkan**; perlu tes integrasi pada server target. |
| 3 | High | `index.php` | Browser sebelumnya mengubah status DB dengan query string `action=sent/failed`; error fetch dapat menandai FAILED meski hasil gateway tidak diketahui. | False-negative dan potensi pengiriman ulang ganda. | **Diperbaiki**; state hasil hanya dicatat melalui proxy/callback; browser tidak menulis status final lewat URL. |
| 4 | High | `gateway_proxy.php`, `server.js` | Tidak ada korelasi persisten/idempotensi per reminder pada jalur pengiriman awal. | Double-click, retry, atau restart dapat memulai pengiriman ganda. | **Diperbaiki sebagian besar** dengan UUID request ID, status PROCESSING, locking DB, locking in-memory pada gateway, dan satu pengiriman aktif per client untuk mencegah panggilan bersamaan; bukan jaminan exactly-once setelah gangguan eksternal. |
| 5 | High | `server.js`, `gateway_qr.php`, `gateway_proxy.php` | QR gateway awal bisa dilihat melalui halaman Node langsung tanpa autentikasi. | QR berpotensi terpapar ke siapa pun yang dapat mengakses port. | **Diperbaiki pada kode**: QR diambil lewat endpoint ber-token dan halaman PHP; root Node tidak lagi menampilkan QR; bind default diubah ke loopback. Perlu verifikasi konfigurasi jaringan deployment. |
| 6 | High | `server.js`, `gateway_proxy.php`, `config.php` | Gateway awal tidak mempunyai token autentikasi pada endpoint operasi dan memakai CORS terbuka. | Endpoint pengiriman rentan dipanggil langsung dari jaringan. | **Diperbaiki untuk akses Node-to-Node** dengan Bearer token, CORS browser dihilangkan, dan gateway default hanya loopback. **Login/otorisasi pengguna aplikasi PHP belum ditemukan di repository**; jangan mengekspos aplikasi PHP ke publik tanpa kontrol akses jaringan/aplikasi. |
| 7 | High | `config.php`, `config.local.example.php`, `.gitignore` | Kredensial DB ditulis di file yang dilacak Git. | Kredensial berpotensi terekspos. | **Nilai rahasia dihapus dari versi kerja saat ini** dan dialihkan ke environment/config lokal yang diabaikan Git. Riwayat Git lama tetap dapat memuat rahasia: rotasi kredensial wajib dan tidak digantikan oleh penghapusan pada commit baru. |
| 8 | High | `database/schema.sql`, `functions.php`, migrasi | Kode aplikasi menyimpan kode dokter eksternal sebagai string, tetapi skema contoh lama mendefinisikan `reminders.doctor_id` sebagai INT dengan FK ke tabel `doctors` lokal. | Instalasi dari skema lama bisa gagal atau salah menyimpan kode dokter. | **Skema fresh install disesuaikan** menjadi `VARCHAR(50)`; migrasi legacy terpisah disediakan dengan prasyarat pemeriksaan manual. Database rumah sakit tidak tersedia untuk memverifikasi struktur aktual. |
| 9 | Medium | `server.js` | Timeout pengiriman 5 detik dan jendela ACK 1,5 detik terlalu ketat untuk beberapa keadaan browser/network. | Hasil dapat dinyatakan gagal sebelum ACK tiba. | Timeout diperpanjang; hasil setelah permintaan dimulai tetapi outcome belum pasti menjadi **UNKNOWN**, bukan otomatis FAILED. Tetap perlu penyesuaian berdasarkan pengukuran live. |
| 10 | Medium | `README.md`, `server.js`, `index.php` | Dokumentasi lama menyebut port 3000; implementasi aktif menggunakan 3210. | Langkah troubleshooting bisa mengarah ke port salah. | **Diperbaiki**; dashboard memakai PHP proxy dan QR page. |
| 11 | Medium | `package.json`, `package-lock.json` | Dependency WhatsApp dipatok ke fork Git, tetapi lockfile awal mereferensikan versi registry npm. | Instalasi deterministik berisiko berbeda. | **Diperbaiki** dengan menyelaraskan resolved commit fork. `npm ci` sudah lolos di GitHub Actions. |
| 12 | Medium | `report.php`, `report_pdf.php` | Laporan awal tidak mendukung status baru PROCESSING/UNKNOWN secara menyeluruh dan PDF menampilkan exception detail. | Status ambigu tidak mudah ditinjau dan detail server dapat bocor ke pengguna. | **Diperbaiki** pada report/filter/PDF; exception detail dicatat ke log, bukan dirender kepada pengguna. |
| 13 | Medium | `cron/reminder.php` | Cron existing hanya memanggil `ensureReminders()`; ia menyiapkan record reminder, bukan mengirim WhatsApp otomatis. | Jika bisnis mengharapkan pengiriman otomatis terjadwal, reminder tetap memerlukan petugas menekan tombol kirim. | **Didokumentasikan, belum diubah**: README dan alur asli secara eksplisit menyatakan pengiriman manual. Mengubahnya menjadi pengiriman otomatis memerlukan aturan jam, hari libur, dan persetujuan operasional supaya tes tidak mengirim pesan produksi. |
| 14 | Medium | `cron/reconcile_delivery.php` | Callback dapat hilang saat service restart/putus jaringan. | Status PROCESSING bisa tertahan. | **Rekonsiliasi ditambahkan**: proses lama berubah menjadi UNKNOWN, bukan FAILED, agar tidak membuat retry otomatis. Cron harus dipasang di server. |

## C. Daftar perubahan

- **Gateway:** `server.js`, `lib/gateway-utils.js` — helper ACK, masking nomor di sebagian log, token internal, endpoint QR/status pengiriman, korelasi UUID, deduplikasi request/reminder/nomor, lock global satu pengiriman aktif, timeout, dan callback hasil.
- **Dashboard/API internal:** `index.php`, `gateway_proxy.php`, `gateway_callback.php`, `gateway_qr.php` — pengiriman lewat PHP proxy, status polling, callback bertoken, tampilan QR melalui halaman PHP, dan penghindaran status palsu akibat error browser.
- **Database:** `database/schema.sql`, `database/migrations/20261010_add_reminder_delivery_tracking.sql`, `database/migrations/20261010_align_reminder_doctor_key.sql`, `cron/reconcile_delivery.php`, `db.php` — tracking status, kunci permintaan, validasi konfigurasi, dan penanganan status kedaluwarsa.
- **Keamanan/konfigurasi:** `config.php`, `config.local.example.php`, `.gitignore` — nilai runtime dipindahkan dari file terlacak; konfigurasi lokal contoh ditambah.
- **Dependency/otomasi tes:** `package.json`, `package-lock.json`, `tests/audit-regressions.test.js`, `.github/workflows/audit-checks.yml`.
- **Dokumentasi/laporan:** `README.md`, `report.php`, `report_pdf.php`, dan laporan ini.

Perubahan dilakukan di branch `audit/fix-send-status-20261010`. Tidak ada merge ke `main`.

## D. Hasil pengujian

| Jenis | Hasil yang dibuktikan | Batasan |
|---|---|---|
| Dependency install | `npm ci --ignore-scripts` berhasil di GitHub Actions. | Tidak membuktikan kompatibilitas runtime WhatsApp live. |
| Node static check | `node --check server.js` dan `node --check lib/gateway-utils.js` berhasil. | Tidak menjalankan browser WhatsApp. |
| Regression tests | 18 test Node lulus: ACK label, normalisasi/masking nomor, perbandingan token, kontrak endpoint, state UI, migrasi additive, callback, konfigurasi, dependency lock, perlindungan QR, dan skema kode dokter. | Sebagian berupa kontrak source/struktur; bukan end-to-end dengan DB nyata. |
| PHP lint | Semua file PHP di luar `vendor` lulus `php -l` di GitHub Actions. | Tidak menjalankan query ke server database atau klik UI dalam browser. |
| QR/Auth WhatsApp | **Belum diuji langsung.** | Membutuhkan browser, sesi WhatsApp, dan perangkat tertaut target. |
| Pesan ke nomor uji | **Belum diuji langsung.** | Harus memakai nomor uji yang secara eksplisit diizinkan. |
| DB migration/rollback | **Tidak dijalankan.** | Tidak tersedia akses database target; struktur aktual harus diperiksa terlebih dahulu. |
| Scheduler/cron | **Tidak dijalankan di server.** | Perlu pasang cron pada environment target dan verifikasi log. |

Tautan workflow: [GitHub Actions audit-checks](https://github.com/muhharis99/REMINDER_DOKTER_RSUIK_25092026_FIKS/actions/workflows/audit-checks.yml).

## E. Status fitur utama

- **QR:** akses kode dilindungi dengan token internal dan QR ditampilkan melalui halaman PHP; pemindaian sebenarnya belum diuji.
- **Sesi/rekoneksi:** implementasi lifecycle existing dipertahankan; belum diuji dengan sesi live atau logout/revoked session.
- **Pengiriman:** request ID + callback/polling + status PROCESSING/SENT/FAILED/UNKNOWN sudah disiapkan; perlu nomor uji dan database aktual untuk verifikasi akhir.
- **Deduplikasi:** request ID, status row locking, active send locks, serta serialisasi satu pengiriman per client membantu mencegah duplikat dan race condition. Exactly-once tidak dijanjikan.
- **Scheduler:** cron reminder tetap menyiapkan record. Cron rekonsiliasi baru harus dipasang; tidak ada pengiriman terjadwal otomatis yang ditambahkan.
- **Database:** migrasi additive tersedia, tetapi belum dijalankan. Periksa skema existing dan mapping kode dokter.
- **Dashboard/report:** status PROCESSING/UNKNOWN disertakan dan browser tidak lagi menyetel SENT/FAILED hanya berdasarkan query string.
- **Logging:** nomor disamarkan pada sebagian log gateway; tetap audit log server secara lokal dan jangan membagikan log yang mungkin mengandung data pasien.
- **Dependency:** lockfile diselaraskan dengan commit fork yang dipatok; npm install terkunci lulus di CI.

## F. Instruksi pemulihan dan deployment

Jangan gunakan branch audit untuk menggantikan deployment yang sedang berjalan sebelum konfigurasi dan migrasi ditinjau.

1. Backup database serta folder `.wwebjs_auth`. Jangan hapus sesi untuk mencoba memperbaiki error QR.
2. Salin `config.local.example.php` menjadi `config.local.php`; masukkan nilai DB sebenarnya. File lokal tersebut tidak dilacak Git. Alternatifnya gunakan environment variable `DB_LOCAL_*`, `DB_RSIKLATEN_*`, `DB_RSI_BYL_*`, dan `DB_RME_*`.
3. Buat dua secret berbeda dengan `openssl rand -hex 32`; set `WA_API_TOKEN` dan `WA_CALLBACK_TOKEN` pada proses Node serta nilai pasangannya di `wa_gateway.api_token` / `wa_gateway.callback_token` pada config PHP.
4. Set `WA_CALLBACK_URL` ke URL internal yang dapat dijangkau service Node, misalnya `http://127.0.0.1:8000/gateway_callback.php` jika PHP built-in server memang berjalan di port 8000 pada host yang sama.
5. Instal dependency secara terkunci dengan `npm ci`; jalankan `npm run check`. Jalankan `php -l` pada file PHP setelah konfigurasi runtime siap.
6. Verifikasi `SHOW CREATE TABLE reminders;`, `SHOW CREATE TABLE doctors;`, tipe `doctor_id`, enum status, kolom, indeks, dan jumlah status existing. Untuk database yang sudah ada, review dan jalankan migrasi yang sesuai secara manual, satu kali, setelah backup.
7. Jalankan gateway dan PHP di environment test terlebih dahulu. Scan QR via `gateway_qr.php`, uji status dan pengiriman pada nomor uji yang diizinkan, lalu pastikan status di DB, callback, log, dan dashboard konsisten.
8. Pasang cron `cron/reconcile_delivery.php` setiap 5 menit dengan path absolut yang benar. Cron `cron/reminder.php` existing tetap hanya menyiapkan reminder.

Jika gateway restart saat pengiriman berlangsung, status yang belum dapat dipastikan harus tetap UNKNOWN sampai hasilnya dapat diverifikasi. Jangan menghapus `.wwebjs_auth`, mengirim massal, atau mengulang permintaan UNKNOWN secara otomatis.

## G. Catatan database dan rollback

- Tidak ada migrasi yang dijalankan dari audit ini.
- `20261010_add_reminder_delivery_tracking.sql` berlaku bagi database existing yang belum mempunyai kolom tracking; jangan jalankan pada instalasi fresh yang telah dibuat memakai skema terbaru.
- `20261010_align_reminder_doctor_key.sql` hanya untuk skema lama yang **persis** menggunakan integer key + FK bernama `fk_reminder_doctor`. Periksa nama dan tipe aktual terlebih dahulu. Tipe conversion tidak otomatis menerjemahkan local doctor ID menjadi `dokter_kd`.
- Sebelum migrasi, backup DB penuh dan simpan hasil `SHOW CREATE TABLE`. Untuk rollback, gunakan backup terverifikasi atau rencana DBA berdasarkan skema awal; jangan mengeksekusi rollback generik tanpa mengetahui data/operasi yang sudah masuk setelah migrasi.
- `database/schema.sql` diperbaiki untuk instalasi baru sehingga `reminders.doctor_id` menyimpan kode dokter string yang digunakan kode aplikasi.

## H. Risiko yang masih tersisa

1. Kredensial lama masih mungkin ada pada histori Git. Rotasi DB credential adalah wajib; commit baru tidak membersihkan sejarah Git.
2. Tidak ada autentikasi pengguna/login yang jelas pada aplikasi PHP dalam repository ini. Token hanya melindungi komunikasi PHP-ke-Node. Batasi dashboard ke jaringan yang berwenang atau integrasikan dengan sistem login/otorisasi rumah sakit yang benar sebelum dipublikasikan.
3. QR/auth, send, database, cron, dan recovery belum menjalani integration test di server target.
4. Pengiriman otomatis berbasis cron belum diterapkan; alur yang terdokumentasi tetap manual via dashboard.
5. Skema produksi dan mapping `doctor_id` belum diverifikasi; migrasi legacy dapat membutuhkan penyesuaian DBA.
6. Job aktif gateway dan status kerja tersimpan di memori Node; setelah restart, database akan direkonsiliasi menjadi UNKNOWN jika callback tidak ada. Ini aman terhadap retry buta tetapi membutuhkan pemeriksaan manual.
7. Belum ada retry otomatis untuk UNKNOWN karena itu berisiko mengirim pesan duplikat.

## I. Ringkasan Git

- Branch kerja: `audit/fix-send-status-20261010`.
- PR: [#1 — Audit dan perbaikan awal](https://github.com/muhharis99/REMINDER_DOKTER_RSUIK_25092026_FIKS/pull/1).
- PR tetap draft dan belum di-merge.
- Branch `main` tidak diubah.
- Lihat diff PR dan run CI sebelum menyetujui merge.
