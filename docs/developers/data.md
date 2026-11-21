---
title: "Autocorrect data"
description: "Sources, transformations and notices for the offline dictionary."
---

Dictionary data is bundled with the plugin. It is not downloaded while typing.

## Frequency dictionary

The English frequency file comes from [SymSpell](https://github.com/wolfgarbe/SymSpell)
at commit `6b8efd7d5053b68013e0193357a79011aa648ce2` (2021-06-29), retrieved 2026-11-01.
The [pinned file](https://raw.githubusercontent.com/wolfgarbe/SymSpell/6b8efd7d5053b68013e0193357a79011aa648ce2/SymSpell/frequency_dictionary_en_82_765.txt)
and [source explanation](https://github.com/wolfgarbe/SymSpell/blob/6b8efd7d5053b68013e0193357a79011aa648ce2/README.md)
identify its provenance.

| Record           | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Upstream rows    | 82,834, with a UTF-8 BOM                                           |
| Retained entries | 82,769 unique words                                                |
| Local file size  | 1,331,971 bytes                                                    |
| Original SHA-256 | `c604e1121e398ae7c7fbf777f11e0a0f2fa66eda932cb9fba1321466cf3acd7b` |
| Local SHA-256    | `5592880d41b2bf1737abdd3f4ec5c4e3cd6d0203f30641690cfacc2f288d7ddb` |

Processing removes the BOM, keeps lowercase ASCII words matching `[a-z]{1,32}`
with positive integer frequencies, and writes LF-separated `word frequency`
lines. Retained frequencies and order are unchanged. The upstream filename's
number is not the actual entry count.

The pinned README describes an intersection of Google Books Ngram frequencies
and SCOWL word lists. The repository MIT notice does not replace those data
notices. `licenses/LICENSE.autocorrect-data` includes the pinned MIT notice,
Google Books attribution/CC BY 3.0 link and historical SCOWLv1 notices. The exact
SCOWL release used upstream is unspecified. No upstream author endorses hstack.

## Curated inputs

| File                                | Purpose                                 |
| ----------------------------------- | --------------------------------------- |
| src/data/autocorrect-typos.json     | 80 reviewed typo-to-word rules          |
| src/data/autocorrect-technical.json | 201 case-insensitive preservation terms |

Every correction target is in the dictionary; misspelling keys are not valid
dictionary entries. Real-word swaps and ambiguous contractions are intentionally
excluded. The technical list prevents corrections; it does not add suggestion
frequency. Review changes to both inputs individually.

Emoji data has its own gemoji MIT notice in `licenses/LICENSE.gemoji`. The build
embeds all required notices in main.js. Keep the notice files even though users
only install the three bundled plugin files.
