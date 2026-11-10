"""Contarina pickups as a calendar entity: one all-day event per pickup day."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import CONF_CALENDAR, DOMAIN
from .coordinator import ContarinaCoordinator, async_waste_names


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the Contarina calendar from a config entry, if turned on."""
    if not {**entry.data, **entry.options}.get(CONF_CALENDAR):
        # Turned off (or never turned on): drop a leftover entity
        registry = er.async_get(hass)
        unique_id = ContarinaCalendar.unique_id_for(entry)
        if entity_id := registry.async_get_entity_id("calendar", DOMAIN, unique_id):
            registry.async_remove(entity_id)
        return

    coordinator: ContarinaCoordinator = entry.runtime_data
    names = await async_waste_names(hass)
    async_add_entities([ContarinaCalendar(coordinator, entry, names)])


class ContarinaCalendar(CoordinatorEntity[ContarinaCoordinator], CalendarEntity):
    """Upcoming pickups, titled with the short waste names (e.g. "Umido, VPL").

    The ICS only holds the pickups from its download day on, so past days are not shown.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "pickups"

    def __init__(
        self, coordinator: ContarinaCoordinator, entry: ConfigEntry, names: dict[str, str]
    ) -> None:
        super().__init__(coordinator)
        self._names = names
        self._attr_unique_id = self.unique_id_for(entry)
        self._attr_device_info = coordinator.device_info

    @staticmethod
    def unique_id_for(entry: ConfigEntry) -> str:
        return f"{entry.entry_id}_pickups"

    def _event(self, day: date, types: list[str]) -> CalendarEvent:
        return CalendarEvent(
            start=day,
            end=day + timedelta(days=1),
            summary=", ".join(self._names[waste] for waste in types),
        )

    @property
    def event(self) -> CalendarEvent | None:
        """Today's pickup, otherwise the next one."""
        today = dt_util.now().date()
        for day, types in self.coordinator.pickups:
            if day >= today:
                return self._event(day, types)
        return None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Pickups overlapping the requested range."""
        return [
            self._event(day, types)
            for day, types in self.coordinator.pickups
            if dt_util.start_of_local_day(day) < end_date
            and dt_util.start_of_local_day(day + timedelta(days=1)) > start_date
        ]
