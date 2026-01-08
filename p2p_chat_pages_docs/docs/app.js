(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const httpPill = $('httpPill');
  const netPill  = $('netPill');
  const latPill  = $('latPill');

  const myIdEl = $('myId');
  const inviteEl = $('inviteUrl');

  const peerIdEl = $('peerId');
  const connectBtn = $('connectBtn');

  const chatLog = $('chatLog');
  const chatInput = $('chatInput');
  const sendBtn = $('sendBtn');

  const copyIdBtn = $('copyIdBtn');
  const copyInviteBtn = $('copyInviteBtn');

  const cfgHost = $('cfgHost');
  const cfgPath = $('cfgPath');
  const cfgPort = $('cfgPort');
  const cfgSecure = $('cfgSecure');
  const saveCfgBtn = $('saveCfgBtn');
  const resetCfgBtn = $('resetCfgBtn');

  // -----------------------
  // HTTP check
  // -----------------------
  const proto = location.protocol;
  if (proto === 'http:' || proto === 'https:') {
    httpPill.textContent = `OK: ${proto}//`;
    httpPill.style.borderColor = '#2b8a3e';
  } else {
    httpPill.textContent = `NG: ${proto} (HTTPで開いて)`;
    httpPill.style.borderColor = '#c92a2a';
  }

  // -----------------------
  // Config
  // -----------------------
  const LS_KEY = 'p2p_chat_peer_server_cfg_v1';

  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function saveCfg(cfg) {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  }
  function clearCfg() {
    localStorage.removeItem(LS_KEY);
  }

  const savedCfg = loadCfg();
  if (savedCfg) {
    cfgHost.value = savedCfg.host || '';
    cfgPath.value = savedCfg.path || '/';
    cfgPort.value = String(savedCfg.port ?? 443);
    cfgSecure.value = String(savedCfg.secure ?? true);
  }

  // -----------------------
  // PeerJS init
  // -----------------------
  let peer = null;
  let conn = null;

  const pending = new Map(); // msgId -> {t0, elMeta}
  let pingTimer = null;

  function setNet(text, ok=null) {
    netPill.textContent = text;
    if (ok === true) netPill.style.borderColor = '#2b8a3e';
    else if (ok === false) netPill.style.borderColor = '#c92a2a';
    else netPill.style.borderColor = '#223248';
  }

  function setRtt(ms) {
    if (ms == null) {
      latPill.textContent = 'RTT: —';
      return;
    }
    const oneWay = ms / 2;
    latPill.textContent = `RTT: ${ms.toFixed(0)}ms  (片道~${oneWay.toFixed(0)}ms)`;
  }

  function makeInviteUrl(myId) {
    const u = new URL(location.href);
    u.searchParams.set('connect_to', myId);
    return u.toString();
  }

  function setMyId(id) {
    myIdEl.value = id;
    inviteEl.value = makeInviteUrl(id);
  }

  function parseConnectTo() {
    const u = new URL(location.href);
    return u.searchParams.get('connect_to') || '';
  }

  function peerOptionsFromUI() {
    const host = (cfgHost.value || '').trim();
    const path = (cfgPath.value || '/').trim() || '/';
    const port = parseInt(cfgPort.value || '443', 10);
    const secure = (cfgSecure.value === 'true');

    if (!host) return null; // PeerJS Cloud (default)
    return { host, path, port: isFinite(port) ? port : 443, secure };
  }

  function initPeer() {
    if (peer) {
      try { peer.destroy(); } catch {}
      peer = null;
    }
    setNet('Connecting…');
    setRtt(null);

    const opts = peerOptionsFromUI();
    peer = opts ? new Peer(opts) : new Peer();

    peer.on('open', (id) => {
      setMyId(id);
      setNet('Ready (share invite URL)', true);

      const connectTo = parseConnectTo();
      if (connectTo) {
        peerIdEl.value = connectTo;
        connect(connectTo);
      }
    });

    peer.on('connection', (incoming) => {
      attachConnection(incoming, true);
    });

    peer.on('error', (err) => {
      console.error(err);
      setNet(`Peer error: ${err.type || err}`, false);
    });
  }

  // -----------------------
  // Connection handling
  // -----------------------
  function attachConnection(c, isIncoming) {
    if (conn && conn.open) {
      try { conn.close(); } catch {}
    }
    conn = c;

    setNet(isIncoming ? `Incoming from ${c.peer}` : `Connecting to ${c.peer}…`);

    c.on('open', () => {
      setNet(`Connected: ${c.peer}`, true);
      startPing();
      addSystem(`接続しました: ${c.peer}`);
    });

    c.on('data', (data) => onData(data, c));
    c.on('close', () => {
      addSystem('接続が切れました');
      setNet('Disconnected', false);
      stopPing();
    });
    c.on('error', (err) => {
      console.error(err);
      addSystem(`接続エラー: ${err}`);
      setNet('Error', false);
      stopPing();
    });
  }

  function connect(targetId) {
    targetId = (targetId || '').trim();
    if (!targetId) return;

    try {
      const c = peer.connect(targetId, { reliable: true });
      attachConnection(c, false);
    } catch (e) {
      console.error(e);
      setNet('Connect failed', false);
    }
  }

  // -----------------------
  // Chat UI helpers
  // -----------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  function addMsg(side, text, metaText) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${side}`;

    const body = document.createElement('div');
    body.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    wrap.appendChild(body);

    const meta = document.createElement('div');
    meta.className = 'meta mono';
    meta.textContent = metaText || '';
    wrap.appendChild(meta);

    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;

    return meta;
  }

  function addSystem(text) {
    addMsg('them', `🛈 ${text}`, new Date().toLocaleTimeString());
  }

  function nowMs() { return performance.now(); }

  function sendChat(text) {
    if (!conn || !conn.open) {
      addSystem('未接続です（先に接続してね）');
      return;
    }
    const msgId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    const t0 = nowMs();

    const metaEl = addMsg('me', text, `sending…  id=${msgId.slice(0,8)}`);
    pending.set(msgId, { t0, metaEl });

    conn.send({ type: 'chat', id: msgId, text });
  }

  function onData(data, c) {
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'chat': {
        addMsg('them', data.text ?? '', new Date().toLocaleTimeString());
        try { c.send({ type: 'ack', id: data.id }); } catch {}
        break;
      }
      case 'ack': {
        const p = pending.get(data.id);
        if (p) {
          const dt = nowMs() - p.t0;
          const oneWay = dt / 2;
          p.metaEl.textContent = `delivered ~${(oneWay/1000).toFixed(3)}s (RTT=${dt.toFixed(0)}ms)`;
          pending.delete(data.id);
        }
        break;
      }
      case 'ping': {
        try { c.send({ type: 'pong', t: data.t }); } catch {}
        break;
      }
      case 'pong': {
        if (typeof data.t === 'number') {
          const rtt = nowMs() - data.t;
          setRtt(rtt);
        }
        break;
      }
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (!conn || !conn.open) return;
      try { conn.send({ type: 'ping', t: nowMs() }); } catch {}
    }, 1000);
  }

  function stopPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    setRtt(null);
  }

  // -----------------------
  // UI events
  // -----------------------
  connectBtn.addEventListener('click', () => connect(peerIdEl.value));

  sendBtn.addEventListener('click', () => {
    const t = chatInput.value.trim();
    if (!t) return;
    chatInput.value = '';
    sendChat(t);
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  copyIdBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(myIdEl.value);
      addSystem('IDをコピーしました');
    } catch {
      addSystem('コピーに失敗（ブラウザの権限を確認）');
    }
  });

  copyInviteBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteEl.value);
      addSystem('招待URLをコピーしました');
    } catch {
      addSystem('コピーに失敗（ブラウザの権限を確認）');
    }
  });

  saveCfgBtn.addEventListener('click', () => {
    const host = (cfgHost.value || '').trim();
    const path = (cfgPath.value || '/').trim() || '/';
    const port = parseInt(cfgPort.value || '443', 10);
    const secure = (cfgSecure.value === 'true');

    if (host) {
      saveCfg({ host, path, port: isFinite(port) ? port : 443, secure });
      addSystem('設定を保存しました（再接続します）');
    } else {
      clearCfg();
      addSystem('Hostが空なのでPeerJS Cloudにします（再接続）');
    }
    initPeer();
  });

  resetCfgBtn.addEventListener('click', () => {
    clearCfg();
    cfgHost.value = '';
    cfgPath.value = '/';
    cfgPort.value = '443';
    cfgSecure.value = 'true';
    addSystem('PeerJS Cloudに戻しました（再接続）');
    initPeer();
  });

  // Start
  initPeer();
})();