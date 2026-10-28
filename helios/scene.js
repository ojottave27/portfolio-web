import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Proportions of a 60-cell module, 1722 × 1134 mm. One scene unit is about 0.506 m.
const PANEL_W = 3.4;
const PANEL_D = 2.24;
const PANEL_T = 0.11;
const FRAME = 0.055;
const CELL_COLS = 10; // cells along the long side
const CELL_ROWS = 6;
const TILT = THREE.MathUtils.degToRad(22);

const NARROW = 900;
const SKY = {
  zenith: 0x05070e,
  horizon: 0x2a2128,
  glow: 0xc9772a,
  sun: 0xffc27a,
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 glow;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float band;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float s = max(dot(dir, sunDir), 0.0);
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));
    // warm band along the horizon, strongest under the sun
    col += glow * exp(-abs(h) * band) * (0.25 + 1.1 * pow(s, 8.0));
    col += sunColor * pow(s, 220.0) * 0.45;
    // kept below the tone-mapping shoulder so the disc stays warm instead of washing out to white
    col += sunColor * smoothstep(0.99955, 0.99975, s) * 0.7;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const isNarrow = () => window.innerWidth < NARROW;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Low on the horizon, behind the array. On phones it sits at the right edge, under the
// hero text, with a tighter glow so the copy stays readable.
function sunDirection(narrow) {
  const az = THREE.MathUtils.degToRad(narrow ? 7 : 19);
  const el = THREE.MathUtils.degToRad(narrow ? 0.9 : 2.8);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

const bandFor = (narrow) => (narrow ? 22 : 10);

function skyMaterial(sunDir, narrow) {
  return new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      glow: { value: new THREE.Color(SKY.glow) },
      sunColor: { value: new THREE.Color(SKY.sun) },
      sunDir: { value: sunDir.clone() },
      band: { value: bandFor(narrow) },
    },
  });
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
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, W, H);

  const cw = (W - pad * 2 - gap * (CELL_COLS - 1)) / CELL_COLS;
  const ch = (H - pad * 2 - gap * (CELL_ROWS - 1)) / CELL_ROWS;
  for (let row = 0; row < CELL_ROWS; row++) {
    for (let col = 0; col < CELL_COLS; col++) {
      const x = pad + col * (cw + gap);
      const y = pad + row * (ch + gap);
      // small tone shift per cell, like real wafers
      const k = 0.86 + (((row * CELL_COLS + col) * 37) % 23) / 100;
      ctx.fillStyle = `rgb(${Math.round(16 * k)},${Math.round(24 * k)},${Math.round(54 * k)})`;
      ctx.fillRect(x, y, cw, ch);
      const sheen = ctx.createLinearGradient(x, y, x + cw, y + ch);
      sheen.addColorStop(0, 'rgba(60,86,150,.16)');
      sheen.addColorStop(1, 'rgba(4,8,18,.20)');
      ctx.fillStyle = sheen;
      ctx.fillRect(x, y, cw, ch);

      ctx.strokeStyle = 'rgba(120,145,190,.18)';
      ctx.lineWidth = 0.7;
      for (let i = 1; i < 18; i++) {
        const fy = y + (i / 18) * ch;
        line(ctx, x + 2, fy, x + cw - 2, fy);
      }
      ctx.strokeStyle = 'rgba(175,195,230,.42)';
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        const bx = x + (i / 4) * cw;
        line(ctx, bx, y + 2, bx, y + ch - 2);
      }

      // monocrystalline wafers have clipped corners
      const c = Math.min(cw, ch) * 0.09;
      ctx.fillStyle = '#05070d';
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
    frame: new THREE.MeshStandardMaterial({ color: 0x9aa0ab, roughness: 0.4, metalness: 0.8 }),
    // the cells sit under a clear-coated glass layer that mirrors the sky
    face: new THREE.MeshPhysicalMaterial({
      map: cellTexture(maxAnisotropy),
      roughness: 0.42,
      metalness: 0.1,
      emissive: 0x0a1430,
      emissiveIntensity: 0.4,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      clearcoatNormalMap: glassNoise(),
      clearcoatNormalScale: new THREE.Vector2(0.02, 0.02),
    }),
    jbox: new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.7, metalness: 0.1 }),
  };
  return { geometry, material };
}

function gridPositions(cols, rows) {
  const stepX = PANEL_W + 0.62;
  const stepZ = PANEL_D + 0.95;
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      out.push([(col - (cols - 1) / 2) * stepX, (row - (rows - 1) / 2) * stepZ]);
    }
  }
  return out;
}

