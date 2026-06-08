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

import os
import re
import yaml
import pytest


def _get_conformance_path(filename):
  return os.path.abspath(
      os.path.join(os.path.dirname(__file__), "../../../../conformance", filename)
  )


def load_tests(filename):
  path = _get_conformance_path(os.path.join("suites", filename))
  with open(path, "r", encoding="utf-8") as f:
    return yaml.safe_load(f)


def get_conformance_cases(filename):
  cases = load_tests(filename)
  return [(case["name"], case) for case in cases]


# --- A2A Integration Conformance ---
cases_a2a_integration = get_conformance_cases("a2a_integration.yaml")


@pytest.mark.parametrize(
    "name, test_case",
    cases_a2a_integration,
    ids=[c[0] for c in cases_a2a_integration],
)
def test_a2a_integration_conformance(name, test_case):
  from a2ui.a2a.parts import create_a2ui_part, is_a2ui_part, get_a2ui_datapart
  from a2a.types import DataPart, Part
  from a2ui.a2a.extension import (
      get_a2ui_agent_extension,
      try_activate_a2ui_extension,
      _select_newest_a2ui_extension,
  )
  from unittest.mock import MagicMock
  from a2a.server.agent_execution import RequestContext

  action = test_case["action"]
  args = test_case.get("args", {})

  if action == "create_a2ui_part":
    data = args["data"]
    version = args.get("version")
    part = create_a2ui_part(data, version=version)
    assert is_a2ui_part(part)
    expect = test_case["expect"]
    data_part = get_a2ui_datapart(part)
    assert data_part.metadata.get("mimeType") == expect["mime_type"]

  elif action == "is_a2ui_part":
    mime_type = args["mime_type"]
    part = Part(root=DataPart(data={}, metadata={"mimeType": mime_type}))
    result = is_a2ui_part(part)
    assert result == test_case["expect"]

  elif action == "get_extension":
    version = args["version"]
    accepts_inline_catalogs = args.get("accepts_inline_catalogs")
    supported_catalog_ids = args.get("supported_catalog_ids")

    kwargs = {}
    if accepts_inline_catalogs is not None:
      kwargs["accepts_inline_catalogs"] = accepts_inline_catalogs
    if supported_catalog_ids is not None:
      kwargs["supported_catalog_ids"] = supported_catalog_ids

    ext = get_a2ui_agent_extension(version, **kwargs)
    expect = test_case["expect"]
    assert ext.uri == expect["uri"]
    if expect["params"] is None:
      assert ext.params is None
    else:
      assert ext.params == expect["params"]

  elif action == "try_activate":
    requested = args["requested"]
    advertised = args["advertised"]

    context = MagicMock(spec=RequestContext)
    context.requested_extensions = requested
    context.add_activated_extension = MagicMock()

    card = MagicMock()
    extensions = []
    for uri in advertised:
      ext = MagicMock()
      ext.uri = uri
      extensions.append(ext)
    card.capabilities.extensions = extensions

    result_version = try_activate_a2ui_extension(context, card)
    expect = test_case["expect"]

    if expect["activated"] is None:
      assert result_version is None
      context.add_activated_extension.assert_not_called()
    else:
      assert result_version == expect["version"]
      context.add_activated_extension.assert_called_once_with(expect["activated"])

  elif action == "select_newest":
    requested = args["requested"]
    advertised = args["advertised"]
    result = _select_newest_a2ui_extension(requested, advertised)
    expect = test_case["expect"]
    assert result == expect["newest"]
