const $ = (id) => document.getElementById(id);

// DOM Elements
const panel = $("panel");
const loginForm = $("loginForm");
const lobbyArea = $("lobbyArea");
const bracketArea = $("bracketArea");
const gameArea = $("gameArea");
const hud = $("hud");

const nameInput = $("nameInput");
const roomInput = $("roomInput");
const roomStatus = $("roomStatus");
const msg = $("msg");
const playersList = $("playersList");
const bracketList = $("bracketList");

// Game Elements
const p1Name = $("p1Name");
const p2Name = $("p2Name");
const p1Img = $("p1Img");
const p2Img = $("p2Img");
const p1Container = $("p1Container");
const p2Container = $("p2Container");
const lightning = $("lightning");
const signal = $("signal");
const slashLine = $("slashLine");

// Audio
const slashAudio = new Audio("./slash.mp3");

// State
let peer = null;
let myId = null;
let myName = null;
let isHost = false;
let connMap = new Map(); // host only
let hostConn = null;     // client only

let players = new Map(); // id -> {name, id}
let tournamentQueue = []; // Array of matches
let currentMatchIdx = 0;

let clientP1Id = null;
let clientP2Id = null;

let matchActive = false; // Host logic

// --- Utility ---
function safeName(s) { return (s || "").trim().slice(0, 16) || "NoName"; }
function safeRoomId(s) { return (s || "").replace(/[^a-zA-Z0-9_-]/g, "").trim(); }
function setMsg(text) { msg.textContent = text; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function now() { return performance.now(); }

// --- Audio ---
function playSlash() {
  try {
    slashAudio.currentTime = 0;
    slashAudio.play().catch(() => {});
  } catch(e){}
}

// --- P2P Setup ---
$("createBtn").onclick = () => initPeer(true);
$("joinBtn").onclick = () => initPeer(false);

function initPeer(host) {
  const name = safeName(nameInput.value);
  let room = safeRoomId(roomInput.value);

  if (!name) return alert("名前を入力してください");
  if (!room) return alert("部屋コードを入力してください（英数字）");

  // ホストで作成する場合、少しランダムな文字を足さないと被りやすいが、
  // 友達と遊ぶために指定したいはずなのでそのまま使う。エラーならアラートを出す。
  
  myName = name;
  isHost = host;
  
  $("createBtn").disabled = true;
  $("joinBtn").disabled = true;
  setMsg(host ? "部屋を作成中..." : "接続中...");

  // PeerJSオブジェクト作成
  // ホストならroom名をIDにする。ゲストならID指定なし（自動生成）。
  peer = new Peer(host ? room : null, {
    debug: 1
  });

  peer.on("open", (id) => {
    myId = id;
    roomStatus.textContent = `Room: ${room} (${host ? "HOST" : "GUEST"})`;
    loginForm.classList.add("hidden");
    
    if (isHost) {
      setMsg("作成完了！友達に部屋コードを教えてください。");
      players.set(myId, { id: myId, name: myName });
      enterLobby();
    } else {
      connectToHost(room);
    }
  });

  peer.on("connection", (conn) => {
    // データ受信時の処理を設定
    conn.on("data", (d) => handleData(d, conn));
    
    conn.on("open", () => {
      if(isHost) {
        connMap.set(conn.peer, conn);
        // 新しい人が来たら現在のリストを送る前に、その人をリストに追加
        // （joinメッセージを待ってから追加するのが一般的だが、簡単のため接続＝参加とするケースもある。
        //  今回は connectToHost で join を送っているのでそこで処理する）
      }
    });
    
    conn.on("close", () => {
      if(isHost) {
        players.delete(conn.peer);
        connMap.delete(conn.peer);
        broadcastLobby();
      }
    });
  });

  peer.on("error", (e) => {
    console.error(e);
    $("createBtn").disabled = false;
    $("joinBtn").disabled = false;
    
    if (e.type === "unavailable-id") {
      alert("その部屋コードは既に使用されています。\n別のコード（例: " + room + "_" + Math.floor(Math.random()*100) + "）を使ってみてください。");
      setMsg("エラー: 部屋コード重複");
    } else if (e.type === "peer-unavailable") {
      alert("部屋が見つかりません。コードが正しいか確認してください。");
      setMsg("エラー: 部屋なし");
    } else {
      alert("エラーが発生しました: " + e.type);
    }
  });
}

function connectToHost(roomCode) {
  hostConn = peer.connect(roomCode);
  
  hostConn.on("open", () => {
    setMsg("ホストに接続しました。");
    hostConn.send({ t: "join", name: myName });
  });

  hostConn.on("data", (d) => handleData(d, hostConn));
  
  hostConn.on("close", () => {
    alert("ホストとの接続が切れました");
    location.reload();
  });
  
  hostConn.on("error", (e) => {
    console.error(e);
  });
}

function broadcast(data) {
  if (!isHost) return;
  for (const c of connMap.values()) {
    try { c.send(data); } catch(e){}
  }
}

// --- Data Handling ---
function handleData(data, conn) {
  // console.log("Received:", data);

  switch (data.t) {
    case "join": // Host receives join
      if (!isHost) return;
      players.set(conn.peer, { id: conn.peer, name: safeName(data.name) });
      broadcastLobby();
      break;

    case "updateLobby": // Client receives lobby update
      players.clear();
      data.players.forEach(p => players.set(p.id, p));
      renderLobby();
      break;

    case "startTournament": // Everyone receives tournament start
      enterTournament();
      break;

    case "updateBracket": // Tournament tree update
      renderBracket(data.matches, data.currentIdx);
      break;

    case "prepareMatch": // Show game screen
      setupMatch(data.p1, data.p2);
      break;

    case "lightningEffect": // Visual 1
      showLightning();
      break;

    case "signalGo": // "NOW!!!"
      showSignal();
      break;

    case "matchResult": // Winner decided
      resolveMatch(data.winnerId, data.loserId, data.reason);
      break;

    // --- Host Logic Inputs ---
    case "actionHit":
      if(isHost) handlePlayerAction(conn.peer, "hit", data.time);
      break;
    case "actionFalse":
      if(isHost) handlePlayerAction(conn.peer, "false", data.time);
      break;
  }
}

// --- Lobby Logic ---
function enterLobby() {
  lobbyArea.classList.remove("hidden");
  if (isHost) {
    $("startTourneyBtn").classList.remove("hidden");
    broadcastLobby();
  }
}

function broadcastLobby() {
  const list = Array.from(players.values());
  const payload = { t: "updateLobby", players: list };
  broadcast(payload);
  handleData(payload, null); // Self update
}

function renderLobby() {
  playersList.innerHTML = "";
  $("playersCount").textContent = `Players: ${players.size}`;
  players.forEach(p => {
    const div = document.createElement("div");
    div.className = "playerChip";
    div.textContent = p.name + (p.id === myId ? " (YOU)" : "");
    playersList.appendChild(div);
  });
}

$("startTourneyBtn").onclick = () => {
  if (players.size < 2) return alert("最低2人必要です");
  broadcast({ t: "startTournament" });
  handleData({ t: "startTournament" }, null);
  
  // Create Bracket
  if (isHost) createBracket();
};

// --- Tournament Logic (Host) ---
function createBracket() {
  const pArray = Array.from(players.values());
  // Shuffle
  for (let i = pArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pArray[i], pArray[j]] = [pArray[j], pArray[i]];
  }

  tournamentQueue = [];
  // Simple pairing
  for(let i=0; i<pArray.length; i+=2) {
    if(i+1 < pArray.length) {
      tournamentQueue.push({ p1: pArray[i], p2: pArray[i+1], winner: null });
    } else {
      // 不戦勝 (BYE)
       tournamentQueue.push({ p1: pArray[i], p2: null, winner: pArray[i] });
    }
  }

  runNextMatch(0);
}

