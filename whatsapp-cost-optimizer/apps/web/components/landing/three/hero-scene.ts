import * as THREE from "three";
import { buildBubbles } from "./bubbles";
import { fontsReady } from "./fonts";
import { DESIGN_H, DESIGN_W } from "./frame";
import { PaperSim, STEP, paperGeometry, type Gust, type SlotFrame } from "./paper";
import { SLOT, buildPrinter } from "./printer";
import { frameWatch } from "./quality";
import { studioEnvironment } from "./studio";
import { RECEIPTS, RECEIPT_ASPECT, RECEIPT_TOTAL_AT, paperNormal, receiptTextures } from "./textures";

export interface SceneHandle {
  /** Pointer over the canvas, each axis in [-1, 1] (y up); may go past the edges. Returns true while over the machine. */
  pointerMove(x: number, y: number): boolean;
  /** Starts a drag if the pointer is on the machine. */
  pointerDown(x: number, y: number): boolean;
  /** Ends a drag; `click` = the pointer did not travel, so it counts as pressing the feed key. */
  pointerUp(click: boolean): void;
  /** How far the hero has scrolled away, in [0, 1]. */
  setScroll(p: number): void;
  /** Close-up on the highlighted total, in [0, 1]. */
  setFocus(f: number): void;
  /** Rendering only runs while the scene is on screen. */
  setActive(on: boolean): void;
  /** Calm version: nothing moves on its own or follows the pointer; what the visitor does on purpose still answers. */
  setCalm(on: boolean): void;
  resize(): void;
  dispose(): void;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const LOOK_Y = -0.02;
const FOV = 26;

const PAPER_W = 1.55;
const PAPER_L = PAPER_W * RECEIPT_ASPECT;
const ROWS = 46;
const COLS = 6;
const PRINT_SPEED = 2.5;
/** Where the highlighted total sits along the strip (0 = free end, 1 = slot). */
const TOTAL_AT = 1 - RECEIPT_TOTAL_AT;

const HOME = new THREE.Vector3(0.3, 1.5, 0);
const YAW = -0.52;
const PITCH = 0.34;

/**
 * Hero scene: a thermal printer rendered like a product photo, printing the statement. The paper
 * is a physical sheet: it is fed out, hangs, swings when the machine is turned, flutters when the
 * pointer passes, and tears off when the feed key is pressed, after which a new statement prints.
 * The machine turns toward the pointer, can be dragged around with inertia, and the camera moves
 * in on the highlighted total when the page asks for the close-up.
 *
 * In the calm version (system set to reduce motion) the scene is just as physical, but it only
 * moves when the visitor acts on it: drag, click, scroll. It does not sway, follow the pointer or
 * blink, and it stops drawing once everything has come to rest.
 */
export async function createHeroScene(canvas: HTMLCanvasElement, opts: { calm: boolean; small: boolean; narrow: boolean }): Promise<SceneHandle> {
  await fontsReady();
  let calm = opts.calm;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  let ratio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const scene = new THREE.Scene();
  const studio = keep(studioEnvironment(renderer));
  scene.environment = studio.texture;
  scene.environmentIntensity = 0.95;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);

