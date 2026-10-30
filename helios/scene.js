import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Proportions of a 60-cell module, 1722 × 1134 mm. One scene unit is about 0.506 m.
const PANEL_W = 3.4;
const PANEL_D = 2.24;
const PANEL_T = 0.11;
const FRAME = 0.055;
const CELL_COLS = 10; // cells along the long side
const CELL_ROWS = 6;

const NARROW = 900;
// North is -z. The camera mostly looks north, so the sun (south) stays behind it.
const HOUSE_AT = new THREE.Vector3(-14, 0, -10);
const SITE = new THREE.Vector3(4, 0, -8); // middle of house and array
const TRACKERS = [
  [2, -14], [14, -14], [26, -14],
  [2, -3], [14, -3], [26, -3],
];
const TRACKER_H = 2.7; // pivot height
const TABLE = { cols: 3, rows: 2 };
const PANELS_PER_TRACKER = TABLE.cols * TABLE.rows;

// Three moments of one day; the page scroll blends between them.
// az is measured from east (+x) towards south (+z); el is the height above the horizon.
const DAY = [
  { at: 0, az: 38, el: 26, zenith: 0x3f7dc8, horizon: 0xbcd6ec, sun: 0xfff1d6, intensity: 2.7 },
  { at: 0.5, az: 90, el: 58, zenith: 0x2f6fc2, horizon: 0xb7d2ea, sun: 0xffffff, intensity: 3.1 },
  { at: 1, az: 148, el: 17, zenith: 0x4a72b0, horizon: 0xf1d8b6, sun: 0xffd7a6, intensity: 2.5 },
];

// Camera framings, one per page chapter. Positions are world units, looks are targets.
const CHAPTERS = {
  top: { pos: [46, 8.5, 34], look: [-52, 12, -20] },
  stats: { pos: [8, 46, 32], look: [4, 0, -9] },
  solutions: { pos: [40, 3.4, 8], look: [-18, 5.5, -6] },
  why: { pos: [27, 3.4, 4], look: [4, 7, -16] },
  contact: { pos: [-34, 16, 34], look: [6, 3, -8] },
};
const CHAPTER_ORDER = ['top', 'stats', 'solutions', 'why', 'contact'];
const INTRO_MS = 2800;
const INTRO_OFFSET = new THREE.Vector3(-12, 34, 30);

// One sky function, shared by the sky dome, the baked environment and the fog,
// so distant geometry dissolves into exactly the colour of the sky behind it.
const skyFunction = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float skyTime;
  float hsHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hsNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsHash(i), hsHash(i + vec2(1.0, 0.0)), u.x),
               mix(hsHash(i + vec2(0.0, 1.0)), hsHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float hsFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * hsNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  // gradient, haze and sun glow: cheap enough for every fogged pixel
  vec3 heliosSkyBase(vec3 dir) {
    float h = dir.y;
    float s = max(dot(dir, sunDir), 0.0);
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
    // haze below the horizon, so the far ground fades instead of ending
    col = mix(col, horizon * 0.93, smoothstep(0.0, -0.3, h));
    return col + sunColor * (pow(s, 6.0) * 0.16 + pow(s, 64.0) * 0.32);
  }
  vec3 heliosSky(vec3 dir) {
    float h = dir.y;
    float s = max(dot(dir, sunDir), 0.0);
    vec3 col = heliosSkyBase(dir);
    if (h > 0.0) {
      // drifting cumulus, projected onto a plane above the site
      vec2 p = dir.xz / (h + 0.12) * 1.25 + vec2(skyTime * 0.012, skyTime * 0.004);
      float c = hsFbm(p);
      float m = smoothstep(0.52, 0.8, c) * smoothstep(0.0, 0.2, h);
      vec3 cloud = mix(vec3(0.84, 0.87, 0.93), vec3(1.0), smoothstep(0.55, 0.92, c));
      cloud += sunColor * pow(s, 4.0) * 0.22;
      col = mix(col, cloud, m * 0.85);
    }
    col += sunColor * smoothstep(0.9994, 0.9997, s) * 1.6;
    return col;
  }
`;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  ${skyFunction}
  varying vec3 vDir;
  void main() {
    gl_FragColor = vec4(heliosSky(normalize(vDir)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Replaces three.js's flat fog colour with the sky seen in the same direction.
// Fog is applied after tone mapping, so the sky colour goes through the same steps first.
function applySkyFog(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vSkyDir;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSkyDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\nvarying vec3 vSkyDir;\n${skyFunction}`)
      .replace('#include <fog_fragment>', /* glsl */ `
        #ifdef USE_FOG
          float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          // fogged geometry sits at or below the horizon, where the clouds have faded out,
          // so the fog skips their noise: it would otherwise run on every pixel of the ground
          vec3 skyFog = heliosSkyBase(normalize(vSkyDir));
          #ifdef TONE_MAPPING
            skyFog = toneMapping(skyFog);
          #endif
          skyFog = linearToOutputTexel(vec4(skyFog, 1.0)).rgb;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, skyFog, fogFactor);
        #endif
      `);
  };
  material.customProgramCacheKey = () => 'helios-sky-fog';
}

