import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { PointerLockControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js";
import { createNoise2D } from "https://cdn.skypack.dev/simplex-noise";

import { generateWorld } from "./procgen.js";
import { Weapons, makeWeaponState } from "./weapons.js";
import { NetSession } from "./net.js";

/**
 * ------------------------------------------------------------
 * 3D Shooter (Solo / PeerJS P2P)
 * - Live Server でそのまま動く（index.html を開いてOK）
 * - GitHub Pages でも動く（静的サイト）
 * ------------------------------------------------------------
 */

const canvas = document.getElementById("c");
const overlay = document.getElementById("overlay");
const hud = document.getElementById("hud");

// Menu buttons
const soloBtn = document.getElementById("soloBtn");
const battleBtn = document.getElementById("battleBtn");
const battlePanel = document.getElementById("battlePanel");

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinIdInput = document.getElementById("joinId");
const startBtn = document.getElementById("startBtn");

const myIdEl = document.getElementById("myId");
const statusEl = document.getElementById("status");

// HUD elements
const hpFill = document.getElementById("hpFill");
const hpNum = document.getElementById("hpNum");
const weaponName = document.getElementById("weaponName");
const ammoEl = document.getElementById("ammo");
const reserveEl = document.getElementById("reserve");
const hint = document.getElementById("hint");

const netTitle = document.getElementById("netTitle");
const pingEl = document.getElementById("ping");
const roomIdEl = document.getElementById("roomId");

let mode = "menu"; // menu | solo | battleLobby | battleGame
let isOwner = false;

// Rendering core
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x050710, 20, 260);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 1200);
camera.position.set(0, 4.3, 10);

const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

const clock = new THREE.Clock();

// Lighting
const hemi = new THREE.HemisphereLight(0x9bb1ff, 0x0b0f1d, 0.70);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(60, 80, 30);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 1;
dir.shadow.camera.far = 300;
dir.shadow.camera.left = -120;
dir.shadow.camera.right = 120;
dir.shadow.camera.top = 120;
dir.shadow.camera.bottom = -120;
scene.add(dir);

// Ground helper grid (faint)
const grid = new THREE.GridHelper(600, 120, 0x28334f, 0x151a2b);
grid.material.transparent = true;
grid.material.opacity = 0.22;
scene.add(grid);

// State
const keys = new Set();
const mouse = { down: false };

const player = {
  hp: 100,
  maxHp: 100,
  speed: 9.0,
  dashMul: 1.7,
  jumpVel: 8.0,
  velY: 0,
  eyeHeight: 1.65,
  onGround: false,
  id: "me",
};

const otherPlayer = {
  id: "peer",
  hp: 100,
  maxHp: 100,
  mesh: null,
  lastNet: { pos: new THREE.Vector3(), yaw: 0, pitch: 0 },
};

let weaponState = makeWeaponState();
let currentWeaponIndex = 0;

let world = null;
let bots = [];
let seed = "seed-" + Math.floor(Math.random() * 1e9).toString(36);
let net = null;

function setHint(text) {
  hint.textContent = text;
}

function setHUDVisible(v) {
  hud.classList.toggle("hidden", !v);
}

function updateHUD() {
  const hp = Math.max(0, Math.min(player.maxHp, player.hp));
  hpNum.textContent = Math.round(hp).toString();
  hpFill.style.width = `${(hp / player.maxHp) * 100}%`;
  if (hp / player.maxHp < 0.33) {
    hpFill.style.background = "linear-gradient(90deg, rgba(255,80,80,.95), rgba(255,160,120,.95))";
  } else {
    hpFill.style.background = "linear-gradient(90deg, rgba(65,255,192,.95), rgba(120,160,255,.95))";
  }

  const w = Weapons[currentWeaponIndex];
  weaponName.textContent = w.name;
  ammoEl.textContent = weaponState.mag[currentWeaponIndex].toString();
  reserveEl.textContent = weaponState.reserve[currentWeaponIndex].toString();
}

function showMenu() {
  mode = "menu";
  overlay.classList.remove("hidden");
  battlePanel.classList.add("hidden");
  setHUDVisible(false);
  setHint("クリックで照準ロック（FPS操作）");
}

function showBattlePanel() {
  battlePanel.classList.remove("hidden");
  statusEl.textContent = "—";
}

