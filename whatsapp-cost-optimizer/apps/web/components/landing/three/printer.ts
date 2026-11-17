import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, controlsTexture, glowTexture, logoTexture, plasticGrainNormal, ratingLabelTexture, smudgeRoughness } from "./textures";

/** Outer size of the machine, in scene units (1.55 units = the 80 mm paper). */
export const PRINTER = { W: 2.2, H: 1.42, D: 2.5 };
const hw = PRINTER.W / 2;
const hh = PRINTER.H / 2;
const hd = PRINTER.D / 2;

/** Half extents of the box the paper must stay out of (and the pointer is tested against). */
export const BODY_HALF = new THREE.Vector3(hw + 0.03, hh + 0.02, hd + 0.04);

/** Where the paper leaves the machine, in the machine's own space. */
export const SLOT = { x: 0, y: 0.47, z: hd + 0.012 };

export interface Printer {
  group: THREE.Group;
  /** Meshes that count as "the machine" for picking (drag, click). */
  pickables: THREE.Object3D[];
  /** Half extents of the box the paper must stay out of. */
  half: THREE.Vector3;
  /** Power light: 0 = off, 1 = steady. */
  setPower(level: number): void;
  /** Feed key travel: 0 = up, 1 = fully pressed. */
  press(amount: number): void;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

/**
 * A compact front-exit thermal printer, modelled from primitives: two-part ABS shell with a
 * parting line, piano-black lid, steel tear bar with its saw teeth, control strip with pad-printed
 * legends, lights and a rubber feed key, side vents, lid lever, rubber feet, and the connector
 * panel and rating label on the back. Materials are physically based and lit by the studio map.
 */
export function buildPrinter(keep: Keep): Printer {
  const group = new THREE.Group();
  const grain = keep(plasticGrainNormal());

  const shellMat = keep(
    new THREE.MeshPhysicalMaterial({ color: "#0f4a38", roughness: 0.42, metalness: 0, normalMap: grain, normalScale: new THREE.Vector2(0.2, 0.2), clearcoat: 0.3, clearcoatRoughness: 0.42 }),
  );
  const glossMat = keep(new THREE.MeshPhysicalMaterial({ color: "#050807", roughness: 1, roughnessMap: keep(smudgeRoughness()), metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }));
  const steelMat = keep(new THREE.MeshStandardMaterial({ color: "#d2d6d9", metalness: 1, roughness: 0.24 }));
  const rubberMat = keep(new THREE.MeshStandardMaterial({ color: "#131716", roughness: 0.84 }));
  const keyMat = keep(new THREE.MeshStandardMaterial({ color: "#272c2a", roughness: 0.7 }));
  const cavityMat = keep(new THREE.MeshStandardMaterial({ color: "#020303", roughness: 1 }));
  const panelMat = keep(new THREE.MeshStandardMaterial({ color: "#0b0e0d", roughness: 0.78 }));

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w: number, h: number, d: number, r: number, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);

  // Shell: a base and an upper part with a real gap between them (the parting line).
  const base = add(rbox(PRINTER.W, 0.36, PRINTER.D, 0.06, 4), shellMat, 0, -hh + 0.18, 0);
  add(box(PRINTER.W - 0.07, 0.08, PRINTER.D - 0.07), cavityMat, 0, -hh + 0.375, 0, false);
  const shell = add(rbox(PRINTER.W, 1.03, PRINTER.D, 0.085, 6), shellMat, 0, hh - 0.515, 0);

  // Lid: a glossy cover over the paper bay, with a groove where it meets the control strip.
  const lid = add(rbox(PRINTER.W - 0.22, 0.04, PRINTER.D * 0.58, 0.018), glossMat, 0, hh + 0.014, -0.4);
  add(box(PRINTER.W - 0.24, 0.006, 0.014), cavityMat, 0, hh + 0.001, 0.345, false);

