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

Gateway berjalan di port `3000`.

Buka browser:

```text
http://localhost:3000
```

Jika sesi WhatsApp belum tersedia, QR akan tampil di halaman tersebut. Scan menggunakan WhatsApp di HP melalui menu **Perangkat tertaut**. Session disimpan menggunakan `LocalAuth` pada folder `.wwebjs_auth`, sehingga normalnya QR cukup discan satu kali selama session tidak dihapus/logout.

Status gateway dapat dicek di:

```text
http://localhost:3000/status
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

Dashboard akan mengakses gateway pada port `3000` menggunakan hostname yang sama dengan halaman PHP. Jadi bila dashboard dibuka melalui `http://192.168.0.14/...`, gateway akan dipanggil melalui `http://192.168.0.14:3000`.

## Cara pengiriman

Alur sekarang:

1. PHP mengambil jadwal dokter dari database.
2. PHP membuat reminder sesuai template.
3. Petugas menekan tombol **Kirim WhatsApp**.
4. Browser melakukan `POST /send` ke service Node.js.
5. `whatsapp-web.js` memeriksa nomor WhatsApp lalu menjalankan `client.sendMessage()`.
6. Jika berhasil, status reminder otomatis menjadi `SENT` dan waktu `sent_at` dicatat.
7. Jika gagal, status reminder menjadi `FAILED`.

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

## Catatan

- `node_modules/`, `.wwebjs_auth/`, dan `.wwebjs_cache/` tidak di-push ke GitHub.
- Jangan menghapus `.wwebjs_auth/` jika tidak ingin scan QR ulang.
- Jika gateway belum `READY`, tombol pengiriman akan gagal dan dashboard menampilkan status gateway.
