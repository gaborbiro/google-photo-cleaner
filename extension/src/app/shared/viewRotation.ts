// Turning a photo in the viewer, for looking at it only: nothing is saved, and Google Photos is not
// changed. Each photo keeps its turn while the review tab is open.

/** Said while a photo is shown turned, so no one takes it for a change to the photo. */
export const ROTATED_TEXT = 'Turned for viewing only; the photo in Google Photos is unchanged.';

export class ViewRotations {
  /** Quarter turns clockwise (1–3) of each photo turned. */
  private readonly turns = new Map<string, number>();

  /** A quarter turn clockwise (1) or anticlockwise (−1). */
  turn(mediaKey: string, delta: 1 | -1): void {
    const next = ((this.turns.get(mediaKey) ?? 0) + delta + 4) % 4;
    if (next === 0) this.turns.delete(mediaKey);
    else this.turns.set(mediaKey, next);
  }

  /** How [mediaKey] is shown: its angle clockwise, whether it lies on its side, and what to say about it. */
  of(mediaKey: string): { rotationDeg: number; sideways: boolean; rotationText: string | null } {
    const turns = this.turns.get(mediaKey) ?? 0;
    return { rotationDeg: turns * 90, sideways: turns % 2 === 1, rotationText: turns === 0 ? null : ROTATED_TEXT };
  }
}
