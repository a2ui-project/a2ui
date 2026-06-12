/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Unit Tests for Personalized Learning Demo
 *
 * Tests the core functionality of the A2A client, chat orchestrator logic,
 * and A2UI rendering without requiring external services.
 */

import {strict as assert} from 'assert';

console.log('='.repeat(60));
console.log('Personalized Learning Demo - Unit Tests');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

// =============================================================================
// A2A Client Fallback Content Tests
// =============================================================================

console.log('\n--- A2A Client Fallback Content Tests ---\n');

// Full fallback content matching a2a-client.ts exactly
function getFallbackContent(format) {
  const surfaceId = 'learningContent';

  switch (format.toLowerCase()) {
    case 'flashcards':
      return {
        format: 'flashcards',
        surfaceId,
        a2ui: [
          {beginRendering: {surfaceId, root: 'mainColumn'}},
          {
            surfaceUpdate: {
              surfaceId,
              components: [
                {
                  id: 'mainColumn',
                  component: {
                    Column: {
                      children: {explicitList: ['headerText', 'flashcardRow']},
                      distribution: 'start',
                      alignment: 'stretch',
                    },
                  },
                },
                {
                  id: 'headerText',
                  component: {
                    Text: {
                      text: {literalString: 'Study Flashcards: ATP & Bond Energy'},
                      usageHint: 'h3',
                    },
                  },
                },
                {
                  id: 'flashcardRow',
                  component: {
                    Row: {
                      children: {explicitList: ['card1', 'card2', 'card3']},
                      distribution: 'start',
                      alignment: 'stretch',
                    },
                  },
                },
                {
                  id: 'card1',
                  component: {
                    Flashcard: {
                      front: {literalString: 'Why does ATP hydrolysis release energy?'},
                      back: {
                        literalString:
                          'Because the products (ADP + Pi) are MORE STABLE than ATP due to reduced electrostatic repulsion and better resonance stabilization.',
                      },
                      category: {literalString: 'Biochemistry'},
                    },
                  },
                },
                {
                  id: 'card2',
                  component: {
                    Flashcard: {
                      front: {literalString: 'Does breaking a bond release energy?'},
                      back: {
                        literalString:
                          'NO! Breaking ANY bond REQUIRES energy input. Energy is released when new, more stable bonds FORM.',
                      },
                      category: {literalString: 'Chemistry'},
                    },
                  },
                },
                {
                  id: 'card3',
                  component: {
                    Flashcard: {
                      front: {literalString: 'Think of ATP like... (gym analogy)'},
                      back: {
                        literalString:
                          "A compressed spring or holding a plank position! It's in a high-energy, unstable state. Releasing to a relaxed state (ADP + Pi) releases that stored potential energy.",
                      },
                      category: {literalString: 'MCAT Analogy'},
                    },
                  },
                },
              ],
            },
          },
        ],
      };

    case 'podcast':
    case 'audio':
      return {
        format: 'audio',
        surfaceId,
        a2ui: [
          {beginRendering: {surfaceId, root: 'audioCard'}},
          {
            surfaceUpdate: {
              surfaceId,
              components: [
                {
                  id: 'audioCard',
                  component: {Card: {child: 'audioContent'}},
                },
                {
                  id: 'audioContent',
                  component: {
                    Column: {
                      children: {
                        explicitList: ['audioHeader', 'audioPlayer', 'audioDescription'],
                      },
                      distribution: 'start',
                      alignment: 'stretch',
                    },
                  },
                },
                {
                  id: 'audioHeader',
                  component: {
                    Row: {
                      children: {explicitList: ['audioIcon', 'audioTitle']},
                      distribution: 'start',
                      alignment: 'center',
                    },
                  },
                },
                {
                  id: 'audioIcon',
                  component: {
                    Icon: {name: {literalString: 'podcasts'}},
                  },
                },
                {
                  id: 'audioTitle',
                  component: {
                    Text: {
                      text: {
                        literalString: 'ATP & Chemical Stability: Correcting the Misconception',
                      },
                      usageHint: 'h3',
                    },
                  },
                },
                {
                  id: 'audioPlayer',
                  component: {
                    Audio: {
                      src: {literalString: '/assets/podcast.m4a'},
                      title: {literalString: 'Understanding ATP Energy Release'},
                    },
                  },
                },
                {
                  id: 'audioDescription',
                  component: {
                    Text: {
                      text: {
                        literalString:
                          "This personalized podcast uses gym analogies to explain why 'energy stored in bonds' is a misconception. Perfect for your MCAT prep!",
                      },
                      usageHint: 'body',
                    },
                  },
                },
              ],
            },
          },
        ],
      };

    case 'video':
      return {
        format: 'video',
        surfaceId,
        a2ui: [
          {beginRendering: {surfaceId, root: 'videoCard'}},
          {
            surfaceUpdate: {
              surfaceId,
              components: [
                {
                  id: 'videoCard',
                  component: {Card: {child: 'videoContent'}},
                },
                {
                  id: 'videoContent',
                  component: {
                    Column: {
                      children: {explicitList: ['videoTitle', 'videoPlayer', 'videoDescription']},
                      distribution: 'start',
                      alignment: 'stretch',
                    },
                  },
                },
                {
                  id: 'videoTitle',
                  component: {
                    Text: {
                      text: {literalString: 'Visual Guide: ATP Energy & Stability'},
                      usageHint: 'h3',
                    },
                  },
                },
                {
                  id: 'videoPlayer',
                  component: {
                    Video: {
                      src: {literalString: '/assets/video.mp4'},
                      title: {literalString: 'ATP Hydrolysis Explained'},
                    },
                  },
                },
                {
                  id: 'videoDescription',
                  component: {
                    Text: {
                      text: {
                        literalString:
                          'Watch the compressed spring analogy in action to understand why ATP releases energy through stability differences.',
                      },
                      usageHint: 'body',
                    },
                  },
                },
              ],
            },
          },
        ],
      };

    default:
      return {
        format: 'error',
        surfaceId,
        a2ui: [],
        error: `Unknown format: ${format}`,
      };
  }
}

