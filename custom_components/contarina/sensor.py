from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import (
    CONF_BIN_LITERS,
    CONF_ECOCENTER,
    CONF_HOUSEHOLD_MEMBERS,
    DOMAIN,
    STANDARD_BIN_LITERS,
    WASTE_TYPES,
)
from .coordinator import ContarinaCoordinator, async_waste_names
from .ecocenter_pages import is_holiday, opening_status
from .ecocenters import ContarinaEcocenters, async_get_ecocenters
from .emptyings import ContarinaEmptyings

_LOGGER = logging.getLogger(__name__)

# add_reminder called without "notify": the entry's default (None = HA notifications)
_DEFAULT: Any = object()


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up Contarina sensor from config entry."""
    coordinator: ContarinaCoordinator = entry.runtime_data
    entities: list[SensorEntity] = [
        ContarinaSensor(coordinator, entry, waste) for waste in WASTE_TYPES
    ]

    # Short waste names in the HA language for the "next pickup" state (e.g. "VPL, Umido")
    names = await async_waste_names(hass)
    entities.append(ContarinaNextPickupSensor(coordinator, entry, names))

    # Options override the setup data, also when they clear the household members
    settings = {**entry.data, **entry.options}
    if settings.get(CONF_HOUSEHOLD_MEMBERS):
        emptyings = ContarinaEmptyings(
            hass,
            entry.entry_id,
            settings[CONF_HOUSEHOLD_MEMBERS],
            settings.get(CONF_BIN_LITERS) or STANDARD_BIN_LITERS,
        )
        await emptyings.async_load()
        entities.append(ContarinaEmptyingsSensor(coordinator, entry, emptyings))
    else:
        # Tracking turned off: drop the leftover entity (the dates stay stored)
        registry = er.async_get(hass)
        unique_id = ContarinaEmptyingsSensor.unique_id_for(entry)
        if entity_id := registry.async_get_entity_id("sensor", DOMAIN, unique_id):
            registry.async_remove(entity_id)

    if settings.get(CONF_ECOCENTER, True):
        ecocenters = await async_get_ecocenters(hass)
        centers = ecocenters.centers_for(coordinator.municipality_name)
        if not centers and ecocenters.data:
            # Every municipality is listed today: the page has probably changed
            _LOGGER.warning(
                "No EcoCentro found for %s on contarina.it: the EcoCentro sensor is not created",
                coordinator.municipality_name,
            )
        entities.extend(
            ContarinaEcocenterSensor(coordinator, entry, ecocenters, index, center, len(centers) > 1)
            for index, center in enumerate(centers)
        )
    else:
        # Turned off: drop the EcoCentro entities
        registry = er.async_get(hass)
        prefix = ContarinaEcocenterSensor.unique_id_for(entry, 0)
        for entity_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
            if entity_entry.domain == "sensor" and entity_entry.unique_id.startswith(prefix):
                registry.async_remove(entity_entry.entity_id)

    async_add_entities(entities)


class ContarinaEntity(CoordinatorEntity[ContarinaCoordinator], SensorEntity):
    """Base entity: one device per calendar, translated entity names."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: ContarinaCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry_id = entry.entry_id
        self._attr_device_info = coordinator.device_info

    def _base_attributes(self) -> dict:
        return {
            "location": self.coordinator.location,
            "municipality_name": self.coordinator.municipality_name,
            "municipality_number": self.coordinator.municipality_number,
            "entry_id": self._entry_id,
        }

    # The emptying services target every Contarina sensor: only the emptyings one handles them
    async def async_add_emptying(self, date: date | None = None) -> None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="not_emptyings_sensor"
        )

    async def async_remove_emptying(self, date: date) -> None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="not_emptyings_sensor"
        )

    # Same for the reminders: only the waste type sensors handle them
    async def async_add_reminder(
        self, at: datetime | None = None, date: date | None = None, notify: Any = _DEFAULT
    ) -> None:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="not_waste_sensor")

    async def async_remove_reminder(self, date: date) -> None:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="not_waste_sensor")


