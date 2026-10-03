// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// Locale-aware formatting behind the basic catalog's `formatNumber`,
/// `formatCurrency`, `formatDate` and `pluralize` functions.
///
/// Output follows the TypeScript engine (`basic_functions.ts`), which uses
/// `Intl`; this file reaches the same results through `package:intl`.
library;

import 'package:intl/date_symbol_data_local.dart' show dateTimeSymbolMap;
import 'package:intl/date_symbols.dart';
import 'package:intl/intl.dart';

import 'function_support.dart';

/// The locale a basic catalog formats with when none is given.
const String defaultBasicCatalogLocale = 'en-US';

const String _fallbackLocale = 'en_US';

/// Converts a BCP 47 tag such as `en-US` to the `en_US` form `package:intl`
/// uses.
///
/// Falls back to `en_US` when [locale] is missing, malformed, or has no
/// number-format data, so output never depends on the host's ambient locale.
String resolveIntlLocale(String? locale) {
  if (locale == null || locale.isEmpty) return _fallbackLocale;
  try {
    // Tries the tag, then its language alone, so `de-DE` resolves to `de`.
    return Intl.verifiedLocale(
          Intl.canonicalizedLocale(locale),
          NumberFormat.localeExists,
          onFailure: (_) => _fallbackLocale,
        ) ??
        _fallbackLocale;
  } on Object {
    return _fallbackLocale;
  }
}

/// Reads [value] as a fraction-digit count, or null when it is absent or not
/// a number.
int? _digits(Object? value) {
  if (value == null) return null;
  final num digits = toNumber(value);
  if (digits.isNaN || digits.isInfinite) return null;
  return digits.toInt().clamp(0, 20);
}

/// Whether a `grouping` argument turns grouping off. Absent means on.
bool _groupingOff(Object? grouping) => grouping != null && !isTruthy(grouping);

/// Formats [value] with [decimals] fraction digits and optional grouping.
///
/// Returns an empty string when [value] is not a number. Without [decimals]
/// the locale's default precision applies (up to three digits for `en_US`).
String formatNumber(
  Object? value, {
  Object? decimals,
  Object? grouping,
  required String locale,
}) {
  final num number = toNumber(value);
  if (number.isNaN) return '';
  final format = NumberFormat.decimalPattern(locale);
  final int? digits = _digits(decimals);
  if (digits != null) {
    format
      ..minimumFractionDigits = digits
      ..maximumFractionDigits = digits;
  }
  if (_groupingOff(grouping)) format.turnOffGrouping();
  return format.format(number);
}

/// Formats [value] as an amount of the ISO 4217 [currency], for example
/// `$1,234.50`.
///
/// [decimals] defaults to two. The currency code is upper-cased, and a code
/// the locale has no symbol for is shown as the code itself. Returns an empty
/// string when [value] is not a number.
String formatCurrency(
  Object? value, {
  required Object? currency,
  Object? decimals,
  Object? grouping,
  required String locale,
}) {
  final num number = toNumber(value);
  if (number.isNaN) return '';
  final format = NumberFormat.simpleCurrency(
    locale: locale,
    name: coerceToString(currency).toUpperCase(),
    decimalDigits: _digits(decimals) ?? 2,
  );
  if (_groupingOff(grouping)) format.turnOffGrouping();
  return format.format(number);
}

final RegExp _dateTokens = RegExp(
  'yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a',
);

/// The offset at the end of a timestamp's time part: `Z`, `+hh`, `+hhmm` or
/// `+hh:mm`. Matched only after the `T` (or space) that starts the time, so
/// the day of a date-only string such as `2026-09-04` is not read as `-04`.
final RegExp _timeOffset = RegExp(
  r'[T ]\d{2}(?::?\d{2}(?::?\d{2}(?:[.,]\d+)?)?)?(?:([zZ])|([+-])(\d{2})(?::?(\d{2}))?)$',
);

/// A parsed timestamp: the UTC instant, and the same instant shifted so its
/// UTC fields read as the wall-clock time the timestamp was written with.
typedef _Timestamp = ({DateTime instant, DateTime shifted});

/// Parses an ISO 8601 [value]. A timestamp without an offset is read as UTC,
/// never as host-local time.
_Timestamp? _parseTimestamp(String value) {
  final DateTime? parsed = DateTime.tryParse(value);
  if (parsed == null) return null;
  final RegExpMatch? offset = _timeOffset.firstMatch(value);
  final bool hasOffset =
      offset != null && (offset[1] != null || offset[2] != null);
  if (!hasOffset) {
    final utc = DateTime.utc(
      parsed.year,
      parsed.month,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
      parsed.millisecond,
      parsed.microsecond,
    );
    return (instant: utc, shifted: utc);
  }
  final DateTime instant = parsed.toUtc();
  var offsetMinutes = 0;
  if (offset[2] != null) {
    final sign = offset[2] == '-' ? -1 : 1;
    final int hours = int.parse(offset[3]!);
    final int minutes = offset[4] == null ? 0 : int.parse(offset[4]!);
    offsetMinutes = sign * (hours * 60 + minutes);
  }
  return (
    instant: instant,
    shifted: instant.add(Duration(minutes: offsetMinutes)),
  );
}

