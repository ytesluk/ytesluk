import * as THREE from "three";
import { C, MESSAGE_FACE, glowTexture, messageTexture, stampTexture, type MessageSpec } from "./textures";

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** The bubble's body, in scene units; the tail hangs below it. */
const W = 1.72;
const H = 1.06;
const R = 0.25;
const TAIL = (H * (1 - MESSAGE_FACE.body)) / MESSAGE_FACE.body;
const DEPTH = 0.05;
const BEVEL = 0.036;

interface Placed extends MessageSpec {
  /** Where it floats (x relative to the machine's home), and its resting turn about the vertical axis. */
  at: readonly [number, number, number];
  turn: number;
  /** The same on a narrow screen, where all three stack down the left of the statement. */
  narrowAt: readonly [number, number, number];
  narrowTurn: number;
  scale: number;
  /** Tail on the right instead of the left. */
  flip: boolean;
}

const MESSAGES: readonly Placed[] = [
  { stamp: "REPETIDA", label: "AVISO · PEDIDO 4812", lines: ["Seu pedido saiu", "para entrega."], at: [-2.2, 1.95, 0.7], turn: 0.44, narrowAt: [-2.2, 0.95, 0.4], narrowTurn: 0.4, scale: 0.8, flip: false },
  { stamp: "SUBSTITUÍDA", label: "STATUS · PEDIDO 4812", lines: ["Pedido em", "separação."], at: [2.0, -0.87, -0.3], turn: -0.44, narrowAt: [-2.2, -2.25, 0.5], narrowTurn: 0.42, scale: 0.86, flip: true },
  { stamp: "JUNTADA", label: "AVISOS · PEDIDO 4813", lines: ["Pagamento aprovado.", "Nota fiscal emitida."], at: [-2.3, -1.16, 0.9], turn: 0.4, narrowAt: [-2.2, -0.65, 0.6], narrowTurn: 0.38, scale: 0.78, flip: false },
];

/** A chat bubble with thickness: rounded body, tail, bevelled rim. */
function bubbleGeometry(flip: boolean): THREE.ExtrudeGeometry {
  const X = (x: number) => (flip ? W - x : x);
  const s = new THREE.Shape();
  s.moveTo(X(R * 1.9), 0);
  s.lineTo(X(W - R), 0);
  s.quadraticCurveTo(X(W), 0, X(W), R);
  s.lineTo(X(W), H - R);
  s.quadraticCurveTo(X(W), H, X(W - R), H);
  s.lineTo(X(R), H);
  s.quadraticCurveTo(X(0), H, X(0), H - R);
  s.lineTo(X(0), R * 0.9);
  s.lineTo(X(R * 0.15), -TAIL * 0.92);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 4, curveSegments: 12 });
  // The face texture covers the bubble's whole box, tail zone included.
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / W, (pos.getY(i) + TAIL) / (H + TAIL));
  geo.translate(-W / 2, -(H - TAIL) / 2, -DEPTH / 2);
  return geo;
}

const backOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + 2.2 * x * x * x + 1.2 * x * x;
};

export interface BubbleFrame {
  time: number;
  step: number;
  /** 1 when things may move on their own, 0 in the calm version. */
  ambient: number;
  /** Eased pointer, each axis in about [-1, 1]. */
  px: number;
  py: number;
  scroll: number;
  /** Close-up on the statement, 0..1: the bubbles get out of the way. */
  focus: number;
  /** Half the width of what the camera sees at the machine's depth. */
  halfWidth: number;
  /** Where the machine's home is. */
  home: THREE.Vector3;
  /** Where a message's tally enters the machine (world space). */
  intake: THREE.Vector3;
}

export interface Bubbles {
  group: THREE.Group;
  /** Index of the bubble under this ray, or -1. */
  pick(raycaster: THREE.Raycaster): number;
  hover(index: number): void;
  /** Advances one frame. Returns true on the frame a tally reaches the machine. */
  update(f: BubbleFrame): boolean;
}

/**
 * The messages that never had to be sent, floating around the machine: thick glass bubbles with
 * a lit rim, the notice crossed out on the face and the reason stamped across it. They drift,
 * lean toward the pointer and swell under it, and every few seconds one of them sends its tally
 * into the printer as a spark, which is what ends up as a line on the statement.
 */