class ContarinaSensor(ContarinaEntity):
    """Days left until the next pickup of a waste type, plus its reminders."""

    _attr_native_unit_of_measurement = UnitOfTime.DAYS
    _unrecorded_attributes = frozenset({"reminders", "reminder_defaults"})

    def __init__(self, coordinator: ContarinaCoordinator, entry: ConfigEntry, waste: str) -> None:
        super().__init__(coordinator, entry)
        self._waste = waste
        self._attr_translation_key = waste
        self._attr_unique_id = f"{entry.entry_id}_{waste}"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            self.coordinator.reminders.async_add_listener(self.async_write_ha_state)
        )

    async def async_add_reminder(
        self, at: datetime | None = None, date: date | None = None, notify: Any = _DEFAULT
    ) -> None:
        """Set a reminder for a pickup of this type (default: the next one).

        Without "at" or "notify" the entry's defaults are used; notify given as empty or
        null means Home Assistant's notifications.
        """
        reminders = self.coordinator.reminders
        day = date or self.coordinator.data.get(self._waste)
        if day is None:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_pickup")
        if at is None:
            at = reminders.default_at(day)
        if notify is _DEFAULT:
            notify = reminders.default_notify()
        await reminders.async_set(self._waste, day, at, notify)

    async def async_remove_reminder(self, date: date) -> None:
        """Remove the reminder of a pickup of this type."""
        await self.coordinator.reminders.async_remove(self._waste, date)

    @property
    def native_value(self) -> int | None:
        next_date = self.coordinator.data.get(self._waste)
        if next_date is None:
            return None
        return (next_date - dt_util.now().date()).days

    @property
    def extra_state_attributes(self):
        next_date = self.coordinator.data.get(self._waste)
        return {
            **self._base_attributes(),
            "waste": self._waste,
            "next_date": next_date.isoformat() if next_date else None,
            # [{date, at, notify}], shown with a bell on the card and the sidebar page
            "reminders": self.coordinator.reminders.for_waste(self._waste),
            # {days, time, notify}: how the popup opens
            "reminder_defaults": self.coordinator.reminders.defaults,
        }


class ContarinaNextPickupSensor(ContarinaEntity):
    """Waste types of the next pickup, e.g. "VPL, Umido": what to put out.

    No "waste" attribute, so the card doesn't list it among the waste types.
    """

    _attr_translation_key = "next_pickup"

    def __init__(
        self, coordinator: ContarinaCoordinator, entry: ConfigEntry, names: dict[str, str]
    ) -> None:
        super().__init__(coordinator, entry)
        self._names = names
        self._attr_unique_id = f"{entry.entry_id}_next_pickup"

    @property
    def native_value(self) -> str | None:
        if (pickup := self.coordinator.next_pickup()) is None:
            return None
        return ", ".join(self._names[waste] for waste in pickup[1])

    @property
    def extra_state_attributes(self):
        pickup = self.coordinator.next_pickup()
        day, types = pickup if pickup else (None, [])
        return {
            **self._base_attributes(),
            "next_date": day.isoformat() if day else None,
            "days": (day - dt_util.now().date()).days if day else None,
            "waste_types": types,
        }


class ContarinaEmptyingsSensor(ContarinaEntity):
    """Residual bin emptyings marked this year, against the yearly allowance.

    A coordinator entity only to be rewritten at the midnight refresh, so the count
    restarts on January 1st.
    """

    _attr_translation_key = "residual_emptyings"

    def __init__(
        self, coordinator: ContarinaCoordinator, entry: ConfigEntry, emptyings: ContarinaEmptyings
    ) -> None:
        super().__init__(coordinator, entry)
        self._emptyings = emptyings
        self._attr_unique_id = self.unique_id_for(entry)

    @staticmethod
    def unique_id_for(entry: ConfigEntry) -> str:
        return f"{entry.entry_id}_residual_emptyings"

    @property
    def native_value(self) -> int:
        return len(self._emptyings.dates_in(dt_util.now().year))

    @property
    def extra_state_attributes(self):
        today = dt_util.now().date()
        dates = self._emptyings.dates_in(today.year)
        total = self._emptyings.total
        # Where an even pace through the year would be today
        year_days = 366 if calendar.isleap(today.year) else 365
        expected = total * today.timetuple().tm_yday / year_days
        return {
            **self._base_attributes(),
            "emptyings_total": round(total, 1),
            "expected_by_now": round(expected, 1),
            "household_members": self._emptyings.household_members,
            "bin_liters": self._emptyings.bin_liters,
            "liters_used": len(dates) * self._emptyings.bin_liters,
            "liters_total": self._emptyings.liters_total,
            "dates": [d.isoformat() for d in dates],
        }

    async def async_add_emptying(self, date: date | None = None) -> None:
        """Mark an emptying (default today)."""
        await self._emptyings.async_add(date or dt_util.now().date())
        self.async_write_ha_state()

    async def async_remove_emptying(self, date: date) -> None:
        """Remove a marked emptying."""
        await self._emptyings.async_remove(date)
        self.async_write_ha_state()


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment else None


