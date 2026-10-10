const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = Number(process.env.WA_PORT || 3210);
const HOST = process.env.WA_HOST || '0.0.0.0';
app.disable('x-powered-by');
app.use(cors());
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

function ackLabel(ack) {
    const value = Number(ack);

    if (value >= 3) return 'READ';
    if (value >= 2) return 'DELIVERED';
    if (value >= 1) return 'SERVER_ACCEPTED';

    return 'UNKNOWN';
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
        `[${now()}] OUTGOING_MESSAGE_CREATE MessageId=${messageId} To=${message?.to || message?._data?.to || '-'}`
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
        hasQr: Boolean(qrDataUrl),
        error: lastError
    });
});

app.post('/send', async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const doctorId = String(req.body.doctor_id || '').trim();
    const message = String(req.body.message || '').trim();

    terminalLog('PERMINTAAN KIRIM WHATSAPP', {
        Status: 'MEMULAI',
        DoctorId: doctorId || '-',
        Tujuan: phone || '-',
        PanjangPesan: message.length
    });

    if (waState !== 'READY') {
        return res.status(503).json({
            success: false,
            queued: false,
            message: 'WhatsApp belum terhubung. Scan QR terlebih dahulu.',
            state: waState
        });
    }

    if (!phone || !/^62\d{8,15}$/.test(phone)) {
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

    try {
        await repairWhatsAppWebCompatibility();

        const numberId = await client.getNumberId(phone);

        if (!numberId) {
            return res.status(404).json({
                success: false,
                queued: false,
                message: 'Nomor tidak terdaftar di WhatsApp.'
            });
        }

        const ackWaiter = waitForOutgoingAck({
            chatId: numberId._serialized,
            phone,
            body: message
        });

        /**
         * FIRE-AND-FORGET:
         * Jangan menunggu sendMessage() selesai.
         * Pada WhatsApp Web build tertentu, promise ini dapat memerlukan
         * beberapa detik walaupun pesan sudah diproses oleh WA.
         *
         * message_ack tetap menjadi sumber konfirmasi background.
         */
        Promise.resolve()
            .then(async () => {
                let sendReturnedMessage = null;

                try {
                    sendReturnedMessage = await client.sendMessage(
                        numberId._serialized,
                        message,
                        {
                            ignoreQuoteErrors: true,
                            sendSeen: false
                        }
                    );

                    console.log(
                        `[${now()}] sendMessage() selesai background. ReturnedMessage=${Boolean(sendReturnedMessage)} MessageId=${extractMessageId(sendReturnedMessage) || '-'} Ack=${sendReturnedMessage?.ack ?? '-'}`
                    );
                } catch (sendError) {
                    console.error(
                        'sendMessage() background error:',
                        sendError.message || sendError
                    );

                    const tracker = Array.from(
                        pendingOutgoingSends.values()
                    ).find((item) =>
                        item.chatId === numberId._serialized &&
                        item.phone === phone &&
                        item.body === message
                    );

                    if (tracker) {
                        const current = clearOutgoingTracker(tracker.token);

                        if (current) {
                            current.reject(
                                new Error(
                                    sendError.message ||
                                    'WhatsApp gagal memulai pengiriman.'
                                )
                            );
                        }
                    }

                    return;
                }

                const directAck = Number(sendReturnedMessage?.ack || 0);

                if (directAck >= 1) {
                    clearOutgoingTrackersFor({
                        chatId: numberId._serialized,
                        phone,
                        body: message
                    });

                    terminalLog('WHATSAPP BERHASIL DIKIRIM', {
                        Status: 'BERHASIL',
                        DoctorId: doctorId || '-',
                        Tujuan: phone,
                        MessageId:
                            extractMessageId(sendReturnedMessage) ||
                            `WA-${Date.now()}`,
                        Ack: directAck,
                        AckStatus:
                            directAck >= 2
                                ? 'DELIVERED'
                                : 'SERVER_ACCEPTED'
                    });

                    return;
                }

                try {
                    const ackResult = await ackWaiter;
                    const ack = Number(ackResult.ack || 0);
                    const messageId =
                        ackResult.messageId ||
                        extractMessageId(ackResult.message) ||
                        extractMessageId(sendReturnedMessage) ||
                        `WA-${Date.now()}`;

                    if (ack >= 1) {
                        terminalLog(
                            'WHATSAPP TERKONFIRMASI VIA MESSAGE_ACK',
                            {
                                Status: 'TERKONFIRMASI',
                                DoctorId: doctorId || '-',
                                Tujuan: phone,
                                MessageId: messageId,
                                Ack: ack,
                                AckStatus:
                                    ackResult.ackLabel ||
                                    (ack >= 2
                                        ? 'DELIVERED'
                                        : 'SERVER_ACCEPTED')
                            }
                        );

                        return;
                    }

                    throw new Error(
                        `Pesan ${messageId} tidak memperoleh ACK server WhatsApp.`
                    );
                } catch (ackError) {
                    terminalLog('WHATSAPP GAGAL DIKIRIM', {
                        Status: 'GAGAL_BACKGROUND',
                        DoctorId: doctorId || '-',
                        Tujuan: phone || '-',
                        Alasan:
                            ackError.message ||
                            'ACK WhatsApp tidak diterima.'
                    });
                }
            })
            .catch((backgroundError) => {
                terminalLog('WHATSAPP GAGAL DIKIRIM', {
                    Status: 'GAGAL_BACKGROUND',
                    DoctorId: doctorId || '-',
                    Tujuan: phone || '-',
                    Alasan:
                        backgroundError.message ||
                        'Pengiriman background gagal.'
                });
            });

        /**
         * Respons HTTP langsung supaya tombol 1 nomor tidak menunggu
         * sendMessage() yang lambat.
         */
        return res.status(202).json({
            success: true,
            queued: true,
            message:
                'Permintaan pengiriman WhatsApp sudah diteruskan ke gateway.',
            phone,
            doctorId
        });
    } catch (error) {
        terminalLog('WHATSAPP GAGAL MEMULAI KIRIM', {
            Status: 'GAGAL',
            DoctorId: doctorId || '-',
            Tujuan: phone || '-',
            Alasan: error.message || 'Gagal memulai pengiriman WhatsApp'
        });

        return res.status(500).json({
            success: false,
            queued: false,
            message:
                error.message ||
                'Gagal memulai pengiriman WhatsApp.'
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