/// Renders [instant] like JavaScript's `Date.prototype.toISOString()`:
/// UTC, with exactly three fractional digits.
String _toIsoString(DateTime instant) {
  String pad(int value, [int width = 2]) =>
      value.toString().padLeft(width, '0');
  return '${pad(instant.year, 4)}-${pad(instant.month)}-${pad(instant.day)}'
      'T${pad(instant.hour)}:${pad(instant.minute)}:${pad(instant.second)}'
      '.${pad(instant.millisecond, 3)}Z';
}

Map<String, DateSymbols>? _dateSymbols;

DateSymbols _dateSymbolsFor(String locale) {
  final Map<String, DateSymbols> symbols = _dateSymbols ??= dateTimeSymbolMap();
  return symbols[locale] ??
      symbols[locale.split('_').first] ??
      symbols[_fallbackLocale] ??
      symbols['en']!;
}

/// Formats an ISO 8601 timestamp [value] with a TR35 [pattern].
///
/// Supports the tokens `yyyy yy MMMM MMM MM M EEEE E dd d HH H hh h mm ss a`;
/// other text is copied through. A timestamp with an offset keeps its
/// wall-clock fields, so `2026-09-04T23:30:00-05:00` formats as `2026-09-04`.
/// The pattern `ISO` emits the UTC instant as `YYYY-MM-DDTHH:mm:ss.sssZ`.
/// Returns an empty string for a missing or unparseable [value].
String formatDate(
  Object? value, {
  Object? pattern,
  required String locale,
}) {
  if (!isTruthy(value)) return '';
  final _Timestamp? parsed = _parseTimestamp(coerceToString(value));
  if (parsed == null) return '';
  final String format = isTruthy(pattern) ? coerceToString(pattern) : '';
  if (format == 'ISO') return _toIsoString(parsed.instant);

  final DateTime shifted = parsed.shifted;
  final DateSymbols names = _dateSymbolsFor(locale);
  // DateSymbols lists weekdays from Sunday; DateTime numbers Monday as 1.
  final int weekday = shifted.weekday % 7;
  final int hours12 = shifted.hour % 12 == 0 ? 12 : shifted.hour % 12;
  String pad(int value) => value.toString().padLeft(2, '0');

  return (format.isEmpty ? 'yyyy-MM-dd' : format).replaceAllMapped(
    _dateTokens,
    (match) => switch (match[0]) {
      'yyyy' => '${shifted.year}',
      'yy' => pad(shifted.year % 100),
      'MMMM' => names.STANDALONEMONTHS[shifted.month - 1],
      'MMM' => names.STANDALONESHORTMONTHS[shifted.month - 1],
      'MM' => pad(shifted.month),
      'M' => '${shifted.month}',
      'EEEE' => names.STANDALONEWEEKDAYS[weekday],
      'E' => names.STANDALONESHORTWEEKDAYS[weekday],
      'dd' => pad(shifted.day),
      'd' => '${shifted.day}',
      'HH' => pad(shifted.hour),
      'H' => '${shifted.hour}',
      'hh' => pad(hours12),
      'h' => '$hours12',
      'mm' => pad(shifted.minute),
      'ss' => pad(shifted.second),
      'a' => shifted.hour < 12 ? 'AM' : 'PM',
      final String? token => token ?? '',
    },
  );
}

const List<String> _pluralCategories = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
];

/// Picks the entry of [forms] for the quantity [value].
///
/// An explicit `zero`, `one` or `two` form wins for exactly 0, 1 or 2;
/// otherwise the locale's CLDR plural category picks the form. A category
/// without a form falls back to `other`. Presence, not truthiness, decides:
/// an empty string is a valid form.
String pluralize(
  Object? value,
  Map<String, Object?> forms, {
  required String locale,
}) {
  final num number = toNumber(value);
  final String category;
  if (number == 0 && forms.containsKey('zero')) {
    category = 'zero';
  } else if (number == 1 && forms.containsKey('one')) {
    category = 'one';
  } else if (number == 2 && forms.containsKey('two')) {
    category = 'two';
  } else if (number.isNaN || number.isInfinite) {
    category = 'other';
  } else {
    category = Intl.pluralLogic<String>(
      number,
      zero: _pluralCategories[0],
      one: _pluralCategories[1],
      two: _pluralCategories[2],
      few: _pluralCategories[3],
      many: _pluralCategories[4],
      other: _pluralCategories[5],
      locale: locale,
      useExplicitNumberCases: false,
    );
  }
  return coerceToString(forms[category] ?? forms['other']);
}
