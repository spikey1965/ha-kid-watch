"""Setup screens: connect to AdGuard Home, add children, choose alerts. Configure adds, edits and removes children."""

from __future__ import annotations

import ipaddress
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlowWithReload
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
    TimeSelector,
)
from homeassistant.util import slugify

from .adguard import AdGuardAuthError, AdGuardClient, AdGuardError
from .const import (
    ALERT_TYPES,
    C_AGE,
    C_BEDTIME,
    C_BUDGET,
    C_CLIENTS,
    C_COLOR,
    C_ID,
    C_NAME,
    C_PLEX,
    C_TVS,
    C_WAKE,
    CLIENT_IP_PREFIX,
    CLIENT_NAME_PREFIX,
    COLORS,
    CONF_ALERTS,
    CONF_CHILDREN,
    CONF_HOST,
    CONF_NOTIFY,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_SERVICES,
    CONF_SSL,
    CONF_USERNAME,
    CONF_VERIFY_SSL,
    DEFAULT_SERVICES,
    DOMAIN,
    RATINGS,
)


def _api(hass: HomeAssistant, data: dict) -> AdGuardClient:
    from . import make_api  # noqa: PLC0415 - avoids importing the frontend at flow load

    return make_api(hass, data)


def _conn_schema(d: dict) -> vol.Schema:
    return vol.Schema({
        vol.Required(CONF_HOST, default=d.get(CONF_HOST, "")): TextSelector(),
        vol.Required(CONF_PORT, default=d.get(CONF_PORT, 80)): NumberSelector(NumberSelectorConfig(min=1, max=65535, mode=NumberSelectorMode.BOX)),
        vol.Optional(CONF_USERNAME, description={"suggested_value": d.get(CONF_USERNAME)}): TextSelector(),
        vol.Optional(CONF_PASSWORD, description={"suggested_value": d.get(CONF_PASSWORD)}): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
        vol.Required(CONF_SSL, default=d.get(CONF_SSL, False)): BooleanSelector(),
        vol.Required(CONF_VERIFY_SSL, default=d.get(CONF_VERIFY_SSL, True)): BooleanSelector(),
    })


async def _test_conn(hass: HomeAssistant, data: dict) -> tuple[AdGuardClient | None, str | None]:
    api = _api(hass, data)
    try:
        await api.status()
    except AdGuardAuthError:
        return None, "invalid_auth"
    except AdGuardError:
        return None, "cannot_connect"
    return api, None


