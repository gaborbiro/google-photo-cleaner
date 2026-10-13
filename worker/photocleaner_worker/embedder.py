"""EmbeddingGemma 2 image embedder.

Model card: https://huggingface.co/google/embeddinggemma-2 (Apache 2.0).
- bfloat16 on GPUs that support it, else float32; float16 is unsupported by the model.
- Images are passed without a task prefix; the image token budget is one of
  70, 140, 280, 560 or 1120 soft tokens (higher = slower, more detail).
"""

from __future__ import annotations

import sys
import time

import numpy as np
import torch
from PIL import Image
from sentence_transformers import SentenceTransformer

MODEL_ID = "google/embeddinggemma-2"
# Pinned so stored embeddings stay comparable; bump deliberately and re-embed.
MODEL_REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"
TOKEN_BUDGETS = (70, 140, 280, 560, 1120)


class GemmaImageEmbedder:
    def __init__(self, token_budget: int = 280, batch_size: int = 16, model_revision: str = MODEL_REVISION) -> None:
        if token_budget not in TOKEN_BUDGETS:
            raise ValueError(f"token budget must be one of {TOKEN_BUDGETS}")
        if not torch.cuda.is_available():
            print("CUDA is not available; running on CPU (slow)", file=sys.stderr)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.bfloat16 if self.device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
        self.token_budget = token_budget
        self.batch_size = batch_size
        started = time.perf_counter()
        self.model = SentenceTransformer(
            MODEL_ID,
            device=self.device,
            revision=model_revision,
            model_kwargs={"torch_dtype": self.dtype},
        )
        self.load_seconds = time.perf_counter() - started
        self.revision = model_revision

    def info(self) -> dict:
        return {
            "model": MODEL_ID,
            "revision": self.revision,
            "device": self.device,
            "gpu": torch.cuda.get_device_name(0) if self.device == "cuda" else None,
            "dtype": str(self.dtype).removeprefix("torch."),
            "tokenBudget": self.token_budget,
            "torch": torch.__version__,
            "loadSeconds": round(self.load_seconds, 2),
        }

    @torch.inference_mode()
    def embed_text(self, texts: list[str]) -> np.ndarray:
        """Search queries in the same space as the images (model prompt "SearchQuery")."""
        vectors = self.model.encode(
            texts,
            prompt_name="SearchQuery",
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=np.float32)

    @torch.inference_mode()
    def embed(self, images: list[Image.Image], token_budget: int | None = None) -> np.ndarray:
        budget = token_budget or self.token_budget
        if budget not in TOKEN_BUDGETS:
            raise ValueError(f"token budget must be one of {TOKEN_BUDGETS}")
        vectors = self.model.encode(
            [{"image": image} for image in images],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
            processing_kwargs={"image": {"max_soft_tokens": budget}},
        )
        return np.asarray(vectors, dtype=np.float32)
