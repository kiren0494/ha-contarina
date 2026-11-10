"""One-off pickup reminders (set from the card or the sidebar page), stored per entry.

A reminder is for one waste type on one pickup day: at the chosen time a notification is
sent to a notify service (e.g. the Companion app) or, without one, to the Home Assistant
notifications. Then it is deleted.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from homeassistant.components import persistent_notification
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.storage import Store
from homeassistant.helpers.translation import async_get_translations
from homeassistant.util import dt as dt_util

from .const import (
    CONF_REMINDER_DAYS,
    CONF_REMINDER_NOTIFY,
    CONF_REMINDER_TIME,
    DEFAULT_REMINDER_DAYS,
    DEFAULT_REMINDER_TIME,
    DOMAIN,
    NOTIFY_HA,
    NOTIFY_LAST_USED,
    PICKUP_DONE_HOUR,
    REMINDER_LATEST_HOUR,
)
from .coordinator import ContarinaCoordinator, async_waste_names

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
# A reminder missed while Home Assistant was off is sent this long after the start, when
# the notify services (e.g. the Companion app's) are loaded
MISSED_DELAY = timedelta(minutes=1)

# Notification texts when the translations can't be read
_FALLBACK = {
    "reminder_today": "Today: {waste} pickup.",
    "reminder_tomorrow": "Tomorrow: {waste} pickup. Remember to put the bin out tonight.",
    "reminder_later": "{waste} pickup on {date}.",
}

type ReminderKey = tuple[str, date]


def _storage_key(entry_id: str) -> str:
    return f"{DOMAIN}.{entry_id}.reminders"


async def async_remove_reminders_store(hass: HomeAssistant, entry_id: str) -> None:
    """Delete an entry's reminders (when the entry is removed)."""
    await Store(hass, STORAGE_VERSION, _storage_key(entry_id)).async_remove()


def _at_hour(day: date, hour: int) -> datetime:
    return datetime.combine(day, time(hour), tzinfo=dt_util.get_default_time_zone())


