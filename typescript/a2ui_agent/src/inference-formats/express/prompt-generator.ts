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
 * Prompt generator for A2UI Express inference format.
 *
 * Compiles component catalog structures and logic helper catalogs into compact plain-text
 * signatures and instruction blocks.
 */

import {AgentToRendererMessage, CatalogApi} from '../../internal/web-core.js';
import {PromptGenerator} from '../../prompt/generator.js';
import {toWireProtocolVersion} from '../../utils/protocol-version.js';
import {buildSchemaHelpers, catalogsDefining, resolveExpressVersion} from './catalogs.js';
import {ExpressDecompiler, RawNumber} from './decompiler.js';
import {CatalogSchemaHelper, commonDefName} from './schema-helper.js';

export const EXPRESS_RULES = `# A2UI Express DSL Output Contract

You must output the user interface using A2UI Express.

IMPORTANT: You MUST always surround the entire A2UI Express block with the sentinel tags \`<a2ui>\` and \`</a2ui>\`.

The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.

## Grammar Rules

1. Component constructors can be assigned to variables or nested inline inside parent component arguments:
   header = ComponentA(prop1="val1")
   root = ComponentB([header, ComponentC("Click", action=Event("submit"))])

   Keyword arguments (\`param=value\`) and positional arguments with \`_\` placeholders are supported.

   Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.

2. The interface tree must have a single entry point assigned to the reserved variable 'root'.

3. Primitives:
   - Strings: Quoted with \`"\` or \`"""\`. Support for \`\\n\`, \`\\t\`, \`\\\\\`, and \`\\"\` escapes.
     Raw Strings: Prefaced by \`r\` (e.g., \`r"..."\` or \`r"""..."""\`), with no escape processing.
   - Numbers: write as integers or decimals, e.g., 42
   - Booleans: write true or false
   - Null values: write null
   - Dates & Times: Values for date-time properties must strictly use RFC 3339 format with a timezone offset (e.g. "2026-03-14T00:00:00Z").

4. Lists: represent as arrays, e.g., [child1, child2].

5. Maps: represent as key-value blocks, e.g., {title: "Overview", child: contentCol}. Map keys are always literal strings (dynamic variable resolution is not supported for keys).

6. Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.
   Prefix relative list scopes with '$', e.g., $firstName.
   A lone '$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).

7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex("^[0-9]{5}$"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex("^[0-9]{5}$", "Postal code must be 5 digits").

8. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: $/form/rep})

9. Nested functions: call client functions directly using catalog signatures, for example myFunction("value").

10. Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = "value") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.

11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:
    _template($/path/to/list, itemTemplate)
    And define the template component variable on another line, utilizing relative path references prefixed with $:
    itemTemplate = ComponentA($url)

12. To delete a user interface surface, output the standalone \`deleteSurface(surfaceId)\` command (no variable assignment):
    deleteSurface("dashboard-surface-1")

13. Static properties: Arguments annotated with '(static)' in the signatures below MUST be defined as literal values or arrays inline. You CANNOT use a dynamic data binding path (prefixed by $) for these arguments.

14. Required actions: Action parameters (or parameters annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter.

15. Surface targeting: Output \`surface(surfaceId)\` to specify or target a user interface surface:
    surface("dashboard-surface-1")
    root = ComponentA(...)`;

/** The message types a fenced JSON example may contain to be rewritten as Express. */
const TRANSLATABLE_MESSAGE_TYPES = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
  'callFunction',
  'callRendererFunction',
] as const;

/**
 * Returns whether a parsed JSON value is a message the decompiler can translate.
 *
 * @param msg One element of a fenced JSON example.
 */
function isTranslatableMessage(msg: unknown): boolean {
  return (
    !!msg &&
    typeof msg === 'object' &&
    TRANSLATABLE_MESSAGE_TYPES.some(type => type in (msg as Record<string, unknown>))
  );
}

