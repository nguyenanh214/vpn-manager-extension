'use strict';
// MV3 service worker bị Chrome kill khi idle -> native port đứt dù Chrome vẫn mở.
// Không thể phân biệt "SW restart" với "Chrome đóng hẳn" chỉ bằng stdin EOF.
//
// Giải pháp: mỗi host đăng ký pid của mình vào ~/.config/vpn-manager/hosts/.
// Khi stdin EOF -> đợi grace -> gỡ đăng ký -> nếu KHÔNG còn host nào khác còn sống
// thì mới dọn tunnel.
//   - SW restart: host mới đã đăng ký trong lúc chờ -> còn host sống -> giữ tunnel.
//   - Chrome đóng hẳn: không còn host nào -> dọn tunnel.
//   - Nhiều trình duyệt/profile cùng chạy: chỉ host cuối cùng thoát mới dọn,
//     nên đóng một cái không giết tunnel của cái còn lại.

const fs = require('fs');
const path = require('path');
const platform = require('./platform');

const STATE_DIR = platform.stateDir();
const HOSTS_DIR = path.join(STATE_DIR, 'hosts');
const GRACE_MS = 15000;

const selfFile = () => path.join(HOSTS_DIR, String(process.pid));

function ensureDirs() {
  fs.mkdirSync(HOSTS_DIR, { recursive: true, mode: 0o700 });
}

/** Đăng ký process hiện tại là một host đang sống. */
function claim() {
  ensureDirs();
  fs.writeFileSync(selfFile(), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
}

function release() {
  try { fs.unlinkSync(selfFile()); } catch { /* đã bị gỡ */ }
}

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/**
 * Các host khác còn sống. Đồng thời dọn luôn entry của process đã chết
 * (host bị SIGKILL không kịp tự gỡ đăng ký).
 */
function liveOtherHosts() {
  let entries;
  try { entries = fs.readdirSync(HOSTS_DIR); } catch { return []; }

  const alive = [];
  for (const name of entries) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    if (isAlive(pid)) alive.push(pid);
    else { try { fs.unlinkSync(path.join(HOSTS_DIR, name)); } catch { /* race */ } }
  }
  return alive;
}

/**
 * Gọi khi stdin EOF hoặc nhận tín hiệu dừng.
 * @param {() => Promise<void>} onRealShutdown chỉ chạy khi không còn host nào khác
 * @param {number} delayMs 0 = quyết định ngay (dùng cho SIGTERM)
 */
function scheduleShutdown(onRealShutdown, delayMs = GRACE_MS) {
  // Timer này KHÔNG unref: nó chính là thứ giữ process sống qua grace period
  // sau khi stdin đã đóng và event loop không còn việc gì khác.
  setTimeout(async () => {
    release();
    const others = liveOtherHosts();
    if (others.length > 0) process.exit(0); // trình duyệt/SW khác vẫn đang quản lý tunnel

    try {
      await onRealShutdown();
    } finally {
      process.exit(0);
    }
  }, delayMs);
}

module.exports = { claim, release, liveOtherHosts, scheduleShutdown, HOSTS_DIR, STATE_DIR, GRACE_MS };
