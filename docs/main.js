
const $ = (id)=>document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");

const httpStatus = $("httpStatus");
const roomStatus = $("roomStatus");
const timeStatus = $("timeStatus");

const panel = $("panel");
const lobbyArea = $("lobbyArea");
const msg = $("msg");

const nameInput = $("nameInput");
const roomInput = $("roomInput");
const createBtn = $("createBtn");
const joinBtn = $("joinBtn");
const readyBtn = $("readyBtn");
const leaveBtn = $("leaveBtn");
const roleBadge = $("roleBadge");
const playersCount = $("playersCount");
const playersList = $("playersList");

const overlay = $("overlay");
const overlayTitle = $("overlayTitle");
const overlayBig = $("overlayBig");
const overlaySub = $("overlaySub");

const scoreSlide = $("scoreSlide");
const scoreTitle = $("scoreTitle");
const scoreRows = $("scoreRows");

function setMsg(t){ msg.textContent = t||""; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function nowMs(){ return performance.now(); }
function safeName(s){ s=(s||"").trim().replace(/\s+/g," "); return s? s.slice(0,16):null; }
function safeRoom(s){ s=(s||"").trim().replace(/[^a-zA-Z0-9_-]/g,""); return s? s.slice(0,24):null; }

function setOverlay(show, big="", sub="", title="MAZE RUN"){
  overlayTitle.textContent = title;
  overlayBig.textContent = big;
  overlaySub.textContent = sub;
  overlay.classList.toggle("hidden", !show);
}

function setupHttp(){
  const ok = location.protocol.startsWith("http");
  httpStatus.textContent = ok ? `HTTP OK (${location.protocol.replace(":","")})` : `NG (${location.protocol})`;
  httpStatus.style.borderColor = ok ? "rgba(77,255,138,.35)" : "rgba(255,77,109,.45)";
}
setupHttp();

// ---------- audio ----------
let audioCtx=null;
let music=null;
async function unlockAudio(){
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==="suspended") await audioCtx.resume();
  }catch(e){}
}
function beep(freq=880, dur=0.08, gain=0.045){
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type="sine"; o.frequency.value=freq;
    g.gain.setValueAtTime(gain,t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0); o.stop(t0+dur);
  }catch(e){}
}
function playMusic(){
  if(!music){
    music = new Audio("./assets/audio/Ruder_Buster.ogg");
    music.loop = true;
    music.volume = 0.18;
  }
  music.currentTime = 0;
  music.play().catch(()=>{});
}
function stopMusic(){
  if(music){ music.pause(); music.currentTime = 0; }
}

// ---------- peer / room ----------
let peer=null;
let isHost=false;
let myId=null;
let roomCode=null;
let myName=null;

let conns = new Map();  // host: pid->conn
let hostConn = null;    // client->host

const COLORS = ["#79d7ff","#ffd84a","#ff4d6d","#4dff8a","#b88cff","#ff9f4d","#4dd9c6","#ff6bd6","#a8ff4d","#4d7dff","#ff4db8","#9affff"];
function colorFor(id){
  let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0;
  return COLORS[h%COLORS.length];
}

let players = new Map(); // pid->{name,color,ready,score}
let myReady=false;

function rebuildPlayersUI(){
  playersCount.textContent = `Players: ${players.size}`;
  playersList.innerHTML = "";
  const arr = Array.from(players.entries()).map(([pid,p])=>({pid,...p}));
  arr.sort((a,b)=> (b.score||0)-(a.score||0) || a.name.localeCompare(b.name));
  for(const p of arr){
    const chip=document.createElement("div");
    chip.className="playerChip";
    const dot=document.createElement("span");
    dot.className="dot"; dot.style.background=p.color||"#79d7ff";
    const nm=document.createElement("span");
    nm.textContent = p.name + (p.pid===myId?" (You)":"");
    const st=document.createElement("span");
    st.className = p.ready ? "ready":"notready";
    st.textContent = p.ready ? "READY":"WAIT";
    chip.appendChild(dot); chip.appendChild(nm); chip.appendChild(st);
    playersList.appendChild(chip);
  }
}

function broadcast(obj){
  const s = JSON.stringify(obj);
  for(const c of conns.values()){
    try{ c.send(s);}catch(e){}
  }
}
function sendHost(obj){
  if(!hostConn) return;
  try{ hostConn.send(JSON.stringify(obj)); }catch(e){}
}

