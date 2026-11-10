"""EcoCentri opening hours: one download a day, shared by all the entries."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from aiohttp import ClientError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .ecocenter_pages import HOURS_URL, MAP_URL, build_centers, parse_closures

_LOGGER = logging.getLogger(__name__)

UPDATE_INTERVAL = timedelta(hours=6)
DOWNLOAD_MAX_AGE = timedelta(days=1)

STORAGE_VERSION = 1
# Bumped when the parsed format changes: an older saved copy is then downloaded again
DATA_FORMAT = 2  # 2: addresses start with a capital letter

_DATA_KEY = "ecocenters"
_LOCK_KEY = "ecocenters_lock"


def _store(hass: HomeAssistant) -> Store[dict]:
    """The parsed pages, in .storage/contarina.ecocenters."""
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.ecocenters")


async def async_get_ecocenters(hass: HomeAssistant) -> ContarinaEcocenters:
    """The shared coordinator, created (and loaded) by the first entry that needs it."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    async with domain_data.setdefault(_LOCK_KEY, asyncio.Lock()):
        if (ecocenters := domain_data.get(_DATA_KEY)) is None:
            ecocenters = ContarinaEcocenters(hass)
            # A failure must not stop the entry: its sensors just stay unavailable
            await ecocenters.async_refresh()
            domain_data[_DATA_KEY] = ecocenters
    return ecocenters


def get_ecocenters(hass: HomeAssistant) -> ContarinaEcocenters | None:
    """The shared coordinator, if an entry has created it."""
    return hass.data.get(DOMAIN, {}).get(_DATA_KEY)


async def async_remove_ecocenters(hass: HomeAssistant) -> None:
    """Delete the saved pages (when the last entry is removed)."""
    hass.data.get(DOMAIN, {}).pop(_DATA_KEY, None)
    await _store(hass).async_remove()


class ContarinaEcocenters(DataUpdateCoordinator[dict]):
    """Data: {"downloaded", "format", "notice", "centers": [...]} (see ecocenter_pages)."""

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_ecocenters",
            update_interval=UPDATE_INTERVAL,
            config_entry=None,
        )
        self._store = _store(hass)

    @property
    def closures(self) -> dict | None:
        """The extraordinary closures of the notice, if understood (see parse_closures)."""
        return parse_closures((self.data or {}).get("notice"), dt_util.now().date())

    def centers_for(self, municipality: str) -> list[dict]:
        """Centers of a municipality ("Treviso - centro storico" -> those of Treviso)."""
        name = municipality.split(" - ")[0]
        return [c for c in (self.data or {}).get("centers", []) if c["municipality"] == name]

    async def _async_update_data(self) -> dict:
        saved = await self._store.async_load()
        if saved is not None and saved.get("format") != DATA_FORMAT:
            saved = None
        if saved is None or self._is_stale(saved):
            try:
                saved = await self._download()
                await self._store.async_save(saved)
                _LOGGER.debug("EcoCentri opening hours downloaded")
            except (ClientError, TimeoutError, ValueError) as err:
                if saved is None:
                    raise UpdateFailed(f"EcoCentri download failed: {err}") from err
                _LOGGER.warning("EcoCentri download failed (%s), using the saved copy", err)
        return saved

    async def _download(self) -> dict:
        hours_page = await self._fetch(HOURS_URL)
        try:
            map_page = await self._fetch(MAP_URL)
        except (ClientError, TimeoutError) as err:
            # Only the coordinates come from the map: go on without them
            _LOGGER.debug("EcoCentri map download failed: %s", err)
            map_page = None
        data = await self.hass.async_add_executor_job(build_centers, hours_page, map_page)
        if not data["centers"]:
            raise ValueError("no EcoCentri found in the page")
        return {"downloaded": dt_util.utcnow().isoformat(), "format": DATA_FORMAT, **data}

    async def _fetch(self, url: str) -> str:
        session = async_get_clientsession(self.hass)
        async with asyncio.timeout(30):
            resp = await session.get(url)
            resp.raise_for_status()
            return (await resp.read()).decode("utf-8", errors="replace")

    @staticmethod
    def _is_stale(saved: dict) -> bool:
        downloaded = dt_util.parse_datetime(saved.get("downloaded") or "")
        return downloaded is None or dt_util.utcnow() - downloaded > DOWNLOAD_MAX_AGE
