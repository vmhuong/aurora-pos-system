// =====================================================================
// AURORA SYSTEM - ADMIN TABLES & FLOOR PLAN MANAGEMENT MODULE
// Sơ đồ bàn thời gian thực, quản lý mã QR, in ấn, điều chuyển / gộp bàn & thanh toán
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
    const deleteField = (...args) => getOps().deleteField(...args);
    const onSnapshot = (...args) => {
        const fn = getOps().onSnapshot || root.onSnapshot || (typeof window !== 'undefined' ? ((window.firebaseOps && window.firebaseOps.onSnapshot) || window.onSnapshot) : null);
        if (typeof fn === 'function') return fn(...args);
        console.warn("onSnapshot chưa sẵn sàng trong firebaseOps");
        return () => {};
    };
    const writeBatch = (d) => (root.writeBatch || getOps().writeBatch)(resolveDbOrRef(d));

    // Debounced floor plan render
    let renderBoardPending = false;
    function scheduleRenderTableBoard() {
        if (typeof root.scheduleRenderTableBoard === 'function' && root.scheduleRenderTableBoard !== scheduleRenderTableBoard) {
            root.scheduleRenderTableBoard();
            return;
        }
        if (renderBoardPending) return;
        renderBoardPending = true;
        const raf = root.requestAnimationFrame || (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb => setTimeout(cb, 16)));
        raf(() => {
            renderBoardPending = false;
            renderTableBoard();
        });
    }

    // Helper functions
    function normalizeTableCode(code) {
        if (!code) return '';
        return String(code).toUpperCase().replace(/^(TABLE|BÀN|BAN)\s*/i, '').trim();
    }

    function isSameTable(tableA, tableB) {
        if (!tableA || !tableB) return false;
        const strA = String(tableA).trim().toUpperCase();
        const strB = String(tableB).trim().toUpperCase();
        if (strA === strB) return true;
        const normA = normalizeTableCode(strA);
        const normB = normalizeTableCode(strB);
        return (normA.length > 0 && normA === normB);
    }

    function formatMoney(val) {
        if (typeof root.formatMoney === 'function') return root.formatMoney(val);
        return Number(val || 0).toLocaleString('vi-VN') + ' VNĐ';
    }

    function escapeHtml(str) {
        if (typeof root.escapeHtml === 'function') return root.escapeHtml(str);
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function formatAdminOptionsHtml(summary) {
        if (typeof root.formatAdminOptionsHtml === 'function') return root.formatAdminOptionsHtml(summary);
        return '';
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

    // Dynamic Live Proxies for real-time data sync with KDS & Orders
    const allOrders = new Proxy({}, {
        get: (target, prop) => {
            const arr = root.allOrders || (typeof window !== 'undefined' ? window.allOrders : []) || [];
            const val = arr[prop];
            return typeof val === 'function' ? val.bind(arr) : val;
        }
    });

    const allServiceRequests = new Proxy({}, {
        get: (target, prop) => {
            const arr = root.allServiceRequests || (typeof window !== 'undefined' ? window.allServiceRequests : []) || [];
            const val = arr[prop];
            return typeof val === 'function' ? val.bind(arr) : val;
        }
    });

    const cachedOrderItemsMap = new Proxy({}, {
        get: (target, prop) => {
            const map = root.cachedOrderItemsMap || (typeof window !== 'undefined' ? window.cachedOrderItemsMap : {}) || {};
            const val = map[prop];
            return typeof val === 'function' ? val.bind(map) : val;
        }
    });

    let allTables = root.allTables || [];
    let currentTableFilter = 'all';

    // Quản lý voucher lưu trữ theo bàn (SSOT đồng bộ với Firestore tables)
    const tableVouchers = root.tableVouchers || {};
    root.tableVouchers = tableVouchers;
    if (typeof window !== 'undefined') window.tableVouchers = tableVouchers;

    // THUẬT TOÁN SẮP XẾP BÀN TỰ NHIÊN CHUẨN XÁC THEO KHU VỰC VÀ SỐ (A1, A2... B1, B2... C1, C2...)
    function getTableSortKey(tableNameOrObj) {
        const raw = (typeof tableNameOrObj === 'object' && tableNameOrObj !== null)
            ? (tableNameOrObj.name || tableNameOrObj.id || tableNameOrObj.tableId || '')
            : String(tableNameOrObj || '');
        const clean = raw.replace(/^(bàn|ban|table)\s*/i, '').trim().toUpperCase();
        const match = clean.match(/^([A-Z]*)(\d+)?(.*)$/);
        if (match) {
            const prefix = match[1] || 'ZZ';
            const num = match[2] ? parseInt(match[2], 10) : 9999;
            const suffix = match[3] || '';
            return { prefix, num, suffix, clean };
        }
        return { prefix: clean, num: 9999, suffix: '', clean };
    }
    window.getTableSortKey = getTableSortKey;

    function compareTableOrder(a, b) {
        const keyA = getTableSortKey(a);
        const keyB = getTableSortKey(b);
        if (keyA.prefix !== keyB.prefix) {
            return keyA.prefix.localeCompare(keyB.prefix);
        }
        if (keyA.num !== keyB.num) {
            return keyA.num - keyB.num;
        }
        return keyA.suffix.localeCompare(keyB.suffix);
    }
    window.compareTableOrder = compareTableOrder;

        /* ================= 3. QUẢN LÝ BÀN & MÃ QR ================= */
        async function loadTables() {
            try {
                const snap = await getDocs(collection(db, "tables"));
                
                // Khử trùng lặp theo tên bàn (tránh bị nhảy nhiều bàn trùng tên)
                const uniqueMap = new Map();
                snap.forEach(d => {
                    const data = d.data();
                    const name = (data.name || d.id || '').trim();
                    const cleanCode = (name || d.id || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();

                    // Đồng bộ Voucher & Khách hàng từ Firestore (SSOT)
                    const vInit = data.applied_voucher;
                    if (vInit && typeof vInit === 'object' && (vInit.code || vInit.id || vInit.value)) {
                        tableVouchers[cleanCode] = vInit;
                        if (name) tableVouchers[name] = vInit;
                    } else {
                        delete tableVouchers[cleanCode];
                        if (name) delete tableVouchers[name];
                    }
                    if (root.AdminLoyalty && typeof root.AdminLoyalty.setCustomerFromFirestore === 'function') {
                        root.AdminLoyalty.setCustomerFromFirestore(cleanCode, data.attached_customer, data.use_points);
                        if (name && name !== cleanCode) {
                            root.AdminLoyalty.setCustomerFromFirestore(name, data.attached_customer, data.use_points);
                        }
                    }

                    if (name && !uniqueMap.has(name)) {
                        uniqueMap.set(name, { 
                            id: d.id, 
                            ...data, 
                            name,
                            applied_voucher: (vInit && typeof vInit === 'object' && (vInit.code || vInit.id || vInit.value)) ? vInit : null,
                            attached_customer: data.attached_customer || null,
                            use_points: !!data.use_points
                        });
                    }
                });

                allTables = Array.from(uniqueMap.values());

                // Sắp xếp thứ tự tự nhiên chuẩn xác (A1, A2, A3... B1, B2... C1, C2...)
                allTables.sort(compareTableOrder);
                root.allTables = allTables;
                if (typeof window !== 'undefined') window.allTables = allTables;

                renderAllTableQRs();
                scheduleRenderTableBoard();
                listenTablesRealtime();
            } catch (err) {
                console.error("Lỗi tải bàn: ", err);
            }
        }

        let tablesRealtimeUnsub = null;
        function listenTablesRealtime() {
            if (tablesRealtimeUnsub) return;
            try {
                tablesRealtimeUnsub = onSnapshot(collection(db, "tables"), (snap) => {
                    let hasTableChanges = false;
                    const changes = (typeof snap.docChanges === 'function') ? snap.docChanges() : null;

                    if (changes && changes.length > 0) {
                        changes.forEach(c => {
                            if (c.type === 'removed') {
                                const d = c.doc;
                                const dData = (typeof d.data === 'function') ? d.data() : null;
                                const name = ((dData && dData.name) || d.id || '').trim();
                                const cleanCode = (name || d.id || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                                delete tableVouchers[cleanCode];
                                if (name) delete tableVouchers[name];
                                const idx = allTables.findIndex(t => isSameTable(t.id, d.id) || isSameTable(t.name, name));
                                if (idx !== -1) allTables.splice(idx, 1);
                                hasTableChanges = true;
                            }
                        });
                    }

                    const docsList = (changes && changes.length > 0)
                        ? changes.filter(c => c.type !== 'removed').map(c => c.doc)
                        : (snap.docs || []);

                    docsList.forEach(d => {
                        const data = (typeof d.data === 'function') ? d.data() : null;
                        if (!data) return;
                        const name = (data.name || d.id || '').trim();
                        const cleanCode = (name || d.id || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();

                        // 1. Đồng bộ Voucher tức thời (Add / Cancel)
                        const v = data.applied_voucher;
                        if (v && typeof v === 'object' && (v.code || v.id || v.value)) {
                            tableVouchers[cleanCode] = v;
                            if (name) tableVouchers[name] = v;
                        } else {
                            delete tableVouchers[cleanCode];
                            if (name) delete tableVouchers[name];
                        }

                        // 2. Đồng bộ Khách hàng tức thời (Login / Logout / Points)
                        if (root.AdminLoyalty && typeof root.AdminLoyalty.setCustomerFromFirestore === 'function') {
                            root.AdminLoyalty.setCustomerFromFirestore(cleanCode, data.attached_customer, data.use_points);
                            if (name && name !== cleanCode) {
                                root.AdminLoyalty.setCustomerFromFirestore(name, data.attached_customer, data.use_points);
                            }
                        }

                        // 3. Cập nhật Single Source of Truth cho allTables trong bộ nhớ
                        const idx = allTables.findIndex(t => isSameTable(t.id, d.id) || isSameTable(t.name, name) || isSameTable(t.id, cleanCode) || isSameTable(t.name, cleanCode));
                        const tablePayload = {
                            ...data,
                            id: d.id,
                            name: name || (idx !== -1 ? allTables[idx].name : cleanCode),
                            applied_voucher: (v && typeof v === 'object' && (v.code || v.id || v.value)) ? v : null,
                            attached_customer: data.attached_customer || null,
                            use_points: !!data.use_points
                        };

                        if (idx !== -1) {
                            allTables[idx] = { ...allTables[idx], ...tablePayload };
                        } else if (name) {
                            allTables.push(tablePayload);
                        }
                        hasTableChanges = true;
                    });

                    if (hasTableChanges) {
                        allTables.sort(compareTableOrder);
                        root.allTables = allTables;
                        if (typeof window !== 'undefined') window.allTables = allTables;
                        scheduleRenderTableBoard();

                        // Nếu đang mở modal chi tiết bàn thì làm mới dữ liệu khách và voucher ngay lập tức
                        if (tdCurrentTable && typeof openTableDetail === 'function') {
                            const tdModal = document.getElementById('modal-table-detail');
                            if (tdModal && !tdModal.classList.contains('hidden')) {
                                openTableDetail(tdCurrentTable);
                            }
                        }

                        // Nếu đang mở modal thanh toán hóa đơn thì cập nhật số tiền, voucher và khách hàng ngay lập tức (0ms lag, không tải lại món)
                        const checkoutModal = document.getElementById('modal-checkout-bill');
                        if (checkoutModal && !checkoutModal.classList.contains('hidden')) {
                            const curCheckoutT = (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '';
                            if (curCheckoutT) {
                                const isAffected = docsList.some(d => {
                                    const dData = (typeof d.data === 'function') ? d.data() : null;
                                    if (!dData) return false;
                                    const n = (dData.name || d.id || '').trim();
                                    return isSameTable(n, curCheckoutT) || isSameTable(d.id, curCheckoutT);
                                });
                                if (isAffected) {
                                    const cleanT = (typeof normalizeTableCode === 'function')
                                        ? normalizeTableCode(curCheckoutT)
                                        : String(curCheckoutT).replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();

                                    // Cập nhật voucher hiện tại
                                    currentBillAppliedVoucher = tableVouchers[cleanT] || tableVouchers[curCheckoutT] || null;
                                    const vInput = document.getElementById('bill-voucher-input');
                                    const vAppliedInfo = document.getElementById('bill-voucher-applied-info');
                                    const vApplyBtn = document.getElementById('btn-apply-voucher');
                                    const vCancelBtn = document.getElementById('btn-cancel-voucher');
                                    if (currentBillAppliedVoucher) {
                                        if (vInput) vInput.value = currentBillAppliedVoucher.code || currentBillAppliedVoucher.id || '';
                                        if (vAppliedInfo) {
                                            let discountAmt = Number(currentBillAppliedVoucher.discountAmount !== undefined ? currentBillAppliedVoucher.discountAmount : currentBillAppliedVoucher.discount_amount) || 0;
                                            if (!discountAmt && root.VoucherEngine && (typeof root.VoucherEngine.calculateDiscount === 'function' || typeof root.VoucherEngine.validateVoucher === 'function')) {
                                                const evalFn = root.VoucherEngine.calculateDiscount || root.VoucherEngine.validateVoucher;
                                                const calcRes = evalFn.call(root.VoucherEngine, currentBillAppliedVoucher, currentCheckoutSubtotal || 0, currentBillOrderItems || []);
                                                if (calcRes && calcRes.valid && calcRes.discountAmount > 0) {
                                                    discountAmt = calcRes.discountAmount;
                                                    currentBillAppliedVoucher.discountAmount = discountAmt;
                                                }
                                            }
                                            vAppliedInfo.textContent = discountAmt > 0 ? `Đã áp dụng giảm: ${formatMoney(discountAmt)}` : `Đã áp dụng voucher: ${currentBillAppliedVoucher.code || currentBillAppliedVoucher.id}`;
                                            vAppliedInfo.classList.remove('hidden');
                                        }
                                        if (vApplyBtn) vApplyBtn.classList.add('hidden');
                                        if (vCancelBtn) vCancelBtn.classList.remove('hidden');
                                    } else {
                                        if (vInput) vInput.value = '';
                                        if (vAppliedInfo) { vAppliedInfo.textContent = ''; vAppliedInfo.classList.add('hidden'); }
                                        if (vApplyBtn) vApplyBtn.classList.remove('hidden');
                                        if (vCancelBtn) vCancelBtn.classList.add('hidden');
                                    }

                                    // Cập nhật huy hiệu khách hàng trên hóa đơn
                                    if (root.AdminLoyalty && typeof root.AdminLoyalty.updateCustomerTopBarBadge === 'function') {
                                        root.AdminLoyalty.updateCustomerTopBarBadge(curCheckoutT);
                                    }

                                    // Tính lại tổng tiền hóa đơn tức thì (0ms lag, không tải lại danh sách món)
                                    if (typeof updateBillCalculations === 'function') {
                                        updateBillCalculations();
                                    }
                                }
                            }
                        }
                    }
                }, err => console.warn("Lỗi lắng nghe tables:", err));
            } catch(e) {
                console.error("Lỗi khởi tạo listenTablesRealtime:", e);
            }
        }

        root.listenTablesRealtime = listenTablesRealtime;
        if (typeof window !== 'undefined') window.listenTablesRealtime = listenTablesRealtime;

        // ================= QUẢN LÝ LƯU & TẢI BASE URL QR CODE =================
        function getTableMenuUrl(tableName) {
            const cleanName = (tableName || '').replace(/^(bàn\s*)+/i, '').trim() || tableName;
            const normCode = cleanName.toUpperCase();
            const baseInput = document.getElementById('base-qr-url');
            let baseUrl = (baseInput && baseInput.value.trim()) 
                ? baseInput.value.trim() 
                : (localStorage.getItem('aurora_base_qr_url') || (window.location.origin + window.location.pathname.replace(/\/admin(\.html)?\/?$/i, '')));

            if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
                baseUrl = 'https://' + baseUrl;
            }

            // Xóa đuôi /admin, /admin.html, /index.html nếu có để link gọn gàng chuẩn https://domain.web.app/?table=X
            baseUrl = baseUrl.replace(/\/index\.html\/?$/i, '')
                             .replace(/\/admin(\.html)?\/?$/i, '')
                             .replace(/\/+$/, '');

            const separator = baseUrl.includes('?') ? '&' : '/?';

            // Bảo mật: Nhúng mã Token bảo mật của bàn chống việc khách tự gõ đổi số bàn trên URL
            let token = '';
            if (typeof allTables !== 'undefined' && Array.isArray(allTables)) {
                const tObj = allTables.find(t => isSameTable(t.id, normCode) || isSameTable(t.name, normCode));
                if (tObj && tObj.qr_token) token = tObj.qr_token;
            }
            const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
            return `${baseUrl}${separator}table=${encodeURIComponent(cleanName)}${tokenQuery}`;
        }
        window.getTableMenuUrl = getTableMenuUrl;

        window.loadBaseQrUrlSetting = async function() {
            const baseInput = document.getElementById('base-qr-url');
            if (!baseInput) return;

            // 1. Kiểm tra localStorage trước để hiện tức thì
            const localSaved = localStorage.getItem('aurora_base_qr_url');
            if (localSaved) {
                baseInput.value = localSaved.replace(/\/index\.html\/?$/i, '').replace(/\/+$/, '');
            } else {
                const defaultBase = (window.location.origin + window.location.pathname.replace(/\/admin(\.html)?\/?$/i, '')).replace(/\/+$/, '');
                baseInput.value = defaultBase;
            }

            // 2. Tải đồng bộ từ Firestore settings/general
            try {
                const snap = await getDocs(collection(db, "settings"));
                snap.forEach(d => {
                    if (d.id === 'general' && d.data()) {
                        const sData = d.data();
                        if (sData.base_qr_url) {
                            const remoteUrl = (sData.base_qr_url || '').replace(/\/index\.html\/?$/i, '').replace(/\/+$/, '');
                            baseInput.value = remoteUrl;
                            localStorage.setItem('aurora_base_qr_url', remoteUrl);
                            if (typeof renderAllTableQRs === 'function') {
                                renderAllTableQRs();
                            }
                        }
                        if (sData.wifi_ssid || sData.wifi_pass) {
                            const wifiText = `Wifi: ${sData.wifi_ssid || 'Aurora_Guest'} / Pass: ${sData.wifi_pass || 'auroracoffee'}`;
                            const wEl1 = document.getElementById('receipt-wifi-info');
                            const wEl2 = document.getElementById('print-receipt-wifi-info');
                            if (wEl1) wEl1.innerText = wifiText;
                            if (wEl2) wEl2.innerText = wifiText;
                        }
                    }
                });
            } catch (e) {
                console.warn("Không đọc được settings từ Firestore:", e);
            }
        };

        window.saveBaseQrUrl = async function(silent = false) {
            const baseInput = document.getElementById('base-qr-url');
            if (!baseInput) return;
            let val = baseInput.value.trim();
            if (!val) {
                if (!silent) showAdminToast('Vui lòng nhập đường dẫn URL hợp lệ!', 'warning');
                return;
            }
            if (!val.startsWith('http://') && !val.startsWith('https://')) {
                val = 'https://' + val;
            }

            // Chuẩn hóa: loại bỏ /index.html hoặc /admin nếu người dùng dán vào
            val = val.replace(/\/index\.html\/?$/i, '').replace(/\/admin(\.html)?\/?$/i, '').replace(/\/+$/, '');
            baseInput.value = val;

            // 1. Lưu vào LocalStorage
            localStorage.setItem('aurora_base_qr_url', val);

            // 2. Lưu đồng bộ lên Firestore (để tất cả nhân viên & thiết bị dùng chung)
            try {
                await setDoc(doc(db, "settings", "general"), {
                    base_qr_url: val,
                    updated_at: serverTimestamp()
                }, { merge: true });
            } catch (err) {
                console.warn("Lỗi lưu Firestore settings:", err);
            }

            // 3. Render lại QR của tất cả bàn
            renderAllTableQRs();

            if (!silent) {
                showAdminToast(`Đã lưu & cập nhật đường dẫn: ${val}`, 'success');
            }
        };

        window.renderAllTableQRs = function() {
            const grid = document.getElementById('tables-grid');
            const printGrid = document.getElementById('print-grid');
            if (!grid || !printGrid) return;
            grid.innerHTML = '';
            printGrid.innerHTML = '';

            const baseInput = document.getElementById('base-qr-url');
            let baseUrl = (baseInput ? (baseInput.value || '').trim() : '') || localStorage.getItem('aurora_base_qr_url') || (window.location.origin + window.location.pathname.replace(/admin(\.html)?\/?$/i, 'index.html'));
            if (baseInput && !(baseInput.value || '').trim()) {
                baseInput.value = baseUrl;
            }

            allTables.forEach((table) => {
                const fullUrl = getTableMenuUrl(table.name);

                const card = document.createElement('div');
                card.className = "bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center text-center space-y-3 relative group";
                
                const canvasId = `qr-${table.id}`;
                card.innerHTML = `
                    <button onclick="deleteTable('${table.id}')" title="Xóa bàn" class="absolute top-3 right-3 text-gray-300 hover:text-red-500 transition">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                    <div class="font-bold text-lg text-gray-800">Bàn ${table.name.replace(/^(bàn\s*)+/i, '').trim() || table.name}</div>
                    <div class="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                        <canvas id="${canvasId}" class="w-36 h-36"></canvas>
                    </div>
                    <div class="text-[11px] text-gray-400 font-mono truncate max-w-full px-2">${fullUrl}</div>
                    <div class="flex gap-2 w-full pt-1">
                        <button onclick="downloadQR('${canvasId}', '${table.name}')" class="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs transition">
                            <i class="fa-solid fa-download mr-1"></i> Tải PNG
                        </button>
                        <a href="${fullUrl}" target="_blank" class="px-3 py-2 bg-[#d4af37]/20 hover:bg-[#d4af37]/30 text-[#8c7423] font-semibold rounded-xl text-xs transition">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </a>
                    </div>
                `;
                grid.appendChild(card);

                const printCard = document.createElement('div');
                printCard.className = "border-2 border-dashed border-gray-400 p-6 rounded-2xl flex flex-col items-center text-center space-y-2";
                const printCanvasId = `print-qr-${table.id}`;
                printCard.innerHTML = `
                    <div class="text-xs font-bold text-gray-500 uppercase">Bàn số</div>
                    <div class="text-3xl font-black">${table.name}</div>
                    <canvas id="${printCanvasId}" class="w-44 h-44"></canvas>
                    <div class="text-xs text-gray-600">Quét mã để xem menu & gọi món</div>
                `;
                printGrid.appendChild(printCard);

                setTimeout(() => {
                    const canvas = document.getElementById(canvasId);
                    if (canvas) {
                        let ok = false;
                        try {
                            if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
                                QRCode.toCanvas(canvas, fullUrl, { width: 144, margin: 1 });
                                ok = true;
                            }
                        } catch (e) {
                            console.error("QR canvas error:", e);
                        }
                        if (!ok) {
                            canvas.style.display = 'none';
                            const img = document.createElement('img');
                            img.src = `https://api.qrserver.com/v1/create-qr-code/?size=144x144&data=${encodeURIComponent(fullUrl)}`;
                            img.className = "w-36 h-36 mx-auto rounded-lg";
                            canvas.parentElement.appendChild(img);
                        }
                    }
                    const printCanvas = document.getElementById(printCanvasId);
                    if (printCanvas) {
                        let ok = false;
                        try {
                            if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
                                QRCode.toCanvas(printCanvas, fullUrl, { width: 176, margin: 1 });
                                ok = true;
                            }
                        } catch (e) {
                            console.error("Print QR canvas error:", e);
                        }
                        if (!ok) {
                            printCanvas.style.display = 'none';
                            const img = document.createElement('img');
                            img.src = `https://api.qrserver.com/v1/create-qr-code/?size=176x176&data=${encodeURIComponent(fullUrl)}`;
                            img.className = "w-44 h-44 mx-auto rounded-lg";
                            printCanvas.parentElement.appendChild(img);
                        }
                    }
                }, 50);
            });
        };

        window.openAddTableModal = function() {
            if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
                if (typeof showAdminToast === 'function') {
                    showAdminToast('Chỉ Quản trị viên (Chủ quán) mới có quyền quản lý bàn & mã QR!', 'error');
                } else {
                    alert('Chỉ Quản trị viên (Chủ quán) mới có quyền quản lý bàn & mã QR!');
                }
                return;
            }
            document.getElementById('new-table-name').value = '';
            document.getElementById('modal-table').classList.remove('hidden');
        };

        window.closeAddTableModal = function() {
            document.getElementById('modal-table').classList.add('hidden');
        };

        window.saveNewTable = async function() {
            if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
                alert("Chỉ Quản trị viên (Chủ quán) mới có quyền thêm bàn!");
                return;
            }
            const name = document.getElementById('new-table-name').value.trim();
            if (!name) {
                alert("Vui lòng nhập tên/mã bàn!");
                return;
            }
            try {
                const cleanId = name.replace(/^(table|bàn|ban)\s*/i, '').trim().toUpperCase() || name.toUpperCase();
                await setDoc(doc(db, "tables", cleanId), {
                    name,
                    status: 'available',
                    transferred_to: deleteField(),
                    transferred_at: deleteField(),
                    created_at: serverTimestamp()
                }, { merge: true });
                closeAddTableModal();
                loadTables();
            } catch (err) {
                alert("Lỗi khi thêm bàn: " + (err.message || err));
            }
        };

        window.deleteTable = async function(id) {
            if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
                alert("Chỉ Quản trị viên (Chủ quán) mới có quyền xóa bàn!");
                return;
            }
            if (!confirm("Bạn có chắc muốn xóa bàn này?")) return;
            try {
                await deleteDoc(doc(db, "tables", id));
                loadTables();
            } catch (err) {
                alert("Lỗi khi xóa bàn!");
            }
        };

        window.downloadQR = function(canvasId, tableName) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const a = document.createElement('a');
            a.download = `QR_Ban_${tableName}.png`;
            a.href = canvas.toDataURL('image/png');
            a.click();
        };

        window.printAllQRs = function() {
            window.print();
        };

        /* ===== TỰ ĐỘNG SINH HÀNG LOẠT BÀN & MÃ QR ===== */
        window.openAutoTablesModal = function() {
            if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
                alert("Chỉ Quản trị viên (Chủ quán) mới có quyền tạo bàn hàng loạt!");
                return;
            }
            document.getElementById('modal-auto-tables').classList.remove('hidden');
        };

        window.closeAutoTablesModal = function() {
            document.getElementById('modal-auto-tables').classList.add('hidden');
        };

        window.executeAutoGenerateTables = async function() {
            if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
                alert("Chỉ Quản trị viên (Chủ quán) mới có quyền tạo bàn hàng loạt!");
                return;
            }
            const prefix = document.getElementById('auto-table-prefix').value.trim() || 'T';
            const fromNum = parseInt(document.getElementById('auto-table-from').value, 10) || 1;
            const toNum = parseInt(document.getElementById('auto-table-to').value, 10) || 10;

            if (fromNum > toNum) {
                alert("Số bắt đầu phải nhỏ hơn hoặc bằng số kết thúc!");
                return;
            }

            const existingNames = new Set(allTables.map(t => t.name.toLowerCase()));
            let addedCount = 0;

            for (let i = fromNum; i <= toNum; i++) {
                const tableName = `${prefix}${i}`;
                if (!existingNames.has(tableName.toLowerCase())) {
                    try {
                        const cleanId = tableName.replace(/^(table|bàn|ban)\s*/i, '').trim().toUpperCase() || tableName.toUpperCase();
                        await setDoc(doc(db, "tables", cleanId), {
                            name: tableName,
                            status: 'available',
                            transferred_to: deleteField(),
                            transferred_at: deleteField(),
                            created_at: serverTimestamp()
                        }, { merge: true });
                        allTables.push({ id: cleanId, name: tableName });
                        existingNames.add(tableName.toLowerCase());
                        addedCount++;
                    } catch (e) {
                        console.error("Lỗi khi thêm bàn tự động:", e);
                    }
                }
            }

            closeAutoTablesModal();
            allTables.sort(compareTableOrder);
            renderAllTableQRs();
            scheduleRenderTableBoard();
            alert(`Đã tự động tạo thêm ${addedCount} bàn và kích hoạt mã QR thành công!`);
        };

        /* ===== XEM & IN MÃ QR TỪNG BÀN (DÙNG TRỰC TIẾP TRÊN SƠ ĐỒ) ===== */
        window.showTableQRModal = function(tableName) {
            const modal = document.getElementById('modal-table-qr');
            if (!modal) return;

            document.getElementById('modal-table-qr-title').innerText = `Mã QR Bàn ${tableName}`;

            const fullUrl = getTableMenuUrl(tableName);

            const urlEl = document.getElementById('modal-table-qr-url');
            if (urlEl) urlEl.innerText = fullUrl;

            const canvas = document.getElementById('modal-table-qr-canvas');
            const container = canvas ? canvas.parentElement : null;
            let existingFallback = document.getElementById('modal-table-qr-fallback');
            if (existingFallback) existingFallback.remove();
            if (canvas) canvas.style.display = 'block';

            let qrRendered = false;
            if (canvas && typeof QRCode !== 'undefined' && QRCode.toCanvas) {
                try {
                    QRCode.toCanvas(canvas, fullUrl, {
                        width: 220,
                        margin: 1,
                        color: {
                            dark: '#1f1a16',
                            light: '#ffffff'
                        }
                    });
                    qrRendered = true;
                } catch (e) {
                    console.error("QRCode.toCanvas error:", e);
                }
            }

            if (!qrRendered && canvas && container) {
                canvas.style.display = 'none';
                const img = document.createElement('img');
                img.id = 'modal-table-qr-fallback';
                img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(fullUrl)}`;
                img.className = "w-56 h-56 rounded-xl shadow-xs bg-white p-2 mx-auto";
                container.appendChild(img);
            }

            const dlBtn = document.getElementById('modal-table-qr-download');
            if (dlBtn) {
                dlBtn.onclick = function() {
                    const fallbackImg = document.getElementById('modal-table-qr-fallback');
                    if (fallbackImg) {
                        window.open(fallbackImg.src, '_blank');
                        return;
                    }
                    if (!canvas) return;
                    try {
                        const a = document.createElement('a');
                        a.download = `QR_Ban_${tableName}.png`;
                        a.href = canvas.toDataURL('image/png');
                        a.click();
                    } catch (e) {
                        window.open(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(fullUrl)}`, '_blank');
                    }
                };
            }

            const testLink = document.getElementById('modal-table-qr-open');
            if (testLink) {
                testLink.href = fullUrl;
            }

            const printBtn = document.getElementById('modal-table-qr-print');
            if (printBtn) {
                printBtn.onclick = function() {
                    printSingleTableQR(tableName, fullUrl);
                };
            }

            modal.classList.remove('hidden');
        };

        window.closeTableQRModal = function() {
            const modal = document.getElementById('modal-table-qr');
            if (modal) modal.classList.add('hidden');
        };

        window.printSingleTableQR = function(tableName, fullUrl) {
            const canvas = document.getElementById('modal-table-qr-canvas');
            const fallbackImg = document.getElementById('modal-table-qr-fallback');
            let qrImgSrc = '';
            if (fallbackImg) {
                qrImgSrc = fallbackImg.src;
            } else if (canvas) {
                try {
                    qrImgSrc = canvas.toDataURL('image/png');
                } catch(e) {
                    qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(fullUrl)}`;
                }
            }
            if (!qrImgSrc) {
                qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(fullUrl)}`;
            }
            const printWin = window.open('', '_blank', 'width=500,height=620');
            if (!printWin) {
                alert("Vui lòng cho phép trình duyệt mở popup để in tem mã QR!");
                return;
            }
            printWin.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>In QR Bàn ${tableName}</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 40px; margin: 0; background: #fff; }
                        .stand-card { border: 3px double #d4af37; border-radius: 24px; padding: 32px 24px; max-width: 320px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
                        .logo { font-size: 13px; font-weight: 800; color: #b89728; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
                        .title { font-size: 32px; font-weight: 900; color: #1a1612; margin: 4px 0 16px 0; }
                        img { width: 220px; height: 220px; border-radius: 16px; border: 1px solid #eae3d5; }
                        .hint { font-size: 13px; color: #4a4238; margin-top: 16px; font-weight: 700; }
                        .subhint { font-size: 11px; color: #8c8275; margin-top: 4px; }
                        .url { font-size: 9px; color: #aaa; margin-top: 12px; font-family: monospace; word-break: break-all; }
                    </style>
                </head>
                <body>
                    <div class="stand-card">
                        <div class="logo">AURORA RESTAURANT & LOUNGE</div>
                        <div class="title">BÀN ${tableName}</div>
                        <img src="${qrDataUrl}" alt="QR Bàn ${tableName}">
                        <div class="hint">Quét mã bằng điện thoại</div>
                        <div class="subhint">Xem menu & gọi món trực tiếp tại bàn</div>
                        <div class="url">${fullUrl}</div>
                    </div>
                    <script>
                        setTimeout(() => { window.print(); window.close(); }, 350);
                    <\/script>
                </body>
                </html>
            `);
            printWin.document.close();
        };


        // RENDER GIAO DIỆN TRỰC QUAN THEO BÀN (TABLE BOARD - ĐỒNG BỘ 100% 0MS, KHÔNG DELAY, KHÔNG CANCEL)
        window.renderTableBoard = renderTableBoard;
        window.setTableFilter = function(filter) {
            currentTableFilter = filter;
            renderTableBoard();
        };

        function renderTableBoard() {
            window.renderTableBoard = renderTableBoard;
            const grid = document.getElementById('table-board-grid');
            const filterBar = document.getElementById('table-filter-bar');
            if (!grid) return;

            // 1. Phân loại và tính toán trạng thái cho từng bàn (Đảm bảo thứ tự bàn luôn chuẩn A1..A4, B1..B4, C1..C4)
            allTables.sort(compareTableOrder);
            const tableDataList = [];
            let countAll = allTables.length;
            let countActive = 0;
            let countPending = 0;
            let countCooking = 0;
            let countCheckout = 0;
            let countAssistance = 0;
            let countEmpty = 0;

            // Lọc các đơn chưa kết toán: Bắt buộc nhân viên bấm Thanh toán thủ công mới đóng bàn, chống thất thoát doanh thu!
            const nonSettledOrders = allOrders.filter(o => !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));

            const pendingServices = allServiceRequests.filter(s => s.status === 'pending');

            for (const table of allTables) {
                const tableName = table.name;
                const tableOrders = nonSettledOrders.filter(o => isSameTable(o.table_id, tableName));
                const tablePendingService = pendingServices.filter(s => isSameTable(s.table_id, tableName));

                const hasPendingAssistance = tablePendingService.some(s => s.type === 'assistance');
                const hasPendingCheckout = tablePendingService.some(s => s.type === 'checkout');

                let tableTotal = 0;
                let pendingCount = 0;
                let cookingCount = 0;
                let doneCount = 0;

                tableOrders.forEach(o => {
                    tableTotal += Number(o.total_amount) || 0;
                    if (o.status === 'pending') pendingCount++;
                    else if (o.status === 'cooking') cookingCount++;
                    else if (o.status === 'done') doneCount++;
                });

                const isActive = tableOrders.length > 0 || hasPendingAssistance || hasPendingCheckout;
                if (isActive) {
                    countActive++;
                    if (hasPendingCheckout) countCheckout++;
                    if (hasPendingAssistance) countAssistance++;
                    if (pendingCount > 0) countPending++;
                    if (cookingCount > 0) countCooking++;
                } else {
                    countEmpty++;
                }

                // Tính thời gian mở bàn / giờ vào (Check-in time) từ đợt gọi món đầu tiên
                let earliestMillis = null;
                tableOrders.forEach(o => {
                    const m = getSafeMillis(o.created_at || o.client_time);
                    if (m > 0 && (!earliestMillis || m < earliestMillis)) {
                        earliestMillis = m;
                    }
                });
                if (!earliestMillis && tablePendingService && tablePendingService.length > 0) {
                    tablePendingService.forEach(s => {
                        const m = getSafeMillis(s.created_at || s.client_time);
                        if (m > 0 && (!earliestMillis || m < earliestMillis)) {
                            earliestMillis = m;
                        }
                    });
                }
                if (!earliestMillis && table.opened_at) {
                    earliestMillis = getSafeMillis(table.opened_at);
                }

                let openTimeStr = '';
                let durationStr = '';
                if (earliestMillis) {
                    const openDate = new Date(earliestMillis);
                    openTimeStr = openDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const diffMins = Math.max(0, Math.floor((Date.now() - earliestMillis) / 60000));
                    if (diffMins < 60) {
                        durationStr = `${diffMins}p`;
                    } else {
                        const h = Math.floor(diffMins / 60);
                        const m = diffMins % 60;
                        durationStr = m > 0 ? `${h}h${m}p` : `${h}h`;
                    }
                }

                const isWaitingTransfer = !!(window.tablesWaitingForTransfer && window.tablesWaitingForTransfer.has(tableName));

                tableDataList.push({
                    table,
                    tableName,
                    tableOrders,
                    tablePendingService,
                    hasPendingAssistance,
                    hasPendingCheckout,
                    pendingCount,
                    cookingCount,
                    doneCount,
                    tableTotal,
                    isActive,
                    isWaitingTransfer,
                    earliestMillis,
                    openTimeStr,
                    durationStr
                });
            }

            // 2. Render Thanh lọc tương tác Realtime (Chỉ giữ lại: Tất cả, Chờ CK, Có khách, Bàn trống)
            if (filterBar) {
                const countWaitingTransfer = tableDataList.filter(t => t.isWaitingTransfer).length;

                if (!['all', 'waiting_transfer', 'active', 'empty'].includes(currentTableFilter)) {
                    currentTableFilter = 'all';
                }

                const filters = [
                    { id: 'all', label: 'Tất cả', count: countAll, icon: 'fa-table-cells' },
                    { id: 'waiting_transfer', label: 'Chờ CK', count: countWaitingTransfer, icon: 'fa-qrcode' },
                    { id: 'active', label: 'Có khách', count: countActive, icon: 'fa-user-group' },
                    { id: 'empty', label: 'Bàn trống', count: countEmpty, icon: 'fa-chair' }
                ];

                filterBar.innerHTML = filters.map(f => {
                    const isSelected = currentTableFilter === f.id;
                    const activeClass = isSelected
                        ? 'bg-[#1f1a16] text-[#d4af37] ring-2 ring-[#d4af37]/40 shadow-xs'
                        : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 shadow-2xs';

                    let badgeColor = isSelected ? 'bg-[#d4af37] text-black font-bold' : 'bg-gray-100 text-gray-600';
                    if (f.id === 'waiting_transfer' && f.count > 0 && !isSelected) badgeColor = 'bg-blue-100 text-blue-700 font-black animate-pulse';
                    if (f.id === 'active' && f.count > 0 && !isSelected) badgeColor = 'bg-emerald-100 text-emerald-800 font-bold';

                    return `
                        <button onclick="setTableFilter('${f.id}')" class="px-2 py-0.5 rounded-lg font-semibold transition flex items-center gap-1 text-[11px] ${activeClass}">
                            <i class="fa-solid ${f.icon} text-[10px]"></i>
                            <span>${f.label}</span>
                            <span class="px-1.5 py-0.2 rounded-full text-[9px] ${badgeColor}">${f.count}</span>
                        </button>
                    `;
                }).join('');
            }

            // 3. Lọc danh sách bàn theo trạng thái được chọn
            const visibleTables = tableDataList.filter(t => {
                if (currentTableFilter === 'all') return true;
                if (currentTableFilter === 'waiting_transfer') return t.isWaitingTransfer;
                if (currentTableFilter === 'active') return t.isActive;
                if (currentTableFilter === 'empty') return !t.isActive;
                return true;
            });

            if (visibleTables.length === 0) {
                grid.innerHTML = `<div class="col-span-full py-12 text-center text-gray-400 text-xs bg-white rounded-2xl border border-dashed border-gray-200">Không có bàn nào phù hợp với bộ lọc đã chọn.</div>`;
                return;
            }

            const fragment = document.createDocumentFragment();

            // Khi số lượng bàn từ 3 trở lên hoặc màn hình hẹp -> Kích hoạt chế độ gọn: chỉ hiện icon link bàn và icon thanh toán
            const isCompact = visibleTables.length > 2;

            for (const t of visibleTables) {
                const tableName = t.tableName;
                // Hiển thị trực tiếp tên/số bàn, không lặp 'Bàn + tên bàn' để tránh bị cắt chữ thành 'B...'
                const cleanTableName = tableName.replace(/^(bàn\s*)+/i, '').trim() || tableName;
                const displayTableName = `Bàn ${cleanTableName}`;
                const tableOrders = t.tableOrders;
                const hasPendingAssistance = t.hasPendingAssistance;
                const hasPendingCheckout = t.hasPendingCheckout;
                const pendingCount = t.pendingCount;
                const cookingCount = t.cookingCount;
                const tableTotal = t.tableTotal;
                const isWaitingTransfer = t.isWaitingTransfer;

                // PHỐI MÀU TRẠNG THÁI TRỰC QUAN GỌN GÀNG (Màu nền đã thể hiện rõ trạng thái, bỏ nút chân thẻ để mở rộng không gian món)
                let headerGradient = '';
                let cardBorder = '';

                if (isWaitingTransfer) {
                    //  Đang dừng lại chờ Webhook chuyển khoản: Xanh dương công nghệ + Nhấp nháy
                    headerGradient = 'bg-gradient-to-r from-blue-700 via-indigo-700 to-sky-600 text-white animate-pulse';
                    cardBorder = 'border-2 border-blue-500 bg-white shadow-blue-100 shadow-md ring-2 ring-blue-300/40';
                } else if (tableOrders.length === 0 && !hasPendingAssistance && !hasPendingCheckout) {
                    //  Bàn trống: Màu xám bạc
                    headerGradient = 'bg-slate-100 text-slate-700 border-b border-slate-200';
                    cardBorder = 'border border-slate-200 bg-white hover:border-slate-300';
                } else if (hasPendingCheckout) {
                    //  Cần tính tiền: Tím gradient rực rỡ + Nhấp nháy
                    headerGradient = 'bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 text-white animate-pulse';
                    cardBorder = 'border-2 border-purple-500 bg-white shadow-purple-100 shadow-md ring-2 ring-purple-300/40';
                } else if (hasPendingAssistance) {
                    //  Gọi phục vụ: Đỏ gradient khẩn cấp + Nhấp nháy
                    headerGradient = 'bg-gradient-to-r from-rose-600 to-red-600 text-white animate-pulse';
                    cardBorder = 'border-2 border-red-500 bg-white shadow-red-100 shadow-md ring-2 ring-red-300/40';
                } else if (pendingCount > 0) {
                    //  Có đơn chờ duyệt: Vàng Cam rực rỡ
                    headerGradient = 'bg-gradient-to-r from-amber-500 to-orange-500 text-white';
                    cardBorder = 'border-2 border-amber-400 bg-white shadow-amber-50 ring-2 ring-amber-300/30';
                } else if (cookingCount > 0) {
                    //  Bếp đang nấu: Xanh dương gradient chuyên nghiệp
                    headerGradient = 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white';
                    cardBorder = 'border-2 border-blue-400 bg-white shadow-blue-50';
                } else {
                    //  Đang dùng bữa: Xanh lá tươi mát
                    headerGradient = 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white';
                    cardBorder = 'border-2 border-emerald-400 bg-white shadow-emerald-50';
                }

                // Tóm tắt danh sách món ăn thu gọn linh hoạt theo chiều cao khung (Đọc ngay lập tức 0ms từ ord.items hoặc cachedOrderItemsMap)
                let itemsSummaryHtml = '';
                if (tableOrders.length > 0) {
                    itemsSummaryHtml = `<div class="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-0.5 text-[10px] sm:text-[10.5px] py-0.5 pr-0.5">`;
                    let hasItems = false;
                    for (const ord of tableOrders) {
                        const items = (ord.items && Array.isArray(ord.items) && ord.items.length > 0)
                            ? ord.items
                            : (cachedOrderItemsMap[ord.id] || []);

                        items.forEach(itData => {
                            hasItems = true;
                            const safeDishName = escapeHtml(itData.dish_name);
                            itemsSummaryHtml += `
                                <div class="flex justify-between items-center text-gray-700 py-0.5">
                                    <div class="truncate pr-1">
                                        <span class="font-bold text-gray-900">${itData.quantity}x</span>
                                        <span title="${safeDishName}">${safeDishName}</span>
                                        ${formatAdminOptionsHtml(itData.options_summary)}
                                        ${itData.note ? `<span class="text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded px-1.5 py-0.5 mt-0.5 block font-medium">Ghi chú: ${escapeHtml(itData.note)}</span>` : ''}
                                    </div>
                                    <span class="text-[10px] font-semibold text-gray-500 whitespace-nowrap">${formatMoney(itData.price * itData.quantity)}</span>
                                </div>
                            `;
                        });
                    }
                    if (!hasItems) {
                        itemsSummaryHtml += `
                            <div class="py-1 text-amber-600 italic text-[10px] flex items-center gap-1">
                                <i class="fa-solid fa-spinner fa-spin"></i> Đang tải chi tiết món...
                            </div>
                        `;
                    }
                    itemsSummaryHtml += `</div>`;
                } else {
                    itemsSummaryHtml = `
                        <div class="py-1 px-1.5 flex flex-col items-center justify-center text-center gap-0.5 flex-1 min-h-0">
                            <i class="fa-solid fa-chair text-slate-300 text-sm"></i>
                            <span class="text-[10px] text-slate-400 font-medium">Sẵn sàng nhận khách</span>
                        </div>
                    `;
                }

                const cleanTableCode = (typeof normalizeTableCode === 'function') ? normalizeTableCode(tableName) : String(tableName).replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                const cardCust = (root.AdminLoyalty && typeof root.AdminLoyalty.getCustomerForTable === 'function')
                    ? root.AdminLoyalty.getCustomerForTable(tableName)
                    : (t.attached_customer || null);
                const cardVoucher = tableVouchers[cleanTableCode] || tableVouchers[tableName] || t.applied_voucher || null;

                const card = document.createElement('div');
                card.className = `${cardBorder} rounded-xl overflow-hidden shadow-2xs hover:shadow-md transition-all flex flex-col justify-between text-xs bg-white h-full min-h-0 max-h-[350px] cursor-pointer select-none`;
                card.onclick = () => openTableDetail(tableName);

                card.innerHTML = `
                    <!-- Header Banner Có Màu Trực Quan & Click mở chi tiết (Ưu tiên Tên bàn luôn rõ ràng) -->
                    <div class="${headerGradient} px-2.5 py-1.5 flex justify-between items-center cursor-pointer select-none shrink-0" onclick="openTableDetail('${tableName}')" title="Bấm để xem chi tiết ${displayTableName}">
                        <div class="flex items-center gap-1.5 min-w-0 flex-1">
                            <h3 class="font-black text-xs sm:text-sm tracking-tight uppercase shrink-0" title="${displayTableName}">${cleanTableName}</h3>
                            ${cardCust && (cardCust.name || cardCust.phone) ? `
                                <span class="w-4 h-4 rounded-full ${tableOrders.length === 0 ? 'bg-amber-200 text-amber-900 border border-amber-400' : 'bg-black/25 text-amber-300 border border-amber-300/40'} flex items-center justify-center shrink-0 shadow-2xs" title="Khách hàng: ${escapeHtml(cardCust.name || cardCust.phone)} (${cardCust.tier || 'Thành viên'})">
                                    <i class="fa-solid fa-user text-[8px]"></i>
                                </span>
                            ` : ''}
                            ${cardVoucher && (cardVoucher.code || cardVoucher.id) ? `
                                <span class="w-4 h-4 rounded-full ${tableOrders.length === 0 ? 'bg-purple-200 text-purple-900 border border-purple-400' : 'bg-purple-950/40 text-purple-200 border border-purple-400/50'} flex items-center justify-center shrink-0 shadow-2xs" title="Voucher: ${escapeHtml(cardVoucher.code || cardVoucher.id)}">
                                    <i class="fa-solid fa-ticket text-[8px]"></i>
                                </span>
                            ` : ''}
                            ${t.isWaitingTransfer ? `
                                <span class="text-[9px] font-black bg-blue-900/60 text-white px-1.5 py-0.2 rounded-full flex items-center gap-0.5 shrink-0 animate-pulse">
                                    <i class="fa-solid fa-satellite-dish text-[8px]"></i> Chờ CK
                                </span>
                            ` : (t.openTimeStr ? `
                                <span class="text-[9px] font-bold bg-black/20 text-white px-1.5 py-0.2 rounded-full flex items-center gap-0.5 shrink-0 truncate max-w-[95px]" title="Thời gian mở bàn: ${t.openTimeStr} (đã ngồi ${t.durationStr})">
                                    <i class="fa-regular fa-clock text-[8px]"></i>
                                    <span>${t.openTimeStr}</span>
                                    <span class="opacity-80 font-normal">(${t.durationStr})</span>
                                </span>
                            ` : (tableOrders.length > 0 ? `<span class="text-[9px] font-semibold opacity-90 shrink-0">(${tableOrders.length} lượt)</span>` : ''))}
                        </div>
                        <div class="flex items-center gap-1 shrink-0 ml-1">
                            ${tableOrders.length > 0 && t.openTimeStr ? `<span class="text-[9px] font-medium opacity-85 mr-1 hidden sm:inline">${tableOrders.length} lượt</span>` : ''}
                            <button onclick="event.stopPropagation(); openTableDetail('${tableName}')" title="Xem chi tiết ${displayTableName}" class="w-5 h-5 rounded-md bg-black/15 hover:bg-black/30 text-white flex items-center justify-center text-[9px] transition shrink-0">
                                <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Thân thẻ chi tiết -->
                    <div class="p-1.5 sm:p-2 flex-1 min-h-0 flex flex-col justify-between gap-1 overflow-hidden">
                        ${itemsSummaryHtml}

                        ${tableOrders.length > 0 ? `
                            <div class="shrink-0 flex justify-between items-center pt-1 border-t border-gray-100/80 text-xs">
                                <span class="text-gray-400 text-[10px] font-medium">Tổng tiền:</span>
                                <span class="font-black text-[11px] sm:text-xs text-[#b89728]">${formatMoney(tableTotal)}</span>
                            </div>
                        ` : ''}
                    </div>
                `;
                fragment.appendChild(card);
            }

            // Cập nhật DOM 1 lần duy nhất, tức thời không độ trễ
            grid.replaceChildren(fragment);

            // Tự động căn chỉnh lưới tối ưu lấp đầy 100% khung màn hình theo số lượng bàn thực tế
            applyOptimalGrid(visibleTables.length);
        }

        // Tự động tính toán số cột & số hàng để lấp đầy 100% khung màn hình không khoảng trống thừa
        function applyOptimalGrid(count) {
            const grid = document.getElementById('table-board-grid');
            if (!grid) return;

            if (count <= 0) {
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = '1fr';
                grid.style.gridTemplateRows = '1fr';
                return;
            }

            const width = window.innerWidth;
            const height = window.innerHeight;
            const isMobile = width < 640;
            const isTablet = width >= 640 && width < 1024;

            let cols = 4;
            let rows = 3;

            if (isMobile) {
                cols = count === 1 ? 1 : 2;
                rows = Math.ceil(count / cols);
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
                grid.style.gridTemplateRows = count <= 4 ? `repeat(${rows}, minmax(0, 1fr))` : `repeat(${rows}, minmax(130px, 1fr))`;
            } else if (isTablet) {
                if (count <= 2) { cols = 2; rows = 1; }
                else if (count <= 4) { cols = 2; rows = 2; }
                else if (count <= 6) { cols = 3; rows = 2; }
                else if (count <= 8) { cols = 4; rows = 2; }
                else if (count <= 12) { cols = 4; rows = 3; }
                else { cols = 4; rows = Math.ceil(count / 4); }
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
                grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
                grid.style.height = '100%';
                grid.style.overflow = 'hidden';
            } else {
                // Màn hình Desktop / POS / TV: Căn chỉnh chuẩn xác 100% khung màn hình, không bao giờ thừa thanh cuộn
                if (count <= 2) { cols = 2; rows = 1; }
                else if (count <= 4) { cols = 2; rows = 2; }
                else if (count <= 6) { cols = 3; rows = 2; }
                else if (count <= 8) { cols = 4; rows = 2; }
                else if (count <= 10) { cols = 5; rows = 2; }
                else if (count <= 12) { cols = 4; rows = 3; } // Chuẩn 4 cột x 3 hàng cho 12 bàn (A1-A4, B1-B4, C1-C4)
                else if (count <= 15) { cols = 5; rows = 3; }
                else if (count <= 18) { cols = 6; rows = 3; }
                else if (count <= 20) { cols = 5; rows = 4; }
                else if (count <= 24) { cols = 6; rows = 4; }
                else if (count <= 28) { cols = 7; rows = 4; }
                else if (count <= 32) { cols = 8; rows = 4; }
                else {
                    const aspect = width / Math.max(1, height);
                    cols = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(count * aspect))));
                    rows = Math.ceil(count / cols);
                }
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
                grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
                grid.style.height = '100%';
                grid.style.overflow = 'hidden';
            }
        }
        window.applyOptimalGrid = applyOptimalGrid;

        // Bật / Tắt chế độ Toàn Màn Hình cho Sơ Đồ Bàn
        window.toggleFullscreenBoard = function() {
            const tabOrders = document.getElementById('tab-orders');
            const btn = document.getElementById('btn-fullscreen-board');
            if (!tabOrders) return;

            const isFullscreen = tabOrders.classList.contains('fixed');

            if (!isFullscreen) {
                tabOrders.classList.add('fixed', 'inset-0', 'z-50', 'bg-[#f9f6f0]', 'p-2', 'sm:p-3', 'w-screen', 'h-screen');
                if (btn) btn.innerHTML = '<i class="fa-solid fa-compress text-[11px]"></i> <span>Thu nhỏ</span>';
                if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                }
            } else {
                tabOrders.classList.remove('fixed', 'inset-0', 'z-50', 'bg-[#f9f6f0]', 'p-2', 'sm:p-3', 'p-3', 'sm:p-5', 'w-screen', 'h-screen');
                if (btn) btn.innerHTML = '<i class="fa-solid fa-expand text-[11px]"></i> <span>Toàn màn hình</span>';
                if (document.exitFullscreen && document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                }
            }

            setTimeout(() => {
                const grid = document.getElementById('table-board-grid');
                if (grid) applyOptimalGrid(grid.children.length);
            }, 100);
        };

        // Lắng nghe sự kiện thay đổi kích thước cửa sổ để tự động co giãn lưới (có Debounce chống đơ)
        let windowResizeTimer = null;
        window.addEventListener('resize', () => {
            if (windowResizeTimer) clearTimeout(windowResizeTimer);
            windowResizeTimer = setTimeout(() => {
                const tabOrders = document.getElementById('tab-orders');
                if (tabOrders && !tabOrders.classList.contains('hidden')) {
                    const grid = document.getElementById('table-board-grid');
                    if (grid && grid.children.length > 0) {
                        applyOptimalGrid(grid.children.length);
                    }
                }
            }, 80);
        });

        // Thoát fullscreen đồng bộ khi nhấn phím ESC
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                const tabOrders = document.getElementById('tab-orders');
                const btn = document.getElementById('btn-fullscreen-board');
                if (tabOrders && tabOrders.classList.contains('fixed')) {
                    tabOrders.classList.remove('fixed', 'inset-0', 'z-50', 'bg-[#f9f6f0]', 'p-2', 'sm:p-3', 'p-3', 'sm:p-5', 'w-screen', 'h-screen');
                    if (btn) btn.innerHTML = '<i class="fa-solid fa-expand text-[11px]"></i> <span>Toàn màn hình</span>';
                    const grid = document.getElementById('table-board-grid');
                    if (grid) applyOptimalGrid(grid.children.length);
                }
            }
        });
        

        // Hỗ trợ xong yêu cầu phục vụ của bàn
        window.resolveTableService = async function(tableName) {
            const tableRequests = allServiceRequests.filter(s => {
                return isSameTable(s.table_id, tableName) && s.status === 'pending';
            });
            const promises = tableRequests.map(r => updateDoc(doc(db, "service_requests", r.id), { status: 'resolved' }));
            await Promise.all(promises);
        };

        /* ================= BẢNG CHI TIẾT BÀN & ĐIỀU PHỐI CHUYỂN BÀN / CHUYỂN ĐỒ ================= */
        // =========================================================================
        // MÀN HÌNH ĐIỀU CHUYỂN BÀN / CHUYỂN MÓN 2 CỘT CHUẨN 100% APP ANDROID
        // Bước 1: Chi tiết bàn (Xem món, giờ mở, tổng tiền) -> Nút [Chuyển / Gộp bàn]
        // Bước 2: Chọn bàn đích (Khung nhìn rộng bao quát, bỏ badge thừa)
        // Bước 3: Màn hình 2 cột tương tác trực quan: Bàn Nguồn <--> Bàn Đích
        // =========================================================================
        let tdCurrentStep = 'detail'; // 'detail' | 'target' | 'action'
        let tdCurrentTable = null;
        let tdSelectedTargetTable = null;
        let tdCachedSubHtml = '';
        let tdCachedGrandTotal = 0;
        let tdCachedActiveOrders = [];

        // State cho màn hình 2 cột điều chuyển món (Split Transfer Workbench)
        let tdSplitSourceItems = []; // Món còn lại ở Bàn Nguồn
        let tdSplitTargetItems = []; // Món chuyển sang Bàn Đích

        function closeTableDetailModal() {
            const modal = document.getElementById('modal-table-detail');
            if (modal) modal.classList.add('hidden');
            tdCurrentTable = null;
            tdSelectedTargetTable = null;
            tdSplitSourceItems = [];
            tdSplitTargetItems = [];
            tdCurrentStep = 'detail';
        }
        window.closeTableDetailModal = closeTableDetailModal;

        // Xử lý Hủy đơn / Hủy đợt gọi món an toàn chuẩn Production (CHỈ QUẢN LÝ / ADMIN TRỞ LÊN)
        window.promptCancelOrder = function(orderId, tableName) {
            if (!orderId) return;
            if (!window.canCancelOrders()) {
                alert("QUYỀN HẠN BỊ TỪ CHỐI:\nChức năng Hủy đợt gọi món chỉ dành cho cấp Quản lý (Manager) hoặc Quản trị viên trở lên!");
                return;
            }
            const reason = prompt(`[QUẢN LÝ XÁC NHẬN]\nNhập lý do hủy đợt gọi món này của Bàn ${tableName}:`, 'Khách đổi ý / Gọi nhầm');
            if (reason === null) return;
            const cleanReason = reason.trim() || 'Hủy bởi Quản lý';
            window.cancelOrder(orderId, cleanReason, tableName);
        };

        window.cancelOrder = async function(orderId, reason, tableName) {
            if (!orderId) return;
            if (!window.canCancelOrders()) {
                alert("QUYỀN HẠN BỊ TỪ CHỐI:\nChức năng Hủy đợt gọi món chỉ dành cho cấp Quản lý (Manager) hoặc Quản trị viên trở lên!");
                return;
            }
            try {
                const batch = writeBatch(db);
                const orderRef = doc(db, "orders", orderId);
                let currentStaff = {};
                try { currentStaff = JSON.parse(localStorage.getItem('aurora_current_user') || '{}'); } catch(e) {}
                const staffName = currentStaff.name || currentStaff.username || 'Quản lý';

                batch.update(orderRef, {
                    status: "cancelled",
                    cancel_reason: reason,
                    cancelled_by: staffName,
                    cancelled_at: serverTimestamp()
                });

                // Kiểm tra xem bàn nguồn còn đơn nào chưa đóng không
                const remainingActive = allOrders.filter(o =>
                    isSameTable(o.table_id, tableName) &&
                    !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status) &&
                    o.id !== orderId
                );

                // Nếu không còn đơn active nào -> Giải phóng bàn về available và thu hồi voucher nếu có
                if (remainingActive.length === 0) {
                    const cleanTableId = tableName.trim().replace(/^(Table|Bàn|Ban)\s*/i, '').trim().toUpperCase() || tableName.toUpperCase();
                    const tableRef = doc(db, "tables", cleanTableId);
                    batch.set(tableRef, {
                        status: 'available',
                        transferred_to: deleteField(),
                        transferred_at: deleteField(),
                        assigned_staff_username: null,
                        assigned_staff_name: null,
                        attached_customer: null,
                        applied_voucher: null,
                        use_points: false,
                        current_session_id: null,
                        updated_at: serverTimestamp()
                    }, { merge: true });

                    // Thu hồi voucher đã lock về kho nếu bàn bị hủy hết đơn
                    const appliedV = tableVouchers[cleanTableId] || tableVouchers[tableName];
                    if (appliedV && root.AdminVoucher && typeof root.AdminVoucher.releaseVoucherCode === 'function') {
                        const codeToRelease = appliedV.code || appliedV.id;
                        if (codeToRelease) {
                            root.AdminVoucher.releaseVoucherCode(codeToRelease).catch(e => console.warn('Release voucher failed:', e));
                        }
                    }
                    delete tableVouchers[cleanTableId];
                    delete tableVouchers[tableName];
                }

                await batch.commit();

                // Ghi nhận nhật ký kiểm toán khi hủy đợt gọi món
                const logCancelFn = (typeof root.logAuditEvent === 'function') ? root.logAuditEvent : ((typeof window !== 'undefined' && typeof window.logAuditEvent === 'function') ? window.logAuditEvent : null);
                if (logCancelFn) {
                    logCancelFn('ORDER_CANCEL', 'ORDERS', `Hủy toàn bộ đợt gọi món của ${tableName}. Lý do: ${reason}`, {
                        order_id: orderId,
                        table: tableName,
                        reason: reason,
                        cancelled_by: staffName
                    });
                }

                // Cập nhật lại cache allOrders tại máy thu ngân ngay lập tức
                const ordInCache = allOrders.find(o => o.id === orderId);
                if (ordInCache) ordInCache.status = 'cancelled';

                showAdminToast(`Đã hủy đợt gọi món (Lý do: ${reason})`, 'info');

                // Làm mới lại bảng chi tiết bàn và sơ đồ bàn
                if (tdCurrentTable && typeof openTableDetail === 'function') {
                    openTableDetail(tdCurrentTable);
                }
                if (typeof scheduleRenderTableBoard === 'function') {
                    scheduleRenderTableBoard();
                }
            } catch (err) {
                console.error("Lỗi khi hủy đơn:", err);
                alert(`Không thể hủy đơn: ${err.message || err}`);
            }
        };

        // Xử lý Hủy từng món lẻ trong đợt gọi món (CHỈ QUẢN LÝ / ADMIN TRỞ LÊN)
        window.promptCancelSingleDish = async function(orderId, itemIdx, tableName) {
            if (!orderId) return;
            if (!window.canCancelOrders()) {
                alert("QUYỀN HẠN BỊ TỪ CHỐI:\nChức năng Hủy món chỉ dành cho cấp Quản lý (Manager) hoặc Quản trị viên trở lên!");
                return;
            }

            let order = (Array.isArray(allOrders) ? allOrders : []).find(o => o.id === orderId);
            let items = (order && Array.isArray(order.items)) ? order.items : [];

            if (items.length === 0) {
                try {
                    const snap = await getDoc(doc(db, "orders", orderId));
                    if (snap.exists()) {
                        order = { id: snap.id, ...snap.data() };
                        items = order.items || [];
                    }
                } catch(e) {
                    console.warn("Lỗi đọc order từ Firestore:", e);
                }
            }

            const targetItem = items[itemIdx];
            if (!targetItem) {
                alert("Không tìm thấy món ăn trong đơn hàng này!");
                return;
            }

            const dishName = targetItem.dish_name || targetItem.name || 'Món ăn';
            const currentQty = Number(targetItem.quantity) || 1;
            const unitPrice = Number(targetItem.price) || 0;
            let cancelQty = 1;

            if (currentQty > 1) {
                const qtyInput = prompt(
                    `[QUẢN LÝ XÁC NHẬN HỦY MÓN]\n` +
                    `Bàn: ${tableName}\n` +
                    `Món: "${dishName}"\n` +
                    `Số lượng hiện có: ${currentQty} phần.\n\n` +
                    `Nhập số lượng phần muốn hủy (1 - ${currentQty}):`,
                    '1'
                );
                if (qtyInput === null) return;
                cancelQty = parseInt(qtyInput, 10);
                if (isNaN(cancelQty) || cancelQty < 1 || cancelQty > currentQty) {
                    alert(`Số lượng không hợp lệ! Vui lòng nhập số từ 1 đến ${currentQty}.`);
                    return;
                }
            } else {
                const confirmed = confirm(`[QUẢN LÝ XÁC NHẬN]\nBạn có chắc chắn muốn hủy món "${dishName}" khỏi Bàn ${tableName}?`);
                if (!confirmed) return;
            }

            const reasonInput = prompt(
                `[QUẢN LÝ XÁC NHẬN]\n` +
                `Nhập lý do hủy ${cancelQty}x "${dishName}" của Bàn ${tableName}:`,
                'Khách đổi ý / Gọi nhầm'
            );
            if (reasonInput === null) return;
            const cleanReason = reasonInput.trim() || 'Hủy bởi Quản lý';

            await executeCancelSingleDish(orderId, itemIdx, dishName, cancelQty, unitPrice, tableName, cleanReason);
        };

        window.executeCancelSingleDish = async function(orderId, itemIdx, dishName, cancelQty, unitPrice, tableName, reason) {
            try {
                let currentStaff = {};
                try { currentStaff = JSON.parse(localStorage.getItem('aurora_current_user') || '{}'); } catch(e) {}
                const staffName = currentStaff.name || currentStaff.username || 'Quản lý';

                const orderRef = doc(db, "orders", orderId);
                const orderSnap = await getDoc(orderRef);
                if (!orderSnap.exists()) {
                    alert("Không tìm thấy đơn hàng trên máy chủ!");
                    return;
                }
                const orderData = orderSnap.data();
                let currentItems = Array.isArray(orderData.items) ? [...orderData.items] : [];

                let targetIdx = itemIdx;
                if (!currentItems[targetIdx] || (currentItems[targetIdx].dish_name !== dishName && currentItems[targetIdx].name !== dishName)) {
                    targetIdx = currentItems.findIndex(it => (it.dish_name === dishName || it.name === dishName));
                }
                if (targetIdx === -1) {
                    alert("Không tìm thấy món ăn trong đơn hàng này trên máy chủ!");
                    return;
                }

                const target = { ...currentItems[targetIdx] };
                const oldQty = Number(target.quantity) || 1;
                const actualCancelQty = Math.min(cancelQty, oldQty);
                const remainingQty = oldQty - actualCancelQty;
                const price = Number(target.price) || Number(unitPrice) || 0;
                const deductedAmount = price * actualCancelQty;
                const newTotal = Math.max(0, (Number(orderData.total_amount) || 0) - deductedAmount);

                if (remainingQty > 0) {
                    target.quantity = remainingQty;
                    currentItems[targetIdx] = target;
                } else {
                    currentItems.splice(targetIdx, 1);
                }

                const batch = writeBatch(db);

                // Đồng bộ collection con order_items
                try {
                    const itemSnap = await getDocs(query(collection(db, "order_items"), where("order_id", "==", orderId)));
                    itemSnap.forEach(itDoc => {
                        const itData = itDoc.data();
                        if (itData.dish_name === dishName || (target.dish_id && itData.dish_id === target.dish_id)) {
                            if (remainingQty > 0) {
                                batch.update(itDoc.ref, { quantity: remainingQty });
                            } else {
                                batch.delete(itDoc.ref);
                            }
                        }
                    });
                } catch(itErr) {
                    console.warn("Lỗi đồng bộ order_items:", itErr);
                }

                // Nếu hủy sạch toàn bộ món của đơn hàng -> Chuyển đơn sang cancelled
                if (currentItems.length === 0) {
                    batch.update(orderRef, {
                        status: "cancelled",
                        total_amount: 0,
                        items: [],
                        cancel_reason: `Hủy hết món: ${dishName} (${reason})`,
                        cancelled_by: staffName,
                        cancelled_at: serverTimestamp()
                    });

                    // Kiểm tra xem bàn nguồn còn đơn active nào khác không
                    const remainingActive = (Array.isArray(allOrders) ? allOrders : []).filter(o =>
                        isSameTable(o.table_id, tableName) &&
                        !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status) &&
                        o.id !== orderId
                    );
                    if (remainingActive.length === 0) {
                        const cleanTableId = tableName.trim().replace(/^(Table|Bàn|Ban)\s*/i, '').trim().toUpperCase() || tableName.toUpperCase();
                        const tableRef = doc(db, "tables", cleanTableId);
                        batch.set(tableRef, {
                            status: 'available',
                            transferred_to: deleteField(),
                            transferred_at: deleteField(),
                            assigned_staff_username: null,
                            assigned_staff_name: null,
                            attached_customer: null,
                            applied_voucher: null,
                            use_points: false,
                            current_session_id: null,
                            updated_at: serverTimestamp()
                        }, { merge: true });

                        // Thu hồi voucher đã lock về kho nếu bàn bị hủy hết đơn
                        const appliedV = tableVouchers[cleanTableId] || tableVouchers[tableName];
                        if (appliedV && root.AdminVoucher && typeof root.AdminVoucher.releaseVoucherCode === 'function') {
                            const codeToRelease = appliedV.code || appliedV.id;
                            if (codeToRelease) {
                                root.AdminVoucher.releaseVoucherCode(codeToRelease).catch(e => console.warn('Release voucher failed:', e));
                            }
                        }
                        delete tableVouchers[cleanTableId];
                        delete tableVouchers[tableName];
                    }
                } else {
                    // Đơn vẫn còn món -> Cập nhật lại mảng items và total_amount
                    batch.update(orderRef, {
                        items: currentItems,
                        total_amount: newTotal,
                        updated_at: serverTimestamp(),
                        last_cancelled_dish: {
                            dish_name: dishName,
                            quantity: actualCancelQty,
                            reason: reason,
                            cancelled_by: staffName,
                            at: new Date().toISOString()
                        }
                    });
                }

                await batch.commit();

                // Cập nhật RAM cache allOrders tại máy thu ngân
                const ordInCache = (Array.isArray(allOrders) ? allOrders : []).find(o => o.id === orderId);
                if (ordInCache) {
                    if (currentItems.length === 0) {
                        ordInCache.status = 'cancelled';
                        ordInCache.total_amount = 0;
                        ordInCache.items = [];
                    } else {
                        ordInCache.items = currentItems;
                        ordInCache.total_amount = newTotal;
                    }
                }
                if (window.cachedOrderItemsMap && window.cachedOrderItemsMap[orderId]) {
                    if (currentItems.length === 0) {
                        delete window.cachedOrderItemsMap[orderId];
                    } else {
                        window.cachedOrderItemsMap[orderId] = currentItems;
                    }
                }

                showAdminToast(`Đã hủy ${actualCancelQty}x "${dishName}" khỏi Bàn ${tableName}`, 'success');

                const logDishFn = (typeof root.logAuditEvent === 'function') ? root.logAuditEvent : ((typeof window !== 'undefined' && typeof window.logAuditEvent === 'function') ? window.logAuditEvent : null);
                if (logDishFn) {
                    logDishFn('ORDER_CANCEL_ITEM', 'ORDERS', `Hủy ${actualCancelQty}x "${dishName}" khỏi Bàn ${tableName}. Lý do: ${reason}`, {
                        order_id: orderId,
                        table: tableName,
                        dish_name: dishName,
                        cancel_quantity: actualCancelQty,
                        reason: reason
                    });
                }

                // Render lại chi tiết bàn và sơ đồ bàn ngay lập tức
                if (tdCurrentTable && typeof openTableDetail === 'function') {
                    openTableDetail(tdCurrentTable);
                }
                if (typeof scheduleRenderTableBoard === 'function') {
                    scheduleRenderTableBoard();
                }
                if (typeof loadDashboardStats === 'function') {
                    loadDashboardStats();
                }

            } catch (err) {
                console.error("Lỗi khi hủy món lẻ:", err);
                alert(`Không thể hủy món: ${err.message || err}`);
            }
        };

        // Điều hướng giữa các bước trong Wizard
        function goToTdStep(step) {
            tdCurrentStep = step;
            const modalContainer = document.getElementById('modal-table-detail-container');
            const stepDetail = document.getElementById('td-step-detail');
            const stepTarget = document.getElementById('td-step-target');
            const stepAction = document.getElementById('td-step-action');
            const btnBack = document.getElementById('btn-td-header-back');
            const btnOpenMenu = document.getElementById('btn-td-open-menu');
            const iconEl = document.getElementById('modal-table-detail-icon');
            const iconBox = document.getElementById('modal-table-detail-icon-box');
            const titleEl = document.getElementById('modal-table-detail-title');
            const subEl = document.getElementById('modal-table-detail-sub');

            const cleanSource = tdCurrentTable ? tdCurrentTable.replace(/^(bàn\s*)+/i, '').trim() : '';
            const cleanTarget = tdSelectedTargetTable ? tdSelectedTargetTable.replace(/^(bàn\s*)+/i, '').trim() : '';

            if (step === 'detail') {
                if (modalContainer) modalContainer.className = "bg-white rounded-3xl p-5 sm:p-6 w-full max-w-xl shadow-2xl space-y-4 max-h-[94vh] flex flex-col transition-all duration-200";
                if (stepDetail) stepDetail.classList.remove('hidden');
                if (stepTarget) stepTarget.classList.add('hidden');
                if (stepAction) stepAction.classList.add('hidden');
                if (btnBack) btnBack.classList.add('hidden');
                if (btnOpenMenu) btnOpenMenu.classList.remove('hidden');

                if (iconEl) iconEl.className = "fa-solid fa-table-cells-large";
                if (iconBox) iconBox.className = "w-10 h-10 rounded-2xl bg-amber-50 text-[#b89728] flex items-center justify-center text-lg font-black shadow-xs";
                if (titleEl) titleEl.innerText = `Chi Tiết Bàn ${cleanSource}`;
                if (subEl) subEl.innerHTML = tdCachedSubHtml || 'Danh sách các món và lượt gọi';

                renderTableDetailOrderActions();

            } else if (step === 'target') {
                // Mở rộng khung nhìn sang max-w-4xl để bao quát tất cả các bàn
                if (modalContainer) modalContainer.className = "bg-white rounded-3xl p-5 sm:p-6 w-full max-w-4xl shadow-2xl space-y-4 max-h-[94vh] flex flex-col transition-all duration-200";
                if (stepDetail) stepDetail.classList.add('hidden');
                if (stepTarget) stepTarget.classList.remove('hidden');
                if (stepAction) stepAction.classList.add('hidden');
                if (btnBack) btnBack.classList.remove('hidden');
                if (btnOpenMenu) btnOpenMenu.classList.add('hidden');

                if (iconEl) iconEl.className = "fa-solid fa-arrows-split-up-and-left";
                if (iconBox) iconBox.className = "w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center text-lg font-black shadow-xs";
                if (titleEl) titleEl.innerText = `Chuyển / Gộp Bàn ${cleanSource}`;
                if (subEl) subEl.innerHTML = `<span class="text-amber-700 font-bold">Bước 1:</span> Chọn bàn đích bạn muốn chuyển tới`;

                // Cập nhật banner thông tin bàn nguồn
                const srcNameEl = document.getElementById('td-target-source-name');
                const srcCountEl = document.getElementById('td-target-order-count');
                const srcTotalEl = document.getElementById('td-target-total-amount');
                if (srcNameEl) srcNameEl.innerText = `Bàn ${cleanSource}`;
                if (srcCountEl) srcCountEl.innerText = `${tdCachedActiveOrders.length} đợt gọi`;
                if (srcTotalEl) srcTotalEl.innerText = formatMoney(tdCachedGrandTotal);

                renderTdTargetGrid();
                updateTdTargetPreview();

            } else if (step === 'action') {
                if (!tdSelectedTargetTable) {
                    goToTdStep('target');
                    return;
                }
                // Mở rộng tối đa sang max-w-5xl cho bàn làm việc 2 cột chuẩn Android
                if (modalContainer) modalContainer.className = "bg-white rounded-3xl p-5 sm:p-6 w-full max-w-5xl shadow-2xl space-y-4 max-h-[94vh] flex flex-col transition-all duration-200";
                if (stepDetail) stepDetail.classList.add('hidden');
                if (stepTarget) stepTarget.classList.add('hidden');
                if (stepAction) stepAction.classList.remove('hidden');
                if (btnBack) btnBack.classList.remove('hidden');
                if (btnOpenMenu) btnOpenMenu.classList.add('hidden');

                if (iconEl) iconEl.className = "fa-solid fa-arrows-left-right";
                if (iconBox) iconBox.className = "w-10 h-10 rounded-2xl bg-amber-50 text-[#b89728] flex items-center justify-center text-lg font-black shadow-xs";
                if (titleEl) titleEl.innerText = `CHUYỂN MÓN: BÀN ${cleanSource} -> BÀN ${cleanTarget}`;
                if (subEl) subEl.innerText = `Chạm vào món để chuyển | Nhấn [Lưu và thoát bàn] khi hoàn tất`;

                initSplitTransferWorkbench();
            }
        }
        window.goToTdStep = goToTdStep;

        // Xử lý nút Quay lại ở Header Modal
        function handleTdBackStep() {
            if (tdCurrentStep === 'action') {
                goToTdStep('target');
            } else if (tdCurrentStep === 'target') {
                goToTdStep('detail');
            }
        }
        window.handleTdBackStep = handleTdBackStep;

        // Modal xem chi tiết tất cả lượt gọi món của bàn
        async function openTableDetail(tableName, initialStep = 'detail') {
            try {
                tdCurrentTable = tableName;
                tdSelectedTargetTable = null;
                tdSplitSourceItems = [];
                tdSplitTargetItems = [];

                const cleanName = tableName.replace(/^(bàn\s*)+/i, '').trim() || tableName;
                const displayTitle = `Chi Tiết Bàn ${cleanName}`;

                const modal = document.getElementById('modal-table-detail');
                const titleEl = document.getElementById('modal-table-detail-title');
                const sub = document.getElementById('modal-table-detail-sub');
                const content = document.getElementById('modal-table-detail-content');
                const totalEl = document.getElementById('modal-table-detail-total');
                const footerTotalBar = document.getElementById('td-footer-total-bar');
                const actionsEl = document.getElementById('modal-table-detail-actions');
                const btnOpenMenu = document.getElementById('btn-td-open-menu');

                // Mở modal ngay lập tức
                if (modal) modal.classList.remove('hidden');
                if (titleEl) titleEl.innerText = displayTitle;
                if (btnOpenMenu) {
                    btnOpenMenu.href = getTableMenuUrl(tableName);
                    btnOpenMenu.title = `Mở trang gọi món cho Bàn ${cleanName}`;
                }

                const tableOrders = allOrders.filter(o => isSameTable(o.table_id, tableName) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
                tdCachedActiveOrders = tableOrders;

                const cleanDetailCode = (typeof normalizeTableCode === 'function') ? normalizeTableCode(tableName) : String(tableName).replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                const currentTObj = (typeof allTables !== 'undefined' && Array.isArray(allTables)) ? allTables.find(t => isSameTable(t.name, tableName) || isSameTable(t.id, tableName)) : null;
                const custInDetail = (root.AdminLoyalty && typeof root.AdminLoyalty.getCustomerForTable === 'function')
                    ? root.AdminLoyalty.getCustomerForTable(tableName)
                    : ((currentTObj && currentTObj.attached_customer) || null);
                const vouchInDetail = tableVouchers[cleanDetailCode] || tableVouchers[tableName] || (currentTObj && currentTObj.applied_voucher) || null;

                if (tableOrders.length === 0) {
                    tdCachedSubHtml = `
                        <div class="flex flex-wrap items-center gap-2 text-xs text-gray-600 mt-0.5">
                            <span class="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"><i class="fa-solid fa-chair text-slate-500"></i> Bàn sẵn sàng</span>
                            ${custInDetail && (custInDetail.name || custInDetail.phone) ? `<span class="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"><i class="fa-solid fa-user text-amber-600 text-[10px]"></i> Khách: <strong>${escapeHtml(custInDetail.name || custInDetail.phone)}</strong></span>` : ''}
                            ${vouchInDetail && (vouchInDetail.code || vouchInDetail.id) ? `<span class="bg-purple-100 text-purple-900 border border-purple-300 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"><i class="fa-solid fa-ticket text-purple-600 text-[10px]"></i> Voucher: <strong class="font-mono">${escapeHtml(vouchInDetail.code || vouchInDetail.id)}</strong></span>` : ''}
                        </div>
                    `;
                    tdCachedGrandTotal = 0;
                    if (sub) sub.innerHTML = tdCachedSubHtml;
                    if (footerTotalBar) footerTotalBar.classList.add('hidden');
                    if (content) {
                        content.classList.remove('hidden');
                        content.innerHTML = `
                            <div class="py-8 text-center space-y-3">
                                <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto text-2xl shadow-inner">
                                    <i class="fa-solid fa-chair"></i>
                                </div>
                                <div>
                                    <div class="text-sm font-bold text-gray-800">Bàn ${cleanName} đang sẵn sàng</div>
                                    ${(custInDetail || vouchInDetail) ? `
                                        <div class="mt-2 inline-flex flex-col gap-1 text-xs text-left bg-amber-50/80 border border-amber-200/90 rounded-2xl p-3 shadow-2xs">
                                            ${custInDetail && (custInDetail.name || custInDetail.phone) ? `<div class="font-semibold text-amber-900 flex items-center gap-1.5"><i class="fa-solid fa-user-check text-amber-600"></i> Đã gắn khách: <strong>${escapeHtml(custInDetail.name || custInDetail.phone)}</strong></div>` : ''}
                                            ${vouchInDetail && (vouchInDetail.code || vouchInDetail.id) ? `<div class="font-semibold text-purple-900 flex items-center gap-1.5"><i class="fa-solid fa-ticket text-purple-600"></i> Đã áp voucher: <strong class="font-mono">${escapeHtml(vouchInDetail.code || vouchInDetail.id)}</strong></div>` : ''}
                                        </div>
                                    ` : `<p class="text-gray-400 text-xs mt-0.5">Bàn hiện chưa có khách hoặc chưa có đơn gọi món</p>`}
                                </div>
                                <a href="${getTableMenuUrl(tableName)}" target="_blank" class="px-5 py-2.5 bg-[#d4af37] hover:bg-[#c29f2f] text-black font-bold rounded-xl text-xs transition inline-flex items-center gap-2 shadow-sm">
                                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Mở Menu Bàn ${cleanName}
                                </a>
                            </div>
                        `;
                    }
                    if (totalEl) totalEl.innerText = "0 VNĐ";
                    if (actionsEl) {
                        actionsEl.innerHTML = `
                            <button onclick="closeTableDetailModal()" class="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition">Đóng</button>
                        `;
                    }
                    goToTdStep('detail');
                    return;
                }

                // Bàn có đơn hàng
                if (footerTotalBar) footerTotalBar.classList.remove('hidden');
                if (content) content.innerHTML = `<div class="py-8 text-center text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Đang tải dữ liệu bàn...</div>`;

                let earliestMillis = null;
                tableOrders.forEach(o => {
                    const m = getSafeMillis(o.created_at || o.client_time);
                    if (m > 0 && (!earliestMillis || m < earliestMillis)) {
                        earliestMillis = m;
                    }
                });
                let openTimeStr = '';
                let durationStr = '';
                if (earliestMillis) {
                    const openDate = new Date(earliestMillis);
                    openTimeStr = openDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const diffMins = Math.max(0, Math.floor((Date.now() - earliestMillis) / 60000));
                    durationStr = diffMins < 60 ? `${diffMins} phút` : `${Math.floor(diffMins / 60)} giờ ${diffMins % 60} phút`;
                }

                tdCachedSubHtml = `
                    <div class="flex flex-wrap items-center gap-2 text-xs text-gray-600 mt-0.5">
                        ${openTimeStr ? `<span class="bg-amber-50 text-amber-800 border border-amber-200/80 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5"><i class="fa-regular fa-clock text-amber-600"></i> Giờ mở: <strong>${openTimeStr}</strong> (${durationStr})</span>` : ''}
                        ${custInDetail && (custInDetail.name || custInDetail.phone) ? `<span class="bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5"><i class="fa-solid fa-user-check text-emerald-600"></i> Khách: <strong>${escapeHtml(custInDetail.name || custInDetail.phone)}</strong></span>` : ''}
                        ${vouchInDetail && (vouchInDetail.code || vouchInDetail.id) ? `<span class="bg-purple-50 text-purple-800 border border-purple-200/80 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5"><i class="fa-solid fa-ticket text-purple-600"></i> Voucher: <strong class="font-mono">${escapeHtml(vouchInDetail.code || vouchInDetail.id)}</strong></span>` : ''}
                        <span>${tableOrders.length} đợt gọi món</span>
                    </div>
                `;
                if (sub) sub.innerHTML = tdCachedSubHtml;

                let grandTotal = 0;
                let roundsHtml = '';

                for (let i = 0; i < tableOrders.length; i++) {
                    const ord = tableOrders[i];
                    grandTotal += Number(ord.total_amount) || 0;
                    let itemsHtml = '';

                    let items = (ord.items && Array.isArray(ord.items) && ord.items.length > 0)
                        ? ord.items
                        : (cachedOrderItemsMap[ord.id] || []);

                    if (items.length === 0) {
                        try {
                            const itemSnap = await getDocs(query(collection(db, "order_items"), where("order_id", "==", ord.id)));
                            items = [];
                            itemSnap.forEach(it => items.push(it.data()));
                        } catch(e) {}
                    }

                    const canCancelOrder = (typeof window.canCancelOrders === 'function') && window.canCancelOrders() && !['settled', 'paid', 'transferred', 'cancelled'].includes(ord.status);

                    items.forEach((d, itemIdx) => {
                        itemsHtml += `
                            <div class="flex justify-between items-center py-1.5 border-b border-gray-100 text-xs">
                                <div class="flex-1 min-w-0 pr-2">
                                    <span class="font-bold text-gray-800">${d.quantity || 1}x</span>
                                    <span class="text-gray-800 ml-1.5 font-medium">${escapeHtml(d.dish_name || d.name || 'Món ăn')}</span>
                                    ${formatAdminOptionsHtml(d.options_summary)}
                                    ${d.note ? `<div class="text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded px-1.5 py-0.5 mt-0.5 ml-4 inline-block font-medium">Ghi chú: ${escapeHtml(d.note)}</div>` : ''}
                                </div>
                                <div class="flex items-center gap-2 shrink-0">
                                    <span class="font-semibold text-gray-600">${formatMoney((Number(d.price) || 0) * (Number(d.quantity) || 1))}</span>
                                    ${canCancelOrder ? `
                                        <button type="button" onclick="promptCancelSingleDish('${ord.id}', ${itemIdx}, '${escapeHtml(tableName)}')" class="w-6 h-6 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/80 transition flex items-center justify-center cursor-pointer shadow-2xs shrink-0" title="Hủy món này khỏi đợt (Chỉ Quản lý)">
                                            <i class="fa-solid fa-trash-can text-[10px]"></i>
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    });

                    let statusLabel = 'Chờ duyệt';
                    let statusBadge = 'bg-amber-100 text-amber-800';
                    if (ord.status === 'cooking') {
                        statusLabel = 'Đang nấu';
                        statusBadge = 'bg-blue-100 text-blue-800';
                    } else if (ord.status === 'done') {
                        statusLabel = 'Hoàn thành';
                        statusBadge = 'bg-emerald-100 text-emerald-800';
                    } else if (ord.status === 'transferred') {
                        statusLabel = 'Đã chuyển bàn';
                        statusBadge = 'bg-indigo-100 text-indigo-800';
                    } else if (ord.status === 'cancelled') {
                        statusLabel = 'Đã hủy';
                        statusBadge = 'bg-rose-100 text-rose-800';
                    } else if (ord.status === 'settled' || ord.status === 'paid') {
                        statusLabel = 'Đã thanh toán';
                        statusBadge = 'bg-purple-100 text-purple-800';
                    }

                    const ordMillis = getSafeMillis(ord.created_at || ord.client_time);
                    const ordTimeText = ordMillis > 0 ? new Date(ordMillis).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
                    const shortOrdId = String(ord.id || '').slice(0, 6).toUpperCase();

                    roundsHtml += `
                        <div class="bg-gray-50 p-3 rounded-2xl border border-gray-200/80 space-y-2">
                            <div class="flex justify-between items-center gap-2 flex-wrap">
                                <span class="font-bold text-gray-700">Đợt #${tableOrders.length - i} ${shortOrdId ? `<span class="text-gray-400 font-normal font-mono">(${shortOrdId})</span>` : ''} ${ordTimeText ? `<span class="text-gray-400 font-normal text-[11px] ml-1.5"><i class="fa-regular fa-clock text-[10px]"></i> ${ordTimeText}</span>` : ''}</span>
                                <div class="flex items-center gap-1.5">
                                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadge}">${statusLabel}</span>
                                </div>
                            </div>
                            <div class="space-y-0.5">
                                ${itemsHtml || '<p class="text-gray-400 italic">Không có món</p>'}
                            </div>
                            <div class="flex justify-between items-center pt-1 border-t border-dashed border-gray-200 font-bold text-xs">
                                <span class="text-gray-500">Tổng đợt:</span>
                                <span class="text-[#b89728]">${formatMoney(ord.total_amount)}</span>
                            </div>
                        </div>
                    `;
                }

                tdCachedGrandTotal = grandTotal;
                if (content) content.innerHTML = roundsHtml;
                if (totalEl) totalEl.innerText = formatMoney(grandTotal);

                goToTdStep(initialStep === 'target' ? 'target' : 'detail');

            } catch (err) {
                console.error("Lỗi khi mở chi tiết bàn:", err);
                const content = document.getElementById('modal-table-detail-content');
                if (content) {
                    content.innerHTML = `<div class="p-4 text-center text-red-500 font-bold">Không thể tải thông tin bàn: ${err.message || err}</div>`;
                }
            }
        }
        window.openTableDetail = openTableDetail;

        // Render các nút hành động ở Bước 1: Chi tiết bàn
        function renderTableDetailOrderActions() {
            const actionsEl = document.getElementById('modal-table-detail-actions');
            if (!actionsEl || !tdCurrentTable) return;
            const tableName = tdCurrentTable;

            actionsEl.innerHTML = `
                <button type="button" onclick="closeTableDetailModal()" class="py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs transition">Đóng</button>
                <button type="button" onclick="goToTdStep('target')" class="py-2.5 px-3.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl text-xs transition border border-amber-200/80 shadow-xs flex items-center justify-center gap-1.5" title="Chuyển hoặc gộp bàn này sang bàn khác">
                    <i class="fa-solid fa-arrows-split-up-and-left text-xs"></i> Chuyển / Gộp bàn
                </button>
                <button type="button" onclick="closeTableDetailModal(); settleAndResetTable('${tableName}');" class="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-1.5"><i class="fa-solid fa-file-invoice-dollar"></i> Thanh toán</button>
            `;
        }

        // =========================================================================
        // BƯỚC 2: RENDER GRID CHỌN BÀN ĐÍCH (HIỂN THỊ HÀNG CỘT CHUẨN THEO SƠ ĐỒ BÀN)
        // =========================================================================
        function renderTdTargetGrid() {
            const container = document.getElementById('td-target-grid');
            if (!container) return;

            // Đảm bảo toàn bộ các bàn luôn được sắp xếp theo đúng quy chuẩn thứ tự bàn (A1..A4, B1..B4, C1..C4)
            const sortedTables = [...allTables].sort(compareTableOrder);

            if (sortedTables.length === 0) {
                container.innerHTML = `<div class="col-span-full py-8 text-center text-gray-400 italic text-xs">Không có bàn nào trong hệ thống để chuyển/gộp.</div>`;
                return;
            }

            let html = '';
            sortedTables.forEach(t => {
                const tName = t.name || t.id || t.tableId;
                const clean = tName.replace(/^(bàn\s*)+/i, '').trim() || tName;
                const isSource = isSameTable(tName, tdCurrentTable);
                const isSelected = !isSource && isSameTable(tName, tdSelectedTargetTable);
                const tableOrders = allOrders.filter(o => isSameTable(o.table_id, tName) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
                const hasActiveOrders = tableOrders.length > 0;

                if (isSource) {
                    // Bàn nguồn (Bàn hiện tại đang thao tác chuyển đi): Giữ nguyên vị trí hàng-cột nhưng khóa không cho chọn chính nó
                    html += `
                        <div class="p-3 sm:p-3.5 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/50 cursor-not-allowed opacity-80 shadow-inner select-none flex flex-col justify-center items-center text-center" title="Bàn nguồn đang thao tác chuyển món">
                            <div class="font-black text-sm sm:text-base text-amber-950">Bàn ${clean}</div>
                            <div class="mt-1">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-black shadow-2xs">Bàn nguồn</span>
                            </div>
                        </div>
                    `;
                } else if (isSelected) {
                    // Bàn đích đang được chọn: Viền vàng hổ phách nổi bật, hiệu ứng scale
                    html += `
                        <div onclick="selectTdTarget('${tName}')" ondblclick="goToTdStep('action')" class="p-3 sm:p-3.5 rounded-2xl cursor-pointer transition flex flex-col justify-center items-center text-center select-none border-2 border-amber-500 bg-amber-50/90 shadow-md ring-2 ring-amber-400/50 scale-[1.02] text-amber-950 font-bold" title="Nhấp đúp để tiếp tục chuyển món">
                            <div class="font-black text-sm sm:text-base text-amber-900">Bàn ${clean}</div>
                            <div class="text-xs ${hasActiveOrders ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'} mt-1 flex items-center gap-1 justify-center">
                                <i class="fa-solid fa-circle-check text-amber-600 text-[10px]"></i>
                                <span>${hasActiveOrders ? `Có khách (${tableOrders.length} đợt)` : 'Bàn trống'}</span>
                            </div>
                        </div>
                    `;
                } else {
                    // Các bàn đích hợp lệ khác
                    const cardBg = hasActiveOrders
                        ? 'border border-amber-200 bg-amber-50/30 hover:border-amber-400 hover:bg-amber-50/60 text-gray-800 shadow-2xs'
                        : 'border border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/20 text-gray-800 shadow-2xs';
                    html += `
                        <div onclick="selectTdTarget('${tName}')" ondblclick="goToTdStep('action')" class="p-3 sm:p-3.5 rounded-2xl cursor-pointer transition flex flex-col justify-center items-center text-center select-none ${cardBg}">
                            <div class="font-black text-sm sm:text-base">Bàn ${clean}</div>
                            <div class="text-xs ${hasActiveOrders ? 'text-amber-700 font-semibold' : 'text-gray-400'} mt-1">
                                ${hasActiveOrders ? `Có khách (${tableOrders.length} đợt)` : 'Bàn trống'}
                            </div>
                        </div>
                    `;
                }
            });

            container.innerHTML = html;
        }

        function selectTdTarget(tableName) {
            tdSelectedTargetTable = tableName;
            renderTdTargetGrid();
            updateTdTargetPreview();
        }
        window.selectTdTarget = selectTdTarget;

        function updateTdTargetPreview() {
            const previewBox = document.getElementById('td-target-preview-box');
            const btnNext = document.getElementById('btn-td-step-target-next');
            if (!btnNext) return;

            if (!tdSelectedTargetTable) {
                if (previewBox) previewBox.classList.add('hidden');
                btnNext.disabled = true;
                return;
            }

            const cleanSource = tdCurrentTable ? tdCurrentTable.replace(/^(bàn\s*)+/i, '').trim() : '';
            const cleanTarget = tdSelectedTargetTable.replace(/^(bàn\s*)+/i, '').trim();
            const targetOrders = allOrders.filter(o => isSameTable(o.table_id, tdSelectedTargetTable) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
            const isOccupied = targetOrders.length > 0;

            if (previewBox) {
                previewBox.classList.remove('hidden');
                previewBox.className = isOccupied
                    ? "p-3 rounded-2xl border border-blue-200 bg-blue-50/80 text-blue-900 text-xs space-y-1 flex-shrink-0"
                    : "p-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 text-emerald-900 text-xs space-y-1 flex-shrink-0";

                previewBox.innerHTML = isOccupied
                    ? `<div><i class="fa-solid fa-arrows-split-up-and-left text-blue-600 mr-1.5"></i> <strong>Bàn đích: Bàn ${cleanTarget}</strong> (Đang có ${targetOrders.length} đợt gọi). Nhấn nút dưới đây để chọn món chuyển sang.</div>`
                    : `<div><i class="fa-solid fa-arrow-right-arrow-left text-emerald-600 mr-1.5"></i> <strong>Bàn đích: Bàn ${cleanTarget}</strong> (Bàn trống sẵn sàng). Nhấn nút dưới đây để chọn món chuyển sang.</div>`;
            }

            btnNext.disabled = false;
        }

        // =========================================================================
        // BƯỚC 3: MÀN HÌNH ĐIỀU CHUYỂN MÓN 2 CỘT CHUẨN 100% APP ANDROID (WORKBENCH)
        // =========================================================================
        async function initSplitTransferWorkbench() {
            tdSplitSourceItems = [];
            tdSplitTargetItems = [];

            const cleanSource = tdCurrentTable ? tdCurrentTable.replace(/^(bàn\s*)+/i, '').trim() : '';
            const cleanTarget = tdSelectedTargetTable ? tdSelectedTargetTable.replace(/^(bàn\s*)+/i, '').trim() : '';

            // Header titles
            const srcTitle = document.getElementById('td-split-source-title');
            const trgTitle = document.getElementById('td-split-target-title');
            const trgBadge = document.getElementById('td-split-target-badge');
            if (srcTitle) srcTitle.innerText = `BÀN ${cleanSource}`;
            if (trgTitle) trgTitle.innerText = `BÀN ${cleanTarget}`;

            const targetOrders = allOrders.filter(o => isSameTable(o.table_id, tdSelectedTargetTable) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
            const isTargetOccupied = targetOrders.length > 0;
            if (trgBadge) {
                trgBadge.innerText = isTargetOccupied ? 'CÓ KHÁCH' : 'BÀN TRỐNG';
                trgBadge.className = isTargetOccupied
                    ? "px-2 py-0.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-bold text-[11px] tracking-wide"
                    : "px-2 py-0.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-700 font-bold text-[11px] tracking-wide";
            }

            // Tải danh sách món từ tất cả đơn active của bàn nguồn
            const sourceOrders = allOrders.filter(o => isSameTable(o.table_id, tdCurrentTable) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
            for (let oIdx = 0; oIdx < sourceOrders.length; oIdx++) {
                const ord = sourceOrders[oIdx];
                let items = (ord.items && Array.isArray(ord.items) && ord.items.length > 0)
                    ? ord.items
                    : (cachedOrderItemsMap[ord.id] || []);

                if (items.length === 0) {
                    try {
                        const itemSnap = await getDocs(query(collection(db, "order_items"), where("order_id", "==", ord.id)));
                        items = [];
                        itemSnap.forEach(it => {
                            const d = it.data();
                            d.docId = it.id;
                            items.push(d);
                        });
                    } catch(e) {}
                }

                items.forEach((it, idx) => {
                    const uid = `${ord.id}_${it.docId || it.id || it.dish_id || idx}_${idx}`;
                    const itemQty = Number(it.quantity) || 1;
                    tdSplitSourceItems.push({
                        uid: uid,
                        orderId: ord.id,
                        docId: it.docId || it.id || '',
                        dish_id: it.dish_id || '',
                        dish_name: it.dish_name || 'Món ăn',
                        price: Number(it.price) || 0,
                        quantity: itemQty,
                        initialQty: itemQty,
                        options_summary: it.options_summary || '',
                        note: it.note || '',
                        is_combo: !!it.is_combo,
                        combo_summary: it.combo_summary || '',
                        selected_options: it.selected_options || [],
                        itemIdx: idx
                    });
                });
            }

            renderSplitWorkbench();
        }

        function renderSplitWorkbench() {
            const srcListEl = document.getElementById('td-split-source-list');
            const trgListEl = document.getElementById('td-split-target-list');
            const srcCountEl = document.getElementById('td-split-source-count');
            const trgCountEl = document.getElementById('td-split-target-count');
            const srcTotalEl = document.getElementById('td-split-source-total');
            const trgTotalEl = document.getElementById('td-split-target-total');
            const btnSave = document.getElementById('btn-td-save-and-exit');

            // Tính tổng số lượng & giá trị
            const srcTotalQty = tdSplitSourceItems.reduce((s, it) => s + it.quantity, 0);
            const srcTotalAmount = tdSplitSourceItems.reduce((s, it) => s + (it.price * it.quantity), 0);
            const trgTotalQty = tdSplitTargetItems.reduce((s, it) => s + it.quantity, 0);
            const trgTotalAmount = tdSplitTargetItems.reduce((s, it) => s + (it.price * it.quantity), 0);

            if (srcCountEl) srcCountEl.innerText = `(${srcTotalQty} món)`;
            if (srcTotalEl) srcTotalEl.innerText = formatMoney(srcTotalAmount);
            if (trgCountEl) trgCountEl.innerText = `(${trgTotalQty} món)`;
            if (trgTotalEl) trgTotalEl.innerText = formatMoney(trgTotalAmount);

            // Cột Trái: BÀN NGUỒN
            if (srcListEl) {
                if (tdSplitSourceItems.length === 0) {
                    srcListEl.innerHTML = `<div class="py-14 text-center text-gray-400 italic text-xs">Đã chuyển hết món sang bàn đích.</div>`;
                } else {
                    let html = '';
                    tdSplitSourceItems.forEach(it => {
                        const optHtml = formatAdminOptionsHtml(it.options_summary);
                        const noteHtml = it.note ? `<div class="text-[10px] text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 mt-0.5 inline-block font-medium">Ghi chú: ${escapeHtml(it.note)}</div>` : '';
                        html += `
                            <div onclick="moveSingleItemToTarget('${it.uid}')" class="bg-white border border-gray-200 hover:border-amber-400 hover:bg-amber-50/30 rounded-xl p-2.5 flex items-center justify-between cursor-pointer transition select-none shadow-2xs group">
                                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                                    <span class="w-7 h-7 rounded-lg bg-amber-100 text-amber-900 font-black text-xs flex items-center justify-center shrink-0">x${it.quantity}</span>
                                    <div class="min-w-0 flex-1">
                                        <div class="font-bold text-gray-800 text-xs truncate">${escapeHtml(it.dish_name)}</div>
                                        <div class="text-[11px] text-[#b89728] font-semibold">${formatMoney(it.price)}</div>
                                        ${optHtml}
                                        ${noteHtml}
                                    </div>
                                </div>
                                <button type="button" onclick="event.stopPropagation(); moveSingleItemToTarget('${it.uid}')" class="w-8 h-8 rounded-lg bg-amber-50 group-hover:bg-amber-100 text-amber-800 border border-amber-200 flex items-center justify-center text-xs font-bold transition shrink-0 ml-2" title="Chuyển 1 phần sang bàn đích">
                                    <i class="fa-solid fa-arrow-right"></i>
                                </button>
                            </div>
                        `;
                    });
                    srcListEl.innerHTML = html;
                }
            }

            // Cột Phải: BÀN ĐÍCH
            if (trgListEl) {
                if (tdSplitTargetItems.length === 0) {
                    trgListEl.innerHTML = `
                        <div class="py-16 px-4 text-center text-gray-400 text-xs flex flex-col items-center justify-center gap-2">
                            <i class="fa-solid fa-arrow-left text-gray-300 text-xl"></i>
                            <span>Chưa có món nào ở bàn đích. Chạm vào món ở bàn nguồn để chuyển sang đây.</span>
                        </div>
                    `;
                } else {
                    let html = '';
                    tdSplitTargetItems.forEach(it => {
                        const optHtml = formatAdminOptionsHtml(it.options_summary);
                        const noteHtml = it.note ? `<div class="text-[10px] text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 mt-0.5 inline-block font-medium">Ghi chú: ${escapeHtml(it.note)}</div>` : '';
                        html += `
                            <div onclick="moveSingleItemBackToSource('${it.uid}')" class="bg-white border border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/30 rounded-xl p-2.5 flex items-center justify-between cursor-pointer transition select-none shadow-2xs group">
                                <button type="button" onclick="event.stopPropagation(); moveSingleItemBackToSource('${it.uid}')" class="w-8 h-8 rounded-lg bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center justify-center text-xs font-bold transition shrink-0 mr-2" title="Hoàn lại 1 phần về bàn nguồn">
                                    <i class="fa-solid fa-arrow-left"></i>
                                </button>
                                <div class="min-w-0 flex-1">
                                    <div class="font-bold text-gray-800 text-xs truncate">${escapeHtml(it.dish_name)}</div>
                                    <div class="text-[11px] text-[#b89728] font-semibold">${formatMoney(it.price)}</div>
                                    ${optHtml}
                                    ${noteHtml}
                                </div>
                                <span class="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-900 font-black text-xs flex items-center justify-center shrink-0 ml-2">x${it.quantity}</span>
                            </div>
                        `;
                    });
                    trgListEl.innerHTML = html;
                }
            }

            // Trạng thái nút Lưu và thoát bàn
            if (btnSave) {
                const hasMoved = tdSplitTargetItems.length > 0;
                btnSave.disabled = !hasMoved;
                if (!hasMoved) {
                    btnSave.innerHTML = `<i class="fa-solid fa-check mr-1.5"></i> Lưu và thoát bàn`;
                } else if (tdSplitSourceItems.length === 0) {
                    btnSave.innerHTML = `<i class="fa-solid fa-arrows-split-up-and-left mr-1.5"></i> Chuyển toàn bộ bàn (${trgTotalQty} món) & Lưu`;
                } else {
                    btnSave.innerHTML = `<i class="fa-solid fa-check mr-1.5"></i> Chuyển ${trgTotalQty} món & Lưu`;
                }
            }
        }

        // Chuyển 1 phần tử từ nguồn sang đích
        function moveSingleItemToTarget(uid) {
            const srcIdx = tdSplitSourceItems.findIndex(it => it.uid === uid);
            if (srcIdx === -1) return;
            const srcItem = tdSplitSourceItems[srcIdx];

            if (srcItem.quantity > 1) {
                srcItem.quantity -= 1;
            } else {
                tdSplitSourceItems.splice(srcIdx, 1);
            }

            const trgItem = tdSplitTargetItems.find(it => it.uid === uid);
            if (trgItem) {
                trgItem.quantity += 1;
            } else {
                tdSplitTargetItems.push({
                    ...srcItem,
                    quantity: 1
                });
            }

            renderSplitWorkbench();
        }
        window.moveSingleItemToTarget = moveSingleItemToTarget;

        // Hoàn 1 phần tử từ đích về nguồn
        function moveSingleItemBackToSource(uid) {
            const trgIdx = tdSplitTargetItems.findIndex(it => it.uid === uid);
            if (trgIdx === -1) return;
            const trgItem = tdSplitTargetItems[trgIdx];

            if (trgItem.quantity > 1) {
                trgItem.quantity -= 1;
            } else {
                tdSplitTargetItems.splice(trgIdx, 1);
            }

            const srcItem = tdSplitSourceItems.find(it => it.uid === uid);
            if (srcItem) {
                srcItem.quantity += 1;
            } else {
                tdSplitSourceItems.push({
                    ...trgItem,
                    quantity: 1
                });
            }

            renderSplitWorkbench();
        }
        window.moveSingleItemBackToSource = moveSingleItemBackToSource;

        // Chuyển tất cả từ nguồn sang đích
        function moveAllSplitItemsToTarget() {
            tdSplitSourceItems.forEach(srcItem => {
                const existing = tdSplitTargetItems.find(it => it.uid === srcItem.uid);
                if (existing) {
                    existing.quantity += srcItem.quantity;
                } else {
                    tdSplitTargetItems.push({ ...srcItem });
                }
            });
            tdSplitSourceItems = [];
            renderSplitWorkbench();
        }
        window.moveAllSplitItemsToTarget = moveAllSplitItemsToTarget;

        // Hoàn tất cả từ đích về nguồn
        function returnAllSplitItemsToSource() {
            tdSplitTargetItems.forEach(trgItem => {
                const existing = tdSplitSourceItems.find(it => it.uid === trgItem.uid);
                if (existing) {
                    existing.quantity += trgItem.quantity;
                } else {
                    tdSplitSourceItems.push({ ...trgItem });
                }
            });
            tdSplitTargetItems = [];
            renderSplitWorkbench();
        }
        window.returnAllSplitItemsToSource = returnAllSplitItemsToSource;

        // Lưu các thay đổi từ 2 cột vào Firestore bằng Atomic Batch Commit
        async function commitSplitTransferWorkbench() {
            if (!tdCurrentTable || !tdSelectedTargetTable) return;
            if (tdSplitTargetItems.length === 0) return;

            const btnSave = document.getElementById('btn-td-save-and-exit');
            const targetClean = String(tdSelectedTargetTable).trim();
            const sourceClean = String(tdCurrentTable).trim();

            if (isSameTable(sourceClean, targetClean)) {
                alert("Bàn nguồn và bàn đích không được trùng nhau!");
                return;
            }

            if (btnSave) {
                btnSave.disabled = true;
                btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Đang lưu và chuyển bàn...`;
            }

            try {
                const batch = writeBatch(db);
                const isFullMove = (tdSplitSourceItems.length === 0);

                if (isFullMove) {
                    // TRƯỜNG HỢP 1: CHUYỂN TOÀN BỘ BÀN (100% món đã được chuyển)
                    let activeOrders = allOrders.filter(o => isSameTable(o.table_id, sourceClean) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
                    if (activeOrders.length === 0) {
                        try {
                            const snap = await getDocs(query(
                                collection(db, "orders"),
                                where("status", "in", ["pending", "cooking", "done", "assistance", "checkout"])
                            ));
                            snap.forEach(d => {
                                const data = d.data();
                                if (isSameTable(data.table_id, sourceClean)) {
                                    activeOrders.push({ id: d.id, ...data });
                                }
                            });
                        } catch(e) {}
                    }
                    if (activeOrders.length === 0) {
                        showAdminToast(`⚠️ Bàn ${sourceClean} không còn đơn hoạt động hoặc đã được chuyển/thanh toán bởi thiết bị khác!`, 'error');
                        if (btnSave) {
                            btnSave.disabled = false;
                            btnSave.innerHTML = `<i class="fa-solid fa-check mr-1.5"></i> Xác nhận chuyển sang bàn đích`;
                        }
                        closeTableDetail();
                        scheduleRenderTableBoard();
                        return;
                    }
                    activeOrders.forEach(ord => {
                        batch.update(doc(db, "orders", ord.id), {
                            table_id: targetClean,
                            transferred_from: sourceClean,
                            transferred_at: serverTimestamp()
                        });
                        ord.table_id = targetClean;
                    });

                    // Chuyển yêu cầu phục vụ pending
                    try {
                        const reqSnap = await getDocs(query(collection(db, "service_requests"), where("status", "==", "pending")));
                        reqSnap.forEach(sDoc => {
                            if (isSameTable(sDoc.data().table_id, sourceClean)) {
                                batch.update(sDoc.ref, { table_id: targetClean });
                            }
                        });
                    } catch(e) {}

                    // Giải phóng bàn nguồn về available và lưu vết transferred_to
                    try {
                        const targetTableObj = allTables.find(t => isSameTable(t.name, targetClean) || isSameTable(t.id, targetClean));
                        const sourceTableObj = allTables.find(t => isSameTable(t.name, sourceClean) || isSameTable(t.id, sourceClean));
                        const sourceDocId = (sourceTableObj && sourceTableObj.id) ? sourceTableObj.id : (normalizeTableCode(sourceClean) || sourceClean);
                        const sourceDocRef = doc(db, "tables", sourceDocId);
                        batch.set(sourceDocRef, {
                            status: "available",
                            transferred_to: targetClean,
                            transferred_to_token: targetTableObj?.qr_token || null,
                            transferred_at: serverTimestamp(),
                            current_session_id: null,
                            assignedStaffUsername: null,
                            assignedStaffName: null,
                            assigned_staff_username: null,
                            assigned_staff_name: null,
                            attached_customer: null,
                            applied_voucher: null,
                            use_points: false,
                            updated_at: serverTimestamp()
                        }, { merge: true });
                    } catch(e) {}

                    // Đảm bảo bàn đích dining và làm sạch cờ transferred cũ nếu có
                    try {
                        const targetTableObj = allTables.find(t => isSameTable(t.name, targetClean) || isSameTable(t.id, targetClean));
                        const targetDocId = (targetTableObj && targetTableObj.id) ? targetTableObj.id : (normalizeTableCode(targetClean) || targetClean);
                        const targetDocRef = doc(db, "tables", targetDocId);
                        const targetTableUpdate = {
                            status: "dining",
                            name: targetTableObj?.name || targetClean,
                            tableId: targetClean,
                            transferred_to: deleteField(),
                            transferred_to_token: deleteField(),
                            transferred_at: deleteField(),
                            updated_at: serverTimestamp()
                        };

                        // Chuyển toàn bộ voucher đã áp dụng sang bàn đích (Case 1: Full Transfer)
                        const srcVoucher = tableVouchers[sourceClean] || null;
                        if (srcVoucher) {
                            targetTableUpdate.applied_voucher = srcVoucher;
                            tableVouchers[targetClean] = srcVoucher;
                            delete tableVouchers[sourceClean];
                            const srcTableDocId = (sourceTableObj && sourceTableObj.id) ? sourceTableObj.id : (normalizeTableCode(sourceClean) || sourceClean);
                            batch.set(doc(db, "tables", srcTableDocId), { applied_voucher: null }, { merge: true });
                        }

                        batch.set(targetDocRef, targetTableUpdate, { merge: true });
                    } catch(e) {}

                    await batch.commit();

                    // Xử lý chuyển tài khoản khách hàng khi chuyển toàn bộ bàn
                    if (root.AdminLoyalty && typeof root.AdminLoyalty.transferCustomerBetweenTables === 'function') {
                        root.AdminLoyalty.transferCustomerBetweenTables(sourceClean, targetClean, true);
                    }

                    showAdminToast(`Đã chuyển toàn bộ từ Bàn ${sourceClean} sang Bàn ${targetClean} thành công!`, 'success');

                    const logTransferFullFn = (typeof root.logAuditEvent === 'function') ? root.logAuditEvent : ((typeof window !== 'undefined' && typeof window.logAuditEvent === 'function') ? window.logAuditEvent : null);
                    if (logTransferFullFn) {
                        logTransferFullFn('TABLE_TRANSFER', 'ORDERS', `Chuyển toàn bộ từ Bàn ${sourceClean} sang Bàn ${targetClean}`, {
                            from_table: sourceClean,
                            to_table: targetClean,
                            is_full_transfer: true
                        });
                    }

                } else {
                    // TRƯỜNG HỢP 2: TÁCH MỘT PHẦN MÓN SANG BÀN ĐÍCH
                    const targetOrderRef = doc(collection(db, "orders"));
                    const targetOrderId = targetOrderRef.id;
                    const targetTotal = tdSplitTargetItems.reduce((sum, it) => sum + (it.price * it.quantity), 0);

                    // Kiểm tra và bảo toàn tài khoản khách của bàn đích
                    const targetCust = (root.AdminLoyalty && typeof root.AdminLoyalty.getCustomerForTable === 'function')
                        ? root.AdminLoyalty.getCustomerForTable(targetClean)
                        : (allTables.find(t => isSameTable(t.name, targetClean) || isSameTable(t.id, targetClean))?.attached_customer || null);

                    const targetOrderData = {
                        table_id: targetClean,
                        total_amount: targetTotal,
                        status: "pending",
                        created_at: serverTimestamp(),
                        client_time: Date.now(),
                        transferred_from: sourceClean,
                        note: `Tách món từ Bàn ${sourceClean}`,
                        items: tdSplitTargetItems.map(it => ({
                            dish_id: it.dish_id || '',
                            dish_name: it.dish_name,
                            price: it.price,
                            quantity: it.quantity,
                            options_summary: it.options_summary || '',
                            note: it.note || '',
                            is_combo: !!it.is_combo,
                            combo_summary: it.combo_summary || '',
                            selected_options: it.selected_options || []
                        }))
                    };

                    if (targetCust) {
                        targetOrderData.customer_id = targetCust.id || targetCust.phone || '';
                        targetOrderData.customer_name = targetCust.name || '';
                        targetOrderData.customer_phone = targetCust.phone || '';
                        targetOrderData.customer_tier = targetCust.tier || 'member';
                    }

                    batch.set(targetOrderRef, targetOrderData);

                    // Ghi order_items cho bàn đích (bảo toàn trọn vẹn thông tin combo & topping)
                    tdSplitTargetItems.forEach(it => {
                        const newItemRef = doc(collection(db, "order_items"));
                        batch.set(newItemRef, {
                            order_id: targetOrderId,
                            dish_id: it.dish_id || '',
                            dish_name: it.dish_name,
                            price: it.price,
                            quantity: it.quantity,
                            options_summary: it.options_summary || '',
                            note: it.note || '',
                            is_combo: !!it.is_combo,
                            combo_summary: it.combo_summary || '',
                            selected_options: it.selected_options || [],
                            created_at: serverTimestamp()
                        });
                    });

                    // Cập nhật lại các món còn lại ở bàn nguồn
                    const originalSourceOrders = allOrders.filter(o => isSameTable(o.table_id, sourceClean) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status));
                    for (const order of originalSourceOrders) {
                        const orderRemaining = tdSplitSourceItems.filter(it => it.orderId === order.id);
                        const newOrderTotal = orderRemaining.reduce((sum, it) => sum + (it.price * it.quantity), 0);

                        // Cập nhật hoặc xóa các document con trong order_items của bàn nguồn
                        for (const it of tdSplitTargetItems.filter(t => t.orderId === order.id)) {
                            if (it.docId) {
                                const rem = orderRemaining.find(r => r.docId === it.docId);
                                if (!rem || rem.quantity <= 0) {
                                    batch.delete(doc(db, "order_items", it.docId));
                                } else {
                                    batch.update(doc(db, "order_items", it.docId), { quantity: rem.quantity });
                                }
                            }
                        }

                        // Cập nhật mảng items & total_amount trong orders (bảo toàn combo & options)
                        const newItemsArray = orderRemaining.map(r => ({
                            dish_id: r.dish_id,
                            dish_name: r.dish_name,
                            price: r.price,
                            quantity: r.quantity,
                            options_summary: r.options_summary || '',
                            note: r.note || '',
                            is_combo: !!r.is_combo,
                            combo_summary: r.combo_summary || '',
                            selected_options: r.selected_options || []
                        }));

                        if (orderRemaining.length === 0) {
                            batch.update(doc(db, "orders", order.id), {
                                status: "transferred",
                                table_id: targetClean,
                                transferred_to: targetClean,
                                transferred_at: serverTimestamp(),
                                total_amount: 0,
                                items: [],
                                note: `Đã chuyển hết món sang Bàn ${targetClean}`
                            });
                        } else {
                            batch.update(doc(db, "orders", order.id), {
                                items: newItemsArray,
                                total_amount: newOrderTotal
                            });
                        }
                    }

                    // Nếu bàn nguồn đã chuyển sạch toàn bộ món sang bàn đích -> giải phóng bàn nguồn về available
                    if (tdSplitSourceItems.length === 0) {
                        try {
                            const targetTableObj = allTables.find(t => isSameTable(t.name, targetClean) || isSameTable(t.id, targetClean));
                            const sourceTableObj = allTables.find(t => isSameTable(t.name, sourceClean) || isSameTable(t.id, sourceClean));
                            const sourceDocId = (sourceTableObj && sourceTableObj.id) ? sourceTableObj.id : (normalizeTableCode(sourceClean) || sourceClean);
                            const sourceDocRef = doc(db, "tables", sourceDocId);
                            batch.set(sourceDocRef, {
                                status: "available",
                                transferred_to: targetClean,
                                transferred_to_token: targetTableObj?.qr_token || null,
                                transferred_at: serverTimestamp(),
                                current_session_id: null,
                                assignedStaffUsername: null,
                                assignedStaffName: null,
                                assigned_staff_username: null,
                                assigned_staff_name: null,
                                attached_customer: null,
                                applied_voucher: null,
                                use_points: false,
                                updated_at: serverTimestamp()
                            }, { merge: true });
                        } catch(e) {}
                    }

                    // Đảm bảo bàn đích dining và làm sạch cờ transferred cũ nếu có
                    try {
                        const targetTableObj = allTables.find(t => isSameTable(t.name, targetClean) || isSameTable(t.id, targetClean));
                        const targetDocId = (targetTableObj && targetTableObj.id) ? targetTableObj.id : (normalizeTableCode(targetClean) || targetClean);
                        const targetDocRef = doc(db, "tables", targetDocId);
                        batch.set(targetDocRef, {
                            status: "dining",
                            name: targetTableObj?.name || targetClean,
                            tableId: targetClean,
                            transferred_to: deleteField(),
                            transferred_to_token: deleteField(),
                            transferred_at: deleteField(),
                            updated_at: serverTimestamp()
                        }, { merge: true });
                    } catch(e) {}

                    await batch.commit();

                    // Xử lý tài khoản khách hàng khi tách món hoặc chuyển hết món
                    const isAllMoved = (tdSplitSourceItems.length === 0);
                    if (root.AdminLoyalty && typeof root.AdminLoyalty.transferCustomerBetweenTables === 'function') {
                        root.AdminLoyalty.transferCustomerBetweenTables(sourceClean, targetClean, isAllMoved);
                    }

                    if (isAllMoved) {
                        // Chuyển toàn bộ voucher sang bàn đích
                        const srcVoucher = tableVouchers[sourceClean] || null;
                        if (srcVoucher) {
                            tableVouchers[targetClean] = srcVoucher;
                            delete tableVouchers[sourceClean];
                            setDoc(doc(db, "tables", targetClean), { applied_voucher: srcVoucher, updated_at: serverTimestamp() }, { merge: true }).catch(() => {});
                            setDoc(doc(db, "tables", sourceClean), { applied_voucher: null, updated_at: serverTimestamp() }, { merge: true }).catch(() => {});
                        }
                    } else {
                        // BÀN NGUỒN CÒN MÓN -> KIỂM TRA LẠI (RE-VALIDATE) VOUCHER BÀN NGUỒN THEO ĐỀ XUẤT 2
                        const srcVoucher = tableVouchers[sourceClean] || null;
                        if (srcVoucher) {
                            const remainingTotal = tdSplitSourceItems.reduce((s, it) => s + (it.price * it.quantity), 0);
                            let shouldCancelVoucher = false;
                            let cancelReason = '';

                            // 1. Kiểm tra voucher tặng món / giảm món cụ thể
                            const vType = String(srcVoucher.type || srcVoucher.discount_type || '').toLowerCase();
                            if (vType === 'dish') {
                                const hasSpecificDish = tdSplitSourceItems.some(it => 
                                    (srcVoucher.specific_dish_id && it.dish_id === srcVoucher.specific_dish_id) ||
                                    (srcVoucher.specific_dish_name && it.dish_name && it.dish_name.toLowerCase().trim() === srcVoucher.specific_dish_name.toLowerCase().trim())
                                );
                                if (!hasSpecificDish) {
                                    shouldCancelVoucher = true;
                                    cancelReason = `Voucher tặng món (${srcVoucher.campaign_name || srcVoucher.code}) đã tự động hủy và hoàn trả về kho do món tặng đã được tách sang Bàn ${targetClean}!`;
                                }
                            }

                            // 2. Kiểm tra điều kiện đơn tối thiểu (min_bill)
                            const minBill = Number(srcVoucher.min_bill || srcVoucher.minBill || 0);
                            if (!shouldCancelVoucher && minBill > 0 && remainingTotal < minBill) {
                                shouldCancelVoucher = true;
                                cancelReason = `Voucher ${srcVoucher.code || ''} đã tự động hủy do tổng tiền còn lại (${formatMoney(remainingTotal)}) nhỏ hơn điều kiện tối thiểu (${formatMoney(minBill)})!`;
                            }

                            if (shouldCancelVoucher) {
                                delete tableVouchers[sourceClean];
                                setDoc(doc(db, "tables", sourceClean), { applied_voucher: null, updated_at: serverTimestamp() }, { merge: true }).catch(() => {});
                                const codeToRelease = srcVoucher.code || srcVoucher.id;
                                if (codeToRelease) {
                                    updateDoc(doc(db, "voucher_codes", String(codeToRelease).toUpperCase()), {
                                        status: "available",
                                        used_at: null,
                                        used_by_order: null
                                    }).catch(() => {});
                                }
                                showAdminToast(cancelReason, 'warning');
                            }
                        }
                    }

                    const totalMovedQty = tdSplitTargetItems.reduce((s, it) => s + it.quantity, 0);
                    showAdminToast(`Đã chuyển ${totalMovedQty} món từ Bàn ${sourceClean} sang Bàn ${targetClean} thành công!`, 'success');
                    const logTransferSplitFn = (typeof root.logAuditEvent === 'function') ? root.logAuditEvent : ((typeof window !== 'undefined' && typeof window.logAuditEvent === 'function') ? window.logAuditEvent : null);
                    if (logTransferSplitFn) {
                        logTransferSplitFn('TABLE_TRANSFER', 'ORDERS', `Chuyển ${totalMovedQty} món từ Bàn ${sourceClean} sang Bàn ${targetClean}`, {
                            from_table: sourceClean,
                            to_table: targetClean,
                            items_count: totalMovedQty,
                            is_full_transfer: (tdSplitSourceItems.length === 0)
                        });
                    }
                }

                closeTableDetailModal();
                if (typeof renderTables === 'function') {
                    renderTables();
                }

            } catch (err) {
                console.error("Lỗi khi lưu và chuyển bàn:", err);
                alert(`Không thể thực hiện chuyển bàn: ${err.message || err}`);
            } finally {
                if (btnSave) {
                    btnSave.disabled = false;
                }
            }
        }
        window.commitSplitTransferWorkbench = commitSplitTransferWorkbench;
        window.executeTableDetailTransfer = commitSplitTransferWorkbench;

        // Aliases cho các nút gọi chuyển bàn từ Floor Plan
        window.openTableTransferModal = function(tableName) {
            openTableDetail(tableName, 'target');
        };

        window.closeTableTransferModal = function() {
            closeTableDetailModal();
        };

        window.submitTableTransfer = function() {
            commitSplitTransferWorkbench();
        };

        // Cập nhật trạng thái tất cả đơn của bàn
        window.quickUpdateTableOrders = async function(tableName, newStatus) {
            const tableOrders = allOrders.filter(o => {
                return isSameTable(o.table_id, tableName) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status);
            });

            const updates = [];
            for (const ord of tableOrders) {
                if (newStatus === 'cooking' && ord.status === 'pending') {
                    updates.push(updateDoc(doc(db, "orders", ord.id), { status: 'cooking' }));
                } else if (newStatus === 'done' && (ord.status === 'pending' || ord.status === 'cooking')) {
                    updates.push(updateDoc(doc(db, "orders", ord.id), { status: 'done' }));
                }
            }
            try {
                await Promise.all(updates);
                showAdminToast(`Đã chuyển bàn ${tableName} sang: ${newStatus === 'cooking' ? 'Đang nấu' : 'Hoàn thành'}`, 'success');
            } catch (err) {
                console.error("Lỗi cập nhật trạng thái đơn: ", err);
                alert("Không thể chuyển trạng thái đơn hàng (Lỗi quyền Firebase 403 Forbidden). Hãy cập nhật Rules trên Firebase Console theo hướng dẫn!");
            }
        };

        let currentCheckoutTable = null;
        let currentCheckoutGrandTotal = 0;
        let currentCheckoutSubtotal = 0;
        let currentCheckoutPaymentMethod = '';
        let currentBillAppliedVoucher = null;
        let currentBillOrderItems = [];

        // Bộ nhớ lưu các bàn đang dừng lại ở trạng thái chờ Webhook chuyển khoản (Lưu bền vững qua localStorage)
        const WAITING_TRANSFER_STORAGE_KEY = 'aurora_tables_waiting_transfer_state_v1';
        window.tablesWaitingForTransfer = window.tablesWaitingForTransfer || new Set();
        window.tablesWaitingForTransferAmounts = window.tablesWaitingForTransferAmounts || new Map();

        window.saveWaitingTransferState = function() {
            try {
                const mapObj = {};
                if (window.tablesWaitingForTransfer && window.tablesWaitingForTransferAmounts) {
                    window.tablesWaitingForTransfer.forEach(tableName => {
                        const amt = window.tablesWaitingForTransferAmounts.get(tableName) || 0;
                        mapObj[tableName] = { amount: amt, time: Date.now() };
                    });
                }
                localStorage.setItem(WAITING_TRANSFER_STORAGE_KEY, JSON.stringify(mapObj));
            } catch(e) {
                console.warn("Lỗi lưu trạng thái chờ chuyển khoản:", e);
            }
        };

        window.loadWaitingTransferState = function() {
            try {
                const raw = localStorage.getItem(WAITING_TRANSFER_STORAGE_KEY);
                if (!raw) return;
                const mapObj = JSON.parse(raw);
                const now = Date.now();
                for (const [tName, data] of Object.entries(mapObj)) {
                    // Giữ lại các bàn trong vòng 24 giờ
                    if (data && (now - (data.time || 0) < 24 * 3600 * 1000)) {
                        window.tablesWaitingForTransfer.add(tName);
                        if (data.amount) {
                            window.tablesWaitingForTransferAmounts.set(tName, data.amount);
                        }
                    }
                }
            } catch(e) {
                console.warn("Lỗi đọc trạng thái chờ chuyển khoản:", e);
            }
        };

        // Nạp lại ngay trạng thái chờ chuyển khoản từ localStorage để không bị mất khi F5 / reload trang
        window.loadWaitingTransferState();

        // Helper lấy tên nhân viên / thu ngân đang làm việc
        function getCurrentCashierName() {
            let user = null;
            if (root.AdminAuth && typeof root.AdminAuth.getCurrentUser === 'function') {
                user = root.AdminAuth.getCurrentUser();
            }
            if (!user) {
                try {
                    user = JSON.parse(localStorage.getItem('aurora_current_user') || 'null');
                } catch(e) {}
            }
            if (user) {
                const rawName = user.name || user.displayName || user.username || '';
                if (rawName && rawName.trim()) {
                    return rawName.trim();
                }
            }
            return localStorage.getItem('aurora_staff_name') 
                || localStorage.getItem('aurora_admin_name') 
                || (root.currentStaffName) 
                || 'Quản trị viên';
        }
        window.getCurrentCashierName = getCurrentCashierName;

        // Mở Modal Xem Trước & In Hóa Đơn Thanh Toán
        window.openBillCheckoutModal = async function(tableName) {
            currentCheckoutTable = tableName;
            window.currentCheckoutTable = tableName;
            currentCheckoutPaymentMethod = '';

            // Đảm bảo đưa modal về giao diện xem trước hóa đơn bình thường
            const normalView = document.getElementById('bill-checkout-normal-view');
            const waitingView = document.getElementById('bill-checkout-waiting-view');
            if (normalView) normalView.classList.remove('hidden');
            if (waitingView) waitingView.classList.add('hidden');
            const btnReturn = document.getElementById('btn-return-waiting-transfer');
            if (btnReturn) btnReturn.classList.add('hidden');

            const modalSubtitle = document.getElementById('modal-bill-subtitle');
            if (modalSubtitle) modalSubtitle.innerText = 'Xem trước hóa đơn & hoàn tất phiên';

            // Lọc đúng các đơn của bàn chưa thanh toán (bắt buộc nhân viên/quản lý đối soát thanh toán thủ công)
            const tableOrders = allOrders.filter(o => {
                if (!isSameTable(o.table_id, tableName)) return false;
                return !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status);
            });

            if (tableOrders.length === 0) {
                alert(`Bàn ${tableName} hiện không có đơn hàng nào cần thanh toán!`);
                return;
            }

            const modal = document.getElementById('modal-checkout-bill');
            document.getElementById('modal-bill-title').innerText = `Hóa Đơn Thanh Toán - ${tableName.replace(/^bàn\s+bàn\s+/i, 'Bàn ').trim()}`;
            document.getElementById('bill-table-name').innerText = tableName;
            document.getElementById('bill-preview-table-name').innerText = tableName;

            // Xóa hình thức thanh toán & mã VietQR ban đầu (chỉ sinh khi chọn Chuyển khoản)
            const previewMethodEl = document.getElementById('bill-preview-method');
            if (previewMethodEl) previewMethodEl.innerText = '';
            const printMethodEl = document.getElementById('bill-print-method');
            if (printMethodEl) printMethodEl.innerText = '';

            const previewQrEl = document.getElementById('bill-preview-vietqr-container');
            if (previewQrEl) previewQrEl.innerHTML = '';
            const printQrEl = document.getElementById('bill-print-vietqr-container');
            if (printQrEl) printQrEl.innerHTML = '';

            // Tìm đợt gọi món sớm nhất để lấy chuẩn "Giờ vào" (Check-in time) cố định
            let earliestMillis = null;
            tableOrders.forEach(o => {
                const m = getSafeMillis(o.created_at || o.client_time);
                if (m > 0 && (!earliestMillis || m < earliestMillis)) {
                    earliestMillis = m;
                }
            });

            const checkInDate = earliestMillis ? new Date(earliestMillis) : new Date();
            const checkInTimeStr = checkInDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const checkInDateStr = checkInDate.toLocaleDateString('vi-VN');

            const now = new Date();
            const printTimeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const billCode = `AU${checkInDate.getFullYear().toString().slice(-2)}${(checkInDate.getMonth()+1).toString().padStart(2,'0')}${checkInDate.getDate().toString().padStart(2,'0')}-${tableName}`;

            document.getElementById('bill-code').innerText = '#' + billCode;
            document.getElementById('bill-preview-code').innerText = '#' + billCode;
            document.getElementById('bill-time').innerText = `Vào: ${checkInTimeStr} ${checkInDateStr} | In: ${printTimeStr}`;
            document.getElementById('bill-preview-time').innerText = `Vào: ${checkInTimeStr} | In: ${printTimeStr}`;
            document.getElementById('bill-rounds-count').innerText = tableOrders.length;

            const currentCashierName = getCurrentCashierName();
            const previewCashierEl = document.getElementById('bill-preview-cashier');
            if (previewCashierEl) previewCashierEl.textContent = currentCashierName;
            const printCashierEl = document.getElementById('bill-print-cashier');
            if (printCashierEl) printCashierEl.textContent = currentCashierName;

            const itemsTbody = document.getElementById('bill-items-body');
            const previewItemsTbody = document.getElementById('bill-preview-items-body');
            itemsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 10px; color: #888;">Đang tải danh sách món...</td></tr>';
            previewItemsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-400">Đang tải danh sách món...</td></tr>';

            modal.classList.remove('hidden');

            let grandTotal = 0;
            const aggregatedItems = {};

            for (const ord of tableOrders) {
                // Ưu tiên đọc trực tiếp từ ord.items để tải ngay 0ms và chuẩn xác 100%
                let items = (ord.items && Array.isArray(ord.items) && ord.items.length > 0)
                    ? ord.items
                    : (cachedOrderItemsMap[ord.id] || []);

                if (items.length === 0) {
                    try {
                        const itemSnap = await getDocs(query(collection(db, "order_items"), where("order_id", "==", ord.id)));
                        items = [];
                        itemSnap.forEach(it => items.push(it.data()));
                    } catch(e) {}
                }

                items.forEach(d => {
                    const optKey = d.options_summary || '';
                    const key = optKey ? `${d.dish_name}__${optKey}__${d.price}` : `${d.dish_name}__${d.price}`;
                    if (!aggregatedItems[key]) {
                        aggregatedItems[key] = {
                            name: d.dish_name,
                            options_summary: optKey,
                            selected_options: Array.isArray(d.selected_options) ? d.selected_options : [],
                            base_price: Number(d.base_price) || 0,
                            quantity: 0,
                            price: Number(d.price) || 0,
                            notes: []
                        };
                    }
                    aggregatedItems[key].quantity += (Number(d.quantity) || 1);
                    if (d.note) aggregatedItems[key].notes.push(d.note);
                });
            }

            // Tính grandTotal chính xác tuyệt đối từ danh sách món thực tế của bàn
            let calculatedTotal = 0;
            for (const key in aggregatedItems) {
                calculatedTotal += aggregatedItems[key].price * aggregatedItems[key].quantity;
            }
            if (calculatedTotal > 0) {
                grandTotal = calculatedTotal;
            } else {
                grandTotal = tableOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
            }
            currentCheckoutGrandTotal = grandTotal;

            let previewHtml = '';
            let printHtml = '';

            for (const key in aggregatedItems) {
                const item = aggregatedItems[key];
                const totalItemQty = item.quantity;

                // Tách riêng Topping có tính phí và Tùy chọn miễn phí
                let paidToppings = [];
                let freeOptions = [];

                if (Array.isArray(item.selected_options) && item.selected_options.length > 0) {
                    item.selected_options.forEach(opt => {
                        const p = Number(opt.price) || 0;
                        const optName = String(opt.item_name || '').replace(/^[+•]\s*/, '').trim();
                        if (p > 0) {
                            paidToppings.push({ name: optName, price: p });
                        } else {
                            freeOptions.push(optName);
                        }
                    });
                } else if (item.options_summary) {
                    const lines = item.options_summary.includes('\n') ? item.options_summary.split('\n') : item.options_summary.split(', ');
                    const priceRegex = /^(.*?)\s*\(\+([0-9.,]+)\s*(?:VNĐ|đ|d)?\)/i;
                    lines.forEach(raw => {
                        const clean = raw.replace(/^[+•]\s*/, '').trim();
                        if (!clean) return;
                        const match = clean.match(priceRegex);
                        if (match) {
                            const optName = match[1].trim();
                            const priceNum = Number(match[2].replace(/[.,]/g, '')) || 0;
                            if (priceNum > 0) {
                                paidToppings.push({ name: optName, price: priceNum });
                            } else {
                                freeOptions.push(optName);
                            }
                        } else {
                            freeOptions.push(clean);
                        }
                    });
                }

                const paidToppingsSum = paidToppings.reduce((sum, pt) => sum + pt.price, 0);
                const dishBasePrice = (item.base_price > 0) ? item.base_price : Math.max(0, item.price - paidToppingsSum);
                const dishLineTotal = dishBasePrice * totalItemQty;

                const freeOptStr = freeOptions.length > 0 ? `<div class="mt-0.5 space-y-0.5">${freeOptions.map(fo => `<span class="text-[9.5px] text-gray-500 font-medium block pl-3">• ${escapeHtml(fo)}</span>`).join('')}</div>` : '';
                const printFreeOptStr = freeOptions.length > 0 ? freeOptions.map(fo => `<div style="font-size: 7.5px; color: #555; padding-left: 6px;">• ${escapeHtml(fo)}</div>`).join('') : '';

                const safeNotes = item.notes.map(n => escapeHtml(n)).join(', ');
                const noteStr = item.notes.length > 0 ? `<div class="text-[9px] text-amber-600 italic pl-3 mt-0.5">(${safeNotes})</div>` : '';
                const printNoteStr = item.notes.length > 0 ? `<div style="font-size: 8px; color: #555; font-style: italic; padding-left: 6px;">(${safeNotes})</div>` : '';

                // Dòng món chính (Giá gốc)
                const safeItemName = escapeHtml(item.name);
                previewHtml += `
                    <tr class="border-b border-gray-100">
                        <td class="py-1.5 pr-2">
                            <span class="font-bold text-gray-800">${safeItemName}</span>
                            ${freeOptStr}
                            ${noteStr}
                        </td>
                        <td class="py-1.5 text-center font-bold text-gray-900">${totalItemQty}</td>
                        <td class="py-1.5 pr-3 text-right text-gray-500">${Number(dishBasePrice).toLocaleString('vi-VN')}</td>
                        <td class="py-1.5 pl-1 text-right font-bold text-gray-900">${Number(dishLineTotal).toLocaleString('vi-VN')}</td>
                    </tr>
                `;

                printHtml += `
                    <tr style="border-bottom: 1px dashed #eee;">
                        <td style="width: 42%; padding: 3px 4px 3px 0; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: break-word;">
                            <strong>${safeItemName}</strong>
                            ${printFreeOptStr}
                            ${printNoteStr}
                        </td>
                        <td style="width: 10%; padding: 3px 2px; text-align: center; vertical-align: top; font-weight: bold;">${totalItemQty}</td>
                        <td style="width: 24%; padding: 3px 12px 3px 0; text-align: right; vertical-align: top; white-space: nowrap;">${Number(dishBasePrice).toLocaleString('vi-VN')}</td>
                        <td style="width: 24%; padding: 3px 0 3px 4px; text-align: right; vertical-align: top; font-weight: bold; white-space: nowrap;">${Number(dishLineTotal).toLocaleString('vi-VN')}</td>
                    </tr>
                `;

                // Từng dòng Topping tính phí riêng biệt kèm Đơn giá
                paidToppings.forEach(pt => {
                    const ptTotal = pt.price * totalItemQty;
                    previewHtml += `
                        <tr class="border-b border-gray-50 bg-amber-50/20">
                            <td class="py-1 pl-4 text-gray-700 text-xs">
                                <span class="text-amber-700 font-bold">+</span> ${pt.name}
                            </td>
                            <td class="py-1 text-center font-bold text-gray-600 text-xs">${totalItemQty}</td>
                            <td class="py-1 pr-3 text-right text-gray-500 text-xs">${Number(pt.price).toLocaleString('vi-VN')}</td>
                            <td class="py-1 pl-1 text-right font-bold text-gray-800 text-xs">${Number(ptTotal).toLocaleString('vi-VN')}</td>
                        </tr>
                    `;

                    printHtml += `
                        <tr style="border-bottom: 1px dashed #f0f0f0;">
                            <td style="width: 42%; padding: 2px 4px 2px 8px; text-align: left; vertical-align: top; font-size: 8.5px; color: #333;">
                                + ${pt.name}
                            </td>
                            <td style="width: 10%; padding: 2px; text-align: center; vertical-align: top; font-size: 8.5px;">${totalItemQty}</td>
                            <td style="width: 24%; padding: 2px 12px 2px 0; text-align: right; vertical-align: top; font-size: 8.5px; white-space: nowrap;">${Number(pt.price).toLocaleString('vi-VN')}</td>
                            <td style="width: 24%; padding: 2px 0 2px 4px; text-align: right; vertical-align: top; font-weight: bold; font-size: 8.5px; white-space: nowrap;">${Number(ptTotal).toLocaleString('vi-VN')}</td>
                        </tr>
                    `;
                });
            }

            previewItemsTbody.innerHTML = previewHtml;
            itemsTbody.innerHTML = printHtml;

            currentCheckoutSubtotal = grandTotal;
            currentCheckoutGrandTotal = grandTotal;
            currentBillOrderItems = Object.values(aggregatedItems);

            const cleanT = (typeof normalizeTableCode === 'function')
                ? normalizeTableCode(tableName)
                : String(tableName || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();

            // Khôi phục voucher đã lưu của bàn (SSOT chống mất voucher khi thoát modal)
            let savedVoucher = tableVouchers[cleanT] || null;
            if (savedVoucher) {
                const sCode = (savedVoucher.code || savedVoucher.id || '').toUpperCase();
                // Kiểm tra trực tiếp xem voucher đã bị dùng thanh toán chưa
                try {
                    const vSnap = await getDoc(doc(db, "voucher_codes", sCode));
                    if (vSnap.exists()) {
                        const vData = vSnap.data();
                        if (vData.status === 'used') {
                            // Mã đã sử dụng -> tự động gỡ sạch, không áp dụng vào bàn mới
                            savedVoucher = null;
                            delete tableVouchers[cleanT];
                            setDoc(doc(db, "tables", cleanT), { applied_voucher: null, updated_at: serverTimestamp() }, { merge: true }).catch(() => {});
                        }
                    }
                } catch(e) {}
            }
            currentBillAppliedVoucher = savedVoucher;
            if (currentBillAppliedVoucher && !currentBillAppliedVoucher.code) {
                currentBillAppliedVoucher.code = currentBillAppliedVoucher.id || '';
            }

            const vInput = document.getElementById('bill-voucher-input');
            const errInfo = document.getElementById('bill-voucher-error-info');
            const vStatus = document.getElementById('bill-voucher-status');
            const vDesc = document.getElementById('bill-voucher-desc');
            const vAppliedInfo = document.getElementById('bill-voucher-applied-info');
            const vApplyBtn = document.getElementById('btn-apply-voucher');
            const vCancelBtn = document.getElementById('btn-cancel-voucher');

            if (errInfo) { errInfo.textContent = ''; errInfo.classList.add('hidden'); }
            if (vStatus) { vStatus.textContent = ''; vStatus.classList.add('hidden'); }
            if (vDesc) { vDesc.textContent = ''; vDesc.classList.add('hidden'); }

            if (savedVoucher) {
                if (vInput) vInput.value = savedVoucher.code || savedVoucher.id || '';
                if (vAppliedInfo) {
                    const discountAmt = savedVoucher.discountAmount || savedVoucher.discount_amount || 0;
                    vAppliedInfo.textContent = `Đã áp dụng giảm: ${formatMoney(discountAmt)}`;
                    vAppliedInfo.classList.remove('hidden');
                }
                if (vApplyBtn) vApplyBtn.classList.add('hidden');
                if (vCancelBtn) vCancelBtn.classList.remove('hidden');
            } else {
                if (vInput) vInput.value = '';
                if (vAppliedInfo) { vAppliedInfo.textContent = ''; vAppliedInfo.classList.add('hidden'); }
                if (vApplyBtn) vApplyBtn.classList.remove('hidden');
                if (vCancelBtn) vCancelBtn.classList.add('hidden');
            }

            // Render customer loyalty card for this table
            if (root.AdminLoyalty && typeof root.AdminLoyalty.renderLoyaltyCardInBill === 'function') {
                root.AdminLoyalty.renderLoyaltyCardInBill(tableName);
            }
            if (root.AdminLoyalty && typeof root.AdminLoyalty.refreshCustomerDataForTable === 'function') {
                root.AdminLoyalty.refreshCustomerDataForTable(tableName);
            }

            // Update bill calculations
            updateBillCalculations();

            // Nạp trước (Preload) ảnh VietQR vào bộ nhớ đệm trình duyệt ngay khi mở xem trước
            // để ảnh có sẵn 100% trong cache, khi thu ngân chọn "Chuyển khoản" là in được ngay lần đầu tiên
            if (grandTotal > 0 && typeof getVietQrUrl === 'function') {
                const preloadImg = new Image();
                preloadImg.src = getVietQrUrl(grandTotal, tableName);
            }
        };

        window.applyVoucherInBill = async function() {
            const input = document.getElementById('bill-voucher-input');
            const code = (input ? input.value : '').trim().toUpperCase();
            const errInfo = document.getElementById('bill-voucher-error-info');
            const vAppliedInfo = document.getElementById('bill-voucher-applied-info');
            if (errInfo) { errInfo.textContent = ''; errInfo.classList.add('hidden'); }
            if (vAppliedInfo) { vAppliedInfo.textContent = ''; vAppliedInfo.classList.add('hidden'); }

            if (!code) {
                if (errInfo) {
                    errInfo.textContent = 'Vui lòng nhập mã voucher';
                    errInfo.classList.remove('hidden');
                }
                showAdminToast('Vui lòng nhập mã voucher', 'error');
                return;
            }

            if (!root.AdminVoucher || typeof root.AdminVoucher.applyVoucherToBill !== 'function') {
                showAdminToast('Hệ thống voucher chưa sẵn sàng', 'error');
                return;
            }

            const res = await root.AdminVoucher.applyVoucherToBill(code, currentCheckoutSubtotal, currentBillOrderItems, currentCheckoutTable);
            if (!res.success) {
                if (errInfo) {
                    errInfo.textContent = res.message || 'Mã voucher không tồn tại hoặc đã được sử dụng!';
                    errInfo.classList.remove('hidden');
                }
                showAdminToast(res.message, 'error');
                return;
            }

            const rawV = (res && res.voucher) ? res.voucher : (res || {});
            const vCode = String(res.code || rawV.code || rawV.id || '').trim().toUpperCase();
            const vId = String(rawV.id || res.id || vCode).trim().toUpperCase();
            const vType = String(rawV.type || rawV.discount_type || res.type || 'fixed').toLowerCase();
            const vValue = Number(rawV.value !== undefined ? rawV.value : (rawV.discount_value !== undefined ? rawV.discount_value : (res.value !== undefined ? res.value : 0))) || 0;
            const vDiscountAmt = Number(res.discountAmount !== undefined ? res.discountAmount : (rawV.discount_amount !== undefined ? rawV.discount_amount : 0)) || 0;
            const vMinBill = Number(rawV.min_bill !== undefined ? rawV.min_bill : (rawV.min_order_value !== undefined ? rawV.min_order_value : 0)) || 0;
            const vMaxDiscount = Number(rawV.max_discount || 0);
            const vCampaignId = String(rawV.campaign_id || res.campaignId || '').trim();
            const vCampaignName = String(rawV.campaign_name || res.campaignName || '').trim();
            const vDishId = String(rawV.specific_dish_id || '').trim();
            const vDishName = String(rawV.specific_dish_name || '').trim();

            const voucherPayload = {
                id: vId,
                code: vCode,
                campaign_id: vCampaignId,
                campaign_name: vCampaignName,
                type: vType,
                discount_type: vType,
                value: vValue,
                discount_value: vValue,
                discount_amount: vDiscountAmt,
                min_bill: vMinBill,
                max_discount: vMaxDiscount,
                specific_dish_id: vDishId,
                specific_dish_name: vDishName,
                status: 'applied'
            };

            Object.assign(res, voucherPayload);
            currentBillAppliedVoucher = res;
            const cleanT = (typeof normalizeTableCode === 'function')
                ? normalizeTableCode(currentCheckoutTable)
                : String(currentCheckoutTable || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
            tableVouchers[cleanT] = res;

            // Đồng bộ lưu voucher vào Firestore tables/{cleanT}
            try {
                setDoc(doc(db, "tables", cleanT), {
                    applied_voucher: voucherPayload,
                    updated_at: serverTimestamp()
                }, { merge: true });
            } catch (eVoucher) {
                console.warn("Lỗi lưu applied_voucher vào Firestore tables:", eVoucher);
            }

            const vStatus = document.getElementById('bill-voucher-status');
            if (vStatus) { vStatus.textContent = ''; vStatus.classList.add('hidden'); }
            const vDesc = document.getElementById('bill-voucher-desc');
            if (vDesc) { vDesc.textContent = ''; vDesc.classList.add('hidden'); }
            if (vAppliedInfo) {
                vAppliedInfo.textContent = `Đã áp dụng giảm: ${formatMoney(res.discountAmount)}`;
                vAppliedInfo.classList.remove('hidden');
            }
            if (errInfo) {
                errInfo.textContent = '';
                errInfo.classList.add('hidden');
            }
            const vApplyBtn = document.getElementById('btn-apply-voucher');
            if (vApplyBtn) vApplyBtn.classList.add('hidden');
            const vCancelBtn = document.getElementById('btn-cancel-voucher');
            if (vCancelBtn) vCancelBtn.classList.remove('hidden');

            updateBillCalculations();
            showAdminToast(res.message, 'success');
        };

        window.cancelVoucherInBill = function() {
            const cleanT = (typeof normalizeTableCode === 'function')
                ? normalizeTableCode(currentCheckoutTable)
                : String(currentCheckoutTable || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
            const voucherCode = currentBillAppliedVoucher ? (currentBillAppliedVoucher.code || currentBillAppliedVoucher.id) : '';

            currentBillAppliedVoucher = null;
            delete tableVouchers[cleanT];

            // Trả voucher về available trong kho và xóa khỏi tables document
            try {
                setDoc(doc(db, "tables", cleanT), {
                    applied_voucher: null,
                    updated_at: serverTimestamp()
                }, { merge: true });

                if (voucherCode) {
                    if (root.AdminVoucher && typeof root.AdminVoucher.releaseVoucherCode === 'function') {
                        root.AdminVoucher.releaseVoucherCode(voucherCode);
                    }
                }
            } catch (eCancel) {
                console.warn("Lỗi hủy voucher trên Firestore:", eCancel);
            }

            const input = document.getElementById('bill-voucher-input');
            if (input) input.value = '';
            const errInfo = document.getElementById('bill-voucher-error-info');
            if (errInfo) { errInfo.textContent = ''; errInfo.classList.add('hidden'); }
            const vStatus = document.getElementById('bill-voucher-status');
            if (vStatus) { vStatus.textContent = ''; vStatus.classList.add('hidden'); }
            const vDesc = document.getElementById('bill-voucher-desc');
            if (vDesc) { vDesc.textContent = ''; vDesc.classList.add('hidden'); }
            const vAppliedInfo = document.getElementById('bill-voucher-applied-info');
            if (vAppliedInfo) { vAppliedInfo.textContent = ''; vAppliedInfo.classList.add('hidden'); }
            const vApplyBtn = document.getElementById('btn-apply-voucher');
            if (vApplyBtn) vApplyBtn.classList.remove('hidden');
            const vCancelBtn = document.getElementById('btn-cancel-voucher');
            if (vCancelBtn) vCancelBtn.classList.add('hidden');

            updateBillCalculations();
            showAdminToast('Đã hủy áp dụng voucher', 'info');
        };

        window.updateBillCalculations = function() {
            const subtotal = currentCheckoutSubtotal || 0;
            let voucherDiscount = 0;

            if (currentBillAppliedVoucher) {
                // 1. Kiểm tra nếu có sẵn discountAmount hoặc discount_amount
                const directAmt = Number(currentBillAppliedVoucher.discountAmount !== undefined ? currentBillAppliedVoucher.discountAmount : currentBillAppliedVoucher.discount_amount);
                if (!isNaN(directAmt) && directAmt > 0) {
                    voucherDiscount = Math.min(subtotal, directAmt);
                } else if (root.VoucherEngine && (typeof root.VoucherEngine.calculateDiscount === 'function' || typeof root.VoucherEngine.validateVoucher === 'function')) {
                    // 2. Tính toán chuẩn xác qua VoucherEngine (hỗ trợ cả fixed, percent, dish)
                    const evalFn = root.VoucherEngine.calculateDiscount || root.VoucherEngine.validateVoucher;
                    const calcRes = evalFn.call(root.VoucherEngine, currentBillAppliedVoucher, subtotal, currentBillOrderItems);
                    if (calcRes && calcRes.valid && calcRes.discountAmount > 0) {
                        voucherDiscount = calcRes.discountAmount;
                        currentBillAppliedVoucher.discountAmount = voucherDiscount;
                    }
                } else {
                    // 3. Fallback tự động tính dựa trên cấu hình voucher
                    const vType = String(currentBillAppliedVoucher.type || currentBillAppliedVoucher.discount_type || 'fixed').toLowerCase();
                    const vVal = Number(currentBillAppliedVoucher.value !== undefined ? currentBillAppliedVoucher.value : currentBillAppliedVoucher.discount_value) || 0;
                    const minB = Number(currentBillAppliedVoucher.min_bill || currentBillAppliedVoucher.min_order_value || 0);
                    if (subtotal >= minB) {
                        if (vType === 'fixed') {
                            voucherDiscount = Math.min(subtotal, vVal);
                        } else if (vType === 'percent') {
                            const raw = Math.round((subtotal * vVal) / 100);
                            const maxD = Number(currentBillAppliedVoucher.max_discount) || 0;
                            voucherDiscount = (maxD > 0) ? Math.min(raw, maxD) : raw;
                        } else if (vType === 'dish') {
                            const targetDishId = String(currentBillAppliedVoucher.specific_dish_id || '').trim();
                            const targetDishName = String(currentBillAppliedVoucher.specific_dish_name || '').trim().toLowerCase();
                            const foundItem = Array.isArray(currentBillOrderItems) ? currentBillOrderItems.find(it => {
                                const itId = String(it.dish_id || it.id || '').trim();
                                const itName = String(it.dish_name || it.name || '').trim().toLowerCase();
                                return (targetDishId && itId === targetDishId) || (targetDishName && itName === targetDishName);
                            }) : null;
                            if (foundItem) {
                                voucherDiscount = Math.min(subtotal, Number(foundItem.price) || 0);
                            }
                        }
                    }
                    currentBillAppliedVoucher.discountAmount = voucherDiscount;
                }
            }

            const remainingAfterVoucher = Math.max(0, subtotal - voucherDiscount);
            let pointsDiscount = 0;
            if (root.AdminLoyalty && typeof root.AdminLoyalty.calculatePointsDeduction === 'function') {
                pointsDiscount = root.AdminLoyalty.calculatePointsDeduction(currentCheckoutTable, remainingAfterVoucher);
            }

            const finalTotal = Math.max(0, remainingAfterVoucher - pointsDiscount);
            currentCheckoutGrandTotal = finalTotal;

            const vRow = document.getElementById('bill-preview-voucher-row');
            const vDiscountEl = document.getElementById('bill-preview-voucher-discount');
            if (vRow && vDiscountEl) {
                if (voucherDiscount > 0) {
                    vRow.classList.remove('hidden');
                    vDiscountEl.textContent = `-${formatMoney(voucherDiscount)}`;
                } else {
                    vRow.classList.add('hidden');
                }
            }

            const pRow = document.getElementById('bill-preview-points-row');
            const pDiscountEl = document.getElementById('bill-preview-points-discount');
            if (pRow && pDiscountEl) {
                if (pointsDiscount > 0) {
                    pRow.classList.remove('hidden');
                    pDiscountEl.textContent = `-${formatMoney(pointsDiscount)}`;
                } else {
                    pRow.classList.add('hidden');
                }
            }

            const grandEl = document.getElementById('bill-preview-grand-total');
            if (grandEl) grandEl.textContent = formatMoney(finalTotal);
            const subEl = document.getElementById('bill-preview-subtotal');
            if (subEl) subEl.textContent = formatMoney(subtotal);

            // Cập nhật Bản in nhiệt chính xác: Tiền hàng, Voucher và Trừ điểm
            const ptSubEl = document.getElementById('bill-subtotal');
            if (ptSubEl) ptSubEl.textContent = formatMoney(subtotal);
            const ptGrandEl = document.getElementById('bill-grand-total');
            if (ptGrandEl) ptGrandEl.textContent = formatMoney(finalTotal);

            const ptVoucherRow = document.getElementById('bill-print-voucher-row');
            const ptVoucherDiscountEl = document.getElementById('bill-print-voucher-discount');
            if (ptVoucherRow && ptVoucherDiscountEl) {
                if (voucherDiscount > 0 && currentBillAppliedVoucher) {
                    ptVoucherRow.style.display = 'flex';
                    ptVoucherDiscountEl.textContent = `-${formatMoney(voucherDiscount)}`;
                } else {
                    ptVoucherRow.style.display = 'none';
                }
            }

            const ptPointsRow = document.getElementById('bill-print-points-row');
            const ptPointsDiscountEl = document.getElementById('bill-print-points-discount');
            if (ptPointsRow && ptPointsDiscountEl) {
                if (pointsDiscount > 0) {
                    ptPointsRow.style.display = 'flex';
                    ptPointsDiscountEl.textContent = `-${formatMoney(pointsDiscount)}`;
                } else {
                    ptPointsRow.style.display = 'none';
                }
            }

            // Cập nhật thông tin voucher ở thanh công cụ đầu bill (chỉ 1 dòng xanh lá ngắn gọn)
            const topVoucherInfo = document.getElementById('bill-voucher-applied-info');
            if (topVoucherInfo) {
                if (currentBillAppliedVoucher && voucherDiscount > 0) {
                    topVoucherInfo.classList.remove('hidden');
                    topVoucherInfo.textContent = `Đã áp dụng giảm: ${formatMoney(voucherDiscount)}`;
                } else {
                    topVoucherInfo.classList.add('hidden');
                    topVoucherInfo.textContent = '';
                }
            }

            // Đồng bộ hiển thị tên khách hàng trên bill (dưới Mã HĐ)
            let custForBill = null;
            if (root.AdminLoyalty && typeof root.AdminLoyalty.getCustomerForTable === 'function') {
                custForBill = root.AdminLoyalty.getCustomerForTable(currentCheckoutTable);
            }
            const custPrevRow = document.getElementById('bill-preview-customer-row');
            const custPrevName = document.getElementById('bill-preview-customer-name');
            if (custPrevRow && custPrevName) {
                if (custForBill && (custForBill.name || custForBill.phone)) {
                    custPrevRow.classList.remove('hidden');
                    custPrevName.textContent = custForBill.name || custForBill.phone;
                } else {
                    custPrevRow.classList.add('hidden');
                    custPrevName.textContent = '';
                }
            }
            const custPrintRow = document.getElementById('bill-print-customer-row');
            const custPrintName = document.getElementById('bill-print-customer-name');
            if (custPrintRow && custPrintName) {
                if (custForBill && (custForBill.name || custForBill.phone)) {
                    custPrintRow.style.display = 'flex';
                    custPrintName.textContent = custForBill.name || custForBill.phone;
                } else {
                    custPrintRow.style.display = 'none';
                    custPrintName.textContent = '';
                }
            }

            // Đồng bộ trạng thái hội viên trên thanh công cụ đầu bill
            if (root.AdminLoyalty && typeof root.AdminLoyalty.updateCustomerTopBarBadge === 'function') {
                root.AdminLoyalty.updateCustomerTopBarBadge(currentCheckoutTable);
            }

            // Giữ hóa đơn xem trước luôn sạch sẽ, không chèn card VietQR web vào tờ bill
            const previewQrEl = document.getElementById('bill-preview-vietqr-container');
            if (previewQrEl) previewQrEl.innerHTML = '';
        };

        window.closeBillCheckoutModal = function() {
            const modal = document.getElementById('modal-checkout-bill');
            if (modal) modal.classList.add('hidden');

            // Trả lại trạng thái bình thường cho normal view
            const normalView = document.getElementById('bill-checkout-normal-view');
            const waitingView = document.getElementById('bill-checkout-waiting-view');
            if (normalView) normalView.classList.remove('hidden');
            if (waitingView) waitingView.classList.add('hidden');

            const modalTitle = document.getElementById('modal-bill-title');
            if (modalTitle) modalTitle.innerText = 'Hóa Đơn Thanh Toán';
            const modalSubtitle = document.getElementById('modal-bill-subtitle');
            if (modalSubtitle) modalSubtitle.innerText = 'Xem trước hóa đơn & hoàn tất phiên';

            const previewQrEl = document.getElementById('bill-preview-vietqr-container');
            if (previewQrEl) previewQrEl.innerHTML = '';
            const printQrEl = document.getElementById('bill-print-vietqr-container');
            if (printQrEl) printQrEl.innerHTML = '';
            const previewMethodEl = document.getElementById('bill-preview-method');
            if (previewMethodEl) previewMethodEl.innerText = '';
            const printMethodEl = document.getElementById('bill-print-method');
            if (printMethodEl) printMethodEl.innerText = '';
            const custPrevRow = document.getElementById('bill-preview-customer-row');
            if (custPrevRow) custPrevRow.classList.add('hidden');
            const custPrintRow = document.getElementById('bill-print-customer-row');
            if (custPrintRow) custPrintRow.style.display = 'none';
            const btnReturn = document.getElementById('btn-return-waiting-transfer');
            if (btnReturn) btnReturn.classList.add('hidden');
            closePaymentMethodModal();
            currentCheckoutTable = null;
            window.currentCheckoutTable = null;
            if (root.AdminLoyalty && typeof root.AdminLoyalty.closeCustomerPopup === 'function') {
                root.AdminLoyalty.closeCustomerPopup();
            }
            currentCheckoutGrandTotal = 0;
            currentCheckoutSubtotal = 0;
            currentCheckoutPaymentMethod = '';
            currentBillAppliedVoucher = null;
            currentBillOrderItems = [];
        };

        // Mở popup chọn hình thức thanh toán khi ấn In bill
        window.openPaymentMethodModal = function() {
            if (!currentCheckoutTable) return;
            const tableName = currentCheckoutTable;

            // Nếu bill được trừ 100% bằng điểm tích lũy hoặc voucher -> Hoàn tất thanh toán trực tiếp!
            if (currentCheckoutGrandTotal === 0) {
                if (confirm(`Hóa đơn bàn ${tableName} được khấu trừ 100% (Tổng phải trả: 0 VNĐ). Xác nhận hoàn tất thanh toán và kết bàn?`)) {
                    settleTableOnlyWithMethod('points');
                }
                return;
            }

            const totalStr = formatMoney(currentCheckoutGrandTotal);
            const titleTableEl = document.getElementById('payment-modal-table-name');
            if (titleTableEl) titleTableEl.innerText = tableName;
            const titleTotalEl = document.getElementById('payment-modal-total-amount');
            if (titleTotalEl) titleTotalEl.innerText = totalStr;
            const modal = document.getElementById('modal-select-payment-method');
            if (modal) modal.classList.remove('hidden');
        };

        window.closePaymentMethodModal = function() {
            const modal = document.getElementById('modal-select-payment-method');
            if (modal) modal.classList.add('hidden');
        };

        // Hiển thị màn hình dừng lại ở trạng thái chờ Webhook tự động kết bàn
        window.showWaitingTransferScreen = function(tableName, grandTotal, qrDataUrl = '') {
            currentCheckoutTable = tableName;
            currentCheckoutGrandTotal = grandTotal;
            currentCheckoutPaymentMethod = 'transfer';

            window.tablesWaitingForTransfer.add(tableName);
            window.tablesWaitingForTransferAmounts.set(tableName, grandTotal);
            if (typeof window.saveWaitingTransferState === 'function') {
                window.saveWaitingTransferState();
            }

            // Quét kiểm tra ngay xem có giao dịch vừa về trong vài giây trước không
            if (typeof checkPendingPaymentTransactions === 'function') {
                checkPendingPaymentTransactions();
            }

            const modal = document.getElementById('modal-checkout-bill');
            if (!modal) return;

            // Cập nhật tiêu đề modal
            const modalTitle = document.getElementById('modal-bill-title');
            if (modalTitle) modalTitle.innerText = `Chờ Chuyển Khoản - ${tableName.replace(/^bàn\s+bàn\s+/i, 'Bàn ').trim()}`;
            const modalSubtitle = document.getElementById('modal-bill-subtitle');
            if (modalSubtitle) modalSubtitle.innerText = 'Webhook MB Bank đang tự động lắng nghe (0s)...';

            // Điền dữ liệu vào màn hình chờ
            const cleanTable = tableName.replace(/^(bàn|ban|table)\s*/i, '').trim();
            const memo = `THANH TOAN BAN ${cleanTable || 'AURORA'}`;

            const waitingTableEl = document.getElementById('waiting-bill-table');
            if (waitingTableEl) waitingTableEl.innerText = tableName;
            const waitingAmountEl = document.getElementById('waiting-bill-amount');
            if (waitingAmountEl) waitingAmountEl.innerText = formatMoney(grandTotal);
            const waitingMemoEl = document.getElementById('waiting-bill-memo');
            if (waitingMemoEl) waitingMemoEl.innerText = memo;

            // Render ảnh QR vào container trên màn hình chờ
            const waitingQrContainer = document.getElementById('waiting-bill-qr-container');
            if (waitingQrContainer) {
                const qrSrc = qrDataUrl || (typeof getVietQrUrl === 'function' ? getVietQrUrl(grandTotal, tableName) : '');
                if (qrSrc) {
                    waitingQrContainer.innerHTML = `<img src="${qrSrc}" alt="Mã VietQR" class="w-36 h-36 object-contain rounded-lg">`;
                }
            }

            // Reset badge trạng thái về màu xanh dương chờ giao dịch
            const waitingStatusBadge = document.getElementById('waiting-bill-status-badge');
            if (waitingStatusBadge) {
                waitingStatusBadge.className = 'p-2.5 rounded-xl bg-blue-500/10 border border-blue-200 text-center space-y-1';
                waitingStatusBadge.innerHTML = `
                    <div class="flex items-center justify-center gap-2 text-blue-800 font-bold text-xs">
                        <i class="fa-solid fa-rotate fa-spin text-blue-600 text-[11px]"></i>
                        <span>Đang chờ thông tin tiền về từ SePay Webhook...</span>
                    </div>
                    <p class="text-[10px] text-gray-500">Khi tiền vào tài khoản MB Bank, hệ thống sẽ phát chuông Ting-Ting và tự động kết bàn!</p>
                `;
            }

            // Ẩn view hóa đơn thường, hiện view chờ
            const normalView = document.getElementById('bill-checkout-normal-view');
            const waitingView = document.getElementById('bill-checkout-waiting-view');
            if (normalView) normalView.classList.add('hidden');
            if (waitingView) waitingView.classList.remove('hidden');

            modal.classList.remove('hidden');

            // Cập nhật lại sơ đồ bàn để hiện huy hiệu chờ chuyển khoản
            if (typeof scheduleRenderTableBoard === 'function') {
                scheduleRenderTableBoard();
            }
        };

        // Chuyển sang thanh toán tiền mặt và kết bàn ngay khi khách đổi ý
        window.switchWaitingToCashSettle = async function() {
            if (!currentCheckoutTable) return;
            const tableName = currentCheckoutTable;
            if (confirm(`Khách đổi sang trả Tiền mặt. Xác nhận kết bàn ngay cho ${tableName}?`)) {
                if (window.tablesWaitingForTransfer) window.tablesWaitingForTransfer.delete(tableName);
                if (window.tablesWaitingForTransferAmounts) window.tablesWaitingForTransferAmounts.delete(tableName);
                if (typeof window.saveWaitingTransferState === 'function') window.saveWaitingTransferState();
                const ok = await executeTableSettle(tableName, 'cash');
                if (ok) {
                    closeBillCheckoutModal();
                    showAdminToast(`Bàn ${tableName} đã thanh toán TIỀN MẶT và kết bàn thành công!`, 'success');
                    if (typeof scheduleRenderTableBoard === 'function') scheduleRenderTableBoard();
                }
            }
        };

        // Thu nhỏ màn hình chờ để quản lý các bàn khác trong khi Webhook vẫn lắng nghe ngầm
        window.minimizeWaitingScreen = function() {
            const modal = document.getElementById('modal-checkout-bill');
            if (modal) modal.classList.add('hidden');
            showAdminToast(`⏳ Bàn ${currentCheckoutTable} đang ở chế độ chờ chuyển khoản. Hệ thống vẫn lắng nghe Webhook tự động!`, 'info');
        };

        // Chuyển đổi qua lại giữa xem lại chi tiết bill và màn hình chờ
        window.toggleReceiptFromWaiting = function() {
            const normalView = document.getElementById('bill-checkout-normal-view');
            const waitingView = document.getElementById('bill-checkout-waiting-view');
            if (!normalView || !waitingView) return;

            if (waitingView.classList.contains('hidden')) {
                // Đang ở normal view -> chuyển sang waiting view
                normalView.classList.add('hidden');
                waitingView.classList.remove('hidden');
                const btnReturn = document.getElementById('btn-return-waiting-transfer');
                if (btnReturn) btnReturn.classList.add('hidden');
                const modalTitle = document.getElementById('modal-bill-title');
                if (modalTitle && currentCheckoutTable) modalTitle.innerText = `Chờ Chuyển Khoản - ${currentCheckoutTable.replace(/^bàn\s+bàn\s+/i, 'Bàn ').trim()}`;
                const modalSubtitle = document.getElementById('modal-bill-subtitle');
                if (modalSubtitle) modalSubtitle.innerText = 'Webhook MB Bank đang tự động lắng nghe (0s)...';
            } else {
                // Đang ở waiting view -> chuyển sang normal view
                waitingView.classList.add('hidden');
                normalView.classList.remove('hidden');
                const btnReturn = document.getElementById('btn-return-waiting-transfer');
                if (btnReturn) btnReturn.classList.remove('hidden');
                const modalTitle = document.getElementById('modal-bill-title');
                if (modalTitle && currentCheckoutTable) modalTitle.innerText = `Hóa Đơn Thanh Toán - ${currentCheckoutTable.replace(/^bàn\s+bàn\s+/i, 'Bàn ').trim()}`;
                const modalSubtitle = document.getElementById('modal-bill-subtitle');
                if (modalSubtitle) modalSubtitle.innerText = 'Xem trước hóa đơn & hoàn tất phiên';
            }
        };

        // Mở trực tiếp màn hình chờ chuyển khoản của bàn
        window.openWaitingTransferScreen = async function(tableName) {
            await openBillCheckoutModal(tableName);
            let qrDataUrl = '';
            if (currentCheckoutGrandTotal > 0 && typeof getVietQrDataUrl === 'function') {
                qrDataUrl = await getVietQrDataUrl(currentCheckoutGrandTotal, tableName, 160);
            }
            showWaitingTransferScreen(tableName, currentCheckoutGrandTotal, qrDataUrl);
        };

        // Xác nhận hình thức thanh toán ('cash' | 'transfer') và in hóa đơn nhiệt
        window.confirmAndPrintBill = async function(method) {
            if (!currentCheckoutTable) return;
            const tableName = currentCheckoutTable;
            currentCheckoutPaymentMethod = method;
            const btnReturn = document.getElementById('btn-return-waiting-transfer');
            if (btnReturn) btnReturn.classList.add('hidden');
            closePaymentMethodModal();

            const isTransfer = (method === 'transfer');
            const methodLabel = isTransfer ? 'Chuyển khoản' : 'Tiền mặt';

            // 1. Cập nhật nhãn hình thức thanh toán & Thu ngân trên hóa đơn xem trước và hóa đơn in nhiệt
            const previewMethodEl = document.getElementById('bill-preview-method');
            if (previewMethodEl) previewMethodEl.innerText = methodLabel;
            const printMethodEl = document.getElementById('bill-print-method');
            if (printMethodEl) printMethodEl.innerText = methodLabel;

            const currentCashierName = getCurrentCashierName();
            const previewCashierEl = document.getElementById('bill-preview-cashier');
            if (previewCashierEl) previewCashierEl.textContent = currentCashierName;
            const printCashierEl = document.getElementById('bill-print-cashier');
            if (printCashierEl) printCashierEl.textContent = currentCashierName;

            // 2. Chỉ sinh VietQR khi chọn Chuyển khoản
            const previewQrEl = document.getElementById('bill-preview-vietqr-container');
            const printQrEl = document.getElementById('bill-print-vietqr-container');

            let qrDataUrl = '';
            if (isTransfer && currentCheckoutGrandTotal > 0 && typeof renderVietQrHtml === 'function') {
                // TẠO ẢNH QR BASE64 CỤC BỘ (0ms, không phụ thuộc mạng, in được ngay 100% lần đầu tiên)
                if (typeof getVietQrDataUrl === 'function') {
                    qrDataUrl = await getVietQrDataUrl(currentCheckoutGrandTotal, tableName, 160);
                }

                // Tờ bill xem trước luôn giữ định dạng phiếu thanh toán sạch đẹp, không chèn card web
                if (previewQrEl) previewQrEl.innerHTML = '';
                // Bản in giấy nhiệt K80 in mã QR đen trắng chuẩn máy in
                if (printQrEl) printQrEl.innerHTML = renderVietQrHtml(currentCheckoutGrandTotal, tableName, true, qrDataUrl);

                if (window.SepayService && window.SepayService.config.autoCheckEnabled) {
                    window.SepayService.checkTransactions();
                }
            } else {
                if (previewQrEl) previewQrEl.innerHTML = '';
                if (printQrEl) printQrEl.innerHTML = '';
            }

            // 3. Kích hoạt in hóa đơn nhiệt
            const billArea = document.getElementById('bill-print-area');
            billArea.classList.remove('hidden');

            // Chờ 50ms cho trình duyệt render layout và vẽ ảnh hoàn chỉnh vào DOM
            await new Promise(resolve => setTimeout(resolve, 50));

            window.print();
            billArea.classList.add('hidden');

            // 4. Nếu là Chuyển khoản -> DỪNG LẠI Ở TRẠNG THÁI CHỜ ĐỂ WEBHOOK LẤY TT TIỀN VỀ ĐỂ TỰ ĐỘNG KẾT BÀN!
            if (isTransfer) {
                showWaitingTransferScreen(tableName, currentCheckoutGrandTotal, qrDataUrl);
                showAdminToast(`Đã in bill! Đang dừng lại ở trạng thái chờ Webhook lấy tt tiền về để tự động kết bàn...`, 'info');
            } else {
                showAdminToast(`Đã in hóa đơn (${methodLabel}) cho Bàn ${tableName}!`, 'info');
            }
        };

        // Tương thích các nút gọi in bill khác
        window.printBill = window.openPaymentMethodModal;
        window.printBillAndSettle = window.openPaymentMethodModal;

        // 2. Kết bàn trực tiếp (không bắt buộc in giấy)
        window.settleTableOnly = async function() {
            if (!currentCheckoutTable) return;
            const tableName = currentCheckoutTable;
            const defaultMethod = (currentCheckoutGrandTotal === 0) ? 'points' : (currentCheckoutPaymentMethod || 'cash');
            const methodLabel = defaultMethod === 'points' ? 'Điểm tích lũy' : (defaultMethod === 'transfer' ? 'Chuyển khoản' : 'Tiền mặt');
            const confirmMsg = `Xác nhận thanh toán (${methodLabel}) và kết bàn ${tableName}?`;
            if (confirm(confirmMsg)) {
                const ok = await executeTableSettle(tableName, defaultMethod);
                if (ok) {
                    closeBillCheckoutModal();
                    showAdminToast(`Bàn ${tableName} thanh toán thành công!`, 'success');
                }
            }
        };

        window.settleTableOnlyWithMethod = async function(method) {
            if (!currentCheckoutTable) return;
            const tableName = currentCheckoutTable;
            const ok = await executeTableSettle(tableName, method);
            if (ok) {
                closeBillCheckoutModal();
                showAdminToast(`Bàn ${tableName} thanh toán thành công!`, 'success');
            }
        };
        window.settleWithoutPrint = window.settleTableOnly;

        // Thực thi cập nhật Firestore
        async function executeTableSettle(tableName, paymentMethod = null) {
            try {
                // Xóa trạng thái chờ chuyển khoản nếu có
                if (window.tablesWaitingForTransfer) {
                    window.tablesWaitingForTransfer.delete(tableName);
                }
                if (window.tablesWaitingForTransferAmounts) {
                    window.tablesWaitingForTransferAmounts.delete(tableName);
                }
                if (typeof window.saveWaitingTransferState === 'function') {
                    window.saveWaitingTransferState();
                }

                const tableOrders = allOrders.filter(o => {
                    return isSameTable(o.table_id, tableName) && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status);
                });

                // Chống Race Condition & Xung đột đồng thời: Nếu bàn đã được thanh toán hoặc chuyển bởi máy khác
                if (tableOrders.length === 0) {
                    showAdminToast(`⚠️ Bàn ${tableName} hiện không còn đơn hoạt động hoặc đã được thanh toán/chuyển bởi nhân viên khác!`, 'error');
                    closeBillCheckoutModal();
                    if (typeof scheduleRenderTableBoard === 'function') scheduleRenderTableBoard();
                    return false;
                }

                // Chống Race Condition: Kiểm tra nếu bàn vừa nhận thanh toán tự động qua SePay MB Bank
                const alreadyPaidByBank = tableOrders.some(o => o.payment_status === 'paid' || o.payment_method === 'sepay_mb_bank');
                if (alreadyPaidByBank && paymentMethod === 'cash') {
                    alert(`Bàn ${tableName} vừa được hệ thống ghi nhận thanh toán tự động qua Chuyển khoản ngân hàng! Không thể kết bàn bằng Tiền mặt để tránh trùng lặp.`);
                    return false;
                }

                // Xác thực tính hợp lệ tối hậu của voucher trước khi kết bàn (Chống 1 voucher thanh toán 2 bàn)
                const vCode = currentBillAppliedVoucher ? (currentBillAppliedVoucher.code || currentBillAppliedVoucher.id || '').toUpperCase() : '';
                if (vCode && root.AdminVoucher && typeof root.AdminVoucher.verifyVoucherBeforeSettle === 'function') {
                    const vCheck = await root.AdminVoucher.verifyVoucherBeforeSettle(vCode, tableName);
                    if (!vCheck.valid) {
                        alert(`CẢNH BÁO KHÔNG THỂ THANH TOÁN:\n${vCheck.reason}\n\nHệ thống đã tự động gỡ bỏ voucher khỏi Bàn ${tableName} và tính lại hóa đơn theo giá gốc. Vui lòng kiểm tra lại.`);
                        
                        const cleanT = (typeof normalizeTableCode === 'function')
                            ? normalizeTableCode(tableName)
                            : String(tableName || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                        currentBillAppliedVoucher = null;
                        delete tableVouchers[cleanT];
                        try {
                            await setDoc(doc(db, "tables", cleanT), { applied_voucher: null, updated_at: serverTimestamp() }, { merge: true });
                        } catch(e) {}
                        updateBillCalculations();
                        return false;
                    }
                }

                // Cập nhật mã voucher đã dùng nếu có
                if (vCode && root.AdminVoucher) {
                    const currentUser = JSON.parse(localStorage.getItem('aurora_current_user') || '{}');
                    const staffU = currentUser.username || currentUser.name || 'Admin';
                    await root.AdminVoucher.markVoucherAsUsed(vCode, tableOrders[0]?.id, tableName, staffU);
                }

                // Cập nhật tích điểm / trừ điểm hội viên
                if (root.AdminLoyalty && typeof root.AdminLoyalty.finalizeLoyaltyTransaction === 'function') {
                    const subtotal = currentCheckoutSubtotal || 0;
                    const vDiscount = currentBillAppliedVoucher ? (currentBillAppliedVoucher.discountAmount || 0) : 0;
                    const remAfterVoucher = Math.max(0, subtotal - vDiscount);
                    const ptsUsed = root.AdminLoyalty.calculatePointsDeduction(tableName, remAfterVoucher);
                    const netPaid = Math.max(0, remAfterVoucher - ptsUsed);
                    await root.AdminLoyalty.finalizeLoyaltyTransaction(tableName, tableOrders[0]?.id, netPaid, ptsUsed, subtotal);
                }

                // Sử dụng Atomic WriteBatch để kết bàn nguyên tử, loại trừ lỗi phân mảnh dữ liệu
                const batch = writeBatch(db);
                const currentCashier = getCurrentCashierName();
                tableOrders.forEach(ord => {
                    const updateData = { 
                        status: 'settled', 
                        settled_at: serverTimestamp(),
                        settled_by: currentCashier
                    };
                    if (paymentMethod) {
                        updateData.payment_method = paymentMethod;
                    }
                    batch.update(doc(db, "orders", ord.id), updateData);
                });

                const tableRequests = allServiceRequests.filter(s => {
                    return isSameTable(s.table_id, tableName) && s.status === 'pending';
                });

                tableRequests.forEach(req => {
                    batch.update(doc(db, "service_requests", req.id), { status: 'resolved' });
                });

                // Đồng thời giải phóng bàn trên Firestore (trả về trạng thái available, xóa khóa nhân viên, reset tài khoản & voucher)
                const tableObj = allTables.find(t => isSameTable(t.name, tableName) || isSameTable(t.id, tableName));
                const cleanTableId = (tableObj && tableObj.id) ? tableObj.id : (normalizeTableCode(tableName) || tableName.trim().replace(/^Table\s+/i, '').replace(/^Bàn\s+/i, ''));
                const tableDocRef = doc(db, "tables", cleanTableId);
                batch.set(tableDocRef, {
                    status: 'available',
                    transferred_to: deleteField(),
                    transferred_at: deleteField(),
                    assigned_staff_username: null,
                    assigned_staff_name: null,
                    attached_customer: null,
                    applied_voucher: null,
                    use_points: false,
                    current_session_id: null,
                    updated_at: serverTimestamp()
                }, { merge: true });

                await batch.commit();

                if (typeof root.logAuditEvent === 'function') {
                    const methodLabel = paymentMethod === 'cash' ? 'Tiền mặt' : (paymentMethod === 'transfer' ? 'Chuyển khoản' : (paymentMethod === 'points' ? 'Điểm thưởng' : (paymentMethod || 'Không xác định')));
                    const totalStr = (currentCheckoutGrandTotal || 0).toLocaleString('vi-VN') + ' VNĐ';
                    root.logAuditEvent('BILL_SETTLE', 'PAYMENT', `Thanh toán & Kết ${tableName} - Số tiền: ${totalStr} (${methodLabel})`, {
                        table: tableName,
                        amount: currentCheckoutGrandTotal || 0,
                        method: paymentMethod || 'cash',
                        cashier: currentCashier
                    });
                }

                // Chỉ giải phóng cache bộ nhớ cục bộ SAU KHI Firestore batch.commit() thành công
                delete tableVouchers[cleanTableId];
                const cleanT = (typeof normalizeTableCode === 'function')
                    ? normalizeTableCode(tableName)
                    : String(tableName || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                delete tableVouchers[cleanT];
                if (typeof scheduleRenderTableBoard === 'function') {
                    scheduleRenderTableBoard();
                }
                return true;
            } catch (err) {
                console.error("Lỗi kết bàn: ", err);
                const isPermissionError = (err?.code === 'permission-denied') || (err?.message && err.message.includes('permission'));
                if (isPermissionError) {
                    alert("Không thể kết bàn (Lỗi quyền Firebase 403 Forbidden). Vui lòng kiểm tra quyền tài khoản hoặc cập nhật Rules trên Firebase Console!");
                } else {
                    alert(`Không thể kết bàn: ${err?.message || 'Có lỗi xảy ra, vui lòng thử lại!'}`);
                }
                return false;
            }
        }
        window.executeTableSettle = executeTableSettle;

        // Tương thích các nút gọi settleAndResetTable hiện tại
        window.settleAndResetTable = function(tableName) {
            if (window.tablesWaitingForTransfer && window.tablesWaitingForTransfer.has(tableName)) {
                openWaitingTransferScreen(tableName);
            } else {
                openBillCheckoutModal(tableName);
            }
        };

        /* Hệ thống Chuyển bàn / Chuyển đồ đã được tích hợp trực tiếp, đồng bộ toàn diện vào Modal Chi Tiết Bàn */


    // Export public methods to root
    root.allTables = allTables;
    if (typeof window !== 'undefined') window.allTables = allTables;

    const tableMethods = [
        'loadTables', 'listenTablesRealtime', 'getTableMenuUrl', 'loadBaseQrUrlSetting', 'saveBaseQrUrl',
        'renderAllTableQRs', 'openAddTableModal', 'closeAddTableModal', 'saveNewTable',
        'deleteTable', 'downloadQR', 'printAllQRs', 'openAutoTablesModal',
        'closeAutoTablesModal', 'executeAutoGenerateTables', 'showTableQRModal',
        'closeTableQRModal', 'printSingleTableQR', 'setTableFilter', 'renderTableBoard',
        'applyOptimalGrid', 'toggleFullscreenBoard', 'scheduleRenderTableBoard',
        'resolveTableService', 'closeTableDetailModal', 'promptCancelOrder',
        'cancelOrder', 'promptCancelSingleDish', 'executeCancelSingleDish', 'goToTdStep', 'handleTdBackStep', 'openTableDetail',
        'renderTableDetailOrderActions', 'renderTdTargetGrid', 'selectTdTarget',
        'updateTdTargetPreview', 'initSplitTransferWorkbench', 'renderSplitWorkbench',
        'moveSingleItemToTarget', 'moveSingleItemBackToSource', 'moveAllSplitItemsToTarget',
        'returnAllSplitItemsToSource', 'commitSplitTransferWorkbench', 'openTableTransferModal',
        'closeTableTransferModal', 'submitTableTransfer', 'quickUpdateTableOrders',
        'saveWaitingTransferState', 'loadWaitingTransferState', 'openBillCheckoutModal',
        'closeBillCheckoutModal', 'openPaymentMethodModal', 'closePaymentMethodModal',
        'showWaitingTransferScreen', 'switchWaitingToCashSettle', 'minimizeWaitingScreen',
        'toggleReceiptFromWaiting', 'openWaitingTransferScreen', 'confirmAndPrintBill',
        'settleTableOnly', 'settleTableOnlyWithMethod', 'executeTableSettle', 'settleAndResetTable',
        'applyVoucherInBill', 'cancelVoucherInBill', 'updateBillCalculations'
    ];

    // Bind all functions safely
    tableMethods.forEach(name => {
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

    // Explicit function bindings from local scope
    try { root.loadTables = loadTables; if (typeof window !== 'undefined') window.loadTables = loadTables; } catch(e) {}
    try { root.listenTablesRealtime = listenTablesRealtime; if (typeof window !== 'undefined') window.listenTablesRealtime = listenTablesRealtime; } catch(e) {}
    try { root.renderTableBoard = renderTableBoard; if (typeof window !== 'undefined') window.renderTableBoard = renderTableBoard; } catch(e) {}
    try { root.scheduleRenderTableBoard = scheduleRenderTableBoard; if (typeof window !== 'undefined') window.scheduleRenderTableBoard = scheduleRenderTableBoard; } catch(e) {}

})(typeof window !== 'undefined' ? window : this);