function destroyPeer(){
  try{ peer?.destroy(); }catch(e){}
  peer=null; conns.clear(); hostConn=null; myId=null;
}

function enterLobby(role){
  lobbyArea.classList.remove("hidden");
  panel.classList.remove("hidden");
  roleBadge.textContent = role;
  rebuildPlayersUI();
  setOverlay(false);
}

// ---------- maze ----------
function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeMaze(w,h,seed){
  const rnd=mulberry32(seed>>>0);
  const cells=Array.from({length:h},()=>Array.from({length:w},()=>({n:true,e:true,s:true,w:true,v:false})));
  const dirs=[[0,-1,"n","s"],[1,0,"e","w"],[0,1,"s","n"],[-1,0,"w","e"]];
  const sx=Math.floor(rnd()*w), sy=Math.floor(rnd()*h);
  const st=[[sx,sy]]; cells[sy][sx].v=true;
  while(st.length){
    const [cx,cy]=st[st.length-1];
    const cand=[];
    for(const [dx,dy,wa,wb] of dirs){
      const nx=cx+dx, ny=cy+dy;
      if(nx>=0&&nx<w&&ny>=0&&ny<h&&!cells[ny][nx].v) cand.push([nx,ny,wa,wb]);
    }
    if(!cand.length){ st.pop(); continue; }
    const [nx,ny,wa,wb]=cand[Math.floor(rnd()*cand.length)];
    cells[cy][cx][wa]=false; cells[ny][nx][wb]=false;
    cells[ny][nx].v=true; st.push([nx,ny]);
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) delete cells[y][x].v;
  return cells;
}
function bfsDist(cells,sx,sy){
  const h=cells.length,w=cells[0].length;
  const dist=Array.from({length:h},()=>Array(w).fill(-1));
  const q=[[sx,sy]]; dist[sy][sx]=0;
  let qi=0;
  while(qi<q.length){
    const [x,y]=q[qi++], d=dist[y][x], c=cells[y][x];
    if(!c.n && y>0 && dist[y-1][x]<0){dist[y-1][x]=d+1;q.push([x,y-1]);}
    if(!c.s && y<h-1 && dist[y+1][x]<0){dist[y+1][x]=d+1;q.push([x,y+1]);}
    if(!c.w && x>0 && dist[y][x-1]<0){dist[y][x-1]=d+1;q.push([x-1,y]);}
    if(!c.e && x<w-1 && dist[y][x+1]<0){dist[y][x+1]=d+1;q.push([x+1,y]);}
  }
  return dist;
}
function pickStartGoal(cells,seed){
  const h=cells.length,w=cells[0].length;
  const rnd=mulberry32((seed*99991+7)>>>0);
  // start edge
  const edge=Math.floor(rnd()*4);
  let sx,sy;
  if(edge===0){ sx=Math.floor(rnd()*w); sy=0; }
  if(edge===1){ sx=w-1; sy=Math.floor(rnd()*h); }
  if(edge===2){ sx=Math.floor(rnd()*w); sy=h-1; }
  if(edge===3){ sx=0; sy=Math.floor(rnd()*h); }
  const dist=bfsDist(cells,sx,sy);
  let best={x:sx,y:sy,d:0};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const d=dist[y][x]; if(d>best.d) best={x,y,d};
  }
  const thr=Math.max(8, Math.floor(best.d*0.75));
  const cand=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) if(dist[y][x]>=thr) cand.push({x,y});
  const g=cand.length ? cand[Math.floor(rnd()*cand.length)] : best;
  return {sx,sy,gx:g.x,gy:g.y};
}

// ---------- game state ----------
let phase="menu"; // menu|lobby|countdown|playing|round_end
let maze=null, mazeW=31, mazeH=21, cellSize=26;
let startCell={x:0,y:0}, goalCell={x:0,y:0};
let pos={x:0,y:0}; // in cell coords (float)
let r=0.28;
let keys=new Set();
let roundStart=0;
let countdownEnd=0;
let winnerLock=false;

window.addEventListener("keydown",(e)=>{
  const k=e.key.toLowerCase();
  if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)){
    keys.add(k); e.preventDefault();
  }
});
window.addEventListener("keyup",(e)=> keys.delete(e.key.toLowerCase()));

