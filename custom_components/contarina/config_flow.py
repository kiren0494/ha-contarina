"""Config flow for Contarina integration.

Setup: one short page (municipality, name, EcoCentro, calendar); ticking "more options"
goes on to the optional pages (emptyings, sidebar, reminders) one after the other.
Options: a menu with the same four groups, each saved on its own.
"""

from __future__ import annotations

from datetime import time

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TimeSelector,
)
from homeassistant.util import dt as dt_util, slugify

from .const import (
    CONF_BIN_LITERS,
    CONF_CALENDAR,
    CONF_ECOCENTER,
    CONF_HOUSEHOLD_MEMBERS,
    CONF_PANEL,
    CONF_REMINDER_DAYS,
    CONF_REMINDER_NOTIFY,
    CONF_REMINDER_TIME,
    CONF_SIDEBAR_PICKUPS,
    DEFAULT_REMINDER_DAYS,
    DEFAULT_REMINDER_TIME,
    DOMAIN,
    NOTIFY_HA,
    NOTIFY_LAST_USED,
    REMINDER_LATEST_HOUR,
    REMINDER_MAX_DAYS,
    STANDARD_BIN_LITERS,
)
from .const import MUNICIPALITIES

MUNICIPALITIES = dict(sorted(MUNICIPALITIES.items()))

# Setup only: go on to the optional pages (not saved)
CONF_MORE_OPTIONS = "more_options"

# Plain number boxes (a bare int range renders as a slider); the selector returns floats
HOUSEHOLD_MEMBERS = vol.All(
    NumberSelector(NumberSelectorConfig(min=1, max=20, step=1, mode=NumberSelectorMode.BOX)),
    vol.Coerce(int),
)
BIN_LITERS = vol.All(
    NumberSelector(
        NumberSelectorConfig(
            min=10, max=1100, step=1, mode=NumberSelectorMode.BOX, unit_of_measurement="L"
        )
    ),
    vol.Coerce(int),
)
REMINDER_DAYS = vol.All(
    NumberSelector(
        NumberSelectorConfig(min=0, max=REMINDER_MAX_DAYS, step=1, mode=NumberSelectorMode.BOX)
    ),
    vol.Coerce(int),
)


# --- Schemas, shared by the setup and the options (`current` = the values to show) ------


def _general_schema(current: dict) -> dict:
    return {
        vol.Optional(CONF_ECOCENTER, default=current.get(CONF_ECOCENTER, True)): bool,
        vol.Optional(CONF_CALENDAR, default=bool(current.get(CONF_CALENDAR))): bool,
    }


def _emptyings_schema(current: dict) -> vol.Schema:
    return vol.Schema(
        {
            # Empty = no residual emptyings tracking; suggested_value instead of default,
            # so the field can be cleared
            vol.Optional(
                CONF_HOUSEHOLD_MEMBERS,
                description={"suggested_value": current.get(CONF_HOUSEHOLD_MEMBERS)},
            ): HOUSEHOLD_MEMBERS,
            vol.Optional(
                CONF_BIN_LITERS, default=current.get(CONF_BIN_LITERS) or STANDARD_BIN_LITERS
            ): BIN_LITERS,
        }
    )


def _sidebar_schema(current: dict) -> vol.Schema:
    return vol.Schema(
        {
            vol.Optional(CONF_PANEL, default=bool(current.get(CONF_PANEL))): bool,
            vol.Optional(
                CONF_SIDEBAR_PICKUPS, default=bool(current.get(CONF_SIDEBAR_PICKUPS))
            ): bool,
        }
    )


def _notify_options(hass: HomeAssistant, current: str) -> list[SelectOptionDict]:
    """Reminder targets: last used, HA notifications, then the notify services.

    The Companion app's mobile_app_<device> services get the device's name (the service
    name is the slug of the name the app registered). The fixed values and notify.notify
    (all the app's devices) are translated through the selector's translation_key.
    """
    names = {}
    for device in dr.async_get(hass).devices.values():
        if device.name and any(domain == "mobile_app" for domain, _ in device.identifiers):
            names[slugify(device.name)] = (device.name_by_user or device.name).strip()
    services = sorted(
        (
            service
            for service in hass.services.async_services_for_domain("notify")
            if service not in ("send_message", NOTIFY_HA)
        ),
        key=lambda service: (not service.startswith("mobile_app_"), service),
    )
    if current not in (NOTIFY_LAST_USED, NOTIFY_HA, *services):
        # The saved device is gone: kept, so that the form still validates
        services.append(current)
    return [
        SelectOptionDict(value=NOTIFY_LAST_USED, label=NOTIFY_LAST_USED),
        SelectOptionDict(value=NOTIFY_HA, label=NOTIFY_HA),
        *(
            SelectOptionDict(
                value=service,
                label=names.get(service.removeprefix("mobile_app_"), service),
            )
            for service in services
        ),
    ]


