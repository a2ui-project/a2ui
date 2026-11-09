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

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'github_item.dart';

/// The triage UI, which helps the triager go through the GitHub items that
/// need triage. See `tools/internal/triage/blueprints/features/ui.blueprint.md`.
class TriageApp extends StatelessWidget {
  const TriageApp({super.key, required this.item});

  /// The item to triage, or null if there is none yet.
  final ValueListenable<GitHubItem?> item;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'A2UI triage',
      home: Scaffold(
        appBar: AppBar(title: const Text('A2UI triage')),
        body: Center(
          child: ValueListenableBuilder<GitHubItem?>(
            valueListenable: item,
            builder: (BuildContext context, GitHubItem? item, Widget? _) =>
                item == null ? const _NoItem() : _ItemView(item: item),
          ),
        ),
      ),
    );
  }
}

class _NoItem extends StatelessWidget {
  const _NoItem();

  @override
  Widget build(BuildContext context) {
    return const Text(
      'No item to triage. To open one, run in your a2ui checkout:\n'
      'tools/internal/triage/triage_ui.sh <item URL>',
      textAlign: TextAlign.center,
    );
  }
}

class _ItemView extends StatelessWidget {
  const _ItemView({required this.item});

  final GitHubItem item;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(item.name, style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 8),
        SelectableText(item.url),
      ],
    );
  }
}