def _usable(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return True  # a ClientID or MAC
    return not (a.is_loopback or a.is_multicast or a.is_unspecified or a.is_link_local)


def _ip_sort(ip: str) -> tuple:
    try:
        a = ipaddress.ip_address(ip)
        return (a.version, int(a))
    except ValueError:
        return (9, 0)


async def _client_options(api: AdGuardClient, selected: list[str]) -> list[SelectOptionDict]:
    """Every device AdGuard knows: named (persistent) clients first, then ones it only knows by address."""
    data = await api.clients()
    opts: list[SelectOptionDict] = []
    known: set[str] = set()
    for c in sorted(data["clients"], key=lambda c: c["name"].lower()):
        ids = c.get("ids") or []
        known.update(ids)
        opts.append(SelectOptionDict(value=CLIENT_NAME_PREFIX + c["name"], label=f"{c['name']} ({', '.join(ids[:2])})" if ids else c["name"]))
    try:
        own = set((await api.status()).get("dns_addresses") or [])
    except AdGuardError:
        own = set()
    found: dict[str, str] = {}
    for a in data["auto_clients"]:
        if a.get("source") != "etc/hosts" and a.get("ip"):
            found[a["ip"]] = a.get("name") or ""
    # devices AdGuard only knows from their lookups
    try:
        for e in await api.querylog(limit=1000):
            ip = e.get("client")
            if ip and ip not in found:
                found[ip] = ""
    except AdGuardError:
        pass
    for ip in sorted(found, key=_ip_sort):
        if ip in known or ip in own or not _usable(ip):
            continue
        known.add(ip)
        opts.append(SelectOptionDict(value=CLIENT_IP_PREFIX + ip, label=f"{found[ip] or 'Unnamed device'} ({ip})"))
    values = {o["value"] for o in opts}
    for s in selected:
        if s not in values:
            # an address Kid Watch has since turned into a named client still works as it is
            addr = s.split(":", 1)[1]
            owner = next((c["name"] for c in data["clients"] if s.startswith(CLIENT_IP_PREFIX) and addr in (c.get("ids") or [])), None)
            opts.append(SelectOptionDict(value=s, label=f"{owner} ({addr})" if owner else f"{addr} (not seen lately)"))
    return opts


def _plex_users(hass: HomeAssistant, children: list[dict]) -> list[str]:
    users = {c.get(C_PLEX) for c in children if c.get(C_PLEX)}
    reg = er.async_get(hass)
    for e in reg.entities.values():
        if e.platform == "plex" and e.domain == "media_player" and (st := hass.states.get(e.entity_id)) and st.attributes.get("username"):
            users.add(st.attributes["username"])
    return sorted(users, key=str.lower)


def _child_schema(clients: list[SelectOptionDict], plex: list[str], d: dict) -> vol.Schema:
    return vol.Schema({
        vol.Required(C_NAME, default=d.get(C_NAME, "")): TextSelector(),
        vol.Required(C_COLOR, default=d.get(C_COLOR, "blue")): SelectSelector(SelectSelectorConfig(options=list(COLORS), translation_key="color")),
        vol.Optional(C_CLIENTS, default=d.get(C_CLIENTS, [])): SelectSelector(SelectSelectorConfig(options=clients, multiple=True, mode=SelectSelectorMode.LIST)),
        vol.Optional(C_TVS, default=d.get(C_TVS, [])): EntitySelector(EntitySelectorConfig(domain="media_player", multiple=True)),
        vol.Optional(C_PLEX, description={"suggested_value": d.get(C_PLEX)}): SelectSelector(SelectSelectorConfig(options=plex, custom_value=True)),
        vol.Required(C_AGE, default=d.get(C_AGE, "PG")): SelectSelector(SelectSelectorConfig(options=RATINGS, translation_key="age_limit")),
        vol.Required(C_BUDGET, default=d.get(C_BUDGET, 120)): NumberSelector(NumberSelectorConfig(min=0, max=1440, step=15, unit_of_measurement="min", mode=NumberSelectorMode.BOX)),
        vol.Required(C_BEDTIME, default=d.get(C_BEDTIME, "20:00:00")): TimeSelector(),
        vol.Required(C_WAKE, default=d.get(C_WAKE, "07:00:00")): TimeSelector(),
    })


def _check_child(inp: dict, children: list[dict], editing: str | None) -> tuple[dict | None, dict[str, str]]:
    errors: dict[str, str] = {}
    name = (inp.get(C_NAME) or "").strip()
    others = [c for c in children if c[C_ID] != editing]
    if not name:
        errors[C_NAME] = "name_required"
    elif any(c[C_NAME].lower() == name.lower() for c in others):
        errors[C_NAME] = "name_taken"
    clients = list(inp.get(C_CLIENTS) or [])
    taken = {s for c in others for s in c.get(C_CLIENTS, [])}
    if taken & set(clients):
        errors[C_CLIENTS] = "client_taken"
    if not clients and not inp.get(C_TVS) and not inp.get(C_PLEX):
        errors["base"] = "nothing_to_watch"
    if errors:
        return None, errors
    cid = editing
    if not cid:
        base = slugify(name) or "child"
        cid, n = base, 2
        while any(c[C_ID] == cid for c in children):
            cid, n = f"{base}_{n}", n + 1
    return {
        C_ID: cid, C_NAME: name, C_COLOR: inp.get(C_COLOR, "blue"), C_CLIENTS: clients, C_TVS: list(inp.get(C_TVS) or []),
        C_PLEX: (inp.get(C_PLEX) or "").strip(), C_AGE: inp.get(C_AGE, "PG"), C_BUDGET: int(inp.get(C_BUDGET) or 0),
        C_BEDTIME: inp.get(C_BEDTIME, "20:00:00"), C_WAKE: inp.get(C_WAKE, "07:00:00"),
    }, {}


async def _alerts_schema(hass: HomeAssistant, api: AdGuardClient, d: dict) -> vol.Schema:
    notify = sorted(f"notify.{s}" for s in hass.services.async_services_for_domain("notify") if s not in ("send_message", "persistent_notification"))
    try:
        services = await api.blocked_services()
    except AdGuardError:
        services = []
    svc_opts = [SelectOptionDict(value=s["id"], label=s["name"]) for s in sorted(services, key=lambda s: s["name"].lower())]
    ids = {s["id"] for s in services}
    chosen = [s for s in d.get(CONF_SERVICES, DEFAULT_SERVICES) if not ids or s in ids]
    return vol.Schema({
        vol.Optional(CONF_NOTIFY, description={"suggested_value": d.get(CONF_NOTIFY)}): SelectSelector(SelectSelectorConfig(options=notify, custom_value=True)),
        vol.Optional(CONF_ALERTS, default=d.get(CONF_ALERTS, ALERT_TYPES)): SelectSelector(SelectSelectorConfig(options=ALERT_TYPES, multiple=True, mode=SelectSelectorMode.LIST, translation_key="alert_type")),
        vol.Optional(CONF_SERVICES, default=chosen): SelectSelector(SelectSelectorConfig(options=svc_opts or [SelectOptionDict(value=s, label=s) for s in chosen], multiple=True)),
    })


class KidWatchConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}
        self._children: list[dict] = []
        self._api: AdGuardClient | None = None

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> KidWatchOptionsFlow:
        return KidWatchOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_PORT] = int(user_input[CONF_PORT])
            api, err = await _test_conn(self.hass, user_input)
            if err:
                errors["base"] = err
            else:
                await self.async_set_unique_id(f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}")
                self._abort_if_unique_id_configured()
                self._data, self._api = user_input, api
                return await self.async_step_child()
        return self.async_show_form(step_id="user", data_schema=_conn_schema(user_input or {}), errors=errors)

    async def async_step_child(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            child, errors = _check_child(user_input, self._children, None)
            if child:
                self._children.append(child)
                return await self.async_step_more()
        d = user_input or {}
        schema = _child_schema(await _client_options(self._api, d.get(C_CLIENTS, [])), _plex_users(self.hass, self._children), d)
        return self.async_show_form(step_id="child", data_schema=schema, errors=errors, description_placeholders={"count": str(len(self._children) + 1)})

    async def async_step_more(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_show_menu(step_id="more", menu_options=["child", "alerts"], description_placeholders={"name": self._children[-1][C_NAME]})

    async def async_step_alerts(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="Kid Watch", data=self._data, options={
                CONF_CHILDREN: self._children, CONF_NOTIFY: user_input.get(CONF_NOTIFY, ""),
                CONF_ALERTS: user_input.get(CONF_ALERTS, []), CONF_SERVICES: user_input.get(CONF_SERVICES, DEFAULT_SERVICES),
            })
        return self.async_show_form(step_id="alerts", data_schema=await _alerts_schema(self.hass, self._api, {}))


class KidWatchOptionsFlow(OptionsFlowWithReload):
    """Configure: add, edit or remove a child; alerts and block buttons; connection."""

    def __init__(self) -> None:
        self._editing: str | None = None

    @property
    def _children(self) -> list[dict]:
        return list(self.config_entry.options.get(CONF_CHILDREN, []))

    def _api(self) -> AdGuardClient:
        coord = getattr(self.config_entry, "runtime_data", None)
        return coord.api if coord else _api(self.hass, dict(self.config_entry.data))

    def _save(self, **changes: Any) -> ConfigFlowResult:
        return self.async_create_entry(data={**self.config_entry.options, **changes})

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        menu = ["add_child"]
        if self._children:
            menu += ["edit_pick", "remove_child"]
        menu += ["alerts", "connection"]
        return self.async_show_menu(step_id="init", menu_options=menu)

    def _pick_schema(self) -> vol.Schema:
        return vol.Schema({vol.Required("child"): SelectSelector(SelectSelectorConfig(options=[SelectOptionDict(value=c[C_ID], label=c[C_NAME]) for c in self._children]))})

    async def async_step_add_child(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._child_form("add_child", user_input, None)

    async def async_step_edit_pick(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            self._editing = user_input["child"]
            return await self.async_step_edit_child()
        return self.async_show_form(step_id="edit_pick", data_schema=self._pick_schema())

    async def async_step_edit_child(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._child_form("edit_child", user_input, self._editing)

    async def _child_form(self, step: str, user_input: dict | None, editing: str | None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        children = self._children
        if user_input is not None:
            child, errors = _check_child(user_input, children, editing)
            if child:
                if editing:
                    children = [child if c[C_ID] == editing else c for c in children]
                else:
                    children.append(child)
                return self._save(**{CONF_CHILDREN: children})
        d = user_input or (next((c for c in children if c[C_ID] == editing), {}) if editing else {})
        try:
            clients = await _client_options(self._api(), d.get(C_CLIENTS, []))
        except AdGuardError:
            return self.async_abort(reason="cannot_connect")
        return self.async_show_form(step_id=step, data_schema=_child_schema(clients, _plex_users(self.hass, children), d), errors=errors,
                                    description_placeholders={"name": d.get(C_NAME, "")})

    async def async_step_remove_child(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self._save(**{CONF_CHILDREN: [c for c in self._children if c[C_ID] != user_input["child"]]})
        return self.async_show_form(step_id="remove_child", data_schema=self._pick_schema())

    async def async_step_alerts(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self._save(**{CONF_NOTIFY: user_input.get(CONF_NOTIFY, ""), CONF_ALERTS: user_input.get(CONF_ALERTS, []), CONF_SERVICES: user_input.get(CONF_SERVICES, DEFAULT_SERVICES)})
        return self.async_show_form(step_id="alerts", data_schema=await _alerts_schema(self.hass, self._api(), dict(self.config_entry.options)))

    async def async_step_connection(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_PORT] = int(user_input[CONF_PORT])
            _, err = await _test_conn(self.hass, user_input)
            if err:
                errors["base"] = err
            else:
                self.hass.config_entries.async_update_entry(self.config_entry, data=user_input)
                return self._save()
        return self.async_show_form(step_id="connection", data_schema=_conn_schema(user_input or dict(self.config_entry.data)), errors=errors)
