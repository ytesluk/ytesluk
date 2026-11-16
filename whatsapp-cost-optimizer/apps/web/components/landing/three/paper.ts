import * as THREE from "three";

/** How the paper leaves the machine, in world space (updated every frame from the machine's pose). */
export interface SlotFrame {
  origin: THREE.Vector3;
  /** Direction the paper travels as it comes out. */
  exit: THREE.Vector3;
  /** Across the paper. */
  right: THREE.Vector3;
}

/** A moving "hand" near the paper: pushes what is close to the pointer's ray. */
export interface Gust {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  push: THREE.Vector3;
  radius: number;
}

const GUIDE = 0.12; // length the exit guide still holds flat
const INSIDE = 0.4; // how far inside the machine unprinted paper is parked
const GRAVITY = 15;
const DRAG = 0.986;
const ITERATIONS = 12;
export const STEP = 1 / 60;

/**
 * The receipt as a sheet of particles (position-based dynamics): it does not stretch, it resists
 * bending the way thin paper does, it is fed out of the slot at printing speed, it rests against
 * the machine instead of passing through it, and it can be torn off and left to fall.
 *
 * Row 0 is the free end (first out, bottom of the texture); the last row is the one still in the slot.
 */
export class PaperSim {
  readonly rows: number;
  readonly cols: number;
  readonly width: number;
  readonly length: number;
  readonly count: number;
  readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly held: Uint8Array;
  private readonly ca: Int32Array;
  private readonly cb: Int32Array;
  private readonly rest: Float32Array;
  private readonly stiff: Float32Array;
  private readonly ds: number;
  private readonly dw: number;
  /** Length already fed out of the slot. */
  fed = 0;
  /** Torn off: nothing holds the sheet any more. */
  detached = false;
  /** Strength of the light draught that keeps the sheet from being perfectly still (0 = none). */
  breeze = 1;

  constructor(width: number, length: number, rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.width = width;
    this.length = length;
    this.ds = length / rows;
    this.dw = width / cols;
    this.count = (rows + 1) * (cols + 1);
    this.pos = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.held = new Uint8Array(this.count);

    const a: number[] = [];
    const b: number[] = [];
    const rest: number[] = [];
    const stiff: number[] = [];
    const link = (r1: number, k1: number, r2: number, k2: number, k: number) => {
      if (r2 > rows || k2 > cols || k2 < 0) return;
      a.push(this.index(r1, k1));
      b.push(this.index(r2, k2));
      rest.push(Math.hypot((r2 - r1) * this.ds, (k2 - k1) * this.dw));
      stiff.push(k);
    };
    for (let r = 0; r <= rows; r++) {
      for (let k = 0; k <= cols; k++) {
        link(r, k, r + 1, k, 1); // along the strip: paper does not stretch
        link(r, k, r, k + 1, 1); // across
        link(r, k, r + 1, k + 1, 0.7); // shear
        link(r, k, r + 1, k - 1, 0.7);
        link(r, k, r + 2, k, 0.14); // bending along the strip: thin paper droops easily
        link(r, k, r, k + 2, 0.9); // paper stays flat across its width
      }
      link(r, 0, r, cols, 0.9);
    }
    this.ca = Int32Array.from(a);
    this.cb = Int32Array.from(b);
    this.rest = Float32Array.from(rest);
    this.stiff = Float32Array.from(stiff);
  }

  index(row: number, col: number): number {
    return row * (this.cols + 1) + col;
  }

  /** Everything back inside the machine, ready to print again. */
  reset(slot: SlotFrame) {
    this.fed = 0;
    this.detached = false;
    this.hold(slot, true);
  }

  /** Lets go of the sheet and gives it a first shove. */
  detach(impulse: THREE.Vector3, spin: number) {
    this.detached = true;
    for (let r = 0; r <= this.rows; r++) {
      for (let k = 0; k <= this.cols; k++) {
        const i = this.index(r, k) * 3;
        const side = (k / this.cols - 0.5) * spin;
        this.prev[i] = (this.pos[i] as number) - impulse.x * STEP;
        this.prev[i + 1] = (this.pos[i + 1] as number) - impulse.y * STEP;
        this.prev[i + 2] = (this.pos[i + 2] as number) - (impulse.z + side) * STEP;
      }
    }
  }

