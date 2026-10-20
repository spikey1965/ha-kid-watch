"""Kid Watch: what each child is watching and browsing, with AdGuard Home controls."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .adguard import AdGuardClient
from .const import (
    C_ID,
    CONF_CHILDREN,
    CONF_HOST,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_SSL,
    CONF_USERNAME,
    CONF_VERIFY_SSL,
    DOMAIN,
    PLATFORMS,
    VERSION,
)
from .coordinator import KidWatchCoordinator

CARD_URL = f"/{DOMAIN}/kid-watch-card.js"

type KidWatchConfigEntry = ConfigEntry[KidWatchCoordinator]


def make_api(hass: HomeAssistant, data: dict) -> AdGuardClient:
    return AdGuardClient(
        async_get_clientsession(hass, verify_ssl=data.get(CONF_VERIFY_SSL, True)),
        data[CONF_HOST],
        data[CONF_PORT],
        data.get(CONF_SSL, False),
        data.get(CONF_VERIFY_SSL, True),
        data.get(CONF_USERNAME),
        data.get(CONF_PASSWORD),
    )


async def _register_card(hass: HomeAssistant) -> None:
    """Serve the dashboard card from the integration, so one install gives both."""
    if hass.data.get(f"{DOMAIN}_card"):
        return
    hass.data[f"{DOMAIN}_card"] = True
    path = Path(__file__).parent / "frontend" / "kid-watch-card.js"
    await hass.http.async_register_static_paths([StaticPathConfig(CARD_URL, str(path), True)])
    add_extra_js_url(hass, f"{CARD_URL}?v={VERSION}")


async def async_setup_entry(hass: HomeAssistant, entry: KidWatchConfigEntry) -> bool:
    await _register_card(hass)
    coordinator = KidWatchCoordinator(hass, entry, make_api(hass, dict(entry.data)))
    await coordinator.async_setup()
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    # children removed in Configure leave no empty devices behind
    reg = dr.async_get(hass)
    keep = {(DOMAIN, f"{entry.entry_id}_{c[C_ID]}") for c in entry.options.get(CONF_CHILDREN, [])}
    for device in dr.async_entries_for_config_entry(reg, entry.entry_id):
        if not device.identifiers & keep:
            reg.async_update_device(device.id, remove_config_entry_id=entry.entry_id)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: KidWatchConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        await entry.runtime_data.async_shutdown()
    return ok
