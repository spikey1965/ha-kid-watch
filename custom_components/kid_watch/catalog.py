"""Which domains belong to which app, and how age ratings compare."""

from __future__ import annotations

import re

# (name, category, domain suffixes). Categories: video, social, gaming, school, tv, music
APPS: list[tuple[str, str, tuple[str, ...]]] = [
    ("YouTube", "video", ("youtube.com", "googlevideo.com", "ytimg.com", "youtu.be", "youtubei.googleapis.com")),
    ("YouTube Kids", "video", ("youtubekids.com",)),
    ("TikTok", "social", ("tiktok.com", "tiktokv.com", "tiktokcdn.com", "tiktokcdn-eu.com", "musical.ly", "byteoversea.com", "ibytedtos.com")),
    ("Snapchat", "social", ("snapchat.com", "sc-cdn.net", "snap-dev.net", "snapkit.com", "sc-static.net")),
    ("Instagram", "social", ("instagram.com", "cdninstagram.com")),
    ("Facebook", "social", ("facebook.com", "fbcdn.net", "fb.com")),
    ("WhatsApp", "social", ("whatsapp.com", "whatsapp.net")),
    ("Discord", "social", ("discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.media")),
    ("Reddit", "social", ("reddit.com", "redd.it", "redditmedia.com", "redditstatic.com")),
    ("X (Twitter)", "social", ("twitter.com", "x.com", "twimg.com")),
    ("Pinterest", "social", ("pinterest.com", "pinimg.com")),
    ("Telegram", "social", ("telegram.org", "t.me")),
    ("Twitch", "video", ("twitch.tv", "ttvnw.net", "jtvnw.net")),
    ("Roblox", "gaming", ("roblox.com", "rbxcdn.com", "rbx.com", "robloxlabs.com")),
    ("Minecraft", "gaming", ("minecraft.net", "minecraftservices.com", "mojang.com", "playfabapi.com")),
    ("Fortnite", "gaming", ("fortnite.com", "epicgames.com", "epicgames.dev", "unrealengine.com")),
    ("Steam", "gaming", ("steampowered.com", "steamcommunity.com", "steamcontent.com", "steamstatic.com")),
    ("Xbox", "gaming", ("xboxlive.com", "xbox.com")),
    ("PlayStation", "gaming", ("playstation.com", "playstation.net", "sonyentertainmentnetwork.com")),
    ("Nintendo", "gaming", ("nintendo.net", "nintendo.com")),
    ("Brawl Stars / Clash", "gaming", ("supercell.com", "supercell.net")),
    ("Among Us", "gaming", ("innersloth.com",)),
    ("Netflix", "tv", ("netflix.com", "nflxvideo.net", "nflxext.com", "nflximg.net", "nflxso.net")),
    ("Disney+", "tv", ("disneyplus.com", "disney-plus.net", "dssott.com", "bamgrid.com")),
    ("Prime Video", "tv", ("primevideo.com", "aiv-cdn.net", "aiv-delivery.net", "amazonvideo.com")),
    ("BBC iPlayer", "tv", ("bbc.co.uk", "bbci.co.uk")),
    ("ITVX", "tv", ("itv.com", "itvx.com")),
    ("Channel 4", "tv", ("channel4.com",)),
    ("NOW", "tv", ("nowtv.com", "now.com")),
    ("Plex", "tv", ("plex.tv", "plex.direct")),
    ("Spotify", "music", ("spotify.com", "scdn.co", "spotifycdn.com")),
    ("Google Classroom", "school", ("classroom.google.com",)),
    ("Google Docs", "school", ("docs.google.com", "drive.google.com")),
    ("Microsoft Teams", "school", ("teams.microsoft.com", "teams.live.com")),
    ("Seesaw", "school", ("seesaw.me",)),
    ("Sparx", "school", ("sparxmaths.uk", "sparx-learning.com", "sparxreader.com")),
    ("Duolingo", "school", ("duolingo.com",)),
    ("Khan Academy", "school", ("khanacademy.org",)),
    ("BBC Bitesize", "school", ("bitesize.bbc.co.uk",)),
    ("Wikipedia", "school", ("wikipedia.org",)),
]

