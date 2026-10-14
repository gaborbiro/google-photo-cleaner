# Browser AI test (spike)

Can EmbeddingGemma 2 run in the browser, on the graphics card (WebGPU), as fast and as accurately
as the desktop app? Compares on the photos of the labelled calibration pairs. Nothing here is used
by the app. `data/` holds personal photos and is git-ignored.

1. Close the desktop app (the export uses its connection to the extension), keep a signed-in
   photos.google.com tab open in Chrome, then from `C:\Work\PhotoCleaner-browser-ai`:

   ```powershell
   .\gradlew.bat :spikes:browser-ai-export:exportCalibrationPhotos
   ```

   Writes `data/manifest.json` and the photos (`p001.jpg`…): labels, desktop scores and vectors,
   no Google keys.

2. Start the local page server:

   ```powershell
   python spikes/browser-ai/serve.py
   ```

3. Open http://localhost:8123/web/ in Chrome. Click **Run 4-bit**, then **Run fp16**. The first run
   of each downloads the model (cached afterwards). Results appear on the page and are saved as
   `data/results-q4.json` / `data/results-fp16.json`.

## Search test

Does Search ("More like selected" and text) still work at lower detail? The approved Search sweeps
are the answer key.

1. With the desktop app closed: `.\gradlew.bat :spikes:browser-ai-export:exportSearchPhotos`
   (the sweeps' photos plus 1,000 random others → `data/search/`).
2. With the page server running, open http://localhost:8123/web/search.html and click **Run**.
   Results: `data/results-search-<query>.json`.

## Extension test

The same model inside extension pages: its own tab, a panel inside photos.google.com, and a hidden
background page (offscreen document). Extensions can't load code from the internet, so the AI
libraries are packed into `extension/lib/`:

1. In `spikes/browser-ai/extension`: `npm install --ignore-scripts`, then `npm run lib`.
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `spikes/browser-ai/extension`.
   It's separate from the real Photo Cleaner extension.
3. With the page server running, use the test extension's toolbar popup. Results:
   `data/results-ext-<placement>.json`.

Model: [onnx-community/embeddinggemma-2-ONNX](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX),
Apache 2.0, no sign-in. Image path = text model + vision encoder; the audio encoder is skipped.
