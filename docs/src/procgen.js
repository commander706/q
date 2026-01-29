/**
 * Procedural world generation
 * - Heightfield terrain (simplex noise)
 * - Buildings & ramps
 * - Spawn + bot spawner
 */
export function generateWorld({ scene, THREE, noise2D, seed }) {
  // Clean any prior world by using a "bucket" group.
  const group = new THREE.Group();
  group.name = "WORLD";
  scene.add(group);

  // Parameters
  const SIZE = 240;           // world side length
  const HALF = SIZE / 2;
  const SEG = 160;            // terrain subdivisions
  const AMP = 16;             // height amplitude
  const FREQ = 0.015;         // noise frequency
  const ROAD_W = 5;           // road carving width

  const bounds = { minX: -HALF + 2, maxX: HALF - 2, minZ: -HALF + 2, maxZ: HALF - 2 };

  // Terrain geometry
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const heights = new Float32Array(pos.count);

  function roadMask(x, z) {
    // A couple of “main roads” (cross) to create flat-ish paths
    const ax = Math.abs(x);
    const az = Math.abs(z);
    const r1 = Math.max(0, 1 - ax / ROAD_W);
    const r2 = Math.max(0, 1 - az / ROAD_W);
    return Math.max(r1, r2); // 0..1
  }

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    // layered noise
    const n1 = noise2D(x * FREQ, z * FREQ);
    const n2 = noise2D(x * FREQ * 2.1 + 100, z * FREQ * 2.1 - 20);
    const n3 = noise2D(x * FREQ * 5.4 - 80, z * FREQ * 5.4 + 70);

    let h = (n1 * 0.65 + n2 * 0.28 + n3 * 0.07) * AMP;

    // road flatten
    const m = roadMask(x, z);
    h *= (1 - 0.85 * m);

    // gentle bowl to keep center interesting
    const d = Math.sqrt(x * x + z * z);
    h -= Math.max(0, (d - 110)) * 0.22;

    heights[i] = h;
    pos.setY(i, h);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x0b1222,
    roughness: 0.95,
    metalness: 0.0,
  });
  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  group.add(terrain);

  // Subtle contour lines (wireframe-ish overlay)
  const contourMat = new THREE.MeshBasicMaterial({
    color: 0x2b3a60,
    wireframe: true,
    transparent: true,
    opacity: 0.20,
  });
  const contour = new THREE.Mesh(geo.clone(), contourMat);
  contour.position.y += 0.02;
  group.add(contour);

  // Sampling function (bilinear from geometry grid)
  function sampleHeight(x, z) {
    // map x,z -> grid coords
    const u = (x + HALF) / SIZE;
    const v = (z + HALF) / SIZE;

    const gx = u * SEG;
    const gz = v * SEG;

    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const x1 = Math.min(SEG, x0 + 1), z1 = Math.min(SEG, z0 + 1);
    const tx = gx - x0, tz = gz - z0;

    function idx(ix, iz) {
      return iz * (SEG + 1) + ix;
    }
    const h00 = pos.getY(idx(x0, z0));
    const h10 = pos.getY(idx(x1, z0));
    const h01 = pos.getY(idx(x0, z1));
    const h11 = pos.getY(idx(x1, z1));

    const ha = h00 * (1 - tx) + h10 * tx;
    const hb = h01 * (1 - tx) + h11 * tx;
    return ha * (1 - tz) + hb * tz;
  }

  // Buildings & ramps
  const buildingAABBs = [];

  const bMat = new THREE.MeshStandardMaterial({ color: 0x121a33, roughness: 0.75, metalness: 0.05 });
  const bMat2 = new THREE.MeshStandardMaterial({ color: 0x0e1730, roughness: 0.7, metalness: 0.1 });
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x18214a, roughness: 0.85, metalness: 0.05 });

  function addAABB(minX, minZ, maxX, maxZ, baseY, topY) {
    buildingAABBs.push({
      min: { x: minX, y: baseY, z: minZ },
      max: { x: maxX, y: topY, z: maxZ },
    });
  }

  function addBuilding(x, z, w, d, h) {
    const y = sampleHeight(x, z);
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, Math.random() < 0.5 ? bMat : bMat2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y + h / 2, z);
    group.add(mesh);

    addAABB(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y, y + h);
  }

  function addRamp(x, z, w, d, h, yaw) {
    // A simple ramp using a box rotated (not perfect wedge but plays fine)
    const y = sampleHeight(x, z);
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, rampMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = yaw;
    mesh.rotation.x = -Math.PI / 10;
    group.add(mesh);

    addAABB(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y, y + h);
  }

  // Place objects with some structure: sparse in center roads, denser on sides
  const PLACEMENTS = 120;
  for (let i = 0; i < PLACEMENTS; i++) {
    const x = (Math.random() * 2 - 1) * (HALF - 12);
    const z = (Math.random() * 2 - 1) * (HALF - 12);

    // keep roads mostly open
    if (Math.abs(x) < 10 || Math.abs(z) < 10) continue;

    const r = Math.random();
    if (r < 0.78) {
      const w = 3.2 + Math.random() * 9.0;
      const d = 3.2 + Math.random() * 9.0;
      const h = 3.5 + Math.random() * 24.0;
      addBuilding(x, z, w, d, h);
    } else {
      const w = 4 + Math.random() * 8;
      const d = 3 + Math.random() * 10;
      const h = 2 + Math.random() * 5;
      addRamp(x, z, w, d, h, Math.random() * Math.PI * 2);
    }
  }

  // “Stripes” road decals (thin boxes)
  const stripeGeo = new THREE.BoxGeometry(1.4, 0.05, 6);
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x2a3d6a, roughness: 0.95, metalness: 0.0 });
  for (let i = -18; i <= 18; i++) {
    // along Z road
    const x = 0;
    const z = i * 10;
    const y = sampleHeight(x, z) + 0.04;
    const m = new THREE.Mesh(stripeGeo, stripeMat);
    m.position.set(x, y, z);
    group.add(m);

    // along X road
    const x2 = i * 10;
    const z2 = 0;
    const y2 = sampleHeight(x2, z2) + 0.04;
    const m2 = new THREE.Mesh(stripeGeo, stripeMat);
    m2.position.set(x2, y2, z2);
    m2.rotation.y = Math.PI / 2;
    group.add(m2);
  }

  // Spawn point near center road but not exactly at (0,0)
  const spawn = new THREE.Vector3(6, 0, 6);

  // Bot spawner
  function spawnBots(count) {
    const bots = [];
    for (let i = 0; i < count; i++) {
      bots.push(makeBot(i));
    }
    return bots;
  }

  function makeBot(i) {
    const g = new THREE.CapsuleGeometry(0.42, 1.05, 6, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffa36b, roughness: 0.65, metalness: 0.05 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;

    const bot = {
      id: "bot-" + i,
      hp: 60,
      maxHp: 60,
      mesh,
      target: new THREE.Vector3(),
      shootCd: 0,
      flashT: 0,
      respawn() {
        this.hp = this.maxHp;
        const x = (Math.random() * 2 - 1) * (HALF - 20);
        const z = (Math.random() * 2 - 1) * (HALF - 20);
        const y = sampleHeight(x, z) + 1.4;
        this.mesh.position.set(x, y, z);
        this.pickTarget();
      },
      pickTarget() {
        const x = (Math.random() * 2 - 1) * (HALF - 20);
        const z = (Math.random() * 2 - 1) * (HALF - 20);
        this.target.set(x, 0, z);
      },
      flash(t) {
        this.flashT = Math.max(this.flashT, t);
        this.mesh.material.emissive?.setHex?.(0x000000);
        this.mesh.material.emissive = new THREE.Color(0x401000);
      },
      update(dt, mePos, world) {
        // Move toward target
        const p = this.mesh.position;
        const to = this.target.clone().sub(p);
        const dist = to.length();

        // keep y on terrain
        const gY = sampleHeight(p.x, p.z) + 1.4;
        p.y = gY;

        if (dist < 3) this.pickTarget();
        else {
          to.normalize();
          p.addScaledVector(to, dt * 3.6);
        }

        // Face player if close
        const toMe = mePos.clone().sub(p);
        const dMe = toMe.length();
        if (dMe < 32) {
          this.mesh.lookAt(mePos.x, p.y, mePos.z);

          // shoot (hitscan)
          this.shootCd -= dt;
          if (this.shootCd <= 0) {
            this.shootCd = 0.55 + Math.random() * 0.6;

            // chance to hit based on distance
            const hitChance = Math.max(0.12, 1 - dMe / 40);
            if (Math.random() < hitChance) {
              // apply damage through a custom event
              window.dispatchEvent(new CustomEvent("botHitPlayer", { detail: { dmg: 6 + Math.random() * 6 } }));
            }
          }
        }

        // flash decay
        this.flashT -= dt;
        if (this.flashT <= 0) {
          this.mesh.material.emissive = new THREE.Color(0x000000);
        }
      },
    };

    bot.respawn();
    group.add(mesh);
    return bot;
  }

  // Hook for bot damage events
  window.addEventListener("botHitPlayer", (e) => {
    // main.js will listen too; we keep this here as a low-dependency “signal”
  });

  // API
  return {
    group,
    terrain,
    buildingAABBs,
    bounds,
    spawn,
    sampleHeight,
    spawnBots,
    dispose() {
      // Remove all children and dispose GPU resources
      scene.remove(group);
      group.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material?.dispose?.();
        }
      });
    },
  };
}
