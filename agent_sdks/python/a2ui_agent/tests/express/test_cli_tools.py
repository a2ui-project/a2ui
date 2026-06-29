# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests for A2UI Express CLI tools/scripts."""

import os
import sys
import json
import urllib.error
import unittest
import tempfile
from unittest.mock import patch, MagicMock

# Set up environment variables
os.environ["A2UI_EXPRESS_ENABLED"] = "true"

# Add express proposals directory to sys.path to import run_* scripts
EXPRESS_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "..",
        "..",
        "specification",
        "proposals",
        "express",
        "scripts",
    )
)
sys.path.insert(0, EXPRESS_DIR)

# Import CLI modules
import run_compiler
import run_decompiler
import run_prompt_generator
import run_inference

# Reference paths to real basic catalog and schemas
SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "..",
        "..",
        "specification",
        "v1_0",
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")
EXAMPLES_DIR = os.path.join(SPEC_DIR, "catalogs", "basic", "examples")


class TestCliTools(unittest.TestCase):
  """Validates all CLI tools under specification/proposals/express/."""

  def setUp(self):
    self.temp_dir = tempfile.TemporaryDirectory()
    self.dsl_file = os.path.join(self.temp_dir.name, "sample.express")
    self.json_file = os.path.join(self.temp_dir.name, "sample.json")

    with open(self.dsl_file, "w", encoding="utf-8") as f:
      f.write('welcome = Text("Hello World")\nroot = Column([welcome])')

    # Standard A2UI example JSON format (array of messages inside a 'messages' key)
    with open(self.json_file, "w", encoding="utf-8") as f:
      f.write(
          json.dumps({
              "messages": [
                  {
                      "version": "v1.0",
                      "createSurface": {
                          "surfaceId": "test_surface",
                          "catalogId": "my_catalog",
                      },
                  },
                  {
                      "version": "v1.0",
                      "updateComponents": {
                          "surfaceId": "test_surface",
                          "components": [
                              {
                                  "id": "welcome",
                                  "component": "Text",
                                  "text": "Hello World",
                              },
                              {
                                  "id": "root",
                                  "component": "Column",
                                  "children": ["welcome"],
                              },
                          ],
                      },
                  },
              ]
          })
      )

  def tearDown(self):
    self.temp_dir.cleanup()

  # ----------------------------------------------------
  # run_compiler.py Tests
  # ----------------------------------------------------

  def test_compiler_dsl_file_compilation(self):
    """Verifies compilation of a DSL file."""
    envelope = run_compiler.compile_dsl_file(
        self.dsl_file, CATALOG_PATH, "my_surface", "my_catalog"
    )
    self.assertEqual(envelope["version"], "v1.0")
    self.assertEqual(envelope["createSurface"]["surfaceId"], "my_surface")
    self.assertEqual(envelope["createSurface"]["catalogId"], "my_catalog")

    # Verifies missing files raise FileNotFoundError
    with self.assertRaises(FileNotFoundError):
      run_compiler.compile_dsl_file(
          "missing_dsl.txt", CATALOG_PATH, "my_surface", "my_catalog"
      )
    with self.assertRaises(FileNotFoundError):
      run_compiler.compile_dsl_file(
          self.dsl_file, "missing_catalog.json", "my_surface", "my_catalog"
      )

  @patch("sys.stdout")
  def test_compiler_main_cli(self, mock_stdout):
    """Verifies the compiler CLI runner."""
    test_args = [
        "run_compiler.py",
        self.dsl_file,
        "--surface-id",
        "cli_surface",
        "--catalog",
        CATALOG_PATH,
    ]
    with patch("sys.argv", test_args):
      with self.assertRaises(SystemExit) as cm:
        run_compiler.main()
      self.assertEqual(cm.exception.code, 0)

    printed = "".join(call.args[0] for call in mock_stdout.write.call_args_list)
    compiled = json.loads(printed)
    self.assertEqual(compiled["createSurface"]["surfaceId"], "cli_surface")

  @patch("sys.stderr")
  def test_compiler_main_cli_error(self, mock_stderr):
    """Verifies compiler CLI runner error handling."""
    test_args = [
        "run_compiler.py",
        "missing_dsl.txt",
    ]
    with patch("sys.argv", test_args):
      with self.assertRaises(SystemExit) as cm:
        run_compiler.main()
      self.assertEqual(cm.exception.code, 1)

  # ----------------------------------------------------
  # run_decompiler.py Tests
  # ----------------------------------------------------

  def test_decompiler_example(self):
    """Verifies decompilation of a JSON layout example file."""
    dsl = run_decompiler.decompile_example(self.json_file, CATALOG_PATH)
    self.assertIn("welcome = Text", dsl)
    self.assertIn("root = Column", dsl)

    with self.assertRaises(FileNotFoundError):
      run_decompiler.decompile_example("missing_example.json", CATALOG_PATH)
    with self.assertRaises(FileNotFoundError):
      run_decompiler.decompile_example(self.json_file, "missing_catalog.json")

  @patch("sys.stdout")
  def test_decompiler_main_cli(self, mock_stdout):
    """Verifies the decompiler CLI runner."""
    test_args = [
        "run_decompiler.py",
        self.json_file,
        "--catalog",
        CATALOG_PATH,
    ]
    with patch("sys.argv", test_args):
      with self.assertRaises(SystemExit) as cm:
        run_decompiler.main()
      self.assertEqual(cm.exception.code, 0)

    printed = "".join(call.args[0] for call in mock_stdout.write.call_args_list)
    self.assertIn("welcome = Text", printed)

  @patch("sys.stderr")
  def test_decompiler_main_cli_error(self, mock_stderr):
    """Verifies decompiler CLI runner error handling."""
    test_args = [
        "run_decompiler.py",
        "missing_example.json",
    ]
    with patch("sys.argv", test_args):
      with self.assertRaises(SystemExit) as cm:
        run_decompiler.main()
      self.assertEqual(cm.exception.code, 1)

  # ----------------------------------------------------
  # run_prompt_generator.py Tests
  # ----------------------------------------------------

  def test_prompt_generator(self):
    """Verifies direct prompt text generation."""
    prompt = run_prompt_generator.generate_prompt_text(CATALOG_PATH)
    self.assertIn("A2UI Express Output Contract", prompt)
    self.assertIn("Button(", prompt)

    with self.assertRaises(FileNotFoundError):
      run_prompt_generator.generate_prompt_text("missing_catalog.json")

  @patch("sys.stdout")
  def test_prompt_generator_main_cli(self, mock_stdout):
    """Verifies prompt generator CLI runner."""
    test_args = [
        "run_prompt_generator.py",
        "--catalog",
        CATALOG_PATH,
    ]
    with patch("sys.argv", test_args):
      with self.assertRaises(SystemExit) as cm:
        run_prompt_generator.main()
      self.assertEqual(cm.exception.code, 0)

    printed = "".join(call.args[0] for call in mock_stdout.write.call_args_list)
    self.assertIn("A2UI Express Output Contract", printed)

  @patch("sys.stderr")
  def test_prompt_generator_main_cli_error(self, mock_stderr):
    """Verifies prompt generator CLI runner error handling."""
    test_args = [
        "run_prompt_generator.py",
        "--catalog",
        "missing_catalog.json",
    ]
    with patch("sys.argv", test_args):
      with self.assertRaises(SystemExit) as cm:
        run_prompt_generator.main()
      self.assertEqual(cm.exception.code, 1)

  # ----------------------------------------------------
  # run_inference.py Tests
  # ----------------------------------------------------

  @patch("urllib.request.urlopen")
  def test_run_inference_mlx(self, mock_urlopen):
    """Verifies local MLX server inference route and markdown stripping."""
    # Test valid response wrapped in triple backticks markdown
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps({
        "choices": [{
            "message": {
                "content": (
                    '```\n<a2ui>\nwelcome = Text("Hello MLX")\nroot ='
                    " Column([welcome])\n</a2ui>\n```"
                )
            }
        }]
    }).encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    dsl_output, compiled_json = run_inference.run_inference_and_validate(
        self.json_file,
        CATALOG_PATH,
        model_name="gemma-4-31b-it",
        is_mlx=True,
    )
    self.assertIn("Hello MLX", dsl_output)
    self.assertEqual(compiled_json["version"], "v1.0")

  @patch("urllib.request.urlopen")
  def test_run_inference_mlx_error_empty_choices(self, mock_urlopen):
    """Verifies MLX handles empty choices gracefully."""
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps({"choices": []}).encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    with self.assertRaises(ValueError):
      run_inference.run_inference_and_validate(
          self.json_file,
          CATALOG_PATH,
          model_name="gemma-4-31b-it",
          is_mlx=True,
      )

  @patch("urllib.request.urlopen")
  def test_run_inference_mlx_connection_error(self, mock_urlopen):
    """Verifies MLX handles server connection errors."""
    mock_urlopen.side_effect = urllib.error.URLError("Connection refused")
    with self.assertRaises(ConnectionError):
      run_inference.run_inference_and_validate(
          self.json_file,
          CATALOG_PATH,
          model_name="gemma-4-31b-it",
          is_mlx=True,
      )

  @patch("urllib.request.urlopen")
  def test_run_inference_local_ollama_connection_error(self, mock_urlopen):
    """Verifies Ollama handles server connection errors."""
    mock_urlopen.side_effect = urllib.error.URLError("Connection refused")
    with self.assertRaises(ConnectionError):
      run_inference.run_inference_and_validate(
          self.json_file,
          CATALOG_PATH,
          model_name="gemma2",
          is_local=True,
      )

  def test_run_inference_missing_update_components(self):
    """Verifies run_inference raises ValueError if updateComponents message is missing."""
    invalid_json_file = os.path.join(self.temp_dir.name, "invalid_sample.json")
    with open(invalid_json_file, "w", encoding="utf-8") as f:
      f.write(json.dumps({"messages": [{"version": "v1.0", "createSurface": {}}]}))
    with self.assertRaises(ValueError):
      run_inference.run_inference_and_validate(invalid_json_file, CATALOG_PATH, "model")

  def test_run_inference_missing_keys_and_files(self):
    """Verifies inference validation checks raise correct errors."""
    with self.assertRaises(FileNotFoundError):
      run_inference.run_inference_and_validate(
          "missing_example.json", CATALOG_PATH, "model"
      )
    with self.assertRaises(FileNotFoundError):
      run_inference.run_inference_and_validate(
          self.json_file, "missing_catalog.json", "model"
      )

    # Missing API key raises ValueError
    with patch.dict(os.environ, {}, clear=True):
      with self.assertRaises(ValueError):
        run_inference.run_inference_and_validate(self.json_file, CATALOG_PATH, "model")

  @patch("google.genai.Client")
  def test_run_inference_invalid_dsl_compilation(self, mock_genai_client):
    """Verifies inference compilation validation failure propagates ValueError."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "<a2ui>\nroot = InvalidSyntaxError!!\n</a2ui>"
    mock_client.models.generate_content.return_value = mock_response
    mock_genai_client.return_value = mock_client

    with patch.dict(os.environ, {"GEMINI_API_KEY": "dummy_key"}):
      with self.assertRaises(ValueError) as ctx:
        run_inference.run_inference_and_validate(
            self.json_file, CATALOG_PATH, "gemma-4-31b-it"
        )
      self.assertIn("failed compilation", str(ctx.exception))

  @patch("google.genai.Client")
  def test_list_available_models(self, mock_genai_client):
    """Verifies listing models with missing API key."""
    with patch.dict(os.environ, {}, clear=True):
      with self.assertRaises(ValueError):
        run_inference.list_available_models()

  @patch("sys.stdout")
  @patch("google.genai.Client")
  def test_inference_main_cli_list_models(self, mock_genai_client, mock_stdout):
    """Verifies list-models CLI argument path."""
    mock_client = MagicMock()
    mock_model = MagicMock()
    mock_model.name = "models/gemini-pro"
    mock_client.models.list.return_value = [mock_model]
    mock_genai_client.return_value = mock_client

    test_args = ["run_inference.py", "--list-models"]
    with patch.dict(os.environ, {"GEMINI_API_KEY": "dummy_key"}):
      with patch("sys.argv", test_args):
        with self.assertRaises(SystemExit) as cm:
          run_inference.main()
        self.assertEqual(cm.exception.code, 0)

  @patch("sys.stdout")
  def test_inference_main_cli_missing_args(self, mock_stdout):
    """Verifies run_inference.py CLI missing positional arguments handles exits."""
    test_args = ["run_inference.py"]
    with patch("sys.argv", test_args):
      with self.assertRaises(SystemExit) as cm:
        run_inference.main()
      self.assertEqual(cm.exception.code, 1)

  @patch("sys.stdout")
  @patch("google.genai.Client")
  def test_inference_main_cli_local_mlx_mapping(self, mock_genai_client, mock_stdout):
    """Verifies local Orama and MLX model mappings within inference main CLI."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = (
        '<a2ui>\nwelcome = Text("Hello Main")\nroot = Column([welcome])\n</a2ui>'
    )
    mock_client.models.generate_content.return_value = mock_response
    mock_genai_client.return_value = mock_client

    # Case 1: local Ollama mapping
    test_args_local = [
        "run_inference.py",
        self.json_file,
        "--local",
        "--catalog",
        CATALOG_PATH,
    ]
    with patch.dict(os.environ, {"GEMINI_API_KEY": "dummy_key"}):
      with patch("sys.argv", test_args_local):
        # We expect it to raise ConnectionError because Ollama server is not running
        with self.assertRaises(SystemExit) as cm:
          with patch("urllib.request.urlopen") as mock_url:
            mock_url.side_effect = urllib.error.URLError("Refused")
            run_inference.main()
        self.assertEqual(cm.exception.code, 1)

    # Case 2: MLX local server mapping
    test_args_mlx = [
        "run_inference.py",
        self.json_file,
        "--mlx",
        "--catalog",
        CATALOG_PATH,
    ]
    with patch.dict(os.environ, {"GEMINI_API_KEY": "dummy_key"}):
      with patch("sys.argv", test_args_mlx):
        with self.assertRaises(SystemExit) as cm:
          with patch("urllib.request.urlopen") as mock_url:
            mock_url.side_effect = urllib.error.URLError("Refused")
            run_inference.main()
        self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
  unittest.main()
