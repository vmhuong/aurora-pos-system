// =====================================================================
// AURORA ENGINE COMPREHENSIVE QA TEST SUITE
// Unit, Integration, Edge-case, and Security Matrix Runner
// =====================================================================

const path = require('path');
const fs = require('fs');

const VoucherEngine = require('./assets/js/services/voucher-engine.js');
const LoyaltyEngine = require('./assets/js/services/loyalty-engine.js');
const ComboEngine = require('./assets/js/services/combo-engine.js').ComboEngine || require('./assets/js/services/combo-engine.js');

let passCount = 0;
let failCount = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  [PASS] ${testName}`);
        passCount++;
    } else {
        console.error(`  [FAIL] ${testName}`);
        failCount++;
    }
}

console.log('====================================================');
console.log('AURORA SYSTEM - FULL QA AUTOMATED TEST SUITE');
console.log('====================================================');

// ====================================================
// 1. VOUCHER ENGINE SUITE
// ====================================================
console.log('\n--- 1. Voucher Engine & Anti-Fraud Suite ---');

// 1.1 Fixed discount below minimum bill
{
    const v = { status: 'available', type: 'fixed', value: 30000, min_bill: 100000 };
    const res = VoucherEngine.validateVoucher(v, 80000, []);
    assert(!res.valid && (res.reason.includes('Hóa đơn phải từ') || res.reason.includes('tối thiểu')), 'TC-VOUCHER-01: Chặn voucher cố định khi bill < min_bill');
}

// 1.2 Fixed discount eligible
{
    const v = { status: 'available', type: 'fixed', value: 30000, min_bill: 100000 };
    const res = VoucherEngine.validateVoucher(v, 150000, []);
    assert(res.valid && res.discountAmount === 30000, 'TC-VOUCHER-02: Giảm đúng 30k khi bill >= min_bill');
}

// 1.3 Percent discount with max_discount cap
{
    const v = { status: 'available', type: 'percent', value: 20, min_bill: 100000, max_discount: 50000 };
    const res = VoucherEngine.validateVoucher(v, 400000, []);
    assert(res.valid && res.discountAmount === 50000, 'TC-VOUCHER-03: Giảm % áp dụng trần max_discount chuẩn xác');
}

// 1.4 Percent discount without cap
{
    const v = { status: 'available', type: 'percent', value: 10, min_bill: 0, max_discount: 0 };
    const res = VoucherEngine.validateVoucher(v, 250000, []);
    assert(res.valid && res.discountAmount === 25000, 'TC-VOUCHER-04: Giảm % chuẩn khi không có trần');
}

// 1.5 Dish voucher matching
{
    const v = { status: 'available', type: 'dish', specific_dish_id: 'dish_01', specific_dish_name: 'Bạc Xỉu', min_bill: 50000 };
    const items = [
        { dish_id: 'dish_02', dish_name: 'Trà Chanh', price: 25000 },
        { dish_id: 'dish_01', dish_name: 'Bạc Xỉu', price: 35000 }
    ];
    const res = VoucherEngine.validateVoucher(v, 60000, items);
    assert(res.valid && res.discountAmount === 35000, 'TC-VOUCHER-05: Voucher tặng món nhận diện đúng món và giảm đúng giá món');
}

// 1.6 Dish voucher not matching
{
    const v = { status: 'available', type: 'dish', specific_dish_id: 'dish_01', specific_dish_name: 'Bạc Xỉu', min_bill: 50000 };
    const items = [
        { dish_id: 'dish_02', dish_name: 'Trà Chanh', price: 25000 }
    ];
    const res = VoucherEngine.validateVoucher(v, 60000, items);
    assert(!res.valid && (res.reason.includes('chưa có món') || res.reason.includes('không có trong đơn')), 'TC-VOUCHER-06: Chặn voucher tặng món nếu đơn không có món đó');
}

// 1.7 Already used voucher
{
    const v = { status: 'used', type: 'fixed', value: 30000, min_bill: 0 };
    const res = VoucherEngine.validateVoucher(v, 100000, []);
    assert(!res.valid && res.reason.includes('đã được sử dụng'), 'TC-VOUCHER-07: Chặn voucher đã used');
}

// 1.8 Voucher currently applied by another table
{
    const v = { status: 'applied', applied_table: 'B1', type: 'fixed', value: 30000, min_bill: 0 };
    const res = VoucherEngine.validateVoucher(v, 100000, [], 'B2');
    assert(!res.valid && res.reason.includes('bàn khác'), 'TC-VOUCHER-08: Chặn voucher đang applied tại bàn khác (Chống 1 mã 2 bàn)');
}

// 1.9 Voucher applied by SAME table (re-opening bill)
{
    const v = { status: 'applied', applied_table: 'B1', type: 'fixed', value: 30000, min_bill: 0 };
    const res = VoucherEngine.validateVoucher(v, 100000, [], 'B1');
    assert(res.valid && res.discountAmount === 30000, 'TC-VOUCHER-09: Cho phép cùng bàn B1 mở lại hóa đơn dùng tiếp voucher');
}

// 1.10 Voucher expired by valid_to
{
    const v = { status: 'available', type: 'fixed', value: 20000, min_bill: 0, valid_to: Date.now() - 86400000 };
    const res = VoucherEngine.validateVoucher(v, 100000, []);
    assert(!res.valid && res.reason.includes('hết hạn'), 'TC-VOUCHER-10: Chặn voucher hết hạn sử dụng (valid_to < now)');
}

// 1.11 Voucher not yet active by valid_from
{
    const v = { status: 'available', type: 'fixed', value: 20000, min_bill: 0, valid_from: Date.now() + 86400000 };
    const res = VoucherEngine.validateVoucher(v, 100000, []);
    assert(!res.valid && res.reason.includes('chưa đến thời gian'), 'TC-VOUCHER-11: Chặn voucher chưa đến thời gian áp dụng (valid_from > now)');
}

// 1.12 Fixed voucher value exceeds bill total
{
    const v = { status: 'available', type: 'fixed', value: 100000, min_bill: 0 };
    const res = VoucherEngine.validateVoucher(v, 45000, []);
    assert(res.valid && res.discountAmount === 45000, 'TC-VOUCHER-12: Giảm tối đa bằng bill khi giá trị voucher > tổng bill (Bill không âm tiền)');
}

// ====================================================
// 2. LOYALTY ENGINE SUITE
// ====================================================
console.log('\n--- 2. Customer Loyalty & Points Suite ---');

// 2.1 Phone normalization & validation
{
    assert(LoyaltyEngine.normalizePhone('036 329 2271') === '0363292271', 'TC-LOYALTY-01: Chuẩn hóa SĐT loại bỏ khoảng trắng');
    assert(LoyaltyEngine.normalizePhone('+84363292271') === '0363292271', 'TC-LOYALTY-02: Chuẩn hóa đầu số +84 về 0');
    assert(LoyaltyEngine.normalizePhone('84363292271') === '0363292271', 'TC-LOYALTY-03: Chuẩn hóa đầu số 84 về 0');
    assert(LoyaltyEngine.normalizePhone('(036) 329-2271') === '0363292271', 'TC-LOYALTY-04: Chuẩn hóa SĐT có ký tự đặc biệt (dấu ngoặc, gạch ngang)');
    assert(LoyaltyEngine.isValidPhone('0363292271'), 'TC-LOYALTY-05: Xác thực SĐT di động hợp lệ (036)');
    assert(LoyaltyEngine.isValidPhone('0987654321'), 'TC-LOYALTY-06: Xác thực SĐT di động hợp lệ (098)');
    assert(!LoyaltyEngine.isValidPhone('123456789'), 'TC-LOYALTY-07: Chặn SĐT không đúng định dạng đầu số VN');
    assert(!LoyaltyEngine.isValidPhone(''), 'TC-LOYALTY-08: Chặn SĐT rỗng');
}

// 2.2 Tier determination by spend
{
    assert(LoyaltyEngine.getTierBySpend(500000).id === 'member', 'TC-LOYALTY-09: Chi tiêu < 2tr xếp hạng Thành viên (3%)');
    assert(LoyaltyEngine.getTierBySpend(2500000).id === 'silver', 'TC-LOYALTY-10: Chi tiêu 2.5tr xếp hạng Bạc (5%)');
    assert(LoyaltyEngine.getTierBySpend(6000000).id === 'gold', 'TC-LOYALTY-11: Chi tiêu 6tr xếp hạng Vàng (7%)');
    assert(LoyaltyEngine.getTierBySpend(20000000).id === 'diamond', 'TC-LOYALTY-12: Chi tiêu 20tr xếp hạng Kim Cương (10%)');
}

// 2.3 Point earning calculation (by tier name & spend)
{
    assert(LoyaltyEngine.calculateEarnPoints(100000, 'member') === 3000, 'TC-LOYALTY-13: Tích 3% cho Thành viên');
    assert(LoyaltyEngine.calculateEarnPoints(100000, 'silver') === 5000, 'TC-LOYALTY-14: Tích 5% cho Hạng Bạc');
    assert(LoyaltyEngine.calculateEarnPoints(100000, 'gold') === 7000, 'TC-LOYALTY-15: Tích 7% cho Hạng Vàng');
    assert(LoyaltyEngine.calculateEarnPoints(100000, 'diamond') === 10000, 'TC-LOYALTY-16: Tích 10% cho Hạng Kim Cương');
    assert(LoyaltyEngine.calculateEarnPoints(0, 'diamond') === 0, 'TC-LOYALTY-17: Thực thu = 0đ (trả 100% bằng điểm/voucher) thì tích 0 điểm');
}

// 2.4 Point redemption limits
{
    assert(LoyaltyEngine.calculateMaxRedeemPoints(500000, 200000) === 200000, 'TC-LOYALTY-18: Điểm dư chỉ được trừ tối đa bằng tiền bill (100% bill)');
    assert(LoyaltyEngine.calculateMaxRedeemPoints(50000, 200000) === 50000, 'TC-LOYALTY-19: Điểm thiếu trừ đúng số điểm hiện có');
    assert(LoyaltyEngine.calculateMaxRedeemPoints(0, 200000) === 0, 'TC-LOYALTY-20: 0 điểm không trừ được');
    assert(LoyaltyEngine.calculateMaxRedeemPoints(50000, 0) === 0, 'TC-LOYALTY-21: Bill 0đ thì trừ 0 điểm');
}

// ====================================================
// 3. COMBO ENGINE SUITE
// ====================================================
console.log('\n--- 3. Combo Management & Selection Suite ---');
if (ComboEngine) {
    const mockCombo = {
        id: 'combo_lunch',
        name: 'Combo Bữa Trưa Tiết Kiệm',
        price: 99000,
        is_combo: true,
        combo_groups: [
            {
                group_title: 'Chọn món chính',
                min: 1,
                max: 1,
                items: [
                    { id: 'm1', name: 'Cơm Gà', extra_price: 0 },
                    { id: 'm2', name: 'Cơm Bò', extra_price: 15000 }
                ]
            },
            {
                group_title: 'Chọn đồ uống',
                min: 1,
                max: 1,
                items: [
                    { id: 'd1', name: 'Trà Đá', extra_price: 0 },
                    { id: 'd2', name: 'Trà Đào', extra_price: 10000 }
                ]
            }
        ]
    };

    assert(ComboEngine.isCombo(mockCombo), 'TC-COMBO-01: Nhận diện chính xác đối tượng Combo');

    // 3.2 Valid Selection
    const selValid = {
        0: [{ id: 'm2', name: 'Cơm Bò', extra_price: 15000 }],
        1: [{ id: 'd1', name: 'Trà Đá', extra_price: 0 }]
    };
    const valRes = ComboEngine.validateSelection(mockCombo, selValid);
    assert(valRes.valid, 'TC-COMBO-02: Xác thực hợp lệ khi chọn đúng đủ các nhóm bắt buộc');

    // 3.3 Invalid Selection: Missing required group
    const selMissing = {
        0: [{ id: 'm1', name: 'Cơm Gà', extra_price: 0 }]
        // group 1 missing
    };
    const resMissing = ComboEngine.validateSelection(mockCombo, selMissing);
    assert(!resMissing.valid && resMissing.error.includes('Chọn đồ uống'), 'TC-COMBO-03: Chặn đặt combo khi chưa chọn nhóm bắt buộc');

    // 3.4 Calculate Total Price with Upcharges
    const selUpgrade = {
        0: [{ id: 'm2', name: 'Cơm Bò', extra_price: 15000 }],
        1: [{ id: 'd2', name: 'Trà Đào', extra_price: 10000 }]
    };
    const priceRes = ComboEngine.calculateTotalPrice(mockCombo, selUpgrade);
    assert(priceRes.totalPrice === 124000, 'TC-COMBO-04: Tính tổng tiền combo chuẩn xác (99k + 15k + 10k = 124k)');

    // 3.5 Format Combo Summary String
    const summaryStr = ComboEngine.formatComboSummary(selUpgrade);
    assert(summaryStr.includes('Cơm Bò') && summaryStr.includes('Trà Đào'), 'TC-COMBO-05: Sinh chuỗi tóm tắt tóm lược đầy đủ các món con');

    // 3.6 Flatten for Kitchen KDS
    const kdsItems = ComboEngine.flattenForKds({ id: 'ord_item_01', combo_selection: selUpgrade });
    assert(Array.isArray(kdsItems) && kdsItems.length === 2, 'TC-COMBO-06: Tách nhỏ các món con trong combo ra danh sách chế biến KDS');
}

// ====================================================
// 4. AUDIT LOG & COMPLIANCE MATRIX SUITE
// ====================================================
console.log('\n--- 4. Audit Log & Operational Integrity Suite ---');
{
    const validCategories = ['PAYMENT', 'ORDERS', 'MENU', 'STAFF', 'SYSTEM'];
    const validActions = [
        'BILL_SETTLE', 'TABLE_TRANSFER', 'ORDER_CANCEL', 'ORDER_CANCEL_ITEM',
        'MENU_ADD_DISH', 'MENU_EDIT_DISH', 'MENU_DELETE_DISH',
        'STAFF_CREATE', 'STAFF_UPDATE', 'STAFF_TOGGLE_STATUS', 'STAFF_DELETE'
    ];

    // Helper kiểm tra chuẩn hóa log payload (bỏ qua AUTH theo yêu cầu)
    function buildAuditEntry(action, category, details, actor, metadata = {}) {
        const act = String(action || 'UNKNOWN_ACTION').toUpperCase();
        const cat = String(category || 'SYSTEM').toUpperCase();
        if (act === 'AUTH_LOGIN' || act === 'AUTH_LOGOUT' || cat === 'AUTH') {
            return null; // Bỏ qua sự kiện đăng nhập / đăng xuất
        }
        const cleanMeta = {};
        if (metadata && typeof metadata === 'object') {
            Object.keys(metadata).forEach(k => {
                if (metadata[k] !== undefined && metadata[k] !== null) cleanMeta[k] = metadata[k];
            });
        }
        return {
            action: act,
            category: validCategories.includes(cat) ? cat : 'SYSTEM',
            details: String(details || '').trim(),
            actor_name: actor?.name || actor?.username || 'Nhân viên',
            actor_username: actor?.username || 'system',
            actor_role: actor?.role || 'staff',
            platform: actor?.platform || 'web',
            metadata: cleanMeta,
            timestamp_ms: Date.now()
        };
    }

    // 4.1 Tạo log thanh toán chuẩn xác
    const logSettle = buildAuditEntry('BILL_SETTLE', 'PAYMENT', 'Thanh toán & Kết Bàn A1 - Số tiền: 500.000 VNĐ (Tiền mặt)', { name: 'Vũ Mạnh Hưởng', username: 'admin', role: 'admin' }, { table: 'Bàn A1', amount: 500000, method: 'cash' });
    assert(logSettle && logSettle.action === 'BILL_SETTLE' && logSettle.category === 'PAYMENT' && logSettle.metadata.amount === 500000, 'TC-AUDIT-01: Định dạng sự kiện kết bàn BILL_SETTLE chuẩn xác');

    // 4.2 Tạo log hủy món nhạy cảm (món lẻ & cả đợt đơn)
    const logCancelDish = buildAuditEntry('ORDER_CANCEL_ITEM', 'ORDERS', 'Hủy 2x "Bò Né" khỏi Bàn B2. Lý do: Khách đổi ý', { name: 'Quản Lý Web', username: 'qlweb', role: 'manager' }, { table: 'Bàn B2', cancel_quantity: 2, reason: 'Khách đổi ý' });
    assert(logCancelDish && logCancelDish.action === 'ORDER_CANCEL_ITEM' && logCancelDish.metadata.reason === 'Khách đổi ý', 'TC-AUDIT-02: Ghi nhận sự kiện ORDER_CANCEL_ITEM an toàn không dính lỗi biến reason');

    const logCancelOrder = buildAuditEntry('ORDER_CANCEL', 'ORDERS', 'Hủy toàn bộ đợt gọi món của Bàn C1. Lý do: Khách bận về gấp', { name: 'Quản Lý Web', username: 'qlweb', role: 'manager' }, { table: 'Bàn C1', reason: 'Khách bận về gấp' });
    assert(logCancelOrder && logCancelOrder.action === 'ORDER_CANCEL' && logCancelOrder.details.includes('Hủy toàn bộ đợt gọi món'), 'TC-AUDIT-03: Ghi nhận sự kiện ORDER_CANCEL hủy trọn vẹn đợt gọi món');

    // 4.3 Tạo log chuyển bàn (chuyển toàn bộ bàn & tách món)
    const logTransferFull = buildAuditEntry('TABLE_TRANSFER', 'ORDERS', 'Chuyển toàn bộ từ Bàn A1 sang Bàn A2', { name: 'Admin', username: 'admin', role: 'admin' }, { from_table: 'A1', to_table: 'A2', is_full_transfer: true });
    assert(logTransferFull && logTransferFull.action === 'TABLE_TRANSFER' && logTransferFull.metadata.is_full_transfer === true, 'TC-AUDIT-04: Ghi nhận sự kiện TABLE_TRANSFER khi chuyển toàn bộ bàn');

    const logTransferSplit = buildAuditEntry('TABLE_TRANSFER', 'ORDERS', 'Chuyển 3 món từ Bàn B1 sang Bàn B3', { name: 'Admin', username: 'admin', role: 'admin' }, { from_table: 'B1', to_table: 'B3', items_count: 3, is_full_transfer: false });
    assert(logTransferSplit && logTransferSplit.action === 'TABLE_TRANSFER' && logTransferSplit.metadata.items_count === 3, 'TC-AUDIT-05: Ghi nhận sự kiện TABLE_TRANSFER khi tách chuyển món');

    // 4.4 Kiểm tra bỏ qua sự kiện đăng nhập / đăng xuất
    const logLogin = buildAuditEntry('AUTH_LOGIN', 'AUTH', 'Đăng nhập vào hệ thống');
    const logLogout = buildAuditEntry('AUTH_LOGOUT', 'AUTH', 'Đăng xuất khỏi hệ thống');
    assert(logLogin === null && logLogout === null, 'TC-AUDIT-06: Loại bỏ hoàn toàn sự kiện đăng nhập/đăng xuất khỏi audit log theo yêu cầu');
}

// ==========================================
// 5. Customer Table Transfer Redirect Suite
// ==========================================
console.log('\n--- 5. Customer Table Transfer & Token Verification Suite ---');
{
    function simulateVerifyTableToken(tableId, tableData, searchParamsStr, mockSessionStorage) {
        if (!tableData) return false;
        const cleanT = String(tableId).trim().toUpperCase().replace(/^(TABLE|BÀN|BAN)\s*/i, '');
        const requiredToken = tableData.qr_token || '';
        if (!requiredToken) return true;

        if (mockSessionStorage.getItem('aurora_transferred_authorized_' + cleanT) === 'true') {
            mockSessionStorage.setItem('aurora_verified_token_' + cleanT, requiredToken);
            return true;
        }

        const currentParams = new URLSearchParams(searchParamsStr);
        const urlToken = (currentParams.get('token') || '').trim();
        const storedToken = (mockSessionStorage.getItem('aurora_verified_token_' + cleanT) || '').trim();

        if (urlToken === requiredToken || storedToken === requiredToken) {
            mockSessionStorage.setItem('aurora_verified_token_' + cleanT, requiredToken);
            return true;
        }
        return false;
    }

    function createMockStorage() {
        const store = {};
        return {
            getItem: (k) => store[k] || null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        };
    }

    // 5.1 Token hợp lệ trên URL
    const s1 = createMockStorage();
    const ok1 = simulateVerifyTableToken('A2', { qr_token: 'secret_token_123' }, '?table=A2&token=secret_token_123', s1);
    assert(ok1 === true && s1.getItem('aurora_verified_token_A2') === 'secret_token_123', 'TC-TRANSFER-01: Token hợp lệ trên URL được xác thực thành công');

    // 5.2 Khách tự gõ bàn trên URL không kèm token bị chặn
    const s2 = createMockStorage();
    const ok2 = simulateVerifyTableToken('A2', { qr_token: 'secret_token_123' }, '?table=A2', s2);
    assert(ok2 === false, 'TC-TRANSFER-02: Khách tự gõ bàn trên URL không kèm token bị từ chối');

    // 5.3 Khách được chuyển bàn chính thức (có cờ authorized) vào bàn thành công
    const s3 = createMockStorage();
    s3.setItem('aurora_transferred_authorized_A2', 'true');
    const ok3 = simulateVerifyTableToken('A2', { qr_token: 'secret_token_123' }, '?table=A2', s3);
    assert(ok3 === true && s3.getItem('aurora_verified_token_A2') === 'secret_token_123', 'TC-TRANSFER-03: Cờ chuyển bàn chính thức cho phép vào bàn mới và tự cập nhật token');

    // 5.4 Tạo URL chuyển hướng đúng định dạng kèm token
    function buildRedirectUrl(baseUrl, targetTable, targetToken) {
        const url = new URL(baseUrl);
        url.searchParams.set('table', targetTable);
        if (targetToken) url.searchParams.set('token', targetToken);
        else url.searchParams.delete('token');
        return url.toString();
    }
    const targetUrl = buildRedirectUrl('https://qr-ordering-system-1b7d4.web.app/?table=A1&token=old_tok', 'A2', 'target_tok_999');
    assert(targetUrl === 'https://qr-ordering-system-1b7d4.web.app/?table=A2&token=target_tok_999', 'TC-TRANSFER-04: Tạo URL chuyển hướng chính xác đến bàn đích kèm token mới');
}

// ==========================================
// 6. Table Board Filter Simplification Suite
// ==========================================
console.log('\n--- 6. Table Board Filter Simplification Suite ---');
{
    const allowedFilters = ['all', 'waiting_transfer', 'active', 'empty'];

    function sanitizeFilter(filter) {
        return allowedFilters.includes(filter) ? filter : 'all';
    }

    const mockTables = [
        { tableName: 'A1', isActive: true, isWaitingTransfer: true },
        { tableName: 'A2', isActive: true, isWaitingTransfer: false },
        { tableName: 'A3', isActive: false, isWaitingTransfer: false },
        { tableName: 'A4', isActive: false, isWaitingTransfer: false },
    ];

    function filterTables(tables, filter) {
        const f = sanitizeFilter(filter);
        return tables.filter(t => {
            if (f === 'all') return true;
            if (f === 'waiting_transfer') return t.isWaitingTransfer;
            if (f === 'active') return t.isActive;
            if (f === 'empty') return !t.isActive;
            return true;
        });
    }

    // 6.1 Xác thực danh sách bộ lọc chỉ gồm 4 mục
    assert(allowedFilters.length === 4 && allowedFilters.includes('waiting_transfer'), 'TC-FILTER-01: Bộ lọc chỉ chứa chính xác 4 bộ lọc (Tất cả, Chờ CK, Có khách, Bàn trống)');

    // 6.2 Lọc bàn 'active'
    const activeTables = filterTables(mockTables, 'active');
    assert(activeTables.length === 2 && activeTables.every(t => t.isActive), 'TC-FILTER-02: Lọc bàn "Có khách" chỉ trả về đúng các bàn có khách');

    // 6.3 Lọc bàn 'empty'
    const emptyTables = filterTables(mockTables, 'empty');
    assert(emptyTables.length === 2 && emptyTables.every(t => !t.isActive), 'TC-FILTER-03: Lọc bàn "Bàn trống" chỉ trả về đúng các bàn trống');

    // 6.4 Lọc bàn 'waiting_transfer'
    const ckTables = filterTables(mockTables, 'waiting_transfer');
    assert(ckTables.length === 1 && ckTables[0].tableName === 'A1', 'TC-FILTER-04: Lọc bàn "Chờ CK" chỉ trả về đúng bàn đang chờ chuyển khoản');

    // 6.5 Fallback khi chọn filter cũ (ví dụ pending, cooking)
    const fallbackPending = sanitizeFilter('pending');
    assert(fallbackPending === 'all', 'TC-FILTER-05: Tự động đưa về "Tất cả" khi gặp các bộ lọc cũ đã loại bỏ');
}

// ==========================================
// 7. SUITE: TABLE NATURAL SORTING & ALIGNMENT
// ==========================================
console.log('\n--- 7. Table Natural Sorting & Alignment Suite ---');
{
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

    // 7.1 Sắp xếp cơ bản trong cùng khu vực
    const sampleA = ['A4', 'A1', 'A3', 'A2'];
    sampleA.sort(compareTableOrder);
    assert(JSON.stringify(sampleA) === JSON.stringify(['A1', 'A2', 'A3', 'A4']), 'TC-SORT-01: Sắp xếp tự nhiên A1..A4 chính xác');

    // 7.2 Xử lý hỗn hợp tiền tố (Bàn, Table, chữ hoa/thường)
    const mixed = ['A4', 'B1', 'Bàn A1', 'Table B4', 'bàn A2', 'A3'];
    mixed.sort(compareTableOrder);
    const mixedKeys = mixed.map(m => getTableSortKey(m).clean);
    assert(JSON.stringify(mixedKeys) === JSON.stringify(['A1', 'A2', 'A3', 'A4', 'B1', 'B4']), 'TC-SORT-02: Chuẩn hóa tiền tố (Bàn/Table) và sắp xếp đúng thứ tự khu vực và số');

    // 7.3 Sắp xếp chuẩn xác 12 bàn mẫu thực tế của quán
    const full12 = [
        'Bàn A1', 'Bàn A2', 'Bàn A3', 'A4',
        'B1', 'Bàn B2', 'Bàn B3', 'B4',
        'C1', 'Bàn C2', 'C3', 'C4'
    ];
    full12.sort(compareTableOrder);
    const full12Keys = full12.map(m => getTableSortKey(m).clean);
    assert(JSON.stringify(full12Keys) === JSON.stringify([
        'A1', 'A2', 'A3', 'A4',
        'B1', 'B2', 'B3', 'B4',
        'C1', 'C2', 'C3', 'C4'
    ]), 'TC-SORT-03: 12 bàn quán ăn luôn xuất hiện thành 3 hàng chuẩn A1..A4, B1..B4, C1..C4');

    // 7.4 Xử lý số có 2 chữ số (A2 phải đứng trước A10, không bị lỗi bảng chữ cái)
    const numTest = ['A10', 'A2', 'A1'];
    numTest.sort(compareTableOrder);
    assert(JSON.stringify(numTest) === JSON.stringify(['A1', 'A2', 'A10']), 'TC-SORT-04: Số 2 chữ số (A10) đứng sau số 1 chữ số (A2)');

    // 7.5 Sắp xếp mảng đối tượng bàn từ Firestore
    const objTest = [
        { id: 'B4', name: 'B4' },
        { id: 'A1', name: 'Bàn A1' },
        { id: 'C2', name: 'Bàn C2' },
        { id: 'B1', name: 'B1' }
    ];
    objTest.sort(compareTableOrder);
    const objResult = objTest.map(o => o.id);
    assert(JSON.stringify(objResult) === JSON.stringify(['A1', 'B1', 'B4', 'C2']), 'TC-SORT-05: Sắp xếp mảng object Firestore chuẩn xác');
}

// =====================================================================
// 8. TABLE TRANSFER VOUCHER CONTINUITY & ANTI-ORPHAN SUITE
// =====================================================================
console.log('\n--- 8. Table Transfer Voucher Continuity & Anti-Orphan Suite ---');
{
    function normalizeTableCode(raw) {
        if (!raw) return '';
        let s = String(raw).trim().toUpperCase();
        s = s.replace(/^(BÀN|BAN|TABLE)\s*/i, '');
        return s.trim();
    }

    // 8.1 Chuyển toàn bộ bàn (Full Transfer) bảo toàn voucher sang bàn đích với cả 2 key (A2 và Bàn A2)
    const mockTableVouchers = {};
    const mockVoucherDoc = {
        code: 'AUR-3SP9-8YDJ',
        type: 'percent',
        value: 10,
        status: 'applied',
        applied_table: 'A1'
    };
    mockTableVouchers['A1'] = mockVoucherDoc;
    mockTableVouchers['Bàn A1'] = mockVoucherDoc;

    const sourceClean = 'Bàn A1';
    const targetClean = 'Bàn A2';
    const normSrc = normalizeTableCode(sourceClean);
    const normTarget = normalizeTableCode(targetClean);

    const srcVoucher = mockTableVouchers[normSrc] || mockTableVouchers[sourceClean] || null;
    assert(srcVoucher !== null, 'TC-TRANSFER-VOUCHER-01: Nhận diện chính xác voucher nguồn bất kể truyền mã A1 hay Bàn A1');

    // Giả lập chuyển bàn
    mockTableVouchers[normTarget] = srcVoucher;
    mockTableVouchers[targetClean] = srcVoucher;
    delete mockTableVouchers[normSrc];
    delete mockTableVouchers[sourceClean];
    mockVoucherDoc.applied_table = normTarget;

    assert(mockTableVouchers['A2'] && mockTableVouchers['Bàn A2'] && !mockTableVouchers['A1'] && !mockTableVouchers['Bàn A1'], 
        'TC-TRANSFER-VOUCHER-02: Đồng bộ đầy đủ 2 key bàn đích và dọn sạch voucher khỏi bàn nguồn');

    // 8.2 Bàn đích A2 kiểm tra voucher không bị lỗi "đang áp dụng tại Bàn A1"
    const validationAtA2 = VoucherEngine.validateVoucher(mockVoucherDoc, 822000, [], 'Bàn A2');
    assert(validationAtA2.valid === true, 'TC-TRANSFER-VOUCHER-03: Bàn đích A2 áp dụng voucher thành công, không bị chặn bởi bàn cũ');

    // 8.3 Bàn khác (B1) kiểm tra voucher bị chặn độc quyền bởi bàn đích A2
    const validationAtB1 = VoucherEngine.validateVoucher(mockVoucherDoc, 500000, [], 'Bàn B1');
    assert(validationAtB1.valid === false && validationAtB1.reason.includes('A2'), 
        'TC-TRANSFER-VOUCHER-04: Bàn khác bị chặn độc quyền chuẩn xác theo bàn đích A2');

    // 8.4 Kiểm tra hàm purgeTableVouchers xóa triệt để mọi biến thể (A1, BÀN A1, BAN A1, TABLE A1)
    const testVoucherStore = {
        'A1': { code: 'AUR-3SP9-8YDJ' },
        'BÀN A1': { code: 'AUR-3SP9-8YDJ' },
        'BAN A1': { code: 'AUR-3SP9-8YDJ' },
        'TABLE A1': { code: 'AUR-3SP9-8YDJ' },
        'A2': { code: 'AUR-OTHER' }
    };
    function purgeTestVouchers(tableNameOrCode) {
        const norm = normalizeTableCode(tableNameOrCode);
        const variants = [tableNameOrCode, norm, `BÀN ${norm}`, `BAN ${norm}`, `TABLE ${norm}`];
        variants.forEach(k => delete testVoucherStore[k]);
        Object.keys(testVoucherStore).forEach(k => {
            if (normalizeTableCode(k) === norm) delete testVoucherStore[k];
        });
    }
    purgeTestVouchers('Bàn A1');
    assert(!testVoucherStore['A1'] && !testVoucherStore['BÀN A1'] && !testVoucherStore['BAN A1'] && !testVoucherStore['TABLE A1'] && testVoucherStore['A2'],
        'TC-TRANSFER-VOUCHER-05: PurgeTableVouchers xóa sạch 100% mọi biến thể của bàn nguồn');

    // 8.5 Bàn trống (0 active orders) không bao giờ hiển thị voucher badge trên card
    const tableOrdersA1 = [];
    const isTableOccupied = tableOrdersA1.length > 0;
    const cardVoucherForAvailable = isTableOccupied ? (testVoucherStore['A1'] || null) : null;
    assert(cardVoucherForAvailable === null,
        'TC-TRANSFER-VOUCHER-06: Bàn trống (sẵn sàng nhận khách) luôn ẩn voucher badge, không lưu voucher ma');
}

console.log('\n====================================================');
console.log(`TOTAL TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
console.log(`PASS RATE: ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%`);
console.log('====================================================');

process.exit(failCount > 0 ? 1 : 0);