def _reminders_schema(hass: HomeAssistant, current: dict) -> vol.Schema:
    days = current.get(CONF_REMINDER_DAYS)
    notify = current.get(CONF_REMINDER_NOTIFY) or NOTIFY_LAST_USED
    return vol.Schema(
        {
            vol.Optional(
                CONF_REMINDER_DAYS, default=DEFAULT_REMINDER_DAYS if days is None else days
            ): REMINDER_DAYS,
            vol.Optional(
                CONF_REMINDER_TIME,
                default=current.get(CONF_REMINDER_TIME) or DEFAULT_REMINDER_TIME,
            ): TimeSelector(),
            vol.Optional(CONF_REMINDER_NOTIFY, default=notify): SelectSelector(
                SelectSelectorConfig(
                    options=_notify_options(hass, notify),
                    mode=SelectSelectorMode.DROPDOWN,
                    translation_key=CONF_REMINDER_NOTIFY,
                )
            ),
        }
    )


def _reminder_errors(data: dict) -> dict[str, str]:
    """On the pickup day itself (0 days before) the reminder is at the latest at 6:00."""
    days = data.get(CONF_REMINDER_DAYS, DEFAULT_REMINDER_DAYS)
    at = dt_util.parse_time(str(data.get(CONF_REMINDER_TIME) or DEFAULT_REMINDER_TIME))
    if at is None:
        return {CONF_REMINDER_TIME: "invalid_reminder_time"}
    if days == 0 and at > time(REMINDER_LATEST_HOUR):
        return {CONF_REMINDER_TIME: "reminder_time_too_late"}
    return {}


USER_SCHEMA = {
    # custom_value turns the long dropdown into a searchable picker; the typed text is
    # then checked in the step
    vol.Required("municipality"): SelectSelector(
        SelectSelectorConfig(
            options=list(MUNICIPALITIES),
            custom_value=True,
            mode=SelectSelectorMode.DROPDOWN,
        )
    ),
    vol.Optional("name"): str,
    **_general_schema({}),
    vol.Optional(CONF_MORE_OPTIONS, default=False): bool,
}


def _location(data: dict) -> str:
    """Name shown in the device and sensors (same rule as the coordinator)."""
    return data.get("name") or data["municipality"]


def _match_municipality(text: str) -> str | None:
    """The municipality picked or typed (case and spaces ignored), None if unknown."""
    wanted = " ".join(str(text or "").split()).casefold()
    return next((name for name in MUNICIPALITIES if name.casefold() == wanted), None)


class ContarinaConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Contarina."""

    VERSION = 1

    def __init__(self) -> None:
        self._pending: dict = {}
        self._more_options = False

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        return ContarinaOptionsFlow()

    async def async_step_user(self, user_input=None) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}
        if user_input is not None:
            # user_input is kept as is to refill the form after an error
            data = dict(user_input)
            more_options = bool(data.pop(CONF_MORE_OPTIONS, False))
            data.pop("name", None)
            if name := (user_input.get("name") or "").strip():
                data["name"] = name

            existing = [entry.data for entry in self._async_current_entries()]
            municipality = _match_municipality(data["municipality"])
            if municipality is None:
                # Free text not matching any municipality
                errors["municipality"] = "unknown_municipality"
            else:
                data["municipality"] = municipality
                location = _location(data).casefold()
                if any(_location(other).casefold() == location for other in existing):
                    # Same device and sensor names as an existing calendar: needs another name
                    errors["name"] = "location_in_use"

            if not errors:
                # Add the zone number matching the selected name
                data["municipality_number"] = MUNICIPALITIES[data["municipality"]]
                self._pending = data
                self._more_options = more_options
                if any(other["municipality"] == data["municipality"] for other in existing):
                    # Allowed (e.g. two households), but ask first
                    return await self.async_step_confirm_duplicate()
                return await self._async_next()

        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(vol.Schema(USER_SCHEMA), user_input),
            errors=errors,
        )

    async def async_step_confirm_duplicate(self, user_input=None) -> ConfigFlowResult:
        """Confirm another calendar for an already configured municipality."""
        if user_input is not None:
            return await self._async_next()

        municipality = self._pending["municipality"]
        names = sorted(
            _location(entry.data)
            for entry in self._async_current_entries()
            if entry.data["municipality"] == municipality
        )
        return self.async_show_form(
            step_id="confirm_duplicate",
            description_placeholders={
                "municipality": municipality,
                "names": ", ".join(f'"{name}"' for name in names),
                "location": _location(self._pending),
            },
        )

    async def _async_next(self) -> ConfigFlowResult:
        """The optional pages if asked for, else the entry with the default options."""
        if self._more_options:
            return await self.async_step_emptyings()
        return self._create_entry()

    async def async_step_emptyings(self, user_input=None) -> ConfigFlowResult:
        """Optional page 1: residual emptyings tracking."""
        if user_input is not None:
            self._pending.update(user_input)
            return await self.async_step_sidebar()
        return self.async_show_form(step_id="emptyings", data_schema=_emptyings_schema({}))

    async def async_step_sidebar(self, user_input=None) -> ConfigFlowResult:
        """Optional page 2: sidebar page and entry."""
        if user_input is not None:
            self._pending.update(user_input)
            return await self.async_step_reminders()
        return self.async_show_form(step_id="sidebar", data_schema=_sidebar_schema({}))

    async def async_step_reminders(self, user_input=None) -> ConfigFlowResult:
        """Optional page 3: reminder defaults, then the entry is created."""
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _reminder_errors(user_input)
            if not errors:
                self._pending.update(user_input)
                return self._create_entry()
        return self.async_show_form(
            step_id="reminders",
            data_schema=self.add_suggested_values_to_schema(
                _reminders_schema(self.hass, {}), user_input
            ),
            errors=errors,
        )

    @callback
    def _create_entry(self) -> ConfigFlowResult:
        return self.async_create_entry(title=self._pending["municipality"], data=self._pending)


class ContarinaOptionsFlow(config_entries.OptionsFlow):
    """A menu of the option groups, each saved on its own (the entry is then reloaded)."""

    @property
    def _current(self) -> dict:
        return {**self.config_entry.data, **self.config_entry.options}

    @callback
    def _save(self, user_input: dict) -> ConfigFlowResult:
        # The options are replaced as a whole: keep the other groups' values
        return self.async_create_entry(data={**self.config_entry.options, **user_input})

    async def async_step_init(self, user_input=None) -> ConfigFlowResult:
        return self.async_show_menu(
            step_id="init", menu_options=["general", "emptyings", "sidebar", "reminders"]
        )

    async def async_step_general(self, user_input=None) -> ConfigFlowResult:
        """EcoCentro sensor and calendar entity."""
        if user_input is not None:
            return self._save(user_input)
        return self.async_show_form(
            step_id="general", data_schema=vol.Schema(_general_schema(self._current))
        )

    async def async_step_emptyings(self, user_input=None) -> ConfigFlowResult:
        """Residual emptyings tracking."""
        if user_input is not None:
            # Store a cleared field too, so it overrides the value from the setup data
            return self._save({CONF_HOUSEHOLD_MEMBERS: None, **user_input})
        return self.async_show_form(
            step_id="emptyings", data_schema=_emptyings_schema(self._current)
        )

    async def async_step_sidebar(self, user_input=None) -> ConfigFlowResult:
        """Sidebar page and entry."""
        if user_input is not None:
            return self._save(user_input)
        return self.async_show_form(step_id="sidebar", data_schema=_sidebar_schema(self._current))

    async def async_step_reminders(self, user_input=None) -> ConfigFlowResult:
        """Reminder defaults."""
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _reminder_errors(user_input)
            if not errors:
                return self._save(user_input)
        return self.async_show_form(
            step_id="reminders",
            data_schema=self.add_suggested_values_to_schema(
                _reminders_schema(self.hass, self._current), user_input
            ),
            errors=errors,
        )
