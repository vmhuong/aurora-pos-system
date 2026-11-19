// =====================================================================
// AURORA SYSTEM - COMBO CORE ENGINE MODULE
// Xu ly logic tinh gia, kiem tra lua chon mon con, va bung cay mon cho KDS
// =====================================================================

(function(root) {
    'use strict';

    const ComboEngine = {
        /**
         * Kiem tra xem mot mon co phai la Combo hay khong
         */
        isCombo: function(dish) {
            if (!dish) return false;
            return dish.is_combo === true || String(dish.category || '').toUpperCase().trim() === 'COMBO';
        },

        /**
         * Kiem tra tinh hop le cua cac lua chon mon con trong combo
         * @param {Object} comboDish - Thong tin mon Combo
         * @param {Object} selectedChoices - Object chua cac mon duoc chon theo group index: { [groupIndex]: [itemObj, ...] }
         * @returns {Object} { valid: boolean, error: string | null }
         */
        validateSelection: function(comboDish, selectedChoices) {
            if (!this.isCombo(comboDish)) return { valid: true, error: null };
            
            const groups = comboDish.combo_groups || [];
            if (!Array.isArray(groups) || groups.length === 0) {
                return { valid: true, error: null };
            }

            for (let i = 0; i < groups.length; i++) {
                const group = groups[i];
                const min = Number(group.min) || 1;
                const max = Number(group.max) || min;
                const groupKey = group.id || group.group_id || i;
                const rawSelected = selectedChoices ? (selectedChoices[groupKey] !== undefined ? selectedChoices[groupKey] : (selectedChoices[i] !== undefined ? selectedChoices[i] : (group.id && selectedChoices[group.id]))) : [];
                const selectedInGroup = Array.isArray(rawSelected) ? rawSelected : (rawSelected ? [rawSelected] : []);

                if (selectedInGroup.length < min) {
                    const diff = min - selectedInGroup.length;
                    return {
                        valid: false,
                        error: `Vui lòng chọn thêm ${diff} món trong nhóm "${group.group_title || ('Nhóm ' + (i + 1))}"`
                    };
                }

                if (selectedInGroup.length > max) {
                    return {
                        valid: false,
                        error: `Nhóm "${group.group_title || ('Nhóm ' + (i + 1))}" chỉ được chọn tối đa ${max} món`
                    };
                }
            }

            return { valid: true, error: null };
        },

        /**
         * Tinh toan tong gia tien cua Combo (Gia co ban + Phu phi cua cac mon con dac biet)
         */
        calculateTotalPrice: function(comboDish, selectedChoices) {
            const basePrice = Number(comboDish ? comboDish.price : 0) || 0;
            let extraPrice = 0;

            if (selectedChoices && typeof selectedChoices === 'object') {
                Object.values(selectedChoices).forEach(groupItems => {
                    if (Array.isArray(groupItems)) {
                        groupItems.forEach(item => {
                            extraPrice += Number(item.extra || item.extra_price || 0);
                        });
                    }
                });
            }

            return {
                basePrice: basePrice,
                extraPrice: extraPrice,
                totalPrice: basePrice + extraPrice
            };
        },

        /**
         * Tao chuoi tom tat cac mon con da chon de hien thi tren hoa don / gio hang
         */
        formatComboSummary: function(selectedChoices) {
            if (!selectedChoices) return '';
            const parts = [];

            Object.values(selectedChoices).forEach(groupItems => {
                if (Array.isArray(groupItems)) {
                    groupItems.forEach(item => {
                        const name = item.name || item.dish_name || '';
                        const extra = Number(item.extra || item.extra_price || 0);
                        if (extra > 0) {
                            parts.push(`${name} (+${extra.toLocaleString('vi-VN')}đ)`);
                        } else {
                            parts.push(name);
                        }
                    });
                }
            });

            return parts.join(' • ');
        },

        /**
         * Bung danh sach phang cac mon con de KDS bep hien thi va gach tung mon
         */
        flattenForKds: function(comboOrderItem) {
            if (!comboOrderItem) return [];
            const result = [];
            const selection = comboOrderItem.combo_selection;

            if (selection && typeof selection === 'object') {
                Object.keys(selection).forEach(groupKey => {
                    const items = selection[groupKey];
                    if (Array.isArray(items)) {
                        items.forEach((it, idx) => {
                            result.push({
                                unique_key: `${comboOrderItem.id || 'item'}_${groupKey}_${idx}_${it.dish_id || it.name}`,
                                dish_id: it.dish_id || '',
                                name: it.name || it.dish_name || '',
                                extra: Number(it.extra || it.extra_price || 0),
                                group_title: it.group_title || '',
                                is_completed: it.is_completed === true
                            });
                        });
                    }
                });
            }

            return result;
        }
    };

    root.ComboEngine = ComboEngine;
})(typeof window !== 'undefined' ? window : this);