function canMoveTo(px,py){
  if(!maze) return true;
  const w=maze[0].length,h=maze.length;
  if(px<r||py<r||px>w-r||py>h-r) return false;
  const cx=Math.floor(px), cy=Math.floor(py);
  const c=maze[cy]?.[cx]; if(!c) return false;
  const lx=px-cx, ly=py-cy;
  if(c.n && ly-r<0) return false;
  if(c.s && ly+r>1) return false;
  if(c.w && lx-r<0) return false;
  if(c.e && lx+r>1) return false;
  return true;
}

function startRound(payload){
  maze=payload.maze;
  mazeW=payload.w; mazeH=payload.h; cellSize=payload.cellSize;
  startCell=payload.start; goalCell=payload.goal;
  pos.x=startCell.x+0.5; pos.y=startCell.y+0.5;
  roundStart=nowMs();
  winnerLock=false;
  phase="playing";
  setOverlay(false);
  playMusic();
}
function showScoreSlide(title, scoreMap){
  scoreTitle.textContent = title;
  scoreRows.innerHTML="";
  const arr=Object.entries(scoreMap).map(([pid,sc])=>({pid,sc,name:players.get(pid)?.name||pid,color:players.get(pid)?.color||"#79d7ff"}));
  arr.sort((a,b)=>b.sc-a.sc||a.name.localeCompare(b.name));
  for(const row of arr){
    const div=document.createElement("div"); div.className="scoreRow";
    const dot=document.createElement("span"); dot.className="dot"; dot.style.background=row.color;
    const nm=document.createElement("span"); nm.className="scoreName"; nm.textContent=row.name;
    const num=document.createElement("span"); num.className="scoreNum bump"; num.textContent=String(row.sc);
    div.appendChild(dot); div.appendChild(nm); div.appendChild(num);
    scoreRows.appendChild(div);
  }
  scoreSlide.classList.remove("hidden");
  scoreSlide.style.animation="slideIn .35s ease";
  setTimeout(()=>{
    scoreSlide.style.animation="slideOut .35s ease";
    setTimeout(()=>scoreSlide.classList.add("hidden"), 360);
  }, 2200);
}
function resetToMenu(){
  phase="menu";
  isHost=false; myReady=false;
  players.clear(); rebuildPlayersUI();
  lobbyArea.classList.add("hidden");
  panel.classList.remove("hidden");
  setOverlay(false);
  roomStatus.textContent="未接続";
  stopMusic();
  setMsg("");
}

// ---------- net messages ----------
function onData(raw, from){
  let m=raw;
  if(typeof raw==="string"){
    try{ m=JSON.parse(raw);}catch(e){return;}
  }
  if(!m||!m.t) return;

  if(m.t==="players" && !isHost){
    players.clear();
    for(const p of m.players) players.set(p.pid, {name:p.name,color:p.color,ready:p.ready,score:p.score||0});
    rebuildPlayersUI();
  }

  if(m.t==="hello" && isHost){
    if(phase!=="lobby") { // reject late join
      try{ conns.get(from)?.send(JSON.stringify({t:"locked"})); }catch(e){}
      try{ conns.get(from)?.close(); }catch(e){}
      conns.delete(from);
      return;
    }
    const p={name:m.name||from,color:colorFor(from),ready:false,score:0};
    players.set(from,p);
    hostSyncPlayers();
  }

  if(m.t==="ready" && isHost){
    const p=players.get(from); if(!p) return;
    p.ready=!!m.value; players.set(from,p);
    hostSyncPlayers();
    broadcast({t:"ready_beep"});
    hostCheckAllReady();
  }

  if(m.t==="ready_beep"){
    beep(880,0.08,0.045);
  }

  if(m.t==="countdown"){
    phase="countdown";
    countdownEnd = nowMs() + (m.sec||5)*1000;
    panel.classList.add("hidden");
    setOverlay(true, String(m.sec||5), "迷路を生成中…", "MAZE RUN");
  }

  if(m.t==="start_round"){
    panel.classList.add("hidden");
    startRound(m.payload);
  }

  if(m.t==="goal" && isHost){
    if(winnerLock) return;
    winnerLock=true;
    const winnerPid=from;
    const winnerName=players.get(winnerPid)?.name||winnerPid;
    const wp=players.get(winnerPid); if(wp){ wp.score=(wp.score||0)+1; players.set(winnerPid,wp); }
    const scoreMap={}; for(const [pid,p] of players.entries()) scoreMap[pid]=p.score||0;
    broadcast({t:"round_winner", name:winnerName, winnerPid, scores:scoreMap});
    hostSyncPlayers();
    stopMusic();
    // next
    const winScore=scoreMap[winnerPid]||0;
    if(winScore>=8){
      broadcast({t:"match_winner", name:winnerName});
      setTimeout(()=>hostResetAll(), 3500);
    }else{
      setTimeout(()=>hostNextRound(), 2600);
    }
  }

  if(m.t==="round_winner"){
    phase="round_end";
    stopMusic();
    showScoreSlide(`${m.name} が最速ゴール！ +1`, m.scores);
  }

  if(m.t==="match_winner"){
    phase="round_end";
    stopMusic();
    setOverlay(true,"WIN",`${m.name} の勝利！\nリセットします…`,"MAZE RUN");
    beep(988,0.12,0.05); beep(1318,0.14,0.05);
  }

  if(m.t==="reset"){
    // back to lobby
    stopMusic();
    setOverlay(false);
    panel.classList.remove("hidden");
    lobbyArea.classList.remove("hidden");
    phase="lobby";
    myReady=false;
    readyBtn.textContent="準備OK";
    players.clear();
    for(const p of m.players) players.set(p.pid,{name:p.name,color:p.color,ready:p.ready,score:p.score||0});
    rebuildPlayersUI();
    setMsg("リセット完了。準備OKで開始。");
  }

  if(m.t==="locked"){
    setMsg("この部屋はゲーム中で参加できない。");
    destroyPeer();
    resetToMenu();
  }
}

