'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    ackLabel,
    normalizePhone,
    isValidIndonesianPhone,
    maskPhone,
    tokenEquals
} = require('../lib/gateway-utils');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('ACK labels preserve server accepted, delivered, and read distinctions', () => {
    assert.equal(ackLabel(0), 'UNKNOWN');
    assert.equal(ackLabel(1), 'SERVER_ACCEPTED');
    assert.equal(ackLabel(2), 'DELIVERED');
    assert.equal(ackLabel(3), 'READ');
    assert.equal(ackLabel(4), 'READ');
});

test('Indonesian phone numbers normalize without changing canonical numbers', () => {
    assert.equal(normalizePhone('0812-3456-7890'), '6281234567890');
    assert.equal(normalizePhone('+62 812 3456 7890'), '6281234567890');
    assert.equal(normalizePhone('6281234567890'), '6281234567890');
    assert.equal(isValidIndonesianPhone('081234567890'), true);
    assert.equal(isValidIndonesianPhone('6281234567890'), true);
    assert.equal(isValidIndonesianPhone('123'), false);
    assert.equal(isValidIndonesianPhone('62ABC'), false);
});

test('phone logging masks full target numbers', () => {
    const masked = maskPhone('6281234567890@c.us');
    assert.notEqual(masked, '6281234567890');
    assert.equal(masked.startsWith('628'), true);
    assert.equal(masked.endsWith('90'), true);
});

test('API token comparison rejects empty or different tokens', () => {
    assert.equal(tokenEquals('a-secret-token', 'a-secret-token'), true);
    assert.equal(tokenEquals('a-secret-token', 'another-token'), false);
    assert.equal(tokenEquals('', ''), false);
    assert.equal(tokenEquals(undefined, 'a-secret-token'), false);
});

test('send endpoint uses authenticated server-to-server API and delivery callback', () => {
    const server = read('server.js');
    assert.match(server, /app\.post\('\/send', requireGatewayApiToken,/);
    assert.match(server, /if \(!WA_CALLBACK_URL \|\| !WA_CALLBACK_TOKEN\)/);
    assert.match(server, /await finishDelivery\(requestId,\s*\{\s*status: 'UNKNOWN'/);
    assert.match(server, /activeRecipientSends/);
    assert.match(server, /app\.get\('\/send-status\/:requestId', requireGatewayApiToken/);
});

test('dashboard never mutates delivery state from success/error query strings', () => {
    const index = read('index.php');
    assert.match(index, /gateway_proxy\.php\?action=send/);
    assert.match(index, /gateway_proxy\.php\?action=delivery/);
    assert.doesNotMatch(index, /action=sent&id=/);
    assert.doesNotMatch(index, /action=failed&id=/);
    assert.match(index, /Periksa Riwayat Dulu/);
});

test('delivery migration is additive and models uncertain delivery explicitly', () => {
    const migration = read('database/migrations/20261010_add_reminder_delivery_tracking.sql');
    assert.match(migration, /'PROCESSING'/);
    assert.match(migration, /'UNKNOWN'/);
    assert.match(migration, /ADD COLUMN gateway_request_id/);
    assert.match(migration, /ADD UNIQUE KEY uq_reminders_gateway_request_id/);
    assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM)\b/i);
});

test('gateway callback is authenticated and only updates the matching request ID', () => {
    const callback = read('gateway_callback.php');
    assert.match(callback, /hash_equals\(\$expectedToken, \$suppliedToken\)/);
    assert.match(callback, /WHERE id = \?/);
    assert.match(callback, /AND gateway_request_id = \?/);
    assert.match(callback, /\['SENT', 'FAILED', 'UNKNOWN'\]/);
});

test('tracked configuration contains no literal database passwords', () => {
    const config = read('config.php');
    assert.doesNotMatch(config, /'pass'\s*=>\s*'[^']+'/i);
    assert.match(config, /config\.local\.php/);
});

test('manifest and lockfile resolve the same pinned WhatsApp fork', () => {
    const manifest = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    const spec = manifest.dependencies['whatsapp-web.js'];
    assert.equal(lock.packages[''].dependencies['whatsapp-web.js'], spec);
    assert.equal(
        lock.packages['node_modules/whatsapp-web.js'].resolved,
        'git+https://github.com/MySSoN/whatsapp-web.js.git#4d1f29e812a69776919f89c4eb380383dbca1136'
    );
});

test('fresh schema stores external doctor codes as strings', () => {
    const schema = read('database/schema.sql');
    const reminders = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS reminders'), schema.indexOf('CREATE TABLE IF NOT EXISTS reminder_logs'));
    assert.match(reminders, /doctor_id VARCHAR\(50\) NOT NULL/);
    assert.doesNotMatch(reminders, /FOREIGN KEY \(doctor_id\) REFERENCES doctors\(id\)/);
    assert.match(reminders, /KEY idx_reminder_doctor \(doctor_id\)/);
});

test('direct gateway root does not expose QR and defaults to loopback', () => {
    const server = read('server.js');
    assert.match(server, /WA_HOST \|\| '127\.0\.0\.1'/);
    assert.match(server, /app\.get\('\/', \(_req, res\) =>/);
    assert.match(server, /app\.get\('\/qr', requireGatewayApiToken/);
    assert.doesNotMatch(server.slice(server.indexOf("app.get('/',"), server.indexOf("app.get('/qr'")), /qrDataUrl/);
});

test('QR page calls same-origin proxy and accepts only PNG data URLs', () => {
    const page = read('gateway_qr.php');
    assert.match(page, /gateway_proxy\.php\?action=qr/);
    assert.match(page, /data:image\/png;base64,/);
    assert.doesNotMatch(page, /:3210/);
});

test('delivery proxy distinguishes config errors from ambiguous transport failures', () => {
    const proxy = read('gateway_proxy.php');
    assert.match(proxy, /configuration_error/);
    assert.match(proxy, /Do not mark FAILED: the gateway may have accepted the request before the connection broke/);
    assert.match(proxy, /return \['configuration_error'/);
});

test('optional schema alignment migration clearly guards the known FK schema', () => {
    const migration = read('database/migrations/20261010_align_reminder_doctor_key.sql');
    assert.match(migration, /Only for databases that match the older repository schema\.sql exactly/);
    assert.match(migration, /SHOW CREATE TABLE reminders/);
    assert.match(migration, /DROP FOREIGN KEY fk_reminder_doctor/);
    assert.match(migration, /MODIFY COLUMN doctor_id VARCHAR\(50\) NOT NULL/);
});

test('same-origin proxy compares scheme, host, and port', () => {
    const proxy = read('gateway_proxy.php');
    assert.match(proxy, /\$originScheme === \$requestScheme/);
    assert.match(proxy, /\$originHost === \$requestHost/);
    assert.match(proxy, /\$originPort === \$requestPort/);
});

test('callback supports forwarded Authorization headers without weakening token check', () => {
    const callback = read('gateway_callback.php');
    assert.match(callback, /REDIRECT_HTTP_AUTHORIZATION/);
    assert.match(callback, /strcasecmp\(\(string\) \$headerName, 'Authorization'\)/);
    assert.match(callback, /hash_equals\(\$expectedToken, \$suppliedToken\)/);
});

test('gateway rejects concurrent sends because one WhatsApp client is shared', () => {
    const server = read('server.js');
    assert.match(server, /let activeGatewaySendRequest = null/);
    assert.match(server, /Gateway sedang memproses pesan lain/);
    assert.match(server, /if \(activeGatewaySendRequest === requestId\) \{\s*activeGatewaySendRequest = null;/);
});
