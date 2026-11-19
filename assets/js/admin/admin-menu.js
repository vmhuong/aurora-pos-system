// =====================================================================
// AURORA SYSTEM - ADMIN MENU & CATEGORY MANAGEMENT MODULE
// Quản lý thực đơn, danh mục, tải ảnh, tùy chọn món & đếm ngược khóa món thời gian thực
// =====================================================================

(function(root) {
    'use strict';

    let currentMenuCat = 'ALL';
    let currentMenuSearch = '';
    let currentDishOptions = [];
    let dishLockCountdownInterval = null;
    const expiringDishIds = new Set();

    function formatMoney(val) {
        return Number(val || 0).toLocaleString('vi-VN') + ' VNĐ';
    }

    function getSafeMillis(val) {
        if (!val) return 0;
        if (typeof val.toMillis === 'function') return val.toMillis();
        if (typeof val.toDate === 'function') return val.toDate().getTime();
        if (val && typeof val.seconds === 'number') return val.seconds * 1000 + (val.nanoseconds || 0) / 1000000;
        if (val && typeof val._seconds === 'number') return val._seconds * 1000 + (val._nanoseconds || 0) / 1000000;
        if (val && val.timestampValue) return new Date(val.timestampValue).getTime();
        if (val instanceof Date) return val.getTime();
        const num = Number(val);
        if (!isNaN(num) && num > 0) return num;
        return 0;
    }

    /* ================= 1. QUẢN LÝ DANH MỤC (CATEGORIES) ================= */
    async function loadCategories() {
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        try {
            const snap = await ops.getDocs(ops.collection(db, "categories"));
            root.allCategories = [];
            snap.forEach(d => {
                root.allCategories.push({ id: d.id, ...d.data() });
            });

            root.allCategories.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));

            renderCategoryFilters();
            populateCategoryDropdown();
            renderCategoryList();
        } catch (err) {
            console.error("Lỗi tải danh mục: ", err);
        }
    }

    function renderCategoryFilters() {
        const filterContainer = document.getElementById('menu-cat-filters');
        if (!filterContainer) return;
        filterContainer.innerHTML = `
            <button onclick="filterAdminMenu('ALL')" class="admin-cat-filter px-3 py-1.5 rounded-full text-xs font-semibold ${currentMenuCat === 'ALL' ? 'bg-[#27231e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}">
                Tất cả
            </button>
            <button onclick="filterAdminMenu('COMBO')" class="admin-cat-filter px-3 py-1.5 rounded-full text-xs font-semibold ${currentMenuCat === 'COMBO' ? 'bg-amber-600 text-white shadow-xs' : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'} whitespace-nowrap">
                <i class="fa-solid fa-boxes-stacked mr-1"></i> COMBO
            </button>
        `;

        (root.allCategories || []).forEach(cat => {
            const isActive = currentMenuCat === cat.name.toUpperCase();
            filterContainer.innerHTML += `
                <button onclick="filterAdminMenu('${cat.name.toUpperCase()}')" class="admin-cat-filter px-3 py-1.5 rounded-full text-xs font-semibold ${isActive ? 'bg-[#27231e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'} whitespace-nowrap">
                    ${cat.name}
                </button>
            `;
        });
    }

    function populateCategoryDropdown() {
        const select = document.getElementById('dish-category');
        if (!select) return;
        select.innerHTML = '';
        (root.allCategories || []).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.name.toUpperCase();
            opt.textContent = cat.name;
            select.appendChild(opt);
        });
    }

    function openCategoryModal() {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền quản lý danh mục món!");
            return;
        }
        document.getElementById('cat-name-input').value = '';
        document.getElementById('cat-icon-input').value = '';
        document.getElementById('cat-edit-id').value = '';
        renderCategoryList();
        document.getElementById('modal-category').classList.remove('hidden');
    }

    function closeCategoryModal() {
        document.getElementById('modal-category').classList.add('hidden');
    }

    function renderCategoryList() {
        const container = document.getElementById('categories-list-container');
        if (!container) return;
        container.innerHTML = '';

        const allDishes = root.allDishes || [];
        (root.allCategories || []).forEach(cat => {
            const dishCount = allDishes.filter(d => d.category === cat.name.toUpperCase()).length;
            const row = document.createElement('div');
            row.className = "flex items-center justify-between p-3 bg-white border border-gray-100 rounded-2xl shadow-2xs";
            row.innerHTML = `
                <div class="flex items-center gap-3">
                    <div>
                        <div class="font-bold text-xs text-gray-900">
                            ${cat.name} 
                            ${cat.name_en ? `<span class="text-xs text-[#b89728] font-semibold ml-1">(${cat.name_en})</span>` : ''}
                        </div>
                        <div class="text-[10px] text-gray-400">${dishCount} món ăn</div>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button onclick="editCategory('${cat.id}')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg text-xs" title="Sửa danh mục">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="deleteCategory('${cat.id}', '${cat.name}')" class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs" title="Xóa danh mục">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;
            container.appendChild(row);
        });
    }

    function resetCategoryForm() {
        document.getElementById('cat-name-input').value = '';
        document.getElementById('cat-name-en-input').value = '';
        document.getElementById('cat-icon-input').value = '';
        document.getElementById('cat-edit-id').value = '';
        const cancelBtn = document.getElementById('cat-cancel-edit-btn');
        if (cancelBtn) cancelBtn.classList.add('hidden');
    }

    async function saveCategory() {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền lưu danh mục món!");
            return;
        }
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        const name = document.getElementById('cat-name-input').value.trim().toUpperCase();
        const name_en = document.getElementById('cat-name-en-input').value.trim();
        const icon = document.getElementById('cat-icon-input').value.trim() || '';
        const editId = document.getElementById('cat-edit-id').value;

        if (!name) {
            alert("Vui lòng nhập tên danh mục!");
            return;
        }

        try {
            if (editId) {
                await ops.updateDoc(ops.doc(db, "categories", editId), { name, name_en, icon });
            } else {
                await ops.addDoc(ops.collection(db, "categories"), { name, name_en, icon, order: (root.allCategories || []).length + 1 });
            }
            resetCategoryForm();
            await loadCategories();
        } catch (err) {
            alert("Lỗi khi lưu danh mục!");
        }
    }

    function editCategory(id) {
        const cat = (root.allCategories || []).find(c => c.id === id);
        if (!cat) return;
        document.getElementById('cat-name-input').value = cat.name;
        document.getElementById('cat-name-en-input').value = cat.name_en || '';
        document.getElementById('cat-icon-input').value = cat.icon || '';
        document.getElementById('cat-edit-id').value = cat.id;
        const cancelBtn = document.getElementById('cat-cancel-edit-btn');
        if (cancelBtn) cancelBtn.classList.remove('hidden');
    }

    async function deleteCategory(id, name) {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền xóa danh mục món!");
            return;
        }
        if (!confirm(`Bạn có chắc muốn xóa danh mục "${name}"?`)) return;
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        try {
            await ops.deleteDoc(ops.doc(db, "categories", id));
            await loadCategories();
        } catch (err) {
            alert("Lỗi khi xóa danh mục!");
        }
    }

    /* ================= 2. QUẢN LÝ THỰC ĐƠN & BỘ ĐẾM NGƯỢC KHÓA MÓN ================= */
    function formatRemainingLockTime(diffMs) {
        if (diffMs <= 0) return '00:00';
        const totalSec = Math.floor(diffMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        if (hours > 0) {
            return `${hours}h ${String(mins).padStart(2, '0')}p ${String(secs).padStart(2, '0')}s`;
        }
        if (mins > 0) {
            return `${mins}p ${String(secs).padStart(2, '0')}s`;
        }
        return `${secs}s`;
    }

    async function handleDishLockExpired(dishId) {
        if (!dishId || expiringDishIds.has(dishId)) return;
        expiringDishIds.add(dishId);

        const dish = (root.allDishes || []).find(d => d.id === dishId);
        if (dish) {
            dish.isLocked = false;
            dish.lockedUntil = null;
            dish.remainingText = '';
        }

        renderAdminDishes();

        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (db && ops) {
            try {
                await ops.updateDoc(ops.doc(db, "dishes", dishId), {
                    is_available: true,
                    locked_until: null
                });
                console.log(`[AutoUnlock] Đã tự động mở bán món hết hạn: ${dish ? dish.name : dishId}`);
            } catch (err) {
                console.warn("Lỗi cập nhật Firestore khi tự động mở khóa món:", err);
            } finally {
                expiringDishIds.delete(dishId);
            }
        }
    }

    function updateDishLockCountdowns() {
        const timerEls = document.querySelectorAll('.dish-lock-timer');
        if (!timerEls || timerEls.length === 0) return;

        const now = Date.now();
        timerEls.forEach(el => {
            const target = Number(el.getAttribute('data-locked-until')) || 0;
            const dishId = el.getAttribute('data-dish-id');
            const diff = target - now;

            if (diff <= 0) {
                el.textContent = "00:00";
                handleDishLockExpired(dishId);
            } else {
                el.textContent = formatRemainingLockTime(diff);
            }
        });
    }

    function startDishLockCountdownTimer() {
        if (dishLockCountdownInterval) {
            clearInterval(dishLockCountdownInterval);
        }
        updateDishLockCountdowns();
        dishLockCountdownInterval = setInterval(updateDishLockCountdowns, 1000);
    }

    async function loadDishes() {
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        try {
            const snap = await ops.getDocs(ops.collection(db, "dishes"));
            root.allDishes = [];
            const nowMillis = Date.now();

            snap.forEach(d => {
                const data = d.data();
                let isLocked = false;
                let remainingText = '';

                const lockedMillis = getSafeMillis(data.locked_until);
                if (lockedMillis > 0) {
                    if (lockedMillis > nowMillis) {
                        isLocked = true;
                        const diffMin = Math.round((lockedMillis - nowMillis) / 60000);
                        if (diffMin > 60) {
                            remainingText = `(còn ~${Math.round(diffMin/60)}h)`;
                        } else {
                            remainingText = `(còn ~${Math.max(1, diffMin)}p)`;
                        }
                    } else {
                        isLocked = false;
                        remainingText = "";
                        ops.updateDoc(ops.doc(db, "dishes", d.id), {
                            is_available: true,
                            locked_until: null
                        }).catch(() => {});
                    }
                } else {
                    isLocked = (data.is_available === false);
                    if (isLocked) {
                        remainingText = "(thủ công)";
                    }
                }

                root.allDishes.push({
                    id: d.id,
                    ...data,
                    name: data.name || "Chưa đặt tên",
                    name_en: data.name_en || "",
                    category: (data.category || "ALL").toUpperCase(),
                    price: Number(data.price) || 0,
                    desc: data.desc || "",
                    desc_en: data.desc_en || "",
                    img: data.img || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=150&q=80",
                    options: Array.isArray(data.options) ? data.options : [],
                    is_combo: data.is_combo === true || String(data.category || '').toUpperCase() === 'COMBO',
                    combo_groups: Array.isArray(data.combo_groups) ? data.combo_groups : [],
                    isLocked: isLocked,
                    lockedUntil: (lockedMillis > nowMillis ? lockedMillis : null),
                    remainingText: remainingText
                });
            });

            const catOrderMap = {};
            (root.allCategories || []).forEach((c, idx) => {
                catOrderMap[c.name.toUpperCase()] = c.order || (idx + 1);
            });
            root.allDishes.sort((a, b) => {
                const orderA = catOrderMap[a.category] || 99;
                const orderB = catOrderMap[b.category] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return a.name.localeCompare(b.name, 'vi');
            });

            renderAdminDishes();
            startDishLockCountdownTimer();
        } catch (err) {
            console.error("Lỗi tải món ăn: ", err);
        }
    }

    function renderAdminDishes() {
        const tbody = document.getElementById('dishes-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const isAdmin = (typeof window.isAdminRole === 'function') ? window.isAdminRole() : false;
        const allDishes = root.allDishes || [];
        let filtered = currentMenuCat === 'ALL'
            ? allDishes
            : currentMenuCat === 'COMBO'
                ? allDishes.filter(d => d.is_combo === true || String(d.category || '').toUpperCase() === 'COMBO')
                : allDishes.filter(d => String(d.category || '').toUpperCase() === currentMenuCat);
        if (currentMenuSearch) {
            filtered = filtered.filter(d => d.name.toLowerCase().includes(currentMenuSearch) || d.desc.toLowerCase().includes(currentMenuSearch));
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-400">Không tìm thấy món ăn nào.</td></tr>`;
            return;
        }

        filtered.forEach(dish => {
            const tr = document.createElement('tr');
            tr.id = 'admin-dish-row-' + dish.id;
            tr.className = "hover:bg-gray-50/70 transition-all duration-200";

            const isTimeLocked = dish.isLocked && dish.lockedUntil && dish.lockedUntil > Date.now();

            let statusBadge = '';
            if (dish.isLocked) {
                if (isTimeLocked) {
                    const unlockTimeStr = new Date(dish.lockedUntil).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const initialRemaining = formatRemainingLockTime(dish.lockedUntil - Date.now());
                    statusBadge = `
                        <span title="Tự động mở bán lại lúc ${unlockTimeStr}" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300 shadow-2xs">
                            <i class="fa-solid fa-clock-rotate-left text-amber-600 text-[10px] animate-spin-slow"></i>
                            <span>Tạm khóa</span>
                            <span class="dish-lock-timer font-mono font-black text-amber-900 bg-amber-200/90 px-1.5 py-0.5 rounded tracking-wide text-[10.5px]" data-locked-until="${dish.lockedUntil}" data-dish-id="${dish.id}">${initialRemaining}</span>
                        </span>`;
                } else {
                    statusBadge = `
                        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-700">
                            <i class="fa-solid fa-lock text-[10px]"></i> Tạm khóa (thủ công)
                        </span>`;
                }
            } else {
                statusBadge = `
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-green-100 text-green-700">
                        <i class="fa-solid fa-check text-[10px]"></i> Đang bán
                    </span>`;
            }

            const lockBtn = dish.isLocked
                ? `<button onclick="unlockDish('${dish.id}')" title="Mở bán lại ngay" class="p-2 text-green-600 hover:bg-green-50 rounded-xl transition">
                     <i class="fa-solid fa-lock-open"></i>
                   </button>`
                : `<button onclick="openLockModal('${dish.id}')" title="Tạm khóa khi hết món" class="p-2 text-amber-600 hover:bg-amber-50 rounded-xl transition">
                     <i class="fa-solid fa-lock"></i>
                   </button>`;

            const isCombo = dish.is_combo === true || String(dish.category || '').toUpperCase() === 'COMBO';
            const comboBadge = isCombo ? `<span class="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-black bg-amber-100 text-amber-800 border border-amber-300 ml-1.5 align-middle">COMBO</span>` : '';

            const actionButtons = isAdmin
                ? `${lockBtn}
                    <button onclick="editDish('${dish.id}')" title="Sửa thông tin" class="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="deleteDish('${dish.id}')" title="Xóa món" class="p-2 text-red-500 hover:bg-red-50 rounded-xl transition">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>`
                : `${lockBtn}`;

            tr.innerHTML = `
                <td class="p-4 flex items-center gap-3">
                    <img src="${dish.img}" loading="lazy" decoding="async" class="w-12 h-12 object-cover rounded-xl shadow-xs" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=150&q=80'">
                    <div>
                        <div class="font-bold text-gray-900">${dish.name}${comboBadge}</div>
                        <div class="text-gray-400 text-[11px] truncate max-w-xs">${dish.desc}</div>
                    </div>
                </td>
                <td class="p-4 font-semibold text-gray-600">${dish.category}</td>
                <td class="p-4 font-bold text-[#b89728]">${formatMoney(dish.price)}</td>
                <td class="p-4">${statusBadge}</td>
                <td class="p-4 text-right space-x-1">
                    ${actionButtons}
                </td>
            `;
            tbody.appendChild(tr);
        });

        updateDishLockCountdowns();
    }

    function filterAdminMenu(cat) {
        currentMenuCat = cat;
        renderCategoryFilters();
        renderAdminDishes();
    }

    function handleMenuSearch(val) {
        currentMenuSearch = (val || '').trim().toLowerCase();
        renderAdminDishes();
    }

    function handleDishImageUpload(input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];

        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const maxDim = 500;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);

                setDishImagePreview(compressedDataUrl);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function handleImageUrlInput(url) {
        if (url && url.trim().startsWith('http')) {
            setDishImagePreview(url.trim());
        } else if (!url) {
            removeDishImage();
        }
    }

    function setDishImagePreview(src) {
        document.getElementById('dish-img').value = src;
        const preview = document.getElementById('dish-img-preview');
        preview.src = src;
        preview.classList.remove('hidden');
        document.getElementById('dish-img-placeholder').classList.add('hidden');
        document.getElementById('btn-remove-img').classList.remove('hidden');
    }

    function removeDishImage() {
        document.getElementById('dish-img').value = '';
        document.getElementById('dish-file-input').value = '';
        const preview = document.getElementById('dish-img-preview');
        preview.src = '';
        preview.classList.add('hidden');
        document.getElementById('dish-img-placeholder').classList.remove('hidden');
        document.getElementById('btn-remove-img').classList.add('hidden');
    }

    /* ===== DISH OPTIONS & TOPPINGS BUILDER ===== */
    function renderDishOptionsEditor() {
        const container = document.getElementById('dish-options-container');
        if (!container) return;

        if (!currentDishOptions || currentDishOptions.length === 0) {
            container.innerHTML = `
                <div class="p-4 bg-gray-50 border border-dashed border-gray-200 rounded-2xl text-center text-gray-400 text-xs">
                    <i class="fa-solid fa-cookie-bite text-xl mb-1 text-gray-300"></i>
                    <p>Món này chưa có nhóm tùy chọn nào (món tiêu chuẩn).</p>
                    <p class="text-[10px] text-gray-400 mt-0.5">Bấm các nút "Mẫu nhanh" ở trên hoặc "Thêm nhóm" để cấu hình.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        currentDishOptions.forEach((grp, gIdx) => {
            const groupCard = document.createElement('div');
            groupCard.className = "p-3 bg-white border border-gray-200 rounded-2xl shadow-2xs space-y-2 relative";

            const isSingle = grp.type === 'single';
            const isRequired = grp.required !== false;

            let itemsHtml = '';
            (grp.items || []).forEach((item, iIdx) => {
                itemsHtml += `
                    <div class="flex items-center gap-1.5 p-1.5 bg-gray-50 rounded-xl border border-gray-100">
                        <input type="text" value="${item.name || ''}" placeholder="Tên lựa chọn (VI)" 
                               onchange="updateOptionItem(${gIdx}, ${iIdx}, 'name', this.value)"
                               class="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-[#d4af37] focus:outline-none">
                        <input type="text" value="${item.name_en || ''}" placeholder="Tên tiếng Anh (EN)" 
                               onchange="updateOptionItem(${gIdx}, ${iIdx}, 'name_en', this.value)"
                               class="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-[#d4af37] focus:outline-none">
                        <div class="flex items-center gap-1 w-24 shrink-0">
                            <span class="text-[10px] text-gray-400">+</span>
                            <input type="number" step="1000" value="${item.price || 0}" placeholder="0đ" 
                                   onchange="updateOptionItem(${gIdx}, ${iIdx}, 'price', Number(this.value)||0)"
                                   class="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-semibold text-[#b89728] focus:border-[#d4af37] focus:outline-none">
                        </div>
                        <label class="flex items-center gap-1 text-[10px] text-gray-500 whitespace-nowrap cursor-pointer select-none px-1" title="Tự động chọn sẵn">
                            <input type="checkbox" ${item.is_default ? 'checked' : ''} 
                                   onchange="updateOptionItemDefault(${gIdx}, ${iIdx}, this.checked)"
                                   class="rounded text-amber-500 focus:ring-0">
                            Mặc định
                        </label>
                        <button type="button" onclick="removeOptionItem(${gIdx}, ${iIdx})" 
                                class="w-6 h-6 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition" title="Xóa dòng này">
                            <i class="fa-solid fa-xmark text-xs"></i>
                        </button>
                    </div>
                `;
            });

            groupCard.innerHTML = `
                <div class="flex items-center justify-between pb-1 border-b border-gray-100 gap-2">
                    <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        <input type="text" value="${grp.name || ''}" placeholder="Tên nhóm (VD: Chọn Size, Độ ngọt)"
                               onchange="updateOptionGroup(${gIdx}, 'name', this.value)"
                               class="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 focus:bg-white focus:border-[#d4af37] focus:outline-none">
                        <input type="text" value="${grp.name_en || ''}" placeholder="Tên tiếng Anh (VD: Choose Size)"
                               onchange="updateOptionGroup(${gIdx}, 'name_en', this.value)"
                               class="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 focus:bg-white focus:border-[#d4af37] focus:outline-none">
                    </div>
                    <button type="button" onclick="removeOptionGroup(${gIdx})" 
                            class="text-gray-400 hover:text-red-500 p-1 text-xs transition shrink-0" title="Xóa toàn bộ nhóm này">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>

                <div class="flex items-center justify-between text-[11px] text-gray-600 px-0.5">
                    <div class="flex items-center gap-3">
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="radio" name="grp_type_${gIdx}" value="single" ${isSingle ? 'checked' : ''} 
                                   onchange="updateOptionGroup(${gIdx}, 'type', 'single')" class="text-amber-500">
                            <span>Chọn 1 (Radio)</span>
                        </label>
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="radio" name="grp_type_${gIdx}" value="multiple" ${!isSingle ? 'checked' : ''} 
                                   onchange="updateOptionGroup(${gIdx}, 'type', 'multiple')" class="text-amber-500">
                            <span>Chọn nhiều (Checkbox)</span>
                        </label>
                    </div>
                    <label class="flex items-center gap-1 cursor-pointer text-gray-600">
                        <input type="checkbox" ${isRequired ? 'checked' : ''} 
                               onchange="updateOptionGroup(${gIdx}, 'required', this.checked)" class="rounded text-amber-500">
                        <span class="font-semibold text-amber-800 text-[10px]">Bắt buộc</span>
                    </label>
                </div>

                <div class="space-y-1.5 pt-1">
                    ${itemsHtml}
                </div>

                <div class="pt-1">
                    <button type="button" onclick="addOptionItem(${gIdx})" 
                            class="w-full py-1 border border-dashed border-gray-200 hover:border-[#d4af37] text-gray-500 hover:text-[#b89728] rounded-xl text-[11px] font-semibold transition flex items-center justify-center gap-1 bg-gray-50/50">
                        <i class="fa-solid fa-plus text-[9px]"></i> Thêm lựa chọn vào nhóm này
                    </button>
                </div>
            `;
            container.appendChild(groupCard);
        });
    }

    function addOptionGroup(name = "Nhóm tùy chọn mới", name_en = "New Option Group", type = "single", required = false) {
        currentDishOptions.push({
            name: name,
            name_en: name_en,
            type: type,
            required: required,
            items: [
                { name: "Lựa chọn 1", name_en: "Option 1", price: 0, is_default: true }
            ]
        });
        renderDishOptionsEditor();
    }

    function removeOptionGroup(gIdx) {
        currentDishOptions.splice(gIdx, 1);
        renderDishOptionsEditor();
    }

    function updateOptionGroup(gIdx, field, val) {
        if (currentDishOptions[gIdx]) {
            currentDishOptions[gIdx][field] = val;
        }
    }

    function addOptionItem(gIdx) {
        if (!currentDishOptions[gIdx]) return;
        if (!currentDishOptions[gIdx].items) currentDishOptions[gIdx].items = [];
        currentDishOptions[gIdx].items.push({
            name: "",
            name_en: "",
            price: 0,
            is_default: false
        });
        renderDishOptionsEditor();
    }

    function removeOptionItem(gIdx, iIdx) {
        if (currentDishOptions[gIdx] && currentDishOptions[gIdx].items) {
            currentDishOptions[gIdx].items.splice(iIdx, 1);
            renderDishOptionsEditor();
        }
    }

    function updateOptionItem(gIdx, iIdx, field, val) {
        if (currentDishOptions[gIdx] && currentDishOptions[gIdx].items[iIdx]) {
            currentDishOptions[gIdx].items[iIdx][field] = val;
        }
    }

    function updateOptionItemDefault(gIdx, iIdx, isDefault) {
        if (currentDishOptions[gIdx] && currentDishOptions[gIdx].items) {
            if (currentDishOptions[gIdx].type === 'single' && isDefault) {
                currentDishOptions[gIdx].items.forEach((it, idx) => {
                    it.is_default = (idx === iIdx);
                });
            } else {
                currentDishOptions[gIdx].items[iIdx].is_default = isDefault;
            }
            renderDishOptionsEditor();
        }
    }

    function clearDishOptions() {
        if (currentDishOptions.length > 0 && !confirm("Bạn có chắc muốn xóa toàn bộ tùy chọn của món này?")) return;
        currentDishOptions = [];
        renderDishOptionsEditor();
    }

    function applyOptionPreset(presetType) {
        if (presetType === 'tea_coffee') {
            currentDishOptions = [
                {
                    name: "Chọn Size",
                    name_en: "Choose Size",
                    type: "single",
                    required: true,
                    items: [
                        { name: "Size M (Vừa)", name_en: "Regular (M)", price: 0, is_default: true },
                        { name: "Size L (Lớn)", name_en: "Large (L)", price: 10000, is_default: false }
                    ]
                },
                {
                    name: "Mức đường",
                    name_en: "Sweetness",
                    type: "single",
                    required: false,
                    items: [
                        { name: "100% đường (Chuẩn)", name_en: "100% Sugar", price: 0, is_default: true },
                        { name: "70% đường", name_en: "70% Sugar", price: 0, is_default: false },
                        { name: "50% đường", name_en: "50% Sugar", price: 0, is_default: false },
                        { name: "Không đường", name_en: "No Sugar", price: 0, is_default: false }
                    ]
                },
                {
                    name: "Mức đá",
                    name_en: "Ice Level",
                    type: "single",
                    required: false,
                    items: [
                        { name: "Đá bình thường", name_en: "Regular Ice", price: 0, is_default: true },
                        { name: "Ít đá", name_en: "Less Ice", price: 0, is_default: false },
                        { name: "Không đá", name_en: "No Ice", price: 0, is_default: false },
                        { name: "Uống nóng", name_en: "Hot", price: 0, is_default: false }
                    ]
                },
                {
                    name: "Topping",
                    name_en: "Toppings",
                    type: "multiple",
                    required: false,
                    items: [
                        { name: "Trân châu trắng", name_en: "White Pearls", price: 8000, is_default: false },
                        { name: "Thạch đào giòn", name_en: "Peach Jelly", price: 10000, is_default: false },
                        { name: "Kem Cheese béo ngậy", name_en: "Cheese Foam", price: 12000, is_default: false }
                    ]
                }
            ];
        } else if (presetType === 'steak') {
            currentDishOptions = [
                {
                    name: "Độ chín thịt",
                    name_en: "Meat Doneness",
                    type: "single",
                    required: true,
                    items: [
                        { name: "Tái (Rare)", name_en: "Rare", price: 0, is_default: false },
                        { name: "Tái chín (Medium Rare)", name_en: "Medium Rare", price: 0, is_default: true },
                        { name: "Chín vừa (Medium)", name_en: "Medium", price: 0, is_default: false },
                        { name: "Chín kỹ (Well Done)", name_en: "Well Done", price: 0, is_default: false }
                    ]
                },
                {
                    name: "Loại sốt",
                    name_en: "Sauce Choice",
                    type: "single",
                    required: true,
                    items: [
                        { name: "Sốt tiêu đen Phú Quốc", name_en: "Black Pepper Sauce", price: 0, is_default: true },
                        { name: "Sốt kem nấm Truffle", name_en: "Truffle Mushroom Sauce", price: 0, is_default: false },
                        { name: "Sốt BBQ đậm vị", name_en: "Smoky BBQ Sauce", price: 0, is_default: false }
                    ]
                },
                {
                    name: "Món ăn kèm",
                    name_en: "Sides",
                    type: "multiple",
                    required: false,
                    items: [
                        { name: "Khoai tây chiên giòn", name_en: "French Fries", price: 20000, is_default: false },
                        { name: "Khoai tây nghiền bơ tỏi", name_en: "Garlic Mashed Potato", price: 25000, is_default: false },
                        { name: "Salad mè rang", name_en: "Sesame Salad", price: 20000, is_default: false }
                    ]
                }
            ];
        } else if (presetType === 'toppings_only') {
            currentDishOptions = [
                {
                    name: "Topping",
                    name_en: "Toppings",
                    type: "multiple",
                    required: false,
                    items: [
                        { name: "Phô mai kéo sợi", name_en: "Mozzarella Cheese", price: 15000, is_default: false },
                        { name: "Trứng ốp la", name_en: "Fried Egg", price: 10000, is_default: false },
                        { name: "Thịt xông khói", name_en: "Crispy Bacon", price: 20000, is_default: false }
                    ]
                }
            ];
        }
        renderDishOptionsEditor();
    }

    function getCleanDishOptions() {
        if (!Array.isArray(currentDishOptions)) return [];
        return currentDishOptions
            .filter(grp => grp && grp.name && grp.name.trim().length > 0)
            .map(grp => ({
                name: grp.name.trim(),
                name_en: (grp.name_en || '').trim(),
                type: grp.type === 'multiple' ? 'multiple' : 'single',
                required: !!grp.required,
                items: (grp.items || [])
                    .filter(it => it && it.name && it.name.trim().length > 0)
                    .map(it => ({
                        name: it.name.trim(),
                        name_en: (it.name_en || '').trim(),
                        price: Math.max(0, Number(it.price) || 0),
                        is_default: !!it.is_default
                    }))
            }));
    }

    function openDishModal() {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền thêm món mới!");
            return;
        }
        document.getElementById('modal-dish-title').innerText = "Thêm Món Ăn Mới";
        document.getElementById('dish-edit-id').value = "";
        document.getElementById('dish-name').value = "";
        document.getElementById('dish-name-en').value = "";
        populateCategoryDropdown();
        document.getElementById('dish-price').value = "";
        document.getElementById('dish-desc').value = "";
        document.getElementById('dish-desc-en').value = "";
        currentDishOptions = [];
        renderDishOptionsEditor();
        removeDishImage();
        document.getElementById('modal-dish').classList.remove('hidden');
    }

    function editDish(dishId) {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền chỉnh sửa món ăn! Tài khoản Quản lý chỉ được phép Tạm khóa / Mở bán lại.");
            return;
        }
        const allDishes = root.allDishes || [];
        const dish = allDishes.find(d => d.id === dishId);
        if (!dish) return;

        // Nếu là món Combo -> Chuyển sang Modal Combo chuyên dụng
        if (dish.is_combo === true || String(dish.category || '').toUpperCase() === 'COMBO') {
            if (root.AdminCombo && typeof root.AdminCombo.openModal === 'function') {
                root.AdminCombo.openModal(dishId);
                return;
            }
        }

        document.getElementById('modal-dish-title').innerText = "Chỉnh Sửa Món Ăn";
        document.getElementById('dish-edit-id').value = dish.id;
        document.getElementById('dish-name').value = dish.name;
        document.getElementById('dish-name-en').value = dish.name_en || "";
        populateCategoryDropdown();
        document.getElementById('dish-category').value = dish.category;
        document.getElementById('dish-price').value = dish.price;
        document.getElementById('dish-desc').value = dish.desc || "";
        document.getElementById('dish-desc-en').value = dish.desc_en || "";
        currentDishOptions = JSON.parse(JSON.stringify(dish.options || []));
        renderDishOptionsEditor();
        if (dish.img) {
            setDishImagePreview(dish.img);
        } else {
            removeDishImage();
        }
        document.getElementById('modal-dish').classList.remove('hidden');
    }

    function closeDishModal() {
        document.getElementById('modal-dish').classList.add('hidden');
    }

    async function saveDish() {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền lưu thông tin món!");
            return;
        }
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        const id = document.getElementById('dish-edit-id').value;
        const name = document.getElementById('dish-name').value.trim();
        const name_en = (document.getElementById('dish-name-en')?.value || '').trim();
        const category = document.getElementById('dish-category').value;
        const price = parseFloat(document.getElementById('dish-price').value);
        const desc = document.getElementById('dish-desc').value.trim();
        const desc_en = (document.getElementById('dish-desc-en')?.value || '').trim();
        const img = document.getElementById('dish-img').value.trim();
        const cleanOptions = getCleanDishOptions();

        if (!name || isNaN(price)) {
            alert("Vui lòng nhập tên món và giá tiền hợp lệ!");
            return;
        }

        const dataObj = {
            name,
            name_en: name_en || "",
            category,
            price,
            desc,
            desc_en: desc_en || "",
            img: img || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80",
            options: cleanOptions
        };

        try {
            if (id) {
                await ops.updateDoc(ops.doc(db, "dishes", id), dataObj);
                if (typeof root.logAuditEvent === 'function') {
                    root.logAuditEvent('MENU_EDIT_DISH', 'MENU', `Cập nhật món ăn: ${name} (Giá: ${price.toLocaleString('vi-VN')}đ, Nhóm: ${category})`, {
                        dish_id: id,
                        name: name,
                        price: price,
                        category: category
                    });
                }
            } else {
                dataObj.is_available = true;
                dataObj.locked_until = null;
                const newDoc = await ops.addDoc(ops.collection(db, "dishes"), dataObj);
                if (typeof root.logAuditEvent === 'function') {
                    root.logAuditEvent('MENU_ADD_DISH', 'MENU', `Thêm món mới: ${name} (Giá: ${price.toLocaleString('vi-VN')}đ, Nhóm: ${category})`, {
                        dish_id: newDoc.id,
                        name: name,
                        price: price,
                        category: category
                    });
                }
            }
            closeDishModal();
            loadDishes();
        } catch (err) {
            console.error("Lỗi lưu món: ", err);
            alert("Có lỗi khi lưu món lên Firebase!");
        }
    }

    async function deleteDish(id) {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert("Chỉ tài khoản Chủ quán (Admin) mới có quyền xóa món khỏi thực đơn!");
            return;
        }
        const dishToDelete = (root.allDishes || []).find(d => d.id === id);
        const dishName = dishToDelete ? dishToDelete.name : id;
        if (!confirm(`Bạn có chắc chắn muốn xóa món "${dishName}" khỏi thực đơn?`)) return;
        const row = document.getElementById('admin-dish-row-' + id);
        if (row) {
            row.style.transition = 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)';
            row.style.opacity = '0';
            row.style.transform = 'translateX(20px)';
            setTimeout(() => row.remove(), 220);
        }
        root.allDishes = (root.allDishes || []).filter(d => d.id !== id);

        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        try {
            await ops.deleteDoc(ops.doc(db, "dishes", id));
            if (typeof root.logAuditEvent === 'function') {
                root.logAuditEvent('MENU_DELETE_DISH', 'MENU', `Xóa món khỏi thực đơn: ${dishName}`, {
                    dish_id: id,
                    name: dishName
                });
            }
        } catch (err) {
            console.error("Lỗi khi xóa món: ", err);
            alert("Lỗi khi xóa món!");
            loadDishes();
        }
    }

    function openLockModal(id) {
        document.getElementById('lock-dish-id').value = id;
        const dish = (root.allDishes || []).find(d => d.id === id);
        const nameEl = document.getElementById('lock-dish-name-text');
        if (nameEl) {
            nameEl.textContent = dish ? dish.name : 'Món ăn';
        }
        const defaultRadio = document.querySelector('input[name="lock-duration"][value="30m"]');
        if (defaultRadio) defaultRadio.checked = true;
        document.getElementById('modal-lock').classList.remove('hidden');
    }

    function closeLockModal() {
        document.getElementById('modal-lock').classList.add('hidden');
    }

    async function confirmLockDish() {
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        const id = document.getElementById('lock-dish-id').value;
        const durationEl = document.querySelector('input[name="lock-duration"]:checked');
        const duration = durationEl ? durationEl.value : '30m';
        let lockedUntil = null;

        const now = new Date();
        if (duration === '15m') {
            lockedUntil = ops.Timestamp.fromDate(new Date(now.getTime() + 15 * 60000));
        } else if (duration === '30m') {
            lockedUntil = ops.Timestamp.fromDate(new Date(now.getTime() + 30 * 60000));
        } else if (duration === '1h') {
            lockedUntil = ops.Timestamp.fromDate(new Date(now.getTime() + 60 * 60000));
        } else if (duration === '2h') {
            lockedUntil = ops.Timestamp.fromDate(new Date(now.getTime() + 120 * 60000));
        } else if (duration === '4h') {
            lockedUntil = ops.Timestamp.fromDate(new Date(now.getTime() + 240 * 60000));
        } else if (duration === 'today') {
            const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            lockedUntil = ops.Timestamp.fromDate(endOfDay);
        } else if (duration === 'custom') {
            const customMins = Math.max(1, parseInt(document.getElementById('lock-custom-mins')?.value) || 15);
            lockedUntil = ops.Timestamp.fromDate(new Date(now.getTime() + customMins * 60000));
        } else if (duration === 'forever') {
            lockedUntil = null;
        }

        const d = (root.allDishes || []).find(item => item.id === id);
        const prevIsLocked = d ? !!d.isLocked : false;
        const prevLockedUntil = d ? d.lockedUntil : null;

        try {
            const targetMillis = lockedUntil ? lockedUntil.toMillis() : null;
            if (d) {
                d.isLocked = true;
                d.lockedUntil = targetMillis;
                d.remainingText = '';
                renderAdminDishes();
            }

            await ops.updateDoc(ops.doc(db, "dishes", id), {
                is_available: false,
                locked_until: lockedUntil
            });
            closeLockModal();
            loadDishes();
            if (typeof root.showAdminToast === 'function') {
                root.showAdminToast(`Đã khóa món "${d ? d.name : ''}" thành công!`, 'success');
            }
        } catch (err) {
            console.error("Lỗi khi khóa món:", err);
            // Hoàn tác trạng thái giao diện nếu máy chủ từ chối
            if (d) {
                d.isLocked = prevIsLocked;
                d.lockedUntil = prevLockedUntil;
                d.remainingText = '';
                renderAdminDishes();
            }
            alert("Lỗi khi khóa món: " + (err.message || "Không có quyền ghi dữ liệu hoặc lỗi mạng!"));
        }
    }

    async function unlockDish(id) {
        expiringDishIds.delete(id);
        const d = (root.allDishes || []).find(item => item.id === id);
        const prevIsLocked = d ? !!d.isLocked : false;
        const prevLockedUntil = d ? d.lockedUntil : null;

        if (d) {
            d.isLocked = false;
            d.lockedUntil = null;
            d.remainingText = '';
            renderAdminDishes();
        }

        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        try {
            await ops.updateDoc(ops.doc(db, "dishes", id), {
                is_available: true,
                locked_until: null
            });
            loadDishes();
            if (typeof root.showAdminToast === 'function') {
                root.showAdminToast(`Đã mở khóa món "${d ? d.name : ''}" thành công!`, 'success');
            }
        } catch (err) {
            console.error("Lỗi khi mở khóa món:", err);
            // Hoàn tác nếu lỗi
            if (d) {
                d.isLocked = prevIsLocked;
                d.lockedUntil = prevLockedUntil;
                d.remainingText = '';
                renderAdminDishes();
            }
            alert("Lỗi khi mở khóa món: " + (err.message || "Không thể kết nối máy chủ!"));
        }
    }

    // Xuất ra root (window) để giao diện HTML và admin-app gọi
    root.loadCategories = loadCategories;
    root.renderCategoryFilters = renderCategoryFilters;
    root.populateCategoryDropdown = populateCategoryDropdown;
    root.openCategoryModal = openCategoryModal;
    root.closeCategoryModal = closeCategoryModal;
    root.renderCategoryList = renderCategoryList;
    root.resetCategoryForm = resetCategoryForm;
    root.saveCategory = saveCategory;
    root.editCategory = editCategory;
    root.deleteCategory = deleteCategory;

    root.loadDishes = loadDishes;
    root.renderAdminDishes = renderAdminDishes;
    root.filterAdminMenu = filterAdminMenu;
    root.handleMenuSearch = handleMenuSearch;
    root.handleDishImageUpload = handleDishImageUpload;
    root.handleImageUrlInput = handleImageUrlInput;
    root.setDishImagePreview = setDishImagePreview;
    root.removeDishImage = removeDishImage;

    root.renderDishOptionsEditor = renderDishOptionsEditor;
    root.addOptionGroup = addOptionGroup;
    root.removeOptionGroup = removeOptionGroup;
    root.updateOptionGroup = updateOptionGroup;
    root.addOptionItem = addOptionItem;
    root.removeOptionItem = removeOptionItem;
    root.updateOptionItem = updateOptionItem;
    root.updateOptionItemDefault = updateOptionItemDefault;
    root.clearDishOptions = clearDishOptions;
    root.applyOptionPreset = applyOptionPreset;

    root.openDishModal = openDishModal;
    root.editDish = editDish;
    root.closeDishModal = closeDishModal;
    root.saveDish = saveDish;
    root.deleteDish = deleteDish;

    root.openLockModal = openLockModal;
    root.closeLockModal = closeLockModal;
    root.confirmLockDish = confirmLockDish;
    root.unlockDish = unlockDish;
    root.startDishLockCountdownTimer = startDishLockCountdownTimer;
    root.updateDishLockCountdowns = updateDishLockCountdowns;
    root.formatRemainingLockTime = formatRemainingLockTime;

})(typeof window !== 'undefined' ? window : this);
