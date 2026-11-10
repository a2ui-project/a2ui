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

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../github/triage_service.dart';

const String _repositoryUrl =
    'https://github.com/${TriageService.owner}/${TriageService.name}';

/// The URL of issue [number]. GitHub redirects it if [number] is a pull
/// request.
String issueUrl(int number) => '$_repositoryUrl/issues/$number';

String pullRequestUrl(int number) => '$_repositoryUrl/pull/$number';

/// Opens [url] in the browser.
Future<void> openUrl(String url) => launchUrl(Uri.parse(url));

/// Text that opens [url] in the browser when clicked.
class LinkText extends StatelessWidget {
  const LinkText(this.text, {super.key, required this.url, this.style});

  final String text;
  final String url;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Tooltip(
      message: url,
      child: InkWell(
        onTap: () => openUrl(url),
        child: Text(
          text,
          style: (style ?? theme.textTheme.bodyMedium)?.copyWith(
            color: theme.colorScheme.primary,
            decoration: TextDecoration.underline,
            decorationColor: theme.colorScheme.primary,
          ),
        ),
      ),
    );
  }
}

/// How long ago [time] was, such as "3 days ago".
/// How long ago [time] was, as an age: "less than a day", "1 day" or
/// "32 days".
String age(DateTime time, {DateTime? now}) {
  final int days = (now ?? DateTime.now()).difference(time).inDays;
  return switch (days) {
    <= 0 => 'less than a day',
    1 => '1 day',
    _ => '$days days',
  };
}

String ago(DateTime time, {DateTime? now}) {
  final int days = (now ?? DateTime.now()).difference(time).inDays;
  return switch (days) {
    <= 0 => 'today',
    1 => 'yesterday',
    _ => '$days days ago',
  };
}
