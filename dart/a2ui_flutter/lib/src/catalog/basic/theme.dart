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
import '../../surface_scope.dart';

final RegExp _hexColor = RegExp(r'^#[0-9a-fA-F]{6}$');

/// Builds a basic component's widget with [builder], under a [Theme] whose
/// primary colors come from the surface theme's `primaryColor`, a `#RRGGBB`
/// color.
///
/// Only the outermost basic component of a subtree adds the theme. The ones
/// below it inherit it. Without a `primaryColor`, no theme is added.
class BasicTheme extends StatelessWidget {
  const BasicTheme({super.key, required this.builder});

  /// Builds the component's widget.
  final WidgetBuilder builder;

  @override
  Widget build(BuildContext context) {
    final SurfaceModel<ComponentImplementation>? surface = SurfaceScope.maybeOf(
      context,
    );
    final Object? primary = surface?.theme['primaryColor'];
    if (surface == null ||
        primary is! String ||
        !_hexColor.hasMatch(primary) ||
        identical(
          context.dependOnInheritedWidgetOfExactType<_Themed>()?.surface,
          surface,
        )) {
      return builder(context);
    }
    return _Themed(
      surface: surface,
      child: Theme(
        data: _withPrimaryColor(Theme.of(context), primary),
        child: Builder(builder: builder),
      ),
    );
  }
}

/// Marks a subtree whose theme [surface]'s `primaryColor` already colors.
class _Themed extends InheritedWidget {
  const _Themed({required this.surface, required super.child});

  final SurfaceModel<ComponentImplementation> surface;

  @override
  bool updateShouldNotify(_Themed oldWidget) =>
      !identical(surface, oldWidget.surface);
}

ThemeData _withPrimaryColor(ThemeData base, String primary) {
  final seed = Color(0xFF000000 | int.parse(primary.substring(1), radix: 16));
  final seeded = ColorScheme.fromSeed(
    seedColor: seed,
    brightness: base.colorScheme.brightness,
  );
  return base.copyWith(
    colorScheme: base.colorScheme.copyWith(
      primary: seed,
      onPrimary: switch (ThemeData.estimateBrightnessForColor(seed)) {
        Brightness.dark => Colors.white,
        Brightness.light => Colors.black,
      },
      primaryContainer: seeded.primaryContainer,
      onPrimaryContainer: seeded.onPrimaryContainer,
    ),
  );
}
