"""
Build the example-sentence table: data/examples.json.

## Why this file exists

The dictionary page shows 组词 — the words a character appears in — but a
learner also needs to see each word IN a sentence. 「学生」 alone is a label;
「我是学生」 shows how the word is used.

## Source

Tatoeba (CC-BY 2.0 FR), three public files:

    per_language/cmn/cmn_sentences.tsv.bz2   89k Chinese sentences
    per_language/cmn/cmn-eng_links.tsv.bz2   78k cmn→eng links
    per_language/eng/eng_sentences.tsv.bz2   2M English sentences

Only sentences that HAVE an English translation are kept: 「学生 → 我是学生」
without a translation helps nobody, and the site's audience is overseas
learners.

## Why Python

The files are bzip2, and Node has no bzip2 in its standard library (adding
an npm package for one build step is not worth it). Python's `bz2` is stdlib,
and the repo already ships a Python script (`scripts/copy-to-up.py`), so this
is not a new toolchain.

## Filtering (each rule is a real problem, not taste)

  - **Traditional characters are dropped.** Tatoeba's `cmn` corpus mixes
    simplified with traditional and mixed script — 「老闆在的時候他就裝成一副
    很熱心的樣子」 sitting next to a simplified headword is jarring, and the
    site teaches simplified. A sentence is kept only when every CJK character
    in it is in the 8105 通用规范 table; anything else is a traditional form
    or a rare character Tatoeba picked up.
  - **Length 6–30 characters.** Shorter is a fragment, longer is a wall of
    text in a dictionary sidebar. The corpus median is 10.
  - **Up to 2 sentences per word, shortest first.** A sidebar has no room for
    a concordance.

## Output

    data/examples.json   { "学生": [ { "zh": "我是学生。", "en": "I am a student." }, ... ] }

## Running it

    npm run examples:build
"""

import bz2
import json
import os
import urllib.request

BASE_CMN = 'https://downloads.tatoeba.org/exports/per_language/cmn/'
BASE_ENG = 'https://downloads.tatoeba.org/exports/per_language/eng/'
CACHE = os.path.join('.tmp', 'tatoeba')
OUTPUT = os.path.join('data', 'examples.json')

FILES = {
    'cmn_sentences': BASE_CMN + 'cmn_sentences.tsv.bz2',
    'cmn_eng_links': BASE_CMN + 'cmn-eng_links.tsv.bz2',
    'eng_sentences': BASE_ENG + 'eng_sentences.tsv.bz2',
}

MIN_LEN = 6
MAX_LEN = 30
PER_WORD = 2


def fetch(name, url):
    """Download once into .tmp/tatoeba, then decompress from the cache."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + '.bz2')
    if not os.path.exists(path):
        print('  downloading', name)
        urllib.request.urlretrieve(url, path)
    with open(path, 'rb') as handle:
        return bz2.decompress(handle.read()).decode('utf-8', errors='replace')


def is_cjk(ch):
    """A CJK ideograph in the BMP or extension A."""
    code = ord(ch)
    return 0x4E00 <= code <= 0x9FFF or 0x3400 <= code <= 0x4DBF


def main():
    print('loading the standard character table')
    with open(
        os.path.join('data', 'general-standard-chinese-characters.json'), encoding='utf-8'
    ) as handle:
        standard = set(json.load(handle))
    print('  8105 table:', len(standard), 'characters')

    print('loading the char-word table')
    with open(os.path.join('data', 'char-words.json'), encoding='utf-8') as handle:
        word_table = json.load(handle)
    words = sorted({entry['word'] for entries in word_table.values() for entry in entries})
    print('  words to cover:', len(words))

    print('loading Tatoeba')
    cmn = fetch('cmn_sentences', FILES['cmn_sentences'])
    links = fetch('cmn_eng_links', FILES['cmn_eng_links'])
    eng = fetch('eng_sentences', FILES['eng_sentences'])

    # id -> Chinese text
    zh = {}
    for line in cmn.split('\n'):
        parts = line.split('\t')
        if len(parts) < 3:
            continue
        try:
            zh[int(parts[0])] = parts[2].strip()
        except ValueError:
            continue

    # cmn_id -> eng_id. The first column is the Chinese side: a probe over
    # the first 2000 rows found 1998 first-column ids in the Chinese file and
    # 0 second-column ids, so the orientation is fixed, not guessed per row.
    pairs = []
    for line in links.split('\n'):
        parts = line.split('\t')
        if len(parts) != 2:
            continue
        try:
            pairs.append((int(parts[0]), int(parts[1])))
        except ValueError:
            continue

    eng_needed = {b for a, b in pairs if a in zh}

    # eng_id -> English text, for the ids that are actually linked.
    eng_map = {}
    for line in eng.split('\n'):
        parts = line.split('\t')
        if len(parts) < 3:
            continue
        try:
            sid = int(parts[0])
        except ValueError:
            continue
        if sid in eng_needed:
            eng_map[sid] = parts[2].strip()

    # cmn_id -> English text (one translation is enough for a sidebar).
    translations = {}
    for a, b in pairs:
        if a in zh and b in eng_map and a not in translations:
            translations[a] = eng_map[b]

    print('  Chinese sentences:', len(zh))
    print('  with an English translation:', len(translations))

    # Simplified-only + length filter, applied to the Chinese side.
    usable = {}
    for sid, text in translations.items():
        chinese = zh[sid]
        if not all(ch in standard for ch in chinese if is_cjk(ch)):
            continue
        if not MIN_LEN <= len(chinese) <= MAX_LEN:
            continue
        usable[sid] = (chinese, text)
    print('  after simplified + length filter:', len(usable))

    # Index each sentence by EVERY two-character gram it contains, not just
    # its opening pair. The first version bucketed by `chinese[:2]`, which
    # only matched words that STARTED the sentence — 「学生」 would miss
    # 「我是学生」 entirely, and coverage came out at 19% instead of what the
    # corpus actually supports.
    buckets = {}
    for sid, (chinese, _) in usable.items():
        seen = set()
        for i in range(len(chinese) - 1):
            gram = chinese[i : i + 2]
            if gram in seen:
                continue
            seen.add(gram)
            buckets.setdefault(gram, []).append((sid, chinese))

    out = {}
    for word in words:
        if len(word) < 2:
            continue
        candidates = buckets.get(word[:2], [])
        found = [(len(chinese), sid) for sid, chinese in candidates if word in chinese]
        if not found:
            continue
        found.sort()
        # A word can appear in the same sentence twice; the sort key is
        # (length, id) so the de-dup is by id.
        unique = []
        seen_ids = set()
        for _, sid in found:
            if sid in seen_ids:
                continue
            seen_ids.add(sid)
            unique.append(sid)
            if len(unique) >= PER_WORD:
                break
        out[word] = [
            {'zh': usable[sid][0], 'en': usable[sid][1]} for sid in unique
        ]

    with open(OUTPUT, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, ensure_ascii=False, separators=(',', ':'))

    size = os.path.getsize(OUTPUT)
    print('\nwritten %s: %d words, %.0f KB' % (OUTPUT, len(out), size / 1024))
    print('  coverage: %.1f%% of %d words' % (100 * len(out) / max(1, len(words)), len(words)))

    for word in ['学生', '老师', '学校', '学习', '中国', '朋友', '时间']:
        entries = out.get(word)
        if not entries:
            print('  %s: (none)' % word)
            continue
        print('  %s: %s / %s' % (word, entries[0]['zh'], entries[0]['en'][:40]))


if __name__ == '__main__':
    main()
