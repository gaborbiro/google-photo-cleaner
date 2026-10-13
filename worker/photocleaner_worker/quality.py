"""Cheap, content-free image quality measurements for keeper recommendation.

All measurements are taken on a copy scaled to a fixed longest side, so values
are comparable across photos regardless of the preview size that was fetched.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import cv2
import numpy as np
from PIL import Image

MEASURE_SIDE = 512
DARK_LEVEL = 8
BRIGHT_LEVEL = 247


@dataclass(frozen=True)
class Quality:
    sharpness: float
    """Variance of the Laplacian; higher is sharper."""
    brightness: float
    """Mean luma, 0-255."""
    clipped_dark: float
    """Fraction of pixels at or below DARK_LEVEL."""
    clipped_bright: float
    """Fraction of pixels at or above BRIGHT_LEVEL."""
    width: int
    height: int

    def to_json(self) -> dict:
        return asdict(self)


def measure(image: Image.Image) -> Quality:
    width, height = image.size
    gray = np.asarray(image.convert("L"))
    scale = MEASURE_SIDE / max(width, height)
    if scale < 1.0:
        gray = cv2.resize(gray, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    total = gray.size
    return Quality(
        sharpness=float(laplacian.var()),
        brightness=float(gray.mean()),
        clipped_dark=float(np.count_nonzero(gray <= DARK_LEVEL) / total),
        clipped_bright=float(np.count_nonzero(gray >= BRIGHT_LEVEL) / total),
        width=width,
        height=height,
    )