  /** Places the rows the machine still controls (inside it, or in the exit guide). */
  private hold(slot: SlotFrame, all: boolean) {
    const { pos, prev, held } = this;
    for (let r = 0; r <= this.rows; r++) {
      const out = this.fed - r * this.ds; // how far this row is past the slot (negative: still inside)
      const mine = !this.detached && (all || out < GUIDE);
      for (let k = 0; k <= this.cols; k++) {
        const n = this.index(r, k);
        held[n] = mine ? 1 : 0;
        if (!mine) continue;
        const i = n * 3;
        const along = Math.max(out, -INSIDE);
        const x = (k / this.cols - 0.5) * this.width;
        if (all) {
          pos[i] = slot.origin.x + slot.exit.x * along + slot.right.x * x;
          pos[i + 1] = slot.origin.y + slot.exit.y * along + slot.right.y * x;
          pos[i + 2] = slot.origin.z + slot.exit.z * along + slot.right.z * x;
          prev[i] = pos[i] as number;
          prev[i + 1] = pos[i + 1] as number;
          prev[i + 2] = pos[i + 2] as number;
        } else {
          // Remember where it was: when the guide lets go, the row leaves with the feed's speed.
          prev[i] = pos[i] as number;
          prev[i + 1] = pos[i + 1] as number;
          prev[i + 2] = pos[i + 2] as number;
          pos[i] = slot.origin.x + slot.exit.x * along + slot.right.x * x;
          pos[i + 1] = slot.origin.y + slot.exit.y * along + slot.right.y * x;
          pos[i + 2] = slot.origin.z + slot.exit.z * along + slot.right.z * x;
        }
      }
    }
  }

