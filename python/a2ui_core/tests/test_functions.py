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

import pytest
import math
from typing import Any
from pydantic import ValidationError
from a2ui.core.rpc import CallOptions
from a2ui.core.schema.v1_0.common_types import FunctionCall

from a2ui.core.basic_catalog.v0_9.function_impls import (
    BASIC_FUNCTION_IMPLEMENTATIONS,
    create_basic_catalog_functions,
)

IMPLS_MAP = {impl.name: impl for impl in BASIC_FUNCTION_IMPLEMENTATIONS}


def invoke(name: str, args: dict, context: Any = None) -> Any:
    impl = IMPLS_MAP.get(name)
    if not impl:
        raise ValueError(f"Function {name} not found")
    if impl.schema:
        validated_args = impl.schema.model_validate(args).model_dump()
    else:
        validated_args = {}
    return impl.execute(validated_args, context)


def test_logical_and():
    assert invoke("and", {"values": [True, True]}) is True
    assert invoke("and", {"values": [True, False]}) is False
    assert invoke("and", {"values": [True]}) is True


def test_logical_or():
    assert invoke("or", {"values": [False, True]}) is True
    assert invoke("or", {"values": [False, False]}) is False


def test_logical_not():
    assert invoke("not", {"value": False}) is True
    assert invoke("not", {"value": True}) is False
    with pytest.raises(ValidationError):
        invoke("not", {})


def test_validation_required():
    assert invoke("required", {"value": "a"}) is True
    assert invoke("required", {"value": ""}) is False
    assert invoke("required", {"value": None}) is False
    with pytest.raises(ValidationError):
        invoke("required", {})


def test_validation_length():
    assert invoke("length", {"value": "abc", "min": 2}) is True
    assert invoke("length", {"value": "abc", "max": 2}) is False
    with pytest.raises(ValidationError):
        invoke("length", {})


def test_validation_numeric():
    assert invoke("numeric", {"value": 10, "min": 5, "max": 15}) is True
    assert invoke("numeric", {"value": 3, "min": 5}) is False
    with pytest.raises(ValidationError):
        invoke("numeric", {})


def test_validation_email():
    assert invoke("email", {"value": "test@example.com"}) is True
    assert invoke("email", {"value": "test.name@example.com"}) is True
    assert invoke("email", {"value": "test+label@example.com"}) is True
    assert invoke("email", {"value": "test@example-domain.com"}) is True

    assert invoke("email", {"value": "invalid"}) is False
    assert invoke("email", {"value": "test@test"}) is False
    assert invoke("email", {"value": "test@test.c"}) is False
    assert invoke("email", {"value": "test@.com"}) is False

    with pytest.raises(ValidationError):
        invoke("email", {})


def test_validation_regex():
    assert invoke("regex", {"value": "abc", "pattern": "^[a-z]+$"}) is True
    assert invoke("regex", {"value": "123", "pattern": "^[a-z]+$"}) is False
    # In python, re.match/re.search throws re.error if pattern is invalid.
    # The RegexImplementation in function_impls.py doesn't catch it currently:
    # lambda args...: bool(re.search(args["pattern"], args["value"]))
    # Let's test that it raises an exception
    with pytest.raises(Exception):
        invoke("regex", {"value": "abc", "pattern": "["})


class MockDataContext:

    def __init__(self, data_model: dict, invoker=None):
        self.data_model = data_model
        self.invoker = invoker

    def resolve_dynamic_value(self, part: Any) -> Any:
        if isinstance(part, dict) and "path" in part:
            path = part["path"].lstrip("/")
            return self.data_model.get(path)
        if isinstance(part, dict) and "call" in part:
            if self.invoker:
                return self.invoker(part["call"], part.get("args", {}))
            raise ValueError("No invoker for call")
        return part


def test_formatting_format_string_static():
    assert invoke("formatString", {"value": "hello world"}) == "hello world"


def test_formatting_format_string_data_binding():
    context = MockDataContext({"a": 10})
    assert (
        invoke("formatString", {"value": "Value: ${a}"}, context=context) == "Value: 10"
    )