function hostSyncPlayers(){
  if(!isHost) return;
  rebuildPlayersUI();
  broadcast({t:"players", players: Array.from(players.entries()).map(([pid,p])=>({pid,...p}))});
}
function hostCheckAllReady(){
  if(!isHost) return;
  if(players.size<1) return;
  for(const p of players.values()) if(!p.ready) return;
  hostStart();
}

function hostStart(){
  if(phase!=="lobby") return;
  phase="countdown";
  winnerLock=false;
  broadcast({t:"countdown", sec:5});
  countdownEnd = nowMs()+5000;
  panel.classList.add("hidden");
  setOverlay(true,"5","迷路を生成中…","MAZE RUN");
  // generate during countdown, send near end
  setTimeout(()=>hostSendRound(), 4800);
}

function hostSendRound(){
  if(!isHost) return;
  const seed = (Date.now() ^ (Math.random()*1e9|0))>>>0;
  const w=mazeW,h=mazeH;
  const cells=makeMaze(w,h,seed);
  const sg=pickStartGoal(cells,seed);
  const payload={seed,w,h,cellSize,maze:cells,start:{x:sg.sx,y:sg.sy},goal:{x:sg.gx,y:sg.gy}};
  startRound(payload);
  broadcast({t:"start_round", payload});
}

function hostNextRound(){
  if(!isHost) return;
  // keep everyone ready for auto-continue
  for(const [pid,p] of players.entries()){ p.ready=true; players.set(pid,p); }
  hostSyncPlayers();
  winnerLock=false;
  broadcast({t:"countdown", sec:5});
  countdownEnd = nowMs()+5000;
  setOverlay(true,"5","次の迷路を生成中…","MAZE RUN");
  setTimeout(()=>hostSendRound(), 4800);
}

function hostResetAll(){
  if(!isHost) return;
  // reset scores and ready
  for(const [pid,p] of players.entries()){
    p.score=0; p.ready=false;
    players.set(pid,p);
  }
  phase="lobby";
  const payloadPlayers = Array.from(players.entries()).map(([pid,p])=>({pid,...p}));
  broadcast({t:"reset", players: payloadPlayers});
  panel.classList.remove("hidden");
  lobbyArea.classList.remove("hidden");
  setOverlay(false);
  myReady=false;
  readyBtn.textContent="準備OK";
  rebuildPlayersUI();
}

