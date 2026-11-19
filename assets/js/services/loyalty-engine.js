// =====================================================================
// AURORA SYSTEM - CUSTOMER LOYALTY ENGINE (MODULAR SERVICE)
// Quan ly tich diem, hang thanh vien (Member/Bac/Vang/Bach Kim/VIP)
// Ty le quy doi: 1.000 diem = 1.000 VND (1 diem = 1 VND)
// Muc chi tieu len hang: 2tr - 5tr - 15tr - 30tr
// Ty le tich diem: Member (3%), Bac (5%), Vang (8%), VIP (13%)
// =====================================================================

(function(root) {
    'use strict';

    const TIERS = [
        { id: 'diamond', name: 'Kim Cương', minSpend: 15000000, earnRate: 0.10 },
        { id: 'gold', name: 'Vàng', minSpend: 5000000, earnRate: 0.07 },
        { id: 'silver', name: 'Bạc', minSpend: 2000000, earnRate: 0.05 },
        { id: 'member', name: 'Thành viên', minSpend: 0, earnRate: 0.03 }
    ];

    const POINT_TO_VND_RATE = 1; // 1 diem = 1 VND (1.000 diem = 1.000 VND)

    const LoyaltyEngine = {
        // Lay thong tin hang thanh vien dua tren tong chi tieu tich luy
        getTierBySpend: function(totalSpend = 0) {
            const spend = Math.max(0, Number(totalSpend) || 0);
            for (let i = 0; i < TIERS.length; i++) {
                if (spend >= TIERS[i].minSpend) {
                    return TIERS[i];
                }
            }
            return TIERS[TIERS.length - 1];
        },

        // Tinh so tien can chi tieu them de len hang tiep theo
        getNextTierInfo: function(totalSpend = 0) {
            const spend = Math.max(0, Number(totalSpend) || 0);
            const currentTier = this.getTierBySpend(spend);
            const curIdx = TIERS.findIndex(t => t.id === currentTier.id);

            if (curIdx === 0) {
                // Da la Kim Cuong (hang cao nhat)
                return { isMaxTier: true, nextTier: null, neededSpend: 0 };
            }

            const nextTier = TIERS[curIdx - 1];
            const needed = Math.max(0, nextTier.minSpend - spend);
            return {
                isMaxTier: false,
                currentTier: currentTier,
                nextTier: nextTier,
                neededSpend: needed
            };
        },

        // Tinh so diem tich luy duoc tu so tien thuc thu (net paid amount)
        // Ho tro ca truyen tong chi tieu (number) hoac ma hang hoi vien (string)
        calculateEarnPoints: function(netPaidAmount = 0, totalSpendOrTier = 0) {
            const net = Math.max(0, Number(netPaidAmount) || 0);
            if (net <= 0) return 0;
            let earnRate = 0.03;
            if (typeof totalSpendOrTier === 'string') {
                const t = totalSpendOrTier.trim().toLowerCase();
                if (t === 'diamond' || t === 'kim cuong' || t === 'kim cương') earnRate = 0.10;
                else if (t === 'gold' || t === 'vang' || t === 'vàng') earnRate = 0.07;
                else if (t === 'silver' || t === 'bac' || t === 'bạc') earnRate = 0.05;
                else earnRate = 0.03;
            } else if (typeof totalSpendOrTier === 'object' && totalSpendOrTier && totalSpendOrTier.earnRate) {
                earnRate = totalSpendOrTier.earnRate;
            } else {
                const tier = this.getTierBySpend(totalSpendOrTier);
                earnRate = tier.earnRate;
            }
            const pointsEarned = Math.round(net * earnRate);
            return Math.max(0, pointsEarned);
        },

        // Tinh so diem toi da co the tru cho hoa don (cho phep tru toi da 100% bill)
        calculateMaxRedeemPoints: function(currentPoints = 0, billAmount = 0) {
            const pts = Math.max(0, Math.floor(Number(currentPoints) || 0));
            const bill = Math.max(0, Math.floor(Number(billAmount) || 0));
            if (pts <= 0 || bill <= 0) return 0;

            // Quy tac: Tru toi da toan bo diem hien co hoac 100% gia tri hoa don
            const maxPointsCanUse = Math.min(pts, bill);
            return maxPointsCanUse;
        },

        // Quy doi diem sang VND
        pointsToVnd: function(points = 0) {
            return Math.max(0, Number(points) || 0) * POINT_TO_VND_RATE;
        },

        // Quy doi VND sang diem
        vndToPoints: function(vnd = 0) {
            return Math.max(0, Math.floor(Number(vnd) || 0) / POINT_TO_VND_RATE);
        },

        // Chuan hoa so dien thoai Viet Nam
        normalizePhone: function(phoneStr) {
            if (!phoneStr) return '';
            let p = String(phoneStr).replace(/[^0-9]/g, '');
            if (p.startsWith('84') && p.length >= 11) {
                p = '0' + p.substring(2);
            }
            return p;
        },

        // Kiem tra tinh hop le cua so dien thoai
        isValidPhone: function(phoneStr) {
            const p = this.normalizePhone(phoneStr);
            return /^(0[3|5|7|8|9])[0-9]{8}$/.test(p);
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LoyaltyEngine;
    } else {
        root.LoyaltyEngine = LoyaltyEngine;
    }
})(typeof window !== 'undefined' ? window : this);
