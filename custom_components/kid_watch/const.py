"""Constants for Kid Watch."""

from datetime import timedelta

DOMAIN = "kid_watch"
VERSION = "0.1.1"

PLATFORMS = ["sensor", "switch"]
SCAN_INTERVAL = timedelta(seconds=60)

# connection (config entry data)
CONF_HOST = "host"
CONF_PORT = "port"
CONF_SSL = "ssl"
CONF_VERIFY_SSL = "verify_ssl"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"

# options
CONF_CHILDREN = "children"
CONF_NOTIFY = "notify_service"
CONF_ALERTS = "alerts"
CONF_SERVICES = "services"

# per-child keys
C_ID = "id"
C_NAME = "name"
C_COLOR = "color"
C_CLIENTS = "clients"
C_TVS = "tvs"
C_PLEX = "plex_user"
C_AGE = "age_limit"
C_BUDGET = "budget"
C_BEDTIME = "bedtime"
C_WAKE = "wake_time"

# client selections are stored with a prefix: a persistent AdGuard client by name,
# or a plain address that Kid Watch turns into a persistent client when needed
CLIENT_NAME_PREFIX = "name:"
CLIENT_IP_PREFIX = "ip:"

ALERT_TYPES = ["site", "tv", "blocked", "budget", "bedtime"]

RATINGS = ["U", "PG", "12", "15", "18"]

COLORS = {
    "pink": "#d6487e",
    "blue": "#2f8fd8",
    "green": "#2f9e6b",
    "orange": "#d48a00",
    "purple": "#8e5cf7",
    "teal": "#0f9b9b",
}

# AdGuard Home blocked-service ids offered as one-tap block buttons by default
DEFAULT_SERVICES = ["youtube", "tiktok", "roblox", "snapchat", "netflix", "disneyplus"]

# marker for the user rules Kid Watch adds to pause a child's internet
PAUSE_MARKER = "! kid_watch pause"

EVENT_ALERT = "kid_watch_alert"

# how long a DNS-only app counts as "now" after its last query
NOW_WINDOW = timedelta(minutes=3)
TIMELINE_MAX = 100
ALERT_DEDUPE = timedelta(minutes=10)

# AdGuard tag put on every child's client, for tag rules such as ||mask.icloud.com^$ctag=user_child
CHILD_TAG = "user_child"
