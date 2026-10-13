"""JSON-lines protocol between the Photo Cleaner app and this worker.

One request per stdin line, one response per stdout line, matched by `id`.
Nothing but protocol responses is ever written to stdout; diagnostics go to
stderr. Requests and responses never contain photo keys beyond the opaque
`key` the app chose, and image bytes are only ever held in memory.

Requests:
  {"id": 1, "op": "info"}
  {"id": 2, "op": "embed", "params": {"tokenBudget": 280, "images": [{"key": "...", "base64": "..."}]}}
  {"id": 3, "op": "embedText", "params": {"texts": ["meal prep boxes"]}}
  {"id": 4, "op": "shutdown"}

Responses:
  {"id": 1, "ok": true, "data": {...}}
  {"id": 1, "ok": false, "error": {"kind": "BAD_REQUEST" | "INTERNAL", "message": "..."}}
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import sys
import traceback
from typing import Callable, Protocol, TextIO

import numpy as np
from PIL import Image, UnidentifiedImageError

from .quality import measure

MAX_IMAGES_PER_REQUEST = 64


class Embedder(Protocol):
    def info(self) -> dict: ...

    def embed(self, images: list[Image.Image], token_budget: int | None = None) -> np.ndarray:
        """Returns L2-normalised float32 vectors, one row per image."""
        ...

    def embed_text(self, texts: list[str]) -> np.ndarray:
        """Returns L2-normalised float32 search-query vectors, one row per text."""
        ...


class BadRequest(Exception):
    pass


def _decode_image(entry: object) -> tuple[str, Image.Image]:
    if not isinstance(entry, dict):
        raise BadRequest("image entry must be an object")
    key = entry.get("key")
    data = entry.get("base64")
    if not isinstance(key, str) or not key or not isinstance(data, str):
        raise BadRequest("image entry needs a non-empty key and base64 data")
    try:
        raw = base64.b64decode(data, validate=True)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (binascii.Error, UnidentifiedImageError, OSError) as error:
        raise ValueError(f"undecodable image ({type(error).__name__})") from error
    return key, image.convert("RGB")


def _embed(embedder: Embedder, params: dict) -> dict:
    entries = params.get("images")
    if not isinstance(entries, list) or not entries:
        raise BadRequest("images must be a non-empty list")
    token_budget = params.get("tokenBudget")
    if token_budget is not None and not isinstance(token_budget, int):
        raise BadRequest("tokenBudget must be an integer")
    if len(entries) > MAX_IMAGES_PER_REQUEST:
        raise BadRequest(f"at most {MAX_IMAGES_PER_REQUEST} images per request")

    decoded: list[tuple[str, Image.Image]] = []
    failed: list[dict] = []
    for entry in entries:
        try:
            decoded.append(_decode_image(entry))
        except ValueError as error:
            key = entry.get("key") if isinstance(entry, dict) else None
            failed.append({"key": key, "reason": str(error)})

    items: list[dict] = []
    if decoded:
        try:
            vectors = embedder.embed([image for _, image in decoded], token_budget)
        except ValueError as error:
            raise BadRequest(str(error)) from error
        if vectors.shape[0] != len(decoded):
            raise RuntimeError("embedder returned a different number of vectors")
        for (key, image), vector in zip(decoded, vectors):
            items.append({
                "key": key,
                # float16 halves the size; similarity is computed in float32 by the app.
                "embedding": base64.b64encode(vector.astype("<f2").tobytes()).decode("ascii"),
                "quality": measure(image).to_json(),
            })
    return {"items": items, "failed": failed, "dimensions": int(vectors.shape[1]) if decoded else None}


MAX_TEXTS_PER_REQUEST = 16
MAX_TEXT_LENGTH = 500


def _embed_text(embedder: Embedder, params: dict) -> dict:
    texts = params.get("texts")
    if not isinstance(texts, list) or not texts or len(texts) > MAX_TEXTS_PER_REQUEST:
        raise BadRequest(f"texts must be a list of 1..{MAX_TEXTS_PER_REQUEST} strings")
    if not all(isinstance(t, str) and 0 < len(t.strip()) <= MAX_TEXT_LENGTH for t in texts):
        raise BadRequest(f"each text must be 1..{MAX_TEXT_LENGTH} characters")
    vectors = embedder.embed_text([t.strip() for t in texts])
    return {"vectors": [base64.b64encode(v.astype("<f2").tobytes()).decode("ascii") for v in vectors]}


def serve(embedder_factory: Callable[[], Embedder], stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout) -> None:
    embedder: Embedder | None = None

    def respond(payload: dict) -> None:
        stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
        stdout.flush()

    for line in stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise BadRequest("request must be an object")
            request_id = request.get("id")
            op = request.get("op")
            params = request.get("params") or {}
            if not isinstance(params, dict):
                raise BadRequest("params must be an object")
            if op == "shutdown":
                respond({"id": request_id, "ok": True, "data": {}})
                return
            if embedder is None:
                embedder = embedder_factory()
            if op == "info":
                data = embedder.info()
            elif op == "embed":
                data = _embed(embedder, params)
            elif op == "embedText":
                data = _embed_text(embedder, params)
            else:
                raise BadRequest(f"unknown op {op!r}")
            respond({"id": request_id, "ok": True, "data": data})
        except (BadRequest, json.JSONDecodeError) as error:
            respond({"id": request_id, "ok": False, "error": {"kind": "BAD_REQUEST", "message": str(error)}})
        except Exception as error:  # reported to the app, which decides whether to retry
            traceback.print_exc(file=sys.stderr)
            respond({"id": request_id, "ok": False, "error": {"kind": "INTERNAL", "message": f"{type(error).__name__}: {error}"}})