function runNextMatch(idx) {
  // Sync Bracket
  const payload = { t: "updateBracket", matches: tournamentQueue, currentIdx: idx };
  broadcast(payload);
  handleData(payload, null);

  if (idx >= tournamentQueue.length) {
    // Round Over
    const winners = tournamentQueue.map(m => m.winner).filter(w => w);
    if(winners.length === 1) {
      // Champion
      setTimeout(() => {
        alert(`優勝: ${winners[0].name} !`);
        location.reload(); // リセット
      }, 2000);
      return;
    }
    // New Round creation
    const nextRound = [];
    for(let i=0; i<winners.length; i+=2) {
      if(i+1 < winners.length) {
        nextRound.push({ p1: winners[i], p2: winners[i+1], winner: null });
      } else {
        nextRound.push({ p1: winners[i], p2: null, winner: winners[i] });
      }
    }
    tournamentQueue = nextRound;
    setTimeout(() => runNextMatch(0), 3000);
    return;
  }

  const match = tournamentQueue[idx];
  currentMatchIdx = idx;

  if (!match.p2) {
    // BYE (不戦勝) skip
    runNextMatch(idx + 1);
    return;
  }

  // Start Real Match
  setTimeout(() => {
    const load = { t: "prepareMatch", p1: match.p1, p2: match.p2 };
    broadcast(load);
    handleData(load, null);
    
    if(isHost) hostGameLoop(match.p1.id, match.p2.id);
  }, 2000);
}

// --- UI Rendering ---
function enterTournament() {
  lobbyArea.classList.add("hidden");
  bracketArea.classList.remove("hidden");
}

function renderBracket(matches, currentIdx) {
  bracketList.innerHTML = "";
  matches.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "matchRow" + (i === currentIdx ? " active" : "");
    
    const p1n = m.p1.name;
    const p2n = m.p2 ? m.p2.name : "不戦勝";
    const win = m.winner ? ` <span class="winnerName">WIN: ${m.winner.name}</span>` : "";

    row.innerHTML = `<div>${p1n} <span class="vs">VS</span> ${p2n}</div>${win}`;
    bracketList.appendChild(row);
  });
  
  if(matches[currentIdx]) {
    const m = matches[currentIdx];
    $("bracketStatus").textContent = m.p2 
      ? `NEXT: ${m.p1.name} vs ${m.p2.name}` 
      : `${m.p1.name} は不戦勝です`;
  }
}

