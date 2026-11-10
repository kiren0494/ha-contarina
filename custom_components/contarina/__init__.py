"""Contarina waste collection calendars for Home Assistant."""

import asyncio
import hashlib
from datetime import timedelta
from pathlib import Path

import voluptuous as vol

from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.frontend import add_extra_js_url, async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.sensor import DOMAIN as SENSOR_DOMAIN
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import service
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .const import (
    CONF_PANEL,
    CONF_SIDEBAR_PICKUPS,
    DOMAIN,
    PICKUP_DONE_HOUR,
    WASTE_ICONS,
    WASTE_TYPES,
)
from .coordinator import ContarinaCoordinator, async_remove_calendar, async_waste_names
from .ecocenter_pages import is_holiday, opening_status
from .ecocenters import async_remove_ecocenters, get_ecocenters
from .emptyings import async_remove_store
from .reminders import ContarinaReminders, async_remove_reminders_store
from .waste_dictionary import async_remove_dictionary, get_dictionary
from .waste_search import search

PLATFORMS = ["calendar", "sensor"]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

WWW_DIR = Path(__file__).parent / "www"
CARD_URL = f"/{DOMAIN}/contarina-card.js"
CARD_PATH = WWW_DIR / "contarina-card.js"
PANEL_URL = f"/{DOMAIN}/contarina-panel.js"
PANEL_PATH = WWW_DIR / "contarina-panel.js"
# Leaflet 1.9.4 (BSD-2), for the EcoCentri map of the sidebar page
LEAFLET_URL = f"/{DOMAIN}/leaflet"
LEAFLET_DIR = WWW_DIR / "leaflet"
# Sidebar page: /contarina
PANEL_URL_PATH = DOMAIN

_PANEL_MODULE_KEY = "panel_module"
# (title, icon) of the registered sidebar entry, None without the page
_PANEL_REGISTERED_KEY = "panel_registered"
_PANEL_LOCK_KEY = "panel_lock"
# Entries set up (and not unloaded yet): the entry being set up isn't LOADED yet
_ACTIVE_ENTRIES_KEY = "active_entries"
PANEL_ICON = "mdi:recycle"
# Sidebar entry with tomorrow's pickups of several types
PANEL_ICON_SEVERAL = "mdi:delete-clock"


