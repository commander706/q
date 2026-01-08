const $ = (id) => document.getElementById(id);

// --- State ---
let peer = null;
let myId = null;
let isHost = false;
let connMap = new Map();
let hostConn = null;

let players = new Map();
let tournamentQueue = [];
let currentMatchIdx = 0;
let matchActive = false;
let myName = "";

// Time Tracking
let signalTime = 0; // "今！"が出た時間

// --- Elements ---
const uiLayer = $("uiLayer");
const panel = $("panel");
const loginForm = $("loginForm");
const lobbyArea = $("lobbyArea");
const bracketArea = $("bracketArea");
const gameArea = $("gameArea");
const mainContainer = $("mainContainer");

const p1Img = $("p1Img");
const p2Img = $("p2Img");
const p1Name = $("p1Name");
const p2Name = $("p2Name");

// FX Elements
const cutInLayer = $("cutInLayer");
const fxLayer = $("fxLayer");
const signal = $("signal");
const slashLine = $("slashLine");
const lightning = $("lightning");
const speedLines = $("speedLines");
const sliceContainer = $("sliceContainer");
const resultLayer = $("resultLayer");
const championLayer = $("championLayer");

// Audio
const slashAudio = new Audio("./slash.mp3");

// --- WEBGL BACKGROUND (Shader) ---
const canvas = $("glCanvas");
const gl = canvas.getContext("webgl");

const vsSource = `
  attribute vec4 aVertexPosition;
  void main() { gl_Position = aVertexPosition; }
`;
const fsSource = `
  precision mediump float;
  uniform float uTime;
  uniform vec2 uResolution;
  
  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / min(uResolution.x, uResolution.y);
    // Sun
    float sun = length(uv - vec2(0.0, 0.2));
    vec3 col = vec3(0.0);
    if(sun < 0.5) {
      float grad = (uv.y + 0.3) * 2.0;
      col = mix(vec3(1.0, 0.0, 0.5), vec3(1.0, 1.0, 0.0), grad);
      if(mod(uv.y * 20.0 - uTime * 0.5, 2.0) > 1.4) col = vec3(0.0); 
    }
    // Grid
    vec2 gv = uv;
    gv.x *= 1.0 + (0.5 - gv.y) * 1.5; 
    float gridVal = 0.0;
    if(gv.y < -0.1) {
      gridVal += step(0.98, fract(gv.x * 5.0));
      gridVal += step(0.98, fract(gv.y * 5.0 + uTime * 0.5));
      col += vec3(0.0, 1.0, 1.0) * gridVal * (abs(gv.y) * 0.5);
    }
    // Stars
    float stars = step(0.995, fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453));
    col += stars * (1.0 - step(0.0, uv.y + 0.1)); 

    gl_FragColor = vec4(col, 1.0);
  }
`;

function initWebGL() {
  if(!gl) return;
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = createProgram(gl, vs, fs);
  
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  
  const posLoc = gl.getAttribLocation(program, "aVertexPosition");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const timeLoc = gl.getUniformLocation(program, "uTime");
  const resLoc = gl.getUniformLocation(program, "uResolution");

  function render(time) {
    resizeCanvas();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniform1f(timeLoc, time * 0.001);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

function createShader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  return s;
}
function createProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  return p;
}
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  if(canvas.width !== window.innerWidth * dpr || canvas.height !== window.innerHeight * dpr){
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
  }
}
initWebGL();

// --- LOGIC ---
function safeName(s) { return (s||"").replace(/[^a-zA-Z0-9_\-]/g, "").slice(0,12) || "PLAYER"; }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function now() { return performance.now(); }

// Audio
function playSlash() {
  try {
    slashAudio.currentTime = 0;
    slashAudio.play().catch(()=>{});
  } catch(e){}
}

// P2P Init
$("createBtn").onclick = () => initPeer(true);
$("joinBtn").onclick = () => initPeer(false);

function initPeer(host) {
  myName = safeName($("nameInput").value);
  const room = safeName($("roomInput").value);
  if(!myName || !room) return alert("Enter Name & Room ID");

  isHost = host;
  $("loginForm").classList.add("hidden");
  $("connStatus").textContent = "CONNECTING...";

  peer = new Peer(host ? room : null);
  
  peer.on("open", id => {
    myId = id;
    $("connStatus").textContent = `ONLINE: ${myName}`;
    $("roomCodeDisplay").textContent = `ROOM: ${room}`;
    
    if(isHost) {
      players.set(myId, { id: myId, name: myName });
      enterLobby();
    } else {
      connectToHost(room);
    }
  });

  peer.on("connection", conn => {
    conn.on("data", d => handleData(d, conn));
    conn.on("open", () => {
      if(isHost) { // Sync lobby immediately
        const load = { t: "updateLobby", players: Array.from(players.values()) };
        conn.send(load);
      }
    });
    conn.on("close", () => {
      if(isHost) {
        players.delete(conn.peer);
        broadcastLobby();
      }
    });
  });
  
  peer.on("error", e => {
    alert(e.type); location.reload();
  });
}

