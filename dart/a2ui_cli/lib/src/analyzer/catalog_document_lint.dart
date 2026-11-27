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

import 'package:a2ui_core/a2ui_core.dart'
    show CatalogDocumentDiagnostic, validateCatalogDocument;

import 'catalog_lint.dart';

/// Semantically lints an A2UI Catalog Document (`formatVersion: "1.0"`).
///
/// Delegates all structural and semantic checks to `a2ui_core`'s shared
/// [validateCatalogDocument] and layers cross-component composition checks
/// (`allowedParents` and `allowedChildren` target validation) on top.
List<CatalogLintFinding> lintCatalogDocument(Map<String, Object?> catalogJson) {
  final findings = <CatalogLintFinding>[
    for (final CatalogDocumentDiagnostic d in validateCatalogDocument(
      catalogJson,
    ))
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: d.code,
        path: d.path,
        message: d.message,
      ),
  ];

  // Cross-component composition checks: allowedParents may reference any
  // declared component or 'Surface'; allowedChildren may only reference
  // declared components.
  final Object? rawComponents = catalogJson['components'];
  if (rawComponents is List) {
    final declared = <String>{
      for (final Object? item in rawComponents)
        if (item is Map &&
            item['name'] is String &&
            (item['name']! as String).isNotEmpty)
          item['name']! as String,
    };
    for (var i = 0; i < rawComponents.length; i++) {
      final Object? item = rawComponents[i];
      if (item is! Map) continue;
      final ptr = '/components/$i';
      if (item['allowedParents'] case final List<Object?> parents) {
        for (var j = 0; j < parents.length; j++) {
          final Object? target = parents[j];
          if (target is String &&
              target.isNotEmpty &&
              target != 'Surface' &&
              !declared.contains(target)) {
            findings.add(
              CatalogLintFinding(
                severity: LintSeverity.error,
                code: 'invalid_constraint',
                path: '$ptr/allowedParents/$j',
                message:
                    "allowedParents references undeclared component '$target'.",
              ),
            );
          }
        }
      }
      if (item['allowedChildren'] case final List<Object?> children) {
        for (var j = 0; j < children.length; j++) {
          final Object? target = children[j];
          if (target is! String || target.isEmpty) continue;
          if (target == 'Surface') {
            findings.add(
              CatalogLintFinding(
                severity: LintSeverity.error,
                code: 'invalid_constraint',
                path: '$ptr/allowedChildren/$j',
                message:
                    "allowedChildren must not contain 'Surface' (only "
                    'allowedParents may reference Surface).',
              ),
            );
          } else if (!declared.contains(target)) {
            findings.add(
              CatalogLintFinding(
                severity: LintSeverity.error,
                code: 'invalid_constraint',
                path: '$ptr/allowedChildren/$j',
                message:
                    'allowedChildren references undeclared component '
                    "'$target'.",
              ),
            );
          }
        }
      }
    }
  }

  return findings;
}
