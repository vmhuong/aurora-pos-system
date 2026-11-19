// =====================================================================
// AURORA SYSTEM - ADMIN KDS & KITCHEN REALTIME COORDINATION MODULE
// Lắng nghe đơn hàng, KDS điều phối bếp, chuông báo âm thanh & yêu cầu phục vụ
// =====================================================================

(function(root) {
    'use strict';

    function getDb() { return root.firebaseDb || root.db || (typeof window !== 'undefined' ? (window.firebaseDb || window.db) : null); }
    function getOps() { return root.firebaseOps || (typeof window !== 'undefined' ? window.firebaseOps : {}) || {}; }

    var db = null;
    function resolveDbOrRef(d) {
        if (!d || d === db) return getDb();
        return d;
    }

    const collection = (d, ...args) => getOps().collection(resolveDbOrRef(d), ...args);
    const doc = (d, ...args) => getOps().doc(resolveDbOrRef(d), ...args);
    const getDocs = (...args) => getOps().getDocs(...args);
    const getDoc = (...args) => getOps().getDoc(...args);
    const setDoc = (...args) => getOps().setDoc(...args);
    const updateDoc = (...args) => getOps().updateDoc(...args);
    const deleteDoc = (...args) => getOps().deleteDoc(...args);
    const query = (...args) => getOps().query(...args);
    const where = (...args) => getOps().where(...args);
    const orderBy = (...args) => getOps().orderBy(...args);
    const limit = (...args) => getOps().limit(...args);
    const serverTimestamp = (...args) => getOps().serverTimestamp(...args);
    const onSnapshot = (...args) => getOps().onSnapshot(...args);

    function isSoundNotificationEnabled() {
        if (typeof root.isSoundNotificationEnabled === 'function' && root.isSoundNotificationEnabled !== isSoundNotificationEnabled) {
            return root.isSoundNotificationEnabled();
        }
        return localStorage.getItem('aurora_service_sound') !== 'false';
    }

    function isSameTable(tableA, tableB) {
        if (typeof root.isSameTable === 'function') return root.isSameTable(tableA, tableB);
        if (!tableA || !tableB) return false;
        return String(tableA).trim().toUpperCase() === String(tableB).trim().toUpperCase();
    }

    function formatMoney(val) {
        if (typeof root.formatMoney === 'function') return root.formatMoney(val);
        return Number(val || 0).toLocaleString('vi-VN') + ' VNĐ';
    }

    function showAdminToast(msg, type) {
        if (typeof root.showAdminToast === 'function') root.showAdminToast(msg, type);
    }

    function getSafeMillis(val) {
        if (typeof root.getSafeMillis === 'function') return root.getSafeMillis(val);
        if (!val) return 0;
        if (typeof val.toMillis === 'function') return val.toMillis();
        if (typeof val.toDate === 'function') return val.toDate().getTime();
        return new Date(val).getTime() || 0;
    }

    function scheduleRenderTableBoard() {
        if (typeof root.scheduleRenderTableBoard === 'function') {
            root.scheduleRenderTableBoard();
        }
    }

    function loadDashboardStats() {
        if (typeof root.loadDashboardStats === 'function') {
            root.loadDashboardStats();
        }
    }

    function playOrderNotificationSound() {
        if (!isSoundNotificationEnabled()) return;
        try {
            if (root.AdminSound && typeof root.AdminSound.play === 'function') {
                root.AdminSound.play('order');
            } else if (typeof root.playOrderNotificationSound === 'function' && root.playOrderNotificationSound !== playOrderNotificationSound) {
                root.playOrderNotificationSound();
            } else if (typeof window !== 'undefined' && typeof window.playOrderNotificationSound === 'function' && window.playOrderNotificationSound !== playOrderNotificationSound) {
                window.playOrderNotificationSound();
            } else {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();
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
            }
        } catch(e) {
            console.warn("Chime playback note:", e);
        }
    }

    let allOrders = root.allOrders || [];
    let allServiceRequests = root.allServiceRequests || [];
    let cachedOrderItemsMap = root.cachedOrderItemsMap || {};
    let knownOrderIds = new Set();
    let hasInitializedOrders = false;
    let ordersUnsub = null;
    let orderItemsUnsub = null;
    let serviceUnsub = null;
    let currentServiceFilter = 'pending';

        /* ================= 4. QUẢN LÝ ĐƠN HÀNG THEO SƠ ĐỒ BÀN (REALTIME CAO CẤP) ================= */
        // Lắng nghe chi tiết món ăn (order_items) Realtime vào bộ nhớ đệm
        function listenOrderItemsRealtime() {
            try {
                if (orderItemsUnsub) {
                    orderItemsUnsub();
                    orderItemsUnsub = null;
                }
                // Tối ưu hóa hiệu năng cao cấp (Senior Architecture):
                // Toàn bộ đơn hàng hiện đại đều lưu danh sách món trong mảng `items` của document `orders`.
                // Các trường hợp đơn cũ / tách món đã có cơ chế tự động tải on-demand theo order_id.
                // Do đó, ngắt bỏ listener tải toàn bộ collection lịch sử order_items để tiết kiệm 100% RAM & Quota.
                cachedOrderItemsMap = root.cachedOrderItemsMap || {};
            } catch(e) {
                console.error("Không thể khởi tạo listener order_items: ", e);
            }
        }

        function listenOrdersRealtime() {
            try {
                if (ordersUnsub) {
                    ordersUnsub();
                    ordersUnsub = null;
                }
                // Tối ưu hóa hiệu năng & chống nghẽn mạng (Senior Architecture):
                // Chỉ lắng nghe các đơn hàng đang hoạt động (active), loại trừ hàng chục nghìn đơn lịch sử đã kết toán.
                const q = query(
                    collection(db, "orders"),
                    where("status", "in", ["pending", "cooking", "done", "assistance", "checkout"])
                );
                ordersUnsub = onSnapshot(q, (snap) => {
                    let hasNewPendingOrder = false;
                    let newOrderTable = '';

                    snap.docChanges().forEach(change => {
                        if (change.type === 'added') {
                            const data = change.doc.data();
                            // Nếu hệ thống đã khởi tạo xong dữ liệu ban đầu và đây là đơn mới gửi vào
                            if (hasInitializedOrders && !knownOrderIds.has(change.doc.id)) {
                                if (data.status === 'pending') {
                                    hasNewPendingOrder = true;
                                    newOrderTable = data.table_id || 'khách';
                                }
                            }
                        }
                        knownOrderIds.add(change.doc.id);
                    });

                    allOrders = [];
                    snap.forEach(d => {
                        allOrders.push({ id: d.id, ...d.data() });
                    });

                    // Sắp xếp an toàn theo thời gian (mới nhất lên đầu)
                    allOrders.sort((a, b) => {
                        const tA = getSafeMillis(a.created_at);
                        const tB = getSafeMillis(b.created_at);
                        return tB - tA;
                    });
                    window.allOrders = allOrders;

                    // Tự động dọn các bàn chờ chuyển khoản nếu bàn đó đã được kết bàn xong
                    if (window.tablesWaitingForTransfer && window.tablesWaitingForTransfer.size > 0) {
                        let transferStateChanged = false;
                        window.tablesWaitingForTransfer.forEach(tName => {
                            const hasActive = allOrders.some(o => isSameTable(o.table_id, tName) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
                            if (!hasActive) {
                                window.tablesWaitingForTransfer.delete(tName);
                                if (window.tablesWaitingForTransferAmounts) window.tablesWaitingForTransferAmounts.delete(tName);
                                transferStateChanged = true;
                            }
                        });
                        if (transferStateChanged && typeof window.saveWaitingTransferState === 'function') {
                            window.saveWaitingTransferState();
                        }
                    }

                    if (!hasInitializedOrders) {
                        hasInitializedOrders = true;
                    } else if (hasNewPendingOrder) {
                        try {
                            playOrderNotificationSound();
                        } catch(soundErr) {
                            console.warn("Chime note:", soundErr);
                        }
                        try {
                            showAdminToast(`🔔 BÀN ${newOrderTable.toUpperCase()} VỪA GỬI ĐƠN HÀNG MỚI!`, 'order');
                        } catch(toastErr) {}
                    }

                    scheduleRenderTableBoard();
                    if (typeof loadDashboardStats === 'function') {
                        const dashTab = typeof document !== 'undefined' ? document.getElementById('tab-dashboard') : null;
                        if (dashTab && !dashTab.classList.contains('hidden')) {
                            loadDashboardStats();
                        }
                    }
                }, (err) => {
                    console.error("Lỗi lắng nghe orders realtime: ", err);
                });
            } catch(e) {
                console.error("Không thể khởi tạo listener orders: ", e);
            }
        }


        /* ================= 5. YÊU CẦU PHỤC VỤ REALTIME & TRUNG TÂM ĐIỀU PHỐI ================= */
        let hasInitializedService = false;
        let knownServiceRequestIds = new Set();
        let serviceSoundEnabled = (typeof window.isSoundNotificationEnabled === 'function') 
            ? window.isSoundNotificationEnabled() 
            : (localStorage.getItem('aurora_service_sound') !== 'false');

        // Hệ thống âm thanh chuông báo thời gian thực chuẩn Lounge
        function playServiceNotificationSound(type) {
            if (typeof window.isSoundNotificationEnabled === 'function' && !window.isSoundNotificationEnabled()) {
                return;
            }
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

        window.toggleServiceSound = function() {
            const current = (typeof window.isSoundNotificationEnabled === 'function')
                ? window.isSoundNotificationEnabled()
                : (localStorage.getItem('aurora_service_sound') !== 'false');
            const next = !current;
            localStorage.setItem('aurora_service_sound', next ? 'true' : 'false');
            serviceSoundEnabled = next;
            updateServiceSoundUI();
            if (next) {
                playServiceNotificationSound('assistance');
                showAdminToast('🔔 Đã bật âm thanh chuông báo (Đơn hàng & Phục vụ)', 'info');
            } else {
                showAdminToast('🔕 Đã tắt âm thanh chuông báo toàn hệ thống', 'info');
            }
        };

        window.testServiceSound = function() {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    const ctx = new AudioCtx();
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
            showAdminToast('🔔 Đang phát thử âm thanh chuông báo', 'info');
        };

        function updateServiceSoundUI() {
            const isEnabled = (typeof window.isSoundNotificationEnabled === 'function')
                ? window.isSoundNotificationEnabled()
                : (localStorage.getItem('aurora_service_sound') !== 'false');
            serviceSoundEnabled = isEnabled;

            // 1. Cập nhật nút trên tab Gọi phục vụ
            const btn = document.getElementById('service-sound-toggle-btn');
            const icon = document.getElementById('service-sound-icon');
            const text = document.getElementById('service-sound-text');
            if (btn && icon && text) {
                if (isEnabled) {
                    btn.className = "px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 shadow-2xs";
                    icon.className = "fa-solid fa-volume-high text-amber-600";
                    text.innerText = "Chuông: BẬT";
                } else {
                    btn.className = "px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition text-gray-500 bg-gray-100 hover:bg-gray-200 border border-gray-200 shadow-2xs";
                    icon.className = "fa-solid fa-volume-xmark text-gray-400";
                    text.innerText = "Chuông: TẮT";
                }
            }

            // 2. Cập nhật nút trên tab Sơ đồ bàn & Đơn hàng
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
        }
        window.updateServiceSoundUI = updateServiceSoundUI;

        function listenServiceRealtime() {
            try {
                if (serviceUnsub) {
                    serviceUnsub();
                    serviceUnsub = null;
                }
                const q = query(collection(db, "service_requests"));
                serviceUnsub = onSnapshot(q, (snap) => {
                    let hasNewPendingService = false;
                    let newestReqType = 'assistance';
                    let newestReqTable = '';
                    let newestReqNote = '';

                    snap.docChanges().forEach(change => {
                        if (change.type === 'added') {
                            const data = change.doc.data();
                            if (hasInitializedService && !knownServiceRequestIds.has(change.doc.id)) {
                                if (data.status === 'pending') {
                                    hasNewPendingService = true;
                                    newestReqType = data.type || 'assistance';
                                    newestReqTable = data.table_id || 'khách';
                                    newestReqNote = data.note || '';
                                }
                            }
                        }
                        knownServiceRequestIds.add(change.doc.id);
                    });

                    allServiceRequests = [];
                    snap.forEach(d => {
                        allServiceRequests.push({ id: d.id, ...d.data() });
                    });

                    allServiceRequests.sort((a, b) => {
                        const tA = getSafeMillis(a.created_at);
                        const tB = getSafeMillis(b.created_at);
                        return tB - tA;
                    });

                    if (!hasInitializedService) {
                        hasInitializedService = true;
                    } else if (hasNewPendingService) {
                        playServiceNotificationSound(newestReqType);
                        if (newestReqType === 'checkout') {
                            showAdminToast(`💳 BÀN ${newestReqTable.toUpperCase()} YÊU CẦU THANH TOÁN TẠI BÀN!`, 'order');
                        } else {
                            const noteText = newestReqNote ? `: ${newestReqNote}` : '!';
                            showAdminToast(`🔔 BÀN ${newestReqTable.toUpperCase()} GỌI HỖ TRỢ${noteText}`, 'info');
                        }
                    }

                    renderServiceRequests();
                    scheduleRenderTableBoard();
                    if (typeof loadDashboardStats === 'function') {
                        const dashTab = typeof document !== 'undefined' ? document.getElementById('tab-dashboard') : null;
                        if (dashTab && !dashTab.classList.contains('hidden')) {
                            loadDashboardStats();
                        }
                    }
                }, (err) => {
                    console.error("Lỗi lắng nghe service_requests: ", err);
                });
            } catch(e) {
                console.error("Không thể khởi tạo listener service_requests: ", e);
            }
        }

        function renderServiceRequests() {
            const container = document.getElementById('service-requests-list');
            if (!container) return;
            
            updateServiceSoundUI();

            // Tính toán số liệu thống kê KPI
            const pendingList = allServiceRequests.filter(s => s.status === 'pending');
            const pendingCount = pendingList.length;
            const checkoutCount = pendingList.filter(s => s.type === 'checkout').length;
            const assistanceCount = pendingList.filter(s => s.type !== 'checkout').length;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayMillis = today.getTime();
            const resolvedTodayCount = allServiceRequests.filter(s => {
                if (s.status !== 'resolved') return false;
                const m = getSafeMillis(s.created_at);
                return m >= todayMillis;
            }).length;

            // Cập nhật thẻ KPI
            const kpiPendingEl = document.getElementById('kpi-service-pending');
            if (kpiPendingEl) kpiPendingEl.innerText = pendingCount;
            const kpiCheckoutEl = document.getElementById('kpi-service-checkout');
            if (kpiCheckoutEl) kpiCheckoutEl.innerText = checkoutCount;
            const kpiAssistanceEl = document.getElementById('kpi-service-assistance');
            if (kpiAssistanceEl) kpiAssistanceEl.innerText = assistanceCount;
            const kpiResolvedEl = document.getElementById('kpi-service-resolved');
            if (kpiResolvedEl) kpiResolvedEl.innerText = resolvedTodayCount;

            // Cập nhật badge trên sidebar
            const badge = document.getElementById('badge-pending-service');
            if (badge) {
                if (pendingCount > 0) {
                    badge.innerText = pendingCount;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }

            // Cập nhật số đếm trên filter chips
            const bPending = document.getElementById('sfilter-badge-pending');
            if (bPending) bPending.innerText = pendingCount;
            const bAssistance = document.getElementById('sfilter-badge-assistance');
            if (bAssistance) bAssistance.innerText = assistanceCount;
            const bCheckout = document.getElementById('sfilter-badge-checkout');
            if (bCheckout) bCheckout.innerText = checkoutCount;

            // Cập nhật nút Resolve All
            const resolveAllBtn = document.getElementById('btn-resolve-all-service');
            if (resolveAllBtn) {
                if (pendingCount > 0) {
                    resolveAllBtn.disabled = false;
                    resolveAllBtn.classList.remove('opacity-40', 'cursor-not-allowed');
                } else {
                    resolveAllBtn.disabled = true;
                    resolveAllBtn.classList.add('opacity-40', 'cursor-not-allowed');
                }
            }

            // Lọc dữ liệu theo tab đã chọn
            let list = [];
            if (currentServiceFilter === 'pending') {
                list = pendingList;
            } else if (currentServiceFilter === 'assistance') {
                list = pendingList.filter(s => s.type !== 'checkout');
            } else if (currentServiceFilter === 'checkout') {
                list = pendingList.filter(s => s.type === 'checkout');
            } else if (currentServiceFilter === 'resolved') {
                list = allServiceRequests.filter(s => s.status === 'resolved');
            } else {
                list = allServiceRequests;
            }

            // Lọc theo ô tìm kiếm số bàn
            const searchInput = document.getElementById('service-search-input');
            const searchVal = (searchInput ? searchInput.value : '').trim().toLowerCase();
            if (searchVal) {
                list = list.filter(s => {
                    const tId = (s.table_id || '').toLowerCase();
                    const type = (s.type || '').toLowerCase();
                    return tId.includes(searchVal) || type.includes(searchVal);
                });
            }

            // Sắp xếp
            const sortSelect = document.getElementById('service-sort-select');
            const sortMode = sortSelect ? sortSelect.value : 'longest';
            list.sort((a, b) => {
                const tA = getSafeMillis(a.created_at);
                const tB = getSafeMillis(b.created_at);
                if (sortMode === 'longest') {
                    // Nếu đang chờ: cũ nhất / chờ lâu nhất lên trước
                    if (a.status === 'pending' && b.status === 'pending') {
                        return tA - tB;
                    }
                    if (a.status === 'pending') return -1;
                    if (b.status === 'pending') return 1;
                    return tB - tA;
                } else {
                    return tB - tA;
                }
            });

            container.innerHTML = '';

            // Nếu không có dữ liệu
            if (list.length === 0) {
                let emptyMsg = "Hiện không có yêu cầu phục vụ nào đang chờ";
                let emptySub = "Hệ thống đang hoạt động và giám sát thời gian thực. Bất kỳ yêu cầu gọi nhân viên hoặc thanh toán nào từ khách sẽ hiển thị và phát chuông ngay lập tức.";
                if (currentServiceFilter === 'checkout') {
                    emptyMsg = "Không có bàn nào yêu cầu thanh toán";
                    emptySub = "Tất cả khách hàng đang dùng bữa thoải mái hoặc chưa có yêu cầu xuất hóa đơn.";
                } else if (currentServiceFilter === 'assistance') {
                    emptyMsg = "Không có bàn nào gọi nhân viên";
                    emptySub = "Các bàn đều đang được phục vụ chu đáo.";
                } else if (currentServiceFilter === 'resolved') {
                    emptyMsg = "Chưa có yêu cầu nào được xử lý hôm nay";
                    emptySub = "Lịch sử các yêu cầu đã hoàn thành sẽ xuất hiện tại đây.";
                } else if (searchVal) {
                    emptyMsg = `Không tìm thấy yêu cầu nào cho "${searchVal}"`;
                    emptySub = "Vui lòng kiểm tra lại số bàn hoặc chọn bộ lọc Tất cả.";
                }

                container.innerHTML = `
                    <div class="col-span-full py-16 px-6 bg-white rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center anim-fade-in">
                        <div class="w-16 h-16 rounded-3xl bg-amber-50 text-[#b89728] flex items-center justify-center text-2xl mb-3 shadow-inner">
                            <i class="fa-solid fa-bell-slash"></i>
                        </div>
                        <h3 class="font-bold text-gray-800 text-base">${emptyMsg}</h3>
                        <p class="text-xs text-gray-400 max-w-md mt-1 leading-relaxed">${emptySub}</p>
                    </div>
                `;
                return;
            }

            // Render từng thẻ Ticket chuyên nghiệp
            const now = Date.now();
            list.forEach(req => {
                const tableName = req.table_id || '?';
                const cleanTableName = tableName.replace(/^(bàn\s*)+/i, '').trim() || tableName;
                const isPending = req.status === 'pending';
                const isCheckout = req.type === 'checkout';

                // Tính thời gian tạo & chờ
                const createdMillis = getSafeMillis(req.created_at);
                let timeAgoText = 'Vừa xong';
                let exactTimeText = '';
                let waitMinutes = 0;
                let isUrgent = false;

                if (createdMillis > 0) {
                    exactTimeText = new Date(createdMillis).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const diffSec = Math.max(0, Math.floor((now - createdMillis) / 1000));
                    waitMinutes = Math.floor(diffSec / 60);
                    if (diffSec < 60) {
                        timeAgoText = 'Vừa xong';
                    } else if (waitMinutes < 60) {
                        timeAgoText = `${waitMinutes} phút trước`;
                    } else {
                        const h = Math.floor(waitMinutes / 60);
                        timeAgoText = `${h} giờ ${waitMinutes % 60}p trước`;
                    }
                    if (isPending && waitMinutes >= 5) {
                        isUrgent = true;
                    }
                }

                // Tìm thông tin bàn từ allTables
                const tableObj = allTables.find(t => isSameTable(t.name, cleanTableName) || isSameTable(t.name, tableName));
                const staffName = tableObj ? (tableObj.assigned_staff_name || tableObj.assigned_staff_username) : null;

                // Tìm thông tin đơn hàng hiện tại từ allOrders
                const activeOrders = allOrders.filter(o => isSameTable(o.table_id, cleanTableName) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
                let sessionTotal = 0;
                let dishCount = 0;
                activeOrders.forEach(o => {
                    sessionTotal += Number(o.total_amount || 0);
                    const items = cachedOrderItemsMap[o.id] || o.items || [];
                    dishCount += items.length;
                });

                // Style theo loại yêu cầu
                const typeBadge = isCheckout
                    ? `<span class="bg-gradient-to-r from-purple-100 to-indigo-100 text-purple-800 font-bold px-2.5 py-1 rounded-xl text-xs flex items-center gap-1.5 border border-purple-200">
                         <i class="fa-solid fa-file-invoice-dollar text-purple-600"></i> Thanh Toán
                       </span>`
                    : `<span class="bg-gradient-to-r from-blue-100 to-cyan-100 text-blue-800 font-bold px-2.5 py-1 rounded-xl text-xs flex items-center gap-1.5 border border-blue-200">
                         <i class="fa-solid fa-bell text-blue-600"></i> Gọi Nhân Viên
                       </span>`;

                const cardBorder = isUrgent
                    ? 'border-2 border-red-500 shadow-md ring-2 ring-red-100'
                    : (isPending 
                        ? (isCheckout ? 'border border-purple-200 hover:border-purple-300 shadow-sm' : 'border border-blue-200 hover:border-blue-300 shadow-sm')
                        : 'border border-gray-100 opacity-80 bg-gray-50/50');

                const cardHeaderBg = isUrgent
                    ? 'bg-red-50/80 border-b border-red-100'
                    : (isPending
                        ? (isCheckout ? 'bg-gradient-to-r from-purple-50/70 via-indigo-50/40 to-white border-b border-purple-100' : 'bg-gradient-to-r from-blue-50/70 via-cyan-50/40 to-white border-b border-blue-100')
                        : 'bg-gray-50 border-b border-gray-100');

                const card = document.createElement('div');
                card.className = `bg-white rounded-3xl ${cardBorder} flex flex-col justify-between overflow-hidden transition-all duration-200 hover:shadow-md`;

                card.innerHTML = `
                    <!-- Card Header -->
                    <div class="p-4 ${cardHeaderBg}">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-3">
                                <div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#d4af37] to-[#b89728] text-white font-black flex items-center justify-center text-sm shadow-sm tracking-tight flex-shrink-0">
                                    ${cleanTableName}
                                </div>
                                <div>
                                    <div class="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                                        <span>Bàn ${cleanTableName}</span>
                                        ${isUrgent ? `<span class="bg-red-500 text-white font-extrabold px-2 py-0.5 rounded-full text-[10px] animate-pulse">⚠️ Chờ ${waitMinutes}p</span>` : ''}
                                    </div>
                                    <div class="text-[11px] text-gray-400 font-medium flex items-center gap-1 mt-0.5">
                                        <i class="fa-regular fa-clock text-[10px]"></i>
                                        <span>${timeAgoText}</span>
                                        ${exactTimeText ? `<span class="text-gray-300">•</span><span>${exactTimeText}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            <div>${typeBadge}</div>
                        </div>
                    </div>

                    <!-- Card Body / Context Info -->
                    <div class="p-4 space-y-3 flex-1 text-xs">
                        <!-- Yêu cầu chi tiết -->
                        <div class="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                            ${isCheckout ? `
                                <div class="flex items-center justify-between">
                                    <span class="text-gray-500 font-medium flex items-center gap-1.5">
                                        <i class="fa-solid fa-receipt text-purple-500"></i> Hóa đơn tạm tính:
                                    </span>
                                    <span class="font-black text-[#b89728] text-sm">${sessionTotal > 0 ? formatMoney(sessionTotal) : '0 VNĐ'}</span>
                                </div>
                                <div class="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
                                    <span>${dishCount > 0 ? `${dishCount} món đang phục vụ` : 'Chưa có đơn phát sinh'}</span>
                                    <span class="font-semibold text-purple-700">Khách đợi thanh toán tại bàn</span>
                                </div>
                            ` : `
                                ${req.note ? `
                                    <div class="bg-amber-50 border border-amber-300 rounded-2xl p-3 mb-2 shadow-2xs">
                                        <div class="text-[10px] font-black text-amber-800 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                                            <i class="fa-solid fa-comment-dots text-amber-600"></i> Yêu cầu của khách:
                                        </div>
                                        <div class="text-xs font-black text-gray-900 leading-snug">
                                            ${escapeHtml(req.note)}
                                        </div>
                                    </div>
                                ` : `
                                    <div class="text-gray-700 font-medium flex items-start gap-2 mb-1">
                                        <i class="fa-solid fa-comment-dots text-blue-500 mt-0.5"></i>
                                        <span>Khách cần hỗ trợ phục vụ tại bàn</span>
                                    </div>
                                `}
                                <div class="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
                                    <span>${dishCount > 0 ? `Bàn có ${dishCount} món (${formatMoney(sessionTotal)})` : 'Bàn chưa gọi món'}</span>
                                    <span class="font-semibold text-blue-700">Đang chờ nhân viên đến</span>
                                </div>
                            `}
                        </div>

                        <!-- Nhân viên phụ trách bàn & trạng thái -->
                        <div class="flex items-center justify-between text-[11px] px-1 text-gray-500">
                            <span class="flex items-center gap-1.5">
                                <i class="fa-solid fa-user-tie text-gray-400"></i>
                                <span>Phụ trách: <b>${staffName || 'Chưa phân công'}</b></span>
                            </span>
                            <span class="flex items-center gap-1 font-semibold ${isPending ? 'text-amber-600' : 'text-emerald-600'}">
                                <span class="w-1.5 h-1.5 rounded-full ${isPending ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}"></span>
                                <span>${isPending ? 'Đang đợi hỗ trợ' : 'Đã hoàn thành'}</span>
                            </span>
                        </div>
                    </div>

                    <!-- Card Footer Actions -->
                    <div class="p-4 pt-0">
                        ${isPending ? `
                            <div class="flex items-center gap-2">
                                <button onclick="resolveServiceRequest('${req.id}')" class="flex-1 py-2.5 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-2xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 active:scale-[0.98]">
                                    <i class="fa-solid fa-check"></i>
                                    <span>Đã xong</span>
                                </button>
                                <button onclick="openTableDetail('${cleanTableName}')" class="py-2.5 px-3 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-2xl text-xs transition border border-amber-200 flex items-center justify-center gap-1.5" title="Mở xem chi tiết các món & hóa đơn">
                                    <i class="fa-solid fa-receipt"></i>
                                    <span>Xem Bill</span>
                                </button>
                            </div>
                        ` : `
                            <div class="flex items-center gap-2">
                                <div class="flex-1 py-2 bg-emerald-50 text-emerald-700 font-bold rounded-2xl text-xs flex items-center justify-center gap-1.5 border border-emerald-100">
                                    <i class="fa-solid fa-circle-check"></i>
                                    <span>Đã xử lý thành công</span>
                                </div>
                                <button onclick="openTableDetail('${cleanTableName}')" class="py-2 px-3 bg-gray-50 hover:bg-gray-100 text-gray-700 font-semibold rounded-2xl text-xs transition border border-gray-200 flex items-center justify-center gap-1">
                                    <i class="fa-solid fa-eye"></i>
                                    <span>Xem bàn</span>
                                </button>
                            </div>
                        `}
                    </div>
                `;

                container.appendChild(card);
            });
        }

        window.setServiceFilter = function(filter) {
            currentServiceFilter = filter;
            document.querySelectorAll('.service-chip').forEach(btn => {
                btn.className = "service-chip px-3.5 py-2 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition flex items-center gap-1.5 font-semibold";
            });
            const activeBtn = document.getElementById(`sfilter-${filter}`);
            if (activeBtn) {
                activeBtn.className = "service-chip px-3.5 py-2 rounded-xl bg-amber-500 text-white font-bold shadow-xs transition flex items-center gap-1.5";
            }
            renderServiceRequests();
        };
        window.filterService = window.setServiceFilter; // Alias

        window.resolveServiceRequest = async function(id) {
            try {
                await updateDoc(doc(db, "service_requests", id), { 
                    status: 'resolved',
                    resolved_at: serverTimestamp()
                });
                showAdminToast('✓ Đã xác nhận xử lý xong yêu cầu!', 'success');
            } catch (err) {
                console.error("Lỗi cập nhật yêu cầu:", err);
                alert("Lỗi cập nhật yêu cầu!");
            }
        };

        window.resolveAllPendingService = async function() {
            const pendingList = allServiceRequests.filter(s => s.status === 'pending');
            if (pendingList.length === 0) {
                showAdminToast('Hiện không có yêu cầu nào đang chờ', 'info');
                return;
            }
            if (!confirm(`Bạn có chắc chắn muốn đánh dấu đã xử lý xong TẤT CẢ ${pendingList.length} yêu cầu phục vụ đang chờ?`)) {
                return;
            }
            try {
                const promises = pendingList.map(r => updateDoc(doc(db, "service_requests", r.id), {
                    status: 'resolved',
                    resolved_at: serverTimestamp()
                }));
                await Promise.all(promises);
                showAdminToast(`✓ Đã hoàn thành tất cả ${pendingList.length} yêu cầu phục vụ!`, 'success');
            } catch (err) {
                console.error("Lỗi xử lý tất cả yêu cầu:", err);
                alert("Lỗi khi cập nhật danh sách yêu cầu!");
            }
        };

        // Chu kỳ tự động cập nhật thời gian mở bàn & thời gian chờ dịch vụ mỗi 30 giây
        setInterval(() => {
            const tabOrders = document.getElementById('tab-orders');
            if (tabOrders && !tabOrders.classList.contains('hidden')) {
                scheduleRenderTableBoard();
            }
            const tabService = document.getElementById('tab-service');
            if (tabService && !tabService.classList.contains('hidden')) {
                renderServiceRequests();
            }
        }, 30000);


    // Export public methods to root
    root.allOrders = allOrders;
    root.allServiceRequests = allServiceRequests;
    root.cachedOrderItemsMap = cachedOrderItemsMap;
    if (typeof window !== 'undefined') {
        window.allOrders = allOrders;
        window.allServiceRequests = allServiceRequests;
        window.cachedOrderItemsMap = cachedOrderItemsMap;
    }

    try { root.listenOrderItemsRealtime = listenOrderItemsRealtime; if (typeof window !== 'undefined') window.listenOrderItemsRealtime = listenOrderItemsRealtime; } catch(e) {}
    try { root.listenOrdersRealtime = listenOrdersRealtime; if (typeof window !== 'undefined') window.listenOrdersRealtime = listenOrdersRealtime; } catch(e) {}
    try { root.listenServiceRealtime = listenServiceRealtime; if (typeof window !== 'undefined') window.listenServiceRealtime = listenServiceRealtime; } catch(e) {}
    try { root.renderServiceRequests = renderServiceRequests; if (typeof window !== 'undefined') window.renderServiceRequests = renderServiceRequests; } catch(e) {}
    try { root.setServiceFilter = setServiceFilter; if (typeof window !== 'undefined') window.setServiceFilter = setServiceFilter; } catch(e) {}
    try { root.filterService = setServiceFilter; if (typeof window !== 'undefined') window.filterService = setServiceFilter; } catch(e) {}
    try { root.resolveServiceRequest = resolveServiceRequest; if (typeof window !== 'undefined') window.resolveServiceRequest = resolveServiceRequest; } catch(e) {}
    try { root.resolveAllPendingService = resolveAllPendingService; if (typeof window !== 'undefined') window.resolveAllPendingService = resolveAllPendingService; } catch(e) {}
    try { root.playOrderNotificationSound = playOrderNotificationSound; if (typeof window !== 'undefined') window.playOrderNotificationSound = playOrderNotificationSound; } catch(e) {}

    const soundMethods = [
        'isSoundNotificationEnabled', 'updateServiceSoundUI',
        'playOrderNotificationSound', 'playServiceNotificationSound',
        'toggleServiceSound', 'testServiceSound'
    ];
    soundMethods.forEach(name => {
        let fn = undefined;
        try {
            if (typeof window !== 'undefined' && typeof window[name] === 'function') fn = window[name];
            else if (typeof root[name] === 'function') fn = root[name];
        } catch(e) {}
        if (fn) {
            root[name] = fn;
            if (typeof window !== 'undefined') window[name] = fn;
        }
    });

})(typeof window !== 'undefined' ? window : this);