import { t } from './i18n.js';
export function createTransport(room, key, onStatus) {
  let socket, receive, change, retry, ping, timeout, attempts = 0, stopped = false, lastPong = 0;
  const transport = { name: 'SlideLink server', up: false, connects: 0,
    send(message) { if (transport.up && socket?.readyState === 1 && socket.bufferedAmount < 512000) socket.send(JSON.stringify(message)); },
    connect(onMessage, onChange) { receive = onMessage; change = onChange; connect(); },
    stop() { stopped = true; clearTimeout(retry); clearInterval(ping); socket?.close(); }
  };
  let statusText = '';
  function update(up, text) { statusText = text; transport.up = up; onStatus(t(text)); change?.(); }
  document.addEventListener('languagechange', () => onStatus(t(statusText)));
  function connect() {
    if (stopped) return;
    if (!navigator.onLine) { update(false, "Offline. Waiting for network…"); return; }
    clearTimeout(retry); clearInterval(ping); clearTimeout(timeout);
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/sync`);
    socket = ws; update(false, "Connecting…");
    timeout = setTimeout(() => ws.close(), 7000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', room, key }));
    ws.onmessage = event => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'ready') {
        clearTimeout(timeout); attempts = 0; transport.connects++; lastPong = Date.now();
        update(true, "Connected");
        ping = setInterval(() => { if (Date.now() - lastPong > 16000) ws.close(); else if(ws.readyState===1)ws.send(JSON.stringify({type:'ping'})); }, 5000);
      } else if (m.type === 'pong') lastPong = Date.now();
      else receive(m);
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      if (ws !== socket) return;
      clearInterval(ping); clearTimeout(timeout);
      if ([4001,4004,4009].includes(event.code)) {
        stopped = true;
        update(false, event.code === 4009 ? 'Presenter opened elsewhere. Reload to take control.' : "Link expired or presentation deleted");
      } else {
        update(false, "Disconnected. Reconnecting…");
        if (!stopped) retry = setTimeout(connect, Math.min(5000, 500 * 2 ** attempts++));
      }
    };
  }
  window.addEventListener('online', () => { if(!stopped && socket?.readyState === WebSocket.CLOSED)connect(); });
  window.addEventListener('offline', () => { if (!stopped) { update(false, "Offline. Waiting for network…"); socket?.close(); } });
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && !stopped) { if(socket?.readyState===WebSocket.CLOSED)connect(); else if(transport.up)socket.send(JSON.stringify({type:'ping'})); } });
  return transport;
}