export function buildBubbles(keep: Keep, anisotropy: number): Bubbles {
  const group = new THREE.Group();
  const rim = keep(new THREE.MeshStandardMaterial({ color: C.lime, emissive: C.lime, emissiveIntensity: 0.5, roughness: 0.36 }));
  const glow = keep(glowTexture());

  const items = MESSAGES.map((spec, i) => {
    const face = keep(messageTexture(spec, anisotropy));
    const faceMat = keep(new THREE.MeshStandardMaterial({ map: face, emissive: "#ffffff", emissiveMap: face, emissiveIntensity: 0.4, roughness: 0.3, envMapIntensity: 1.1 }));
    const body = new THREE.Mesh(keep(bubbleGeometry(spec.flip)), [faceMat, rim]);
    const stamp = stampTexture(spec.stamp, anisotropy);
    keep(stamp.texture);
    const sh = 0.3;
    const stampMat = keep(new THREE.MeshBasicMaterial({ map: stamp.texture, transparent: true, depthWrite: false, toneMapped: false }));
    const stampMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(sh * stamp.aspect, sh)), stampMat);
    const stampHome = new THREE.Vector3(W / 2 - (sh * stamp.aspect) / 2 - 0.1, -(H - TAIL) / 2 + 0.24, DEPTH / 2 + BEVEL + 0.012);
    stampMesh.position.copy(stampHome);
    stampMesh.rotation.z = -0.1;
    const holder = new THREE.Group();
    holder.add(body, stampMesh);
    group.add(holder);
    return { spec, holder, body, faceMat, stampMesh, stampMat, phase: 1.3 + i * 1.7, delay: 0.5 + i * 0.22, hover: 0, punch: 0, shake: 0, stamped: false, world: new THREE.Vector3() };
  });

  // The tally on its way to the machine: a spark and its tail.
  const sparks = [0.34, 0.2].map((size) => {
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glow, color: C.lime, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false })));
    sprite.scale.setScalar(size);
    sprite.visible = false;
    group.add(sprite);
    return { sprite, size };
  });
  const flight = { from: 0, t: 1, next: 3.4, turn: 0 };
  const a = new THREE.Vector3();
  const m = new THREE.Vector3();
  const along = (t: number, out: THREE.Vector3, target: THREE.Vector3) => {
    const u = 1 - t;
    out.set(u * u * a.x + 2 * u * t * m.x + t * t * target.x, u * u * a.y + 2 * u * t * m.y + t * t * target.y, u * u * a.z + 2 * u * t * m.z + t * t * target.z);
  };
  let hovered = -1;

  return {
    group,
    pick(raycaster) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (it.holder.visible && raycaster.intersectObject(it.body, false).length) return i;
      }
      return -1;
    },
    hover(index) {
      hovered = index;
    },
    update(f) {
      const out = 1 - f.focus;
      // 0 on a wide picture, 1 on a phone held upright.
      const narrow = Math.min(1, Math.max(0, (3.1 - f.halfWidth) / 0.4));
      const mix = (wide: number, tight: number) => wide + (tight - wide) * narrow;
      items.forEach((it, i) => {
        const { spec } = it;
        const at = [mix(spec.at[0], spec.narrowAt[0]), mix(spec.at[1], spec.narrowAt[1]), mix(spec.at[2], spec.narrowAt[2])] as const;
        const turn = mix(spec.turn, spec.narrowTurn);
        const size = spec.scale * (1 - narrow * 0.2);
        const k = f.ambient ? backOut((f.time - it.delay) / 0.7) : 1;
        it.hover += ((hovered === i ? 1 : 0) - it.hover) * 0.16;
        it.punch *= 0.88;
        it.shake *= 0.86;
        const depth = 1 + at[2] * 0.6;
        // Keep the bubble inside the picture instead of letting the edge cut it (nearer ones look bigger).
        const side = Math.sign(at[0]);
        const reach = Math.max(0.9, (f.halfWidth - 0.32) / (1 + at[2] * 0.085) - W * size * 0.5 - f.home.x * side);
        const x = side * Math.min(Math.abs(at[0]), reach);
        const drift = f.ambient;
        it.holder.position.set(
          f.home.x + x + f.px * 0.36 * depth + Math.sign(x) * f.focus * 1.8,
          at[1] + Math.sin(f.time * 0.8 + it.phase) * 0.09 * drift + f.py * 0.18 * depth + f.scroll * (0.7 + at[2] * 0.5),
          at[2],
        );
        const face = 1 - it.hover * 0.65; // under the pointer it turns to face the visitor
        it.holder.rotation.set(
          (Math.sin(f.time * 0.6 + it.phase) * 0.07 * drift - f.py * 0.16) * face,
          (turn + f.px * 0.34 + Math.sin(f.time * 0.5 + it.phase) * 0.08 * drift) * face,
          Math.sin(f.time * 0.7 + it.phase * 2) * 0.035 * drift + it.shake * Math.sin(f.time * 48),
        );
        it.holder.scale.setScalar(Math.max(0.0001, k * out) * size * (1 + it.hover * 0.14 + it.punch));
        it.holder.visible = k > 0.001 && out > 0.02;
        it.faceMat.emissiveIntensity = 0.4 + it.hover * 0.22;

        // The stamp comes down once the bubble has arrived.
        const s = f.ambient ? (f.time - it.delay - 0.62) / 0.2 : 1;
        if (s >= 1 && !it.stamped) {
          it.stamped = true;
          if (f.ambient) it.shake = 0.05;
        }
        const land = Math.min(1, Math.max(0, s));
        it.stampMesh.visible = s > 0;
        it.stampMat.opacity = land;
        it.stampMesh.scale.setScalar(1 + (1 - land * land) * 1.5);
        it.holder.getWorldPosition(it.world);
      });

      // One message at a time sends its tally to the machine.
      let arrived = false;
      if (f.ambient && out > 0.6) {
        if (flight.t >= 1 && f.time > flight.next) {
          flight.from = flight.turn++ % items.length;
          flight.t = 0;
          items[flight.from]!.punch = 0.1;
        }
        if (flight.t < 1) {
          const before = flight.t;
          flight.t = Math.min(1, flight.t + f.step / 1.05);
          a.copy(items[flight.from]!.world);
          m.copy(a).lerp(f.intake, 0.5);
          m.y += 1.15;
          sparks.forEach((sp, n) => {
            const t = Math.max(0, flight.t - n * 0.07);
            const eased = t * t * (3 - 2 * t);
            along(eased, sp.sprite.position, f.intake);
            sp.sprite.visible = t > 0 && t < 1;
            (sp.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * Math.min(1, t * 1.02)) ** 0.6 * (n ? 0.5 : 0.95);
            sp.sprite.scale.setScalar(sp.size * (1 - eased * 0.45));
          });
          if (before < 1 && flight.t >= 1) {
            arrived = true;
            flight.next = f.time + 2.4;
            for (const sp of sparks) sp.sprite.visible = false;
          }
        }
      } else if (flight.t < 1) {
        flight.t = 1;
        flight.next = f.time + 1.5;
        for (const sp of sparks) sp.sprite.visible = false;
      }
      return arrived;
    },
  };
}
