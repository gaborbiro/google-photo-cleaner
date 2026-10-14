// Gentle mode: the first analysis can take hours on a slow laptop, so by default it stays out of
// the way. While the computer is in use it goes at about half speed; on battery it waits for the
// charger. "Full speed" switches both off.

export interface Conditions {
  fullSpeed: boolean;
  /** Running on battery and not charging. */
  onBattery: boolean;
  /** Someone used the keyboard or mouse in the last minute. */
  userActive: boolean;
}

export type PaceDecision =
  | { kind: 'go' }
  /** Wait about as long as the last photo took: roughly half speed. */
  | { kind: 'slow'; extraMs: number; text: string }
  | { kind: 'wait'; text: string };

export const WAIT_CHECK_MS = 15_000;

export function decidePace(conditions: Conditions, lastPhotoMs: number): PaceDecision {
  if (conditions.fullSpeed) return { kind: 'go' };
  if (conditions.onBattery) {
    return { kind: 'wait', text: 'Waiting: the computer is on battery. Plug it in, or switch to full speed.' };
  }
  if (conditions.userActive) {
    return { kind: 'slow', extraMs: lastPhotoMs, text: 'Going gently while you use the computer. Switch to full speed to go faster.' };
  }
  return { kind: 'go' };
}
