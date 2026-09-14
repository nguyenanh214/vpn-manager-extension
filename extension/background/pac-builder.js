// Sinh PAC script từ danh sách domain đang bật.
// FindProxyForURL chạy cho MỖI request -> đây là cách duy nhất route theo domain,
// vì chrome.proxy là per-profile chứ không per-tab.

import { activeDomains } from '../lib/storage.js';
import { isIpv4 } from '../lib/domain-validator.js';

/**
 * Ánh xạ domain -> chuỗi proxy. Entry apex bao luôn subdomain
 * (thêm "example.com" thì "www.example.com" cũng đi VPN).
 */
export function buildProxyMap(state) {
  const portById = new Map(state.vpnProfiles.map((p) => [p.id, Number(p.socksPort)]));
  const map = {};
  for (const d of activeDomains(state)) {
    const port = portById.get(d.vpnId);
    if (!port) continue;
    map[d.domain] = { proxy: `SOCKS5 127.0.0.1:${port}`, exact: isIpv4(d.domain) };
  }
  return map;
}

/**
 * KHÔNG có fallback "; DIRECT". Nếu tunnel chết thì request phải fail rõ ràng,
 * chứ không được âm thầm rơi ra mạng thường làm lộ traffic.
 */
export function buildPac(state) {
  const map = buildProxyMap(state);
  const exactOnly = {};
  const suffixable = {};
  for (const [domain, entry] of Object.entries(map)) {
    (entry.exact ? exactOnly : suffixable)[domain] = entry.proxy;
  }

  return `function FindProxyForURL(url, host) {
  var EXACT = ${JSON.stringify(exactOnly)};
  var SUFFIX = ${JSON.stringify(suffixable)};
  host = ("" + host).toLowerCase().replace(/\\.$/, "");

  if (EXACT[host]) return EXACT[host];
  if (SUFFIX[host]) return SUFFIX[host];

  var rest = host;
  var dot = rest.indexOf(".");
  while (dot > -1) {
    rest = rest.substring(dot + 1);
    if (SUFFIX[rest]) return SUFFIX[rest];
    dot = rest.indexOf(".");
  }
  return "DIRECT";
}`;
}

export function hasActiveRoutes(state) {
  return Object.keys(buildProxyMap(state)).length > 0;
}