const isNarrow = () => window.innerWidth < NARROW;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const rad = THREE.MathUtils.degToRad;

// small deterministic random, so trees land in the same places on every load
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function triangle(ctx, ax, ay, bx, by, cx, cy) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.fill();
}

function cellTexture(maxAnisotropy) {
  const W = 1024;
  const H = 672;
  const pad = 10;
  const gap = 5;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c9ced6'; // white backsheet between the cells
  ctx.fillRect(0, 0, W, H);

  const cw = (W - pad * 2 - gap * (CELL_COLS - 1)) / CELL_COLS;
  const ch = (H - pad * 2 - gap * (CELL_ROWS - 1)) / CELL_ROWS;
  for (let row = 0; row < CELL_ROWS; row++) {
    for (let col = 0; col < CELL_COLS; col++) {
      const x = pad + col * (cw + gap);
      const y = pad + row * (ch + gap);
      // small tone shift per cell, like real wafers
      const k = 0.86 + (((row * CELL_COLS + col) * 37) % 23) / 100;
      ctx.fillStyle = `rgb(${Math.round(18 * k)},${Math.round(27 * k)},${Math.round(58 * k)})`;
      ctx.fillRect(x, y, cw, ch);
      const sheen = ctx.createLinearGradient(x, y, x + cw, y + ch);
      sheen.addColorStop(0, 'rgba(70,100,165,.18)');
      sheen.addColorStop(1, 'rgba(4,8,18,.20)');
      ctx.fillStyle = sheen;
      ctx.fillRect(x, y, cw, ch);

      ctx.strokeStyle = 'rgba(120,145,190,.18)';
      ctx.lineWidth = 0.7;
      for (let i = 1; i < 18; i++) {
        const fy = y + (i / 18) * ch;
        line(ctx, x + 2, fy, x + cw - 2, fy);
      }
      ctx.strokeStyle = 'rgba(190,205,235,.45)';
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        const bx = x + (i / 4) * cw;
        line(ctx, bx, y + 2, bx, y + ch - 2);
      }

      // monocrystalline wafers have clipped corners
      const c = Math.min(cw, ch) * 0.09;
      ctx.fillStyle = '#c9ced6';
      triangle(ctx, x, y, x + c, y, x, y + c);
      triangle(ctx, x + cw, y, x + cw - c, y, x + cw, y + c);
      triangle(ctx, x, y + ch, x + c, y + ch, x, y + ch - c);
      triangle(ctx, x + cw, y + ch, x + cw - c, y + ch, x + cw, y + ch - c);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

function glassNoise() {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function frameGeometry() {
  const long = new THREE.BoxGeometry(PANEL_W, PANEL_T, FRAME);
  const short = new THREE.BoxGeometry(FRAME, PANEL_T, PANEL_D);
  const parts = [
    long.clone().translate(0, 0, PANEL_D / 2 - FRAME / 2),
    long.clone().translate(0, 0, -PANEL_D / 2 + FRAME / 2),
    short.clone().translate(PANEL_W / 2 - FRAME / 2, 0, 0),
    short.clone().translate(-PANEL_W / 2 + FRAME / 2, 0, 0),
    new THREE.BoxGeometry(PANEL_W * 0.97, PANEL_T * 0.5, 0.035).translate(0, -PANEL_T * 0.2, 0),
  ];
  return mergeGeometries(parts, false);
}

function panelParts(maxAnisotropy) {
  const geometry = {
    back: new THREE.BoxGeometry(PANEL_W - FRAME * 1.7, 0.012, PANEL_D - FRAME * 1.7).translate(0, -PANEL_T / 2 + 0.008, 0),
    frame: frameGeometry(),
    face: new THREE.PlaneGeometry(PANEL_W - FRAME * 2 - 0.01, PANEL_D - FRAME * 2 - 0.01)
      .rotateX(-Math.PI / 2)
      .translate(0, PANEL_T / 2 - 0.006, 0),
    jbox: new THREE.BoxGeometry(0.34, 0.055, 0.2).translate(0, -PANEL_T / 2 - 0.03, PANEL_D * 0.26),
  };
  const material = {
    back: new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.85, metalness: 0.02 }),
    frame: new THREE.MeshStandardMaterial({ color: 0xb4bac4, roughness: 0.35, metalness: 0.85 }),
    // the cells sit under a clear-coated glass layer that mirrors the sky
    face: new THREE.MeshPhysicalMaterial({
      map: cellTexture(maxAnisotropy),
      roughness: 0.38,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      clearcoatNormalMap: glassNoise(),
      clearcoatNormalScale: new THREE.Vector2(0.02, 0.02),
    }),
    jbox: new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.7, metalness: 0.1 }),
  };
  return { geometry, material };
}

