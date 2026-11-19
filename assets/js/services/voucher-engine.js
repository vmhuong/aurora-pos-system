// =====================================================================
// AURORA SYSTEM - VOUCHER & PROMOTION ENGINE (MODULAR SERVICE)
// Tinh toan ma giam gia, kiem tra chong gian lan va sinh ma theo lo
// =====================================================================

(function(root) {
    'use strict';

    const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Bo qua 0, O, 1, I de tranh nham lan khi doc/in

    const VoucherEngine = {
        // Sinh 1 ma code ngau nhien co do bao mat cao (VD: AURORA-7K9M-2XP4)
        generateUniqueCode: function(prefix = 'AUR') {
            const part1 = this._randomString(4);
            const part2 = this._randomString(4);
            const p = (prefix || 'AUR').trim().toUpperCase();
            return `${p}-${part1}-${part2}`;
        },

        _randomString: function(len) {
            let res = '';
            for (let i = 0; i < len; i++) {
                const idx = Math.floor(Math.random() * CHARS.length);
                res += CHARS[idx];
            }
            return res;
        },

        // Sinh danh sach N ma code ngau nhien khong bi trung lap
        generateBatchCodes: function(count = 10, prefix = 'AUR', existingCodes = new Set()) {
            const results = [];
            const localSet = new Set(existingCodes);
            let attempts = 0;
            const maxAttempts = count * 20;

            while (results.length < count && attempts < maxAttempts) {
                attempts++;
                const code = this.generateUniqueCode(prefix);
                if (!localSet.has(code)) {
                    localSet.add(code);
                    results.push(code);
                }
            }
            return results;
        },

        // Kiem tra tinh hop le cua voucher doi voi hoa don
        // voucher: Object { type, value, min_bill, max_discount, specific_dish_id, status, valid_from, valid_to }
        // orderTotal: tong tien hien tai cua hoa don (so tien chua giam)
        // orderItems: danh sach cac mon trong bill [ { dish_id, dish_name, price, quantity } ]
        // targetTable: ma hoac ten ban dang muon ap dung (kiem tra chong ap dung trung lap 2 ban cung luc)
        validateVoucher: function(voucher, orderTotal = 0, orderItems = [], targetTable = '') {
            if (!voucher) {
                return { valid: false, discountAmount: 0, reason: 'Mã voucher không tồn tại trong hệ thống' };
            }

            // Kiem tra trang thai
            const status = String(voucher.status || '').toLowerCase();
            if (status === 'used') {
                return { valid: false, discountAmount: 0, reason: 'Mã voucher này đã được sử dụng trước đó' };
            }
            if (status === 'disabled' || status === 'expired') {
                return { valid: false, discountAmount: 0, reason: 'Mã voucher đã bị vô hiệu hóa hoặc hết hạn' };
            }
            if (status === 'applied' && voucher.applied_table) {
                const normApplied = String(voucher.applied_table).replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                const normTarget = String(targetTable || '').replace(/^(BÀN|BAN|TABLE)\s*/i, '').trim().toUpperCase();
                if (normTarget && normApplied !== normTarget) {
                    return { valid: false, discountAmount: 0, reason: `Mã voucher này đang được áp dụng tại Bàn ${voucher.applied_table}, không thể dùng cho bàn khác!` };
                }
            }

            // Kiem tra han su dung
            const now = Date.now();
            if (voucher.valid_from) {
                const fromMillis = this._toMillis(voucher.valid_from);
                if (fromMillis > 0 && now < fromMillis) {
                    return { valid: false, discountAmount: 0, reason: 'Voucher chưa đến thời gian áp dụng' };
                }
            }
            if (voucher.valid_to) {
                const toMillis = this._toMillis(voucher.valid_to);
                if (toMillis > 0 && now > toMillis) {
                    return { valid: false, discountAmount: 0, reason: 'Voucher đã hết hạn sử dụng' };
                }
            }

            // Kiem tra dieu kien tong bill toi thieu
            const minBill = Math.max(0, Number(voucher.min_bill) || 0);
            if (orderTotal < minBill) {
                return {
                    valid: false,
                    discountAmount: 0,
                    reason: `Hóa đơn phải từ ${Number(minBill).toLocaleString('vi-VN')} VNĐ trở lên để áp dụng voucher này`
                };
            }

            // Tinh toan muc giam theo loai voucher
            const type = String(voucher.type || 'fixed').toLowerCase();
            let discount = 0;
            let appliedDish = null;

            if (type === 'fixed') {
                // Giam so tien cu the (vi du: 50.000 VND)
                const fixedVal = Math.max(0, Number(voucher.value) || 0);
                discount = Math.min(orderTotal, fixedVal);
            } else if (type === 'percent') {
                // Giam % bill (vi du: 20%, 50%)
                const percentVal = Math.max(0, Math.min(100, Number(voucher.value) || 0));
                discount = Math.round((orderTotal * percentVal) / 100);
                const maxDiscount = Number(voucher.max_discount) || 0;
                if (maxDiscount > 0 && discount > maxDiscount) {
                    discount = maxDiscount;
                }
                discount = Math.min(orderTotal, discount);
            } else if (type === 'dish') {
                // Tang 1 mon an cu the (tru gia tri cua 1 phan mon do co trong bill)
                const targetDishId = String(voucher.specific_dish_id || '').trim();
                const targetDishName = String(voucher.specific_dish_name || '').trim().toLowerCase();

                let foundItem = null;
                if (Array.isArray(orderItems)) {
                    foundItem = orderItems.find(it => {
                        const itId = String(it.dish_id || it.id || '').trim();
                        const itName = String(it.dish_name || it.name || '').trim().toLowerCase();
                        if (targetDishId && itId === targetDishId) return true;
                        if (targetDishName && itName === targetDishName) return true;
                        return false;
                    });
                }

                if (!foundItem) {
                    const dishDisplay = voucher.specific_dish_name || 'món được chỉ định';
                    return {
                        valid: false,
                        discountAmount: 0,
                        reason: `Hóa đơn hiện chưa có món "${dishDisplay}" để áp dụng ưu đãi tặng món này`
                    };
                }

                // Giam gia dung bang gia 1 phan cua mon do
                discount = Math.min(orderTotal, Number(foundItem.price) || 0);
                appliedDish = foundItem;
            } else {
                return { valid: false, discountAmount: 0, reason: 'Loại voucher không xác định' };
            }

            return {
                valid: true,
                discountAmount: Math.max(0, discount),
                type: type,
                value: voucher.value,
                appliedDish: appliedDish,
                reason: 'Hợp lệ'
            };
        },

        calculateDiscount: function(voucher, orderTotal, orderItems) {
            return this.validateVoucher(voucher, orderTotal, orderItems);
        },

        // Chuoi tom tat mo ta voucher de hien thi truc quan
        formatVoucherDescription: function(voucher) {
            if (!voucher) return '';
            const type = String(voucher.type || 'fixed').toLowerCase();
            const minBill = Number(voucher.min_bill) || 0;
            const minBillStr = minBill > 0 ? ` (Đơn từ ${minBill.toLocaleString('vi-VN')} VNĐ)` : '';

            if (type === 'fixed') {
                const val = Number(voucher.value) || 0;
                return `Giảm ${val.toLocaleString('vi-VN')} VNĐ${minBillStr}`;
            }
            if (type === 'percent') {
                const val = Number(voucher.value) || 0;
                const max = Number(voucher.max_discount) || 0;
                const maxStr = max > 0 ? ` (Tối đa ${max.toLocaleString('vi-VN')} VNĐ)` : '';
                return `Giảm ${val}% hóa đơn${maxStr}${minBillStr}`;
            }
            if (type === 'dish') {
                const dishName = voucher.specific_dish_name || '1 Món ăn';
                return `Tặng miễn phí: ${dishName}${minBillStr}`;
            }
            return 'Ưu đãi voucher';
        },

        _toMillis: function(val) {
            if (!val) return 0;
            if (typeof val.toMillis === 'function') return val.toMillis();
            if (typeof val.toDate === 'function') return val.toDate().getTime();
            return new Date(val).getTime() || 0;
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = VoucherEngine;
    } else {
        root.VoucherEngine = VoucherEngine;
    }
})(typeof window !== 'undefined' ? window : this);
