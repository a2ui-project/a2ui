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

import 'package:server/server.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;

/// Starts the server with the settings from the environment. See the README.
Future<void> main() async {
  final ({ServerConfig config, List<String> warnings}) settings;
  try {
    settings = ServerConfig.fromEnvironment(Platform.environment);
  } on ConfigException catch (e) {
    stderr.writeln(e.message);
    exitCode = 64;
    return;
  }
  final ServerConfig config = settings.config;
  settings.warnings.forEach(stderr.writeln);
  if (!Directory(config.webDir).existsSync()) {
    stderr.writeln(
      'Warning: ${config.webDir} does not exist. Run "flutter build web" in '
      'pkgs/ui, or set WEB_DIR.',
    );
  }

  final HttpServer server = await shelf_io.serve(
    createHandler(config, log: stdout.writeln),
    config.listenOnAllInterfaces
        ? InternetAddress.anyIPv4
        : InternetAddress.loopbackIPv4,
    config.port,
  );
  stdout.writeln(
    'Serving ${config.webDir} on port ${server.port}, at ${config.publicUrl}. '
    'Sign in with GitHub: ${config.oauthEnabled ? 'on' : 'off'}.',
  );
}