  // Control strip (top, in front of the lid).
  const legends = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.9, 0.475)), keep(new THREE.MeshStandardMaterial({ map: keep(controlsTexture()), transparent: true, depthWrite: false, roughness: 0.6 })));
  legends.rotation.x = -Math.PI / 2;
  legends.position.set(0, hh + 0.0015, 0.84);
  group.add(legends);

  const lens = new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20);
  const powerMat = keep(new THREE.MeshStandardMaterial({ color: "#1c2408", emissive: C.lime, emissiveIntensity: 2.2, roughness: 0.25 }));
  add(lens, powerMat, -0.75, hh + 0.006, 0.8, false);
  add(lens, keep(new THREE.MeshPhysicalMaterial({ color: "#34100d", roughness: 0.18, clearcoat: 1 })), -0.551, hh + 0.006, 0.8, false);
  add(lens, keep(new THREE.MeshPhysicalMaterial({ color: "#33260a", roughness: 0.18, clearcoat: 1 })), -0.3515, hh + 0.006, 0.8, false);
  const glow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(glowTexture()), color: C.lime, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85, toneMapped: false })));
  glow.scale.setScalar(0.36);
  glow.position.set(-0.75, hh + 0.03, 0.8);
  group.add(glow);

  const key = add(rbox(0.44, 0.05, 0.2, 0.022), keyMat, 0.62, hh + 0.016, 0.8);

  // Paper exit (front, near the top): dark throat, steel tear bar with teeth, guide lip, cover edge.
  add(box(1.74, 0.09, 0.02), cavityMat, 0, SLOT.y, hd + 0.001, false);
  add(box(1.76, 0.058, 0.03), steelMat, 0, SLOT.y + 0.078, hd + 0.014);
  const saw = new THREE.Shape();
  const teeth = 58;
  const tw = 1.76 / teeth;
  saw.moveTo(-0.88, 0);
  for (let i = 0; i < teeth; i++) {
    saw.lineTo(-0.88 + (i + 0.5) * tw, -0.022);
    saw.lineTo(-0.88 + (i + 1) * tw, 0);
  }
  saw.lineTo(-0.88, 0);
  add(new THREE.ExtrudeGeometry(saw, { depth: 0.008, bevelEnabled: false }), steelMat, 0, SLOT.y + 0.05, hd + 0.022, false);
  add(rbox(1.84, 0.045, 0.11, 0.02, 2), shellMat, 0, SLOT.y - 0.068, hd + 0.03);
  add(rbox(1.9, 0.05, 0.07, 0.02, 2), shellMat, 0, SLOT.y + 0.132, hd + 0.02);

  // Sides: vents on both, brand mark and lid lever on the right.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) add(box(0.004, 0.36, 0.03), cavityMat, side * (hw + 0.001), 0.15, -1.0 + i * 0.08, false);
  }
  const logo = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.8, 0.3125)), keep(new THREE.MeshStandardMaterial({ map: keep(logoTexture()), transparent: true, depthWrite: false, roughness: 0.5, metalness: 0.2 })));
  logo.rotation.y = Math.PI / 2;
  logo.position.set(hw + 0.002, -0.05, 0.52);
  group.add(logo);
  add(rbox(0.04, 0.12, 0.5, 0.016, 2), rubberMat, hw + 0.008, 0.5, 0.22);

  // Feet.
  const foot = new THREE.CylinderGeometry(0.15, 0.15, 0.05, 28);
  for (const [x, z] of [
    [-0.8, -0.95],
    [0.8, -0.95],
    [-0.8, 0.95],
    [0.8, 0.95],
  ] as const)
    add(foot, rubberMat, x, -hh - 0.022, z);

  // Back: connector panel and rating label.
  add(box(1.5, 0.46, 0.012), panelMat, 0, -0.05, -hd - 0.001, false);
  const port = (w: number, h: number, x: number) => {
    add(box(w, h, 0.03), steelMat, x, -0.05, -hd - 0.016, false);
    add(box(w * 0.7, h * 0.62, 0.031), cavityMat, x, -0.05, -hd - 0.017, false);
  };
  port(0.15, 0.16, -0.5);
  port(0.2, 0.17, -0.2);
  port(0.16, 0.14, 0.08);
  const jack = add(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), steelMat, 0.42, -0.05, -hd - 0.016, false);
  jack.rotation.x = Math.PI / 2;
  const jackHole = add(new THREE.CylinderGeometry(0.032, 0.032, 0.031, 20), cavityMat, 0.42, -0.05, -hd - 0.017, false);
  jackHole.rotation.x = Math.PI / 2;
  const label = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.72, 0.36)), keep(new THREE.MeshStandardMaterial({ map: keep(ratingLabelTexture()), roughness: 0.55 })));
  label.rotation.y = Math.PI;
  label.position.set(0, 0.42, -hd - 0.002);
  group.add(label);

  const keyRest = key.position.y;
  return {
    group,
    pickables: [base, shell, lid],
    half: BODY_HALF,
    setPower(level) {
      powerMat.emissiveIntensity = 2.4 * level;
      (glow.material as THREE.SpriteMaterial).opacity = 0.85 * level;
    },
    press(amount) {
      key.position.y = keyRest - 0.022 * amount;
    },
  };
}
