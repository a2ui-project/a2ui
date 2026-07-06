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

"""Dataset loader for A2UI evaluation."""

import json
import os

import jsonschema
import yaml
from inspect_ai.dataset import MemoryDataset, Sample

from datasets.defaults import DEFAULT_CATALOG_PATH, DEFAULT_WORKFLOW_DESCRIPTION, DEFAULT_ROLE_DESCRIPTION
from a2ui_eval.shared.utils import GIT_ROOT

SCHEMA_PATH = GIT_ROOT / 'eval' / 'datasets' / 'dataset_schema.json'


def load_a2ui_dataset(
    file_path: str, default_catalog_path: str | None = None
) -> MemoryDataset:
  """Loads A2UI evaluation samples from a YAML file.

  Args:
      file_path: The path to the YAML dataset file.
      default_catalog_path: The default catalog path to use if not specified in the sample.

  Returns:
      A MemoryDataset containing the resolved samples.

  Raises:
      FileNotFoundError: If the dataset file does not exist.
  """
  if not os.path.exists(file_path):
    raise FileNotFoundError(f'Dataset file not found: {file_path}')

  with open(file_path, 'r', encoding='utf-8') as f:
    data = yaml.safe_load(f)

  with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
    schema = json.load(f)

  jsonschema.validate(instance=data, schema=schema)

  samples = []
  for item in data:
    samples.append(
        Sample(
            input=item['promptText'],
            target=item.get('target') or item.get('description'),
            metadata={
                'name': item.get('name'),
                'description': item.get('description'),
                'catalog': (
                    item.get('catalog') or default_catalog_path or DEFAULT_CATALOG_PATH
                ),
                'role_description': (
                    item.get('role_description') or DEFAULT_ROLE_DESCRIPTION
                ),
                'workflow_description': (
                    item.get('workflow_description') or DEFAULT_WORKFLOW_DESCRIPTION
                ),
            },
        )
    )

  return MemoryDataset(samples=samples)
