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

import 'package:flutter/widgets.dart';

import '../model/triage_controller.dart';

/// Gives the widgets below it the [TriageController], and rebuilds the ones
/// that depend on it when it changes.
class TriageScope extends InheritedNotifier<TriageController> {
  const TriageScope({
    super.key,
    required TriageController controller,
    required super.child,
  }) : super(notifier: controller);

  /// The controller, rebuilding [context] when it changes.
  static TriageController of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<TriageScope>()!.notifier!;

  /// The controller, without rebuilding [context] when it changes, for use
  /// in callbacks.
  static TriageController read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<TriageScope>()!.notifier!;
}
