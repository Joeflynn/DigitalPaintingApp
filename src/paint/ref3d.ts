/**
 * 3D references to trace over: a small WebGL renderer with a handful of
 * built-in models (a poseable mannequin, primitive solids, simple buildings).
 * The models are deliberately plain — they are drawing aids, not artwork.
 */

export type ModelId =
  | "mannequin"
  | "cube"
  | "sphere"
  | "cylinder"
  | "cone"
  | "pyramid"
  | "torus"
  | "shapes"
  | "house"
  | "tower"
  | "street"

export type RefStyle = "shaded" | "both" | "wire"

export const MODELS: { group: string; items: { id: ModelId; label: string }[] }[] = [
  { group: "Figure", items: [{ id: "mannequin", label: "Mannequin" }] },
  {
    group: "Shapes",
    items: [
      { id: "cube", label: "Cube" },
      { id: "sphere", label: "Sphere" },
      { id: "cylinder", label: "Cylinder" },
      { id: "cone", label: "Cone" },
      { id: "pyramid", label: "Pyramid" },
      { id: "torus", label: "Torus" },
      { id: "shapes", label: "Still life" },
    ],
  },
  {
    group: "Buildings",
    items: [
      { id: "house", label: "House" },
      { id: "tower", label: "Tower" },
      { id: "street", label: "Street" },
    ],
  },
]

export interface RefSettings {
  model: ModelId
  pose: string
  style: RefStyle
  floor: boolean
  yaw: number
  pitch: number
  size: number
  fov: number
  x: number
  y: number
}

// ---- matrices (column-major 4×4) ----------------------------------------------

type V3 = [number, number, number]
type M4 = number[]

const RAD = Math.PI / 180

function mul(...ms: M4[]): M4 {
  return ms.reduce((a, b) => {
    const o = new Array<number>(16)
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
        o[c * 4 + r] = s
      }
    return o
  })
}

const identity = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const translate = (x: number, y: number, z: number): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]

function rotX(deg: number): M4 {
  const c = Math.cos(deg * RAD)
  const s = Math.sin(deg * RAD)
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
}
function rotY(deg: number): M4 {
  const c = Math.cos(deg * RAD)
  const s = Math.sin(deg * RAD)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
}
function rotZ(deg: number): M4 {
  const c = Math.cos(deg * RAD)
  const s = Math.sin(deg * RAD)
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

// ---- mesh building ------------------------------------------------------------

/** Triangles and wireframe edges, collected in world space. */
class Mesh {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  lines: number[] = []
  /** Applied to everything added; rotation and translation only. */
  m: M4 = identity()
  color: V3 = [0.8, 0.8, 0.8]

  private point(p: V3): V3 {
    const m = this.m
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ]
  }

  private dir(n: V3): V3 {
    const m = this.m
    return [
      m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
      m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
      m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
    ]
  }

  edge(a: V3, b: V3) {
    this.lines.push(...this.point(a), ...this.point(b))
  }

  /** A triangle; without normals it is shaded flat. */
  tri(a: V3, b: V3, c: V3, normals?: [V3, V3, V3]) {
    const flat = normals ? null : norm(cross(sub(b, a), sub(c, a)))
    ;[a, b, c].forEach((p, i) => {
      this.pos.push(...this.point(p))
      this.nor.push(...this.dir(flat ?? normals![i]))
      this.col.push(...this.color)
    })
  }

  /** A quad a→b→c→d with its outline as wireframe edges. */
  quad(a: V3, b: V3, c: V3, d: V3, normals?: [V3, V3, V3, V3]) {
    this.tri(a, b, c, normals && [normals[0], normals[1], normals[2]])
    this.tri(a, c, d, normals && [normals[0], normals[2], normals[3]])
    this.edge(a, b)
    this.edge(b, c)
    this.edge(c, d)
    this.edge(d, a)
  }

  /** Runs `build` with `m` applied on top of the current transform. */
  at(m: M4, build: () => void) {
    const saved = this.m
    this.m = mul(saved, m)
    build()
    this.m = saved
  }
}

/** A box centred on the origin. */
function box(mesh: Mesh, w: number, h: number, d: number) {
  const x = w / 2
  const y = h / 2
  const z = d / 2
  mesh.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z])
  mesh.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z])
  mesh.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z])
  mesh.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z])
  mesh.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z])
  mesh.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z])
}

