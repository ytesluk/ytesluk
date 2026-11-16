import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, decalTexture, fontsReady, ghostBubbleTexture, paperBackTexture, receiptTexture } from "./textures";

export interface SceneHandle {
  /** Pointer position over the viewport, each axis in [-1, 1] (y grows downwards). */
  setPointer(x: number, y: number): void;
  /** How far the hero has scrolled away, in [0, 1]. */
  setScroll(p: number): void;
  /** Rendering only runs while the scene is on screen. */
  setActive(on: boolean): void;
  resize(): void;
  dispose(): void;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const backOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + 2.2 * x * x * x + 1.2 * x * x;
};

/** Scene units. The frame the camera must always contain: */
const DESIGN_W = 7.1;
const DESIGN_H = 6.9;
const LOOK_Y = -0.12;

const PAPER_W = 2.2;
const PAPER_L = 4.55;
const ROWS = 72;
const COLS = 8;
const SLOT = new THREE.Vector3(0, 1.5, 0.8);

/**
 * Hero scene: the logo come to life. A small printing machine feeds out the statement, which hangs,
 * sways and curls like real paper; around it float the one message that was delivered (solid) and
 * the ones that never had to be sent (dashed outlines).
 */
export async function createHeroScene(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }): Promise<SceneHandle> {
  await fontsReady();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.18;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 80);
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // Light: a warm key from the upper left, paper-coloured fill, and a lime rim coming from the sun.
  scene.add(new THREE.HemisphereLight("#fbf8ee", "#1b3a2d", 1.45));
  const key = new THREE.DirectionalLight("#fff3dc", 2.9);
  key.position.set(-4.5, 6.5, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 26;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(C.lime, 1.5);
  rim.position.set(4, -4.5, -3);
  scene.add(rim);

  const rig = new THREE.Group();
  rig.position.x = 0.45;
  scene.add(rig);

  // ---- the machine -------------------------------------------------------------------------
  const bodyMat = keep(new THREE.MeshStandardMaterial({ color: C.green, roughness: 0.62, metalness: 0.05 }));
  const body = new THREE.Mesh(keep(new RoundedBoxGeometry(2.95, 1.3, 1.6, 8, 0.3)), bodyMat);
  body.position.set(0, 1.9, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  rig.add(body);

  const lid = new THREE.Mesh(keep(new RoundedBoxGeometry(2.3, 0.1, 1.02, 4, 0.05)), keep(new THREE.MeshStandardMaterial({ color: C.greenHi, roughness: 0.5 })));
  lid.position.set(0, 2.53, -0.04);
  lid.receiveShadow = true;
  rig.add(lid);

  const slot = new THREE.Mesh(keep(new RoundedBoxGeometry(2.42, 0.17, 0.16, 4, 0.07)), keep(new THREE.MeshStandardMaterial({ color: C.deep, roughness: 0.9 })));
  slot.position.set(0, SLOT.y + 0.02, 0.76);
  rig.add(slot);

  const led = new THREE.Mesh(keep(new THREE.SphereGeometry(0.055, 20, 14)), keep(new THREE.MeshStandardMaterial({ color: C.lime, emissive: C.lime, emissiveIntensity: 1.6 })));
  led.position.set(1.12, 2.2, 0.8);
  rig.add(led);

  const decal = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.92, 0.2875)), keep(new THREE.MeshBasicMaterial({ map: keep(decalTexture()), transparent: true, toneMapped: false })));
  decal.position.set(-0.8, 2.13, 0.803);
  rig.add(decal);

  // ---- the paper ---------------------------------------------------------------------------
  const paperGeo = keep(new THREE.BufferGeometry());
  const vCount = (ROWS + 1) * (COLS + 1);
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx: number[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let k = 0; k < COLS; k++) {
      const a = j * (COLS + 1) + k;
      const b = a + COLS + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  paperGeo.setIndex(idx);
  paperGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  paperGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));

  const aspect = PAPER_L / PAPER_W;
  const frontMat = keep(new THREE.MeshStandardMaterial({ map: keep(receiptTexture(aspect, maxAniso)), roughness: 0.96, alphaTest: 0.5, side: THREE.FrontSide }));
  frontMat.shadowSide = THREE.DoubleSide;
  const backMat = keep(new THREE.MeshStandardMaterial({ map: keep(paperBackTexture(aspect)), roughness: 1, alphaTest: 0.5, side: THREE.BackSide }));
  const paperFront = new THREE.Mesh(paperGeo, frontMat);
  paperFront.castShadow = true;
  paperFront.receiveShadow = true;
  paperFront.frustumCulled = false;
  const paperBack = new THREE.Mesh(paperGeo, backMat);
  paperBack.frustumCulled = false;
  rig.add(paperFront, paperBack);

  /** Lays the paper out: `out` = how much has been fed (0–1), `wind` = extra flutter. */
  function layPaper(out: number, time: number, wind: number, lean: number) {
    const len = Math.max(0.0001, out) * PAPER_L;
    const ds = len / ROWS;
    let y = SLOT.y;
    let z = SLOT.z;
    for (let j = 0; j <= ROWS; j++) {
      const s = j * ds; // distance from the slot
      const e = len - s; // distance to the free end
      const along = s / PAPER_L;
      const exit = 1.22 * (1 - smooth(0, 0.6, s));
      const curl = 0.9 * Math.pow(1 - smooth(0, 1.05, e), 2);
      const sway = (0.085 + wind * 0.3) * Math.pow(along, 1.15) * Math.sin(1.75 * s - 1.35 * time);
      const theta = exit + curl + sway + lean * along * 0.5 - 0.035;
      const ny = Math.sin(theta);
      const nz = Math.cos(theta);
      const twist = along * (0.11 * Math.sin(0.62 * time + 0.9) + wind * 0.25 * Math.sin(2.1 * time));
      const ct = Math.cos(twist);
      const st = Math.sin(twist);
      const v = e / PAPER_L;
      for (let k = 0; k <= COLS; k++) {
        const u = k / COLS;
        const x = (u - 0.5) * PAPER_W;
        const cup = 0.045 * (1 - (2 * u - 1) * (2 * u - 1)) * Math.min(1, s * 2);
        const off = x * st + cup;
        const i = (j * (COLS + 1) + k) * 3;
        pos[i] = x * ct;
        pos[i + 1] = y + off * ny;
        pos[i + 2] = z + off * nz;
        const t = (j * (COLS + 1) + k) * 2;
        uv[t] = u;
        uv[t + 1] = v;
      }
      y -= ds * Math.cos(theta);
      z += ds * Math.sin(theta);
    }
    paperGeo.attributes.position!.needsUpdate = true;
    paperGeo.attributes.uv!.needsUpdate = true;
    paperGeo.computeVertexNormals();
  }

  // ---- messages ----------------------------------------------------------------------------
  const float = new THREE.Group();
  scene.add(float);
  interface Floater {
    obj: THREE.Object3D;
    base: THREE.Vector3;
    rot: number;
    phase: number;
    depth: number;
    delay: number;
    scale: number;
  }
  const floaters: Floater[] = [];

  // The one that was delivered: a solid bubble.
  {
    const w = 1.55;
    const h = 0.98;
    const r = 0.27;
    const x0 = -w / 2;
    const x1 = w / 2;
    const y0 = -h / 2;
    const y1 = h / 2;
    const sh = new THREE.Shape();
    sh.moveTo(x0 + r, y1);
    sh.lineTo(x1 - r, y1);
    sh.quadraticCurveTo(x1, y1, x1, y1 - r);
    sh.lineTo(x1, y0 + r);
    sh.quadraticCurveTo(x1, y0, x1 - r, y0);
    sh.lineTo(x0 + r * 1.9, y0);
    sh.lineTo(x0 + r * 0.25, y0 - r * 0.95);
    sh.lineTo(x0, y0 + r * 0.9);
    sh.lineTo(x0, y1 - r);
    sh.quadraticCurveTo(x0, y1, x0 + r, y1);
    const geo = keep(new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 12 }));
    geo.translate(0, 0, -0.08);
    const g = new THREE.Group();
    const bubble = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ color: C.paper, roughness: 0.9 })));
    bubble.castShadow = true;
    g.add(bubble);
    const lineMat = keep(new THREE.MeshStandardMaterial({ color: C.ink, roughness: 1 }));
    const limeMat = keep(new THREE.MeshStandardMaterial({ color: C.lime, roughness: 0.8, emissive: C.lime, emissiveIntensity: 0.25 }));
    const bar = (wid: number, x: number, yy: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(keep(new RoundedBoxGeometry(wid, 0.07, 0.03, 2, 0.03)), mat);
      m.position.set(x0 + 0.26 + wid / 2 + x, yy, 0.135);
      g.add(m);
    };
    bar(0.95, 0, 0.22, lineMat);
    bar(0.62, 0, 0.02, lineMat);
    bar(0.38, 0, -0.2, limeMat);
    float.add(g);
    floaters.push({ obj: g, base: new THREE.Vector3(1.82, 0.3, 1.1), rot: -0.58, phase: 0.4, depth: 1.1, delay: 1.1, scale: 0.8 });
  }

  // The ones that never had to be sent.
  const ghostGeo = keep(new THREE.PlaneGeometry(1.92, 1.5));
  const ghosts: Array<[string, number, number, number, number, number]> = [
    ["REPETIDA", -2.05, 0.6, -0.9, 0.4, 0.86],
    ["SUBSTITUÍDA", 2.1, -1.6, -0.8, -0.34, 0.86],
    ["JUNTADA", -1.98, -1.95, -0.5, 0.46, 0.78],
  ];
  ghosts.forEach(([caption, x, y, z, rot, scale], i) => {
    const mat = keep(new THREE.MeshBasicMaterial({ map: keep(ghostBubbleTexture(caption)), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const m = new THREE.Mesh(ghostGeo, mat);
    float.add(m);
    floaters.push({ obj: m, base: new THREE.Vector3(x, y, z), rot, phase: 1.3 + i * 1.7, depth: z, delay: 1.35 + i * 0.16, scale });
  });

  // ---- state & loop ------------------------------------------------------------------------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, lastX: 0 };
  let wind = 0;
  let scroll = 0;
  let active = false;
  let raf = 0;
  let disposed = false;
  let time = 0; // seconds of animation actually shown (it does not advance while off screen)
  let last = 0;
  // Slow devices: after the intro, if most frames take longer than ~30 fps allows, give up
  // sharpness first (pixel ratio 1) and soft shadows second. It never steps back up.
  let quality = 2;
  let measured = 0;
  let slow = 0;
  function stepDown() {
    quality -= 1;
    if (quality === 1) {
      renderer.setPixelRatio(1);
      fit();
    } else {
      renderer.shadowMap.enabled = false;
      key.castShadow = false;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.needsUpdate = true;
      });
    }
  }

  function fit() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const visH = Math.max(DESIGN_H, DESIGN_W / camera.aspect);
    const dist = visH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, LOOK_Y + 0.85, dist);
    camera.lookAt(0, LOOK_Y, 0);
    camera.updateProjectionMatrix();
  }

  function draw() {
    const now = performance.now();
    const dt = Math.max(0, (now - last) / 1000);
    time += Math.min(0.05, dt);
    last = now;
    if (quality > 0 && !opts.reducedMotion && time > 3.2) {
      measured += 1;
      if (dt > 0.034) slow += 1;
      if (measured >= 90) {
        if (slow > 60) stepDown();
        measured = 0;
        slow = 0;
      }
    }
    const since = opts.reducedMotion ? 99 : time;
    const t = opts.reducedMotion ? 0 : time;

    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    wind *= 0.94;

    rig.rotation.y = -0.44 + pointer.x * 0.24 + scroll * 0.4;
    rig.rotation.x = 0.07 + pointer.y * 0.09 - scroll * 0.06;
    rig.position.y = Math.sin(t * 0.7) * 0.035 + scroll * 0.55;

    // The machine pulses its light while it prints, then rests.
    const out = easeOut((since - 0.25) / 2.1);
    (led.material as THREE.MeshStandardMaterial).emissiveIntensity = out < 1 ? 1.2 + Math.sin(since * 16) * 0.9 : 1.5 + Math.sin(t * 1.6) * 0.25;
    layPaper(out, t, wind, pointer.x * 0.1);

    for (const f of floaters) {
      const k = backOut((since - f.delay) / 0.7);
      f.obj.visible = k > 0.001;
      f.obj.scale.setScalar(Math.max(0.0001, k) * f.scale);
      f.obj.position.set(0.45 + f.base.x + pointer.x * 0.16 * (1 + f.depth), f.base.y + Math.sin(t * 0.8 + f.phase) * 0.09 - pointer.y * 0.08 * (1 + f.depth) + scroll * (0.9 + f.depth * 0.5), f.base.z);
      f.obj.rotation.set(Math.sin(t * 0.6 + f.phase) * 0.05 + pointer.y * 0.06, f.rot + pointer.x * 0.16 + Math.sin(t * 0.5 + f.phase) * 0.06, Math.sin(t * 0.7 + f.phase * 2) * 0.035);
    }
    renderer.render(scene, camera);
  }

  function loop() {
    raf = 0;
    if (!active || disposed) return;
    draw();
    if (!opts.reducedMotion) raf = requestAnimationFrame(loop);
  }

  fit();
  layPaper(opts.reducedMotion ? 1 : 0, 0, 0, 0);

  return {
    setPointer(x, y) {
      wind = Math.min(1, wind + Math.abs(x - pointer.lastX) * 1.6);
      pointer.lastX = x;
      pointer.tx = x;
      pointer.ty = y;
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
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