def test_formatting_format_string_function_call():
    def mock_invoker(name, args):
        if name == "add":
            return int(args["a"]) + int(args["b"])
        return None

    context = MockDataContext({}, invoker=mock_invoker)
    assert (
        invoke("formatString", {"value": "Result: ${add(a: 5, b: 7)}"}, context=context)
        == "Result: 12"
    )


def test_formatting_format_string_serialization():
    # Test dictionary serialization
    context = MockDataContext({"user": {"name": "Alice", "age": 30}})
    assert (
        invoke("formatString", {"value": "User: ${user}"}, context=context)
        == 'User: {"name":"Alice","age":30}'
    )

    # Test list serialization
    context = MockDataContext({"tags": ["swift", "ios"]})
    assert (
        invoke("formatString", {"value": "Tags: ${tags}"}, context=context)
        == 'Tags: ["swift","ios"]'
    )

    # Test list with null/None preservation
    context = MockDataContext({"vals": [1, None, 3]})
    assert (
        invoke("formatString", {"value": "V = ${vals}"}, context=context)
        == "V = [1,null,3]"
    )

    # Test None/null interpolated as empty string
    context = MockDataContext({"x": None})
    assert (
        invoke("formatString", {"value": "val=${x}end"}, context=context) == "val=end"
    )


def test_formatting_format_number():
    assert invoke("formatNumber", {"value": 1234.56, "decimals": 1}) == "1,234.6"
    assert (
        invoke("formatNumber", {"value": 1234.56, "decimals": 1, "grouping": False})
        == "1234.6"
    )


def test_formatting_format_currency():
    assert (
        invoke("formatCurrency", {"value": 1234.56, "currency": "USD", "decimals": 2})
        == "$1,234.56"
    )
    # An unrecognised code stands in for its own symbol. Because that stand-in
    # is alphabetic, CLDR currency spacing separates it from the amount with
    # U+00A0, exactly as Intl does.
    assert (
        invoke(
            "formatCurrency",
            {"value": 1234.56, "currency": "INVALID-CURRENCY", "decimals": 2},
        )
        == "INVALID-CURRENCY\u00a01,234.56"
    )


def test_formatting_format_date():
    assert (
        invoke("formatDate", {"value": "2025-01-01T12:00:00Z", "format": "yyyy-MM-dd"})
        == "2025-01-01"
    )
    # Test extended date formatting tokens
    dt_str = "2026-03-05T08:04:09Z"
    assert (
        invoke("formatDate", {"value": dt_str, "format": "yy-M-d H:mm:ss"})
        == "26-3-5 8:04:09"
    )
    assert (
        invoke("formatDate", {"value": dt_str, "format": "MMM MMMM E EEEE hh:mm:ss a"})
        == "Mar March Thu Thursday 08:04:09 AM"
    )
    dt_pm_str = "2026-03-05T15:04:09Z"
    assert (
        invoke("formatDate", {"value": dt_pm_str, "format": "h:mm:ss a HH"})
        == "3:04:09 PM 15"
    )
    # Format ISO
    assert (
        invoke("formatDate", {"value": "2025-01-01T12:00:00Z", "format": "ISO"})
        == "2025-01-01T12:00:00.000Z"
    )
    # Invalid date
    assert invoke("formatDate", {"value": "invalid-date", "format": "yyyy"}) == ""


def test_formatting_pluralize():
    assert (
        invoke("pluralize", {"value": 1, "one": "apple", "other": "apples"}) == "apple"
    )
    assert (
        invoke("pluralize", {"value": 2, "one": "apple", "other": "apples"}) == "apples"
    )
    assert (
        invoke("pluralize", {"value": 5, "one": "apple", "other": "apples"}) == "apples"
    )
    assert invoke("pluralize", {"value": 1, "other": "apples"}) == "apples"


def test_actions_open_url():
    # Since openUrl has side effects in browser only and returns None in python, we verify it executes without error.
    assert invoke("openUrl", {"url": "https://google.com"}) is None


