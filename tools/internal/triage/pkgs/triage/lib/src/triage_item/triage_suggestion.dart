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
import 'package:json_schema_builder/json_schema_builder.dart';

/// The A2UI component that carries a triage suggestion for one GitHub
/// item (issue or pull request).
///
/// The advisor posts it on the item, and the triage UI shows it to the
/// triager, who finalizes it and applies it to the item. See
/// `blueprints/features/triage_item.blueprint.md`.
final ComponentApi triageSuggestionApi = ComponentApi(
  name: TriageSuggestionProps.componentName,
  schema: Schema.object(
    description:
        'A triage suggestion for one GitHub issue or pull '
        'request.',
    properties: {
      'component': Schema.string(
        constValue: TriageSuggestionProps.componentName,
      ),
      TriageSuggestionProps.summary: Schema.string(
        description: 'What the item is about, in plain English.',
        minLength: 1,
      ),
      TriageSuggestionProps.suggestion: Schema.string(
        description:
            'What the triager should do with the item and why, in '
            'plain English.',
        minLength: 1,
      ),
      TriageSuggestionProps.addedLabels: _names('Labels to add to the item.'),
      TriageSuggestionProps.removedLabels: _names(
        'Labels to remove from the item.',
      ),
      TriageSuggestionProps.newAssignees: _names(
        'GitHub logins to assign to the item.',
      ),
      TriageSuggestionProps.removedAssignees: _names(
        'GitHub logins to unassign from the item.',
      ),
      TriageSuggestionProps.relatedIssues: _itemNumbers(
        'Numbers of issues in the same repository that relate to the item.',
      ),
      TriageSuggestionProps.relatedPrs: _itemNumbers(
        'Numbers of pull requests in the same repository that relate to the '
        'item.',
      ),
    },
    required: [
      'component',
      TriageSuggestionProps.summary,
      TriageSuggestionProps.suggestion,
    ],
    additionalProperties: false,
  ),
);

/// The names of the [triageSuggestionApi] component and its properties.
abstract final class TriageSuggestionProps {
  static const String componentName = 'TriageSuggestion';

  static const String summary = 'summary';
  static const String suggestion = 'suggestion';
  static const String addedLabels = 'added_labels';
  static const String removedLabels = 'removed_labels';
  static const String newAssignees = 'new_assignees';
  static const String removedAssignees = 'removed_assignees';
  static const String relatedIssues = 'related_issues';
  static const String relatedPrs = 'related_prs';
}

Schema _names(String description) => Schema.list(
  description: '$description Omitted means none.',
  items: Schema.string(minLength: 1),
  uniqueItems: true,
);

Schema _itemNumbers(String description) => Schema.list(
  description: '$description Omitted means none.',
  items: Schema.integer(minimum: 1),
  uniqueItems: true,
);
