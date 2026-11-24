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

/**
 * The reference macros and case runner for `conformance/agent/macros/macros.yaml`.
 *
 * The macros are written with `defineMacro`, mirroring the Python harness
 * (`python/a2ui_agent/tests/conformance/macro_suite.py`), including its imperative
 * transforms such as the uppercased status. The goldens were recorded from Python's typed
 * builder, which fills in catalog defaults such as `Row.justify`; the node helpers below
 * write the same defaults.
 */

import {readFileSync} from 'fs';

import {load} from 'js-yaml';

import {
  A2uiValidationError,
  type AgentToRendererMessage,
  Catalog,
  type CatalogApi,
  type ComponentNode,
  defineMacro,
  type MacroDefinition,
  MacroExpander,
  param,
} from '../../src/index.js';
import {loadBasicCatalog} from '../helpers/basic-catalogs.js';
import {LoadedCase} from './loader.js';
import {conformancePath} from './suite-helpers.js';

export const SUITE = 'agent/macros/macros.yaml';
export const GOLDEN_DIR = conformancePath('agent/macros/golden');

const V1_0_BASIC_CID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const V0_9_BASIC_CID = 'https://a2ui.org/specification/v0_9/standard_catalog.json';
const FOO_CID = 'https://example.com/catalogs/foo/v1/catalog.json';
const BAR_CID = 'https://example.com/catalogs/bar/v1/catalog.json';
const BRAND_CID = 'https://example.com/brand.json';
const BRAND_SURFACE_CID = 'https://example.com/brand_surface.json';
const CAT_A_CID = 'https://example.com/catalog_a.json';
const CAT_B_CID = 'https://example.com/catalog_b.json';
const BAZ_MACROS_CID = 'https://example.com/catalogs/baz_macros.json';

const RAW_SUITE = load(readFileSync(conformancePath(SUITE), 'utf8')) as {
  custom_catalogs?: Record<string, Record<string, unknown>>;
};
const CUSTOM_CATALOG_DOCUMENTS = RAW_SUITE.custom_catalogs ?? {};

// Node helpers with the defaults of the Python v1.0 builder classes.

function builderNode(component: string, defaults: Record<string, unknown> = {}) {
  return (props: Record<string, unknown>): ComponentNode => {
    const node: ComponentNode = {component, ...props};
    for (const [key, value] of Object.entries(defaults)) {
      if (node[key] === undefined) {
        node[key] = value;
      }
    }
    return node;
  };
}

const Button = builderNode('Button', {variant: 'default'});
const Card = builderNode('Card');
const Column = builderNode('Column', {justify: 'start', align: 'stretch'});
const List = builderNode('List', {direction: 'vertical', align: 'stretch'});
const Row = builderNode('Row', {justify: 'start', align: 'stretch'});
const Text = builderNode('Text', {variant: 'body'});
const TextField = builderNode('TextField', {variant: 'shortText'});

// The v1.0 reference macros (`get_v1_0_suite_macros` in Python).

const StatusBadge = defineMacro({
  name: 'StatusBadge',
  description: 'Status badge with uppercase status and title.',
  parameters: {status: param.string(), title: param.string()},
  render: ({status, title}) =>
    Card({
      child: Row({
        children: [Text({text: status.toUpperCase(), variant: 'caption'}), Text({text: title})],
      }),
    }),
});

const SlotContainer = defineMacro({
  name: 'SlotContainer',
  description: 'Container accepting an external child slot.',
  parameters: {title: param.string(), content: param.component()},
  render: ({title, content}) => Card({child: Column({children: [Text({text: title}), content]})}),
});

const MultiSlotContainer = defineMacro({
  name: 'MultiSlotContainer',
  description: 'Container accepting a list of child slots.',
  parameters: {header: param.string(), items: param.componentList()},
  render: ({header, items}) => Card({child: Column({children: [Text({text: header}), ...items]})}),
});

const ActionButton = defineMacro({
  name: 'ActionButton',
  description: 'Button with coerced action.',
  parameters: {label: param.string(), action: param.action()},
  render: ({label, action}) => Button({child: Text({text: label}), action, variant: 'primary'}),
});

const BoundMetric = defineMacro({
  name: 'BoundMetric',
  description: 'Metric card displaying a dynamic value.',
  parameters: {label: param.string(), value: param.dynamicString()},
  render: ({label, value}) =>
    Card({
      child: Column({children: [Text({text: label, variant: 'caption'}), Text({text: value})]}),
    }),
});