def _next_days(count: int) -> list[date]:
    today = dt_util.now().date()
    return [today + timedelta(days=offset) for offset in range(count)]


class ContarinaEcocenterSensor(ContarinaEntity):
    """Whether an EcoCentro of the municipality is open, with its weekly opening hours.

    No "waste" attribute, so the card doesn't list it among the waste types: it finds it
    by "opening_hours". The state changes exactly when a time slot starts or ends.
    """

    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = ["open", "booking_only", "closed"]
    # Static or bulky: kept out of the history
    _unrecorded_attributes = frozenset(
        {
            "opening_hours",
            "address",
            "note",
            "notice",
            "closures",
            "holidays",
            "latitude",
            "longitude",
        }
    )

    def __init__(
        self,
        coordinator: ContarinaCoordinator,
        entry: ConfigEntry,
        ecocenters: ContarinaEcocenters,
        index: int,
        center: dict,
        several: bool,
    ) -> None:
        super().__init__(coordinator, entry)
        self._ecocenters = ecocenters
        self._index = index
        self._attr_unique_id = self.unique_id_for(entry, index)
        if several:
            # Municipalities with two centers: the address tells them apart
            self._attr_translation_key = "ecocenter_address"
            self._attr_translation_placeholders = {"address": center["address"]}
        else:
            self._attr_translation_key = "ecocenter"
        self._unsub_change: CALLBACK_TYPE | None = None

    @staticmethod
    def unique_id_for(entry: ConfigEntry, index: int) -> str:
        return f"{entry.entry_id}_ecocenter" + (f"_{index + 1}" if index else "")

    @property
    def _center(self) -> dict | None:
        centers = self._ecocenters.centers_for(self.coordinator.municipality_name)
        return centers[self._index] if self._index < len(centers) else None

    def _status(self) -> dict | None:
        center = self._center
        if center is None:
            return None
        return opening_status(center["hours"], dt_util.now(), self._ecocenters.closures)

    @property
    def available(self) -> bool:
        return self._center is not None

    @property
    def native_value(self) -> str | None:
        status = self._status()
        return status["state"] if status else None

    @property
    def extra_state_attributes(self):
        center = self._center
        if center is None:
            return self._base_attributes()
        status = self._status()
        return {
            **self._base_attributes(),
            "address": center["address"],
            "opening_hours": center["hours"],
            "open_until": _iso(status["until"]),
            "next_opening": _iso(status["next_opening"]),
            # National holidays in the coming week (closed whatever the weekly hours say)
            "holidays": [day.isoformat() for day in _next_days(7) if is_holiday(day)],
            "note": center["note"],
            "notice": self._ecocenters.data.get("notice"),
            # The notice read into dates ({weekdays, days}), None if not understood: the
            # card writes it in the user's language and closes those days in the table
            "closures": self._ecocenters.closures,
            "latitude": center["latitude"],
            "longitude": center["longitude"],
        }

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # Also follow the shared opening hours download
        self.async_on_remove(self._ecocenters.async_add_listener(self._handle_coordinator_update))
        self.async_on_remove(self._cancel_change)
        # The first state is written without async_write_ha_state: schedule here too
        self._schedule_change()

    @callback
    def _cancel_change(self) -> None:
        if self._unsub_change:
            self._unsub_change()
            self._unsub_change = None

    @callback
    def _schedule_change(self) -> None:
        """Wake up again when the current time slot ends or the next one starts."""
        self._cancel_change()
        status = self._status()
        if status and status["next_change"]:
            self._unsub_change = async_track_point_in_time(
                self.hass, self._async_slot_changed, status["next_change"]
            )

    @callback
    def async_write_ha_state(self) -> None:
        self._schedule_change()
        super().async_write_ha_state()

    @callback
    def _async_slot_changed(self, _now) -> None:
        self._unsub_change = None
        self.async_write_ha_state()