def test_localized_formatting():
    def invoke_localized(locale: str, name: str, args: dict) -> Any:
        impls = create_basic_catalog_functions(locale=locale)
        impls_map = {impl.name: impl for impl in impls}
        impl = impls_map.get(name)
        if not impl:
            raise ValueError(f"Function {name} not found")
        if impl.schema:
            validated_args = impl.schema.model_validate(args).model_dump()
        else:
            validated_args = {}
        return impl.execute(validated_args, None)

    # Number
    assert (
        invoke_localized("en-US", "formatNumber", {"value": 1234.56, "decimals": 2})
        == "1,234.56"
    )
    assert (
        invoke_localized("de-DE", "formatNumber", {"value": 1234.56, "decimals": 2})
        == "1.234,56"
    )
    assert (
        invoke_localized("fr-FR", "formatNumber", {"value": 1234.56, "decimals": 2})
        == "1\u202f234,56"
    )

    # Currency
    assert (
        invoke_localized(
            "de-DE",
            "formatCurrency",
            {"value": 1234.56, "currency": "EUR", "decimals": 2},
        )
        == "1.234,56\xa0€"
    )
    assert (
        invoke_localized(
            "en-US",
            "formatCurrency",
            {"value": 1234.56, "currency": "USD", "decimals": 2},
        )
        == "$1,234.56"
    )
    assert (
        invoke_localized(
            "fr-FR",
            "formatCurrency",
            {"value": 1234.56, "currency": "USD", "decimals": 2},
        )
        == "1\u202f234,56\xa0$US"
    )

    # Date
    assert (
        invoke_localized(
            "fr-FR",
            "formatDate",
            {"value": "2026-06-10T12:00:00Z", "format": "EEEE, MMMM d, yyyy"},
        )
        == "mercredi, juin 10, 2026"
    )
    assert (
        invoke_localized(
            "de-DE",
            "formatDate",
            {"value": "2026-06-10T12:00:00Z", "format": "EEEE, MMMM d, yyyy"},
        )
        == "Mittwoch, Juni 10, 2026"
    )

    # Pluralize (Welsh cy locale)
    assert (
        invoke_localized(
            "cy",
            "pluralize",
            {"value": 0, "zero": "dim", "one": "un", "other": "llawer"},
        )
        == "dim"
    )


def test_v10_formatting_matches_web_engine():
    """Pins the v1.0 cases where this engine used to disagree with web_core."""
    from a2ui.core.basic_catalog import v1_0

    impls = {impl.name: impl for impl in v1_0.BASIC_FUNCTION_IMPLEMENTATIONS}
    format_date = impls["formatDate"]
    pluralize = impls["pluralize"]

    # The ISO pattern yields the UTC instant with exactly three fractional
    # digits, matching JavaScript's toISOString(). An offset is resolved
    # rather than echoed back.
    assert (
        format_date.execute({"value": "2025-01-01T12:00:00Z", "format": "ISO"})
        == "2025-01-01T12:00:00.000Z"
    )
    assert (
        format_date.execute({"value": "2025-01-01T12:00:00+02:00", "format": "ISO"})
        == "2025-01-01T10:00:00.000Z"
    )
    assert (
        format_date.execute({"value": "2025-01-01T12:00:00-05:00", "format": "ISO"})
        == "2025-01-01T17:00:00.000Z"
    )
    # A naive timestamp is read as UTC, so the host time zone cannot affect it.
    assert (
        format_date.execute({"value": "2025-01-01T12:00:00", "format": "ISO"})
        == "2025-01-01T12:00:00.000Z"
    )

    # An explicitly empty plural form means "render nothing" for that category
    # rather than "fall through to other".
    assert pluralize.execute({"value": 0, "zero": "", "other": "cats"}) == ""
    assert pluralize.execute({"value": 1, "one": "", "other": "cats"}) == ""
    # An absent category still falls through to other.
    assert pluralize.execute({"value": 0, "other": "cats"}) == "cats"
    assert pluralize.execute({"value": 5, "other": "cats"}) == "cats"


