# Laporan Audit Teknis Awal — DokterReminder RSUI Klaten

Tanggal: 10 Oktober 2026  
Branch audit: `audit/fix-send-status-20261010`  
Branch utama `main`: tidak diubah.

## Ringkasan

Audit kode berbasis repository menemukan beberapa penyebab konkret yang berkontribusi terhadap gangguan pengiriman dan status yang menyesatkan. Perubahan pertama dibuat di branch audit terpisah. Tidak ada sesi WhatsApp, database server, browser Chromium, atau nomor uji yang tersedia dalam lingkungan pemeriksaan ini; karena itu QR, pengiriman aktual, dan scheduler produksi belum dapat diuji secara langsung.

## Temuan

| No. | Tingkat | File/Modul | Temuan berbasis kode | Dampak | Status |
|---|---|---|---|---|---|
| 1 | High | `server.js` | Handler `message_ack` memanggil `ackLabel(ack)`, tetapi fungsi tersebut tidak ada pada branch awal. | Saat event ACK cocok dengan pengiriman, pemrosesan bisa melempar `ReferenceError`, mengganggu pelaporan keberhasilan. | Diperbaiki di branch audit |
| 2 | High | `server.js`, `index.php` | `POST /send` mengembalikan HTTP 202 sebelum pengiriman background selesai. Dashboard lalu memperlakukan respons itu sebagai permintaan diteruskan, bukan hasil final. Tidak ada callback/persistensi ACK ke database reminder pada kode yang diperiksa. | Status database tidak dijamin merepresentasikan hasil aktual. Kegagalan setelah respons 202 tidak otomatis terlihat di dashboard. | Ditemukan; integrasi lanjutan diperlukan |
| 3 | High | `index.php` | Jika permintaan fetch gagal/timeout, browser mengarahkan ke `action=failed`; ini mengubah status DB menjadi FAILED meski outcome gateway mungkin tidak diketahui (misalnya koneksi browser putus setelah gateway menerima permintaan). | Status gagal dapat menjadi false-negative dan tindakan retry berpotensi mengirim duplikat. | Belum diperbaiki; perlu desain idempotensi/status |
| 4 | Medium | `server.js` | Timeout pengiriman 5 detik dan jendela verifikasi ACK 1,5 detik cukup sempit untuk operasi browser/network yang lambat. | ACK dapat terlambat sehingga operasi tercatat gagal walau outcome belum final. | Dilonggarkan di branch audit menjadi 15 detik/5 detik; perlu ukur dengan tes langsung |
| 5 | Medium | `README.md` | Dokumentasi awal mengarahkan ke port 3000, sedangkan `server.js` dan dashboard menggunakan 3210 secara default. | Instalasi/troubleshooting dapat menggunakan URL yang salah. | Diperbaiki di branch audit |
| 6 | High | `config.php` | File konfigurasi yang terlacak berisi kredensial database plaintext. | Kredensial dapat terekspos kepada siapa pun yang dapat membaca repository/history. | Belum diperbaiki; rotasi kredensial dan migrasi konfigurasi butuh koordinasi environment |
| 7 | High | `server.js` | Gateway menggunakan `cors()` terbuka dan endpoint `POST /send` tidak terlihat mempunyai autentikasi/otorisasi. Gateway bind ke `0.0.0.0` secara default. | Jika port dapat diakses jaringan, pihak lain bisa mencoba menyalahgunakan endpoint pengiriman. | Belum diperbaiki; perlu inventarisasi akses jaringan sebelum mengubah kontrak |
| 8 | Medium | `package.json`, `package-lock.json` | `package.json` merujuk fork Git pada commit spesifik, sedangkan lockfile mencatat paket npm registry versi 1.34.7. | Instalasi deterministik dan kode yang terpasang dapat berbeda antar lingkungan. | Ditemukan; belum mengubah dependency tanpa tes kompatibilitas |
| 9 | Medium | `cron/reminder.php`, `functions.php` | Cron hanya menjalankan `ensureReminders($date)`; README juga menyebut pengiriman aktual masih melalui tombol dashboard. | Cron ini menyiapkan record reminder, bukan worker otomatis yang mengirim WhatsApp. | Dikonfirmasi dari kode; perlu pastikan ini sesuai kebutuhan bisnis |

