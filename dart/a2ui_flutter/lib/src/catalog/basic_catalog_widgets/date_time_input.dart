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

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../model/data_model.dart';
import '../../model/validation_helper.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';

final _schema = S.object(
  description: 'A widget for selecting a date and/or time.',
  properties: {
    'value': A2uiSchemas.stringReference(
      description: 'The selected date and/or time.',
    ),
    'variant': S.string(
      description: 'The input type: date, time, or datetime.',
      enumValues: ['date', 'time', 'datetime'],
    ),
    'min': S.string(
      description:
          'The earliest selectable date (YYYY-MM-DD). Defaults to -9999-01-01.',
    ),
    'max': S.string(
      description:
          'The latest selectable date (YYYY-MM-DD). Defaults to 9999-12-31.',
    ),
    'label': A2uiSchemas.stringReference(
      description: 'The text label for the input field.',
    ),
    'checks': S.list(items: A2uiSchemas.validationCheck()),
  },
  required: ['value'],
);

extension type _DateTimeInputData.fromMap(JsonMap _json) {
  factory _DateTimeInputData({
    required JsonMap value,
    String? variant,
    String? min,
    String? max,
    Object? label,
    List<JsonMap>? checks,
  }) => _DateTimeInputData.fromMap({
    'value': value,
    'variant': variant,
    'min': min,
    'max': max,
    'label': label,
    'checks': checks,
  });

  Object get value => _json['value'] as Object;
  String? get variant => _json['variant'] as String?;
  Object? get label => _json['label'];
  List<JsonMap>? get checks => (_json['checks'] as List?)?.cast<JsonMap>();

  bool get enableDate {
    final String? v = variant;
    if (v == null) {
      if (_json.containsKey('enableDate')) return _json['enableDate'] as bool;
      return true;
    }
    return v == 'date' || v == 'datetime';
  }

  bool get enableTime {
    final String? v = variant;
    if (v == null) {
      if (_json.containsKey('enableTime')) return _json['enableTime'] as bool;
      return true;
    }
    return v == 'time' || v == 'datetime';
  }

  DateTime get firstDate =>
      DateTime.tryParse((_json['min'] as String?) ?? '') ?? DateTime(-9999);
  DateTime get lastDate =>
      DateTime.tryParse((_json['max'] as String?) ?? '') ??
      DateTime(9999, 12, 31);
}

class _DateTimeInput extends StatefulWidget {
  const _DateTimeInput({
    required this.id,
    required this.value,
    required this.path,
    required this.data,
    required this.dataContext,
    required this.onChanged,
    this.label,
    this.checks,
  });

  final String id;
  final String? value;
  final String path;
  final _DateTimeInputData data;
  final DataContext dataContext;
  final VoidCallback onChanged;
  final String? label;
  final List<JsonMap>? checks;

  @override
  State<_DateTimeInput> createState() => _DateTimeInputState();
}

class _DateTimeInputState extends State<_DateTimeInput> {
  String? _errorText;
  StreamSubscription<String?>? _validationSubscription;

  @override
  void initState() {
    super.initState();
    _setupValidation();
  }

