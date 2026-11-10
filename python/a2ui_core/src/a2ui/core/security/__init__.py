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

"""URL security policy.

The contract hosts implement or configure, the built-in policies, and the
schema helper that marks catalog properties as URLs.
"""

from ._basic_catalog_url_properties import (
    BASIC_CATALOG_URL_PROPERTIES as BASIC_CATALOG_URL_PROPERTIES,
)
from .allowlist_url_security_policy import (
    AllowlistUrlSecurityPolicy as AllowlistUrlSecurityPolicy,
    UrlRewriteHook as UrlRewriteHook,
)
from .url_schema import (
    URL_CONTEXT_KEYWORD as URL_CONTEXT_KEYWORD,
    url_context_of as url_context_of,
    url_property as url_property,
)
from .url_security_policy import (
    OpenUrlHandler as OpenUrlHandler,
    PermissiveUrlSecurityPolicy as PermissiveUrlSecurityPolicy,
    URL_CONTEXTS as URL_CONTEXTS,
    UrlCheckInfo as UrlCheckInfo,
    UrlContext as UrlContext,
    UrlContextAnnotation as UrlContextAnnotation,
    UrlPropertyMap as UrlPropertyMap,
    UrlSecurityPolicy as UrlSecurityPolicy,
    apply_url_security_policy as apply_url_security_policy,
    redact_url as redact_url,
)

__all__ = [
    "AllowlistUrlSecurityPolicy",
    "BASIC_CATALOG_URL_PROPERTIES",
    "OpenUrlHandler",
    "PermissiveUrlSecurityPolicy",
    "URL_CONTEXTS",
    "URL_CONTEXT_KEYWORD",
    "UrlCheckInfo",
    "UrlContext",
    "UrlContextAnnotation",
    "UrlPropertyMap",
    "UrlRewriteHook",
    "UrlSecurityPolicy",
    "apply_url_security_policy",
    "redact_url",
    "url_context_of",
    "url_property",
]
