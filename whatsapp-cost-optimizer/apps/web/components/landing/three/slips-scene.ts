import * as THREE from "three";
import type { SceneHandle } from "./hero-scene";
import { frameWatch } from "./quality";
import { studioEnvironment } from "./studio";
import { SLIP_ASPECT, fontsReady, paperNormal, rng, slipAtlas } from "./textures";

const FOG = "#0c1712";
const SLIP_W = 0.66;
const SLIP_H = SLIP_W * SLIP_ASPECT;
const NEAR_Z = 0.5;
const FAR_Z = -8.5;

/**
 * Closing scene: printed statements falling through the dark the way paper really falls: rocking
 * from side to side, sliding as it tilts, slowly turning. Each one is a curled sheet of thermal
 * paper with a real print, lit by the same studio as the hero, fading with distance. Moving the
 * pointer through them pushes them aside. Three draw calls, rendered only while on screen.
 *
 * In the calm version (system set to reduce motion) they do not fall on their own: they come down
 * as the page is scrolled, still give way to the pointer, and the scene rests in between.
 */
export async function createSlipsScene(canvas: HTMLCanvasElement, opts: { calm: boolean; small: boolean }): Promise<SceneHandle> {
  await fontsReady();
  let calm = opts.calm;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  let ratio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 8, 19.5);
  const studio = studioEnvironment(renderer, 1.5);
  scene.environment = studio.texture;
  scene.environmentIntensity = 0.7;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  camera.position.set(0, 0, 10);
  const key = new THREE.DirectionalLight("#fff3df", 2.2);
  key.position.set(-4, 6, 7);
  scene.add(key);

  const atlas = slipAtlas(opts.small ? 256 : 384);
  const fibres = paperNormal();
  const material = new THREE.MeshStandardMaterial({ map: atlas.texture, normalMap: fibres, normalScale: new THREE.Vector2(0.25, 0.25), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, envMapIntensity: 0.6 });
  // The back of thermal paper is blank: only a ghost of the print shows through.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n\tif ( ! gl_FrontFacing ) diffuseColor.rgb = mix( vec3( 0.86, 0.85, 0.81 ), diffuseColor.rgb, 0.1 );");
  };

  const total = opts.small ? 21 : 42;
  const perKind = Math.floor(total / atlas.count);
  const r = rng(77);
  const geos: THREE.BufferGeometry[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  for (let v = 0; v < atlas.count; v++) {
    // A sheet with the curl of the roll still in it; each kind curls a little differently.
    const geo = new THREE.PlaneGeometry(SLIP_W, SLIP_H, 4, 14);
    const pos = geo.attributes.position!;
    const uv = geo.attributes.uv!;
    const curl = 0.55 + v * 0.35;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / SLIP_H; // -0.5 .. 0.5
      const x = pos.getX(i) / SLIP_W;
      pos.setZ(i, Math.sin((y + 0.5) * curl * Math.PI) * 0.09 * (v % 2 ? -1 : 1) + x * y * 0.12);
      uv.setX(i, (v + uv.getX(i)) / atlas.count);
    }
    geo.computeVertexNormals();
    geos.push(geo);
    const mesh = new THREE.InstancedMesh(geo, material, perKind);
    mesh.frustumCulled = false;
    scene.add(mesh);
    meshes.push(mesh);
  }

  const slips = Array.from({ length: perKind * atlas.count }, () => ({
    x: r() * 2 - 1,
    y: r(),
    z: FAR_Z + r() * (NEAR_Z - FAR_Z),
    fall: 0.03 + r() * 0.035,
    rock: 0.9 + r() * 1.1, // how fast it rocks
    swing: 0.35 + r() * 0.5, // how far it slides sideways while rocking
    phase: r() * 6.28,
    yaw: (r() - 0.5) * 0.5,
    lean: (r() - 0.5) * 0.7,
    scale: 0.8 + r() * 0.6,
    // What the pointer did to it: an offset that drifts back.
    ox: 0,
    oy: 0,
    vx: 0,
    vy: 0,
  }));

  const dummy = new THREE.Object3D();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const here = new THREE.Vector3();
  const hit = new THREE.Vector3();
  const ptr = { x: 9, y: 9, dx: 0, dy: 0, moved: 0 };
  let halfW = 5;
  let halfH = 4;
  let active = false;
  let disposed = false;
  let raf = 0;
  let time = 0;
  let last = 0;
  let scroll = 0;
  let busy = false;
  // Slow devices: sharpness first, then resolution.
  const watch = frameWatch(() => {
    ratio = ratio > 1 ? 1 : 0.66;
    renderer.setPixelRatio(ratio);
    fit();
    return ratio > 0.66;
  });

  function fit() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Half extents of the view at the farthest slip, so the field always covers the canvas.
    halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (10 - FAR_Z);
    halfW = halfH * camera.aspect;
  }

  function draw() {
    const now = performance.now();
    const raw = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.05, raw);
    last = now;
    watch(raw);
    // Calm version: the sheets do not fall on their own, the page's scroll brings them down instead.
    if (!calm) time += dt;
    const drift = calm ? scroll * 3.2 : scroll * 0.3;
    const sway = calm ? scroll * 5 : 0;
    const span = halfH * 2 + 2.4;
    const blowing = ptr.moved > 0.02;
    if (blowing) {
      ndc.set(ptr.x, ptr.y);
      raycaster.setFromCamera(ndc, camera);
    }
    busy = blowing;
    slips.forEach((s, i) => {
      const fallen = (s.y + time * s.fall + drift * (calm ? s.fall * 10 : 1)) % 1;
      const rock = (time + sway) * s.rock + s.phase;
      // Falling-leaf motion: it slides toward the side it is tilted to, and drops faster when edge-on.
      const tilt = Math.sin(rock) * 0.95;
      const depthScale = (10 - s.z) / (10 - FAR_Z);
      here.set(s.x * halfW * depthScale * 1.05 + Math.cos(rock) * s.swing, (halfH + 1.2 - fallen * span) * depthScale + Math.abs(Math.cos(rock)) * 0.12, s.z);
      if (blowing) {
        // Push away from the pointer's ray, and along the way the pointer is moving.
        raycaster.ray.closestPointToPoint(here, hit);
        const ax = here.x + s.ox - hit.x;
        const ay = here.y + s.oy - hit.y;
        const d = Math.hypot(ax, ay);
        if (d < 1.7) {
          const f = (1 - d / 1.7) ** 2 * ptr.moved * 26;
          s.vx += (ax / (d || 1)) * f + ptr.dx * f * 3;
          s.vy += (ay / (d || 1)) * f + ptr.dy * f * 3;
        }
      }
      s.vx *= 0.93;
      s.vy *= 0.93;
      s.ox = (s.ox + s.vx * dt) * 0.992;
      s.oy = (s.oy + s.vy * dt) * 0.992;
      if (Math.abs(s.vx) + Math.abs(s.vy) > 0.02 || Math.abs(s.ox) + Math.abs(s.oy) > 0.01) busy = true;
      dummy.position.set(here.x + s.ox, here.y + s.oy, here.z);
      const kick = Math.hypot(s.vx, s.vy);
      dummy.rotation.set(1.15 + Math.sin(rock * 0.5 + s.phase) * 0.35 + s.lean + kick * 0.25, s.yaw + (time + sway) * 0.12 * (s.lean > 0 ? 1 : -1) + kick * 0.4, tilt * 0.75);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      meshes[i % meshes.length]!.setMatrixAt(Math.floor(i / meshes.length), dummy.matrix);
    });
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    ptr.moved *= 0.85;
    renderer.render(scene, camera);
  }

  function loop() {
    raf = 0;
    if (!active || disposed) return;
    draw();
    // The calm version only keeps drawing while sheets pushed by the pointer are still settling.
    if (!calm || busy) raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!active || raf) return;
    last = performance.now(); // the time spent at rest is not a frame
    raf = requestAnimationFrame(loop);
  };

  fit();

  return {
    pointerMove(x, y) {
      if (Math.abs(x) < 1.3 && Math.abs(y) < 1.3 && Math.abs(ptr.x) < 5) {
        ptr.dx = x - ptr.x;
        ptr.dy = y - ptr.y;
        ptr.moved = Math.min(0.5, ptr.moved + Math.hypot(ptr.dx, ptr.dy));
        kick();
      }
      ptr.x = x;
      ptr.y = y;
      return false;
    },
    pointerDown: () => false,
    pointerUp: () => undefined,
    setFocus: () => undefined,
    setScroll(p) {
      scroll = p;
      kick();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) kick();
    },
    setCalm(on) {
      calm = on;
      kick();
    },
    resize() {
      fit();
      kick();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      for (const g of geos) g.dispose();
      for (const m of meshes) m.dispose();
      material.dispose();
      atlas.texture.dispose();
      fibres.dispose();
      studio.dispose();
      renderer.dispose();
    },
  };
}