  @override
  void didUpdateWidget(_DateTimeInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != oldWidget.value ||
        widget.checks != oldWidget.checks ||
        widget.dataContext != oldWidget.dataContext) {
      _setupValidation();
    }
  }

  void _setupValidation() {
    _validationSubscription?.cancel();
    _validationSubscription = null;

    if (widget.checks == null || widget.checks!.isEmpty) {
      if (_errorText != null && mounted) {
        setState(() => _errorText = null);
      }
      return;
    }

    _validationSubscription =
        ValidationHelper.validateStream(
          widget.checks,
          widget.dataContext,
        ).listen((String? newError) {
          if (newError != _errorText && mounted) {
            setState(() => _errorText = newError);
          }
        });
  }

  @override
  void dispose() {
    _validationSubscription?.cancel();
    super.dispose();
  }

  Future<void> _handleTap(BuildContext context) async {
    final DateTime initialDate =
        DateTime.tryParse(widget.value ?? '') ??
        DateTime.tryParse('1970-01-01T${widget.value}') ??
        DateTime.now();

    var resultDate = initialDate;
    var resultTime = TimeOfDay.fromDateTime(initialDate);

    if (widget.data.enableDate) {
      final DateTime? pickedDate = await showDatePicker(
        context: context,
        initialDate: initialDate,
        firstDate: widget.data.firstDate,
        lastDate: widget.data.lastDate,
      );
      if (pickedDate == null) {
        return;
      }
      resultDate = pickedDate;
    }

    if (widget.data.enableTime) {
      final TimeOfDay? pickedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(initialDate),
      );
      if (pickedTime == null) {
        return;
      }
      resultTime = pickedTime;
    }

    final finalDateTime = DateTime(
      resultDate.year,
      resultDate.month,
      resultDate.day,
      widget.data.enableTime ? resultTime.hour : 0,
      widget.data.enableTime ? resultTime.minute : 0,
    );

    String formattedValue;

    if (widget.data.enableDate && !widget.data.enableTime) {
      formattedValue = finalDateTime.toIso8601String().split('T').first;
    } else if (!widget.data.enableDate && widget.data.enableTime) {
      final String hour = finalDateTime.hour.toString().padLeft(2, '0');
      final String minute = finalDateTime.minute.toString().padLeft(2, '0');
      formattedValue = '$hour:$minute:00';
    } else {
      formattedValue = finalDateTime.toIso8601String();
    }

    widget.dataContext.update(DataPath(widget.path), formattedValue);
    widget.onChanged();
  }

  String _getDisplayText(MaterialLocalizations localizations) {
    if (widget.value == null) {
      return _getPlaceholderText();
    }

    final DateTime? date =
        DateTime.tryParse(widget.value!) ??
        DateTime.tryParse('1970-01-01T${widget.value}');

    if (date == null) {
      return widget.value!;
    }

    final List<String> parts = [
      if (widget.data.enableDate) localizations.formatFullDate(date),
      if (widget.data.enableTime)
        localizations.formatTimeOfDay(TimeOfDay.fromDateTime(date)),
    ];
    return parts.join(' ');
  }

  String _getPlaceholderText() {
    if (widget.data.enableDate && widget.data.enableTime) {
      return 'Select a date and time';
    } else if (widget.data.enableDate) {
      return 'Select a date';
    } else if (widget.data.enableTime) {
      return 'Select a time';
    }
    return 'Select a date/time';
  }

  @override
  Widget build(BuildContext context) {
    final MaterialLocalizations localizations = MaterialLocalizations.of(
      context,
    );
    final String displayText = _getDisplayText(localizations);

    return InputDecorator(
      decoration: InputDecoration(
        labelText: widget.label,
        errorText: _errorText,
        border: const OutlineInputBorder(),
      ),
      child: InkWell(
        onTap: () => _handleTap(context),
        child: Text(
          displayText,
          key: Key('${widget.id}_text'),
          style: Theme.of(context).textTheme.bodyLarge,
        ),
      ),
    );
  }
}

/// A widget for selecting a date and/or time.
///
/// This widget displays a field that, when tapped, opens the native date and/or
/// time pickers. The selected value is stored as a string in the data model
/// path specified by the `value` parameter.
///
/// ## Parameters:
///
/// - `value`: The selected date and/or time, as a string.
/// - `enableDate`: Whether to allow the user to select a date. Defaults to
///   `true`.
/// - `enableTime`: Whether to allow the user to select a time. Defaults to
///   `true`.
/// - `min`: The minimum allowed date.
/// - `max`: The maximum allowed date.
/// - `label`: The label text.
/// - `checks`: Validation checks.
final dateTimeInput = CatalogItem(
  name: 'DateTimeInput',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final dateTimeInputData = _DateTimeInputData.fromMap(
      itemContext.data as JsonMap,
    );
    final Object valueRef = dateTimeInputData.value;
    final path = (valueRef is Map && valueRef.containsKey('path'))
        ? valueRef['path'] as String
        : '${itemContext.id}.value';

    return BoundString(
      dataContext: itemContext.dataContext,
      value: {'path': path},
      builder: (context, value) {
        var effectiveValue = value;
        if (effectiveValue == null) {
          final Object val = dateTimeInputData.value;
          if (val is! Map || !val.containsKey('path')) {
            effectiveValue = val as String?;
          }
        }

        return BoundString(
          dataContext: itemContext.dataContext,
          value: dateTimeInputData.label,
          builder: (context, label) {
            return _DateTimeInput(
              id: itemContext.id,
              value: effectiveValue,
              path: path,
              data: dateTimeInputData,
              dataContext: itemContext.dataContext,
              onChanged: () {},
              label: label,
              checks: dateTimeInputData.checks,
            );
          },
        );
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "DateTimeInput",
          "value": "2026-05-15"
        }
      ]
    ''',
    () => '''
       [
        {
          "id": "root",
          "component": "DateTimeInput",
          "value": {
            "path": "/myDate"
          },
          "variant": "date"
        }
      ]
    ''',
    () => '''
      [
        {
          "id": "root",
          "component": "DateTimeInput",
          "value": {
            "path": "/myTime"
          },
          "variant": "time"
        }
      ]
    ''',
  ],
  isImplicitlyFlexible: true,
);
