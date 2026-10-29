# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Semantic pointer classification for archetype-driven layout synthesis."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
import re
from typing import Any
from urllib.parse import urlparse

from .models import SemanticType

_CAMEL_SPLIT_RE = re.compile(r"([a-z0-9])([A-Z])|([A-Z]+)([A-Z][a-z])")
_KEY_SEP_RE = re.compile(r"[\s_\-/~]+")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$")
_PHONE_RE = re.compile(
    r"^(?:\+\d[\d\s().-]{6,18}\d|\(\d{3}\)\s*\d{3}[-\s]\d{4}|\d{3}[-\s]\d{3}[-\s]\d{4})$"
)
_HTTP_URL_RE = re.compile(r"^(?:https?://|www\.)\S+$", re.IGNORECASE)
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_HEX_HASH_RE = re.compile(r"^[0-9a-fA-F]{32,64}$")

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SLASH_DATE_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")
_MONTH_DATE_RE = re.compile(
    r"^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}$",
    re.IGNORECASE,
)
_ISO_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$"
)
_TIME_RE = re.compile(r"^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[APap][Mm])?$")
_DATE_RANGE_RE = re.compile(
    r"^(?:\d{4}-\d{2}-\d{2}\s*(?:\.\.|/|to|–|—|-)\s*\d{4}-\d{2}-\d{2}"
    r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}"
    r"\s*(?:to|–|—|-)\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?"
    r"\d{1,2}(?:,?\s+\d{4})?)$",
    re.IGNORECASE,
)
_ISO_DURATION_RE = re.compile(
    r"^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?"
    r"(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$"
)
_HUMAN_DURATION_RE = re.compile(
    r"^\d+(?:\.\d+)?\s*(?:ms|msec|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|"
    r"h|hrs?|hours?|d|days?|w|wks?|weeks?)"
    r"(?:\s+\d+\s*(?:s|secs?|m|mins?|h|hrs?|d|days?))*$",
    re.IGNORECASE,
)
_RELATIVE_TIME_RE = re.compile(
    r"^(?:just now|yesterday|today|tomorrow"
    r"|\d+\s*(?:s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|"
    r"w|wks?|weeks?|mo|months?|y|yrs?|years?)\s+ago"
    r"|in\s+\d+\s*(?:s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|"
    r"w|wks?|weeks?|mo|months?|y|yrs?|years?))$",
    re.IGNORECASE,
)

_HEX_COLOR_RE = re.compile(
    r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
)
_CSS_COLOR_RE = re.compile(r"^(?:rgb|rgba|hsl|hsla|oklch)\([^)]+\)$", re.IGNORECASE)

_CURRENCY_STR_RE = re.compile(
    r"^(?:(?P<sym>[$€£¥₹])\s*-?\d[\d,]*(?:\.\d+)?"
    r"|(?P<code1>USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR)\s+-?\d[\d,]*(?:\.\d+)?"
    r"|-?\d[\d,]*(?:\.\d+)?\s+(?P<code2>USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR))$",
    re.IGNORECASE,
)
_PERCENT_STR_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?\s*%$")
_RATING_STR_RE = re.compile(
    r"^(?:\d+(?:\.\d+)?\s*(?:/|out of)\s*(?:5|10)|[★☆]{3,10})$",
    re.IGNORECASE,
)
_RATIO_STR_RE = re.compile(
    r"^\d+(?:\.\d+)?\s*(?:/|:|of)\s*\d+(?:\.\d+)?$", re.IGNORECASE
)
_QUANTITY_STR_RE = re.compile(
    r"^[+-]?\d[\d,]*(?:\.\d+)?\s*"
    r"(?P<unit>kWh|Wh|MWh|kW|MW|W|kg|g|mg|lb|lbs|oz|km|m|cm|mm|mi|ft|in|"
    r"GB|MB|KB|TB|PB|GiB|MiB|Mbps|Gbps|Hz|kHz|MHz|GHz|bpm|rpm|"
    r"kcal|cal|L|mL|ml|gal|fl\s*oz|°C|°F|K|psi|bar|hPa|dB|ppm|pts|px|rem|em)$"
)

