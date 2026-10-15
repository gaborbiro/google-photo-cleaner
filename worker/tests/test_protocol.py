import base64
import io
import json

import numpy as np
import pytest
from PIL import Image, ImageFilter

from photocleaner_worker.protocol import serve
from photocleaner_worker.quality import measure


class FakeEmbedder:
    """Deterministic 4-d vectors from mean colour; records the budgets it saw."""

    def __init__(self) -> None:
        self.budgets: list[int | None] = []
        self.texts: list[str] = []

    def info(self) -> dict:
        return {"model": "fake"}

    def embed(self, images, token_budget=None):
        self.budgets.append(token_budget)
        if token_budget is not None and token_budget not in (70, 280):
            raise ValueError("token budget must be one of (70, 280)")
        rows = []
        for image in images:
            r, g, b = np.asarray(image, dtype=np.float32).reshape(-1, 3).mean(axis=0)
            vector = np.array([r, g, b, 1.0], dtype=np.float32)
            rows.append(vector / np.linalg.norm(vector))
        return np.stack(rows)


    def embed_text(self, texts):
        self.texts.extend(texts)
        return np.stack([np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32) for _ in texts])


def test_embed_text_returns_one_vector_per_text_and_validates():
    embedder = FakeEmbedder()
    responses = run(
        {"id": 1, "op": "embedText", "params": {"texts": ["meal prep boxes", "  documents  "]}},
        {"id": 2, "op": "embedText", "params": {"texts": []}},
        {"id": 3, "op": "embedText", "params": {"texts": ["   "]}},
        embedder=embedder,
    )
    vectors = [np.frombuffer(base64.b64decode(v), dtype="<f2") for v in responses[0]["data"]["vectors"]]
    assert len(vectors) == 2 and vectors[0].shape == (4,)
    assert [r["ok"] for r in responses] == [True, False, False]
    assert [r["error"]["kind"] for r in responses[1:]] == ["BAD_REQUEST", "BAD_REQUEST"]
    assert embedder.texts == ["meal prep boxes", "documents"]


@pytest.mark.parametrize("shape", [(1, 4), (3, 4), (2,), (2, 0)])
def test_embed_text_refuses_a_model_returning_the_wrong_number_of_vectors(shape):
    class ShortResult(FakeEmbedder):
        def embed_text(self, texts):
            return np.zeros(shape, dtype=np.float32)

    responses = run(
        {"id": 1, "op": "embedText", "params": {"texts": ["boxes", "documents"]}},
        {"id": 2, "op": "info"},
        embedder=ShortResult(),
    )
    assert responses[0]["ok"] is False
    assert responses[0]["error"]["kind"] == "INTERNAL"
    assert responses[1]["ok"] is True


def test_malformed_json_does_not_stop_the_next_request():
    stdout = io.StringIO()
    serve(FakeEmbedder, stdin=io.StringIO('{broken\n{"id":2,"op":"info"}\n'), stdout=stdout)
    failed, recovered = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert failed["id"] is None
    assert failed["error"]["kind"] == "BAD_REQUEST"
    assert recovered == {"id": 2, "ok": True, "data": {"model": "fake"}}


def png_base64(colour=(200, 50, 50), size=(32, 24)) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def run(*requests, embedder=None):
    embedder = embedder or FakeEmbedder()
    stdin = io.StringIO("".join(json.dumps(r) + "\n" for r in requests))
    stdout = io.StringIO()
    serve(lambda: embedder, stdin=stdin, stdout=stdout)
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


def test_info_and_shutdown():
    responses = run({"id": 1, "op": "info"}, {"id": 2, "op": "shutdown"}, {"id": 3, "op": "info"})
    assert responses == [
        {"id": 1, "ok": True, "data": {"model": "fake"}},
        {"id": 2, "ok": True, "data": {}},
    ]


def test_embed_returns_float16_vectors_quality_and_failures():
    responses = run({"id": 7, "op": "embed", "params": {"tokenBudget": 70, "images": [
        {"key": "a", "base64": png_base64()},
        {"key": "broken", "base64": base64.b64encode(b"not an image").decode()},
    ]}})
    data = responses[0]["data"]
    assert responses[0]["ok"] is True
    assert [item["key"] for item in data["items"]] == ["a"]
    vector = np.frombuffer(base64.b64decode(data["items"][0]["embedding"]), dtype="<f2")
    assert vector.shape == (4,)
    assert abs(float(np.linalg.norm(vector.astype(np.float32))) - 1.0) < 1e-2
    assert data["items"][0]["quality"]["width"] == 32
    assert data["failed"] == [{"key": "broken", "reason": "undecodable image (UnidentifiedImageError)"}]
    assert data["dimensions"] == 4


def test_token_budget_is_passed_through_and_validated():
    embedder = FakeEmbedder()
    responses = run(
        {"id": 1, "op": "embed", "params": {"tokenBudget": 280, "images": [{"key": "a", "base64": png_base64()}]}},
        {"id": 2, "op": "embed", "params": {"tokenBudget": 99, "images": [{"key": "a", "base64": png_base64()}]}},
        embedder=embedder,
    )
    assert responses[0]["ok"] is True
    assert responses[1]["error"]["kind"] == "BAD_REQUEST"
    assert embedder.budgets == [280, 99]


def test_bad_requests_are_reported_not_fatal():
    responses = run(
        "not json",
        {"id": 2, "op": "embed", "params": {"images": []}},
        {"id": 3, "op": "explode"},
        {"id": 4, "op": "info"},
    )
    assert [r["ok"] for r in responses] == [False, False, False, True]
    assert all(r["error"]["kind"] == "BAD_REQUEST" for r in responses[:3])


def test_internal_errors_are_reported():
    class Broken(FakeEmbedder):
        def embed(self, images, token_budget=None):
            raise RuntimeError("CUDA out of memory")

    responses = run({"id": 1, "op": "embed", "params": {"images": [{"key": "a", "base64": png_base64()}]}}, embedder=Broken())
    assert responses[0]["error"] == {"kind": "INTERNAL", "message": "RuntimeError: CUDA out of memory"}


def test_sharpness_drops_with_blur():
    rng = np.random.default_rng(0)
    sharp = Image.fromarray(rng.integers(0, 255, (256, 256, 3), dtype=np.uint8))
    blurred = sharp.filter(ImageFilter.GaussianBlur(3))
    assert measure(blurred).sharpness < measure(sharp).sharpness / 10


def test_clipping_is_measured():
    quality = measure(Image.new("RGB", (100, 100), (0, 0, 0)))
    assert quality.clipped_dark == 1.0
    assert quality.clipped_bright == 0.0