const ConfigCard = defineMacro({
  name: 'ConfigCard',
  description: 'Configuration card displaying primitives and metadata.',
  parameters: {name: param.string(), port: param.integer(), active: param.boolean()},
  render: ({name, port, active}) =>
    Card({
      child: Column({
        children: [
          Text({text: name}),
          Text({text: `Port: ${port}`}),
          Text({text: `Active: ${String(active)}`}),
        ],
      }),
    }),
});

const NestedMacroCard = defineMacro({
  name: 'NestedMacroCard',
  description: 'Macro composing another macro.',
  parameters: {title: param.string(), status: param.string()},
  render: ({title, status}) =>
    Card({
      child: Column({
        children: [Text({text: title}), StatusBadge.render({status, title: `${title} Status`})],
      }),
    }),
});

const RecursiveCard: MacroDefinition = defineMacro({
  name: 'RecursiveCard',
  description: 'Macro composing itself recursively.',
  parameters: {title: param.string()},
  render: ({title}) => Card({child: RecursiveCard.render({title})}),
});

const ComplexCard = defineMacro({
  name: 'ComplexCard',
  description: 'Card testing protocol common types in macro parameter schemas.',
  parameters: {
    title: param.string(),
    dynamic_title: param.dynamicString(),
    metric: param.dynamicNumber(),
    is_active: param.dynamicBoolean(),
    tags: param.dynamicStringList(),
    anything: param.dynamicValue(),
    on_click: param.action(),
    checks: param.checkRuleList(),
    accessibility: param.accessibility(),
    footer: param.component(),
    items: param.componentList(),
    theme: param.string({enum: ['primary', 'secondary']}),
  },
  render: ({title}) => Card({child: Text({text: title})}),
});

const PayloadButton = defineMacro({
  name: 'PayloadButton',
  description: 'Button sending dynamic payload values inside an Action event context.',
  parameters: {
    label: param.string(),
    event_name: param.string(),
    payload: param.dynamicValue(),
    extra: param.dynamicValue(),
  },
  render: ({label, event_name, payload, extra}) =>
    Button({
      child: Text({text: label}),
      variant: 'primary',
      action: {event: {name: event_name, context: {payload, extra}}},
    }),
});

const DynamicFormCard = defineMacro({
  name: 'DynamicFormCard',
  description: 'Form card with dynamic child list, check rules, and submit action.',
  parameters: {
    label: param.string(),
    placeholder: param.dynamicString(),
    items: param.childList(),
    checks: param.checkRuleList(),
    on_submit: param.action(),
  },
  render: ({label, placeholder, items, checks, on_submit}) =>
    Card({
      child: Column({
        children: [
          TextField({label, value: {'@path': '/form/email'}, placeholder, '@checks': checks}),
          List({children: items}),
          Button({child: Text({text: 'Submit'}), variant: 'primary', action: on_submit}),
        ],
      }),
    }),
});

const AnnotatedBadge = defineMacro({
  name: 'AnnotatedBadge',
  description:
    'Status badge whose root Card defines default accessibility and metadata extensions.',
  parameters: {status: param.string(), title: param.string()},
  render: ({status, title}) =>
    Card({
      child: Row({
        children: [Text({text: status.toUpperCase(), variant: 'caption'}), Text({text: title})],
      }),
      '@accessibility': {description: 'Default badge description'},
      '@metadata': {extensions: {macroMeta: {source: 'AnnotatedBadge'}}},
    }),
});

const DeclaredA11yCard = defineMacro({
  name: 'DeclaredA11yCard',
  description: 'Card declaring accessibility as an explicit macro parameter.',
  parameters: {title: param.string(), accessibility: param.accessibility({required: false})},
  render: ({title, accessibility}) =>
    Card({
      child: Text({text: title}),
      '@accessibility': {
        label:
          typeof accessibility?.label === 'string' ? `Custom: ${accessibility.label}` : 'Internal',
      },
    }),
});

const WeightedCard = defineMacro({
  name: 'WeightedCard',
  description: 'Card declaring weight as an explicit macro parameter.',
  parameters: {label: param.string(), weight: param.number({required: false})},
  render: ({label, weight}) => Card({child: Text({text: label}), weight}),
});

const PositiveCountCard = defineMacro({
  name: 'PositiveCountCard',
  description: 'Card raising ValidationError when count is negative.',
  parameters: {count: param.integer()},
  render: ({count}) => {
    if (count < 0) {
      throw new A2uiValidationError('count must be non-negative');
    }
    return Card({child: Text({text: `Count: ${count}`})});
  },
});