class ContarinaReminders:
    """The reminders of a calendar: {(waste, pickup day): {"at", "notify"}}."""

    def __init__(self, hass: HomeAssistant, coordinator: ContarinaCoordinator) -> None:
        self.hass = hass
        self._coordinator = coordinator
        self._entry_id = coordinator.config_entry.entry_id
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, _storage_key(self._entry_id))
        self._reminders: dict[ReminderKey, dict] = {}
        self._timers: dict[ReminderKey, CALLBACK_TYPE] = {}
        self._listeners: list[Callable[[], None]] = []

    async def async_load(self) -> None:
        """Load the saved reminders and schedule them."""
        data = await self._store.async_load() or {}
        now = dt_util.now()
        dropped = False
        for item in data.get("reminders", []):
            try:
                day = date.fromisoformat(item["date"])
                at = dt_util.parse_datetime(item["at"])
                waste = item["waste"]
            except (KeyError, TypeError, ValueError):
                continue
            if at is None:
                continue
            if at <= now:
                # Missed while Home Assistant was off: still useful until the pickup is over
                if now >= _at_hour(day, PICKUP_DONE_HOUR):
                    dropped = True
                    continue
                self._reminders[(waste, day)] = {"at": at, "notify": item.get("notify")}
                self._schedule((waste, day), now + MISSED_DELAY)
            else:
                self._reminders[(waste, day)] = {"at": at, "notify": item.get("notify")}
                self._schedule((waste, day), at)
        if dropped:
            await self._async_save()

    @callback
    def async_unload(self) -> None:
        """Cancel the timers (the reminders stay saved)."""
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call `listener` whenever the reminders change."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)

    @property
    def defaults(self) -> dict:
        """The entry's reminder defaults: {days, time ("HH:MM"), notify}.

        notify is a notify service, NOTIFY_HA or NOTIFY_LAST_USED (the popup's last choice).
        """
        entry = self._coordinator.config_entry
        current = {**entry.data, **entry.options}
        days = current.get(CONF_REMINDER_DAYS)
        at = dt_util.parse_time(str(current.get(CONF_REMINDER_TIME) or DEFAULT_REMINDER_TIME))
        if at is None:
            at = dt_util.parse_time(DEFAULT_REMINDER_TIME)
        return {
            "days": DEFAULT_REMINDER_DAYS if days is None else int(days),
            "time": at.strftime("%H:%M"),
            "notify": current.get(CONF_REMINDER_NOTIFY) or NOTIFY_LAST_USED,
        }

    def default_at(self, day: date) -> datetime:
        """The default reminder time of a pickup (the flow keeps it within 6:00 that day)."""
        defaults = self.defaults
        at = dt_util.parse_time(defaults["time"])
        return datetime.combine(
            day - timedelta(days=defaults["days"]), at, tzinfo=dt_util.get_default_time_zone()
        )

    def default_notify(self) -> str | None:
        """The default notify service, None for Home Assistant's notifications."""
        notify = self.defaults["notify"]
        return None if notify in (NOTIFY_HA, NOTIFY_LAST_USED) else notify

    def for_waste(self, waste: str) -> list[dict]:
        """A waste type's reminders, by pickup day: [{date, at, notify}]."""
        return [
            {"date": day.isoformat(), "at": rem["at"].isoformat(), "notify": rem["notify"]}
            for (kind, day), rem in sorted(self._reminders.items(), key=lambda item: item[0][1])
            if kind == waste
        ]

    async def async_set(
        self, waste: str, day: date, at: datetime, notify: str | None
    ) -> None:
        """Set (or replace) the reminder of a pickup."""
        if at.tzinfo is None:
            at = at.replace(tzinfo=dt_util.get_default_time_zone())
        if not any(d == day and waste in types for d, types in self._coordinator.pickups):
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_a_pickup",
                translation_placeholders={"date": day.isoformat()},
            )
        if at > _at_hour(day, REMINDER_LATEST_HOUR):
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="reminder_too_late",
                translation_placeholders={"hour": f"{REMINDER_LATEST_HOUR}:00"},
            )
        if at <= dt_util.now():
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="reminder_in_past"
            )
        if notify:
            notify = notify.removeprefix("notify.")
            if not self.hass.services.has_service("notify", notify):
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="notify_not_found",
                    translation_placeholders={"service": f"notify.{notify}"},
                )

        key = (waste, day)
        self._cancel(key)
        self._reminders[key] = {"at": at, "notify": notify or None}
        self._schedule(key, at)
        await self._async_changed()

    async def async_remove(self, waste: str, day: date) -> None:
        """Remove the reminder of a pickup (nothing happens if there is none)."""
        key = (waste, day)
        self._cancel(key)
        if self._reminders.pop(key, None) is not None:
            await self._async_changed()

    @callback
    def _schedule(self, key: ReminderKey, at: datetime) -> None:
        @callback
        def _due(_now: datetime) -> None:
            self._timers.pop(key, None)
            self.hass.async_create_task(self._async_send(key))

        self._timers[key] = async_track_point_in_time(self.hass, _due, at)

    @callback
    def _cancel(self, key: ReminderKey) -> None:
        if cancel := self._timers.pop(key, None):
            cancel()

    async def _async_send(self, key: ReminderKey) -> None:
        reminder = self._reminders.pop(key, None)
        if reminder is None:
            return
        await self._async_changed()

        waste, day = key
        names = await async_waste_names(self.hass)
        translations = await async_get_translations(
            self.hass, self.hass.config.language, "exceptions", [DOMAIN]
        )
        offset = (day - dt_util.now().date()).days
        kind = (
            "reminder_today"
            if offset <= 0
            else "reminder_tomorrow"
            if offset == 1
            else "reminder_later"
        )
        text = translations.get(f"component.{DOMAIN}.exceptions.{kind}.message", _FALLBACK[kind])
        message = text.replace("{waste}", names.get(waste, waste)).replace(
            "{date}", day.strftime("%d/%m")
        )
        title = f"Contarina {self._coordinator.location}"

        if notify := reminder["notify"]:
            if self.hass.services.has_service("notify", notify):
                try:
                    await self.hass.services.async_call(
                        "notify", notify, {"title": title, "message": message}, blocking=True
                    )
                    return
                except HomeAssistantError as err:
                    _LOGGER.warning("Reminder not sent with notify.%s: %s", notify, err)
            else:
                _LOGGER.warning("notify.%s not found: reminder sent to the notifications", notify)
        persistent_notification.async_create(
            self.hass,
            message,
            title=title,
            notification_id=f"{DOMAIN}_{self._entry_id}_{waste}_{day.isoformat()}",
        )

    async def _async_changed(self) -> None:
        await self._async_save()
        for listener in list(self._listeners):
            listener()

    async def _async_save(self) -> None:
        await self._store.async_save(
            {
                "reminders": [
                    {
                        "waste": waste,
                        "date": day.isoformat(),
                        "at": rem["at"].isoformat(),
                        "notify": rem["notify"],
                    }
                    for (waste, day), rem in sorted(self._reminders.items())
                ]
            }
        )
