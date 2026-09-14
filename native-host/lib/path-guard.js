'use strict';
// Native host chạy full quyền user, không sandbox.
// Mọi path nhận từ extension phải được kiểm tra trước khi bind-mount vào container.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

/**
 * Path cert hợp lệ: tuyệt đối, là file thường, đọc được, nằm trong HOME.
 * Resolve symlink trước khi kiểm tra để chặn traversal qua link.
 * @returns {string} path đã chuẩn hoá
 */
function assertSafeCertPath(p, label) {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error(`${label}: thiếu đường dẫn`);
  }
  if (!path.isAbsolute(p)) {
    throw new Error(`${label}: phải là đường dẫn tuyệt đối`);
  }

  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    throw new Error(`${label}: không tồn tại (${p})`);
  }

  const rel = path.relative(HOME, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${label}: phải nằm trong thư mục home (${real})`);
  }

  const st = fs.statSync(real);
  if (!st.isFile()) {
    throw new Error(`${label}: không phải file thường`);
  }

  try {
    fs.accessSync(real, fs.constants.R_OK);
  } catch {
    throw new Error(`${label}: không có quyền đọc`);
  }

  return real;
}

/** Kiểm tra file tồn tại + đọc được, không ném lỗi. Dùng cho UI. */
function describePath(p) {
  try {
    const real = assertSafeCertPath(p, 'path');
    const st = fs.statSync(real);
    return { ok: true, path: real, size: st.size, mode: (st.mode & 0o777).toString(8) };
  } catch (err) {
    return { ok: false, path: p, error: err.message };
  }
}

/** ID profile chỉ chứa ký tự an toàn cho tên container Docker. */
function assertSafeProfileId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
    throw new Error(`Profile id không hợp lệ: ${id}`);
  }
  return id;
}

/** Gateway dạng host[:port], chỉ cho ký tự hostname/IP hợp lệ. */
function assertSafeGateway(gw) {
  if (typeof gw !== 'string' || !/^[A-Za-z0-9._-]{1,253}(:\d{1,5})?$/.test(gw)) {
    throw new Error(`Gateway không hợp lệ: ${gw}`);
  }
  const port = gw.includes(':') ? Number(gw.split(':')[1]) : 1194;
  if (port < 1 || port > 65535) throw new Error(`Cổng không hợp lệ: ${port}`);
  return gw;
}

/** Cổng SOCKS5 phải nằm trong dải extension được cấp. */
function assertSafeSocksPort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1080 || n > 1179) {
    throw new Error(`Cổng SOCKS không hợp lệ: ${port} (cho phép 1080-1179)`);
  }
  return n;
}

/** Cổng forward cục bộ: tránh đụng dải SOCKS và các cổng đặc quyền. */
function assertSafeForwardPort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error(`Cổng forward không hợp lệ: ${port} (cho phép 1024-65535)`);
  }
  if (n >= 1080 && n <= 1179) {
    throw new Error(`Cổng ${n} thuộc dải dành riêng cho SOCKS (1080-1179)`);
  }
  return n;
}

/** Host đích bên trong VPN: hostname hoặc IPv4. */
function assertSafeRemoteHost(host) {
  if (typeof host !== 'string' || !/^[A-Za-z0-9._-]{1,253}$/.test(host)) {
    throw new Error(`Host đích không hợp lệ: ${host}`);
  }
  return host;
}

function assertSafeRemotePort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Cổng đích không hợp lệ: ${port}`);
  }
  return n;
}

module.exports = {
  assertSafeForwardPort,
  assertSafeRemoteHost,
  assertSafeRemotePort,
  assertSafeCertPath,
  describePath,
  assertSafeProfileId,
  assertSafeGateway,
  assertSafeSocksPort,
  HOME,
};
