const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { ackLabel, normalizePhone, isValidIndonesianPhone, maskPhone, tokenEquals } = require('./lib/gateway-utils');

const app = express();
const PORT = Number(process.env.WA_PORT || 3210);
const HOST = process.env.WA_HOST || '127.0.0.1';
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

let waState = 'STARTING';
let qrDataUrl = null;
let lastError = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let initializingWhatsApp = false;
let readyWatchdogTimer = null;
let authenticatedAt = 0;
let shutdownInProgress = false;


const pendingOutgoingSends = new Map();
const deliveryJobs = new Map();
const activeReminderSends = new Map();
const activeRecipientSends = new Map();
let activeGatewaySendRequest = null;

const WA_API_TOKEN = String(process.env.WA_API_TOKEN || '').trim();
const WA_CALLBACK_URL = String(process.env.WA_CALLBACK_URL || '').trim();
const WA_CALLBACK_TOKEN = String(process.env.WA_CALLBACK_TOKEN || '').trim();
const DELIVERY_CALLBACK_TIMEOUT_MS = 5000;

const SEND_TIMEOUT_MS = 15000;
const ACK_VERIFY_TIMEOUT_MS = 5000;
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

function resolveChromeExecutable() {
    const candidates = [];

    if (process.env.CHROME_EXECUTABLE_PATH) {
        candidates.push(process.env.CHROME_EXECUTABLE_PATH);
    }

    if (process.platform === 'win32') {
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env.LOCALAPPDATA || '';

        candidates.push(
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFiles, 'Chromium', 'Application', 'chromium.exe'),
            path.join(programFiles, 'Chromium', 'Application', 'chrome.exe')
        );
    }

    if (process.platform === 'linux') {
        candidates.push(
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser'
        );
    }

    if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'
        );
    }

    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

const chromeExecutable = resolveChromeExecutable();

if (chromeExecutable) {
    console.log('WhatsApp Chrome executable:', chromeExecutable);
} else {
    console.warn(
        'Chrome/Chromium sistem tidak ditemukan. Puppeteer akan memakai browser bawaan jika tersedia.'
    );
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'dokter-reminder',
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    webVersionCache: {
        type: 'none'
    },
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    puppeteer: {
        ...(chromeExecutable ? { executablePath: chromeExecutable } : {}),
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
            '--disable-features=TranslateUI',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled'
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
            `WhatsApp READY timeout setelah ${elapsedSeconds} detik. Tidak membuat browser kedua; gateway menunggu sesi browser yang ada.`
        );

        waState = 'ERROR';
        lastError = `READY timeout setelah ${elapsedSeconds} detik`;
    }, 45000);
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleWhatsAppReconnect(reason) {
    if (reconnectTimer || shutdownInProgress || initializingWhatsApp) {
        return;
    }

    reconnectAttempts++;

    const delay = Math.min(
        30000,
        Math.max(3000, reconnectAttempts * 3000)
    );

    waState = 'RECONNECTING';
    lastError = String(reason || 'WhatsApp terputus');

    console.warn(
        `WhatsApp recovery dijadwalkan dalam ${Math.ceil(delay / 1000)} detik. Percobaan #${reconnectAttempts}`
    );

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;

        if (shutdownInProgress || initializingWhatsApp) {
            return;
        }

        try {
            await safelyRestartWhatsApp(reason);
        } catch (error) {
            console.error('Recovery WhatsApp gagal:', error);
            waState = 'ERROR';
            lastError = error.message || String(error);
        }
    }, delay);

    reconnectTimer.unref?.();
}

async function waitForBrowserClosed(timeoutMs = 15000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const browser = client.pupBrowser;

        if (!browser || browser.connected?.() === false) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return false;
}