export const SUITE_MACROS_V1_0: readonly MacroDefinition[] = [
  StatusBadge,
  SlotContainer,
  MultiSlotContainer,
  ActionButton,
  BoundMetric,
  ConfigCard,
  NestedMacroCard,
  RecursiveCard,
  ComplexCard,
  PayloadButton,
  DynamicFormCard,
  AnnotatedBadge,
  DeclaredA11yCard,
  WeightedCard,
  PositiveCountCard,
];

// The catalog-scoped reference macros (`get_scoped_suite_macros` in Python), by the
// `macro_catalog_id` of the cases that use them.

const BarBadge = builderNode('BarBadge');
const BarButton = builderNode('BarButton');
const BrandBox = builderNode('BrandBox');
const Chart = builderNode('Chart');
const ChartCard = builderNode('ChartCard');
const FooHeader = builderNode('FooHeader');
const FooPanel = builderNode('FooPanel');

const BrandText = defineMacro({
  name: 'Text',
  description: 'Custom brand Text macro wrapping a basic Text inside a Card.',
  parameters: {text: param.string(), variant: param.string({default: 'body'})},
  render: ({text, variant}) => Card({child: Text({text: `[Brand] ${text}`, variant})}),
});

const UnannotatedBrandCard = defineMacro({
  name: 'UnannotatedBrandCard',
  description: 'Brand card emitting unannotated Card, BrandBox, and Text nodes.',
  parameters: {title: param.string()},
  render: ({title}) => Card({child: BrandBox({child: Text({text: title, variant: 'body'})})}),
});

const BrandBadge = defineMacro({
  name: 'BrandBadge',
  description: 'Brand badge emitting basic Card and Text with explicit catalogId.',
  parameters: {label: param.string()},
  render: ({label}) =>
    Card({
      '@catalogId': V1_0_BASIC_CID,
      child: Text({'@catalogId': V1_0_BASIC_CID, text: `[Badge] ${label}`, variant: 'body'}),
    }),
});

const InnerBadgeScoped = defineMacro({
  name: 'InnerBadgeScoped',
  description: 'Scoped inner badge emitting BrandBox and unannotated basic Text.',
  parameters: {label: param.string()},
  render: ({label}) =>
    BrandBox({
      '@catalogId': BRAND_CID,
      child: Text({text: `Scoped Badge: ${label}`, variant: 'caption'}),
    }),
});

const OuterPanelScoped = defineMacro({
  name: 'OuterPanelScoped',
  description: 'Scoped outer panel emitting unannotated Text alongside deferred InnerBadgeScoped.',
  parameters: {title: param.string()},
  render: ({title}) =>
    Card({
      child: Column({
        children: [
          Text({text: title, variant: 'body'}),
          {component: 'InnerBadgeScoped', label: title, '@catalogId': BRAND_CID},
        ],
      }),
    }),
});

const BrandChart = defineMacro({
  name: 'Chart',
  description: 'Brand Chart macro emitting ChartCard wrapping an unannotated Chart primitive.',
  parameters: {series: param.string()},
  render: ({series}) => ChartCard({child: Chart({series: `[Brand] ${series}`})}),
});

const BrandSurfaceText = defineMacro({
  name: 'Text',
  description:
    'Brand surface Text macro emitting cross-catalog basic Card and Text around BrandBox.',
  parameters: {text: param.string(), variant: param.string({default: 'body'})},
  render: ({text, variant}) =>
    Card({
      '@catalogId': V1_0_BASIC_CID,
      child: BrandBox({
        '@catalogId': BRAND_SURFACE_CID,
        child: Text({'@catalogId': V1_0_BASIC_CID, text: `[Brand] ${text}`, variant}),
      }),
    }),
});

const BrandSurfaceBadge = defineMacro({
  name: 'BrandBadge',
  description: 'Brand surface badge emitting cross-catalog basic Card and Text around BrandBox.',
  parameters: {label: param.string()},
  render: ({label}) =>
    Card({
      '@catalogId': V1_0_BASIC_CID,
      child: BrandBox({
        '@catalogId': BRAND_SURFACE_CID,
        child: Text({'@catalogId': V1_0_BASIC_CID, text: `[Badge] ${label}`, variant: 'body'}),
      }),
    }),
});

const BazMacro = defineMacro({
  name: 'BazMacro',
  description:
    'Composite macro combining FooCatalog and BarCatalog primitives with explicit catalogIds.',
  parameters: {
    headline: param.dynamicString(),
    badge_tag: param.string(),
    cta_label: param.string(),
    on_cta: param.action(),
  },
  render: ({headline, badge_tag, cta_label, on_cta}) =>
    FooPanel({
      '@catalogId': FOO_CID,
      children: [
        FooHeader({'@catalogId': FOO_CID, title: headline}),
        BarBadge({'@catalogId': BAR_CID, tag: badge_tag}),
        BarButton({'@catalogId': BAR_CID, label: cta_label, action: on_cta}),
      ],
    }),
});

