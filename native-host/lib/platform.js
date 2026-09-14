'use strict';
// Mọi khác biệt giữa Linux, macOS và Windows gom về đây.
// Chỗ khác trong code không được tự suy diễn đường dẫn theo OS.
//
// Các hàm nhận tham số `plat`/`env`/`home` để test giả lập được cả ba OS trên
// một máy, thay vì phải có đủ ba máy mới kiểm được.

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

module.exports = {
  osKind, stateDir, pathFor, nativeHostDirs, nodeSearchPaths,
  hostLauncher, supportsNetworkManager, pathsEqual,
  WINDOWS_REGISTRY_KEYS, BROWSER_ROOTS,
};
