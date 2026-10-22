"""Polls AdGuard Home and the TVs, and keeps each child's day: screen time, timeline, alerts."""

from __future__ import annotations

import asyncio
import copy
import logging
import re
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .adguard import AdGuardClient, AdGuardError, escape_client
from .catalog import classify, is_noise, over_limit, site_of
from .const import (
    ALERT_DEDUPE,
    C_AGE,
    C_BEDTIME,
    C_BUDGET,
    C_CLIENTS,
    C_ID,
    C_NAME,
    C_PLEX,
    C_TVS,
    C_WAKE,
    CHILD_TAG,
    CLIENT_IP_PREFIX,
    CLIENT_NAME_PREFIX,
    CONF_ALERTS,
    CONF_CHILDREN,
    CONF_NOTIFY,
    CONF_SERVICES,
    DEFAULT_SERVICES,
    DOMAIN,
    EVENT_ALERT,
    NOW_WINDOW,
    PAUSE_MARKER,
    SCAN_INTERVAL,
    TIMELINE_MAX,
)

_LOGGER = logging.getLogger(__name__)

PAUSE_RULE = "/.*/$client="
SAFE_SEARCH_ALL = {"enabled": True, "bing": True, "duckduckgo": True, "ecosia": True, "google": True, "pixabay": True, "yandex": True, "youtube": True}
_FRACTION = re.compile(r"(\.\d{6})\d+")


def parse_time(value: str) -> datetime | None:
    """AdGuard writes nanoseconds; Python only takes microseconds."""
    return dt_util.parse_datetime(_FRACTION.sub(r"\1", value or ""))


def _blank_day() -> dict[str, Any]:
    return {"minutes": {}, "apps": {}, "timeline": [], "alerts": [], "budget_alerted": False, "alerted_media": [], "last_key": None, "dedupe": {}}


