// Errors whose message is written for the user, as opposed to everything else (bugs, browser and
// library errors), whose text is technical: that goes to the log, and the user reads a plain fallback.

/** An error whose message can be shown as it is: plain words, saying what to do. */
export class PlainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlainError';
  }
}

/** What to show for [error]: its own message when written for the user, otherwise [fallback] (and the details go to the log). */
export function plainMessage(error: unknown, fallback: string): string {
  if (error instanceof PlainError) return error.message;
  console.warn(`Photo Cleaner: ${fallback}`, error);
  return fallback;
}
