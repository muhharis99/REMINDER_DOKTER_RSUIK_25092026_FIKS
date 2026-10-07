const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = Number(process.env.WA_PORT || 3210);
const HOST = process.env.WA_HOST || '0.0.0.0';
const CHAT_INCOMING_URL = process.env.CHAT_INCOMING_URL ||
    'http://127.0.0.1/dokter-reminder/api/chat/incoming.php';
const CHAT_IDENTITY_FILE = path.join(__dirname, '.chat_identity_map.json');
const WA_WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1044810432-alpha';
const WA_WEB_VERSION_URL =
    process.env.WA_WEB_VERSION_URL ||
    `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WA_WEB_VERSION}.html`;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '128kb' }));

let waState = 'STARTING';
let qrDataUrl = null;
let lastError = null;
let incomingQueueProcessing = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let initializingWhatsApp = false;
let readyWatchdogTimer = null;
let authenticatedAt = 0;

const incomingQueue = new Map();
const completedIncoming = new Map();
const contactIdentityMap = new Map();

const SEND_TIMEOUT_MS = 20000;
const ACK_VERIFY_TIMEOUT_MS = 8000;
const ACK_VERIFY_INTERVAL_MS = 500;

const timeFormatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
});

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'dokter-reminder',
        dataPath: './.wwebjs_auth'
    }),
    webVersion: WA_WEB_VERSION,
    webVersionCache: {
        type: 'remote',
        remotePath: WA_WEB_VERSION_URL,
        strict: true
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--no-default-browser-check'
        ]
    }
});

function extractMessageId(message) {
    const candidates = [
        message?.id?._serialized,
        message?.id?.$1,
        message?._data?.id?._serialized,
        message?._data?.id?.$1
    ];

    for (const candidate of candidates) {
        const value = String(candidate || '').trim();

        if (value !== '' && value !== '[object Object]') {
            return value;
        }
    }

    try {
        if (
            message?.id &&
            typeof message.id.toString === 'function' &&
            message.id.toString !== Object.prototype.toString
        ) {
            const value = String(message.id.toString()).trim();

            if (value !== '' && value !== '[object Object]') {
                return value;
            }
        }
    } catch (error) {
    }

    return null;
}

function normalizePhone(value) {
    let phone = String(value || '').replace(/\D+/g, '');

    if (phone.startsWith('0')) {
        phone = '62' + phone.slice(1);
    }

    return phone;
}

function isValidIndonesianPhone(value) {
    return /^62\d{8,15}$/.test(normalizePhone(value));
}

function loadIdentityMap() {
    try {
        if (!fs.existsSync(CHAT_IDENTITY_FILE)) {
            return;
        }

        const raw = fs.readFileSync(CHAT_IDENTITY_FILE, 'utf8');
        const data = JSON.parse(raw);

        if (!data || typeof data !== 'object') {
            return;
        }

        Object.entries(data).forEach(([identityId, identity]) => {
            if (!identity || typeof identity !== 'object') {
                return;
            }

            const phone = normalizePhone(identity.phone);
            const doctorId = String(identity.doctor_id || '').trim();

            if (identityId && isValidIndonesianPhone(phone)) {
                contactIdentityMap.set(identityId, {
                    phone,
                    doctor_id: doctorId
                });
            }
        });
    } catch (error) {
        console.error('Gagal membaca mapping chat dokter:', error.message || error);
    }
}

function saveIdentityMap() {
    try {
        const data = {};

        for (const [identityId, identity] of contactIdentityMap.entries()) {
            data[identityId] = identity;
        }

        fs.writeFileSync(
            CHAT_IDENTITY_FILE,
            JSON.stringify(data, null, 2),
            'utf8'
        );
    } catch (error) {
        console.error('Gagal menyimpan mapping chat dokter:', error.message || error);
    }
}