// ---------- UI events ----------
createBtn.addEventListener("click", async ()=>{
  myName=safeName(nameInput.value);
  roomCode=safeRoom(roomInput.value);
  if(!myName){ setMsg("名前を入れて"); return; }
  if(!roomCode){ setMsg("部屋コードを入れて（英数字/_/-）"); return; }
  await unlockAudio();

  isHost=true;
  destroyPeer();
  setMsg("ホスト作成中…");
  roomStatus.textContent=`Room: ${roomCode} (host)`;

  peer = new Peer(roomCode);
  peer.on("open",(id)=>{
    myId=id;
    players.clear();
    players.set(myId,{name:myName,color:colorFor(myId),ready:false,score:0});
    enterLobby("HOST");
    hostSyncPlayers();
    setMsg("部屋できた。友達に部屋コードを送って。");
    phase="lobby";
  });
  peer.on("connection",(conn)=>{
    if(phase!=="lobby"){
      try{ conn.send(JSON.stringify({t:"locked"})); }catch(e){}
      try{ conn.close(); }catch(e){}
      return;
    }
    conns.set(conn.peer, conn);
    conn.on("data",(d)=>onData(d, conn.peer));
    conn.on("close",()=>{
      conns.delete(conn.peer);
      players.delete(conn.peer);
      hostSyncPlayers();
      setMsg("誰かが退出した");
    });
  });
  peer.on("error",(err)=>{
    console.error(err);
    setMsg("作成失敗：その部屋コードは使われてるかも。別のコードにして。");
  });
});

joinBtn.addEventListener("click", async ()=>{
  myName=safeName(nameInput.value);
  roomCode=safeRoom(roomInput.value);
  if(!myName){ setMsg("名前を入れて"); return; }
  if(!roomCode){ setMsg("部屋コードを入れて（英数字/_/-）"); return; }
  await unlockAudio();

  isHost=false;
  destroyPeer();
  setMsg("参加中…");
  roomStatus.textContent=`Room: ${roomCode} (guest)`;

  peer = new Peer();
  peer.on("open",(id)=>{
    myId=id;
    players.clear();
    players.set(myId,{name:myName,color:colorFor(myId),ready:false,score:0});
    enterLobby("GUEST");
    rebuildPlayersUI();

    hostConn = peer.connect(roomCode, {reliable:true});
    hostConn.on("open",()=>{
      hostConn.send(JSON.stringify({t:"hello", name:myName}));
      phase="lobby";
      setMsg("接続OK。準備OKを押して待って。");
    });
    hostConn.on("data",(d)=>onData(d, roomCode));
    hostConn.on("close",()=>{
      setMsg("接続が切れた。");
      destroyPeer();
      resetToMenu();
    });
    hostConn.on("error",()=> setMsg("接続失敗。部屋コードが違うかも。"));
  });
  peer.on("error",(err)=>{
    console.error(err);
    setMsg("参加失敗：" + (err?.type||"error"));
  });
});

readyBtn.addEventListener("click", async ()=>{
  await unlockAudio();
  myReady = !myReady;
  readyBtn.textContent = myReady ? "準備解除" : "準備OK";
  if(isHost){
    const p=players.get(myId);
    if(p){ p.ready=myReady; players.set(myId,p); }
    hostSyncPlayers();
    broadcast({t:"ready_beep"});
    hostCheckAllReady();
  }else{
    sendHost({t:"ready", value: myReady});
  }
});

leaveBtn.addEventListener("click", ()=>{
  try{
    if(isHost){
      for(const c of conns.values()) try{ c.close(); }catch(e){}
    }else{
      try{ hostConn?.close(); }catch(e){}
    }
  }catch(e){}
  destroyPeer();
  resetToMenu();
});

