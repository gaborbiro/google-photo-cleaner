import { describe, expect, it, vi } from 'vitest';
import type { StoredEmbedding } from '../../src/app/ai/analysisStore';
import { EmbeddingStats } from '../../src/app/review/embeddingStats';

const EMBEDDING: StoredEmbedding = {
  account: 'account-a',
  modelKey: 'model/t140',
  mediaKey: 'photo-a',
  vector: new Float32Array([0.25, -0.5, 0.75]),
  quality: { sharpness: 12.5, brightness: 120, clippedDark: 0.01, clippedBright: 0.02, width: 512, height: 384 },
  createdAtMs: Date.parse('2026-11-02T12:00:37.000Z'),
};

describe('Stats for nerds', () => {
  it('does nothing without a right-clicked photo, then shows every stored vector component', async () => {
    const load = vi.fn(async () => EMBEDDING);
    const stats = new EmbeddingStats({ load });
    stats.openTarget();
    expect(load).not.toHaveBeenCalled();

    stats.pointAt('photo-a');
    stats.openTarget();
    expect(stats.getView()).toMatchObject({ open: true, loading: true });
    await vi.waitFor(() => expect(stats.getView().loading).toBe(false));
    expect(load).toHaveBeenCalledExactlyOnceWith('photo-a');
    expect(stats.getView()).toMatchObject({
      modelKey: 'model/t140', dimensions: 3, analysedAt: '2026-11-02T12:00:37.000Z',
      previewSize: '512 × 384 px', vectorText: '[\n  0.25,\n  -0.5,\n  0.75\n]',
    });
  });

  it('says when no embedding is stored and closing cancels a read still in flight', async () => {
    let finish: (value: StoredEmbedding | null) => void = () => {};
    const load = vi.fn(() => new Promise<StoredEmbedding | null>((resolve) => { finish = resolve; }));
    const stats = new EmbeddingStats({ load });
    stats.pointAt('missing');
    stats.openTarget();
    finish(null);
    await vi.waitFor(() => expect(stats.getView().problem).toBe('No embedding is stored for this photo.'));

    stats.pointAt('photo-a');
    stats.openTarget();
    stats.close();
    finish(EMBEDDING);
    await Promise.resolve();
    expect(stats.getView().open).toBe(false);
  });
});
