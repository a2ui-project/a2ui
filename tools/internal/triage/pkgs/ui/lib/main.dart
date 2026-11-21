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

import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared/shared.dart';

import 'src/github/triage_service.dart';
import 'src/github_item.dart';
import 'src/item_server.dart';
import 'src/model/triage_controller.dart';
import 'src/ui/triage_app.dart';

Future<void> main(List<String> args) async {
  final controller = TriageController(
    connect: () async => TriageService(GitHubClient(token: await _findToken())),
  );

  // Opened once the items are loaded.
  if (_initialItem(args) case final GitHubItem item) {
    unawaited(controller.open(item));
  }

  // A web page cannot listen on a port.
  if (!kIsWeb) await _startItemServer(controller);

  unawaited(controller.start());
  runApp(TriageApp(controller: controller));
}

/// Finds the triager's GitHub token.
///
/// On the web, the app can neither read the environment nor run `gh`, so the
/// token comes from `--dart-define=GITHUB_TOKEN=<token>`.
Future<String> _findToken() async {
  if (!kIsWeb) return findGitHubToken();
  const token = String.fromEnvironment('GITHUB_TOKEN');
  if (token.isEmpty) {
    throw const GitHubException(
      'Cannot find a GitHub token. Start the app with '
      '--dart-define=GITHUB_TOKEN="\$(gh auth token)".',
    );
  }
  return token;
}

/// Listens for the items that triage_ui.sh sends, and opens them.
Future<void> _startItemServer(TriageController controller) async {
  try {
    await ItemServer.start(
      onItem: (GitHubItem item) {
        unawaited(_activateWindow());
        unawaited(controller.open(item));
      },
    );
  } on SocketException catch (e) {
    debugPrint(
      'Cannot listen on port ${ItemServer.defaultPort}, so triage_ui.sh '
      'cannot send items to this app: $e',
    );
  }
}

/// Brings the app's window to the front, so that the triager sees the item
/// that triage_ui.sh sent. The channel is in `macos/Runner/`.
Future<void> _activateWindow() async {
  try {
    await const MethodChannel(
      'triage_ui/window',
    ).invokeMethod<void>('activate');
  } on MissingPluginException {
    // Not on macOS.
  }
}

/// The item to open first: the first argument, or on the web, the `item`
/// query parameter, as in `http://localhost:<port>/?item=<URL>`.
GitHubItem? _initialItem(List<String> args) {
  final String? url = kIsWeb
      ? Uri.base.queryParameters['item']
      : args.firstOrNull;
  if (url == null) return null;
  final GitHubItem? item = GitHubItem.tryParse(url);
  if (item == null) {
    debugPrint(
      'Ignoring "$url": it is not the URL of an issue or a pull '
      'request in a2ui-project/a2ui or flutter/genui.',
    );
  }
  return item;
}