// ---------- canvas resize ----------
function resize(){
  const dpr=Math.max(1, Math.min(2, window.devicePixelRatio||1));
  canvas.width = Math.floor(window.innerWidth*dpr);
  canvas.height = Math.floor(window.innerHeight*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", resize);
resize();

// ---------- loop ----------
function drawGrid(){
  const w=window.innerWidth, h=window.innerHeight;
  ctx.save();
  ctx.strokeStyle="rgba(121,215,255,.06)";
  ctx.lineWidth=1;
  const step=42;
  for(let x=0;x<w;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.restore();
}

function drawMaze(){
  const w=maze[0].length, h=maze.length;
  const margin=80;
  const maxCX=(window.innerWidth - margin*2)/w;
  const maxCY=(window.innerHeight - margin*2 - 120)/h;
  const cs=Math.floor(Math.max(14, Math.min(30, Math.min(maxCX, maxCY))));
  cellSize=cs;
  const totalW=w*cs, totalH=h*cs;
  const ox=Math.floor((window.innerWidth-totalW)/2);
  const oy=Math.floor((window.innerHeight-totalH)/2);

  ctx.save();
  ctx.translate(ox,oy);
  ctx.lineWidth=2;
  ctx.strokeStyle="rgba(121,215,255,.35)";
  ctx.shadowColor="rgba(121,215,255,.15)";
  ctx.shadowBlur=10;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const c=maze[y][x];
      const px=x*cs, py=y*cs;
      ctx.beginPath();
      if(c.n){ ctx.moveTo(px,py); ctx.lineTo(px+cs,py); }
      if(c.e){ ctx.moveTo(px+cs,py); ctx.lineTo(px+cs,py+cs); }
      if(c.s){ ctx.moveTo(px+cs,py+cs); ctx.lineTo(px,py+cs); }
      if(c.w){ ctx.moveTo(px,py+cs); ctx.lineTo(px,py); }
      ctx.stroke();
    }
  }

  // goal
  const gx=(goalCell.x+0.5)*cs, gy=(goalCell.y+0.5)*cs;
  ctx.fillStyle="rgba(255,216,74,.18)";
  ctx.beginPath(); ctx.arc(gx,gy,cs*0.46,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="rgba(255,216,74,.75)";
  ctx.beginPath(); ctx.arc(gx,gy,cs*0.18,0,Math.PI*2); ctx.fill();

  // start dot
  const sx=(startCell.x+0.5)*cs, sy=(startCell.y+0.5)*cs;
  ctx.fillStyle="rgba(77,255,138,.65)";
  ctx.beginPath(); ctx.arc(sx,sy,cs*0.12,0,Math.PI*2); ctx.fill();

  // player (self only)
  const px=pos.x*cs, py=pos.y*cs;
  ctx.fillStyle=colorFor(myId||"me");
  ctx.shadowColor=colorFor(myId||"me");
  ctx.shadowBlur=18;
  ctx.beginPath(); ctx.arc(px,py,cs*0.22,0,Math.PI*2); ctx.fill();

  ctx.restore();

  // hint
  ctx.save();
  ctx.fillStyle="rgba(255,255,255,.85)";
  ctx.font="14px system-ui";
  ctx.fillText("WASD / 矢印キーで移動。最速ゴールで+1。8ラウンドで勝利。", 18, window.innerHeight-18);
  ctx.restore();
}

function update(dt){
  if(phase!=="playing") return;
  const speed=3.1;
  let vx=0, vy=0;
  if(keys.has("w")||keys.has("arrowup")) vy-=1;
  if(keys.has("s")||keys.has("arrowdown")) vy+=1;
  if(keys.has("a")||keys.has("arrowleft")) vx-=1;
  if(keys.has("d")||keys.has("arrowright")) vx+=1;
  const len=Math.hypot(vx,vy)||1;
  vx/=len; vy/=len;

  const nx=pos.x+vx*speed*dt;
  const ny=pos.y+vy*speed*dt;
  if(canMoveTo(nx,pos.y)) pos.x=nx;
  if(canMoveTo(pos.x,ny)) pos.y=ny;

  const gx=goalCell.x+0.5, gy=goalCell.y+0.5;
  if(!winnerLock && Math.hypot(pos.x-gx,pos.y-gy) < 0.35){
    winnerLock=true;
    if(isHost) onData({t:"goal"}, myId);
    else sendHost({t:"goal"});
  }
}

let last=nowMs();
let lastCountdownShown=null;

function loop(){
  const t=nowMs();
  const dt=Math.min(0.033, (t-last)/1000);
  last=t;

  // countdown overlay
  if(phase==="countdown"){
    const rem=Math.max(0, countdownEnd - t);
    const sec=Math.ceil(rem/1000);
    overlayBig.textContent=String(sec);
    overlaySub.textContent="迷路を生成中…";
    if(lastCountdownShown!==sec){
      if(sec>0) beep(660+(5-sec)*60,0.08,0.04);
      lastCountdownShown=sec;
    }
  }else{
    lastCountdownShown=null;
  }

  // time
  if(phase==="playing"){
    timeStatus.textContent = `Time: ${((t-roundStart)/1000).toFixed(3)}s`;
  }else{
    timeStatus.textContent = "Time: 0.000s";
  }

  update(dt);

  // draw
  ctx.clearRect(0,0,window.innerWidth,window.innerHeight);
  drawGrid();
  if(maze && (phase==="playing"||phase==="round_end")) drawMaze();
  else{
    ctx.save();
    ctx.fillStyle="rgba(255,255,255,.08)";
    ctx.font="900 80px system-ui";
    ctx.fillText("MAZE RUN", 36, 120);
    ctx.restore();
  }

  requestAnimationFrame(loop);
}
loop();

resetToMenu();
