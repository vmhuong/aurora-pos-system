// =====================================================================
// AURORA SYSTEM - AUDIT LOG & COMPLIANCE TRAIL MODULE
// Nhật ký kiểm toán hệ thống: Ghi nhận và giám sát mọi thao tác nhạy cảm
// (Thanh toán, Hủy món, Chuyển bàn, Đổi giá món, Thêm/Sửa/Khóa nhân sự, Đăng nhập)
// Dữ liệu bất biến (Append-only) chống sửa/xóa dấu vết
// =====================================================================

(function(root) {
    'use strict';

    let allAuditLogs = [];
    let auditFilterCategory = 'ALL';
    let auditSearchQuery = '';
    let auditUnsubscribe = null;
    let isAuditInitialized = false;

    /**
     * Ghi nhận một sự kiện kiểm toán vào Firestore collection 'audit_logs'
     * @param {string} action - Mã hành động (VD: 'BILL_SETTLE', 'ORDER_CANCEL_ITEM', 'ORDER_CANCEL', 'TABLE_TRANSFER', 'STAFF_UPDATE')
     * @param {string} category - Danh mục ('PAYMENT' | 'ORDERS' | 'MENU' | 'STAFF' | 'SYSTEM')
     * @param {string} details - Mô tả chi tiết hành động
     * @param {object} metadata - Dữ liệu mở rộng (bàn, số tiền, ID món...)
     */
    async function logAuditEvent(action, category, details, metadata = {}) {
        // Bỏ qua hoàn toàn các sự kiện đăng nhập / đăng xuất theo yêu cầu
        const normAction = String(action || 'UNKNOWN_ACTION').toUpperCase();
        const normCategory = String(category || 'SYSTEM').toUpperCase();
        if (normAction === 'AUTH_LOGIN' || normAction === 'AUTH_LOGOUT' || normCategory === 'AUTH') {
            return;
        }

        try {
            const db = root.firebaseDb || (typeof window !== 'undefined' ? (window.firebaseDb || window.db) : null) || root.db;
            const ops = root.firebaseOps || (typeof window !== 'undefined' ? window.firebaseOps : null);
            if (!db || !ops || typeof ops.addDoc !== 'function' || typeof ops.collection !== 'function') {
                console.warn('[AUDIT LOG] Firebase DB hoặc Ops chưa sẵn sàng');
                return;
            }

            let actor = null;
            if (root.AdminAuth && typeof root.AdminAuth.getCurrentUser === 'function') {
                actor = root.AdminAuth.getCurrentUser();
            }
            if (!actor) {
                try {
                    actor = JSON.parse(localStorage.getItem('aurora_current_user') || 'null');
                } catch(e) {}
            }

            const actorName = actor ? (actor.name || actor.username || 'Nhân viên') : 'Khách / Hệ thống';
            const actorUsername = actor ? (actor.username || actor.email || 'system') : 'system';
            const actorRole = actor ? (actor.role || 'staff') : 'guest';
            const platform = actor ? (actor.platform || 'web') : 'web';

            // Làm sạch metadata chống lỗi undefined trên Firestore
            const cleanMetadata = {};
            if (metadata && typeof metadata === 'object') {
                for (const k of Object.keys(metadata)) {
                    if (metadata[k] !== undefined && metadata[k] !== null) {
                        cleanMetadata[k] = metadata[k];
                    }
                }
            }

            const logEntry = {
                action: normAction,
                category: normCategory,
                details: String(details || '').trim(),
                actor_name: actorName,
                actor_username: actorUsername,
                actor_role: actorRole,
                platform: platform,
                metadata: cleanMetadata,
                created_at: (typeof ops.serverTimestamp === 'function') ? ops.serverTimestamp() : new Date(),
                timestamp_ms: Date.now()
            };

            await ops.addDoc(ops.collection(db, 'audit_logs'), logEntry);
        } catch (err) {
            console.warn('[AUDIT LOG] Lỗi ghi nhận nhật ký (không chặn luồng chính):', err);
        }
    }

    /**
     * Khởi tạo lắng nghe realtime các sự kiện Audit Log mới nhất (tối đa 100 sự kiện)
     */
    function initAuditLogModule() {
        if (isAuditInitialized) return;
        const db = root.firebaseDb || (typeof window !== 'undefined' ? (window.firebaseDb || window.db) : null) || root.db;
        const ops = root.firebaseOps || (typeof window !== 'undefined' ? window.firebaseOps : null);
        if (!db || !ops || typeof ops.collection !== 'function' || typeof ops.onSnapshot !== 'function') {
            return;
        }

        try {
            const colRef = ops.collection(db, 'audit_logs');
            const q = (typeof ops.query === 'function' && typeof ops.orderBy === 'function' && typeof ops.limit === 'function')
                ? ops.query(colRef, ops.orderBy('created_at', 'desc'), ops.limit(100))
                : colRef;

            if (auditUnsubscribe) {
                auditUnsubscribe();
            }

            auditUnsubscribe = ops.onSnapshot(q, (snapshot) => {
                const logs = [];
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    logs.push({ id: docSnap.id, ...data });
                });
                allAuditLogs = logs;
                renderAuditLogView();
            }, (err) => {
                console.warn('[AUDIT LOG] Lỗi lắng nghe audit_logs:', err);
            });

            isAuditInitialized = true;
        } catch (e) {
            console.warn('[AUDIT LOG] Khởi tạo audit log listener thất bại:', e);
        }
    }

    function setAuditCategoryFilter(cat) {
        auditFilterCategory = cat;
        // Cập nhật giao diện nút bấm bộ lọc
        document.querySelectorAll('.btn-audit-filter').forEach(btn => {
            const btnCat = btn.getAttribute('data-cat');
            if (btnCat === cat) {
                btn.className = 'btn-audit-filter px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-xs bg-[#d4af37] text-white';
            } else {
                btn.className = 'btn-audit-filter px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-xs bg-white text-gray-600 hover:bg-gray-100 border border-gray-200';
            }
        });
        renderAuditLogView();
    }

    function setAuditSearchQuery(query) {
        auditSearchQuery = (query || '').toLowerCase().trim();
        renderAuditLogView();
    }

    function formatAuditTimestamp(created_at, timestamp_ms) {
        let d = null;
        if (created_at && typeof created_at.toDate === 'function') {
            d = created_at.toDate();
        } else if (created_at && created_at.seconds) {
            d = new Date(created_at.seconds * 1000);
        } else if (timestamp_ms) {
            d = new Date(timestamp_ms);
        } else {
            d = new Date();
        }

        const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return { timeStr, dateStr, fullStr: `${timeStr} - ${dateStr}` };
    }

    function getCategoryBadge(category) {
        switch (category) {
            case 'PAYMENT':
                return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <i class="fa-solid fa-money-bill-wave text-emerald-600"></i> Thanh toán
                </span>`;
            case 'ORDERS':
                return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                    <i class="fa-solid fa-utensils text-blue-600"></i> Đơn & Bàn
                </span>`;
            case 'STAFF':
                return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
                    <i class="fa-solid fa-user-shield text-purple-600"></i> Nhân sự
                </span>`;
            case 'MENU':
                return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    <i class="fa-solid fa-book-open text-amber-600"></i> Thực đơn
                </span>`;
            case 'AUTH':
                return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
                    <i class="fa-solid fa-right-to-bracket text-indigo-600"></i> Đăng nhập
                </span>`;
            default:
                return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-800 border border-gray-300">
                    <i class="fa-solid fa-gear text-gray-600"></i> Hệ thống
                </span>`;
        }
    }

    function getRoleBadge(role) {
        const r = String(role || '').toLowerCase();
        if (r === 'admin' || r === 'superadmin' || r === 'owner') {
            return `<span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">Quản trị viên</span>`;
        }
        if (r === 'manager' || r === 'quanly') {
            return `<span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Quản lý</span>`;
        }
        return `<span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">Nhân viên</span>`;
    }

    /**
     * Render bảng hiển thị Audit Logs
     */
    function renderAuditLogView() {
        if (typeof window.isAdminRole === 'function' && !window.isAdminRole()) {
            const tbody = document.getElementById('audit-log-tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400 font-medium">Bạn không có quyền truy cập nhật ký kiểm toán! Chỉ Quản trị viên (Chủ quán) mới có quyền xem.</td></tr>';
            }
            return;
        }
        const tbody = document.getElementById('audit-log-tbody');
        const emptyState = document.getElementById('audit-log-empty');
        const countBadge = document.getElementById('audit-total-count');
        if (!tbody) return;

        let filtered = allAuditLogs.filter(l => l.category !== 'AUTH' && l.action !== 'AUTH_LOGIN' && l.action !== 'AUTH_LOGOUT');
        if (auditFilterCategory !== 'ALL') {
            filtered = filtered.filter(l => l.category === auditFilterCategory);
        }
        if (auditSearchQuery) {
            filtered = filtered.filter(l => {
                const details = (l.details || '').toLowerCase();
                const actor = (l.actor_name || '').toLowerCase();
                const username = (l.actor_username || '').toLowerCase();
                const action = (l.action || '').toLowerCase();
                return details.includes(auditSearchQuery) || actor.includes(auditSearchQuery) || username.includes(auditSearchQuery) || action.includes(auditSearchQuery);
            });
        }

        if (countBadge) {
            countBadge.innerText = `${filtered.length} sự kiện`;
        }

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        let html = '';
        filtered.forEach((log) => {
            const timeObj = formatAuditTimestamp(log.created_at, log.timestamp_ms);
            const catBadge = getCategoryBadge(log.category);
            const roleBadge = getRoleBadge(log.actor_role);
            const actorDisplay = `${log.actor_name || 'Hệ thống'} <span class="text-[10px] text-gray-400 font-mono">(${log.actor_username || 'system'})</span>`;

            html += `
                <tr class="hover:bg-amber-50/40 transition border-b border-gray-100 text-xs">
                    <td class="p-4 font-mono text-gray-500 whitespace-nowrap">
                        <div class="font-bold text-gray-800">${timeObj.timeStr}</div>
                        <div class="text-[10px] text-gray-400">${timeObj.dateStr}</div>
                    </td>
                    <td class="p-4 whitespace-nowrap">
                        ${catBadge}
                    </td>
                    <td class="p-4">
                        <div class="font-semibold text-gray-900 leading-snug">${log.details || ''}</div>
                        ${log.metadata && Object.keys(log.metadata).length > 0 ? `
                            <div class="text-[10px] text-gray-500 font-mono mt-1 bg-gray-50 p-1.5 rounded-lg border border-gray-100 max-w-md truncate">
                                ${JSON.stringify(log.metadata).replace(/["{}]/g, '').replace(/,/g, ' · ')}
                            </div>
                        ` : ''}
                    </td>
                    <td class="p-4 whitespace-nowrap">
                        <div class="font-bold text-gray-800">${actorDisplay}</div>
                        <div class="mt-0.5">${roleBadge}</div>
                    </td>
                    <td class="p-4 font-mono text-[10px] text-gray-400 whitespace-nowrap">
                        <span class="px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-bold">${log.platform === 'app' ? 'App Android' : 'Web Quản trị'}</span>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    /**
     * Xuất dữ liệu nhật ký kiểm toán ra tệp CSV cho Quản lý / Chủ quán
     */
    function exportAuditLogsToCSV() {
        const validLogs = (allAuditLogs || []).filter(l => l.category !== 'AUTH' && l.action !== 'AUTH_LOGIN' && l.action !== 'AUTH_LOGOUT');
        if (validLogs.length === 0) {
            if (typeof root.showAdminToast === 'function') {
                root.showAdminToast('Chưa có dữ liệu nhật ký để xuất!', 'info');
            }
            return;
        }

        let csv = '\uFEFFThời gian,Danh mục,Hành động,Chi tiết thao tác,Người thực hiện,Tên tài khoản,Vai trò,Thiết bị\n';
        validLogs.forEach(l => {
            const timeObj = formatAuditTimestamp(l.created_at, l.timestamp_ms);
            const row = [
                `"${timeObj.fullStr}"`,
                `"${l.category || ''}"`,
                `"${l.action || ''}"`,
                `"${(l.details || '').replace(/"/g, '""')}"`,
                `"${l.actor_name || ''}"`,
                `"${l.actor_username || ''}"`,
                `"${l.actor_role || ''}"`,
                `"${l.platform || 'web'}"`
            ];
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Aurora_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof root.showAdminToast === 'function') {
            root.showAdminToast('Đã xuất tệp Audit Log CSV thành công!', 'success');
        }
    }

    // Xuất ra phạm vi toàn cục (Global Exports)
    root.logAuditEvent = logAuditEvent;
    root.initAuditLogModule = initAuditLogModule;
    root.setAuditCategoryFilter = setAuditCategoryFilter;
    root.setAuditSearchQuery = setAuditSearchQuery;
    root.renderAuditLogView = renderAuditLogView;
    root.exportAuditLogsToCSV = exportAuditLogsToCSV;

})(typeof window !== 'undefined' ? window : this);
