import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Toy-like shapes in the page's swatch colours, cel-shaded with a light outline like the page's badges.
const holder = document.querySelector('.hero-3d');
const canvas = holder?.querySelector('canvas');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer = null;
try {
  renderer = canvas && new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch {
  renderer = null;
}

if (!renderer) {
  holder?.remove();
} else {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 11);

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 5);
  scene.add(key);

  // three flat bands of light, like a printed sticker
  const bands = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  bands.minFilter = bands.magFilter = THREE.NearestFilter;
  bands.needsUpdate = true;
  const css = getComputedStyle(document.documentElement);
  const swatch = (name) => new THREE.Color(css.getPropertyValue(name).trim());
  const rim = new THREE.MeshBasicMaterial({ color: swatch('--line'), side: THREE.BackSide });
  const shapes = [
    [new RoundedBoxGeometry(1.5, 1.5, 1.5, 4, 0.28), '--sun', [-1.6, 1.15, 0]],
    [new THREE.TorusGeometry(0.72, 0.3, 24, 48), '--mint', [1.35, 1.5, -0.6]],
    [new THREE.SphereGeometry(0.78, 40, 24), '--pink', [0.35, -0.2, 0.8]],
    [new THREE.ConeGeometry(0.75, 1.5, 40), '--sky', [-1.25, -1.55, -0.3]],
    [new THREE.CapsuleGeometry(0.42, 1.0, 8, 24), '--tomato', [1.75, -1.25, 0.1]],
    [new THREE.TorusGeometry(0.45, 0.16, 16, 40), '--lime', [-0.3, 2.2, -1.2]],
  ].map(([geometry, colour, pos], i) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color: swatch(colour), gradientMap: bands }));
    const outline = new THREE.Mesh(geometry, rim);
    outline.scale.setScalar(1.045);
    mesh.add(outline);
    mesh.position.fromArray(pos);
    mesh.rotation.set(i * 0.7, i * 1.1, i * 0.4);
    scene.add(mesh);
    return { mesh, base: mesh.position.y, phase: i * 1.3, spin: 0.15 + (i % 3) * 0.08 };
  });

  const group = new THREE.Group();
  shapes.forEach(({ mesh }) => group.add(mesh));
  scene.add(group);

  function resize() {
    const w = holder.clientWidth;
    const h = holder.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole cluster in frame on narrow, tall boxes
    camera.position.z = w / h < 1 ? 11 / (w / h) ** 0.7 : 11;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(holder);
  resize();

  const pointer = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  function draw(t) {
    shapes.forEach(({ mesh, base, phase, spin }) => {
      mesh.position.y = base + Math.sin(t * 0.9 + phase) * 0.14;
      mesh.rotation.x += spin * 0.01;
      mesh.rotation.y += spin * 0.014;
    });
    group.rotation.y += (pointer.x * 0.45 - group.rotation.y) * 0.05;
    group.rotation.x += (pointer.y * 0.25 - group.rotation.x) * 0.05;
    renderer.render(scene, camera);
  }

  if (reduceMotion) {
    draw(0);
  } else {
    // only animate while the hero is on screen
    let visible = true;
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(holder);
    const start = performance.now();
    const tick = () => {
      requestAnimationFrame(tick);
      if (visible && !document.hidden) draw((performance.now() - start) / 1000);
    };
    tick();
  }
}
