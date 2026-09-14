// Cầu nối tới native host. Extension không tự chạy được VPN,
// mọi thao tác với docker/openvpn đều đi qua đây.

import { NATIVE_HOST_NAME } from '../lib/constants.js';

const REQUEST_TIMEOUT_MS = 70000; // start-tunnel có thể mất tới 45s

let port = null;
let nextId = 1;
const pending = new Map();

function rejectAll(reason) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  pending.clear();
}

function connect() {
  if (port) return port;

  port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

  port.onMessage.addListener((msg) => {
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.data);
    else entry.reject(new Error(msg.error || 'Native host trả lỗi không rõ'));
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    port = null;
    rejectAll(
      err?.message
        ? `Mất kết nối native host: ${err.message}`
        : 'Native host ngắt kết nối'
    );
  });

  return port;
}

/**
 * Gửi một request và chờ phản hồi.
 * Port tự kết nối lại ở lần gửi kế tiếp nếu service worker đã bị Chrome kill.
 */
export function send(action, payload = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = connect();
    } catch (err) {
      return reject(new Error(`Không gọi được native host: ${err.message}`));
    }

    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Quá thời gian chờ native host (${action})`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });

    try {
      p.postMessage({ id, action, payload });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      port = null;
      reject(new Error(`Gửi lệnh thất bại: ${err.message}`));
    }
  });
}

export function disconnect() {
  if (port) {
    port.disconnect();
    port = null;
  }
  rejectAll('Đã ngắt kết nối chủ động');
}

export function isConnected() {
  return port !== null;
}
