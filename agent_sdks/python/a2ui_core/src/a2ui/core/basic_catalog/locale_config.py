# Copyright 2026 Google LLC
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

from typing import Dict, List, Optional, Any, Callable
from pydantic import BaseModel, Field


class LocaleFormattingRules(BaseModel):
    """Encapsulates all internationalization and formatting rules for a specific locale."""

    decimal_separator: str = "."
    grouping_separator: str = ","
    currency_symbol_after: bool = False
    currency_space_separated: bool = False

    # Month names (1-indexed for convenience matching datetime.month, index 0 is empty string)
    months_long: List[str] = Field(
        default=[
            "",
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ]
    )
    months_short: List[str] = Field(
        default=[
            "",
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ]
    )

    # Weekday names (0-indexed matching datetime.weekday(): Monday=0 ... Sunday=6)
    weekdays_long: List[str] = Field(
        default=[
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]
    )
    weekdays_short: List[str] = Field(
        default=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    )

    # Plural rule selector closure: accepts float value and returns correct morphological category
    plural_category_selector: Any = None


def _plural_en(val: float) -> str:
    return "one" if abs(val) == 1 else "other"


def _plural_fr(val: float) -> str:
    return "one" if abs(val) <= 1 else "other"


def _plural_cy(val: float) -> str:
    if val == 0:
        return "zero"
    if val == 1:
        return "one"
    if val == 2:
        return "two"
    return "other"


_SUPPORTED_LOCALES: Dict[str, LocaleFormattingRules] = {
    "en": LocaleFormattingRules(
        decimal_separator=".",
        grouping_separator=",",
        currency_symbol_after=False,
        currency_space_separated=False,
        plural_category_selector=_plural_en,
    ),
    "de": LocaleFormattingRules(
        decimal_separator=",",
        grouping_separator=".",
        currency_symbol_after=True,
        currency_space_separated=True,
        months_long=[
            "",
            "Januar",
            "Februar",
            "März",
            "April",
            "Mai",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "Dezember",
        ],
        months_short=[
            "",
            "Jan",
            "Feb",
            "Mär",
            "Apr",
            "Mai",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Okt",
            "Nov",
            "Dez",
        ],
        weekdays_long=[
            "Montag",
            "Dienstag",
            "Mittwoch",
            "Donnerstag",
            "Freitag",
            "Samstag",
            "Sonntag",
        ],
        weekdays_short=["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
        plural_category_selector=_plural_en,
    ),
    "fr": LocaleFormattingRules(
        decimal_separator=",",
        grouping_separator=" ",
        currency_symbol_after=True,
        currency_space_separated=True,
        months_long=[
            "",
            "janvier",
            "février",
            "mars",
            "avril",
            "mai",
            "juin",
            "juillet",
            "août",
            "septembre",
            "octobre",
            "novembre",
            "décembre",
        ],
        months_short=[
            "",
            "janv.",
            "févr.",
            "mars",
            "avr.",
            "mai",
            "juin",
            "juil.",
            "août",
            "sept.",
            "oct.",
            "nov.",
            "déc.",
        ],
        weekdays_long=[
            "lundi",
            "mardi",
            "mercredi",
            "jeudi",
            "vendredi",
            "samedi",
            "dimanche",
        ],
        weekdays_short=["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."],
        plural_category_selector=_plural_fr,
    ),
    "es": LocaleFormattingRules(
        decimal_separator=",",
        grouping_separator=".",
        currency_symbol_after=True,
        currency_space_separated=True,
        months_long=[
            "",
            "enero",
            "febrero",
            "marzo",
            "abril",
            "mayo",
            "junio",
            "julio",
            "agosto",
            "septiembre",
            "octubre",
            "noviembre",
            "diciembre",
        ],
        months_short=[
            "",
            "ene.",
            "feb.",
            "mar.",
            "abr.",
            "may.",
            "jun.",
            "jul.",
            "ago.",
            "sept.",
            "oct.",
            "nov.",
            "dic.",
        ],
        weekdays_long=[
            "lunes",
            "martes",
            "miércoles",
            "jueves",
            "viernes",
            "sábado",
            "domingo",
        ],
        weekdays_short=["lun.", "mar.", "mié.", "jue.", "vie.", "sáb.", "dom."],
        plural_category_selector=_plural_en,
    ),
    "cy": LocaleFormattingRules(
        plural_category_selector=_plural_cy,
    ),
}

CURRENCY_SYMBOLS: Dict[str, str] = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "JPY": "¥",
    "CNY": "¥",
    "INR": "₹",
    "CAD": "CA$",
    "AUD": "A$",
    "CHF": "CHF",
}


def register_locale_rules(locale_prefix: str, rules: LocaleFormattingRules) -> None:
    """Registers or updates formatting rules for a new or existing locale."""
    _SUPPORTED_LOCALES[locale_prefix.lower()] = rules


def get_locale_rules(locale_string: Optional[str]) -> LocaleFormattingRules:
    """Resolves formatting rules for a given locale string, falling back to English."""
    if not locale_string:
        return _SUPPORTED_LOCALES["en"]
    prefix = str(locale_string).replace("_", "-").split("-")[0].lower()
    return _SUPPORTED_LOCALES.get(prefix) or _SUPPORTED_LOCALES["en"]
