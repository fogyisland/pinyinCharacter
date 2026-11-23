# Third-Party Font Licenses

This project bundles the following fonts, all under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL). The full OFL.txt for each font is committed next to its WOFF2 in `public/fonts/`.

## LXGW WenKai GB (霞鹜文楷 GB)

- Upstream: https://github.com/lxgw/LxgwWenkaiGB
- Copyright: © 2022-2026 LXGW.
- License: SIL OFL 1.1

## Yozai (悠哉)

- Upstream: https://github.com/lxgw/yozai-font
- Copyright: © 2020, 2024 LXGW.
- License: SIL OFL 1.1

## Iansui (芫荽)

- Upstream: https://github.com/ButTaiwan/iansui
- Copyright: © 2025 The Iansui Project Authors.
- License: SIL OFL 1.1

## Zen Kaku Gothic New (思源ゴシック)

- Upstream: https://github.com/googlefonts/zen-kakugothic
- Copyright: © 2022 Adobe Inc., Google Inc.
- License: SIL OFL 1.1

## Ma Shan Zheng (马善政体) (Plan G3)

- Upstream: https://github.com/google/fonts/tree/main/ofl/mashanzheng
- Copyright: © 2024 The Ma Shan Zheng Project Authors.
- License: SIL OFL 1.1

## Long Cang (龙藏体) (Plan G3)

- Upstream: https://github.com/google/fonts/tree/main/ofl/longcang
- Copyright: © 2024 The Long Cang Project Authors.
- License: SIL OFL 1.1

## BabelStone Han Basic + Extra (Plan L)

- Upstream: https://www.babelstone.co.uk/Fonts/BabelStoneHan.html
- Copyright: © 2019 BabelStone.
- License: SIL OFL 1.1

## Tatoeba example sentences (CC-BY 2.0 FR)

- Upstream: https://tatoeba.org — downloads at https://downloads.tatoeba.org/exports/
- Used for: `data/examples.json`, the example sentences shown next to 组词 on the
  dictionary page. Only sentences that carry an English translation are kept, and
  only those whose Chinese characters are all in the 8105 通用规范 table, so a
  traditional-script sentence is never shown next to a simplified headword.
- License: CC-BY 2.0 FR — attribution required. The sentence pairs are used
  verbatim; `scripts/build-examples.py` records exactly which files were fetched.
- Rebuilt with: `npm run examples:build`
