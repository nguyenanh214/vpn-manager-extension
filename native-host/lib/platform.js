'use strict';
// Mọi khác biệt giữa Linux, macOS và Windows gom về đây.
// Chỗ khác trong code không được tự suy diễn đường dẫn theo OS.
//
// Các hàm nhận tham số `plat`/`env`/`home` để test giả lập được cả ba OS trên
// một máy, thay vì phải có đủ ba máy mới kiểm được.

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Chọn đúng bộ hàm path theo OS đích. Trên Windows thật `path` === `path.win32`,
 * nhưng khi giả lập Windows từ Linux để test thì phải chỉ định rõ, không thì
 * `path.join` sinh ra dấu `/` và test không phản ánh đúng thực tế.
 */
const pathFor = (plat) => (osKind(plat) === 'windows' ? path.win32 : path.posix);

/** @returns {'linux'|'macos'|'windows'|'unknown'} */
function osKind(plat = process.platform) {
  if (plat === 'linux') return 'linux';
  if (plat === 'darwin') return 'macos';
  if (plat === 'win32') return 'windows';
  return 'unknown';
}

/**
 * Thư mục lưu state: lock file của host, file .ovpn user import.
 * Windows dùng %APPDATA% chứ không phải ~/.config.
 */
function stateDir(plat = process.platform, env = process.env, home = os.homedir()) {
  const P = pathFor(plat);
  if (osKind(plat) === 'windows') {
    return P.join(env.APPDATA || P.join(home, 'AppData', 'Roaming'), 'vpn-manager');
  }
  return P.join(home, '.config', 'vpn-manager');
}

// Thư mục gốc chứa cấu hình trình duyệt, theo từng OS.
const BROWSER_ROOTS = {
  linux: {
    chrome: ['.config', 'google-chrome'],
    chromium: ['.config', 'chromium'],
    brave: ['.config', 'BraveSoftware', 'Brave-Browser'],
    edge: ['.config', 'microsoft-edge'],
  },
  macos: {
    chrome: ['Library', 'Application Support', 'Google', 'Chrome'],
    chromium: ['Library', 'Application Support', 'Chromium'],
    brave: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'],
    edge: ['Library', 'Application Support', 'Microsoft Edge'],
  },
};

/**
 * Thư mục thả manifest native messaging, theo từng trình duyệt.
 * Windows trả về rỗng: ở đó đăng ký bằng REGISTRY chứ không phải file trong thư mục.
 */
function nativeHostDirs(plat = process.platform, home = os.homedir()) {
  const kind = osKind(plat);
  const roots = BROWSER_ROOTS[kind];
  if (!roots) return [];
  const P = pathFor(plat);
  return Object.entries(roots).map(([browser, parts]) => ({
    browser,
    root: P.join(home, ...parts),
    dir: P.join(home, ...parts, 'NativeMessagingHosts'),
  }));
}

/** Khoá registry cho Windows. Giá trị mặc định là đường dẫn tới file manifest. */
const WINDOWS_REGISTRY_KEYS = {
  chrome: 'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts',
  chromium: 'HKCU:\\Software\\Chromium\\NativeMessagingHosts',
  brave: 'HKCU:\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
  edge: 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
};

/**
 * Nơi tìm node khi PATH không có (Chrome spawn native host với PATH tối thiểu).
 * Trên macOS ARM, Homebrew nằm ở /opt/homebrew nên phải đứng trước /usr/local.
 */
function nodeSearchPaths(plat = process.platform, env = process.env, home = os.homedir()) {
  switch (osKind(plat)) {
    case 'macos':
      return ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
    case 'windows': {
      const P = path.win32;
      return [
        P.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
        P.join(env.LOCALAPPDATA || P.join(home, 'AppData', 'Local'),
          'Programs', 'nodejs', 'node.exe'),
        P.join(env.APPDATA || P.join(home, 'AppData', 'Roaming'), 'nvm'),
      ];
    }
    default:
      return ['/usr/local/bin/node', '/usr/bin/node', '/snap/bin/node'];
  }
}

/** Tên file wrapper mà Chrome sẽ thực thi. Windows không chạy được .sh. */
function hostLauncher(plat = process.platform) {
  return osKind(plat) === 'windows' ? 'vpn-manager-host.bat' : 'vpn-manager-host.sh';
}

