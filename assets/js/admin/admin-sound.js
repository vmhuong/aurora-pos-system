// =====================================================================
// AURORA SYSTEM - ADMIN AUDIO & CHIME NOTIFICATION MODULE
// Hệ thống chuông báo âm thanh chuẩn Lounge (Web Audio API Synthesizer)
// =====================================================================

(function(root) {
    'use strict';

    const AdminSound = {
        isEnabled() {
            return localStorage.getItem('aurora_service_sound') !== 'false';
        },

        toggle() {
            const next = !this.isEnabled();
            localStorage.setItem('aurora_service_sound', next ? 'true' : 'false');
            this.updateUI();
            if (next) {
                this.play('assistance');
                if (typeof root.showAdminToast === 'function') {
                    root.showAdminToast('🔔 Đã bật âm thanh chuông báo', 'info');
                }
            } else {
                if (typeof root.showAdminToast === 'function') {
                    root.showAdminToast('🔕 Đã tắt âm thanh chuông báo', 'warning');
                }
            }
            return next;
        },

        updateUI() {
            const isEnabled = this.isEnabled();
            const btn = document.getElementById('service-sound-toggle-btn');
            const icon = document.getElementById('service-sound-icon');
            const text = document.getElementById('service-sound-text');
            const ind = document.getElementById('service-sound-status-dot');

            if (btn && icon && text) {
                if (isEnabled) {
                    btn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100";
                    icon.className = "fa-solid fa-volume-high text-xs text-emerald-600";
                    text.innerText = "Chuông báo: Bật";
                    if (ind) ind.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
                } else {
                    btn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition bg-gray-100 text-gray-500 border border-gray-300 hover:bg-gray-200";
                    icon.className = "fa-solid fa-volume-xmark text-xs text-gray-400";
                    text.innerText = "Chuông báo: Tắt";
                    if (ind) ind.className = "w-2 h-2 rounded-full bg-gray-400";
                }
            }

            const orderBtn = document.getElementById('order-board-sound-btn');
            const orderIcon = document.getElementById('order-board-sound-icon');
            const orderText = document.getElementById('order-board-sound-text');
            if (orderBtn && orderIcon && orderText) {
                if (isEnabled) {
                    orderBtn.className = "px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold shadow-2xs transition flex items-center gap-1 shrink-0";
                    orderIcon.className = "fa-solid fa-volume-high text-amber-600 text-[10px]";
                    orderText.innerText = "Chuông: BẬT";
                } else {
                    orderBtn.className = "px-2.5 py-1 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-200 text-xs font-semibold shadow-2xs transition flex items-center gap-1 shrink-0";
                    orderIcon.className = "fa-solid fa-volume-xmark text-gray-400 text-[10px]";
                    orderText.innerText = "Chuông: TẮT";
                }
            }
        },

        play(type = 'assistance') {
            if (!this.isEnabled()) return;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();

                if (type === 'checkout') {
                    // Âm thanh xin thanh toán (Triad C5 -> E5 -> G5 ngân vang sang trọng)
                    const notes = [523.25, 659.25, 783.99];
                    notes.forEach((freq, idx) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
                        gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.12);
                        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.5);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(ctx.currentTime + idx * 0.12);
                        osc.stop(ctx.currentTime + idx * 0.12 + 0.5);
                    });
                } else if (type === 'order') {
                    // Âm thanh có đơn mới (Marimba G4 -> C5 -> E5)
                    const notes = [392.00, 523.25, 659.25];
                    notes.forEach((freq, idx) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
                        gain.gain.setValueAtTime(0.3, ctx.currentTime + idx * 0.1);
                        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.4);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(ctx.currentTime + idx * 0.1);
                        osc.stop(ctx.currentTime + idx * 0.1 + 0.4);
                    });
                } else {
                    // Âm thanh gọi nhân viên (Chime 2 nốt E5 -> A5 trong trẻo)
                    const notes = [659.25, 880.00];
                    notes.forEach((freq, idx) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.14);
                        gain.gain.setValueAtTime(0.28, ctx.currentTime + idx * 0.14);
                        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.6);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(ctx.currentTime + idx * 0.14);
                        osc.stop(ctx.currentTime + idx * 0.14 + 0.6);
                    });
                }
            } catch(e) {}
        }
    };

    root.AdminSound = AdminSound;
    root.isSoundNotificationEnabled = AdminSound.isEnabled.bind(AdminSound);
    root.toggleServiceSound = AdminSound.toggle.bind(AdminSound);
    root.updateServiceSoundUI = AdminSound.updateUI.bind(AdminSound);
    root.playServiceNotificationSound = AdminSound.play.bind(AdminSound);
    root.playOrderNotificationSound = function() { AdminSound.play('order'); };

    // Tự động mở khóa Web Audio API ngay khi người dùng tương tác lần đầu
    if (typeof document !== 'undefined') {
        const unlockAudio = function() {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    const tempCtx = new AudioCtx();
                    if (tempCtx.state === 'suspended') {
                        tempCtx.resume().catch(() => {});
                    }
                }
            } catch(e) {}
            ['click', 'touchstart', 'keydown'].forEach(evt => {
                document.removeEventListener(evt, unlockAudio);
            });
        };
        ['click', 'touchstart', 'keydown'].forEach(evt => {
            document.addEventListener(evt, unlockAudio, { passive: true });
        });
    }
})(typeof window !== 'undefined' ? window : this);
