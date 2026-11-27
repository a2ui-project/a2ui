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

/// The triage report: what a person triaged in a period, collected from
/// GitHub and rendered for the team chat space and the triage log. See
/// `blueprints/features/triage_bot/report.blueprint.md`.
///
/// It is apart from `shared.dart`, so that the packages that do not write
/// the report do not depend on it.
library;

export 'src/triage_bot/report.dart';
export 'src/triage_bot/report_args.dart';
export 'src/triage_bot/report_command.dart';
export 'src/triage_bot/report_github.dart';
export 'src/triage_bot/report_render.dart';
