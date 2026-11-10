"""Residual bin emptyings marked by the user, stored per config entry."""

from __future__ import annotations

from datetime import date

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STANDARD_BIN_LITERS

STORAGE_VERSION = 1


def _storage_key(entry_id: str) -> str:
    return f"{DOMAIN}.{entry_id}.emptyings"


async def async_remove_store(hass: HomeAssistant, entry_id: str) -> None:
    """Delete an entry's stored emptyings (when the entry is removed)."""
    await Store(hass, STORAGE_VERSION, _storage_key(entry_id)).async_remove()


class ContarinaEmptyings:
    """Emptying dates of an entry's residual bin, plus the yearly allowance.

    The allowance is (household members + 1) emptyings of the standard 120 L bin, i.e. a
    volume: with a different bin it is rescaled, so a 60 L bin gets twice as many emptyings.
    """

    def __init__(
        self, hass: HomeAssistant, entry_id: str, household_members: int, bin_liters: int
    ) -> None:
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, _storage_key(entry_id))
        self.household_members = household_members
        self.bin_liters = bin_liters
        self._dates: set[date] = set()

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._dates = {date.fromisoformat(d) for d in data.get("dates", [])}

    @property
    def liters_total(self) -> int:
        return (self.household_members + 1) * STANDARD_BIN_LITERS

    @property
    def total(self) -> float:
        return self.liters_total / self.bin_liters

    def dates_in(self, year: int) -> list[date]:
        return sorted(d for d in self._dates if d.year == year)

    async def async_add(self, day: date) -> None:
        self._dates.add(day)
        await self._async_save()

    async def async_remove(self, day: date) -> None:
        self._dates.discard(day)
        await self._async_save()

    async def _async_save(self) -> None:
        await self._store.async_save({"dates": [d.isoformat() for d in sorted(self._dates)]})
