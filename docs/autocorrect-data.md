# Autocorrect data

These files are bundled data for hstack. They are available offline;
the plugin does not download dictionaries while typing.

## Frequency dictionary

`src/data/autocorrect-frequency.txt` comes from Wolf Garbe's SymSpell English frequency
dictionary. Each line contains one lowercase ASCII word and its integer
frequency, separated by a space.

- Upstream repository: <https://github.com/wolfgarbe/SymSpell>
- Pinned dictionary commit: `6b8efd7d5053b68013e0193357a79011aa648ce2`
  (2021-06-29).
- Original file: <https://raw.githubusercontent.com/wolfgarbe/SymSpell/6b8efd7d5053b68013e0193357a79011aa648ce2/SymSpell/frequency_dictionary_en_82_765.txt>
- Source explanation: <https://github.com/wolfgarbe/SymSpell/blob/6b8efd7d5053b68013e0193357a79011aa648ce2/README.md>
- Retrieved: 2026-11-01.
- Original SHA-256:
  `c604e1121e398ae7c7fbf777f11e0a0f2fa66eda932cb9fba1321466cf3acd7b`
- Local SHA-256:
  `5592880d41b2bf1737abdd3f4ec5c4e3cd6d0203f30641690cfacc2f288d7ddb`

The source contains 82,834 rows and a UTF-8 byte-order mark. Local processing
removed that mark, retained only words matching `[a-z]{1,32}` with a positive
integer frequency, and wrote normalized `word frequency` lines with LF endings.
The resulting file has **82,769 unique entries** and **1,331,971 bytes**. Retained
frequencies and entry order were not changed. The upstream filename's number is
not used as the actual entry count.

The pinned README identifies the data as an intersection of **Google Books
Ngram frequencies** and **SCOWL word lists**. The SymSpell repository's MIT
license is a software/repository notice; it does not replace the underlying
dataset notices. `licenses/LICENSE.autocorrect-data` includes the pinned repository MIT
notice, attribution and the CC BY 3.0 link for Google Books Ngram data, and the
full copyright/source notices from the official historical SCOWLv1 README.
The exact SCOWL release used by SymSpell is unspecified in its pinned README.
Neither the data sources nor their authors endorse this plugin.

## Explicit corrections

`src/data/autocorrect-typos.json` is a plain JSON object mapping **80** locally curated
misspellings to their corrections. It includes obvious errors such as `teh`,
`recieve`, `seperate`, and `slgihtly`. Every target appears in the frequency
dictionary; none of the misspelling keys appears there as a word.

The list intentionally excludes real-word swaps such as `form`/`from`,
`its`/`it's`, and ambiguous contraction guesses such as `cant`/`can't` or
`dont`/`don't`. Dictionary membership alone cannot prove a misspelling is safe;
changes to this small explicit list should be reviewed individually.

## Preserved technical terms

`src/data/autocorrect-technical.json` is a plain JSON array of **201** lowercase strings.
It covers Python, C/C++, SQL, JSON, Obsidian, common libraries, tooling,
abbreviations, and computer science vocabulary, plus the user's name.

This is a preservation list: it prevents corrections to these terms. It should
not increase their frequency or introduce them as suggested corrections for
other words. Its lowercase spelling supports case-insensitive lookup; it does
not prescribe capitalization in notes. Unknown names and identifiers still
need the typing engine's context and capitalization protections.

The curated corrections and technical list were written locally for this
plugin; they are not presented as part of the upstream frequency dataset.
