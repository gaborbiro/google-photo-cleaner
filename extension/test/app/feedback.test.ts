import { describe, expect, it } from 'vitest';
import { feedbackView } from '../../src/app/shared/feedback';

describe('feedback', () => {
  it('writes to the store listing’s address, with the version in the subject', () => {
    expect(feedbackView('0.4.71')).toEqual({
      email: 'nomadworkz@gmail.com',
      mailto: 'mailto:nomadworkz@gmail.com?subject=Photo%20Cleaner%20feedback%20(v0.4.71)',
      issuesUrl: 'https://github.com/gaborbiro/google-photo-cleaner/issues',
    });
  });
});