/** A cylinder or cone standing on y = 0, `r0` at the bottom and `r1` at the top. */
function cylinder(mesh: Mesh, r0: number, r1: number, h: number, seg = 20, flat = false) {
  const slope = (r0 - r1) / h
  const ring = (r: number, y: number, i: number): V3 => {
    const a = (i / seg) * Math.PI * 2
    return [Math.cos(a) * r, y, Math.sin(a) * r]
  }
  const normal = (i: number): V3 => {
    const a = (i / seg) * Math.PI * 2
    return norm([Math.cos(a), slope, Math.sin(a)])
  }
  for (let i = 0; i < seg; i++) {
    const a = ring(r0, 0, i)
    const b = ring(r0, 0, i + 1)
    const c = ring(r1, h, i + 1)
    const d = ring(r1, h, i)
    const n: [V3, V3, V3, V3] | undefined = flat ? undefined : [normal(i), normal(i + 1), normal(i + 1), normal(i)]
    if (r1 > 0 && r0 > 0) mesh.quad(a, b, c, d, n)
    else if (r0 > 0) {
      mesh.tri(a, b, [0, h, 0], n && [n[0], n[1], normal(i + 0.5)])
      mesh.edge(a, b)
      if (flat || i % 2 === 0) mesh.edge(a, [0, h, 0])
    }
    if (r0 > 0) mesh.tri([0, 0, 0], b, a)
    if (r1 > 0) mesh.tri([0, h, 0], d, c)
  }
}

function ellipsoid(mesh: Mesh, rx: number, ry: number, rz: number, seg = 16, rings = 10) {
  const at = (i: number, j: number): [V3, V3] => {
    const a = (i / seg) * Math.PI * 2
    const b = (j / rings) * Math.PI
    const n: V3 = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]
    return [[n[0] * rx, n[1] * ry, n[2] * rz], norm([n[0] / rx, n[1] / ry, n[2] / rz])]
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const [a, na] = at(i, j)
      const [b, nb] = at(i + 1, j)
      const [c, nc] = at(i + 1, j + 1)
      const [d, nd] = at(i, j + 1)
      mesh.quad(a, b, c, d, [na, nb, nc, nd])
    }
}

/** A ring lying flat around the y axis. */
function torus(mesh: Mesh, R: number, r: number, seg = 28, tube = 12) {
  const at = (i: number, j: number): [V3, V3] => {
    const a = (i / seg) * Math.PI * 2
    const b = (j / tube) * Math.PI * 2
    const n: V3 = [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)]
    return [[Math.cos(a) * R + n[0] * r, n[1] * r, Math.sin(a) * R + n[2] * r], n]
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < tube; j++) {
      const [a, na] = at(i, j)
      const [b, nb] = at(i + 1, j)
      const [c, nc] = at(i + 1, j + 1)
      const [d, nd] = at(i, j + 1)
      mesh.quad(a, b, c, d, [na, nb, nc, nd])
    }
}

/** A gable roof sitting on y = 0 with its ridge along x. */
function gable(mesh: Mesh, w: number, h: number, d: number) {
  const x = w / 2
  const z = d / 2
  mesh.quad([-x, 0, z], [x, 0, z], [x, h, 0], [-x, h, 0])
  mesh.quad([x, 0, -z], [-x, 0, -z], [-x, h, 0], [x, h, 0])
  mesh.tri([x, 0, z], [x, 0, -z], [x, h, 0])
  mesh.tri([-x, 0, -z], [-x, 0, z], [-x, h, 0])
  mesh.edge([x, 0, z], [x, 0, -z])
  mesh.edge([-x, 0, z], [-x, 0, -z])
}

// ---- mannequin ----------------------------------------------------------------

/**
 * A pose, in degrees. Limbs are [forward, outward, twist] from hanging
 * straight down; the trunk and head are [bend forward, turn left, tilt].
 * Elbows and knees just flex.
 */