test('getFallbackContent returns valid flashcard structure', () => {
  const result = getFallbackContent('flashcards');
  assert.equal(result.format, 'flashcards');
  assert.equal(result.surfaceId, 'learningContent');
  assert.ok(Array.isArray(result.a2ui));
  assert.equal(result.a2ui.length, 2);
  assert.ok(result.a2ui[0].beginRendering);
  assert.ok(result.a2ui[1].surfaceUpdate);
});

test('getFallbackContent returns valid audio structure', () => {
  const result = getFallbackContent('audio');
  assert.equal(result.format, 'audio');
  assert.ok(result.a2ui[0].beginRendering);
  assert.equal(result.a2ui[0].beginRendering.root, 'audioCard');
});

test('getFallbackContent handles podcast as audio', () => {
  const result = getFallbackContent('podcast');
  assert.equal(result.format, 'audio');
});

test('getFallbackContent returns valid video structure', () => {
  const result = getFallbackContent('video');
  assert.equal(result.format, 'video');
  assert.ok(result.a2ui[0].beginRendering);
});

test('getFallbackContent returns error for unknown format', () => {
  const result = getFallbackContent('unknown');
  assert.equal(result.format, 'error');
  assert.ok(result.error.includes('Unknown format'));
});

// =============================================================================
// Intent Detection Tests (from chat-orchestrator.ts logic)
// =============================================================================

console.log('\n--- Intent Detection Tests ---\n');

function detectIntent(message) {
  const lower = message.toLowerCase();

  if (
    lower.includes('flashcard') ||
    lower.includes('flash card') ||
    lower.includes('study cards') ||
    lower.includes('review cards')
  ) {
    return 'flashcards';
  }

  if (lower.includes('podcast') || lower.includes('listen') || lower.includes('audio')) {
    return 'podcast';
  }

  if (lower.includes('video') || lower.includes('watch') || lower.includes('show me')) {
    return 'video';
  }

  if (lower.includes('quiz') || lower.includes('test me') || lower.includes('practice question')) {
    return 'quiz';
  }

  if (lower.match(/^(hi|hello|hey|good morning|good afternoon|good evening)/i)) {
    return 'greeting';
  }

  if (
    lower.includes('help me understand') ||
    lower.includes('explain') ||
    lower.includes('teach me') ||
    lower.includes('learn about') ||
    (lower.includes('atp') && (lower.includes('energy') || lower.includes('bond'))) ||
    lower.includes('misconception')
  ) {
    return 'flashcards';
  }

  return 'general';
}