function startGame(newMode, opts = {}) {
  mode = newMode;
  overlay.classList.add("hidden");
  setHUDVisible(true);
  controls.lock();

  // Reset player
  player.hp = player.maxHp;
  player.velY = 0;

  // World seed
  if (opts.seed) seed = opts.seed;
  Math.seedrandom(seed);

  // World generation
  if (world) world.dispose?.();
  world = generateWorld({
    scene,
    THREE,
    noise2D: createNoise2D(() => Math.random()),
    seed,
  });

  // Spawn
  controls.getObject().position.copy(world.spawn);
  controls.getObject().position.y = world.sampleHeight(world.spawn.x, world.spawn.z) + player.eyeHeight;

  // Bots for solo
  if (mode === "solo") {
    bots = world.spawnBots(10);
  } else {
    bots = [];
  }

  // Other player (battle)
  if (mode === "battleGame") {
    ensureOtherPlayerMesh();
    otherPlayer.mesh.visible = true;
    netTitle.textContent = isOwner ? "BATTLE (OWNER)" : "BATTLE";
    roomIdEl.textContent = net?.myId || "—";
  } else {
    netTitle.textContent = "SOLO";
    roomIdEl.textContent = "—";
    pingEl.textContent = "—";
    if (otherPlayer.mesh) otherPlayer.mesh.visible = false;
  }

  updateHUD();
}

function ensureOtherPlayerMesh() {
  if (otherPlayer.mesh) return;
  const g = new THREE.CapsuleGeometry(0.40, 1.05, 6, 12);
  const m = new THREE.MeshStandardMaterial({ color: 0x88aaff, roughness: 0.55, metalness: 0.1 });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.position.set(0, 3, 0);
  scene.add(mesh);
  otherPlayer.mesh = mesh;
}


// Bot -> player damage event (solo)
window.addEventListener("botHitPlayer", (e) => {
  if (mode !== "solo") return;
  const dmg = e?.detail?.dmg ?? 0;
  if (dmg <= 0) return;
  applyDamage(player, dmg);
  updateHUD();
  if (player.hp <= 0) {
    setHint("やられた… 3秒後にリスポーン");
    setTimeout(() => {
      if (mode !== "solo") return;
      controls.getObject().position.copy(world.spawn);
      controls.getObject().position.y = world.sampleHeight(world.spawn.x, world.spawn.z) + player.eyeHeight;
      player.hp = player.maxHp;
      updateHUD();
      setHint("");
    }, 3000);
  }
});

function connectControls() {
  document.addEventListener("keydown", (e) => {
    keys.add(e.code);

    // Weapon switch 1-4
    if (e.code === "Digit1") currentWeaponIndex = 0;
    if (e.code === "Digit2") currentWeaponIndex = 1;
    if (e.code === "Digit3") currentWeaponIndex = 2;
    if (e.code === "Digit4") currentWeaponIndex = 3;

    if (e.code === "KeyR") tryReload();
  });

  document.addEventListener("keyup", (e) => keys.delete(e.code));

  document.addEventListener("mousedown", () => (mouse.down = true));
  document.addEventListener("mouseup", () => (mouse.down = false));

  // Pointer lock click
  canvas.addEventListener("click", () => {
    if (mode !== "menu") controls.lock();
  });

  window.addEventListener("resize", onResize);
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

// Simple damage helper
function applyDamage(target, amount) {
  target.hp = Math.max(0, target.hp - amount);
}

// Reload
function tryReload() {
  const w = Weapons[currentWeaponIndex];
  const mag = weaponState.mag[currentWeaponIndex];
  const cap = w.magSize;
  if (mag >= cap) return;
  const avail = weaponState.reserve[currentWeaponIndex];
  if (avail <= 0) return;
  const need = cap - mag;
  const take = Math.min(need, avail);
  weaponState.mag[currentWeaponIndex] += take;
  weaponState.reserve[currentWeaponIndex] -= take;
  updateHUD();
}

// Shooting (raycast)
const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
function shoot(dt) {
  const w = Weapons[currentWeaponIndex];
  const now = performance.now();
  const cd = 1000 / w.fireRate;
  if (now - weaponState.lastShot < cd) return;

  if (weaponState.mag[currentWeaponIndex] <= 0) {
    setHint("弾切れ！Rでリロード");
    return;
  }

  weaponState.lastShot = now;
  weaponState.mag[currentWeaponIndex]--;
  updateHUD();

  // pellets
  const pellets = w.pellets ?? 1;

  for (let i = 0; i < pellets; i++) {
    // Spread
    const spread = w.spread;
    const dx = (Math.random() - 0.5) * spread;
    const dy = (Math.random() - 0.5) * spread;

    // Ray direction: camera forward + small offset
    const dirV = new THREE.Vector3();
    camera.getWorldDirection(dirV);
    dirV.add(new THREE.Vector3(dx, dy, 0)).normalize();

    raycaster.set(camera.getWorldPosition(tmpV), dirV);

    const targets = [];

    // Solo bots
    for (const b of bots) targets.push(b.mesh);

    // Battle other player
    if (mode === "battleGame" && otherPlayer.mesh?.visible) targets.push(otherPlayer.mesh);

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const obj = hit.object;

      if (mode === "solo") {
        const bot = bots.find((b) => b.mesh === obj);
        if (bot) {
          bot.hp -= w.damage;
          bot.flash(0.08);
          if (bot.hp <= 0) bot.respawn();
        }
      }

      if (mode === "battleGame") {
        if (obj === otherPlayer.mesh) {
          // Local hit confirmation (prototype)
          net?.send({ t: "hit", dmg: w.damage });
        }
      }
    }
  }
}

