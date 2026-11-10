# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""The URL security policy contract, its baseline, and the permissive policy."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, fields, replace
import re
from typing import Final, Literal, Protocol, runtime_checkable
from urllib.parse import unquote, urlsplit

UrlContext = Literal["media", "navigation", "iframe"]
"""How a renderer uses a URL, which decides the rules it is checked against.

- `"media"`: loaded automatically without a click, such as an image, video,
  or audio source.
- `"navigation"`: opened when the user acts, such as a link or `openUrl`.
- `"iframe"`: embedded in a frame.
"""

UrlContextAnnotation = Literal["media", "navigation", "iframe", "none"]
"""The URL context a catalog property declares with `x-a2ui-url-context`.

`"none"` states that a property is not a URL, even if its name looks like one
or a built-in list would treat it as one.
"""

URL_CONTEXTS: Final[tuple[UrlContext, ...]] = ("media", "navigation", "iframe")
"""Every URL context, in a stable order."""

_URL_CONTEXT_ANNOTATIONS: Final[frozenset[str]] = frozenset({*URL_CONTEXTS, "none"})

UrlPropertyMap = Mapping[str, Mapping[str, Mapping[str, UrlContextAnnotation]]]
"""URL properties of catalogs that a host can't annotate itself.

Keyed by catalog ID, then component type, then property name, for example
`{"https://maps.example.com/catalog.json": {"MapTile": {"tileUrl": "media"}}}`.
"""


@dataclass(frozen=True, kw_only=True)
class UrlCheckInfo:
    """Details about where a URL comes from, for logging and per-component rules.

    Contexts fill in what they know: `ComponentContext.sanitize_url` adds the
    surface, catalog, component type, and component ID, and the resolver adds
    the property name.

    Attributes:
        surface_id: Identifier of the surface the URL appears on.
        catalog_id: Identifier of the catalog of the component or function
            using the URL.
        component_type: Type of the component using the URL, such as `"Image"`.
        component_id: Identifier of the component instance using the URL.
        property_name: Name of the property holding the URL. Nested properties
            are written as a path, with `[]` for list items, such as
            `"items[].imageUrl"`.
        function_name: Name of the function using the URL, such as `"openUrl"`.
    """

    surface_id: str | None = None
    catalog_id: str | None = None
    component_type: str | None = None
    component_id: str | None = None
    property_name: str | None = None
    function_name: str | None = None


def merge_url_check_info(
    base: UrlCheckInfo, overrides: UrlCheckInfo | None
) -> UrlCheckInfo:
    """Returns `base` with the fields `overrides` sets replacing its own.

    Package-internal.
    """
    if overrides is None:
        return base
    changes = {
        f.name: getattr(overrides, f.name)
        for f in fields(overrides)
        if getattr(overrides, f.name) is not None
    }
    return replace(base, **changes) if changes else base


OpenUrlHandler = Callable[[str, UrlCheckInfo], "None | Awaitable[None]"]
"""Opens a URL that the URL security policy allowed for `openUrl`.

Hosts use it to ask for confirmation, open a browser, or route links
themselves. It only ever receives URLs the policy allowed (and possibly
rewrote), so it is for presentation, not for security decisions. It gets the
URL as the policy returned it; relative URLs are not resolved, since a
headless core has no page location to resolve them against. It may return an
awaitable, which runs on the event loop that owns the surface.
"""


@runtime_checkable
class UrlSecurityPolicy(Protocol):
    """Decides which URLs a renderer may load, open, or embed.

    Set one on `MessageProcessorOptions.url_security_policy`. Every URL a
    policy sees has already passed the built-in baseline checks, and whatever
    it returns is checked by the baseline again, so a policy can only narrow
    or rewrite what the baseline allows.

    A policy may also define two optional attributes, which the SDK reads when
    present:

    - `allow_svg_data_urls` (`bool`): whether `data:image/svg+xml` URLs are
      allowed as `"media"`. The baseline blocks them unless the policy opts in.
    - `url_properties` (`UrlPropertyMap`): URL properties of catalogs the host
      can't annotate. An entry there wins over a catalog's own
      `x-a2ui-url-context` annotation.
    """

    def sanitize_url(
        self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
    ) -> str | None:
        """Returns the URL to use, possibly rewritten, or None to block it.

        Args:
            url: The URL, exactly as the agent or data model gave it.
            context: How the renderer uses the URL.
            info: Where the URL comes from, when known.

        Returns:
            The URL to use, or None when it is blocked.
        """
        ...


