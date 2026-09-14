'use strict';
// Kiểm tra máy có đủ điều kiện chạy không, và báo lỗi theo đúng từng OS.

const { promisify } = require('util');
const { execFile } = require('child_process');
const dockerDriver = require('./docker-driver');
const platform = require('./platform');

const run = promisify(execFile);

async function checkPrereqs() {

  const result = {
    os: platform.osKind(), docker: false, image: false, tun: null,
    curl: false, nmcli: false, errors: [],
  };

  try {
    result.image = await dockerDriver.imageExists();
    result.docker = true;
    if (!result.image) {
      result.errors.push(`Chưa có image "${dockerDriver.IMAGE}", chạy lại script cài đặt`);
    }
  } catch (err) {
    result.errors.push(`Docker không dùng được: ${(err.stderr || err.message).trim()}`);
  }

  // Trên macOS/Windows, Docker chạy trong VM nên host KHÔNG có /dev/net/tun —
  // kiểm tra file trên host sẽ luôn sai. Thứ cần biết là container có mượn được
  // device không, nên thử thật.
  if (result.image) {
    result.tun = await dockerDriver.tunProbe();
    if (!result.tun.ok) {
      result.errors.push(`Không tạo được interface tun trong container: ${result.tun.reason}`);
    }
  }

  const needed = [['curl', 'curl']];
  if (platform.supportsNetworkManager()) needed.push(['nmcli', 'nmcli']);
  else result.nmcli = null; // không áp dụng, không phải thiếu

  for (const [key, bin] of needed) {
    try {
      await require('util').promisify(require('child_process').execFile)(
        bin, ['--version'], { timeout: 5000 });
      result[key] = true;
    } catch {
      result.errors.push(`Thiếu lệnh ${bin}`);
    }
  }
  return result;
}

module.exports = { checkPrereqs };
