# Multi-Database Server Connection Guide

## Overview
Aplikasi ini mendukung koneksi ke multiple database servers di host berbeda dengan port yang dapat dikonfigurasi.

## Konfigurasi Database

Semua konfigurasi database disimpan di file `config.php` dalam array `$databases`.

### Format Template
```php
'nama_alias' => [
    'host' => 'ip_or_hostname',
    'port' => 3306,              // Opsional, default 3306
    'user' => 'username',
    'pass' => 'password',
    'name' => 'database_name'
]
```

## Database Server yang Tersedia

### 1. Local Database (localhost)
- **Alias**: `local`
- **Host**: localhost
- **Port**: 3306
- **Database**: dokter_reminder
- **Penggunaan**: Menyimpan setting dan konfigurasi aplikasi lokal

### 2. RSiklaten Database (db_67)
- **Alias**: `rsiklaten`
- **Host**: localhost
- **Port**: 3306
- **Database**: db_67
- **Penggunaan**: Master data dokter dan antrian pasien

### 3. Server 1 (Template)
- **Alias**: `server1`
- **Host**: 192.168.1.100
- **Port**: 3306
- **Database**: database_server1
- **Status**: Template - perlu dikonfigurasi

### 4. Server 2 (Template)
- **Alias**: `server2`
- **Host**: 192.168.1.101
- **Port**: 3307 (custom port)
- **Database**: database_server2
- **Status**: Template - perlu dikonfigurasi

## Cara Menggunakan

### Koneksi Ke Database
```php
// Koneksi ke local database
$pdo = get_db('local');

// Koneksi ke rsiklaten database
$pdo = get_db('rsiklaten');

// Koneksi ke server1
$pdo = get_db('server1');

// Koneksi ke server2
$pdo = get_db('server2');
```

### Menjalankan Query
```php
$pdo = get_db('server1');
$result = $pdo->prepare('SELECT * FROM table_name WHERE id =?');
$result->execute([1]);
$data = $result->fetchAll();
```

## Menambah Database Server Baru

1. Edit file `config.php`
2. Tambahkan entry baru dalam array `$databases`:
```php
'server3' => [
    'host' => '192.168.1.102',
    'port' => 3306,
    'user' => 'username',
    'pass' => 'password',
    'name' => 'database_name'
]
```
3. Gunakan dengan `get_db('server3')`

## Error Handling

Jika koneksi gagal, aplikasi akan:
1. Log error ke file log
2. Throw exception dengan pesan detail
3. Menampilkan database mana yang gagal dan alasannya

## Fungsi Backward Compatibility

Untuk backward compatibility dengan kode lama:
- `db()` - mengembalikan koneksi ke database 'local'
- `ext_db()` - mengembalikan koneksi ke database 'rsiklaten'

## Tips Keamanan

1. **Jangan commit password**: Gunakan environment variables atau file config terpisah
2. **Gunakan SSL/TLS**: Untuk koneksi ke remote server, aktifkan enkripsi
3. **Batasi akses**: Gunakan username dengan privilege minimal yang diperlukan
4. **Backup credentials**: Jaga file config.php dengan aman

## Testing Connection

Untuk test koneksi ke database tertentu, gunakan script sederhana:
```php
<?php
require_once 'db.php';
try {
    $pdo = get_db('server1');
    $result = $pdo->query('SELECT 1');
    echo "Connection to server1 successful!";
} catch (Exception $e) {
    echo "Connection failed: ". $e->getMessage();
}
?>