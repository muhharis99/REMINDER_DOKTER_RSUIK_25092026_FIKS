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

Buka browser:

```text
http://localhost:3210
```

Jika sesi WhatsApp belum tersedia, QR akan tampil di halaman tersebut. Scan menggunakan WhatsApp di HP melalui menu **Perangkat tertaut**. Session disimpan menggunakan `LocalAuth` pada folder `.wwebjs_auth`, sehingga normalnya QR cukup discan satu kali selama session tidak dihapus/logout.

Status gateway dapat dicek di:

```text
http://localhost:3210/status
```

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

Dashboard akan mengakses gateway pada port `3210` menggunakan hostname yang sama dengan halaman PHP. Jadi bila dashboard dibuka melalui `http://192.168.0.14/...`, gateway akan dipanggil melalui `http://192.168.0.14:3210`.

## Cara pengiriman

Alur sekarang:

1. PHP mengambil jadwal dokter dari database.
2. PHP membuat reminder sesuai template.
3. Petugas menekan tombol **Kirim WhatsApp**.
4. Browser melakukan `POST /send` ke service Node.js.
5. `whatsapp-web.js` memeriksa nomor WhatsApp lalu menjalankan `client.sendMessage()`.
6. Gateway mengembalikan `202 Accepted` ketika permintaan diterima untuk diproses di background. Respons `202` belum membuktikan pesan terkirim; ACK dicatat pada log gateway, tetapi hasil ACK belum otomatis memperbarui status reminder di database PHP.
7. Jika gateway menolak permintaan sebelum mengirim, status dicatat `FAILED`; jika hasilnya tidak pasti atau callback hilang, status menjadi `UNKNOWN` dan tidak boleh dikirim ulang sebelum pemeriksaan manual.

Tidak ada lagi proses membuka WhatsApp Web dan menekan tombol Send secara manual.

## Database

Database menggunakan MariaDB/MySQL melalui PDO. Konfigurasi koneksi berada di `config.php`.

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

Endpoint pengiriman gateway sekarang **fail-closed**: `POST /send` ditolak jika `WA_API_TOKEN`, `WA_CALLBACK_URL`, atau `WA_CALLBACK_TOKEN` belum diatur. Dashboard berkomunikasi melalui `gateway_proxy.php`, sehingga token tidak dikirim ke browser. Halaman QR tetap dapat dibuka langsung di port 3210 pada jaringan internal.

### Migrasi database pengiriman

Sebelum kode baru digunakan, buat backup database aplikasi dan periksa bahwa tabel `reminders` memiliki struktur yang sesuai. Jalankan sekali, setelah review manual, migrasi:

```text
database/migrations/20261010_add_reminder_delivery_tracking.sql
```

Migrasi menambah status `PROCESSING` dan `UNKNOWN`, ID permintaan, ACK, serta kolom pelacakan. Migrasi tidak dijalankan otomatis oleh aplikasi. Jika tabel produksi berbeda dari skema yang didokumentasikan, sesuaikan migrasi terlebih dahulu; jangan jalankan langsung secara membabi buta. Simpan backup untuk pemulihan.

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