test('detectIntent identifies flashcard requests', () => {
  assert.equal(detectIntent('Create flashcards for me'), 'flashcards');
  assert.equal(detectIntent('Show me some study cards'), 'flashcards');
  assert.equal(detectIntent('I need review cards'), 'flashcards');
});

test('detectIntent identifies podcast/audio requests', () => {
  assert.equal(detectIntent('Play the podcast'), 'podcast');
  assert.equal(detectIntent('I want to listen to something'), 'podcast');
  assert.equal(detectIntent('Give me audio content'), 'podcast');
});

test('detectIntent identifies video requests', () => {
  assert.equal(detectIntent('Show me a video'), 'video');
  assert.equal(detectIntent('I want to watch something'), 'video');
  assert.equal(detectIntent('Can you show me the explanation?'), 'video');
});

test('detectIntent identifies quiz requests', () => {
  assert.equal(detectIntent('Quiz me on this'), 'quiz');
  assert.equal(detectIntent('Test me please'), 'quiz');
  assert.equal(detectIntent('Give me a practice question'), 'quiz');
});

test('detectIntent identifies greetings', () => {
  assert.equal(detectIntent('Hi there!'), 'greeting');
  assert.equal(detectIntent('Hello'), 'greeting');
  assert.equal(detectIntent('Hey, how are you?'), 'greeting');
  assert.equal(detectIntent('Good morning'), 'greeting');
});

test('detectIntent defaults to flashcards for learning requests', () => {
  assert.equal(detectIntent('Help me understand ATP'), 'flashcards');
  assert.equal(detectIntent('Explain bond energy to me'), 'flashcards');
  assert.equal(detectIntent('I have a misconception about this'), 'flashcards');
});

test('detectIntent returns general for unrecognized messages', () => {
  assert.equal(detectIntent("What's the weather?"), 'general');
  assert.equal(detectIntent('Tell me a joke'), 'general');
});

// =============================================================================
// A2UI Message Structure Tests
// =============================================================================

console.log('\n--- A2UI Message Structure Tests ---\n');

function validateA2UIMessage(message) {
  // A valid A2UI message should have exactly one of these keys
  const validKeys = ['beginRendering', 'surfaceUpdate', 'dataModelUpdate', 'deleteSurface'];
  const keys = Object.keys(message);
  const matchingKeys = keys.filter(k => validKeys.includes(k));

  if (matchingKeys.length !== 1) {
    return {
      valid: false,
      error: `Expected exactly one of ${validKeys.join(', ')}, got ${matchingKeys.length}`,
    };
  }

  const key = matchingKeys[0];

  if (key === 'beginRendering') {
    const br = message.beginRendering;
    if (!br.surfaceId || !br.root) {
      return {valid: false, error: 'beginRendering requires surfaceId and root'};
    }
  }

  if (key === 'surfaceUpdate') {
    const su = message.surfaceUpdate;
    if (!su.surfaceId || !Array.isArray(su.components)) {
      return {valid: false, error: 'surfaceUpdate requires surfaceId and components array'};
    }
    for (const comp of su.components) {
      if (!comp.id || !comp.component) {
        return {valid: false, error: 'Each component needs id and component properties'};
      }
    }
  }

  return {valid: true};
}

test('validateA2UIMessage accepts valid beginRendering', () => {
  const msg = {beginRendering: {surfaceId: 'test', root: 'main'}};
  const result = validateA2UIMessage(msg);
  assert.ok(result.valid, result.error);
});

test('validateA2UIMessage rejects beginRendering without surfaceId', () => {
  const msg = {beginRendering: {root: 'main'}};
  const result = validateA2UIMessage(msg);
  assert.ok(!result.valid);
});

