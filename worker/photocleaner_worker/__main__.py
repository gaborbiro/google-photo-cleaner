"""Entry point: `python -m photocleaner_worker [--token-budget N] [--batch-size N]`."""

from __future__ import annotations

import argparse
import os
import sys

from .protocol import serve


def main() -> None:
    parser = argparse.ArgumentParser(description="Photo Cleaner inference worker (JSON lines on stdin/stdout)")
    parser.add_argument("--token-budget", type=int, default=280)
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args()

    def factory():
        if os.environ.get("PHOTOCLEANER_FAKE_EMBEDDER") == "1":
            # Test only: lets the app's process client be tested without a GPU or model.
            from .fake import FakeEmbedder

            return FakeEmbedder()
        # Imported lazily so protocol errors can be reported before the model loads.
        from .embedder import GemmaImageEmbedder

        return GemmaImageEmbedder(token_budget=args.token_budget, batch_size=args.batch_size)

    # stdout carries the protocol only: anything a library prints goes to stderr instead.
    protocol_out = sys.stdout
    sys.stdout = sys.stderr
    serve(factory, stdout=protocol_out)


if __name__ == "__main__":
    main()