function getSchemaEnum(propSchema: unknown): string[] | undefined {
  if (!propSchema || typeof propSchema !== 'object') {
    return undefined;
  }
  const s = propSchema as Record<string, unknown>;
  if (Array.isArray(s.enum)) {
    return s.enum as string[];
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const list = s[key];
    if (Array.isArray(list)) {
      for (const sub of list) {
        const val = getSchemaEnum(sub);
        if (val) {
          return val;
        }
      }
    }
  }
  return undefined;
}

export class ExpressPromptGenerator extends PromptGenerator {
  private readonly examples?: Record<
    string,
    AgentToRendererMessage[] | AgentToRendererMessage[][] | string
  >;
  private readonly version: string;
  private readonly helpers: Map<string, CatalogSchemaHelper>;

  /**
   * @param catalogs Active catalogs to render instructions for.
   * @param examples Few-shot examples keyed by catalog id.
   * @param allowedMessages Optional allowlist of message names (`createSurface`,
   *     `updateComponents`, `updateDataModel`, `deleteSurface`). The base rules drop the
   *     instructions for messages outside it.
   * @param version Optional wire protocol version override.
   */
  constructor(
    catalogs: CatalogApi[],
    examples?: Record<string, AgentToRendererMessage[] | AgentToRendererMessage[][] | string>,
    private readonly allowedMessages?: readonly string[],
    version?: string,
  ) {
    super(catalogs);
    this.version = resolveExpressVersion(this.catalogs, version);
    this.examples = examples;
    this.helpers = buildSchemaHelpers(this.catalogs, this.version);
  }

  private getHelper(catalog: CatalogApi): CatalogSchemaHelper {
    let helper = this.helpers.get(catalog.id);
    if (!helper) {
      const version = toWireProtocolVersion(catalog.protocolVersion);
      helper = new CatalogSchemaHelper(catalog, version);
      this.helpers.set(catalog.id, helper);
    }
    return helper;
  }

  private multiCatalogRules(): string {
    const catalogList = this.catalogs.map(c => `- \`${c.id}\``).join('\n');
    const sharedLines: string[] = [];

    const activeHelpers = new Map<string, CatalogSchemaHelper>();
    for (const c of this.catalogs) {
      const h = this.helpers.get(c.id);
      if (h) {
        activeHelpers.set(c.id, h);
      }
    }

    const seenComponents = new Set<string>();
    for (const helper of activeHelpers.values()) {
      for (const name of helper.components.keys()) {
        if (seenComponents.has(name)) continue;
        seenComponents.add(name);
        const defining = catalogsDefining(activeHelpers, 'component', name);
        if (defining.length > 1) {
          const ids = defining.map(c => `\`${c}\``).join(', ');
          sharedLines.push(`- Component \`${name}\`: ${ids}`);
        }
      }
    }

    const seenFunctions = new Set<string>();
    for (const helper of activeHelpers.values()) {
      for (const name of helper.functions.keys()) {
        if (seenFunctions.has(name)) continue;
        seenFunctions.add(name);
        const defining = catalogsDefining(activeHelpers, 'function', name);
        if (defining.length > 1) {
          const ids = defining.map(c => `\`${c}\``).join(', ');
          sharedLines.push(`- Function \`${name}\`: ${ids}`);
        }
      }
    }

    const lines = [
      '',
      '## Multiple Catalogs',
      '',
      'Active catalogs for this request:',
      catalogList,
      '',
      '16. **No Catalog on `surface`**: Write `surface("surface_id")` with no catalog argument. Components from any active catalog may be used in the same surface.',
      '17. **Catalog Resolution**: A component or function whose name is in only one active catalog needs no `catalogId`. When a name is in more than one active catalog, pass `catalogId="<catalog_id>"` on the component or function call (or `{catalogId: "<catalog_id>"}` on a `?check(...)` call) to choose one.',
    ];
    if (sharedLines.length > 0) {
      lines.push(
        '',
        'Names defined in more than one active catalog (`catalogId` required):',
        ...sharedLines,
      );
    } else {
      lines.push(
        '',
        'No component or function names are shared across the active catalogs; omit `catalogId` on every call.',
      );
    }
    return lines.join('\n');
  }

