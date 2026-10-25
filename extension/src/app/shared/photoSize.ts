// How large a workbench (Duplicates, Search) shows its photos: a few steps, chosen with − and + (keys
// or buttons) and remembered in this browser. A larger photo fetches a sharper preview.

export interface SizeStep {
  /** The tile's width and height on screen. */
  tilePx: number;
  /** The preview fetched for it: sharper than the tile, for high-density screens. */
  previewPx: number;
}

/** Where the chosen step is remembered; nothing when it was never chosen (or can't be read). */
export interface SizeMemory {
  load(): number | null;
  save(step: number): void;
}

export class PhotoSize {
  private step: number;

  constructor(private readonly steps: readonly SizeStep[], defaultStep: number, private readonly memory: SizeMemory) {
    if (defaultStep < 0 || defaultStep >= steps.length) throw new Error(`No size step ${defaultStep}`);
    const saved = memory.load();
    this.step = saved !== null && Number.isInteger(saved) && saved >= 0 && saved < steps.length ? saved : defaultStep;
  }

  get current(): SizeStep {
    return this.steps[this.step]!;
  }

  get canGrow(): boolean {
    return this.step < this.steps.length - 1;
  }

  get canShrink(): boolean {
    return this.step > 0;
  }

  /** One step larger (+1) or smaller (−1); false at the end, where nothing changes. */
  change(delta: 1 | -1): boolean {
    const next = this.step + delta;
    if (next < 0 || next >= this.steps.length) return false;
    this.step = next;
    this.memory.save(next);
    return true;
  }
}

/** The step remembered in this browser under [key] (erased with Photo Cleaner's data). */
export function browserSizeMemory(key: string): SizeMemory {
  return {
    load() {
      try {
        const saved = localStorage.getItem(key);
        return saved === null ? null : Number(saved);
      } catch (error) {
        console.warn('Photo Cleaner: could not read the photo size chosen last', error);
        return null;
      }
    },
    save(step) {
      try {
        localStorage.setItem(key, String(step));
      } catch (error) {
        // Only a convenience: the size simply isn't remembered.
        console.warn('Photo Cleaner: could not remember the photo size', error);
      }
    },
  };
}

/** Remembers nothing beyond this object's life (tests, and pages without storage). */
export function memorySizeMemory(): SizeMemory {
  let step: number | null = null;
  return { load: () => step, save: (s) => void (step = s) };
}
