"""Contarina waste dictionary ("where does it go?"), used by the search_waste service.

The site's own search box calls this endpoint; it answers in JSON, with the containers
as a small HTML fragment (an icon per container and its Italian name). Asked with an
empty query it returns the whole dictionary (about 300 items): it is downloaded once a
day and searched here, also by the English names of waste_names_en.
No Home Assistant imports: it can be tried on a PC.
"""

from __future__ import annotations

import html
import re
import unicodedata

try:
    from .waste_names_en import NAMES_EN
except ImportError:  # Loaded on its own, outside the package (tests on a PC)
    from waste_names_en import NAMES_EN

SEARCH_URL = "https://contarina.it/ajax/moduli/dizionari/ajax_search"
# Query of the whole dictionary
DICTIONARY_PARAMS = {"q": "", "limit": 10000}

# Icon number of the site -> container key (waste types as in WASTE_TYPES, the EcoCentro
# and the special collections)
ICON_TYPES = {
    1: "residual",
    2: "garden",
    3: "organic",
    4: "glass",
    5: "paper",
    8: "ecocenter",
    9: "special_service",
    10: "batteries",
    11: "small_appliances",
    12: "toner",
    13: "clothes",
    14: "medicines",
}

_CONTAINER = re.compile(r'icona_rifiuto_(\d+)\.png[^>]*>\s*<strong>(.*?)</strong>', re.S)


def _clean(text: str) -> str:
    return " ".join(html.unescape(text or "").split())


def normalize(text: str) -> str:
    """For matching: lower case, no accents, plain apostrophes, single spaces."""
    text = unicodedata.normalize("NFD", text.replace("’", "'").casefold())
    return " ".join("".join(c for c in text if not unicodedata.combining(c)).split())


def parse_dictionary(results: list) -> list[dict]:
    """[{"id", "name" (Italian), "containers": [{"name": Italian name, "type": key|None}]}]."""
    items = []
    for result in results if isinstance(results, list) else []:
        if not isinstance(result, dict) or not result.get("titolo"):
            continue
        containers = [
            {"name": _clean(name), "type": ICON_TYPES.get(int(icon))}
            for icon, name in _CONTAINER.findall(result.get("contenitori") or "")
        ]
        name = _clean(result["titolo"])
        items.append({"id": str(result.get("id") or ""), "name": name[:1].upper() + name[1:], "containers": containers})
    return items


def english_name(item: dict) -> str | None:
    """The English name, while the Italian title is still the translated one."""
    entry = NAMES_EN.get(item["id"])
    if entry is None or normalize(entry[0]) != normalize(item["name"]):
        return None
    return entry[1]


def _variants(word: str) -> tuple[str, ...]:
    """A word as typed, and without its last letter when that is likely just the ending
    of singular/plural ("bottiglia" finds "bottiglie", "battery" finds "batteries")."""
    if len(word) >= 5 and word[-1] in "aeiouys":
        return word, word[:-1]
    return (word,)


def _matches(words: list[str], name: str, word_start: bool = False) -> bool:
    """Every word found in the name: anywhere, as on contarina.it (Italian compounds like
    "caricabatterie"), or at the start of a word (English: "oil" isn't "foil")."""
    if word_start:
        name = " " + re.sub(r"[^\w]+", " ", name)
        return all(any(f" {variant}" in name for variant in _variants(word)) for word in words)
    return all(any(variant in name for variant in _variants(word)) for word in words)


def search(items: list[dict], query: str, language: str, limit: int) -> list[dict]:
    """Items whose name contains every word of the query (case and accents ignored).

    In a language other than Italian the English names are searched too, and shown when
    there is one. Names starting with the query come first. Each result:
    {"name", "name_it", "containers"}.
    """
    words = normalize(query).split()
    if not words:
        return []
    english = not language.lower().startswith("it")
    first, rest = [], []
    for item in items:
        name_en = english_name(item) if english else None
        names = [normalize(item["name"])] + ([normalize(name_en)] if name_en else [])
        if not _matches(words, names[0]) and not (
            name_en and _matches(words, names[1], word_start=True)
        ):
            continue
        result = {"name": name_en or item["name"], "name_it": item["name"], "containers": item["containers"]}
        prefix = normalize(query)
        (first if any(name.startswith(prefix) for name in names) else rest).append(result)
    key = lambda result: normalize(result["name"])  # noqa: E731
    return (sorted(first, key=key) + sorted(rest, key=key))[:limit]