// Movement + collisions (simple)
function updatePlayer(dt) {
  const obj = controls.getObject();
  const speed = player.speed * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? player.dashMul : 1);

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).multiplyScalar(-1);

  const move = new THREE.Vector3();
  if (keys.has("KeyW")) move.add(forward);
  if (keys.has("KeyS")) move.addScaledVector(forward, -1);
  if (keys.has("KeyA")) move.addScaledVector(right, -1);
  if (keys.has("KeyD")) move.add(right);

  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

  // Gravity
  player.velY -= 18 * dt;
  if (player.onGround) player.velY = Math.max(player.velY, -2);

  // Jump
  if (player.onGround && keys.has("Space")) {
    player.velY = player.jumpVel;
    player.onGround = false;
  }

  // Apply motion
  obj.position.add(move);
  obj.position.y += player.velY * dt;

  // Terrain clamp
  const groundY = world.sampleHeight(obj.position.x, obj.position.z) + player.eyeHeight;
  if (obj.position.y <= groundY) {
    obj.position.y = groundY;
    player.velY = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  // Building collisions (AABB push out in XZ)
  const r = 0.45; // player radius
  for (const aabb of world.buildingAABBs) {
    const px = obj.position.x, pz = obj.position.z;
    if (px > aabb.min.x - r && px < aabb.max.x + r && pz > aabb.min.z - r && pz < aabb.max.z + r) {
      // push out to nearest side
      const dxMin = (aabb.min.x - r) - px;
      const dxMax = (aabb.max.x + r) - px;
      const dzMin = (aabb.min.z - r) - pz;
      const dzMax = (aabb.max.z + r) - pz;
      // Choose minimal displacement
      const candidates = [
        { ax: dxMin, az: 0, mag: Math.abs(dxMin) },
        { ax: dxMax, az: 0, mag: Math.abs(dxMax) },
        { ax: 0, az: dzMin, mag: Math.abs(dzMin) },
        { ax: 0, az: dzMax, mag: Math.abs(dzMax) },
      ].sort((a, b) => a.mag - b.mag);
      obj.position.x += candidates[0].ax;
      obj.position.z += candidates[0].az;
    }
  }

  // Bounds
  const b = world.bounds;
  obj.position.x = THREE.MathUtils.clamp(obj.position.x, b.minX, b.maxX);
  obj.position.z = THREE.MathUtils.clamp(obj.position.z, b.minZ, b.maxZ);
}

// Solo bots AI
function updateBots(dt) {
  const mePos = controls.getObject().position;
  for (const b of bots) b.update(dt, mePos, world);
}

// Networking
function updateNet(dt) {
  if (!net) return;
  net.update(dt);

  // Local -> peer
  const obj = controls.getObject();
  const yaw = controls.getObject().rotation.y;
  // pitch is on camera; approximate via camera rotation x
  const pitch = camera.rotation.x;

  net.sendThrottled({
    t: "state",
    pos: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
    yaw, pitch,
    hp: player.hp,
    w: currentWeaponIndex,
  });

  // Ping
  const p = net.getPingMs();
  pingEl.textContent = p ? String(p) : "—";
}

