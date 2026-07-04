# data/hsk-vocab.json

Hand-curated list of single characters that appear in **HSK 1.0** vocabulary,
de-duplicated across multi-char words. Each entry contains only `{ "char": "X" }`
because the import script (`scripts/import-hsk.ts`) only reads `char` and
writes it to `chars.hsk_level`.

HSK levels **2-6** are empty arrays — vocab for those levels is added later.

If you need richer per-char data (pinyin, meaning, POS), read it from the
`chars` table; do NOT re-add those fields here. The earlier draft carried
hand-crafted-from-memory placeholders that were unreliable and not consumed by
the importer — they were stripped on 2026-07-04 to remove any risk of misuse.