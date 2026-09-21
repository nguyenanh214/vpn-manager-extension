'use strict';
// Vì sao tunnel không lên — nói thẳng nguyên nhân thay vì đổ log ra cho người dùng tự đọc.
//
// Hai lớp:
//   1. checkCertWindow — đọc hạn cert TRƯỚC khi dựng container. Cert hết hạn làm
//      OpenVPN chạy hết 45s rồi mới chịu chết, và thứ người dùng nhận được là
//      "Quá 45s mà tunnel chưa sẵn sàng" kèm 30 dòng log, trong đó dòng
//      "Your certificate has expired" nằm lẫn giữa những dòng bình thường.
//      Đọc thẳng cert thì báo được ngày hết hạn cụ thể, ngay, không tốn 45s.
//   2. diagnoseLogs — khi tunnel chết vì lý do chỉ lộ ra lúc chạy (server từ chối,
//      không bắt tay được, thiếu /dev/net/tun), dịch dòng log của OpenVPN sang câu
//      người đọc hiểu, đặt lên TRƯỚC log chứ không thay thế log.
//
// Cả hai đều FAIL-OPEN: không chắc thì im lặng để OpenVPN thật phán. Chặn nhầm một
// cert hợp lệ tệ hơn nhiều so với việc bắt người dùng đợi 45s.

const fs = require('fs');
const { X509Certificate } = require('crypto');

/** Lấy khối cert của CLIENT. File .ovpn tự chứa có cả <ca> nên không thể lấy bừa. */
function extractClientCert(text) {
  const tagged = text.match(/<cert>([\s\S]*?)<\/cert>/);
  if (tagged) return tagged[1].trim();
  // File .pem rời: chỉ có cert client trong đó, lấy khối đầu tiên.
  const bare = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  return bare ? bare[0] : null;
}

/** dd/mm/yyyy HH:MM giờ máy. Tự format vì locale của native host không đoán trước được. */
function formatLocal(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} `
       + `${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Đường dẫn tới file chứa cert client của profile, theo từng chế độ. */
function certSourceOf(profile) {
  if (!profile) return null;
  if (profile.mode === 'ovpn' && profile.configPath) return profile.configPath;
  return profile.cert || null;
}

/**
 * Cert của profile có đang trong hạn không.
 *
 * `now` tiêm được để test giả lập thời điểm: OpenSSL 3.0 không đặt được notAfter
 * trong quá khứ, nên không sinh được cert hết hạn thật để làm fixture.
 *
 * @returns {null | {message: string}} null = không phát hiện vấn đề (kể cả khi
 *   không đọc/parse được — xem ghi chú fail-open ở đầu file).
 */
function checkCertWindow(profile, { now = Date.now() } = {}) {
  const src = certSourceOf(profile);
  if (!src) return null;

  let cert;
  try {
    const pem = extractClientCert(fs.readFileSync(src, 'utf8'));
    if (!pem) return null;
    cert = new X509Certificate(pem);
  } catch {
    return null; // thiếu file hay cert hỏng: để buildCreateArgs/OpenVPN báo bằng lỗi của nó
  }

  // validToDate/validFromDate có từ Node 18.13; chuỗi validTo là đường lùi.
  const to = cert.validToDate || new Date(cert.validTo);
  const from = cert.validFromDate || new Date(cert.validFrom);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) return null;

  if (now > to.getTime()) {
    return { message:
      `Certificate của VPN này đã hết hạn ngày ${formatLocal(to)}.\n`
      + 'Tunnel sẽ không kết nối được cho tới khi có cert mới. '
      + 'Xin cert mới từ người quản trị VPN rồi import lại.' };
  }

  if (now < from.getTime()) {
    return { message:
      `Certificate của VPN này chưa có hiệu lực (bắt đầu từ ${formatLocal(from)}).\n`
      + 'Thường là do đồng hồ máy sai, hoặc cert vừa cấp cho một múi giờ khác.' };
  }

  return null;
}

// Mẫu log -> nguyên nhân. Xếp từ cụ thể xuống chung: mẫu đầu tiên khớp là thắng.
const LOG_PATTERNS = [
  [/Your certificate has expired/i,
   'Certificate client đã hết hạn — server từ chối.'],
  [/certificate is not yet valid/i,
   'Certificate chưa có hiệu lực. Kiểm tra đồng hồ máy.'],
  [/VERIFY ERROR[\s\S]*?certificate has expired/i,
   'Certificate của SERVER đã hết hạn. Đây là việc của người quản trị VPN.'],
  [/VERIFY X509NAME ERROR/i,
   'Tên X509 của server không khớp giá trị đang cấu hình (verifyX509).'],
  [/VERIFY ERROR/i,
   'Không xác minh được certificate của server — CA không khớp hoặc cert sai.'],
  [/AUTH_FAILED/i,
   'Server từ chối xác thực. Cert đã bị thu hồi, hoặc profile này cần tài khoản.'],
  [/Private key password verification failed|Enter Private Key Password/i,
   'Private key có đặt mật khẩu. Extension không hỏi được mật khẩu — hãy dùng key không mã hoá.'],
  [/TLS key negotiation failed to occur within/i,
   'Không bắt tay được với server. Thường là sai địa chỉ/cổng, sai giao thức '
   + '(udp/tcp), hoặc firewall chặn.'],
  [/RESOLVE:.*Cannot resolve host address|Cannot resolve host address/i,
   'Không phân giải được tên miền của server VPN.'],
  [/Connection refused|Network( is)? unreachable/i,
   'Không kết nối được tới server VPN.'],
  [/Cannot open TUN\/TAP dev/i,
   'Container không mở được thiết bị TUN. Docker thiếu quyền NET_ADMIN hoặc /dev/net/tun.'],
  [/Options error:/i,
   'File .ovpn có tuỳ chọn OpenVPN không hợp lệ.'],
];

/**
 * Dịch log OpenVPN sang một câu nguyên nhân.
 * @returns {string|null} null khi không mẫu nào khớp — lúc đó log thô vẫn là thứ tốt nhất có.
 */
function diagnoseLogs(text) {
  if (!text) return null;
  for (const [re, message] of LOG_PATTERNS) {
    if (re.test(text)) return message;
  }
  return null;
}

/** Ghép nguyên nhân lên trước log. Log vẫn giữ nguyên để còn debug được. */
function explainFailure(headline, logs) {
  const cause = diagnoseLogs(logs);
  if (!cause) return `${headline}:\n${logs}`;
  return `${cause}\n\n(${headline}, log 30 dòng cuối:)\n${logs}`;
}

module.exports = { checkCertWindow, diagnoseLogs, explainFailure, extractClientCert };
