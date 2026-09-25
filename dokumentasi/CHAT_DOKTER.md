# Chat Dokter

## Tujuan

Modul Chat Dokter menambahkan komunikasi dua arah antara petugas dan dokter melalui session `whatsapp-web.js` yang sudah dipakai Dokter Reminder. Modul ini tidak mengubah logic reminder, jadwal, izin, pindah jam, CAPD, S666, template, maupun perhitungan inden.

## Flow

Pesan masuk:

Dokter -> WhatsApp -> whatsapp-web.js -> listener `server.js` -> `api/chat/incoming.php` -> `whatsapp_messages` -> `chat_dokter.php`.

Pesan keluar:

Petugas -> `chat_dokter.php` -> SweetAlert -> `api/chat/send.php` -> gateway `/send` -> whatsapp-web.js -> WhatsApp dokter -> `whatsapp_messages` direction `OUT`.

Tidak ada auto-reply dan isi chat tidak mengubah jadwal atau kuota.

## Database

Jalankan migration:

```bash
cd /var/www/html/dokter-reminder
mysql -u admin3dp -p dokter_reminder < database/migrations/20260903_create_whatsapp_messages.sql
```

Masukkan password database local saat diminta.

Tabel baru: `whatsapp_messages`.

## File Baru

- `chat_dokter.php`
- `chat_functions.php`
- `assets/chat-dokter.css`
- `assets/chat-dokter.js`
- `api/chat/incoming.php`
- `api/chat/conversations.php`
- `api/chat/messages.php`
- `api/chat/mark_read.php`
- `api/chat/send.php`
- `database/migrations/20260903_create_whatsapp_messages.sql`

## File Existing yang Diubah

- `server.js`: menambahkan listener incoming pada client WhatsApp existing.
- `assets/back-to-top.js`: menambahkan menu Chat Dokter tepat setelah Pindah Jam Praktek.

## Endpoint

- `GET api/chat/conversations.php`
- `GET api/chat/messages.php?doctor_id=S666&after_id=0`
- `POST api/chat/mark_read.php`
- `POST api/chat/send.php`
- `POST api/chat/incoming.php` khusus gateway lokal

## Incoming Message

Node.js menggunakan event `client.on('message')` dari client existing. Pesan group, broadcast, status, dan pesan `fromMe` diabaikan. Nomor dinormalisasi ke format `62...` lalu webhook PHP mencocokkannya dengan `rsi_byl.kontak_dokter.no_hp` dan `master_dokter.dokter_kd`.

Untuk instalasi di `/var/www/html/dokter-reminder`, default webhook adalah:

```text
http://127.0.0.1/dokter-reminder/api/chat/incoming.php
```

Jika URL aplikasi berbeda, jalankan gateway dengan environment:

```bash
export CHAT_INCOMING_URL="http://127.0.0.1/PATH_APLIKASI/api/chat/incoming.php"
npm start
```

## Outgoing Message

`api/chat/send.php` menggunakan gateway existing di `http://127.0.0.1:3210/send`. Jika gateway berada di alamat berbeda, gunakan:

```bash
export WA_GATEWAY_URL="http://127.0.0.1:3210"
```

Pesan `OUT` baru disimpan setelah gateway mengembalikan status sukses.

## Realtime

Versi ini menggunakan polling setiap 3 detik agar fitur tetap terisolasi dan tidak merombak gateway menjadi WebSocket.

## Test S666

1. Pastikan `rsi_byl.kontak_dokter` memiliki nomor aktif untuk `kd_dr = 'S666'`.
2. Jalankan migration.
3. Restart gateway Node.js.
4. Buka `chat_dokter.php`.
5. Cari `S666` atau `Muhammad Haris`.
6. Kirim `Test chat dari website`.
7. Balas dari WhatsApp S666 dengan `Test balasan dokter`.
8. Balasan seharusnya muncul maksimal sekitar 3 detik setelah tersimpan.

Nomor S666 tidak di-hardcode pada modul chat.

## Restart Node.js

Jika gateway dijalankan manual:

```bash
cd /var/www/html/dokter-reminder
npm start
```

Jika memakai PM2, restart proses gateway sesuai nama proses yang sudah digunakan di server.

## Troubleshooting

### Data chat belum siap

Pastikan migration sudah dijalankan dan tabel `whatsapp_messages` ada pada database `dokter_reminder`.

### Pesan website tidak terkirim

Cek `http://IP-SERVER:3210/status` dan pastikan `ready = true`. Pastikan PHP cURL aktif.

### Balasan WhatsApp tidak masuk website

Cek terminal Node.js. Pastikan `CHAT_INCOMING_URL` benar dan endpoint PHP dapat diakses dari proses Node.js pada mesin yang sama.

### Dokter tidak dikenali

Pastikan nomor dokter pada `rsi_byl.kontak_dokter.no_hp` benar. Sistem menormalisasi format `08...` menjadi `628...`.

## Rollback

Untuk menonaktifkan fitur tanpa mengganggu reminder:

1. Kembalikan perubahan `server.js` dan menu Chat Dokter pada `assets/back-to-top.js`.
2. Hapus file-file modul Chat Dokter jika memang tidak diperlukan.
3. Tabel `whatsapp_messages` boleh dibiarkan karena tidak digunakan oleh reminder existing.

Tidak perlu mengubah tabel reminder, jadwal dokter, master dokter, izin, pindah jam, atau konfigurasi session WhatsApp existing.