function connectToHost(room) {
  hostConn = peer.connect(room);
  hostConn.on("open", () => {
    hostConn.send({ t: "join", name: myName });
    hostConn.send({ t: "reqLobby" });
  });
  hostConn.on("data", d => handleData(d, hostConn));
  hostConn.on("close", () => { alert("Disconnected"); location.reload(); });
}

function broadcast(data) {
  if(!isHost) return;
  for(const c of connMap.values()) { try{c.send(data);}catch(e){} }
}

// --- Data Handler ---
function handleData(data, conn) {
  switch(data.t) {
    case "join":
      if(!isHost) return;
      connMap.set(conn.peer, conn);
      players.set(conn.peer, { id: conn.peer, name: safeName(data.name) });
      broadcastLobby();
      break;
    
    case "reqLobby":
      if(isHost) broadcastLobby();
      break;

    case "updateLobby":
      players.clear();
      data.players.forEach(p => players.set(p.id, p));
      renderLobby();
      // Only force to lobby screen if we are supposed to be there
      if(gameState === "lobby" && $("lobbyArea").classList.contains("hidden")) enterLobby();
      break;

    case "startTournament":
      enterTournament();
      break;

    case "updateBracket":
      renderBracket(data.matches, data.currentIdx);
      break;

    case "prepareMatch":
      runMatchSequence(data.p1, data.p2);
      break;

    case "signalGo":
      triggerSignal(data.time);
      break;

    case "matchResult":
      showResult(data);
      break;

    case "champion":
      showChampion(data.winner);
      break;

    case "backToLobby":
      resetToLobby();
      break;

    // Host Inputs
    case "actionHit":
      if(isHost) checkHit(conn.peer, data.time);
      break;
    case "actionFalse":
      if(isHost) checkFalse(conn.peer);
      break;
  }
}

// --- Lobby UI ---
let gameState = "lobby";

function enterLobby() {
  gameState = "lobby";
  lobbyArea.classList.remove("hidden");
  panel.classList.remove("hidden");
  if(isHost) $("startTourneyBtn").classList.remove("hidden");
}

function broadcastLobby() {
  const list = Array.from(players.values());
  const payload = { t: "updateLobby", players: list };
  broadcast(payload);
  handleData(payload, null);
}

function renderLobby() {
  const el = $("playersList");
  el.innerHTML = "";
  players.forEach(p => {
    const d = document.createElement("div");
    d.className = "playerChip" + (p.id===myId ? " me" : "");
    d.textContent = p.name;
    el.appendChild(d);
  });
  $("msg").textContent = `Waiting... (${players.size} players)`;
}

$("startTourneyBtn").onclick = () => {
  if(players.size < 2) return alert("Need 2+ players");
  broadcast({t: "startTournament"});
  handleData({t: "startTournament"}, null);
  if(isHost) createBracket();
}

function enterTournament() {
  gameState = "tournament";
  lobbyArea.classList.add("hidden");
  bracketArea.classList.remove("hidden");
}

function renderBracket(matches, idx) {
  const el = $("bracketList");
  el.innerHTML = "";
  matches.forEach((m, i) => {
    const div = document.createElement("div");
    div.className = "matchRow" + (i === idx ? " active" : "");
    const w = m.winner ? `<span class="winner">WIN: ${m.winner.name}</span>` : "";
    div.innerHTML = `<span>${m.p1.name} vs ${m.p2 ? m.p2.name : "BYE"}</span> ${w}`;
    el.appendChild(div);
  });
  const cm = matches[idx];
  if(cm) $("bracketStatus").textContent = cm.p2 ? `UP NEXT: ${cm.p1.name} VS ${cm.p2.name}` : "BYE ROUND";
}

// --- Host Logic ---
function createBracket() {
  const arr = Array.from(players.values());
  // Shuffle
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  tournamentQueue = [];
  for(let i=0; i<arr.length; i+=2) {
    if(i+1<arr.length) tournamentQueue.push({p1: arr[i], p2: arr[i+1], winner:null});
    else tournamentQueue.push({p1: arr[i], p2: null, winner: arr[i]});
  }
  runNextMatch(0);
}