async function safelyRestartWhatsApp(reason = '') {
    if (shutdownInProgress || initializingWhatsApp) {
        return;
    }

    console.warn('Menjalankan recovery WhatsApp:', reason || 'unknown');

    try {
        await client.destroy();
    } catch (error) {
        console.warn(
            'client.destroy() saat recovery:',
            error.message || error
        );
    }

    const closed = await waitForBrowserClosed();

    if (!closed) {
        throw new Error(
            'Browser WhatsApp lama belum tertutup. Recovery dihentikan agar tidak membuat userDataDir kedua.'
        );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await initializeWhatsApp('recovery');
}


async function initializeWhatsApp(reason = 'startup') {
    if (initializingWhatsApp || shutdownInProgress) {
        return;
    }

    clearReconnectTimer();
    initializingWhatsApp = true;
    waState = reason === 'recovery' ? 'RECONNECTING' : 'STARTING';
    lastError = null;

    try {
        await client.initialize();
    } catch (error) {
        waState = 'ERROR';
        lastError = error.message || String(error);
        console.error('Gagal menginisialisasi WhatsApp:', error);
        throw error;
    } finally {
        initializingWhatsApp = false;
    }
}



function requireGatewayApiToken(req, res, next) {
    if (!WA_API_TOKEN) {
        return res.status(503).json({
            success: false,
            message: 'WA_API_TOKEN belum dikonfigurasi pada service gateway.'
        });
    }

    const authorization = String(req.get('authorization') || '');
    const supplied = authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';

    if (!tokenEquals(supplied, WA_API_TOKEN)) {
        return res.status(401).json({
            success: false,
            message: 'Autentikasi gateway tidak valid.'
        });
    }

    return next();
}

async function notifyDeliveryResult(job, result) {
    if (!WA_CALLBACK_URL || !WA_CALLBACK_TOKEN) {
        console.error('Delivery callback tidak dikonfigurasi; status DB belum dapat disinkronkan.');
        return false;
    }

    let callbackUrl;
    try {
        callbackUrl = new URL(WA_CALLBACK_URL);
        if (!['http:', 'https:'].includes(callbackUrl.protocol)) {
            throw new Error('Protokol callback tidak didukung');
        }
    } catch (error) {
        console.error('WA_CALLBACK_URL tidak valid.');
        return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_CALLBACK_TIMEOUT_MS);

    try {
        const response = await fetch(callbackUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + WA_CALLBACK_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                request_id: job.requestId,
                reminder_id: job.reminderId,
                status: result.status,
                message_id: result.messageId || null,
                ack: Number.isFinite(Number(result.ack)) ? Number(result.ack) : null,
                error: String(result.error || '').slice(0, 450) || null
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            console.error(`Delivery callback ditolak: HTTP ${response.status}; request_id=${job.requestId}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error(`Delivery callback gagal; request_id=${job.requestId}; alasan=${error.name === 'AbortError' ? 'timeout' : (error.message || 'network error')}`);
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

async function finishDelivery(requestId, result) {
    const job = deliveryJobs.get(requestId);
    if (!job || job.status !== 'PROCESSING') return;

    job.status = result.status;
    job.ack = Number.isFinite(Number(result.ack)) ? Number(result.ack) : null;
    job.messageId = result.messageId || null;
    job.error = String(result.error || '').slice(0, 450) || null;
    job.updatedAt = new Date().toISOString();
    job.callbackDelivered = await notifyDeliveryResult(job, result);

    if (activeReminderSends.get(String(job.reminderId)) === requestId) {
        activeReminderSends.delete(String(job.reminderId));
    }
    if (job.phone && activeRecipientSends.get(String(job.phone)) === requestId) {
        activeRecipientSends.delete(String(job.phone));
    }
    if (activeGatewaySendRequest === requestId) {
        activeGatewaySendRequest = null;
    }

    // Keep a bounded in-memory status window for polling if the PHP callback is late.
    const completed = [...deliveryJobs.entries()]
        .filter(([, item]) => item.status !== 'PROCESSING')
        .sort((a, b) => String(a[1].updatedAt || a[1].createdAt).localeCompare(String(b[1].updatedAt || b[1].createdAt)));
    while (completed.length > 500) {
        const [oldRequestId] = completed.shift();
        deliveryJobs.delete(oldRequestId);
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

function isOutgoingMessage(message) {
    return message?.fromMe === true ||
        message?.id?.fromMe === true ||
        String(message?.id?.fromMe || '').toLowerCase() === 'true';
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

function captureOutgoingMessage(message) {
    if (!message || !isOutgoingMessage(message)) {
        return;
    }

    const messageId = extractMessageId(message);
    const body = String(
        message?.body ||
        message?._data?.body ||
        ''
    ).trim();

    if (!messageId || body === '') {
        return;
    }

    let candidate = null;

    for (const [token, tracker] of pendingOutgoingSends.entries()) {
        if (Date.now() - tracker.createdAt > SEND_TIMEOUT_MS) {
            continue;
        }

        if (tracker.body !== body) {
            continue;
        }

        if (!candidate || tracker.createdAt > candidate.tracker.createdAt) {
            candidate = {
                token,
                tracker
            };
        }
    }

    if (!candidate) {
        return;
    }

    candidate.tracker.messageId = messageId;

    console.log(
        `[${now()}] OUTGOING_MESSAGE_CREATE MessageId=${messageId} To=${maskPhone(message?.to || message?._data?.to || '-')}`
    );
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

async function watchAuthenticatedReady() {
    const startedAt = Date.now();
    const timeoutMs = 90000;

    const probe = async () => {
        if (waState === 'READY' || shutdownInProgress) {
            return;
        }

        try {
            const state = await client.getState();

            console.log(
                `WhatsApp connection state: ${state}`
            );

            if (state === 'CONNECTED') {
                clearReadyWatchdog();
                authenticatedAt = 0;
                waState = 'READY';
                qrDataUrl = null;
                lastError = null;

                await repairWhatsAppWebCompatibility();

                reconnectAttempts = 0;
                clearReconnectTimer();

                console.log(
                    'WhatsApp gateway READY (promoted from getState CONNECTED).'
                );

                return;
            }

            if (state === 'CONFLICT') {
                lastError = 'WhatsApp session conflict';
                console.warn('WhatsApp session conflict detected.');
            }
        } catch (error) {
            lastError = error.message || String(error);
        }

        if (Date.now() - startedAt >= timeoutMs) {
            lastError =
                'WhatsApp sudah authenticated tetapi tidak mencapai CONNECTED dalam 90 detik.';
            waState = 'ERROR';

            console.error(lastError);
            return;
        }

        setTimeout(probe, 2000).unref?.();
    };

    setTimeout(probe, 1500).unref?.();
}

client.on('loading_screen', (percent, message) => {
    console.log(
        `WhatsApp loading: ${percent}% ${message || ''}`
    );
});

client.on('change_state', (state) => {
    console.log(`WhatsApp state berubah: ${state}`);

    if (state === 'CONNECTED') {
        clearReadyWatchdog();
        authenticatedAt = 0;
        waState = 'READY';
        qrDataUrl = null;
        lastError = null;
        reconnectAttempts = 0;
        clearReconnectTimer();

        repairWhatsAppWebCompatibility().catch((error) => {
            console.warn(
                'Gagal memasang WA Web compatibility saat CONNECTED:',
                error.message || error
            );
        });

        console.log('WhatsApp gateway READY (change_state=CONNECTED).');
    } else if (['DISCONNECTED', 'UNPAIRED', 'UNPAIRED_IDLE'].includes(state)) {
        if (waState !== 'STARTING' && waState !== 'RECONNECTING') {
            waState = 'DISCONNECTED';
        }
    }
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
        'WhatsApp berhasil diautentikasi. Mengecek connection state...'
    );

    scheduleReadyWatchdog();
    watchAuthenticatedReady();
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

    const disconnectReason = String(reason || 'Disconnected');

    waState = 'DISCONNECTED';
    qrDataUrl = null;
    lastError = disconnectReason;

    console.warn(
        'WhatsApp disconnected. Recovery akan memakai lifecycle restart tunggal:',
        disconnectReason
    );

    scheduleWhatsAppReconnect(disconnectReason);
});

client.on('message_create', (message) => {
    if (isOutgoingMessage(message)) {
        captureOutgoingMessage(message);
    }
});

client.on('message_ack', (message, ack) => {
    const messageId = extractMessageId(message);

    console.log(
        `[${now()}] MESSAGE_ACK MessageId=${messageId || '-'} Ack=${ack} To=${maskPhone(message?.to || message?._data?.to || '-')}`
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

app.get('/', (_req, res) => {
    res.status(200).type('text/plain').send(
        'WhatsApp Gateway berjalan. Untuk QR, buka gateway_qr.php dari dashboard PHP; jangan mengekspos halaman QR gateway secara langsung.'
    );
});

app.get('/qr', requireGatewayApiToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        state: waState,
        ready: waState === 'READY',
        hasQr: Boolean(qrDataUrl),
        qr: qrDataUrl,
        error: lastError
    });
});

app.get('/status', requireGatewayApiToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        state: waState,
        ready: waState === 'READY',
        authenticatedAt: authenticatedAt || null,
        hasQr: Boolean(qrDataUrl),
        error: lastError
    });
});

app.get('/send-status/:requestId', requireGatewayApiToken, (req, res) => {
    const requestId = String(req.params.requestId || '');
    const job = deliveryJobs.get(requestId);
    if (!job) {
        return res.status(404).json({
            success: false,
            status: 'UNKNOWN',
            message: 'Status permintaan tidak tersedia pada memori gateway.'
        });
    }

    return res.json({
        success: true,
        request_id: job.requestId,
        reminder_id: job.reminderId,
        status: job.status,
        ack: job.ack,
        message_id: job.messageId,
        error: job.error,
        callback_delivered: Boolean(job.callbackDelivered),
        created_at: job.createdAt,
        updated_at: job.updatedAt || null
    });
});

app.post('/send', requireGatewayApiToken, async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const doctorId = String(req.body.doctor_id || '').trim();
    const reminderId = Number.parseInt(req.body.reminder_id, 10);
    const requestId = String(req.body.request_id || '').trim().toLowerCase();
    const message = String(req.body.message || '').trim();

    if (!WA_CALLBACK_URL || !WA_CALLBACK_TOKEN) {
        return res.status(503).json({
            success: false,
            queued: false,
            message: 'Delivery callback belum dikonfigurasi. Pengiriman dinonaktifkan agar status reminder tidak hilang.'
        });
    }

    if (!Number.isSafeInteger(reminderId) || reminderId < 1 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
        return res.status(422).json({
            success: false,
            queued: false,
            message: 'ID reminder atau request ID tidak valid.'
        });
    }

    // Idempotency: a repeated HTTP request with the same request_id never sends twice.
    const existingJob = deliveryJobs.get(requestId);
    if (existingJob) {
        if (existingJob.reminderId !== reminderId) {
            return res.status(409).json({
                success: false,
                queued: false,
                message: 'Request ID sudah digunakan oleh reminder lain.'
            });
        }
        return res.status(202).json({
            success: true,
            queued: existingJob.status === 'PROCESSING',
            idempotent: true,
            request_id: requestId,
            reminder_id: reminderId,
            status: existingJob.status
        });
    }

    const activeRequestId = activeReminderSends.get(String(reminderId));
    if (activeRequestId && activeRequestId !== requestId) {
        return res.status(409).json({
            success: false,
            queued: false,
            request_id: activeRequestId,
            message: 'Reminder ini sedang diproses. Jangan mengirim ulang sebelum hasilnya diketahui.'
        });
    }

    terminalLog('PERMINTAAN KIRIM WHATSAPP', {
        Status: 'MEMULAI',
        DoctorId: doctorId || '-',
        ReminderId: reminderId,
        Tujuan: maskPhone(phone),
        PanjangPesan: message.length,
        RequestId: requestId
    });

    if (waState !== 'READY') {
        return res.status(503).json({
            success: false,
            queued: false,
            message: 'WhatsApp belum terhubung. Scan QR terlebih dahulu.',
            state: waState
        });
    }

    if (!isValidIndonesianPhone(phone)) {
        return res.status(422).json({
            success: false,
            queued: false,
            message: 'Format nomor WhatsApp tidak valid.'
        });
    }

    if (!message) {
        return res.status(422).json({
            success: false,
            queued: false,
            message: 'Pesan WhatsApp kosong.'
        });
    }

    if (activeGatewaySendRequest && activeGatewaySendRequest !== requestId) {
        return res.status(409).json({
            success: false,
            queued: false,
            request_id: activeGatewaySendRequest,
            message: 'Gateway sedang memproses pesan lain. Tunggu hasilnya lalu coba lagi.'
        });
    }

    const activeRecipientRequestId = activeRecipientSends.get(phone);
    if (activeRecipientRequestId && activeRecipientRequestId !== requestId) {
        return res.status(409).json({
            success: false,
            queued: false,
            request_id: activeRecipientRequestId,
            message: 'Sudah ada pengiriman aktif ke nomor ini. Tunggu hasilnya sebelum mencoba lagi.'
        });
    }

    const job = {
        requestId,
        reminderId,
        doctorId: doctorId || null,
        phone,
        status: 'PROCESSING',
        createdAt: new Date().toISOString(),
        updatedAt: null,
        ack: null,
        messageId: null,
        error: null,
        callbackDelivered: false
    };
    deliveryJobs.set(requestId, job);
    activeReminderSends.set(String(reminderId), requestId);
    activeRecipientSends.set(phone, requestId);
    activeGatewaySendRequest = requestId;

    try {
        await repairWhatsAppWebCompatibility();
        const numberId = await client.getNumberId(phone);

        if (!numberId) {
            await finishDelivery(requestId, {
                status: 'FAILED',
                error: 'Nomor tidak terdaftar di WhatsApp.'
            });
            return res.status(404).json({
                success: false,
                queued: false,
                message: 'Nomor tidak terdaftar di WhatsApp.'
            });
        }

        job.chatId = numberId._serialized;

        const ackWaiter = waitForOutgoingAck({
            chatId: numberId._serialized,
            phone,
            body: message
        });
        // Attach a rejection handler immediately: sendMessage() can fail before the waiter is awaited.
        ackWaiter.catch(() => {});

        Promise.resolve().then(async () => {
            let returnedMessage = null;
            try {
                returnedMessage = await client.sendMessage(
                    numberId._serialized,
                    message,
                    { ignoreQuoteErrors: true, sendSeen: false }
                );
                console.log(
                    `[${now()}] sendMessage() selesai; request_id=${requestId}; message_id=${extractMessageId(returnedMessage) || '-'}; ack=${returnedMessage?.ack ?? '-'}`
                );
            } catch (sendError) {
                const tracker = Array.from(pendingOutgoingSends.values()).find((item) =>
                    item.chatId === numberId._serialized &&
                    item.phone === phone &&
                    item.body === message
                );
                if (tracker) {
                    clearOutgoingTracker(tracker.token);
                    tracker.reject(sendError);
                }
                // A send exception after invoking the library does not prove that no message went out.
                await finishDelivery(requestId, {
                    status: 'UNKNOWN',
                    error: sendError.message || 'Hasil pengiriman tidak dapat dipastikan.'
                });
                return;
            }

            const directAck = Number(returnedMessage?.ack || 0);
            const returnedMessageId = extractMessageId(returnedMessage);
            if (directAck >= 1) {
                clearOutgoingTrackersFor({
                    chatId: numberId._serialized,
                    phone,
                    body: message
                });
                await finishDelivery(requestId, {
                    status: 'SENT',
                    ack: directAck,
                    messageId: returnedMessageId
                });
                terminalLog('ACK WHATSAPP DITERIMA', {
                    Status: 'SENT',
                    ReminderId: reminderId,
                    RequestId: requestId,
                    MessageId: returnedMessageId || '-',
                    Ack: directAck,
                    AckStatus: ackLabel(directAck)
                });
                return;
            }

            try {
                const ackResult = await ackWaiter;
                const ack = Number(ackResult.ack || 0);
                const messageId = ackResult.messageId || extractMessageId(ackResult.message);
                if (ack >= 1) {
                    await finishDelivery(requestId, {
                        status: 'SENT',
                        ack,
                        messageId
                    });
                    terminalLog('ACK WHATSAPP DITERIMA', {
                        Status: 'SENT',
                        ReminderId: reminderId,
                        RequestId: requestId,
                        MessageId: messageId || '-',
                        Ack: ack,
                        AckStatus: ackResult.ackLabel || ackLabel(ack)
                    });
                } else {
                    await finishDelivery(requestId, {
                        status: 'UNKNOWN',
                        error: 'ACK tidak memberikan bukti penerimaan yang memadai.'
                    });
                }
            } catch (ackError) {
                await finishDelivery(requestId, {
                    status: 'UNKNOWN',
                    error: ackError.message || 'ACK tidak diterima dalam batas waktu.'
                });
                terminalLog('STATUS PENGIRIMAN BELUM PASTI', {
                    Status: 'UNKNOWN',
                    ReminderId: reminderId,
                    RequestId: requestId,
                    Alasan: ackError.message || 'ACK tidak diterima.'
                });
            }
        }).catch(async (backgroundError) => {
            await finishDelivery(requestId, {
                status: 'UNKNOWN',
                error: backgroundError.message || 'Proses background gagal.'
            });
        });

        return res.status(202).json({
            success: true,
            queued: true,
            request_id: requestId,
            reminder_id: reminderId,
            status: 'PROCESSING',
            message: 'Permintaan diterima. Status akhir akan diperbarui melalui callback.'
        });
    } catch (error) {
        await finishDelivery(requestId, {
            status: 'FAILED',
            error: error.message || 'Gagal menyiapkan pengiriman WhatsApp.'
        });
        terminalLog('WHATSAPP GAGAL MEMULAI KIRIM', {
            Status: 'FAILED',
            ReminderId: reminderId,
            RequestId: requestId,
            Tujuan: maskPhone(phone),
            Alasan: error.message || 'Gagal memulai pengiriman WhatsApp'
        });
        return res.status(500).json({
            success: false,
            queued: false,
            status: 'FAILED',
            request_id: requestId,
            reminder_id: reminderId,
            message: 'Gateway gagal menyiapkan pengiriman WhatsApp.'
        });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`WhatsApp gateway berjalan di http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
    if (shutdownInProgress) {
        return;
    }

    shutdownInProgress = true;
    clearReadyWatchdog();
    clearReconnectTimer();

    console.log('\nMenghentikan WhatsApp gateway...');

    try {
        await client.destroy();
    } catch (error) {
        console.error(
            'Gagal menutup WhatsApp saat shutdown:',
            error.message || error
        );
    } finally {
        process.exit(0);
    }
});

process.on('SIGTERM', async () => {
    if (shutdownInProgress) {
        return;
    }

    shutdownInProgress = true;
    clearReadyWatchdog();
    clearReconnectTimer();

    try {
        await client.destroy();
    } catch (error) {
        console.error(
            'Gagal menutup WhatsApp saat shutdown:',
            error.message || error
        );
    } finally {
        process.exit(0);
    }
});

initializeWhatsApp('startup').catch((error) => {
    scheduleWhatsAppReconnect(
        error?.message || 'Inisialisasi WhatsApp gagal'
    );
});