interface Pose {
  label: string
  /** Height off the floor, for poses caught in mid-air. */
  lift?: number
  root?: V3
  spine?: V3
  chest?: V3
  neck?: V3
  head?: V3
  armL?: V3
  armR?: V3
  elbowL?: number
  elbowR?: number
  handL?: V3
  handR?: V3
  legL?: V3
  legR?: V3
  kneeL?: number
  kneeR?: number
  footL?: number
  footR?: number
}

const POSE_LIBRARY: Record<string, Pose> = {
  standing: {
    label: "Standing",
    armL: [0, 9, 0], armR: [0, 9, 0], elbowL: 8, elbowR: 8,
    legL: [0, 3, 0], legR: [0, 3, 0],
  },
  tpose: { label: "T-pose", armL: [0, 90, 0], armR: [0, 90, 0], legL: [0, 5, 0], legR: [0, 5, 0] },
  contrapposto: {
    label: "Contrapposto",
    root: [0, 0, 7], spine: [0, 0, -7], chest: [0, -8, -6], head: [0, 12, 5],
    armL: [6, 8, 0], elbowL: 12, armR: [-12, 14, 0], elbowR: 35,
    legL: [0, -7, 0], legR: [14, 2, 0], kneeR: 24, footR: 8,
  },
  walking: {
    label: "Walking",
    spine: [3, 0, 0], chest: [0, -7, 0], head: [0, 5, 0],
    armL: [-24, 6, 0], elbowL: 16, armR: [26, 6, 0], elbowR: 32,
    legL: [26, 2, 0], kneeL: 8, footL: -12, legR: [-20, 2, 0], kneeR: 24, footR: 18,
  },
  running: {
    label: "Running",
    lift: 0.06,
    root: [14, 0, 0], chest: [0, -12, 0], head: [-10, 6, 0],
    armL: [-50, 8, 0], elbowL: 95, armR: [55, 8, 0], elbowR: 100,
    legL: [58, 0, 0], kneeL: 85, legR: [-28, 0, 0], kneeR: 50, footR: 35,
  },
  sitting: {
    label: "Sitting",
    spine: [4, 0, 0],
    armL: [24, 8, 0], elbowL: 58, armR: [24, 8, 0], elbowR: 58,
    legL: [86, 7, 0], kneeL: 88, legR: [86, 7, 0], kneeR: 88,
  },
  crouching: {
    label: "Crouching",
    root: [22, 0, 0], spine: [14, 0, 0], head: [-24, 0, 0],
    armL: [62, 12, 0], elbowL: 45, armR: [62, 12, 0], elbowR: 45,
    legL: [118, 14, 0], kneeL: 142, footL: -24, legR: [118, 14, 0], kneeR: 142, footR: -24,
  },
  kneeling: {
    label: "Kneeling",
    armL: [30, 8, 0], elbowL: 45, armR: [10, 10, 0], elbowR: 20,
    legL: [88, 2, 0], kneeL: 92, legR: [-4, 2, 0], kneeR: 96, footR: 55,
  },
  jumping: {
    label: "Jumping",
    lift: 0.3,
    spine: [-8, 0, 0], head: [-10, 0, 0],
    armL: [165, 18, 0], elbowL: 12, armR: [165, 18, 0], elbowR: 12,
    legL: [34, 5, 0], kneeL: 75, footL: 30, legR: [-12, 5, 0], kneeR: 62, footR: 35,
  },
  reaching: {
    label: "Reaching",
    spine: [-4, 0, -4], head: [-22, 0, 0],
    armR: [168, 8, 0], elbowR: 4, armL: [-8, 14, 0], elbowL: 14,
    legL: [0, 4, 0], legR: [0, 4, 0], footL: 28, footR: 28,
  },
  fighting: {
    label: "Guard",
    root: [0, -28, 0], spine: [8, 0, 0], chest: [0, 10, 0], head: [0, 22, 0],
    armL: [72, 14, 0], elbowL: 105, armR: [48, 26, 0], elbowR: 125,
    legL: [22, 12, 0], kneeL: 26, legR: [-16, 12, 0], kneeR: 30, footR: 14,
  },
  waving: {
    label: "Waving",
    head: [0, -8, -5],
    armR: [0, 138, 90], elbowR: 62, armL: [0, 9, 0], elbowL: 8,
    legL: [0, 4, 0], legR: [0, 4, 0],
  },
}

