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

import 'package:flutter/material.dart';

/// The colors that GitHub shows a label in: `background`, the label's own
/// color, and `foreground`, black or white, whichever reads better on it.
typedef LabelColors = ({Color background, Color foreground});

/// The colors of a label whose color is [hex], six hex digits such as
/// `d73a4a`, or null if [hex] is null or not a color.
LabelColors? labelColors(String? hex) {
  final int? rgb = hex == null || hex.length != 6
      ? null
      : int.tryParse(hex, radix: 16);
  if (rgb == null) return null;
  final background = Color(0xFF000000 | rgb);
  return (
    background: background,
    foreground: background.computeLuminance() > 0.4
        ? Colors.black
        : Colors.white,
  );
}

/// A label as GitHub shows it: its name on its color.
class LabelPill extends StatelessWidget {
  const LabelPill(this.name, {super.key, this.colors});

  final String name;

  /// The label's colors, or null for the theme's colors.
  final LabelColors? colors;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final LabelColors? colors = this.colors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors?.background ?? theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        child: Text(
          name,
          style: theme.textTheme.labelMedium?.copyWith(
            color: colors?.foreground,
          ),
        ),
      ),
    );
  }
}