function rememberIdentity(identityId, phone, doctorId = '') {
    const id = String(identityId || '').trim();
    const normalizedPhone = normalizePhone(phone);
    const normalizedDoctorId = String(doctorId || '').trim();

    if (id === '' || !isValidIndonesianPhone(normalizedPhone)) {
        return;
    }

    const existing = contactIdentityMap.get(id) || {};

    contactIdentityMap.set(id, {
        phone: normalizedPhone,
        doctor_id: normalizedDoctorId || existing.doctor_id || ''
    });

    saveIdentityMap();
}

loadIdentityMap();

function clearReadyWatchdog() {
    if (readyWatchdogTimer) {
        clearTimeout(readyWatchdogTimer);
        readyWatchdogTimer = null;
    }
}

function scheduleReadyWatchdog() {
    clearReadyWatchdog();

    readyWatchdogTimer = setTimeout(async () => {
        readyWatchdogTimer = null;

        if (waState === 'READY') {
            return;
        }

        if (waState !== 'AUTHENTICATED' || !authenticatedAt) {
            return;
        }

        const elapsedSeconds = Math.floor(
            (Date.now() - authenticatedAt) / 1000
        );

        console.error(
            `WhatsApp READY timeout setelah ${elapsedSeconds} detik. WA Web=${WA_WEB_VERSION}. Client akan diinisialisasi ulang dengan sesi LocalAuth yang sama.`
        );

        try {
            await client.destroy();
        } catch (error) {
            console.warn(
                'Gagal destroy client saat READY watchdog:',
                error.message || error
            );
        }

        waState = 'RECONNECTING';
        lastError = `READY timeout setelah ${elapsedSeconds} detik`;

        initializeWhatsApp('ready-watchdog').catch((error) => {
            console.error('Reinitialize dari READY watchdog gagal:', error);
            scheduleWhatsAppReconnect(
                error.message || 'READY watchdog gagal'
            );
        });
    }, 45000);
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleWhatsAppReconnect(reason) {
    if (reconnectTimer || initializingWhatsApp || waState === 'READY') {
        return;
    }

    reconnectAttempts++;
    const delay = Math.min(
        30000,
        Math.max(5000, reconnectAttempts * 5000)
    );

    waState = 'RECONNECTING';
    lastError = String(reason || 'WhatsApp terputus');

    console.warn(
        `WhatsApp akan mencoba reconnect dalam ${Math.ceil(delay / 1000)} detik. Percobaan #${reconnectAttempts}`
    );

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        initializeWhatsApp('reconnect').catch((error) => {
            console.error('Reconnect WhatsApp gagal:', error);
            scheduleWhatsAppReconnect(error.message || 'Reconnect gagal');
        });
    }, delay);
}

async function initializeWhatsApp(reason = 'startup') {
    if (initializingWhatsApp) {
        return;
    }

    clearReconnectTimer();
    initializingWhatsApp = true;
    waState = reason === 'reconnect' ? 'RECONNECTING' : 'STARTING';

    try {
        await client.initialize();
        reconnectAttempts = 0;
        lastError = null;
    } catch (error) {
        waState = 'ERROR';
        lastError = error.message || String(error);
        console.error('Gagal menginisialisasi WhatsApp:', error);
        throw error;
    } finally {
        initializingWhatsApp = false;
    }
}

function now() {
    return timeFormatter.format(new Date());
}

function terminalLog(status, data = {}) {
    const lines = [
        '',
        '============================================================',
        `[${now()}] ${status}`
    ];

    Object.entries(data).forEach(([key, value]) => {
        lines.push(`${key}: ${value ?? '-'}`);
    });

    lines.push('============================================================');

    console.log(lines.join('\n'));
}

function incomingMessageContent(message) {
    const type = String(message.type || 'chat').toLowerCase();
    const body = String(message.body || '').trim();

    if (body !== '') {
        return body;
    }

    if (type === 'image') {
        return '[IMAGE]';
    }

    if (type === 'document') {
        return '[DOCUMENT]';
    }

    if (type === 'audio' || type === 'ptt') {
        return '[AUDIO]';
    }

    if (type === 'video') {
        return '[VIDEO]';
    }

    return '[MESSAGE]';
}

