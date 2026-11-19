// =====================================================================
// AURORA SYSTEM - ADMIN CUSTOMER LOYALTY MODULE (MODULAR CONTROLLER)
// Tra cuu hoi vien theo SDT, dang ky member moi, tich diem va tru 100% bill
// Khach khong tu nhap tren QR web - Nhan vien nhap tren Web Admin & App
// Ho tro popup dang nhap/dang xuat & hien thi tren dau hoa don
// =====================================================================

(function(root) {
    'use strict';

    function getDb() { return root.firebaseDb || root.db || (typeof window !== 'undefined' ? (window.firebaseDb || window.db) : null); }
    function getOps() { return root.firebaseOps || (typeof window !== 'undefined' ? window.firebaseOps : {}) || {}; }

    // Map luu thong tin khach hang dang gan vao tung ban
    const tableCustomers = {}; // { [tableName]: customerObject }
    const tablePointsApplied = {}; // { [tableName]: boolean }
    const tableAppliedPointsAmounts = {}; // { [tableName]: number }
    const TABLE_CUSTOMERS_STORAGE_KEY = 'aurora_table_customers_map_v1';

    function saveTableCustomersState() {
        try {
            const dataToSave = {};
            const now = Date.now();
            for (const [tName, cust] of Object.entries(tableCustomers)) {
                if (cust && (cust.id || cust.phone || cust.name)) {
                    dataToSave[tName] = {
                        customer: cust,
                        pointsApplied: !!tablePointsApplied[tName],
                        appliedAmount: tableAppliedPointsAmounts[tName] || 0,
                        time: now
                    };
                }
            }
            localStorage.setItem(TABLE_CUSTOMERS_STORAGE_KEY, JSON.stringify(dataToSave));
        } catch (e) {
            console.warn("Lỗi lưu trạng thái khách hàng của bàn:", e);
        }
    }

    function loadTableCustomersState() {
        try {
            const raw = localStorage.getItem(TABLE_CUSTOMERS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const now = Date.now();
            for (const [tName, item] of Object.entries(parsed)) {
                // Giữ lại các bàn trong vòng 24 giờ
                if (item && item.customer && (now - (item.time || 0) < 24 * 3600 * 1000)) {
                    const cleanT = tName.toUpperCase();
                    // Nếu hệ thống đã nạp allOrders và bàn này hiện không có đơn active nào -> Bỏ qua không nạp tài khoản ma
                    if (typeof root.allOrders !== 'undefined' && Array.isArray(root.allOrders) && root.allOrders.length > 0) {
                        const hasActive = root.allOrders.some(o => {
                            const oTable = String(o.table_id || '').trim().toUpperCase();
                            const cleanOTable = oTable.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                            const cleanTarget = cleanT.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                            return (oTable === cleanT || cleanOTable === cleanTarget) &&
                                   !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status);
                        });
                        if (!hasActive) {
                            continue;
                        }
                    }
                    tableCustomers[cleanT] = item.customer;
                    if (item.pointsApplied) {
                        tablePointsApplied[cleanT] = true;
                        tableAppliedPointsAmounts[cleanT] = Number(item.appliedAmount) || 0;
                    }
                }
            }
        } catch (e) {
            console.warn("Lỗi nạp trạng thái khách hàng của bàn:", e);
        }
    }

    // Nạp lại trạng thái ngay khi khởi động
    loadTableCustomersState();

    function applyTierStyling(tierId, tierEl, cardEl, pointsEl) {
        const tid = String(tierId || '').toLowerCase().trim();
        
        let badgeClass = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-2xs ';
        let cardClass = 'p-3.5 rounded-2xl space-y-2.5 shadow-2xs ';
        let pointsColorClass = 'font-black text-xl leading-none ';

        if (tid === 'diamond' || tid === 'kim cuong' || tid === 'kim cương') {
            badgeClass += 'bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 text-slate-950 border border-cyan-300';
            cardClass += 'bg-gradient-to-r from-cyan-50 via-sky-50 to-blue-50/70 border border-cyan-300';
            pointsColorClass += 'text-cyan-900';
        } else if (tid === 'gold' || tid === 'vang' || tid === 'vàng') {
            badgeClass += 'bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-amber-950 border border-amber-400';
            cardClass += 'bg-gradient-to-r from-amber-50 via-yellow-50/80 to-amber-100/60 border border-amber-300';
            pointsColorClass += 'text-amber-900';
        } else if (tid === 'silver' || tid === 'bac' || tid === 'bạc') {
            badgeClass += 'bg-gradient-to-r from-slate-300 via-gray-200 to-slate-400 text-slate-900 border border-slate-300';
            cardClass += 'bg-gradient-to-r from-slate-50 via-gray-100/70 to-slate-100 border border-slate-300';
            pointsColorClass += 'text-slate-800';
        } else {
            badgeClass += 'bg-gradient-to-r from-stone-400 via-zinc-300 to-stone-400 text-stone-900 border border-stone-300';
            cardClass += 'bg-gradient-to-r from-stone-50 via-gray-50 to-zinc-100/70 border border-stone-200';
            pointsColorClass += 'text-stone-800';
        }

        if (tierEl) tierEl.className = badgeClass;
        if (cardEl) cardEl.className = cardClass;
        if (pointsEl) pointsEl.className = pointsColorClass;
    }

    function formatMoney(num) {
        return (Number(num) || 0).toLocaleString('vi-VN') + ' VNĐ';
    }

    function formatNumber(num) {
        return (Number(num) || 0).toLocaleString('vi-VN');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showToast(msg, type = 'info') {
        if (typeof root.showAdminToast === 'function') {
            root.showAdminToast(msg, type);
        } else if (typeof window !== 'undefined' && typeof window.showAdminToast === 'function') {
            window.showAdminToast(msg, type);
        } else {
            console.log(`[${type}] ${msg}`);
        }
    }

    let activeTableForLoyalty = '';
    let isPointsAppliedInCurrentBill = false;
    let appliedPointsAmount = 0;

    function getTableVariants(tableName) {
        if (!tableName) return [];
        const raw = String(tableName).trim().toUpperCase();
        const norm = raw.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();
        return Array.from(new Set([
            raw,
            norm,
            `BÀN ${norm}`,
            `BAN ${norm}`,
            `TABLE ${norm}`
        ])).filter(Boolean);
    }

    const AdminLoyalty = {
        // Lay thong tin khach dang gan voi ban (Ho tro fallback tu localStorage va tu don hang active)
        getCustomerForTable: function(tableName) {
            const rawT = String(tableName || '').trim().toUpperCase();
            if (!rawT) return null;
            const variants = getTableVariants(rawT);
            const normT = rawT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();

            // 1. Kiểm tra RAM trước (0ms, phản hồi tức thì không lag)
            for (const v of variants) {
                if (tableCustomers[v] && (tableCustomers[v].id || tableCustomers[v].name || tableCustomers[v].phone)) {
                    return tableCustomers[v];
                }
            }

            // 2. Single Source of Truth từ allTables (Firestore tables collection realtime)
            if (typeof root.allTables !== 'undefined' && Array.isArray(root.allTables)) {
                const tblObj = root.allTables.find(t => {
                    const tName = String(t.name || t.id || '').trim().toUpperCase();
                    const cleanTName = tName.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                    return (variants.includes(tName) || cleanTName === normT);
                });
                if (tblObj && tblObj.attached_customer && (tblObj.attached_customer.id || tblObj.attached_customer.phone || tblObj.attached_customer.name)) {
                    const restoredCust = {
                        id: tblObj.attached_customer.id || '',
                        name: tblObj.attached_customer.name || '',
                        phone: tblObj.attached_customer.phone || '',
                        tier: tblObj.attached_customer.tier || 'member',
                        points: Number(tblObj.attached_customer.points) || 0,
                        total_spend: Number(tblObj.attached_customer.total_spend) || 0
                    };
                    variants.forEach(v => {
                        tableCustomers[v] = restoredCust;
                    });
                    return restoredCust;
                }
            }

            // 3. Fallback nạp lại từ localStorage nếu RAM chưa kịp nạp
            loadTableCustomersState();
            for (const v of variants) {
                if (tableCustomers[v] && (tableCustomers[v].id || tableCustomers[v].name || tableCustomers[v].phone)) {
                    return tableCustomers[v];
                }
            }

            return null;
        },

        // Gan khach vao ban
        setCustomerForTable: function(tableName, customer) {
            const rawT = String(tableName || '').trim().toUpperCase();
            if (!rawT || !customer) return;
            const formattedCust = {
                id: customer.id || '',
                name: customer.name || '',
                phone: customer.phone || '',
                tier: customer.tier || 'member',
                points: Number(customer.points) || 0,
                total_spend: Number(customer.total_spend) || 0
            };
            const variants = getTableVariants(rawT);
            const normT = rawT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();

            // 1. Lưu RAM
            variants.forEach(v => {
                tableCustomers[v] = formattedCust;
            });

            // 2. Cập nhật ngay lập tức vào allTables trong RAM để đồng bộ
            if (typeof root.allTables !== 'undefined' && Array.isArray(root.allTables)) {
                const tblObj = root.allTables.find(t => {
                    const tName = String(t.name || t.id || '').trim().toUpperCase();
                    const cleanTName = tName.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                    return (variants.includes(tName) || cleanTName === normT);
                });
                if (tblObj) {
                    tblObj.attached_customer = formattedCust;
                }
            }

            saveTableCustomersState();

            // 3. Cập nhật giao diện Web NGAY LẬP TỨC (0ms lag, hiển thị đã đăng nhập thành công ngay)
            this.updateCustomerTopBarBadge(rawT);
            this.renderCustomerPopup(rawT);
            if (typeof root.scheduleRenderTableBoard === 'function') {
                root.scheduleRenderTableBoard();
            }
            if (typeof root.updateBillCalculations === 'function') {
                root.updateBillCalculations();
            }

            // 4. Đồng bộ Firestore ngầm (Background - KHÔNG CHẶN GIAO DIỆN)
            const cleanT = normT.toUpperCase();
            const db = getDb();
            const ops = getOps();
            if (db && ops.doc && ops.setDoc) {
                ops.setDoc(ops.doc(db, 'tables', cleanT), {
                    attached_customer: formattedCust,
                    updated_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                }, { merge: true }).catch(e => console.warn("Lỗi lưu attached_customer trên tables:", e));
            }

            // 5. Cập nhật đơn hàng ngầm (không chặn UI)
            this.syncCustomerToFirestoreOrders(rawT, formattedCust);
        },

        // Dong bo danh sach khach hang realtime tu AdminCustomerLoyalty
        syncCustomersFromList: function(custList) {
            if (!Array.isArray(custList) || custList.length === 0) return;
            let hasChanged = false;
            const db = getDb();
            const ops = getOps();

            for (const [tName, cust] of Object.entries(tableCustomers)) {
                if (!cust) continue;
                const match = custList.find(c => (cust.id && c.id === cust.id) || (cust.phone && c.phone === cust.phone));
                if (match) {
                    const oldPts = Number(cust.points) || 0;
                    const newPts = Number(match.points !== undefined ? match.points : cust.points) || 0;
                    const oldSpd = Number(cust.total_spend) || 0;
                    const newSpd = Number(match.total_spend !== undefined ? match.total_spend : cust.total_spend) || 0;
                    if (oldPts !== newPts || oldSpd !== newSpd || cust.name !== match.name || cust.tier !== match.tier) {
                        tableCustomers[tName] = {
                            ...cust,
                            ...match,
                            id: match.id || cust.id,
                            name: match.name || cust.name,
                            phone: match.phone || cust.phone,
                            points: newPts,
                            total_spend: newSpd,
                            tier: match.tier || cust.tier || 'member'
                        };
                        hasChanged = true;

                        // Đồng bộ ngay sang Firestore tables
                        const cleanT = cleanTableName(tName);
                        if (db && ops.doc && ops.setDoc) {
                            ops.setDoc(ops.doc(db, 'tables', cleanT), {
                                attached_customer: tableCustomers[tName],
                                updated_at: ops.serverTimestamp()
                            }, { merge: true }).catch(e => console.warn("Lỗi sync customer sang Firestore tables:", e));
                        }
                    }
                }
            }
            if (hasChanged) {
                saveTableCustomersState();
                const curT = String(activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
                if (curT) {
                    this.updateCustomerTopBarBadge(curT);
                    this.renderCustomerPopup(curT);
                    if (typeof root.updateBillCalculations === 'function') {
                        root.updateBillCalculations();
                    }
                }
            }
        },

        // Cập nhật thông tin khách hàng vào tất cả bàn đang gắn khách hàng này (và sync Firestore)
        updateCustomerInAllActiveTables: async function(updatedCust) {
            if (!updatedCust) return;
            const db = getDb();
            const ops = getOps();
            let hasChanged = false;

            for (const [tName, cust] of Object.entries(tableCustomers)) {
                if (cust && ((updatedCust.id && cust.id === updatedCust.id) || (updatedCust.phone && cust.phone === updatedCust.phone))) {
                    tableCustomers[tName] = {
                        ...cust,
                        ...updatedCust
                    };
                    hasChanged = true;
                    const cleanT = cleanTableName(tName);
                    if (db && ops.doc && ops.setDoc) {
                        try {
                            await ops.setDoc(ops.doc(db, 'tables', cleanT), {
                                attached_customer: tableCustomers[tName],
                                updated_at: ops.serverTimestamp()
                            }, { merge: true });
                        } catch(e) {
                            console.warn("Lỗi sync customer sang Firestore tables:", e);
                        }
                    }
                }
            }

            if (hasChanged) {
                saveTableCustomersState();
                const curT = String(activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
                if (curT) {
                    this.updateCustomerTopBarBadge(curT);
                    this.renderCustomerPopup(curT);
                    if (typeof root.updateBillCalculations === 'function') {
                        root.updateBillCalculations();
                    }
                }
            }
        },

        // Lam moi du lieu hoi vien truc tiep tu Firestore cho mot ban cu the
        refreshCustomerDataForTable: async function(tableName) {
            const cleanT = String(tableName || activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
            if (!cleanT) return null;

            const currentCached = this.getCustomerForTable(cleanT);
            if (!currentCached) return null;

            let freshDocData = null;
            const custId = currentCached.id || '';
            const custPhone = currentCached.phone || '';

            // 1. Thu lay tu cache bo nho RAM cua AdminCustomerLoyalty truoc (0ms)
            if (root.AdminCustomerLoyalty) {
                if (custId && typeof root.AdminCustomerLoyalty.getCustomerById === 'function') {
                    freshDocData = root.AdminCustomerLoyalty.getCustomerById(custId);
                }
                if (!freshDocData && custPhone && typeof root.AdminCustomerLoyalty.getCustomerByPhone === 'function') {
                    freshDocData = root.AdminCustomerLoyalty.getCustomerByPhone(custPhone);
                }
            }

            // 2. Query truc tiep tu Firestore de lay du lieu chinh xac 100%
            const db = getDb();
            const ops = getOps();
            if (db) {
                try {
                    if (custId && ops.doc && ops.getDoc) {
                        try {
                            const snap = await ops.getDoc(ops.doc(db, 'customers', custId));
                            if (snap.exists()) {
                                freshDocData = { id: snap.id, ...snap.data() };
                            }
                        } catch (eDoc) {
                            console.warn("Lỗi đọc doc customer theo ID:", eDoc);
                        }
                    }

                    if (!freshDocData && custPhone && ops.collection && ops.getDocs && ops.query && ops.where) {
                        try {
                            const rawPhone = String(custPhone).trim();
                            const normPhone = root.LoyaltyEngine ? root.LoyaltyEngine.normalizePhone(rawPhone) : rawPhone;
                            let snap = await ops.getDocs(ops.query(ops.collection(db, 'customers'), ops.where('phone', '==', normPhone)));
                            if (snap.empty && normPhone !== rawPhone) {
                                snap = await ops.getDocs(ops.query(ops.collection(db, 'customers'), ops.where('phone', '==', rawPhone)));
                            }
                            if (!snap.empty) {
                                const d = snap.docs[0];
                                freshDocData = { ...d.data(), id: d.id };
                            }
                        } catch (ePhone) {
                            console.warn("Lỗi query customer theo phone:", ePhone);
                        }
                    }
                } catch (errDb) {
                    console.warn("Lỗi tra cứu Firestore cho customer:", errDb);
                }
            }

            // 3. Cap nhat du lieu moi nhat vao tableCustomers va dong bo giao dien
            if (freshDocData) {
                const newPts = Number(freshDocData.points !== undefined ? freshDocData.points : currentCached.points) || 0;
                const newSpend = Number(freshDocData.total_spend !== undefined ? freshDocData.total_spend : currentCached.total_spend) || 0;
                const newTier = freshDocData.tier || currentCached.tier || (root.LoyaltyEngine ? root.LoyaltyEngine.getTierBySpend(newSpend).id : 'member');

                const updatedCust = {
                    ...currentCached,
                    ...freshDocData,
                    id: freshDocData.id || currentCached.id || custId,
                    name: freshDocData.name || currentCached.name || '',
                    phone: freshDocData.phone || currentCached.phone || '',
                    points: newPts,
                    total_spend: newSpend,
                    tier: newTier
                };

                tableCustomers[cleanT] = updatedCust;
                saveTableCustomersState();

                this.updateCustomerTopBarBadge(cleanT);

                const curOpenT = String(activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
                if (curOpenT === cleanT) {
                    this.renderCustomerPopup(cleanT);
                }

                if (typeof root.updateBillCalculations === 'function') {
                    root.updateBillCalculations();
                }

                return updatedCust;
            }

            return currentCached;
        },

        // Dong bo thong tin khach vao cac don hang active cua ban tren Firestore
        syncCustomerToFirestoreOrders: async function(tableName, customer) {
            const cleanT = String(tableName || '').trim().toUpperCase();
            if (!cleanT || !customer) return;
            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.updateDoc) return;

            try {
                if (typeof root.allOrders !== 'undefined' && Array.isArray(root.allOrders)) {
                    const activeOrders = root.allOrders.filter(o => {
                        const oTable = String(o.table_id || '').trim().toUpperCase();
                        const cleanOTable = oTable.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                        const cleanTarget = cleanT.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                        return (oTable === cleanT || cleanOTable === cleanTarget) &&
                               !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status);
                    });

                    // Cập nhật bộ nhớ RAM ngay tức khắc (0ms lag)
                    activeOrders.forEach(ord => {
                        ord.customer_id = customer.id || '';
                        ord.customer_name = customer.name || '';
                        ord.customer_phone = customer.phone || '';
                        ord.customer_tier = customer.tier || 'member';
                    });

                    // Đồng bộ Firestore ngầm không chặn luồng UI (Parallel background update)
                    if (activeOrders.length > 0) {
                        Promise.all(activeOrders.map(ord => ops.updateDoc(ops.doc(db, 'orders', ord.id), {
                            customer_id: customer.id || '',
                            customer_name: customer.name || '',
                            customer_phone: customer.phone || '',
                            customer_tier: customer.tier || 'member'
                        }).catch(() => {}))).catch(() => {});
                    }
                }
            } catch (e) {
                console.warn("Lỗi đồng bộ khách hàng vào đơn hàng Firestore:", e);
            }
        },

        // Xu ly chuyen tai khoan khach hang khi Chuyen ban / Tach ban / Gop ban
        transferCustomerBetweenTables: function(sourceTable, targetTable, isFullMove) {
            const src = String(sourceTable || '').trim().toUpperCase();
            const tgt = String(targetTable || '').trim().toUpperCase();
            if (!src || !tgt || src === tgt) return;

            const sourceCust = this.getCustomerForTable(src);
            const targetCust = this.getCustomerForTable(tgt);

            if (isFullMove) {
                // TRƯỜNG HỢP 1: CHUYỂN TOÀN BỘ BÀN (GỘP BÀN)
                if (sourceCust && !targetCust) {
                    // Bàn nguồn có tài khoản, bàn đích chưa có -> Chuyển toàn bộ tài khoản bàn nguồn sang bàn đích
                    const formatted = {
                        id: sourceCust.id || '',
                        name: sourceCust.name || '',
                        phone: sourceCust.phone || '',
                        tier: sourceCust.tier || 'member',
                        points: Number(sourceCust.points) || 0,
                        total_spend: Number(sourceCust.total_spend) || 0
                    };
                    const tgtVariants = getTableVariants(tgt);
                    tgtVariants.forEach(v => {
                        tableCustomers[v] = formatted;
                        tablePointsApplied[v] = !!tablePointsApplied[src];
                        tableAppliedPointsAmounts[v] = tableAppliedPointsAmounts[src] || 0;
                    });
                    saveTableCustomersState();

                    // Xóa triệt để bàn nguồn
                    this.clearCustomerForTable(src);
                    this.clearCustomerFromFirestoreOrders(src);

                    // Cập nhật Firestore tables cho cả nguồn và đích
                    const db = getDb();
                    const ops = getOps();
                    const normSrc = src.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();
                    const normTgt = tgt.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();
                    if (db && ops.doc && ops.setDoc) {
                        ops.setDoc(ops.doc(db, 'tables', normTgt), {
                            attached_customer: formatted,
                            use_points: !!tablePointsApplied[src],
                            updated_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                        }, { merge: true }).catch(e => {});

                        ops.setDoc(ops.doc(db, 'tables', normSrc), {
                            attached_customer: null,
                            use_points: false,
                            updated_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                        }, { merge: true }).catch(e => {});
                    }

                    this.updateCustomerTopBarBadge(tgt);
                    this.syncCustomerToFirestoreOrders(tgt, formatted);
                    showToast(`Đã chuyển tài khoản hội viên ${formatted.name || formatted.phone} sang Bàn ${tgt}!`, "info");

                } else if (sourceCust && targetCust) {
                    // CẢ 2 BÀN ĐỀU CÓ TÀI KHOẢN:
                    // Ưu tiên giữ lại tài khoản của bàn đích (targetCust).
                    // Đồng bộ toàn bộ các đơn/món của bàn đích sang tài khoản targetCust.
                    this.syncCustomerToFirestoreOrders(tgt, targetCust);

                    // XÓA TRIỆT ĐỂ TÀI KHOẢN BÀN NGUỒN CŨ (Cả RAM, localStorage, Firestore orders)
                    // để không bao giờ bị khôi phục lại khi chuyển ngược món
                    this.clearCustomerForTable(src);
                    this.clearCustomerFromFirestoreOrders(src);

                    showToast(`Bàn ${tgt} giữ tài khoản (${targetCust.name || targetCust.phone}). Đã xóa tài khoản cũ của Bàn ${src}.`, "info");

                } else if (!sourceCust && targetCust) {
                    // Bàn nguồn không có khách, bàn đích có khách -> giữ nguyên bàn đích, giải phóng bàn nguồn
                    this.clearCustomerForTable(src);
                    this.clearCustomerFromFirestoreOrders(src);
                }
            } else {
                // TRƯỜNG HỢP 2: TÁCH MỘT PHẦN MÓN SANG BÀN ĐÍCH
                // Bàn nguồn (src) vẫn còn khách ngồi -> Giữ nguyên tài khoản tại bàn nguồn (sourceCust)
                // Bàn đích (tgt):
                // - NẾU BÀN ĐÍCH ĐÃ CÓ TÀI KHOẢN KHÁCH: TUYỆT ĐỐI GIỮ NGUYÊN! Các món chuyển sang sẽ tích điểm cho khách bàn đích.
                // - NẾU BÀN ĐÍCH CHƯA CÓ TÀI KHOẢN: Giữ nguyên bàn đích là bàn chưa gắn tài khoản (không tự ý sao chép tài khoản bàn nguồn).
                if (targetCust) {
                    this.syncCustomerToFirestoreOrders(tgt, targetCust);
                    this.updateCustomerTopBarBadge(tgt);
                }
            }
        },

        // Xoa thong tin khach khoi cac don hang active cua ban tren Firestore & bo nho
        clearCustomerFromFirestoreOrders: async function(tableName) {
            const rawT = String(tableName || '').trim().toUpperCase();
            if (!rawT) return;
            const normT = rawT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();
            const variants = getTableVariants(rawT);
            const db = getDb();
            const ops = getOps();

            try {
                if (typeof root.allOrders !== 'undefined' && Array.isArray(root.allOrders)) {
                    const activeOrders = root.allOrders.filter(o => {
                        const oTable = String(o.table_id || '').trim().toUpperCase();
                        const cleanOTable = oTable.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                        return (variants.includes(oTable) || cleanOTable === normT) &&
                               !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status);
                    });

                    for (const ord of activeOrders) {
                        delete ord.customer_id;
                        delete ord.customer_name;
                        delete ord.customer_phone;
                        delete ord.customer_tier;
                        delete ord.customer_points;
                        delete ord.customer_total_spend;

                        if (db && ops.doc && ops.updateDoc) {
                            try {
                                const deleteField = ops.deleteField || root.deleteField;
                                const payload = deleteField ? {
                                    customer_id: deleteField(),
                                    customer_name: deleteField(),
                                    customer_phone: deleteField(),
                                    customer_tier: deleteField(),
                                    customer_points: deleteField(),
                                    customer_total_spend: deleteField()
                                } : {
                                    customer_id: '',
                                    customer_name: '',
                                    customer_phone: '',
                                    customer_tier: 'member',
                                    customer_points: 0,
                                    customer_total_spend: 0
                                };
                                ops.updateDoc(ops.doc(db, 'orders', ord.id), payload).catch(err => console.warn("Lỗi xóa khách khỏi orders:", err));
                            } catch(err) {
                                console.warn("Lỗi updateDoc khi xóa khách khỏi orders:", err);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("Lỗi xóa thông tin khách khỏi đơn Firestore:", e);
            }
        },

        // Thoat hoac doi tai khoan khach hang cho ban (Dang xuat)
        clearCustomerForTable: function(tableName) {
            const domTable = document.getElementById('bill-table-name') ? document.getElementById('bill-table-name').innerText : '';
            const rawT = String(tableName || activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || domTable || '').trim().toUpperCase();
            if (!rawT) return;
            const variants = getTableVariants(rawT);

            // 1. Xóa trong bộ nhớ RAM
            variants.forEach(k => {
                delete tableCustomers[k];
                delete tablePointsApplied[k];
                delete tableAppliedPointsAmounts[k];
            });

            const normT = rawT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();
            if (typeof root.allTables !== 'undefined' && Array.isArray(root.allTables)) {
                const tblObj = root.allTables.find(t => {
                    const tName = String(t.name || t.id || '').trim().toUpperCase();
                    const cleanTName = tName.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                    return (variants.includes(tName) || cleanTName === normT);
                });
                if (tblObj) {
                    tblObj.attached_customer = null;
                    tblObj.use_points = false;
                }
            }

            isPointsAppliedInCurrentBill = false;
            appliedPointsAmount = 0;

            // 2. Xóa trong localStorage
            saveTableCustomersState();
            try {
                const raw = localStorage.getItem(TABLE_CUSTOMERS_STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    variants.forEach(k => {
                        delete parsed[k];
                        delete parsed[k.toLowerCase()];
                    });
                    localStorage.setItem(TABLE_CUSTOMERS_STORAGE_KEY, JSON.stringify(parsed));
                }
            } catch(e) {}

            // 3. Xóa thông tin khách hàng trong allOrders & Firestore
            this.clearCustomerFromFirestoreOrders(rawT);

            // 3.5. Xóa triệt để Single Source of Truth trên Firestore tables/{cleanT}
            const cleanT = rawT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
            const db = getDb();
            const ops = getOps();
            if (db && ops.doc && ops.setDoc) {
                ops.setDoc(ops.doc(db, 'tables', cleanT), {
                    attached_customer: null,
                    use_points: false,
                    updated_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                }, { merge: true }).catch(e => console.warn("Lỗi xóa attached_customer trên tables:", e));
            }

            // 4. Cập nhật giao diện
            variants.forEach(v => {
                this.updateCustomerTopBarBadge(v);
            });
            this.renderCustomerPopup(rawT);
            if (typeof root.scheduleRenderTableBoard === 'function') {
                root.scheduleRenderTableBoard();
            }
            if (typeof root.updateBillCalculations === 'function') {
                root.updateBillCalculations();
            }
        },

        // Dong bo voi icon khach hang tren dau hoa don (Top Bar) & hien thi ten tren bill
        updateCustomerTopBarBadge: function(tableName) {
            const cleanT = String(tableName || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
            const cust = this.getCustomerForTable(cleanT);

            const btn = document.getElementById('btn-bill-customer-popup');
            const indicatorEl = document.getElementById('bill-customer-indicator');

            if (btn) {
                if (cust) {
                    const tier = root.LoyaltyEngine ? root.LoyaltyEngine.getTierBySpend(cust.total_spend || 0) : { id: 'member', name: 'Thành viên', earnRate: 0.03 };
                    const points = Number(cust.points) || 0;
                    const tid = String(tier.id || cust.tier || '').toLowerCase();
                    
                    let btnColorClass = 'w-10 h-10 rounded-xl flex items-center justify-center transition shrink-0 relative shadow-2xs ';
                    if (tid === 'diamond' || tid === 'kim cuong' || tid === 'kim cương') {
                        btnColorClass += 'bg-cyan-100 hover:bg-cyan-200 border-2 border-cyan-400 text-cyan-900';
                    } else if (tid === 'gold' || tid === 'vang' || tid === 'vàng') {
                        btnColorClass += 'bg-amber-100 hover:bg-amber-200 border-2 border-amber-400 text-amber-900';
                    } else if (tid === 'silver' || tid === 'bac' || tid === 'bạc') {
                        btnColorClass += 'bg-slate-100 hover:bg-slate-200 border-2 border-slate-400 text-slate-800';
                    } else {
                        btnColorClass += 'bg-stone-100 hover:bg-stone-200 border-2 border-stone-400 text-stone-800';
                    }

                    btn.className = btnColorClass;
                    btn.title = `Khách hàng: ${cust.name || cust.phone} (${tier.name} - ${formatNumber(points)} điểm)`;
                    if (indicatorEl) indicatorEl.classList.remove('hidden');
                } else {
                    btn.className = 'w-10 h-10 rounded-xl bg-white hover:bg-amber-50 border border-gray-200 flex items-center justify-center text-gray-700 hover:text-amber-800 transition shrink-0 relative shadow-2xs';
                    btn.title = 'Đăng nhập tài khoản khách hàng / Xem điểm';
                    if (indicatorEl) indicatorEl.classList.add('hidden');
                }
            }

            // Đồng bộ trực quan với thanh Huy hiệu khách hàng nổi bật trên đầu hóa đơn
            const badgeBox = document.getElementById('bill-customer-badge');
            const badgeName = document.getElementById('bill-customer-badge-name');
            const badgeTier = document.getElementById('bill-customer-badge-tier');
            const badgePoints = document.getElementById('bill-customer-badge-points');
            if (badgeBox) {
                if (cust && (cust.name || cust.phone)) {
                    const tier = root.LoyaltyEngine ? root.LoyaltyEngine.getTierBySpend(cust.total_spend || 0) : { id: 'member', name: 'Thành viên', earnRate: 0.03 };
                    const points = Number(cust.points) || 0;
                    if (badgeName) badgeName.textContent = cust.name || cust.phone;
                    if (badgeTier) {
                        badgeTier.textContent = tier.name;
                        const tid = String(tier.id || cust.tier || '').toLowerCase();
                        if (tid === 'diamond' || tid === 'kim cuong' || tid === 'kim cương') {
                            badgeTier.className = 'px-1.5 py-0.2 rounded-md text-[10px] font-bold bg-cyan-700 text-white shrink-0';
                        } else if (tid === 'gold' || tid === 'vang' || tid === 'vàng') {
                            badgeTier.className = 'px-1.5 py-0.2 rounded-md text-[10px] font-bold bg-amber-600 text-white shrink-0';
                        } else if (tid === 'silver' || tid === 'bac' || tid === 'bạc') {
                            badgeTier.className = 'px-1.5 py-0.2 rounded-md text-[10px] font-bold bg-slate-600 text-white shrink-0';
                        } else {
                            badgeTier.className = 'px-1.5 py-0.2 rounded-md text-[10px] font-bold bg-[#b89728] text-white shrink-0';
                        }
                    }
                    if (badgePoints) badgePoints.textContent = `(${formatNumber(points)} đ)`;
                    badgeBox.classList.remove('hidden');
                } else {
                    badgeBox.classList.add('hidden');
                }
            }

            // Đồng bộ tên khách hàng trên bill xem trước và bill in nhiệt (nằm dưới mã HĐ)
            const custPrevRow = document.getElementById('bill-preview-customer-row');
            const custPrevName = document.getElementById('bill-preview-customer-name');
            if (custPrevRow && custPrevName) {
                if (cust && (cust.name || cust.phone)) {
                    custPrevRow.classList.remove('hidden');
                    custPrevName.textContent = cust.name || cust.phone;
                } else {
                    custPrevRow.classList.add('hidden');
                    custPrevName.textContent = '';
                }
            }

            const custPrintRow = document.getElementById('bill-print-customer-row');
            const custPrintName = document.getElementById('bill-print-customer-name');
            if (custPrintRow && custPrintName) {
                if (cust && (cust.name || cust.phone)) {
                    custPrintRow.style.display = 'flex';
                    custPrintName.textContent = cust.name || cust.phone;
                } else {
                    custPrintRow.style.display = 'none';
                    custPrintName.textContent = '';
                }
            }
        },

        // Mo popup tai khoan khach hang tu icon/nut tren dau hoa don
        openCustomerPopup: function(tableName) {
            const domTable = document.getElementById('bill-table-name') ? document.getElementById('bill-table-name').innerText : '';
            activeTableForLoyalty = String(tableName || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || domTable || '').trim().toUpperCase();
            this.renderCustomerPopup(activeTableForLoyalty);
            this.refreshCustomerDataForTable(activeTableForLoyalty);
            const modal = document.getElementById('modal-bill-customer');
            if (modal) {
                modal.classList.remove('hidden');
                setTimeout(() => {
                    const phoneInp = document.getElementById('popup-cust-phone');
                    const loginView = document.getElementById('popup-cust-login-view');
                    if (phoneInp && loginView && !loginView.classList.contains('hidden')) {
                        phoneInp.focus();
                    }
                }, 80);
            }
        },

        closeCustomerPopup: function() {
            const modal = document.getElementById('modal-bill-customer');
            if (modal) modal.classList.add('hidden');
        },

        // Render noi dung ben trong Popup Khach Hang
        renderCustomerPopup: function(tableName) {
            const cleanT = String(tableName || activeTableForLoyalty || '').trim().toUpperCase();
            const cust = this.getCustomerForTable(cleanT);

            const loginView = document.getElementById('popup-cust-login-view');
            const profileView = document.getElementById('popup-cust-profile-view');
            const regBox = document.getElementById('popup-cust-reg-box');

            if (!loginView || !profileView) return;

            if (!cust) {
                // Hien thi giao dien dang nhap / tra cuu SDT
                loginView.classList.remove('hidden');
                profileView.classList.add('hidden');
                if (regBox) regBox.classList.add('hidden');
                const phoneInp = document.getElementById('popup-cust-phone');
                if (phoneInp) phoneInp.value = '';
            } else {
                // Hien thi ho so khach hang da dang nhap
                loginView.classList.add('hidden');
                profileView.classList.remove('hidden');

                const tier = root.LoyaltyEngine ? root.LoyaltyEngine.getTierBySpend(cust.total_spend || 0) : { name: 'Thành viên', earnRate: 0.03 };
                const points = Number(cust.points) || 0;
                const spend = Number(cust.total_spend) || 0;

                const nameEl = document.getElementById('popup-profile-name');
                const phoneEl = document.getElementById('popup-profile-phone');
                const tierEl = document.getElementById('popup-profile-tier');
                const pointsEl = document.getElementById('popup-profile-points');
                const spendEl = document.getElementById('popup-profile-spend');
                const equivEl = document.getElementById('popup-profile-points-equiv');
                const cardEl = document.getElementById('popup-cust-card') || document.getElementById('popup-profile-card');
                const btnPoints = document.getElementById('btn-popup-use-points');

                if (nameEl) nameEl.textContent = cust.name || 'Hội viên';
                if (phoneEl) phoneEl.textContent = cust.phone || '--';
                if (tierEl) tierEl.textContent = tier.name;
                applyTierStyling(tier.id || cust.tier, tierEl, cardEl, pointsEl);
                if (pointsEl) pointsEl.textContent = formatNumber(points);
                if (spendEl) spendEl.textContent = formatMoney(spend);
                if (equivEl) equivEl.textContent = `(= ${formatMoney(points)} giảm trực tiếp vào hóa đơn)`;

                if (btnPoints) {
                    const isApplied = !!tablePointsApplied[cleanT];
                    const appliedAmt = tableAppliedPointsAmounts[cleanT] || 0;

                    // Tính số tiền còn lại của hóa đơn để biết chuẩn xác số điểm được dùng (khớp 100% Android App)
                    let subtotal = Number(root.currentCheckoutSubtotal || (typeof window !== 'undefined' ? window.currentCheckoutSubtotal : 0)) || 0;
                    if (subtotal <= 0 && Array.isArray(root.allOrders)) {
                        const tblOrders = root.allOrders.filter(o => {
                            const oTable = String(o.table_id || o.table || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                            const curClean = cleanT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                            return oTable === curClean && !['settled', 'paid', 'transferred', 'cancelled'].includes(o.status);
                        });
                        subtotal = tblOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
                    }

                    // Trừ số tiền voucher giảm giá nếu có
                    let voucherDiscount = 0;
                    const vObj = root.currentBillAppliedVoucher || (root.tableVouchers ? root.tableVouchers[cleanT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase()] : null);
                    if (vObj) {
                        const directV = Number(vObj.discountAmount ?? vObj.discount_amount ?? 0);
                        if (directV > 0) {
                            voucherDiscount = directV;
                        } else {
                            const vVal = Number(vObj.value ?? vObj.discount_value ?? 0);
                            const vT = String(vObj.type || vObj.discount_type || 'fixed').toLowerCase();
                            if (vT === 'fixed') voucherDiscount = Math.min(subtotal, vVal);
                            else if (vT === 'percent') {
                                const raw = Math.round((subtotal * vVal) / 100);
                                const maxD = Number(vObj.max_discount) || 0;
                                voucherDiscount = (maxD > 0) ? Math.min(raw, maxD) : raw;
                            }
                        }
                    }

                    const remainingBill = Math.max(0, subtotal - voucherDiscount);
                    const usablePoints = (remainingBill > 0) ? Math.min(points, remainingBill) : points;

                    if (isApplied) {
                        const showAmt = (appliedAmt > 0) ? appliedAmt : usablePoints;
                        btnPoints.className = 'w-full py-2.5 px-3 rounded-xl text-xs font-bold transition bg-red-100 hover:bg-red-200 text-red-800 border border-red-300';
                        btnPoints.textContent = `Bỏ dùng điểm (Đang trừ ${formatNumber(showAmt)} điểm)`;
                        btnPoints.disabled = false;
                    } else if (points > 0 && remainingBill > 0) {
                        btnPoints.className = 'w-full py-2.5 px-3 rounded-xl text-xs font-bold transition bg-[#a07820] hover:bg-[#8c6719] text-white border border-[#a07820] shadow-2xs';
                        btnPoints.textContent = `Dùng ${formatNumber(usablePoints)} điểm`;
                        btnPoints.disabled = false;
                    } else if (points > 0 && remainingBill === 0 && subtotal > 0) {
                        btnPoints.className = 'w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200 cursor-not-allowed';
                        btnPoints.textContent = 'Hóa đơn đã được giảm 100%';
                        btnPoints.disabled = true;
                    } else if (points > 0) {
                        btnPoints.className = 'w-full py-2.5 px-3 rounded-xl text-xs font-bold transition bg-[#a07820] hover:bg-[#8c6719] text-white border border-[#a07820] shadow-2xs';
                        btnPoints.textContent = `Dùng ${formatNumber(points)} điểm`;
                        btnPoints.disabled = false;
                    } else {
                        btnPoints.className = 'w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed';
                        btnPoints.textContent = '0 điểm khả dụng';
                        btnPoints.disabled = true;
                    }
                }
            }
        },

        // Tra cuu hoi vien trong Popup theo SDT
        lookupCustomerInPopup: async function() {
            const phoneInp = document.getElementById('popup-cust-phone');
            const rawPhone = (phoneInp ? phoneInp.value : '').trim();
            const phone = root.LoyaltyEngine ? root.LoyaltyEngine.normalizePhone(rawPhone) : rawPhone;

            if (!phone || phone.length < 9) {
                showToast("Vui lòng nhập số điện thoại hợp lệ (tối thiểu 9 số)", "error");
                return;
            }

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.collection || !ops.getDocs || !ops.query || !ops.where) {
                showToast("Cơ sở dữ liệu chưa sẵn sàng", "error");
                return;
            }

            try {
                let snap = await ops.getDocs(ops.query(ops.collection(db, 'customers'), ops.where('phone', '==', phone)));
                if (snap.empty && phone !== rawPhone) {
                    snap = await ops.getDocs(ops.query(ops.collection(db, 'customers'), ops.where('phone', '==', rawPhone)));
                }

                if (!snap.empty) {
                    const doc = snap.docs[0];
                    const docData = doc.data();
                    const cust = {
                        ...docData,
                        id: doc.id,
                        points: Number(docData.points) || 0,
                        total_spend: Number(docData.total_spend) || 0
                    };
                    const targetTable = activeTableForLoyalty 
                        || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') 
                        || root.currentCheckoutTable 
                        || (document.getElementById('bill-table-name') ? document.getElementById('bill-table-name').innerText : '')
                        || '';
                    activeTableForLoyalty = targetTable;
                    this.setCustomerForTable(targetTable, cust);
                    showToast(`Đã nhận diện hội viên: ${cust.name || cust.phone}`, "success");
                    if (typeof root.updateBillCalculations === 'function') {
                        root.updateBillCalculations();
                    }
                } else {
                    // Chưa có tài khoản -> Mở hộp đăng ký nhanh
                    const regBox = document.getElementById('popup-cust-reg-box');
                    const regPhone = document.getElementById('popup-cust-reg-phone-display');
                    const nameInp = document.getElementById('popup-cust-reg-name');
                    if (regBox) regBox.classList.remove('hidden');
                    if (regPhone) regPhone.textContent = phone;
                    if (nameInp) {
                        nameInp.value = '';
                        nameInp.focus();
                    }
                }
            } catch (err) {
                console.error("Lỗi tra cứu khách hàng: ", err);
                showToast("Lỗi tra cứu: " + err.message, "error");
            }
        },

        // Đăng ký nhanh khách hàng mới trong Popup
        quickRegisterInPopup: async function() {
            const phoneInp = document.getElementById('popup-cust-phone');
            const nameInp = document.getElementById('popup-cust-reg-name');
            const rawPhone = (phoneInp ? phoneInp.value : '').trim();
            const name = (nameInp ? nameInp.value : '').trim();
            const phone = root.LoyaltyEngine ? root.LoyaltyEngine.normalizePhone(rawPhone) : rawPhone;

            if (!phone || phone.length < 9) {
                showToast("Vui lòng nhập số điện thoại hợp lệ", "error");
                return;
            }
            if (!name) {
                showToast("Vui lòng nhập họ và tên khách hàng", "error");
                return;
            }

            const db = getDb();
            const ops = getOps();
            const addDocFn = ops.addDoc || (typeof root.addDoc === 'function' ? root.addDoc : null);
            if (!db || !ops.collection || !addDocFn) {
                showToast("Hệ thống cơ sở dữ liệu chưa sẵn sàng", "error");
                return;
            }

            const newCust = {
                phone: phone,
                name: name,
                points: 0,
                total_spend: 0,
                tier: 'member',
                created_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
            };

            try {
                const docRef = await addDocFn(ops.collection(db, 'customers'), newCust);
                const cust = { id: docRef.id, ...newCust };
                const targetTable = activeTableForLoyalty 
                    || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') 
                    || root.currentCheckoutTable 
                    || (document.getElementById('bill-table-name') ? document.getElementById('bill-table-name').innerText : '')
                    || '';
                activeTableForLoyalty = targetTable;
                this.setCustomerForTable(targetTable, cust);
                showToast(`Đăng ký thành công hội viên mới: ${name}!`, "success");
                if (typeof root.updateBillCalculations === 'function') {
                    root.updateBillCalculations();
                }
            } catch (err) {
                console.error("Lỗi đăng ký hội viên: ", err);
                showToast("Lỗi đăng ký: " + err.message, "error");
            }
        },

        // Bật / tắt dùng điểm trong Popup
        togglePointsInPopup: function() {
            const cleanT = String(activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
            const cust = this.getCustomerForTable(cleanT);
            if (!cust) return;

            const points = Number(cust.points) || 0;
            const db = getDb();
            const ops = getOps();
            const normT = cleanT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();

            if (tablePointsApplied[cleanT]) {
                tablePointsApplied[cleanT] = false;
                tableAppliedPointsAmounts[cleanT] = 0;
                isPointsAppliedInCurrentBill = false;
                appliedPointsAmount = 0;
                saveTableCustomersState();
                if (db && ops.doc && ops.setDoc) {
                    ops.setDoc(ops.doc(db, 'tables', normT), {
                        use_points: false,
                        updated_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                    }, { merge: true }).catch(e => {});
                }
                showToast("Đã hủy áp dụng trừ điểm", "info");
            } else {
                if (points <= 0) {
                    showToast("Khách hàng chưa có điểm tích lũy", "warning");
                    return;
                }
                tablePointsApplied[cleanT] = true;
                isPointsAppliedInCurrentBill = true;
                saveTableCustomersState();
                if (db && ops.doc && ops.setDoc) {
                    ops.setDoc(ops.doc(db, 'tables', normT), {
                        use_points: true,
                        updated_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                    }, { merge: true }).catch(e => {});
                }
                showToast("Đã kích hoạt dùng điểm tích lũy", "success");
            }

            if (typeof root.updateBillCalculations === 'function') {
                root.updateBillCalculations();
            }
            this.updateCustomerTopBarBadge(cleanT);
            this.renderCustomerPopup(cleanT);
        },

        // Đăng xuất khách hàng khỏi bàn hiện tại
        logoutCustomerFromTable: function() {
            const domTable = document.getElementById('bill-table-name') ? document.getElementById('bill-table-name').innerText : '';
            const curTable = activeTableForLoyalty 
                || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') 
                || root.currentCheckoutTable 
                || domTable;
            this.clearCustomerForTable(curTable);
            showToast("Đã đăng xuất tài khoản khách hàng khỏi hóa đơn", "info");
        },

        // Tính số tiền điểm được khấu trừ dựa trên số tiền còn lại sau voucher
        calculatePointsDeduction: function(tableName, remainingBillAfterVoucher) {
            const cleanT = String(tableName || activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
            if (!tablePointsApplied[cleanT]) {
                tableAppliedPointsAmounts[cleanT] = 0;
                isPointsAppliedInCurrentBill = false;
                appliedPointsAmount = 0;
                return 0;
            }

            const cust = this.getCustomerForTable(cleanT);
            if (!cust) {
                tablePointsApplied[cleanT] = false;
                tableAppliedPointsAmounts[cleanT] = 0;
                isPointsAppliedInCurrentBill = false;
                appliedPointsAmount = 0;
                return 0;
            }

            const points = Number(cust.points) || 0;
            const maxPointsCanUse = root.LoyaltyEngine ? root.LoyaltyEngine.calculateMaxRedeemPoints(points, remainingBillAfterVoucher) : Math.min(points, remainingBillAfterVoucher);

            tableAppliedPointsAmounts[cleanT] = maxPointsCanUse;
            isPointsAppliedInCurrentBill = true;
            appliedPointsAmount = maxPointsCanUse;
            return maxPointsCanUse;
        },

        // Tự động tích điểm cho khách hàng và lưu lịch sử khi thanh toán hóa đơn
        finalizeLoyaltyTransaction: async function(tableName, orderId, netPaidAmount, pointsUsed, billTotal) {
            const cleanT = String(tableName || '').trim().toUpperCase();
            const cust = this.getCustomerForTable(cleanT);
            if (!cust || !cust.id) return;

            const db = getDb();
            const ops = getOps();
            const addDocFn = ops.addDoc || (typeof root.addDoc === 'function' ? root.addDoc : null);
            if (!db || !ops.doc || !ops.updateDoc || !ops.collection || !addDocFn) return;

            let currentSpend = Number(cust.total_spend) || 0;
            let currentPts = Number(cust.points) || 0;

            // Đọc dữ liệu mới nhất trực tiếp từ Firestore trước khi chốt để tránh lệch điểm
            try {
                if (ops.getDoc) {
                    const snap = await ops.getDoc(ops.doc(db, 'customers', cust.id));
                    if (snap.exists()) {
                        const fd = snap.data();
                        currentPts = Number(fd.points !== undefined ? fd.points : currentPts) || 0;
                        currentSpend = Number(fd.total_spend !== undefined ? fd.total_spend : currentSpend) || 0;
                    }
                }
            } catch (eFresh) {
                console.warn("Lỗi đọc fresh data trước khi finalize:", eFresh);
            }

            const earnedPts = root.LoyaltyEngine ? root.LoyaltyEngine.calculateEarnPoints(netPaidAmount, currentSpend) : Math.round(netPaidAmount * 0.03);
            const newPoints = Math.max(0, currentPts - pointsUsed + earnedPts);
            const newSpend = currentSpend + netPaidAmount;
            const newTier = root.LoyaltyEngine ? root.LoyaltyEngine.getTierBySpend(newSpend).id : 'member';

            try {
                // Cập nhật thông tin khách hàng trong Firestore
                await ops.updateDoc(ops.doc(db, 'customers', cust.id), {
                    points: newPoints,
                    total_spend: newSpend,
                    tier: newTier,
                    last_active: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                });

                // Ghi nhận lịch sử giao dịch tích điểm / trừ điểm
                await addDocFn(ops.collection(db, 'loyalty_transactions'), {
                    customer_id: cust.id,
                    customer_name: cust.name,
                    customer_phone: cust.phone,
                    order_id: orderId || '',
                    table_name: cleanT || '',
                    bill_total: billTotal || 0,
                    net_paid: netPaidAmount || 0,
                    points_used: pointsUsed || 0,
                    points_earned: earnedPts || 0,
                    points_balance: newPoints,
                    created_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                });

                if (earnedPts > 0) {
                    showToast(`Tích lũy thành công ${formatNumber(earnedPts)} điểm cho khách hàng ${cust.name}!`, "success");
                }

                // Dọn dẹp bộ nhớ đệm cho bàn này
                this.clearCustomerForTable(cleanT);
            } catch (err) {
                console.error("Lỗi cập nhật giao dịch tích điểm: ", err);
            }
        },

        // Render thẻ và làm mới dữ liệu
        renderLoyaltyCardInBill: function(tableName) {
            const cleanT = String(tableName || '').trim().toUpperCase();
            this.updateCustomerTopBarBadge(cleanT);
            this.refreshCustomerDataForTable(cleanT);
        },

        // Đồng bộ thời gian thực từ Firestore tables document (SSOT)
        setCustomerFromFirestore: function(tableName, customerData, usePoints) {
            const rawT = String(tableName || '').trim().toUpperCase();
            if (!rawT) return;
            const variants = getTableVariants(rawT);
            const normT = rawT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();

            if (customerData && (customerData.id || customerData.name || customerData.phone)) {
                const formatted = {
                    id: customerData.id || '',
                    name: customerData.name || '',
                    phone: customerData.phone || '',
                    tier: customerData.tier || 'member',
                    points: Number(customerData.points) || 0,
                    total_spend: Number(customerData.total_spend) || 0
                };
                variants.forEach(v => {
                    tableCustomers[v] = formatted;
                    tablePointsApplied[v] = (usePoints === true);
                });
                saveTableCustomersState();

                // Cập nhật bộ nhớ cục bộ allOrders (không gọi Firestore update để tránh vòng lặp nghẽn mạng)
                if (typeof root.allOrders !== 'undefined' && Array.isArray(root.allOrders)) {
                    root.allOrders.forEach(o => {
                        const oTable = String(o.table_id || '').trim().toUpperCase();
                        const cleanOTable = oTable.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                        if (variants.includes(oTable) || cleanOTable === normT) {
                            o.customer_id = formatted.id;
                            o.customer_name = formatted.name;
                            o.customer_phone = formatted.phone;
                            o.customer_tier = formatted.tier;
                        }
                    });
                }
                this.updateCustomerTopBarBadge(rawT);
            } else {
                // Clear
                variants.forEach(v => {
                    delete tableCustomers[v];
                    delete tablePointsApplied[v];
                    delete tableAppliedPointsAmounts[v];
                });
                saveTableCustomersState();

                // Dọn dẹp bộ nhớ cục bộ allOrders (không gọi Firestore update)
                if (typeof root.allOrders !== 'undefined' && Array.isArray(root.allOrders)) {
                    root.allOrders.forEach(o => {
                        const oTable = String(o.table_id || '').trim().toUpperCase();
                        const cleanOTable = oTable.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
                        if (variants.includes(oTable) || cleanOTable === normT) {
                            delete o.customer_id;
                            delete o.customer_name;
                            delete o.customer_phone;
                            delete o.customer_tier;
                        }
                    });
                }
                this.updateCustomerTopBarBadge(rawT);
            }

            const curOpenT = String(activeTableForLoyalty || (typeof window !== 'undefined' ? window.currentCheckoutTable : '') || root.currentCheckoutTable || '').trim().toUpperCase();
            const cleanOpen = curOpenT.replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim();
            if (cleanOpen === normT || curOpenT === rawT || variants.includes(curOpenT)) {
                this.renderCustomerPopup(curOpenT);
                if (typeof root.updateBillCalculations === 'function') {
                    root.updateBillCalculations();
                }
            }
        }
    };

    root.AdminLoyalty = AdminLoyalty;
    if (typeof window !== 'undefined') {
        window.AdminLoyalty = AdminLoyalty;
        window.logoutCustomerFromTable = function() {
            AdminLoyalty.logoutCustomerFromTable();
        };
    }
})(typeof window !== 'undefined' ? window : this);
