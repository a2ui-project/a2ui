/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {execSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function getPythonExecutable(): string {
  const repoVenv = path.resolve(process.cwd(), '../../.venv/bin/python');
  if (fs.existsSync(repoVenv)) {
    return repoVenv;
  }
  if (process.env.VIRTUAL_ENV) {
    const venvPython = path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
  }
  return 'python3';
}

describe('a2ui CLI end-to-end command execution', () => {
  const cliPath = path.resolve(process.cwd(), 'dist/src/cli.js');
  const catalogPath = path.resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );
  const pythonBin = getPythonExecutable();
  const pythonSdkPath = path.resolve(process.cwd(), '../../agent_sdks/python/a2ui_agent/src');
  const pythonCorePath = path.resolve(process.cwd(), '../../agent_sdks/python/a2ui_core/src');

  it('prints help with codegen command', () => {
    const output = execSync(`node "${cliPath}" --help`, {encoding: 'utf-8'});
    assert.ok(output.includes('Usage: a2ui [options] [command]'));
    assert.ok(output.includes('codegen'));
  });

  it('executes codegen and writes single-file module into target output directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-cli-e2e-'));
    try {
      const output = execSync(
        `node "${cliPath}" codegen --catalog "${catalogPath}" --out "${tmpDir}"`,
        {encoding: 'utf-8'},
      );
      assert.ok(output.includes('Successfully generated 1 file(s)'));
      assert.ok(fs.existsSync(path.join(tmpDir, 'basic.py')));

      const content = fs.readFileSync(path.join(tmpDir, 'basic.py'), 'utf-8');
      assert.ok(content.includes('class Button(ComponentBuilderNode):'));
      assert.ok(content.includes('ButtonVariant = Literal['));
      assert.ok(content.includes('def open_url('));
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });

  it('executes codegen and verifies generated code runs in Python SDK producing valid A2UI JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-cli-py-e2e-'));
    try {
      // 1. Run CLI codegen to emit basic.py
      execSync(`node "${cliPath}" codegen -c "${catalogPath}" -o "${tmpDir}"`, {
        encoding: 'utf-8',
      });
      assert.ok(fs.existsSync(path.join(tmpDir, 'basic.py')));

      // 2. Python verification script constructing a fluent UI tree and serializing to JSON
      const pyScript = `
import json
import sys
from basic import (
    Action,
    Button,
    Card,
    Column,
    Row,
    Text,
    bind,
    create_surface,
    open_url,
    update_components,
)

# Build a fluent component tree
tree = Card(
    child=Column(
        children=[
            Text(text="Welcome to A2UI", variant="h1"),
            Row(
                children=[
                    Text(text=bind("/app/status"), variant="caption"),
                    Button(
                        child=Text(text="Explore Docs"),
                        action=Action(event="open_link", context={"url": "https://a2ui.org"}),
                    ),
                ]
            ),
        ]
    )
)

fn_call = open_url(url="https://a2ui.org/specification")
surface_msgs = create_surface("surface_main", root=tree, catalog_id="org.a2ui.basic")
update_msgs = update_components("surface_main", root=tree)

output = {
    "surface_messages": surface_msgs,
    "update_messages": update_msgs,
    "components": tree.to_components(),
    "function_call": fn_call.to_dict(),
}
print(json.dumps(output))
`;

      const scriptPath = path.join(tmpDir, 'test_builder.py');
      fs.writeFileSync(scriptPath, pyScript, 'utf-8');

      // 3. Execute Python subprocess importing the generated library and SDK
      const pyOut = execSync(`"${pythonBin}" "${scriptPath}"`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PYTHONPATH: [tmpDir, pythonSdkPath, pythonCorePath, process.env.PYTHONPATH || ''].join(
            path.delimiter,
          ),
        },
      });

      const result = JSON.parse(pyOut.trim());

      // 4. Verify createSurface envelope message
      assert.strictEqual(result.surface_messages.length, 2);
      const createMsg = result.surface_messages[0].createSurface;
      assert.strictEqual(createMsg.surfaceId, 'surface_main');
      assert.strictEqual(createMsg.catalogId, 'org.a2ui.basic');

      // 5. Verify updateComponents envelope message
      const updateMsg = result.surface_messages[1].updateComponents;
      assert.strictEqual(updateMsg.surfaceId, 'surface_main');
      assert.strictEqual(result.update_messages.length, 1);
      assert.strictEqual(result.update_messages[0].updateComponents.surfaceId, 'surface_main');

      // 6. Verify flattened components and ID references
      const comps = result.components as Array<Record<string, unknown>>;
      assert.strictEqual(comps.length, 7);

      const card = comps.find(c => c.component === 'Card');
      const column = comps.find(c => c.component === 'Column');
      const row = comps.find(c => c.component === 'Row');
      const button = comps.find(c => c.component === 'Button');
      const texts = comps.filter(c => c.component === 'Text');

      assert.ok(card, 'Card component must be present');
      assert.ok(column, 'Column component must be present');
      assert.ok(row, 'Row component must be present');
      assert.ok(button, 'Button component must be present');
      assert.strictEqual(texts.length, 3, 'Three Text components must be present');

      // Hierarchy assertions
      assert.strictEqual(card.child, column.id);
      assert.deepStrictEqual(column.children, [texts[0].id, row.id]);
      assert.deepStrictEqual(row.children, [texts[1].id, button.id]);
      assert.strictEqual(button.child, texts[2].id);

      // Value assertions
      assert.strictEqual(texts[0].text, 'Welcome to A2UI');
      assert.strictEqual(texts[0].variant, 'h1');
      assert.deepStrictEqual(texts[1].text, {path: '/app/status'});
      assert.strictEqual(texts[2].text, 'Explore Docs');

      assert.deepStrictEqual(button.action, {
        event: {
          name: 'open_link',
          context: {url: 'https://a2ui.org'},
        },
      });

      // Function wrapper assertion
      assert.deepStrictEqual(result.function_call, {
        call: 'openUrl',
        args: {url: 'https://a2ui.org/specification'},
      });
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });

  it('verifies generated Pydantic models reject misspelled attributes in Python', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-cli-py-strict-'));
    try {
      execSync(`node "${cliPath}" codegen -c "${catalogPath}" -o "${tmpDir}"`, {
        encoding: 'utf-8',
      });

      const pyScript = `
from pydantic import ValidationError
from basic import Text

try:
    Text(text="Hello", unrecognized_typo_property="Bad")
    print("FAILED_NO_ERROR")
except ValidationError as e:
    assert "extra_forbidden" in str(e)
    print("VALIDATION_ERROR_SUCCESS")
`;
      const scriptPath = path.join(tmpDir, 'test_strict.py');
      fs.writeFileSync(scriptPath, pyScript, 'utf-8');

      const pyOut = execSync(`"${pythonBin}" "${scriptPath}"`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PYTHONPATH: [tmpDir, pythonSdkPath, pythonCorePath, process.env.PYTHONPATH || ''].join(
            path.delimiter,
          ),
        },
      });

      assert.strictEqual(pyOut.trim(), 'VALIDATION_ERROR_SUCCESS');
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });

  it('verifies generated open enums accept custom string variants in Python', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-cli-py-enum-'));
    try {
      execSync(`node "${cliPath}" codegen -c "${catalogPath}" -o "${tmpDir}"`, {
        encoding: 'utf-8',
      });

      const pyScript = `
import json
from basic import Action, Button, Text

# Pass forward-compatible custom variants not in the original enum
btn = Button(
    child=Text(text="Custom Variant", variant="custom-hero-heading"),
    action=Action(event="click"),
    variant="custom-pill-gradient",
)
comps = btn.to_components()
button_comp = next(c for c in comps if c["component"] == "Button")
text_comp = next(c for c in comps if c["component"] == "Text")

output = {
    "button_variant": button_comp.get("variant"),
    "text_variant": text_comp.get("variant"),
}
print(json.dumps(output))
`;
      const scriptPath = path.join(tmpDir, 'test_enum.py');
      fs.writeFileSync(scriptPath, pyScript, 'utf-8');

      const pyOut = execSync(`"${pythonBin}" "${scriptPath}"`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PYTHONPATH: [tmpDir, pythonSdkPath, pythonCorePath, process.env.PYTHONPATH || ''].join(
            path.delimiter,
          ),
        },
      });

      const output = JSON.parse(pyOut.trim());
      assert.strictEqual(output.button_variant, 'custom-pill-gradient');
      assert.strictEqual(output.text_variant, 'custom-hero-heading');
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });
});
