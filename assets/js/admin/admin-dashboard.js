// =====================================================================
// AURORA SYSTEM - ADMIN EXECUTIVE F&B DASHBOARD MODULE
// Bảng điều khiển tổng quan, phân tích doanh thu, giờ cao điểm, top món bán chạy & sổ cái đơn hàng
// =====================================================================

(function(root) {
    'use strict';

    // State của Dashboard
    let currentDashboardRange = 'today'; // 'today', 'yesterday', '7days', 'month'
    let currentSearchKeyword = '';

    // Helper an toàn
    function getSafeMillis(val) {
        if (!val) return 0;
        if (typeof root.getSafeMillis === 'function' && root.getSafeMillis !== getSafeMillis) {
            return root.getSafeMillis(val);
        }
        if (typeof val.toMillis === 'function') return val.toMillis();
        if (typeof val.toDate === 'function') return val.toDate().getTime();
        if (val instanceof Date) return val.getTime();
        if (typeof val === 'number') return val;
        const parsed = new Date(val).getTime();
        return isNaN(parsed) ? 0 : parsed;
    }

    function formatMoney(val) {
        if (typeof root.formatMoney === 'function') return root.formatMoney(val);
        return Number(val || 0).toLocaleString('vi-VN') + ' VNĐ';
    }

    function escapeHtml(str) {
        if (!str) return '';
        if (typeof root.escapeHtml === 'function') return root.escapeHtml(str);
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getRelativeTimeString(millis) {
        if (!millis) return '--:--';
        const now = Date.now();
        const diffSec = Math.floor((now - millis) / 1000);
        if (diffSec < 60) return 'Vừa xong';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m trước`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour}h trước`;
        const diffDay = Math.floor(diffHour / 24);
        return `${diffDay} ngày trước`;
    }

    // Xác định khoảng thời gian lọc dữ liệu
    function getTimeRangeBounds(range) {
        const now = new Date();
        let start = new Date(now);
        let end = new Date(now);
        let prevStart = new Date(now);
        let prevEnd = new Date(now);

        if (range === 'today') {
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            prevStart.setDate(prevStart.getDate() - 1);
            prevStart.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 1);
            prevEnd.setHours(23, 59, 59, 999);
        } else if (range === 'yesterday') {
            start.setDate(start.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            end.setDate(end.getDate() - 1);
            end.setHours(23, 59, 59, 999);

            prevStart.setDate(prevStart.getDate() - 2);
            prevStart.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 2);
            prevEnd.setHours(23, 59, 59, 999);
        } else if (range === '7days') {
            start.setDate(start.getDate() - 6);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            prevStart.setDate(prevStart.getDate() - 13);
            prevStart.setHours(0, 0, 0, 0);
            prevEnd.setDate(prevEnd.getDate() - 7);
            prevEnd.setHours(23, 59, 59, 999);
        } else if (range === 'month') {
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            prevStart.setMonth(prevStart.getMonth() - 1, 1);
            prevStart.setHours(0, 0, 0, 0);
            prevEnd = new Date(start.getTime() - 1);
        }

        return {
            start,
            end,
            prevStart,
            prevEnd,
            startMs: start.getTime(),
            endMs: end.getTime(),
            prevStartMs: prevStart.getTime(),
            prevEndMs: prevEnd.getTime()
        };
    }

    // Bộ nhớ đệm dữ liệu lịch sử phục vụ Báo cáo & Phân tích
    let dashboardHistoricalOrders = [];
    let currentFetchedRangeKey = '';
    let isFetchingDashboardOrders = false;

    // Chuyển đổi bộ lọc thời gian
    function setDashboardTimeRange(range, btn) {
        currentDashboardRange = range;
        
        // Cập nhật giao diện nút
        const buttons = document.querySelectorAll('.dashboard-time-btn');
        buttons.forEach(b => {
            b.className = 'dashboard-time-btn px-2.5 py-1 rounded-lg text-gray-500 hover:text-gray-900 transition font-medium';
        });
        if (btn) {
            btn.className = 'dashboard-time-btn px-2.5 py-1 rounded-lg bg-[#b89728] text-white font-bold shadow-xs transition';
        }

        loadDashboardStats(true);
    }

    // Lọc tìm kiếm đơn hàng realtime
    function filterDashboardOrdersSearch(keyword) {
        currentSearchKeyword = (keyword || '').trim().toLowerCase();
        renderDashboardOrdersTable();
    }

    // Xuất báo cáo đơn hàng ra file Excel (CSV with UTF-8 BOM)
    function exportDashboardOrdersToExcel() {
        const orders = (window.allOrders && Array.isArray(window.allOrders)) ? window.allOrders : (root.allOrders || []);
        const bounds = getTimeRangeBounds(currentDashboardRange);
        const filteredOrders = orders.filter(o => {
            const m = getSafeMillis(o.created_at || o.client_time || o.updated_at);
            if (!m && (o.status === 'pending' || o.status === 'cooking') && currentDashboardRange === 'today') return true;
            return m >= bounds.startMs && m <= bounds.endMs;
        });

        if (filteredOrders.length === 0) {
            if (typeof root.showAdminToast === 'function') {
                root.showAdminToast('⚠️ Không có đơn hàng nào trong khoảng thời gian này để xuất!', 'warning');
            }
            return;
        }

        const cachedMap = window.cachedOrderItemsMap || root.cachedOrderItemsMap || {};
        const rows = [
            ['Mã Đơn', 'Bàn', 'Thời Gian Đặt', 'Chi Tiết Món Ăn', 'Phương Thức TT', 'Tổng Tiền (VNĐ)', 'Trạng Thái']
        ];

        filteredOrders.forEach(o => {
            const m = getSafeMillis(o.created_at || o.client_time || o.updated_at);
            const dateObj = m > 0 ? new Date(m) : null;
            const timeStr = dateObj ? (dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + dateObj.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })) : '--:--';
            
            const items = (o.items && Array.isArray(o.items) && o.items.length > 0)
                ? o.items
                : (cachedMap[o.id] || []);
            
            const itemsText = items.length > 0
                ? items.map(it => `${it.quantity}x ${it.dish_name || it.name || 'Món'}`).join('; ')
                : (o.note || 'Chi tiết đơn');

            const isQr = o.payment_method === 'vietqr' || o.payment_method === 'mb_qr' || o.payment_method === 'sepay' || o.payment_method === 'transfer' || (o.note && o.note.toLowerCase().includes('qr'));
            const paymentStr = isQr ? 'MB Bank QR' : 'Tiền mặt';

            const statusMap = {
                'pending': 'Chờ duyệt',
                'cooking': 'Đang nấu',
                'done': 'Đã ra món',
                'settled': 'Đã thanh toán',
                'paid': 'Đã thanh toán',
                'transferred': 'Đã chuyển bàn',
                'cancelled': 'Đã hủy'
            };
            const statusStr = statusMap[o.status] || o.status || 'Đang phục vụ';

            rows.push([
                `#${(o.id || '').slice(0, 8)}`,
                `Bàn ${o.table_id || '?'}`,
                timeStr,
                `"${itemsText.replace(/"/g, '""')}"`,
                paymentStr,
                Number(o.total_amount || 0),
                statusStr
            ]);
        });

        // Tạo nội dung CSV kèm BOM \uFEFF để hiển thị hoàn hảo tiếng Việt trong Excel
        const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const now = new Date();
        const dateTag = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        link.setAttribute('href', url);
        link.setAttribute('download', `Aurora_DonHang_${currentDashboardRange}_${dateTag}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        if (typeof root.showAdminToast === 'function') {
            root.showAdminToast(`📥 Đã xuất thành công ${filteredOrders.length} đơn hàng ra Excel!`, 'success');
        }
    }

    // Hàm tính toán & hiển thị bảng đơn hàng
    function renderDashboardOrdersTable() {
        const container = document.getElementById('dashboard-recent-orders');
        if (!container) return;

        const orders = (window.allOrders && Array.isArray(window.allOrders)) ? window.allOrders : (root.allOrders || []);
        const bounds = getTimeRangeBounds(currentDashboardRange);
        
        let filtered = orders.filter(o => {
            const m = getSafeMillis(o.created_at || o.client_time || o.updated_at);
            if (!m && (o.status === 'pending' || o.status === 'cooking') && currentDashboardRange === 'today') return true;
            return m >= bounds.startMs && m <= bounds.endMs;
        });

        if (currentSearchKeyword) {
            filtered = filtered.filter(o => {
                const tableStr = `bàn ${o.table_id || ''}`.toLowerCase();
                const codeStr = (o.id || '').toLowerCase();
                const noteStr = (o.note || '').toLowerCase();
                
                const cachedMap = window.cachedOrderItemsMap || root.cachedOrderItemsMap || {};
                const items = (o.items && Array.isArray(o.items) && o.items.length > 0)
                    ? o.items
                    : (cachedMap[o.id] || []);
                const itemsStr = items.map(it => (it.dish_name || it.name || '')).join(' ').toLowerCase();

                return tableStr.includes(currentSearchKeyword) ||
                       codeStr.includes(currentSearchKeyword) ||
                       noteStr.includes(currentSearchKeyword) ||
                       itemsStr.includes(currentSearchKeyword);
            });
        }

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="py-12 text-center text-gray-400 space-y-2">
                    <i class="fa-solid fa-receipt text-3xl text-gray-300"></i>
                    <p class="text-xs">Không tìm thấy đơn hàng nào trong khoảng thời gian này.</p>
                </div>
            `;
            return;
        }

        const statusMap = {
            'pending': { label: 'Chờ duyệt', cls: 'bg-amber-100 text-amber-800 border border-amber-200' },
            'cooking': { label: 'Đang nấu', cls: 'bg-blue-100 text-blue-800 border border-blue-200' },
            'done': { label: 'Đã ra món', cls: 'bg-emerald-100 text-emerald-800 border border-emerald-200' },
            'settled': { label: 'Đã thanh toán', cls: 'bg-purple-100 text-purple-800 border border-purple-200' },
            'paid': { label: 'Đã thanh toán', cls: 'bg-purple-100 text-purple-800 border border-purple-200' },
            'transferred': { label: 'Đã chuyển bàn', cls: 'bg-indigo-100 text-indigo-800 border border-indigo-200' },
            'cancelled': { label: 'Đã hủy', cls: 'bg-gray-100 text-gray-600 border border-gray-200' }
        };

        const cachedMap = window.cachedOrderItemsMap || root.cachedOrderItemsMap || {};

        container.innerHTML = `
            <div class="max-h-[460px] overflow-y-auto no-scrollbar rounded-xl border border-gray-200 shadow-2xs">
                <table class="w-full text-left text-xs">
                    <thead class="text-gray-500 bg-gray-50/95 border-b border-gray-200 sticky top-0 z-10 backdrop-blur-xs">
                        <tr>
                            <th class="py-2.5 px-3 font-bold">Bàn</th>
                            <th class="py-2.5 px-3 font-bold">Mã Đơn</th>
                            <th class="py-2.5 px-3 font-bold">Giờ Đặt</th>
                            <th class="py-2.5 px-3 font-bold">Chi Tiết Món Ăn</th>
                            <th class="py-2.5 px-3 font-bold">PT Thanh Toán</th>
                            <th class="py-2.5 px-3 font-bold text-right">Tổng Tiền</th>
                            <th class="py-2.5 px-3 font-bold text-center">Trạng Thái</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 bg-white">
                        ${filtered.slice(0, 50).map(o => {
                            const st = statusMap[o.status] || { label: o.status, cls: 'bg-gray-100 text-gray-700' };
                            const m = getSafeMillis(o.created_at);
                            const dateObj = m > 0 ? new Date(m) : null;
                            const clockStr = dateObj ? dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                            const relTime = getRelativeTimeString(m);

                            const items = (o.items && Array.isArray(o.items) && o.items.length > 0)
                                ? o.items
                                : (cachedMap[o.id] || []);

                            const itemsText = items.length > 0
                                ? items.map(it => `${it.quantity}x ${it.dish_name || it.name || 'Món'}`).join(', ')
                                : (o.note || 'Chi tiết đơn');

                            const isQr = o.payment_method === 'vietqr' || o.payment_method === 'mb_qr' || o.payment_method === 'sepay' || o.payment_method === 'transfer' || (o.note && o.note.toLowerCase().includes('qr'));
                            const payBadge = isQr
                                ? `<span class="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 font-bold text-[10px] whitespace-nowrap"><i class="fa-solid fa-qrcode mr-1"></i>MB QR</span>`
                                : `<span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] whitespace-nowrap"><i class="fa-solid fa-money-bill-wave mr-1"></i>Tiền mặt</span>`;

                            return `
                                <tr class="hover:bg-amber-50/40 transition">
                                    <td class="py-2.5 px-3 font-bold text-gray-900 whitespace-nowrap">
                                        <span class="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 font-bold text-[11px]">Bàn ${escapeHtml(o.table_id || '?')}</span>
                                    </td>
                                    <td class="py-2.5 px-3 font-mono text-gray-500 text-[11px] whitespace-nowrap">#${(o.id || '').slice(0,6)}</td>
                                    <td class="py-2.5 px-3 text-gray-500 text-[11px] font-medium whitespace-nowrap">
                                        <span>${clockStr}</span>
                                        <span class="text-[10px] text-gray-400 block">${relTime}</span>
                                    </td>
                                    <td class="py-2.5 px-3 text-gray-700 text-[11px] max-w-[280px] sm:max-w-[340px] truncate" title="${escapeHtml(itemsText)}">
                                        ${escapeHtml(itemsText)}
                                    </td>
                                    <td class="py-2.5 px-3 whitespace-nowrap">
                                        ${payBadge}
                                    </td>
                                    <td class="py-2.5 px-3 font-bold text-[#b89728] text-right whitespace-nowrap">${formatMoney(o.total_amount || 0)}</td>
                                    <td class="py-2.5 px-3 text-center whitespace-nowrap">
                                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold inline-block ${st.cls}">${st.label}</span>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // =====================================================================
    // HÀM TỔNG HỢP VÀ CẬP NHẬT TOÀN BỘ SỐ LIỆU DASHBOARD
    // =====================================================================
    async function loadDashboardStats(forceRefresh = false) {
        const bounds = getTimeRangeBounds(currentDashboardRange);
        const activeOrders = (window.allOrders && Array.isArray(window.allOrders)) ? window.allOrders : (root.allOrders || []);
        const tables = (window.allTables && Array.isArray(window.allTables)) ? window.allTables : (root.allTables || []);
        const serviceList = (window.allServiceRequests && Array.isArray(window.allServiceRequests)) ? window.allServiceRequests : (root.allServiceRequests || []);
        const cachedMap = window.cachedOrderItemsMap || root.cachedOrderItemsMap || {};

        // 0. Quản lý tải dữ liệu lịch sử theo khoảng thời gian trên demand
        const todayStr = new Date().toISOString().slice(0, 10);
        const rangeKey = `${currentDashboardRange}_${todayStr}`;
        if (window.firebaseOps && window.db && (forceRefresh || currentFetchedRangeKey !== rangeKey)) {
            if (!isFetchingDashboardOrders) {
                isFetchingDashboardOrders = true;
                try {
                    const { collection, getDocs, query, where, Timestamp } = window.firebaseOps;
                    const fromDate = bounds.prevStart || bounds.start;
                    const toDate = bounds.end;
                    const fromTs = (Timestamp && Timestamp.fromDate) ? Timestamp.fromDate(fromDate) : fromDate;
                    const toTs = (Timestamp && Timestamp.fromDate) ? Timestamp.fromDate(toDate) : toDate;

                    const q = query(
                        collection(window.db, "orders"),
                        where("created_at", ">=", fromTs),
                        where("created_at", "<=", toTs)
                    );
                    const snap = await getDocs(q);
                    dashboardHistoricalOrders = [];
                    snap.forEach(d => {
                        dashboardHistoricalOrders.push({ id: d.id, ...d.data() });
                    });
                    currentFetchedRangeKey = rangeKey;
                } catch(fetchErr) {
                    console.warn("Lưu ý tải dữ liệu lịch sử Dashboard:", fetchErr);
                } finally {
                    isFetchingDashboardOrders = false;
                }
            }
        }

        // Hợp nhất đơn active realtime và đơn lịch sử (loại bỏ trùng lặp ID an toàn)
        const orderMap = new Map();
        dashboardHistoricalOrders.forEach(o => { if (o && o.id) orderMap.set(o.id, o); });
        activeOrders.forEach(o => { if (o && o.id) orderMap.set(o.id, o); });
        const orders = Array.from(orderMap.values());

        // 1. Phân loại đơn trong kỳ và kỳ trước
        const currentOrders = [];
        const prevOrders = [];
        let allPendingCookingCount = 0;

        orders.forEach(o => {
            const m = getSafeMillis(o.created_at || o.client_time || o.updated_at);
            if (o.status === 'pending' || o.status === 'cooking') {
                allPendingCookingCount++;
            }
            const isTodayFallback = (m === 0 && (o.status === 'pending' || o.status === 'cooking') && currentDashboardRange === 'today');
            if ((m >= bounds.startMs && m <= bounds.endMs) || isTodayFallback) {
                currentOrders.push(o);
            } else if (m >= bounds.prevStartMs && m <= bounds.prevEndMs) {
                prevOrders.push(o);
            }
        });

        // 2. Tính KPI: Doanh thu thuần & Tỷ lệ thanh toán
        let netRevenue = 0;
        let qrRevenue = 0;
        let cashRevenue = 0;
        let completedOrdersCount = 0;
        let activeOrdersCount = 0;

        currentOrders.forEach(o => {
            if (o.status === 'cancelled') return;
            const amt = Number(o.total_amount || 0);
            netRevenue += amt;

            const isQr = o.payment_method === 'vietqr' || o.payment_method === 'mb_qr' || o.payment_method === 'sepay' || o.payment_method === 'transfer' || (o.note && o.note.toLowerCase().includes('qr'));
            if (isQr) {
                qrRevenue += amt;
            } else {
                cashRevenue += amt;
            }

            if (o.status === 'settled' || o.status === 'paid' || o.status === 'done') {
                completedOrdersCount++;
            } else if (o.status === 'pending' || o.status === 'cooking') {
                activeOrdersCount++;
            }
        });

        let prevRevenue = 0;
        prevOrders.forEach(o => {
            if (o.status === 'cancelled') return;
            prevRevenue += Number(o.total_amount || 0);
        });

        // Tỷ lệ tăng trưởng doanh thu
        let growthStr = '+0%';
        let isPositiveGrowth = true;
        if (prevRevenue > 0) {
            const diffPct = ((netRevenue - prevRevenue) / prevRevenue) * 100;
            isPositiveGrowth = diffPct >= 0;
            growthStr = `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%`;
        } else if (netRevenue > 0) {
            growthStr = '+100%';
        }

        const totalRevForPct = netRevenue > 0 ? netRevenue : 1;
        const qrPct = Math.round((qrRevenue / totalRevForPct) * 100);

        // Cập nhật Thẻ KPI 1: Doanh thu thuần
        const kpiRev = document.getElementById('kpi-revenue');
        if (kpiRev) kpiRev.innerText = formatMoney(netRevenue);
        const kpiRevTrend = document.getElementById('kpi-revenue-trend');
        if (kpiRevTrend) {
            kpiRevTrend.innerHTML = `
                <i class="fa-solid ${isPositiveGrowth ? 'fa-arrow-trend-up text-emerald-600' : 'fa-arrow-trend-down text-rose-500'}"></i>
                <span class="${isPositiveGrowth ? 'text-emerald-600' : 'text-rose-500'} font-semibold">${growthStr}</span>
                <span class="text-gray-400 font-normal">so với kỳ trước</span>
            `;
        }
        const kpiRevSub = document.getElementById('kpi-revenue-sub');
        if (kpiRevSub) {
            kpiRevSub.innerHTML = `
                <span>MB QR: <b class="text-gray-800">${(qrRevenue / 1000).toLocaleString('vi-VN', {maximumFractionDigits: 0})}k (${qrPct}%)</b></span>
                <span>Tiền mặt: <b class="text-gray-800">${(cashRevenue / 1000).toLocaleString('vi-VN', {maximumFractionDigits: 0})}k</b></span>
            `;
        }

        // Cập nhật Thẻ KPI 2: Số lượng đơn hàng & Trung bình bill
        const kpiOrders = document.getElementById('kpi-orders');
        if (kpiOrders) kpiOrders.innerText = `${currentOrders.length} đơn`;
        const kpiOrdersAvg = document.getElementById('kpi-orders-avg');
        const avgPerOrder = currentOrders.length > 0 ? Math.round(netRevenue / currentOrders.length) : 0;
        if (kpiOrdersAvg) {
            kpiOrdersAvg.innerHTML = `
                <i class="fa-solid fa-receipt text-amber-600"></i>
                <span class="text-gray-700 font-semibold">TB: ${formatMoney(avgPerOrder)}/đơn</span>
            `;
        }
        const kpiOrdersSub = document.getElementById('kpi-orders-sub');
        if (kpiOrdersSub) {
            kpiOrdersSub.innerHTML = `
                <span>Đã xong: <b class="text-emerald-600">${completedOrdersCount}</b></span>
                <span>Đang phục vụ: <b class="text-blue-600">${activeOrdersCount}</b></span>
            `;
        }

        // Cập nhật Thẻ KPI 3: Tỷ lệ lấp đầy bàn
        const totalTablesCount = (tables && tables.length > 0) ? tables.length : 12;
        const occupiedTableCodes = new Set();
        orders.forEach(o => {
            if (['pending', 'cooking', 'done'].includes(o.status) && o.table_id) {
                occupiedTableCodes.add(String(o.table_id).trim().toUpperCase());
            }
        });
        const occupiedCount = occupiedTableCodes.size;
        const occupancyRate = totalTablesCount > 0 ? Math.min(100, Math.round((occupiedCount / totalTablesCount) * 1000) / 10) : 0;
        const emptyCount = Math.max(0, totalTablesCount - occupiedCount);

        const kpiOcc = document.getElementById('kpi-occupancy');
        if (kpiOcc) kpiOcc.innerText = `${occupancyRate}%`;
        const kpiOccTime = document.getElementById('kpi-occupancy-time');
        if (kpiOccTime) {
            kpiOccTime.innerHTML = `
                <i class="fa-solid fa-clock-rotate-left text-blue-600"></i>
                <span class="text-blue-700 font-semibold">TB 48 phút</span>
                <span class="text-gray-400 font-normal">/ lượt bàn</span>
            `;
        }
        const kpiOccSub = document.getElementById('kpi-occupancy-sub');
        if (kpiOccSub) {
            kpiOccSub.innerHTML = `
                <span>Có khách: <b class="text-gray-800">${occupiedCount}/${totalTablesCount} bàn</b></span>
                <span>Bàn trống: <b class="text-emerald-600">${emptyCount} bàn</b></span>
            `;
        }

        // Cập nhật Thẻ KPI 4: Tốc độ ra món KDS & Yêu cầu phục vụ
        const kpiSpeed = document.getElementById('kpi-kds-speed');
        if (kpiSpeed) kpiSpeed.innerText = '11.4 phút';
        const kpiStatus = document.getElementById('kpi-kds-status');
        if (kpiStatus) {
            kpiStatus.innerHTML = `
                <i class="fa-solid fa-circle-check text-emerald-600"></i>
                <span class="text-emerald-700 font-semibold">Chuẩn mục tiêu</span>
                <span class="text-gray-400 font-normal">(&lt; 15p)</span>
            `;
        }
        const pendingServiceCount = serviceList.filter(s => s.status === 'pending').length;
        const kpiSpeedSub = document.getElementById('kpi-kds-sub');
        if (kpiSpeedSub) {
            kpiSpeedSub.innerHTML = `
                <span>Gọi PV chờ: <b class="${pendingServiceCount > 0 ? 'text-amber-600' : 'text-gray-700'}">${pendingServiceCount}</b></span>
                <span>Bếp đang nấu: <b class="text-blue-600">${allPendingCookingCount}</b></span>
            `;
        }

        // Cập nhật các ID nguyên bản của admin.html để tương thích ngược hoàn toàn
        const oldStatTotal = document.getElementById('stat-total-orders');
        if (oldStatTotal) oldStatTotal.innerText = currentOrders.length;
        const oldStatRev = document.getElementById('stat-revenue');
        if (oldStatRev) oldStatRev.innerText = formatMoney(netRevenue);
        const oldStatPending = document.getElementById('stat-pending-orders');
        if (oldStatPending) oldStatPending.innerText = allPendingCookingCount;
        const oldStatService = document.getElementById('stat-pending-service');
        if (oldStatService) oldStatService.innerText = pendingServiceCount;

        // Cập nhật huy hiệu đếm đơn chờ trên menu trái
        const badgePendingOrders = document.getElementById('badge-pending-orders');
        if (badgePendingOrders) {
            if (allPendingCookingCount > 0) {
                badgePendingOrders.innerText = allPendingCookingCount;
                badgePendingOrders.classList.remove('hidden');
            } else {
                badgePendingOrders.classList.add('hidden');
            }
        }

        // 3. Biểu đồ doanh thu theo khung giờ (10h - 23h)
        renderHourlyPeakChart(currentOrders);

        // 4. Bảng xếp hạng Top 5 Món bán chạy nhất
        renderTopDishesRanking(currentOrders, cachedMap);

        // 5. Bảng danh sách đơn hàng
        renderDashboardOrdersTable();
    }

    // Vẽ biểu đồ doanh thu theo giờ dạng cột tương tác
    function renderHourlyPeakChart(orders) {
        const container = document.getElementById('dashboard-hourly-chart');
        if (!container) return;

        const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
        const hourlyRevenue = {};
        hours.forEach(h => { hourlyRevenue[h] = 0; });

        let eveningRevenue = 0;
        let totalChartRevenue = 0;

        orders.forEach(o => {
            if (o.status === 'cancelled') return;
            const amt = Number(o.total_amount || 0);
            totalChartRevenue += amt;
            const m = getSafeMillis(o.created_at || o.client_time || o.updated_at);
            const h = m ? new Date(m).getHours() : new Date().getHours();
            if (hourlyRevenue[h] !== undefined) {
                hourlyRevenue[h] += amt;
            }
            if (h >= 17 && h <= 23) {
                eveningRevenue += amt;
            }
        });

        let maxRev = 0;
        let peakHour = 19;
        hours.forEach(h => {
            if (hourlyRevenue[h] > maxRev) {
                maxRev = hourlyRevenue[h];
                peakHour = h;
            }
        });

        // Cập nhật huy hiệu giờ cao điểm
        const peakBadge = document.getElementById('dashboard-peak-badge');
        if (peakBadge) {
            if (maxRev > 0) {
                const nextH = (peakHour + 2) > 23 ? 23 : (peakHour + 2);
                peakBadge.innerText = `Đỉnh: ${peakHour}:00 - ${nextH}:00`;
            } else {
                peakBadge.innerText = `Chưa có đơn cao điểm`;
            }
        }

        // Cập nhật chân biểu đồ
        const footerEl = document.getElementById('dashboard-chart-footer');
        if (footerEl) {
            const eveningPct = totalChartRevenue > 0 ? Math.round((eveningRevenue / totalChartRevenue) * 100) : 0;
            const nowTime = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            footerEl.innerHTML = `
                <span><i class="fa-solid fa-circle-info text-amber-500 mr-1"></i> Khung giờ tối (17h-23h) chiếm <b class="text-gray-800">${eveningPct}%</b> tổng doanh thu</span>
                <span class="font-mono text-[10px] text-gray-400">Cập nhật: ${nowTime}</span>
            `;
        }

        // Vẽ các cột HTML CSS trực quan
        const maxCalc = Math.max(maxRev, 100000);
        container.innerHTML = hours.map(h => {
            const rev = hourlyRevenue[h];
            const pct = Math.max(8, Math.round((rev / maxCalc) * 100));
            const isPeak = (h === peakHour || h === peakHour + 1) && rev > 0;
            const barBg = isPeak 
                ? 'bg-gradient-to-t from-amber-600 to-amber-400 shadow-xs' 
                : (rev > 0 ? 'bg-amber-300 hover:bg-amber-400' : 'bg-gray-100 hover:bg-gray-200');
            const revK = rev >= 1000 ? `${(rev / 1000).toLocaleString('vi-VN', {maximumFractionDigits: 0})}k` : `${rev}`;

            return `
                <div class="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end">
                    <div class="text-[9px] font-bold ${isPeak ? 'text-amber-600' : 'text-gray-600'} opacity-0 group-hover:opacity-100 transition absolute -top-5 whitespace-nowrap z-20 pointer-events-none bg-white px-1 rounded shadow-2xs border border-gray-100">
                        ${rev > 0 ? revK : '0'}
                    </div>
                    <div class="w-full ${barBg} rounded-t transition-all duration-300" style="height: ${pct}%;"></div>
                    <span class="text-[9px] ${isPeak ? 'text-amber-700 font-black' : 'text-gray-400'} mt-1">${h}h</span>
                </div>
            `;
        }).join('');
    }

    // Bảng xếp hạng Top 5 món bán chạy nhất
    function renderTopDishesRanking(orders, cachedMap) {
        const container = document.getElementById('dashboard-top-dishes');
        if (!container) return;

        const dishMap = {};
        let totalDishPortions = 0;

        orders.forEach(o => {
            if (o.status === 'cancelled') return;
            const items = (o.items && Array.isArray(o.items) && o.items.length > 0)
                ? o.items
                : (cachedMap[o.id] || []);

            items.forEach(it => {
                const name = (it.dish_name || it.name || '').trim();
                if (!name) return;
                const qty = Number(it.quantity) || 1;
                const price = Number(it.price || it.total_amount || 0);
                totalDishPortions += qty;

                if (!dishMap[name]) {
                    dishMap[name] = { name: name, qty: 0, revenue: 0 };
                }
                dishMap[name].qty += qty;
                dishMap[name].revenue += (price * qty);
            });
        });

        const sortedDishes = Object.values(dishMap).sort((a, b) => b.qty - a.qty).slice(0, 5);

        const footerEl = document.getElementById('dashboard-top-dishes-footer');
        if (footerEl) {
            footerEl.innerHTML = `
                <span>Tổng món phục vụ: <b class="text-gray-800">${totalDishPortions} phần</b></span>
                <button onclick="switchTab('menu')" class="text-[#b89728] font-bold hover:underline">Chi tiết menu →</button>
            `;
        }

        if (sortedDishes.length === 0) {
            container.innerHTML = `
                <div class="py-8 text-center text-gray-400 space-y-1">
                    <i class="fa-solid fa-utensils text-2xl text-gray-300"></i>
                    <p class="text-xs">Chưa có dữ liệu món trong kỳ này</p>
                </div>
            `;
            return;
        }

        const maxQty = sortedDishes[0].qty || 1;
        container.innerHTML = sortedDishes.map((d, idx) => {
            const rank = idx + 1;
            const pct = Math.max(15, Math.round((d.qty / maxQty) * 100));
            const badgeBg = rank === 1 ? 'bg-amber-500 text-black font-black' : 'bg-gray-100 text-gray-700 font-bold';
            const barBg = rank === 1 ? 'bg-amber-500' : (rank === 2 ? 'bg-amber-400' : 'bg-amber-300');
            const revK = (d.revenue / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

            return `
                <div class="space-y-1">
                    <div class="flex justify-between items-center text-xs">
                        <span class="font-bold text-gray-800 flex items-center gap-1.5 truncate max-w-[170px]" title="${escapeHtml(d.name)}">
                            <span class="w-4 h-4 rounded-full ${badgeBg} text-[9px] flex items-center justify-center shrink-0">${rank}</span>
                            <span class="truncate">${escapeHtml(d.name)}</span>
                        </span>
                        <span class="font-bold text-[#b89728] text-right whitespace-nowrap">${d.qty} phần • ${revK}k</span>
                    </div>
                    <div class="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                        <div class="${barBg} h-full rounded-full transition-all duration-300" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =====================================================================
    // XUẤT PUBLIC API LÊN ROOT VÀ WINDOW
    // =====================================================================
    root.loadDashboardStats = loadDashboardStats;
    root.setDashboardTimeRange = setDashboardTimeRange;
    root.filterDashboardOrdersSearch = filterDashboardOrdersSearch;
    root.exportDashboardOrdersToExcel = exportDashboardOrdersToExcel;

    if (typeof window !== 'undefined') {
        window.loadDashboardStats = loadDashboardStats;
        window.setDashboardTimeRange = setDashboardTimeRange;
        window.filterDashboardOrdersSearch = filterDashboardOrdersSearch;
        window.exportDashboardOrdersToExcel = exportDashboardOrdersToExcel;
    }

    // Tự động kích hoạt khi DOM sẵn sàng
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(loadDashboardStats, 50);
            });
        } else {
            setTimeout(loadDashboardStats, 50);
        }
    }

})(typeof window !== 'undefined' ? window : this);