function runNextMatch(idx) {
  const load = {t:"updateBracket", matches:tournamentQueue, currentIdx:idx};
  broadcast(load); handleData(load, null);

  if(idx >= tournamentQueue.length) {
    // End of round
    const winners = tournamentQueue.map(m=>m.winner).filter(w=>w);
    
    if(winners.length===1) {
      // Champion Found!
      const w = winners[0];
      const winLoad = { t: "champion", winner: w };
      broadcast(winLoad);
      handleData(winLoad, null);

      // Return to lobby after 5 seconds
      setTimeout(() => {
        broadcast({ t: "backToLobby" });
        handleData({ t: "backToLobby" }, null);
      }, 5000);
      return;
    }

    // Prepare Next Round
    const nextQ = [];
    for(let i=0; i<winners.length; i+=2) {
      if(i+1<winners.length) nextQ.push({p1: winners[i], p2: winners[i+1], winner:null});
      else nextQ.push({p1: winners[i], p2: null, winner: winners[i]});
    }
    tournamentQueue = nextQ;
    setTimeout(()=>runNextMatch(0), 3000);
    return;
  }

  currentMatchIdx = idx;
  const match = tournamentQueue[idx];
  if(!match.p2) { runNextMatch(idx+1); return; } // Bye

  // Start sequence
  setTimeout(() => {
    const pl = {t: "prepareMatch", p1: match.p1, p2: match.p2};
    broadcast(pl); handleData(pl, null);
    
    if(isHost) hostGameLoop(match.p1.id, match.p2.id);
  }, 2000);
}

let hostP1, hostP2;
async function hostGameLoop(p1, p2) {
  hostP1 = p1; hostP2 = p2;
  matchActive = true;
  
  // Cinematic time (4s)
  await sleep(4000);
  
  // Random wait (2-6s)
  const wait = 2000 + Math.random()*4000;
  setTimeout(() => {
    if(!matchActive) return;
    const t = now();
    const pl = { t: "signalGo", time: t };
    broadcast(pl); handleData(pl, null);
  }, wait);
}

function checkHit(pid, clientTime) {
  if(!matchActive) return;
  matchActive = false;
  const isP1 = (pid === hostP1);
  const loser = isP1 ? hostP2 : hostP1;
  
  const hostNow = now();
  const react = Math.max(0.001, (hostNow - signalTime) / 1000); 

  finishMatch(pid, loser, react, "WIN");
}
function checkFalse(pid) {
  if(!matchActive) return;
  matchActive = false;
  const isP1 = (pid === hostP1);
  const winner = isP1 ? hostP2 : hostP1; // Opponent wins
  finishMatch(winner, pid, 0, "FALSE START");
}

function finishMatch(wid, lid, time, reason) {
  const pl = { t: "matchResult", winnerId: wid, loserId: lid, time: time, reason: reason };
  broadcast(pl); handleData(pl, null);
  
  tournamentQueue[currentMatchIdx].winner = players.get(wid);
  setTimeout(() => {
    // Hide game view to show bracket again, unless it was the final
    // But logic-wise, we just show bracket.
    sliceContainer.innerHTML = "";
    mainContainer.classList.remove("hidden");
    gameArea.classList.add("hidden");
    resultLayer.classList.add("hidden");
    panel.classList.remove("hidden");
    
    if(isHost) runNextMatch(currentMatchIdx+1);
  }, 5000);
}

// --- CLIENT VISUALS ---
let amIPlaying = false;
let hasSwung = false;
let canHit = false;

async function runMatchSequence(p1, p2) {
  // Reset previous states
  mainContainer.classList.remove("hidden");
  panel.classList.add("hidden");
  gameArea.classList.remove("hidden");
  sliceContainer.innerHTML = "";
  championLayer.classList.add("hidden"); // Ensure champ screen is off
  
  resultLayer.classList.add("hidden");
  signal.classList.add("hidden");
  slashLine.classList.add("hidden");
  lightning.classList.add("hidden");
  speedLines.classList.add("hidden");
  
  // Reset character visuals
  p1Img.style.filter = "";
  p1Img.style.transform = "scaleX(-1)";
  p2Img.style.filter = "";
  p2Img.style.transform = "";

  p1Name.textContent = p1.name;
  p2Name.textContent = p2.name;
  
  amIPlaying = (myId === p1.id || myId === p2.id);
  hasSwung = false;
  canHit = false;

  // 1. Cinematic Intro
  cutInLayer.classList.remove("hidden");
  $("cutInName1").textContent = p1.name;
  $("cutInName2").textContent = p2.name;
  
  requestAnimationFrame(() => cutInLayer.classList.add("active"));
  
  await sleep(3500);
  cutInLayer.classList.remove("active");
  await sleep(500);
  cutInLayer.classList.add("hidden");
  
  // 2. Waiting Phase
  lightning.classList.remove("hidden");
  setTimeout(()=>lightning.classList.add("hidden"), 200);
}

