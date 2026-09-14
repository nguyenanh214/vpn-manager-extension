// Áp PAC script vào Chrome. chrome.proxy là per-profile: đây là lý do
// việc route phải làm bằng PAC theo domain chứ không phải theo tab.

import { buildPac, hasActiveRoutes } from './pac-builder.js';

/** Extension khác cũng chỉnh proxy sẽ khiến cấu hình của ta bị vô hiệu. */
export async function checkControl() {
  try {
    const cfg = await chrome.proxy.settings.get({ incognito: false });
    return {
      level: cfg.levelOfControl,
      controllable:
        cfg.levelOfControl === 'controllable_by_this_extension' ||
        cfg.levelOfControl === 'controlled_by_this_extension',
    };
  } catch (err) {
    return { level: 'unknown', controllable: false, error: err.message };
  }
}

/** Không còn domain nào bật -> trả Chrome về proxy hệ thống. */
export async function applyPac(state) {
  if (!hasActiveRoutes(state)) return clearProxy();

  const pac = buildPac(state);
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: pac, mandatory: false } },
    scope: 'regular',
  });
  return { applied: true, pac };
}

export async function clearProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  return { applied: false };
}