// --- Game Loop (Host) ---
let currentHostP1 = null;
let currentHostP2 = null;

async function hostGameLoop(p1Id, p2Id) {
  matchActive = true;
  currentHostP1 = p1Id;
  currentHostP2 = p2Id;
  
  // Wait for visuals
  await sleep(1500);

  // 1. Lightning Effect
  broadcast({ t: "lightningEffect" });
  handleData({ t: "lightningEffect" }, null);

  // 2. Random Wait (2s - 6s)
  const wait = 2000 + Math.random() * 4000;

  // We actually wait here using setTimeout
  const timerId = setTimeout(() => {
    if(!matchActive) return; // Already ended
    broadcast({ t: "signalGo" });
    handleData({ t: "signalGo" }, null);
  }, wait);
  
  // Save timerId inside a closure/global if we wanted to cancel it, 
  // but simpler logic: if matchActive becomes false (false start), we ignore the signal logic.
}

function handlePlayerAction(pid, type, clientTime) {
  if (!matchActive) return;
  // Identify player
  if (pid !== currentHostP1 && pid !== currentHostP2) return;
  
  const isP1 = (pid === currentHostP1);
  const enemyId = isP1 ? currentHostP2 : currentHostP1;

  if (type === "false") {
    // False Start -> Other wins
    matchActive = false;
    finishMatch(enemyId, pid, "お手付き！");
  } else if (type === "hit") {
    // Hit -> This player wins
    matchActive = false;
    finishMatch(pid, enemyId, "見切った！");
  }
}

function finishMatch(winnerId, loserId, reason) {
  const res = { t: "matchResult", winnerId, loserId, reason };
  broadcast(res);
  handleData(res, null);

  // Update Bracket Data
  tournamentQueue[currentMatchIdx].winner = players.get(winnerId);
  
  // Next match after delay
  setTimeout(() => {
    gameArea.classList.add("hidden");
    panel.classList.remove("hidden"); // Show bracket again
    if(isHost) runNextMatch(currentMatchIdx + 1);
  }, 4000);
}


// --- Client Game Visuals & Input ---
let amIPlaying = false;
let canHit = false;
let hasSwung = false;

function setupMatch(p1, p2) {
  panel.classList.add("hidden");
  gameArea.classList.remove("hidden");
  
  clientP1Id = p1.id;
  clientP2Id = p2.id;
  
  // Reset Visuals
  p1Img.className = "charImg";
  p2Img.className = "charImg";
  p1Img.classList.remove("exploded", "winnerMoveLeft", "winnerMoveRight");
  p2Img.classList.remove("exploded", "winnerMoveLeft", "winnerMoveRight");

  p1Container.style.opacity = 1;
  p2Container.style.opacity = 1;
  $("winMsg").classList.add("hidden");
  signal.classList.add("hidden");
  slashLine.classList.add("hidden");
  lightning.classList.add("hidden");

  p1Name.textContent = p1.name;
  p2Name.textContent = p2.name;

  // Input State
  amIPlaying = (myId === p1.id || myId === p2.id);
  canHit = false;
  hasSwung = false;
}

function showLightning() {
  lightning.classList.remove("hidden");
  setTimeout(() => lightning.classList.add("hidden"), 350);
}

function showSignal() {
  if(!gameArea.classList.contains("hidden")) {
      signal.classList.remove("hidden");
      canHit = true;
  }
}

function resolveMatch(winnerId, loserId, reason) {
  canHit = false;
  
  // Visuals
  playSlash();
  
  // Slash Line
  slashLine.classList.remove("hidden");
  
  const isP1Win = (winnerId === clientP1Id);
  const winnerName = players.get(winnerId)?.name || "Unknown";

  if (isP1Win) {
    p1Img.classList.add("winnerMoveLeft"); 
    p2Img.classList.add("exploded");
  } else {
    p2Img.classList.add("winnerMoveRight");
    p1Img.classList.add("exploded");
  }

  $("winMsg").textContent = `${reason} - ${winnerName} WIN!`;
  $("winMsg").classList.remove("hidden");
}

// --- Input Handling ---
window.addEventListener("keydown", (e) => {
  if (gameArea.classList.contains("hidden")) return;
  if (!amIPlaying || hasSwung) return;

  const k = e.key.toLowerCase();
  if (k === " " || k === "z" || k === "enter") {
    hasSwung = true;
    const nowT = now();
    
    if (!canHit) {
      // False Start
      if(isHost) handlePlayerAction(myId, "false", nowT);
      else hostConn.send({ t: "actionFalse", time: nowT });
    } else {
      // Hit
      if(isHost) handlePlayerAction(myId, "hit", nowT);
      else hostConn.send({ t: "actionHit", time: nowT });
    }
  }
});