const ProductCard = defineMacro({
  name: 'ProductCard',
  description: 'Macro sharing its name with ProductCard primitive in catalog_a.json.',
  parameters: {name: param.string()},
  render: ({name}) => Card({child: Text({text: `Product: ${name}`})}),
});

const BrandBoxMacro = defineMacro({
  name: 'BrandBox',
  description: 'Macro wrapping a same-named BrandBox primitive from catalog_a.json.',
  parameters: {title: param.string()},
  render: ({title}) =>
    Card({child: BrandBox({'@catalogId': CAT_A_CID, child: Text({text: title})})}),
});

const InnerBadgeInherited = defineMacro({
  name: 'InnerBadgeInherited',
  description:
    'Deferred inner macro inheriting enclosing catalogId when surface catalog is registered.',
  parameters: {label: param.string()},
  render: ({label}) =>
    BrandBox({
      '@catalogId': CAT_A_CID,
      child: Text({text: `Inherited Badge: ${label}`, variant: 'caption'}),
    }),
});

const OuterPanelInherited = defineMacro({
  name: 'OuterPanelInherited',
  description: 'Outer macro emitting unannotated deferred InnerBadgeInherited node.',
  parameters: {title: param.string()},
  render: ({title}) =>
    Card({
      child: Column({
        children: [
          Text({text: title, variant: 'body'}),
          {component: 'InnerBadgeInherited', label: title},
        ],
      }),
    }),
});

const DeferredCycle = defineMacro({
  name: 'DeferredCycle',
  description: 'Deferred self-recursive macro node.',
  parameters: {label: param.string()},
  render: ({label}) => Card({child: {component: 'DeferredCycle', label}}),
});

const CycleA = defineMacro({
  name: 'CycleA',
  description: 'Mutually recursive deferred macro A referencing CycleB.',
  parameters: {label: param.string()},
  render: ({label}) => Card({child: {component: 'CycleB', label}}),
});

const CycleB = defineMacro({
  name: 'CycleB',
  description: 'Mutually recursive deferred macro B referencing CycleA.',
  parameters: {label: param.string()},
  render: ({label}) => Card({child: {component: 'CycleA', label}}),
});

const EmitsSurface = defineMacro({
  name: 'EmitsSurface',
  description: 'Macro illegally emitting reserved Surface component in v1.0.',
  render: () => ({component: 'Surface'}),
});

export const SCOPED_SUITE_MACROS: Readonly<Record<string, readonly MacroDefinition[]>> = {
  [BRAND_CID]: [
    BrandText,
    UnannotatedBrandCard,
    BrandBadge,
    InnerBadgeScoped,
    OuterPanelScoped,
    BrandChart,
  ],
  [BRAND_SURFACE_CID]: [BrandSurfaceText, BrandSurfaceBadge],
  [BAZ_MACROS_CID]: [BazMacro],
  [CAT_B_CID]: [
    ProductCard,
    BrandBoxMacro,
    InnerBadgeInherited,
    OuterPanelInherited,
    DeferredCycle,
    CycleA,
    CycleB,
    EmitsSurface,
  ],
};

// Catalog resolution and case execution.

/** The protocol version of a case's envelope: `1.0`, `v0.9` or `v0.8`. */
export function envelopeVersion(testCase: LoadedCase): string {
  const raw = (testCase['envelope_version'] ?? testCase['version']) as string | undefined;
  if (raw === '1.0' || raw === 'v1.0') return '1.0';
  return raw ?? 'v0.9';
}

/** The protocol version the case's macros are written for, as Python's harness picks it. */
export function macroVersion(testCase: LoadedCase): string {
  const raw = testCase['macro_version'] as string | undefined;
  if (raw === undefined) return envelopeVersion(testCase);
  return raw === '1.0' || raw === 'v1.0' ? '1.0' : raw;
}

function basicCatalog(version: string): CatalogApi {
  return loadBasicCatalog(version === '1.0' ? '1.0' : 'v0.9.1');
}