function panelArray(parts, positions, offset = [0, 0]) {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  for (const key of ['back', 'frame', 'face', 'jbox']) {
    const mesh = new THREE.InstancedMesh(parts.geometry[key], parts.material[key], positions.length);
    positions.forEach(([x, z], i) => {
      dummy.position.set(x + offset[0], 0.72, z + offset[1]);
      dummy.rotation.set(TILT, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

function postArray(positions) {
  const material = new THREE.MeshStandardMaterial({ color: 0x404a5c, roughness: 0.42, metalness: 0.75 });
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), material, positions.length * 2);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (const [x, z] of positions) {
    for (const dx of [-PANEL_W * 0.34, PANEL_W * 0.34]) {
      dummy.position.set(x + dx, 0.35, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Starts the background scene. Returns null when WebGL is unavailable,
 * otherwise an object whose setProgress(0..1) follows the page scroll.
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let narrow = isNarrow();
  let sunDir = sunDirection(narrow);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY.horizon, 0.0085);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 6, 20);

  // sky dome that travels with the camera, so the horizon stays at infinity
  const skyMat = skyMaterial(sunDir, narrow);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // the same sky, smaller, baked into the environment map that panels and frames reflect
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSkyMat = skyMaterial(sunDir, narrow);
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envSkyMat));
  let envTarget = null;
  const bakeEnvironment = () => {
    envTarget?.dispose();
    envTarget = pmrem.fromScene(envScene, 0.02);
    scene.environment = envTarget.texture;
  };
  bakeEnvironment();
  scene.environmentIntensity = 0.9;

  scene.add(new THREE.HemisphereLight(0x9fb3d9, 0x2a1f18, 0.55));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.8);
  key.position.set(12, 20, 18);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
  fill.position.set(-8, 10, 16);
  scene.add(fill);
  // warm rim light from the setting sun, behind the array
  const rim = new THREE.DirectionalLight(0xffb066, 2.2);
  const placeRim = () => rim.position.copy(sunDir).multiplyScalar(60);
  placeRim();
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    // slightly glossy, so the ground picks up the glow near the horizon
    new THREE.MeshStandardMaterial({ color: 0x0e1016, roughness: 0.72, metalness: 0.04 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const parts = panelParts(renderer.capabilities.getMaxAnisotropy());
  const mainPositions = gridPositions(6, 4);
  const array = new THREE.Group();
  array.add(panelArray(parts, mainPositions), postArray(mainPositions));
  scene.add(array);

  // distant blocks of a utility-scale field, fading into the haze
  const field = new THREE.Group();
  const block = gridPositions(9, 3);
  for (const offset of [[-46, -78], [-8, -96], [34, -82], [72, -104]]) {
    field.add(panelArray(parts, block, offset));
  }
  scene.add(field);

  const camGoal = new THREE.Vector3();
  const lookAt = new THREE.Vector3(0, 1.4, -2.5);
  const lookGoal = new THREE.Vector3();

  function frame(progress, snap) {
    const rise = smoothstep(0, 0.62, progress);
    const settle = smoothstep(0.58, 1, progress);
    if (narrow) {
      camGoal.set(0, 6.6 - rise * 0.5, 20 - rise * 1.2);
      lookAt.set(0, 9.8 - rise * 0.35, -9 + rise * 0.6);
    } else {
      camGoal.set(2.2 * rise - 0.8 * settle, 6 - 2.4 * rise + 2.2 * settle, 20 - 7.5 * rise + 4 * settle);
      lookGoal.set(4.6 * rise - 1.2 * settle, 1.4 - 0.4 * rise + 0.3 * settle, -2.5 - 3.2 * rise - settle);
      lookAt.lerp(lookGoal, snap ? 1 : 0.14);
    }
    camera.position.lerp(camGoal, snap ? 1 : 0.085);
    camera.lookAt(lookAt);
    sky.position.copy(camera.position);

    array.rotation.y = progress * 0.55;
    array.position.set(narrow ? 0 : 10.2, rise * 0.12, narrow ? -24 : -6.8);
    array.scale.setScalar(narrow ? 1 : 0.85);
    renderer.render(scene, camera);
  }

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    if (isNarrow() !== narrow) {
      narrow = isNarrow();
      sunDir = sunDirection(narrow);
      for (const mat of [skyMat, envSkyMat]) {
        mat.uniforms.sunDir.value.copy(sunDir);
        mat.uniforms.band.value = bandFor(narrow);
      }
      placeRim();
      bakeEnvironment();
    }
    if (reduceMotion) frame(0, true);
  }
  window.addEventListener('resize', onResize, { passive: true });

  let target = 0;
  let current = 0;
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
    },
  };
}
