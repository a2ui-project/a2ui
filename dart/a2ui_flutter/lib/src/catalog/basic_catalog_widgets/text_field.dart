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
import 'package:flutter/services.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../model/data_model.dart';
import '../../model/ui_models.dart';
import '../../model/validation_helper.dart';
import '../../primitives/logging.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';

class _Fields {
  static const String value = 'value';
  static const String label = 'label';
  static const String checks = 'checks';
  static const String variant = 'variant';
  static const String validationRegexp = 'validationRegexp';
  static const String onSubmittedAction = 'onSubmittedAction';
}

class _Variant {
  static const String shortText = 'shortText';
  static const String longText = 'longText';
  static const String number = 'number';
  static const String obscured = 'obscured';
}

final _componentName = 'TextField';

final _schema = S.object(
  description: 'A text input field.',
  properties: {
    _Fields.value: A2uiSchemas.stringReference(
      description: 'The value of the text field.',
    ),
    _Fields.label: A2uiSchemas.stringReference(),
    _Fields.variant: S.string(
      description:
          '''The kind of input the field accepts. ${_Variant.shortText} (the default) is a single line of text, ${_Variant.longText} is multi-line text, ${_Variant.number} only accepts numeric input, and ${_Variant.obscured} hides the typed characters, e.g. for passwords.''',
      enumValues: [
        _Variant.shortText,
        _Variant.longText,
        _Variant.number,
        _Variant.obscured,
      ],
    ),
    _Fields.checks: A2uiSchemas.checkable(),
    _Fields.validationRegexp: S.string(
      description:
          'A regular expression the value has to match in full for the field '
          'to be valid. An empty field is exempt; use a `required` check to '
          'demand a value at all.',
    ),
    _Fields.onSubmittedAction: A2uiSchemas.action(),
  },
);

extension type _TextFieldData.fromMap(JsonMap _json) {
  factory _TextFieldData({
    Object? value,
    Object? label,
    List<JsonMap>? checks,
    String? variant,
    String? validationRegexp,
    JsonMap? onSubmittedAction,
  }) => _TextFieldData.fromMap({
    _Fields.value: value,
    _Fields.label: label,
    _Fields.checks: checks,
    _Fields.variant: variant,
    _Fields.validationRegexp: validationRegexp,
    _Fields.onSubmittedAction: onSubmittedAction,
  });

  Object? get value => _json[_Fields.value];
  Object? get label => _json[_Fields.label];
  List<JsonMap>? get checks =>
      (_json[_Fields.checks] as List?)?.cast<JsonMap>();
  String? get variant => _json[_Fields.variant] as String?;
  String? get validationRegexp => _json[_Fields.validationRegexp] as String?;
  JsonMap? get onSubmittedAction =>
      _json[_Fields.onSubmittedAction] as JsonMap?;
}

/// Matches a number, as well as the partial input it is typed through, such as
/// `-`, `1.` or `-1.5`.
final _numberPattern = RegExp(r'^-?\d*\.?\d*$');

/// Rejects any edit that would make the text something other than a number.
///
/// Partial input such as `-` or `1.` is accepted so that a number can be typed
/// one character at a time; [num.tryParse] is what decides whether the current
/// text is an actual number.
final _numberFormatter = TextInputFormatter.withFunction(
  (oldValue, newValue) =>
      _numberPattern.hasMatch(newValue.text) ? newValue : oldValue,
);

class _TextField extends StatefulWidget {
  const _TextField({
    required this.initialValue,
    this.label,
    this.checks,
    this.context,
    this.variant,
    this.validationRegexp,
    required this.onChanged,
    required this.onSubmitted,
  });

  final String initialValue;
  final String? label;
  final List<JsonMap>? checks;
  final DataContext? context;
  final String? variant;
  final String? validationRegexp;
  final void Function(String) onChanged;
  final void Function(String) onSubmitted;

  @override
  State<_TextField> createState() => _TextFieldState();
}

/// Shown when the text does not match the component's `validationRegexp`,
/// which, unlike a check, carries no message of its own.
const _invalidFormatMessage = 'Invalid format';

class _TextFieldState extends State<_TextField> {
  late final TextEditingController _controller;
  String? _checkError;
  String? _formatError;
  StreamSubscription<String?>? _validationSubscription;

