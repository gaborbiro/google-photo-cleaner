"""Browser AI test, step 2: serves the test page and the exported photos on http://localhost:8123/web/
and saves the results the page posts (data/results-<dtype>.json). Local only.

    python spikes/browser-ai/serve.py
"""

import http.server
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
PORT = 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Cross-origin isolation lets ONNX Runtime use multi-threaded WebAssembly next to WebGPU.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        match = re.fullmatch(r"/results/([a-z0-9-]+)", self.path)
        if not match:
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        json.loads(body)  # refuse anything that is not JSON
        (DATA / f"results-{match.group(1)}.json").write_bytes(body)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    if not (DATA / "manifest.json").exists():
        raise SystemExit("No data/manifest.json yet: run the export first (see README.md)")
    print(f"Open http://localhost:{PORT}/web/ in Chrome")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
