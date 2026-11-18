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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/v0_9/basic_catalog.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import 'chat_session.dart';

/// A chat app showing the entries of [session], newest at the bottom, above
/// a text field for the user's next turn.
class ChatApp extends StatefulWidget {
  const ChatApp({super.key, required this.session});

  final ChatSession session;

  @override
  State<ChatApp> createState() => _ChatAppState();
}

class _ChatAppState extends State<ChatApp> {
  final TextEditingController _input = TextEditingController();

  void _send() {
    final String text = _input.text.trim();
    if (text.isEmpty) return;
    _input.clear();
    unawaited(widget.session.send(text));
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'A2UI chat',
    theme: ThemeData(colorSchemeSeed: Colors.indigo),
    home: Scaffold(
      appBar: AppBar(title: const Text('A2UI chat')),
      body: ListenableBuilder(
        listenable: widget.session,
        builder: (context, _) => Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                reverse: true,
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final ChatEntry entry in widget.session.entries)
                      _buildEntry(context, entry),
                  ],
                ),
              ),
            ),
            if (widget.session.busy) const LinearProgressIndicator(),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      decoration: const InputDecoration(
                        hintText: 'Ask for some UI',
                      ),
                      onEditingComplete: _send,
                    ),
                  ),
                  TextFieldTapRegion(
                    child: IconButton(
                      tooltip: 'Send',
                      icon: const Icon(Icons.send),
                      onPressed: _send,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

Widget _buildEntry(BuildContext context, ChatEntry entry) {
  final ColorScheme colors = Theme.of(context).colorScheme;
  if (entry.surface case final SurfaceModel<ComponentImplementation> surface) {
    return Card.outlined(
      key: ObjectKey(surface),
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: A2uiMarkdown(
          builder: _markdown,
          child: A2uiSurface(surface: surface),
        ),
      ),
    );
  }
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: switch (entry.kind) {
      ChatEntryKind.user => Align(
        alignment: Alignment.centerRight,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: colors.primaryContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(entry.text),
        ),
      ),
      ChatEntryKind.sent => Text(
        'Sent: ${entry.text}',
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          color: colors.outline,
        ),
      ),
      ChatEntryKind.error => Text(
        entry.text,
        style: TextStyle(color: colors.error),
      ),
      _ => MarkdownBody(
        data: entry.text,
        onTapLink: _openLink,
        styleSheet: _markdownStyleSheetFromTheme(Theme.of(context)),
      ),
    },
  );
}

/// Renders [markdown] with [style] as its paragraph style, and opens a
/// tapped link.
Widget _markdown(BuildContext context, String markdown, TextStyle style) =>
    MarkdownBody(
      data: markdown,
      onTapLink: _openLink,
      styleSheet: _markdownStyleSheetFromTheme(Theme.of(context))
          .copyWith(p: style),
    );

// TODO(flutter_markdown_plus#144): Replace with
// MarkdownStyleSheet.fromMaterialUiTheme once flutter_markdown_plus supports
// package:material_ui ThemeData natively (see PR #150).
MarkdownStyleSheet _markdownStyleSheetFromTheme(ThemeData theme) {
  final TextStyle? body = theme.textTheme.bodyMedium;
  return MarkdownStyleSheet(
    a: const TextStyle(color: Colors.blue),
    p: body,
    pPadding: EdgeInsets.zero,
    code: body?.copyWith(
      backgroundColor: theme.cardTheme.color,
      fontFamily: 'monospace',
      fontSize: body.fontSize == null ? null : body.fontSize! * 0.85,
    ),
    h1: theme.textTheme.headlineSmall,
    h1Padding: EdgeInsets.zero,
    h2: theme.textTheme.titleLarge,
    h2Padding: EdgeInsets.zero,
    h3: theme.textTheme.titleMedium,
    h3Padding: EdgeInsets.zero,
    h4: theme.textTheme.bodyLarge,
    h4Padding: EdgeInsets.zero,
    h5: theme.textTheme.bodyLarge,
    h5Padding: EdgeInsets.zero,
    h6: theme.textTheme.bodyLarge,
    h6Padding: EdgeInsets.zero,
    em: const TextStyle(fontStyle: FontStyle.italic),
    strong: const TextStyle(fontWeight: FontWeight.bold),
    del: const TextStyle(decoration: TextDecoration.lineThrough),
    blockquote: body,
    img: body,
    checkbox: body?.copyWith(color: theme.primaryColor),
    blockSpacing: 8.0,
    listIndent: 24.0,
    listBullet: body,
    listBulletPadding: const EdgeInsets.only(right: 4),
    tableHead: const TextStyle(fontWeight: FontWeight.w600),
    tableBody: body,
    tableHeadAlign: TextAlign.center,
    tablePadding: const EdgeInsets.only(bottom: 4.0),
    tableBorder: TableBorder.all(color: theme.dividerColor),
    tableColumnWidth: const FlexColumnWidth(),
    tableCellsPadding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
    tableCellsDecoration: const BoxDecoration(),
    blockquotePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    blockquoteDecoration: BoxDecoration(
      color: theme.colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(3),
      border: Border(
        left: BorderSide(color: theme.colorScheme.primary, width: 3),
      ),
    ),
    codeblockPadding: const EdgeInsets.all(8.0),
    codeblockDecoration: BoxDecoration(
      color: theme.cardTheme.color ?? theme.cardColor,
      borderRadius: BorderRadius.circular(2.0),
    ),
    horizontalRuleDecoration: BoxDecoration(
      border: Border(top: BorderSide(width: 5.0, color: theme.dividerColor)),
    ),
  );
}

/// Opens [href] with `url_launcher`.
void _openLink(String text, String? href, String title) {
  final Uri? uri = href == null ? null : Uri.tryParse(href);
  if (uri != null) launchUrl(uri).ignore();
}