  /**
   * Returns the core syntax contract and grammar rules for A2UI Express.
   *
   * Verbatim matches `EXPRESS_RULES` (and express_base_rules.txt) when no allowlist of
   * message types was given. Otherwise, filters out envelope-specific instructions
   * accordingly.
   */
  generateBaseRules(): string {
    const allowedMessages = this.allowedMessages;
    let rules = EXPRESS_RULES;
    let wantsComponentsOrData = true;

    if (allowedMessages) {
      // Filter rule 12 if deleteSurface is disallowed
      if (!allowedMessages.includes('deleteSurface')) {
        rules = rules.replace(
          /\n\n12\. To delete a user interface surface, output the standalone `deleteSurface\(surfaceId\)` command \(no variable assignment\):\n {4}deleteSurface\("dashboard-surface-1"\)/,
          '',
        );
      }

      // Filter rule 10 if updateDataModel is disallowed
      if (!allowedMessages.includes('updateDataModel')) {
        rules = rules.replace(
          /\n\n10\. Data model population: Assign a value directly to an absolute data path \(e\.g\. \$\/path\/to\/key = "value"\) to populate or initialize values inside the shared dataModel\. The value can be a primitive, array, or map\./,
          '',
        );
      }

      // Rule 15 teaches `surface(...)`, which component and data statements both need to
      // target a surface. Its `root = ...` line applies only to components, and the rule
      // goes when neither kind of statement is allowed.
      const writesComponents =
        allowedMessages.includes('createSurface') || allowedMessages.includes('updateComponents');
      const writesData = allowedMessages.includes('updateDataModel');
      wantsComponentsOrData = writesComponents || writesData;
      if (!writesComponents) {
        rules = rules.replace(/\n {4}root = ComponentA\(\.\.\.\)$/, '');
        if (!writesData) {
          rules = rules.replace(
            /\n\n15\. Surface targeting: Output `surface\(surfaceId\)` to specify or target a user interface surface:\n {4}surface\("dashboard-surface-1"\)$/,
            '',
          );
        }
      }
    }

    const lines = [rules];
    if (this.catalogs.length > 1 && wantsComponentsOrData) {
      lines.push(this.multiCatalogRules());
    }
    return lines.join('\n');
  }

  protected renderCatalogInstructions(catalog: CatalogApi): string {
    const helper = this.getHelper(catalog);
    const compSigs = this.generateComponentSignatures(helper);
    const funcSigs = this.generateFunctionSignatures(helper);

    const rawInstructions =
      catalog.instructions || (helper.catalog.instructions as string | undefined) || '';
    let catalogInstructions = rawInstructions;
    if (catalogInstructions) {
      const pattern = /```json\s*\n([\s\S]*?)\n```/g;
      catalogInstructions = catalogInstructions.replace(pattern, (match, jsonContent) =>
        this.replaceJsonBlockInInstructions(match, jsonContent),
      );
    }

    const catalogInstructionsBlock = catalogInstructions
      ? `\n\n## Catalog Instructions\n\n${catalogInstructions}`
      : '';

    let header = '';
    if (this.catalogs.length > 1) {
      header = `# Catalog: ${catalog.id}\n\n`;
    }

    return (
      header +
      '## Positional Component Signatures\n\n' +
      'Use these exact positional signatures to instantiate components. Do not output property keys:\n' +
      compSigs +
      '\n\n## Positional Function Signatures\n\n' +
      'Use these exact positional signatures to instantiate check rules or logic functions:\n' +
      funcSigs +
      catalogInstructionsBlock
    );
  }

