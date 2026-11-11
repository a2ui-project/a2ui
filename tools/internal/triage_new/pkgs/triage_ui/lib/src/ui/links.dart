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
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../model/triage_item.dart';

/// The URL of the issue that [item] refers to. GitHub redirects it if the
/// item is a pull request.
String issueUrl(ItemRef item) =>
    'https://github.com/${item.repository}/issues/${item.number}';

/// The URL of the pull request that [item] refers to.
String pullRequestUrl(ItemRef item) =>
    'https://github.com/${item.repository}/pull/${item.number}';

/// Opens [url] in the browser.
Future<void> openUrl(String url) => launchUrl(Uri.parse(url));

/// A small button that copies [url] to the clipboard, for the right of a
/// link.
class CopyLinkButton extends StatelessWidget {
  const CopyLinkButton(this.url, {super.key});

  final String url;

  @override
  Widget build(BuildContext context) => IconButton(
    icon: const Icon(Icons.copy, size: 14),
    tooltip: 'Copy link',
    visualDensity: VisualDensity.compact,
    padding: EdgeInsets.zero,
    constraints: const BoxConstraints.tightFor(width: 24, height: 24),
    onPressed: () async {
      await Clipboard.setData(ClipboardData(text: url));
      if (!context.mounted) return;
      ScaffoldMessenger.maybeOf(context)
        ?..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text('Copied $url'),
            duration: const Duration(seconds: 2),
          ),
        );
    },
  );
}

/// Text that opens [url] in the browser when clicked, followed by a
/// [CopyLinkButton].
class LinkText extends StatelessWidget {
  const LinkText(this.text, {super.key, required this.url, this.style});

  final String text;
  final String url;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 4,
      children: [
        Flexible(
          child: Tooltip(
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
          ),
        ),
        CopyLinkButton(url),
      ],
    );
  }
}

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

/// How long ago [time] was, such as "3 days ago".
String ago(DateTime time, {DateTime? now}) {
  final int days = (now ?? DateTime.now()).difference(time).inDays;
  return switch (days) {
    <= 0 => 'today',
    1 => 'yesterday',
    _ => '$days days ago',
  };
}