// A set of panels drawn with one instanced mesh per part. place(i, matrix) moves panel i.
function panelSet(parts, count) {
  const group = new THREE.Group();
  const meshes = {};
  for (const key of ['back', 'frame', 'face', 'jbox']) {
    const mesh = new THREE.InstancedMesh(parts.geometry[key], parts.material[key], count);
    mesh.castShadow = true;
    mesh.receiveShadow = key === 'face' || key === 'frame';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    meshes[key] = mesh;
    group.add(mesh);
  }
  return {
    group,
    face: meshes.face,
    place(i, matrix) {
      for (const mesh of Object.values(meshes)) mesh.setMatrixAt(i, matrix);
    },
    commit() {
      for (const mesh of Object.values(meshes)) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
  };
}

function std(color, roughness = 0.85, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function groundMesh() {
  const size = 900;
  const seg = 180;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const c = new THREE.Color();
  const grassA = new THREE.Color(0x5f7f31);
  const grassB = new THREE.Color(0x86a046);
  const dry = new THREE.Color(0xa69b5d);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // the site stays level; rolling country starts beyond it
    const flat = smoothstep(70, 190, Math.hypot(x - SITE.x, z - SITE.z));
    const h = (Math.sin(x * 0.018) + Math.cos(z * 0.021 + 1.3)) * 3.2 + Math.sin(x * 0.051 + z * 0.037) * 1.2;
    pos.setY(i, h * flat);
    const n = (Math.sin(x * 0.13 + z * 0.07) + Math.sin(x * 0.031 - z * 0.12)) * 0.25 + 0.5;
    c.copy(grassA).lerp(grassB, n).lerp(dry, smoothstep(0.72, 1, n) * 0.55);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
  mesh.receiveShadow = true;
  return mesh;
}

// Two bands of distant ridgelines around the site; the fog turns them blue with distance.
function ridges() {
  const group = new THREE.Group();
  const materials = [];
  for (const [radius, height, color, seed] of [[190, 26, 0x5d7b4f, 3], [270, 46, 0x6f8a86, 11]]) {
    const geo = new THREE.CylinderGeometry(radius, radius, 1, 260, 1, true);
    const pos = geo.attributes.position;
    const rand = seeded(seed);
    const ph = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const profile = 0.5 + 0.22 * Math.sin(a * 3 + ph[0]) + 0.14 * Math.sin(a * 7 + ph[1])
        + 0.08 * Math.sin(a * 17 + ph[2]) + 0.04 * Math.sin(a * 41 + ph[3]);
      pos.setY(i, pos.getY(i) > 0 ? height * profile : -6);
    }
    geo.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide });
    const ridge = new THREE.Mesh(geo, material);
    ridge.position.set(SITE.x, 0, SITE.z);
    group.add(ridge);
    materials.push(material);
  }
  return { group, materials };
}

