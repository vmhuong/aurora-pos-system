/**
 * =====================================================================
 * AURORA RESTAURANT & LOUNGE - SEPAY WEBHOOK CLOUDFLARE WORKER
 * Tự động nhận Webhook SePay MB Bank -> Xác thực bảo mật Firebase Auth Bot
 * Ghi nhận an toàn vào Firestore REST API (Chặn 100% DevTools giả mạo)
 * =====================================================================
 * 
 * Hướng dẫn triển khai (1 phút):
 * 1. Đăng ký tài khoản miễn phí tại https://dash.cloudflare.com -> Workers & Pages -> Create Worker.
 * 2. Dán toàn bộ nội dung file này vào, thay đổi các biến cấu hình bên dưới và bấm Save & Deploy.
 * 3. Copy URL của Worker dán vào ô Webhook URL trên https://my.sepay.vn!
 */

// CẤU HÌNH HỆ THỐNG CỦA BẠN
const FIREBASE_PROJECT_ID = 'YOUR_FIREBASE_PROJECT_ID';
const FIREBASE_API_KEY = 'YOUR_FIREBASE_API_KEY';
const BOT_EMAIL = 'sepay-bot@your-domain.system';
const BOT_PASSWORD = 'YOUR_BOT_PASSWORD_HERE';
const DEFAULT_SECRET_TOKEN = 'YOUR_SEPAY_WEBHOOK_SECRET';
const DEFAULT_BANK_ACCOUNT = '0123456789';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getBotIdToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
        return cachedToken;
    }
    try {
        const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: BOT_EMAIL,
                password: BOT_PASSWORD,
                returnSecureToken: true
            })
        });
        const data = await authRes.json();
        if (data.idToken) {
            cachedToken = data.idToken;
            tokenExpiresAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
            return cachedToken;
        }
    } catch (err) {
        console.error('Lỗi xác thực Bot Firebase Auth:', err);
    }
    return null;
}

export default {
    async fetch(request, env, ctx) {
        // Chỉ xử lý phương thức POST
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ success: false, message: 'Only POST supported' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // BẢO MẬT: Xác thực Secret API Token từ SePay Webhook
        const expectedSecret = env.SEPAY_WEBHOOK_SECRET || env.SEPAY_API_KEY || DEFAULT_SECRET_TOKEN;
        const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
        const cleanToken = authHeader.replace(/^Apikey\s+/i, '').trim();

        if (!authHeader || (cleanToken !== expectedSecret && authHeader !== expectedSecret)) {
            console.warn('Từ chối Webhook không có Secret API Token hợp lệ:', authHeader);
            return new Response(JSON.stringify({ 
                success: false, 
                message: '401 Unauthorized: Invalid or missing Secret API Token' 
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            const data = await request.json();
            console.log('SePay Webhook Received:', JSON.stringify(data));

            const txId = String(data.id || data.referenceCode || Date.now());
            const amount = Number(data.transferAmount || data.amount_in || 0);
            const content = String(data.content || data.transaction_content || '').toUpperCase();
            const bank = String(data.gateway || data.bank_brand_name || 'MBBank');
            const accNo = String(data.accountNumber || data.account_number || DEFAULT_BANK_ACCOUNT);

            // Trích xuất mã bàn chuẩn xác từ nội dung chuyển khoản (VD: "THANH TOAN BAN A1" -> "A1")
            let extractedTable = '';
            const match = content.match(/\b(?:BAN|BÀN)\s*([A-Za-z0-9_-]+)/i)
                       || content.match(/(?:AURORA|TT)\s*([A-Za-z0-9_-]+)/i)
                       || content.match(/\b([A-Za-z0-9_-]+)$/i);
            if (match) {
                extractedTable = match[1].replace(/^(BAN|BÀN)\s*/i, '').trim().toUpperCase();
            }

            // Ghi nhận giao dịch vào Firestore collection `payment_transactions`
            const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/payment_transactions/${encodeURIComponent(txId)}`;

            const docBody = {
                fields: {
                    transaction_id: { stringValue: txId },
                    amount: { integerValue: String(amount) },
                    content: { stringValue: content },
                    extracted_table: { stringValue: extractedTable },
                    table_code: { stringValue: extractedTable },
                    bank: { stringValue: bank },
                    account_number: { stringValue: accNo },
                    source: { stringValue: 'cloudflare_worker_webhook' },
                    created_at: { timestampValue: new Date().toISOString() }
                }
            };

            // Ghi Firestore ngầm có xác thực chứng chỉ Bot Firebase
            ctx.waitUntil((async () => {
                try {
                    const token = await getBotIdToken();
                    const headers = { 'Content-Type': 'application/json' };
                    if (token) {
                        headers['Authorization'] = `Bearer ${token}`;
                    }
                    const res = await fetch(firestoreUrl, {
                        method: 'PATCH',
                        headers: headers,
                        body: JSON.stringify(docBody)
                    });
                    if (!res.ok) {
                        const errText = await res.text();
                        console.error('Firestore write error:', res.status, errText);
                    } else {
                        console.log('Đã ghi nhận giao dịch vào Firestore an toàn:', txId);
                    }
                } catch (e) {
                    console.error('Lỗi ghi Firestore trong Worker:', e);
                }
            })());

            // Phản hồi ngay 200 OK cho SePay
            return new Response(JSON.stringify({
                success: true,
                message: 'Webhook processed by Aurora Cloudflare Worker',
                matched_table: extractedTable,
                transaction_id: txId
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (err) {
            return new Response(JSON.stringify({ success: false, error: err.message }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};
