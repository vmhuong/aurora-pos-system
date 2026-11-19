// =====================================================================
// AURORA SYSTEM - ADMIN AUTHENTICATION & RBAC MODULE
// Quản lý đăng nhập, chữ ký phiên bảo mật (Anti-tamper), phân quyền vai trò
// =====================================================================

(function(root) {
    'use strict';

    const SALT = 'AURORA_SECURE_AUTH_v2026';

    function generateSignature(user) {
        if (!user || !user.role) return '';
        const raw = `${user.email || user.username || 'user'}|${user.role}|${SALT}`;
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return 'sig_' + Math.abs(hash).toString(36);
    }

    const AdminAuth = {
        saveSession(user) {
            if (!user) return;
            const sig = generateSignature(user);
            const userRole = user.role || '';
            sessionStorage.setItem('aurora_admin_auth', 'true');
            localStorage.setItem('aurora_admin_auth', 'true');
            localStorage.setItem('aurora_admin_role', userRole);
            localStorage.setItem('aurora_current_user', JSON.stringify(user));
            localStorage.setItem('aurora_session_sig', sig);
            if (typeof root !== 'undefined') {
                root.currentStaffRole = userRole;
            }
        },

        getCurrentUser() {
            try {
                const raw = localStorage.getItem('aurora_current_user');
                if (!raw) return null;
                const user = JSON.parse(raw);
                const storedSig = localStorage.getItem('aurora_session_sig');
                // Chống giả mạo role bằng DevTools
                if (storedSig && storedSig !== generateSignature(user)) {
                    console.warn("Phat hien sua doi phien lam viec trai phep! Dang xuat khan cap.");
                    this.logout();
                    return null;
                }
                return user;
            } catch(e) {
                return null;
            }
        },

        hasRole(roles) {
            const u = this.getCurrentUser();
            if (!u || !u.role) return false;
            const userRole = String(u.role).trim().toLowerCase();
            if (!Array.isArray(roles)) {
                roles = [roles];
            }
            const normalizedRoles = roles.map(r => String(r).trim().toLowerCase());
            return normalizedRoles.includes(userRole);
        },

        logout() {
            sessionStorage.removeItem('aurora_admin_auth');
            localStorage.removeItem('aurora_admin_auth');
            localStorage.removeItem('aurora_admin_role');
            localStorage.removeItem('aurora_current_user');
            localStorage.removeItem('aurora_session_sig');
            if (typeof root !== 'undefined') {
                root.currentStaffRole = '';
            }
            if (root.firebaseAuth && typeof root.signOut === 'function') {
                try { root.signOut(root.firebaseAuth); } catch(e) {}
            }
            location.reload();
        },

        canAccessPaymentGateway(userOrRole) {
            let role = '';
            if (typeof userOrRole === 'string') {
                role = userOrRole;
            } else if (userOrRole && typeof userOrRole === 'object') {
                role = userOrRole.role || '';
            } else {
                const u = this.getCurrentUser();
                role = u ? (u.role || '') : '';
            }
            const r = String(role).trim().toLowerCase();
            return (r === 'admin' || r === 'superadmin' || r === 'owner' || r === 'quản trị viên' || r === 'quan tri vien');
        },

        isStaffRole(role) {
            if (!role) return false;
            const r = String(role).trim().toLowerCase();
            if (r === 'admin' || r === 'superadmin' || r === 'owner' || r === 'quản trị viên' || r === 'quan tri vien' || r === 'manager' || r === 'quanly' || r === 'quan_ly' || r === 'quản lý') {
                return false;
            }
            return (r === 'staff' || r === 'web_staff' || r === 'web_waiter' || r === 'waiter' || r === 'kitchen' || r === 'cashier' || r === 'nhân viên' || r === 'nhanvien');
        },

        getRoleDisplayName(role) {
            const r = String(role || '').trim().toLowerCase();
            if (r === 'admin' || r === 'superadmin' || r === 'owner' || r === 'quản trị viên' || r === 'quan tri vien') return 'Quản trị viên';
            if (r === 'manager' || r === 'quanly' || r === 'quan_ly' || r === 'quản lý') return 'Quản lý';
            if (r === 'kitchen' || r === 'bếp' || r === 'bep') return 'Nhân viên Bếp';
            if (r === 'cashier' || r === 'thu ngân' || r === 'thu_ngan') return 'Thu ngân';
            return 'Nhân viên Phục vụ';
        }
    };

    root.AdminAuth = AdminAuth;
    root.canAccessPaymentGateway = AdminAuth.canAccessPaymentGateway.bind(AdminAuth);
    root.isStaffRole = AdminAuth.isStaffRole.bind(AdminAuth);
    root.getRoleDisplayName = AdminAuth.getRoleDisplayName.bind(AdminAuth);
})(typeof window !== 'undefined' ? window : this);