  private replaceJsonBlockInInstructions(match: string, jsonContent: string): string {
    try {
      // Python's json.loads keeps `1500.00` as the float 1500.0, which the decompiler
      // writes as `1500.0`. JS numbers lose that distinction, so integral values written
      // with a decimal point are wrapped in RawNumber. This relies on the reviver's
      // `context.source` argument (JSON.parse source text access, Node 21+); on older
      // runtimes `context` is undefined and such values decompile as integers.
      const reviver = (_key: string, value: unknown, context?: {source?: string}): unknown => {
        if (typeof value === 'number' && context?.source && context.source.includes('.')) {
          if (Number.isInteger(value)) {
            return new RawNumber(`${value}.0`);
          }
        }
        return value;
      };
      const parsed = (
        JSON.parse as (
          text: string,
          reviver?: (_key: string, value: unknown, context?: {source?: string}) => unknown,
        ) => unknown
      )(jsonContent.trim(), reviver);
      const messages: unknown[] = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null
          ? [parsed]
          : [];
      if (messages.length === 0) {
        return match;
      }
      if (!messages.every(isTranslatableMessage)) {
        return match;
      }

      const fullDsl = this.decompileMessages(messages as AgentToRendererMessage[]);
      return `\`\`\`\n${fullDsl}\n\`\`\``;
    } catch {
      // Mirrors prompt_generator.py:446 (except Exception:)
      return match;
    }
  }

  private formatSignatureEntry(
    name: string,
    orderedArgs: string[],
    description: string | undefined,
    propDetails: string[],
  ): string {
    let sig = `• ${name}(${orderedArgs.join(', ')})`;
    if (description) {
      const descIndented = description.replaceAll('\n', '\n    ');
      sig += `\n  - Description: ${descIndented}`;
    }
    if (propDetails.length > 0) {
      sig += '\n' + propDetails.join('\n');
    }
    return sig;
  }

  private formatComponentArgLabel(
    propName: string,
    isRequired: boolean,
    pSchema: Record<string, unknown> | undefined,
    helper: CatalogSchemaHelper,
  ): string {
    let argLabel = `${propName}${isRequired ? '' : '?'}`;
    const ref =
      pSchema && typeof pSchema === 'object' && typeof pSchema.$ref === 'string'
        ? pSchema.$ref
        : undefined;
    if (ref && commonDefName(ref) === 'ComponentId') {
      argLabel += ' (component ID)';
    } else if (!helper.admitsPath(pSchema)) {
      argLabel += ' (static)';
    }
    return argLabel;
  }

  private formatSubKeyLines(properties: Record<string, unknown>): string {
    return Object.entries(properties)
      .map(([subK, subV]) => {
        const desc =
          subV &&
          typeof subV === 'object' &&
          typeof (subV as Record<string, unknown>).description === 'string'
            ? (subV as Record<string, unknown>).description
            : '';
        return `    * ${subK}${desc ? ` - ${desc}` : ''}`;
      })
      .join('\n');
  }

  private formatComponentPropertyDetail(
    propName: string,
    pSchema: Record<string, unknown> | undefined,
  ): string | undefined {
    if (!pSchema || typeof pSchema !== 'object') {
      return undefined;
    }

    const pDesc = typeof pSchema.description === 'string' ? pSchema.description : undefined;
    const enumVals = getSchemaEnum(pSchema);
    const lineParts: string[] = [];
    if (pDesc) {
      lineParts.push(pDesc);
    }
    if (enumVals) {
      lineParts.push(`Must be one of: ${enumVals.map(v => `'${v}'`).join(', ')}`);
    }

    let detail = lineParts.length > 0 ? `  - ${propName}: ${lineParts.join(' ')}` : undefined;

    if (pSchema.type === 'object' && pSchema.properties && typeof pSchema.properties === 'object') {
      const subKeys = this.formatSubKeyLines(pSchema.properties as Record<string, unknown>);
      detail = detail
        ? `${detail}\n    Map keys:\n${subKeys}`
        : `  - ${propName}: Map with keys:\n${subKeys}`;
    } else if (pSchema.type === 'array' && pSchema.items && typeof pSchema.items === 'object') {
      const itemsSchema = pSchema.items as Record<string, unknown>;
      if (
        itemsSchema.type === 'object' &&
        itemsSchema.properties &&
        typeof itemsSchema.properties === 'object'
      ) {
        const subKeys = this.formatSubKeyLines(itemsSchema.properties as Record<string, unknown>);
        detail = detail
          ? `${detail}\n    List of maps keys:\n${subKeys}`
          : `  - ${propName}: List of maps with keys:\n${subKeys}`;
      }
    }

    return detail;
  }

