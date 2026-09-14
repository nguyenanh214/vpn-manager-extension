// Chuẩn hoá + validate domain do user nhập.
// Chấp nhận cả khi user paste nguyên URL; tự bóc scheme, path, port, "*." đầu.

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Bóc mọi thứ thừa, trả về hostname thuần chữ thường. */
export function normalizeDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.split('/')[0].split('?')[0].split('#')[0]; // path/query/fragment
  s = s.split('@').pop(); // userinfo
  s = s.replace(/:\d+$/, ''); // port
  s = s.replace(/^\*\./, ''); // wildcard: entry apex đã bao subdomain
  s = s.replace(/\.$/, ''); // dấu chấm cuối của FQDN
  return s;
}

export function isIpv4(host) {
  return IPV4_RE.test(host) && host.split('.').every((o) => Number(o) <= 255);
}

/**
 * @returns {{ok: true, domain: string, isIp: boolean} | {ok: false, error: string}}
 */
export function validateDomain(raw, existingDomains = []) {
  const domain = normalizeDomain(raw);

  if (!domain) return { ok: false, error: 'Nhập domain' };
  if (domain.length > 253) return { ok: false, error: 'Domain quá dài' };

  if (isIpv4(domain)) {
    if (existingDomains.includes(domain)) return { ok: false, error: 'Địa chỉ này đã có trong danh sách' };
    return { ok: true, domain, isIp: true };
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
    return { ok: false, error: 'Địa chỉ IP không hợp lệ' };
  }

  const labels = domain.split('.');
  if (labels.length < 2) return { ok: false, error: 'Cần domain đầy đủ, ví dụ example.com' };

  for (const label of labels) {
    if (!label) return { ok: false, error: 'Domain có dấu chấm thừa' };
    if (!LABEL_RE.test(label)) {
      return { ok: false, error: `Phần "${label}" chứa ký tự không hợp lệ` };
    }
  }

  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return { ok: false, error: `Đuôi ".${tld}" không hợp lệ` };

  if (existingDomains.includes(domain)) return { ok: false, error: 'Domain này đã có trong danh sách' };

  return { ok: true, domain, isIp: false };
}