  /** One fixed step of STEP seconds. `inv`/`mat` take a point into and out of the machine's space. */
  step(slot: SlotFrame, inv: THREE.Matrix4, mat: THREE.Matrix4, half: THREE.Vector3, gust: Gust | null, time: number) {
    const { pos, prev, held, cols, rows } = this;
    this.hold(slot, false);

    const h2 = STEP * STEP;
    const curlRows = Math.max(2, Math.round(rows * 0.2));
    const mid = Math.floor(cols / 2);
    for (let r = 0; r <= rows; r++) {
      // Curl memory of the roll: the free end wants to lift toward the printed side.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (r < curlRows) {
        const a = this.index(r, 0) * 3;
        const b = this.index(r, cols) * 3;
        const c = this.index(r, mid) * 3;
        const d = this.index(r + 1, mid) * 3;
        const ax = (pos[b] as number) - (pos[a] as number);
        const ay = (pos[b + 1] as number) - (pos[a + 1] as number);
        const az = (pos[b + 2] as number) - (pos[a + 2] as number);
        const tx = (pos[d] as number) - (pos[c] as number);
        const ty = (pos[d + 1] as number) - (pos[c + 1] as number);
        const tz = (pos[d + 2] as number) - (pos[c + 2] as number);
        nx = ay * tz - az * ty;
        ny = az * tx - ax * tz;
        nz = ax * ty - ay * tx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const k = (15 * (1 - r / curlRows) ** 2) / len;
        nx *= k;
        ny *= k;
        nz *= k;
      }
      const along = r / rows;
      // A light draught, so the sheet is never perfectly still.
      const breeze = this.breeze * (1 - along) * (Math.sin(time * 1.1 + r * 0.21) * 0.55 + Math.sin(time * 2.3 + r * 0.4) * 0.25);
      for (let k = 0; k <= cols; k++) {
        const n = this.index(r, k);
        if (held[n]) continue;
        const i = n * 3;
        const px = pos[i] as number;
        const py = pos[i + 1] as number;
        const pz = pos[i + 2] as number;
        let ax = nx;
        let ay = ny - GRAVITY;
        let az = nz + breeze;
        if (gust) {
          const ox = px - gust.origin.x;
          const oy = py - gust.origin.y;
          const oz = pz - gust.origin.z;
          const t = ox * gust.dir.x + oy * gust.dir.y + oz * gust.dir.z;
          const dx = ox - gust.dir.x * t;
          const dy = oy - gust.dir.y * t;
          const dz = oz - gust.dir.z * t;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < gust.radius) {
            const f = (1 - dist / gust.radius) ** 2;
            ax += gust.push.x * f;
            ay += gust.push.y * f;
            az += gust.push.z * f;
          }
        }
        pos[i] = px + (px - (prev[i] as number)) * DRAG + ax * h2;
        pos[i + 1] = py + (py - (prev[i + 1] as number)) * DRAG + ay * h2;
        pos[i + 2] = pz + (pz - (prev[i + 2] as number)) * DRAG + az * h2;
        prev[i] = px;
        prev[i + 1] = py;
        prev[i + 2] = pz;
      }
    }

    const { ca, cb, rest, stiff } = this;
    const e = mat.elements;
    const ie = inv.elements;
    for (let it = 0; it < ITERATIONS; it++) {
      for (let c = 0; c < ca.length; c++) {
        const a = ca[c] as number;
        const b = cb[c] as number;
        const wa = held[a] ? 0 : 1;
        const wb = held[b] ? 0 : 1;
        if (wa + wb === 0) continue;
        const i = a * 3;
        const j = b * 3;
        const dx = (pos[j] as number) - (pos[i] as number);
        const dy = (pos[j + 1] as number) - (pos[i + 1] as number);
        const dz = (pos[j + 2] as number) - (pos[i + 2] as number);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const corr = (((dist - (rest[c] as number)) / dist) * (stiff[c] as number)) / (wa + wb);
        if (wa) {
          pos[i] = (pos[i] as number) + dx * corr;
          pos[i + 1] = (pos[i + 1] as number) + dy * corr;
          pos[i + 2] = (pos[i + 2] as number) + dz * corr;
        }
        if (wb) {
          pos[j] = (pos[j] as number) - dx * corr;
          pos[j + 1] = (pos[j + 1] as number) - dy * corr;
          pos[j + 2] = (pos[j + 2] as number) - dz * corr;
        }
      }
      // The paper rests against the machine: anything that got inside is pushed out of the nearest face.
      if (it % 3 === 2) {
        for (let n = 0; n < this.count; n++) {
          if (held[n]) continue;
          const i = n * 3;
          const x = pos[i] as number;
          const y = pos[i + 1] as number;
          const z = pos[i + 2] as number;
          const lx = (ie[0] as number) * x + (ie[4] as number) * y + (ie[8] as number) * z + (ie[12] as number);
          const ly = (ie[1] as number) * x + (ie[5] as number) * y + (ie[9] as number) * z + (ie[13] as number);
          const lz = (ie[2] as number) * x + (ie[6] as number) * y + (ie[10] as number) * z + (ie[14] as number);
          const px = half.x - Math.abs(lx);
          const py = half.y - Math.abs(ly);
          const pz = half.z - Math.abs(lz);
          if (px <= 0 || py <= 0 || pz <= 0) continue;
          let ox = lx;
          let oy = ly;
          let oz = lz;
          if (pz <= px && pz <= py) oz = Math.sign(lz || 1) * half.z;
          else if (py <= px) oy = Math.sign(ly || 1) * half.y;
          else ox = Math.sign(lx || 1) * half.x;
          pos[i] = (e[0] as number) * ox + (e[4] as number) * oy + (e[8] as number) * oz + (e[12] as number);
          pos[i + 1] = (e[1] as number) * ox + (e[5] as number) * oy + (e[9] as number) * oz + (e[13] as number);
          pos[i + 2] = (e[2] as number) * ox + (e[6] as number) * oy + (e[10] as number) * oz + (e[14] as number);
        }
      }
    }
  }
}

/** Geometry that mirrors the simulated sheet (front and back share it). */
export function paperGeometry(sim: PaperSim): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const uv = new Float32Array(sim.count * 2);
  const idx: number[] = [];
  for (let r = 0; r <= sim.rows; r++) {
    for (let k = 0; k <= sim.cols; k++) {
      const n = sim.index(r, k);
      uv[n * 2] = k / sim.cols;
      uv[n * 2 + 1] = r / sim.rows;
      if (r < sim.rows && k < sim.cols) {
        const a = n;
        const b = sim.index(r + 1, k);
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  geo.setIndex(idx);
  geo.setAttribute("position", new THREE.BufferAttribute(sim.pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}