  generateComponentSignatures(helper: CatalogSchemaHelper): string {
    const compNames = Array.from(helper.components.keys()).sort();
    return compNames
      .map(name => {
        const props = helper.getComponentProperties(name);
        const reqs = helper.getComponentRequired(name);
        const orderedArgs: string[] = [];
        const propDetails: string[] = [];

        for (const p of props) {
          const pSchema = helper.getPropertySchema(name, p);
          orderedArgs.push(this.formatComponentArgLabel(p, reqs.includes(p), pSchema, helper));
          const detail = this.formatComponentPropertyDetail(p, pSchema);
          if (detail) {
            propDetails.push(detail);
          }
        }

        return this.formatSignatureEntry(
          name,
          orderedArgs,
          helper.getComponentDescription(name),
          propDetails,
        );
      })
      .join('\n');
  }

  generateFunctionSignatures(helper: CatalogSchemaHelper): string {
    const fnNames = Array.from(helper.functions.keys()).sort();
    return fnNames
      .map(name => {
        const props = helper.getFunctionProperties(name);
        const reqs = helper.getFunctionRequired(name);
        const orderedArgs: string[] = [];
        const propDetails: string[] = [];

        for (const p of props) {
          orderedArgs.push(`${p}${reqs.includes(p) ? '' : '?'}`);
          const pSchema = helper.getFunctionPropertySchema(name, p);
          const pDesc =
            pSchema && typeof pSchema.description === 'string' ? pSchema.description : undefined;
          if (pDesc) {
            propDetails.push(`  - ${p}: ${pDesc}`);
          }
        }

        return this.formatSignatureEntry(
          name,
          orderedArgs,
          helper.getFunctionDescription(name),
          propDetails,
        );
      })
      .join('\n');
  }

  transformExamples(rawExamplesMarkdown: string, _catalog?: CatalogApi): string {
    const pattern = /```json\s*\n([\s\S]*?)\n```/g;
    return rawExamplesMarkdown.replace(pattern, (match, jsonContent) =>
      this.replaceJsonBlock(match, jsonContent),
    );
  }

  private replaceJsonBlock(match: string, jsonContent: string): string {
    try {
      const parsed = JSON.parse(jsonContent.trim());
      const messages: unknown[] = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null
          ? [parsed]
          : [];
      if (messages.length === 0) {
        return match;
      }
      if (!messages.every(isTranslatableMessage)) {
        return match;
      }

      return this.decompileMessages(messages as AgentToRendererMessage[]);
    } catch {
      // Mirrors prompt_generator.py:477 (except Exception:)
      return match;
    }
  }

  /**
   * Decompiles a list of messages into one sentinel-wrapped Express block.
   *
   * The list goes to the decompiler as a whole so that messages for the same surface
   * (e.g. `createSurface` followed by `updateComponents`) merge under a single
   * `surface(...)` header. Decompiling them one at a time would emit an empty
   * `surface(...)` scope per message, which fails to compile.
   *
   * @param messages The messages of one example.
   */
  private decompileMessages(messages: AgentToRendererMessage[]): string {
    const decompiler = new ExpressDecompiler(this.catalogs, this.version);
    return decompiler.wrapDecompiledBlocks([decompiler.decompile(messages)]);
  }

  protected renderExamples(catalog: CatalogApi): string {
    if (!this.examples || !this.examples[catalog.id]) {
      return '';
    }

    const exampleMessages = this.examples[catalog.id];
    if (typeof exampleMessages === 'string') {
      return this.transformExamples(exampleMessages, catalog);
    }

    if (Array.isArray(exampleMessages) && exampleMessages.length > 0) {
      if (Array.isArray(exampleMessages[0])) {
        const decompiler = new ExpressDecompiler(this.catalogs, this.version);
        const blocks: string[] = [];
        for (const turn of exampleMessages as AgentToRendererMessage[][]) {
          const dsl = decompiler.decompile(turn);
          if (dsl) {
            blocks.push(decompiler.wrapDecompiledBlocks([dsl]));
          }
        }
        return blocks.join('\n\n');
      }
      return this.decompileMessages(exampleMessages as AgentToRendererMessage[]);
    }

    return '';
  }
}
