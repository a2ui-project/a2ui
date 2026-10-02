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

/// Loading placeholder rendered for pending components.
class A2uiLoadingPlaceholder extends StatelessWidget {
  final String componentId;

  const A2uiLoadingPlaceholder({super.key, required this.componentId});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(8.0),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Text(
            'Loading $componentId...',
            style: const TextStyle(
              fontSize: 12,
              fontStyle: FontStyle.italic,
              color: Colors.grey,
            ),
          ),
        ],
      ),
    );
  }
}

/// Diagnostic warning rendered when a component type has no catalog
/// implementation.
class A2uiUnknownTypeWarning extends StatelessWidget {
  final String type;
  final String componentId;

  const A2uiUnknownTypeWarning({
    super.key,
    required this.type,
    required this.componentId,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.amber.shade50,
        border: Border.all(color: Colors.amber.shade700),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        'Unknown component type: $type (id: $componentId)',
        style: TextStyle(
          color: Colors.amber.shade900,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

/// Diagnostic indicator rendered when a cyclic component reference is detected.
class A2uiCyclicReferenceIndicator extends StatelessWidget {
  final String componentId;

  const A2uiCyclicReferenceIndicator({super.key, required this.componentId});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.red.shade50,
        border: Border.all(color: Colors.red.shade700),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        'Cyclic component reference detected for id: $componentId',
        style: TextStyle(
          color: Colors.red.shade900,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}
