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

import 'applier.dart';

/// Something that the triage UI did to an item in this session, or found
/// out about it, as the item's log shows it.
final class LogEntry {
  LogEntry(this.title, {this.steps = const [], DateTime? time})
    : time = time ?? DateTime.now();

  final DateTime time;

  /// What happened, such as "Applied the suggestion".
  final String title;

  /// The changes made on GitHub, in order, and how each went.
  final List<StepResult> steps;

  /// Whether a step failed.
  bool get failed => steps.any((StepResult s) => s.status == StepStatus.failed);
}
