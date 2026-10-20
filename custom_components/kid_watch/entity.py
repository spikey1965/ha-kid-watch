"""Shared base for Kid Watch entities: one device per child."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import C_ID, C_NAME, DOMAIN, VERSION
from .coordinator import KidWatchCoordinator


class KidWatchEntity(CoordinatorEntity[KidWatchCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: KidWatchCoordinator, child: dict[str, Any], key: str) -> None:
        super().__init__(coordinator)
        self.cid = child[C_ID]
        entry_id = coordinator.config_entry.entry_id
        self._attr_unique_id = f"{entry_id}_{self.cid}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry_id}_{self.cid}")},
            name=child[C_NAME],
            manufacturer="Kid Watch",
            model="Child",
            sw_version=VERSION,
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def snap(self) -> dict[str, Any]:
        return (self.coordinator.data or {}).get(self.cid, {})

    @property
    def available(self) -> bool:
        return super().available and self.cid in (self.coordinator.data or {})
