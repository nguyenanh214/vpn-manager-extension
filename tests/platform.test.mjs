// platform.js: giả lập cả ba OS trên một máy. Không cần Chrome, không cần Docker.
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { counter } from './lib/harness.js';

const require = createRequire(import.meta.url);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const P = require(join(REPO, 'native-host', 'lib', 'platform.js'));

const { ok, done } = counter();

const WIN_ENV = {
  APPDATA: 'C:\\Users\\Andy\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Andy\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
};
const WIN_HOME = 'C:\\Users\\Andy';

console.log('--- osKind ---');
ok(P.osKind('linux') === 'linux', 'linux');
ok(P.osKind('darwin') === 'macos', 'darwin -> macos');
ok(P.osKind('win32') === 'windows', 'win32 -> windows');
ok(P.osKind('freebsd') === 'unknown', 'OS lạ -> unknown');

console.log('\n--- stateDir ---');
ok(P.stateDir('linux', {}, '/home/user') === '/home/user/.config/vpn-manager',
   'Linux dùng ~/.config', P.stateDir('linux', {}, '/home/user'));
ok(P.stateDir('darwin', {}, '/Users/apple') === '/Users/apple/.config/vpn-manager',
   'macOS dùng ~/.config');
const winState = P.stateDir('win32', WIN_ENV, WIN_HOME);
ok(winState === 'C:\\Users\\Andy\\AppData\\Roaming\\vpn-manager',
   'Windows dùng %APPDATA% với dấu backslash', winState);
ok(!winState.includes('/'), 'đường dẫn Windows không lẫn dấu /', winState);

console.log('\n--- thư mục manifest ---');
const linuxChrome = P.nativeHostDirs('linux', '/home/user').find((d) => d.browser === 'chrome');
ok(linuxChrome.dir === '/home/user/.config/google-chrome/NativeMessagingHosts',
   'Linux Chrome', linuxChrome.dir);

const macChrome = P.nativeHostDirs('darwin', '/Users/apple').find((d) => d.browser === 'chrome');
ok(macChrome.dir === '/Users/apple/Library/Application Support/Google/Chrome/NativeMessagingHosts',
   'macOS Chrome (có dấu cách trong đường dẫn)', macChrome.dir);

ok(P.nativeHostDirs('win32', WIN_HOME).length === 0,
   'Windows trả rỗng vì dùng registry');
ok(Object.keys(P.WINDOWS_REGISTRY_KEYS).length === 4,
   'có khoá registry cho 4 trình duyệt');
ok(P.WINDOWS_REGISTRY_KEYS.edge.includes('Microsoft\\Edge'),
   'khoá Edge đúng dạng', P.WINDOWS_REGISTRY_KEYS.edge);

console.log('\n--- nơi dò node ---');
const macNode = P.nodeSearchPaths('darwin', {}, '/Users/apple');
ok(macNode[0] === '/opt/homebrew/bin/node',
   'macOS ưu tiên Homebrew ARM trước /usr/local', macNode[0]);
const winNode = P.nodeSearchPaths('win32', WIN_ENV, WIN_HOME);
ok(winNode[0] === 'C:\\Program Files\\nodejs\\node.exe', 'Windows tìm ProgramFiles trước', winNode[0]);
ok(winNode.some((n) => n.includes('nvm')), 'Windows có dò nvm-windows');

console.log('\n--- launcher và NetworkManager ---');
ok(P.hostLauncher('linux') === 'vpn-manager-host.sh', 'Linux dùng .sh');
ok(P.hostLauncher('darwin') === 'vpn-manager-host.sh', 'macOS dùng .sh');
ok(P.hostLauncher('win32') === 'vpn-manager-host.bat', 'Windows dùng .bat');
ok(P.supportsNetworkManager('linux') === true, 'NetworkManager có trên Linux');
ok(P.supportsNetworkManager('darwin') === false, 'không có trên macOS');
ok(P.supportsNetworkManager('win32') === false, 'không có trên Windows');

console.log('\n--- so sánh đường dẫn ---');
ok(P.pathsEqual('C:\\Users\\A', 'c:\\users\\a', 'win32') === true,
   'Windows không phân biệt hoa thường');
ok(P.pathsEqual('/home/A', '/home/a', 'linux') === false,
   'Linux phân biệt hoa thường');

