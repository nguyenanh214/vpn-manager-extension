'use strict';
// Quản lý container OpenVPN+SOCKS5. Dùng execFile (KHÔNG qua shell) để tránh injection.

const { execFile } = require('child_process');
const spec = require('./container-spec');

const { IMAGE, NAME_PREFIX, containerName, signatureOf, buildCreateArgs } = spec;

const READY_MARKER = 'VPNMGR_READY';
const READY_TIMEOUT_MS = 45000;
const POLL_INTERVAL_MS = 500;

function docker(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          return reject(err);
        }
        resolve({ stdout, stderr });
      });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Signature đang gắn trên container đang chạy; null nếu không có container. */
async function runningSignature(profileId) {
  try {
    const { stdout } = await docker(['inspect', '-f',
      '{{ index .Config.Labels "vpnmgr.signature" }}', containerName(profileId)]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function isRunning(profileId) {
  const name = containerName(profileId);
  const { stdout } = await docker(['ps', '-q', '--filter', `name=^${name}$`]);
  return stdout.trim().length > 0;
}

async function getLogs(profileId, tail = 50) {
  try {
    const name = containerName(profileId);
    const { stdout, stderr } = await docker(['logs', '--tail', String(tail), name]);
    return (stdout + stderr).trim();
  } catch (err) {
    return (err.stdout || '') + (err.stderr || err.message);
  }
}

/** Start tunnel, chờ tới khi container in VPNMGR_READY. Idempotent. */
async function start(profile) {
  if (await isRunning(profile.id)) {
    if ((await runningSignature(profile.id)) === signatureOf(profile)) {
      return { started: false, alreadyRunning: true, port: profile.socksPort };
    }
    // Cấu hình đã đổi (thêm/sửa forward, đổi cert...) -> container cũ không còn đúng
    await stop(profile.id);
  }

  const { args, name, port, copies } = buildCreateArgs(profile);
  await docker(['rm', '-f', name]).catch(() => {}); // dọn container chết còn sót

  // create -> cp -> start. Container tạo xong mới sao file vào, rồi mới chạy, nên
  // entrypoint chắc chắn thấy đủ cert. Nếu hỏng giữa chừng phải xoá container dở dang,
  // không thì nó giữ cổng và lần start sau báo "port is already allocated".
  try {
    await docker(args, { timeoutMs: 60000 });
  } catch (err) {
    throw new Error(`Không tạo được container: ${(err.stderr || err.message).trim()}`);
  }

  try {
    for (const { src, dest } of copies) {
      await docker(['cp', src, `${name}:${dest}`], { timeoutMs: 20000 });
    }
    await docker(['start', name], { timeoutMs: 30000 });
  } catch (err) {
    await docker(['rm', '-f', name]).catch(() => {});
    throw new Error(`Không khởi động được container: ${(err.stderr || err.message).trim()}`);
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const logs = await getLogs(profile.id, 200);
    if (logs.includes(READY_MARKER)) return { started: true, port };

    if (!(await isRunning(profile.id))) {
      const why = await getLogs(profile.id, 30);
      await docker(['rm', '-f', name]).catch(() => {});
      throw new Error(`Tunnel chết khi đang kết nối:\n${why}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const why = await getLogs(profile.id, 30);
  await stop(profile.id).catch(() => {});
  throw new Error(`Quá ${READY_TIMEOUT_MS / 1000}s mà tunnel chưa sẵn sàng:\n${why}`);
}

/**
 * Dừng mềm trước khi xoá: SIGTERM cho entrypoint chạy trap, OpenVPN gửi
 * explicit-exit-notify và server giải phóng session ngay. `rm -f` thẳng sẽ SIGKILL,
 * server giữ session cũ tới 120s và đụng với container vừa dựng lại.
 */
async function stop(profileId) {
  const name = containerName(profileId);
  await docker(['stop', '-t', '5', name], { timeoutMs: 20000 }).catch(() => {});
  await docker(['rm', '-f', name], { timeoutMs: 20000 }).catch(() => {});
  return { stopped: true };
}

/** Dọn toàn bộ container do extension quản lý. Dùng lúc shutdown. */
async function stopAll() {
  const { stdout } = await docker(['ps', '-aq', '--filter', `name=^${NAME_PREFIX}`]);
  const ids = stdout.trim().split('\n').filter(Boolean);
  if (ids.length === 0) return { stopped: 0 };
  await docker(['rm', '-f', ...ids], { timeoutMs: 30000 }).catch(() => {});
  return { stopped: ids.length };
}

/** Tên các container do extension quản lý đang chạy. */
async function listRunning() {
  const { stdout } = await docker(['ps', '--filter', `name=^${NAME_PREFIX}`, '--format', '{{.Names}}']);
  return stdout.trim().split('\n').filter(Boolean).map((n) => n.slice(NAME_PREFIX.length));
}

/**
 * Container chạy KHÔNG có nghĩa tunnel còn truyền được gói tin. Khi client bị server
 * đá (trùng cert chẳng hạn), tun0 vẫn up và route vẫn đúng nhưng mọi thứ im lặng cho
 * tới khi ping-restart kích hoạt. Phải thử thật mới biết.
 *
 * Hai phép thử: ping gateway tunnel (nhanh), và TCP tới 1.1.1.1:53 (không phụ thuộc
 * ICMP, phòng khi server chặn ping). Chỉ báo hỏng khi CẢ HAI đều thất bại.
 */
async function health(profileId) {
  if (!(await isRunning(profileId))) {
    return { healthy: false, reason: 'Tunnel không chạy' };
  }
  const name = containerName(profileId);

  // tun0 mất (OpenVPN đang restart) thì default route rơi về eth0 và phép thử TCP
  // bên dưới sẽ đi ra MẠNG THƯỜNG rồi báo "khoẻ" sai. Phải chặn trước.
  try {
    await docker(['exec', name, 'ip', 'link', 'show', 'tun0'], { timeoutMs: 8000 });
  } catch {
    return { healthy: false, reason: 'Giao diện tun0 không tồn tại — tunnel đang kết nối lại' };
  }

  let gateway = '';
  try {
    const { stdout } = await docker(
      ['exec', name, 'sh', '-c', "ip route | awk '/^0.0.0.0\\/1/ {print $3}'"],
      { timeoutMs: 8000 });
    gateway = stdout.trim();
  } catch { /* không lấy được route thì bỏ qua phép ping */ }

  if (gateway) {
    try {
      await docker(['exec', name, 'timeout', '5', 'ping', '-c', '1', '-W', '3', gateway],
        { timeoutMs: 9000 });
      return { healthy: true, via: 'ping', gateway };
    } catch { /* thử tiếp bằng TCP */ }
  }

  try {
    await docker(
      ['exec', name, 'sh', '-c', 'timeout 6 socat -T3 - TCP:1.1.1.1:53 < /dev/null > /dev/null'],
      { timeoutMs: 10000 });
    return { healthy: true, via: 'tcp', gateway };
  } catch { /* cả hai đều hỏng */ }

  return {
    healthy: false,
    gateway,
    reason: 'Tunnel không truyền được gói tin — thường do một client khác dùng cùng certificate đá mất phiên',
  };
}

async function imageExists() {
  const { stdout } = await docker(['images', '-q', IMAGE]);
  return stdout.trim().length > 0;
}

module.exports = {
  start, stop, stopAll, isRunning, listRunning, getLogs, imageExists, health,
  runningSignature, signatureOf, buildCreateArgs, IMAGE, NAME_PREFIX,
};
