"""Small async client for the parts of the AdGuard Home API that Kid Watch uses."""

from __future__ import annotations

from typing import Any

import aiohttp


class AdGuardError(Exception):
    """AdGuard Home could not be reached or returned an error."""


class AdGuardAuthError(AdGuardError):
    """AdGuard Home rejected the username or password."""


def escape_client(name: str) -> str:
    """Quote a client name for a $client rule modifier."""
    for ch in ("\\", "'", '"', ",", "|"):
        name = name.replace(ch, "\\" + ch)
    return f"'{name}'"


class AdGuardClient:
    """Talks to one AdGuard Home instance."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        host: str,
        port: int,
        ssl: bool,
        verify_ssl: bool,
        username: str | None,
        password: str | None,
    ) -> None:
        self._session = session
        self._base = f"{'https' if ssl else 'http'}://{host}:{port}/control"
        self._verify = verify_ssl
        self._auth = aiohttp.BasicAuth(username, password or "") if username else None

    async def _req(self, method: str, path: str, *, params: dict | None = None, json: Any = None) -> Any:
        try:
            async with self._session.request(
                method,
                self._base + path,
                params=params,
                json=json,
                auth=self._auth,
                ssl=None if self._verify else False,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as resp:
                if resp.status in (401, 403):
                    raise AdGuardAuthError("invalid_auth")
                if resp.status >= 400:
                    raise AdGuardError(f"{method} {path}: HTTP {resp.status}: {(await resp.text())[:200]}")
                if resp.content_type == "application/json":
                    return await resp.json()
                return await resp.text()
        except (aiohttp.ClientError, TimeoutError) as err:
            raise AdGuardError(str(err)) from err

    async def status(self) -> dict:
        return await self._req("GET", "/status")

    async def clients(self) -> dict:
        """Persistent clients ("clients") and the ones AdGuard only knows by address ("auto_clients")."""
        data = await self._req("GET", "/clients")
        return {"clients": data.get("clients") or [], "auto_clients": data.get("auto_clients") or []}

    async def add_client(self, client: dict) -> None:
        await self._req("POST", "/clients/add", json=client)

    async def update_client(self, name: str, client: dict) -> None:
        await self._req("POST", "/clients/update", json={"name": name, "data": client})

    async def querylog(self, limit: int = 500, older_than: str | None = None) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if older_than:
            params["older_than"] = older_than
        data = await self._req("GET", "/querylog", params=params)
        return data.get("data") or []

    async def blocked_services(self) -> list[dict]:
        """All blockable services as [{id, name}], newest API first."""
        try:
            data = await self._req("GET", "/blocked_services/all")
            return [{"id": s["id"], "name": s.get("name", s["id"])} for s in data.get("blocked_services", [])]
        except AdGuardAuthError:
            raise
        except AdGuardError:
            data = await self._req("GET", "/blocked_services/services")
            if isinstance(data, list):
                return [{"id": s, "name": s} for s in data]
            return []

    async def user_rules(self) -> list[str]:
        data = await self._req("GET", "/filtering/status")
        return list(data.get("user_rules") or [])

    async def set_user_rules(self, rules: list[str]) -> None:
        await self._req("POST", "/filtering/set_rules", json={"rules": rules})
