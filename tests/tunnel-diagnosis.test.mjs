// Chẩn đoán vì sao tunnel không lên. Không cần Chrome, không cần Docker.
//
// Cert dùng để kiểm được SINH LÚC CHẠY vào thư mục tạm, không bao giờ nằm trong repo:
// `.gitignore` chặn *.pem và pre-commit hook chặn khối PEM trong nội dung stage.
//
// Vì sao tiêm đồng hồ thay vì làm cert hết hạn thật: OpenSSL 3.0 không đặt được
// notAfter trong quá khứ (`-not_after` chỉ có từ 3.2), nên không sinh nổi cert đã
// hết hạn để làm fixture. Tiêm `now` kiểm đúng cùng một nhánh code, và không phụ
// thuộc vào phiên bản openssl của từng máy.

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { counter } from './lib/harness.js';

const require = createRequire(import.meta.url);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const D = require(join(REPO, 'native-host', 'lib', 'tunnel-diagnosis.js'));

const { ok, done } = counter();

let hasOpenssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  hasOpenssl = false;
}

const box = mkdtempSync(join(tmpdir(), 'vpnmgr-diag-'));
const DAY = 86400000;

/** Cert tự ký sống `days` ngày kể từ bây giờ. Trả về {pem, from, to}. */
function makeCert(name, days) {
  const certPath = join(box, `${name}-cert.pem`);
  const keyPath = join(box, `${name}-key.pem`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-days', String(days), '-subj', `/CN=${name}`,
  ], { stdio: 'ignore' });
  return { path: certPath, pem: readFileSync(certPath, 'utf8') };
}

if (!hasOpenssl) {
  console.log('!! không có openssl — bỏ qua phần kiểm hạn cert, vẫn chạy phần đọc log');
} else {
  console.log('--- 1. Cert còn hạn thì không chặn ---');
  const client = makeCert('client', 30);
  const manual = { mode: 'manual', cert: client.path };
  ok(D.checkCertWindow(manual) === null, 'cert còn 30 ngày -> không có vấn đề');

  console.log('\n--- 2. Cert hết hạn: báo thẳng, kèm ngày ---');
  const expired = D.checkCertWindow(manual, { now: Date.now() + 31 * DAY });
  ok(expired !== null, 'phát hiện được cert đã hết hạn');
  ok(/hết hạn/.test(expired.message), 'câu báo nói rõ "hết hạn"', expired.message.split('\n')[0]);
  ok(/\d{2}\/\d{2}\/\d{4}/.test(expired.message), 'có ngày cụ thể dd/mm/yyyy');
  ok(!/45s|VPNMGR_READY|OpenVPN/.test(expired.message),
     'không đổ chi tiết kỹ thuật vào mặt người dùng');

  console.log('\n--- 3. Cert chưa có hiệu lực (đồng hồ máy sai) ---');
  const early = D.checkCertWindow(manual, { now: Date.now() - 2 * DAY });
  ok(early !== null, 'phát hiện cert chưa tới hạn dùng');
  ok(/chưa có hiệu lực/.test(early.message), 'nói đúng là chưa hiệu lực, không phải hết hạn');
  ok(/đồng hồ/.test(early.message), 'gợi ý nguyên nhân hay gặp nhất');

  console.log('\n--- 4. Chế độ .ovpn: lấy <cert>, KHÔNG lấy <ca> ---');
  // CA sống 10 năm, cert client sống 30 ngày. Nếu code lấy nhầm khối <ca> thì mốc
  // 31 ngày sau sẽ không phát hiện được gì — đó chính là cái bẫy bộ này canh.
  const ca = makeCert('ca', 3650);
  const ovpnPath = join(box, 'profile.ovpn');
  writeFileSync(ovpnPath,
    `client\nremote vpn.example.com 1194\n<ca>\n${ca.pem}</ca>\n<cert>\n${client.pem}</cert>\n`);
  const ovpnProfile = { mode: 'ovpn', configPath: ovpnPath };
  ok(D.checkCertWindow(ovpnProfile) === null, 'file .ovpn còn hạn -> không chặn');
  ok(D.checkCertWindow(ovpnProfile, { now: Date.now() + 31 * DAY }) !== null,
     'hết hạn cert CLIENT vẫn bị bắt dù <ca> còn 10 năm');
  ok(D.checkCertWindow(ovpnProfile, { now: Date.now() + 100 * DAY }) !== null,
     'không im lặng chỉ vì <ca> còn hạn');

  console.log('\n--- 5. extractClientCert ---');
  ok(D.extractClientCert(`<ca>\n${ca.pem}</ca>\n<cert>\n${client.pem}</cert>`).trim()
     === client.pem.trim(), 'lấy đúng khối <cert> khi có cả <ca>');
  ok(D.extractClientCert(client.pem) === client.pem.trim(),
     'file .pem rời vẫn lấy được');
  ok(D.extractClientCert('không có cert gì ở đây') === null, 'không có cert -> null');
}

