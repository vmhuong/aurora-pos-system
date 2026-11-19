// =====================================================================
// AURORA LOUNGE - SEPAY REALTIME BANK PAYMENT GATEWAY
// Tự động nhận biến động số dư MB Bank (0123456789) qua SePay Webhook & API
// Tự động kiểm tra, khớp bàn, phát chuông Ting-ting và tự động kết bàn
// =====================================================================

(function(root) {
    'use strict';

    const DEFAULT_CONFIG = {
        apiToken: '', // Tùy chọn (Hệ thống sử dụng SePay Webhook Server-to-Server)
        bankAccount: '0123456789',
        bankBrand: 'MBBank',
        autoCheckEnabled: true,
        autoSettle: true,
        soundNotification: true,
        voiceNotification: false, // Đã bỏ chức năng đọc trợ lý
        pollInterval: 4000
    };

    const SepayService = {
        config: { ...DEFAULT_CONFIG },
        processedTxIds: new Set(),
        timerId: null,
        isPolling: false,
        isChecking: false,
        lastCheckTime: null,
        db: null,
        ops: null, // Modular Firebase ops: { doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit, serverTimestamp }
        listeners: {
            onPaymentSuccess: null,
            onCheckStatus: null
        },

        // 1. Khởi tạo dịch vụ
        async init(firestoreDb, firebaseOps = {}, callbacks = {}) {
            this.db = firestoreDb;
            this.ops = firebaseOps;
            if (callbacks.onPaymentSuccess) this.listeners.onPaymentSuccess = callbacks.onPaymentSuccess;
            if (callbacks.onCheckStatus) this.listeners.onCheckStatus = callbacks.onCheckStatus;

            // Nạp cấu hình từ localStorage trước
            try {
                const local = localStorage.getItem('aurora_sepay_config');
                if (local) {
                    const parsed = JSON.parse(local);
                    if (parsed.bankAccount === '9935105205' || parsed.bankBrand === 'Vietcombank') {
                        localStorage.removeItem('aurora_sepay_config');
                    } else {
                        this.config = { ...this.config, ...parsed };
                    }
                }
            } catch (e) {
                console.warn('Lỗi đọc local SePay config:', e);
            }

            // Đồng bộ cấu hình từ Firestore settings/payment (nếu có)
            if (this.db && this.ops && typeof this.ops.getDoc === 'function') {
                try {
                    const docRef = this.ops.doc(this.db, 'settings', 'payment');
                    const snap = await this.ops.getDoc(docRef);
                    if (snap && snap.exists()) {
                        const data = snap.data() || {};
                        if (data.sepay_api_token) this.config.apiToken = data.sepay_api_token;
                        if (data.sepay_account) this.config.bankAccount = data.sepay_account;
                        if (data.sepay_bank) this.config.bankBrand = data.sepay_bank;
                        if (typeof data.sepay_auto_check === 'boolean') this.config.autoCheckEnabled = data.sepay_auto_check;
                        if (typeof data.sepay_auto_settle === 'boolean') this.config.autoSettle = data.sepay_auto_settle;
                        if (typeof data.sepay_sound === 'boolean') this.config.soundNotification = data.sepay_sound;
                        if (typeof data.sepay_voice === 'boolean') this.config.voiceNotification = data.sepay_voice;
                        if (data.sepay_interval) this.config.pollInterval = Number(data.sepay_interval) || 4000;
                    }
                } catch (e) {
                    console.log('Chưa có cấu hình settings/payment trên Firestore, dùng cấu hình mặc định.');
                }

                // Nạp danh sách các mã giao dịch đã xử lý gần đây từ Firestore để không bao giờ bị xử lý trùng
                this.loadProcessedTransactions();
            }

            // Tự động bắt đầu polling nếu đã bật và có token
            if (this.config.autoCheckEnabled && this.config.apiToken) {
                this.startPolling();
            }

            console.log('✅ SepayService đã khởi tạo sẵn sàng! Tài khoản:', this.config.bankAccount, 'Ngân hàng:', this.config.bankBrand);
        },

        // Nạp danh sách ID giao dịch đã xử lý từ Firestore
        async loadProcessedTransactions() {
            if (!this.db || !this.ops || typeof this.ops.getDocs !== 'function') return;
            try {
                const colRef = this.ops.collection(this.db, 'payment_transactions');
                const q = this.ops.query(colRef, this.ops.orderBy('created_at', 'desc'), this.ops.limit(50));
                const snap = await this.ops.getDocs(q);
                snap.forEach(docSnap => {
                    const data = docSnap.data();
                    if (!data) return;
                    const txId = String(data.transaction_id || docSnap.id);
                    // CHỈ nạp vào danh sách ĐÃ XỬ LÝ nếu giao dịch đã có cờ settled: true
                    if (data.settled === true) {
                        this.processedTxIds.add(txId);
                    }
                });
            } catch (e) {
                console.warn('Ghi chú nạp payment_transactions:', e);
            }
        },

        // 2. Lưu cài đặt vào Firestore và localStorage
        async saveSettings(newSettings) {
            this.config = { ...this.config, ...newSettings };
            try {
                localStorage.setItem('aurora_sepay_config', JSON.stringify(this.config));
            } catch (e) {}

            if (this.db && this.ops && typeof this.ops.setDoc === 'function') {
                try {
                    const docRef = this.ops.doc(this.db, 'settings', 'payment');
                    const serverTs = (typeof this.ops.serverTimestamp === 'function') ? this.ops.serverTimestamp() : new Date();
                    await this.ops.setDoc(docRef, {
                        sepay_api_token: this.config.apiToken || '',
                        sepay_account: this.config.bankAccount || '0123456789',
                        sepay_bank: this.config.bankBrand || 'MBBank',
                        sepay_auto_check: !!this.config.autoCheckEnabled,
                        sepay_auto_settle: !!this.config.autoSettle,
                        sepay_sound: !!this.config.soundNotification,
                        sepay_voice: !!this.config.voiceNotification,
                        sepay_interval: Number(this.config.pollInterval) || 4000,
                        updated_at: serverTs
                    }, { merge: true });
                } catch (e) {
                    console.warn('Lỗi lưu settings/payment lên Firestore:', e);
                }
            }

            // Cập nhật lại trạng thái polling
            if (this.config.autoCheckEnabled && this.config.apiToken) {
                this.startPolling();
            } else {
                this.stopPolling();
            }

            return true;
        },

        // 3. Kiểm tra tính hợp lệ của SePay API Token
        async testToken(token) {
            const apiToken = token || this.config.apiToken;
            if (!apiToken) {
                return { success: false, message: 'Vui lòng nhập API Token từ my.sepay.vn' };
            }

            try {
                const res = await fetch('https://userapi.sepay.vn/v2/transactions?per_page=1', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiToken.trim()}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (res.status === 401) {
                    return { success: false, message: 'API Token không đúng hoặc đã hết hạn (401 Unauthorized).' };
                }

                if (!res.ok) {
                    return { success: false, message: `Lỗi kết nối máy chủ SePay (HTTP ${res.status}).` };
                }

                const json = await res.json();
                return {
                    success: true,
                    message: 'Kết nối SePay thành công! API Token hoàn toàn hợp lệ.',
                    data: json
                };
            } catch (e) {
                return {
                    success: false,
                    message: `Không thể kết nối đến SePay: ${e.message || 'Lỗi mạng hoặc CORS'}`
                };
            }
        },

        // 4. Bắt đầu vòng lặp tự động kiểm tra giao dịch (Polling)
        startPolling() {
            if (this.timerId) clearInterval(this.timerId);
            this.isPolling = true;
            const interval = Math.max(3000, Number(this.config.pollInterval) || 4000);

            // Chạy kiểm tra ngay lần đầu
            this.checkTransactions();

            this.timerId = setInterval(() => {
                this.checkTransactions();
            }, interval);
        },

        // Dừng vòng lặp kiểm tra
        stopPolling() {
            if (this.timerId) {
                clearInterval(this.timerId);
                this.timerId = null;
            }
            this.isPolling = false;
        },

        // 5. Lấy danh sách giao dịch gần nhất từ SePay
        async fetchRecentTransactions() {
            if (!this.config.apiToken) return [];
            try {
                const url = `https://userapi.sepay.vn/v2/transactions?transfer_type=in&per_page=15`;
                const res = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${this.config.apiToken.trim()}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!res.ok) {
                    if (res.status === 401) {
                        console.warn('SePay Token không hợp lệ.');
                        this.stopPolling();
                    }
                    return [];
                }

                const json = await res.json();
                const list = json.data || json.transactions || [];
                return Array.isArray(list) ? list : [];
            } catch (e) {
                console.warn('Lỗi gọi API SePay:', e);
                return [];
            }
        },

        // 6. Kiểm tra giao dịch và so khớp với các bàn đang có đơn
        async checkTransactions() {
            if (this.isChecking || !this.config.apiToken) return;
            this.isChecking = true;
            this.lastCheckTime = new Date();

            if (this.listeners.onCheckStatus) {
                this.listeners.onCheckStatus({ isChecking: true, lastCheck: this.lastCheckTime });
            }

            try {
                // 1. Lấy danh sách bàn đang có khách ngồi từ toàn cục (admin.html)
                const activeTables = this.getActiveTablesSummary();
                if (activeTables.length === 0) {
                    return; // Không có bàn nào đang nợ tiền, không cần quét
                }

                // 2. Lấy các giao dịch tiền vào mới nhất từ ngân hàng
                const txs = await this.fetchRecentTransactions();
                if (!txs || txs.length === 0) return;

                // 3. So khớp từng giao dịch
                for (const tx of txs) {
                    const txId = String(tx.id || tx.reference_number || '');
                    if (!txId || this.processedTxIds.has(txId)) continue;

                    // Chỉ kiểm tra các giao dịch tiền vào và khớp số tài khoản quán (nếu có trường này)
                    const accNo = String(tx.account_number || '').trim();
                    if (accNo && this.config.bankAccount && accNo !== this.config.bankAccount.trim()) {
                        continue;
                    }

                    const getMs = (typeof getSafeMillis === 'function') 
                        ? getSafeMillis 
                        : (typeof window !== 'undefined' && typeof window.getSafeMillis === 'function' ? window.getSafeMillis : null);
                    const txTime = getMs ? getMs(tx.transaction_date || tx.created_at) : 0;
                    if (txTime > 0 && (Date.now() - txTime > 15 * 60 * 1000)) continue;

                    const transferAmount = Number(tx.amount_in || tx.transferAmount || 0);
                    const content = String(tx.transaction_content || tx.content || '').toUpperCase();

                    // Tìm bàn khớp nội dung chuyển khoản và số tiền
                    for (const table of activeTables) {
                        const tableStartTime = table.earliestOrderTime || 0;
                        if (tableStartTime > 0 && txTime > 0 && txTime < tableStartTime - 60000) {
                            continue;
                        }
                        const isMatch = this.matchTransactionWithTable(content, transferAmount, table);
                        if (isMatch) {
                            // Khớp thành công!
                            await this.handlePaymentMatched(table, tx);
                            break; // 1 giao dịch chỉ khớp với 1 bàn
                        }
                    }
                }
            } catch (err) {
                console.error('Lỗi trong chu kỳ checkTransactions:', err);
            } finally {
                this.isChecking = false;
                if (this.listeners.onCheckStatus) {
                    this.listeners.onCheckStatus({ isChecking: false, lastCheck: this.lastCheckTime });
                }
            }
        },

        // Lấy danh sách các bàn đang mở có đơn hàng và số tiền tương ứng
        getActiveTablesSummary(customOrders = null) {
            const orders = (Array.isArray(customOrders) && customOrders.length > 0)
                ? customOrders
                : (Array.isArray(window.allOrders) ? window.allOrders : []);

            if (!Array.isArray(orders) || orders.length === 0) {
                // Nếu chưa có mảng đơn hàng nhưng có bàn đang dừng lại chờ chuyển khoản
                if (window.tablesWaitingForTransferAmounts && window.tablesWaitingForTransferAmounts.size > 0) {
                    const fallbackList = [];
                    window.tablesWaitingForTransferAmounts.forEach((amt, tName) => {
                        if (amt > 0) {
                            fallbackList.push({
                                tableName: tName,
                                cleanCode: this.normalizeTableCode(tName),
                                totalAmount: amt,
                                orders: []
                            });
                        }
                    });
                    return fallbackList;
                }
                return [];
            }

            // Gom nhóm đơn hàng theo bàn
            const tablesMap = new Map();
            for (const ord of orders) {
                if (ord.status === 'settled' || ord.status === 'paid') continue;
                const rawName = String(ord.table_id || '').trim();
                if (!rawName) continue;

                if (!tablesMap.has(rawName)) {
                    tablesMap.set(rawName, {
                        tableName: rawName,
                        cleanCode: this.normalizeTableCode(rawName),
                        totalAmount: 0,
                        earliestOrderTime: 0,
                        orders: []
                    });
                }
                const tableInfo = tablesMap.get(rawName);
                tableInfo.orders.push(ord);

                const getMs = (typeof getSafeMillis === 'function') 
                    ? getSafeMillis 
                    : (typeof window !== 'undefined' && typeof window.getSafeMillis === 'function' ? window.getSafeMillis : null);
                const ordTime = getMs ? getMs(ord.created_at || ord.client_time) : (ord.client_time || (ord.created_at ? new Date(ord.created_at).getTime() : 0));
                if (ordTime > 0 && (!tableInfo.earliestOrderTime || ordTime < tableInfo.earliestOrderTime)) {
                    tableInfo.earliestOrderTime = ordTime;
                }

                let orderAmt = Number(ord.total_amount ?? ord.total_price ?? ord.total ?? 0);
                if (orderAmt === 0 && Array.isArray(ord.items)) {
                    orderAmt = ord.items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 1)), 0);
                }
                tableInfo.totalAmount += orderAmt;
            }

            // Bổ sung các bàn đang trong danh sách dừng lại chờ chuyển khoản
            if (window.tablesWaitingForTransferAmounts && window.tablesWaitingForTransferAmounts instanceof Map) {
                window.tablesWaitingForTransferAmounts.forEach((cachedAmount, wTable) => {
                    if (tablesMap.has(wTable)) {
                        const tInfo = tablesMap.get(wTable);
                        if (cachedAmount > 0) {
                            tInfo.totalAmount = cachedAmount;
                        }
                    }
                });
            }

            return Array.from(tablesMap.values()).filter(t => t.totalAmount > 0);
        },

        // Chuẩn hóa tên bàn để so khớp (Bàn A1 -> A1, Table 4 -> 4)
        normalizeTableCode(tableStr) {
            return String(tableStr || '')
                .toUpperCase()
                .replace(/^(BÀN|BAN|TABLE|TAB)\s*/i, '')
                .trim();
        },

        // Thuật toán so khớp nội dung chuyển khoản và số tiền
        matchTransactionWithTable(content, transferAmount, table) {
            const cleanCode = String(table.cleanCode || '').toUpperCase().trim();
            const fullTable = String(table.tableName || '').toUpperCase().trim();
            const expected = Number(table.totalAmount || 0);

            // 1. Kiểm tra số tiền: Phải đủ số tiền cần trả (cho phép chênh lệch +- 1000đ do làm tròn)
            if (transferAmount < expected - 1000) {
                return false; // Khách chuyển thiếu tiền
            }

            // 2. Chuẩn hóa nội dung chuyển khoản bỏ ký tự đặc biệt
            const upper = String(content || '').toUpperCase();
            const normalized = upper.replace(/[^A-Z0-9]/g, ' ');

            if (
                upper.includes(`BAN ${cleanCode}`) ||
                upper.includes(`BÀN ${cleanCode}`) ||
                upper.includes(`BAN${cleanCode}`) ||
                upper.includes(`BÀN${cleanCode}`) ||
                upper.includes(`THANH TOAN BAN ${cleanCode}`) ||
                upper.includes(`AURORA ${cleanCode}`) ||
                normalized.includes(`BAN ${cleanCode}`) ||
                normalized.includes(`BÀN ${cleanCode}`) ||
                normalized.includes(`THANH TOAN BAN ${cleanCode}`) ||
                new RegExp(`(?:^|\\s)(?:BAN|BÀN|AURORA|TT)?\\s*${cleanCode}(?:\\s|$)`, 'i').test(normalized) ||
                upper.includes(fullTable)
            ) {
                return true;
            }

            return false;
        },

        // Xử lý khi thanh toán khớp thành công
        async handlePaymentMatched(table, tx) {
            const txId = String(tx.id || tx.reference_number || tx.transaction_id || Date.now());
            this.processedTxIds.add(txId);

            const tableName = table.tableName;
            const transferAmount = Number(tx.amount || tx.transferAmount || tx.amount_in || table.totalAmount);
            const refNo = tx.reference_number || tx.referenceCode || txId;
            const content = tx.transaction_content || tx.content || '';

            console.log(`🎉 [SepayService] XÁC NHẬN THANH TOÁN THÀNH CÔNG: Bàn ${tableName} - ${transferAmount.toLocaleString('vi-VN')} VNĐ!`);

            // Xóa bàn khỏi danh sách đang dừng lại chờ chuyển khoản
            if (window.tablesWaitingForTransfer) {
                window.tablesWaitingForTransfer.delete(tableName);
            }
            if (window.tablesWaitingForTransferAmounts) {
                window.tablesWaitingForTransferAmounts.delete(tableName);
            }
            if (typeof window.saveWaitingTransferState === 'function') {
                window.saveWaitingTransferState();
            }

            // 1. Cập nhật giao diện màn hình chờ Webhook nếu đang mở bàn này
            const waitingStatusBadge = document.getElementById('waiting-bill-status-badge');
            const modalBill = document.getElementById('modal-checkout-bill');
            const isModalOpenForThisTable = modalBill && !modalBill.classList.contains('hidden') && 
                window.currentCheckoutTable && (window.currentCheckoutTable === tableName || String(window.currentCheckoutTable).includes(table.cleanCode));

            if (waitingStatusBadge && isModalOpenForThisTable) {
                waitingStatusBadge.className = 'p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 text-white text-center space-y-1.5 shadow-lg anim-scale-up';
                waitingStatusBadge.innerHTML = `
                    <div class="w-10 h-10 rounded-full bg-white text-emerald-600 flex items-center justify-center text-xl mx-auto shadow-md animate-bounce">
                        <i class="fa-solid fa-check"></i>
                    </div>
                    <div class="text-sm font-black">ĐÃ NHẬN TIỀN THÀNH CÔNG!</div>
                    <div class="text-base font-black font-mono">+${transferAmount.toLocaleString('vi-VN')} VNĐ</div>
                    <p class="text-[11px] text-emerald-100">Đã khớp MB Bank · Đang tự động kết bàn và giải phóng bàn...</p>
                `;
            }

            const liveBadge = document.getElementById('sepay-live-listener-badge');
            if (liveBadge) {
                liveBadge.className = 'mt-2.5 p-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 text-white text-center space-y-1 shadow-lg anim-scale-up';
                liveBadge.innerHTML = `
                    <div class="flex items-center justify-center gap-2 text-sm font-black">
                        <i class="fa-solid fa-circle-check text-base"></i>
                        <span>ĐÃ NHẬN TIỀN THÀNH CÔNG!</span>
                    </div>
                    <p class="text-xs font-semibold opacity-95">+${transferAmount.toLocaleString('vi-VN')} VNĐ · Đang tự động kết bàn...</p>
                `;
            }

            // 2. Phát âm thanh Ting Ting vui tai
            if (this.config.soundNotification) {
                this.playPaymentSuccessSound();
            }

            // 3. Ghi log giao dịch vào Firestore để lưu vết và tránh lặp lại
            if (this.db && this.ops && typeof this.ops.setDoc === 'function') {
                try {
                    const docRef = this.ops.doc(this.db, 'payment_transactions', txId);
                    const serverTs = (typeof this.ops.serverTimestamp === 'function') ? this.ops.serverTimestamp() : new Date();
                    await this.ops.setDoc(docRef, {
                        transaction_id: txId,
                        reference_number: refNo,
                        table_name: tableName,
                        table_code: table.cleanCode,
                        amount: transferAmount,
                        expected_amount: table.totalAmount,
                        settled: true, // Đánh dấu đã kết bàn thành công
                        bank: tx.bank || tx.bank_brand_name || tx.gateway || 'MBBank',
                        account_number: tx.account_number || this.config.bankAccount,
                        content: content,
                        transaction_date: tx.transaction_date || tx.created_at || new Date().toISOString(),
                        updated_at: serverTs,
                        source: tx.source || 'sepay_auto_check'
                    }, { merge: true });
                } catch (e) {
                    console.warn('Lỗi ghi payment_transactions:', e);
                }
            }

            // 4. Bắn sự kiện tới Admin UI
            if (typeof window.showAdminToast === 'function') {
                window.showAdminToast(`💰 Đã nhận ${transferAmount.toLocaleString('vi-VN')}đ từ Bàn ${tableName} qua MB Bank!`, 'success');
            }

            // 5. Tự động kết bàn ngay khi tiền về khớp với bàn
            if (typeof window.executeTableSettle === 'function') {
                try {
                    console.log(`⚡ [SepayService] Khớp tiền chuyển khoản! Đang tự động kết bàn ${tableName}...`);
                    await window.executeTableSettle(tableName, 'transfer');
                    
                    // Nếu đang mở modal thanh toán của bàn này thì đóng lại sau 1.8s cho người dùng nhìn thấy thông báo xanh
                    setTimeout(() => {
                        if (typeof window.closeBillCheckoutModal === 'function') {
                            window.closeBillCheckoutModal();
                        }
                    }, 1800);
                } catch (e) {
                    console.error('Lỗi khi tự động kết bàn qua SePay:', e);
                }
            }

            // Cập nhật lại sơ đồ bàn
            if (typeof window.scheduleRenderTableBoard === 'function') {
                window.scheduleRenderTableBoard();
            }

            // Callback riêng (nếu có)
            if (this.listeners.onPaymentSuccess) {
                this.listeners.onPaymentSuccess({ table, transaction: tx });
            }
        },

        // 7. Âm thanh chuông báo Ting-Ting chuyên nghiệp (Web Audio API)
        playPaymentSuccessSound() {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();

                // Chuỗi hợp âm vinh quang ngân nga: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> C6 (1046Hz)
                const notes = [
                    { freq: 523.25, time: 0.00, dur: 0.4 },
                    { freq: 659.25, time: 0.12, dur: 0.4 },
                    { freq: 783.99, time: 0.24, dur: 0.5 },
                    { freq: 1046.50, time: 0.36, dur: 0.9 } // Nốt C6 ngân vang
                ];

                notes.forEach(n => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.time);

                    gain.gain.setValueAtTime(0.001, ctx.currentTime + n.time);
                    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + n.time + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + n.time + n.dur);

                    osc.connect(gain);
                    gain.connect(ctx.destination);

                    osc.start(ctx.currentTime + n.time);
                    osc.stop(ctx.currentTime + n.time + n.dur);
                });
            } catch (e) {
                console.warn('Lỗi phát âm thanh:', e);
            }
        },

        // 8. Giọng đọc trợ lý tiếng Việt (Đã vô hiệu hóa theo yêu cầu người dùng)
        speakPaymentSuccess(tableName, amount) {
            // No-op: Không phát giọng đọc
        },

        // 9. Công cụ TEST GIẢ LẬP: Chỉ cho phép chạy trên localhost để kiểm thử nội bộ, chặn triệt để trên Production
        async simulateTestPayment(tableName, customAmount = null) {
            const isLocal = typeof window !== 'undefined' && (
                window.location.hostname === 'localhost' || 
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname.startsWith('192.168.')
            );
            if (!isLocal) {
                console.warn("⛔ CẢNH BÁO BẢO MẬT: Hàm simulateTestPayment bị vô hiệu hóa hoàn toàn trên môi trường Production!");
                if (typeof window.showAdminToast === 'function') {
                    window.showAdminToast('Chức năng giả lập thanh toán chỉ khả dụng trên máy chủ nội bộ (Localhost)!', 'error');
                }
                return null;
            }

            const cleanCode = this.normalizeTableCode(tableName);
            const activeTables = this.getActiveTablesSummary();
            const matched = activeTables.find(t => t.cleanCode === cleanCode || t.tableName === tableName);

            const finalAmount = customAmount || (matched ? matched.totalAmount : 89000);
            const mockTxId = `SIM_${Date.now()}`;

            const mockTx = {
                id: mockTxId,
                reference_number: `MB_TEST_${Math.floor(Math.random() * 899999 + 100000)}`,
                bank_brand_name: 'MBBank',
                account_number: this.config.bankAccount,
                amount_in: finalAmount,
                transaction_content: `THANH TOAN BAN ${cleanCode} SIMULATED`,
                transaction_date: new Date().toLocaleString('vi-VN'),
                transfer_type: 'in'
            };

            const targetTable = matched || {
                tableName: tableName || 'A1',
                cleanCode: cleanCode || 'A1',
                totalAmount: finalAmount
            };

            await this.handlePaymentMatched(targetTable, mockTx);
            return mockTx;
        }
    };

    // Đưa ra phạm vi toàn cục
    root.SepayService = SepayService;

})(typeof window !== 'undefined' ? window : this);
