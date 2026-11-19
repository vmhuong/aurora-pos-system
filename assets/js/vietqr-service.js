// =====================================================================
// AURORA LOUNGE - VIETQR SERVICE (NAPAS 247)
// Tự động sinh mã VietQR chuẩn EMVCo cục bộ (Base64 0ms, không phụ thuộc mạng)
// =====================================================================

(function(root) {
    const BANK_CONFIG = {
        bankId: 'mbbank',
        bankBin: '970422', // Mã BIN chuẩn NAPAS của MBBank (Ngân hàng Quân Đội)
        bankName: 'MB Bank',
        accountNo: '0123456789',
        accountName: 'NGUYEN VAN A',
        accountNameDisplay: 'Vũ Mạnh Hưởng'
    };

    // Thuật toán tính CRC16-CCITT (False: Init 0xFFFF, Poly 0x1021) theo đúng chuẩn EMVCo / VietQR
    function crc16Ccitt(data) {
        let crc = 0xFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= (data.charCodeAt(i) << 8);
            for (let j = 0; j < 8; j++) {
                if ((crc & 0x8000) !== 0) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
    }

    function tlv(tag, val) {
        const sVal = String(val == null ? '' : val);
        const len = sVal.length.toString().padStart(2, '0');
        return tag + len + sVal;
    }

    // Sinh chuỗi dữ liệu EMVCo VietQR chính quy chuẩn NAPAS 247
    function buildVietQrPayload(amount, tableCode) {
        const cleanTable = String(tableCode || '').toUpperCase().replace(/^(TABLE|BÀN|BAN)\s*/i, '').trim();
        const memo = `THANH TOAN BAN ${cleanTable || 'AURORA'}`;
        const intAmount = Math.round(Number(amount) || 0);

        // Sub-tags của Tag 38 (Consumer Account Information)
        const guid = tlv('00', 'A000000727'); // NAPAS GUID
        const benInfo = tlv('01', tlv('00', BANK_CONFIG.bankBin) + tlv('01', BANK_CONFIG.accountNo));
        const srv = tlv('02', 'QRIBFTTA'); // Chuyển nhanh Napas247 tới số tài khoản
        const tag38 = tlv('38', guid + benInfo + srv);

        let raw = tlv('00', '01') + // Format indicator
                  tlv('01', '12') + // 12: Dynamic QR (có số tiền xác định)
                  tag38 +
                  tlv('53', '704') + // Tiền tệ VNĐ
                  tlv('54', intAmount) + // Số tiền giao dịch
                  tlv('58', 'VN'); // Quốc gia

        if (memo) {
            raw += tlv('62', tlv('08', memo)); // Nội dung chuyển khoản
        }

        raw += '6304';
        const checksum = crc16Ccitt(raw);
        return raw + checksum;
    }

    // Lấy Data URL (Base64) sinh cục bộ ngay lập tức 0ms bằng thư viện qrcode.js
    async function getVietQrDataUrl(amount, tableCode, width = 160) {
        const payload = buildVietQrPayload(amount, tableCode);
        if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
            try {
                return await QRCode.toDataURL(payload, {
                    width: width,
                    margin: 1,
                    errorCorrectionLevel: 'M'
                });
            } catch(e) {
                console.warn("Lỗi sinh QR DataURL cục bộ:", e);
            }
        }
        // Fallback sang API trực tuyến nếu chưa tải được thư viện QRCode
        return getVietQrUrl(amount, tableCode);
    }

    function getVietQrUrl(amount, tableCode) {
        if (!amount || amount <= 0) return '';
        const cleanTable = String(tableCode || '').toUpperCase().replace(/^(TABLE|BÀN|BAN)\s*/i, '').trim();
        const memo = encodeURIComponent(`THANH TOAN BAN ${cleanTable || 'AURORA'}`);
        const accName = encodeURIComponent(BANK_CONFIG.accountName);
        const intAmount = Math.round(Number(amount) || 0);

        return `https://img.vietqr.io/image/${BANK_CONFIG.bankId}-${BANK_CONFIG.accountNo}-compact2.png?amount=${intAmount}&addInfo=${memo}&accountName=${accName}`;
    }

    function renderVietQrHtml(amount, tableCode, isPrint, customQrUrl) {
        if (!amount || amount <= 0) return '';
        const qrUrl = customQrUrl || getVietQrUrl(amount, tableCode);
        const cleanTable = String(tableCode || '').toUpperCase().replace(/^(TABLE|BÀN|BAN)\s*/i, '').trim();
        const transferMemo = `THANH TOAN BAN ${cleanTable || 'AURORA'}`;

        if (isPrint) {
            // Mẫu in hóa đơn nhiệt giấy K80 / K57 (sử dụng Base64 Data URL để in lập tức 100% không bị trắng)
            return `
            <div style="text-align: center; margin-top: 6px; padding-top: 5px; border-top: 1px dashed black; font-family: monospace;">
                <div style="font-size: 9.5px; font-weight: bold; text-transform: uppercase; margin-bottom: 3px;">QUÉT MÃ THANH TOÁN (VIETQR)</div>
                <img src="${qrUrl}" alt="VietQR" style="width: 135px; height: 135px; margin: 0 auto; display: block; border: 1px solid #ddd; padding: 2px; background: white;">
                <div style="font-size: 8px; margin-top: 3px; line-height: 1.3;">
                    <div>${BANK_CONFIG.bankName}: <strong>${BANK_CONFIG.accountNo}</strong> - ${BANK_CONFIG.accountNameDisplay}</div>
                    <div>Nội dung: <strong>${transferMemo}</strong></div>
                    <div style="font-weight: bold; color: black; font-size: 8.5px; margin-top: 1px;">Số tiền: ${Number(amount).toLocaleString('vi-VN')} VNĐ</div>
                </div>
            </div>`;
        }

        // Mẫu hiển thị giao diện Web (Customer & Admin)
        return `
        <div class="vietqr-card bg-gradient-to-b from-white to-[#fbf9f5] border border-[#e8dfcf] rounded-3xl p-4 sm:p-5 shadow-sm space-y-3.5 text-center anim-fade-up">
            <div class="flex items-center justify-between pb-2 border-b border-[#eae3d5]">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span class="text-xs font-bold text-[#2c2621] uppercase tracking-wider">Thanh Toán Chuyển Khoản</span>
                </div>
                <span class="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
                    Miễn phí & Tự động
                </span>
            </div>

            <!-- Khung ảnh QR -->
            <div class="relative inline-block mx-auto bg-white p-3 rounded-2xl border border-[#e2d7c5] shadow-xs">
                <img src="${qrUrl}" alt="Mã VietQR Thanh Toán" class="w-48 h-48 sm:w-56 sm:h-56 mx-auto object-contain rounded-xl">
                <div class="absolute -bottom-2.5 left-1/2 transform -translate-x-1/2 bg-[#002f6c] text-white text-[10px] font-bold px-3 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                    MB Bank Napas247
                </div>
            </div>

            <!-- Chi tiết tài khoản & Nút sao chép -->
            <div class="bg-[#f5efe4] rounded-2xl p-3 text-left space-y-1.5 text-xs text-[#524941]">
                <div class="flex justify-between items-center">
                    <span>Ngân hàng:</span>
                    <span class="font-bold text-[#1b1714]">MB Bank (Quân Đội)</span>
                </div>
                <div class="flex justify-between items-center">
                    <span>Chủ tài khoản:</span>
                    <span class="font-bold text-[#1b1714]">${BANK_CONFIG.accountNameDisplay}</span>
                </div>
                <div class="flex justify-between items-center pt-1 border-t border-[#e5dcce]">
                    <span>Số tài khoản:</span>
                    <div class="flex items-center gap-1.5">
                        <strong class="font-mono text-sm text-[#002f6c] tracking-wider">${BANK_CONFIG.accountNo}</strong>
                        <button onclick="navigator.clipboard.writeText('${BANK_CONFIG.accountNo}'); (typeof showToast === 'function' ? showToast('Đã chép số tài khoản MB Bank!', 'success') : alert('Đã chép số tài khoản: ${BANK_CONFIG.accountNo}'));" 
                                class="px-2 py-0.5 bg-white text-gray-700 hover:text-black rounded-md text-[10px] font-semibold border border-gray-300 shadow-2xs active:scale-95 transition" title="Sao chép">
                            <i class="fa-regular fa-copy"></i> Chép
                        </button>
                    </div>
                </div>
                <div class="flex justify-between items-center">
                    <span>Số tiền:</span>
                    <strong class="font-bold text-sm text-[#b89728]">${Number(amount).toLocaleString('vi-VN')} VNĐ</strong>
                </div>
                <div class="flex justify-between items-center pt-1 border-t border-[#e5dcce]">
                    <span>Nội dung:</span>
                    <div class="flex items-center gap-1.5">
                        <strong class="font-mono text-xs text-purple-800">${transferMemo}</strong>
                        <button onclick="navigator.clipboard.writeText('${transferMemo}'); (typeof showToast === 'function' ? showToast('Đã chép nội dung chuyển khoản!', 'success') : alert('Đã chép nội dung: ${transferMemo}'));" 
                                class="px-2 py-0.5 bg-white text-gray-700 hover:text-black rounded-md text-[10px] font-semibold border border-gray-300 shadow-2xs active:scale-95 transition" title="Sao chép">
                            <i class="fa-regular fa-copy"></i> Chép
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    }

    if (typeof window !== 'undefined') {
        window.BANK_CONFIG = BANK_CONFIG;
        window.getVietQrUrl = getVietQrUrl;
        window.buildVietQrPayload = buildVietQrPayload;
        window.getVietQrDataUrl = getVietQrDataUrl;
        window.renderVietQrHtml = renderVietQrHtml;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { BANK_CONFIG, buildVietQrPayload, getVietQrDataUrl, getVietQrUrl, renderVietQrHtml };
    }
})(typeof window !== 'undefined' ? window : this);
