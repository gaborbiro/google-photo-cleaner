# Photo Cleaner inference worker

Local image embeddings (EmbeddingGemma 2) and quality metrics. The desktop app starts it as a child process and talks JSON lines over stdin/stdout (`photocleaner_worker/protocol.py`). Images arrive as bytes, stay in memory, and only vectors and quality numbers go back. Hugging Face is forced offline when the app runs it.

## Setup (Windows, once)

Python 3.12 must be on PATH (`python --version`).

```powershell
cd C:\Work\PhotoCleaner\worker
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
# RTX 50-series (sm_120) needs a CUDA 12.8+ build; the driver here supports CUDA 13.x.
.\.venv\Scripts\python.exe -m pip install torch==2.14.1 torchvision --index-url https://download.pytorch.org/whl/cu130
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
# First model download (~1.5 GB, online). Later runs are offline.
.\.venv\Scripts\python.exe scripts\benchmark_synthetic.py
```

Check the GPU build: `.\.venv\Scripts\python.exe -c "import torch; print(torch.cuda.get_arch_list())"` must list `sm_120`.

## Model

- `google/embeddinggemma-2`, Apache 2.0, revision pinned in `embedder.py` (`MODEL_REVISION`) and in the app (`EmbeddingSettings.REVISION`); the app refuses a worker reporting another revision.
- bfloat16 on GPU (float16 is unsupported by the model). 768-d L2-normalised vectors, returned as float16.
- Image token budget per request: 70, 140, 280, 560 or 1120.

Measured on the RTX 5060 Laptop GPU (synthetic 512 px images): budget 70 ≈ 38 images/s, 1.7 GiB peak VRAM; budget 280 ≈ 9.5 images/s, 2.7 GiB.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

The app's Kotlin tests also start this worker with `PHOTOCLEANER_FAKE_EMBEDDER=1` (deterministic vectors, no model) to test the process protocol.

## Windows Smart App Control

Smart App Control is enabled on this machine. It blocked a freshly installed NumPy DLL once and allowed it on the next attempt. If an `ImportError: ... An Application Control policy has blocked this file` persists, the fix is a package version Windows recognises, not turning the protection off.
