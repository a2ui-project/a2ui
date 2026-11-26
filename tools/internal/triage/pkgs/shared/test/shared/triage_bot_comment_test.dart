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

import 'package:shared/shared.dart';
import 'package:test/test.dart';

void main() {
  test('recognizes the triage bot prefix', () {
    expect(hasTriageBotPrefix('**From triage bot, analysis:**\n'), isTrue);
    expect(hasTriageBotPrefix('  **From triage bot, ping:** @a'), isTrue);
    expect(
      hasTriageBotPrefix('Thanks!\n**From triage bot, response:**'),
      isFalse,
    );
    // Earlier triage bot comments.
    expect(
      hasTriageBotPrefix('**From triage bot:**\n\nResponse to requests:'),
      isTrue,
    );
    expect(hasTriageBotPrefix('**Suggestion from triage bot:**\n'), isFalse);
    expect(hasTriageBotPrefix('From triage bot: plain'), isFalse);
    expect(hasTriageBotPrefix('**From triage bot** says'), isFalse);
  });

  group('isTriageBotComment', () {
    const body = '**From triage bot, analysis:**\n\nNeeds a priority.';

    test('is true for a team member', () {
      for (final String association in teamAssociations) {
        expect(
          isTriageBotComment(
            body: body,
            association: association,
            byBot: false,
          ),
          isTrue,
          reason: association,
        );
      }
    });

    test('is true for a bot', () {
      expect(
        isTriageBotComment(body: body, association: 'NONE', byBot: true),
        isTrue,
      );
    });

    test('is false for anyone else, so they cannot hide a comment', () {
      expect(
        isTriageBotComment(
          body: body,
          association: 'CONTRIBUTOR',
          byBot: false,
        ),
        isFalse,
      );
      expect(
        isTriageBotComment(body: body, association: null, byBot: false),
        isFalse,
      );
    });

    test('is false without the prefix', () {
      expect(
        isTriageBotComment(body: 'LGTM', association: 'MEMBER', byBot: false),
        isFalse,
      );
    });
  });
}