function incomingMessageType(message) {
    const type = String(message.type || 'chat').toLowerCase();

    if (type === 'chat') {
        return 'text';
    }

    if (type === 'ptt') {
        return 'audio';
    }

    return type;
}

function isOutgoingMessage(message) {
    return message?.fromMe === true ||
        message?.id?.fromMe === true ||
        String(message?.id?.fromMe || '').toLowerCase() === 'true';
}

function phoneCandidatesFromContact(contact) {
    if (!contact) {
        return [];
    }

    return [
        contact.number,
        contact.id?.user,
        contact.phoneNumber?.user,
        contact.phoneNumber?._serialized,
        contact._data?.number,
        contact._data?.phoneNumber?.user,
        contact._data?.phoneNumber?._serialized,
        contact._data?.id?.user
    ];
}

function identityById(identityId) {
    const id = String(identityId || '').trim();

    if (id === '') {
        return null;
    }

    return contactIdentityMap.get(id) || null;
}

async function resolveIncomingIdentity(message) {
    const sourceIds = [
        message?.author,
        message?.from,
        message?.id?.remote?._serialized,
        message?.id?.remote?.$1,
        message?._data?.id?.remote?._serialized,
        message?._data?.id?.remote?.$1
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

    for (const sourceId of sourceIds) {
        const mapped = identityById(sourceId);

        if (mapped) {
            return mapped;
        }
    }

    try {
        const chat = await message.getChat();
        const chatIds = [
            chat?.id?._serialized,
            chat?.id?.user,
            chat?._data?.id?._serialized,
            chat?._data?.id?.user
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean);

        for (const chatId of chatIds) {
            const mapped = identityById(chatId);

            if (mapped) {
                sourceIds.forEach((sourceId) => {
                    rememberIdentity(sourceId, mapped.phone, mapped.doctor_id);
                });

                return mapped;
            }
        }
    } catch (error) {
        console.warn('Gagal membaca chat incoming:', error.message || error);
    }

    for (const sourceId of sourceIds) {
        if (!sourceId.endsWith('@c.us')) {
            continue;
        }

        const directPhone = normalizePhone(sourceId.split('@')[0]);

        if (isValidIndonesianPhone(directPhone)) {
            return {
                phone: directPhone,
                doctor_id: ''
            };
        }
    }

    const rawCandidates = [
        message?._data?.senderObj?.phoneNumber?.user,
        message?._data?.senderObj?.phoneNumber?._serialized,
        message?._data?.from?.phoneNumber?.user,
        message?._data?.from?.phoneNumber?._serialized,
        message?.rawData?.senderObj?.phoneNumber?.user,
        message?.rawData?.senderObj?.phoneNumber?._serialized
    ];

    for (const candidate of rawCandidates) {
        const phone = normalizePhone(candidate);

        if (isValidIndonesianPhone(phone)) {
            return {
                phone,
                doctor_id: ''
            };
        }
    }

    try {
        const contact = await message.getContact();

        for (const candidate of phoneCandidatesFromContact(contact)) {
            const phone = normalizePhone(candidate);

            if (isValidIndonesianPhone(phone)) {
                const contactId = String(contact?.id?._serialized || '').trim();

                if (contactId !== '') {
                    rememberIdentity(contactId, phone, '');
                }

                sourceIds.forEach((sourceId) => {
                    rememberIdentity(sourceId, phone, '');
                });

                return {
                    phone,
                    doctor_id: ''
                };
            }
        }
    } catch (error) {
        console.warn('Gagal resolve contact incoming:', error.message || error);
    }

    terminalLog('CHAT DOKTER MASUK BELUM TERIDENTIFIKASI', {
        Status: 'SENDER_TIDAK_DIKENAL',
        Source: sourceIds.join(', ') || '-',
        MessageId: message?.id?._serialized || '-'
    });

    return null;
}

async function incomingPayload(message) {
    if (!message || isOutgoingMessage(message)) {
        return null;
    }

    const source = String(message.author || message.from || '');

    if (source === '' ||
        source === 'status@broadcast' ||
        source.endsWith('@g.us') ||
        source.endsWith('@broadcast')) {
        return null;
    }

    const identity = await resolveIncomingIdentity(message);
    const messageId = extractMessageId(message) || '';

    if (!identity || !messageId) {
        return null;
    }

    const timestamp = Number(message.timestamp || 0);
    const receivedAt = timestamp > 0
        ? new Date(timestamp * 1000).toISOString()
        : new Date().toISOString();

    return {
        message_id: messageId,
        doctor_id: identity.doctor_id || '',
        phone: identity.phone,
        message_type: incomingMessageType(message),
        message: incomingMessageContent(message),
        received_at: receivedAt
    };
}

function retryDelay(attempts) {
    const delays = [
        1000,
        2000,
        5000,
        10000,
        20000,
        30000,
        60000
    ];

    return delays[Math.min(attempts, delays.length - 1)];
}

function cleanupCompletedIncoming() {
    const cutoff = Date.now() - (30 * 60 * 1000);

    for (const [messageId, completedAt] of completedIncoming.entries()) {
        if (completedAt < cutoff) {
            completedIncoming.delete(messageId);
        }
    }
}

async function enqueueIncomingMessage(message, eventName) {
    const payload = await incomingPayload(message);

    if (!payload) {
        return;
    }

    const messageId = payload.message_id;

    cleanupCompletedIncoming();

    if (completedIncoming.has(messageId) || incomingQueue.has(messageId)) {
        return;
    }

    incomingQueue.set(messageId, {
        payload,
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        eventName
    });

    terminalLog('CHAT DOKTER MASUK DITERIMA', {
        Status: 'MASUK ANTREAN',
        DoctorId: payload.doctor_id || '-',
        Pengirim: payload.phone,
        MessageId: messageId,
        Event: eventName,
        Antrean: incomingQueue.size
    });

    processIncomingQueue();
}

async function deliverIncomingItem(messageId, item) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(CHAT_INCOMING_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(item.payload),
            signal: controller.signal
        });

        const responseText = await response.text();

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}: ${responseText.slice(0, 250)}`
            );
        }

        let result = null;

        try {
            result = JSON.parse(responseText);
        } catch (error) {
            throw new Error('Respons webhook incoming bukan JSON yang valid.');
        }

        if (!result || result.success !== true) {
            throw new Error(
                result?.message || 'Webhook incoming tidak mengembalikan status sukses.'
            );
        }

        incomingQueue.delete(messageId);
        completedIncoming.set(messageId, Date.now());

        terminalLog('CHAT DOKTER MASUK DISIMPAN', {
            Status: 'BERHASIL',
            DoctorId: result.doctor_id || item.payload.doctor_id || '-',
            Pengirim: result.phone || item.payload.phone,
            MessageId: messageId,
            Percobaan: item.attempts + 1,
            Antrean: incomingQueue.size
        });
    } catch (error) {
        item.attempts += 1;
        item.lastError = error.message || String(error);
        item.nextAttemptAt = Date.now() + retryDelay(item.attempts - 1);
        incomingQueue.set(messageId, item);

        terminalLog('CHAT DOKTER MASUK MENUNGGU RETRY', {
            Status: 'RETRY',
            DoctorId: item.payload.doctor_id || '-',
            Pengirim: item.payload.phone,
            MessageId: messageId,
            Percobaan: item.attempts,
            UlangDalamDetik: Math.round(
                (item.nextAttemptAt - Date.now()) / 1000
            ),
            Alasan: item.lastError,
            Antrean: incomingQueue.size
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function processIncomingQueue() {
    if (incomingQueueProcessing) {
        return;
    }

    incomingQueueProcessing = true;

    try {
        const currentTime = Date.now();

        for (const [messageId, item] of incomingQueue.entries()) {
            if (item.nextAttemptAt > currentTime) {
                continue;
            }

            await deliverIncomingItem(messageId, item);
        }
    } finally {
        incomingQueueProcessing = false;
    }
}

async function repairWhatsAppWebCompatibility() {
    if (!client.pupPage) {
        return false;
    }

    try {
        const result = await client.pupPage.evaluate(() => {
            try {
                const MsgKeyModule = window.require?.('WAWebMsgKey');
                const MsgKeyProto = MsgKeyModule?.prototype;

                if (!MsgKeyProto) {
                    return {
                        ok: false,
                        reason: 'WAWebMsgKey prototype tidak ditemukan.'
                    };
                }

                const existing = Object.getOwnPropertyDescriptor(
                    MsgKeyProto,
                    '_serialized'
                );

                if (!existing) {
                    Object.defineProperty(MsgKeyProto, '_serialized', {
                        configurable: true,
                        get() {
                            return this.toString();
                        },
                        set(value) {
                            Object.defineProperty(this, '_serialized', {
                                configurable: true,
                                enumerable: true,
                                writable: true,
                                value
                            });
                        }
                    });

                    return {
                        ok: true,
                        patched: true
                    };
                }

                return {
                    ok: true,
                    patched: false
                };
            } catch (error) {
                return {
                    ok: false,
                    reason: error?.message || String(error)
                };
            }
        });

        if (result?.ok) {
            console.log(
                `WA Web MsgKey compatibility: ${result.patched ? 'PATCHED' : 'ALREADY_OK'}`
            );
            return true;
        }

        console.warn(
            'WA Web MsgKey compatibility gagal:',
            result?.reason || 'unknown error'
        );

        return false;
    } catch (error) {
        console.warn(
            'Gagal memasang WA Web MsgKey compatibility:',
            error.message || error
        );
        return false;
    }
}

function sendMatchScore(pending, message) {
    if (!message || !isOutgoingMessage(message)) {
        return 0;
    }

    const to = String(
        message?.to ||
        message?._data?.to ||
        message?.id?.remote ||
        message?._data?.id?.remote ||
        ''
    ).trim();

    const body = String(
        message?.body ||
        message?._data?.body ||
        ''
    );

    let score = 0;

    if (pending.chatId !== '' && to === pending.chatId) {
        score += 100;
    }

    const targetPhone = normalizePhone(
        to.split('@')[0]
    );

    if (
        pending.phone !== '' &&
        targetPhone !== '' &&
        targetPhone === pending.phone
    ) {
        score += 80;
    }

    if (pending.body !== '' && body === pending.body) {
        score += 50;
    }

    if (
        pending.messageId &&
        extractMessageId(message) === pending.messageId
    ) {
        score += 200;
    }

    return score;
}

function clearOutgoingTracker(token) {
    const tracker = pendingOutgoingSends.get(token);

    if (!tracker) {
        return null;
    }

    pendingOutgoingSends.delete(token);

    if (tracker.timeout) {
        clearTimeout(tracker.timeout);
        tracker.timeout = null;
    }

    return tracker;
}

function clearOutgoingTrackersFor({ chatId, phone, body }) {
    const normalizedChatId = String(chatId || '');
    const normalizedPhone = normalizePhone(phone);
    const normalizedBody = String(body || '');

    for (const [token, tracker] of pendingOutgoingSends.entries()) {
        const sameChat =
            normalizedChatId !== '' &&
            tracker.chatId === normalizedChatId;

        const samePhone =
            normalizedPhone !== '' &&
            tracker.phone === normalizedPhone;

        const sameBody =
            normalizedBody !== '' &&
            tracker.body === normalizedBody;

        if ((sameChat || samePhone) && sameBody) {
            clearOutgoingTracker(token);
        }
    }
}

function waitForOutgoingAck({ chatId, phone, body, messageId = null }) {
    const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            const tracker = clearOutgoingTracker(token);

            if (tracker) {
                reject(new Error(
                    `Tidak menerima message_ack untuk tujuan ${phone} dalam ${SEND_TIMEOUT_MS / 1000} detik.`
                ));
            }
        }, SEND_TIMEOUT_MS);

        pendingOutgoingSends.set(token, {
            token,
            chatId: String(chatId || ''),
            phone: normalizePhone(phone),
            body: String(body || ''),
            messageId: messageId ? String(messageId) : null,
            timeout,
            createdAt: Date.now(),
            resolve,
            reject
        });
    });
}

async function sendMessageWithTimeout(chatId, content) {
    let timer = null;

    try {
        return await Promise.race([
            client.sendMessage(chatId, content, {
                waitUntilMsgSent: true,
                ignoreQuoteErrors: true,
                sendSeen: false
            }),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(
                        `Timeout ${SEND_TIMEOUT_MS / 1000} detik: WhatsApp tidak mengonfirmasi hasil pengiriman ke server.`
                    ));
                }, SEND_TIMEOUT_MS);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

async function verifyServerAck(sentMessage) {
    const deadline = Date.now() + ACK_VERIFY_TIMEOUT_MS;

    while (Date.now() < deadline) {
        const ack = Number(sentMessage?.ack ?? 0);

        if (ack >= 1) {
            return ack;
        }

        if (typeof sentMessage?.reload === 'function') {
            try {
                await sentMessage.reload();
                const reloadedAck = Number(sentMessage?.ack ?? 0);

                if (reloadedAck >= 1) {
                    return reloadedAck;
                }
            } catch (error) {
                console.warn(
                    'Gagal refresh status ACK pesan:',
                    error.message || error
                );
            }
        }

        await new Promise((resolve) => {
            setTimeout(resolve, ACK_VERIFY_INTERVAL_MS);
        });
    }

    throw new Error(
        `Pesan berhasil dibuat tetapi ACK server WhatsApp tidak diterima dalam ${ACK_VERIFY_TIMEOUT_MS / 1000} detik. Status TIDAK ditandai terkirim untuk mencegah false-positive.`
    );
}

setInterval(() => {
    processIncomingQueue();
}, 2000);

client.on('loading_screen', (percent, message) => {
    console.log(
        `WhatsApp loading: ${percent}% ${message || ''} | WA Web=${WA_WEB_VERSION}`
    );
});

client.on('change_state', (state) => {
    console.log(
        `WhatsApp state berubah: ${state} | WA Web=${WA_WEB_VERSION}`
    );
});

client.on('qr', async (qr) => {
    try {
        qrDataUrl = await QRCode.toDataURL(qr, {
            width: 240,
            margin: 1
        });

        waState = 'QR_READY';
        lastError = null;

        console.log(
            'QR WhatsApp siap. Buka browser ke http://localhost:' +
            PORT
        );
    } catch (error) {
        lastError = error.message;
        waState = 'ERROR';
        console.error('Gagal membuat QR:', error);
    }
});

client.on('authenticated', () => {
    waState = 'AUTHENTICATED';
    qrDataUrl = null;
    lastError = null;
    authenticatedAt = Date.now();

    console.log(
        `WhatsApp berhasil diautentikasi. Menunggu READY... WA Web=${WA_WEB_VERSION}`
    );

    scheduleReadyWatchdog();
});

client.on('ready', async () => {
    clearReadyWatchdog();
    authenticatedAt = 0;

    waState = 'READY';

    await repairWhatsAppWebCompatibility();
    qrDataUrl = null;
    lastError = null;
    reconnectAttempts = 0;
    clearReconnectTimer();
    console.log('WhatsApp gateway READY.');
});

client.on('auth_failure', (message) => {
    waState = 'AUTH_FAILURE';
    lastError = String(message || 'Authentication failure');
    console.error('WhatsApp auth failure:', message);
});

client.on('disconnected', (reason) => {
    clearReadyWatchdog();
    authenticatedAt = 0;

    waState = 'DISCONNECTED';
    qrDataUrl = null;
    lastError = String(reason || 'Disconnected');
    console.warn('WhatsApp disconnected:', reason);

    scheduleWhatsAppReconnect(reason || 'WhatsApp disconnected');
});

client.on('message', (message) => {
    if (isOutgoingMessage(message)) {
        return;
    }

    enqueueIncomingMessage(message, 'message').catch((error) => {
        console.error('Gagal memproses event message:', error);
    });
});

client.on('message_create', (message) => {
    if (isOutgoingMessage(message)) {
        return;
    }

    enqueueIncomingMessage(message, 'message_create').catch((error) => {
        console.error('Gagal memproses event message_create:', error);
    });
});

client.on('message_ack', (message, ack) => {
    const messageId = extractMessageId(message);

    console.log(
        `[${now()}] MESSAGE_ACK MessageId=${messageId || '-'} Ack=${ack} To=${message?.to || message?._data?.to || '-'}`
    );

    for (const [token, tracker] of pendingOutgoingSends.entries()) {
        if (Date.now() - tracker.createdAt > SEND_TIMEOUT_MS) {
            continue;
        }

        const score = sendMatchScore(tracker, message);

        if (score < 100) {
            continue;
        }

        const current = clearOutgoingTracker(token);

        if (!current) {
            continue;
        }

        if (Number(ack) < 1) {
            current.reject(new Error(
                'WhatsApp mengembalikan ACK ERROR untuk pesan outgoing.'
            ));
            continue;
        }

        current.resolve({
            ack: Number(ack),
            ackLabel: ackLabel(ack),
            message,
            messageId: extractMessageId(message)
        });
    }
});

app.get('/', (req, res) => {
    const statusLabel = waState === 'READY'
        ? 'WhatsApp Terhubung'
        : waState === 'QR_READY'
            ? 'Scan QR WhatsApp'
            : 'Menyiapkan WhatsApp';

    const qrSection = waState === 'QR_READY' && qrDataUrl
        ? `<div class="mb-4"><img class="img-fluid border rounded-3 p-2 bg-white" src="${qrDataUrl}" alt="QR WhatsApp" width="240" height="240"></div><p class="text-secondary mb-0">Buka WhatsApp di HP, pilih Perangkat tertaut, lalu scan QR ini.</p>`
        : '';

    const readySection = waState === 'READY'
        ? `<div class="display-3 text-success mb-3">✓</div><h2 class="h4 mb-2">WhatsApp siap digunakan</h2><p class="text-secondary mb-0">Dashboard PHP dapat mengirim pesan langsung melalui gateway ini.</p>`
        : '';

    const waitingSection = waState !== 'QR_READY' && waState !== 'READY'
        ? `<h2 class="h4 mb-3">${statusLabel}</h2><p class="text-secondary mb-0">Status: <code>${waState}</code>. Halaman akan memperbarui otomatis.</p>`
        : '';

    const errorSection = lastError
        ? `<div class="alert alert-danger mt-4 mb-0">${String(lastError).replace(/</g, '&lt;')}</div>`
        : '';

    res.send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WhatsApp Gateway</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet"></head><body class="bg-body-tertiary"><main class="container py-5"><div class="row justify-content-center"><div class="col-12 col-md-8 col-lg-6"><div class="card shadow-sm border-0"><div class="card-body p-4 p-lg-5 text-center"><span class="badge text-bg-success-subtle text-success mb-3">${statusLabel}</span>${qrSection}${readySection}${waitingSection}${errorSection}<div class="mt-4"><button class="btn btn-outline-secondary btn-sm" type="button" onclick="location.reload()">Refresh</button></div></div></div></div></div></main><script>if (${JSON.stringify(waState)} !== 'READY') { setTimeout(function () { location.reload(); }, 5000); }</script></body></html>`);
});

