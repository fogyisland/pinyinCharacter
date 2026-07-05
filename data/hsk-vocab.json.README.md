# data/hsk-vocab.json

Single-character lists extracted from HSK 2.0 vocabulary (150 + 147 + 298 + 598 + 1298 + 2500 = 4991 words, 2632 unique chars after dedup).
Source data: [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) `complete.min.json` (2026-07-05 import).

Each entry contains only `{ "char": "X" }` because the import script (`scripts/import-hsk.ts`) only reads `char` and writes it to `chars.hsk_level`.

**Level mapping** (HSK 2.0 standard, 6-tier):
- HSK 1: 178 chars
- HSK 2: 168 chars
- HSK 3: 272 chars
- HSK 4: 453 chars
- HSK 5: 639 chars
- HSK 6: 922 chars

Each char appears at its **lowest** level (HSK 1 ⊂ HSK 2 ⊂ ... ⊂ HSK 6 inclusive — a char in HSK 1 is also "in" HSK 2 in theory, but the importer sets `hsk_level` to the lowest level so the chip shows the most appropriate tier).

## Re-import

To repopulate `chars.hsk_level` from this file:

```sql
UPDATE chars SET hsk_level = NULL;  -- clear all
```

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test" npx tsx scripts/import-hsk.ts
```

The import script does `INSERT … ON DUPLICATE KEY UPDATE hsk_level = VALUES(hsk_level)` so re-running with new vocab will overwrite existing `hsk_level` values. The clearing step is needed for chars that drop out of the new list (e.g., the original hand-crafted HSK 1.0 list had 285 chars; the official list has 178 — the 107 extras must be cleared).

## HSK 3.0 data is NOT used

The source repo also contains HSK 3.0 levels (`new-1` through `new-7`) but we use HSK 2.0 (`old-1` through `old-6`) to match the project's existing 6-tier reveal model in `lib/reveal.ts`. If HSK 3.0 adoption becomes a project decision later, this file can be regenerated.

## If you need richer per-char data

Do NOT re-add fields like `pinyin`, `meaning_zh`, `pos` to this file. The earlier draft (2026-07-04) carried hand-crafted-from-memory placeholders that were unreliable and not consumed by the importer — they were stripped. Read pinyin/meaning from the `chars` table instead; `lib/chars.ts:resolvePinyin()` falls back to `pinyin-pro` when DB pinyin is empty.