// Env để spawn native host trong sandbox: HOME/APPDATA trỏ vào thư mục tạm nên test
// không đụng profile thật của người chạy. Host tính stateDir() từ env lúc nạp module
// nên truyền env tạm là đủ tách.
import { dirname, join } from 'path';
import { homedir, userInfo } from 'os';

/**
 * @param {string} sandbox thư mục tạm thay cho HOME/APPDATA
 * @param {{docker?: boolean}} opts docker=true khi test thật sự dựng container
 */
export function sandboxEnv(sandbox, { docker = false } = {}) {
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
    // Chrome trên Windows truyền NGUYÊN PATH của user chứ không cắt bớt, mà
    // docker.exe nằm trong thư mục cài Docker Desktop — cắt PATH là host báo
    // "spawn docker ENOENT". Thư mục node đứng trước vì APPDATA sandbox không có
    // file node-path.
    const tail = docker
      ? [process.env.PATH || '']
      : [join(sysRoot, 'system32'), sysRoot];
    return {
      APPDATA: sandbox, HOME: sandbox, SystemRoot: sysRoot,
      USERNAME: process.env.USERNAME || '',
      USERPROFILE: process.env.USERPROFILE || '',
      PATH: [dirname(process.execPath), ...tail].join(';'),
      ...(docker ? dockerContextEnv() : {}),
    };
  }
  // PATH tối thiểu giống cách Chrome spawn host. Không thêm /usr/local/bin vào đây:
  // trên macOS Chrome thật sự KHÔNG có nó, và host phải tự dò ra docker qua
  // platform.dockerSearchPaths(). Cắt đúng như thật thì test mới bắt được lỗi đó.
  return { HOME: sandbox, PATH: '/usr/bin:/bin', ...(docker ? dockerContextEnv() : {}) };
}

// Chụp lúc nạp module. import được hoist nên dòng này chạy TRƯỚC khi test gán
// process.env.HOME sang sandbox — đây là đường lui khi userInfo() không dùng được.
const HOME_AT_LOAD = homedir();

/**
 * userInfo() đọc từ passwd chứ không đọc $HOME, nên vẫn ra thư mục thật kể cả sau khi
 * test đã trỏ process.env.HOME sang sandbox. Nhưng nó NÉM LỖI khi uid không có entry
 * trong passwd (container CI chạy uid tuỳ ý), nên phải có đường lui.
 */
function realHome() {
  try { return userInfo().homedir; } catch { return HOME_AT_LOAD; }
}

/**
 * Docker Desktop trên macOS không tạo /var/run/docker.sock; endpoint thật nằm ở
 * ~/.docker/run/docker.sock và chọn qua "context" lưu trong $HOME/.docker. Sandbox
 * HOME làm mất context đó, docker CLI quay về socket mặc định rồi báo "daemon
 * không chạy" — lỗi không liên quan gì tới thứ đang test.
 *
 * CHỈ macOS. Linux dùng thẳng /var/run/docker.sock nên sandbox HOME không ảnh hưởng,
 * mà bơm DOCKER_CONFIG về HOME thật ở đó lại kéo theo `credsStore` trỏ tới helper
 * nằm ngoài PATH tối thiểu của con — đổi hành vi ở chỗ trước đó vẫn chạy.
 */
export function dockerContextEnv() {
  if (process.platform !== 'darwin') return {};
  return { DOCKER_CONFIG: join(realHome(), '.docker') };
}
