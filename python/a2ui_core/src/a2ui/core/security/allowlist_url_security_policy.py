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

"""A URL security policy that limits each URL context to a list of hosts."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
import re
from typing import Final
from urllib.parse import urlsplit

from .url_security_policy import (
    UrlCheckInfo,
    UrlContext,
    UrlPropertyMap,
    check_url_context,
    classify_baseline_url,
    normalize_hostname,
    parse_http_authority,
)

UrlRewriteHook = Callable[[str, UrlContext, "UrlCheckInfo | None"], "str | None"]
"""Rewrites an allowed URL, for example to route it through a proxy.

Called with the URL, its context, and where it comes from. Returns the URL to
use, or None to block it.
"""

# Characters that can't appear in a bare host entry.
_INVALID_HOST_ENTRY: Final = re.compile(r"[/?#@*\s\\]")


@dataclass(frozen=True)
class _HostMatcher:
    # Exact hosts (or `host:port` pairs).
    exact: frozenset[str]
    # Subdomain suffixes, with a leading dot, for wildcard entries.
    suffixes: tuple[str, ...]
    # Whether an entry has a port, so the comparison also uses `host:port`.
    with_port: bool


class AllowlistUrlSecurityPolicy:
    """A policy that limits each URL context to a list of hosts.

    Host entries are exact hosts (`cdn.example.com`) or subdomain wildcards
    (`*.example.com`, which matches `a.example.com` and `a.b.example.com` but
    not `example.com`), compared case-insensitively. An entry with a port
    (`localhost:8080`) matches only that port; one without matches any port.

    Once a context has a list, relative URLs are blocked for it unless the
    context is in `allow_relative`. URLs without a host (`data:` media,
    `mailto:` and `tel:` links) make no request to a server, so the lists
    don't apply to them; the baseline still limits them to their contexts.

    Example:
        ::

            MessageProcessor(
                [v1_0.BasicCatalog()],
                options=MessageProcessorOptions(
                    url_security_policy=AllowlistUrlSecurityPolicy(
                        media=["cdn.example.com", "*.googleusercontent.com"],
                        navigation=["*.example.com"],
                        rewrite={
                            "media": lambda url, context, info: (
                                "https://proxy.example.com/?u=" + quote(url, safe="")
                            ),
                        },
                    ),
                ),
            )
    """

    def __init__(
        self,
        *,
        media: Sequence[str] | None = None,
        navigation: Sequence[str] | None = None,
        iframe: Sequence[str] | None = None,
        allow_relative: Iterable[UrlContext] = (),
        rewrite: Mapping[UrlContext, UrlRewriteHook] | None = None,
        allow_svg_data_urls: bool = False,
        url_properties: UrlPropertyMap | None = None,
    ) -> None:
        """Creates an allowlist policy.

        Args:
            media: Hosts that media URLs may point to. Leaving it out keeps
                media at the baseline checks; an empty list blocks every
                http(s) media URL.
            navigation: Hosts that navigation URLs may point to.
            iframe: Hosts that iframe URLs may point to.
            allow_relative: Contexts that keep allowing relative URLs even
                though they have a host list. A context with a host list
                blocks relative URLs by default.
            rewrite: Hooks that rewrite URLs the lists allowed, per context.
                The rewritten URL still has to pass the baseline checks.
            allow_svg_data_urls: Allows `data:image/svg+xml` URLs as media.
            url_properties: URL properties of catalogs the host can't annotate.

        Raises:
            ValueError: If a host entry is not a host, a host with a port, or a
                `*.` wildcard, or if `allow_relative` or `rewrite` names an
                unknown context.
        """
        self.allow_svg_data_urls = bool(allow_svg_data_urls)
        self.url_properties = url_properties
        self._allow_relative: frozenset[str] = frozenset(
            check_url_context(context) for context in allow_relative
        )
        self._rewrite: dict[str, UrlRewriteHook] = {
            check_url_context(context): hook
            for context, hook in (rewrite or {}).items()
        }
        hosts_by_context = {"media": media, "navigation": navigation, "iframe": iframe}
        self._matchers: dict[str, _HostMatcher] = {
            context: _compile_hosts(hosts, context)
            for context, hosts in hosts_by_context.items()
            if hosts is not None
        }

    def sanitize_url(
        self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
    ) -> str | None:
        """See `UrlSecurityPolicy.sanitize_url`."""
        kind = classify_baseline_url(url, context, self.allow_svg_data_urls)
        if kind is None:
            return None
        matcher = self._matchers.get(context)
        if matcher is not None:
            if kind == "relative" and context not in self._allow_relative:
                return None
            if kind == "http" and not _matches_host(matcher, url):
                return None
        hook = self._rewrite.get(context)
        return hook(url, context, info) if hook is not None else url


def _compile_hosts(hosts: Sequence[str], context: str) -> _HostMatcher:
    if isinstance(hosts, str):
        raise ValueError(
            f"The {context} host list must be a list of hosts, not the string"
            f" {hosts!r}."
        )
    exact: set[str] = set()
    suffixes: list[str] = []
    with_port = False
    for entry in hosts:
        is_wildcard = isinstance(entry, str) and entry.startswith("*.")
        normalized = _normalize_host_entry(entry[2:] if is_wildcard else entry)
        if normalized is None:
            raise ValueError(
                f"Invalid {context} host entry {entry!r}: use a host such as"
                " 'cdn.example.com', a host with a port, or a subdomain wildcard"
                " such as '*.example.com'."
            )
        host, has_port = normalized
        with_port = with_port or has_port
        if is_wildcard:
            suffixes.append(f".{host}")
        else:
            exact.add(host)
    return _HostMatcher(frozenset(exact), tuple(suffixes), with_port)


def _normalize_host_entry(entry: object) -> tuple[str, bool] | None:
    """Normalizes a host entry the way URL hosts are normalized.

    Returns:
        The host (with `:port` when the entry names a port) and whether it has
        a port, or None if the entry is not a bare host with an optional port.
    """
    if not isinstance(entry, str) or not entry or _INVALID_HOST_ENTRY.search(entry):
        return None
    try:
        parts = urlsplit(f"https://{entry}")
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if not hostname:
        return None
    host = normalize_hostname(hostname)
    if host is None:
        return None
    # A port limits matches to that port, even the scheme's default one.
    if port is None:
        return host, False
    return f"{host}:{port}", True


def _matches_host(matcher: _HostMatcher, url: str) -> bool:
    authority = parse_http_authority(url)
    if authority is None:
        return False
    host, port = authority
    candidates = [host]
    if matcher.with_port:
        candidates.append(f"{host}:{port}")
    return any(
        candidate in matcher.exact
        or any(candidate.endswith(suffix) for suffix in matcher.suffixes)
        for candidate in candidates
    )
