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

import 'src/github/browser_stub.dart'
    if (dart.library.js_interop) 'src/github/browser_web.dart';
import 'src/github/github_access.dart';
import 'src/item_server.dart';
import 'src/model/github_item.dart';
import 'src/model/triage_controller.dart';
import 'src/model/triage_service.dart';
import 'src/ui/triage_app.dart';

/// On macOS, the app signs the triager in with `GITHUB_TOKEN` or `GH_TOKEN`
/// from the environment, or with the token that `gh auth token` prints. The
/// web app can do neither, so it uses `--dart-define=GITHUB_TOKEN=<token>`.
/// Without a token, the triager signs in on the sign-in page. A web page
/// cannot listen on a port, so there is no item server on the web. See
/// `pkgs/server/README.md`.
Future<void> main(List<String> args) async {
  // The item server can bring the window to the front through a platform
  // channel before runApp.
  WidgetsFlutterBinding.ensureInitialized();
  final access = GitHubAccess(
    page: kIsWeb ? Uri.base : null,
    browser: createBrowser(),
    presetToken: kIsWeb
        ? const String.fromEnvironment('GITHUB_TOKEN')
        : await _desktopToken(),
    expectServer: const bool.fromEnvironment('TRIAGE_SERVER'),
  );
  final controller = TriageController(
    connect: () async => TriageService(access.client()),
  );
  // Opened once the triager signs in and the items are loaded.
  if (_initialItem(args) case final GitHubItem item) {
    unawaited(controller.open(item));
  }
  if (!kIsWeb) await _startItemServer(controller);
  unawaited(access.check());
  runApp(TriageApp(controller: controller, access: access));
}

/// The token from the environment or `gh`, or empty to show the sign-in.
Future<String> _desktopToken() async {
  try {
    return await findGitHubToken();
  } on GitHubException {
    return '';
  }
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
