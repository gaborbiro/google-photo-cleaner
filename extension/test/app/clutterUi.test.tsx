// @vitest-environment jsdom
//
// The developer page's photo opened large: drawn again with new copies of its tiles (as the page does
// whenever it redraws), it keeps the photo it has instead of loading it again.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Zoom, type Tile } from '../../src/app/dev/clutterUi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tile = (mediaKey: string): Tile => ({ mediaKey, thumbUrl: `https://thumb/${mediaKey}`, caption: [{ text: mediaKey, kind: null }], breakdowns: () => [] });

describe('a photo opened large on the developer page', () => {
  let container: HTMLDivElement;
  afterEach(() => container.remove());

  it('loads its photo once while the page redraws, and again only for another photo', async () => {
    container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    const preview = vi.fn(async (url: string) => `blob:${url}`);
    const draw = (index: number) => root.render(<Zoom tiles={[tile('a'), tile('b')]} index={index} preview={preview} onMove={() => {}} onClose={() => {}} />);
    await act(async () => draw(0));
    // Redrawn three times with new tiles of the same photos: no reload, the photo stays shown.
    for (let i = 0; i < 3; i++) await act(async () => draw(0));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.viewer-photo img')?.getAttribute('src')).toBe('blob:https://thumb/a');
    await act(async () => draw(1));
    expect(preview.mock.calls.map(([url]) => url)).toEqual(['https://thumb/a', 'https://thumb/b']);
    await act(async () => root.unmount());
  });
});
