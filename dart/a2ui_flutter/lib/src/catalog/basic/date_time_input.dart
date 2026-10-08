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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/material.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import 'unbounded_width.dart';
import 'write_back.dart';

/// Builds the basic `DateTimeInput` component: a field showing `value` that
/// opens a date picker when `enableDate` is set, then a time picker when
/// `enableTime` is set. With neither set it is a date input. Removing the
/// field closes its open picker.
///
/// The picked value is written to the bound `value` path as `YYYY-MM-DD`,
/// `HH:MM:SS`, or a local date-time (a UTC one when `value` has a time zone),
/// clamped to the `min` and `max` in effect when it is written. A date or
/// date-time `min` or `max` also limits the date picker. A `HH:MM[:SS]` one
/// applies to a time alone. A literal `value` renders the field disabled.
Widget buildDateTimeInput(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final bool time = props.boolean('enableTime') ?? false;
  final bool date = (props.boolean('enableDate') ?? false) || !time;
  DateTime? bound(String key) {
    final String text = props.string(key) ?? '';
    return DateTime.tryParse(date ? text : '1970-01-01T$text')?.toLocal();
  }

  return _DateTimeInput(
    date: date,
    time: time,
    value: props.string('value') ?? '',
    min: bound('min'),
    max: bound('max'),
    label: props.string('label'),
    onChanged: writerFor(context, props, 'value'),
    error: props.validationErrors.firstOrNull,
  );
}

/// Parses an ISO 8601 date, date-time or `HH:MM[:SS]` time in local time.
DateTime? _parse(String text) =>
    (DateTime.tryParse(text) ?? DateTime.tryParse('1970-01-01T$text'))
        ?.toLocal();

class _DateTimeInput extends StatefulWidget {
  const _DateTimeInput({
    required this.date,
    required this.time,
    required this.value,
    required this.min,
    required this.max,
    required this.label,
    required this.onChanged,
    required this.error,
  });

  final bool date;
  final bool time;
  final String value;
  final DateTime? min;
  final DateTime? max;
  final String? label;
  final void Function(Object? value)? onChanged;
  final String? error;

  @override
  State<_DateTimeInput> createState() => _DateTimeInputState();
}

class _DateTimeInputState extends State<_DateTimeInput> {
  /// The route of the picker opened last.
  Route<Object?>? _picker;

  @override
  void dispose() {
    if (_picker case final picker? when picker.isActive) {
      picker.navigator!.removeRoute(picker);
    }
    super.dispose();
  }

  /// Shows [dialog] in a dialog route on the root navigator and returns the
  /// value it is closed with.
  Future<T?> _show<T>(Widget dialog) {
    final NavigatorState navigator = Navigator.of(context, rootNavigator: true);
    final route = DialogRoute<T>(
      context: context,
      builder: (_) => dialog,
      themes: InheritedTheme.capture(from: context, to: navigator.context),
      barrierColor: DialogTheme.of(context).barrierColor ?? Colors.black54,
      traversalEdgeBehavior: TraversalEdgeBehavior.closedLoop,
    );
    _picker = route;
    return navigator.push(route);
  }

  Future<void> _pick() async {
    final DateTime current = _parse(widget.value) ?? DateTime.now();
    var picked = current;

    if (widget.date) {
      DateTime first = DateUtils.dateOnly(widget.min ?? DateTime(1));
      DateTime last = DateUtils.dateOnly(widget.max ?? DateTime(9999, 12, 31));
      if (first.isAfter(last)) {
        (first, last) = (DateTime(1), DateTime(9999, 12, 31));
      }
      final DateTime? day = await _show(
        DatePickerDialog(
          initialDate: current.isBefore(first)
              ? first
              : current.isAfter(last)
              ? last
              : current,
          firstDate: first,
          lastDate: last,
        ),
      );
      if (!mounted || day == null) return;
      picked = day;
    }

    if (widget.time) {
      final TimeOfDay? time = await _show(
        TimePickerDialog(initialTime: TimeOfDay.fromDateTime(current)),
      );
      if (!mounted || time == null) return;
      final day = widget.date ? picked : DateTime(1970);
      picked = DateTime(day.year, day.month, day.day, time.hour, time.minute);
    }

    final DateTime? min = widget.min;
    final DateTime? max = widget.max;
    // A min after max is ignored, as it is in the picker.
    if (min == null || max == null || !min.isAfter(max)) {
      if (min != null && picked.isBefore(min)) picked = min;
      if (max != null && picked.isAfter(max)) picked = max;
    }
    widget.onChanged?.call(switch ((widget.date, widget.time)) {
      (true, true) when DateTime.tryParse(widget.value)?.isUtc ?? false =>
        picked.toUtc().toIso8601String(),
      (true, true) => picked.toIso8601String(),
      (true, false) => picked.toIso8601String().substring(0, 10),
      _ => [picked.hour, picked.minute, picked.second].map(_two).join(':'),
    });
  }

  String _display(BuildContext context) {
    final DateTime? moment = _parse(widget.value);
    if (moment == null) return widget.value;
    final MaterialLocalizations localizations = MaterialLocalizations.of(
      context,
    );
    return [
      if (widget.date) localizations.formatShortDate(moment),
      if (widget.time)
        localizations.formatTimeOfDay(
          TimeOfDay.fromDateTime(moment),
          alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
        ),
    ].join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final String display = _display(context);
    return limitUnboundedWidth(
      context,
      InkWell(
        onTap: widget.onChanged == null ? null : _pick,
        child: InputDecorator(
          isEmpty: display.isEmpty,
          decoration: InputDecoration(
            enabled: widget.onChanged != null,
            labelText: widget.label,
            errorText: widget.error,
            border: const OutlineInputBorder(),
            suffixIcon: Icon(
              widget.date ? Icons.calendar_today : Icons.access_time,
            ),
          ),
          child: Text(display),
        ),
      ),
    );
  }
}

String _two(int n) => n.toString().padLeft(2, '0');
