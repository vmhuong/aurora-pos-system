// =====================================================================
// AURORA SYSTEM - ADMIN STAFF & ACCOUNT MANAGEMENT MODULE
// Quản lý tài khoản nhân viên, phân quyền Web/App và bảo mật mã PIN SHA-256
// =====================================================================

(function(root) {
    'use strict';

    let currentStaffFilter = 'all';
    let staffSearchQuery = '';
    const PIN_SALT = 'AURORA_PIN_SALT_2026_';

    // Hàm băm mật khẩu / mã PIN SHA-256 bảo mật
    async function hashStaffPin(pin) {
        if (!pin) return '';
        try {
            const raw = PIN_SALT + String(pin).trim();
            const msgBuffer = new TextEncoder().encode(raw);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch(e) {
            console.warn("Crypto API fallback:", e);
            // Fallback nếu môi trường không có crypto.subtle
            let hash = 0;
            const str = PIN_SALT + String(pin).trim();
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return 'fb_' + Math.abs(hash).toString(16);
        }
    }

    function removeVietnameseTones(str) {
        if (!str) return '';
        return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D')
            .toLowerCase();
    }

    function isStaffWeb(s) {
        if (!s) return false;
        if (s.platform === 'web') return true;
        if (s.platform === 'app') return false;
        return (s.role === 'web_staff' || s.role === 'admin' || s.role === 'manager');
    }

    function getRoleDisplayName(role, isWeb) {
        const r = (role || '').toLowerCase().trim();
        if (r === 'admin' || r === 'owner' || r === 'superadmin') return 'Quản trị viên';
        if (r === 'manager' || r === 'quanly' || r === 'quan_ly' || r === 'quản lý') return 'Quản lý';
        if (r === 'kitchen' || r === 'bep' || r === 'bếp') return 'Bếp';
        if (r === 'waiter' || r === 'phucvu' || r === 'phục vụ') return 'Phục vụ';
        if (r === 'cashier' || r === 'thungan' || r === 'thu ngân') return 'Thu ngân';
        if (r === 'staff' || r === 'web_staff' || r === 'nhanvien' || r === 'nhân viên') return 'Nhân viên';
        return isWeb ? 'Nhân viên' : 'Phục vụ';
    }

    async function loadStaff() {
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        try {
            const snap = await ops.getDocs(ops.collection(db, "staff"));
            root.allStaff = [];
            snap.forEach(d => {
                root.allStaff.push({ id: d.id, ...d.data() });
            });

            renderStaff();
        } catch (err) {
            console.error("Lỗi tải danh sách nhân viên: ", err);
            const tbody = document.getElementById('staff-table-body');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-600 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1.5 text-base"></i> Không thể tải danh sách tài khoản (Lỗi quyền Firebase 403 Forbidden).<br><span class="text-xs text-gray-500 font-normal mt-1 block">Vui lòng kiểm tra quyền truy cập trên Firebase Console.</span></td></tr>`;
            }
        }
    }

    function setStaffFilter(filter) {
        currentStaffFilter = filter;
        document.querySelectorAll('.staff-subtab-btn').forEach(b => {
            b.className = "staff-subtab-btn px-3 py-1.5 rounded-xl font-semibold text-gray-600 hover:text-gray-900 transition flex items-center gap-1.5 shrink-0";
        });
        const activeBtn = document.getElementById(`btn-staff-filter-${filter}`);
        if (activeBtn) {
            activeBtn.className = "staff-subtab-btn px-3 py-1.5 rounded-xl font-bold bg-white text-gray-900 shadow-xs transition flex items-center gap-1.5 shrink-0";
        }
        renderStaff();
    }

    function onStaffSearchInput(val) {
        staffSearchQuery = (val || '').trim();
        const clearBtn = document.getElementById('btn-clear-staff-search');
        if (clearBtn) {
            if (staffSearchQuery) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
        renderStaff();
    }

    function clearStaffSearch() {
        staffSearchQuery = '';
        const inp = document.getElementById('staff-search-input');
        if (inp) inp.value = '';
        const clearBtn = document.getElementById('btn-clear-staff-search');
        if (clearBtn) clearBtn.classList.add('hidden');
        renderStaff();
    }

    function renderStaff() {
        const tbody = document.getElementById('staff-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const allStaff = root.allStaff || [];

        // Cập nhật số lượng đếm trên sub-tabs
        const countAll = allStaff.length;
        const countWeb = allStaff.filter(s => isStaffWeb(s)).length;
        const countApp = allStaff.filter(s => !isStaffWeb(s)).length;

        const elAll = document.getElementById('count-staff-all');
        const elWeb = document.getElementById('count-staff-web');
        const elApp = document.getElementById('count-staff-app');
        if (elAll) elAll.innerText = countAll;
        if (elWeb) elWeb.innerText = countWeb;
        if (elApp) elApp.innerText = countApp;

        // Lọc danh sách nhân viên theo sub-tab và từ khóa tìm kiếm
        const qRaw = staffSearchQuery.toLowerCase();
        const qNorm = removeVietnameseTones(staffSearchQuery);

        const filteredStaff = allStaff.filter(s => {
            if (currentStaffFilter === 'web' && !isStaffWeb(s)) return false;
            if (currentStaffFilter === 'app' && isStaffWeb(s)) return false;

            if (staffSearchQuery) {
                const idLower = (s.id || '').toLowerCase();
                const shortId = idLower.slice(0, 5);
                const nameRaw = (s.name || '').toLowerCase();
                const nameNorm = removeVietnameseTones(s.name || '');
                const userRaw = (s.username || '').toLowerCase();
                const emailRaw = (s.email || '').toLowerCase();

                const matchCode = idLower.includes(qRaw) || shortId.includes(qRaw) || `#${shortId}`.includes(qRaw);
                const matchName = nameRaw.includes(qRaw) || nameNorm.includes(qNorm);
                const matchUser = userRaw.includes(qRaw) || emailRaw.includes(qRaw);

                return matchCode || matchName || matchUser;
            }
            return true;
        });

        if (filteredStaff.length === 0) {
            let emptyMsg = '';
            if (staffSearchQuery) {
                emptyMsg = `
                    <div class="py-4 space-y-2">
                        <i class="fa-solid fa-magnifying-glass text-2xl text-gray-300"></i>
                        <div class="text-gray-500 font-semibold">Không tìm thấy nhân viên nào phù hợp với từ khóa <span class="text-gray-800 font-bold">"${staffSearchQuery}"</span></div>
                        <button onclick="clearStaffSearch()" class="mt-2 px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition">Xóa tìm kiếm</button>
                    </div>
                `;
            } else if (currentStaffFilter === 'web') {
                emptyMsg = 'Chưa có tài khoản Web nào. Nhấn "+ Thêm Tài Khoản" để tạo tài khoản phân quyền.';
            } else if (currentStaffFilter === 'app') {
                emptyMsg = 'Chưa có tài khoản App Android nào.';
            } else {
                emptyMsg = 'Chưa có tài khoản nhân viên nào.';
            }
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-400">${emptyMsg}</td></tr>`;
            return;
        }

        filteredStaff.forEach(staff => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50/70 transition";

            const isWeb = isStaffWeb(staff);
            const roleName = getRoleDisplayName(staff.role, isWeb);
            const isActive = staff.status === 'active';

            const platformBadge = isWeb ? `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 shadow-xs">
                    <i class="fa-solid fa-laptop text-[11px]"></i> Web
                </span>
            ` : `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 shadow-xs">
                    <i class="fa-solid fa-mobile-screen text-[11px]"></i> App Android
                </span>
            `;

            // Hiển thị PIN: Nếu có mã hóa pin_hash thì hiển thị badge bảo mật
            const hasHash = Boolean(staff.pin_hash);

            tr.innerHTML = `
                <td class="p-4">
                    <div class="font-bold text-gray-900">
                        ${staff.name}
                    </div>
                    <div class="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                        <span>#${staff.id.slice(0, 5).toUpperCase()}</span>
                        ${hasHash ? '<span class="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-1 rounded border border-emerald-200" title="Đã mã hóa SHA-256 bảo mật">SHA-256</span>' : ''}
                    </div>
                </td>
                <td class="p-4 font-mono font-bold text-gray-700">
                    ${staff.username}
                    ${staff.email ? `<div class="text-[10px] text-gray-400 font-normal">${staff.email}</div>` : ''}
                </td>
                <td class="p-4 font-mono">
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <i class="fa-solid fa-shield-halved text-emerald-600"></i> Mã hóa SHA-256
                    </span>
                </td>
                <td class="p-4">
                    <span class="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-semibold bg-gray-100 text-gray-800 border border-gray-200/70">
                        ${roleName}
                    </span>
                </td>
                <td class="p-4">
                    ${platformBadge}
                </td>
                <td class="p-4">
                    <button onclick="toggleStaffStatus('${staff.id}', '${staff.status}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold ${isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'} transition" title="Nhấn để đổi trạng thái">
                        <span class="w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-red-500'}"></span>
                        ${isActive ? 'Hoạt động' : 'Tạm khóa'}
                    </button>
                </td>
                <td class="p-4 text-right space-x-1">
                    <button onclick="editStaff('${staff.id}')" title="Sửa thông tin" class="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="deleteStaff('${staff.id}', '${staff.name}')" title="Xóa tài khoản" class="p-2 text-red-500 hover:bg-red-50 rounded-xl transition">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function togglePinVisibility(id, pin) {
        const el = document.getElementById(`pin-${id}`);
        const eye = document.getElementById(`eye-${id}`);
        if (!el || !eye) return;
        if (el.innerText === '••••') {
            el.innerText = pin || '(Đã mã hóa)';
            eye.className = "fa-solid fa-eye-slash text-[11px]";
        } else {
            el.innerText = '••••';
            eye.className = "fa-solid fa-eye text-[11px]";
        }
    }

    function onStaffPlatformChange(platform, currentRole) {
        const labelWeb = document.getElementById('label-platform-web');
        const labelApp = document.getElementById('label-platform-app');
        const userLabel = document.getElementById('staff-username-label');
        const userInput = document.getElementById('staff-username');
        const pinLabel = document.getElementById('staff-pin-label');
        const pinInput = document.getElementById('staff-pin');
        const roleSelect = document.getElementById('staff-role');
        
        if (platform === 'web') {
            if (labelWeb) labelWeb.className = "cursor-pointer border-2 border-purple-500 bg-purple-50/50 p-2.5 rounded-2xl flex items-center gap-2 transition";
            if (labelApp) labelApp.className = "cursor-pointer border-2 border-gray-200 hover:border-gray-300 p-2.5 rounded-2xl flex items-center gap-2 transition";
            if (userLabel) userLabel.innerText = "Tên đăng nhập Web *";
            if (userInput) userInput.placeholder = "Tên tài khoản";
            if (pinLabel) pinLabel.innerText = "Mật khẩu đăng nhập Web *";
            if (pinInput) pinInput.placeholder = "Mật khẩu";

            if (roleSelect) {
                roleSelect.innerHTML = `
                    <option value="admin">Quản trị viên</option>
                    <option value="manager">Quản lý</option>
                    <option value="staff" selected>Nhân viên</option>
                `;
                let selected = currentRole || 'staff';
                if (selected === 'web_staff' || selected === 'waiter' || selected === 'kitchen' || selected === 'cashier') selected = 'staff';
                if (selected === 'manager' || selected === 'quanly' || selected === 'quan_ly') selected = 'manager';
                if (selected === 'admin' || selected === 'owner' || selected === 'superadmin') selected = 'admin';
                roleSelect.value = selected;
            }
        } else {
            if (labelApp) labelApp.className = "cursor-pointer border-2 border-amber-500 bg-amber-50/50 p-2.5 rounded-2xl flex items-center gap-2 transition";
            if (labelWeb) labelWeb.className = "cursor-pointer border-2 border-gray-200 hover:border-gray-300 p-2.5 rounded-2xl flex items-center gap-2 transition";
            if (userLabel) userLabel.innerText = "Tên đăng nhập App / Mã NV *";
            if (userInput) userInput.placeholder = "Tên tài khoản";
            if (pinLabel) pinLabel.innerText = "Mã PIN App (4-6 số) *";
            if (pinInput) pinInput.placeholder = "1234";

            if (roleSelect) {
                roleSelect.innerHTML = `
                    <option value="waiter" selected>Phục vụ</option>
                    <option value="kitchen">Bếp</option>
                    <option value="manager">Quản lý</option>
                `;
                let selected = currentRole || 'waiter';
                if (selected === 'staff' || selected === 'web_staff' || selected === 'cashier') selected = 'waiter';
                if (selected === 'admin') selected = 'manager';
                roleSelect.value = selected;
            }
        }
        updateRoleHint();
    }

    function updateRoleHint() {
        const roleEl = document.getElementById('staff-role');
        if (!roleEl) return;
        const role = roleEl.value;
        const box = document.getElementById('staff-role-hint-box');
        const title = document.getElementById('role-hint-title');
        const desc = document.getElementById('role-hint-desc');
        if (!box || !title || !desc) return;

        const isApp = document.getElementById('platform-app')?.checked;

        if (isApp) {
            if (role === 'waiter') {
                box.className = "p-3 bg-blue-50 rounded-2xl border border-blue-200 text-blue-900 space-y-1";
                title.innerHTML = '<i class="fa-solid fa-mobile-screen text-blue-600"></i> Quyền Phục vụ:';
                desc.innerHTML = 'Đăng nhập App bằng mã PIN: Mở bàn, order gọi món tại bàn, gửi món vào bếp. <b>Không can thiệp KDS bếp, không khóa món.</b>';
            } else if (role === 'kitchen') {
                box.className = "p-3 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 space-y-1";
                title.innerHTML = '<i class="fa-solid fa-fire-burner text-amber-600"></i> Quyền Bếp:';
                desc.innerHTML = 'Vào thẳng màn hình <b>KDS Nhà Bếp toàn màn hình</b>: Xem danh sách món gọi theo thứ tự thời gian, bấm nhận nấu và báo xong món.';
            } else {
                box.className = "p-3 bg-indigo-50 rounded-2xl border border-indigo-200 text-indigo-900 space-y-1";
                title.innerHTML = '<i class="fa-solid fa-crown text-indigo-600"></i> Quyền Quản lý:';
                desc.innerHTML = 'Toàn quyền trên App: Quản lý sơ đồ bàn (chuyển bàn, gộp bàn, quản lý đơn mọi nhân viên), can thiệp bếp KDS, và <b>Bật / Tắt trạng thái món ăn (còn món / hết món)</b>.';
            }
        } else {
            if (role === 'admin') {
                box.className = "p-3 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 space-y-1";
                title.innerHTML = '<i class="fa-solid fa-shield-halved text-amber-600"></i> Quyền Quản trị viên (Chủ quán):';
                desc.innerHTML = 'Toàn quyền tối cao tất cả chức năng: Doanh thu/Tổng quan, Thực đơn & giá món, Quản lý bàn & QR, Quản lý nhân viên, <b>Cổng thanh toán MB Bank</b>, Sơ đồ bàn & Đơn hàng, Gọi phục vụ.';
            } else if (role === 'manager') {
                box.className = "p-3 bg-indigo-50 rounded-2xl border border-indigo-200 text-indigo-900 space-y-1";
                title.innerHTML = '<i class="fa-solid fa-crown text-indigo-600"></i> Quyền Quản lý (Manager):';
                desc.innerHTML = 'Quản lý vận hành toàn quán: Xem Doanh thu/Tổng quan, Quản lý thực đơn, Bàn & QR, Nhân viên, Sơ đồ bàn & Phục vụ. <b>TUYỆT ĐỐI KHÔNG có quyền xem hay cấu hình Cổng thanh toán MB Bank</b>.';
            } else {
                box.className = "p-3 bg-purple-50 rounded-2xl border border-purple-200 text-purple-900 space-y-1";
                title.innerHTML = '<i class="fa-solid fa-user-check text-purple-600"></i> Quyền Nhân viên:';
                desc.innerHTML = 'Được phép xem & thao tác <b>Sơ đồ Bàn & Đơn hàng</b> và <b>Gọi phục vụ</b>. Ẩn hoàn toàn doanh thu, thực đơn, bàn, quản lý nhân viên và <b>Cổng thanh toán</b>.';
            }
        }
    }

    function openStaffModal(defaultType) {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            if (typeof root.showAdminToast === 'function') {
                root.showAdminToast('Chỉ Quản trị viên (Chủ quán) mới có quyền quản lý nhân viên!', 'error');
            } else {
                alert('Chỉ Quản trị viên (Chủ quán) mới có quyền quản lý nhân viên!');
            }
            return;
        }
        const allStaff = root.allStaff || [];
        const selectedType = defaultType || (currentStaffFilter === 'app' ? 'app' : 'web');

        document.getElementById('modal-staff-title').innerText = selectedType === 'app' ? "Thêm Nhân Viên App Android" : "Thêm Tài Khoản Web Mới";
        document.getElementById('staff-edit-id').value = "";
        document.getElementById('staff-name').value = "";
        document.getElementById('staff-username').value = "";
        document.getElementById('staff-pin').value = "";
        document.getElementById('staff-status').value = "active";

        if (selectedType === 'app') {
            const radApp = document.getElementById('platform-app');
            if (radApp) radApp.checked = true;
            onStaffPlatformChange('app', 'waiter');
        } else {
            const radWeb = document.getElementById('platform-web');
            if (radWeb) radWeb.checked = true;
            onStaffPlatformChange('web', 'staff');
        }
        document.getElementById('modal-staff').classList.remove('hidden');
    }

    function closeStaffModal() {
        document.getElementById('modal-staff').classList.add('hidden');
    }

    function editStaff(id) {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            if (typeof root.showAdminToast === 'function') {
                root.showAdminToast('Chỉ Quản trị viên (Chủ quán) mới có quyền quản lý nhân viên!', 'error');
            } else {
                alert('Chỉ Quản trị viên (Chủ quán) mới có quyền quản lý nhân viên!');
            }
            return;
        }
        const allStaff = root.allStaff || [];
        const staff = allStaff.find(s => s.id === id);
        if (!staff) return;
        const isWeb = isStaffWeb(staff);

        document.getElementById('modal-staff-title').innerText = isWeb ? "Chỉnh Sửa Tài Khoản Web" : "Chỉnh Sửa Nhân Viên App Android";
        document.getElementById('staff-edit-id').value = staff.id;
        document.getElementById('staff-name').value = staff.name;
        document.getElementById('staff-username').value = staff.username;
        document.getElementById('staff-pin').value = "";
        const pinInput = document.getElementById('staff-pin');
        if (pinInput) pinInput.placeholder = "(Để trống nếu không đổi mật khẩu/PIN)";
        document.getElementById('staff-status').value = staff.status || "active";

        if (isWeb) {
            const radWeb = document.getElementById('platform-web');
            if (radWeb) radWeb.checked = true;
            onStaffPlatformChange('web', staff.role);
        } else {
            const radApp = document.getElementById('platform-app');
            if (radApp) radApp.checked = true;
            onStaffPlatformChange('app', staff.role);
        }
        document.getElementById('modal-staff').classList.remove('hidden');
    }

    async function saveStaff() {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert('Chỉ Quản trị viên (Chủ quán) mới có quyền lưu tài khoản nhân sự!');
            return;
        }
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        const id = document.getElementById('staff-edit-id').value;
        const name = document.getElementById('staff-name').value.trim();
        const username = document.getElementById('staff-username').value.trim().toLowerCase();
        const pin = document.getElementById('staff-pin').value.trim();
        const role = document.getElementById('staff-role').value;
        const status = document.getElementById('staff-status').value;
        const isWeb = document.getElementById('platform-web') ? document.getElementById('platform-web').checked : true;
        const platform = isWeb ? 'web' : 'app';

        if (!name || !username) {
            alert("Vui lòng điền đầy đủ Họ tên và Tên đăng nhập!");
            return;
        }

        if (!id && !pin) {
            alert("Vui lòng nhập Mật khẩu / Mã PIN cho tài khoản mới!");
            return;
        }

        if (pin && pin.length < 4) {
            alert("Mật khẩu / Mã PIN phải có ít nhất 4 ký tự!");
            return;
        }

        const allStaff = root.allStaff || [];
        const duplicate = allStaff.find(s => s.username === username && s.id !== id);
        if (duplicate) {
            alert(`Tên đăng nhập "${username}" đã tồn tại! Vui lòng chọn tên khác.`);
            return;
        }

        const staffObj = {
            name,
            username,
            role,
            platform,
            status
        };

        // Băm mã PIN SHA-256 an toàn (Tuyệt đối không lưu pin dạng plain-text)
        if (pin) {
            staffObj.pin_hash = await hashStaffPin(pin);
        }

        try {
            if (id) {
                await ops.updateDoc(ops.doc(db, "staff", id), staffObj);
                if (typeof root.showAdminToast === 'function') {
                    root.showAdminToast(`✅ Đã cập nhật tài khoản: ${name} (Bảo mật SHA-256)`, 'success');
                }
                if (typeof root.logAuditEvent === 'function') {
                    root.logAuditEvent('STAFF_UPDATE', 'STAFF', `Cập nhật thông tin nhân viên: ${name} (${username}) - Vai trò: ${role}`, {
                        staff_id: id,
                        username: username,
                        role: role,
                        status: staffObj.status
                    });
                }
            } else {
                staffObj.created_at = ops.serverTimestamp();
                const newDoc = await ops.addDoc(ops.collection(db, "staff"), staffObj);
                if (typeof root.showAdminToast === 'function') {
                    root.showAdminToast(`✅ Đã tạo tài khoản mới: ${name} (Bảo mật SHA-256)`, 'success');
                }
                if (typeof root.logAuditEvent === 'function') {
                    root.logAuditEvent('STAFF_CREATE', 'STAFF', `Tạo tài khoản nhân viên mới: ${name} (${username}) - Vai trò: ${role}`, {
                        staff_id: newDoc.id,
                        username: username,
                        role: role,
                        status: staffObj.status
                    });
                }
            }

            closeStaffModal();
            loadStaff();
        } catch (err) {
            console.error("Lỗi lưu nhân viên: ", err);
            alert("Lỗi khi lưu tài khoản nhân viên lên Firebase!");
        }
    }

    async function toggleStaffStatus(id, currentStatus) {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert('Chỉ Quản trị viên (Chủ quán) mới có quyền đổi trạng thái nhân sự!');
            return;
        }
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        try {
            await ops.updateDoc(ops.doc(db, "staff", id), { status: newStatus });
            if (typeof root.logAuditEvent === 'function') {
                const staffMember = (root.allStaff || []).find(s => s.id === id);
                const sName = staffMember ? staffMember.name : id;
                root.logAuditEvent('STAFF_TOGGLE_STATUS', 'STAFF', `${newStatus === 'active' ? 'Mở khóa' : 'Khóa'} tài khoản nhân viên: ${sName}`, {
                    staff_id: id,
                    status: newStatus
                });
            }
            loadStaff();
        } catch (err) {
            alert("Lỗi đổi trạng thái nhân viên!");
        }
    }

    async function deleteStaff(id, name) {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            alert('Chỉ Quản trị viên (Chủ quán) mới có quyền xóa tài khoản nhân sự!');
            return;
        }
        if (!confirm(`Bạn có chắc muốn xóa tài khoản của "${name}"?`)) return;
        const db = root.firebaseDb;
        const ops = root.firebaseOps;
        if (!db || !ops) return;

        try {
            await ops.deleteDoc(ops.doc(db, "staff", id));
            if (typeof root.showAdminToast === 'function') {
                root.showAdminToast(`Đã xóa tài khoản "${name}"`, 'info');
            }
            if (typeof root.logAuditEvent === 'function') {
                root.logAuditEvent('STAFF_DELETE', 'STAFF', `Xóa tài khoản nhân viên: ${name}`, {
                    staff_id: id,
                    name: name
                });
            }
            loadStaff();
        } catch (err) {
            alert("Lỗi xóa nhân viên!");
        }
    }

    // Xuất ra root (window) để giao diện HTML gọi được
    root.loadStaff = loadStaff;
    root.renderStaff = renderStaff;
    root.setStaffFilter = setStaffFilter;
    root.onStaffSearchInput = onStaffSearchInput;
    root.clearStaffSearch = clearStaffSearch;
    root.openStaffModal = openStaffModal;
    root.closeStaffModal = closeStaffModal;
    root.editStaff = editStaff;
    root.saveStaff = saveStaff;
    root.toggleStaffStatus = toggleStaffStatus;
    root.deleteStaff = deleteStaff;
    root.togglePinVisibility = togglePinVisibility;
    root.onStaffPlatformChange = onStaffPlatformChange;
    root.updateRoleHint = updateRoleHint;
    root.hashStaffPin = hashStaffPin;

})(typeof window !== 'undefined' ? window : this);
