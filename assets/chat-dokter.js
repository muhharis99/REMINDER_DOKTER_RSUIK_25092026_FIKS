document.addEventListener('DOMContentLoaded', function () {
    const app = document.getElementById('doctorChatApp');

    if (!app) {
        return;
    }

    const conversationList = document.getElementById('conversationList');
    const doctorSearch = document.getElementById('doctorSearch');
    const emptyState = document.getElementById('chatEmptyState');
    const activeState = document.getElementById('chatActiveState');
    const doctorName = document.getElementById('chatDoctorName');
    const doctorCode = document.getElementById('chatDoctorCode');
    const doctorPhone = document.getElementById('chatDoctorPhone');
    const messagesBox = document.getElementById('chatMessages');
    const sendForm = document.getElementById('chatSendForm');
    const messageInput = document.getElementById('chatMessageInput');
    const sendButton = document.getElementById('chatSendButton');
    const gatewayStatus = document.getElementById('gatewayStatus');

    let conversations = [];
    let selectedDoctorId = '';
    let selectedDoctor = null;
    let lastMessageId = 0;
    let polling = false;
    let initialMessagesLoaded = false;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isNearBottom() {
        const distance = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight;
        return distance < 100;
    }

    function scrollToBottom() {
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    function renderConversations() {
        const query = doctorSearch.value.trim().toLowerCase();
        const filtered = conversations.filter(function (item) {
            const haystack = [
                item.name,
                item.doctor_id,
                item.phone,
                item.phone_raw,
                item.last_message
            ].join(' ').toLowerCase();

            return query === '' || haystack.includes(query);
        });

        if (filtered.length === 0) {
            conversationList.innerHTML = '<div class="p-4 text-center text-secondary small">Dokter tidak ditemukan.</div>';
            return;
        }

        conversationList.innerHTML = filtered.map(function (item) {
            const active = item.doctor_id === selectedDoctorId ? ' active' : '';
            const unread = Number(item.unread_count || 0);
            const unreadBadge = unread > 0
                ? '<span class="badge text-bg-success rounded-pill">' + unread + '</span>'
                : '';
            const preview = item.last_message
                ? escapeHtml(item.last_message)
                : 'Belum ada percakapan';
            const direction = item.last_direction === 'OUT' ? 'Anda: ' : '';

            return '<button type="button" class="chat-contact-item' + active + '" data-doctor-id="' + escapeHtml(item.doctor_id) + '">' +
                '<div class="d-flex justify-content-between gap-2 align-items-start">' +
                    '<div class="min-w-0 flex-grow-1">' +
                        '<div class="chat-contact-name">' + escapeHtml(item.name) + '</div>' +
                        '<div class="chat-contact-meta">' + escapeHtml(item.doctor_id) + ' • ' + escapeHtml(item.phone_raw || item.phone) + '</div>' +
                        '<div class="chat-contact-preview mt-1">' + direction + preview + '</div>' +
                    '</div>' +
                    '<div class="text-end flex-shrink-0">' +
                        '<div class="chat-contact-time mb-1">' + escapeHtml(item.last_time || '') + '</div>' +
                        unreadBadge +
                    '</div>' +
                '</div>' +
            '</button>';
        }).join('');
    }

    function renderMessage(message) {
        const direction = message.direction === 'OUT' ? 'out' : 'in';
        const label = direction === 'OUT' ? 'PETUGAS' : 'DOKTER';
        const html = '<div class="chat-message-row ' + direction + '" data-message-id="' + Number(message.id) + '">' +
            '<div class="chat-bubble">' +
                '<div class="chat-bubble-label">' + label + '</div>' +
                '<div class="chat-bubble-message">' + escapeHtml(message.message) + '</div>' +
                '<div class="chat-bubble-time">' + escapeHtml(message.time || '') + '</div>' +
            '</div>' +
        '</div>';

        messagesBox.insertAdjacentHTML('beforeend', html);
        lastMessageId = Math.max(lastMessageId, Number(message.id || 0));
    }

    async function loadConversations() {
        try {
            const response = await fetch('api/chat/conversations.php', {
                cache: 'no-store'
            });
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Daftar dokter gagal dimuat.');
            }

            conversations = Array.isArray(result.conversations)
                ? result.conversations
                : [];

            if (selectedDoctorId !== '') {
                selectedDoctor = conversations.find(function (item) {
                    return item.doctor_id === selectedDoctorId;
                }) || selectedDoctor;
            }

            renderConversations();
        } catch (error) {
            conversationList.innerHTML = '<div class="p-4 text-center text-danger small">' + escapeHtml(error.message) + '</div>';
        }
    }

    async function markRead() {
        if (selectedDoctorId === '') {
            return;
        }

        try {
            await fetch('api/chat/mark_read.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    doctor_id: selectedDoctorId
                })
            });
        } catch (error) {
        }
    }

    async function loadMessages(reset) {
        if (selectedDoctorId === '' || polling) {
            return;
        }

        polling = true;
        const shouldStick = reset || isNearBottom();

        try {
            const afterId = reset ? 0 : lastMessageId;
            const response = await fetch(
                'api/chat/messages.php?doctor_id=' + encodeURIComponent(selectedDoctorId) + '&after_id=' + afterId,
                { cache: 'no-store' }
            );
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Pesan gagal dimuat.');
            }

            if (reset) {
                messagesBox.innerHTML = '';
                lastMessageId = 0;
                initialMessagesLoaded = false;
            }

            const messages = Array.isArray(result.messages) ? result.messages : [];

            messages.forEach(renderMessage);

            if (reset && messages.length === 0) {
                messagesBox.innerHTML = '<div class="chat-empty-message text-center text-secondary small">Belum ada percakapan dengan dokter ini.</div>';
            }

            if (messages.length > 0 && messagesBox.querySelector('.chat-empty-message')) {
                messagesBox.querySelector('.chat-empty-message').remove();
            }

            if (shouldStick) {
                scrollToBottom();
            }

            initialMessagesLoaded = true;
            await markRead();
        } catch (error) {
            if (reset) {
                messagesBox.innerHTML = '<div class="p-4 text-center text-danger small">' + escapeHtml(error.message) + '</div>';
            }
        } finally {
            polling = false;
        }
    }

    async function selectDoctor(doctorId) {
        const doctor = conversations.find(function (item) {
            return item.doctor_id === doctorId;
        });

        if (!doctor) {
            return;
        }

        selectedDoctorId = doctorId;
        selectedDoctor = doctor;
        lastMessageId = 0;
        initialMessagesLoaded = false;

        doctorName.textContent = doctor.name;
        doctorCode.textContent = doctor.doctor_id;
        doctorPhone.textContent = doctor.phone_raw || doctor.phone;
        emptyState.classList.add('d-none');
        activeState.classList.remove('d-none');
        renderConversations();

        await loadMessages(true);
        await loadConversations();
        messageInput.focus();
    }

    async function checkGateway() {
        try {
            const url = 'http://' + window.location.hostname + ':3210/status';
            const response = await fetch(url, { cache: 'no-store' });
            const result = await response.json();

            if (response.ok && result.ready) {
                gatewayStatus.className = 'badge text-bg-success';
                gatewayStatus.textContent = 'WhatsApp Aktif';
                return;
            }

            gatewayStatus.className = 'badge text-bg-warning';
            gatewayStatus.textContent = result.state || 'Tidak Siap';
        } catch (error) {
            gatewayStatus.className = 'badge text-bg-danger';
            gatewayStatus.textContent = 'Gateway Offline';
        }
    }

    conversationList.addEventListener('click', function (event) {
        const button = event.target.closest('[data-doctor-id]');

        if (!button) {
            return;
        }

        selectDoctor(button.dataset.doctorId || '');
    });

    doctorSearch.addEventListener('input', renderConversations);

    sendForm.addEventListener('submit', async function (event) {
        event.preventDefault();

        if (!selectedDoctor || selectedDoctorId === '') {
            return;
        }

        const message = messageInput.value.trim();

        if (message === '') {
            await Swal.fire({
                icon: 'info',
                title: 'Pesan kosong',
                text: 'Ketik pesan WhatsApp terlebih dahulu.',
                confirmButtonColor: '#389f6a'
            });
            return;
        }

        const confirmation = await Swal.fire({
            icon: 'question',
            title: 'Kirim WhatsApp?',
            html: '<strong>' + escapeHtml(selectedDoctor.name) + '</strong><br>' +
                escapeHtml(selectedDoctor.phone_raw || selectedDoctor.phone) +
                '<hr><div class="text-start" style="white-space:pre-wrap">' + escapeHtml(message) + '</div>',
            showCancelButton: true,
            confirmButtonText: 'Ya, Kirim',
            cancelButtonText: 'Batal',
            confirmButtonColor: '#389f6a',
            cancelButtonColor: '#6c757d',
            reverseButtons: true,
            focusCancel: true
        });

        if (!confirmation.isConfirmed) {
            return;
        }

        sendButton.disabled = true;
        messageInput.disabled = true;

        try {
            const response = await fetch('api/chat/send.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    doctor_id: selectedDoctorId,
                    message: message
                })
            });
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Pesan WhatsApp gagal dikirim.');
            }

            messageInput.value = '';
            await loadMessages(false);
            await loadConversations();

            await Swal.fire({
                icon: 'success',
                title: 'Berhasil',
                text: 'Pesan WhatsApp berhasil dikirim.',
                timer: 1400,
                showConfirmButton: false
            });
        } catch (error) {
            await Swal.fire({
                icon: 'error',
                title: 'Gagal',
                text: error.message || 'Pesan WhatsApp gagal dikirim.',
                confirmButtonColor: '#dc3545'
            });
        } finally {
            sendButton.disabled = false;
            messageInput.disabled = false;
            messageInput.focus();
        }
    });

    messageInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendForm.requestSubmit();
        }
    });

    window.setInterval(async function () {
        await loadConversations();

        if (selectedDoctorId !== '' && initialMessagesLoaded) {
            await loadMessages(false);
        }
    }, 3000);

    window.setInterval(checkGateway, 10000);

    loadConversations();
    checkGateway();

    window.setTimeout(function () {
        const chatLink = document.querySelector('#mainNavbar a[href="chat_dokter.php"]');

        if (chatLink) {
            document.querySelectorAll('#mainNavbar .nav-link').forEach(function (link) {
                link.classList.remove('active', 'fw-semibold');
            });
            chatLink.classList.add('active', 'fw-semibold');
        }
    }, 0);
});
