#!/usr/bin/env python3
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

# /// script
# dependencies = [
#   "google-genai",
# ]
# ///
"""Command-line tool to run AI inference evaluating the A2UI Express prompt.

Loads a standard A2UI JSON example, generates its A2UI Express prompt contract,
submits the conversion task to Gemini/Gemma 4 using the google-genai SDK,
and validates the generated output by compiling it back to standard JSON.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

try:
  # pylint: disable=import-error
  from google import genai
except ImportError:
  genai = None

# Support direct script execution from any directory
sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "..",
            "..",
            "agent_sdks",
            "python",
            "a2ui_agent",
            "src",
        )
    ),
)

# pylint: disable=import-error, wrong-import-position
import json
from a2ui.core.catalog import Catalog
from a2ui.experimental.express.compiler import ExpressCompiler
from a2ui.experimental.express.prompt_generator import ExpressPromptGenerator
# pylint: enable=import-error, wrong-import-position


def run_inference_and_validate(
    example_path: str,
    catalog_path: str,
    model_name: str,
    is_local: bool = False,
    is_mlx: bool = False,
) -> tuple[str, dict]:
  """Submits the example to the AI model and compiles the returned DSL.

  Args:
      example_path: Path to the standard A2UI JSON example file.
      catalog_path: Path to the catalog JSON schema.
      model_name: Name of the Gemini/Gemma model to call.
      is_local: Whether to query a local Ollama model instead of the Gemini API.
      is_mlx: Whether to query a local MLX-LM model instead of the Gemini API.

  Returns:
      A tuple containing:
        - The raw A2UI Express DSL outputted by the model.
        - The successfully compiled standard A2UI v1.0 JSON dict.

  Raises:
      ImportError: If google-genai package is not installed.
      FileNotFoundError: If files do not exist.
      ValueError: If example does not contain component updates or fails compilation.
  """
  if not is_local and not is_mlx:
    if genai is None:
      raise ImportError(
          "The 'google-genai' SDK is required to run this script in API mode. "
          "Install it using: pip install google-genai"
      )

  if not os.path.exists(example_path):
    raise FileNotFoundError(f"Example file not found: {example_path}")
  if not os.path.exists(catalog_path):
    raise FileNotFoundError(f"Catalog schema not found: {catalog_path}")

  with open(catalog_path, "r", encoding="utf-8") as f:
    catalog_dict = json.load(f)
  catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")

  # 1. Load the original example JSON to extract target component list
  with open(example_path, "r", encoding="utf-8") as f:
    ex_data = json.load(f)

  messages = ex_data.get("messages", [])
  components_list = None
  for msg in messages:
    if "updateComponents" in msg:
      components_list = msg["updateComponents"].get("components", [])
      break

  if not components_list:
    raise ValueError(f"Could not find any 'updateComponents' message in {example_path}")

  # 2. Generate prompt contract instructions
  prompt_generator = ExpressPromptGenerator(catalog)
  system_instruction = prompt_generator.generate_prompt()

  # 3. Construct conversion task prompt
  user_prompt = f"""You are an advanced UI compiler agent.

Translate the following standard A2UI component tree list into compact A2UI Express DSL variables assignments.
adhere strictly to the positional signatures and grammar rules specified in the system instruction output contract.

Do not wrap the output in markdown formatting blocks, do not include explanations, and do not output the createSurface envelope. Simply output the variable assignments, one statement per line.

## Input A2UI JSON Components List:
{json.dumps(components_list, indent=2)}