/** Resolves a catalog ID from `custom_catalogs` or the basic catalog, as Python does. */
export function resolveCatalog(catalogId: string, version: string): CatalogApi {
  const custom = CUSTOM_CATALOG_DOCUMENTS[catalogId];
  if (custom) {
    return Catalog.fromJson(structuredClone(custom));
  }
  if (catalogId === V1_0_BASIC_CID) return basicCatalog('1.0');
  if (catalogId === V0_9_BASIC_CID) return basicCatalog('v0.9');
  const basic = basicCatalog(version);
  return catalogId === basic.id ? basic : Catalog.fromJson(basic.toJson(), undefined, catalogId);
}

function selectMacros(testCase: LoadedCase): readonly MacroDefinition[] {
  if (testCase['empty_macros']) {
    return [];
  }
  const colliding = testCase['colliding_macro'] as string | undefined;
  if (colliding !== undefined) {
    return [defineMacro({name: colliding, render: () => Card({child: Text({text: 'colliding'})})})];
  }
  const macroCatalogId = testCase['macro_catalog_id'] as string | undefined;
  if (macroCatalogId !== undefined) {
    const scoped = SCOPED_SUITE_MACROS[macroCatalogId];
    if (scoped === undefined) {
      throw new Error(`No scoped macros registered for macro_catalog_id ${macroCatalogId}`);
    }
    return scoped;
  }
  return SUITE_MACROS_V1_0;
}

function buildExpander(testCase: LoadedCase): MacroExpander {
  const protocolVersion = testCase['expander_protocol_version'] as string | undefined;
  if (protocolVersion !== undefined && protocolVersion !== '1.0') {
    throw new Error(`Unexpected expander_protocol_version ${protocolVersion}`);
  }
  const macroCatalogId = testCase['macro_catalog_id'] as string | undefined;
  const scoped = (testCase['expander_scoped'] as boolean | undefined) ?? true;
  const catalogId =
    (testCase['expander_catalog_id'] as string | undefined) ??
    (scoped ? macroCatalogId : undefined);
  const version = envelopeVersion(testCase);
  const baseCatalogs = (testCase['base_catalogs'] as string[] | undefined)?.map(id =>
    resolveCatalog(id, version),
  );
  return new MacroExpander(selectMacros(testCase), {
    passthroughComponents: testCase['passthrough_components'] as string[] | undefined,
    catalogId,
    baseCatalogs,
    onError: testCase['on_error'] as 'passthrough' | 'raise' | undefined,
  });
}

/** Runs a catalog case and returns the catalog it produces, or `undefined` for none. */
export function runCatalogCase(testCase: LoadedCase): CatalogApi | undefined {
  const expander = buildExpander(testCase);
  switch (testCase.action) {
    case 'to_catalog':
      return expander.toCatalog();
    case 'transform_catalog':
      expander.transformToInferenceCatalog(basicCatalog(envelopeVersion(testCase)));
      return undefined;
    case 'transform_to_inference_catalog':
      return expander.transformToInferenceCatalog(basicCatalog(envelopeVersion(testCase)));
    default:
      throw new Error(`Unexpected catalog action ${testCase.action}`);
  }
}

/** Runs a transport case and returns the lowered messages. */
export function runTransportCase(testCase: LoadedCase): AgentToRendererMessage[] {
  const expander = buildExpander(testCase);
  return expander.transformToTransport(transportMessages(testCase));
}

/** The messages a transport case sends: its `messages`, or messages built from `input`. */
function transportMessages(testCase: LoadedCase): AgentToRendererMessage[] {
  if (testCase['messages'] !== undefined) {
    return structuredClone(testCase['messages']) as AgentToRendererMessage[];
  }
  const version = envelopeVersion(testCase);
  const surfaceId = (testCase['surface_id'] as string | undefined) ?? 'conformance';
  const input = testCase['input'];
  const components = structuredClone(Array.isArray(input) ? input : [input]);
  const messages: Record<string, unknown>[] = [];
  if (testCase['catalog_id'] !== undefined) {
    messages.push({version, createSurface: {surfaceId, catalogId: testCase['catalog_id']}});
  }
  messages.push({version, updateComponents: {surfaceId, components}});
  return messages as unknown as AgentToRendererMessage[];
}

/** The catalogs a renderer would check the lowered messages against. */
export function validationCatalogs(testCase: LoadedCase): CatalogApi[] {
  const version = envelopeVersion(testCase);
  const ids = testCase['validation_catalogs'] as string[] | undefined;
  if (ids !== undefined) {
    return ids.map(id => resolveCatalog(id, version));
  }
  const catalogs = [basicCatalog(version)];
  const catalogId = testCase['catalog_id'] as string | undefined;
  if (catalogId !== undefined && catalogId !== catalogs[0].id) {
    catalogs.push(resolveCatalog(catalogId, version));
  }
  return catalogs;
}
