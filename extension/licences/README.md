# Licence texts the libraries don't ship themselves

`scripts/notices.mjs` writes `THIRD_PARTY_NOTICES.txt` into the extension from each bundled library's
own licence file. These are for the ones without one:

- `Apache-2.0.txt`: the Apache License 2.0, unchanged (a copy of `@huggingface/tokenizers`' LICENSE).
- `kotlin-stdlib.txt`: the Kotlin standard library, compiled into `generated/kotlin` (Apache 2.0).
- `onnxruntime.txt`: ONNX Runtime Web and onnxruntime-common, whose npm packages have no licence file
  (MIT, as the packages and their bundled files say).