# Control characters, spaces, DEL, and backslashes. URL parsers strip or ignore
# some of them and browsers treat backslashes as path separators, either of
# which can hide a different host from a check.
_UNSAFE_CHARACTERS: Final = re.compile(r"[\x00-\x20\x7f\\]")
_SCHEME: Final = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):")
# `https://` followed by a host, not by another slash (which a URL parser
# would otherwise skip, turning `https:///evil.example` into a host).
_HTTP_WITH_AUTHORITY: Final = re.compile(r"^https?://[^/?#]", re.IGNORECASE)
_MEDIA_DATA_URL: Final = re.compile(
    r"^data:(?:image|audio|video)/[a-z0-9!#$&^_.+\-]+[;,]", re.IGNORECASE
)
_SVG_DATA_URL: Final = re.compile(r"^data:image/svg\+xml[;,]", re.IGNORECASE)
_DATA_MEDIA_TYPE: Final = re.compile(
    r"^data:([a-z0-9!#$&^_.+\-]+/[a-z0-9!#$&^_.+\-]+)", re.IGNORECASE
)
# Code points a host may not contain once percent-decoded, besides controls.
_FORBIDDEN_HOST_CHARACTERS: Final = re.compile(r"[\x00-\x20\x7f #%/<>?@\[\\\]^|]")
_DEFAULT_PORTS: Final[dict[str, int]] = {"http": 80, "https": 443}

BaselineUrlKind = Literal["http", "relative", "data", "mailto", "tel"]
"""The scheme-level kind of a URL that passed the baseline checks."""


def check_url_context(context: object) -> UrlContext:
    """Returns `context` if it names a URL context.

    Package-internal.

    Raises:
        ValueError: If `context` is not `"media"`, `"navigation"`, or `"iframe"`.
    """
    if context not in URL_CONTEXTS:
        raise ValueError(
            f"Unknown URL context {context!r}: use 'media', 'navigation', or 'iframe'."
        )
    return context


def is_url_context_annotation(value: object) -> bool:
    """Whether a value is `"media"`, `"navigation"`, `"iframe"`, or `"none"`.

    Package-internal.
    """
    return isinstance(value, str) and value in _URL_CONTEXT_ANNOTATIONS


def normalize_hostname(hostname: str) -> str | None:
    """Normalizes a hostname the way a browser's URL parser does.

    Percent-decodes it, lowercases it, converts it to punycode, and drops a
    trailing dot. IPv6 addresses are wrapped in brackets.

    Package-internal.

    Returns:
        The normalized hostname, or None if it is not a valid host.
    """
    host = unquote(hostname)
    if not host or _FORBIDDEN_HOST_CHARACTERS.search(host):
        return None
    if ":" in host:
        return f"[{host.lower()}]"
    if not host.isascii():
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError:
            return None
    host = host.lower()
    if host.endswith("."):
        host = host[:-1]
    return host or None


def parse_http_authority(url: str) -> tuple[str, int] | None:
    """Returns the normalized hostname and effective port of an http(s) URL.

    Package-internal.

    Returns:
        The hostname and port (the scheme's default when the URL names none),
        or None when the URL has no valid host.
    """
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if not hostname:
        return None
    host = normalize_hostname(hostname)
    if host is None:
        return None
    return host, port if port is not None else _DEFAULT_PORTS[parts.scheme.lower()]


def classify_baseline_url(
    url: object, context: UrlContext, allow_svg_data_urls: bool = False
) -> BaselineUrlKind | None:
    """Runs the built-in baseline checks every URL passes, whatever the policy.

    - Control characters, spaces, and backslashes are rejected anywhere in the
      URL, including at its ends.
    - `http:` and `https:` URLs need `//` and a host (`https:evil.example` and
      protocol-relative `//evil.example` are rejected).
    - `data:` URLs are allowed only as `"media"`, only with an `image/*`,
      `audio/*`, or `video/*` type, and not as `data:image/svg+xml` unless
      `allow_svg_data_urls` is set.
    - `mailto:` and `tel:` are allowed only as `"navigation"`.
    - Relative URLs are allowed as `"media"` and `"navigation"`, not as
      `"iframe"`.
    - Every other scheme (`javascript:`, `file:`, `blob:`, and so on) is
      rejected.

    Package-internal.

    Args:
        url: The URL to check.
        context: How the renderer uses the URL.
        allow_svg_data_urls: Whether `data:image/svg+xml` is allowed as media.

    Returns:
        The kind of URL, or None when the baseline rejects it.
    """
    if not isinstance(url, str) or not url or _UNSAFE_CHARACTERS.search(url):
        return None

    match = _SCHEME.match(url)
    if match is None:
        if url.startswith("//"):
            return None
        return None if context == "iframe" else "relative"
    scheme = match.group(1).lower()
    if scheme in ("http", "https"):
        if _HTTP_WITH_AUTHORITY.match(url) and parse_http_authority(url):
            return "http"
        return None
    if scheme == "data":
        if context != "media" or not _MEDIA_DATA_URL.match(url):
            return None
        if _SVG_DATA_URL.match(url) and not allow_svg_data_urls:
            return None
        return "data"
    if scheme == "mailto":
        return "mailto" if context == "navigation" else None
    if scheme == "tel":
        return "tel" if context == "navigation" else None
    return None


