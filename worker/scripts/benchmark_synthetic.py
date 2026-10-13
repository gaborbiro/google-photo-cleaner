"""Sanity and speed check on synthetic images (no user photos).

Usage: .venv\\Scripts\\python.exe scripts\\benchmark_synthetic.py
"""

from __future__ import annotations

import io
import time

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from photocleaner_worker.embedder import GemmaImageEmbedder


def scene(seed: int, size: int = 512) -> Image.Image:
    rng = np.random.default_rng(seed)
    image = Image.new("RGB", (size, size), tuple(int(c) for c in rng.integers(0, 255, 3)))
    draw = ImageDraw.Draw(image)
    for _ in range(12):
        x0, y0 = rng.integers(0, size - 60, 2)
        x1, y1 = x0 + rng.integers(30, 200), y0 + rng.integers(30, 200)
        colour = tuple(int(c) for c in rng.integers(0, 255, 3))
        if rng.random() < 0.5:
            draw.ellipse((int(x0), int(y0), int(x1), int(y1)), fill=colour)
        else:
            draw.rectangle((int(x0), int(y0), int(x1), int(y1)), fill=colour)
    return image


def jpeg(image: Image.Image, quality: int) -> Image.Image:
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=quality)
    return Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")


def main() -> None:
    base = scene(1)
    variants = {
        "recompressed": jpeg(base, 40),
        "resized": base.resize((300, 300)).resize((512, 512)),
        "cropped 90%": base.crop((25, 25, 487, 487)).resize((512, 512)),
        "brighter": ImageEnhance.Brightness(base).enhance(1.3),
        "blurred": base.filter(ImageFilter.GaussianBlur(4)),
        "different scene": scene(2),
        "another scene": scene(3),
    }

    for budget in (70, 280):
        torch.cuda.reset_peak_memory_stats()
        embedder = GemmaImageEmbedder(token_budget=budget, batch_size=16)
        print(embedder.info())
        vectors = embedder.embed([base, *variants.values()])
        for name, vector in zip(variants, vectors[1:]):
            print(f"  budget {budget:4d}  {name:16s} cosine {float(vectors[0] @ vector):.4f}")

        batch = [scene(100 + i) for i in range(64)]
        embedder.embed(batch[:16])  # warm-up
        torch.cuda.synchronize()
        started = time.perf_counter()
        embedder.embed(batch)
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        print(f"  budget {budget:4d}  throughput {len(batch) / elapsed:.1f} images/s, peak VRAM {torch.cuda.max_memory_allocated() / 2**30:.2f} GiB")
        del embedder
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