test('validateA2UIMessage accepts valid surfaceUpdate', () => {
  const msg = {
    surfaceUpdate: {
      surfaceId: 'test',
      components: [{id: 'comp1', component: {Text: {text: {literalString: 'Hello'}}}}],
    },
  };
  const result = validateA2UIMessage(msg);
  assert.ok(result.valid, result.error);
});

test('validateA2UIMessage rejects surfaceUpdate without components', () => {
  const msg = {surfaceUpdate: {surfaceId: 'test'}};
  const result = validateA2UIMessage(msg);
  assert.ok(!result.valid);
});

test('validateA2UIMessage rejects message with multiple action types', () => {
  const msg = {
    beginRendering: {surfaceId: 'test', root: 'main'},
    surfaceUpdate: {surfaceId: 'test', components: []},
  };
  const result = validateA2UIMessage(msg);
  assert.ok(!result.valid);
});

// =============================================================================
// Component ID Validation Tests
// =============================================================================

console.log('\n--- Component ID Validation Tests ---\n');

function validateComponentIds(components) {
  const ids = new Set();
  const errors = [];

  for (const comp of components) {
    if (!comp.id) {
      errors.push('Component missing id');
      continue;
    }
    if (ids.has(comp.id)) {
      errors.push(`Duplicate component id: ${comp.id}`);
    }
    ids.add(comp.id);
  }

  return {valid: errors.length === 0, errors};
}

test('validateComponentIds accepts unique ids', () => {
  const components = [
    {id: 'comp1', component: {}},
    {id: 'comp2', component: {}},
    {id: 'comp3', component: {}},
  ];
  const result = validateComponentIds(components);
  assert.ok(result.valid);
});

test('validateComponentIds rejects duplicate ids', () => {
  const components = [
    {id: 'comp1', component: {}},
    {id: 'comp1', component: {}},
  ];
  const result = validateComponentIds(components);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Duplicate')));
});

test('validateComponentIds rejects missing ids', () => {
  const components = [{id: 'comp1', component: {}}, {component: {}}];
  const result = validateComponentIds(components);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('missing id')));
});

// =============================================================================
// Children Reference Validation Tests
// =============================================================================

console.log('\n--- Children Reference Validation Tests ---\n');

function validateChildrenReferences(components) {
  const ids = new Set(components.map(c => c.id).filter(Boolean));
  const errors = [];

  for (const comp of components) {
    const componentDef = comp.component;
    if (!componentDef) continue;

    const componentType = Object.keys(componentDef)[0];
    const props = componentDef[componentType];

    // Check single child reference
    if (props?.child && typeof props.child === 'string') {
      if (!ids.has(props.child)) {
        errors.push(`Component ${comp.id} references non-existent child: ${props.child}`);
      }
    }

    // Check children list
    if (props?.children?.explicitList) {
      for (const childId of props.children.explicitList) {
        if (!ids.has(childId)) {
          errors.push(`Component ${comp.id} references non-existent child: ${childId}`);
        }
      }
    }
  }

  return {valid: errors.length === 0, errors};
}

test('validateChildrenReferences accepts valid references', () => {
  const components = [
    {id: 'parent', component: {Column: {children: {explicitList: ['child1', 'child2']}}}},
    {id: 'child1', component: {Text: {text: {literalString: 'Hello'}}}},
    {id: 'child2', component: {Text: {text: {literalString: 'World'}}}},
  ];
  const result = validateChildrenReferences(components);
  assert.ok(result.valid, result.errors.join(', '));
});

test('validateChildrenReferences catches invalid child reference', () => {
  const components = [
    {id: 'parent', component: {Column: {children: {explicitList: ['child1', 'missing']}}}},
    {id: 'child1', component: {Text: {text: {literalString: 'Hello'}}}},
  ];
  const result = validateChildrenReferences(components);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('missing')));
});