console.log('\n--- nơi dò docker ---');
const macDocker = P.dockerSearchPaths('darwin', {}, '/Users/apple');
ok(macDocker[0] === '/usr/local/bin/docker',
   'macOS tìm symlink Docker Desktop ở /usr/local/bin trước', macDocker[0]);
ok(macDocker.includes('/Users/apple/.docker/bin/docker'),
   'macOS có dò ~/.docker/bin (bản cài cho riêng user)');
ok(macDocker.some((d) => d.startsWith('/Applications/Docker.app')),
   'macOS có dò thẳng vào trong Docker.app');
const winDocker = P.dockerSearchPaths('win32', WIN_ENV, WIN_HOME);
ok(winDocker.every((d) => d.endsWith('.exe')), 'Windows dò .exe', winDocker[0]);
ok(P.dockerSearchPaths('linux', {}, '/home/user')[0] === '/usr/bin/docker',
   'Linux tìm /usr/bin trước');

console.log('\n--- resolveExecutable ---');
// isExec giả: chỉ những đường dẫn liệt kê ở đây mới coi là chạy được.
const fake = (paths) => (p) => paths.includes(p);

ok(P.resolveExecutable('docker', [], { PATH: '/usr/bin:/bin' }, 'darwin',
     fake(['/bin/docker'])) === '/bin/docker',
   'có trong PATH thì dùng PATH');

// Đúng tình huống macOS thật: PATH của launchd không chứa /usr/local/bin.
const launchdPath = '/usr/bin:/bin:/usr/sbin:/sbin';
ok(P.resolveExecutable('docker', P.dockerSearchPaths('darwin', {}, '/Users/apple'),
     { PATH: launchdPath }, 'darwin', fake(['/usr/local/bin/docker']))
   === '/usr/local/bin/docker',
   'PATH của launchd không có docker -> rơi về /usr/local/bin');

ok(P.resolveExecutable('docker', ['/opt/homebrew/bin/docker'],
     { PATH: launchdPath }, 'darwin', fake([])) === 'docker',
   'không tìm thấy thì trả lại tên trần để ENOENT nổi lên ở chỗ gọi');

ok(P.resolveExecutable('docker.exe', [], { Path: 'C:\\Windows;C:\\tools' }, 'win32',
     fake(['C:\\tools\\docker.exe'])) === 'C:\\tools\\docker.exe',
   'Windows tách PATH bằng dấu ; và đọc được biến Path');

// Production truyền tên TRẦN ('docker'), không phải 'docker.exe' — đây mới là đường
// code thật trên Windows. Quét PATH phải tự thêm đuôi, nếu không thì không entry nào
// khớp và cả PATH bị bỏ qua.
ok(P.resolveExecutable('docker', [], { Path: 'C:\\tools' }, 'win32',
     fake(['C:\\tools\\docker.exe'])) === 'C:\\tools\\docker.exe',
   'Windows tự thêm .exe cho tên trần');

// File `docker` không đuôi trong PATH là shim sh của Git-Bash/MSYS/WSL. Exec thẳng nó
// là chạy một file không phải PE; PATHEXT cũng không bao giờ khớp tên trần.
ok(P.resolveExecutable('docker', ['C:\\DD\\docker.exe'], { Path: 'C:\\msys' }, 'win32',
     fake(['C:\\msys\\docker', 'C:\\DD\\docker.exe'])) === 'C:\\DD\\docker.exe',
   'Windows bỏ qua shim không đuôi, rơi về Docker Desktop');

console.log('\n--- canExec: thư mục KHÔNG phải executable ---');
// accessSync(X_OK) trả true cho cả thư mục, nên một thư mục tên `docker` trong PATH
// từng thắng cả binary thật rồi execFile ném EACCES. Dùng canExec THẬT, không giả lập.
{
  const { mkdtempSync, mkdirSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const box = mkdtempSync(join(tmpdir(), 'vpnmgr-canexec-'));
  mkdirSync(join(box, 'docker'));
  ok(P.resolveExecutable('docker', ['/usr/bin/env'], { PATH: box }, 'linux') === '/usr/bin/env',
     'thư mục tên docker trong PATH bị bỏ qua',
     P.resolveExecutable('docker', ['/usr/bin/env'], { PATH: box }, 'linux'));
  rmSync(box, { recursive: true, force: true });
}

done();
