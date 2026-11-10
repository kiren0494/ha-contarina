"""Contarina coordinator: downloads and parses a municipality's ICS calendar."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

from aiohttp import ClientError
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.storage import Store
from homeassistant.helpers.translation import async_get_translations
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import DOMAIN, PICKUP_DONE_HOUR, WASTE_TYPES

_LOGGER = logging.getLogger(__name__)

ICS_URL = "https://contarina.it/ajax/moduli/appbugfixapi/genera_ics_calendari?id_zona={}"

# How often to recompute the remaining days (plus the midnight refresh)
UPDATE_INTERVAL = timedelta(hours=6)
# How often to re-download the calendar from contarina.it
DOWNLOAD_MAX_AGE = timedelta(days=1)

CALENDAR_STORAGE_VERSION = 1


def _calendar_store(hass: HomeAssistant, municipality_number: int) -> Store[dict]:
    """The downloaded calendar, in .storage/contarina.calendar_<zone>.

    Shared by the entries of the same municipality: {"downloaded": ISO time, "content": ICS}.
    """
    return Store(hass, CALENDAR_STORAGE_VERSION, f"{DOMAIN}.calendar_{municipality_number}")


async def async_remove_calendar(hass: HomeAssistant, municipality_number: int) -> None:
    """Delete a municipality's saved calendar."""
    await _calendar_store(hass, municipality_number).async_remove()


async def async_waste_names(hass: HomeAssistant) -> dict[str, str]:
    """Short waste names in the HA language, e.g. {"glass": "VPL"} in Italian."""
    translations = await async_get_translations(hass, hass.config.language, "entity", [DOMAIN])
    prefix = f"component.{DOMAIN}.entity.sensor.next_pickup.state_attributes.waste_types.state."
    return {waste: translations.get(prefix + waste, waste.capitalize()) for waste in WASTE_TYPES}


class ContarinaCoordinator(DataUpdateCoordinator[dict[str, date | None]]):
    """One coordinator per config entry; data is {waste type: next date}."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=UPDATE_INTERVAL,
            config_entry=entry,
        )
        self.municipality_name: str = entry.data["municipality"]
        self.municipality_number: int = entry.data["municipality_number"]
        # Custom name chosen during setup, otherwise the municipality name
        self.location: str = entry.data.get("name") or self.municipality_name

        self._store = _calendar_store(hass, self.municipality_number)
        self._events: list[tuple[date, str]] = []
        self._parsed_download: str | None = None
        # Upcoming pickups: (date, waste types collected that day), sorted by date
        self.pickups: list[tuple[date, list[str]]] = []
        # Every pickup in the saved calendar (from its download day), for the sidebar page
        self.all_pickups: list[tuple[date, list[str]]] = []
        # Pickup reminders (ContarinaReminders), set up with the entry
        self.reminders = None

    @property
    def device_info(self) -> DeviceInfo:
        """The calendar's device, shared by its sensors and calendar entity."""
        return DeviceInfo(
            identifiers={(DOMAIN, self.config_entry.entry_id)},
            name=f"Contarina {self.location}",
            manufacturer="Contarina",
            model=self.municipality_name,
            entry_type=DeviceEntryType.SERVICE,
            configuration_url="https://contarina.it",
        )

    def next_pickup(self) -> tuple[date, list[str]] | None:
        """The next pickup: on a pickup day, the following one from midday on."""
        now = dt_util.now()
        today = now.date()
        for day, types in self.pickups:
            # Today's pickup is over by midday: move on to the following one
            if day < today or (day == today and now.hour >= PICKUP_DONE_HOUR):
                continue
            return day, types
        return None

    async def _async_update_data(self) -> dict[str, date | None]:
        # Loaded every time: another entry of the same municipality may have refreshed it
        saved = await self._store.async_load()
        if saved is not None and not isinstance(saved.get("content"), str):
            saved = None
        if saved is None or self._is_stale(saved):
            try:
                saved = {"downloaded": dt_util.utcnow().isoformat(), "content": await self._download()}
                await self._store.async_save(saved)
                _LOGGER.debug("Calendar of zone %s downloaded", self.municipality_number)
            except (ClientError, TimeoutError, ValueError) as err:
                if saved is None:
                    raise UpdateFailed(f"Calendar download failed: {err}") from err
                _LOGGER.warning("Calendar download failed (%s), using the saved copy", err)

        # Re-parse the calendar only if it has changed
        if saved["downloaded"] != self._parsed_download:
            self._events = parse_ics(saved["content"])
            self._parsed_download = saved["downloaded"]
            self.all_pickups = group_pickups(self._events, date.min)

        self.pickups = group_pickups(self._events, dt_util.now().date())
        return {
            waste: next((day for day, types in self.pickups if waste in types), None)
            for waste in WASTE_TYPES
        }

    async def _download(self) -> str:
        session = async_get_clientsession(self.hass)
        async with asyncio.timeout(30):
            resp = await session.get(ICS_URL.format(self.municipality_number))
            resp.raise_for_status()
            content = (await resp.read()).decode("utf-8", errors="replace")
        # Avoid saving an error page in place of the calendar
        if "BEGIN:VCALENDAR" not in content:
            raise ValueError("the response is not an ICS calendar")
        return content

    @staticmethod
    def _is_stale(saved: dict) -> bool:
        downloaded = dt_util.parse_datetime(saved.get("downloaded") or "")
        return downloaded is None or dt_util.utcnow() - downloaded > DOWNLOAD_MAX_AGE


