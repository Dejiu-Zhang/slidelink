export function createTransport(room, key, onStatus) {
  let socket, receive, change, retry, ping, timeout, attempts = 0, stopped = false, lastPong = 0;
  const transport = { name: 'SlideLink server', up: false, connects: 0,
    send(message) { if (transport.up && socket?.readyState === 1 && socket.bufferedAmount < 512000) socket.send(JSON.stringify(message)); },
    connect(onMessage, onChange) { receive = onMessage; change = onChange; connect(); },
    stop() { stopped = true; clearTimeout(retry); clearInterval(ping); socket?.close(); }
  };
  function update(up, text) { transport.up = up; onStatus(text); change?.(); }
  function connect() {
    if (stopped) return;
    if (!navigator.onLine) { update(false, '网络已断开，等待恢复…'); return; }
    clearTimeout(retry); clearInterval(ping); clearTimeout(timeout);
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/sync`);
    socket = ws; update(false, '正在连接…');
    timeout = setTimeout(() => ws.close(), 7000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', room, key }));
    ws.onmessage = event => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'ready') {
        clearTimeout(timeout); attempts = 0; transport.connects++; lastPong = Date.now();
        update(true, '服务已连接');
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
        update(false, event.code === 4009 ? '演讲者已在另一窗口打开；刷新可接管' : '链接失效或演示已删除');
      } else {
        update(false, '连接中断，正在重连…');
        if (!stopped) retry = setTimeout(connect, Math.min(5000, 500 * 2 ** attempts++));
      }
    };
  }
  window.addEventListener('online', () => { if(!stopped && socket?.readyState === WebSocket.CLOSED)connect(); });
  window.addEventListener('offline', () => { if (!stopped) { update(false, '网络已断开，等待恢复…'); socket?.close(); } });
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && !stopped) { if(socket?.readyState===WebSocket.CLOSED)connect(); else if(transport.up)socket.send(JSON.stringify({type:'ping'})); } });
  return transport;
}