  /// The error to show, if any.
  ///
  /// A failing check wins over a failing regexp, since it comes with a message
  /// written for this particular field.
  String? get _error => _checkError ?? _formatError;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialValue);
    _formatError = _formatErrorFor(widget.initialValue);
    _setupValidation();
  }

  @override
  void didUpdateWidget(_TextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialValue != _controller.text &&
        !_isSameNumberAsTyped(widget.initialValue)) {
      _controller.text = widget.initialValue;
      // No need to manually calculate error here, stream should handle it if
      // related to value.
    }
    if (widget.checks != oldWidget.checks ||
        widget.context != oldWidget.context) {
      _setupValidation();
    }
    // A build follows, so the new error does not need a `setState`.
    _formatError = _formatErrorFor(_controller.text);
  }

  /// The error for [text] not matching [_TextField.validationRegexp], or `null`
  /// when it matches.
  ///
  /// The pattern has to match all of [text], and an empty field is exempt, so
  /// that this behaves like the HTML `pattern` attribute that other A2UI
  /// renderers map this property to. Demanding a value at all is what a
  /// `required` check is for.
  String? _formatErrorFor(String text) {
    final String? pattern = widget.validationRegexp;
    if (pattern == null || text.isEmpty) return null;
    final RegExp regexp;
    try {
      regexp = RegExp('^(?:$pattern)\$');
    } on FormatException catch (error) {
      genUiLogger.warning('Invalid validationRegexp "$pattern": $error');
      return null;
    }
    return regexp.hasMatch(text) ? null : _invalidFormatMessage;
  }

  /// Whether [value] is just another spelling of the number already in the
  /// field, such as `-1.0` for a field the user has typed `-1.` into.
  ///
  /// A number variant writes a [num] to the data model, which comes back as its
  /// canonical string. Overwriting the field with that string would rewrite the
  /// text mid-edit, so that typing `-1.5` would land on `-1.05`.
  bool _isSameNumberAsTyped(String value) {
    if (widget.variant != _Variant.number) return false;
    final num? parsed = num.tryParse(value);
    return parsed != null && parsed == num.tryParse(_controller.text);
  }

  void _setupValidation() {
    _validationSubscription?.cancel();
    _validationSubscription = null;

    if (widget.checks == null ||
        widget.checks!.isEmpty ||
        widget.context == null) {
      if (_checkError != null && mounted) {
        setState(() => _checkError = null);
      }
      return;
    }

    _validationSubscription =
        ValidationHelper.validateStream(widget.checks, widget.context).listen((
          String? newError,
        ) {
          if (newError != _checkError && mounted) {
            setState(() => _checkError = newError);
          }
        });
  }

  @override
  void dispose() {
    _controller.dispose();
    _validationSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String? variant = widget.variant;
    final isObscured = variant == _Variant.obscured;
    final isLongText = variant == _Variant.longText;
    final isNumber = variant == _Variant.number;

    return TextField(
      controller: _controller,
      decoration: InputDecoration(labelText: widget.label, errorText: _error),
      obscureText: isObscured,
      // Suggestions and autocorrect would leak or corrupt a password, and are
      // meaningless for numbers.
      autocorrect: !isObscured && !isNumber,
      enableSuggestions: !isObscured && !isNumber,
      // `null` lets the field grow with its content; obscured text is only
      // valid on a single line.
      maxLines: isLongText ? null : 1,
      minLines: isLongText ? 3 : null,
      keyboardType: switch (variant) {
        _Variant.number => const TextInputType.numberWithOptions(
          signed: true,
          decimal: true,
        ),
        _Variant.longText => .multiline,
        _ => .text,
      },
      // The keyboard type is only a hint, so numbers are also enforced here,
      // which is what stops non-numeric input on desktop and web.
      inputFormatters: isNumber ? [_numberFormatter] : null,
      onChanged: (val) {
        // Checks are handled via data model updates + stream, but the regexp
        // is checked against the text itself.
        final String? formatError = _formatErrorFor(val);
        if (formatError != _formatError) {
          setState(() => _formatError = formatError);
        }
        widget.onChanged(val);
      },
      onSubmitted: (val) {
        // Validation is handled via data model updates + stream
        // But we check current error state before submitting.
        if (_error == null) {
          widget.onSubmitted(val);
        }
      },
    );
  }
}

