'use strict';
// Lưu file .ovpn do user import.
//
// File .ovpn tự chứa có private key inline — nó là secret hoàn chỉnh, tương đương
// file key rời. Ba ràng buộc:
//   1. Chỉ native host ghi, extension không bao giờ lưu nội dung vào chrome.storage
//   2. Quyền 0600 trong thư mục 0700
//   3. Xoá profile phải xoá file, không để lại secret mồ côi

const fs = require('fs');
const path = require('path');
const platform = require('./platform');

const STATE_DIR = platform.stateDir();
const PROFILE_DIR = path.join(STATE_DIR, 'profiles');

/**
 * Giới hạn quyền đọc file về đúng chủ sở hữu.
 *
 * Trên Windows `chmod` không có tác dụng thật: file kế thừa ACL của thư mục cha,
 * nghĩa là mặc định user khác trên máy vẫn đọc được. File .ovpn có private key
 * inline nên bước này là bắt buộc, không phải tuỳ chọn.
 */
function restrictToOwner(target) {
  if (platform.osKind() !== 'windows') {
    try { fs.chmodSync(target, 0o600); } catch { /* hệ thống file không hỗ trợ */ }
    return;
  }
  try {
    const user = process.env.USERNAME || process.env.USER;
    if (!user) return;
    require('child_process').execFileSync(
      'icacls', [target, '/inheritance:r', '/grant:r', `${user}:(R,W)`],
      { stdio: 'ignore', timeout: 10000 });
  } catch { /* không đặt được ACL thì để cảnh báo ở check-prereqs */ }
}

function ensureDir() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  // mkdir bỏ qua mode nếu thư mục đã tồn tại -> ép lại cho chắc
  try { fs.chmodSync(PROFILE_DIR, 0o700); } catch { /* không phải POSIX */ }
}

/** Id chỉ chứa ký tự an toàn cho tên file, tránh thoát khỏi PROFILE_DIR. */
function assertSafeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`Id profile không hợp lệ: ${id}`);
  }
  return id;
}

const configPath = (id) => path.join(PROFILE_DIR, `${assertSafeId(id)}.ovpn`);

/**
 * Ghi nội dung .ovpn ra đĩa với quyền 0600.
 * @returns {string} đường dẫn file đã ghi
 */
function save(id, content) {
  ensureDir();
  const target = configPath(id);
  // mode trong writeFileSync chỉ áp dụng khi file được TẠO MỚI; ghi đè file cũ
  // vẫn giữ quyền cũ, nên phải chmod lại.
  fs.writeFileSync(target, content, { mode: 0o600 });
  restrictToOwner(target);
  return target;
}

function remove(id) {
  try {
    fs.unlinkSync(configPath(id));
    return { removed: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: false };
    throw err;
  }
}

function read(id) {
  return fs.readFileSync(configPath(id), 'utf8');
}

function exists(id) {
  return fs.existsSync(configPath(id));
}

/**
 * Xoá mọi config không còn profile nào trỏ tới.
 *
 * Mồ côi sinh ra khi save() ghi file xong mà extension chưa kịp lưu profile —
 * service worker MV3 bị Chrome kill bất cứ lúc nào — hoặc khi storage của extension
 * bị xoá. Không ai dọn thì private key nằm lại trên đĩa vĩnh viễn, mà UI không còn
 * chỗ nào trỏ tới để user xoá.
 *
 * Chỉ extension biết id nào còn sống, host chỉ thấy file. Nên danh sách giữ lại phải
 * do bên gọi đưa vào, và phải là mảng thật: thiếu nó mà mặc định thành rỗng là xoá
 * sạch config của user.
 */
function pruneExcept(keepIds) {
  if (!Array.isArray(keepIds)) throw new Error('pruneExcept: keepIds phải là mảng');
  const keep = new Set(keepIds);
  const removed = [];
  for (const id of list()) {
    if (keep.has(id)) continue;
    // configPath tự kiểm id nên tên file rác trên đĩa bị bỏ qua thay vì xoá nhầm
    try {
      fs.unlinkSync(configPath(id));
      removed.push(id);
    } catch { /* đã bị xoá, hoặc tên file không phải id hợp lệ */ }
  }
  return { removed };
}

/** Id của mọi config đang lưu — dùng để dọn file mồ côi. */
function list() {
  try {
    return fs.readdirSync(PROFILE_DIR)
      .filter((f) => f.endsWith('.ovpn'))
      .map((f) => f.slice(0, -'.ovpn'.length));
  } catch {
    return [];
  }
}

module.exports = {
  save, remove, read, exists, list, pruneExcept, configPath, PROFILE_DIR,
};