export const POSES = Object.entries(POSE_LIBRARY).map(([id, p]) => ({ id, label: p.label }))

const BODY: V3 = [0.8, 0.78, 0.76]
const JOINT: V3 = [0.62, 0.62, 0.65]

function mannequin(mesh: Mesh, pose: Pose) {
  const bend = (v: V3 = [0, 0, 0]) => mul(rotY(v[1]), rotX(v[0]), rotZ(v[2]))
  const limb = (v: V3 = [0, 0, 0], side: number) => mul(rotX(-v[0]), rotZ(side * v[1]), rotY(side * v[2]))
  // A tapered segment hanging down from the joint, with a ball on the joint.
  const segment = (m: M4, ball: number, r0: number, r1: number, len: number) => {
    mesh.at(m, () => {
      mesh.color = JOINT
      ellipsoid(mesh, ball, ball, ball, 12, 8)
      mesh.color = BODY
      mesh.at(rotZ(180), () => cylinder(mesh, r0, r1, len, 12))
    })
  }
  const lump = (m: M4, c: V3, r: V3) => mesh.at(mul(m, translate(...c)), () => ellipsoid(mesh, ...r))

  mesh.color = BODY
  const root = mul(translate(0, 0.9, 0), bend(pose.root))
  lump(root, [0, 0.02, 0], [0.165, 0.12, 0.115])
  const spine = mul(root, translate(0, 0.07, 0), bend(pose.spine))
  lump(spine, [0, 0.1, 0], [0.135, 0.15, 0.1])
  const chest = mul(spine, translate(0, 0.2, 0), bend(pose.chest))
  lump(chest, [0, 0.15, 0], [0.185, 0.19, 0.125])
  const neck = mul(chest, translate(0, 0.31, 0), bend(pose.neck))
  mesh.at(neck, () => cylinder(mesh, 0.052, 0.048, 0.11, 12))
  const head = mul(neck, translate(0, 0.09, 0), bend(pose.head))
  lump(head, [0, 0.125, 0.01], [0.095, 0.125, 0.108])
  // A nose, so it's clear which way the head faces.
  mesh.color = JOINT
  mesh.at(mul(head, translate(0, 0.105, 0.105), rotX(90)), () => cylinder(mesh, 0.022, 0, 0.045, 8))

  for (const side of [1, -1]) {
    const L = side === 1
    const shoulder = mul(chest, translate(side * 0.215, 0.26, 0), limb(L ? pose.armL : pose.armR, side))
    segment(shoulder, 0.06, 0.052, 0.042, 0.29)
    const elbow = mul(shoulder, translate(0, -0.29, 0), rotX(-((L ? pose.elbowL : pose.elbowR) ?? 0)))
    segment(elbow, 0.046, 0.042, 0.032, 0.26)
    const hand = mul(elbow, translate(0, -0.26, 0), bend(L ? pose.handL : pose.handR))
    mesh.color = BODY
    lump(hand, [0, -0.085, 0], [0.045, 0.09, 0.022])

    const hip = mul(root, translate(side * 0.095, -0.05, 0), limb(L ? pose.legL : pose.legR, side))
    segment(hip, 0.086, 0.082, 0.058, 0.42)
    const knee = mul(hip, translate(0, -0.42, 0), rotX((L ? pose.kneeL : pose.kneeR) ?? 0))
    segment(knee, 0.062, 0.058, 0.04, 0.41)
    const foot = mul(knee, translate(0, -0.41, 0), rotX((L ? pose.footL : pose.footR) ?? 0))
    mesh.at(foot, () => {
      mesh.color = JOINT
      ellipsoid(mesh, 0.046, 0.046, 0.046, 12, 8)
      mesh.color = BODY
      mesh.at(translate(0, -0.035, 0.075), () => box(mesh, 0.095, 0.065, 0.25))
    })
  }

  // Stand the figure on the floor whatever the pose.
  let low = Infinity
  for (let i = 1; i < mesh.pos.length; i += 3) low = Math.min(low, mesh.pos[i])
  low -= pose.lift ?? 0
  for (let i = 1; i < mesh.pos.length; i += 3) mesh.pos[i] -= low
  for (let i = 1; i < mesh.lines.length; i += 3) mesh.lines[i] -= low
}