/// A Material Design text field.
///
/// This widget allows the user to enter and edit text. The `text` parameter
/// bidirectionally binds the field's content to the data model. This is
/// analogous to Flutter's [TextField] widget.
///
/// ## Parameters:
///
/// - `value`: The initial value of the text field.
/// - `label`: The text to display as the label for the text field.
/// - `variant`: The kind of input the field accepts. Can be `shortText` (the
///   default), `longText`, `number`, or `obscured`.
/// - `checks`: Validation checks to run against the field's value.
/// - `validationRegexp`: A regular expression the value has to match in full.
///   An empty field is exempt, matching the HTML `pattern` attribute that other
///   A2UI renderers map this to.
/// - `onSubmittedAction`: The action to perform when the user submits the
///   text field. A `longText` field is not submitted by pressing enter, since
///   that inserts a newline instead.
final textField = CatalogItem(
  name: _componentName,
  isImplicitlyFlexible: true,
  dataSchema: _schema,
  exampleData: [
    () =>
        '''
      [
        {
          "id": "root",
          "component": "$_componentName",
          "${_Fields.label}": "Enter your name here:",
          "${_Fields.variant}": "${_Variant.shortText}"
        }
      ]
    ''',
    () =>
        '''
      [
        {
          "id": "root",
          "component": "$_componentName",
          "${_Fields.label}": "Type your story here:",
          "${_Fields.variant}": "${_Variant.longText}"
        }
      ]
    ''',
    () =>
        '''
      [
        {
          "id": "root",
          "component": "$_componentName",
          "${_Fields.label}": "Type your story here:",
          "${_Fields.variant}": "${_Variant.longText}",
          "${_Fields.value}": "Once upon a time..."
        }
      ]
    ''',
    () =>
        '''
      [
        {
          "id": "root",
          "component": "$_componentName",
          "${_Fields.label}": "What is minimum allowed temperature?",
          "${_Fields.variant}": "${_Variant.number}"
        }
      ]
    ''',
    () =>
        '''
      [
        {
          "id": "root",
          "component": "$_componentName",
          "${_Fields.label}": "Enter your password here",
          "${_Fields.variant}": "${_Variant.obscured}"
        }
      ]
    ''',
    // A price, written with a dollar sign, greater than zero, and with at most
    // two decimals. Character classes keep the pattern free of backslashes,
    // which would have to be escaped again to survive JSON.
    () =>
        '''
      [
        {
          "id": "root",
          "component": "$_componentName",
          "${_Fields.label}": "What price do you want to offer, e.g. \$9.99?",
          "${_Fields.variant}": "${_Variant.shortText}",
          "${_Fields.validationRegexp}": "[\$](?:[1-9][0-9]*(?:[.][0-9]{1,2})?|0[.](?:[1-9][0-9]?|[0-9][1-9]))"
        }
      ]
    ''',
  ],
  widgetBuilder: (itemContext) {
    final textFieldData = _TextFieldData.fromMap(itemContext.data as JsonMap);
    final Object? valueRef = textFieldData.value;
    final path = (valueRef is Map && valueRef.containsKey('path'))
        ? valueRef['path'] as String
        : '${itemContext.id}.${_Fields.value}';
    return BoundString(
      dataContext: itemContext.dataContext,
      value: {'path': path},
      builder: (context, currentValue) {
        return BoundString(
          dataContext: itemContext.dataContext,
          value: textFieldData.label,
          builder: (context, label) {
            final String? effectiveValue =
                currentValue?.toString() ??
                (valueRef is String ? valueRef : null);

            return _TextField(
              initialValue: effectiveValue ?? '',
              label: label,
              checks: textFieldData.checks,
              context: itemContext.dataContext,
              variant: textFieldData.variant,
              validationRegexp: textFieldData.validationRegexp,
              onChanged: (newValue) {
                if (textFieldData.variant == _Variant.number) {
                  final num? numberValue = num.tryParse(newValue);
                  if (numberValue != null) {
                    itemContext.dataContext.update(DataPath(path), numberValue);
                    return;
                  }
                }
                itemContext.dataContext.update(DataPath(path), newValue);
              },
              onSubmitted: (newValue) async {
                final JsonMap? actionData = textFieldData.onSubmittedAction;
                if (actionData == null) {
                  return;
                }

                if (actionData.containsKey('event')) {
                  final eventMap = actionData['event'] as JsonMap;
                  final actionName = eventMap['name'] as String;
                  final contextDefinition = eventMap['context'] as JsonMap?;
                  final JsonMap resolvedContext = await resolveContext(
                    itemContext.dataContext,
                    contextDefinition,
                  );
                  itemContext.dispatchEvent(
                    UserActionEvent(
                      name: actionName,
                      sourceComponentId: itemContext.id,
                      context: resolvedContext,
                    ),
                  );
                } else if (actionData.containsKey('functionCall')) {
                  final funcMap = actionData['functionCall'] as JsonMap;
                  final callName = funcMap['call'] as String;
                  if (callName == 'closeModal') {
                    if (itemContext.buildContext.mounted) {
                      Navigator.of(itemContext.buildContext).pop();
                    }
                    return;
                  }
                  final Stream<Object?> resultStream = itemContext.dataContext
                      .resolve(funcMap);
                  await resultStream.first;
                }
              },
            );
          },
        );
      },
    );
  },
);
