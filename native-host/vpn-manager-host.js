#!/usr/bin/env node
// VPN Manager — định tuyến từng domain qua OpenVPN tunnel riêng.
// Copyright (C) 2026 thuyanh.nguyen
//
// Phát hành theo GNU General Public License v3.0 hoặc bản mới hơn.
// KHÔNG KÈM BẤT KỲ BẢO ĐẢM NÀO. Xem file LICENSE.
'use strict';
// Native messaging host cho VPN Manager extension.
// Chrome spawn process này, giao tiếp qua stdin/stdout. stderr đi vào log của Chrome.

const protocol = require('./lib/protocol');
const dockerDriver = require('./lib/docker-driver');
const nmImporter = require('./lib/nm-importer');
const connectionTester = require('./lib/connection-tester');
const lifecycle = require('./lib/lifecycle-lock');
const guard = require('./lib/path-guard');
const platform = require('./lib/platform');
const { checkPrereqs } = require('./lib/prereq-check');
const ovpnStore = require('./lib/ovpn-store');
const { parseOvpn } = require('./lib/ovpn-parser');

const log = (...a) => process.stderr.write(`[vpn-manager-host] ${a.join(' ')}\n`);

const HANDLERS = {
  async ping() {
    return { pong: true, pid: process.pid, node: process.version };
  },

  async 'check-prereqs'() {
    return checkPrereqs();
  },

  async 'list-nm-profiles'() {
    return nmImporter.listProfiles();
  },

  // Nội dung .ovpn chỉ đi qua đây một lần rồi nằm trên đĩa với quyền 0600.
  // Extension không bao giờ lưu nội dung, chỉ giữ đường dẫn.
  async 'save-ovpn'(payload) {
    const parsed = parseOvpn(payload.content);
    if (!parsed.ok) return { ok: false, errors: parsed.errors };

    const configPath = ovpnStore.save(payload.id, payload.content);
    return { ok: true, configPath, info: parsed.info };
  },

  async 'delete-ovpn'(payload) {
    return ovpnStore.remove(payload.id);
  },

  // Extension là bên duy nhất biết profile nào còn sống; host chỉ nhìn thấy file.
  async 'prune-ovpn'(payload) {
    return ovpnStore.pruneExcept(payload.keepIds);
  },

  async 'check-paths'(payload) {
    const out = {};
    for (const [field, value] of Object.entries(payload.paths || {})) {
      out[field] = value ? guard.describePath(value) : { ok: true, path: '', skipped: true };
    }
    return { results: out };
  },

  async 'start-tunnel'(payload) {
    return dockerDriver.start(payload.profile);
  },

  async 'stop-tunnel'(payload) {
    return dockerDriver.stop(payload.profileId);
  },

  async 'tunnel-status'(payload) {
    const ids = payload.profileIds || [];
    const status = {};
    for (const id of ids) {
      try {
        status[id] = { running: await dockerDriver.isRunning(id) };
      } catch (err) {
        status[id] = { running: false, error: err.message };
      }
    }
    return { status };
  },

  async 'tunnel-health'(payload) {
    const health = {};
    for (const id of payload.profileIds || []) {
      try {
        health[id] = await dockerDriver.health(id);
      } catch (err) {
        health[id] = { healthy: false, reason: err.message };
      }
    }
    return { health };
  },

  async 'tunnel-logs'(payload) {
    return { logs: await dockerDriver.getLogs(payload.profileId, payload.tail || 50) };
  },

  async 'test-connection'(payload) {
    return connectionTester.testConnection(payload.profile);
  },

  async 'sync-tunnels'(payload) {
    // Đưa tập tunnel đang chạy về đúng tập mà extension yêu cầu.
    const wanted = payload.profiles || [];
    const wantedIds = new Set(wanted.map((p) => p.id));
    const results = { started: [], stopped: [], failed: [] };

    for (const id of await dockerDriver.listRunning()) {
      if (!wantedIds.has(id)) {
        await dockerDriver.stop(id).catch(() => {});
        results.stopped.push(id);
      }
    }

    for (const profile of wanted) {
      try {
        const r = await dockerDriver.start(profile);
        if (r.started) results.started.push(profile.id);
      } catch (err) {
        results.failed.push({ id: profile.id, error: err.message });
      }
    }
    return results;
  },

  async 'stop-all'() {
    return dockerDriver.stopAll();
  },
};

async function dispatch(msg) {
  const handler = HANDLERS[msg.action];
  if (!handler) throw new Error(`Action không tồn tại: ${msg.action}`);
  return handler(msg.payload || {});
}

function main() {
  lifecycle.claim();
  log(`khởi động pid=${process.pid}`);

  protocol.createReader(
    process.stdin,
    (msg) => {
      dispatch(msg)
        .then((data) => protocol.writeMessage(process.stdout, { id: msg.id, ok: true, data }))
        .catch((err) => {
          log(`lỗi action=${msg.action}: ${err.message}`);
          protocol.writeMessage(process.stdout, { id: msg.id, ok: false, error: err.message });
        });
    },
    (err) => log(`lỗi protocol: ${err.message}`)
  );

  process.stdin.on('end', () => {
    log('stdin đóng, chờ grace period trước khi dọn tunnel');
    lifecycle.scheduleShutdown(async () => {
      log('Chrome đã đóng, dọn toàn bộ tunnel');
      const r = await dockerDriver.stopAll().catch((e) => ({ error: e.message }));
      log(`đã dừng ${r.stopped ?? 0} tunnel`);
    });
  });

  // Cùng quy tắc như EOF nhưng quyết định ngay: chỉ dọn khi mình là host cuối cùng.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      lifecycle.scheduleShutdown(async () => {
        await dockerDriver.stopAll().catch(() => {});
      }, 0);
    });
  }
}

main();
