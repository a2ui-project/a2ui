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
import io
import pytest
import json
import os
from unittest.mock import patch, MagicMock, PropertyMock
from a2ui.schema.manager import A2uiSchemaManager, A2uiCatalog, CatalogConfig
from a2ui.basic_catalog import BasicCatalog
from a2ui.basic_catalog.constants import BASIC_CATALOG_NAME
from a2ui.schema.constants import (
    DEFAULT_WORKFLOW_RULES,
    INLINE_CATALOG_NAME,
    VERSION_0_8,
    VERSION_0_9,
)
from a2ui.schema.constants import (
    A2UI_SCHEMA_BLOCK_START,
    A2UI_SCHEMA_BLOCK_END,
    INLINE_CATALOGS_KEY,
    SUPPORTED_CATALOG_IDS_KEY,
)


@pytest.fixture
def mock_importlib_resources():
  with patch("importlib.resources.files") as mock_files:
    yield mock_files


def test_schema_manager_init_valid_version(mock_importlib_resources):
  mock_files = mock_importlib_resources
  mock_traversable = MagicMock()

  def files_side_effect(package):
    if package == "a2ui.assets":
      return mock_traversable
    return MagicMock()

  mock_files.side_effect = files_side_effect

  # Mock file open calls for server_to_client and catalog
  def joinpath_side_effect(path):
    if path == VERSION_0_8:
      return mock_traversable

    mock_file = MagicMock()
    if path == "server_to_client.json":
      content = (
          '{"$schema": "https://json-schema.org/draft/2020-12/schema", "version":'
          f' "{VERSION_0_8}", "defs": "server_defs"}}'
      )
    elif path == "standard_catalog_definition.json":
      content = (
          '{"$schema": "https://json-schema.org/draft/2020-12/schema", "version":'
          f' "{VERSION_0_8}", "components": {{"Text": {{}}}}}}'
      )
    else:
      content = '{"$schema": "https://json-schema.org/draft/2020-12/schema"}'

    mock_file.open.return_value.__enter__.return_value = io.StringIO(content)
    return mock_file

  mock_traversable.joinpath.side_effect = joinpath_side_effect

  manager = A2uiSchemaManager(
      VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)]
  )

  assert manager._server_to_client_schema["defs"] == "server_defs"
  # Basic catalog might have a URI-based ID if not explicitly matched
  # So we check if any catalog exists
  assert len(manager._supported_catalogs) >= 1
  # The first one should be the basic one
  catalog = manager._supported_catalogs[0]
  assert catalog.catalog_schema["version"] == VERSION_0_8
  assert "Text" in catalog.catalog_schema["components"]


def test_schema_manager_init_invalid_version():
  with pytest.raises(ValueError, match="Unknown A2UI specification version"):
    A2uiSchemaManager("invalid_version")


def test_schema_manager_fallback_local_assets(mock_importlib_resources):
  # Force importlib to fail
  # Note: A2UI_ASSET_PACKAGE is "a2ui.assets"
  mock_importlib_resources.side_effect = FileNotFoundError("Package not found")

  with (
      patch("os.path.exists", return_value=True),
      patch("builtins.open", new_callable=MagicMock) as mock_open,
  ):

    def open_side_effect(path, *args, **kwargs):
      path_str = str(path)
      if "server_to_client" in path_str:
        return io.StringIO(
            '{"$schema": "https://json-schema.org/draft/2020-12/schema", "defs":'
            ' "local_server"}'
        )
      elif "standard_catalog" in path_str or "catalog" in path_str:
        return io.StringIO(
            '{"$schema": "https://json-schema.org/draft/2020-12/schema",'
            ' "catalogId": "basic", "components": {"LocalText": {}}}'
        )
      raise FileNotFoundError(path)

    mock_open.side_effect = open_side_effect

    manager = A2uiSchemaManager(
        VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)]
    )

    assert manager._server_to_client_schema["defs"] == "local_server"
    assert len(manager._supported_catalogs) >= 1
    catalog = manager._supported_catalogs[0]
    assert "LocalText" in catalog.catalog_schema["components"]
