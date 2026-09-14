'use strict';
// Kiểm tra tunnel có THẬT SỰ truyền được gói tin, và device tun có mượn được không.
// Tách khỏi docker-driver: driver lo vòng đời container, module này lo chẩn đoán.

const spec = require('./container-spec');

const { IMAGE, containerName } = spec;

/**
 * Container chạy KHÔNG có nghĩa tunnel còn truyền được gói tin. Khi client bị server
 * đá (trùng cert chẳng hạn), tun0 vẫn up và route vẫn đúng nhưng mọi thứ im lặng cho
 * tới khi ping-restart kích hoạt. Phải thử thật mới biết.
 *
 * Hai phép thử: ping gateway tunnel (nhanh), và TCP tới 1.1.1.1:53 (không phụ thuộc
 * ICMP, phòng khi server chặn ping). Chỉ báo hỏng khi CẢ HAI đều thất bại.
 */
function createHealth({ docker, isRunning }) {

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

/**
 * Container có thật sự tạo được interface tun không.
 *
 * `ls /dev/net/tun` chỉ chứng minh node thiết bị nhìn thấy được — đó là dương tính
 * giả. Thứ OpenVPN cần là `ip tuntap add` chạy được với NET_ADMIN.
 */
async function tunProbe() {
  try {
    const { stdout } = await docker([
      'run', '--rm', '--cap-add=NET_ADMIN', '--device', '/dev/net/tun',
      '--entrypoint', 'sh', IMAGE, '-c',
      'ip tuntap add dev tunprobe mode tun && ip link del tunprobe && echo TUN_OK',
    ], { timeoutMs: 45000 });
    if (stdout.includes('TUN_OK')) return { ok: true };
    return { ok: false, reason: stdout.trim() || 'không rõ' };
  } catch (err) {
    return { ok: false, reason: (err.stderr || err.message).trim().split('\n')[0] };
  }
}


return { health, tunProbe };
}

module.exports = { createHealth };
