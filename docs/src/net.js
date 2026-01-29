/**
 * PeerJS networking wrapper (P2P data connection)
 * - owner creates a peer id
 * - joiner connects to owner
 * - owner presses Start -> send seed to joiner
 * - both sides exchange state updates (position etc.)
 */
export class NetSession {
  constructor({ isOwner }) {
    this.isOwner = isOwner;
    this.peer = null;
    this.conn = null;
    this.myId = null;

    this.onMessage = null;
    this.onStatus = null;

    this._queue = [];
    this._tAcc = 0;
    this._lastSend = 0;
    this._lastPingSent = 0;
    this._pingMs = null;
    this._pendingPingTs = null;

    this._sendHz = 20; // state updates throttled
  }

  async open() {
    // PeerJS uses a signaling server to find peers (default config works in many cases)
    this.peer = new window.Peer();
    this.onStatus?.("Opening peer…");

    return await new Promise((resolve, reject) => {
      const p = this.peer;

      p.on("open", (id) => {
        this.myId = id;
        this.onStatus?.("Peer ready.");
        resolve(id);
      });

      p.on("connection", (conn) => {
        // only owner expects incoming
        this.conn = conn;
        this._wireConn(conn);
        this.onStatus?.("Connected! Ready.");
      });

      p.on("error", (err) => {
        console.error(err);
        this.onStatus?.("Peer error: " + err.type);
        reject(err);
      });
    });
  }

  async connect(ownerId) {
    if (!this.peer) throw new Error("peer not open");
    this.onStatus?.("Connecting to " + ownerId + " …");

    const conn = this.peer.connect(ownerId, { reliable: true });
    this.conn = conn;
    this._wireConn(conn);

    return await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("timeout")), 12000);
      conn.on("open", () => {
        clearTimeout(to);
        this.onStatus?.("Connected.");
        resolve();
      });
      conn.on("error", (e) => {
        clearTimeout(to);
        reject(e);
      });
    });
  }

  _wireConn(conn) {
    conn.on("data", (data) => this.onMessage?.(data));
    conn.on("close", () => this.onStatus?.("Disconnected."));
    conn.on("error", (e) => {
      console.error(e);
      this.onStatus?.("Conn error.");
    });
  }

  send(msg) {
    if (!this.conn || !this.conn.open) return;
    this.conn.send(msg);
  }

  sendThrottled(msg) {
    // last-wins buffering for high-frequency state
    this._queue[0] = msg;
  }

  update(dt) {
    this._tAcc += dt;

    // send state at fixed Hz
    const now = performance.now();
    const interval = 1000 / this._sendHz;
    if (this._queue.length && now - this._lastSend >= interval) {
      this._lastSend = now;
      this.send(this._queue[0]);
      this._queue.length = 0;
    }

    // ping every ~1.5s
    if (!this._lastPingSent || now - this._lastPingSent > 1500) {
      this._lastPingSent = now;
      this._pendingPingTs = now;
      this.send({ t: "ping", ts: now });
    }
  }

  replyPong(ts) {
    this.send({ t: "pong", ts });
  }

  onPong(ts) {
    // ts is the sender's ping timestamp; we compare to now
    const now = performance.now();
    const rtt = now - ts;
    this._pingMs = Math.round(rtt);
  }

  getPingMs() {
    return this._pingMs;
  }

  close() {
    try { this.conn?.close?.(); } catch {}
    try { this.peer?.destroy?.(); } catch {}
    this.conn = null;
    this.peer = null;
  }
}
