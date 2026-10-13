"""Deterministic stand-in embedder for testing the app's process client.

Vectors are the L2-normalised mean colour plus a constant, so identical images
get identical vectors and different colours differ. Never used for real data.
"""

from __future__ import annotations

import os
import time

import numpy as np
from PIL import Image


class FakeEmbedder:
    def info(self) -> dict:
        return {"model": "fake", "revision": "test", "device": "cpu", "gpu": None, "dtype": "float32", "torch": "none"}

    def embed_text(self, texts: list[str]) -> np.ndarray:
        # "red ..." points towards red images, anything else towards blue.
        rows = [np.array([255.0, 0.0, 0.0, 64.0] if t.startswith("red") else [0.0, 0.0, 255.0, 64.0], dtype=np.float32) for t in texts]
        return np.stack([r / np.linalg.norm(r) for r in rows])

    def embed(self, images: list[Image.Image], token_budget: int | None = None) -> np.ndarray:
        # Lets tests abandon a request while the worker is still busy with it.
        time.sleep(int(os.environ.get("PHOTOCLEANER_FAKE_DELAY_MS", "0")) / 1000)
        if token_budget is not None and token_budget not in (70, 140, 280, 560, 1120):
            raise ValueError("token budget must be one of (70, 140, 280, 560, 1120)")
        rows = []
        for image in images:
            r, g, b = np.asarray(image, dtype=np.float32).reshape(-1, 3).mean(axis=0)
            vector = np.array([r, g, b, 64.0], dtype=np.float32)
            rows.append(vector / np.linalg.norm(vector))
        return np.stack(rows)
