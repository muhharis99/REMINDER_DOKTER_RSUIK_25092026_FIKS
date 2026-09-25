const navbarFixLink = document.createElement('link');
navbarFixLink.rel = 'stylesheet';
navbarFixLink.href = 'assets/navbar-fix.css';
document.head.appendChild(navbarFixLink);

const rsiReferenceLink = document.createElement('link');
rsiReferenceLink.rel = 'stylesheet';
rsiReferenceLink.href = 'assets/rsi-reference.css';
document.head.appendChild(rsiReferenceLink);

const footerFixLink = document.createElement('link');
footerFixLink.rel = 'stylesheet';
footerFixLink.href = 'assets/footer-fix.css';
document.head.appendChild(footerFixLink);

const modalFixLink = document.createElement('link');
modalFixLink.rel = 'stylesheet';
modalFixLink.href = 'assets/modal-fix.css';
document.head.appendChild(modalFixLink);

const noHoverLink = document.createElement('link');
noHoverLink.rel = 'stylesheet';
noHoverLink.href = 'assets/no-hover.css';
document.head.appendChild(noHoverLink);

const sweetAlertReady = new Promise(function (resolve) {
    if (window.Swal) {
        resolve(window.Swal);
        return;
    }

    const existingScript = document.querySelector('script[src*="sweetalert2"]');

    if (existingScript) {
        existingScript.addEventListener('load', function () {
            resolve(window.Swal || null);
        }, { once: true });
        existingScript.addEventListener('error', function () {
            resolve(null);
        }, { once: true });
        return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11';
    script.async = true;
    script.addEventListener('load', function () {
        resolve(window.Swal || null);
    }, { once: true });
    script.addEventListener('error', function () {
        resolve(null);
    }, { once: true });
    document.head.appendChild(script);
});

function getConfirmationCopy(form) {
    const actionInput = form.querySelector('input[name="action"]');
    const action = actionInput ? actionInput.value.trim() : '';
    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
    const submitText = submitButton
        ? (submitButton.textContent || submitButton.value || '').trim()
        : '';

    if (action === 'disable_contact') {
        return {
            title: 'Nonaktifkan Nomor WhatsApp?',
            text: 'Apakah nomor WhatsApp dokter ini benar akan dinonaktifkan?',
            confirmText: 'Ya, Nonaktifkan',
            confirmColor: '#dc3545'
        };
    }

    if (action === 'save_contact') {
        return {
            title: 'Simpan Nomor WhatsApp?',
            text: 'Pastikan dokter dan nomor WhatsApp yang dipilih sudah benar.',
            confirmText: 'Ya, Simpan',
            confirmColor: '#198754'
        };
    }

    if (/hapus|delete/i.test(action + ' ' + submitText)) {
        return {
            title: 'Hapus Data?',
            text: 'Apakah data benar di hapus? Tindakan ini akan mengubah data pada sistem.',
            confirmText: 'Ya, Hapus',
            confirmColor: '#dc3545'
        };
    }

    if (/nonaktif|disable/i.test(action + ' ' + submitText)) {
        return {
            title: 'Nonaktifkan Data?',
            text: 'Apakah data ini benar akan dinonaktifkan?',
            confirmText: 'Ya, Nonaktifkan',
            confirmColor: '#dc3545'
        };
    }

    if (/aktif|enable/i.test(action + ' ' + submitText)) {
        return {
            title: 'Aktifkan Data?',
            text: 'Apakah data ini benar akan diaktifkan?',
            confirmText: 'Ya, Aktifkan',
            confirmColor: '#198754'
        };
    }

    return {
        title: 'Simpan Perubahan?',
        text: 'Pastikan data yang diisi sudah benar sebelum melanjutkan.',
        confirmText: 'Ya, Simpan',
        confirmColor: '#198754'
    };
}

document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form').forEach(function (form) {
        const method = (form.getAttribute('method') || 'get').toLowerCase();

        if (method !== 'post' || form.dataset.swalConfirmation === 'off') {
            return;
        }

        form.querySelectorAll('[onclick*="confirm("]').forEach(function (element) {
            element.removeAttribute('onclick');
        });

        form.addEventListener('submit', async function (event) {
            if (form.dataset.confirmedSubmit === '1') {
                return;
            }

            event.preventDefault();

            const SwalInstance = await sweetAlertReady;
            const copy = getConfirmationCopy(form);

            if (!SwalInstance) {
                if (window.confirm(copy.text)) {
                    form.dataset.confirmedSubmit = '1';
                    form.submit();
                }

                return;
            }

            const result = await SwalInstance.fire({
                icon: 'question',
                title: copy.title,
                text: copy.text,
                showCancelButton: true,
                confirmButtonText: copy.confirmText,
                cancelButtonText: 'Batal',
                confirmButtonColor: copy.confirmColor,
                cancelButtonColor: '#6c757d',
                reverseButtons: true,
                focusCancel: true,
                allowOutsideClick: false
            });

            if (!result.isConfirmed) {
                return;
            }

            form.dataset.confirmedSubmit = '1';
            form.submit();
        });
    });

    const serverNotice = document.querySelector('.alert.alert-success, .alert.alert-danger');

    if (serverNotice && serverNotice.textContent.trim() !== '') {
        const noticeText = serverNotice.textContent.trim();
        const isSuccess = serverNotice.classList.contains('alert-success');

        sweetAlertReady.then(function (SwalInstance) {
            if (!SwalInstance) {
                return;
            }

            serverNotice.remove();

            SwalInstance.fire({
                icon: isSuccess ? 'success' : 'error',
                title: isSuccess ? 'Berhasil' : 'Gagal',
                text: noticeText,
                confirmButtonText: 'OK',
                confirmButtonColor: isSuccess ? '#198754' : '#dc3545'
            });
        });
    }

    const navbarBrand = document.querySelector('.navbar-brand');

    if (navbarBrand) {
        navbarBrand.textContent = 'Dokter Reminder RSU Islam Klaten';
    }

    const navbarMenu = document.querySelector('#mainNavbar .navbar-nav');

    if (navbarMenu) {
        let leaveLink = navbarMenu.querySelector('a[href="dokter_ijin.php"]');

        if (!leaveLink) {
            const reportLink = navbarMenu.querySelector('a[href="report.php"]');
            leaveLink = document.createElement('a');
            leaveLink.className = 'nav-link';
            leaveLink.href = 'dokter_ijin.php';
            leaveLink.textContent = 'Dokter Ijin';

            if (reportLink && reportLink.nextSibling) {
                navbarMenu.insertBefore(leaveLink, reportLink.nextSibling);
            } else {
                navbarMenu.appendChild(leaveLink);
            }
        }

        if (!navbarMenu.querySelector('a[href="pindah_jam_praktek.php"]')) {
            const movedPracticeLink = document.createElement('a');
            movedPracticeLink.className = 'nav-link';
            movedPracticeLink.href = 'pindah_jam_praktek.php';
            movedPracticeLink.textContent = 'Pindah Jam Praktek';

            if (leaveLink && leaveLink.nextSibling) {
                navbarMenu.insertBefore(movedPracticeLink, leaveLink.nextSibling);
            } else {
                navbarMenu.appendChild(movedPracticeLink);
            }
        }

        if (!navbarMenu.querySelector('a[href="chat_dokter.php"]')) {
            const movedPracticeLink = navbarMenu.querySelector('a[href="pindah_jam_praktek.php"]');
            const chatDoctorLink = document.createElement('a');
            chatDoctorLink.className = 'nav-link';
            chatDoctorLink.href = 'chat_dokter.php';
            chatDoctorLink.textContent = 'Chat Dokter';

            if (movedPracticeLink && movedPracticeLink.nextSibling) {
                navbarMenu.insertBefore(chatDoctorLink, movedPracticeLink.nextSibling);
            } else {
                navbarMenu.appendChild(chatDoctorLink);
            }
        }
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'backToTop';
    button.setAttribute('aria-label', 'Kembali ke atas');
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
    button.style.position = 'fixed';
    button.style.right = '20px';
    button.style.bottom = '20px';
    button.style.width = '44px';
    button.style.height = '44px';
    button.style.display = 'none';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.border = '0';
    button.style.borderRadius = '0';
    button.style.background = '#389f6a';
    button.style.color = '#ffffff';
    button.style.boxShadow = 'none';
    button.style.cursor = 'pointer';
    button.style.zIndex = '1040';
    button.style.padding = '0';

    document.body.appendChild(button);

    function updateVisibility() {
        button.style.display = window.scrollY > 300 ? 'flex' : 'none';
    }

    window.addEventListener('scroll', updateVisibility, { passive: true });

    button.addEventListener('click', function () {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    const dashboardTitle = Array.from(document.querySelectorAll('h1')).find(function (element) {
        return element.textContent.trim() === 'Reminder Jadwal Dokter';
    });

    if (dashboardTitle) {
        const dashboardHeader = dashboardTitle.closest('.row');
        const filterForm = dashboardHeader
            ? dashboardHeader.querySelector('form[method="get"]')
            : null;
        const practiceDateElement = dashboardHeader
            ? dashboardHeader.querySelector('p.text-secondary')
            : null;
        const practiceDate = practiceDateElement
            ? practiceDateElement.textContent.trim()
            : '';

        if (filterForm) {
            const submitButton = filterForm.querySelector('button[type="submit"]');
            const doctorFilter = filterForm.querySelector('#doctorFilter');
            const poliFilter = filterForm.querySelector('#poliFilter');
            const scheduleDate = filterForm.querySelector('#scheduleDate');
            let submitting = false;

            if (submitButton) {
                submitButton.remove();
            }

            function submitFilter() {
                if (submitting) {
                    return;
                }

                submitting = true;
                window.setTimeout(function () {
                    filterForm.submit();
                }, 50);
            }

            if (doctorFilter) {
                doctorFilter.addEventListener('change', submitFilter);
            }

            if (poliFilter) {
                poliFilter.addEventListener('change', submitFilter);
            }

            if (scheduleDate) {
                scheduleDate.addEventListener('change', submitFilter);
            }

            if (window.jQuery) {
                const $ = window.jQuery;

                if (doctorFilter) {
                    $(doctorFilter)
                        .off('.autoFilter')
                        .on('select2:select.autoFilter select2:clear.autoFilter change.autoFilter', submitFilter);
                }

                if (poliFilter) {
                    $(poliFilter)
                        .off('.autoFilter')
                        .on('select2:select.autoFilter select2:clear.autoFilter change.autoFilter', submitFilter);
                }
            }
        }

        if (practiceDate !== '') {
            document.querySelectorAll('h3.h5.mb-1').forEach(function (doctorName) {
                const identity = doctorName.parentElement;
                const card = doctorName.closest('.card');

                if (!identity || !card || identity.querySelector('.doctor-practice-date')) {
                    return;
                }

                const practiceInfo = document.createElement('div');
                practiceInfo.className = 'doctor-practice-date small mt-1';
                practiceInfo.innerHTML = '<span class="text-secondary">Praktek:</span> <span class="fw-semibold">' + practiceDate + '</span>';

                const timeValues = Array.from(
                    card.querySelectorAll('.list-group-item .fw-semibold.text-nowrap')
                )
                    .map(function (element) {
                        return element.textContent.trim().replace(/\s+/g, ' ');
                    })
                    .filter(function (value, index, values) {
                        return value !== '' && values.indexOf(value) === index;
                    });

                if (timeValues.length > 0) {
                    practiceInfo.innerHTML += '<br><span class="text-secondary">Jam:</span> <span class="fw-semibold">' + timeValues.join(', ') + '</span>';
                }

                identity.appendChild(practiceInfo);
            });
        }

        const scheduleHeading = Array.from(document.querySelectorAll('h2')).find(function (element) {
            return element.textContent.trim() === 'Jadwal Dokter';
        });

        if (scheduleHeading && !document.getElementById('sendAllDoctors')) {
            const headingRow = scheduleHeading.closest('.d-flex.justify-content-between');

            if (headingRow) {
                const bulkWrap = document.createElement('div');
                bulkWrap.className = 'form-check d-flex align-items-center gap-2 mb-0';

                const bulkCheckbox = document.createElement('input');
                bulkCheckbox.className = 'form-check-input mt-0';
                bulkCheckbox.type = 'checkbox';
                bulkCheckbox.id = 'sendAllDoctors';

                const bulkLabel = document.createElement('label');
                bulkLabel.className = 'form-check-label fw-semibold';
                bulkLabel.htmlFor = 'sendAllDoctors';
                bulkLabel.textContent = 'Kirim Semua Dokter';

                bulkWrap.appendChild(bulkCheckbox);
                bulkWrap.appendChild(bulkLabel);
                headingRow.appendChild(bulkWrap);

                function randomDelaySeconds() {
                    return Math.floor(Math.random() * 13) + 8;
                }

                function sleep(milliseconds) {
                    return new Promise(function (resolve) {
                        window.setTimeout(resolve, milliseconds);
                    });
                }

                async function updateReminderStatus(reminderId, action) {
                    const statusUrl = new URL(window.location.href);
                    statusUrl.searchParams.set('action', action);
                    statusUrl.searchParams.set('id', reminderId);

                    await fetch(statusUrl.toString(), {
                        method: 'GET',
                        cache: 'no-store',
                        redirect: 'follow'
                    });
                }

                bulkCheckbox.addEventListener('change', async function () {
                    if (!this.checked) {
                        return;
                    }

                    const allWhatsappButtons = Array.from(
                        document.querySelectorAll('.js-whatsapp')
                    );

                    const sendButtons = allWhatsappButtons.filter(function (whatsappButton) {
                        const buttonText = whatsappButton.textContent.trim();

                        return whatsappButton.dataset.phone &&
                            whatsappButton.dataset.message &&
                            whatsappButton.dataset.reminderId &&
                            !buttonText.includes('Kirim Ulang');
                    });

                    if (sendButtons.length === 0) {
                        this.checked = false;

                        await Swal.fire({
                            icon: 'info',
                            title: 'Tidak ada reminder',
                            text: 'Semua dokter yang tampil sudah dikirim atau data WhatsApp belum lengkap.',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#198754'
                        });

                        return;
                    }

                    const confirmation = await Swal.fire({
                        icon: 'question',
                        title: 'Kirim Semua Dokter?',
                        html: 'Sistem akan mengirim reminder ke <strong>' + sendButtons.length + ' dokter</strong> satu per satu.<br><br>Jeda antar nomor dibuat acak <strong>8–20 detik</strong> untuk menghindari pengiriman terlalu cepat.',
                        showCancelButton: true,
                        confirmButtonText: 'Ya, Kirim Semua',
                        cancelButtonText: 'Batal',
                        confirmButtonColor: '#198754',
                        cancelButtonColor: '#6c757d',
                        reverseButtons: true,
                        focusCancel: true
                    });

                    if (!confirmation.isConfirmed) {
                        this.checked = false;
                        return;
                    }

                    const gatewayUrl = 'http://' + window.location.hostname + ':3210';
                    let successCount = 0;
                    let failedCount = 0;
                    const failures = [];

                    this.disabled = true;
                    allWhatsappButtons.forEach(function (whatsappButton) {
                        whatsappButton.disabled = true;
                    });

                    try {
                        for (let index = 0; index < sendButtons.length; index++) {
                            const whatsappButton = sendButtons[index];
                            const phone = whatsappButton.dataset.phone;
                            const message = whatsappButton.dataset.message;
                            const reminderId = whatsappButton.dataset.reminderId;
                            const doctorName = whatsappButton.dataset.doctorName || 'Dokter';

                            Swal.fire({
                                title: 'Mengirim Reminder',
                                html: '<strong>' + (index + 1) + ' dari ' + sendButtons.length + '</strong><br>' + doctorName + '<br>' + phone,
                                allowOutsideClick: false,
                                allowEscapeKey: false,
                                showConfirmButton: false,
                                didOpen: function () {
                                    Swal.showLoading();
                                }
                            });

                            try {
                                const response = await fetch(gatewayUrl + '/send', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                        phone: phone,
                                        message: message
                                    })
                                });

                                const result = await response.json();

                                if (!response.ok || !result.success) {
                                    throw new Error(result.message || 'Gagal mengirim WhatsApp.');
                                }

                                await updateReminderStatus(reminderId, 'sent');
                                successCount++;
                                whatsappButton.textContent = 'Kirim Ulang WhatsApp';
                            } catch (error) {
                                failedCount++;
                                failures.push(doctorName);

                                try {
                                    await updateReminderStatus(reminderId, 'failed');
                                } catch (statusError) {
                                }
                            }

                            if (index < sendButtons.length - 1) {
                                const delaySeconds = randomDelaySeconds();

                                Swal.fire({
                                    title: 'Menunggu Pengiriman Berikutnya',
                                    html: 'Berhasil: <strong>' + successCount + '</strong> &nbsp; Gagal: <strong>' + failedCount + '</strong><br><br>Jeda acak: <strong>' + delaySeconds + ' detik</strong>',
                                    allowOutsideClick: false,
                                    allowEscapeKey: false,
                                    showConfirmButton: false,
                                    didOpen: function () {
                                        Swal.showLoading();
                                    }
                                });

                                await sleep(delaySeconds * 1000);
                            }
                        }

                        let resultHtml = 'Berhasil dikirim: <strong>' + successCount + '</strong><br>Gagal: <strong>' + failedCount + '</strong>';

                        if (failures.length > 0) {
                            resultHtml += '<br><br>Gagal dikirim ke:<br>' + failures.join('<br>');
                        }

                        await Swal.fire({
                            icon: failedCount === 0 ? 'success' : 'warning',
                            title: 'Pengiriman Selesai',
                            html: resultHtml,
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#198754'
                        });

                        window.location.reload();
                    } finally {
                        this.checked = false;
                        this.disabled = false;

                        allWhatsappButtons.forEach(function (whatsappButton) {
                            whatsappButton.disabled = false;
                        });
                    }
                });
            }
        }

        const previewLinks = Array.from(
            document.querySelectorAll('a[href^="preview.php?id="]')
        );

        if (previewLinks.length > 0 && window.bootstrap) {
            let previewModalElement = document.getElementById('previewReminderModal');

            if (!previewModalElement) {
                previewModalElement = document.createElement('div');
                previewModalElement.className = 'modal fade';
                previewModalElement.id = 'previewReminderModal';
                previewModalElement.tabIndex = -1;
                previewModalElement.setAttribute('aria-hidden', 'true');
                previewModalElement.innerHTML = '<div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Preview Reminder WhatsApp</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Tutup"></button></div><div class="modal-body p-0"><iframe id="previewReminderFrame" title="Preview Reminder WhatsApp" style="display:block;width:100%;height:72vh;border:0;background:#ffffff;"></iframe></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button></div></div></div>';
                document.body.appendChild(previewModalElement);
            }

            const previewFrame = previewModalElement.querySelector('#previewReminderFrame');
            const previewModal = bootstrap.Modal.getOrCreateInstance(previewModalElement);

            previewLinks.forEach(function (previewLink) {
                previewLink.removeAttribute('target');
                previewLink.setAttribute('role', 'button');

                previewLink.addEventListener('click', function (event) {
                    event.preventDefault();

                    if (previewFrame) {
                        previewFrame.src = this.getAttribute('href');
                    }

                    previewModal.show();
                });
            });

            previewModalElement.addEventListener('hidden.bs.modal', function () {
                if (previewFrame) {
                    previewFrame.src = 'about:blank';
                }
            });
        }
    }

    const reportFilterForm = document.getElementById('reportFilterForm');

    if (reportFilterForm) {
        const showReportButton = document.getElementById('showReportButton');
        const startDate = document.getElementById('startDate');
        const endDate = document.getElementById('endDate');
        const statusFilter = document.getElementById('status');
        let reportSubmitting = false;

        if (showReportButton) {
            const buttonColumn = showReportButton.closest('[class*="col-"]');

            if (buttonColumn) {
                buttonColumn.remove();
            } else {
                showReportButton.remove();
            }
        }

        function submitReportFilter() {
            if (reportSubmitting) {
                return;
            }

            if (!startDate || !endDate || startDate.value.trim() === '' || endDate.value.trim() === '') {
                return;
            }

            reportSubmitting = true;
            window.setTimeout(function () {
                reportFilterForm.submit();
            }, 80);
        }

        if (startDate) {
            startDate.addEventListener('change', submitReportFilter);
        }

        if (endDate) {
            endDate.addEventListener('change', submitReportFilter);
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', submitReportFilter);
        }

        if (window.jQuery && statusFilter) {
            window.jQuery(statusFilter)
                .off('.reportAutoFilter')
                .on('select2:select.reportAutoFilter select2:clear.reportAutoFilter change.reportAutoFilter', submitReportFilter);
        }
    }

    const footers = Array.from(document.querySelectorAll('footer'));
    let footer = footers.shift();

    footers.forEach(function (duplicateFooter) {
        duplicateFooter.remove();
    });

    if (!footer) {
        footer = document.createElement('footer');
        document.body.appendChild(footer);
    }

    footer.className = 'app-footer';
    footer.replaceChildren(
        document.createTextNode(
            'Dokter Reminder RSU Islam Klaten © ' + new Date().getFullYear()
        )
    );

    footer.style.setProperty('width', '100%', 'important');
    footer.style.setProperty('max-width', 'none', 'important');
    footer.style.setProperty('margin', '0', 'important');
    footer.style.setProperty('padding', '11px 16px', 'important');
    footer.style.setProperty('min-height', '46px', 'important');
    footer.style.setProperty('display', 'flex', 'important');
    footer.style.setProperty('align-items', 'center', 'important');
    footer.style.setProperty('justify-content', 'center', 'important');
    footer.style.setProperty('background', '#389f6a', 'important');
    footer.style.setProperty('background-color', '#389f6a', 'important');
    footer.style.setProperty('color', '#ffffff', 'important');
    footer.style.setProperty('border', '0', 'important');
    footer.style.setProperty('border-radius', '0', 'important');
    footer.style.setProperty('box-shadow', 'none', 'important');
    footer.style.setProperty('font-size', '13px', 'important');
    footer.style.setProperty('font-weight', '400', 'important');
    footer.style.setProperty('line-height', '24px', 'important');
    footer.style.setProperty('text-align', 'center', 'important');
    footer.style.setProperty('transform', 'none', 'important');
    footer.style.setProperty('transition', 'none', 'important');

    updateVisibility();
});