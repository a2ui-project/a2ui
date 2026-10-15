/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import * as url from 'node:url';

import {A2uiCatalogError} from '../errors.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {PayloadValidator} from '../validation/payload-validator.js';
import {Catalog, CatalogApi, ComponentApi, linkCatalogs} from './types.js';

/** Walks up from this file until it finds `relPath`. */
function findRepoFile(relPath: string): string {
  let dir = path.dirname(url.fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find ${relPath}`);
}

function loadFixture(name: string): CatalogApi {
  const file = findRepoFile(path.join('conformance', 'test_data', 'catalogs', name));
  return Catalog.fromJson(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Builds a v1.0 catalog document with the given components and `$defs`. */
function catalogDoc(
  id: string,
  components: Record<string, unknown>,
  defs: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    $id: id,
    catalogId: id,
    protocolVersion: '1.0',
    components,
    $defs: defs,
  };
}

/** A component definition with the given `allOf` members and own properties. */
function component(
  name: string,
  allOf: unknown[],
  properties: Record<string, unknown> = {},
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    ...(allOf.length > 0 ? {allOf} : {}),
    properties: {component: {const: name}, ...properties},
    required: ['component', ...required],
  };
}

function accepts(catalog: CatalogApi, name: string, value: Record<string, unknown>): boolean {
  return catalog.components.get(name)!.schema.safeParse(value).success;
}

/** Types schema-only catalogs as the catalogs a `MessageProcessor` takes. */
function rendererCatalogs(catalogs: CatalogApi[]): Catalog<ComponentApi>[] {
  return catalogs as unknown as Catalog<ComponentApi>[];
}

function cachedValidationSchema(catalog: CatalogApi): unknown {
  return (catalog as unknown as {cachedValidationSchema?: unknown}).cachedValidationSchema;
}

const PEER = catalogDoc('https://example.com/peer/peer_catalog.json', {
  Base: component('Base', [], {label: {type: 'string'}}, ['label']),
});

const REFERENCING = catalogDoc('https://example.com/referencing.json', {
  Derived: component('Derived', [{$ref: 'peer_catalog.json#/components/Base'}], {
    extra: {type: 'number'},
  }),
});

describe('withPeerCatalogs', () => {
  it('returns a linked copy and leaves the receiver unchanged', () => {
    const peer = Catalog.fromJson(PEER);
    const catalog = Catalog.fromJson(REFERENCING);
    const schemaBefore = catalog.validationSchema;
    const cachedBefore = cachedValidationSchema(catalog);
    const derivedBefore = catalog.components.get('Derived')!;
    // Unlinked, the reference to the peer cannot be resolved.
    assert.throws(() => derivedBefore.schema, A2uiCatalogError);

    const linked = catalog.withPeerCatalogs([peer]);

    assert.notStrictEqual(linked, catalog);
    assert.ok(linked instanceof Catalog);
    assert.strictEqual(linked.id, catalog.id);
    assert.deepStrictEqual(linked.toJson(), catalog.toJson());
    assert.deepStrictEqual(linked.peerCatalogs, [peer]);
    assert.ok(accepts(linked, 'Derived', {label: 'a', extra: 1}));
    assert.ok(!accepts(linked, 'Derived', {extra: 1}));

    assert.deepStrictEqual(catalog.peerCatalogs, []);
    assert.strictEqual(cachedValidationSchema(catalog), cachedBefore);
    assert.deepStrictEqual(catalog.validationSchema, schemaBefore);
    assert.strictEqual(catalog.components.get('Derived'), derivedBefore);
    assert.throws(() => derivedBefore.schema, A2uiCatalogError);
  });

  it('keeps the runtime class of a subclass', () => {
    class CustomCatalog extends Catalog<ComponentApi> {}
    const base = Catalog.fromJson(REFERENCING);
    const custom = new CustomCatalog(
      base.id,
      base.protocolVersion,
      [...base.components.values()],
      [],
      {schemaId: base.schemaId},
    );
    const linked = custom.withPeerCatalogs([Catalog.fromJson(PEER)]);
    assert.ok(linked instanceof CustomCatalog);
    assert.ok(accepts(linked as CatalogApi, 'Derived', {label: 'a'}));
  });

  it('returns the receiver when no peer is added', () => {
    const peer = Catalog.fromJson(PEER);
    const catalog = Catalog.fromJson(REFERENCING);
    assert.strictEqual(catalog.withPeerCatalogs([]), catalog);
    assert.strictEqual(catalog.withPeerCatalogs([catalog]), catalog);
    const linked = catalog.withPeerCatalogs([peer]);
    assert.strictEqual(linked.withPeerCatalogs([peer]), linked);
  });

  it('records linked peers as the catalogs they were linked from', () => {
    const peer = Catalog.fromJson(PEER);
    const linkedPeer = peer.withPeerCatalogs([Catalog.fromJson(REFERENCING)]);
    const linked = Catalog.fromJson(REFERENCING).withPeerCatalogs([linkedPeer]);
    assert.deepStrictEqual(linked.peerCatalogs, [peer]);
  });

  it('resolves through the source of a pruned peer', () => {
    const peerSource = Catalog.fromJson(PEER);
    const pruned = peerSource.withEntries([], []);
    const linked = Catalog.fromJson(REFERENCING).withPeerCatalogs([pruned]);
    assert.deepStrictEqual(linked.peerCatalogs, [peerSource, pruned]);
    assert.ok(accepts(linked, 'Derived', {label: 'a'}));
    assert.ok(!accepts(linked, 'Derived', {}));
  });

  it('resolves references transitively with the referencing catalog peers', () => {
    const c = catalogDoc('https://example.com/c.json', {
      Leaf: component('Leaf', [], {leaf: {type: 'string'}}, ['leaf']),
    });
    const b = catalogDoc('https://example.com/b.json', {
      Middle: component('Middle', [{$ref: 'c.json#/components/Leaf'}], {
        middle: {type: 'string'},
      }),
    });
    const a = catalogDoc('https://example.com/a.json', {
      Top: component('Top', [{$ref: 'b.json#/components/Middle'}]),
    });
    const linked = Catalog.fromJson(a).withPeerCatalogs([Catalog.fromJson(b), Catalog.fromJson(c)]);
    assert.ok(accepts(linked, 'Top', {leaf: 'x', middle: 'y'}));
    assert.ok(!accepts(linked, 'Top', {middle: 'y'}));
    const top = (linked.validationSchema['components'] as Record<string, any>)['Top'];
    assert.deepStrictEqual(Object.keys(top.properties).sort(), [
      'component',
      'id',
      'leaf',
      'middle',
    ]);
    assert.ok(top.required.includes('leaf'));
  });

  it('resolves local pointers inside a peer against the peer document', () => {
    const peer = catalogDoc(
      'https://example.com/peer.json',
      {
        Base: component('Base', [{$ref: '#/$defs/Common'}], {kind: {$ref: '#/$defs/Kind'}}),
      },
      {
        Common: {type: 'object', properties: {peerOnly: {type: 'string'}}, required: ['peerOnly']},
        Kind: {type: 'number'},
      },
    );
    const referencing = catalogDoc(
      'https://example.com/referencing.json',
      {
        Derived: component(
          'Derived',
          [{$ref: '#/$defs/Common'}, {$ref: 'peer.json#/components/Base'}],
          {ownKind: {$ref: '#/$defs/Kind'}},
        ),
      },
      {
        Common: {type: 'object', properties: {localOnly: {type: 'string'}}},
        Kind: {type: 'string'},
      },
    );
    const linked = Catalog.fromJson(referencing).withPeerCatalogs([Catalog.fromJson(peer)]);
    assert.ok(accepts(linked, 'Derived', {localOnly: 'a', peerOnly: 'b', ownKind: 'x', kind: 1}));
    assert.ok(!accepts(linked, 'Derived', {localOnly: 'a'}), 'peerOnly is required');
    assert.ok(!accepts(linked, 'Derived', {peerOnly: 'b', kind: 'not a number'}));
    assert.ok(!accepts(linked, 'Derived', {peerOnly: 'b', ownKind: 1}));
  });
});

describe('peer matching', () => {
  const badge = (prop: string) => component('Badge', [], {[prop]: {type: 'string'}}, [prop]);
  const alpha = catalogDoc('https://example.com/alpha/catalog.json', {Badge: badge('alpha')});
  const beta = catalogDoc('https://example.com/beta/catalog.json', {Badge: badge('beta')});
  const mcp = catalogDoc('https://example.com/mcp_catalog.json', {Badge: badge('mcp')});

  function linkedReferencing(ref: string): CatalogApi {
    const doc = catalogDoc(
      'https://example.com/referencing.json',
      {Ref: component('Ref', [{$ref: ref}])},
      {},
    );
    (doc['components'] as Record<string, unknown>)['Badge'] = badge('self');
    return Catalog.fromJson(doc).withPeerCatalogs([alpha, beta, mcp].map(d => Catalog.fromJson(d)));
  }

  it('prefers an exact or suffix match over a file name match', () => {
    assert.ok(
      accepts(linkedReferencing('https://example.com/beta/catalog.json#/components/Badge'), 'Ref', {
        beta: 'x',
      }),
    );
    assert.ok(
      accepts(linkedReferencing('beta/catalog.json#/components/Badge'), 'Ref', {beta: 'x'}),
    );
    assert.ok(
      accepts(linkedReferencing('alpha/catalog.json#/components/Badge'), 'Ref', {alpha: 'x'}),
    );
  });

  it('matches mcp_catalog.json to its peer rather than the referencing catalog', () => {
    const linked = linkedReferencing('mcp_catalog.json#/components/Badge');
    assert.ok(accepts(linked, 'Ref', {mcp: 'x'}));
    assert.ok(!accepts(linked, 'Ref', {self: 'x'}));
  });

  it('treats catalog.json without a matching peer as the referencing catalog', () => {
    assert.ok(accepts(linkedReferencing('catalog.json#/components/Badge'), 'Ref', {self: 'x'}));
    assert.ok(
      accepts(linkedReferencing('gamma/catalog.json#/components/Badge'), 'Ref', {self: 'x'}),
    );
  });
});

describe('linkCatalogs', () => {
  it('returns linked copies and leaves the inputs unchanged', () => {
    const peer = Catalog.fromJson(PEER);
    const catalog = Catalog.fromJson(REFERENCING);
    const [linkedCatalog, linkedPeer] = linkCatalogs([catalog, peer]);
    assert.notStrictEqual(linkedCatalog, catalog);
    assert.deepStrictEqual(linkedCatalog.peerCatalogs, [peer]);
    assert.deepStrictEqual(catalog.peerCatalogs, []);
    // The peer has no reference into another catalog, so it is not linked.
    assert.strictEqual(linkedPeer, peer);
  });

  it('puts extra peers first and does not link them', () => {
    const extra = Catalog.fromJson(PEER);
    const other = Catalog.fromJson(catalogDoc('https://example.com/other.json', {}));
    const catalog = Catalog.fromJson(REFERENCING);
    const [linked, otherLinked] = linkCatalogs([catalog, other], [extra]);
    assert.deepStrictEqual(linked.peerCatalogs, [extra, other]);
    assert.strictEqual(otherLinked, other);
    assert.deepStrictEqual(extra.peerCatalogs, []);
  });

  it('returns the catalogs unchanged when there are fewer than two', () => {
    const catalog = Catalog.fromJson(REFERENCING);
    const result = linkCatalogs([catalog]);
    assert.strictEqual(result[0], catalog);
  });
});

describe('MessageProcessor', () => {
  it('does not change the catalogs it is given', () => {
    const shared = loadFixture('simplified_catalog_v1_0.json');
    const crossRef = loadFixture('cross_ref_catalog_v1_0.json');
    assert.ok(shared.validationSchema);
    const sharedCached = cachedValidationSchema(shared);
    const textSchema = shared.components.get('Text')!.schema;
    const customText = crossRef.components.get('CustomText')!;

    new MessageProcessor(rendererCatalogs([shared, crossRef]));
    new MessageProcessor(rendererCatalogs([shared, loadFixture('cross_ref_catalog_v1_0.json')]));

    assert.deepStrictEqual(shared.peerCatalogs, []);
    assert.deepStrictEqual(crossRef.peerCatalogs, []);
    assert.strictEqual(cachedValidationSchema(shared), sharedCached);
    assert.strictEqual(shared.components.get('Text')!.schema, textSchema);
    assert.strictEqual(crossRef.components.get('CustomText'), customText);
    assert.throws(() => customText.schema, A2uiCatalogError);
  });
});

describe('unresolvable cross-catalog references', () => {
  const doc = {
    $id: 'https://example.com/referencing.json',
    catalogId: 'https://example.com/referencing.json',
    protocolVersion: '1.0',
    components: {
      Inherits: component('Inherits', [{$ref: 'other.json#/components/Badge'}]),
      Property: component('Property', [], {
        icon: {$ref: 'mcp_catalog.json#/components/Badge/properties/icon'},
      }),
      MissingPointer: component('MissingPointer', [
        {$ref: 'peer_catalog.json#/components/Missing'},
      ]),
    },
    functions: {
      fn: {
        type: 'object',
        properties: {
          '@call': {const: 'fn'},
          args: {$ref: 'other.json#/functions/fn/properties/args'},
        },
        required: ['@call', 'args'],
      },
    },
  };

  it('fail loudly instead of accepting any value', () => {
    const catalog = Catalog.fromJson(doc).withPeerCatalogs([Catalog.fromJson(PEER)]);
    for (const name of ['Inherits', 'Property', 'MissingPointer']) {
      assert.throws(
        () => catalog.components.get(name)!.schema,
        (err: Error) =>
          err instanceof A2uiCatalogError && err.message.includes('Unresolvable schema reference'),
        name,
      );
    }
    assert.throws(() => catalog.functions.get('fn')!.schema, A2uiCatalogError);
    const validator = new PayloadValidator(catalog);
    assert.throws(() =>
      validator.validateComponent({id: 'p', component: 'Property', icon: 'star'}),
    );
  });
});

describe('validationSchema of a linked catalog', () => {
  it('keeps the properties and required names inherited from a peer', () => {
    const linked = loadFixture('cross_ref_catalog_v1_0.json').withPeerCatalogs([
      loadFixture('simplified_catalog_v1_0.json'),
    ]);
    const components = linked.validationSchema['components'] as Record<string, any>;
    const customText = components['CustomText'];
    assert.ok('text' in customText.properties);
    assert.ok('variant' in customText.properties);
    assert.ok(customText.required.includes('text'));
    assert.ok('child' in components['StyledCard'].properties);
  });
});
