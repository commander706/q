/* global Peer */
(() => {
  "use strict";
  const $ = (q)=>document.querySelector(q);

  const el = {
    netPill: $("#netPill"),
    copyInviteBtn: $("#copyInviteBtn"),
    viewHome: $("#viewHome"),
    viewCreate: $("#viewCreate"),
    viewFind: $("#viewFind"),
    viewLobby: $("#viewLobby"),
    viewGame: $("#viewGame"),
    btnCreate: $("#btnCreate"),
    btnFind: $("#btnFind"),
    btnBackFromCreate: $("#btnBackFromCreate"),
    btnBackFromFind: $("#btnBackFromFind"),
    btnDoCreate: $("#btnDoCreate"),
    segPrivate: $("#segPrivate"),
    segPublic: $("#segPublic"),
    privateCodeField: $("#privateCodeField"),
    createCode: $("#createCode"),
    joinCode: $("#joinCode"),
    btnJoinByCode: $("#btnJoinByCode"),
    publicNote: $("#publicNote"),
    publicList: $("#publicList"),
    lobbyMode: $("#lobbyMode"),
    lobbyCode: $("#lobbyCode"),
    lobbyRole: $("#lobbyRole"),
    lobbyCount: $("#lobbyCount"),
    lobbyState: $("#lobbyState"),
    btnReady: $("#btnReady"),
    btnLeave: $("#btnLeave"),
    chatLog: $("#chatLog"),
    chatInput: $("#chatInput"),
    chatSend: $("#chatSend"),
    latencyLine: $("#latencyLine"),
    canvas: $("#gameCanvas"),
    scoreL: $("#scoreL"),
    scoreR: $("#scoreR"),
    centerOverlay: $("#centerOverlay"),
    centerText: $("#centerText"),
    centerSub: $("#centerSub"),
    btnExitGame: $("#btnExitGame"),
  };

  function showView(v){
    [el.viewHome,el.viewCreate,el.viewFind,el.viewLobby,el.viewGame].forEach(x=>x.classList.add("hidden"));
    v.classList.remove("hidden");
  }
  function setPill(t, ok){
    el.netPill.textContent=t;
    el.netPill.style.borderColor = ok ? "rgba(0,212,255,.55)" : "rgba(255,255,255,.10)";
  }
  const now = ()=>performance.now();

  // ---------------- room utils ----------------
  const sanitize = (s)=>String(s??"").trim().replace(/[\/\\?#]/g,"_").slice(0,32);
  const randCode = ()=>{
    const a="abcdefghjkmnpqrstuvwxyz23456789";
    let s=""; for(let i=0;i<6;i++) s+=a[(Math.random()*a.length)|0];
    return s;
  };
  const hostId = (code,isPublic)=>(isPublic?"pong_pub_":"pong_")+code;
  const inviteUrl = (code,isPublic)=>{
    const u=new URL(location.origin+location.pathname);
    u.searchParams.set("join", code);
    u.searchParams.set("pub", isPublic?"1":"0");
    return u.toString();
  };
  const parseJoin = ()=>{
    const sp=new URLSearchParams(location.search);
    const join=sp.get("join");
    if(!join) return null;
    return { code:sanitize(join), isPublic: sp.get("pub")==="1" };
  };

  // ---------------- app state ----------------
  const st = {
    peer:null, conn:null,
    role:"none", // host|guest
    code:"", isPublic:false,
    readySelf:false, readyOther:false,
    pingT0:0, rtt:null,
    invite:"",
    game:null
  };

  function destroyPeer(){
    if(st.conn){ try{st.conn.close();}catch{} st.conn=null; }
    if(st.peer){ try{st.peer.destroy();}catch{} st.peer=null; }
    st.role="none"; st.code=""; st.isPublic=false;
    st.readySelf=false; st.readyOther=false;
    st.rtt=null; st.invite="";
    el.copyInviteBtn.disabled=true;
  }

  function updateLobby(){
    el.lobbyMode.textContent = st.isPublic ? "公開" : "プライベート";
    el.lobbyCode.textContent = st.code || "-";
    el.lobbyRole.textContent = st.role==="host" ? "ホスト（左）" : st.role==="guest" ? "ゲスト（右）" : "-";
    const count = st.role==="host" ? (st.conn && st.conn.open ? 2:1) : (st.role==="guest"?2:0);
    el.lobbyCount.textContent = `${count}/2`;
    el.lobbyState.textContent = `準備: 自分 ${st.readySelf?"✅":"…"} / 相手 ${st.readyOther?"✅":"…"}`
  }

  function addMsg(who, text){
    const d=document.createElement("div"); d.className="msg";
    d.innerHTML = `<div class="t">${who} • ${new Date().toLocaleTimeString()}</div><div class="b"></div>`;
    d.querySelector(".b").textContent=text;
    el.chatLog.appendChild(d);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  function send(obj){
    if(st.conn && st.conn.open) st.conn.send(obj);
  }

  function startPing(){
    setInterval(()=>{
      if(!st.conn || !st.conn.open) return;
      st.pingT0 = now();
      send({t:"ping", t0: st.pingT0});
    }, 1000);
  }

  function onData(m){
    if(!m || typeof m!=="object") return;
    if(m.t==="ping"){ send({t:"pong", t0:m.t0}); return; }
    if(m.t==="pong"){
      st.rtt = now() - (m.t0||0);
      el.latencyLine.textContent = `RTT: ${(st.rtt/1000).toFixed(3)}s`;
      return;
    }
    if(m.t==="chat"){ addMsg("相手", m.text||""); send({t:"ack", id:m.id}); return; }
    if(m.t==="ack"){ return; }
    if(m.t==="ready"){ st.readyOther=!!m.v; updateLobby(); if(st.role==="host") maybeStart(); return; }
    if(m.t==="countdown"){ showCountdown(m.n); return; }
    if(m.t==="begin"){ if(st.role==="guest") beginGameGuest(); return; }
    if(m.t==="in"){ if(st.role==="host" && st.game){ st.game.inR = {up:!!m.up, down:!!m.down}; } return; }
    if(m.t==="st"){ if(st.role==="guest" && st.game){ st.game.remote = m.gs; } return; }
    if(m.t==="end"){ showWin(m.winner); return; }
  }

  function hookConn(conn){
    st.conn=conn;
    conn.on("open", ()=>{
      setPill("P2P 接続OK", true);
      addMsg("SYSTEM","接続しました");
      updateLobby();
      startPing();
    });
    conn.on("data", onData);
    conn.on("close", ()=>{
      addMsg("SYSTEM","切断されました");
      setPill("切断", false);
      stopGame();
      destroyPeer();
      showView(el.viewHome);
    });
    conn.on("error", (e)=>{
      console.error(e);
      addMsg("SYSTEM","接続エラー");
      setPill("接続エラー", false);
    });
  }

  // ---------------- game core ----------------
  const G = { w:1000, h:560, pw:14, ph:110, ps:520, br:10, bs:520, bmax:980, accel:1.06, win:7 };

  function newGS(){
    return { scoreL:0, scoreR:0, leftY:G.h/2, rightY:G.h/2, ballX:G.w/2, ballY:G.h/2, vx:0, vy:0, running:false };
  }
  function resetBall(gs, dir){
    const ang=(Math.random()*0.7-0.35);
    const sp=G.bs;
    gs.ballX=G.w/2; gs.ballY=G.h/2;
    gs.vx=Math.cos(ang)*sp*dir;
    gs.vy=Math.sin(ang)*sp;
  }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function ensureCanvas(){
    const dpr=Math.max(1, Math.min(2, window.devicePixelRatio||1));
    const r = el.viewGame.getBoundingClientRect();
    const w=Math.max(320, (r.width|0)), h=Math.max(260,(r.height|0));
    el.canvas.width=(w*dpr)|0; el.canvas.height=(h*dpr)|0;
    const ctx=el.canvas.getContext("2d",{alpha:false});
    ctx.setTransform(dpr,0,0,dpr,0,0);
    st.game.ctx=ctx; st.game.viewW=w; st.game.viewH=h;
  }
  const vx = x=> x/G.w * st.game.viewW;
  const vy = y=> y/G.h * st.game.viewH;
  const vs = s=> s/G.w * st.game.viewW;

  function draw(gs){
    const ctx=st.game.ctx, W=st.game.viewW, H=st.game.viewH;
    ctx.fillStyle="#03050a"; ctx.fillRect(0,0,W,H);
    // net
    ctx.fillStyle="rgba(255,255,255,.10)";
    const nx=W/2-3;
    for(let y=0;y<H;y+=30) ctx.fillRect(nx,y+10,6,16);

    // paddles
    ctx.fillStyle="rgba(0,212,255,.95)";
    ctx.fillRect(vx(40), vy(gs.leftY-G.ph/2), vs(G.pw), vy(G.ph)-vy(0));
    ctx.fillStyle="rgba(255,210,0,.95)";
    ctx.fillRect(vx(G.w-40-G.pw), vy(gs.rightY-G.ph/2), vs(G.pw), vy(G.ph)-vy(0));

    // ball
    ctx.fillStyle="#e9f2ff";
    ctx.beginPath(); ctx.arc(vx(gs.ballX), vy(gs.ballY), vs(G.br), 0, Math.PI*2); ctx.fill();

    el.scoreL.textContent=String(gs.scoreL);
    el.scoreR.textContent=String(gs.scoreR);
  }

  function stepHost(gs, dt){
    // paddles
    const mP=(y,input)=>{
      let dy=0;
      if(input.up) dy-=G.ps*dt;
      if(input.down) dy+=G.ps*dt;
      return clamp(y+dy, G.ph/2, G.h-G.ph/2);
    };
    gs.leftY = mP(gs.leftY, st.game.inL);
    gs.rightY = mP(gs.rightY, st.game.inR);

    // ball
    gs.ballX += gs.vx*dt;
    gs.ballY += gs.vy*dt;

    // walls
    if(gs.ballY < G.br){ gs.ballY=G.br; gs.vy*=-1; }
    if(gs.ballY > G.h-G.br){ gs.ballY=G.h-G.br; gs.vy*=-1; }

    // paddles collision
    const lpX=40, rpX=G.w-40-G.pw;
    const hit = (pX, pY, dir)=>{
      // reflect with angle
      const rel=(gs.ballY - pY)/(G.ph/2);
      const sp=Math.min(G.bmax, Math.hypot(gs.vx,gs.vy)*G.accel);
      const ang = rel*0.75;
      gs.vx = Math.cos(ang)*sp*dir;
      gs.vy = Math.sin(ang)*sp;
    };

    // left
    if(gs.vx<0 && gs.ballX-G.br <= lpX+G.pw && gs.ballX>lpX &&
       gs.ballY >= gs.leftY-G.ph/2 && gs.ballY <= gs.leftY+G.ph/2){
      gs.ballX = lpX+G.pw+G.br;
      hit(lpX, gs.leftY, +1);
    }
    // right
    if(gs.vx>0 && gs.ballX+G.br >= rpX && gs.ballX<rpX+G.pw &&
       gs.ballY >= gs.rightY-G.ph/2 && gs.ballY <= gs.rightY+G.ph/2){
      gs.ballX = rpX-G.br;
      hit(rpX, gs.rightY, -1);
    }

    // score
    if(gs.ballX < -60){
      gs.scoreR++;
      if(gs.scoreR>=G.win) return "R";
      resetBall(gs, -1);
    }
    if(gs.ballX > G.w+60){
      gs.scoreL++;
      if(gs.scoreL>=G.win) return "L";
      resetBall(gs, +1);
    }
    return null;
  }

  // input
  const keys=new Set();
  function keyDown(e){
    if(["ArrowUp","ArrowDown","w","W","s","S"].includes(e.key)) e.preventDefault();
    keys.add(e.key); updateInput();
  }
  function keyUp(e){ keys.delete(e.key); updateInput(); }

  function updateInput(){
    const isHost = st.role==="host";
    const up = isHost ? (keys.has("w")||keys.has("W")) : keys.has("ArrowUp");
    const down = isHost ? (keys.has("s")||keys.has("S")) : keys.has("ArrowDown");
    if(!st.game) return;
    if(isHost){
      st.game.inL = {up, down};
    }else{
      st.game.inR = {up, down};
      // send to host (throttle 30Hz)
      const pack = (up?1:0)*2 + (down?1:0);
      if(pack!==st.game._lastPack || now()-(st.game._lastSend||0)>80){
        st.game._lastPack=pack; st.game._lastSend=now();
        send({t:"in", up, down});
      }
    }
  }

  function startLoopHost(){
    const dtFix=1/120;
    const loop=()=>{
      if(!st.game) return;
      const t=now();
      st.game.acc = (st.game.acc||0) + Math.min(50, t-st.game.last)/1000;
      st.game.last=t;

      while(st.game.acc>=dtFix){
        const w = stepHost(st.game.gs, dtFix);
        if(w){ endGame(w); break; }
        st.game.acc-=dtFix;
      }

      // send snapshot 30Hz
      if(t-(st.game.lastSnap||0) > 33){
        st.game.lastSnap=t;
        send({t:"st", gs: st.game.gs});
      }

      draw(st.game.gs);
      st.game.raf=requestAnimationFrame(loop);
    };
    st.game.last=now();
    st.game.raf=requestAnimationFrame(loop);
  }

  function startLoopGuest(){
    const loop=()=>{
      if(!st.game) return;
      const gs = st.game.remote || st.game.gs;
      draw(gs);
      st.game.raf=requestAnimationFrame(loop);
    };
    st.game.raf=requestAnimationFrame(loop);
  }

  function stopGame(){
    if(!st.game) return;
    try{ cancelAnimationFrame(st.game.raf);}catch{}
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp);
    st.game=null;
    el.centerOverlay.classList.add("hidden");
  }

  function showCountdown(n){
    el.centerOverlay.classList.remove("hidden");
    el.centerSub.textContent="開始まで";
    el.centerText.textContent = (n===0) ? "GO!" : String(n);
    if(n===0) setTimeout(()=>el.centerOverlay.classList.add("hidden"), 520);
  }

  function showWin(w){
    el.centerOverlay.classList.remove("hidden");
    el.centerSub.textContent="7点先取";
    el.centerText.textContent = (w==="L") ? "LEFT WIN" : "RIGHT WIN";
  }

  function beginGameHost(){
    showView(el.viewGame);
    st.game = { gs:newGS(), inL:{up:false,down:false}, inR:{up:false,down:false} };
    ensureCanvas();
    st.game.gs.running=true;
    resetBall(st.game.gs, Math.random()<0.5?-1:+1);

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    startLoopHost();
  }

  function beginGameGuest(){
    showView(el.viewGame);
    st.game = { gs:newGS(), remote:null, inR:{up:false,down:false} };
    ensureCanvas();
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    startLoopGuest();
  }

  function endGame(w){
    showWin(w);
    send({t:"end", winner:w});
  }

  // ---------------- ready / start ----------------
  function maybeStart(){
    if(st.role!=="host") return;
    if(!st.readySelf || !st.readyOther) return;

    // countdown
    let n=3;
    showCountdown(n);
    send({t:"countdown", n});
    const tick=()=>{
      n--;
      if(n<=0){
        showCountdown(0);
        send({t:"countdown", n:0});
        setTimeout(()=>{
          el.centerOverlay.classList.add("hidden");
          beginGameHost();
          send({t:"begin"});
        }, 450);
        return;
      }
      showCountdown(n);
      send({t:"countdown", n});
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  // ---------------- create/join ----------------
  function enterLobby(){
    showView(el.viewLobby);
    el.chatLog.innerHTML="";
    addMsg("SYSTEM","ロビーへ。相手を待っています。");
    updateLobby();
    el.copyInviteBtn.disabled = !st.code;
    el.latencyLine.textContent = "RTT: -";
  }

  function createRoom(isPublic, code){
    destroyPeer();
    st.role="host"; st.isPublic=!!isPublic; st.code=sanitize(code || randCode());
    const pid=hostId(st.code, st.isPublic);
    st.invite = inviteUrl(st.code, st.isPublic);

    st.peer = new Peer(pid);
    st.peer.on("open", ()=>{
      setPill(`ルーム作成: ${st.code}`, true);
      enterLobby();
      el.copyInviteBtn.disabled=false;
    });
    st.peer.on("connection", (conn)=>{
      if(st.conn && st.conn.open){ try{conn.close();}catch{} return; }
      hookConn(conn);
      addMsg("SYSTEM","相手が入室しました。準備OKを待っています。");
      updateLobby();
    });
    st.peer.on("error", (e)=>{
      console.error(e);
      setPill(`Peer Error: ${e.type||"error"}`, false);
      addMsg("SYSTEM", `Peerエラー: ${e.type||e}`);
    });
  }

  function joinRoom(isPublic, code){
    destroyPeer();
    st.role="guest"; st.isPublic=!!isPublic; st.code=sanitize(code);
    st.peer = new Peer();
    st.peer.on("open", ()=>{
      setPill("参加準備OK", true);
      enterLobby();
      const hid=hostId(st.code, st.isPublic);
      addMsg("SYSTEM", `接続先: ${hid}`);
      const conn=st.peer.connect(hid, { reliable:true });
      hookConn(conn);
    });
    st.peer.on("error", (e)=>{
      console.error(e);
      setPill(`Peer Error: ${e.type||"error"}`, false);
      addMsg("SYSTEM", `Peerエラー: ${e.type||e}`);
    });
  }

  // public list best-effort
  async function tryPublic(){
    el.publicList.innerHTML="";
    el.publicNote.textContent="読み込み中…";
    const urls=["https://0.peerjs.com/peerjs/peers","https://peerjs.com/peerjs/peers"];
    for(const u of urls){
      try{
        const r=await fetch(u,{cache:"no-store"});
        if(!r.ok) throw 0;
        const peers=await r.json();
        if(!Array.isArray(peers)) throw 0;
        const pubs=peers.filter(x=>typeof x==="string" && x.startsWith("pong_pub_")).slice(0,30);
        if(!pubs.length){ el.publicNote.textContent="公開ルームなし"; return; }
        el.publicNote.textContent=`公開ルーム: ${pubs.length}件`;
        pubs.forEach(pid=>{
          const code=pid.replace(/^pong_pub_/,"");
          const item=document.createElement("div");
          item.className="item";
          item.innerHTML=`<div class="left"><div class="code">${code}</div><div class="meta">公開ルーム</div></div>`;
          const b=document.createElement("button");
          b.className="btn"; b.textContent="参加";
          b.onclick=()=>joinRoom(true, code);
          item.appendChild(b);
          el.publicList.appendChild(item);
        });
        return;
      }catch{}
    }
    el.publicNote.textContent="未対応（PeerServerのdiscoveryが無効の可能性）。コード参加は使えます。";
  }

  // ---------------- UI wiring ----------------
  el.btnCreate.onclick=()=>showView(el.viewCreate);
  el.btnFind.onclick=()=>{showView(el.viewFind); tryPublic();};
  el.btnBackFromCreate.onclick=()=>showView(el.viewHome);
  el.btnBackFromFind.onclick=()=>showView(el.viewHome);

  let createIsPublic=false;
  const setCreateMode=(pub)=>{
    createIsPublic=pub;
    el.segPrivate.classList.toggle("active", !pub);
    el.segPublic.classList.toggle("active", pub);
    el.privateCodeField.style.display = pub ? "none" : "block";
  };
  el.segPrivate.onclick=()=>setCreateMode(false);
  el.segPublic.onclick=()=>setCreateMode(true);
  setCreateMode(false);

  el.btnDoCreate.onclick=()=>{
    const code = createIsPublic ? randCode() : sanitize(el.createCode.value);
    if(!createIsPublic && !code){ alert("部屋コードを入力してね"); return; }
    createRoom(createIsPublic, code);
  };
  el.btnJoinByCode.onclick=()=>{
    const code=sanitize(el.joinCode.value);
    if(!code){ alert("部屋コードを入力してね"); return; }
    // pub/privateは分からないので、まずプライベート扱いで接続
    joinRoom(false, code);
  };

  el.btnReady.onclick=()=>{
    st.readySelf = !st.readySelf;
    el.btnReady.textContent = st.readySelf ? "準備OK解除" : "準備OK";
    send({t:"ready", v: st.readySelf});
    updateLobby();
    maybeStart();
  };
  el.btnLeave.onclick=()=>{ stopGame(); destroyPeer(); showView(el.viewHome); };
  el.btnExitGame.onclick=()=>{ stopGame(); destroyPeer(); showView(el.viewHome); };

  el.chatSend.onclick=()=>{
    const text=(el.chatInput.value||"").trim(); if(!text) return;
    el.chatInput.value="";
    addMsg("自分", text);
    send({t:"chat", id:Date.now(), text});
  };
  el.chatInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") el.chatSend.click(); });

  el.copyInviteBtn.onclick=async ()=>{
    if(!st.invite) return;
    try{ await navigator.clipboard.writeText(st.invite); addMsg("SYSTEM","招待URLをコピーしました"); }
    catch{
      const ta=document.createElement("textarea"); ta.value=st.invite; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); ta.remove();
      addMsg("SYSTEM","招待URLをコピーしました（fallback）");
    }
  };

  // ---------------- boot ----------------
  function boot(){
    showView(el.viewHome);
    setPill(`HTTP OK (${location.protocol.replace(":","")})`, true);

    const auto=parseJoin();
    if(auto && auto.code){
      addMsg("SYSTEM","招待URLで参加します…");
      joinRoom(auto.isPublic, auto.code);
    }
  }
  boot();
})();
