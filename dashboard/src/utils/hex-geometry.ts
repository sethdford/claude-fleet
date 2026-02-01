/**
 * Hex Geometry Utilities
 * Axial coordinate hex math ported from VibeCraft's HexGrid.ts for 2D SVG rendering.
 * Uses pointy-top orientation with axial (q, r) coordinate system.
 */

export interface HexCoord {
  q: number;
  r: number;
}

/** Six neighbor direction vectors (counterclockwise from east). */
const HEX_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },   // east
  { q: 1, r: -1 },  // northeast
  { q: 0, r: -1 },  // northwest
  { q: -1, r: 0 },  // west
  { q: -1, r: 1 },  // southwest
  { q: 0, r: 1 },   // southeast
];

/** Convert axial hex coordinates to 2D cartesian (screen) coordinates. */
export function axialToCartesian(
  hex: HexCoord,
  radius: number,
  spacing: number,
): { x: number; y: number } {
  const hexWidth = Math.sqrt(3) * radius * spacing;
  const hexHeight = 2 * radius * spacing;
  return {
    x: hexWidth * (hex.q + hex.r / 2),
    y: hexHeight * (3 / 4) * hex.r,
  };
}

/** Convert 2D cartesian coordinates to fractional axial coordinates. */
export function cartesianToAxial(
  x: number,
  y: number,
  radius: number,
  spacing: number,
): { q: number; r: number } {
  const hexWidth = Math.sqrt(3) * radius * spacing;
  const hexHeight = 2 * radius * spacing;
  const r = y / (hexHeight * 0.75);
  const q = x / hexWidth - r / 2;
  return { q, r };
}

/** Round fractional axial coordinates to the nearest hex center using cube rounding. */
export function roundToHex(q: number, r: number): HexCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}

/** Manhattan distance between two hex coordinates. */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** Get the six neighboring hex coordinates. */
export function getNeighbors(hex: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map(d => ({ q: hex.q + d.q, r: hex.r + d.r }));
}

/** Generate SVG polygon points string for a pointy-top hexagon centered at (cx, cy). */
export function hexToPolygonPoints(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);
    points.push(`${px},${py}`);
  }
  return points.join(' ');
}

/** Hex key for map lookups. */
function hexKey(hex: HexCoord): string {
  return `${hex.q},${hex.r}`;
}

/**
 * Tracks hex occupancy and provides spiral placement for auto-layout.
 * Mirrors VibeCraft's occupancy tracking and spiral algorithm.
 */
export class HexOccupancy {
  private occupied = new Map<string, string>();
  private reverseMap = new Map<string, string>();
  private spiralIndex = 0;

  /** Mark a hex as occupied by the given id. */
  occupy(hex: HexCoord, id: string): void {
    const key = hexKey(hex);
    this.occupied.set(key, id);
    this.reverseMap.set(id, key);
  }

  /** Release the hex occupied by the given id. */
  release(id: string): void {
    const key = this.reverseMap.get(id);
    if (key) {
      this.occupied.delete(key);
      this.reverseMap.delete(id);
    }
  }

  /** Check if a hex is occupied. */
  isOccupied(hex: HexCoord): boolean {
    return this.occupied.has(hexKey(hex));
  }

  /** Get the hex position for a given id, or undefined if not placed. */
  getPosition(id: string): HexCoord | undefined {
    const key = this.reverseMap.get(id);
    if (!key) return undefined;
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }

  /** Convert a linear spiral index to a hex coordinate. */
  private indexToHexCoord(index: number): HexCoord {
    if (index === 0) return { q: 0, r: 0 };

    let ring = 1;
    let remaining = index - 1;

    while (remaining >= 6 * ring) {
      remaining -= 6 * ring;
      ring++;
    }

    // Start at the ring's first hex and walk around the ring perimeter
    let hex: HexCoord = { q: ring, r: 0 };
    let walkIndex = 0;
    for (let side = 0; side < 6; side++) {
      for (let j = 0; j < ring; j++) {
        if (walkIndex === remaining) return hex;
        hex = {
          q: hex.q + HEX_DIRECTIONS[(side + 2) % 6].q,
          r: hex.r + HEX_DIRECTIONS[(side + 2) % 6].r,
        };
        walkIndex++;
      }
    }

    return hex;
  }

  /** Get the next unoccupied hex in the outward spiral sequence. */
  getNextInSpiral(): HexCoord {
    let coord = this.indexToHexCoord(this.spiralIndex);
    while (this.isOccupied(coord)) {
      this.spiralIndex++;
      coord = this.indexToHexCoord(this.spiralIndex);
    }
    this.spiralIndex++;
    return coord;
  }

  /** Reset the spiral counter. */
  resetSpiral(): void {
    this.spiralIndex = 0;
  }

  /** Clear all occupancy data. */
  clear(): void {
    this.occupied.clear();
    this.reverseMap.clear();
    this.spiralIndex = 0;
  }
}
