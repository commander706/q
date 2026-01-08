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
let tournamentQueue = []; // Array of matches {p1, p2, winner}
let currentMatch = null;  // {p1, p2}
let gameState = "menu";   // menu, lobby, tournament, waiting, signal, ended

// --- Utility ---
function safeName(s) { return (s || "").trim().slice(0, 16) || "NoName"; }
function setMsg(text) { msg.textContent = text; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function now() { return performance.now(); }

// --- Audio ---
function playSlash() {
  slashAudio.currentTime = 0;
  slashAudio.play().catch(() => {});
}

// --- P2P Setup ---
$("createBtn").onclick = () => initPeer(true);
$("joinBtn").onclick = () => initPeer(false);

function initPeer(host) {
  const name = safeName(nameInput.value);
  const room = roomInput.value.trim();
  if (!name || !room) return alert("名前と部屋コードを入力してください");

  myName = name;
  isHost = host;
  loginForm.classList.add("hidden");
  setMsg("接続中...");

  peer = new Peer(host ? room : null);

  peer.on("open", (id) => {
    myId = id;
    roomStatus.textContent = `Room: ${room} (${host ? "HOST" : "GUEST"})`;
    
    if (isHost) {
      players.set(myId, { id: myId, name: myName });
      enterLobby();
    } else {
      connectToHost(room);
    }
  });

  peer.on("connection", (conn) => {
    conn.on("data", (d) => handleData(d, conn));
    conn.on("open", () => {
      if(isHost) {
        connMap.set(conn.peer, conn);
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
    alert("エラー: " + e.type);
    location.reload();
  });
}

function connectToHost(roomCode) {
  hostConn = peer.connect(roomCode);
  hostConn.on("open", () => {
    hostConn.send({ t: "join", name: myName });
  });
  hostConn.on("data", (d) => handleData(d, hostConn));
  hostConn.on("close", () => {
    alert("ホストとの接続が切れました");
    location.reload();
  });
}

function broadcast(data) {
  if (!isHost) return;
  for (const c of connMap.values()) c.send(data);
}

// --- Data Handling ---
function handleData(data, conn) {
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
  gameState = "lobby";
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
  // Simple pairing (Odd number gets a bye handled by loop)
  for(let i=0; i<pArray.length; i+=2) {
    if(i+1 < pArray.length) {
      tournamentQueue.push({ p1: pArray[i], p2: pArray[i+1], winner: null });
    } else {
      // Bye (Advance automatically - implemented simply as instant win)
      // For this demo, we'll just push them to next round or ignore odd one
      // Better: Push as a match where p2 is null (BYE)
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
    // Round Over, create next round or announce champion
    const winners = tournamentQueue.map(m => m.winner).filter(w => w);
    if(winners.length === 1) {
      // Champion
      setTimeout(() => alert(`CHAMPION: ${winners[0].name} !`), 1000);
      return;
    }
    // New Round
    const nextRound = [];
    for(let i=0; i<winners.length; i+=2) {
      if(i+1 < winners.length) {
        nextRound.push({ p1: winners[i], p2: winners[i+1], winner: null });
      } else {
        nextRound.push({ p1: winners[i], p2: null, winner: winners[i] });
      }
    }
    tournamentQueue = nextRound;
    setTimeout(() => runNextMatch(0), 2000);
    return;
  }

  const match = tournamentQueue[idx];
  currentMatchIdx = idx;

  if (!match.p2) {
    // BYE, skip
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
  gameState = "tournament";
  lobbyArea.classList.add("hidden");
  bracketArea.classList.remove("hidden");
}

function renderBracket(matches, currentIdx) {
  bracketList.innerHTML = "";
  matches.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "matchRow" + (i === currentIdx ? " active" : "");
    
    const p1n = m.p1.name;
    const p2n = m.p2 ? m.p2.name : "BYE";
    const win = m.winner ? ` <span class="winnerName">WIN: ${m.winner.name}</span>` : "";

    row.innerHTML = `<div>${p1n} <span class="vs">VS</span> ${p2n}</div>${win}`;
    bracketList.appendChild(row);
  });
}

// --- Game Loop (Host) ---
let signalTime = 0;
let matchActive = false;
let currentP1 = null;
let currentP2 = null;

async function hostGameLoop(p1Id, p2Id) {
  matchActive = true;
  currentP1 = p1Id;
  currentP2 = p2Id;
  
  // Wait for clients to ready visually
  await sleep(1000);

  // 1. Lightning Effect
  broadcast({ t: "lightningEffect" });
  handleData({ t: "lightningEffect" }, null);

  // 2. Random Wait (2s - 6s)
  const wait = 2000 + Math.random() * 4000;
  signalTime = now() + wait; // Future time

  // We actually wait here using setTimeout
  setTimeout(() => {
    if(!matchActive) return; // Ended early by false start
    signalTime = now(); // Mark actual start
    broadcast({ t: "signalGo" });
    handleData({ t: "signalGo" }, null);
  }, wait);
}

function handlePlayerAction(pid, type, clientTime) {
  if (!matchActive) return;
  // Identify player
  if (pid !== currentP1 && pid !== currentP2) return;
  const enemyId = (pid === currentP1) ? currentP2 : currentP1;

  if (type === "false") {
    // False Start -> Other wins
    matchActive = false;
    finishMatch(enemyId, pid, "FALSE START");
  } else if (type === "hit") {
    // Hit -> This player wins (First one processed wins in this simple version)
    // To be strictly fair we would compare clientTime, but for prototype, first arrival is OK.
    matchActive = false;
    finishMatch(pid, enemyId, "KIRIGUTE MEN");
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
  }, 3500);
}


// --- Client Game Visuals & Input ---
function setupMatch(p1, p2) {
  panel.classList.add("hidden");
  gameArea.classList.remove("hidden");
  
  // Reset Visuals
  p1Img.className = "charImg";
  p2Img.className = "charImg";
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

let amIPlaying = false;
let canHit = false;
let hasSwung = false;

function showLightning() {
  lightning.classList.remove("hidden");
  setTimeout(() => lightning.classList.add("hidden"), 350);
}

function showSignal() {
  signal.classList.remove("hidden");
  canHit = true;
}

function resolveMatch(winnerId, loserId, reason) {
  canHit = false;
  
  // Visuals
  playSlash();
  
  // Slash Line
  slashLine.classList.remove("hidden");
  
  // Winner Move
  if (winnerId === players.get(p1Name.textContent === myName ? myId : null)?.id /* Logic correction needed here */) {
      // Find who is P1 visually
      // Actually we just map ID to Left/Right
  }

  // Map IDs to DOM
  // We stored p1/p2 in setupMatch implicitly. Let's rely on name or global vars?
  // Easier: We need to know who was P1 and P2 from the setup packet.
  // But we didn't save it globally. Let's fix handleData scope or query DOM.
  
  // Simple check: Is winner name same as P1 name?
  const winnerName = players.get(winnerId).name;
  const isP1Win = (p1Name.textContent === winnerName);

  if (isP1Win) {
    p1Img.classList.add("winnerMoveLeft"); // P1 (Left) moves right (Wait, CSS says Left moves Left?)
    // Let's fix CSS animation classes:
    // P1 is on Left. Needs to move Right. "winnerMoveLeft" in CSS actually does scaleX(-1) translateX...
    // Let's just trust the CSS I wrote or fix logic.
    // CSS: winnerMoveLeft -> translateX(100px). Correct.
    p2Img.classList.add("exploded");
  } else {
    p2Img.classList.add("winnerMoveRight");
    p1Img.classList.add("exploded");
  }

  $("winMsg").textContent = `${reason} - ${winnerName} WINS`;
  $("winMsg").classList.remove("hidden");
}

// --- Input Handling ---
window.addEventListener("keydown", (e) => {
  if (gameState !== "tournament") return;
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