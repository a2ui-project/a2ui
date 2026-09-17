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

/// A widget to display an internal message in the chat.
class InternalMessageView extends StatelessWidget {
  /// Creates a new [InternalMessageView].
  const InternalMessageView({super.key, required this.content});

  /// The content of the message.
  final String content;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Card(
        color: Colors.grey.shade200,
        child: Padding(
          padding: const EdgeInsets.all(8.0),
          child: Text('Internal message: $content'),
        ),
      ),
    );
  }
}

/// A widget to display a chat message.
class ChatMessageView extends StatelessWidget {
  /// Creates a new [ChatMessageView].
  const ChatMessageView({
    super.key,
    required this.text,
    required this.icon,
    required this.alignment,
  });

  /// The text of the message.
  final String text;

  /// The icon to display next to the message.
  final IconData icon;

  /// The alignment of the message.
  final MainAxisAlignment alignment;

  @override
  Widget build(BuildContext context) {
    final isStart = alignment == MainAxisAlignment.start;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0, horizontal: 8.0),
      child: Row(
        mainAxisAlignment: alignment,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Flexible(
            child: Card(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(
                    alignment == MainAxisAlignment.start ? 5 : 25,
                  ),
                  topRight: Radius.circular(
                    alignment == MainAxisAlignment.start ? 25 : 5,
                  ),
                  bottomLeft: const Radius.circular(25),
                  bottomRight: const Radius.circular(25),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isStart) ...[Icon(icon), const SizedBox(width: 8.0)],
                    Flexible(child: Text(text)),
                    if (!isStart) ...[const SizedBox(width: 8.0), Icon(icon)],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
