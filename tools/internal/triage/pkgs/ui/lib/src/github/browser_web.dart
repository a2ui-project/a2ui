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

import 'package:web/web.dart' as web;

import 'browser.dart';

/// The real browser: keeps the pasted token in the page's local storage.
final class WebBrowser implements Browser {
  static const String _tokenKey = 'a2ui_triage_github_token';

  @override
  String? readToken() => web.window.localStorage.getItem(_tokenKey);

  @override
  void writeToken(String? token) => token == null
      ? web.window.localStorage.removeItem(_tokenKey)
      : web.window.localStorage.setItem(_tokenKey, token);

  @override
  void go(Uri url) => web.window.location.assign(url.toString());

  @override
  void reload() => web.window.location.reload();
}

/// The browser the app runs in.
Browser createBrowser() => WebBrowser();