_MARKDOWN_SYNTAX_RE = re.compile(
    r"(?:^#{1,6}\s+\S|\*\*[^*\n]+\*\*|\[[^\[\]\n]{1,256}\]\(https?://[^()\s]{1,1024}\)|^\s*[-*]\s+\S)",
    re.MULTILINE,
)
_CODE_SYNTAX_RE = re.compile(
    r"(?:^```|^(?:SELECT|INSERT|UPDATE|DELETE)\s+.+\s+FROM\b|"
    r"^(?:def|class|function|import|from|const|let|var)\s+\w+|"
    r"^\s*\{[\s\S]*\"[^\"]+\"\s*:[\s\S]*\}\s*$)",
    re.IGNORECASE | re.MULTILINE,
)

_IMAGE_EXTENSIONS = frozenset({
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".avif",
    ".bmp",
    ".ico",
})
_VIDEO_EXTENSIONS = frozenset(
    {".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".m3u8"}
)
_AUDIO_EXTENSIONS = frozenset(
    {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"}
)
_DOCUMENT_EXTENSIONS = frozenset({
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".csv",
    ".rtf",
    ".odt",
    ".epub",
})

_IMAGE_FRAMING_HINTS = (
    "logo",
    "icon",
    "avatar",
    "portrait",
    "cover",
    "poster",
    "thumbnail",
    "banner",
    "hero",
)
_IMAGE_KEY_HINTS = frozenset({
    *_IMAGE_FRAMING_HINTS,
    "image",
    "img",
    "photo",
    "picture",
    "thumb",
    "artwork",
    "illustration",
})
_VIDEO_KEY_HINTS = frozenset(
    {"video", "clip", "trailer", "stream", "movie", "recording", "footage"}
)
_AUDIO_KEY_HINTS = frozenset(
    {"audio", "track", "song", "podcast", "voice", "sound", "voicemail"}
)
_DOCUMENT_KEY_HINTS = frozenset({
    "document",
    "doc",
    "pdf",
    "invoice",
    "receipt",
    "report",
    "contract",
    "resume",
    "attachment",
    "syllabus",
    "manual",
    "datasheet",
})
_URL_KEY_HINTS = frozenset({
    "url",
    "uri",
    "href",
    "link",
    "website",
    "homepage",
    "endpoint",
    "callback",
    "webhook",
})
_EMAIL_KEY_HINTS = frozenset({"email", "e_mail", "mail", "contact_email"})
_PHONE_KEY_HINTS = frozenset({
    "phone",
    "tel",
    "telephone",
    "mobile",
    "cell",
    "fax",
    "hotline",
    "contact_phone",
})

_MEDIA_RULES: tuple[tuple[SemanticType, frozenset[str], frozenset[str]], ...] = (
    (SemanticType.IMAGE_URL, _IMAGE_EXTENSIONS, _IMAGE_KEY_HINTS),
    (SemanticType.VIDEO_URL, _VIDEO_EXTENSIONS, _VIDEO_KEY_HINTS),
    (SemanticType.AUDIO_URL, _AUDIO_EXTENSIONS, _AUDIO_KEY_HINTS),
    (SemanticType.DOCUMENT_URL, _DOCUMENT_EXTENSIONS, _DOCUMENT_KEY_HINTS),
)

_DATE_RANGE_KEY_HINTS = frozenset(
    {"date_range", "daterange", "stay_dates", "booking_window", "date_window"}
)
_DATE_KEY_HINTS = frozenset({
    "date",
    "birthdate",
    "birthday",
    "dob",
    "arrives",
    "departs",
    "check_in",
    "check_out",
    "due_date",
    "expires_on",
})
_TIME_KEY_HINTS = frozenset({
    "time",
    "start_time",
    "end_time",
    "check_in_time",
    "departure_time",
    "arrival_time",
})
_DURATION_SECONDS_KEY_HINTS = frozenset({
    "duration",
    "duration_sec",
    "duration_seconds",
    "skip",
    "skip_forward",
    "skip_backward",
    "timeout",
    "timeout_sec",
    "ttl",
    "ttl_seconds",
})
_DURATION_UNIT_BY_TOKEN: Mapping[str, str] = {
    "ms": "ms",
    "msec": "ms",
    "milliseconds": "ms",
    "sec": "seconds",
    "secs": "seconds",
    "seconds": "seconds",
    "min": "minutes",
    "mins": "minutes",
    "minutes": "minutes",
}

_BOUNDED_KEY_HINTS = frozenset(
    {"progress", "battery", "capacity", "quota", "completion"}
)
_RATING_KEY_HINTS = frozenset(
    {"rating", "stars", "score", "review_score", "satisfaction"}
)
_CURRENCY_KEY_HINTS = frozenset({
    "price",
    "cost",
    "amount",
    "fee",
    "subtotal",
    "tax",
    "balance",
    "salary",
    "budget",
    "revenue",
    "spend",
    "payment",
    "charge",
    "discount",
    "tip",
    "fare",
    "rent",
    "wage",
})
_PERCENT_KEY_HINTS = frozenset({
    "percent",
    "percentage",
    "pct",
    "apr",
    "apy",
    "yield",
    "margin",
    "tax_rate",
    "discount_rate",
    "completion_rate",
    "error_rate",
})
_RATIO_KEY_HINTS = frozenset({
    "ratio",
    "share",
    "fraction",
    "proportion",
    "probability",
    "confidence",
    "likelihood",
    "odds",
})
_COUNT_KEY_HINTS = frozenset({
    "count",
    "num",
    "total_count",
    "items",
    "qty",
    "seats",
    "guests",
    "followers",
    "views",
    "likes",
    "comments",
    "retries",
    "attempts",
    "page_count",
    "word_count",
})
_KEY_UNIT_SUFFIXES: Mapping[str, str] = {
    "kg": "kg",
    "g": "g",
    "mg": "mg",
    "lb": "lb",
    "lbs": "lbs",
    "oz": "oz",
    "km": "km",
    "cm": "cm",
    "mm": "mm",
    "mi": "mi",
    "ft": "ft",
    "gb": "GB",
    "mb": "MB",
    "kb": "KB",
    "tb": "TB",
    "kwh": "kWh",
    "wh": "Wh",
    "kw": "kW",
    "mhz": "MHz",
    "ghz": "GHz",
    "bpm": "bpm",
    "rpm": "rpm",
    "kcal": "kcal",
    "cal": "cal",
    "ml": "mL",
    "celsius": "°C",
    "fahrenheit": "°F",
    "psi": "psi",
}
_CURRENCY_SYMBOL_MAP: Mapping[str, str] = {
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
    "¥": "JPY",
    "₹": "INR",
}
_CURRENCY_CODES = frozenset(
    {"USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "MXN", "BRL"}
)

_COLOR_KEY_HINTS = frozenset({
    "color",
    "colour",
    "bg_color",
    "background_color",
    "text_color",
    "fill_color",
    "stroke_color",
    "accent_color",
    "tint",
})
_STATUS_KEY_HINTS = frozenset({
    "status",
    "state",
    "health",
    "phase",
    "stage",
    "severity",
    "condition",
    "availability",
    "lifecycle",
})
_STATUS_VALUES = frozenset({
    "active",
    "inactive",
    "pending",
    "completed",
    "complete",
    "failed",
    "error",
    "ok",
    "healthy",
    "degraded",
    "unhealthy",
    "critical",
    "warning",
    "online",
    "offline",
    "running",
    "stopped",
    "paused",
    "cancelled",
    "canceled",
    "approved",
    "rejected",
    "draft",
    "published",
    "archived",
    "open",
    "closed",
    "resolved",
    "in_progress",
    "in progress",
    "queued",
    "scheduled",
    "expired",
    "overdue",
    "paid",
    "unpaid",
    "processing",
    "shipped",
    "delivered",
})
_ENUM_KEY_HINTS = frozenset({
    "enum",
    "category",
    "type",
    "kind",
    "tier",
    "plan",
    "role",
    "mode",
    "currency",
    "method",
    "channel",
    "environment",
    "env",
    "direction",
    "side",
    "priority",
})

_CODE_KEY_HINTS = frozenset({
    "code",
    "code_snippet",
    "script",
    "sql_query",
    "sql",
    "regex",
    "command",
    "cmd",
    "shell",
    "expression",
    "expr",
    "formula",
    "source_code",
})
_MARKDOWN_KEY_HINTS = frozenset({"markdown", "md", "rich_text"})
_LONG_TEXT_KEY_HINTS = frozenset({
    "about",
    "bio",
    "biography",
    "description",
    "summary",
    "overview",
    "body",
    "content",
    "notes",
    "comment",
    "message",
    "review",
    "excerpt",
    "snippet",
    "abstract",
    "details",
    "instructions",
    "instruction",
    "story",
})
_IDENTIFIER_KEY_HINTS = frozenset({
    "id",
    "uuid",
    "guid",
    "uid",
    "slug",
    "sku",
    "isbn",
    "asin",
    "vin",
    "iban",
    "ssn",
    "account_id",
    "user_id",
    "order_id",
    "transaction_id",
    "reference_id",
    "ref_id",
    "tracking_number",
    "serial_number",
    "token",
    "api_key",
    "hash",
    "checksum",
    "sha",
    "commit",
    "revision",
})
_NAME_KEY_HINTS = frozenset({
    "name",
    "full_name",
    "fullname",
    "first_name",
    "firstname",
    "last_name",
    "lastname",
    "display_name",
    "username",
    "author",
    "artist",
    "creator",
    "owner",
    "vendor",
    "merchant",
    "company",
    "brand",
    "organization",
})
_TITLE_KEY_HINTS = frozenset({
    "title",
    "headline",
    "heading",
    "subtitle",
    "subheading",
    "subject",
    "topic",
    "tagline",
})


def prose_length_level(word_count: int) -> str:
    """Maps a word count to the `prose.measures.length` level name."""
    if word_count < 15:
        return "line"
    if word_count < 60:
        return "blurb"
    if word_count < 200:
        return "summary"
    return "article"


def _split_key_tokens(key: str) -> tuple[str, ...]:
    """Splits a camelCase, PascalCase, or snake_case key into lowercase tokens."""
    if not key:
        return ()
    spaced = _CAMEL_SPLIT_RE.sub(
        lambda m: f"{m.group(1) or m.group(3)} {m.group(2) or m.group(4)}", key
    )
    parts = [part.lower() for part in _KEY_SEP_RE.split(spaced) if part]
    return tuple(parts)


def humanize_key(key: str) -> str:
    """Formats a raw JSON key or pointer segment as a human-readable label.

    ``"priceFrom"`` becomes ``"Price from"`` and ``"skip_forward"`` becomes
    ``"Skip forward"``.
    """
    tokens = _split_key_tokens(key)
    if not tokens:
        return ""
    joined = " ".join(tokens)
    return joined[0].upper() + joined[1:]


def _match_key_hint(tokens: Sequence[str], hints: Collection[str]) -> str | None:
    """Returns the matching hint token or snake_case compound key, if any."""
    if not tokens:
        return None
    joined = "_".join(tokens)
    if joined in hints:
        return joined
    for token in tokens:
        if token in hints:
            return token
    return None


def _hint_dict(hint: str | None) -> dict[str, Any]:
    """Builds a single-key ``{"keyHint": hint}`` dictionary when `hint` is set."""
    if hint is None:
        return {}
    return {"keyHint": hint}


def _url_extension(text: str) -> str:
    """Extracts the lowercase file extension from a URL or file path."""
    path = urlparse(text).path if "://" in text else text.split("?", 1)[0]
    dot = path.rfind(".")
    if dot == -1:
        return ""
    return path[dot:].lower()


def _image_key_hint(tokens: Sequence[str]) -> dict[str, Any]:
    """Builds the `keyHint` dictionary for an image pointer when matched."""
    for framing in _IMAGE_FRAMING_HINTS:
        if framing in tokens:
            return {"keyHint": framing}
    return _hint_dict(_match_key_hint(tokens, _IMAGE_KEY_HINTS))


def _detect_url_or_media(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `image_url`, `video_url`, `audio_url`, `document_url`, or `url`."""
    if text.startswith("data:image/"):
        return SemanticType.IMAGE_URL, _image_key_hint(tokens)

    is_http = bool(_HTTP_URL_RE.match(text))
    is_url_like = is_http or text.startswith("/")
    ext = _url_extension(text) if ("." in text) else ""

    for sem_type, extensions, key_hints in _MEDIA_RULES:
        matched_hint = _match_key_hint(tokens, key_hints)
        if ext in extensions or (is_url_like and matched_hint is not None):
            hints = (
                _image_key_hint(tokens)
                if sem_type == SemanticType.IMAGE_URL
                else _hint_dict(matched_hint)
            )
            return sem_type, hints

    url_hint = _match_key_hint(tokens, _URL_KEY_HINTS)
    if is_http or (text.startswith("/") and len(text) > 1 and url_hint is not None):
        return SemanticType.URL, _hint_dict(url_hint)
    return None


def _detect_email_or_phone(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `email` or `phone` from scheme prefixes, key hints, or patterns."""
    lower = text.lower()
    if lower.startswith("mailto:") or _EMAIL_RE.match(text):
        return SemanticType.EMAIL, _hint_dict(_match_key_hint(tokens, _EMAIL_KEY_HINTS))
    phone_hint = _match_key_hint(tokens, _PHONE_KEY_HINTS)
    if lower.startswith("tel:") or _PHONE_RE.match(text):
        return SemanticType.PHONE, _hint_dict(phone_hint)
    if phone_hint and sum(ch.isdigit() for ch in text) >= 7:
        return SemanticType.PHONE, {"keyHint": phone_hint}
    return None


def _has_digits(text: str, minimum: int = 1) -> bool:
    """Returns whether `text` contains at least `minimum` ASCII digits."""
    return sum(ch.isdigit() for ch in text) >= minimum


def _is_date_string(text: str, tokens: tuple[str, ...]) -> bool:
    """Returns whether `text` and `tokens` represent a calendar date."""
    if (
        _ISO_DATE_RE.match(text)
        or _SLASH_DATE_RE.match(text)
        or _MONTH_DATE_RE.match(text)
    ):
        return True
    return _match_key_hint(tokens, _DATE_KEY_HINTS) is not None and _has_digits(text, 4)


def _detect_time_from_string(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `date_range`, `datetime`, `date`, `time`, `relative_time`, or `duration`."""
    if _DATE_RANGE_RE.match(text) or (
        _match_key_hint(tokens, _DATE_RANGE_KEY_HINTS) and _has_digits(text)
    ):
        return SemanticType.DATE_RANGE, {}
    if _ISO_DATETIME_RE.match(text):
        return SemanticType.DATETIME, {}
    if _is_date_string(text, tokens):
        return SemanticType.DATE, {}
    if _TIME_RE.match(text) or (
        _match_key_hint(tokens, _TIME_KEY_HINTS) and _has_digits(text)
    ):
        return SemanticType.TIME, {}
    if _RELATIVE_TIME_RE.match(text):
        return SemanticType.RELATIVE_TIME, {}
    if _ISO_DURATION_RE.match(text) or _HUMAN_DURATION_RE.match(text):
        return SemanticType.DURATION, {}
    return None


def _detect_duration_from_number(
    value: int | float, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects numeric `duration` pointers such as `skipForward: 30` or `latencyMs: 12`."""
    if not tokens:
        return None
    if tokens[-1] in _DURATION_UNIT_BY_TOKEN and len(tokens) >= 2:
        unit = _DURATION_UNIT_BY_TOKEN[tokens[-1]]
        return SemanticType.DURATION, {"unit": unit, "keyHint": tokens[-1]}
    hint = _match_key_hint(tokens, _DURATION_SECONDS_KEY_HINTS)
    if hint is not None and value >= 0:
        return SemanticType.DURATION, {"unit": "seconds", "keyHint": hint}
    return None


def _detect_quantity_from_string(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `currency`, `percent`, `rating`, `ratio`, or `quantity` from strings."""
    curr_match = _CURRENCY_STR_RE.match(text)
    if curr_match:
        sym = curr_match.group("sym")
        code = (
            curr_match.group("code1")
            or curr_match.group("code2")
            or _CURRENCY_SYMBOL_MAP.get(sym or "", "USD")
        )
        return SemanticType.CURRENCY, {"currency": code.upper()}
    if _PERCENT_STR_RE.match(text):
        return SemanticType.PERCENT, {}
    if _RATING_STR_RE.match(text):
        return SemanticType.RATING, {}
    if _RATIO_STR_RE.match(text):
        return SemanticType.RATIO, {}
    qty_match = _QUANTITY_STR_RE.match(text)
    if qty_match:
        unit = re.sub(r"\s+", " ", qty_match.group("unit").strip())
        return SemanticType.QUANTITY, {"unit": unit}
    hint = _match_key_hint(tokens, _RATING_KEY_HINTS)
    if hint and text.replace(".", "", 1).isdigit():
        return SemanticType.RATING, {"keyHint": hint}
    return None


def _is_numeric_scalar(val: Any) -> bool:
    """Returns whether `val` is an `int` or `float` (excluding `bool`)."""
    return isinstance(val, (int, float)) and not isinstance(val, bool)


def _detect_bounded_number(
    value: int | float,
    key: str,
    tokens: tuple[str, ...],
    siblings: Mapping[str, Any] | None,
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `bounded` numbers from sibling `min`/`max` bounds or key hints."""
    if siblings and key.lower() not in {
        "min",
        "max",
        "limit",
        "quota",
        "total",
        "step",
    }:
        raw_min = siblings.get("min", 0)
        raw_max = siblings.get("max", siblings.get("limit", siblings.get("quota")))
        if (
            _is_numeric_scalar(raw_min)
            and _is_numeric_scalar(raw_max)
            and raw_min < raw_max
        ):
            return SemanticType.BOUNDED, {"min": raw_min, "max": raw_max}
    hint = _match_key_hint(tokens, _BOUNDED_KEY_HINTS)
    if hint is not None and 0 <= value <= 100:
        upper = 1 if (isinstance(value, float) and value <= 1.0) else 100
        return SemanticType.BOUNDED, {"min": 0, "max": upper, "keyHint": hint}
    return None


def _sibling_string(siblings: Mapping[str, Any] | None, field: str) -> str | None:
    """Returns a non-empty string sibling value for `field`, if present."""
    if not siblings:
        return None
    val = siblings.get(field)
    return val if isinstance(val, str) and val.strip() else None


def _detect_quantity_from_number(
    value: int | float,
    key: str,
    tokens: tuple[str, ...],
    siblings: Mapping[str, Any] | None,
) -> tuple[SemanticType, dict[str, Any]]:
    """Classifies a numeric scalar into a specific Quantity-family `SemanticType`."""
    bounded = _detect_bounded_number(value, key, tokens, siblings)
    if bounded is not None:
        return bounded

    for sem_type, key_hints in (
        (SemanticType.RATING, _RATING_KEY_HINTS),
        (SemanticType.PERCENT, _PERCENT_KEY_HINTS),
        (SemanticType.RATIO, _RATIO_KEY_HINTS),
    ):
        hint = _match_key_hint(tokens, key_hints)
        if hint is not None:
            return sem_type, {"keyHint": hint}

    curr_hint = _match_key_hint(tokens, _CURRENCY_KEY_HINTS)
    if curr_hint is not None:
        hints: dict[str, Any] = {"keyHint": curr_hint}
        sib_curr = _sibling_string(siblings, "currency")
        if sib_curr is not None:
            hints["currency"] = sib_curr
        return SemanticType.CURRENCY, hints

    sib_unit = _sibling_string(siblings, "unit")
    if sib_unit is not None and key.lower() != "unit":
        return SemanticType.QUANTITY, {"unit": sib_unit}

    if len(tokens) >= 2 and tokens[-1] in _KEY_UNIT_SUFFIXES:
        return SemanticType.QUANTITY, {
            "unit": _KEY_UNIT_SUFFIXES[tokens[-1]],
            "keyHint": tokens[-1],
        }

    if isinstance(value, int):
        count_hint = _match_key_hint(tokens, _COUNT_KEY_HINTS)
        if count_hint is not None:
            return SemanticType.COUNT, {"keyHint": count_hint}
        return SemanticType.INTEGER, {}

    return SemanticType.NUMBER, {}


def _detect_color_from_string(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `color` from hex/CSS color strings or color key hints."""
    if _HEX_COLOR_RE.match(text) or _CSS_COLOR_RE.match(text):
        return SemanticType.COLOR, {}
    color_hint = _match_key_hint(tokens, _COLOR_KEY_HINTS)
    if color_hint is not None and len(text) <= 24:
        return SemanticType.COLOR, {"keyHint": color_hint}
    return None


def _detect_state_from_string(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `color`, `status`, or `enum` from a string value and key tokens."""
    color = _detect_color_from_string(text, tokens)
    if color is not None:
        return color

    normalized = text.strip().lower()
    status_hint = _match_key_hint(tokens, _STATUS_KEY_HINTS)
    if normalized in _STATUS_VALUES or (
        status_hint is not None and len(text) <= 32 and " " not in normalized
    ):
        return SemanticType.STATUS, _hint_dict(status_hint)

    enum_hint = _match_key_hint(tokens, _ENUM_KEY_HINTS)
    if text.upper() in _CURRENCY_CODES and (enum_hint == "currency" or text.isupper()):
        return SemanticType.ENUM, _hint_dict(enum_hint)
    if enum_hint is not None and len(text) <= 24 and "\n" not in text:
        return SemanticType.ENUM, {"keyHint": enum_hint}
    return None


def _prose_hints(text: str, key_hint: str | None = None) -> dict[str, Any]:
    """Builds `wordCount`, `length`, and optional `keyHint` hints for prose text."""
    word_count = len(text.split())
    hints: dict[str, Any] = {
        "wordCount": word_count,
        "length": prose_length_level(word_count),
    }
    if key_hint is not None:
        hints["keyHint"] = key_hint
    return hints


def _is_identifier_key_or_value(text: str, tokens: tuple[str, ...]) -> bool:
    """Returns whether `text` and `tokens` represent an `identifier` scalar."""
    if _UUID_RE.match(text) or _HEX_HASH_RE.match(text):
        return True
    if not tokens or " " in text.strip() or len(text) > 64:
        return False
    if _match_key_hint(tokens, _IDENTIFIER_KEY_HINTS) is not None:
        return True
    return len(tokens) >= 2 and tokens[-1] == "id"


def _is_long_text(text: str, long_hint: str | None) -> bool:
    """Returns whether `text` qualifies as `long_text` by length or key hint."""
    word_count = len(text.split())
    if word_count >= 15 or len(text) >= 120:
        return True
    return long_hint is not None and (word_count >= 3 or len(text) >= 20)


def _detect_prose_or_code(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]] | None:
    """Detects `code`, `markdown`, or `long_text` from text content and key hints."""
    code_hint = _match_key_hint(tokens, _CODE_KEY_HINTS)
    if code_hint is not None or _CODE_SYNTAX_RE.search(text):
        return SemanticType.CODE, _hint_dict(code_hint)

    md_hint = _match_key_hint(tokens, _MARKDOWN_KEY_HINTS)
    if md_hint is not None or _MARKDOWN_SYNTAX_RE.search(text):
        return SemanticType.MARKDOWN, _prose_hints(text, md_hint)

    long_hint = _match_key_hint(tokens, _LONG_TEXT_KEY_HINTS)
    if _is_long_text(text, long_hint):
        return SemanticType.LONG_TEXT, _prose_hints(text, long_hint)
    return None


def _detect_text(
    text: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]]:
    """Classifies a non-empty string into one of the Text-family `SemanticType`s."""
    prose_or_code = _detect_prose_or_code(text, tokens)
    if prose_or_code is not None:
        return prose_or_code

    if _is_identifier_key_or_value(text, tokens):
        id_hint = _match_key_hint(tokens, _IDENTIFIER_KEY_HINTS)
        if id_hint is None and tokens and tokens[-1] == "id":
            id_hint = "id"
        return SemanticType.IDENTIFIER, _hint_dict(id_hint)

    name_hint = _match_key_hint(tokens, _NAME_KEY_HINTS)
    if name_hint is not None and len(text) <= 80:
        return SemanticType.NAME, {"keyHint": name_hint}

    title_hint = _match_key_hint(tokens, _TITLE_KEY_HINTS)
    if title_hint is not None and len(text) <= 140:
        return SemanticType.TITLE, {"keyHint": title_hint}

    return SemanticType.STRING, {}


def _classify_string_scalar(
    value: str, tokens: tuple[str, ...]
) -> tuple[SemanticType, dict[str, Any]]:
    """Runs the ordered string detector chain on a non-empty string value."""
    for detector in (
        _detect_url_or_media,
        _detect_time_from_string,
        _detect_email_or_phone,
        _detect_quantity_from_string,
        _detect_state_from_string,
    ):
        detected = detector(value, tokens)
        if detected is not None:
            return detected
    return _detect_text(value, tokens)


def _classify_container(value: Any) -> SemanticType | None:
    """Classifies `None`, `Mapping`, or non-string `Sequence` values."""
    if value is None:
        return SemanticType.EMPTY
    if isinstance(value, Mapping):
        return SemanticType.OBJECT if value else SemanticType.EMPTY
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return SemanticType.ARRAY if value else SemanticType.EMPTY
    return None


def classify_scalar(
    value: Any,
    key: str = "",
    *,
    siblings: Mapping[str, Any] | None = None,
) -> tuple[SemanticType, dict[str, Any]]:
    """Classifies a scalar or container value into a `SemanticType` and hints.

    Detectors run from most specific (key hint and value pattern) to least
    specific (coarse JSON type), so ``priceFrom: 240`` is classified as
    `SemanticType.CURRENCY` before `SemanticType.INTEGER`.

    Args:
      value: The runtime payload value at the pointer.
      key: The unescaped JSON key or last pointer segment.
      siblings: Optional parent mapping for sibling-aware rules (`bounded`
        `min`/`max`, sibling `currency` or `unit`).

    Returns:
      A ``(SemanticType, hints)`` pair.
    """
    container_type = _classify_container(value)
    if container_type is not None:
        return container_type, {}
    if isinstance(value, bool):
        return SemanticType.BOOLEAN, {}

    tokens = _split_key_tokens(key)
    if isinstance(value, (int, float)):
        duration = _detect_duration_from_number(value, tokens)
        if duration is not None:
            return duration
        return _detect_quantity_from_number(value, key, tokens, siblings)

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return SemanticType.EMPTY, {}
        return _classify_string_scalar(stripped, tokens)

    return SemanticType.STRING, {}


def _non_empty_array_entries(
    values: Sequence[Any],
    siblings_per_item: Sequence[Mapping[str, Any]] | None,
) -> list[tuple[Any, Mapping[str, Any] | None]]:
    """Filters out `None` and blank string entries while pairing item siblings."""
    entries: list[tuple[Any, Mapping[str, Any] | None]] = []
    for idx, val in enumerate(values):
        if val is None or (isinstance(val, str) and not val.strip()):
            continue
        sib = (
            siblings_per_item[idx]
            if siblings_per_item and idx < len(siblings_per_item)
            else None
        )
        entries.append((val, sib))
    return entries


def _classify_string_array_column(
    values: Sequence[str], first_type: SemanticType
) -> SemanticType:
    """Refines a string column into `STATUS` or `ENUM` using column statistics."""
    normalized = [v.strip().lower() for v in values]
    if all(item in _STATUS_VALUES for item in normalized):
        return SemanticType.STATUS
    distinct = set(normalized)
    if 1 <= len(distinct) <= 12 and len(distinct) * 2 <= len(normalized):
        return SemanticType.ENUM
    return first_type


def classify_array_field(
    values: Sequence[Any],
    key: str = "",
    *,
    siblings_per_item: Sequence[Mapping[str, Any]] | None = None,
) -> SemanticType:
    """Classifies a column of values across array elements into a `SemanticType`.

    Applies array-level statistics for `SemanticType.STATUS` and
    `SemanticType.ENUM` (low distinct ratio `<= 12` distinct values with
    `<= 50%` uniqueness across non-empty string values) while delegating format
    and key-hint classification to `classify_scalar`.
    """
    non_empty = _non_empty_array_entries(values, siblings_per_item)
    if not non_empty:
        return SemanticType.EMPTY

    first_val, first_sib = non_empty[0]
    first_type, _ = classify_scalar(first_val, key, siblings=first_sib)
    raw_vals = [v for v, _ in non_empty]

    if all(isinstance(v, str) for v in raw_vals) and first_type in {
        SemanticType.STRING,
        SemanticType.STATUS,
        SemanticType.ENUM,
    }:
        return _classify_string_array_column([str(v) for v in raw_vals], first_type)

    if first_type == SemanticType.INTEGER and any(
        isinstance(v, float) for v in raw_vals
    ):
        return SemanticType.NUMBER

    return first_type
