'use strict';

const crypto = require('crypto');

function ackLabel(ack) {
    const value = Number(ack);
    if (value >= 3) return 'READ';
    if (value >= 2) return 'DELIVERED';
    if (value >= 1) return 'SERVER_ACCEPTED';
    return 'UNKNOWN';
}

function normalizePhone(value) {
    let phone = String(value || '').replace(/\D+/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);
    return phone;
}

function isValidIndonesianPhone(value) {
    return /^62\d{8,15}$/.test(normalizePhone(value));
}

function maskPhone(value) {
    const phone = String(value || '').split('@')[0].replace(/\D+/g, '');
    if (phone.length < 7) return phone ? '***' : '-';
    return phone.slice(0, 3) + '*'.repeat(Math.max(2, phone.length - 5)) + phone.slice(-2);
}

function tokenEquals(actual, expected) {
    if (!actual || !expected) return false;
    const a = Buffer.from(String(actual));
    const b = Buffer.from(String(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
    ackLabel,
    normalizePhone,
    isValidIndonesianPhone,
    maskPhone,
    tokenEquals
};