@pytest.mark.parametrize(
    ("pattern", "symbol", "expected"),
    [
        # Symbol precedes the amount and is alphabetic, so the rule fires.
        ("\u00a4#,##0.00", "CHF", "\u00a4\u00a0#,##0.00"),
        # `$` is a Unicode symbol character, so it stays flush.
        ("\u00a4#,##0.00", "$", "\u00a4#,##0.00"),
        # `HK$` ends in a symbol character, and only the adjacent edge counts.
        ("\u00a4#,##0.00", "HK$", "\u00a4#,##0.00"),
        # The pattern already separates the two, so nothing is inserted.
        ("#,##0.00\u00a0\u00a4", "CHF", "#,##0.00\u00a0\u00a4"),
        # Symbol follows the amount with no separator, so the rule fires.
        ("#,##0.00\u00a4", "CHF", "#,##0.00\u00a0\u00a4"),
        # A pattern carrying no placeholder is returned untouched.
        ("#,##0.00", "CHF", "#,##0.00"),
    ],
)
def test_apply_currency_spacing(pattern, symbol, expected):
    """Pins CLDR's root `currencySpacing` rule, which Babel does not apply."""
    from a2ui.core.basic_catalog.locale_formatting import apply_currency_spacing

    assert apply_currency_spacing(pattern, symbol) == expected


@pytest.mark.parametrize("version", ["v0_9", "v1_0"])
def test_format_currency_spacing_matches_web_engine(version):
    """Pins currency spacing against values measured from `Intl`.

    Babel omits CLDR's `currencySpacing`, so without the rule every currency
    with an alphabetic symbol renders flush against the amount while the
    TypeScript engine separates it. These expectations are the exact strings
    `Intl.NumberFormat` produces.
    """
    import importlib

    module = importlib.import_module(
        f"a2ui.core.basic_catalog.{version}.function_impls"
    )
    create = module.create_format_currency_implementation

    def fmt(locale, currency):
        return create(locale).execute(
            {"value": 1234.56, "currency": currency, "decimals": 2}
        )

    # Alphabetic symbols take U+00A0; glyph symbols stay flush.
    assert fmt("en-US", "CHF") == "CHF\u00a01,234.56"
    assert fmt("en-US", "SEK") == "SEK\u00a01,234.56"
    assert fmt("en-US", "USD") == "$1,234.56"
    assert fmt("en-US", "EUR") == "\u20ac1,234.56"
    assert fmt("en-US", "HKD") == "HK$1,234.56"

    # Locales that place the symbol last already space it, so the rule must
    # not double up.
    assert fmt("de-DE", "CHF") == "1.234,56\u00a0CHF"
    assert fmt("de-DE", "USD") == "1.234,56\u00a0$"


@pytest.mark.parametrize("version", ["v0_9", "v1_0"])
def test_format_currency_malformed_code_follows_locale_pattern(version):
    """Pins the malformed-code layout against the web engine.

    `Intl` rejects a code that is not three ASCII letters, so the TypeScript
    engine cannot format one directly and reconstructs the layout instead.
    Babel rejects nothing and places the code wherever the locale's currency
    pattern puts it. These are the exact strings both engines produce; the
    conformance suite compares them byte for byte.
    """
    import importlib

    module = importlib.import_module(
        f"a2ui.core.basic_catalog.{version}.function_impls"
    )
    create = module.create_format_currency_implementation

    def fmt(locale, currency):
        return create(locale).execute(
            {"value": 1234.56, "currency": currency, "decimals": 2}
        )

    # Placement follows the locale, not the caller. Note the U+202F grouping
    # separator in fr-FR.
    assert fmt("en-US", "INVALID-CURRENCY") == "INVALID-CURRENCY\u00a01,234.56"
    assert fmt("de-DE", "INVALID-CURRENCY") == "1.234,56\u00a0INVALID-CURRENCY"
    assert fmt("fr-FR", "INVALID-CURRENCY") == "1\u202f234,56\u00a0INVALID-CURRENCY"
    assert fmt("ja-JP", "INVALID-CURRENCY") == "INVALID-CURRENCY\u00a01,234.56"

    # `XYZ` is unassigned but well formed, so `Intl` accepts it as its own
    # symbol and never reaches the TypeScript fallback. Both engines agree.
    assert fmt("en-US", "XYZ") == "XYZ\u00a01,234.56"
    assert fmt("de-DE", "XYZ") == "1.234,56\u00a0XYZ"