def _file_version(path: Path) -> str:
    """Short hash of a file: changes whenever the file does."""
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register the Lovelace card, the panel files and the services (once, at startup)."""
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(CARD_URL, str(CARD_PATH), True),
            StaticPathConfig(PANEL_URL, str(PANEL_PATH), True),
            StaticPathConfig(LEAFLET_URL, str(LEAFLET_DIR), True),
        ]
    )
    # The ?v= forces the browser to reload the files when they change
    card_version = await hass.async_add_executor_job(_file_version, CARD_PATH)
    add_extra_js_url(hass, f"{CARD_URL}?v={card_version}")
    panel_version = await hass.async_add_executor_job(_file_version, PANEL_PATH)
    hass.data.setdefault(DOMAIN, {})[_PANEL_MODULE_KEY] = f"{PANEL_URL}?v={panel_version}"
    websocket_api.async_register_command(hass, _ws_pickups)
    websocket_api.async_register_command(hass, _ws_ecocenters)

    service.async_register_platform_entity_service(
        hass,
        DOMAIN,
        "add_emptying",
        entity_domain=SENSOR_DOMAIN,
        schema={vol.Optional("date"): cv.date},
        func="async_add_emptying",
    )
    service.async_register_platform_entity_service(
        hass,
        DOMAIN,
        "remove_emptying",
        entity_domain=SENSOR_DOMAIN,
        schema={vol.Required("date"): cv.date},
        func="async_remove_emptying",
    )
    service.async_register_platform_entity_service(
        hass,
        DOMAIN,
        "add_reminder",
        entity_domain=SENSOR_DOMAIN,
        schema={
            # Without "at"/"notify": the entry's reminder defaults
            vol.Optional("at"): cv.datetime,
            vol.Optional("date"): cv.date,
            vol.Optional("notify"): vol.Any(None, cv.string),
        },
        func="async_add_reminder",
    )
    service.async_register_platform_entity_service(
        hass,
        DOMAIN,
        "remove_reminder",
        entity_domain=SENSOR_DOMAIN,
        schema={vol.Required("date"): cv.date},
        func="async_remove_reminder",
    )

    async def _async_search_waste(call: ServiceCall) -> ServiceResponse:
        """Where an item goes, from the waste dictionary of contarina.it (saved daily)."""
        dictionary = await get_dictionary(hass).async_get()
        language = call.data.get("language") or hass.config.language
        return {
            "results": search(
                dictionary["items"], call.data["query"], language, call.data["limit"]
            ),
            # When the dictionary was downloaded from contarina.it
            "updated": dictionary["downloaded"],
        }

    hass.services.async_register(
        DOMAIN,
        "search_waste",
        _async_search_waste,
        schema=vol.Schema(
            {
                vol.Required("query"): vol.All(cv.string, vol.Strip, vol.Length(min=2)),
                vol.Optional("limit", default=10): vol.All(vol.Coerce(int), vol.Range(1, 50)),
                # Names in English unless Italian (default: Home Assistant's language)
                vol.Optional("language"): cv.string,
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Contarina from a config entry."""
    await _async_migrate_unique_ids(hass, entry)

    coordinator = ContarinaCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    coordinator.reminders = ContarinaReminders(hass, coordinator)
    await coordinator.reminders.async_load()
    entry.async_on_unload(coordinator.reminders.async_unload)

    # The remaining days change at midnight, the next pickup moves on at midday:
    # recompute right away
    async def _scheduled_refresh(now) -> None:
        await coordinator.async_refresh()

    entry.async_on_unload(
        async_track_time_change(
            hass, _scheduled_refresh, hour=[0, PICKUP_DONE_HOUR], minute=0, second=5
        )
    )
    # Options changed (emptyings tracking): reload to add/remove the sensor
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    hass.data.setdefault(DOMAIN, {}).setdefault(_ACTIVE_ENTRIES_KEY, set()).add(entry.entry_id)
    await _async_update_panel(hass)
    # The sidebar entry follows tomorrow's pickups (refreshed at midnight and midday)
    entry.async_on_unload(
        coordinator.async_add_listener(
            lambda: hass.async_create_task(_async_update_panel(hass), eager_start=True)
        )
    )
    return True


@websocket_api.websocket_command(
    {vol.Required("type"): "contarina/pickups", vol.Required("entry_id"): str}
)
@callback
def _ws_pickups(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Every pickup of a calendar, for the month view of the sidebar page."""
    entry = hass.config_entries.async_get_entry(msg["entry_id"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Calendar not found")
        return
    coordinator: ContarinaCoordinator = entry.runtime_data
    connection.send_result(
        msg["id"],
        {
            "pickups": [
                {"date": day.isoformat(), "types": types} for day, types in coordinator.all_pickups
            ]
        },
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "contarina/ecocenters", vol.Optional("entry_id"): str}
)
@callback
def _ws_ecocenters(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Every EcoCentro with its current status, for the map of the sidebar page.

    Each center is shaped like the EcoCentro sensor ({"state", "attributes"}), so the
    page draws it like the card does; "own" marks those of the given entry's municipality.
    """
    ecocenters = get_ecocenters(hass)
    if ecocenters is None or not ecocenters.data:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "EcoCentri not loaded")
        return
    own: set[tuple[str, str]] = set()
    entry = hass.config_entries.async_get_entry(msg.get("entry_id", ""))
    if entry is not None and entry.domain == DOMAIN and entry.state is ConfigEntryState.LOADED:
        own = {
            (c["municipality"], c["address"])
            for c in ecocenters.centers_for(entry.runtime_data.municipality_name)
        }

    now = dt_util.now()
    week = [now.date() + timedelta(days=offset) for offset in range(7)]
    holidays = [day.isoformat() for day in week if is_holiday(day)]
    closures = ecocenters.closures
    centers = []
    for center in ecocenters.data["centers"]:
        status = opening_status(center["hours"], now, closures)
        centers.append(
            {
                "state": status["state"],
                "own": (center["municipality"], center["address"]) in own,
                "attributes": {
                    "municipality": center["municipality"],
                    "address": center["address"],
                    "opening_hours": center["hours"],
                    "open_until": status["until"].isoformat() if status["until"] else None,
                    "next_opening": (
                        status["next_opening"].isoformat() if status["next_opening"] else None
                    ),
                    "note": center["note"],
                    "holidays": holidays,
                    "closures": closures,
                    "latitude": center["latitude"],
                    "longitude": center["longitude"],
                },
            }
        )
    connection.send_result(
        msg["id"],
        {"notice": ecocenters.data.get("notice"), "closures": closures, "centers": centers},
    )