console.log('\n--- 6. Fail-open: không chắc thì im lặng ---');
ok(D.checkCertWindow({ mode: 'manual', cert: join(box, 'khong-ton-tai.pem') }) === null,
   'thiếu file -> không chặn (để lỗi thật nổi lên ở chỗ khác)');
const junk = join(box, 'junk.pem');
writeFileSync(junk, 'đây không phải certificate');
ok(D.checkCertWindow({ mode: 'manual', cert: junk }) === null, 'file rác -> không chặn');
ok(D.checkCertWindow({ mode: 'manual' }) === null, 'profile không có cert -> không chặn');
ok(D.checkCertWindow(null) === null, 'profile null -> không ném');

console.log('\n--- 7. Đọc log OpenVPN ---');
const cases = [
  ['WARNING: Your certificate has expired!', /Certificate client đã hết hạn/],
  ['AUTH_FAILED', /từ chối xác thực/],
  ['TLS Error: TLS key negotiation failed to occur within 60 seconds', /Không bắt tay được/],
  ['ERROR: Cannot open TUN/TAP dev /dev/net/tun', /TUN/],
  ['RESOLVE: Cannot resolve host address: vpn.example.com', /phân giải/],
  ['Options error: Unrecognized option or missing parameter', /không hợp lệ/],
  ['Enter Private Key Password:', /mật khẩu/],
  ['VERIFY X509NAME ERROR: CN=abc', /X509/],
];
for (const [log, want] of cases) {
  const got = D.diagnoseLogs(log);
  ok(got !== null && want.test(got), `nhận ra: ${log.slice(0, 42)}`, String(got));
}
ok(D.diagnoseLogs('Initialization Sequence Completed') === null,
   'log bình thường -> không bịa nguyên nhân');
ok(D.diagnoseLogs('') === null, 'log rỗng -> null');

console.log('\n--- 8. explainFailure: nguyên nhân lên trước, log giữ nguyên ---');
const withCause = D.explainFailure('quá 45s mà tunnel chưa sẵn sàng',
  'Mon Sep 21 ...\nWARNING: Your certificate has expired!\nMon Sep 21 ...');
ok(withCause.startsWith('Certificate client đã hết hạn'),
   'nguyên nhân nằm ở dòng ĐẦU, không lẫn giữa log', withCause.split('\n')[0]);
ok(withCause.includes('Your certificate has expired'), 'log thô vẫn còn để debug');
ok(withCause.includes('quá 45s'), 'vẫn nói rõ nó chết theo kiểu nào');

const noCause = D.explainFailure('Tunnel chết khi đang kết nối', 'log lạ hoắc');
ok(noCause === 'Tunnel chết khi đang kết nối:\nlog lạ hoắc',
   'không mẫu nào khớp -> giữ nguyên dạng cũ', noCause);

rmSync(box, { recursive: true, force: true });
done();
