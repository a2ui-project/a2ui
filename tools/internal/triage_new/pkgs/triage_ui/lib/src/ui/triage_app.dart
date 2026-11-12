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

import '../model/triage_controller.dart';
import 'triage_page.dart';
import 'triage_scope.dart';

class TriageApp extends StatelessWidget {
  const TriageApp({super.key, required this.controller});

  final TriageController controller;

  @override
  Widget build(BuildContext context) => TriageScope(
    controller: controller,
    child: MaterialApp(
      title: 'A2UI triage',
      theme: _theme,
      home: const TriagePage(),
    ),
  );
}

/// A white background, gray as the main color, and large bold tab headers.
final ThemeData _theme = ThemeData(
  colorScheme: ColorScheme.fromSeed(
    seedColor: Colors.grey,
    dynamicSchemeVariant: DynamicSchemeVariant.monochrome,
  ).copyWith(primary: Colors.grey.shade700, surface: Colors.white),
  scaffoldBackgroundColor: Colors.white,
  tabBarTheme: const TabBarThemeData(
    labelStyle: _tabLabelStyle,
    unselectedLabelStyle: _tabLabelStyle,
  ),
);

const TextStyle _tabLabelStyle = TextStyle(
  fontSize: 16,
  fontWeight: FontWeight.bold,
);
