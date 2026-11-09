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

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'src/github/github_client.dart';
import 'src/github/github_token.dart';
import 'src/github/triage_service.dart';
import 'src/github_item.dart';
import 'src/item_server.dart';
import 'src/model/triage_controller.dart';
import 'src/ui/triage_app.dart';

Future<void> main(List<String> args) async {
  final controller = TriageController(
    connect: () async =>
        TriageService(GitHubClient(token: await findGitHubToken())),
  );

  // Opened once the items are loaded.
  if (_initialItem(args) case final GitHubItem item) {
    unawaited(controller.open(item));
  }

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

  unawaited(controller.start());
  runApp(TriageApp(controller: controller));
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