def test_format_currency_uses_latin_digits_for_arabic_locales():
    """Pins the one case where this engine still differs from `Intl`.

    For `ar-EG`, `Intl` shapes digits in Eastern Arabic numerals
    (`١٬٢٣٤٫٥٦`) while Babel emits Latin ones. Babel cannot close the gap:
    asking it for the locale's default numbering system swaps the separators
    to their Arabic forms but leaves the digits Latin, which is worse than
    either engine's output. Babel's default of `latn` is therefore deliberate,
    and this test fails if that default ever changes.
    """
    from a2ui.core.basic_catalog.v1_0.function_impls import (
        create_format_currency_implementation,
    )

    result = create_format_currency_implementation("ar-EG").execute(
        {"value": 1234.56, "currency": "USD", "decimals": 2}
    )
    assert result == "\u200f1,234.56\u00a0US$"


@pytest.mark.parametrize(
    "locale",
    [
        # Well formed, but CLDR carries no such locale. `Intl` falls back here;
        # Babel raises `UnknownLocaleError`.
        "xx-YY",
        "zz",
        # Malformed. `Intl` raises `RangeError`; Babel raises `ValueError`.
        "!!!",
        "not a locale",
    ],
)
def test_get_locale_falls_back_for_unusable_tags(locale):
    """Pins the fallback that keeps an unusable tag from aborting a format."""
    from a2ui.core.basic_catalog.locale_formatting import get_locale

    assert str(get_locale(locale)) == "en_US"


def test_get_locale_resolves_usable_tags():
    """Pins that resolution still accepts both tag separators."""
    from a2ui.core.basic_catalog.locale_formatting import get_locale

    assert str(get_locale(None)) == "en_US"
    assert str(get_locale("")) == "en_US"
    assert str(get_locale("de-DE")) == "de_DE"
    assert str(get_locale("de_DE")) == "de_DE"


@pytest.mark.parametrize("version", ["v0_9", "v1_0"])
@pytest.mark.parametrize("locale", ["xx-YY", "!!!"])
def test_formatting_falls_back_for_unusable_locale(version, locale):
    """Pins that an unusable locale formats as `en-US` rather than raising.

    A catalog carries whatever tag its host passed, and Babel raises for any
    tag CLDR does not carry, which would abort the format call. The TypeScript
    engine falls back for the same tags, so every function here must produce
    the `en-US` result.
    """
    import importlib

    module = importlib.import_module(
        f"a2ui.core.basic_catalog.{version}.function_impls"
    )

    number = module.create_format_number_implementation
    currency = module.create_format_currency_implementation
    date = module.create_format_date_implementation
    pluralize = module.create_pluralize_implementation

    assert number(locale).execute({"value": 1234.56, "decimals": 2}) == "1,234.56"
    assert (
        currency(locale).execute({"value": 1234.56, "currency": "USD", "decimals": 2})
        == "$1,234.56"
    )
    assert (
        date(locale).execute(
            {"value": "2026-06-10T12:00:00Z", "format": "EEEE, MMMM d, yyyy"}
        )
        == "Wednesday, June 10, 2026"
    )
    assert (
        pluralize(locale).execute({"value": 2, "one": "apple", "other": "apples"})
        == "apples"
    )


