// Validate một port-forward: cổng cục bộ, host đích trong VPN, cổng đích.
// Dùng cho client không nói được SOCKS5 (Navicat, DBeaver, psql...).

import { SOCKS_PORT_BASE, SOCKS_PORT_MAX, FORWARD_PORT_MIN, FORWARD_PORT_MAX } from './constants.js';

const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function validatePort(raw, label, min, max) {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n)) return `${label} phải là số nguyên`;
  if (n < min || n > max) return `${label} phải trong khoảng ${min}-${max}`;
  return null;
}

/**
 * @param {object} input {label, vpnId, localPort, remoteHost, remotePort}
 * @param {Array} existing các forward đã có, để kiểm trùng cổng
 * @param {string|null} ignoreId bỏ qua chính nó khi đang sửa
 */
export function validateForward(input, existing = [], ignoreId = null) {
  const localErr = validatePort(input.localPort, 'Cổng cục bộ', FORWARD_PORT_MIN, FORWARD_PORT_MAX);
  if (localErr) return { ok: false, field: 'localPort', error: localErr };

  const localPort = Number(input.localPort);
  if (localPort >= SOCKS_PORT_BASE && localPort <= SOCKS_PORT_MAX) {
    return {
      ok: false, field: 'localPort',
      error: `Cổng ${localPort} thuộc dải dành riêng cho SOCKS (${SOCKS_PORT_BASE}-${SOCKS_PORT_MAX})`,
    };
  }
  if (existing.some((f) => f.id !== ignoreId && Number(f.localPort) === localPort)) {
    return { ok: false, field: 'localPort', error: `Cổng ${localPort} đã được forward khác dùng` };
  }

  const remoteHost = String(input.remoteHost || '').trim().toLowerCase();
  if (!remoteHost) return { ok: false, field: 'remoteHost', error: 'Nhập host đích' };
  if (remoteHost.length > 253) return { ok: false, field: 'remoteHost', error: 'Host quá dài' };

  const isIp = IPV4_RE.test(remoteHost);
  if (isIp) {
    if (!remoteHost.split('.').every((o) => Number(o) <= 255)) {
      return { ok: false, field: 'remoteHost', error: 'Địa chỉ IP không hợp lệ' };
    }
  } else if (!HOST_RE.test(remoteHost)) {
    return { ok: false, field: 'remoteHost', error: 'Host chứa ký tự không hợp lệ' };
  }

  const remoteErr = validatePort(input.remotePort, 'Cổng đích', 1, 65535);
  if (remoteErr) return { ok: false, field: 'remotePort', error: remoteErr };

  return {
    ok: true,
    forward: {
      label: String(input.label || '').trim() || `${remoteHost}:${Number(input.remotePort)}`,
      vpnId: input.vpnId || null,
      localPort,
      remoteHost,
      remotePort: Number(input.remotePort),
    },
  };
}
