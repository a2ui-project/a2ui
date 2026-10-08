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
import 'package:flutter/services.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import 'unbounded_width.dart';
import 'write_back.dart';

/// Builds the basic `TextField` component: a text input labelled `label`
/// that writes every edit to the path `value` is bound to, and otherwise
/// keeps the edit itself. An edit the data model rejects is replaced by the
/// bound value.
Widget buildTextField(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) => limitUnboundedWidth(
  context,
  _TextField(
    label: props.string('label'),
    value: props.string('value') ?? '',
    variant: props.string('variant'),
    pattern: props.string('validationRegexp'),
    error: props.validationErrors.firstOrNull,
    write: writerFor(context, props, 'value'),
  ),
);

/// Shown when the text does not match `validationRegexp`.
const String _invalidFormatMessage = 'Invalid format';

/// Accepts a number and every prefix of one, such as `-` or `1.`.
final RegExp _partialNumber = RegExp(r'^-?\d*\.?\d*$');

/// Accepts an edit that leaves a number or a prefix of one, or that only
/// deletes.
final TextInputFormatter _numberFormatter = TextInputFormatter.withFunction(
  (oldValue, newValue) =>
      _partialNumber.hasMatch(newValue.text) ||
          _onlyDeletes(oldValue.text, newValue.text)
      ? newValue
      : oldValue,
);

/// Whether [next] is [previous] with at most one run of characters removed.
bool _onlyDeletes(String previous, String next) {
  if (next.length > previous.length) return false;
  var start = 0;
  while (start < next.length && next[start] == previous[start]) {
    start++;
  }
  return previous.endsWith(next.substring(start));
}

class _TextField extends StatefulWidget {
  const _TextField({
    required this.label,
    required this.value,
    required this.variant,
    required this.pattern,
    required this.error,
    required this.write,
  });

  final String? label;
  final String value;
  final String? variant;
  final String? pattern;
  final String? error;
  final bool Function(String)? write;

  @override
  State<_TextField> createState() => _TextFieldState();
}

class _TextFieldState extends State<_TextField> {
  late final TextEditingController _controller;
  RegExp? _regExp;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
    _regExp = _compile(widget.pattern);
  }

  @override
  void didUpdateWidget(_TextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A bound field shows the bound value. A literal one keeps an edit until
    // the literal changes.
    final bound = widget.write != null;
    if ((bound || widget.value != oldWidget.value) &&
        widget.value != _controller.text) {
      _showValue();
    }
    if (widget.pattern != oldWidget.pattern) {
      _regExp = _compile(widget.pattern);
    }
  }

  /// Shows the widget's value with the cursor at its end.
  void _showValue() {
    _controller.value = TextEditingValue(
      text: widget.value,
      selection: TextSelection.collapsed(offset: widget.value.length),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// [pattern] anchored to match a whole text, or null when [pattern] is
  /// absent or does not compile.
  static RegExp? _compile(String? pattern) {
    if (pattern == null) return null;
    try {
      return RegExp('^(?:$pattern)\$');
    } on FormatException {
      return null;
    }
  }

  /// The first failing check's message, else [_invalidFormatMessage] when
  /// the text is not empty and does not match the pattern.
  String? get _errorText {
    if (widget.error != null) return widget.error;
    final String text = _controller.text;
    final RegExp? regExp = _regExp;
    if (regExp == null || text.isEmpty || regExp.hasMatch(text)) return null;
    return _invalidFormatMessage;
  }

  void _onChanged(String text) {
    if (widget.write?.call(text) == false) _showValue();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final String? variant = widget.variant;
    final obscured = variant == 'obscured';
    final number = variant == 'number';
    final long = variant == 'longText';
    final String? label = widget.label;
    return TextField(
      controller: _controller,
      decoration: InputDecoration(
        labelText: label == null || label.isEmpty ? null : label,
        errorText: _errorText,
      ),
      obscureText: obscured,
      autocorrect: !obscured && !number,
      enableSuggestions: !obscured && !number,
      minLines: long ? 3 : null,
      maxLines: long ? null : 1,
      keyboardType: number
          ? const TextInputType.numberWithOptions(signed: true, decimal: true)
          : long
          ? TextInputType.multiline
          : TextInputType.text,
      inputFormatters: number ? [_numberFormatter] : null,
      onChanged: _onChanged,
    );
  }
}