// Apply received net state
function applyRemoteState(s) {
  ensureOtherPlayerMesh();
  otherPlayer.lastNet.pos.set(s.pos.x, s.pos.y, s.pos.z);
  otherPlayer.lastNet.yaw = s.yaw;
  otherPlayer.lastNet.pitch = s.pitch;
  // Smooth set
  otherPlayer.mesh.position.lerp(otherPlayer.lastNet.pos, 0.35);
  // Face direction roughly (yaw only)
  otherPlayer.mesh.rotation.y = otherPlayer.lastNet.yaw;
}

function handleNetMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.t === "start") {
    seed = msg.seed;
    isOwner = false;
    startGame("battleGame", { seed });
    return;
  }

  if (msg.t === "state") {
    applyRemoteState(msg);
    return;
  }

  if (msg.t === "hit") {
    applyDamage(player, msg.dmg ?? 0);
    updateHUD();
    if (player.hp <= 0) {
      setHint("やられた…（Rで弾補充してリスポーン）");
      // simple respawn
      controls.getObject().position.copy(world.spawn);
      controls.getObject().position.y = world.sampleHeight(world.spawn.x, world.spawn.z) + player.eyeHeight;
      player.hp = player.maxHp;
      updateHUD();
    }
    return;
  }

  if (msg.t === "ping") {
    net?.replyPong(msg.ts);
    return;
  }

  if (msg.t === "pong") {
    net?.onPong(msg.ts);
    return;
  }
}

// Main loop
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if (mode === "solo" || mode === "battleGame") {
    updatePlayer(dt);

    if (mouse.down && controls.isLocked) shoot(dt);

    if (mode === "solo") updateBots(dt);
    if (mode === "battleGame") updateNet(dt);

    // Smooth other player visibility
    if (mode === "battleGame" && otherPlayer.mesh) otherPlayer.mesh.visible = true;

    // Camera bob hint (tiny)
    setHint(controls.isLocked ? "" : "クリックで照準ロック（FPS操作）");
    updateHUD();
  }

  renderer.render(scene, camera);
}

// UI wiring
soloBtn.addEventListener("click", () => {
  // tear down net if any
  net?.close();
  net = null;
  isOwner = false;

  netTitle.textContent = "SOLO";
  startGame("solo", { seed: "solo-" + Math.floor(Math.random() * 1e9).toString(36) });
});

battleBtn.addEventListener("click", () => {
  showBattlePanel();
});

createBtn.addEventListener("click", async () => {
  if (net) net.close();
  net = new NetSession({ isOwner: true });
  isOwner = true;
  statusEl.textContent = "Creating…";
  const myId = await net.open();
  myIdEl.textContent = myId;
  statusEl.textContent = "Room created. Waiting for join…";
  roomIdEl.textContent = myId;
  netTitle.textContent = "BATTLE (OWNER)";
  startBtn.classList.remove("hidden");

  net.onMessage = (m) => handleNetMessage(m);
  net.onStatus = (s) => (statusEl.textContent = s);
});

joinBtn.addEventListener("click", async () => {
  const ownerId = joinIdInput.value.trim();
  if (!ownerId) {
    statusEl.textContent = "Owner IDを入力してね";
    return;
  }
  if (net) net.close();
  net = new NetSession({ isOwner: false });
  isOwner = false;
  statusEl.textContent = "Connecting…";
  const myId = await net.open();
  myIdEl.textContent = myId;
  net.onMessage = (m) => handleNetMessage(m);
  net.onStatus = (s) => (statusEl.textContent = s);

  try {
    await net.connect(ownerId);
    statusEl.textContent = "Connected. OwnerがStartするのを待ってね";
    roomIdEl.textContent = ownerId;
    netTitle.textContent = "BATTLE";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "接続失敗… IDを確認してもう一回";
  }
});

startBtn.addEventListener("click", () => {
  if (!net || !isOwner) return;
  seed = "battle-" + Math.floor(Math.random() * 1e9).toString(36);
  // Start for owner locally
  startGame("battleGame", { seed });
  // Tell peer
  net.send({ t: "start", seed });
});

battlePanel.addEventListener("click", (e) => e.stopPropagation());

// Show menu initially
showMenu();
connectControls();
animate();
