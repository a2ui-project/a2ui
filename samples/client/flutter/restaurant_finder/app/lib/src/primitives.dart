// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:flutter/material.dart';

class ThemeToggleButton extends StatelessWidget {
  const ThemeToggleButton({required this.themeMode, required this.onToggle});

  final ThemeMode themeMode;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(
        themeMode == ThemeMode.dark ? Icons.light_mode : Icons.dark_mode,
      ),
      onPressed: onToggle,
      style: IconButton.styleFrom(
        backgroundColor: Theme.of(context).colorScheme.surface,
        shape: const CircleBorder(),
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.errorContainer,
          border: Border.all(
            color: Theme.of(context).colorScheme.error.withValues(alpha: 0.5),
          ),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          message,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onErrorContainer,
          ),
        ),
      ),
    );
  }
}

class LoadingTexts {
  /// Placeholder messages shown next to the loading spinner while the agent
  /// is busy.
  ///
  /// The same loading screen appears during both the restaurant-finding
  /// phase (after the user submits a search) and the booking phase (after
  /// the user taps "Submit Reservation"), so messages are kept neutral
  /// enough to fit either context — no "finding restaurants" copy that
  /// would look wrong while a reservation is being confirmed.
  static const List<String> _texts = [
    'Talking to your concierge...',
    'Checking availability...',
    'Looking up details...',
    'Working on your request...',
    'Almost there...',
    'Just a moment...',
  ];

  int _index = 0;

  String get current => _texts[_index];

  void advance() {
    _index = (_index + 1) % _texts.length;
  }

  void reset() {
    _index = 0;
  }
}
