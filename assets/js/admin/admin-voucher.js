// =====================================================================
// AURORA SYSTEM - ADMIN VOUCHER & CAMPAIGN MANAGEMENT MODULE
// Quan ly chong gian lan, custom chien dich, sinh ma theo lo, gach ngang ma da dung
// Chi cap Admin tro len moi duoc phep truy cap va can thiep
// =====================================================================

(function(root) {
    'use strict';

    function getDb() { return root.firebaseDb || root.db || (typeof window !== 'undefined' ? (window.firebaseDb || window.db) : null); }
    function getOps() { return root.firebaseOps || (typeof window !== 'undefined' ? window.firebaseOps : {}) || {}; }

    let campaigns = [];
    let voucherCodes = [];
    let currentFilterCampaign = 'ALL';
    let currentFilterStatus = 'ALL';
    let currentSearchCode = '';
    let campaignsUnsub = null;
    let vouchersUnsub = null;

    function formatMoney(num) {
        return (Number(num) || 0).toLocaleString('vi-VN') + ' VNĐ';
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

    function canManageVouchers() {
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

    function showToast(msg, type = 'info') {
        if (typeof root.showAdminToast === 'function') {
            root.showAdminToast(msg, type);
        } else if (typeof window !== 'undefined' && typeof window.showAdminToast === 'function') {
            window.showAdminToast(msg, type);
        } else {
            alert(msg);
        }
    }

    const AdminVoucher = {
        init: function() {
            this.listenCampaignsRealtime();
            this.listenVoucherCodesRealtime();
        },

        listenCampaignsRealtime: function() {
            const db = getDb();
            const ops = getOps();
            if (!db || !ops.collection || !ops.onSnapshot) return;

            if (campaignsUnsub) {
                campaignsUnsub();
                campaignsUnsub = null;
            }

            const col = ops.collection(db, 'voucher_campaigns');
            campaignsUnsub = ops.onSnapshot(col, (snap) => {
                const list = [];
                snap.forEach(d => {
                    list.push({ id: d.id, ...d.data() });
                });
                list.sort((a, b) => {
                    const tA = (a.created_at && a.created_at.toMillis) ? a.created_at.toMillis() : 0;
                    const tB = (b.created_at && b.created_at.toMillis) ? b.created_at.toMillis() : 0;
                    return tB - tA;
                });
                campaigns = list;
                this.renderCampaignsUI();
                this.updateCampaignFilterSelect();
            }, (err) => {
                console.error("Loi lang nghe voucher_campaigns: ", err);
            });
        },

        listenVoucherCodesRealtime: function() {
            const db = getDb();
            const ops = getOps();
            if (!db || !ops.collection || !ops.onSnapshot) return;

            if (vouchersUnsub) {
                vouchersUnsub();
                vouchersUnsub = null;
            }

            const col = ops.collection(db, 'voucher_codes');
            vouchersUnsub = ops.onSnapshot(col, (snap) => {
                const list = [];
                snap.forEach(d => {
                    list.push({ id: d.id, ...d.data() });
                });
                list.sort((a, b) => {
                    const tA = (a.created_at && a.created_at.toMillis) ? a.created_at.toMillis() : 0;
                    const tB = (b.created_at && b.created_at.toMillis) ? b.created_at.toMillis() : 0;
                    return tB - tA;
                });
                voucherCodes = list;
                this.renderVoucherCodesUI();
                this.updateCountersUI();
            }, (err) => {
                console.error("Loi lang nghe voucher_codes: ", err);
            });
        },

        updateCountersUI: function() {
            const total = voucherCodes.length;
            const used = voucherCodes.filter(v => v.status === 'used').length;
            const available = total - used;

            const elTotal = document.getElementById('voucher-stat-total');
            if (elTotal) elTotal.textContent = total;
            const elUsed = document.getElementById('voucher-stat-used');
            if (elUsed) elUsed.textContent = used;
            const elAvail = document.getElementById('voucher-stat-avail');
            if (elAvail) elAvail.textContent = available;
        },

        renderCampaignsUI: function() {
            const container = document.getElementById('voucher-campaigns-list');
            if (!container) return;

            if (campaigns.length === 0) {
                container.innerHTML = `
                    <div class="col-span-full py-10 text-center text-gray-500 bg-white rounded-2xl border border-gray-200">
                        Chưa có chiến dịch voucher nào được tạo. Bấm "Thêm Chiến Dịch Mới" để bắt đầu.
                    </div>
                `;
                return;
            }

            let html = '';
            campaigns.forEach(c => {
                const codesCount = voucherCodes.filter(v => v.campaign_id === c.id).length;
                const usedCount = voucherCodes.filter(v => v.campaign_id === c.id && v.status === 'used').length;
                const desc = root.VoucherEngine ? root.VoucherEngine.formatVoucherDescription(c) : '';

                html += `
                    <div class="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between space-y-3">
                        <div>
                            <div class="flex items-center justify-between gap-2">
                                <h4 class="font-bold text-gray-900 text-sm truncate">${escapeHtml(c.name)}</h4>
                                <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${c.status === 'disabled' ? 'bg-gray-100 text-gray-600' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">
                                    ${c.status === 'disabled' ? 'Tạm ngưng' : 'Đang áp dụng'}
                                </span>
                            </div>
                            <p class="text-xs font-semibold text-[#b89728] mt-1">${escapeHtml(desc)}</p>
                            <div class="text-[11px] text-gray-500 mt-2 space-y-0.5">
                                <div>Điều kiện đơn tối thiểu: <b>${formatMoney(c.min_bill || 0)}</b></div>
                                ${c.valid_to ? `<div>Hạn dùng: đến ${new Date(root.VoucherEngine._toMillis(c.valid_to)).toLocaleDateString('vi-VN')}</div>` : ''}
                                <div class="pt-1 text-gray-700 font-medium">Đã sinh: <b>${codesCount}</b> mã | Đã dùng: <b class="text-purple-700">${usedCount}</b> mã</div>
                            </div>
                        </div>

                        <div class="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                            <button onclick="AdminVoucher.openBatchGenerateModal('${c.id}')" class="flex-1 py-1.5 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs rounded-xl border border-amber-200 transition text-center">
                                Sinh mã theo lô
                            </button>
                            <button onclick="AdminVoucher.printVoucherCards('${c.id}')" class="py-1.5 px-2.5 bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold text-xs rounded-xl border border-blue-200 transition" title="In danh sách voucher để phát cho khách">
                                In thẻ
                            </button>
                            <button onclick="AdminVoucher.openEditCampaignModal('${c.id}')" class="py-1.5 px-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl border border-gray-200 transition" title="Chỉnh sửa chiến dịch hoặc xóa">
                                Sửa
                            </button>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        },

        updateCampaignFilterSelect: function() {
            const select = document.getElementById('voucher-filter-campaign');
            if (!select) return;

            let html = '<option value="ALL">Tất cả chiến dịch</option>';
            campaigns.forEach(c => {
                html += `<option value="${c.id}">${escapeHtml(c.name)}</option>`;
            });
            select.innerHTML = html;
            select.value = currentFilterCampaign;
        },

        renderVoucherCodesUI: function() {
            const tableBody = document.getElementById('voucher-codes-table-body');
            if (!tableBody) return;

            let filtered = voucherCodes;

            if (currentFilterCampaign !== 'ALL') {
                filtered = filtered.filter(v => v.campaign_id === currentFilterCampaign);
            }

            if (currentFilterStatus !== 'ALL') {
                filtered = filtered.filter(v => v.status === currentFilterStatus);
            }

            if (currentSearchCode) {
                const q = currentSearchCode.toLowerCase();
                filtered = filtered.filter(v =>
                    (v.id && v.id.toLowerCase().includes(q)) ||
                    (v.campaign_name && v.campaign_name.toLowerCase().includes(q)) ||
                    (v.used_table_id && v.used_table_id.toLowerCase().includes(q))
                );
            }

            if (filtered.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="6" class="py-10 text-center text-gray-400 text-xs">
                            Không tìm thấy mã voucher nào phù hợp bộ lọc.
                        </td>
                    </tr>
                `;
                return;
            }

            let html = '';
            filtered.forEach(v => {
                const isUsed = v.status === 'used';
                const usedTimeStr = v.used_at ? new Date(root.VoucherEngine._toMillis(v.used_at)).toLocaleString('vi-VN') : '';
                const desc = root.VoucherEngine ? root.VoucherEngine.formatVoucherDescription(v) : '';

                // Quy tac chong gian lan: Ma da dung bi gach ngang ro rang
                const codeClass = isUsed 
                    ? 'line-through text-gray-400 font-mono tracking-wider font-bold' 
                    : 'text-gray-900 font-mono tracking-wider font-bold bg-amber-50/70 border border-amber-200 px-2 py-0.5 rounded-lg';

                const rowBg = isUsed ? 'bg-gray-50/70 text-gray-400' : 'bg-white hover:bg-amber-50/20';

                html += `
                    <tr class="border-b border-gray-100 transition ${rowBg} text-xs">
                        <td class="py-3 px-3">
                            <span class="${codeClass}">${escapeHtml(v.id)}</span>
                        </td>
                        <td class="py-3 px-3">
                            <div class="font-bold text-gray-800">${escapeHtml(v.campaign_name || 'Voucher')}</div>
                            <div class="text-[11px] text-[#b89728] font-medium">${escapeHtml(desc)}</div>
                        </td>
                        <td class="py-3 px-3">
                            <div>Đơn từ: <b>${formatMoney(v.min_bill || 0)}</b></div>
                        </td>
                        <td class="py-3 px-3">
                            ${isUsed ? `
                                <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-700">
                                    ĐÃ SỬ DỤNG
                                </span>
                            ` : `
                                <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                    CHƯA DÙNG
                                </span>
                            `}
                        </td>
                        <td class="py-3 px-3">
                            ${isUsed ? `
                                <div class="text-[11px] text-gray-600">
                                    <div>Bàn: <b>${escapeHtml(v.used_table_id || 'N/A')}</b></div>
                                    <div>Thời gian: ${usedTimeStr}</div>
                                    ${v.used_by ? `<div>Nhân viên: ${escapeHtml(v.used_by)}</div>` : ''}
                                </div>
                            ` : '<span class="text-gray-400 italic">Sẵn sàng phát cho khách</span>'}
                        </td>
                        <td class="py-3 px-3 text-right">
                            <button onclick="AdminVoucher.deleteVoucherCode('${v.id}')" class="py-1 px-2 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold transition">
                                Xóa
                            </button>
                        </td>
                    </tr>
                `;
            });

            tableBody.innerHTML = html;
        },

        populateDishSelect: function() {
            const dishSelect = document.getElementById('voucher-new-dish-select');
            if (dishSelect && root.allDishes && Array.isArray(root.allDishes)) {
                let dHtml = '<option value="">-- Chọn món ăn được tặng --</option>';
                root.allDishes.forEach(d => {
                    dHtml += `<option value="${d.id}" data-name="${escapeHtml(d.name)}">${escapeHtml(d.name)} (${formatMoney(d.price)})</option>`;
                });
                dishSelect.innerHTML = dHtml;
            }
        },

        // Modal Tao Campaign Mua
        openCreateCampaignModal: function() {
            if (!canManageVouchers()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền tạo chiến dịch Voucher", "error");
                return;
            }

            // Xoa sach toan bo form ve trang thai ban dau
            this.resetCreateCampaignForm();

            // Nap danh sach mon an de phuc vu loai voucher tang mon
            this.populateDishSelect();

            const modal = document.getElementById('modal-voucher-campaign');
            if (modal) modal.classList.remove('hidden');
        },

        openEditCampaignModal: function(campaignId) {
            if (!canManageVouchers()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền chỉnh sửa chiến dịch Voucher", "error");
                return;
            }

            const campaign = campaigns.find(c => c.id === campaignId);
            if (!campaign) {
                showToast("Không tìm thấy chiến dịch voucher", "error");
                return;
            }

            this.resetCreateCampaignForm();
            this.populateDishSelect();

            // Gan id chien dich dang sua
            const idInput = document.getElementById('voucher-campaign-id');
            if (idInput) idInput.value = campaign.id;

            // Cap nhat tieu de modal va nut submit
            const title = document.getElementById('modal-voucher-campaign-title');
            if (title) title.textContent = "Chỉnh Sửa Chiến Dịch Voucher";

            const saveBtn = document.getElementById('btn-save-campaign-submit');
            if (saveBtn) saveBtn.textContent = "Lưu Thay Đổi";

            // Hien nut xoa chien dich trong modal
            const delBtn = document.getElementById('btn-delete-campaign-in-modal');
            if (delBtn) delBtn.classList.remove('hidden');

            // Hien va gan gia tri cho trang thai chien dich
            const statusGroup = document.getElementById('voucher-campaign-status-group');
            if (statusGroup) statusGroup.classList.remove('hidden');
            const statusSelect = document.getElementById('voucher-campaign-status');
            if (statusSelect) statusSelect.value = campaign.status || 'active';

            // Dien thong tin chien dich vao form
            const nameInput = document.getElementById('voucher-campaign-name');
            if (nameInput) nameInput.value = campaign.name || '';

            const typeSelect = document.getElementById('voucher-campaign-type');
            if (typeSelect) typeSelect.value = campaign.type || 'fixed';

            const fixedVal = document.getElementById('voucher-val-fixed');
            if (fixedVal) fixedVal.value = campaign.type === 'fixed' ? (campaign.value || '') : '';

            const percentVal = document.getElementById('voucher-val-percent');
            if (percentVal) percentVal.value = campaign.type === 'percent' ? (campaign.value || '') : '';

            const maxDiscount = document.getElementById('voucher-val-max-discount');
            if (maxDiscount) maxDiscount.value = campaign.max_discount || '';

            const dishSelect = document.getElementById('voucher-new-dish-select');
            if (dishSelect) dishSelect.value = campaign.specific_dish_id || '';

            const minBill = document.getElementById('voucher-campaign-min-bill');
            if (minBill) minBill.value = campaign.min_bill || '';

            const validToInput = document.getElementById('voucher-campaign-valid-to');
            if (validToInput) {
                if (campaign.valid_to) {
                    const d = new Date(root.VoucherEngine ? root.VoucherEngine._toMillis(campaign.valid_to) : campaign.valid_to);
                    if (!isNaN(d.getTime())) {
                        const yyyy = d.getFullYear();
                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                        const dd = String(d.getDate()).padStart(2, '0');
                        validToInput.value = `${yyyy}-${mm}-${dd}`;
                    } else {
                        validToInput.value = '';
                    }
                } else {
                    validToInput.value = '';
                }
            }

            this.onTypeChange(campaign.type || 'fixed');

            const modal = document.getElementById('modal-voucher-campaign');
            if (modal) modal.classList.remove('hidden');
        },

        deleteCampaignFromModal: async function() {
            const idInput = document.getElementById('voucher-campaign-id');
            const campaignId = idInput ? idInput.value : '';
            if (!campaignId) return;

            const success = await this.deleteCampaign(campaignId);
            if (success) {
                this.closeCreateCampaignModal();
            }
        },

        resetCreateCampaignForm: function() {
            const idInput = document.getElementById('voucher-campaign-id');
            if (idInput) idInput.value = '';

            const title = document.getElementById('modal-voucher-campaign-title');
            if (title) title.textContent = "Tạo Chiến Dịch Voucher Mới";

            const saveBtn = document.getElementById('btn-save-campaign-submit');
            if (saveBtn) saveBtn.textContent = "Lưu Chiến Dịch";

            const delBtn = document.getElementById('btn-delete-campaign-in-modal');
            if (delBtn) delBtn.classList.add('hidden');

            const statusGroup = document.getElementById('voucher-campaign-status-group');
            if (statusGroup) statusGroup.classList.add('hidden');

            const nameInput = document.getElementById('voucher-campaign-name');
            if (nameInput) nameInput.value = '';

            const typeSelect = document.getElementById('voucher-campaign-type');
            if (typeSelect) typeSelect.value = 'fixed';

            const fixedVal = document.getElementById('voucher-val-fixed');
            if (fixedVal) fixedVal.value = '';

            const percentVal = document.getElementById('voucher-val-percent');
            if (percentVal) percentVal.value = '';

            const maxDiscount = document.getElementById('voucher-val-max-discount');
            if (maxDiscount) maxDiscount.value = '';

            const dishSelect = document.getElementById('voucher-new-dish-select');
            if (dishSelect) dishSelect.value = '';

            const minBill = document.getElementById('voucher-campaign-min-bill');
            if (minBill) minBill.value = '';

            const validTo = document.getElementById('voucher-campaign-valid-to');
            if (validTo) validTo.value = '';

            this.onTypeChange('fixed');
        },

        closeCreateCampaignModal: function() {
            this.resetCreateCampaignForm();
            const modal = document.getElementById('modal-voucher-campaign');
            if (modal) modal.classList.add('hidden');
        },

        onTypeChange: function(type) {
            const percentGroup = document.getElementById('voucher-type-percent-group');
            const fixedGroup = document.getElementById('voucher-type-fixed-group');
            const dishGroup = document.getElementById('voucher-type-dish-group');

            if (percentGroup) percentGroup.classList.add('hidden');
            if (fixedGroup) fixedGroup.classList.add('hidden');
            if (dishGroup) dishGroup.classList.add('hidden');

            if (type === 'percent') {
                if (percentGroup) percentGroup.classList.remove('hidden');
            } else if (type === 'fixed') {
                if (fixedGroup) fixedGroup.classList.remove('hidden');
            } else if (type === 'dish') {
                if (dishGroup) dishGroup.classList.remove('hidden');
            }
        },

        saveCampaign: async function() {
            if (!canManageVouchers()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền can thiệp Voucher", "error");
                return;
            }

            const campaignId = (document.getElementById('voucher-campaign-id')?.value || '').trim();
            const name = (document.getElementById('voucher-campaign-name').value || '').trim();
            const type = document.getElementById('voucher-campaign-type').value || 'fixed';
            const minBill = Number(document.getElementById('voucher-campaign-min-bill').value) || 0;
            const validToInput = document.getElementById('voucher-campaign-valid-to').value;

            if (!name) {
                showToast("Vui lòng nhập tên chiến dịch", "error");
                return;
            }

            let value = 0;
            let maxDiscount = 0;
            let specificDishId = '';
            let specificDishName = '';

            if (type === 'fixed') {
                value = Number(document.getElementById('voucher-val-fixed').value) || 0;
                if (value <= 0) {
                    showToast("Vui lòng nhập số tiền giảm lớn hơn 0", "error");
                    return;
                }
            } else if (type === 'percent') {
                value = Number(document.getElementById('voucher-val-percent').value) || 0;
                maxDiscount = Number(document.getElementById('voucher-val-max-discount').value) || 0;
                if (value <= 0 || value > 100) {
                    showToast("Phần trăm giảm phải từ 1 đến 100%", "error");
                    return;
                }
            } else if (type === 'dish') {
                const dishSelect = document.getElementById('voucher-new-dish-select');
                specificDishId = dishSelect ? dishSelect.value : '';
                const selectedOpt = dishSelect ? dishSelect.options[dishSelect.selectedIndex] : null;
                specificDishName = selectedOpt ? selectedOpt.getAttribute('data-name') : '';
                if (!specificDishId) {
                    showToast("Vui lòng chọn món ăn được tặng", "error");
                    return;
                }
            }

            const db = getDb();
            const ops = getOps();
            if (!db) return;

            const campaignData = {
                name: name,
                type: type,
                value: value,
                max_discount: maxDiscount,
                min_bill: minBill,
                specific_dish_id: specificDishId,
                specific_dish_name: specificDishName
            };

            if (validToInput) {
                const d = new Date(validToInput);
                d.setHours(23, 59, 59, 999);
                campaignData.valid_to = d;
            } else {
                campaignData.valid_to = null;
            }

            if (campaignId) {
                // Che do cap nhat chien dich
                const statusSelect = document.getElementById('voucher-campaign-status');
                const status = statusSelect ? statusSelect.value : 'active';
                campaignData.status = status;
                if (ops.serverTimestamp) {
                    campaignData.updated_at = ops.serverTimestamp();
                }

                try {
                    if (!ops.doc || !ops.updateDoc) return;
                    await ops.updateDoc(ops.doc(db, 'voucher_campaigns', campaignId), campaignData);

                    // Dong bo cac ma voucher chua dung thuoc chien dich nay
                    const codesToUpdate = voucherCodes.filter(v => v.campaign_id === campaignId && v.status !== 'used');
                    if (codesToUpdate.length > 0 && ops.writeBatch) {
                        const CHUNK_SIZE = 400;
                        for (let i = 0; i < codesToUpdate.length; i += CHUNK_SIZE) {
                            const chunk = codesToUpdate.slice(i, i + CHUNK_SIZE);
                            const batch = ops.writeBatch(db);
                            chunk.forEach(v => {
                                const updatePayload = {
                                    campaign_name: name,
                                    type: type,
                                    value: value,
                                    max_discount: maxDiscount,
                                    min_bill: minBill,
                                    specific_dish_id: specificDishId,
                                    specific_dish_name: specificDishName,
                                    valid_to: campaignData.valid_to || null,
                                    status: status === 'disabled' ? 'disabled' : 'available'
                                };
                                batch.update(ops.doc(db, 'voucher_codes', v.id), updatePayload);
                            });
                            await batch.commit();
                        }
                    }

                    showToast("Đã cập nhật chiến dịch voucher thành công!", "success");
                    this.closeCreateCampaignModal();
                } catch (err) {
                    console.error("Loi cap nhat chien dich voucher: ", err);
                    showToast("Lỗi khi cập nhật chiến dịch: " + err.message, "error");
                }
            } else {
                // Che do tao moi chien dich
                campaignData.status = 'active';
                campaignData.created_at = ops.serverTimestamp ? ops.serverTimestamp() : new Date();

                try {
                    if (!ops.collection || !ops.addDoc) return;
                    await ops.addDoc(ops.collection(db, 'voucher_campaigns'), campaignData);
                    showToast("Đã tạo chiến dịch voucher thành công!", "success");
                    this.closeCreateCampaignModal();
                } catch (err) {
                    console.error("Loi tao chien dich voucher: ", err);
                    showToast("Lỗi khi lưu chiến dịch: " + err.message, "error");
                }
            }
        },

        deleteCampaign: async function(campaignId) {
            if (!canManageVouchers()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền xóa Voucher", "error");
                return false;
            }

            if (!confirm("Bạn có chắc chắn muốn xóa chiến dịch này và TẤT CẢ mã voucher đã sinh thuộc về nó không?")) {
                return false;
            }

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.deleteDoc) return false;

            try {
                // Xoa chien dich
                await ops.deleteDoc(ops.doc(db, 'voucher_campaigns', campaignId));

                // Xoa cac ma thuoc ve chien dich
                const codesToDelete = voucherCodes.filter(v => v.campaign_id === campaignId);
                if (codesToDelete.length > 0 && ops.writeBatch) {
                    const CHUNK_SIZE = 400;
                    for (let i = 0; i < codesToDelete.length; i += CHUNK_SIZE) {
                        const chunk = codesToDelete.slice(i, i + CHUNK_SIZE);
                        const batch = ops.writeBatch(db);
                        chunk.forEach(c => {
                            batch.delete(ops.doc(db, 'voucher_codes', c.id));
                        });
                        await batch.commit();
                    }
                }

                showToast("Đã xóa chiến dịch và các mã voucher liên quan", "success");
                return true;
            } catch (err) {
                console.error("Loi xoa chien dich: ", err);
                showToast("Lỗi khi xóa: " + err.message, "error");
                return false;
            }
        },

        // Modal Sinh Ma Theo Lo (Batch Generator)
        openBatchGenerateModal: function(campaignId) {
            if (!canManageVouchers()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền sinh mã Voucher", "error");
                return;
            }

            const campaign = campaigns.find(c => c.id === campaignId);
            if (!campaign) return;

            document.getElementById('batch-gen-campaign-id').value = campaign.id;
            document.getElementById('batch-gen-campaign-name').textContent = campaign.name;
            const desc = root.VoucherEngine ? root.VoucherEngine.formatVoucherDescription(campaign) : '';
            document.getElementById('batch-gen-campaign-desc').textContent = desc;

            const countInput = document.getElementById('batch-gen-count');
            if (countInput) countInput.value = '40';
            const prefixInput = document.getElementById('batch-gen-prefix');
            if (prefixInput) prefixInput.value = 'AUR';

            const modal = document.getElementById('modal-voucher-batch');
            if (modal) modal.classList.remove('hidden');
        },

        closeBatchGenerateModal: function() {
            const modal = document.getElementById('modal-voucher-batch');
            if (modal) modal.classList.add('hidden');
        },

        executeBatchGenerate: async function() {
            if (!canManageVouchers()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền sinh mã Voucher", "error");
                return;
            }

            const campaignId = document.getElementById('batch-gen-campaign-id').value;
            const count = Math.max(1, Math.min(200, Number(document.getElementById('batch-gen-count').value) || 40));
            const prefix = (document.getElementById('batch-gen-prefix').value || 'AUR').trim().toUpperCase();

            const campaign = campaigns.find(c => c.id === campaignId);
            if (!campaign) {
                showToast("Không tìm thấy chiến dịch đã chọn", "error");
                return;
            }

            const existingSet = new Set(voucherCodes.map(v => v.id));
            const generatedCodes = root.VoucherEngine.generateBatchCodes(count, prefix, existingSet);

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.writeBatch || !ops.doc) return;

            try {
                const batch = ops.writeBatch(db);
                generatedCodes.forEach(code => {
                    const codeRef = ops.doc(db, 'voucher_codes', code);
                    batch.set(codeRef, {
                        campaign_id: campaign.id,
                        campaign_name: campaign.name,
                        type: campaign.type,
                        value: campaign.value,
                        max_discount: campaign.max_discount || 0,
                        min_bill: campaign.min_bill || 0,
                        specific_dish_id: campaign.specific_dish_id || '',
                        specific_dish_name: campaign.specific_dish_name || '',
                        status: 'available',
                        valid_from: campaign.valid_from || null,
                        valid_to: campaign.valid_to || null,
                        created_at: ops.serverTimestamp()
                    });
                });

                await batch.commit();
                showToast(`Đã sinh thành công ${generatedCodes.length} mã voucher mới cho chiến dịch!`, "success");
                this.closeBatchGenerateModal();
            } catch (err) {
                console.error("Lỗi sinh mã voucher theo lô: ", err);
                showToast("Lỗi khi sinh mã: " + err.message, "error");
            }
        },

        deleteVoucherCode: async function(codeId) {
            if (!canManageVouchers()) {
                showToast("Chỉ quản trị viên cấp Admin trở lên mới có quyền xóa Voucher", "error");
                return;
            }

            if (!confirm(`Bạn có chắc muốn xóa mã voucher ${codeId} không?`)) {
                return;
            }

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.deleteDoc) return;

            try {
                await ops.deleteDoc(ops.doc(db, 'voucher_codes', codeId));
                showToast(`Đã xóa mã voucher ${codeId}`, "success");
            } catch (err) {
                console.error("Lỗi xóa mã: ", err);
                showToast("Lỗi khi xóa: " + err.message, "error");
            }
        },

        // In Thẻ Voucher để Phát Cho Khách Hàng
        printVoucherCards: function(campaignId) {
            const campaign = campaigns.find(c => c.id === campaignId);
            if (!campaign) return;

            const codes = voucherCodes.filter(v => v.campaign_id === campaignId && v.status === 'available');
            if (codes.length === 0) {
                showToast("Chiến dịch này không có mã khả dụng nào để in. Vui lòng sinh thêm mã!", "info");
                return;
            }

            const desc = root.VoucherEngine ? root.VoucherEngine.formatVoucherDescription(campaign) : '';
            const minBillStr = (campaign.min_bill > 0) ? `Áp dụng cho đơn từ ${formatMoney(campaign.min_bill)}` : 'Áp dụng cho mọi đơn hàng';
            const validToStr = campaign.valid_to ? `Hạn dùng đến: ${new Date(root.VoucherEngine._toMillis(campaign.valid_to)).toLocaleDateString('vi-VN')}` : 'Không giới hạn thời gian';

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                showToast("Trình duyệt đã chặn cửa sổ popup in. Vui lòng cho phép popup để in voucher!", "error");
                return;
            }

            let cardsHtml = '';
            codes.forEach(c => {
                cardsHtml += `
                    <div class="voucher-card">
                        <div class="header">
                            <span class="brand">AURORA LOUNGE</span>
                            <span class="badge">VOUCHER</span>
                        </div>
                        <div class="title">${escapeHtml(campaign.name)}</div>
                        <div class="offer">${escapeHtml(desc)}</div>
                        <div class="code-box">
                            <div class="code">${escapeHtml(c.id)}</div>
                        </div>
                        <div class="footer">
                            <div>${escapeHtml(minBillStr)}</div>
                            <div>${escapeHtml(validToStr)}</div>
                        </div>
                    </div>
                `;
            });

            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>In Thẻ Voucher - ${escapeHtml(campaign.name)}</title>
                    <style>
                        @page { size: A4; margin: 10mm; }
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; padding: 0; color: #111; }
                        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12mm; }
                        .voucher-card {
                            border: 2px dashed #b89728;
                            border-radius: 12px;
                            padding: 14px 18px;
                            background: #fffdfa;
                            page-break-inside: avoid;
                            box-sizing: border-box;
                        }
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e5dcc7; padding-bottom: 6px; }
                        .brand { font-size: 13px; font-weight: 900; letter-spacing: 1px; color: #b89728; }
                        .badge { font-size: 10px; font-weight: 800; background: #b89728; color: #fff; padding: 2px 8px; border-radius: 4px; }
                        .title { font-size: 14px; font-weight: 800; margin-top: 10px; color: #222; }
                        .offer { font-size: 16px; font-weight: 900; color: #b89728; margin: 4px 0 10px 0; }
                        .code-box { background: #f5f0e4; border: 1px solid #d4c7a5; border-radius: 6px; text-align: center; padding: 8px; margin: 8px 0; }
                        .code { font-family: monospace; font-size: 18px; font-weight: 900; letter-spacing: 2px; color: #111; }
                        .footer { font-size: 10px; color: #666; margin-top: 8px; line-height: 1.4; border-top: 1px dashed #e5dcc7; padding-top: 6px; }
                    </style>
                </head>
                <body>
                    <div style="margin-bottom: 15px; font-size: 12px; color: #666; display: flex; justify-content: space-between;">
                        <span>Chiến dịch: <b>${escapeHtml(campaign.name)}</b> (${codes.length} thẻ sẵn sàng in)</span>
                        <span>Ngày in: ${new Date().toLocaleDateString('vi-VN')}</span>
                    </div>
                    <div class="grid">
                        ${cardsHtml}
                    </div>
                    <script>
                        window.onload = function() {
                            window.print();
                        };
                    </script>
                </body>
                </html>
            `;

            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();
        },

        // Helper cho Table / Bill Checkout:
        // Kiem tra ma voucher do nhan vien nhap vao luc thanh toan (Khoa nguyen tu bang Firestore runTransaction)
        applyVoucherToBill: async function(codeStr, billTotal, billItems, tableName = '') {
            const cleanCode = (codeStr || '').trim().toUpperCase();
            if (!cleanCode) {
                return { success: false, message: 'Vui lòng nhập mã voucher' };
            }

            const db = getDb();
            const ops = getOps();
            const runTx = ops.runTransaction || (typeof root.runTransaction === 'function' ? root.runTransaction : null);
            if (!db || !ops.doc) {
                return { success: false, message: 'Hệ thống cơ sở dữ liệu chưa sẵn sàng' };
            }

            const cleanT = (typeof normalizeTableCode === 'function')
                ? normalizeTableCode(tableName)
                : String(tableName || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();

            try {
                const vDocRef = ops.doc(db, 'voucher_codes', cleanCode);

                if (runTx) {
                    // SỬ DỤNG FIRESTORE TRANSACTION NGUYÊN TỬ: Chống triệt để Race Condition khi 2 bàn cùng áp dụng 1 lúc
                    const txResult = await runTx(db, async (transaction) => {
                        const docSnap = await transaction.get(vDocRef);
                        if (!docSnap.exists()) {
                            throw new Error(`Mã voucher "${cleanCode}" không tồn tại trong hệ thống!`);
                        }
                        const voucherData = docSnap.data();

                        // Kiểm tra tính hợp lệ nghiệp vụ
                        const evalResult = root.VoucherEngine.validateVoucher(voucherData, billTotal, billItems, tableName);
                        if (!evalResult.valid) {
                            throw new Error(evalResult.reason);
                        }

                        // Nếu voucher đã bị bàn khác áp dụng
                        const currentApplied = String(voucherData.applied_table || '').trim().toUpperCase();
                        if (voucherData.status === 'applied' && currentApplied && currentApplied !== cleanT) {
                            throw new Error(`Mã voucher "${cleanCode}" đang được áp dụng tại Bàn ${voucherData.applied_table}!`);
                        }
                        if (voucherData.status === 'used') {
                            throw new Error(`Mã voucher "${cleanCode}" đã được sử dụng trước đó!`);
                        }

                        // Khóa độc quyền voucher cho bàn này
                        transaction.update(vDocRef, {
                            status: 'applied',
                            applied_table: cleanT,
                            applied_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                        });

                        return {
                            voucherData,
                            evalResult
                        };
                    });

                    return {
                        success: true,
                        code: cleanCode,
                        voucher: txResult.voucherData,
                        discountAmount: txResult.evalResult.discountAmount,
                        type: txResult.evalResult.type,
                        description: root.VoucherEngine.formatVoucherDescription(txResult.voucherData),
                        message: `Áp dụng thành công: Giảm ${formatMoney(txResult.evalResult.discountAmount)}`
                    };
                } else {
                    // Fallback nếu không có runTransaction
                    const docSnap = await ops.getDoc(vDocRef);
                    if (!docSnap.exists()) {
                        return { success: false, message: `Mã voucher "${cleanCode}" không tồn tại trong hệ thống!` };
                    }
                    const voucherData = docSnap.data();
                    const evalResult = root.VoucherEngine.validateVoucher(voucherData, billTotal, billItems, tableName);
                    if (!evalResult.valid) {
                        return { success: false, message: evalResult.reason };
                    }
                    if (tableName && ops.updateDoc) {
                        await ops.updateDoc(vDocRef, {
                            status: 'applied',
                            applied_table: cleanT,
                            applied_at: ops.serverTimestamp ? ops.serverTimestamp() : new Date()
                        });
                    }
                    return {
                        success: true,
                        code: cleanCode,
                        voucher: voucherData,
                        discountAmount: evalResult.discountAmount,
                        type: evalResult.type,
                        description: root.VoucherEngine.formatVoucherDescription(voucherData),
                        message: `Áp dụng thành công: Giảm ${formatMoney(evalResult.discountAmount)}`
                    };
                }
            } catch (err) {
                console.error("Lỗi kiểm tra voucher: ", err);
                return { success: false, message: err.message || 'Lỗi kiểm tra voucher' };
            }
        },

        // Giải phóng voucher về available nếu bàn hủy áp dụng hoặc giải phóng bàn
        releaseVoucherCode: async function(codeStr) {
            const cleanCode = (codeStr || '').trim().toUpperCase();
            if (!cleanCode) return;
            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.updateDoc || !ops.getDoc) return;
            try {
                const docSnap = await ops.getDoc(ops.doc(db, 'voucher_codes', cleanCode));
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.status === 'applied') {
                        await ops.updateDoc(ops.doc(db, 'voucher_codes', cleanCode), {
                            status: 'available',
                            applied_table: null,
                            applied_at: null
                        });
                    }
                }
            } catch (err) {
                console.warn("Lỗi giải phóng voucher_codes:", err);
            }
        },

        // Kiểm tra tính hợp lệ tối hậu trước khi thanh toán (Chống race condition 1 voucher thanh toán 2 lần)
        verifyVoucherBeforeSettle: async function(codeStr, tableName) {
            const cleanCode = (codeStr || '').trim().toUpperCase();
            if (!cleanCode) return { valid: true };
            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.getDoc) return { valid: true };
            try {
                const docSnap = await ops.getDoc(ops.doc(db, 'voucher_codes', cleanCode));
                if (!docSnap.exists()) {
                    return { valid: false, reason: `Mã voucher "${cleanCode}" không còn tồn tại trong hệ thống!` };
                }
                const data = docSnap.data();
                if (data.status === 'used') {
                    const usedTable = data.used_table_id ? `tại Bàn ${data.used_table_id}` : 'ở bàn khác';
                    return { valid: false, reason: `Mã voucher "${cleanCode}" đã được thanh toán ${usedTable}!` };
                }
                if (data.status === 'disabled' || data.status === 'expired') {
                    return { valid: false, reason: `Mã voucher "${cleanCode}" đã bị vô hiệu hóa hoặc hết hạn sử dụng!` };
                }
                const normApplied = String(data.applied_table || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                const normTarget = String(tableName || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                if (data.status === 'applied' && normApplied && normTarget && normApplied !== normTarget) {
                    return { valid: false, reason: `Mã voucher "${cleanCode}" đang được áp dụng tại Bàn ${data.applied_table}!` };
                }
                return { valid: true, voucher: data };
            } catch (err) {
                console.error("Lỗi xác thực lại voucher trước khi kết bàn:", err);
                return { valid: true };
            }
        },

        // Danh dau ma voucher da duoc su dung khi hoan tat thanh toan bill
        markVoucherAsUsed: async function(codeStr, orderId, tableId, staffUsername) {
            const cleanCode = (codeStr || '').trim().toUpperCase();
            if (!cleanCode) return;

            const db = getDb();
            const ops = getOps();
            if (!db || !ops.doc || !ops.updateDoc) return;

            try {
                await ops.updateDoc(ops.doc(db, 'voucher_codes', cleanCode), {
                    status: 'used',
                    used_at: ops.serverTimestamp(),
                    used_order_id: orderId || '',
                    used_table_id: tableId || '',
                    used_by: staffUsername || '',
                    applied_table: null
                });
            } catch (err) {
                console.error("Loi danh dau voucher da dung: ", err);
            }
        }
    };

    root.AdminVoucher = AdminVoucher;
})(typeof window !== 'undefined' ? window : this);
