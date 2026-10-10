# DokterReminder — PHP Native + WhatsApp Gateway

Aplikasi reminder jadwal praktik dokter dengan dashboard PHP dan pengiriman WhatsApp langsung menggunakan `whatsapp-web.js`.

## 1. Install dependency Node.js

Pastikan Node.js 18 atau lebih baru tersedia, lalu jalankan:

```bash
npm install
```

## 2. Jalankan WhatsApp Gateway

```bash
node server.js
```

Gateway berjalan di port `3210`.

Gateway internal mendengarkan di `127.0.0.1:3210` secara default. **Jangan buka port Node untuk menampilkan QR langsung.** Setelah aplikasi PHP berjalan, buka dashboard dan tekan **Buka QR / Status** atau kunjungi `gateway_qr.php`. Halaman PHP tersebut mengambil QR terbaru melalui endpoint gateway yang terautentikasi. Pindai QR menggunakan WhatsApp di HP melalui menu **Perangkat tertaut**. Session disimpan menggunakan `LocalAuth` pada folder `.wwebjs_auth`; jangan menghapus folder ini kecuali memang ingin mengautentikasi ulang.

Status gateway dapat dilihat dari dashboard PHP. Endpoint internal `/status` dan `/qr` sekarang membutuhkan token server-to-server dan secara default hanya didengarkan pada `127.0.0.1:3210`; jangan membukanya langsung ke jaringan publik.

## 3. Jalankan aplikasi PHP

Contoh menggunakan PHP built-in server:

```bash
php -S 127.0.0.1:8000 -t .
```

Kemudian buka:

```text
http://127.0.0.1:8000
```

Jika menggunakan Apache/Laragon, buka URL project seperti biasa.

Dashboard mengakses gateway melalui `gateway_proxy.php`, dan PHP berbicara ke gateway internal pada `http://127.0.0.1:3210`. Karena browser tidak mengakses port Node secara langsung, QR dan token server tidak perlu dipublikasikan kepada browser.

## Cara pengiriman

Alur sekarang:

1. PHP mengambil jadwal dokter dari database.
2. PHP membuat reminder sesuai template.
3. Petugas menekan tombol **Kirim WhatsApp**.
4. Browser melakukan `POST /send` ke service Node.js.
5. `whatsapp-web.js` memeriksa nomor WhatsApp lalu menjalankan `client.sendMessage()`.
6. Gateway mengembalikan `202 Accepted` ketika permintaan mulai diproses. Status akhir dicatat ke database melalui callback terautentikasi dan rekonsiliasi polling. `SENT` berarti ada ACK server WhatsApp; itu bukan bukti pesan sudah sampai ke perangkat atau dibaca.
7. Jika gateway memastikan permintaan gagal sebelum terkirim, status dicatat `FAILED`. Jika outcome tidak dapat dipastikan atau callback hilang, status menjadi `UNKNOWN`; jangan mengirim ulang sebelum memeriksa riwayat WhatsApp.

Tidak ada lagi proses membuka WhatsApp Web dan menekan tombol Send secara manual.

## Database

Database menggunakan MariaDB/MySQL melalui PDO. Konfigurasi koneksi berada di `config.php`.

Untuk instalasi baru, `database/schema.sql` mendefinisikan `reminders.doctor_id` sebagai `VARCHAR(50)`, karena kode reminder menggunakan kode dokter eksternal (`dokter_kd`) dan bukan selalu ID integer dari tabel `doctors`.

Buat database lokal dengan mengimpor:

```text
database/schema.sql
```

Pastikan ekstensi PHP `pdo_mysql` aktif.

## Scheduler reminder

Untuk menyiapkan reminder otomatis setiap 5 menit:

```bash
*/5 * * * * php /path/ke/dokter-reminder/cron/reminder.php
```

Scheduler menyiapkan record reminder. Pengiriman aktual dilakukan oleh WhatsApp Gateway ketika tombol **Kirim WhatsApp** ditekan.

## Konfigurasi keamanan dan pengiriman (wajib sebelum deploy branch audit)

### Konfigurasi PHP

1. Salin `config.local.example.php` menjadi `config.local.php`.
2. Isi host, port, nama database, user, dan password yang benar untuk keempat alias database (`local`, `rsiklaten`, `rsi_byl`, dan `rme`). Jangan commit `config.local.php`; file itu masuk `.gitignore`.
3. Ganti `api_token` dan `callback_token` dengan dua nilai acak berbeda (minimal 32 byte). Nilai PHP harus sama persis dengan token pada proses Node.js.

