'use strict';
// Test thật: bật tunnel, so IP thoát qua SOCKS5 với IP thật. Trùng nhau = traffic KHÔNG qua VPN.

const { execFile } = require('child_process');
const dockerDriver = require('./docker-driver');
const guard = require('./path-guard');

const IP_ENDPOINTS = [
  'https://api.ipify.org',
  'https://ifconfig.me/ip',
  'https://icanhazip.com',
];
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function curl(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));
  });
}

/** Thử lần lượt các endpoint echo IP cho tới khi có IPv4 hợp lệ. */
async function fetchIp(extraArgs, timeoutSec) {
  let lastErr = 'không endpoint nào phản hồi';
  for (const url of IP_ENDPOINTS) {
    try {
      const out = await curl(
        ['-s', '--max-time', String(timeoutSec), ...extraArgs, url],
        (timeoutSec + 5) * 1000
      );
      if (IPV4_RE.test(out)) return out;
      lastErr = `phản hồi lạ từ ${url}: ${out.slice(0, 80)}`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  throw new Error(lastErr);
}

/**
 * --socks5-hostname ép proxy tự resolve DNS -> đồng thời là phép thử DNS leak.
 * Nếu tunnel vốn chưa chạy thì test xong sẽ tắt lại, không để sót container.
 */
async function testConnection(profile) {
  const port = guard.assertSafeSocksPort(profile.socksPort);
  const wasRunning = await dockerDriver.isRunning(profile.id);

  let startedForTest = false;
  if (!wasRunning) {
    await dockerDriver.start(profile);
    startedForTest = true;
  }

  try {
    const directIp = await fetchIp([], 10).catch((e) => ({ error: e.message }));

    const t0 = Date.now();
    const tunnelIp = await fetchIp(['--socks5-hostname', `127.0.0.1:${port}`], 15);
    const latencyMs = Date.now() - t0;

    const direct = typeof directIp === 'string' ? directIp : null;
    return {
      ok: true,
      directIp: direct,
      directError: direct ? null : directIp.error,
      tunnelIp,
      latencyMs,
      leaked: direct !== null && direct === tunnelIp,
      wasAlreadyRunning: wasRunning,
    };
  } catch (err) {
    const logs = await dockerDriver.getLogs(profile.id, 30);
    return { ok: false, error: err.message, logs, wasAlreadyRunning: wasRunning };
  } finally {
    if (startedForTest) await dockerDriver.stop(profile.id).catch(() => {});
  }
}

module.exports = { testConnection, fetchIp };