## Perubahan pada branch audit

1. `server.js`
   - Menambahkan fungsi `ackLabel()` yang sebelumnya dirujuk tetapi tidak didefinisikan.
   - Memperlonggar timeout operasi pengiriman dari 5 menjadi 15 detik dan jendela pemeriksaan ACK dari 1,5 menjadi 5 detik (interval 500 ms). Nilai ini belum dianggap optimal sebelum pengujian aktual.
2. `index.php`
   - Mengubah teks dashboard agar HTTP 202 tidak dipresentasikan sebagai bukti pengiriman final.
3. `README.md`
   - Menyelaraskan contoh URL port dengan konfigurasi aktual 3210.
   - Mengoreksi deskripsi bahwa HTTP 202 berarti permintaan diterima untuk proses background, bukan bukti pesan sudah terkirim, serta menyebutkan hasil ACK belum tersinkron ke database PHP.
4. `AUDIT_REPORT_20261010.md`
   - Menambahkan laporan awal ini.

Branch utama `main` tidak diubah. Belum ada perubahan skema database, sesi autentikasi, port aplikasi, nama endpoint, ataupun kredensial.

## Hasil verifikasi yang dapat dilakukan

- Repository dan file pada branch audit berhasil dibaca ulang dari GitHub setelah commit.
- Pemeriksaan kode memastikan `ackLabel()` kini terdefinisi.
- Dashboard masih memakai endpoint port 3210, dan README kini memakai port yang sama.
- Pemeriksaan kode menyatakan endpoint `/send` masih bersifat asinkron dan tidak memiliki mekanisme callback untuk memperbarui status reminder setelah ACK.
- Tes Node.js/PHP, lint, unit/integration test, koneksi database, scan QR, autentikasi, pengiriman ke nomor uji, dan scheduler produksi belum dijalankan dari lingkungan ini.

## Rekomendasi tahap lanjutan

1. Rancang alur status pengiriman persisten dengan ID korelasi, status `PENDING/PROCESSING/SENT/FAILED/UNKNOWN`, dan endpoint internal untuk hasil ACK. Jangan menganggap outcome timeout sebagai FAILED secara otomatis bila status pengiriman tidak diketahui.
2. Terapkan idempotensi sebelum retry, menggunakan kunci yang kompatibel dengan skema aktual. Jangan menambah constraint atau kolom produksi tanpa backup, verifikasi duplikasi existing, dan rollback.
3. Batasi akses ke gateway: tentukan terlebih dulu apakah dashboard dan gateway satu host/origin atau lintas host, kemudian pasang autentikasi/otorisasi dan aturan CORS allowlist yang sesuai. Jangan mengekspos port gateway ke jaringan publik tanpa kontrol.
4. Anggap kredensial di file terlacak sudah terekspos: rotasi kredensial secara terencana; pindahkan nilai ke environment/config lokal yang tidak dilacak; jangan sekadar menghapus file history sambil mengasumsikan rahasia lama aman.
5. Rekonsiliasi sumber dependency dengan membuat lockfile yang sesuai menggunakan versi Node/npm di environment target, lalu lakukan tes regresi. Jangan upgrade massal.
6. Jalankan tes QR dan pengiriman hanya pada perangkat serta nomor uji yang diizinkan; jangan memicu pesan produksi dari tes otomatis.
7. Verifikasi apakah cron memang hanya bertugas menyiapkan reminder. Bila pengiriman otomatis memang diharapkan, buat worker terkontrol sebagai perubahan tahap terpisah.

## Status kesimpulan

Ini adalah audit awal berbasis kode, bukan sertifikasi sistem bebas error. QR dan pengiriman WhatsApp langsung belum teruji. Perubahan branch audit adalah perbaikan awal dengan risiko terkontrol; diperlukan integrasi status asinkron, pemeriksaan keamanan, dan tes di environment aplikasi untuk menyatakan sistem siap produksi.