// ---- other models -------------------------------------------------------------

const WALL: V3 = [0.84, 0.83, 0.8]
const ROOF: V3 = [0.62, 0.56, 0.52]
const TRIM: V3 = [0.68, 0.7, 0.74]

function house(mesh: Mesh) {
  mesh.color = WALL
  mesh.at(translate(0, 1.5, 0), () => box(mesh, 8, 3, 6))
  mesh.color = ROOF
  mesh.at(translate(0, 3, 0), () => gable(mesh, 8.8, 2.4, 6.8))
  mesh.at(translate(2.4, 4.4, -1.2), () => box(mesh, 0.7, 1.8, 0.7))
  mesh.color = TRIM
  mesh.at(translate(-1.6, 1.05, 3.03), () => box(mesh, 1, 2.1, 0.08))
  for (const x of [-3.1, 0.6, 2.6]) mesh.at(translate(x, 1.75, 3.03), () => box(mesh, 1.1, 1.1, 0.08))
  for (const z of [-1.5, 1.5]) mesh.at(translate(4.03, 1.75, z), () => box(mesh, 0.08, 1.1, 1.1))
}

function tower(mesh: Mesh) {
  mesh.color = TRIM
  mesh.at(translate(0, 1.5, 0), () => box(mesh, 11, 3, 11))
  mesh.color = WALL
  mesh.at(translate(0, 16.5, 0), () => box(mesh, 6.5, 27, 6.5))
  // Floor lines, as wireframe only.
  for (let y = 6; y < 30; y += 3) {
    const c = 3.25
    const ring: V3[] = [[-c, y, c], [c, y, c], [c, y, -c], [-c, y, -c]]
    ring.forEach((p, i) => mesh.edge(p, ring[(i + 1) % 4]))
  }
  mesh.color = ROOF
  mesh.at(translate(0, 31, 0), () => box(mesh, 3.5, 2, 3.5))
}

function street(mesh: Mesh) {
  const heights = [
    [9, 14, 7, 18, 11, 6],
    [12, 6, 16, 9, 13, 8],
  ]
  for (const side of [0, 1]) {
    const dir = side ? 1 : -1
    heights[side].forEach((h, i) => {
      const w = 7 + ((i * 3 + side) % 3)
      mesh.color = i % 2 ? WALL : [0.78, 0.79, 0.82]
      mesh.at(translate(dir * (5 + w / 2), h / 2, -15 + i * 6), () => box(mesh, w, h, 5.8))
      if (h > 10) {
        mesh.color = ROOF
        mesh.at(translate(dir * (5 + w / 2), h + 0.6, -15 + i * 6), () => box(mesh, 2.4, 1.2, 2.4))
      }
    })
    mesh.color = TRIM
    mesh.at(translate(dir * 4, 0.08, 0), () => box(mesh, 2, 0.16, 36))
  }
}

function stillLife(mesh: Mesh) {
  mesh.color = WALL
  mesh.at(mul(translate(-0.75, 0.5, -0.1), rotY(24)), () => box(mesh, 1, 1, 1))
  mesh.at(translate(0.55, 0.45, 0.35), () => ellipsoid(mesh, 0.45, 0.45, 0.45, 24, 14))
  mesh.at(translate(0.75, 0, -0.75), () => cylinder(mesh, 0.4, 0, 1.1, 28))
  mesh.at(translate(-0.25, 0, 0.9), () => cylinder(mesh, 0.28, 0.28, 0.6, 24))
}

function buildModel(model: ModelId, pose: string): Mesh {
  const mesh = new Mesh()
  mesh.color = WALL
  switch (model) {
    case "mannequin":
      mannequin(mesh, POSE_LIBRARY[pose] ?? POSE_LIBRARY.standing)
      break
    case "cube":
      mesh.at(translate(0, 0.6, 0), () => box(mesh, 1.2, 1.2, 1.2))
      break
    case "sphere":
      mesh.at(translate(0, 0.7, 0), () => ellipsoid(mesh, 0.7, 0.7, 0.7, 32, 18))
      break
    case "cylinder":
      cylinder(mesh, 0.55, 0.55, 1.3, 32)
      break
    case "cone":
      cylinder(mesh, 0.6, 0, 1.3, 32)
      break
    case "pyramid":
      mesh.at(rotY(45), () => cylinder(mesh, 0.9, 0, 1.2, 4, true))
      break
    case "torus":
      mesh.at(translate(0, 0.28, 0), () => torus(mesh, 0.65, 0.28))
      break
    case "shapes":
      stillLife(mesh)
      break
    case "house":
      house(mesh)
      break
    case "tower":
      tower(mesh)
      break
    case "street":
      street(mesh)
      break
  }
  return mesh
}

