'use strict';
// Đọc file .ovpn để lấy thông tin hiển thị và chặn sớm những file chưa hỗ trợ.
//
// Chủ ý KHÔNG parse rồi dựng lại config. File .ovpn có thể chứa directive lạ
// (mẫu thật có `ignore-unknown-option block-outside-dns`) và parse lại sẽ làm mất
// thông tin. Container dùng thẳng file gốc; parser ở đây chỉ để:
//   1. lấy remote/proto cho UI và cho quyết định thêm explicit-exit-notify
//   2. từ chối file cần thứ chưa hỗ trợ, ngay lúc import thay vì lúc kết nối

// Các khối inline có thể nhúng trong .ovpn
const INLINE_TAGS = ['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'pkcs12'];

// Directive tham chiếu file bên ngoài. Nếu có mà không có khối inline tương ứng
// thì file không tự chứa, import về cũng không kết nối được.
const FILE_DIRECTIVES = ['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'pkcs12'];

const MAX_BYTES = 512 * 1024;

/** Bỏ nội dung các khối inline, chỉ giữ directive để phân tích. */
function directiveLines(text) {
  const lines = [];
  let insideTag = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const open = line.match(/^<([a-z0-9-]+)>$/i);
    const close = line.match(/^<\/([a-z0-9-]+)>$/i);

    if (insideTag) {
      if (close && close[1].toLowerCase() === insideTag) insideTag = null;
      continue;
    }
    if (open) { insideTag = open[1].toLowerCase(); continue; }
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    lines.push(line);
  }
  return lines;
}

function inlineTags(text) {
  const found = new Set();
  for (const tag of INLINE_TAGS) {
    if (new RegExp(`^<${tag}>\\s*$`, 'im').test(text)) found.add(tag);
  }
  return found;
}

/**
 * @returns {{ok: true, info: object} | {ok: false, errors: string[]}}
 */
function parseOvpn(text) {
  const errors = [];

  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, errors: ['File rỗng'] };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { ok: false, errors: [`File lớn hơn ${MAX_BYTES / 1024}KB, nhiều khả năng không phải .ovpn`] };
  }

  const lines = directiveLines(text);
  const inline = inlineTags(text);

  // remote có hai dạng: "remote host port" và "remote host port proto"
  let remoteHost = '';
  let remotePort = 1194;
  let remoteProto = '';
  let proto = '';

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const key = parts[0].toLowerCase();

    if (key === 'remote' && !remoteHost) {
      remoteHost = parts[1] || '';
      if (parts[2]) remotePort = Number(parts[2]) || 1194;
      if (parts[3]) remoteProto = parts[3].toLowerCase();
    } else if (key === 'proto') {
      proto = (parts[1] || '').toLowerCase();
    } else if (key === 'auth-user-pass') {
      // Không có file credential đi kèm thì OpenVPN sẽ hỏi tương tác -> treo trong container
      errors.push('Cần username/password (`auth-user-pass`) — hiện chỉ hỗ trợ xác thực bằng certificate');
    } else if (key === 'askpass') {
      errors.push('Cần nhập passphrase tương tác (`askpass`) — chưa hỗ trợ');
    } else if (FILE_DIRECTIVES.includes(key) && parts.length > 1 && !inline.has(key)) {
      errors.push(`Trỏ tới file bên ngoài: \`${key} ${parts[1]}\` — cần file .ovpn tự chứa (có khối <${key}>)`);
    }
  }

  // Khối <key> không mã hoá thì OpenVPN không hỏi gì; có mã hoá thì sẽ hỏi passphrase.
  if (/^-----BEGIN ENCRYPTED PRIVATE KEY-----/m.test(text)) {
    errors.push('Private key được mã hoá bằng passphrase — chưa hỗ trợ');
  }

  if (!remoteHost) errors.push('Không tìm thấy dòng `remote` — không biết kết nối tới đâu');
  if (!inline.has('ca') && !inline.has('pkcs12')) {
    errors.push('Thiếu khối <ca> — file không tự chứa certificate');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    info: {
      remoteHost,
      remotePort,
      // proto trên dòng remote được ưu tiên hơn directive proto rời
      proto: remoteProto || proto || 'udp',
      gateway: `${remoteHost}:${remotePort}`,
      inline: [...inline],
      remoteIsHostname: !/^\d{1,3}(\.\d{1,3}){3}$/.test(remoteHost),
    },
  };
}

module.exports = { parseOvpn, directiveLines, MAX_BYTES };