  // One shadow-casting key light; everything else comes from the studio map.
  const key = new THREE.DirectionalLight("#fff3df", 2.3);
  key.position.set(-5.5, 8, 8.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4.5;
  key.shadow.camera.right = 4.5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 3.5;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#dcf45b", 0.7);
  rim.position.set(5, -5, -5);
  scene.add(rim);

  // ---- machine -----------------------------------------------------------------------------
  const rig = new THREE.Group();
  rig.position.copy(HOME);
  rig.rotation.set(PITCH, YAW, 0);
  scene.add(rig);
  const printer = buildPrinter(keep);
  rig.add(printer.group);

  // ---- paper -------------------------------------------------------------------------------
  const sim = new PaperSim(PAPER_W, PAPER_L, ROWS, COLS);
  const paperGeo = keep(paperGeometry(sim));
  const fibres = keep(paperNormal());
  const texWidth = opts.small ? 768 : Math.min(1280, Math.floor(renderer.capabilities.maxTextureSize / RECEIPT_ASPECT));
  let variant = 0;
  let sheets = receiptTextures(RECEIPTS[0]!, texWidth, maxAniso);
  const frontMat = keep(
    new THREE.MeshPhysicalMaterial({ map: sheets.front, normalMap: fibres, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.58, alphaTest: 0.5, side: THREE.FrontSide, envMapIntensity: 0.6 }),
  );
  frontMat.shadowSide = THREE.DoubleSide;
  const backMat = keep(new THREE.MeshStandardMaterial({ map: sheets.back, normalMap: fibres, normalScale: new THREE.Vector2(0.2, 0.2), roughness: 0.78, alphaTest: 0.5, side: THREE.BackSide, envMapIntensity: 0.5 }));
  const paperFront = new THREE.Mesh(paperGeo, frontMat);
  paperFront.castShadow = true;
  paperFront.receiveShadow = true;
  paperFront.frustumCulled = false;
  const paperBack = new THREE.Mesh(paperGeo, backMat);
  paperBack.receiveShadow = true;
  paperBack.frustumCulled = false;
  scene.add(paperFront, paperBack);

  const slot: SlotFrame = { origin: new THREE.Vector3(), exit: new THREE.Vector3(), right: new THREE.Vector3() };
  const inv = new THREE.Matrix4();
  const rot = new THREE.Matrix3();
  function readSlot() {
    rig.updateMatrixWorld(true);
    slot.origin.set(SLOT.x, SLOT.y, SLOT.z).applyMatrix4(rig.matrixWorld);
    rot.setFromMatrix4(rig.matrixWorld);
    slot.exit.set(0, -0.07, 1).normalize().applyMatrix3(rot);
    slot.right.set(1, 0, 0).applyMatrix3(rot);
    inv.copy(rig.matrixWorld).invert();
  }

  // ---- the messages that never had to be sent ----------------------------------------------
  const bubbles = buildBubbles(keep, opts.narrow);
  scene.add(bubbles.group);

  // ---- state -------------------------------------------------------------------------------
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, px: 0, py: 0 };
  const drag = { on: false, yaw: 0, pitch: 0, vy: 0, vp: 0, lx: 0, ly: 0, idle: 9 };
  const gust: Gust = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), push: new THREE.Vector3(), radius: 0.8 };
  const raycaster = new THREE.Raycaster();
  const localRay = new THREE.Ray();
  const body = new THREE.Box3(printer.half.clone().negate(), printer.half.clone());
  const ndc = new THREE.Vector2();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  let scroll = 0;
  let focus = 0;
  let focusNow = 0;
  let phase: "printing" | "idle" | "tearing" = "idle";
  let tearT = 0;
  let pressed = 0;
  let halfWidth = 4;
  let active = false;
  let disposed = false;
  let raf = 0;
  let time = 0;
  let last = 0;
  let acc = 0;
  /** Calm version: the scene keeps drawing until this moment, then rests until something happens. */
  let wake = 0;
  let baseDist = 10;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const total = new THREE.Vector3();

  // Devices that cannot hold a smooth frame rate give up picture quality for speed, one step at a
  // time, and never step back up: first sharpness, then the shadows, then resolution.
  let quality = 3;
  const watch = frameWatch(() => {
    quality -= 1;
    if (quality === 2) {
      ratio = Math.min(ratio, 1);
    } else if (quality === 1) {
      renderer.shadowMap.enabled = false;
      key.castShadow = false;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.needsUpdate = true;
      });
    } else {
      ratio = 0.75;
    }
    renderer.setPixelRatio(ratio);
    fit();
    return quality > 0;
  });

  function fit() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const visH = Math.max(DESIGN_H, DESIGN_W / camera.aspect);
    halfWidth = (visH * camera.aspect) / 2;
    baseDist = visH / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.updateProjectionMatrix();
  }

  /** Is the pointer on the machine? Its ray against the machine's box, in the machine's own space (no triangles tested). */
  function overMachine(x: number, y: number): boolean {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    localRay.copy(raycaster.ray).applyMatrix4(inv);
    return localRay.intersectsBox(body);
  }

  /** Feed key: tears the statement off and prints the next one. */
  function feed() {
    pressed = 1;
    if (phase !== "idle") return;
    phase = "tearing";
    tearT = 0;
    frontMat.transparent = true;
    backMat.transparent = true;
    frontMat.needsUpdate = true;
    backMat.needsUpdate = true;
    sim.detach(new THREE.Vector3(slot.exit.x * 2.2, 1.4, slot.exit.z * 2.2), 5.5);
  }

  function nextStatement() {
    variant = (variant + 1) % RECEIPTS.length;
    sheets.front.dispose();
    sheets.back.dispose();
    sheets = receiptTextures(RECEIPTS[variant]!, texWidth, maxAniso);
    frontMat.map = sheets.front;
    backMat.map = sheets.back;
    frontMat.opacity = 1;
    backMat.opacity = 1;
    frontMat.transparent = false;
    backMat.transparent = false;
    frontMat.needsUpdate = true;
    backMat.needsUpdate = true;
    sim.reset(slot);
    phase = "printing";
  }

  function draw() {
    const now = performance.now();
    const dt = Math.max(0, (now - last) / 1000);
    const step = Math.min(0.05, dt);
    last = now;
    time += step;
    if (time > 1.2) watch(dt);
    /** 1 when the scene may move on its own, 0 in the calm version. */
    const ambient = calm ? 0 : 1;

    // --- pose: base angle, the pointer it turns toward, the user's drag, the page's scroll -----
    focusNow += (focus - focusNow) * 0.09;
    const f = smooth(0, 1, focusNow);
    ptr.x += (ptr.tx - ptr.x) * 0.075;
    ptr.y += (ptr.ty - ptr.y) * 0.075;
    if (!drag.on) {
      drag.yaw += drag.vy;
      drag.pitch = clamp(drag.pitch + drag.vp, -0.6, 0.7);
      drag.vy *= 0.93;
      drag.vp *= 0.9;
      drag.idle += step;
      if (drag.idle > 1.5) {
        // Back to the showcase angle by the shortest way round.
        const turns = Math.round(drag.yaw / (Math.PI * 2));
        if (turns !== 0) {
          drag.yaw -= turns * Math.PI * 2;
          rig.rotation.y -= turns * Math.PI * 2;
        }
        drag.yaw *= 0.955;
        drag.pitch *= 0.95;
      }
    }
    const follow = 1 - 0.8 * f;
    const yawT = YAW * (1 - f) + ptr.x * 0.34 * follow + drag.yaw + scroll * 0.85 * (1 - f);
    const pitchT = PITCH * (1 - 0.6 * f) - ptr.y * 0.17 * follow + drag.pitch - scroll * 0.1;
    const ease = drag.on ? 0.34 : 0.11;
    rig.rotation.y += (yawT - rig.rotation.y) * ease;
    rig.rotation.x += (pitchT - rig.rotation.x) * ease;
    rig.rotation.z = -ptr.x * 0.03 * follow;
    rig.position.set(HOME.x + ptr.x * 0.14 * follow - f * HOME.x, HOME.y + ptr.y * 0.07 * follow + Math.sin(time * 0.7) * 0.02 * ambient + scroll * 0.25 * (1 - f), HOME.z);
    readSlot();
    // Anything still on its way somewhere keeps the calm version drawing; the paper then needs a moment to come to rest.
    if (
      phase !== "idle" ||
      drag.on ||
      pressed > 0.01 ||
      Math.abs(drag.vy) > 0.0004 ||
      Math.abs(drag.yaw) > 0.002 ||
      Math.abs(drag.pitch) > 0.002 ||
      Math.abs(focus - focusNow) > 0.002 ||
      Math.abs(yawT - rig.rotation.y) > 0.002 ||
      Math.abs(pitchT - rig.rotation.x) > 0.002 ||
      gust.push.lengthSq() > 0.5
    )
      wake = time + 2.5;

    // --- printing, resting, tearing off ---------------------------------------------------------
    pressed *= 0.86;
    printer.press(pressed);
    if (phase === "printing") printer.setPower(calm || Math.sin(time * 34) > 0 ? 1 : 0.35);
    else if (phase === "idle") printer.setPower(0.86 + Math.sin(time * 1.6) * 0.14 * ambient);
    else printer.setPower(0.3);
    if (phase === "tearing") {
      tearT += step;
      const o = 1 - smooth(0.3, 0.95, tearT);
      frontMat.opacity = o;
      backMat.opacity = o;
      if (tearT > 1) nextStatement();
    }

    // --- physics --------------------------------------------------------------------------------
    sim.breeze = ambient;
    acc = Math.min(acc + step, STEP * 3);
    while (acc >= STEP) {
      acc -= STEP;
      if (phase === "printing") {
        sim.fed = Math.min(PAPER_L, sim.fed + PRINT_SPEED * STEP);
        if (sim.fed >= PAPER_L) phase = "idle";
      }
      const blowing = gust.push.lengthSq() > 0.5;
      sim.step(slot, inv, rig.matrixWorld, printer.half, blowing ? gust : null, time);
      gust.push.multiplyScalar(0.84);
    }
    paperGeo.attributes.position!.needsUpdate = true;
    paperGeo.computeVertexNormals();

    // --- camera: the whole machine, or in close on the highlighted total ------------------------
    const row = Math.round(TOTAL_AT * ROWS);
    const i = sim.index(row, COLS / 2) * 3;
    total.set(sim.pos[i]!, sim.pos[i + 1]!, sim.pos[i + 2]!);
    const closeDist = PAPER_W / 0.82 / camera.aspect / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camPos.set(0, LOOK_Y + 2.7, baseDist).lerp(new THREE.Vector3(total.x, total.y + 0.25, total.z + closeDist), f);
    camLook.set(0, LOOK_Y, 0).lerp(total, f);
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    bubbles.update({ time, ambient, px: ptr.x, py: ptr.y, scroll, focus: f, halfWidth, home: HOME });
    renderer.render(scene, camera);
  }

  function loop() {
    raf = 0;
    if (!active || disposed) return;
    draw();
    if (!calm || time < wake) raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!active || raf) return;
    last = performance.now(); // the time spent at rest is not a frame
    raf = requestAnimationFrame(loop);
  };

  fit();
  readSlot();
  // The page opens with the statement already printed: exactly the still picture shown while this
  // scene loads (scripts/hero-poster.mjs), so the live scene takes over without a jump.
  sim.settle(slot, inv, rig.matrixWorld, printer.half);
  paperGeo.attributes.position!.needsUpdate = true;
  paperGeo.computeVertexNormals();
  // Have the graphics card build every shader before the scene is shown, without freezing the page meanwhile.
  camera.position.set(0, LOOK_Y + 2.7, baseDist);
  camera.lookAt(0, LOOK_Y, 0);
  await renderer.compileAsync(scene, camera).catch(() => undefined);

  return {
    pointerMove(x, y) {
      const dx = x - ptr.px;
      const dy = y - ptr.py;
      ptr.px = x;
      ptr.py = y;
      if (drag.on) {
        drag.vy = (x - drag.lx) * 1.9;
        drag.vp = -(y - drag.ly) * 0.9;
        drag.yaw += drag.vy;
        drag.pitch = clamp(drag.pitch + drag.vp, -0.6, 0.7);
        drag.lx = x;
        drag.ly = y;
        kick();
        return true;
      }
      // It turns toward the pointer, but never so far that the statement stops being readable.
      ptr.tx = calm ? 0 : clamp(x, -1.25, 1.25);
      ptr.ty = calm ? 0 : clamp(y, -1.25, 1.25);
      // The pointer is a hand passing by: it drags air along with it and pushes the paper back.
      if (Math.abs(x) < 1.2 && Math.abs(y) < 1.2) {
        ndc.set(x, y);
        raycaster.setFromCamera(ndc, camera);
        gust.origin.copy(raycaster.ray.origin);
        gust.dir.copy(raycaster.ray.direction);
        camRight.setFromMatrixColumn(camera.matrixWorld, 0);
        camUp.setFromMatrixColumn(camera.matrixWorld, 1);
        const speed = Math.min(0.35, Math.hypot(dx, dy));
        gust.push
          .copy(camRight)
          .multiplyScalar(clamp(dx, -0.35, 0.35) * 520)
          .addScaledVector(camUp, clamp(dy, -0.35, 0.35) * 520)
          .addScaledVector(gust.dir, speed * 300);
        if (gust.push.lengthSq() > 0.5) kick();
      }
      return overMachine(x, y);
    },
    pointerDown(x, y) {
      if (!overMachine(x, y)) return false;
      drag.on = true;
      drag.lx = x;
      drag.ly = y;
      drag.vy = 0;
      drag.vp = 0;
      kick();
      return true;
    },
    pointerUp(click) {
      drag.on = false;
      drag.idle = 0;
      if (click) {
        drag.vy = 0;
        drag.vp = 0;
        feed();
      }
      kick();
    },
    setScroll(p) {
      scroll = p;
      kick();
    },
    setFocus(v) {
      focus = v;
      kick();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        wake = time + 2.5;
        kick();
      }
    },
    setCalm(on) {
      calm = on;
      if (on) {
        ptr.tx = 0;
        ptr.ty = 0;
      }
      wake = time + 2.5;
      kick();
    },
    resize() {
      fit();
      wake = Math.max(wake, time + 0.2);
      kick();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      sheets.front.dispose();
      sheets.back.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