/** NetworkManager chỉ có trên Linux. */
function supportsNetworkManager(plat = process.platform) {
  return osKind(plat) === 'linux';
}

/**
 * Windows không phân biệt hoa thường trong đường dẫn; Linux và macOS thì có
 * (macOS mặc định không phân biệt nhưng có thể format phân biệt, nên coi như có).
 */
function pathsEqual(a, b, plat = process.platform) {
  if (osKind(plat) === 'windows') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/**
 * Nơi tìm docker khi PATH không có nó.
 *
 * macOS là chỗ đau: launchd cấp cho app GUI đúng PATH=/usr/bin:/bin:/usr/sbin:/sbin,
 * mà Docker Desktop lại đặt symlink ở /usr/local/bin. Chrome spawn host xong là
 * `spawn docker ENOENT` — triệu chứng trông y hệt "Docker chưa chạy".
 */
function dockerSearchPaths(plat = process.platform, env = process.env, home = os.homedir()) {
  switch (osKind(plat)) {
    case 'macos':
      return [
        '/usr/local/bin/docker',
        '/opt/homebrew/bin/docker',
        path.posix.join(home, '.docker', 'bin', 'docker'),
        '/Applications/Docker.app/Contents/Resources/bin/docker',
      ];
    case 'windows': {
      const P = path.win32;
      return [
        P.join(env.ProgramFiles || 'C:\\Program Files',
          'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
        P.join(env.LOCALAPPDATA || P.join(home, 'AppData', 'Local'),
          'Docker', 'bin', 'docker.exe'),
      ];
    }
    default:
      return ['/usr/bin/docker', '/usr/local/bin/docker', '/snap/bin/docker'];
  }
}

const canExec = (p) => {
  try {
    // isFile() là bắt buộc: accessSync(X_OK) trả true cho cả THƯ MỤC, nên một thư mục
    // tên `docker` nằm trong PATH sẽ thắng binary thật rồi execFile ném EACCES.
    // Windows còn dễ dính hơn — Node bỏ qua X_OK ở đó nên nó chỉ còn là F_OK.
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
};

/**
 * Đường dẫn thực thi của `name`: ưu tiên PATH hiện có, sau đó các vị trí cài đặt
 * quen thuộc. Không tìm thấy thì trả lại `name` nguyên vẹn để lỗi ENOENT nổi lên ở
 * đúng chỗ gọi execFile kèm ngữ cảnh, thay vì thành lỗi mơ hồ ở đây.
 *
 * `isExec` tách ra được để test giả lập cả ba OS mà không cần file thật.
 */
function resolveExecutable(name, candidates = [], env = process.env,
  plat = process.platform, isExec = canExec) {
  const P = pathFor(plat);
  const isWin = osKind(plat) === 'windows';
  // Windows: quét PATH phải tự thêm đuôi, vì libuv mới là bên gắn PATHEXT khi ta đưa
  // cho nó tên trần. Thiếu bước này thì `docker` không khớp entry nào và ta bỏ qua
  // PATH hoàn toàn. Chỉ nhận các đuôi của PATHEXT, KHÔNG nhận tên trần: file `docker`
  // không đuôi trong PATH là shim sh của Git-Bash/MSYS/WSL, exec thẳng nó là chạy
  // một file không phải PE. PATHEXT cũng không bao giờ khớp tên trần.
  const leaves = isWin && !/\.[a-z0-9]+$/i.test(name)
    ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`]
    : [name];
  for (const dir of (env.PATH || env.Path || '').split(isWin ? ';' : ':')) {
    if (!dir) continue;
    for (const leaf of leaves) {
      if (isExec(P.join(dir, leaf))) return P.join(dir, leaf);
    }
  }
  for (const candidate of candidates) {
    if (isExec(candidate)) return candidate;
  }
  return name;
}

module.exports = {
  osKind, stateDir, pathFor, nativeHostDirs, nodeSearchPaths,
  dockerSearchPaths, resolveExecutable,
  hostLauncher, supportsNetworkManager, pathsEqual,
  WINDOWS_REGISTRY_KEYS, BROWSER_ROOTS,
};