app.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        state: waState,
        ready: waState === 'READY',
        authenticatedAt: authenticatedAt || null,
        waWebVersion: WA_WEB_VERSION,
        hasQr: Boolean(qrDataUrl),
        error: lastError,
        incomingQueue: incomingQueue.size,
        mappedContacts: contactIdentityMap.size
    });
});

app.post('/send', async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const doctorId = String(req.body.doctor_id || '').trim();
    const message = String(req.body.message || '').trim();

    terminalLog('PERMINTAAN KIRIM WHATSAPP', {
        Status: 'MEMPROSES',
        DoctorId: doctorId || '-',
        Tujuan: phone || '-',
        PanjangPesan: message.length
    });

    try {
        if (waState !== 'READY') {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp belum terhubung. Scan QR terlebih dahulu.',
                state: waState
            });
        }

        if (!phone || !/^62\d{8,15}$/.test(phone)) {
            return res.status(422).json({
                success: false,
                message: 'Format nomor WhatsApp tidak valid.'
            });
        }

        if (!message) {
            return res.status(422).json({
                success: false,
                message: 'Pesan WhatsApp kosong.'
            });
        }

        await repairWhatsAppWebCompatibility();

        const numberId = await client.getNumberId(phone);

        if (!numberId) {
            return res.status(404).json({
                success: false,
                message: 'Nomor tidak terdaftar di WhatsApp.'
            });
        }

        rememberIdentity(numberId._serialized, phone, doctorId);
        rememberIdentity(numberId.user, phone, doctorId);

        const ackWaiter = waitForOutgoingAck({
            chatId: numberId._serialized,
            phone,
            body: message
        });

        const sentMessage = await sendMessageWithTimeout(
            numberId._serialized,
            message
        );

        let messageId = extractMessageId(sentMessage);

        if (!messageId) {
            const ackResult = await ackWaiter;

            messageId =
                ackResult.messageId ||
                extractMessageId(ackResult.message) ||
                `WA-${Date.now()}`;

            terminalLog('WHATSAPP TERKONFIRMASI VIA MESSAGE_ACK', {
                Status: 'TERKONFIRMASI',
                DoctorId: doctorId || '-',
                Tujuan: phone,
                MessageId: messageId,
                Ack: ackResult.ack,
                AckStatus: ackResult.ackLabel
            });
        }

        if (!messageId) {
            throw new Error('WhatsApp tidak mengembalikan Message ID setelah sendMessage().');
        }

        rememberIdentity(sentMessage?.to, phone, doctorId);
        rememberIdentity(sentMessage?.id?.remote, phone, doctorId);
        rememberIdentity(sentMessage?._data?.to?._serialized, phone, doctorId);
        rememberIdentity(sentMessage?._data?.to?.user, phone, doctorId);

        let ack = Number(sentMessage?.ack ?? 0);

        if (ack <= 0) {
            const ackResult = await ackWaiter;
            ack = ackResult.ack;
        }

        if (ack <= 0) {
            throw new Error(
                `Pesan ${messageId} tidak memperoleh ACK server WhatsApp.`
            );
        }

        clearOutgoingTrackersFor({
            chatId: numberId._serialized,
            phone,
            body: message
        });

        terminalLog('WHATSAPP BERHASIL DIKIRIM', {
            Status: 'BERHASIL',
            DoctorId: doctorId || '-',
            Tujuan: phone,
            MessageId: messageId,
            Ack: ack,
            AckStatus: ack >= 2 ? 'DELIVERED' : 'SERVER_ACCEPTED',
            Mapping: contactIdentityMap.size
        });

        return res.json({
            success: true,
            message: 'Pesan WhatsApp berhasil dikirim.',
            phone,
            doctorId,
            messageId,
            ack,
            ackStatus: ack >= 2 ? 'DELIVERED' : 'SERVER_ACCEPTED'
        });
    } catch (error) {
        clearOutgoingTrackersFor({
            phone,
            body: message
        });

        terminalLog('WHATSAPP GAGAL DIKIRIM', {
            Status: 'GAGAL',
            DoctorId: doctorId || '-',
            Tujuan: phone || '-',
            Alasan: error.message || 'Gagal mengirim WhatsApp'
        });

        return res.status(500).json({
            success: false,
            message: error.message || 'Gagal mengirim WhatsApp.'
        });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`WhatsApp gateway berjalan di http://localhost:${PORT}`);
});

initializeWhatsApp('startup').catch(() => {
    scheduleWhatsAppReconnect('Inisialisasi WhatsApp gagal');
});