// ---- rendering ----------------------------------------------------------------

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in vec3 aCol;
uniform mat4 uViewProj;
uniform vec2 uShift;
out vec3 vPos;
out vec3 vNor;
out vec3 vCol;
void main() {
  vPos = aPos;
  vNor = aNor;
  vCol = aCol;
  vec4 p = uViewProj * vec4(aPos, 1.0);
  p.xy += uShift * p.w;
  gl_Position = p;
}`

const FRAG = `#version 300 es
precision mediump float;
in vec3 vPos;
in vec3 vNor;
in vec3 vCol;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec4 uFlat;
out vec4 color;
void main() {
  if (uFlat.a > 0.0) {
    color = uFlat;
    return;
  }
  vec3 n = normalize(vNor);
  vec3 v = normalize(uEye - vPos);
  if (dot(n, v) < 0.0) n = -n;
  float diffuse = max(dot(n, uLight), 0.0);
  // Darken towards the silhouette so the form reads clearly when traced.
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  color = vec4(vCol * (0.42 + 0.62 * diffuse) - 0.2 * rim, 1.0);
}`

interface Scene {
  key: string
  tris: WebGLBuffer
  triCount: number
  lines: WebGLBuffer
  lineCount: number
  floor: WebGLBuffer
  floorCount: number
  center: V3
  radius: number
}

interface Renderer {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  program: WebGLProgram
  scene: Scene | null
  drawn: string
}

let renderer: Renderer | null | undefined

function createRenderer(): Renderer | null {
  const canvas = document.createElement("canvas")
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  })
  if (!gl) return null
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    return sh
  }
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
  gl.bindAttribLocation(program, 0, "aPos")
  gl.bindAttribLocation(program, 1, "aNor")
  gl.bindAttribLocation(program, 2, "aCol")
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("3D reference shader failed to link", gl.getProgramInfoLog(program))
    return null
  }
  canvas.addEventListener("webglcontextlost", () => {
    renderer = undefined
  })
  return { canvas, gl, program, scene: null, drawn: "" }
}

function buildScene(gl: WebGL2RenderingContext, model: ModelId, pose: string, key: string): Scene {
  const mesh = buildModel(model, pose)
  const lo: V3 = [Infinity, Infinity, Infinity]
  const hi: V3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.pos.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], mesh.pos[i])
    hi[i % 3] = Math.max(hi[i % 3], mesh.pos[i])
  }
  const center: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2

  // Interleave position, normal and colour.
  const n = mesh.pos.length / 3
  const data = new Float32Array(n * 9)
  for (let i = 0; i < n; i++) {
    data.set(mesh.pos.slice(i * 3, i * 3 + 3), i * 9)
    data.set(mesh.nor.slice(i * 3, i * 3 + 3), i * 9 + 3)
    data.set(mesh.col.slice(i * 3, i * 3 + 3), i * 9 + 6)
  }

  // A floor grid on y = 0, in steps suited to the model's size.
  const step = [0.25, 0.5, 1, 2, 5, 10].find((s) => s >= radius / 5) ?? 10
  const reach = Math.ceil((radius * 2.2) / step) * step
  const floor: number[] = []
  for (let t = -reach; t <= reach + 1e-6; t += step) {
    floor.push(center[0] + t, 0, center[2] - reach, center[0] + t, 0, center[2] + reach)
    floor.push(center[0] - reach, 0, center[2] + t, center[0] + reach, 0, center[2] + t)
  }

  const buffer = (values: Float32Array) => {
    const b = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW)
    return b
  }
  return {
    key,
    tris: buffer(data),
    triCount: n,
    lines: buffer(new Float32Array(mesh.lines)),
    lineCount: mesh.lines.length / 3,
    floor: buffer(new Float32Array(floor)),
    floorCount: floor.length / 3,
    center,
    radius,
  }
}

function perspective(fovY: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan((fovY * RAD) / 2)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
}

/**
 * Renders the reference at the given pixel size and returns the canvas it is
 * on, reusing the last frame when nothing has changed. Null without WebGL.
 */
export function renderReference(s: RefSettings, width: number, height: number): HTMLCanvasElement | null {
  if (renderer === undefined) renderer = createRenderer()
  if (!renderer || width < 2 || height < 2) return null
  const { canvas, gl, program } = renderer

  const drawn = [s.model, s.pose, s.style, s.floor, s.yaw, s.pitch, s.size, s.fov, s.x, s.y, width, height].join("|")
  if (drawn === renderer.drawn) return canvas
  renderer.drawn = drawn

  const sceneKey = `${s.model}|${s.pose}`
  if (renderer.scene?.key !== sceneKey) {
    const old = renderer.scene
    if (old) for (const b of [old.tris, old.lines, old.floor]) gl.deleteBuffer(b)
    renderer.scene = buildScene(gl, s.model, s.pose, sceneKey)
  }
  const scene = renderer.scene

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  // Orbit camera: the lens angle changes the perspective, not the framing.
  const fov = Math.max(5, Math.min(120, s.fov))
  const dist = scene.radius / (Math.max(0.05, s.size) * Math.tan((fov * RAD) / 2))
  const pitch = Math.max(-89, Math.min(89, s.pitch)) * RAD
  const yaw = s.yaw * RAD
  const back: V3 = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)]
  const eye: V3 = [
    scene.center[0] + back[0] * dist,
    scene.center[1] + back[1] * dist,
    scene.center[2] + back[2] * dist,
  ]
  const right = norm(cross([0, 1, 0], back))
  const up = cross(back, right)
  const view: M4 = [
    right[0], up[0], back[0], 0,
    right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
    -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
    -(back[0] * eye[0] + back[1] * eye[1] + back[2] * eye[2]),
    1,
  ]
  const near = Math.max(0.02, dist / 60)
  const viewProj = mul(perspective(fov, width / height, near, dist + scene.radius * 12), view)
  const light = norm([
    -0.45 * right[0] + 0.75 * up[0] + 0.55 * back[0],
    -0.45 * right[1] + 0.75 * up[1] + 0.55 * back[1],
    -0.45 * right[2] + 0.75 * up[2] + 0.55 * back[2],
  ])

  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.enable(gl.DEPTH_TEST)
  gl.useProgram(program)
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "uViewProj"), false, viewProj)
  gl.uniform2f(gl.getUniformLocation(program, "uShift"), s.x, s.y)
  gl.uniform3fv(gl.getUniformLocation(program, "uEye"), eye)
  gl.uniform3fv(gl.getUniformLocation(program, "uLight"), light)
  const flat = gl.getUniformLocation(program, "uFlat")

  // Solid surfaces: shaded, or depth only so a wireframe hides its far side.
  gl.bindBuffer(gl.ARRAY_BUFFER, scene.tris)
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i)
    gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12)
  }
  gl.uniform4f(flat, 0, 0, 0, 0)
  gl.enable(gl.POLYGON_OFFSET_FILL)
  gl.polygonOffset(1, 1)
  if (s.style === "wire") gl.colorMask(false, false, false, false)
  gl.drawArrays(gl.TRIANGLES, 0, scene.triCount)
  gl.colorMask(true, true, true, true)
  gl.disable(gl.POLYGON_OFFSET_FILL)

  const drawLines = (buffer: WebGLBuffer, count: number, r: number, g: number, b: number) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0)
    gl.uniform4f(flat, r, g, b, 1)
    gl.drawArrays(gl.LINES, 0, count)
  }
  gl.disableVertexAttribArray(1)
  gl.disableVertexAttribArray(2)
  if (s.style !== "shaded") drawLines(scene.lines, scene.lineCount, 0.1, 0.12, 0.16)
  if (s.floor) drawLines(scene.floor, scene.floorCount, 0.4, 0.46, 0.54)
  return canvas
}