function triggerSignal(svTime) {
  signalTime = now(); 
  if(gameArea.classList.contains("hidden")) return;
  
  signal.classList.remove("hidden");
  speedLines.classList.remove("hidden");
  canHit = true;
}

function showResult(data) {
  canHit = false;
  speedLines.classList.add("hidden");
  signal.classList.add("hidden");
  playSlash();
  
  slashLine.classList.remove("hidden");

  // Determine Winner for Visuals
  const wName = players.get(data.winnerId)?.name || "---";
  const p1IsWinner = (wName === p1Name.textContent);

  if (p1IsWinner) {
    p1Img.style.filter = "brightness(1.5) drop-shadow(0 0 20px gold)";
    p1Img.style.transform = "scaleX(-1) scale(1.2)";
    p2Img.style.filter = "grayscale(100%) brightness(0.3)";
  } else {
    p2Img.style.filter = "brightness(1.5) drop-shadow(0 0 20px gold)";
    p2Img.style.transform = "scale(1.2)";
    p1Img.style.filter = "grayscale(100%) brightness(0.3)";
  }

  // Slice Effect
  sliceContainer.innerHTML = "";
  const clone = mainContainer.cloneNode(true);
  const cloneUi = clone.querySelector("#uiLayer");
  if(cloneUi) cloneUi.remove();

  const topPart = document.createElement("div"); topPart.className = "slicePart top";
  const botPart = document.createElement("div"); botPart.className = "slicePart bottom";
  
  topPart.appendChild(clone.cloneNode(true));
  botPart.appendChild(clone);
  
  sliceContainer.appendChild(topPart);
  sliceContainer.appendChild(botPart);
  
  mainContainer.classList.add("hidden");

  // Show Text
  $("winTitle").textContent = data.reason;
  $("winName").textContent = wName;
  
  let rank = "";
  if(data.reason === "FALSE START") {
    $("reactTime").textContent = "FOUL";
    $("reactTime").style.color = "#f00";
    rank = "DISQUALIFIED";
  } else {
    const t = data.time.toFixed(3);
    $("reactTime").textContent = `${t}s`;
    $("reactTime").style.color = "#fff";
    
    if(data.time < 0.12) rank = "GODSPEED (神速)";
    else if(data.time < 0.18) rank = "MASTER (達人)";
    else if(data.time < 0.25) rank = "SOLDIER (一般兵)";
    else rank = "SLOW (亀)";
  }
  $("rankText").textContent = rank;
  resultLayer.classList.remove("hidden");
}

function showChampion(winner) {
  // Clear any existing game view artifacts
  sliceContainer.innerHTML = "";
  mainContainer.classList.remove("hidden"); // Ensure main container is visible
  gameArea.classList.add("hidden");
  resultLayer.classList.add("hidden");
  panel.classList.add("hidden");
  
  // Show Champion Layer
  $("champName").textContent = winner.name;
  championLayer.classList.remove("hidden");
}

function resetToLobby() {
  gameState = "lobby";
  
  // Cleanup visuals
  championLayer.classList.add("hidden");
  gameArea.classList.add("hidden");
  bracketArea.classList.add("hidden");
  sliceContainer.innerHTML = "";
  resultLayer.classList.add("hidden");
  
  // Show lobby
  mainContainer.classList.remove("hidden");
  panel.classList.remove("hidden");
  lobbyArea.classList.remove("hidden");
  
  // Data reset (keep players, clear tournament)
  tournamentQueue = [];
  currentMatchIdx = 0;
  
  if(isHost) {
     broadcastLobby(); // Ensure everyone is synced
  }
}

// --- INPUT ---
window.addEventListener("keydown", e => {
  if(gameArea.classList.contains("hidden")) return;
  if(!amIPlaying || hasSwung) return;
  
  const k = e.key.toLowerCase();
  if(k===" " || k==="z" || k==="enter") {
    hasSwung = true;
    const t = now();
    if(!canHit) {
      if(isHost) checkFalse(myId);
      else hostConn.send({t:"actionFalse"});
    } else {
      if(isHost) checkHit(myId, t);
      else hostConn.send({t:"actionHit", time:t});
    }
  }
});