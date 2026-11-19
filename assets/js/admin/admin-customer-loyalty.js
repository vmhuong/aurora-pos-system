// =====================================================================
// AURORA SYSTEM - ADMIN CUSTOMER LOYALTY MANAGEMENT MODULE
// Quan ly danh sach hoi vien, hang thanh vien, tich diem, va dieu chinh diem
// Chi quan tri vien cap Admin moi co quyen xem va sua
// =====================================================================

(function(root) {
    'use strict';

    function getDb() { return root.firebaseDb || root.db || (typeof window !== 'undefined' ? (window.firebaseDb || window.db) : null); }
    function getOps() { return root.firebaseOps || (typeof window !== 'undefined' ? window.firebaseOps : {}) || {}; }

    let allCustomers = [];
    let customersUnsub = null;
    let selectedTierFilter = 'ALL';
    let searchQuery = '';
    let editingCustomerId = null;

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

    // Kiem tra quyen quan tri: Chi cho phep Admin (Chu quan) xem va thao tac
    function canEdit() {
        if (typeof window.isAdminRole === 'function') {
            return window.isAdminRole();
        }
        const allowed = ['admin', 'owner', 'superadmin', 'quản trị viên', 'quan tri vien'];
        if (root.AdminAuth && typeof root.AdminAuth.hasRole === 'function') {
            if (root.AdminAuth.hasRole(allowed)) return true;
        }
        let role = '';
        if (root.AdminAuth && typeof root.AdminAuth.getCurrentUser === 'function') {
            const u = root.AdminAuth.getCurrentUser();
            if (u && u.role) role = u.role;
        }
        if (!role) {
            try {
                const u = JSON.parse(localStorage.getItem('aurora_current_user') || '{}');
                role = u.role || '';
            } catch(e) {}
        }
        if (!role) {
            role = ((typeof root.currentStaffRole !== 'undefined' && root.currentStaffRole) ? root.currentStaffRole : (localStorage.getItem('aurora_admin_role') || ''));
        }
        const r = String(role || '').trim().toLowerCase();
        return allowed.includes(r);
    }

    function getTierInfo(tierId, spend = 0) {
        if (root.LoyaltyEngine && typeof root.LoyaltyEngine.getTierBySpend === 'function') {
            return root.LoyaltyEngine.getTierBySpend(spend);
        }
        const t = String(tierId || '').toLowerCase();
        if (t === 'diamond' || t === 'kim cuong') return { id: 'diamond', name: 'Kim Cương', earnRate: 0.10, minSpend: 15000000 };
        if (t === 'gold' || t === 'vang') return { id: 'gold', name: 'Vàng', earnRate: 0.07, minSpend: 5000000 };
        if (t === 'silver' || t === 'bac') return { id: 'silver', name: 'Bạc', earnRate: 0.05, minSpend: 2000000 };
        return { id: 'member', name: 'Thành viên', earnRate: 0.03, minSpend: 0 };
    }

    const AdminCustomerLoyalty = {
        init: function() {
            this.listenCustomersRealtime();
        },

        onTabActivated: function() {
            if (allCustomers.length === 0) {
                this.listenCustomersRealtime();
            } else {
                this.renderStats();
                this.renderCustomerTable();
            }
        },

        listenCustomersRealtime: function() {
            const db = getDb();
            const ops = getOps();
            if (!db || !ops.collection || !ops.onSnapshot) return;

            if (customersUnsub) {
                customersUnsub();
                customersUnsub = null;
            }

            const col = ops.collection(db, 'customers');
            customersUnsub = ops.onSnapshot(col, (snap) => {
                const list = [];
                snap.forEach(d => {
                    list.push({ ...d.data(), id: d.id });
                });
                list.sort((a, b) => {
                    const sA = Number(a.total_spend) || 0;
                    const sB = Number(b.total_spend) || 0;
                    return sB - sA;
                });
                allCustomers = list;
                this.renderStats();
                this.renderCustomerTable();

                // Tu dong cap nhat lai thong tin khach hang cho cac ban dang phuc vu
                if (root.AdminLoyalty && typeof root.AdminLoyalty.syncCustomersFromList === 'function') {
                    root.AdminLoyalty.syncCustomersFromList(allCustomers);
                }
            }, (err) => {
                console.error("Loi lang nghe danh sach khach hang: ", err);
            });
        },

        renderStats: function() {
            let totalSpend = 0;
            let totalPoints = 0;
            let countMember = 0;
            let countSilver = 0;
            let countGold = 0;
            let countDiamond = 0;

            allCustomers.forEach(c => {
                const sp = Number(c.total_spend) || 0;
                const pt = Number(c.points) || 0;
                totalSpend += sp;
                totalPoints += pt;

                const tier = getTierInfo(c.tier, sp);
                if (tier.id === 'diamond') countDiamond++;
                else if (tier.id === 'gold') countGold++;
                else if (tier.id === 'silver') countSilver++;
                else countMember++;
            });

            const totalEl = document.getElementById('cust-stat-total');
            if (totalEl) totalEl.textContent = formatNumber(allCustomers.length);

            const spendEl = document.getElementById('cust-stat-spend');
            if (spendEl) spendEl.textContent = formatMoney(totalSpend);

            const pointsEl = document.getElementById('cust-stat-points');
            if (pointsEl) pointsEl.textContent = formatNumber(totalPoints) + ' điểm';

            const tierBreakdownEl = document.getElementById('cust-stat-tiers');
            if (tierBreakdownEl) {
                tierBreakdownEl.textContent = `Thành viên: ${countMember} | Bạc: ${countSilver} | Vàng: ${countGold} | Kim Cương: ${countDiamond}`;
            }
        },

        filterByTier: function(tier) {
            selectedTierFilter = tier || 'ALL';
            const buttons = document.querySelectorAll('.cust-tier-filter-btn');
            buttons.forEach(btn => {
                const t = btn.getAttribute('data-tier');
                if (t === selectedTierFilter) {
                    btn.classList.add('bg-[#d4af37]', 'text-black', 'font-bold');
                    btn.classList.remove('bg-white', 'text-gray-600');
                } else {
                    btn.classList.remove('bg-[#d4af37]', 'text-black', 'font-bold');
                    btn.classList.add('bg-white', 'text-gray-600');
                }
            });
            this.renderCustomerTable();
        },

        onSearchInput: function(val) {
            searchQuery = String(val || '').trim().toLowerCase();
            this.renderCustomerTable();
        },

        renderTable: function() {
            this.renderCustomerTable();
        },

        renderCustomerTable: function() {
            const tableBody = document.getElementById('customer-table-body');
            const emptyEl = document.getElementById('customer-table-empty');
            if (!tableBody) return;

            let filtered = allCustomers.slice();

            if (selectedTierFilter !== 'ALL') {
                filtered = filtered.filter(c => {
                    const t = getTierInfo(c.tier, c.total_spend || 0);
                    return t.id.toLowerCase() === selectedTierFilter.toLowerCase();
                });
            }

            if (searchQuery) {
                filtered = filtered.filter(c => {
                    const phone = String(c.phone || '').toLowerCase();
                    const name = String(c.name || '').toLowerCase();
                    return phone.includes(searchQuery) || name.includes(searchQuery);
                });
            }

            if (filtered.length === 0) {
                tableBody.innerHTML = '';
                if (emptyEl) emptyEl.classList.remove('hidden');
                return;
            }

            if (emptyEl) emptyEl.classList.add('hidden');

            const isEditable = canEdit();

            let html = '';
            filtered.forEach((c, idx) => {
                const tier = getTierInfo(c.tier, c.total_spend || 0);
                const points = Number(c.points) || 0;
                const spend = Number(c.total_spend) || 0;
                const earnPercent = Math.round(tier.earnRate * 100);

                let tierBadgeClass = 'bg-stone-100 text-stone-700 border-stone-300';
                if (tier.id === 'silver') tierBadgeClass = 'bg-slate-200 text-slate-900 border-slate-300 font-bold';
                else if (tier.id === 'gold') tierBadgeClass = 'bg-amber-100 text-amber-900 border-amber-400 font-bold';
                else if (tier.id === 'diamond') tierBadgeClass = 'bg-cyan-100 text-cyan-900 border-cyan-300 font-bold';

                let dateStr = '--';
                if (c.created_at && c.created_at.toDate) {
                    const d = c.created_at.toDate();
                    dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
                }

                html += `
                    <tr class="border-b border-gray-100 hover:bg-amber-50/20 text-xs transition">
                        <td class="p-3 font-semibold text-gray-500">${idx + 1}</td>
                        <td class="p-3">
                            <div class="font-bold text-gray-900 text-sm">${escapeHtml(c.name || 'Khách vãng lai')}</div>
                            <div class="text-[11px] text-gray-400 font-mono">${escapeHtml(c.phone || '--')}</div>
                        </td>
                        <td class="p-3">
                            <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${tierBadgeClass}">
                                ${escapeHtml(tier.name)}
                            </span>
                        </td>
                        <td class="p-3 text-right">
                            <span class="font-bold text-gray-900">${formatMoney(spend)}</span>
                        </td>
                        <td class="p-3 text-right">
                            <div class="font-bold text-amber-800">${formatNumber(points)} điểm</div>
                            <div class="text-[10px] text-gray-400">(= ${formatMoney(points)})</div>
                        </td>
                        <td class="p-3 text-center text-gray-500 font-mono text-[11px]">
                            ${dateStr}
                        </td>
                        <td class="p-3 text-right whitespace-nowrap">
                            <div class="inline-flex gap-1.5 items-center">
                                <button type="button" onclick="AdminCustomerLoyalty.openHistoryModal('${c.id}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-semibold transition" title="Xem lịch sử giao dịch tích điểm">
                                    Lịch sử
                                </button>
                                ${isEditable ? `
                                    <button type="button" onclick="AdminCustomerLoyalty.openEditModal('${c.id}')" class="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-[11px] font-bold transition" title="Chỉnh sửa thông tin và điều chỉnh điểm">
                                        Sửa / Điểm
                                    </button>
                                    <button type="button" onclick="AdminCustomerLoyalty.deleteCustomer('${c.id}')" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[11px] font-semibold transition" title="Xóa khách hàng">
                                        Xóa
                                    </button>
                                ` : `
                                    <span class="text-[10px] text-gray-400 italic">Chỉ xem</span>
                                `}
                            </div>
                        </td>
                    </tr>
                `;
            });

            tableBody.innerHTML = html;
        },

        // Modal Them Khach Hang Moi
        openAddModal: function() {
            if (!canEdit()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền thêm tài khoản khách hàng", "error");
                return;
            }

            document.getElementById('cust-add-name').value = '';
            document.getElementById('cust-add-phone').value = '';
            document.getElementById('cust-add-points').value = '0';
            document.getElementById('cust-add-spend').value = '0';

            const modal = document.getElementById('modal-customer-add');
            if (modal) modal.classList.remove('hidden');
        },

        closeAddModal: function() {
            const modal = document.getElementById('modal-customer-add');
            if (modal) modal.classList.add('hidden');
        },

        submitAddCustomer: async function() {
            if (!canEdit()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền thêm tài khoản khách hàng", "error");
                return;
            }

            const name = (document.getElementById('cust-add-name').value || '').trim();
            const rawPhone = (document.getElementById('cust-add-phone').value || '').trim();
            const phone = root.LoyaltyEngine ? root.LoyaltyEngine.normalizePhone(rawPhone) : rawPhone;
            const points = Number(document.getElementById('cust-add-points').value) || 0;
            const spend = Number(document.getElementById('cust-add-spend').value) || 0;

            if (!name) {
                showToast("Vui lòng nhập họ tên khách hàng", "error");
                return;
            }
            if (!phone || phone.length < 9) {
                showToast("Vui lòng nhập số điện thoại hợp lệ", "error");
                return;
            }

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.collection || !ops.addDoc) return;

            // Kiem tra trung so dien thoai
            const exists = allCustomers.some(c => c.phone === phone);
            if (exists) {
                showToast(`Số điện thoại ${phone} đã tồn tại trong hệ thống!`, "error");
                return;
            }

            const tier = root.LoyaltyEngine ? root.LoyaltyEngine.getTierBySpend(spend).id : 'member';

            const newCust = {
                name: name,
                phone: phone,
                points: Math.max(0, points),
                total_spend: Math.max(0, spend),
                tier: tier,
                created_at: ops.serverTimestamp()
            };

            try {
                const docRef = await ops.addDoc(ops.collection(db, 'customers'), newCust);
                if (points > 0) {
                    await ops.addDoc(ops.collection(db, 'loyalty_transactions'), {
                        customer_id: docRef.id,
                        customer_name: name,
                        customer_phone: phone,
                        order_id: 'MANUAL_INIT',
                        table_name: 'ADMIN',
                        bill_total: 0,
                        net_paid: 0,
                        points_used: 0,
                        points_earned: points,
                        points_balance: points,
                        note: 'Khởi tạo điểm ban đầu bởi Admin',
                        created_at: ops.serverTimestamp()
                    });
                }

                this.closeAddModal();
                showToast(`Đã tạo thành công tài khoản: ${name}`, "success");
            } catch (err) {
                console.error("Lỗi thêm khách hàng: ", err);
                showToast("Lỗi tạo khách hàng: " + err.message, "error");
            }
        },

        // Modal Chinh Sua / Dieu Chinh Diem
        openEditModal: function(custId) {
            if (!canEdit()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền chỉnh sửa tài khoản khách hàng", "error");
                return;
            }

            const cust = allCustomers.find(c => c.id === custId);
            if (!cust) return;

            editingCustomerId = custId;
            document.getElementById('cust-edit-id').value = cust.id;
            document.getElementById('cust-edit-name').value = cust.name || '';
            document.getElementById('cust-edit-phone').value = cust.phone || '';
            document.getElementById('cust-edit-points-current').value = Number(cust.points) || 0;
            document.getElementById('cust-edit-spend').value = cust.total_spend || 0;
            document.getElementById('cust-edit-tier').value = cust.tier || 'member';

            // Reset o dieu chinh diem
            document.getElementById('cust-adjust-points-action').value = 'ADD';
            document.getElementById('cust-adjust-points-amount').value = '';
            document.getElementById('cust-adjust-points-reason').value = '';

            const modal = document.getElementById('modal-customer-edit');
            if (modal) modal.classList.remove('hidden');
        },

        closeEditModal: function() {
            const modal = document.getElementById('modal-customer-edit');
            if (modal) modal.classList.add('hidden');
            editingCustomerId = null;
        },

        submitEditCustomer: async function() {
            if (!canEdit()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền chỉnh sửa", "error");
                return;
            }

            const cust = allCustomers.find(c => c.id === editingCustomerId);
            if (!cust) return;

            const name = (document.getElementById('cust-edit-name').value || '').trim();
            const rawPhone = (document.getElementById('cust-edit-phone').value || '').trim();
            const phone = root.LoyaltyEngine ? root.LoyaltyEngine.normalizePhone(rawPhone) : rawPhone;
            const spend = Number(document.getElementById('cust-edit-spend').value) || 0;
            const tierSelect = document.getElementById('cust-edit-tier').value;

            if (!name) {
                showToast("Vui lòng nhập họ tên khách hàng", "error");
                return;
            }
            if (!phone || phone.length < 9) {
                showToast("Vui lòng nhập số điện thoại hợp lệ", "error");
                return;
            }

            const initialPts = Number(cust.points) || 0;
            const directPtsVal = document.getElementById('cust-edit-points-current').value;
            const directPts = directPtsVal !== '' ? Number(directPtsVal) : initialPts;

            // Xu ly dieu chinh diem thu cong (neu co nhap)
            const adjustAction = document.getElementById('cust-adjust-points-action').value;
            const adjustAmount = Number(document.getElementById('cust-adjust-points-amount').value) || 0;
            const adjustReason = (document.getElementById('cust-adjust-points-reason').value || '').trim();

            let finalPts = initialPts;
            let transactionRecorded = false;
            let pointsUsedRecord = 0;
            let pointsEarnedRecord = 0;
            let finalReason = adjustReason;

            if (adjustAmount > 0) {
                transactionRecorded = true;
                if (adjustAction === 'ADD') {
                    finalPts = initialPts + adjustAmount;
                    pointsEarnedRecord = adjustAmount;
                    finalReason = adjustReason || `Admin cộng thêm ${formatNumber(adjustAmount)} điểm`;
                } else if (adjustAction === 'SUBTRACT') {
                    if (adjustAmount >= initialPts) {
                        finalPts = 0;
                        pointsUsedRecord = initialPts;
                        finalReason = adjustReason || `Admin trừ hết toàn bộ ${formatNumber(initialPts)} điểm về 0`;
                    } else {
                        finalPts = initialPts - adjustAmount;
                        pointsUsedRecord = adjustAmount;
                        finalReason = adjustReason || `Admin trừ ${formatNumber(adjustAmount)} điểm`;
                    }
                } else if (adjustAction === 'SET') {
                    finalPts = Math.max(0, adjustAmount);
                    if (finalPts > initialPts) {
                        pointsEarnedRecord = finalPts - initialPts;
                    } else {
                        pointsUsedRecord = initialPts - finalPts;
                    }
                    finalReason = adjustReason || `Admin thiết lập lại số điểm thành ${formatNumber(finalPts)}`;
                }
            } else if (!isNaN(directPts) && directPts !== initialPts) {
                // Người dùng sửa trực tiếp trong ô Điểm tích lũy hiện có
                finalPts = Math.max(0, directPts);
                transactionRecorded = true;
                if (finalPts > initialPts) {
                    pointsEarnedRecord = finalPts - initialPts;
                } else {
                    pointsUsedRecord = initialPts - finalPts;
                }
                finalReason = adjustReason || `Admin cập nhật trực tiếp điểm thành ${formatNumber(finalPts)}`;
            }

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.updateDoc) return;

            try {
                // Tinh toan lai tier dua tren tong chi tieu neu nguoi dung de auto
                const calculatedTier = root.LoyaltyEngine ? root.LoyaltyEngine.getTierBySpend(spend).id : tierSelect;
                const finalTier = tierSelect || calculatedTier;

                await ops.updateDoc(ops.doc(db, 'customers', cust.id), {
                    name: name,
                    phone: phone,
                    points: Math.max(0, finalPts),
                    total_spend: Math.max(0, spend),
                    tier: finalTier,
                    updated_at: ops.serverTimestamp()
                });

                // Cập nhật ngay trong mảng allCustomers bộ nhớ local
                cust.name = name;
                cust.phone = phone;
                cust.points = Math.max(0, finalPts);
                cust.total_spend = Math.max(0, spend);
                cust.tier = finalTier;
                this.renderCustomerTable();

                if (transactionRecorded && ops.collection && ops.addDoc) {
                    await ops.addDoc(ops.collection(db, 'loyalty_transactions'), {
                        customer_id: cust.id,
                        customer_name: name,
                        customer_phone: phone,
                        order_id: 'MANUAL_ADJUST',
                        table_name: 'ADMIN',
                        bill_total: 0,
                        net_paid: 0,
                        points_used: pointsUsedRecord,
                        points_earned: pointsEarnedRecord,
                        points_balance: finalPts,
                        note: finalReason,
                        created_at: ops.serverTimestamp()
                    });
                }

                // Đồng bộ sang AdminLoyalty và cập nhật Firestore tables cho bất kỳ bàn nào đang gắn khách hàng này
                if (root.AdminLoyalty && typeof root.AdminLoyalty.syncCustomersFromList === 'function') {
                    root.AdminLoyalty.syncCustomersFromList(allCustomers);
                }
                if (root.AdminLoyalty && typeof root.AdminLoyalty.updateCustomerInAllActiveTables === 'function') {
                    root.AdminLoyalty.updateCustomerInAllActiveTables({
                        id: cust.id,
                        name: name,
                        phone: phone,
                        points: Math.max(0, finalPts),
                        total_spend: Math.max(0, spend),
                        tier: finalTier
                    });
                }

                this.closeEditModal();
                showToast(`Đã cập nhật thành công tài khoản: ${name}`, "success");
            } catch (err) {
                console.error("Lỗi cập nhật khách hàng: ", err);
                showToast("Lỗi cập nhật: " + err.message, "error");
            }
        },

        deleteCustomer: async function(custId) {
            if (!canEdit()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền xóa tài khoản khách hàng", "error");
                return;
            }

            const cust = allCustomers.find(c => c.id === custId);
            if (!cust) return;

            const confirmed = confirm(`Xác nhận xóa tài khoản khách hàng "${cust.name}" (${cust.phone})?\nThao tác này không thể hoàn tác!`);
            if (!confirmed) return;

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.deleteDoc) return;

            try {
                await ops.deleteDoc(ops.doc(db, 'customers', custId));
                showToast(`Đã xóa thành công tài khoản: ${cust.name}`, "success");
            } catch (err) {
                console.error("Lỗi xóa khách hàng: ", err);
                showToast("Lỗi xóa: " + err.message, "error");
            }
        },

        // Modal Lich Su Giao Dich Tich Diem / Tru Diem
        openHistoryModal: async function(custId) {
            const cust = allCustomers.find(c => c.id === custId);
            if (!cust) return;

            document.getElementById('cust-history-name').textContent = cust.name || 'Khách hàng';
            document.getElementById('cust-history-phone').textContent = cust.phone || '--';
            document.getElementById('cust-history-points').textContent = formatNumber(cust.points || 0) + ' điểm';

            const tableBody = document.getElementById('cust-history-table-body');
            const loadingEl = document.getElementById('cust-history-loading');
            const emptyEl = document.getElementById('cust-history-empty');

            if (tableBody) tableBody.innerHTML = '';
            if (loadingEl) loadingEl.classList.remove('hidden');
            if (emptyEl) emptyEl.classList.add('hidden');

            const modal = document.getElementById('modal-customer-history');
            if (modal) modal.classList.remove('hidden');

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.collection || !ops.getDocs || !ops.query || !ops.where) {
                if (loadingEl) loadingEl.classList.add('hidden');
                return;
            }

            try {
                const q = ops.query(
                    ops.collection(db, 'loyalty_transactions'),
                    ops.where('customer_id', '==', custId)
                );
                const snap = await ops.getDocs(q);

                const txs = [];
                snap.forEach(d => txs.push({ ...d.data(), id: d.id }));

                txs.sort((a, b) => {
                    const tA = (a.created_at && a.created_at.toMillis) ? a.created_at.toMillis() : 0;
                    const tB = (b.created_at && b.created_at.toMillis) ? b.created_at.toMillis() : 0;
                    return tB - tA;
                });

                if (loadingEl) loadingEl.classList.add('hidden');

                if (txs.length === 0) {
                    if (emptyEl) emptyEl.classList.remove('hidden');
                    return;
                }

                let html = '';
                txs.forEach((tx, idx) => {
                    let timeStr = '--';
                    if (tx.created_at && tx.created_at.toDate) {
                        const d = tx.created_at.toDate();
                        timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} - ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
                    }

                    const ptsUsed = Number(tx.points_used) || 0;
                    const ptsEarned = Number(tx.points_earned) || 0;
                    const balance = Number(tx.points_balance) || 0;
                    const orderId = tx.order_id || '--';
                    const table = tx.table_name ? `Bàn ${tx.table_name}` : '--';
                    const note = tx.note || '';

                    html += `
                        <tr class="border-b border-gray-100 text-xs hover:bg-gray-50">
                            <td class="p-2.5 font-mono text-gray-500 text-[11px]">${timeStr}</td>
                            <td class="p-2.5">
                                <span class="font-bold text-gray-900">${escapeHtml(table)}</span>
                                <span class="block text-[10px] text-gray-400 font-mono">${escapeHtml(orderId)}</span>
                                ${note ? `<span class="block text-[10px] text-amber-800 font-semibold mt-0.5">${escapeHtml(note)}</span>` : ''}
                            </td>
                            <td class="p-2.5 text-right font-semibold text-gray-700">
                                ${formatMoney(tx.bill_total || 0)}
                            </td>
                            <td class="p-2.5 text-right font-bold text-red-600">
                                ${ptsUsed > 0 ? `-${formatNumber(ptsUsed)}` : '--'}
                            </td>
                            <td class="p-2.5 text-right font-bold text-emerald-600">
                                ${ptsEarned > 0 ? `+${formatNumber(ptsEarned)}` : '--'}
                            </td>
                            <td class="p-2.5 text-right font-bold text-amber-900 font-mono">
                                ${formatNumber(balance)} điểm
                            </td>
                        </tr>
                    `;
                });

                if (tableBody) tableBody.innerHTML = html;
            } catch (err) {
                console.error("Lỗi tải lịch sử giao dịch loyalty: ", err);
                if (loadingEl) loadingEl.classList.add('hidden');
                showToast("Lỗi tải lịch sử: " + err.message, "error");
            }
        },

        closeHistoryModal: function() {
            const modal = document.getElementById('modal-customer-history');
            if (modal) modal.classList.add('hidden');
        },

        getCustomerById: function(id) {
            if (!id || !allCustomers || !allCustomers.length) return null;
            return allCustomers.find(c => c.id === id) || null;
        },

        getCustomerByPhone: function(phone) {
            if (!phone || !allCustomers || !allCustomers.length) return null;
            const norm = root.LoyaltyEngine ? root.LoyaltyEngine.normalizePhone(phone) : phone;
            return allCustomers.find(c => {
                const cNorm = root.LoyaltyEngine ? root.LoyaltyEngine.normalizePhone(c.phone) : c.phone;
                return cNorm === norm || c.phone === phone;
            }) || null;
        },

        getAllCustomers: function() {
            return allCustomers;
        }
    };

    root.AdminCustomerLoyalty = AdminCustomerLoyalty;
})(typeof window !== 'undefined' ? window : this);
