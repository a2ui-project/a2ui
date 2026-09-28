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

"""CLDR locale formatting rules that Babel does not implement.

Babel resolves currency patterns and symbols from CLDR, but it does not apply
CLDR's ``currencySpacing`` rule. ICU does, so a JavaScript engine formatting
through ``Intl`` inserts a space that Babel omits::

    Intl    CHF 1,234.56
    Babel   CHF1,234.56

The gap shows up for any currency whose symbol is alphabetic, which includes
assigned codes such as ``CHF``, ``SEK``, ``DKK``, ``CZK`` and ``PLN``, and it
shows up in ``en-US``, the default locale. This module supplies the rule so the
two engines agree.

The module also holds :func:`get_locale`, the one place either catalog version
turns a locale tag into a Babel ``Locale``.
"""

import unicodedata

from babel.core import Locale, UnknownLocaleError

__all__ = ["apply_currency_spacing", "get_locale"]

#: The CLDR currency placeholder.
_CURRENCY_PLACEHOLDER = "\u00a4"

#: The locale every catalog falls back to, matching the TypeScript engine's
#: `DEFAULT_LOCALE`.
_DEFAULT_LOCALE = "en_US"

#: Characters CLDR uses to stand for a digit position in a number pattern.
_DIGIT_PLACEHOLDERS = frozenset("#0")

#: What CLDR's root ``currencySpacing`` inserts. Matches the code point ICU
#: emits, so output compares equal to ``Intl`` without normalisation.
_INSERT_BETWEEN = "\u00a0"


def _is_currency_match(char: str) -> bool:
    """Reports whether ``char`` satisfies CLDR's ``[:^S:]`` currency match.

    The rule fires for a symbol edge that is *not* a Unicode symbol character,
    which in practice means a letter. ``$`` and ``€`` are category ``Sc`` and so
    take no space, while the ``F`` of ``CHF`` does.

    Args:
      char: The edge character of the resolved currency symbol.

    Returns:
      True when the spacing rule applies to this edge.
    """
    return unicodedata.category(char)[0] != "S"


def apply_currency_spacing(pattern: str, symbol: str) -> str:
    """Inserts CLDR ``currencySpacing`` into a currency number pattern.

    Applies the root locale rule: where the currency placeholder sits directly
    against a digit position, and the adjacent edge of the resolved symbol is
    not a Unicode symbol character, separate the two with U+00A0.

    Locales whose pattern already spaces the symbol, such as ``de-DE``
    (``#,##0.00 ¤``), are returned unchanged, because the placeholder does not
    abut a digit position.

    Only the root rule is implemented. CLDR allows a locale to override the
    match sets and the inserted string; no locale in the conformance suite does,
    and Babel does not expose the per-locale data needed to honour an override.

    Args:
      pattern: A CLDR number pattern containing the currency placeholder.
      symbol: The currency symbol Babel will substitute for the placeholder.

    Returns:
      The pattern, with U+00A0 inserted where the rule applies.
    """
    if not symbol or _CURRENCY_PLACEHOLDER not in pattern:
        return pattern

    out: list[str] = []
    for index, char in enumerate(pattern):
        if char != _CURRENCY_PLACEHOLDER:
            out.append(char)
            continue

        # `beforeCurrency`: the symbol follows the number.
        previous = pattern[index - 1] if index else ""
        if (
            previous in _DIGIT_PLACEHOLDERS
            and _is_currency_match(symbol[0])
            and out
            and out[-1] != _INSERT_BETWEEN
        ):
            out.append(_INSERT_BETWEEN)

        out.append(char)

        # `afterCurrency`: the symbol precedes the number.
        following = pattern[index + 1] if index + 1 < len(pattern) else ""
        if following in _DIGIT_PLACEHOLDERS and _is_currency_match(symbol[-1]):
            out.append(_INSERT_BETWEEN)

    return "".join(out)


def get_locale(locale: str | None) -> Locale:
    """Resolves a locale tag to the Babel locale the catalog should format with.

    Falls back to ``en_US`` for an absent tag, for a malformed tag, and for a
    well-formed tag that CLDR does not carry, because the TypeScript engine
    falls back for exactly those three cases and the two engines must agree.
    Babel instead raises, which would abort the whole format call.

    Args:
      locale: A BCP 47 language tag, or None for the default.

    Returns:
      The resolved locale.
    """
    if not locale:
        return Locale(_DEFAULT_LOCALE)
    try:
        return Locale.parse(locale.replace("-", "_"))
    except (UnknownLocaleError, ValueError, TypeError):
        return Locale(_DEFAULT_LOCALE)
