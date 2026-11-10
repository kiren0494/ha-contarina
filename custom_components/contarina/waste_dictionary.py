"""The Contarina waste dictionary, downloaded once a day and saved in .storage.

Shared by all the entries (it's the same for every municipality) and loaded only when
someone searches: the first search of the day downloads it again. If the download fails
the saved copy is used; without one the search fails.
"""

from __future__ import annotations

import asyncio
import logging

from aiohttp import ClientError

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .waste_search import DICTIONARY_PARAMS, SEARCH_URL, parse_dictionary

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
# Bumped when the saved format changes: an older copy is then downloaded again
DATA_FORMAT = 1

_DATA_KEY = "dictionary"


def _store(hass: HomeAssistant) -> Store[dict]:
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.dictionary")


def get_dictionary(hass: HomeAssistant) -> ContarinaDictionary:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if (dictionary := domain_data.get(_DATA_KEY)) is None:
        dictionary = domain_data[_DATA_KEY] = ContarinaDictionary(hass)
    return dictionary


async def async_remove_dictionary(hass: HomeAssistant) -> None:
    """Delete the saved dictionary (when the last entry is removed)."""
    hass.data.get(DOMAIN, {}).pop(_DATA_KEY, None)
    await _store(hass).async_remove()


class ContarinaDictionary:
    """{"downloaded": ISO UTC, "format", "items": [...]} (see waste_search.parse_dictionary)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = _store(hass)
        self._data: dict | None = None
        self._loaded = False
        self._lock = asyncio.Lock()

    async def async_get(self) -> dict:
        """The dictionary, downloaded again if it isn't from today."""
        async with self._lock:
            if not self._loaded:
                saved = await self._store.async_load()
                self._data = saved if saved and saved.get("format") == DATA_FORMAT else None
                self._loaded = True
            if self._data is None or not self._from_today(self._data):
                try:
                    self._data = await self._download()
                    await self._store.async_save(self._data)
                    _LOGGER.debug("Waste dictionary downloaded: %d items", len(self._data["items"]))
                except (ClientError, TimeoutError, ValueError) as err:
                    if self._data is None:
                        raise HomeAssistantError(
                            translation_domain=DOMAIN, translation_key="search_failed"
                        ) from err
                    _LOGGER.warning("Waste dictionary download failed (%s), using the saved copy", err)
            return self._data

    async def _download(self) -> dict:
        session = async_get_clientsession(self.hass)
        async with asyncio.timeout(30):
            resp = await session.get(
                SEARCH_URL,
                params=DICTIONARY_PARAMS,
                headers={"X-Requested-With": "XMLHttpRequest"},
            )
            resp.raise_for_status()
            results = await resp.json(content_type=None)
        items = parse_dictionary(results)
        if not items:
            raise ValueError("empty waste dictionary")
        return {"downloaded": dt_util.utcnow().isoformat(), "format": DATA_FORMAT, "items": items}

    @staticmethod
    def _from_today(data: dict) -> bool:
        downloaded = dt_util.parse_datetime(data.get("downloaded") or "")
        return downloaded is not None and dt_util.as_local(downloaded).date() == dt_util.now().date()
