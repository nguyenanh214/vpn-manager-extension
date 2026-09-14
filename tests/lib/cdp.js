// Driver CDP tối giản để điều khiển Chrome trong test.
// Không dùng Playwright vì chỉ cần mở trang và eval — Node 22 có sẵn WebSocket.

const PORT = process.env.CDP_PORT || 9223;

async function targets() {
  return (await fetch(`http://localhost:${PORT}/json/list`)).json();
}

export async function openPage(url) {
  const r = await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' });
  const t = await r.json();
  return attach(t.webSocketDebuggerUrl, t.id);
}

export async function attachTo(match) {
  const t = (await targets()).find((x) => x.url.includes(match));
  if (!t) throw new Error(`Không tìm thấy target: ${match}`);
  return attach(t.webSocketDebuggerUrl, t.id);
}

function attach(wsUrl, targetId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p(m); }
    };
    ws.onerror = (e) => reject(new Error('WS error ' + (e.message || '')));

    ws.onopen = () => {
      const cmd = (method, params = {}) => new Promise((res) => {
        const mid = ++id;
        pending.set(mid, res);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });

      resolve({
        targetId,
        cmd,
        close: () => ws.close(),
        async eval(expr, awaitPromise = true) {
          const r = await cmd('Runtime.evaluate', {
            expression: expr, awaitPromise, returnByValue: true, userGesture: true,
          });
          if (r.result?.exceptionDetails) {
            throw new Error(r.result.exceptionDetails.exception?.description || 'eval lỗi');
          }
          return r.result?.result?.value;
        },
      });
    };
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
