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

import {PromptGenerator} from '../../prompt/generator.js';
import {AgentToRendererMessage, CatalogApi} from '../../internal/web_core.js';
import {toWireProtocolVersion} from '../../utils/protocol_version.js';
import {CatalogSchemaHelper, commonDefName} from './schema_helper.js';
import {ExpressDecompiler, RawNumber} from './decompiler.js';

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
  private readonly examples?: Record<string, AgentToRendererMessage[] | string>;
  private readonly helpers = new Map<string, CatalogSchemaHelper>();
  private readonly decompilers = new Map<string, ExpressDecompiler>();

  /**
   * @param catalogs Active catalogs to render instructions for.
   * @param examples Few-shot examples keyed by catalog id.
   * @param allowedMessages Optional allowlist of message names (`createSurface`,
   *     `updateComponents`, `updateDataModel`, `deleteSurface`). The base rules drop the
   *     instructions for messages outside it.
   */
  constructor(
    catalogs: CatalogApi[],
    examples?: Record<string, AgentToRendererMessage[] | string>,
    private readonly allowedMessages?: readonly string[],
  ) {
    super(catalogs);
    this.examples = examples;
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

  private getDecompiler(catalog: CatalogApi): ExpressDecompiler {
    let decompiler = this.decompilers.get(catalog.id);
    if (!decompiler) {
      const version = toWireProtocolVersion(catalog.protocolVersion);
      decompiler = new ExpressDecompiler([catalog], version);
      this.decompilers.set(catalog.id, decompiler);
    }
    return decompiler;
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
    if (!allowedMessages) {
      return EXPRESS_RULES;
    }

    let rules = EXPRESS_RULES;

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

    // Filter rule 15 if neither createSurface nor updateComponents is allowed
    if (
      !allowedMessages.includes('createSurface') &&
      !allowedMessages.includes('updateComponents')
    ) {
      rules = rules.replace(
        /\n\n15\. Surface targeting: Output `surface\(surfaceId\)` to specify or target a user interface surface:\n {4}surface\("dashboard-surface-1"\)\n {4}root = ComponentA\(\.\.\.\)/,
        '',
      );
    }

    return rules;
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
        this.replaceJsonBlockInInstructions(match, jsonContent, catalog),
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

  private replaceJsonBlockInInstructions(
    match: string,
    jsonContent: string,
    catalog: CatalogApi,
  ): string {
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

      const decompiler = this.getDecompiler(catalog);
      const dslBlocks = (messages as AgentToRendererMessage[]).map(msg =>
        decompiler.decompile(msg),
      );
      const fullDsl = decompiler.wrapDecompiledBlocks(dslBlocks);
      return `\`\`\`\n${fullDsl}\n\`\`\``;
    } catch {
      // Mirrors prompt_generator.py:446 (except Exception:)
      return match;
    }
  }

  generateComponentSignatures(helper: CatalogSchemaHelper): string {
    const signatures: string[] = [];
    const compNames = Array.from(helper.components.keys()).sort();

    for (const name of compNames) {
      const props = helper.getComponentProperties(name);
      const reqs = helper.getComponentRequired(name);
      const compDesc = helper.getComponentDescription(name);

      const orderedArgs: string[] = [];
      const propDetails: string[] = [];

      for (const p of props) {
        const isReq = reqs.includes(p);
        const optSuffix = isReq ? '' : '?';

        const pSchema = helper.getPropertySchema(name, p);
        let argLabel = `${p}${optSuffix}`;

        let isComponentId = false;
        if (
          pSchema &&
          typeof pSchema === 'object' &&
          typeof (pSchema as Record<string, unknown>).$ref === 'string'
        ) {
          if (commonDefName((pSchema as Record<string, unknown>).$ref) === 'ComponentId') {
            isComponentId = true;
          }
        }

        if (isComponentId) {
          argLabel += ' (component ID)';
        } else if (!helper.admitsPath(pSchema)) {
          argLabel += ' (static)';
        }

        orderedArgs.push(argLabel);

        const pDesc =
          pSchema && typeof pSchema === 'object' && typeof pSchema.description === 'string'
            ? pSchema.description
            : undefined;
        const enumVals = getSchemaEnum(pSchema);

        if (pDesc || enumVals) {
          const pLineParts: string[] = [];
          if (pDesc) {
            pLineParts.push(pDesc);
          }
          if (enumVals) {
            const enumValsStr = enumVals.map(v => `'${v}'`).join(', ');
            pLineParts.push(`Must be one of: ${enumValsStr}`);
          }
          propDetails.push(`  - ${p}: ${pLineParts.join(' ')}`);
        }

        // Fetch property schema and check if it has nested object structure
        if (pSchema && typeof pSchema === 'object') {
          const s = pSchema as Record<string, unknown>;
          if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
            const subKeys: string[] = [];
            for (const [subK, subV] of Object.entries(s.properties as Record<string, unknown>)) {
              const desc =
                subV &&
                typeof subV === 'object' &&
                typeof (subV as Record<string, unknown>).description === 'string'
                  ? (subV as Record<string, unknown>).description
                  : '';
              const descSuffix = desc ? ` - ${desc}` : '';
              subKeys.push(`    * ${subK}${descSuffix}`);
            }

            if (
              propDetails.length > 0 &&
              propDetails[propDetails.length - 1].startsWith(`  - ${p}:`)
            ) {
              propDetails[propDetails.length - 1] += '\n    Map keys:\n' + subKeys.join('\n');
            } else {
              propDetails.push(`  - ${p}: Map with keys:\n` + subKeys.join('\n'));
            }
          } else if (s.type === 'array' && s.items && typeof s.items === 'object') {
            const itemsSchema = s.items as Record<string, unknown>;
            if (
              itemsSchema.type === 'object' &&
              itemsSchema.properties &&
              typeof itemsSchema.properties === 'object'
            ) {
              const subKeys: string[] = [];
              for (const [subK, subV] of Object.entries(
                itemsSchema.properties as Record<string, unknown>,
              )) {
                const desc =
                  subV &&
                  typeof subV === 'object' &&
                  typeof (subV as Record<string, unknown>).description === 'string'
                    ? (subV as Record<string, unknown>).description
                    : '';
                const descSuffix = desc ? ` - ${desc}` : '';
                subKeys.push(`    * ${subK}${descSuffix}`);
              }

              if (
                propDetails.length > 0 &&
                propDetails[propDetails.length - 1].startsWith(`  - ${p}:`)
              ) {
                propDetails[propDetails.length - 1] +=
                  '\n    List of maps keys:\n' + subKeys.join('\n');
              } else {
                propDetails.push(`  - ${p}: List of maps with keys:\n` + subKeys.join('\n'));
              }
            }
          }
        }
      }

      let sig = `• ${name}(${orderedArgs.join(', ')})`;
      if (compDesc) {
        const descIndented = compDesc.replaceAll('\n', '\n    ');
        sig += `\n  - Description: ${descIndented}`;
      }
      if (propDetails.length > 0) {
        sig += '\n' + propDetails.join('\n');
      }
      signatures.push(sig);
    }

    return signatures.join('\n');
  }

  generateFunctionSignatures(helper: CatalogSchemaHelper): string {
    const signatures: string[] = [];
    const fnNames = Array.from(helper.functions.keys()).sort();

    for (const name of fnNames) {
      const props = helper.getFunctionProperties(name);
      const reqs = helper.getFunctionRequired(name);
      const fDesc = helper.getFunctionDescription(name);

      const orderedArgs: string[] = [];
      const propDetails: string[] = [];

      for (const p of props) {
        const isReq = reqs.includes(p);
        const optSuffix = isReq ? '' : '?';
        orderedArgs.push(`${p}${optSuffix}`);

        const pSchema = helper.getFunctionPropertySchema(name, p);
        const pDesc =
          pSchema && typeof pSchema.description === 'string' ? pSchema.description : undefined;
        if (pDesc) {
          propDetails.push(`  - ${p}: ${pDesc}`);
        }
      }

      let sig = `• ${name}(${orderedArgs.join(', ')})`;
      if (fDesc) {
        const descIndented = fDesc.replaceAll('\n', '\n    ');
        sig += `\n  - Description: ${descIndented}`;
      }
      if (propDetails.length > 0) {
        sig += '\n' + propDetails.join('\n');
      }
      signatures.push(sig);
    }

    return signatures.join('\n');
  }

  transformExamples(rawExamplesMarkdown: string, catalog: CatalogApi): string {
    const pattern = /```json\s*\n([\s\S]*?)\n```/g;
    return rawExamplesMarkdown.replace(pattern, (match, jsonContent) =>
      this.replaceJsonBlock(match, jsonContent, catalog),
    );
  }

  private replaceJsonBlock(match: string, jsonContent: string, catalog: CatalogApi): string {
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

      const decompiler = this.getDecompiler(catalog);
      const blocks = (messages as AgentToRendererMessage[]).map(msg => decompiler.decompile(msg));
      return decompiler.wrapDecompiledBlocks(blocks);
    } catch {
      // Mirrors prompt_generator.py:477 (except Exception:)
      return match;
    }
  }

  protected renderExamples(catalog: CatalogApi): string {
    if (!this.examples || !this.examples[catalog.id]) {
      return '';
    }

    const ex = this.examples[catalog.id];
    if (typeof ex === 'string') {
      return this.transformExamples(ex, catalog);
    }

    const decompiler = this.getDecompiler(catalog);
    const decompiled = decompiler.decompile(ex);
    return decompiler.wrapDecompiledBlocks([decompiled]);
  }
}