function trees(count) {
  const rand = seeded(42);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6).translate(0, 1.2, 0), std(0x5b4331), count);
  // three overlapping lobes read as foliage instead of a single ball
  const crownGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(1.9, 1).scale(1, 0.9, 1).translate(0, 3.7, 0),
    new THREE.IcosahedronGeometry(1.4, 1).translate(1.0, 3.1, 0.5),
    new THREE.IcosahedronGeometry(1.3, 1).translate(-0.9, 3.3, -0.6),
    new THREE.IcosahedronGeometry(1.1, 1).translate(0.2, 4.7, -0.2),
  ]);
  const crown = new THREE.InstancedMesh(crownGeo, std(0xffffff, 0.9), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  const greens = [0x3f6b2c, 0x4f7d34, 0x5d8a3a, 0x36602a];
  let placed = 0;
  while (placed < count) {
    const x = SITE.x + (rand() - 0.5) * 220;
    const z = SITE.z + (rand() - 0.5) * 200;
    // keep the site, its approach and the camera corridors clear
    if (x > -40 && x < 70 && z > -30 && z < 70) continue;
    const k = 0.75 + rand() * 0.8;
    p.set(x, 0, z);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
    s.set(k, k * (0.85 + rand() * 0.4), k);
    m.compose(p, q, s);
    trunk.setMatrixAt(placed, m);
    crown.setMatrixAt(placed, m);
    crown.setColorAt(placed, tint.setHex(greens[placed % greens.length]).offsetHSL(0, 0, (rand() - 0.5) * 0.06));
    placed++;
  }
  // a few close to the house, for scale
  const near = [[-26, -18, 1.2], [-24, -4, 1.0], [-30, -9, 1.4], [-6, -26, 1.1], [-18, -27, 1.3]];
  const all = { trunk, crown };
  for (const mesh of Object.values(all)) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  const extraTrunk = new THREE.InstancedMesh(trunk.geometry, trunk.material, near.length);
  const extraCrown = new THREE.InstancedMesh(crown.geometry, crown.material, near.length);
  near.forEach(([x, z, k], i) => {
    m.compose(p.set(x, 0, z), q.identity(), s.set(k, k, k));
    extraTrunk.setMatrixAt(i, m);
    extraCrown.setMatrixAt(i, m);
    extraCrown.setColorAt(i, tint.setHex(greens[i % greens.length]));
  });
  for (const mesh of [extraTrunk, extraCrown]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  const group = new THREE.Group();
  group.add(trunk, crown, extraTrunk, extraCrown);
  return { group, materials: [trunk.material, crown.material] };
}

// A modern two-volume house with glazing to the south.
function houseMesh() {
  const group = new THREE.Group();
  const white = std(0xf1ede5, 0.9);
  const timber = std(0x3d3833, 0.75);
  const wood = std(0xa07c55, 0.8);
  const concrete = std(0xc9c4ba, 0.95);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x22313f, roughness: 0.06, metalness: 0.25, clearcoat: 1,
    emissive: 0xffb36b, emissiveIntensity: 0,
  });
  const box = (w, h, d, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  box(13, 6, 9, white, 0, 3, 0); // ground floor
  box(13.8, 0.4, 9.8, white, 0, 6.2, 0); // slab
  box(9, 3.6, 8, timber, 2, 8.2, -0.6); // upper floor, cantilevered over the deck
  box(9.4, 0.3, 8.4, timber, 2, 10.15, -0.6); // upper roof
  box(7.6, 4.3, 0.12, glass, -1.9, 2.6, 4.52);
  box(2.6, 4.3, 0.12, glass, 4.8, 2.6, 4.52);
  box(6.2, 2.3, 0.12, glass, 1.6, 8.2, 3.42);
  box(0.12, 4.3, 5, glass, -6.52, 2.6, 0.6);
  box(9.4, 0.28, 4.2, wood, -1.6, 0.14, 6.6); // deck
  box(2.4, 0.2, 7, concrete, 7.6, 0.1, 6.5); // path to the door
  box(1.6, 3.4, 0.14, timber, 7.6, 1.7, 4.53); // door
  group.position.copy(HOUSE_AT);
  return { group, glass };
}

// Inverter and three home batteries on a pad by the east wall of the house.
function storageMesh() {
  const group = new THREE.Group();
  const shell = std(0xf4f4f2, 0.55, 0.05);
  const grey = std(0x8c9199, 0.5, 0.2);
  const pad = std(0xbdb7ad, 0.95);
  const led = new THREE.MeshBasicMaterial({ color: 0x5ff2a0, toneMapped: false });
  const add = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(3.2, 0.25, 6.4), pad, 0, 0.12, 0);
  add(new THREE.BoxGeometry(0.55, 1.8, 1.5), grey, 0, 1.4, 2.2); // inverter
  add(new THREE.BoxGeometry(0.02, 0.35, 0.6), new THREE.MeshBasicMaterial({ color: 0x9fe3ff, toneMapped: false }), 0.29, 1.75, 2.2);
  const batteries = [];
  for (let i = 0; i < 3; i++) {
    const z = 0.6 - i * 1.25;
    add(new THREE.BoxGeometry(0.6, 2.3, 1.0), shell, 0, 1.4, z);
    batteries.push(add(new THREE.BoxGeometry(0.02, 1.6, 0.06), led, 0.31, 1.5, z));
  }
  group.position.set(-5.4, 0, -7.6);
  return { group, batteries };
}