def test_validation_return_types_v09_vs_v10():
    from a2ui.core.basic_catalog import v0_9, v1_0

    v09_impls = {impl.name: impl for impl in v0_9.BASIC_FUNCTION_IMPLEMENTATIONS}
    v10_impls = {impl.name: impl for impl in v1_0.BASIC_FUNCTION_IMPLEMENTATIONS}

    # v0.9 returns raw boolean
    assert v09_impls["required"].execute({"value": "hello"}) is True
    assert v09_impls["required"].execute({"value": ""}) is False
    assert v09_impls["regex"].execute({"value": "123", "pattern": r"^\d+$"}) is True
    assert v09_impls["regex"].execute({"value": "abc", "pattern": r"^\d+$"}) is False
    assert v09_impls["length"].execute({"value": "abc", "min": 2, "max": 4}) is True
    assert v09_impls["numeric"].execute({"value": 5, "min": 1, "max": 10}) is True
    assert v09_impls["email"].execute({"value": "user@example.com"}) is True

    # v1.0 returns ValidationResult dict {"valid": bool}
    assert v10_impls["required"].execute({"value": "hello"}) == {"valid": True}
    assert v10_impls["required"].execute({"value": ""}) == {"valid": False}
    assert v10_impls["regex"].execute({"value": "123", "pattern": r"^\d+$"}) == {
        "valid": True
    }
    assert v10_impls["regex"].execute({"value": "abc", "pattern": r"^\d+$"}) == {
        "valid": False
    }
    assert v10_impls["length"].execute({"value": "abc", "min": 2, "max": 4}) == {
        "valid": True
    }
    assert v10_impls["numeric"].execute({"value": 5, "min": 1, "max": 10}) == {
        "valid": True
    }
    assert v10_impls["email"].execute({"value": "user@example.com"}) == {"valid": True}

    # @index is in v1.0 but not in v0.9
    assert "@index" not in v09_impls
    assert "@index" in v10_impls
    assert v10_impls["@index"].execute({}, context={"index": 2}) == 2
    assert v10_impls["@index"].execute({"offset": 1}, context={"index": 2}) == 3
    assert v10_impls["@index"].execute({"offset": 10}) == 10


def test_call_agent_function_helper_and_response_event():
    from a2ui.core.catalog import Catalog
    from a2ui.core.processing import MessageProcessor, MessageProcessorOptions
    from a2ui.core.schema import ProtocolVersion

    outbound_msgs = []
    options = MessageProcessorOptions(
        outbound_listener=lambda msg: outbound_msgs.append(msg)
    )
    cat = Catalog("basic", protocol_version=ProtocolVersion.V1_0)
    processor = MessageProcessor([cat], options=options)

    from a2ui.core.rpc import CallOptions
    from a2ui.core.schema.v1_0.common_types import FunctionCall

    # 1. Test call_agent_function emitting outbound callAgentFunction message
    _ = processor.call_agent_function(
        surface_id="s1",
        call=FunctionCall(
            call="verifyProvider",
            catalogId="basic",
            args={"providerId": "PRV-102"},
        ),
        options=CallOptions(
            function_call_id="call-98",
            version="v1.0",
        ),
    )
    assert len(outbound_msgs) == 1
    assert outbound_msgs[0] == {
        "version": "v1.0",
        "callAgentFunction": {
            "surfaceId": "s1",
            "functionCallId": "call-98",
            "callFunction": {
                "call": "verifyProvider",
                "catalogId": "basic",
                "args": {"providerId": "PRV-102"},
            },
        },
    }

    # 2. Test processing inbound agentFunctionResponse message resolving future
    fut = processor.call_agent_function(
        surface_id="s1",
        call=FunctionCall(
            call="verifyProvider",
            catalogId="basic",
            args={"providerId": "PRV-102"},
        ),
        options=CallOptions(
            function_call_id="call-99",
            version="v1.0",
        ),
    )

    processor.process_messages([{
        "version": "v1.0",
        "agentFunctionResponse": {
            "functionCallId": "call-99",
            "value": {"status": "success"},
        },
    }])

    assert fut.done()
    assert fut.result() == {"status": "success"}


def test_call_agent_function_response_done_future():
    import asyncio
    from a2ui.core.catalog import Catalog
    from a2ui.core.processing import MessageProcessor, MessageProcessorOptions
    from a2ui.core.schema import ProtocolVersion

    cat = Catalog("basic", protocol_version=ProtocolVersion.V1_0)
    options = MessageProcessorOptions(outbound_listener=lambda msg: None)
    processor = MessageProcessor([cat], options=options)

    fut = processor.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="someFunc"),
        options=CallOptions(function_call_id="call-done"),
    )
    fut.cancel()  # Mark future as done/cancelled

    # Processing response for done/cancelled future should not crash with InvalidStateError
    processor.process_messages([{
        "version": "v1.0",
        "agentFunctionResponse": {
            "functionCallId": "call-done",
            "value": {"status": "ignored"},
        },
    }])

    assert fut.cancelled()