test('validateChildrenReferences validates single child prop', () => {
  const components = [
    {id: 'card', component: {Card: {child: 'content'}}},
    {id: 'content', component: {Text: {text: {literalString: 'Hello'}}}},
  ];
  const result = validateChildrenReferences(components);
  assert.ok(result.valid, result.errors.join(', '));
});

// =============================================================================
// Flashcard Content Validation Tests
// =============================================================================

console.log('\n--- Flashcard Content Validation Tests ---\n');

function validateFlashcard(component) {
  const errors = [];
  const fc = component.Flashcard;

  if (!fc) {
    return {valid: false, errors: ['Not a Flashcard component']};
  }

  if (!fc.front) {
    errors.push('Flashcard missing front property');
  } else if (!fc.front.literalString && !fc.front.path) {
    errors.push('Flashcard front must have literalString or path');
  }

  if (!fc.back) {
    errors.push('Flashcard missing back property');
  } else if (!fc.back.literalString && !fc.back.path) {
    errors.push('Flashcard back must have literalString or path');
  }

  return {valid: errors.length === 0, errors};
}

test('validateFlashcard accepts valid flashcard', () => {
  const component = {
    Flashcard: {
      front: {literalString: 'Question?'},
      back: {literalString: 'Answer!'},
      category: {literalString: 'Test'},
    },
  };
  const result = validateFlashcard(component);
  assert.ok(result.valid, result.errors.join(', '));
});

test('validateFlashcard rejects flashcard without front', () => {
  const component = {
    Flashcard: {
      back: {literalString: 'Answer!'},
    },
  };
  const result = validateFlashcard(component);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('front')));
});

test('validateFlashcard rejects flashcard without back', () => {
  const component = {
    Flashcard: {
      front: {literalString: 'Question?'},
    },
  };
  const result = validateFlashcard(component);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('back')));
});

// =============================================================================
// Full A2UI Payload Validation Tests
// =============================================================================

console.log('\n--- Full A2UI Payload Validation Tests ---\n');

function validateA2UIPayload(messages) {
  const errors = [];

  if (!Array.isArray(messages)) {
    return {valid: false, errors: ['Payload must be an array']};
  }

  if (messages.length === 0) {
    return {valid: false, errors: ['Payload cannot be empty']};
  }

  // Check that first message is beginRendering
  if (!messages[0].beginRendering) {
    errors.push('First message should be beginRendering');
  }

  // Validate each message
  for (let i = 0; i < messages.length; i++) {
    const msgResult = validateA2UIMessage(messages[i]);
    if (!msgResult.valid) {
      errors.push(`Message ${i}: ${msgResult.error}`);
    }
  }

  // Collect all components and validate
  const allComponents = [];
  for (const msg of messages) {
    if (msg.surfaceUpdate?.components) {
      allComponents.push(...msg.surfaceUpdate.components);
    }
  }

  if (allComponents.length > 0) {
    const idResult = validateComponentIds(allComponents);
    if (!idResult.valid) {
      errors.push(...idResult.errors);
    }

    const refResult = validateChildrenReferences(allComponents);
    if (!refResult.valid) {
      errors.push(...refResult.errors);
    }
  }

  return {valid: errors.length === 0, errors};
}

test('validateA2UIPayload accepts valid flashcard payload', () => {
  const payload = getFallbackContent('flashcards').a2ui;
  const result = validateA2UIPayload(payload);
  assert.ok(result.valid, result.errors.join(', '));
});

test('validateA2UIPayload accepts valid audio payload', () => {
  const payload = getFallbackContent('audio').a2ui;
  const result = validateA2UIPayload(payload);
  assert.ok(result.valid, result.errors.join(', '));
});

test('validateA2UIPayload accepts valid video payload', () => {
  const payload = getFallbackContent('video').a2ui;
  const result = validateA2UIPayload(payload);
  assert.ok(result.valid, result.errors.join(', '));
});

test('validateA2UIPayload rejects non-array', () => {
  const result = validateA2UIPayload('not an array');
  assert.ok(!result.valid);
});

test('validateA2UIPayload rejects empty array', () => {
  const result = validateA2UIPayload([]);
  assert.ok(!result.valid);
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log(`Unit Tests Complete: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
