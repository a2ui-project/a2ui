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

import os
import pytest
from a2ui_eval.dataset import load_a2ui_dataset


def test_load_a2ui_dataset(tmp_path):
  # Create a dummy YAML file
  d = tmp_path / "sub"
  d.mkdir()
  p = d / "dummy_prompts.yaml"
  p.write_text("""
- name: testPrompt
  description: A test prompt.
  promptText: "Test input"
""")

  dataset = load_a2ui_dataset(str(p))

  assert len(dataset) == 1
  assert dataset[0].input == "Test input"
  assert dataset[0].target == "A test prompt."
  assert dataset[0].metadata["name"] == "testPrompt"


def test_load_a2ui_dataset_file_not_found():
  with pytest.raises(FileNotFoundError):
    load_a2ui_dataset("non_existent_file.yaml")