# background chatter that isn't something a child is doing
NOISE = (
    "apple.com", "icloud.com", "mzstatic.com", "push.apple.com", "aaplimg.com", "apple-dns.net", "cdn-apple.com",
    "googleapis.com", "gstatic.com", "google.com", "googleusercontent.com", "gvt1.com", "gvt2.com", "1e100.net",
    "google-analytics.com", "googletagmanager.com", "doubleclick.net", "googlesyndication.com", "app-measurement.com",
    "crashlytics.com", "firebaseio.com", "firebaselogging-pa.googleapis.com", "microsoft.com", "msftconnecttest.com",
    "windows.com", "windowsupdate.com", "live.com", "office.com", "akamaiedge.net", "akamaized.net", "akadns.net",
    "cloudfront.net", "amazonaws.com", "cloudflare.com", "cloudflare-dns.com", "fastly.net", "edgekey.net",
    "samsungcloudsolution.com", "samsungosp.com", "samsungqbe.com", "samsungelectronics.com", "ntp.org",
    "in-addr.arpa", "local", "lan", "home.arpa", "sentry.io", "branch.io", "adjust.com", "appsflyer.com",
)

_SUFFIXES = sorted(
    ((suffix, name, cat) for name, cat, sufs in APPS for suffix in sufs),
    key=lambda x: -len(x[0]),
)

_TWO_PART_TLDS = ("co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "co.nz", "co.jp", "com.br", "co.za")


def _matches(domain: str, suffix: str) -> bool:
    return domain == suffix or domain.endswith("." + suffix)


def classify(domain: str) -> tuple[str, str] | None:
    """Return (app name, category) for a known app's domain."""
    domain = domain.lower().rstrip(".")
    for suffix, name, cat in _SUFFIXES:
        if _matches(domain, suffix):
            return name, cat
    return None


def is_noise(domain: str) -> bool:
    domain = domain.lower().rstrip(".")
    return any(_matches(domain, n) for n in NOISE)


def site_of(domain: str) -> str:
    """The registrable part of a domain, e.g. cdn.example.co.uk -> example.co.uk."""
    parts = domain.lower().rstrip(".").split(".")
    keep = 3 if ".".join(parts[-2:]) in _TWO_PART_TLDS else 2
    return ".".join(parts[-keep:])


# minimum age for each limit a parent can pick
LIMIT_AGE = {"U": 0, "PG": 8, "12": 12, "15": 15, "18": 18}

_RATING_AGE = {
    "U": 0, "UC": 0, "G": 0, "TV-Y": 0, "TV-G": 0, "ALL": 0, "E": 0,
    "TV-Y7": 7, "TV-Y7-FV": 7, "PG": 8, "TV-PG": 8,
    "12": 12, "12A": 12, "PG-13": 13, "TV-14": 14, "15": 15,
    "R": 17, "TV-MA": 17, "NC-17": 18, "18": 18, "R18": 18, "X": 18,
}


def rating_age(rating: str | None) -> int | None:
    """Minimum viewer age for a content rating such as 'gb/15', 'TV-14' or 'PG-13'. None if unknown."""
    if not rating:
        return None
    r = str(rating).strip().upper()
    if "/" in r:
        r = r.rsplit("/", 1)[1]
    r = r.replace("RATED ", "").strip()
    if r in _RATING_AGE:
        return _RATING_AGE[r]
    m = re.search(r"(\d{1,2})", r)
    if m and r not in ("NR", "NOT RATED", "UNRATED"):
        return int(m.group(1))
    return None


def over_limit(rating: str | None, limit: str) -> bool:
    age = rating_age(rating)
    return age is not None and age > LIMIT_AGE.get(limit, 18)