function trackerHardware(count) {
  const metal = std(0x9aa1ab, 0.45, 0.7);
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.22, TRACKER_H, 10).translate(0, TRACKER_H / 2, 0), metal, count);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), metal, count);
  const beam = new THREE.InstancedMesh(
    mergeGeometries([
      new THREE.BoxGeometry(TABLE.cols * (PANEL_W + 0.08), 0.12, 0.22).translate(0, -0.17, -0.6),
      new THREE.BoxGeometry(TABLE.cols * (PANEL_W + 0.08), 0.12, 0.22).translate(0, -0.17, 0.6),
      new THREE.BoxGeometry(0.22, 0.14, TABLE.rows * (PANEL_D + 0.08)).translate(0, -0.27, 0),
    ]),
    metal,
    count
  );
  for (const mesh of [pole, head, beam]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  return { pole, head, beam, material: metal };
}

/**
 * Starts the background scene. Returns null when WebGL is unavailable, otherwise an
 * object that follows the page: setProgress(0..1), setAnchors({ chapter: progress }),
 * setPointer(x, y) in normalised device coordinates (or null) and onHover(callback).
 */
export function startScene(canvas, { reduceMotion = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
  let narrow = isNarrow();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const sunDir = new THREE.Vector3();
  const skyU = {
    zenith: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color() },
    sunDir: { value: sunDir },
    skyTime: { value: 0 },
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.0027);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 900);

  // sky dome that travels with the camera, so the horizon stays at infinity
  const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), new THREE.ShaderMaterial({
    vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide,
    depthWrite: false, fog: false, uniforms: skyU,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // the same sky, baked into the environment map that glass and metal reflect
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, uniforms: skyU,
  })));
  let envTarget = null;
  let bakedFor = new THREE.Vector3(0, -1, 0);
  let lastBake = 0;
  function bakeEnvironment(force) {
    const now = performance.now();
    if (!force && (bakedFor.angleTo(sunDir) < 0.04 || now - lastBake < 300)) return;
    envTarget?.dispose();
    envTarget = pmrem.fromScene(envScene, 0.02);
    scene.environment = envTarget.texture;
    bakedFor.copy(sunDir);
    lastBake = now;
  }
  scene.environmentIntensity = 0.75;

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x4f5a34, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(narrow ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 40, bottom: -40, near: 1, far: 260 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.copy(SITE);
  scene.add(sun, sun.target);

  // the world
  const ground = groundMesh();
  scene.add(ground);
  const gravel = new THREE.Mesh(new THREE.PlaneGeometry(38, 24).rotateX(-Math.PI / 2), std(0xb8b1a1, 1));
  gravel.position.set(14, 0.03, -8.5);
  gravel.receiveShadow = true;
  scene.add(gravel);
  const ridgeSet = ridges();
  scene.add(ridgeSet.group);
  const treeSet = trees(narrow ? 70 : 120);
  scene.add(treeSet.group);
  const house = houseMesh();
  scene.add(house.group);
  const storage = storageMesh();
  scene.add(storage.group);

  const parts = panelParts(renderer.capabilities.getMaxAnisotropy());
  const roof = panelSet(parts, 6);
  const placeM = new THREE.Matrix4();
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(14), 0, 0));
  for (let i = 0; i < 6; i++) {
    const x = HOUSE_AT.x + 2 + (i % 3 - 1) * (PANEL_W + 0.25);
    const z = HOUSE_AT.z - 0.6 + (Math.floor(i / 3) - 0.5) * (PANEL_D + 1.1);
    placeM.compose(new THREE.Vector3(x, 10.85, z), tilt, new THREE.Vector3(1, 1, 1));
    roof.place(i, placeM);
  }
  roof.commit();
  scene.add(roof.group);

  const field = panelSet(parts, TRACKERS.length * PANELS_PER_TRACKER);
  scene.add(field.group);
  const hw = trackerHardware(TRACKERS.length);
  scene.add(hw.pole, hw.head, hw.beam);
  const trackerAngles = TRACKERS.map(() => ({ yaw: 0, tilt: rad(30) }));

  // wiring: each tracker drops a cable down its pole into a junction box, the cables run in a
  // ground tray to a combiner cabinet, and one feeder goes on to the inverter and into the house
  const COMBINER = new THREE.Vector3(-1.5, 0, -8.5);
  const TRAY_Y = 0.2;
  const polyline = (points) => {
    const path = new THREE.CurvePath();
    for (let i = 1; i < points.length; i++) {
      path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i - 1]), new THREE.Vector3(...points[i])));
    }
    return path;
  };
  const cablePaths = TRACKERS.map(([x, z], t) => {
    const lane = z + ((t % 3) - 1) * 0.1; // three cables side by side in each tray
    const side = z > COMBINER.z ? 0.45 : -0.45; // enter the cabinet on the face toward its row
    return polyline([
      [x - 0.3, TRACKER_H - 0.15, z], [x - 0.3, TRAY_Y, z], [x - 0.3, TRAY_Y, lane],
      [COMBINER.x + (t % 3 - 1) * 0.1, TRAY_Y, lane], [COMBINER.x + (t % 3 - 1) * 0.1, TRAY_Y, COMBINER.z + side],
    ]);
  });
  cablePaths.push(polyline([
    [COMBINER.x - 0.32, 0.5, COMBINER.z], [-2.1, TRAY_Y, COMBINER.z], [-3.3, TRAY_Y, COMBINER.z], [-3.3, TRAY_Y, -5.4],
    [-3.72, TRAY_Y, -5.4], [-3.88, 0.3, -5.4], [-4.6, 0.3, -5.4], // up onto the storage pad
    [-5.12, 0.7, -5.4], // inverter, east face
    [-5.68, 0.7, -5.4], [-6.3, 0.3, -5.4], [-6.9, 0.3, -6.0], [-7.48, 0.9, -6.0], // into the house wall
  ]));
  const cableGeos = cablePaths.map((path) => new THREE.TubeGeometry(path, Math.ceil(path.getLength() * 4), 0.04, 6));
  const cable = new THREE.Mesh(mergeGeometries(cableGeos), std(0x3f4247, 0.7));
  cable.receiveShadow = true;
  scene.add(cable);

  // junction box on every pole, the ground trays and the combiner cabinet
  const greyBox = std(0x9aa1ab, 0.5, 0.3);
  const boxGeos = TRACKERS.map(([x, z]) => new THREE.BoxGeometry(0.16, 0.5, 0.38).translate(x - 0.3, 1.1, z));
  const trayGeos = [...new Set(TRACKERS.map(([, z]) => z))].map((z) => {
    const east = Math.max(...TRACKERS.filter(([, tz]) => tz === z).map(([x]) => x));
    return new THREE.BoxGeometry(east - COMBINER.x + 0.4, 0.12, 0.42).translate((east + COMBINER.x) / 2 - 0.1, 0.09, z);
  });
  const zs = TRACKERS.map(([, z]) => z);
  trayGeos.push(new THREE.BoxGeometry(0.42, 0.12, Math.max(...zs) - Math.min(...zs)).translate(COMBINER.x, 0.09, (Math.max(...zs) + Math.min(...zs)) / 2));
  const wiringBoxes = new THREE.Mesh(mergeGeometries([
    ...boxGeos,
    new THREE.BoxGeometry(0.62, 1.3, 0.9).translate(COMBINER.x, 0.65, COMBINER.z),
  ]), greyBox);
  wiringBoxes.castShadow = true;
  wiringBoxes.receiveShadow = true;
  const trays = new THREE.Mesh(mergeGeometries(trayGeos), std(0x8d877b, 0.95));
  trays.receiveShadow = true;
  scene.add(wiringBoxes, trays);

  // energy pulses run along every cable, one every PULSE_GAP units
  const PULSE_GAP = 2.4;
  const pulseRuns = cablePaths.map((path) => {
    const length = path.getLength();
    return { path, length, count: Math.max(2, Math.floor(length / PULSE_GAP)) };
  });
  const PULSES = pulseRuns.reduce((sum, run) => sum + run.count, 0);
  const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffc04d, toneMapped: false, fog: false });
  const pulses = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 10, 8), pulseMat, PULSES);
  pulses.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pulses.frustumCulled = false;
  scene.add(pulses);

  const fogged = [
    ground.material, gravel.material, ...ridgeSet.materials, cable.material, greyBox, trays.material, hw.material,
    house.glass, ...treeSet.materials, ...Object.values(parts.material),
  ];
  for (const object of [house.group, storage.group]) {
    object.traverse((o) => o.material && !o.material.isMeshBasicMaterial && fogged.push(o.material));
  }
  for (const material of new Set(fogged)) applySkyFog(material, skyU);

  // amber outline drawn over the panel under the pointer
  const outline = new THREE.Mesh(
    frameGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xf5a623, toneMapped: false, fog: false })
  );
  outline.matrixAutoUpdate = false;
  outline.visible = false;
  scene.add(outline);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const outlineScale = new THREE.Matrix4().makeScale(1.035, 1.5, 1.06);
  let pointerOn = false;
  let hovered = -1;
  let hoverCallback = () => {};

  function pickPanel() {
    let id = -1;
    if (pointerOn && !narrow) {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(field.face, false)[0];
      if (hit) id = hit.instanceId;
    }
    if (id >= 0) {
      field.face.getMatrixAt(id, placeM);
      outline.matrix.copy(placeM).multiply(outlineScale);
    }
    if (id !== hovered) {
      hovered = id;
      outline.visible = id >= 0;
      hoverCallback(id >= 0 ? {
        tracker: Math.floor(id / PANELS_PER_TRACKER) + 1,
        module: (id % PANELS_PER_TRACKER) + 1,
      } : null);
    }
  }

  // sky and light for a moment of the day, 0 = morning, 1 = late afternoon
  const cA = new THREE.Color();
  const cB = new THREE.Color();
  let dayK = -1;
  function setDay(k, force) {
    if (!force && Math.abs(k - dayK) < 1e-4) return;
    dayK = k;
    const i = k < DAY[1].at ? 0 : 1;
    const a = DAY[i];
    const b = DAY[i + 1];
    const t = smoothstep(0, 1, (k - a.at) / (b.at - a.at));
    const az = rad(THREE.MathUtils.lerp(a.az, b.az, t));
    const el = rad(THREE.MathUtils.lerp(a.el, b.el, t));
    sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    skyU.zenith.value.lerpColors(cA.setHex(a.zenith), cB.setHex(b.zenith), t);
    skyU.horizon.value.lerpColors(cA.setHex(a.horizon), cB.setHex(b.horizon), t);
    skyU.sunColor.value.lerpColors(cA.setHex(a.sun), cB.setHex(b.sun), t);
    sun.color.copy(skyU.sunColor.value);
    sun.intensity = THREE.MathUtils.lerp(a.intensity, b.intensity, t);
    sun.position.copy(SITE).addScaledVector(sunDir, 120);
    hemi.color.copy(skyU.zenith.value).lerp(cA.setHex(0xffffff), 0.55);
    // late in the day the house lights up
    house.glass.emissiveIntensity = smoothstep(0.8, 1, k) * 0.55;
    bakeEnvironment(force);
  }

  // dual-axis trackers turn to face the sun, each a little behind the one before
  const yawM = new THREE.Matrix4();
  const tiltM = new THREE.Matrix4();
  const tableM = new THREE.Matrix4();
  const localM = new THREE.Matrix4();
  function updateTrackers(snap) {
    const goalYaw = Math.atan2(sunDir.x, sunDir.z);
    const goalTilt = Math.min(rad(72), Math.acos(THREE.MathUtils.clamp(sunDir.y, -1, 1)));
    TRACKERS.forEach(([x, z], t) => {
      const ang = trackerAngles[t];
      const k = snap ? 1 : 0.035 + t * 0.006;
      ang.yaw += (goalYaw - ang.yaw) * k;
      ang.tilt += (goalTilt - ang.tilt) * k;
      yawM.makeRotationY(ang.yaw);
      tiltM.makeRotationX(ang.tilt);
      tableM.makeTranslation(x, TRACKER_H + 0.35, z).multiply(yawM).multiply(tiltM);
      placeM.makeTranslation(x, 0, z);
      hw.pole.setMatrixAt(t, placeM);
      placeM.makeTranslation(x, TRACKER_H + 0.1, z).multiply(yawM);
      hw.head.setMatrixAt(t, placeM);
      hw.beam.setMatrixAt(t, tableM);
      for (let i = 0; i < PANELS_PER_TRACKER; i++) {
        const c = i % TABLE.cols;
        const r = Math.floor(i / TABLE.cols);
        localM.makeTranslation((c - (TABLE.cols - 1) / 2) * (PANEL_W + 0.08), 0, (r - (TABLE.rows - 1) / 2) * (PANEL_D + 0.08));
        placeM.multiplyMatrices(tableM, localM);
        field.place(t * PANELS_PER_TRACKER + i, placeM);
      }
    });
    for (const mesh of [hw.pole, hw.head, hw.beam]) mesh.instanceMatrix.needsUpdate = true;
    field.commit();
  }

  const pulseM = new THREE.Matrix4();
  const pulseP = new THREE.Vector3();
  let flow = 0;
  function updatePulses(dt) {
    // more sun, more current
    flow = (flow + dt * (1.2 + 2.2 * Math.max(0, sunDir.y))) % (PULSE_GAP * 1000);
    let i = 0;
    for (const run of pulseRuns) {
      for (let k = 0; k < run.count; k++, i++) {
        const u = (((k * run.length) / run.count + flow) % run.length) / run.length;
        run.path.getPointAt(u, pulseP);
        const fade = smoothstep(0, 0.03, u) * (1 - smoothstep(0.97, 1, u));
        pulseM.makeScale(fade, fade, fade).setPosition(pulseP);
        pulses.setMatrixAt(i, pulseM);
      }
    }
    pulses.instanceMatrix.needsUpdate = true;
    const blink = 0.55 + 0.45 * Math.sin(performance.now() * 0.004);
    storage.batteries.forEach((b, i) => b.scale.set(1, 0.4 + 0.6 * clamp01(blink + i * 0.15), 1));
  }

  // chapter anchors in scroll progress; replaced by the page once it has measured its sections
  let anchors = CHAPTER_ORDER.map((name, i) => ({ name, p: i / (CHAPTER_ORDER.length - 1) }));
  const camGoal = new THREE.Vector3();
  const lookAt = new THREE.Vector3().fromArray(CHAPTERS.top.look);
  const lookGoal = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const introStart = performance.now();

  function chapterPose(progress) {
    let i = 0;
    while (i < anchors.length - 2 && progress > anchors[i + 1].p) i++;
    const a = CHAPTERS[anchors[i].name];
    const b = CHAPTERS[anchors[i + 1].name];
    const span = Math.max(1e-4, anchors[i + 1].p - anchors[i].p);
    const t = smoothstep(0, 1, (progress - anchors[i].p) / span);
    camGoal.lerpVectors(tmpA.fromArray(a.pos), tmpB.fromArray(b.pos), t);
    lookGoal.lerpVectors(tmpA.fromArray(a.look), tmpB.fromArray(b.look), t);
    if (narrow) {
      // phones: the copy fills the width, so pull back, centre the site and aim above it,
      // which drops the house and array into the lower third, under the buttons
      lookGoal.lerp(SITE, 0.6);
      camGoal.sub(lookGoal).multiplyScalar(1.45).add(lookGoal);
      lookGoal.y += 11;
    }
  }

  let lastTime = performance.now();
  function frame(progress, snap) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    skyU.skyTime.value += reduceMotion ? 0 : dt;

    setDay(progress, snap);
    chapterPose(progress);
    if (!reduceMotion) {
      const intro = 1 - easeOutCubic(clamp01((now - introStart) / INTRO_MS));
      if (intro > 0) camGoal.addScaledVector(INTRO_OFFSET, intro);
    }
    lookAt.lerp(lookGoal, snap ? 1 : 0.09);
    camera.position.lerp(camGoal, snap ? 1 : 0.07);
    camera.lookAt(lookAt);
    sky.position.copy(camera.position);

    updateTrackers(snap);
    updatePulses(reduceMotion ? 0 : dt);
    pickPanel();
    renderer.render(scene, camera);
  }

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    narrow = isNarrow();
    if (reduceMotion) frame(progressNow(), true);
  }
  window.addEventListener('resize', onResize, { passive: true });

  let target = 0;
  let current = 0;
  const progressNow = () => (reduceMotion ? target : current);
  setDay(0, true);
  updateTrackers(true);
  camera.position.fromArray(CHAPTERS.top.pos).add(INTRO_OFFSET);
  if (reduceMotion) {
    frame(0, true);
  } else {
    const tick = () => {
      requestAnimationFrame(tick);
      current += (target - current) * 0.06;
      if (Math.abs(target - current) < 5e-5) current = target;
      frame(current, false);
    };
    tick();
  }

  return {
    setProgress(p) {
      target = p;
      if (reduceMotion) frame(p, true);
    },
    setAnchors(byName) {
      anchors = CHAPTER_ORDER.filter((name) => name in byName)
        .map((name) => ({ name, p: byName[name] }))
        .sort((a, b) => a.p - b.p);
      if (reduceMotion) frame(progressNow(), true);
    },
    setPointer(x, y) {
      pointerOn = x !== null;
      if (pointerOn) pointer.set(x, y);
      if (reduceMotion) frame(progressNow(), true);
    },
    onHover(callback) {
      hoverCallback = callback;
    },
  };
}
