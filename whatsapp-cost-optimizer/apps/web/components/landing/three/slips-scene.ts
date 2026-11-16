import * as THREE from "three";
import type { SceneHandle } from "./hero-scene";
import { slipTexture } from "./textures";

const COUNT = 44;
const FOG = "#0c1712";

/** Deterministic pseudo-random numbers: the same arrangement on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Closing scene: small statements drifting down through the dark, fading with distance. One draw
 * call (instanced), rendered only while the band is on screen.
 */
export async function createSlipsScene(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }): Promise<SceneHandle> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 7.5, 19);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  camera.position.set(0, 0, 10);

  scene.add(new THREE.HemisphereLight("#f6f3e8", "#0c1712", 1.2));
  const key = new THREE.DirectionalLight("#fff3dc", 2.4);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#dcf45b", 0.45);
  rim.position.set(4, -3, -2);
  scene.add(rim);

  const geo = new THREE.PlaneGeometry(0.62, 0.806);
  const tex = slipTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const r = rng(77);
  const slips = Array.from({ length: COUNT }, () => ({
    x: r() * 2 - 1,
    y: r(),
    z: -8.5 + r() * 8.5,
    fall: 0.035 + r() * 0.05,
    sway: 0.25 + r() * 0.5,
    phase: r() * 6.28,
    spinX: (r() - 0.5) * 1.3,
    spinY: (r() - 0.5) * 1.7,
    spinZ: (r() - 0.5) * 0.7,
    scale: 0.75 + r() * 0.7,
  }));

  const dummy = new THREE.Object3D();
  let halfW = 5;
  let halfH = 4;
  let active = false;
  let disposed = false;
  let raf = 0;
  let time = 0;
  let last = 0;
  let scroll = 0;
  const pointer = { x: 0, tx: 0 };

  function fit() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Half extents of the view at the farthest slip, so the field always covers the canvas.
    halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 18.5; // camera at z = 10, farthest slip at z = -8.5
    halfW = halfH * camera.aspect;
  }

  function draw() {
    const now = performance.now();
    if (!opts.reducedMotion) time += Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    const span = halfH * 2 + 2;
    slips.forEach((s, i) => {
      const fallen = (s.y + time * s.fall + scroll * 0.35) % 1;
      dummy.position.set(s.x * halfW + Math.sin(time * s.sway + s.phase) * 0.45 + pointer.x * (0.25 + (s.z + 8.5) * 0.06), halfH + 1 - fallen * span, s.z);
      dummy.rotation.set(s.phase + time * s.spinX, s.phase * 2 + time * s.spinY, s.phase * 0.5 + time * s.spinZ);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }

  function loop() {
    raf = 0;
    if (!active || disposed) return;
    draw();
    if (!opts.reducedMotion) raf = requestAnimationFrame(loop);
  }

  fit();

  return {
    setPointer(x) {
      pointer.tx = x;
    },
    setScroll(p) {
      scroll = p;
      if (opts.reducedMotion && active && !raf) raf = requestAnimationFrame(loop);
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        last = performance.now();
        if (!raf) raf = requestAnimationFrame(loop);
      }
    },
    resize() {
      fit();
      if (active && !raf) raf = requestAnimationFrame(loop);
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      geo.dispose();
      mat.dispose();
      tex.dispose();
      mesh.dispose();
      renderer.dispose();
    },
  };
}
