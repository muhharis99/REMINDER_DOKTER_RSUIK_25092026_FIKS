-- Only for databases that match the older repository schema.sql exactly:
-- reminders.doctor_id is INT UNSIGNED and fk_reminder_doctor references doctors(id).
-- First take and verify a backup. Run SHOW CREATE TABLE reminders and SHOW CREATE TABLE doctors.
-- If the foreign-key name or types differ, STOP and adapt the migration manually.
-- Converting integer doctor IDs preserves their textual representation but does not map old IDs
-- to external dokter_kd codes automatically. Existing reminders should be reconciled before use.

ALTER TABLE reminders
    DROP FOREIGN KEY fk_reminder_doctor,
    MODIFY COLUMN doctor_id VARCHAR(50) NOT NULL,
    ADD KEY idx_reminder_doctor (doctor_id);
