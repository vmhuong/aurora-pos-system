# 🍽️ AURORA RESTAURANT & LOUNGE · SMART QR ORDERING & POS SYSTEM

> Hệ thống gọi món thông minh qua mã QR tại bàn, quản lý nhà hàng thời gian thực (Realtime POS), Màn hình Bếp (KDS) và Tự động hóa thanh toán chuyển khoản ngân hàng qua SePay (0 giây).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore%20%26%20Hosting-orange.svg)](https://firebase.google.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020.svg)](https://workers.cloudflare.com/)
[![SePay](https://img.shields.io/badge/Payment-SePay%20VietQR-0052cc.svg)](https://sepay.vn/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-success.svg)](https://web.dev/progressive-web-apps/)

---

## 🌟 ĐẶC ĐIỂM NỔI BẬT

1. **Khách tự đặt món tại bàn qua QR Code (Self-Ordering Menu):**
   - Không cần tải ứng dụng: Khách chỉ cần dùng Camera điện thoại quét mã QR dán trên bàn.
   - Giao diện PWA mượt mà, hỗ trợ đa ngôn ngữ (Tiếng Việt & English).
   - Chọn combo linh hoạt, tùy chọn thêm món (Topping, đá, đường), ghi chú món.
   - **Gọi phục vụ thông minh:** Bấm chuông kèm lựa chọn nhanh (*Lấy thêm đá, Bát đĩa, Khăn giấy...*) hoặc gõ mô tả chi tiết gửi trực tiếp tới nhân viên.
   - Theo dõi trạng thái đơn hàng (Đang chế biến, Đã lên món) và xem hóa đơn tạm tính theo thời gian thực.

2. **Màn hình Quản lý & Thu ngân (Smart POS & Floorplan):**
   - Sơ đồ bàn trực quan đa trạng thái: `Trống (Xanh)`, `Chờ món (Cam)`, `Đang nấu (Lam)`, `Đang ăn (Lục)`, `Cần hỗ trợ (Đỏ)`, `Chờ thanh toán (Tím)`.
   - Chuyển bàn, tách bàn, chuyển từng món ăn giữa các bàn cực kỳ trực quan.
   - Quản lý thực đơn: Bật/Tắt khóa món hết hàng trong 1 chạm.
   - Quản lý mã giảm giá (Voucher) và Tích điểm hội viên (Loyalty Points) theo hạng thẻ (Bạc, Vàng, Kim Cương).

3. **Màn hình Bếp thời gian thực (Kitchen Display System - KDS):**
   - Bếp nhận đơn tức thì (0s) ngay khi khách hoặc nhân viên gửi đơn.
   - Âm thanh chuông báo có đơn mới.
   - Cập nhật trạng thái từng món: *Chờ nấu $\rightarrow$ Đang nấu $\rightarrow$ Hoàn thành*.

4. **Tự động hóa thanh toán ngân hàng (SePay 0-Second Auto-Settlement):**
   - Tích hợp cổng SePay lắng nghe biến động số dư ngân hàng (MB Bank, Vietcombank...).
   - Khách quét mã VietQR chuyển khoản đúng cú pháp (VD: `THANH TOAN BAN A1`).
   - Hệ thống tự động so khớp số tiền và mã bàn, phát chuông "Ting Ting" và **tự động giải phóng bàn trong 0 giây** mà không cần thu ngân thao tác tay.

5. **Bảo mật cấp doanh nghiệp (Enterprise Security):**
   - Phân quyền RBAC 3 cấp độ: `Admin (Quản trị viên)`, `Quản lý (Manager)`, `Nhân viên (Staff)`.
   - Bảo mật mã PIN bằng thuật toán băm một chiều SHA-256 kèm muối bảo mật.
   - **Chống gian lận DevTools (F12):** Firestore Rules khóa chặt toàn diện, chỉ cấp quyền tạo giao dịch cho Bot định danh bảo mật của Cloudflare Worker thông qua Google JWT Token.

---

## 🌐 HỆ SINH THÁI AURORA POS ECOSYSTEM

Dự án này gồm 2 nền tảng mã nguồn mở độc lập và tương thích hoàn toàn với nhau:
1. 🌐 **Web QR Ordering & Cloud POS:** [aurora-pos-system](https://github.com/vmhuong/aurora-pos-system) *(Repo hiện tại)*
2. 📱 **Native Android Staff & Kitchen Display (KDS) App:** [aurora-pos-android](https://github.com/vmhuong/aurora-pos-android)

---

## 🏗️ KIẾN TRÚC HỆ THỐNG

```
[ Khách hàng quét QR ] ────┐
                          ▼
[ Màn hình POS Thu ngân ] ───► [ Google Firebase Firestore (Realtime DB) ]
                          ▲                   ▲
[ Màn hình Bếp KDS ] ─────┘                   │
                                              │ Ghi nhận giao dịch (Google Bot JWT)
[ Khách chuyển khoản MB Bank ]                 │
            │                                 │
            ▼                                 │
     [ Cổng SePay ] ──(Webhook POST)──► [ Cloudflare Worker ]
```

---

## 🚀 HƯỚNG DẪN CÀI ĐẶT & TRIỂN KHAI (QUICKSTART)

### Bước 1: Tải mã nguồn về máy
```bash
git clone https://github.com/your-username/aurora-pos-system.git
cd aurora-pos-system
```

### Bước 2: Tạo dự án Firebase
1. Truy cập [Firebase Console](https://console.firebase.google.com/) và tạo một dự án mới (miễn phí).
2. Kích hoạt **Firestore Database** (chọn chế độ Production).
3. Kích hoạt **Firebase Authentication** $\rightarrow$ Bật phương thức đăng nhập bằng **Email/Password**.
4. Tạo một tài khoản Bot nội bộ dùng cho Webhook:
   - Email: `sepay-bot@your-domain.system`
   - Mật khẩu: Chọn một mật khẩu ngẫu nhiên phức tạp (32 ký tự).
5. Lấy thông tin cấu hình web tại: **Project settings $\rightarrow$ General $\rightarrow$ Your apps (Web app)**.

### Bước 3: Cấu hình hệ thống
1. Sao chép file cấu hình mẫu:
   ```bash
   cp config.example.js config.js
   ```
2. Mở file `config.js` và điền thông tin Firebase và tài khoản ngân hàng của bạn:
   ```javascript
   window.AURORA_CONFIG = {
       firebase: {
           apiKey: "AIzaSy...",
           authDomain: "your-project.firebaseapp.com",
           projectId: "your-project",
           storageBucket: "your-project.appspot.com",
           messagingSenderId: "123456789",
           appId: "1:123456789:web:abcdef"
       },
       restaurant: {
           name: "Tên Quán Của Bạn",
           bankName: "MBBank",
           bankAccount: "0123456789",
           accountName: "NGUYEN VAN A",
           webhookUrl: "https://your-worker.yourname.workers.dev/"
       }
   };
   ```

### Bước 4: Triển khai quy tắc bảo mật Firestore Rules
Cài đặt Firebase CLI và triển khai file quy tắc bảo mật:
```bash
npm install -g firebase-tools
firebase login
firebase use your-project-id
firebase deploy --only firestore:rules
```

### Bước 5: Triển khai Cloudflare Worker cho SePay Webhook
1. Đăng ký tài khoản miễn phí tại [dash.cloudflare.com](https://dash.cloudflare.com/).
2. Vào **Workers & Pages $\rightarrow$ Create Worker**.
3. Dán toàn bộ nội dung file `sepay-webhook-worker.js` vào, cập nhật `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `BOT_EMAIL`, `BOT_PASSWORD`.
4. Bấm **Deploy**.
5. Copy URL của Worker (VD: `https://your-worker.yourname.workers.dev`) và dán vào ô **Webhook URL** trên [my.sepay.vn](https://my.sepay.vn).

### Bước 6: Chạy thử nghiệm hoặc Đưa lên Hosting
- **Chạy thử trên máy tính:** Mở file `index.html` (Khách đặt món) hoặc `admin.html` (POS Quản trị) bằng bất kỳ Web Server nào (Live Server, XAMPP, Nginx).
- **Đưa lên Firebase Hosting miễn phí:**
  ```bash
  firebase deploy --only hosting
  ```

---

## 📁 CẤU TRÚC THƯ MỤC DỰ ÁN

```
aurora-pos-system/
├── assets/
│   ├── css/              # Tùy biến kiểu dáng và animation
│   ├── js/
│   │   ├── admin/        # Các module quản lý: Bàn, Menu, KDS, Nhân viên, Voucher, Tích điểm
│   │   ├── services/     # Công cụ lõi tính giá Combo, Voucher, Loyalty Engine
│   │   ├── sepay-service.js # Dịch vụ kết nối và tự động kết bàn SePay
│   │   └── vietqr-service.js # Tạo mã VietQR động theo chuẩn ngân hàng
│   └── vendor/           # Thư viện cục bộ: TailwindCSS, FontAwesome, QRCode.js (Hỗ trợ Offline)
├── admin.html            # Màn hình quản trị POS, Bếp KDS, Sơ đồ bàn
├── index.html            # Giao diện khách hàng quét QR đặt món & gọi phục vụ
├── sepay-webhook-worker.js # Serverless Cloudflare Worker bắt biến động số dư ngân hàng
├── firestore.rules       # Quy tắc bảo mật Firestore cấp doanh nghiệp (Chống F12)
├── firebase.json         # Cấu hình máy chủ Firebase Hosting
├── config.example.js     # File mẫu cấu hình Firebase & Ngân hàng
├── sw.js                 # Service Worker hỗ trợ cài đặt PWA
└── manifest.json         # Khai báo Progressive Web App
```

---

## 📜 GIẤY PHÉP (LICENSE)

Dự án được phân phối dưới giấy phép **MIT License**. Bạn hoàn toàn có thể tự do sử dụng, chỉnh sửa và triển khai cho nhà hàng, quán cà phê của mình mà không mất phí bản quyền.
