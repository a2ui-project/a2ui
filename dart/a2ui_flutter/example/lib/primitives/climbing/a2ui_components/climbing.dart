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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../climbing_db.dart';

final CatalogItem climbingLocationItem = CatalogItem(
  name: 'ClimbingLocation',
  dataSchema: S.object(
    description: 'A card showing information about a climbing location.',
    properties: {
      'identifier': S.string(
        description: 'The unique identifier of the climbing location.',
      ),
    },
    required: ['identifier'],
  ),
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "ClimbingLocation",
          "identifier": "kraft_boulders"
        }
      ]
    ''',
  ],
  widgetBuilder: (itemContext) {
    final data = itemContext.data as Map<String, dynamic>;
    final identifier = data['identifier'] as String;

    final int index = climbingLocations.indexWhere(
      (v) => v.identifier == identifier,
    );
    if (index == -1) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Text(
            'Climbing location not found: $identifier',
            style: const TextStyle(color: Colors.red),
          ),
        ),
      );
    }
    final ClimbingLocationInfo info = climbingLocations[index];

    return ClimbingLocation(
      info: info,
      onLearnMore: () {
        itemContext.dispatchEvent(
          UserActionEvent(
            name: 'learnMoreAboutLocation',
            sourceComponentId: itemContext.id,
            context: {'identifier': info.identifier, 'name': info.name},
          ),
        );
      },
    );
  },
);

/// A card widget that displays information about a climbing location.
class ClimbingLocation extends StatelessWidget {
  const ClimbingLocation({super.key, required this.info, this.onLearnMore});

  final ClimbingLocationInfo info;
  final VoidCallback? onLearnMore;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.0)),
      elevation: 4,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 200,
            width: double.infinity,
            child: Image.asset(
              'assets/climbing/${info.image}',
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) {
                return Container(
                  color: theme.colorScheme.surfaceContainerHighest,
                  child: const Icon(Icons.broken_image, size: 48),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  info.name,
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  info.address,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8.0,
                  runSpacing: 4.0,
                  children: info.properties.map((prop) {
                    return Chip(
                      label: Text(prop.displayName),
                      backgroundColor:
                          theme.colorScheme.surfaceContainerHighest,
                      labelStyle: TextStyle(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      side: BorderSide.none,
                    );
                  }).toList(),
                ),
                const SizedBox(height: 12),
                Text('Climbing Types', style: theme.textTheme.titleSmall),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8.0,
                  runSpacing: 4.0,
                  children: info.climbingTypes.map((type) {
                    return Chip(
                      label: Text(type.displayName),
                      backgroundColor: theme.colorScheme.primaryContainer,
                      labelStyle: TextStyle(
                        color: theme.colorScheme.onPrimaryContainer,
                      ),
                      side: BorderSide.none,
                    );
                  }).toList(),
                ),
                const SizedBox(height: 12),
                Text('Experience Levels', style: theme.textTheme.titleSmall),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8.0,
                  runSpacing: 4.0,
                  children: info.experienceRanges.map((level) {
                    return Chip(
                      label: Text(level.displayName),
                      backgroundColor: theme.colorScheme.secondaryContainer,
                      labelStyle: TextStyle(
                        color: theme.colorScheme.onSecondaryContainer,
                      ),
                      side: BorderSide.none,
                    );
                  }).toList(),
                ),
                if (onLearnMore != null) ...[
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton(
                      onPressed: onLearnMore,
                      child: const Text('Learn more'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
