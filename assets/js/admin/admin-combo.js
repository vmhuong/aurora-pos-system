// =====================================================================
// AURORA SYSTEM - ADMIN COMBO MANAGEMENT MODULE
// Quan ly tao, sua, cau hinh cac nhom mon tuy chon va phu phi cho Combo
// =====================================================================

(function(root) {
    'use strict';

    function getDb() { return root.firebaseDb || root.db || (typeof window !== 'undefined' ? (window.firebaseDb || window.db) : null); }
    function getOps() { return root.firebaseOps || (typeof window !== 'undefined' ? window.firebaseOps : {}) || {}; }

    let currentComboGroups = [];
    let currentComboImageBase64 = '';
    let activeMultiPickGroupIndex = null;
    let selectedDishIdsForMultiPick = new Set();

    function formatMoney(val) {
        return Number(val || 0).toLocaleString('vi-VN') + ' VNĐ';
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

    function cleanObj(obj) {
        if (obj === undefined) return null;
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj.constructor && obj.constructor.name !== 'Object' && obj.constructor.name !== 'Array') {
            return obj;
        }
        if (Array.isArray(obj)) return obj.map(cleanObj);
        const res = {};
        for (const k in obj) {
            if (obj[k] !== undefined) res[k] = cleanObj(obj[k]);
        }
        return res;
    }

    const AdminCombo = {
        /**
         * Khoi tao va mo modal them/sua Combo
         */
        openModal: async function(comboId = null) {
            if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
                alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền tạo hoặc chỉnh sửa Combo!");
                return;
            }
            const modal = document.getElementById('modal-combo');
            if (!modal) return;

            const allDishes = root.allDishes || [];
            currentComboImageBase64 = '';

            if (comboId) {
                let combo = allDishes.find(d => d.id === comboId);

                // Fallback nếu combo trong RAM chưa có combo_groups, lấy trực tiếp từ Firestore
                if (!combo || !combo.combo_groups || combo.combo_groups.length === 0) {
                    const db = getDb();
                    const ops = getOps();
                    if (db && ops.doc && ops.getDoc) {
                        try {
                            const snap = await ops.getDoc(ops.doc(db, "dishes", comboId));
                            if (snap.exists()) {
                                combo = { id: snap.id, ...snap.data() };
                            }
                        } catch (eSnap) {
                            console.warn("Lỗi đọc Firestore combo:", eSnap);
                        }
                    }
                }

                if (!combo) return;

                document.getElementById('modal-combo-title').innerText = "Chỉnh Sửa Gói Combo";
                document.getElementById('combo-edit-id').value = combo.id;
                document.getElementById('combo-name').value = combo.name || '';
                document.getElementById('combo-name-en').value = combo.name_en || '';
                document.getElementById('combo-price').value = combo.price || 0;
                document.getElementById('combo-desc').value = combo.desc || '';
                document.getElementById('combo-desc-en').value = combo.desc_en || '';

                const rawGroups = Array.isArray(combo.combo_groups) ? JSON.parse(JSON.stringify(combo.combo_groups)) : [];
                currentComboGroups = rawGroups.map(g => ({
                    group_title: g.group_title || '',
                    group_title_en: g.group_title_en || '',
                    min: Number(g.min) || 1,
                    max: Number(g.max) || 1,
                    items: (g.items || []).map(it => {
                        const dMatch = allDishes.find(d => d.id === (it.dish_id || it.id));
                        return {
                            dish_id: it.dish_id || it.id || '',
                            name: it.name || it.dish_name || (dMatch ? dMatch.name : ''),
                            name_en: it.name_en || (dMatch ? dMatch.name_en : '') || '',
                            price: Number(it.price || (dMatch ? dMatch.price : 0)) || 0,
                            extra: Number(it.extra || it.extra_price) || 0
                        };
                    })
                }));

                this.renderImagePreview(combo.img || '');
            } else {
                document.getElementById('modal-combo-title').innerText = "Thêm Gói Combo Mới";
                document.getElementById('combo-edit-id').value = "";
                document.getElementById('combo-name').value = "";
                document.getElementById('combo-name-en').value = "";
                document.getElementById('combo-price').value = "";
                document.getElementById('combo-desc').value = "";
                document.getElementById('combo-desc-en').value = "";

                // Mặc định tạo 1 nhóm ban đầu để người dùng dễ dàng cấu hình
                currentComboGroups = [
                    {
                        group_title: "Chọn Món Chính",
                        group_title_en: "Main Dishes",
                        min: 1,
                        max: 1,
                        items: []
                    }
                ];
                this.renderImagePreview('');
            }

            this.renderGroupsEditor();
            modal.classList.remove('hidden');
        },

        closeModal: function() {
            const modal = document.getElementById('modal-combo');
            if (modal) modal.classList.add('hidden');
        },

        renderImagePreview: function(url) {
            const imgEl = document.getElementById('combo-preview-img');
            const placeholder = document.getElementById('combo-img-placeholder');
            const removeBtn = document.getElementById('combo-remove-img-btn');

            if (url) {
                if (imgEl) {
                    imgEl.src = url;
                    imgEl.classList.remove('hidden');
                }
                if (placeholder) placeholder.classList.add('hidden');
                if (removeBtn) removeBtn.classList.remove('hidden');
            } else {
                if (imgEl) {
                    imgEl.src = '';
                    imgEl.classList.add('hidden');
                }
                if (placeholder) placeholder.classList.remove('hidden');
                if (removeBtn) removeBtn.classList.add('hidden');
            }
        },

        handleImageUpload: function(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxDim = 800;
                    let width = img.width;
                    let height = img.height;

                    if (width > height && width > maxDim) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else if (height > maxDim) {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    currentComboImageBase64 = canvas.toDataURL('image/jpeg', 0.85);
                    this.renderImagePreview(currentComboImageBase64);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        },

        removeImage: function() {
            currentComboImageBase64 = '';
            this.renderImagePreview('');
            const fileInput = document.getElementById('combo-img-file');
            if (fileInput) fileInput.value = '';
        },

        // Đồng bộ dữ liệu người dùng đang nhập trên DOM vào state currentComboGroups
        syncGroupsFromDOM: function() {
            currentComboGroups.forEach((group, gIdx) => {
                const titleInp = document.getElementById(`combo-group-title-${gIdx}`);
                if (titleInp) group.group_title = titleInp.value.trim();

                const minInp = document.getElementById(`combo-group-min-${gIdx}`);
                if (minInp) group.min = Math.max(1, Number(minInp.value) || 1);

                const maxInp = document.getElementById(`combo-group-max-${gIdx}`);
                if (maxInp) group.max = Math.max(1, Number(maxInp.value) || 1);

                (group.items || []).forEach((it, iIdx) => {
                    const extraInp = document.getElementById(`combo-item-extra-${gIdx}-${iIdx}`);
                    if (extraInp) it.extra = Math.max(0, Number(extraInp.value) || 0);
                });
            });
        },

        addGroup: function() {
            this.syncGroupsFromDOM();
            currentComboGroups.push({
                group_title: `Nhóm ${currentComboGroups.length + 1}`,
                group_title_en: `Group ${currentComboGroups.length + 1}`,
                min: 1,
                max: 1,
                items: []
            });
            this.renderGroupsEditor();
        },

        removeGroup: function(groupIndex) {
            this.syncGroupsFromDOM();
            currentComboGroups.splice(groupIndex, 1);
            this.renderGroupsEditor();
        },

        addItemToGroup: function(groupIndex, dishId) {
            this.syncGroupsFromDOM();
            if (!dishId) return;
            const allDishes = root.allDishes || [];
            const dish = allDishes.find(d => d.id === dishId);
            if (!dish) return;

            const group = currentComboGroups[groupIndex];
            if (!group) return;
            if (!Array.isArray(group.items)) group.items = [];

            // Kiểm tra không thêm trùng món trong cùng 1 nhóm
            const exists = group.items.some(it => (it.dish_id || it.id) === dish.id);
            if (exists) {
                showToast("Món này đã có trong nhóm rồi!", "warning");
                return;
            }

            group.items.push({
                dish_id: dish.id,
                name: dish.name,
                name_en: dish.name_en || '',
                price: Number(dish.price) || 0,
                extra: 0
            });

            this.renderGroupsEditor();
            showToast(`Đã thêm món "${dish.name}" vào nhóm`, "success");
        },

        addMultipleDishesToGroup: function(groupIndex, dishIds) {
            this.syncGroupsFromDOM();
            if (!Array.isArray(dishIds) || dishIds.length === 0) return;
            const allDishes = root.allDishes || [];
            const group = currentComboGroups[groupIndex];
            if (!group) return;
            if (!Array.isArray(group.items)) group.items = [];

            let addedCount = 0;
            dishIds.forEach(dId => {
                const dish = allDishes.find(d => d.id === dId);
                if (!dish) return;
                const exists = group.items.some(it => (it.dish_id || it.id) === dish.id);
                if (!exists) {
                    group.items.push({
                        dish_id: dish.id,
                        name: dish.name,
                        name_en: dish.name_en || '',
                        price: Number(dish.price) || 0,
                        extra: 0
                    });
                    addedCount++;
                }
            });

            this.renderGroupsEditor();
            if (addedCount > 0) {
                showToast(`Đã thêm ${addedCount} món vào nhóm thành công!`, "success");
            }
        },

        removeItemFromGroup: function(groupIndex, itemIndex) {
            this.syncGroupsFromDOM();
            const group = currentComboGroups[groupIndex];
            if (!group || !group.items) return;
            group.items.splice(itemIndex, 1);
            this.renderGroupsEditor();
        },

        updateItemExtraPrice: function(groupIndex, itemIndex, value) {
            const group = currentComboGroups[groupIndex];
            if (!group || !group.items || !group.items[itemIndex]) return;
            group.items[itemIndex].extra = Math.max(0, Number(value) || 0);
        },

        updateGroupProp: function(groupIndex, prop, value) {
            const group = currentComboGroups[groupIndex];
            if (!group) return;
            if (prop === 'min' || prop === 'max') {
                group[prop] = Math.max(1, Number(value) || 1);
            } else {
                group[prop] = value;
            }
        },

        // Hộp thoại chọn nhiều món bằng Checklist
        openMultiDishPicker: function(groupIndex) {
            this.syncGroupsFromDOM();
            activeMultiPickGroupIndex = groupIndex;
            selectedDishIdsForMultiPick.clear();

            const group = currentComboGroups[groupIndex];
            const groupTitle = group ? (group.group_title || `Nhóm ${groupIndex + 1}`) : '';
            const subTitleEl = document.getElementById('modal-multi-pick-subtitle');
            if (subTitleEl) subTitleEl.textContent = `Chọn các món muốn thêm vào "${groupTitle}"`;

            const existingDishIds = new Set((group && group.items ? group.items : []).map(it => it.dish_id || it.id));
            this.renderMultiDishPickerList('', existingDishIds);

            const modal = document.getElementById('modal-combo-multi-pick');
            if (modal) modal.classList.remove('hidden');

            const searchInp = document.getElementById('multi-pick-search');
            if (searchInp) {
                searchInp.value = '';
                searchInp.focus();
            }
            this.updateMultiPickCountDisplay();
        },

        closeMultiDishPicker: function() {
            const modal = document.getElementById('modal-combo-multi-pick');
            if (modal) modal.classList.add('hidden');
            activeMultiPickGroupIndex = null;
            selectedDishIdsForMultiPick.clear();
        },

        renderMultiDishPickerList: function(search = '', existingDishIds = new Set()) {
            const container = document.getElementById('multi-pick-dish-list');
            if (!container) return;

            const allDishes = (root.allDishes || []).filter(d => !d.is_combo && String(d.category || '').toUpperCase() !== 'COMBO');
            const cleanSearch = String(search || '').toLowerCase().trim();

            const filtered = allDishes.filter(d => {
                if (!cleanSearch) return true;
                const nameMatch = String(d.name || '').toLowerCase().includes(cleanSearch);
                const catMatch = String(d.category || '').toLowerCase().includes(cleanSearch);
                return nameMatch || catMatch;
            });

            if (filtered.length === 0) {
                container.innerHTML = `<div class="text-center py-8 text-gray-400 text-xs">Không tìm thấy món ăn nào phù hợp.</div>`;
                return;
            }

            let html = '';
            filtered.forEach(d => {
                const isAlreadyInGroup = existingDishIds.has(d.id);
                const isChecked = selectedDishIdsForMultiPick.has(d.id);

                html += `
                    <label class="flex items-center justify-between p-2.5 rounded-xl border ${isAlreadyInGroup ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed' : (isChecked ? 'bg-amber-50 border-amber-400 shadow-2xs cursor-pointer' : 'bg-white border-gray-200 hover:bg-gray-50 cursor-pointer')} transition">
                        <div class="flex items-center gap-2.5 min-w-0 flex-1">
                            <input type="checkbox" 
                                ${isAlreadyInGroup ? 'disabled checked' : (isChecked ? 'checked' : '')}
                                onchange="AdminCombo.toggleMultiPickDish('${d.id}')"
                                class="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-gray-300 ${isAlreadyInGroup ? 'cursor-not-allowed' : 'cursor-pointer'}">
                            <div class="truncate">
                                <span class="font-bold text-xs text-gray-800">${escapeHtml(d.name)}</span>
                                <span class="text-[10px] text-gray-400 block">${d.category || 'Món'} - ${formatMoney(d.price)}</span>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            ${isAlreadyInGroup ? '<span class="text-[10px] text-gray-500 font-semibold bg-gray-200 px-2 py-0.5 rounded-full">Đã có</span>' : `<span class="text-xs font-bold text-amber-700">${formatMoney(d.price)}</span>`}
                        </div>
                    </label>
                `;
            });

            container.innerHTML = html;
        },

        toggleMultiPickDish: function(dishId) {
            if (!dishId) return;
            if (selectedDishIdsForMultiPick.has(dishId)) {
                selectedDishIdsForMultiPick.delete(dishId);
            } else {
                selectedDishIdsForMultiPick.add(dishId);
            }
            this.updateMultiPickCountDisplay();

            const group = (activeMultiPickGroupIndex !== null) ? currentComboGroups[activeMultiPickGroupIndex] : null;
            const existingDishIds = new Set((group && group.items ? group.items : []).map(it => it.dish_id || it.id));
            const searchVal = document.getElementById('multi-pick-search') ? document.getElementById('multi-pick-search').value : '';
            this.renderMultiDishPickerList(searchVal, existingDishIds);
        },

        filterMultiPickerDishes: function(query) {
            const group = (activeMultiPickGroupIndex !== null) ? currentComboGroups[activeMultiPickGroupIndex] : null;
            const existingDishIds = new Set((group && group.items ? group.items : []).map(it => it.dish_id || it.id));
            this.renderMultiDishPickerList(query, existingDishIds);
        },

        updateMultiPickCountDisplay: function() {
            const countEl = document.getElementById('multi-pick-selected-count');
            if (countEl) {
                countEl.textContent = `Đã chọn: ${selectedDishIdsForMultiPick.size} món`;
            }
        },

        confirmMultiDishPicker: function() {
            if (activeMultiPickGroupIndex === null) return;
            if (selectedDishIdsForMultiPick.size === 0) {
                showToast("Vui lòng tick chọn ít nhất 1 món ăn", "warning");
                return;
            }

            const dishIds = Array.from(selectedDishIdsForMultiPick);
            this.addMultipleDishesToGroup(activeMultiPickGroupIndex, dishIds);
            this.closeMultiDishPicker();
        },

        renderGroupsEditor: function() {
            const container = document.getElementById('combo-groups-container');
            if (!container) return;

            const allDishes = (root.allDishes || []).filter(d => !d.is_combo && String(d.category || '').toUpperCase() !== 'COMBO');

            if (currentComboGroups.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-6 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 text-xs">
                        Chưa có nhóm món nào. Bấm <b>"+ Thêm nhóm món"</b> bên dưới để bắt đầu cấu hình.
                    </div>`;
                return;
            }

            let html = '';
            currentComboGroups.forEach((group, gIdx) => {
                const items = group.items || [];
                let itemsHtml = '';

                if (items.length === 0) {
                    itemsHtml = `<div class="text-[11px] text-gray-400 italic py-2">Chưa có món nào trong nhóm này. Hãy bấm "Chọn nhiều món" hoặc chọn từ danh sách bên dưới.</div>`;
                } else {
                    itemsHtml = items.map((it, iIdx) => {
                        const dMatch = allDishes.find(d => d.id === (it.dish_id || it.id));
                        const hasOpts = dMatch && Array.isArray(dMatch.options) && dMatch.options.length > 0;
                        const optSummary = hasOpts ? dMatch.options.map(o => o.name).join(', ') : '';

                        return `
                        <div class="p-2 rounded-xl bg-gray-50 border border-gray-200/70 text-xs space-y-1">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2 flex-1 min-w-0">
                                    <span class="font-bold text-gray-800 truncate">${escapeHtml(it.name)}</span>
                                    <span class="text-gray-400 text-[10px]">(${formatMoney(it.price)})</span>
                                </div>
                                <div class="flex items-center gap-2">
                                    <label class="text-[10px] text-gray-500 whitespace-nowrap">Phụ phí:</label>
                                    <input type="number" id="combo-item-extra-${gIdx}-${iIdx}" step="1000" min="0" value="${it.extra || 0}" 
                                        onchange="AdminCombo.updateItemExtraPrice(${gIdx}, ${iIdx}, this.value)"
                                        placeholder="+VNĐ"
                                        class="w-20 px-2 py-1 bg-white border border-gray-300 rounded-lg text-right font-bold text-amber-700 text-xs focus:ring-1 focus:ring-amber-500">
                                    <button type="button" onclick="AdminCombo.removeItemFromGroup(${gIdx}, ${iIdx})" class="text-red-400 hover:text-red-600 p-1">
                                        <i class="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                            </div>
                            ${hasOpts ? `
                                <div class="flex items-center gap-1.5 text-[10px] text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded-md w-fit">
                                    <i class="fa-solid fa-sliders text-[9px]"></i>
                                    <span>Tùy chọn khi đặt: <b>${escapeHtml(optSummary)}</b></span>
                                </div>
                            ` : ''}
                        </div>
                    `;
                    }).join('');
                }

                // Dropdown chọn món thêm vào nhóm
                const dishOptions = allDishes.map(d => `<option value="${d.id}">${escapeHtml(d.name)} (${formatMoney(d.price)})</option>`).join('');

                html += `
                    <div class="p-3.5 rounded-2xl border border-amber-200/80 bg-amber-50/30 space-y-3">
                        <div class="flex items-center justify-between gap-2 border-b border-amber-200/60 pb-2">
                            <div class="flex-1">
                                <input type="text" id="combo-group-title-${gIdx}" value="${escapeHtml(group.group_title || '')}" 
                                    onchange="AdminCombo.updateGroupProp(${gIdx}, 'group_title', this.value)"
                                    placeholder="Tên nhóm (vd: Chọn 1 Món Chính)"
                                    class="w-full font-bold text-xs text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-amber-400 focus:border-amber-600 focus:ring-0 p-0">
                            </div>
                            <div class="flex items-center gap-1.5 text-[11px] text-gray-600">
                                <span>Chọn tối thiểu:</span>
                                <input type="number" id="combo-group-min-${gIdx}" min="1" max="10" value="${group.min || 1}" 
                                    onchange="AdminCombo.updateGroupProp(${gIdx}, 'min', this.value)"
                                    class="w-12 px-1.5 py-0.5 bg-white border border-gray-300 rounded text-center text-xs font-bold">
                                <span>Tối đa:</span>
                                <input type="number" id="combo-group-max-${gIdx}" min="1" max="10" value="${group.max || 1}" 
                                    onchange="AdminCombo.updateGroupProp(${gIdx}, 'max', this.value)"
                                    class="w-12 px-1.5 py-0.5 bg-white border border-gray-300 rounded text-center text-xs font-bold">
                                <button type="button" onclick="AdminCombo.removeGroup(${gIdx})" title="Xóa nhóm" class="ml-2 text-red-400 hover:text-red-600 p-1">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        </div>

                        <!-- Danh sach mon trong nhom -->
                        <div class="space-y-1.5">
                            ${itemsHtml}
                        </div>

                        <!-- Thanh chon mon de them vao nhom nay -->
                        <div class="flex items-center gap-2 pt-1 flex-wrap sm:flex-nowrap">
                            <select id="combo-pick-dish-${gIdx}" class="flex-1 min-w-[180px] px-3 py-1.5 bg-white border border-gray-300 rounded-xl text-xs text-gray-700">
                                <option value="">-- Chọn 1 món đưa vào nhóm --</option>
                                ${dishOptions}
                            </select>
                            <button type="button" onclick="const sel = document.getElementById('combo-pick-dish-${gIdx}'); AdminCombo.addItemToGroup(${gIdx}, sel.value); sel.value='';" 
                                class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1 shrink-0">
                                <i class="fa-solid fa-plus"></i> Thêm món
                            </button>
                            <button type="button" onclick="AdminCombo.openMultiDishPicker(${gIdx})" 
                                class="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold rounded-xl text-xs transition border border-amber-300 flex items-center gap-1 shrink-0" title="Chọn cùng lúc nhiều món bằng hộp kiểm">
                                <i class="fa-solid fa-list-check"></i> Chọn nhiều món
                            </button>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        },

        saveCombo: async function() {
            if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
                alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền lưu Combo!");
                return;
            }
            this.syncGroupsFromDOM();

            const db = getDb();
            const ops = getOps();
            if (!db || !ops || !ops.doc) {
                alert("Cơ sở dữ liệu chưa sẵn sàng. Vui lòng tải lại trang.");
                return;
            }

            const editId = document.getElementById('combo-edit-id').value;
            const name = document.getElementById('combo-name').value.trim();
            const name_en = document.getElementById('combo-name-en').value.trim();
            const price = Number(document.getElementById('combo-price').value) || 0;
            const desc = document.getElementById('combo-desc').value.trim();
            const desc_en = document.getElementById('combo-desc-en').value.trim();

            if (!name) {
                alert("Vui lòng nhập tên gói Combo!");
                return;
            }
            if (price <= 0) {
                alert("Vui lòng nhập giá bán trọn gói của Combo!");
                return;
            }

            // Lọc các nhóm có món ăn. Nếu người dùng để nhóm trống thì loại bỏ nhóm trống đó
            const validGroups = currentComboGroups.filter(g => Array.isArray(g.items) && g.items.length > 0);
            if (validGroups.length === 0) {
                alert("Combo phải có ít nhất 1 nhóm món và nhóm đó phải có món ăn được chọn!");
                return;
            }
            currentComboGroups = validGroups;

            const imgEl = document.getElementById('combo-preview-img');
            const existingImg = (imgEl && !imgEl.classList.contains('hidden')) ? imgEl.src : '';
            const finalImg = currentComboImageBase64 || existingImg || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80';

            const cleanedGroups = currentComboGroups.map(g => ({
                group_title: String(g.group_title || '').trim(),
                group_title_en: String(g.group_title_en || '').trim(),
                min: Math.max(1, Number(g.min) || 1),
                max: Math.max(1, Number(g.max) || 1),
                items: (g.items || []).map(it => ({
                    dish_id: String(it.dish_id || it.id || '').trim(),
                    name: String(it.name || '').trim(),
                    name_en: String(it.name_en || '').trim(),
                    price: Number(it.price) || 0,
                    extra: Number(it.extra || it.extra_price) || 0
                }))
            }));

            const comboData = cleanObj({
                name: name,
                name_en: name_en,
                price: price,
                desc: desc,
                desc_en: desc_en,
                img: finalImg,
                category: "COMBO",
                is_combo: true,
                combo_groups: cleanedGroups,
                is_available: true,
                locked_until: null
            });
            comboData.updated_at = (ops.serverTimestamp && typeof ops.serverTimestamp === 'function') ? ops.serverTimestamp() : new Date();

            const saveBtn = document.getElementById('combo-save-btn');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerText = "Đang lưu...";
            }

            try {
                let savedId = editId;
                if (editId) {
                    await ops.updateDoc(ops.doc(db, "dishes", editId), comboData);
                } else {
                    comboData.created_at = (ops.serverTimestamp && typeof ops.serverTimestamp === 'function') ? ops.serverTimestamp() : new Date();
                    const docRef = await ops.addDoc(ops.collection(db, "dishes"), comboData);
                    savedId = docRef ? docRef.id : '';
                }

                // Cập nhật ngay lập tức vào root.allDishes trong RAM để UI có dữ liệu combo mới tức thì
                if (root.allDishes && Array.isArray(root.allDishes)) {
                    const localItem = {
                        id: savedId,
                        ...comboData,
                        is_combo: true,
                        combo_groups: cleanedGroups,
                        isLocked: false,
                        lockedUntil: null,
                        remainingText: ''
                    };
                    if (editId) {
                        const idx = root.allDishes.findIndex(d => d.id === editId);
                        if (idx !== -1) root.allDishes[idx] = localItem;
                        else root.allDishes.push(localItem);
                    } else if (savedId) {
                        root.allDishes.push(localItem);
                    }
                }

                this.closeModal();
                if (typeof root.loadDishes === 'function') {
                    await root.loadDishes();
                }
                showToast(editId ? "Đã cập nhật Combo thành công!" : "Đã tạo Combo mới thành công!", "success");
            } catch (err) {
                console.error("Lỗi khi lưu Combo: ", err);
                alert("Không thể lưu Combo. Lỗi: " + (err.message || err));
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerText = "Lưu Combo";
                }
            }
        }
    };

    root.AdminCombo = AdminCombo;
})(typeof window !== 'undefined' ? window : this);