def _hm(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    parts = str(value).split(":")
    return int(parts[0]), int(parts[1])


class KidWatchCoordinator(DataUpdateCoordinator[dict[str, dict[str, Any]]]):
    """One per Kid Watch config entry."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, api: AdGuardClient) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.api = api
        self._store: Store = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}")
        self._day: str | None = None
        self._kids: dict[str, dict[str, Any]] = {}
        self._flags: dict[str, dict[str, Any]] = {}
        self._last_query: datetime | None = None
        self._last_update: datetime | None = None
        self._last_seen: dict[str, tuple[datetime, str, str, str, str]] = {}
        self._clients: dict[str, Any] = {"clients": [], "auto_clients": []}
        self._rules: list[str] = []
        self._global_blocked: list[str] = []
        self.service_names: dict[str, str] = {}
        self._unsubs: list = []
        self._lock = asyncio.Lock()

    # ---- configuration helpers ----

    @property
    def children(self) -> list[dict[str, Any]]:
        return list(self.config_entry.options.get(CONF_CHILDREN, []))

    @property
    def services(self) -> list[str]:
        return list(self.config_entry.options.get(CONF_SERVICES, DEFAULT_SERVICES))

    def child(self, cid: str) -> dict[str, Any]:
        for c in self.children:
            if c[C_ID] == cid:
                return c
        raise HomeAssistantError(f"Unknown child {cid}")

    def flags(self, cid: str) -> dict[str, Any]:
        return self._flags.setdefault(cid, {"bedtime_enabled": True, "stop_over_age": False, "paused_by_bedtime": False})

    # ---- start / stop ----

    async def async_setup(self) -> None:
        stored = await self._store.async_load() or {}
        self._day = stored.get("day")
        self._kids = stored.get("kids", {})
        self._flags = stored.get("flags", {})
        if stored.get("last_query"):
            self._last_query = parse_time(stored["last_query"])
        for day in self._kids.values():
            day["apps"] = {k: {"cat": v["cat"], "mins": set(v["mins"])} for k, v in day.get("apps", {}).items()}
        try:
            self.service_names = {s["id"]: s["name"] for s in await self.api.blocked_services()}
        except AdGuardError as err:
            _LOGGER.debug("Could not read AdGuard's service list: %s", err)
        for c in self.children:
            for key, cb in ((C_BEDTIME, self._bedtime), (C_WAKE, self._wake)):
                hm = _hm(c.get(key))
                if hm:
                    self._unsubs.append(async_track_time_change(self.hass, self._make_timer(cb, c[C_ID]), hour=hm[0], minute=hm[1], second=0))

    def _make_timer(self, cb, cid: str):
        @callback
        def _fire(_now: datetime) -> None:
            self.hass.async_create_task(cb(cid))
        return _fire

    async def async_shutdown(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        await self._store.async_save(self._serialize())
        await super().async_shutdown()

    def _serialize(self) -> dict[str, Any]:
        kids = {}
        for cid, day in self._kids.items():
            d = dict(day)
            d["apps"] = {k: {"cat": v["cat"], "mins": sorted(v["mins"])} for k, v in day["apps"].items()}
            kids[cid] = d
        return {"day": self._day, "kids": kids, "flags": self._flags, "last_query": self._last_query.isoformat() if self._last_query else None}

    def _save(self) -> None:
        self._store.async_delay_save(self._serialize, 30)

    # ---- AdGuard clients ----

    def _child_clients(self, cid: str) -> tuple[set[str], set[str], list[str]]:
        """(ids, persistent names, addresses without a persistent client) for a child."""
        persistent = self._clients["clients"]
        ids: set[str] = set()
        names: set[str] = set()
        loose: list[str] = []
        for sel in self.child(cid).get(C_CLIENTS, []):
            if sel.startswith(CLIENT_NAME_PREFIX):
                name = sel[len(CLIENT_NAME_PREFIX):]
                for pc in persistent:
                    if pc["name"] == name:
                        names.add(name)
                        ids.update(pc.get("ids") or [])
            elif sel.startswith(CLIENT_IP_PREFIX):
                ip = sel[len(CLIENT_IP_PREFIX):]
                ids.add(ip)
                owner = next((pc for pc in persistent if ip in (pc.get("ids") or [])), None)
                if owner:
                    names.add(owner["name"])
                else:
                    loose.append(ip)
        return ids, names, loose

    async def _persistent_names(self, cid: str) -> list[str]:
        """Names of the child's persistent clients, creating them for bare addresses (controls need them)."""
        _, names, loose = self._child_clients(cid)
        if loose:
            child = self.child(cid)
            for ip in loose:
                name = f"{child[C_NAME]} ({ip})"
                await self.api.add_client({
                    "name": name, "ids": [ip], "use_global_settings": True, "use_global_blocked_services": True,
                    **await self._global_protection(),
                    "safe_search": {**SAFE_SEARCH_ALL, "enabled": False}, "blocked_services": [], "upstreams": [], "tags": [CHILD_TAG],
                })
                names.add(name)
            self._clients = await self.api.clients()
        return sorted(names)

    async def _tag_children(self) -> None:
        """Give every child's AdGuard client the user_child tag, so tag rules (e.g. blocking iCloud Private Relay) reach them."""
        names = {n for c in self.children for n in self._child_clients(c[C_ID])[1]}
        changed = False
        for name in sorted(names):
            pc = self._persistent(name)
            if pc is None or CHILD_TAG in (pc.get("tags") or []):
                continue
            new = copy.deepcopy(pc)
            new["tags"] = [*(pc.get("tags") or []), CHILD_TAG]
            try:
                await self.api.update_client(name, new)
                changed = True
            except AdGuardError as err:
                _LOGGER.warning("Could not tag %s as %s: %s", name, CHILD_TAG, err)
        if changed:
            self._clients = await self.api.clients()

    def _persistent(self, name: str) -> dict[str, Any] | None:
        return next((pc for pc in self._clients["clients"] if pc["name"] == name), None)

    # ---- the poll ----

    async def _async_update_data(self) -> dict[str, dict[str, Any]]:
        try:
            self._clients = await self.api.clients()
            await self._tag_children()
            self._rules = await self.api.user_rules()
            self._global_blocked = await self._global_blocked_ids()
            entries = await self._pull_log()
        except AdGuardError as err:
            raise UpdateFailed(f"AdGuard Home: {err}") from err

        now = dt_util.now()
        today = now.date().isoformat()
        if self._day != today:
            self._day = today
            self._kids = {}
            self._last_seen = {}
        for c in self.children:
            self._kids.setdefault(c[C_ID], _blank_day())

        lookups = {c[C_ID]: self._child_clients(c[C_ID]) for c in self.children}
        for t, e in entries:
            local = dt_util.as_local(t)
            if local.date().isoformat() != today:
                continue
            info = e.get("client_info") or {}
            for cid, (ids, names, _) in lookups.items():
                if e.get("client") in ids or (e.get("client_id") and e["client_id"] in ids) or info.get("name") in names:
                    self._log_entry(cid, local, e, info.get("name") or e.get("client") or "")

        since = self._last_update or now - SCAN_INTERVAL
        elapsed = max(1, min(5, round((now - since).total_seconds() / 60)))
        data = {c[C_ID]: await self._child_snapshot(c, now, elapsed) for c in self.children}
        self._last_update = now
        self._save()
        return data

    async def _global_blocked_ids(self) -> list[str]:
        try:
            data = await self.api._req("GET", "/blocked_services/get")
            return list(data.get("ids") or [])
        except AdGuardError:
            data = await self.api._req("GET", "/blocked_services/list")
            return list(data) if isinstance(data, list) else []

    async def _pull_log(self) -> list[tuple[datetime, dict]]:
        since = self._last_query or dt_util.start_of_local_day()
        out: list[tuple[datetime, dict]] = []
        older = None
        for _ in range(10):
            page = await self.api.querylog(limit=500, older_than=older)
            if not page:
                break
            done = False
            for e in page:
                t = parse_time(e.get("time", ""))
                if t is None:
                    continue
                if t <= since:
                    done = True
                    break
                out.append((t, e))
            if done or len(page) < 500:
                break
            older = page[-1]["time"]
        out.sort(key=lambda x: x[0])
        if out:
            self._last_query = out[-1][0]
        return out

    def _log_entry(self, cid: str, local: datetime, e: dict, device: str) -> None:
        day = self._kids[cid]
        domain = ((e.get("question") or {}).get("name") or "").rstrip(".").lower()
        reason = e.get("reason") or ""
        minute = local.hour * 60 + local.minute
        child = self.child(cid)
        if reason in ("FilteredParental", "FilteredSafeBrowsing"):
            what = "adult content" if reason == "FilteredParental" else "a dangerous site"
            self._alert(cid, "site", site_of(domain), local, f"⚠ {child[C_NAME]} tried to open a blocked site",
                        f"{site_of(domain)} on {device} ({what}). AdGuard blocked it.", "Blocked site", f"{site_of(domain)} · {device} · {what}")
            return
        if reason == "FilteredBlockedService":
            if self._is_paused(cid):
                return
            sid = e.get("service_name")
            svc = self.service_names.get(sid, sid) if sid else site_of(domain)
            self._alert(cid, "blocked", svc, local, f"{child[C_NAME]} tried {svc}", f"Blocked on {device}.", f"{svc} (blocked)", f"{device} · {svc} is blocked")
            return
        if reason.startswith("Filtered"):
            return
        app = classify(domain)
        if app:
            name, cat = app
            day["minutes"][str(minute)] = day["minutes"].get(str(minute)) or cat
            day["apps"].setdefault(name, {"cat": cat, "mins": set()})["mins"].add(minute)
            last = self._last_seen.get(cid)
            key = e.get("client") or device   # the device's address: stays the same when AdGuard renames it
            if not last or local >= last[0]:
                if not last or last[1] != name or last[4] != key or local - last[0] > NOW_WINDOW:
                    self._timeline(cid, local, cat, name, device)
                self._last_seen[cid] = (local, name, cat, device, key)
        elif domain and not is_noise(domain):
            day["apps"].setdefault(site_of(domain), {"cat": "web", "mins": set()})["mins"].add(minute)

    # ---- TVs ----

    def _plex_entities(self) -> set[str]:
        reg = er.async_get(self.hass)
        return {e.entity_id for e in reg.entities.values() if e.platform == "plex" and e.domain == "media_player"}

    def _tv_info(self, entity_id: str, plex: set[str]) -> dict[str, Any] | None:
        st = self.hass.states.get(entity_id)
        if st is None or st.state not in ("playing", "paused"):
            return None
        a = st.attributes
        series = a.get("media_series_title")
        title = a.get("media_title") or a.get("app_name") or "Something"
        episode = None
        if series:
            if a.get("media_season") is not None and a.get("media_episode") is not None:
                episode = f"S{a['media_season']}E{a['media_episode']}"
            elif title != series:
                episode = title
        show = series or title
        app = "Plex" if entity_id in plex else (a.get("app_name") or a.get("source") or "")
        duration = a.get("media_duration")
        position = a.get("media_position")
        if position is not None and st.state == "playing" and a.get("media_position_updated_at"):
            upd = a["media_position_updated_at"]
            upd = upd if isinstance(upd, datetime) else dt_util.parse_datetime(str(upd))
            if upd:
                position += (dt_util.utcnow() - upd).total_seconds()
        return {
            "entity_id": entity_id, "tv": st.name, "show": show, "episode": episode,
            "title": f"{show} · {episode}" if episode else show, "app": app,
            "rating": a.get("media_content_rating"), "picture": a.get("entity_picture"),
            "duration": duration, "position": position, "paused": st.state == "paused",
            "plex_user": a.get("username"),
        }

    def _child_tvs(self, child: dict[str, Any], plex: set[str]) -> list[dict[str, Any]]:
        ents = list(child.get(C_TVS, []))
        user = (child.get(C_PLEX) or "").lower()
        if user:
            for eid in plex:
                st = self.hass.states.get(eid)
                if st and str(st.attributes.get("username", "")).lower() == user and eid not in ents:
                    ents.append(eid)
        out = []
        for eid in ents:
            info = self._tv_info(eid, plex)
            if info is None:
                continue
            # a Plex player watched by someone else isn't this child's
            if eid in plex and user and info["plex_user"] and str(info["plex_user"]).lower() != user and eid not in child.get(C_TVS, []):
                continue
            out.append(info)
        out.sort(key=lambda i: i["paused"])
        return out

    # ---- per-child snapshot ----

    def _is_paused(self, cid: str) -> bool:
        return f"{PAUSE_MARKER} {cid}" in self._rules

    async def _child_snapshot(self, child: dict[str, Any], now: datetime, elapsed: int) -> dict[str, Any]:
        cid = child[C_ID]
        day = self._kids[cid]
        flags = self.flags(cid)
        paused = self._is_paused(cid)
        plex = self._plex_entities()
        tvs = self._child_tvs(child, plex)
        tv = tvs[0] if tvs else None

        if tv and not tv["paused"]:
            key = f"{tv['show']} ({tv['app']})" if tv["app"] else tv["show"]
            mins = day["apps"].setdefault(key, {"cat": "tv", "mins": set()})["mins"]
            base = now.hour * 60 + now.minute
            for m in range(base - elapsed + 1, base + 1):
                if m >= 0:
                    day["minutes"][str(m)] = "tv"
                    mins.add(m)

        current = None
        if tv:
            current = {"kind": "tv", "category": "tv", **tv}
        elif not paused and (seen := self._last_seen.get(cid)) and now - seen[0] <= NOW_WINDOW:
            current = {"kind": "app", "category": seen[2], "title": seen[1], "device": seen[3], "since": seen[0].isoformat()}

        if tv and over_limit(tv["rating"], child.get(C_AGE, "18")):
            rating = str(tv["rating"]).rsplit("/", 1)[-1]
            mid = f"{tv['entity_id']}|{tv['title']}"
            if mid not in day["alerted_media"]:
                day["alerted_media"].append(mid)
                stop = flags["stop_over_age"] and not tv["paused"]
                msg = f"On {tv['tv']}{' (' + tv['app'] + ')' if tv['app'] else ''}. Their limit is {child.get(C_AGE)}."
                if stop:
                    msg += " The TV was stopped."
                self._alert(cid, "tv", mid, now, f"⚠ {child[C_NAME]} is watching {tv['show']} ({rating})", msg,
                            f"{tv['title']} ({rating})", f"{tv['app']} · {tv['tv']} · above {child[C_NAME]}'s limit ({child.get(C_AGE)})")
                if stop:
                    await self._stop_tv(tv["entity_id"])
                    self.hass.async_create_task(self.async_request_refresh())

        # a new show goes on the timeline once (an over-age one already went on as its alert)
        key = f"{tv['title']}|{tv['tv']}" if tv else None
        if key and key != day["last_key"] and not over_limit(tv["rating"], child.get(C_AGE, "18")):
            self._timeline(cid, now, "tv", tv["title"], f"{tv['app']} · {tv['tv']}" if tv["app"] else tv["tv"])
        day["last_key"] = key

        total = len(day["minutes"])
        budget = int(child.get(C_BUDGET) or 0)
        if budget and total >= budget and not day["budget_alerted"]:
            day["budget_alerted"] = True
            self._alert(cid, "budget", "budget", now, f"{child[C_NAME]} hit their screen-time budget",
                        f"{total} minutes used today." + (f" Now: {current['title']}." if current else ""), "Screen-time budget used up", f"{total} of {budget} minutes")

        by_cat: dict[str, int] = {}
        for cat in day["minutes"].values():
            by_cat[cat] = by_cat.get(cat, 0) + 1
        top = sorted(({"name": k, "category": v["cat"], "minutes": len(v["mins"])} for k, v in day["apps"].items()), key=lambda x: -x["minutes"])[:15]

        safesearch, blocked = self._client_settings(cid)
        _, names, loose = self._child_clients(cid)
        return {
            "now": current, "paused": paused, "screen_time": total, "budget": budget, "by_category": by_cat,
            "top_sites": top, "timeline": day["timeline"], "alerts": day["alerts"], "safesearch": safesearch,
            "blocked": blocked, "bedtime_enabled": flags["bedtime_enabled"], "stop_over_age": flags["stop_over_age"],
            "tvs": tvs, "devices": sorted(names) + loose,
        }

    def _client_settings(self, cid: str) -> tuple[bool, dict[str, bool]]:
        _, names, _ = self._child_clients(cid)
        clients = [c for n in names if (c := self._persistent(n))]
        if not clients:
            return False, {s: False for s in self.services}
        safe = all(not c.get("use_global_settings") and ((c.get("safe_search") or {}).get("enabled") or c.get("safesearch_enabled")) for c in clients)
        blocked = {}
        for s in self.services:
            blocked[s] = all(s in (self._global_blocked if c.get("use_global_blocked_services") else (c.get("blocked_services") or [])) for c in clients)
        return bool(safe), blocked

    # ---- timeline and alerts ----

    def _timeline(self, cid: str, when: datetime, cat: str, title: str, detail: str, alert: bool = False) -> None:
        tl = self._kids[cid]["timeline"]
        tl.insert(0, {"t": when.isoformat(), "category": cat, "title": title, "detail": detail, "alert": alert})
        tl.sort(key=lambda e: e["t"], reverse=True)
        del tl[TIMELINE_MAX:]

    def _alert(self, cid: str, kind: str, key: str, when: datetime, title: str, message: str, short: str, detail: str) -> None:
        day = self._kids[cid]
        dkey = f"{kind}:{key}"
        last = day["dedupe"].get(dkey)
        if last and (prev := dt_util.parse_datetime(last)) and when - prev < ALERT_DEDUPE:
            return
        day["dedupe"][dkey] = when.isoformat()
        item = {"t": when.isoformat(), "type": kind, "title": short, "detail": detail}
        day["alerts"].insert(0, item)
        del day["alerts"][50:]
        self._timeline(cid, when, {"site": "blocked", "blocked": "blocked", "bedtime": "paused", "tv": "tv"}.get(kind, "alert"), short, detail, alert=kind in ("site", "tv"))
        # history pulled in after a restart doesn't notify again
        if dt_util.now() - when > timedelta(minutes=5):
            return
        child = self.child(cid)
        self.hass.bus.async_fire(EVENT_ALERT, {"child": child[C_NAME], "child_id": cid, "type": kind, "title": title, "message": message})
        opts = self.config_entry.options
        target = opts.get(CONF_NOTIFY)
        if target and kind in opts.get(CONF_ALERTS, []) and "." in target:
            domain, service = target.split(".", 1)
            self.hass.async_create_task(
                self.hass.services.async_call(domain, service, {"title": title, "message": message}, blocking=False)
            )

    # ---- controls ----

    async def async_set_pause(self, cid: str, on: bool, by_bedtime: bool = False) -> None:
        async with self._lock:
            names = await self._set_pause_rules(cid, on)
        flags = self.flags(cid)
        flags["paused_by_bedtime"] = on and by_bedtime
        now = dt_util.now()
        # bedtime's own alert already puts "Bedtime" on the timeline
        if cid in self._kids and not (on and by_bedtime):
            if on:
                self._timeline(cid, now, "paused", "Internet paused by a parent", f"{len(names)} device" + ("" if len(names) == 1 else "s"))
            else:
                self._timeline(cid, now, "paused", "Internet resumed", "morning" if by_bedtime else "by a parent")
        self._save()
        await self.async_refresh()

    async def _set_pause_rules(self, cid: str, on: bool) -> list[str]:
        names = await self._persistent_names(cid)
        rules = await self.api.user_rules()
        marker = f"{PAUSE_MARKER} {cid}"
        out: list[str] = []
        skipping = False
        for r in rules:
            if r == marker:
                skipping = True
                continue
            if skipping and r.startswith(PAUSE_RULE):
                continue
            skipping = False
            out.append(r)
        if on:
            out.append(marker)
            out.extend(PAUSE_RULE + escape_client(n) for n in names)
        await self.api.set_user_rules(out)
        self._rules = out
        return names

    async def _update_clients(self, cid: str, change) -> None:
        # one change at a time, each on fresh settings, so quick taps don't undo each other
        async with self._lock:
            names = await self._persistent_names(cid)
            self._clients = await self.api.clients()
            self._global_blocked = await self._global_blocked_ids()
            for name in names:
                pc = self._persistent(name)
                if pc is None:
                    continue
                new = copy.deepcopy(pc)
                change(new)
                if CHILD_TAG not in (new.get("tags") or []):
                    new["tags"] = [*(new.get("tags") or []), CHILD_TAG]
                await self.api.update_client(name, new)
            self._clients = await self.api.clients()
        await self.async_refresh()

    async def _global_protection(self) -> dict[str, bool]:
        """AdGuard's global filtering, parental control and safe browsing settings."""
        out = {}
        for key, path in (("filtering_enabled", "/filtering/status"), ("parental_enabled", "/parental/status"), ("safebrowsing_enabled", "/safebrowsing/status")):
            try:
                out[key] = bool((await self.api._req("GET", path)).get("enabled"))
            except AdGuardError:
                out[key] = True
        return out

    async def async_set_safesearch(self, cid: str, on: bool) -> None:
        glob = await self._global_protection()

        def change(c: dict) -> None:
            if c.get("use_global_settings"):
                # moving to the child's own settings: start from the parent's global ones
                c.update({"use_global_settings": False, **glob})
            c["safe_search"] = {**SAFE_SEARCH_ALL, "enabled": on}
            c["safesearch_enabled"] = on
        await self._update_clients(cid, change)

    async def async_set_service(self, cid: str, service: str, on: bool) -> None:
        glob = list(self._global_blocked)

        def change(c: dict) -> None:
            current = list(glob if c.get("use_global_blocked_services") else (c.get("blocked_services") or []))
            if on and service not in current:
                current.append(service)
            if not on:
                current = [s for s in current if s != service]
            c["use_global_blocked_services"] = False
            c["blocked_services"] = current
        await self._update_clients(cid, change)

    async def async_set_flag(self, cid: str, flag: str, on: bool) -> None:
        self.flags(cid)[flag] = on
        self._save()
        self.async_update_listeners()

    async def _stop_tv(self, entity_id: str) -> None:
        st = self.hass.states.get(entity_id)
        features = int(st.attributes.get("supported_features", 0)) if st else 0
        service = "media_stop" if features & 4096 else "media_pause"
        try:
            await self.hass.services.async_call("media_player", service, {"entity_id": entity_id}, blocking=True)
        except HomeAssistantError as err:
            _LOGGER.warning("Could not stop %s: %s", entity_id, err)

    async def _bedtime(self, cid: str) -> None:
        if not self.flags(cid)["bedtime_enabled"] or self._is_paused(cid):
            return
        await self.async_set_pause(cid, True, by_bedtime=True)
        child = self.child(cid)
        if cid in self._kids:
            self._alert(cid, "bedtime", dt_util.now().isoformat(), dt_util.now(), f"Bedtime for {child[C_NAME]}",
                        f"Internet paused on {child[C_NAME]}'s devices until {str(child.get(C_WAKE, ''))[:5]}.", "Bedtime", "internet paused")

    async def _wake(self, cid: str) -> None:
        if self.flags(cid)["paused_by_bedtime"] and self._is_paused(cid):
            await self.async_set_pause(cid, False, by_bedtime=True)