Contoh membuat token acak di Linux:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Jika memilih environment variable alih-alih file konfigurasi lokal, gunakan nama yang dipakai di `config.php`: `DB_LOCAL_HOST/PORT/USER/PASS/NAME`, `DB_RSIKLATEN_HOST/PORT/USER/PASS/NAME`, `DB_RSI_BYL_HOST/PORT/USER/PASS/NAME`, dan `DB_RME_HOST/PORT/USER/PASS/NAME`. Jangan mengandalkan file `.env` saja karena aplikasi ini tidak memuat file tersebut secara otomatis.

### Konfigurasi Node.js

Atur environment variable di service manager atau terminal yang menjalankan gateway:

- `WA_API_TOKEN`: sama dengan `wa_gateway.api_token` di konfigurasi PHP.
- `WA_CALLBACK_TOKEN`: sama dengan `wa_gateway.callback_token` di konfigurasi PHP.
- `WA_CALLBACK_URL`: URL internal ke `gateway_callback.php` yang dapat dijangkau oleh proses Node.js. Contoh jika PHP built-in server melayani direktori proyek di port 8000: `http://127.0.0.1:8000/gateway_callback.php`.
- `WA_PORT`: tetap 3210 bila port existing belum ingin diubah.
- `WA_GATEWAY_INTERNAL_URL` di konfigurasi PHP: default `http://127.0.0.1:3210`.

Endpoint pengiriman gateway sekarang **fail-closed**: `POST /send` ditolak jika `WA_API_TOKEN`, `WA_CALLBACK_URL`, atau `WA_CALLBACK_TOKEN` belum diatur. Dashboard berkomunikasi melalui `gateway_proxy.php`, sehingga token tidak dikirim ke browser. QR diakses melalui `gateway_qr.php` pada aplikasi PHP. Root Node gateway sengaja tidak menampilkan QR, dan service bind ke loopback secara default; ubah `WA_HOST` hanya jika ada kebutuhan arsitektur yang sudah ditinjau.

### Migrasi database pengiriman

**Instalasi baru:** impor versi terbaru `database/schema.sql`. Skema tersebut sudah memuat kolom tracking dan status `PROCESSING`/`UNKNOWN`; jangan jalankan migrasi tracking lagi pada database yang baru dibuat dari skema terbaru.

**Database yang sudah ada:** sebelum mengubah apa pun, buat backup, jalankan `SHOW CREATE TABLE reminders;`, periksa daftar status/kolom/index yang sudah ada, serta sesuaikan migrasi bila struktur aktual berbeda. Jika tabel belum mempunyai kolom tracking, tinjau lalu jalankan sekali `database/migrations/20261010_add_reminder_delivery_tracking.sql`. Jangan menjalankan ulang migrasi yang sama atau menjalankannya pada database yang sudah memakai skema terbaru.

**Peringatan kompatibilitas skema dokter:** kode aplikasi menyimpan kode dokter eksternal sebagai string. Database lama yang benar-benar dibuat memakai skema contoh terdahulu mungkin masih memakai `reminders.doctor_id INT UNSIGNED` dan foreign key `fk_reminder_doctor`. Periksa `SHOW CREATE TABLE reminders;` dan `SHOW CREATE TABLE doctors;`. Hanya jika struktur persis sama dengan skema lama tersebut, tinjau `database/migrations/20261010_align_reminder_doctor_key.sql` sebagai migrasi terpisah. Migrasi ini mengubah tipe key, tetapi tidak secara otomatis memetakan ID dokter lokal ke `dokter_kd` eksternal. Rekonsiliasi data lama secara manual sebelum penggunaan produksi; jangan jalankan jika nama foreign key atau tipe kolom berbeda.

Tambahkan cron rekonsiliasi setiap 5 menit (sesuaikan path PHP dan direktori instalasi):

```cron
*/5 * * * * php /path/absolut/ke/proyek/cron/reconcile_delivery.php
```

Job yang masih `PROCESSING` selama lebih dari 10 menit diubah menjadi `UNKNOWN`, bukan `FAILED`. Periksa riwayat WhatsApp secara manual sebelum mengulang kirim agar pesan tidak terduplikasi.

### Peringatan kredensial

Versi awal repository menyimpan kredensial database pada file yang terlacak Git. Menghapusnya dari versi baru tidak menghapusnya dari riwayat Git. Rotasi kredensial database secara terencana, batasi hak akses database, dan hindari menyalin rahasia ke issue, log, atau laporan.

## Catatan

- `node_modules/`, `.wwebjs_auth/`, dan `.wwebjs_cache/` tidak di-push ke GitHub.
- Jangan menghapus `.wwebjs_auth/` jika tidak ingin scan QR ulang.
- Jika gateway belum `READY`, tombol pengiriman akan gagal dan dashboard menampilkan status gateway.
