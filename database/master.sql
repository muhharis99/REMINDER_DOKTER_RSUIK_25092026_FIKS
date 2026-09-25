CREATE DATABASE IF NOT EXISTS rsi_byl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE rsi_byl;

CREATE TABLE IF NOT EXISTS master_dokter (
  dokter_kd VARCHAR(50) PRIMARY KEY,
  dokter_nama VARCHAR(150) NOT NULL,
  spesialis VARCHAR(150),
  dokter_no_wa VARCHAR(30) NOT NULL,
  status ENUM('AKTIF','NONAKTIF') NOT NULL DEFAULT 'AKTIF'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dokter_jadwal (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dokter_kd VARCHAR(50) NOT NULL,
  poli_nama VARCHAR(150),
  jam_mulai TIME NOT NULL,
  jam_selesai TIME NOT NULL,
  lokasi VARCHAR(150),
  status ENUM('AKTIF','NONAKTIF') NOT NULL DEFAULT 'AKTIF',
  CONSTRAINT fk_jadwal_dokter FOREIGN KEY (dokter_kd) REFERENCES master_dokter(dokter_kd)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dokter_jadwal_kuota (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dokter_jadwal_id INT UNSIGNED NOT NULL,
  hari VARCHAR(20),
  tanggal DATE NOT NULL,
  status ENUM('AKTIF','NONAKTIF') NOT NULL DEFAULT 'AKTIF',
  CONSTRAINT fk_kuota_jadwal FOREIGN KEY (dokter_jadwal_id) REFERENCES dokter_jadwal(id),
  INDEX idx_tanggal (tanggal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;