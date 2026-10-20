"""Switches for each child: pause internet, bedtime, SafeSearch, stop over-age TV, and app blocks."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import KidWatchConfigEntry
from .entity import KidWatchEntity


async def async_setup_entry(hass: HomeAssistant, entry: KidWatchConfigEntry, add: AddConfigEntryEntitiesCallback) -> None:
    coord = entry.runtime_data
    entities: list[SwitchEntity] = []
    for child in coord.children:
        entities += [PauseSwitch(coord, child), BedtimeSwitch(coord, child), SafeSearchSwitch(coord, child), OverAgeSwitch(coord, child)]
        entities += [ServiceSwitch(coord, child, s) for s in coord.services]
    add(entities)


class PauseSwitch(KidWatchEntity, SwitchEntity):
    _attr_translation_key = "pause"
    _attr_icon = "mdi:wifi-off"

    def __init__(self, coordinator, child) -> None:
        super().__init__(coordinator, child, "pause")

    @property
    def is_on(self) -> bool:
        return bool(self.snap.get("paused"))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_pause(self.cid, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_pause(self.cid, False)


class _FlagSwitch(KidWatchEntity, SwitchEntity):
    flag = ""

    def __init__(self, coordinator, child) -> None:
        super().__init__(coordinator, child, self.flag.replace("_enabled", ""))

    @property
    def is_on(self) -> bool:
        return bool(self.coordinator.flags(self.cid)[self.flag])

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_flag(self.cid, self.flag, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_flag(self.cid, self.flag, False)


class BedtimeSwitch(_FlagSwitch):
    _attr_translation_key = "bedtime"
    _attr_icon = "mdi:weather-night"
    flag = "bedtime_enabled"


class OverAgeSwitch(_FlagSwitch):
    _attr_translation_key = "stop_over_age"
    _attr_icon = "mdi:television-off"
    flag = "stop_over_age"


class SafeSearchSwitch(KidWatchEntity, SwitchEntity):
    _attr_translation_key = "safesearch"
    _attr_icon = "mdi:shield-search"

    def __init__(self, coordinator, child) -> None:
        super().__init__(coordinator, child, "safesearch")

    @property
    def is_on(self) -> bool:
        return bool(self.snap.get("safesearch"))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_safesearch(self.cid, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_safesearch(self.cid, False)


class ServiceSwitch(KidWatchEntity, SwitchEntity):
    _attr_translation_key = "block_service"
    _attr_icon = "mdi:cancel"

    def __init__(self, coordinator, child, service: str) -> None:
        super().__init__(coordinator, child, f"block_{service}")
        self.service = service
        self._attr_translation_placeholders = {"service": coordinator.service_names.get(service, service)}

    @property
    def is_on(self) -> bool:
        return bool((self.snap.get("blocked") or {}).get(self.service))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_service(self.cid, self.service, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_service(self.cid, self.service, False)
