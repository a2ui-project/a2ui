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

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'src/github_item.dart';
import 'src/item_server.dart';
import 'src/triage_app.dart';

/// Starts the triage UI.
///
/// [args] may hold the URL of the item to open, as
/// `tools/internal/triage/triage_ui.sh` passes it.
Future<void> main(List<String> args) async {
  final item = ValueNotifier<GitHubItem?>(_initialItem(args));

  // The web has no server sockets, and triage_ui.sh runs the app on macOS.
  if (!kIsWeb) {
    try {
      await ItemServer.start(
        onItem: (GitHubItem received) {
          item.value = received;
        },
      );
    } on SocketException catch (e) {
      debugPrint(
        'Cannot listen on port ${ItemServer.defaultPort}, so triage_ui.sh '
        'cannot send items to this app: $e',
      );
    }
  }

  runApp(TriageApp(item: item));
}

GitHubItem? _initialItem(List<String> args) {
  if (args.isEmpty) return null;
  final GitHubItem? item = GitHubItem.tryParse(args.first);
  if (item == null) {
    debugPrint(
      'Ignoring "${args.first}": it is not the URL of an issue or a pull '
      'request in a2ui-project/a2ui.',
    );
  }
  return item;
}