def group_pickups(events: list[tuple[date, str]], today: date) -> list[tuple[date, list[str]]]:
    """Waste types collected on each day from today on, in WASTE_TYPES order."""
    by_day: dict[date, set[str]] = {}
    for day, text in events:
        if day < today:
            continue
        for waste, keyword in WASTE_TYPES.items():
            if keyword in text:
                by_day.setdefault(day, set()).add(waste)
    return [
        (day, [waste for waste in WASTE_TYPES if waste in types])
        for day, types in sorted(by_day.items())
    ]


def parse_ics(content: str) -> list[tuple[date, str]]:
    """Return (date, lowercase summary + description) for each event of an ICS calendar.

    Contarina's calendars are plain one-off events (no recurrences, no time zones), so a
    minimal parser is enough and spares the integration any third-party dependency.
    """
    # Unfold continuation lines (RFC 5545 §3.1: a line starting with a space or tab)
    lines: list[str] = []
    for line in content.splitlines():
        if line[:1] in (" ", "\t") and lines:
            lines[-1] += line[1:]
        elif line:
            lines.append(line)

    events: list[tuple[date, str]] = []
    event: dict[str, str] | None = None
    for line in lines:
        name_params, sep, value = line.partition(":")
        if not sep:
            continue
        name = name_params.split(";", 1)[0].strip().upper()
        if name == "BEGIN" and value.strip().upper() == "VEVENT":
            event = {}
        elif name == "END" and value.strip().upper() == "VEVENT":
            if event is not None and (day := _parse_date(event.get("DTSTART", ""))):
                text = f"{event.get('SUMMARY', '')} {event.get('DESCRIPTION', '')}"
                events.append((day, _unescape(text).lower()))
            event = None
        elif event is not None and name in ("DTSTART", "SUMMARY", "DESCRIPTION"):
            event[name] = value.strip()
    return events


def _parse_date(value: str) -> date | None:
    """Day of a DTSTART value: 20261230, 20261230T060000 or 20261230T060000Z (UTC)."""
    try:
        if value.endswith("Z"):
            moment = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            return dt_util.as_local(moment).date()
        return datetime.strptime(value[:8], "%Y%m%d").date()
    except ValueError:
        return None


def _unescape(text: str) -> str:
    return (
        text.replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
    )
