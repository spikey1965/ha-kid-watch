"""Sensors for each child: status (everything the card needs), screen time, alerts today."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import KidWatchConfigEntry
from .const import C_AGE, C_BEDTIME, C_BUDGET, C_COLOR, C_NAME, C_TVS, C_WAKE, COLORS, DOMAIN
from .entity import KidWatchEntity

_HEAVY = frozenset({"now", "timeline", "alerts", "top_sites", "tvs", "tv_entities", "by_category", "switches", "services", "devices"})


async def async_setup_entry(hass: HomeAssistant, entry: KidWatchConfigEntry, add: AddConfigEntryEntitiesCallback) -> None:
    coord = entry.runtime_data
    entities: list[SensorEntity] = []
    for child in coord.children:
        entities += [StatusSensor(coord, child), ScreenTimeSensor(coord, child), AlertsSensor(coord, child)]
    add(entities)


class StatusSensor(KidWatchEntity, SensorEntity):
    """State: what the child is doing now. Attributes: the whole day, for the card."""

    _attr_translation_key = "status"
    _unrecorded_attributes = _HEAVY

    def __init__(self, coordinator, child) -> None:
        super().__init__(coordinator, child, "status")

    @property
    def native_value(self) -> str:
        s = self.snap
        if s.get("paused"):
            return "Paused"
        now = s.get("now")
        return (now or {}).get("title", "Idle")[:255] if now else "Idle"

    @property
    def icon(self) -> str:
        s = self.snap
        if s.get("paused"):
            return "mdi:wifi-off"
        cat = (s.get("now") or {}).get("category")
        return {"tv": "mdi:television-play", "video": "mdi:play-box", "social": "mdi:chat", "gaming": "mdi:controller", "school": "mdi:school"}.get(cat, "mdi:account-child")

    def _switch_ids(self) -> dict[str, Any]:
        reg = er.async_get(self.hass)
        base = f"{self.coordinator.config_entry.entry_id}_{self.cid}_"
        find = lambda key: reg.async_get_entity_id("switch", DOMAIN, base + key)  # noqa: E731
        return {
            "pause": find("pause"), "bedtime": find("bedtime"), "safesearch": find("safesearch"), "stop_over_age": find("stop_over_age"),
            "services": {s: find(f"block_{s}") for s in self.coordinator.services},
        }

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        child = self.coordinator.child(self.cid)
        color = child.get(C_COLOR, "blue")
        return {
            "kid_watch": True,
            "child_id": self.cid,
            "child": child[C_NAME],
            "color": COLORS.get(color, color),
            "age_limit": child.get(C_AGE),
            "bedtime": str(child.get(C_BEDTIME) or "")[:5],
            "wake_time": str(child.get(C_WAKE) or "")[:5],
            "budget": int(child.get(C_BUDGET) or 0),
            "tv_entities": list(child.get(C_TVS, [])),
            **{k: v for k, v in self.snap.items() if k != "budget"},
            "switches": self._switch_ids(),
            "services": {s: self.coordinator.service_names.get(s, s) for s in self.coordinator.services},
        }


class ScreenTimeSensor(KidWatchEntity, SensorEntity):
    _attr_translation_key = "screen_time"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_state_class = SensorStateClass.TOTAL_INCREASING

    def __init__(self, coordinator, child) -> None:
        super().__init__(coordinator, child, "screen_time")

    @property
    def native_value(self) -> int:
        return int(self.snap.get("screen_time", 0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"budget": self.snap.get("budget", 0), "by_category": self.snap.get("by_category", {})}


class AlertsSensor(KidWatchEntity, SensorEntity):
    _attr_translation_key = "alerts"
    _attr_icon = "mdi:alert-circle-outline"
    _attr_state_class = SensorStateClass.TOTAL

    def __init__(self, coordinator, child) -> None:
        super().__init__(coordinator, child, "alerts")

    @property
    def native_value(self) -> int:
        return len(self.snap.get("alerts", []))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"latest": (self.snap.get("alerts") or [None])[0]}
