CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(255) NULL,
    doctor_id VARCHAR(50) NULL,
    phone VARCHAR(30) NOT NULL,
    direction ENUM('IN', 'OUT') NOT NULL,
    message_type VARCHAR(30) NOT NULL DEFAULT 'text',
    message TEXT NULL,
    status VARCHAR(30) NULL,
    sent_at DATETIME NULL,
    received_at DATETIME NULL,
    read_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_phone (phone),
    INDEX idx_doctor_id (doctor_id),
    INDEX idx_created_at (created_at),
    INDEX idx_unread (doctor_id, direction, read_at),
    UNIQUE KEY uq_message_id (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
