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

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// A setting that is missing or wrong.
final class ConfigException implements Exception {
  const ConfigException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// The settings of the server, from environment variables. See the README.
final class ServerConfig {
  ServerConfig({
    required this.port,
    required this.publicUrl,
    required this.webDir,
    required this.sessionKey,
    this.oauthClientId,
    this.oauthClientSecret,
    this.listenOnAllInterfaces = false,
    Uri? githubWeb,
    Uri? githubApi,
  }) : githubWeb = githubWeb ?? Uri.parse('https://github.com/'),
       githubApi = githubApi ?? Uri.parse('https://api.github.com/') {
    if ((oauthClientId == null) != (oauthClientSecret == null)) {
      throw const ConfigException(
        'Set both GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or '
        'neither.',
      );
    }
    if (sessionKey.length != 32) {
      throw const ConfigException('The session key must have 32 bytes.');
    }
  }

  /// Reads the settings from [env]. Returns them with the warnings to log.
  ///
  /// Throws a [ConfigException] if a setting is wrong.
  static ({ServerConfig config, List<String> warnings}) fromEnvironment(
    Map<String, String> env,
  ) {
    final warnings = <String>[];
    String? read(String name) {
      final String? value = env[name]?.trim();
      return value == null || value.isEmpty ? null : value;
    }

    final String portText = read('PORT') ?? '8080';
    final int? port = int.tryParse(portText);
    if (port == null) throw ConfigException('PORT is not a number: $portText');

    final Uri publicUrl = Uri.parse(
      read('PUBLIC_URL') ?? 'http://localhost:$port',
    );
    if (!publicUrl.isScheme('http') && !publicUrl.isScheme('https')) {
      throw ConfigException('PUBLIC_URL is not an http(s) URL: $publicUrl');
    }

    final List<int> sessionKey;
    if (read('SESSION_SECRET') case final String secret) {
      sessionKey = sha256.convert(utf8.encode(secret)).bytes;
    } else {
      final random = Random.secure();
      sessionKey = [for (var i = 0; i < 32; i++) random.nextInt(256)];
      warnings.add(
        'SESSION_SECRET is not set, so a random one is used, and everyone is '
        'signed out when the server restarts.',
      );
    }

    final String? clientId = read('GITHUB_OAUTH_CLIENT_ID');
    if (clientId == null) {
      warnings.add(
        'GITHUB_OAUTH_CLIENT_ID is not set, so "Sign in with GitHub" is off, '
        'and the triager can only paste a token.',
      );
    }

    return (
      config: ServerConfig(
        port: port,
        publicUrl: publicUrl,
        webDir: read('WEB_DIR') ?? '../ui/build/web',
        sessionKey: sessionKey,
        oauthClientId: clientId,
        oauthClientSecret: read('GITHUB_OAUTH_CLIENT_SECRET'),
        // Cloud Run sets K_SERVICE, and sends requests from outside the
        // container. Elsewhere, only this computer can reach the server.
        listenOnAllInterfaces: env.containsKey('K_SERVICE'),
      ),
      warnings: warnings,
    );
  }

  /// The port to listen on.
  final int port;

  /// The URL the browser opens the app at. GitHub sends the triager back to
  /// `<publicUrl>/auth/callback`, which must be the callback URL of the
  /// OAuth App.
  final Uri publicUrl;

  /// The folder with the output of `flutter build web`.
  final String webDir;

  /// The 32-byte key that encrypts the cookies.
  final List<int> sessionKey;

  /// The client ID of the GitHub OAuth App, or null if "Sign in with GitHub"
  /// is off.
  final String? oauthClientId;

  /// The client secret of the GitHub OAuth App.
  final String? oauthClientSecret;

  /// Whether to listen on all network interfaces, rather than only on
  /// localhost.
  final bool listenOnAllInterfaces;

  /// GitHub's web site, with its OAuth pages. Tests replace it.
  final Uri githubWeb;

  /// The GitHub API. Tests replace it.
  final Uri githubApi;

  /// Whether "Sign in with GitHub" is on.
  bool get oauthEnabled => oauthClientId != null;

  /// Whether the cookies are only sent over HTTPS.
  bool get secureCookies => publicUrl.isScheme('https');

  /// Where GitHub sends the triager back to after signing in.
  Uri get callbackUrl => publicUrl.resolve('/auth/callback');
}
