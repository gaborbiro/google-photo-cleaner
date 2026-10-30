// Where people write with questions, ideas and problems: the same addresses as the Chrome Web Store
// listing (docs/chrome-web-store.md).

export const FEEDBACK_EMAIL = 'nomadworkz@gmail.com';
export const ISSUES_URL = 'https://github.com/gaborbiro/google-photo-cleaner/issues';

export interface FeedbackView {
  email: string;
  /** Opens the user's email app with the subject filled in, naming the version so a reply can tell what ran. */
  mailto: string;
  issuesUrl: string;
}

export function feedbackView(version: string): FeedbackView {
  const subject = `Photo Cleaner feedback (v${version})`;
  return { email: FEEDBACK_EMAIL, mailto: `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}`, issuesUrl: ISSUES_URL };
}
