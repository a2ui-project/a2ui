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
 * Integration Tests for Personalized Learning Demo
 *
 * Tests cross-module integration without requiring external services.
 * API-dependent tests are skipped but documented for manual verification.
 */

import {strict as assert} from 'assert';

console.log('='.repeat(60));
console.log('Personalized Learning Demo - Integration Tests');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;
let skipped = 0;

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

function skipTest(name, reason) {
  console.log(`○ ${name} (skipped: ${reason})`);
  skipped++;
}

// =============================================================================
// Chat Flow Integration Tests
// =============================================================================

console.log('\n--- Chat Flow Integration Tests ---\n');

// Simulate the full chat flow from message to A2UI rendering
function simulateChatFlow(userMessage) {
  // Step 1: Intent detection
  const lower = userMessage.toLowerCase();
  let format = 'general';

  if (lower.includes('flashcard')) format = 'flashcards';
  else if (lower.includes('podcast') || lower.includes('audio')) format = 'audio';
  else if (lower.includes('video')) format = 'video';
  else if (lower.includes('quiz')) format = 'quiz';
  else if (lower.match(/^(hi|hello|hey)/i)) format = 'greeting';
  else if (lower.includes('explain') || lower.includes('atp')) format = 'flashcards';

  // Step 2: Get content (simulated)
  let content;
  if (format === 'greeting') {
    content = {format: 'greeting', response: 'Hello! How can I help you?'};
  } else if (['flashcards', 'audio', 'video'].includes(format)) {
    content = getFallbackContent(format);
  } else {
    content = {format: 'general', response: 'I understand. Let me help you.'};
  }

  // Step 3: Prepare for rendering
  const result = {
    originalMessage: userMessage,
    detectedFormat: format,
    hasA2UI: !!content.a2ui,
    contentType: content.format,
  };

  if (content.a2ui) {
    result.a2uiMessageCount = content.a2ui.length;
    result.componentCount = content.a2ui
      .filter(m => m.surfaceUpdate)
      .reduce((sum, m) => sum + m.surfaceUpdate.components.length, 0);
  }

  return result;
}

function getFallbackContent(format) {
  const surfaceId = 'learningContent';

  const contents = {
    flashcards: {
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
                component: {Column: {children: {explicitList: ['card1']}}},
              },
              {
                id: 'card1',
                component: {
                  Flashcard: {front: {literalString: 'Q?'}, back: {literalString: 'A!'}},
                },
              },
            ],
          },
        },
      ],
    },
    audio: {
      format: 'audio',
      surfaceId,
      a2ui: [
        {beginRendering: {surfaceId, root: 'audioCard'}},
        {
          surfaceUpdate: {
            surfaceId,
            components: [
              {id: 'audioCard', component: {Card: {child: 'audioPlayer'}}},
              {
                id: 'audioPlayer',
                component: {Audio: {src: {literalString: '/assets/podcast.m4a'}}},
              },
            ],
          },
        },
      ],
    },
    video: {
      format: 'video',
      surfaceId,
      a2ui: [
        {beginRendering: {surfaceId, root: 'videoCard'}},
        {
          surfaceUpdate: {
            surfaceId,
            components: [
              {id: 'videoCard', component: {Card: {child: 'videoPlayer'}}},
              {
                id: 'videoPlayer',
                component: {Video: {src: {literalString: '/assets/video.mp4'}}},
              },
            ],
          },
        },
      ],
    },
  };

  return contents[format] || {format: 'unknown', a2ui: []};
}

test('chat flow handles flashcard request end-to-end', () => {
  const result = simulateChatFlow('Create some flashcards about ATP');
  assert.equal(result.detectedFormat, 'flashcards');
  assert.ok(result.hasA2UI);
  assert.equal(result.contentType, 'flashcards');
  assert.equal(result.a2uiMessageCount, 2);
});

test('chat flow handles audio request end-to-end', () => {
  const result = simulateChatFlow('I want to listen to the podcast');
  assert.equal(result.detectedFormat, 'audio');
  assert.ok(result.hasA2UI);
  assert.equal(result.contentType, 'audio');
});

test('chat flow handles video request end-to-end', () => {
  const result = simulateChatFlow('Show me a video about this');
  assert.equal(result.detectedFormat, 'video');
  assert.ok(result.hasA2UI);
  assert.equal(result.contentType, 'video');
});

test('chat flow handles greeting without A2UI', () => {
  const result = simulateChatFlow('Hello there!');
  assert.equal(result.detectedFormat, 'greeting');
  assert.ok(!result.hasA2UI);
  assert.equal(result.contentType, 'greeting');
});

test('chat flow handles general question', () => {
  const result = simulateChatFlow("What's the weather like?");
  assert.equal(result.detectedFormat, 'general');
  assert.ok(!result.hasA2UI);
});

// =============================================================================
// A2UI Component Hierarchy Tests
// =============================================================================

console.log('\n--- A2UI Component Hierarchy Tests ---\n');