## Compiled A2UI Express DSL output:
"""

  if is_mlx:
    url = "http://localhost:8080/v1/chat/completions"
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
    }
    print(f"Submitting query to local MLX-LM model '{model_name}'...")
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
      with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode("utf-8"))
        choices = res_data.get("choices", [])
        if choices:
          dsl_output = choices[0].get("message", {}).get("content", "").strip()
        else:
          raise ValueError(f"Unexpected response structure from MLX: {res_data}")
    except urllib.error.URLError as e:
      raise ConnectionError(
          f"Failed to connect to local MLX-LM server at {url}. "
          f"Make sure you started the server: mlx_lm.server --model {model_name}. "
          f"Error details: {e}"
      ) from e
  elif is_local:
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": model_name,
        "prompt": user_prompt,
        "system": system_instruction,
        "stream": False,
        "options": {"temperature": 0.1},
    }
    print(f"Submitting query to local Ollama model '{model_name}'...")
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
      with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode("utf-8"))
        dsl_output = res_data.get("response", "").strip()
    except urllib.error.URLError as e:
      raise ConnectionError(
          f"Failed to connect to local Ollama server at {url}. "
          f"Make sure Ollama is installed and running (ollama serve): {e}"
      ) from e
  else:
    # 4. Submitting query to Gemini API
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
      raise ValueError(
          "GEMINI_API_KEY environment variable is not set. "
          "Please export it before running: export GEMINI_API_KEY='your-key'"
      )

    client = genai.Client(api_key=api_key)

    # Ensure model name is prefixed with models/ as expected by the API
    if not model_name.startswith("models/"):
      model_name = f"models/{model_name}"

    print("Waiting for API response...")
    response = client.models.generate_content(
        model=model_name,
        contents=user_prompt,
        config={
            "system_instruction": system_instruction,
            "temperature": 0.1,  # Low temperature for deterministic compiler output
        },
    )

    dsl_output = response.text.strip()
  # Strip any markdown code block wrappers if the model Hallucinated them
  if dsl_output.startswith("```"):
    lines = dsl_output.splitlines()
    if lines[0].startswith("```"):
      lines = lines[1:]
    if lines and lines[-1].startswith("```"):
      lines = lines[:-1]
    dsl_output = "\n".join(lines).strip()

  # 5. Run compilation to validate correctness of model-generated DSL
  compiler = ExpressCompiler(catalog)
  try:
    compiled_json = compiler.compile(dsl_output, surface_id="ai_surface")
  except Exception as ex:  # pylint: disable=broad-exception-caught
    raise ValueError(
        f"Generated A2UI Express DSL failed compilation: {ex}\n"
        f"Raw generated DSL:\n{dsl_output}"
    ) from ex

  return dsl_output, compiled_json


def list_available_models():
  """Fetches and prints all available models from the Gemini API."""
  if genai is None:
    raise ImportError(
        "The 'google-genai' SDK is required to list models. "
        "Install it using: pip install google-genai"
    )

  api_key = os.environ.get("GEMINI_API_KEY")
  if not api_key:
    raise ValueError(
        "GEMINI_API_KEY environment variable is not set. "
        "Please export it before running: export GEMINI_API_KEY='your-key'"
    )

  client = genai.Client(api_key=api_key)
  print("Available models:")
  for m in client.models.list():
    name = getattr(m, "name", str(m))
    print(f"  {name}")


def main():
  """CLI entrypoint for inference runner."""
  parser = argparse.ArgumentParser(
      description="Generate A2UI Express DSL from standard JSON using Gemini/Gemma."
  )
  parser.add_argument(
      "example_file",
      nargs="?",
      help="Path to the standard A2UI JSON example file to convert.",
  )
  parser.add_argument(
      "--list-models",
      action="store_true",
      help="List all available models from the Gemini API and exit.",
  )
  parser.add_argument(
      "--local",
      action="store_true",
      help=(
          "Query a local Ollama model endpoint at http://localhost:11434 "
          "instead of the Gemini API."
      ),
  )
  parser.add_argument(
      "--mlx",
      action="store_true",
      help=(
          "Query a local Apple MLX-LM server endpoint at http://localhost:8080 "
          "instead of the Gemini API."
      ),
  )
  parser.add_argument(
      "--model",
      default="gemma-4-31b-it",
      help="Name of the Gemini model to run (default: gemma-4-31b-it).",
  )
  parser.add_argument(
      "--catalog",
      default=os.path.join(
          os.path.dirname(__file__),
          "..",
          "..",
          "..",
          "v1_0",
          "catalogs",
          "basic",
          "catalog.json",
      ),
      help="Path to the catalog JSON schema (default: basic catalog).",
  )

  args = parser.parse_args()

  if args.list_models:
    try:
      list_available_models()
      sys.exit(0)
    except Exception as e:  # pylint: disable=broad-exception-caught
      print(f"Error listing models: {e}", file=sys.stderr)
      sys.exit(1)

  if not args.example_file:
    parser.print_help()
    sys.exit(1)

  # Set default model dynamically based on local/mlx environment
  model_target = args.model
  if model_target == "gemma-4-31b-it":
    if args.local:
      model_target = "gemma2"
    elif args.mlx:
      model_target = "mlx-community/gemma-4-e2b-it-4bit"

  env_label = "remote Gemini"
  if args.local:
    env_label = "local Ollama"
  elif args.mlx:
    env_label = "local Apple MLX-LM"

  print(
      f"Submitting example {os.path.basename(args.example_file)} "
      f"to {env_label} model '{model_target}'..."
  )
  try:
    dsl_output, compiled_json = run_inference_and_validate(
        args.example_file,
        args.catalog,
        model_target,
        is_local=args.local,
        is_mlx=args.mlx,
    )

    print("\n" + "=" * 40)
    print("GENERATED A2UI EXPRESS DSL (COMPILER INPUT):")
    print("=" * 40)
    print(dsl_output)

    print("\n" + "=" * 40)
    print("COMPILED WIRE JSON ENVELOPE (COMPILER OUTPUT):")
    print("=" * 40)
    print(json.dumps(compiled_json, indent=2))

    print("\nValidation successful! Compiler processed generated DSL with zero errors.")
    sys.exit(0)
  except Exception as e:  # pylint: disable=broad-exception-caught
    print(f"Error running inference/compilation: {e}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
  main()
