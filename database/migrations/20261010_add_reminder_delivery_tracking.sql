-- Back up the dokter_reminder database before running this migration.
-- Run once against the actual application database after verifying its current schema.
-- Additive delivery tracking; existing reminder rows and their IDs are preserved.

ALTER TABLE reminders
    MODIFY COLUMN status ENUM(
        'PENDING',
        'READY',
        'OPENED',
        'PROCESSING',
        'UNKNOWN',
        'SENT',
        'FAILED'
    ) NOT NULL DEFAULT 'READY',
    ADD COLUMN gateway_request_id CHAR(36) NULL AFTER sent_at,
    ADD COLUMN gateway_message_id VARCHAR(255) NULL AFTER gateway_request_id,
    ADD COLUMN gateway_ack TINYINT UNSIGNED NULL AFTER gateway_message_id,
    ADD COLUMN delivery_error VARCHAR(500) NULL AFTER gateway_ack,
    ADD COLUMN delivery_started_at DATETIME NULL AFTER delivery_error,
    ADD COLUMN delivery_updated_at DATETIME NULL AFTER delivery_started_at,
    ADD UNIQUE KEY uq_reminders_gateway_request_id (gateway_request_id),
    ADD KEY idx_reminders_delivery (status, delivery_updated_at);
