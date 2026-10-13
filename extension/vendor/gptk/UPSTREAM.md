# Vendored: Google Photos Toolkit (GPTK)

- Repository: https://github.com/xob0t/Google-Photos-Toolkit
- Revision: `6db9ab355e4797327e4078cf87a2b6994d36cf73` (tag `v3.3.0`, 2026-08-20)
- Licence: MIT, see `LICENSE` in this folder (Copyright (c) 2024 xob0t)

## Files copied verbatim

| File | SHA-256 |
|---|---|
| `src/api/parser.ts` | `E47BAFE4AAD499542461CF41D52049862661BE8831570A8AF8FB2243C9F8246C` |
| `src/types/index.ts` | `AEB476F2F7570B0C58137068B739D618838BB8797414DD0DA7F5D23C6A652043` |

Do not edit these files. Project-specific behaviour lives in `extension/src/`.

## Deliberately not vendored

- `src/api/api.ts`: contains every mutating RPC (trash, restore, album edits, favourite/archive toggles, locked folder moves, metadata edits). The read-only request shapes this project needs are re-implemented in `extension/src/page/rpc.ts`, with a reference to the upstream line each one comes from.
- `src/api/api-utils.ts`, `src/gptk-core.ts`: pagination and retry helpers that skip failed pages and return partial results. This project needs failures to surface, so paging and retries live in the Kotlin app.
- UI, filters, storage helpers.
