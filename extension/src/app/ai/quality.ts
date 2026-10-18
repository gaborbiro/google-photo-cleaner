// Cheap, content-free image quality measurements for choosing which duplicate to keep.
// Measured on the 512 px previews (ported from the former desktop app's OpenCV worker).

export interface RgbaImage {
  /** RGBA bytes, row by row. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Quality {
  /** Variance of the Laplacian; higher is sharper. */
  sharpness: number;
  /** Mean luma, 0–255. */
  brightness: number;
  /** Share of pixels at or below DARK_LEVEL. */
  clippedDark: number;
  /** Share of pixels at or above BRIGHT_LEVEL. */
  clippedBright: number;
  width: number;
  height: number;
}

const DARK_LEVEL = 8;
const BRIGHT_LEVEL = 247;

/** Luma as PIL's convert("L") computes it (ITU-R 601, integer, rounded). */
function grayscale({ data, width, height }: RgbaImage): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p]! * 19595 + data[p + 1]! * 38470 + data[p + 2]! * 7471 + 0x8000) >> 16;
  }
  return gray;
}

/**
 * The previews are at most 512 px, so unlike the worker no down-scaling is needed. The Laplacian
 * is OpenCV's default (3×3, 4-neighbour) with its default border (reflect-101).
 */
export function measureQuality(image: RgbaImage): Quality {
  const { width, height } = image;
  if (width < 1 || height < 1) throw new Error('Empty image');
  const gray = grayscale(image);
  const at = (x: number, y: number) => {
    // reflect-101: -1 -> 1, w -> w-2 (a 1-pixel-wide image reflects to itself)
    const rx = x < 0 ? Math.min(1, width - 1) : x >= width ? Math.max(0, width - 2) : x;
    const ry = y < 0 ? Math.min(1, height - 1) : y >= height ? Math.max(0, height - 2) : y;
    return gray[ry * width + rx]!;
  };
  let sum = 0;
  let sumSq = 0;
  let lumaSum = 0;
  let dark = 0;
  let bright = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x]!;
      const lap = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * v;
      sum += lap;
      sumSq += lap * lap;
      lumaSum += v;
      if (v <= DARK_LEVEL) dark++;
      if (v >= BRIGHT_LEVEL) bright++;
    }
  }
  const total = width * height;
  const mean = sum / total;
  return {
    sharpness: sumSq / total - mean * mean,
    brightness: lumaSum / total,
    clippedDark: dark / total,
    clippedBright: bright / total,
    width,
    height,
  };
}
