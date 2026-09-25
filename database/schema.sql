CREATE DATABASE IF NOT EXISTS dokter_reminder CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE dokter_reminder;

CREATE TABLE IF NOT EXISTS doctors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kode_dokter VARCHAR(50) NOT NULL UNIQUE,
  nama_dokter VARCHAR(150) NOT NULL,
  spesialis VARCHAR(150) NULL,
  no_whatsapp VARCHAR(30) NOT NULL,
  status ENUM('AKTIF','NONAKTIF') NOT NULL DEFAULT 'AKTIF'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS poli (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kode_poli VARCHAR(50) NOT NULL UNIQUE,
  nama_poli VARCHAR(150) NOT NULL,
  status ENUM('AKTIF','NONAKTIF') NOT NULL DEFAULT 'AKTIF'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schedules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT UNSIGNED NOT NULL,
  poli_id INT UNSIGNED NOT NULL,
  tanggal DATE NOT NULL,
  jam_mulai TIME NOT NULL,
  jam_selesai TIME NOT NULL,
  lokasi VARCHAR(150) NULL,
  status ENUM('AKTIF','NONAKTIF') NOT NULL DEFAULT 'AKTIF',
  CONSTRAINT fk_schedule_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT fk_schedule_poli FOREIGN KEY (poli_id) REFERENCES poli(id),
  INDEX idx_schedule_date (tanggal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reminders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT UNSIGNED NOT NULL,
  tanggal DATE NOT NULL,
  reminder_type VARCHAR(30) NOT NULL DEFAULT 'HARI_INI',
  message TEXT NOT NULL,
  status ENUM('PENDING','READY','OPENED','SENT','FAILED') NOT NULL DEFAULT 'READY',
  opened_at DATETIME NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_reminder (tanggal, doctor_id, reminder_type),
  CONSTRAINT fk_reminder_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reminder_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reminder_id INT UNSIGNED NOT NULL,
  action VARCHAR(30) NOT NULL,
  user_name VARCHAR(100) NOT NULL DEFAULT 'Admin',
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_log_reminder FOREIGN KEY (reminder_id) REFERENCES reminders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(80) PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO settings (`key`, `value`) VALUES
('nama_rs', 'RS Sehat Sentosa'),
('template', 'Assalamualaikum, {{nama_dokter}}.\n\nMengingatkan bahwa Anda memiliki jadwal praktik:\n\n📅 {{tanggal}}\n🏥 {{nama_rs}}\n🩺 Poli: {{nama_poli}}\n🕐 Jam: {{jam_mulai}} - {{jam_selesai}}\n📍 Lokasi: {{lokasi}}\n\nJumlah Pasien : {{jumlah_pasien}}\nJumlah Inden Pasien : {{inden}}\n\nApakah ada pembatasan untuk kuota pasien nggih dokter?\n\nTerima kasih.\nWassalamualaikum, Wr.Wb');