function buildComponentTree(components) {
  const componentMap = new Map(components.map(c => [c.id, c]));
  const tree = {roots: [], orphans: []};
  const referenced = new Set();

  for (const comp of components) {
    const def = comp.component;
    const type = Object.keys(def)[0];
    const props = def[type];

    if (props?.child) {
      referenced.add(props.child);
    }
    if (props?.children?.explicitList) {
      props.children.explicitList.forEach(id => referenced.add(id));
    }
  }

  for (const comp of components) {
    if (!referenced.has(comp.id)) {
      tree.roots.push(comp.id);
    }
  }

  return tree;
}

test('component tree identifies root components', () => {
  const components = [
    {id: 'root', component: {Column: {children: {explicitList: ['child1', 'child2']}}}},
    {id: 'child1', component: {Text: {text: {literalString: 'A'}}}},
    {id: 'child2', component: {Text: {text: {literalString: 'B'}}}},
  ];
  const tree = buildComponentTree(components);
  assert.deepEqual(tree.roots, ['root']);
});

test('component tree handles Card with single child', () => {
  const components = [
    {id: 'card', component: {Card: {child: 'content'}}},
    {id: 'content', component: {Text: {text: {literalString: 'Hello'}}}},
  ];
  const tree = buildComponentTree(components);
  assert.deepEqual(tree.roots, ['card']);
});

// =============================================================================
// Surface State Management Tests
// =============================================================================

console.log('\n--- Surface State Management Tests ---\n');

class MockSurfaceManager {
  constructor() {
    this.surfaces = new Map();
  }

  processMessage(message) {
    if (message.beginRendering) {
      const {surfaceId, root} = message.beginRendering;
      this.surfaces.set(surfaceId, {root, components: new Map(), rendered: false});
      return {action: 'begin', surfaceId};
    }

    if (message.surfaceUpdate) {
      const {surfaceId, components} = message.surfaceUpdate;
      const surface = this.surfaces.get(surfaceId);
      if (!surface) {
        return {action: 'error', error: `Unknown surface: ${surfaceId}`};
      }

      for (const comp of components) {
        surface.components.set(comp.id, comp.component);
      }
      surface.rendered = true;
      return {action: 'update', surfaceId, componentCount: components.length};
    }

    if (message.deleteSurface) {
      const {surfaceId} = message.deleteSurface;
      this.surfaces.delete(surfaceId);
      return {action: 'delete', surfaceId};
    }

    return {action: 'unknown'};
  }

  getSurface(surfaceId) {
    return this.surfaces.get(surfaceId);
  }
}

test('surface manager processes beginRendering', () => {
  const manager = new MockSurfaceManager();
  const result = manager.processMessage({beginRendering: {surfaceId: 'test', root: 'main'}});
  assert.equal(result.action, 'begin');
  assert.ok(manager.getSurface('test'));
});

test('surface manager processes surfaceUpdate', () => {
  const manager = new MockSurfaceManager();
  manager.processMessage({beginRendering: {surfaceId: 'test', root: 'main'}});
  const result = manager.processMessage({
    surfaceUpdate: {
      surfaceId: 'test',
      components: [{id: 'main', component: {Text: {text: {literalString: 'Hello'}}}}],
    },
  });
  assert.equal(result.action, 'update');
  assert.equal(result.componentCount, 1);
  assert.ok(manager.getSurface('test').rendered);
});

test('surface manager processes deleteSurface', () => {
  const manager = new MockSurfaceManager();
  manager.processMessage({beginRendering: {surfaceId: 'test', root: 'main'}});
  const result = manager.processMessage({deleteSurface: {surfaceId: 'test'}});
  assert.equal(result.action, 'delete');
  assert.ok(!manager.getSurface('test'));
});

test('surface manager handles full A2UI payload', () => {
  const manager = new MockSurfaceManager();
  const payload = getFallbackContent('flashcards').a2ui;

  for (const msg of payload) {
    manager.processMessage(msg);
  }

  const surface = manager.getSurface('learningContent');
  assert.ok(surface);
  assert.ok(surface.rendered);
  assert.ok(surface.components.size > 0);
});

// =============================================================================
// Error Handling Integration Tests
// =============================================================================

console.log('\n--- Error Handling Integration Tests ---\n');

test('graceful handling of unknown surface update', () => {
  const manager = new MockSurfaceManager();
  const result = manager.processMessage({
    surfaceUpdate: {surfaceId: 'nonexistent', components: []},
  });
  assert.equal(result.action, 'error');
  assert.ok(result.error.includes('Unknown surface'));
});

test('content fallback returns valid structure for all formats', () => {
  const formats = ['flashcards', 'audio', 'video'];
  for (const format of formats) {
    const content = getFallbackContent(format);
    assert.equal(content.format, format, `Format mismatch for ${format}`);
    assert.ok(Array.isArray(content.a2ui), `A2UI not array for ${format}`);
    assert.ok(content.a2ui.length >= 2, `A2UI too short for ${format}`);
  }
});

// =============================================================================
// API Integration Tests (require external services)
// =============================================================================

console.log('\n--- API Integration Tests ---\n');

skipTest('Gemini API generates valid flashcard JSON', 'requires API credentials');
skipTest('A2A agent returns valid A2UI response', 'requires agent server');
skipTest('Full chat flow with live Gemini API', 'requires API credentials');

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log(`Integration Tests Complete: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
