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

/// The labels that the triage process uses. See
/// `docs/contributing/triage/labels.md`.
library;

/// The label that the flagger adds to the items that need triage.
const String needsTriageLabel = 'status: needs-triage';

/// The label that the triager adds to the items that the team should
/// discuss. See `docs/contributing/triage/triage.md`.
const String needsTeamInputLabel = 'status: needs-team-input';

/// The label that the triager adds to an item to hand its triage to its
/// assignee.
const String assignedForTriageLabel = 'status: assigned-for-triage';

/// The label that the team adds to an item when it waits for an answer from
/// outside the team. The flagger removes it once someone outside the team
/// answers.
const String waitingForAuthorResponseLabel =
    'status: waiting-for-author-response';

/// The priority labels, from the most urgent.
const List<String> priorityLabels = ['P0', 'P1', 'P2', 'P3'];