async def _async_sidebar_entry(hass: HomeAssistant) -> tuple[str, str] | None:
    """Title and icon of the sidebar entry, None if no calendar wants the page.

    With "tomorrow's pickups in the sidebar" the entry becomes e.g. "Contarina · Organic,
    Paper" (with the waste's icon, if only one) from the day before the pickup until it's
    over at midday, like the "Next pickup" sensor.
    """
    domain_data = hass.data.get(DOMAIN, {})
    active = domain_data.get(_ACTIVE_ENTRIES_KEY, set())
    wanted = False
    soon: set[str] = set()
    today = dt_util.now().date()
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.entry_id not in active:
            continue
        settings = {**entry.data, **entry.options}
        if settings.get(CONF_PANEL) or settings.get(CONF_SIDEBAR_PICKUPS):
            wanted = True
        if settings.get(CONF_SIDEBAR_PICKUPS):
            coordinator: ContarinaCoordinator = entry.runtime_data
            pickup = coordinator.next_pickup()
            if pickup and (pickup[0] - today).days <= 1:
                soon.update(pickup[1])
    if not wanted:
        return None
    if not soon:
        return "Contarina", PANEL_ICON
    types = [waste for waste in WASTE_TYPES if waste in soon]
    names = await async_waste_names(hass)
    title = "Contarina · " + ", ".join(names[waste] for waste in types)
    return title, WASTE_ICONS[types[0]] if len(types) == 1 else PANEL_ICON_SEVERAL


async def _async_update_panel(hass: HomeAssistant) -> None:
    """Show the sidebar page if a set-up entry asks for it, remove it otherwise."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    async with domain_data.setdefault(_PANEL_LOCK_KEY, asyncio.Lock()):
        wanted = await _async_sidebar_entry(hass)
        registered = domain_data.get(_PANEL_REGISTERED_KEY)
        if wanted == registered:
            return
        # A panel can't be registered twice: a new title or icon means remove and add again
        if registered:
            async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
            domain_data[_PANEL_REGISTERED_KEY] = None
        if wanted:
            title, icon = wanted
            await panel_custom.async_register_panel(
                hass,
                frontend_url_path=PANEL_URL_PATH,
                webcomponent_name="contarina-panel",
                sidebar_title=title,
                sidebar_icon=icon,
                module_url=domain_data[_PANEL_MODULE_KEY],
                require_admin=False,
            )
            domain_data[_PANEL_REGISTERED_KEY] = wanted

async def _async_migrate_unique_ids(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Migrate old unique_ids to "<entry_id>_<english type>".

    Old formats: "contarina_Contarina <name> Umido_Umido" (collided for two entries
    of the same municipality without a custom name) and "<entry_id>_Umido".
    """

    @callback
    def _migrate(entity_entry: er.RegistryEntry) -> dict | None:
        # The last part is the Italian type; if it's already the English one, nothing matches
        old_waste = entity_entry.unique_id.rsplit("_", 1)[-1].lower()
        for waste, keyword in WASTE_TYPES.items():
            if keyword == old_waste:
                return {"new_unique_id": f"{entry.entry_id}_{waste}"}
        return None

    await er.async_migrate_entries(hass, entry.entry_id, _migrate)

async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data.get(DOMAIN, {}).get(_ACTIVE_ENTRIES_KEY, set()).discard(entry.entry_id)
        await _async_update_panel(hass)
    return unloaded

async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete the stored emptyings and reminders and, unless other entries still use them,
    the calendar and the EcoCentri opening hours."""
    await async_remove_store(hass, entry.entry_id)
    await async_remove_reminders_store(hass, entry.entry_id)

    others = [
        other
        for other in hass.config_entries.async_entries(DOMAIN)
        if other.entry_id != entry.entry_id
    ]
    if not others:
        await async_remove_ecocenters(hass)
        await async_remove_dictionary(hass)

    zone = entry.data["municipality_number"]
    if not any(other.data.get("municipality_number") == zone for other in others):
        await async_remove_calendar(hass, zone)