def check_url_baseline(
    url: object, context: UrlContext, allow_svg_data_urls: bool = False
) -> str | None:
    """Returns the URL if it passes `classify_baseline_url`, or None.

    Package-internal.
    """
    if classify_baseline_url(url, context, allow_svg_data_urls) is None:
        return None
    return url  # type: ignore[return-value]


class PermissiveUrlSecurityPolicy:
    """The default policy: allows every URL the built-in baseline allows.

    URLs are returned unchanged.

    Example:
        Same as leaving `url_security_policy` unset, but also allows SVG
        `data:` URLs::

            MessageProcessor(
                [v1_0.BasicCatalog()],
                options=MessageProcessorOptions(
                    url_security_policy=PermissiveUrlSecurityPolicy(
                        allow_svg_data_urls=True
                    ),
                ),
            )
    """

    def __init__(
        self,
        *,
        allow_svg_data_urls: bool = False,
        url_properties: UrlPropertyMap | None = None,
    ) -> None:
        """Creates a permissive policy.

        Args:
            allow_svg_data_urls: Allows `data:image/svg+xml` URLs as media.
            url_properties: URL properties of catalogs the host can't annotate.
        """
        self.allow_svg_data_urls = bool(allow_svg_data_urls)
        self.url_properties = url_properties

    def sanitize_url(
        self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
    ) -> str | None:
        """See `UrlSecurityPolicy.sanitize_url`."""
        del info  # Unused.
        return check_url_baseline(url, context, self.allow_svg_data_urls)


DEFAULT_URL_SECURITY_POLICY: Final[UrlSecurityPolicy] = PermissiveUrlSecurityPolicy()
"""The policy used where none is configured. Package-internal."""


def apply_url_security_policy(
    policy: UrlSecurityPolicy,
    url: object,
    context: UrlContext,
    info: UrlCheckInfo | None = None,
) -> str | None:
    """Checks a URL with the baseline, then the policy, then the baseline again.

    The second baseline check runs on what the policy returned when it
    rewrote the URL. A policy that raises blocks the URL. These are the exact
    semantics the renderer applies; components and functions call
    `sanitize_url` on the context they receive instead, which also reports
    blocked URLs.

    Args:
        policy: The policy to apply.
        url: The URL to check.
        context: How the renderer uses the URL.
        info: Where the URL comes from.

    Returns:
        The URL to use, or None when it is blocked.

    Raises:
        ValueError: If `context` is not a URL context.
    """
    check_url_context(context)
    allow_svg = bool(getattr(policy, "allow_svg_data_urls", False))
    if check_url_baseline(url, context, allow_svg) is None:
        return None
    try:
        result = policy.sanitize_url(url, context, info)  # type: ignore[arg-type]
    except Exception:  # pylint: disable=broad-exception-caught
        # A failing policy must never let a URL through.
        return None
    if not isinstance(result, str):
        return None
    return result if result == url else check_url_baseline(result, context, allow_svg)


def redact_url(url: str) -> str:
    """Returns a form of a URL that is safe to log.

    That is `scheme://host[:port]` for a URL with a host, `data:<media type>`
    for a `data:` URL, `relative` for a relative URL, and `<scheme>:`
    otherwise. The path, query, fragment, user info, and `data:` payload, any
    of which may carry exfiltrated data, are dropped.
    """
    match = _SCHEME.match(url)
    if match is None:
        return "relative"
    scheme = match.group(1).lower()
    if scheme == "data":
        media_type = _DATA_MEDIA_TYPE.match(url)
        return f"data:{media_type.group(1).lower()}" if media_type else "data:"
    # Without `//` (as in `https:evil.example`) a parser could still find a
    # host, but the baseline treats such a URL as having none.
    if scheme in ("http", "https") and _HTTP_WITH_AUTHORITY.match(url):
        authority = parse_http_authority(url)
        if authority is not None:
            host, port = authority
            suffix = "" if port == _DEFAULT_PORTS[scheme] else f":{port}"
            return f"{scheme}://{host}{suffix}"
    return f"{scheme}:"
