# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Tests for parser helper functions."""

import pytest

from a2ui.parser import parser


def test_has_a2ui_parts_with_valid_string():
  content = "<a2ui-json>[{}]</a2ui-json>"
  assert parser.has_a2ui_parts(content) is True


def test_has_a2ui_parts_with_non_a2ui_string():
  content = "Hello, world!"
  assert parser.has_a2ui_parts(content) is False


def test_has_a2ui_parts_with_integer():
  assert parser.has_a2ui_parts(6) is False


def test_has_a2ui_parts_with_dict():
  assert parser.has_a2ui_parts({"result": 6}) is False


def test_has_a2ui_parts_with_none():
  assert parser.has_a2ui_parts(None) is False
