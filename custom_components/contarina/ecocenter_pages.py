"""EcoCentri of contarina.it: page parsers (opening hours and map) and opening status.

There is no API: the data comes from the HTML of the public pages, so this is kept
free of Home Assistant imports and tolerant of small markup changes.
"""

from __future__ import annotations

import html
import re
from datetime import date, datetime, time, timedelta
from functools import lru_cache

HOURS_URL = "https://contarina.it/cittadino/raccolta-differenziata/ecocentro/orari-ecocentro"
MAP_URL = "https://contarina.it/cittadino/raccolta-differenziata/ecocentro/mappa-degli-ecocentri"

# First three letters of the Italian weekday -> Python weekday (Monday = 0)
_WEEKDAYS = {"lun": 0, "mar": 1, "mer": 2, "gio": 3, "ven": 4, "sab": 5, "dom": 6}

_SLOT = re.compile(r"(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})")
_HEADING = re.compile(r'<div class="panel-heading comune_(\d{6})">')
_TITLE = re.compile(r'<h4 class="panel-title">\s*<strong>(.*?)</strong>(.*?)</h4>', re.S)
_ROW = re.compile(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", re.S)
_SITE = re.compile(
    r'\["(\d{6})","(-?[\d.]+)","(-?[\d.]+)","<div class=\'boxdiv\'><strong>(.*?)</strong>'
    r"<br />(.*?)<br />"
)


def _text(fragment: str) -> str:
    """Plain text of an HTML fragment, with collapsed whitespace."""
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _key(istat: str, place: str) -> tuple[str, str]:
    return istat, _text(place).casefold()


def parse_slots(text: str) -> list[dict]:
    """Time slots of a day, e.g. "9.00 - 12.00 / 15.00 - 18.00 su prenotazione".

    "su prenotazione" (booking required) refers to the slot it follows.
    """
    matches = list(_SLOT.finditer(text))
    slots = []
    for i, match in enumerate(matches):
        start_h, start_m, end_h, end_m = (int(g) for g in match.groups())
        tail_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        slots.append(
            {
                "from": f"{start_h:02d}:{start_m:02d}",
                "to": f"{end_h:02d}:{end_m:02d}",
                "booking": "prenotazione" in text[match.end() : tail_end].lower(),
            }
        )
    return slots


def parse_hours_page(page: str) -> tuple[str | None, list[dict]]:
    """Return (closures notice, centers) from the opening hours page.

    Each center: {"istat", "municipality", "address", "note", "hours"}, where "hours" has
    7 lists of slots, Monday first; days missing from the table are closed.
    """
    parts = _HEADING.split(page)
    notice = None
    intro = parts[0]
    # The closures are announced in a paragraph right before the list of centers
    paragraphs = [_text(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", intro, re.S)]
    closures = [p for p in paragraphs if "chius" in p.lower()]
    if closures:
        notice = closures[-1]

    centers = []
    for istat, block in zip(parts[1::2], parts[2::2]):
        title = _TITLE.search(block)
        if not title:
            continue
        place = title.group(2)
        # A warning is sometimes appended to the address: "via ... - ATTENZIONE: ..."
        pieces = re.split(r"\s+-\s+(?=attenzione)", _text(place), maxsplit=1, flags=re.I)
        hours: list[list[dict]] = [[] for _ in range(7)]
        table = block.split("</table>", 1)[0]
        for day_html, slots_html in _ROW.findall(table):
            weekday = _WEEKDAYS.get(_text(day_html).lower()[:3])
            if weekday is not None:
                hours[weekday] = parse_slots(_text(slots_html))
        # "via della Botte" -> "Via della Botte"
        address = pieces[0][:1].upper() + pieces[0][1:]
        centers.append(
            {
                "istat": istat,
                "municipality": _text(title.group(1)),
                "address": address,
                "note": pieces[1] if len(pieces) > 1 else None,
                "hours": hours,
                "key": _key(istat, place),
            }
        )
    return notice, centers


def parse_map_page(page: str) -> dict[tuple[str, str], tuple[float, float]]:
    """Coordinates of the centers, by (ISTAT code, address as written on the hours page)."""
    return {
        _key(istat, place): (float(lat), float(lon))
        for istat, lat, lon, _name, place in _SITE.findall(page)
    }


def build_centers(hours_page: str, map_page: str | None) -> dict:
    """Centers with their coordinates (when the map page is available)."""
    notice, centers = parse_hours_page(hours_page)
    sites = parse_map_page(map_page) if map_page else {}
    for center in centers:
        key = center.pop("key")
        coords = sites.get(key)
        if coords is None:
            # Address written differently: fall back to the only center of that municipality
            same = [c for k, c in sites.items() if k[0] == center["istat"]]
            coords = same[0] if len(same) == 1 else None
        center["latitude"], center["longitude"] = coords or (None, None)
    return {"notice": notice, "centers": centers}


# Italian national holidays on a fixed date (month, day)
_FIXED_HOLIDAYS = [
    (1, 1),  # Capodanno
    (1, 6),  # Epifania
    (4, 25),  # Festa della Liberazione
    (5, 1),  # Festa del Lavoro
    (6, 2),  # Festa della Repubblica
    (8, 15),  # Ferragosto
    (11, 1),  # Ognissanti
    (12, 8),  # Immacolata
    (12, 25),  # Natale
    (12, 26),  # Santo Stefano
]


def _easter(year: int) -> date:
    """Easter Sunday (Gregorian calendar, Meeus/Jones/Butcher algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


@lru_cache(maxsize=4)
def italian_holidays(year: int) -> frozenset[date]:
    """National holidays, when the EcoCentri are closed.

    Local patron saints differ from town to town and are not included.
    """
    days = {date(year, month, day) for month, day in _FIXED_HOLIDAYS}
    if year >= 2026:
        days.add(date(year, 10, 4))  # San Francesco, national holiday again (L. 151/2025)
    easter = _easter(year)
    days.update({easter, easter + timedelta(days=1)})  # Pasqua, Pasquetta
    return frozenset(days)


def is_holiday(day: date) -> bool:
    return day in italian_holidays(day.year)


# --- Extraordinary closures --------------------------------------------------------------
#
# Published only as a sentence above the list of centers, e.g. "Gli EcoCentri rimarranno
# chiusi: tutti i venerdì, il pomeriggio di sabato 4 aprile e l'intera giornata di
# giovedì 24 e 31 dicembre 2026." It is read into
# {"weekdays": [{"weekday", "part"}], "days": [{"date", "part"}]} (part: all, morning,
# afternoon), so that the sensors are closed on those days and the card can write the
# sentence in the user's language. A sentence not understood word for word gives None:
# then only the Italian text is shown, as before.

_MONTHS = {
    name: number
    for number, name in enumerate(
        (
            "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre "
            "novembre dicembre"
        ).split(),
        start=1,
    )
}
# Singular and plural ("tutti i sabati"), with and without accents
_DAY_NAMES = {
    "lunedì": 0, "lunedi": 0, "martedì": 1, "martedi": 1, "mercoledì": 2, "mercoledi": 2,
    "giovedì": 3, "giovedi": 3, "venerdì": 4, "venerdi": 4, "sabato": 5, "sabati": 5,
    "domenica": 6, "domeniche": 6,
}  # fmt: skip
_DAY = "|".join(sorted(_DAY_NAMES, key=len, reverse=True))
_MONTH = "|".join(_MONTHS)

_CLOSURES = re.compile(
    r"^gli\s+eco\s?centri\s+(?:rimarranno|resteranno|saranno|sono)\s+chiusi\s*:?\s*(.+?)\.?$",
    re.I,
)
_EVERY = re.compile(rf"\b(?:tutti\s+i|tutte\s+le|ogni)\s+(?P<day>{_DAY})\b", re.I)
_DATES = re.compile(
    rf"(?:\b(?P<day>{_DAY})\s+)?\b(?P<numbers>\d{{1,2}}(?:\s*(?:,|\be\b)\s*\d{{1,2}})*)\s+"
    rf"(?P<month>{_MONTH})\b(?:\s+(?P<year>\d{{4}}))?",
    re.I,
)
_MORNING = re.compile(r"\bmattin(?:a|o|ata)\b", re.I)
_AFTERNOON = re.compile(r"\bpomeriggio\b", re.I)
# Words that may surround the dates without changing their meaning
_FILLER = {
    "il", "l'", "la", "lo", "le", "i", "di", "del", "della", "dei", "delle", "e", "anche",
    "intera", "intero", "giornata", "tutta", "tutto", "giorno", "nel", "nella", "in",
    "mattina", "mattino", "mattinata", "pomeriggio",
}  # fmt: skip
# Where the morning ends and the afternoon starts, for half-day closures
NOON = "12:00"


def _part(text: str) -> str:
    morning, afternoon = bool(_MORNING.search(text)), bool(_AFTERNOON.search(text))
    return "morning" if morning and not afternoon else "afternoon" if afternoon and not morning else "all"


def _understood(text: str, spans: list[tuple[int, int]]) -> bool:
    """Whether all the words outside the recognized dates are harmless fillers."""
    rest = text
    for start, end in sorted(spans, reverse=True):
        rest = rest[:start] + " " + rest[end:]
    words = re.findall(r"[^\W\d]+'?|\d+|[^\w\s']", rest.lower().replace("’", "'"))
    return all(word in _FILLER for word in words)


def _resolve_year(day: int, month: int, year: str | None, weekday: int | None, today: date):
    """The date meant: the year given, else the one where the weekday matches (this year
    first), else this year."""
    years = [int(year)] if year else [today.year, today.year + 1, today.year - 1]
    for candidate in years:
        try:
            found = date(candidate, month, day)
        except ValueError:
            continue
        if weekday is None or found.weekday() == weekday:
            return found
    return None


@lru_cache(maxsize=8)
def parse_closures(notice: str | None, today: date) -> dict | None:
    """The extraordinary closures announced in the notice, None if not fully understood."""
    if not notice:
        return None
    match = _CLOSURES.match(" ".join(notice.split()))
    if not match:
        return None
    # "il pomeriggio di sabato 4 aprile e l'intera giornata di giovedì 24 e 31 dicembre"
    # -> one item per closure; " e " between two numbers stays inside the item
    items: list[str] = []
    for piece in re.split(r"\s*,\s*|\s+e\s+(?!\d)", match.group(1)):
        if items and re.fullmatch(r"\d{1,2}", items[-1]):
            items[-1] += f", {piece}"  # "24, 25 e 31 dicembre"
        else:
            items.append(piece)

    weekdays: dict[int, set[str]] = {}
    days: dict[date, set[str]] = {}
    for item in items:
        part = _part(item)
        spans = []
        found = False
        for every in _EVERY.finditer(item):
            weekdays.setdefault(_DAY_NAMES[every["day"].lower()], set()).add(part)
            spans.append(every.span())
            found = True
        for dates in _DATES.finditer(item):
            weekday = _DAY_NAMES[dates["day"].lower()] if dates["day"] else None
            month = _MONTHS[dates["month"].lower()]
            numbers = [int(n) for n in re.findall(r"\d+", dates["numbers"])]
            first = _resolve_year(numbers[0], month, dates["year"], weekday, today)
            if first is None:
                return None
            for number in numbers:
                try:
                    days.setdefault(date(first.year, month, number), set()).add(part)
                except ValueError:
                    return None
            spans.append(dates.span())
            found = True
        if not found or not _understood(item, spans):
            return None

    def merged(parts: set[str]) -> str:
        return parts.pop() if len(parts) == 1 else "all"

    return {
        "weekdays": [
            {"weekday": weekday, "part": merged(parts)} for weekday, parts in sorted(weekdays.items())
        ],
        "days": [
            {"date": day.isoformat(), "part": merged(parts)} for day, parts in sorted(days.items())
        ],
    }


def closed_part(day: date, closures: dict | None) -> str | None:
    """Which part of a day an extraordinary closure takes: all, morning, afternoon or None."""
    if not closures:
        return None
    parts = {c["part"] for c in closures["weekdays"] if c["weekday"] == day.weekday()}
    iso = day.isoformat()
    parts.update(c["part"] for c in closures["days"] if c["date"] == iso)
    if not parts:
        return None
    return parts.pop() if len(parts) == 1 else "all"


def open_slots(slots: list[dict], part: str | None) -> list[dict]:
    """A day's slots without the closed part (a slot across noon is cut there)."""
    if part is None:
        return slots
    if part == "all":
        return []
    kept = []
    for slot in slots:
        if part == "afternoon":
            if slot["from"] >= NOON:
                continue
            if slot["to"] > NOON:
                slot = {**slot, "to": NOON}
        else:
            if slot["to"] <= NOON:
                continue
            if slot["from"] < NOON:
                slot = {**slot, "from": NOON}
        kept.append(slot)
    return kept


def opening_status(hours: list[list[dict]], now: datetime, closures: dict | None = None) -> dict:
    """Whether a center is open at `now` (an aware local datetime).

    Returns {"state": "open" | "booking_only" | "closed", "until": end of the current
    slot, "next_opening": start of the next slot, "next_change": when the state changes}.
    Closed on national holidays and on the extraordinary closures (parse_closures).
    """
    current = None
    next_opening = None
    for offset in range(15):
        day = now.date() + timedelta(days=offset)
        if is_holiday(day):
            continue
        for slot in open_slots(hours[day.weekday()], closed_part(day, closures)):
            start = datetime.combine(day, time.fromisoformat(slot["from"]), now.tzinfo)
            end = datetime.combine(day, time.fromisoformat(slot["to"]), now.tzinfo)
            if current is None and start <= now < end:
                current = (slot, end)
            elif start > now and (next_opening is None or start < next_opening):
                next_opening = start
        if next_opening is not None and offset > 0:
            break

    if current is not None:
        slot, until = current
        return {
            "state": "booking_only" if slot["booking"] else "open",
            "until": until,
            "next_opening": next_opening,
            "next_change": until,
        }
    return {"state": "closed", "until": None, "next_opening": next_opening, "next_change": next_opening}
