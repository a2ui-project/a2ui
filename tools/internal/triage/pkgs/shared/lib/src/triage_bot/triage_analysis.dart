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

/// The A2UI component that carries a triage analysis of one GitHub
/// item (issue or pull request).
///
/// The triage bot posts it on the item, and the triage UI shows it to the
/// triager, who finalizes it and applies it to the item. See
/// `blueprints/features/triage_bot/analysis.blueprint.md`.
final ComponentApi triageAnalysisApi = ComponentApi(
  name: TriageAnalysisProps.componentName,
  schema: Schema.object(
    description:
        'A triage analysis of one GitHub issue or pull '
        'request.',
    properties: {
      'component': Schema.string(constValue: TriageAnalysisProps.componentName),
      TriageAnalysisProps.tldr: Schema.string(
        description:
            'The case and the suggestion in a few words each, as two lines: '
            '"Case: ..." and "Suggestion: ...".',
        minLength: 1,
      ),
      TriageAnalysisProps.summary: Schema.string(
        description: 'What the item is about, in plain English.',
        minLength: 1,
      ),
      TriageAnalysisProps.reason: Schema.string(
        description:
            'Why the item is flagged for triage, in plain English. Omitted '
            'when the item is not flagged.',
        minLength: 1,
      ),
      TriageAnalysisProps.suggestion: Schema.string(
        description:
            'What the triager should do with the item and why, in '
            'plain English.',
        minLength: 1,
      ),
      TriageAnalysisProps.reply: Schema.string(
        description:
            'A comment to post on the item for its author or other '
            'participants, in plain English. Omitted means no comment.',
        minLength: 1,
      ),
      TriageAnalysisProps.closeAs: Schema.string(
        description:
            'How to close the item. Omitted means keep it open. A pull '
            'request has no close reason, so any value closes it.',
        enumValues: TriageCloseReason.values,
      ),
      TriageAnalysisProps.duplicateOf: Schema.integer(
        description:
            'The number of the item in the same repository that this item '
            'duplicates. Set it only when `close_as` is `duplicate`.',
        minimum: 1,
      ),
      TriageAnalysisProps.addedLabels: _names('Labels to add to the item.'),
      TriageAnalysisProps.removedLabels: _names(
        'Labels to remove from the item.',
      ),
      TriageAnalysisProps.newAssignees: _names(
        'GitHub logins to assign to the item.',
      ),
      TriageAnalysisProps.removedAssignees: _names(
        'GitHub logins to unassign from the item.',
      ),
      TriageAnalysisProps.targetingPrs: _itemNumbers(
        'Numbers of open pull requests in the same repository that target '
        'the item, such as pull requests that fix it.',
      ),
      TriageAnalysisProps.targetedIssues: _itemNumbers(
        'Numbers of issues in the same repository that the item targets, '
        'such as issues that a pull request fixes.',
      ),
      TriageAnalysisProps.relatedItems: _itemNumbers(
        'Numbers of other issues and pull requests in the same repository '
        'that relate to the item.',
      ),
    },
    required: [
      'component',
      TriageAnalysisProps.summary,
      TriageAnalysisProps.suggestion,
    ],
    additionalProperties: false,
  ),
);

/// The id of [triageCatalog].
const String triageCatalogId =
    'https://github.com/a2ui-project/a2ui/tree/main/tools/internal/triage';

/// The catalog of the triage components, which analysis comments use.
final Catalog<ComponentApi, FunctionApi> triageCatalog =
    Catalog<ComponentApi, FunctionApi>(
      id: triageCatalogId,
      components: [triageAnalysisApi],
      protocolVersion: A2uiProtocolVersion.v1_0,
    );

/// The names of the [triageAnalysisApi] component and its properties.
abstract final class TriageAnalysisProps {
  static const String componentName = 'TriageAnalysis';

  static const String tldr = 'tldr';
  static const String summary = 'summary';
  static const String reason = 'reason';
  static const String suggestion = 'suggestion';
  static const String reply = 'reply';
  static const String closeAs = 'close_as';
  static const String duplicateOf = 'duplicate_of';
  static const String addedLabels = 'added_labels';
  static const String removedLabels = 'removed_labels';
  static const String newAssignees = 'new_assignees';
  static const String removedAssignees = 'removed_assignees';
  static const String targetingPrs = 'targeting_prs';
  static const String targetedIssues = 'targeted_issues';
  static const String relatedItems = 'related_items';
}

/// The values of the `close_as` property of [triageAnalysisApi], which
/// match the GitHub close reasons of an issue.
abstract final class TriageCloseReason {
  static const String completed = 'completed';
  static const String notPlanned = 'not_planned';
  static const String duplicate = 'duplicate';

  static const List<String> values = [completed, notPlanned, duplicate];
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
