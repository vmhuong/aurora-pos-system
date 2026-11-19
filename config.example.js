/**
 * =====================================================================
 * AURORA RESTAURANT & LOUNGE - OPEN SOURCE CONFIGURATION TEMPLATE
 * Hướng dẫn cấu hình:
 * 1. Sao chép file này thành 'config.js' trong cùng thư mục.
 * 2. Điền thông tin Firebase và Ngân hàng của bạn vào bên dưới.
 * =====================================================================
 */

window.AURORA_CONFIG = {
    // 1. Cấu hình Firebase Project (Lấy từ Firebase Console -> Project Settings)
    firebase: {
        apiKey: "YOUR_FIREBASE_API_KEY",
        authDomain: "your-project-id.firebaseapp.com",
        projectId: "your-project-id",
        storageBucket: "your-project-id.appspot.com",
        messagingSenderId: "123456789012",
        appId: "1:123456789012:web:abcdef123456"
    },

    // 2. Cấu hình Quán & Tài khoản nhận chuyển khoản SePay
    restaurant: {
        name: "Aurora Restaurant & Lounge",
        bankName: "MBBank",
        bankAccount: "0123456789",          // Thay bằng STK ngân hàng của bạn
        accountName: "NGUYEN VAN A",        // Tên chủ tài khoản
        hotline: "0901234567",              // Hotline liên hệ
        webhookUrl: "https://your-worker.yourname.workers.dev/"
    },

    // 3. Khóa bảo mật hệ thống (Nên đổi chuỗi khác khi đưa vào vận hành thật)
    security: {
        qrSalt: "AURORA_QR_TABLE_TOKEN_SALT_2026",
        pinSalt: "AURORA_PIN_SALT_2026_"
    }
};
