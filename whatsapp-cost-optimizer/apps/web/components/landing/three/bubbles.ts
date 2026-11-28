import * as THREE from "three";
import { ghostBubbleTexture } from "./textures";

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** Width of the outline picture, in scene units before scaling. */
const W = 1.92;

interface Placed {
  caption: string;
  /** Where it floats (x relative to the machine's home), and its resting turn about the vertical axis. */
  at: readonly [number, number, number];
  turn: number;
  /** The same on a phone, where all three stack down the left of the statement. */
  narrowAt: readonly [number, number, number];
  narrowTurn: number;
  scale: number;
  /** Only on a phone: fills the right side, which the wide layout leaves to the copy. */
  narrowOnly?: boolean;
}

const MESSAGES: readonly Placed[] = [
  { caption: "R$ 0,00", at: [-2.2, 1.8, 0.7], turn: 0.36, narrowAt: [-2.2, 0.85, 0.4], narrowTurn: 0.36, scale: 0.6 },
  { caption: "FORA DA FATURA", at: [2.0, -1.0, -0.3], turn: -0.32, narrowAt: [-2.2, -2.3, 0.5], narrowTurn: 0.4, scale: 0.6 },
  { caption: "NÃO COBRADA", at: [-2.3, -1.3, 0.9], turn: 0.42, narrowAt: [-2.2, -0.75, 0.6], narrowTurn: 0.4, scale: 0.54 },
  // Phone only: behind the machine, on the right of the background.
  { caption: "SEM CUSTO", at: [0, 0, 0], turn: 0, narrowAt: [2.3, 0.05, -0.6], narrowTurn: -0.4, scale: 0.54, narrowOnly: true },
  { caption: "ECONOMIZADA", at: [0, 0, 0], turn: 0, narrowAt: [2.3, -2.75, -0.3], narrowTurn: -0.38, scale: 0.54, narrowOnly: true },
];

export interface BubbleFrame {
  time: number;
  /** 1 when things may move on their own, 0 in the calm version. */
  ambient: number;
  /** Eased pointer, each axis in about [-1, 1]. */
  px: number;
  py: number;
  scroll: number;
  /** Close-up on the statement, 0..1: the outlines fade out of the way. */
  focus: number;
  /** Half the width of what the camera sees at the machine's depth. */
  halfWidth: number;
  /** Where the machine's home is. */
  home: THREE.Vector3;
}

/**
 * The messages that never had to be sent. They are not real objects, so they are not rendered like
 * one: only a dashed outline (the same "dashed = not real money" convention as the estimate tags)
 * with the reason underneath, drifting around the machine and leaning with the pointer.
 */
export function buildBubbles(keep: Keep, narrow: boolean): { group: THREE.Group; update(f: BubbleFrame): void } {
  const group = new THREE.Group();
  const geo = keep(new THREE.PlaneGeometry(W, 1.5));
  const items = MESSAGES.filter((m) => narrow || !m.narrowOnly).map((spec, i) => {
    const mat = keep(new THREE.MeshBasicMaterial({ map: keep(ghostBubbleTexture(spec.caption)), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    return { mesh, mat, at: narrow ? spec.narrowAt : spec.at, turn: narrow ? spec.narrowTurn : spec.turn, scale: spec.scale * (narrow ? 0.85 : 1), phase: 1.3 + i * 1.7 };
  });

  return {
    group,
    update(f) {
      for (const it of items) {
        const { at } = it;
        const depth = 1 + at[2] * 0.6;
        // Keep the outline inside the picture instead of letting the edge cut it (nearer ones look bigger).
        const side = Math.sign(at[0]);
        const reach = Math.max(0.9, (f.halfWidth - 0.32) / (1 + at[2] * 0.085) - W * it.scale * 0.5 - f.home.x * side);
        const x = side * Math.min(Math.abs(at[0]), reach);
        it.mesh.visible = f.focus < 0.98;
        it.mat.opacity = 1 - f.focus;
        it.mesh.scale.setScalar(it.scale);
        it.mesh.position.set(f.home.x + x + f.px * 0.34 * depth, at[1] + Math.sin(f.time * 0.8 + it.phase) * 0.08 * f.ambient + f.py * 0.16 * depth + f.scroll * (0.7 + at[2] * 0.5), at[2]);
        it.mesh.rotation.set(Math.sin(f.time * 0.6 + it.phase) * 0.05 * f.ambient - f.py * 0.1, it.turn + f.px * 0.3 + Math.sin(f.time * 0.5 + it.phase) * 0.06 * f.ambient, Math.sin(f.time * 0.7 + it.phase * 2) * 0.03 * f.ambient);
      }
    },
  };
}
