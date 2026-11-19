// =====================================================================
// AURORA LOUNGE - SERVICE WORKER (PWA & OFFLINE CACHE)
// Version 40.0 - Support request custom note & quick chips for customer calling staff
// =====================================================================

const CACHE_NAME = 'aurora-cache-v40.0';
const STATIC_ASSETS = [
    './index.html',
    './admin.html',
    './manifest.json',
    './assets/js/vietqr-service.js',
    './assets/js/sepay-service.js',
    './assets/js/services/combo-engine.js',
    './assets/js/services/voucher-engine.js',
    './assets/js/services/loyalty-engine.js',
    './assets/js/admin/admin-combo.js',
    './assets/js/admin/admin-voucher.js',
    './assets/js/admin/admin-loyalty.js',
    './assets/js/admin/admin-customer-loyalty.js',
    './assets/js/admin/admin-auth.js',
    './assets/js/admin/admin-sound.js',
    './assets/js/admin/admin-menu.js',
    './assets/js/admin/admin-staff.js',
    './assets/js/admin/admin-tables.js',
    './assets/js/admin/admin-kds.js',
    './assets/js/admin/admin-dashboard.js',
    './assets/js/admin/admin-audit.js',
    // Thư viện Vendor cục bộ
    './assets/vendor/tailwindcss.js',
    './assets/vendor/qrcode.min.js',
    './assets/vendor/fontawesome/css/all.min.css',
    './assets/vendor/fontawesome/webfonts/fa-solid-900.woff2',
    './assets/vendor/fontawesome/webfonts/fa-regular-400.woff2',
    './assets/vendor/fontawesome/webfonts/fa-brands-400.woff2',
    './assets/vendor/fontawesome/webfonts/fa-v4compatibility.woff2',
    './assets/vendor/fonts/plus-jakarta-sans.css',
    './assets/vendor/fonts/plus-jakarta-sans-1.ttf',
    './assets/vendor/fonts/plus-jakarta-sans-2.ttf',
    './assets/vendor/fonts/plus-jakarta-sans-3.ttf',
    './assets/vendor/fonts/plus-jakarta-sans-4.ttf',
    './assets/vendor/fonts/plus-jakarta-sans-5.ttf',
    './assets/vendor/fonts/plus-jakarta-sans-6.ttf'
];

// Cài đặt Service Worker và nạp toàn bộ tài nguyên vào cache cục bộ
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('Ghi chú nạp cache ban đầu:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// Dọn dẹp cache cũ khi phiên bản mới được kích hoạt
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Xử lý request mạng:
// 1. Với các trang HTML & JavaScript mã nguồn ứng dụng (assets/js/**): Dùng chiến lược Network-First
//    để người dùng luôn nhận ngay bản cập nhật mới nhất từ Firebase Hosting khi có mạng.
//    Chỉ fallback sang cache khi thiết bị hoàn toàn mất kết nối.
// 2. Với tài nguyên tĩnh ít thay đổi (Fonts, CSS, Vendor JS): Dùng Stale-While-Revalidate để tải tức thì.
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Không can thiệp vào các truy vấn thời gian thực Firestore hoặc Auth hoặc các request không phải GET
    if (
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('firebase') ||
        url.hostname.includes('identitytoolkit') ||
        event.request.method !== 'GET'
    ) {
        return; // Để trình duyệt gửi trực tiếp qua mạng
    }

    const isAppCodeRequest = event.request.mode === 'navigate' ||
                             url.pathname.endsWith('.html') ||
                             url.pathname === '/' ||
                             url.pathname.endsWith('/') ||
                             url.pathname.includes('/assets/js/');

    if (isAppCodeRequest) {
        // Network-First cho HTML và Application Scripts
        event.respondWith(
            fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                return caches.match(event.request);
            })
        );
        return;
    }

    // Stale-While-Revalidate cho tài nguyên tĩnh
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                return cachedResponse;
            });

            return cachedResponse || fetchPromise;
        })
    );
});
