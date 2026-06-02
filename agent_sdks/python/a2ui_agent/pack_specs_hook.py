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

import importlib.util
import os
import sys
import shutil
from hatchling.builders.hooks.plugin.interface import BuildHookInterface


def load_module(project_root, rel_path, filename, module_name):
  """Loads a module directly from its path in src/."""
  path = os.path.join(project_root, "src", rel_path.replace(".", os.sep), filename)
  if not os.path.exists(path):
    raise RuntimeError(f"Could not find module at {path}")

  # Add src to sys.path so absolute imports work
  src_path = os.path.abspath(os.path.join(project_root, "src"))
  if src_path not in sys.path:
    sys.path.insert(0, src_path)

  spec = importlib.util.spec_from_file_location(module_name, path)
  if spec and spec.loader:
    module = importlib.util.module_from_spec(spec)
    # Set the package context to allow relative imports if any
    module.__package__ = rel_path
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module
  raise RuntimeError(f"Could not load module from {path}")


class PackSpecsBuildHook(BuildHookInterface):

  def initialize(self, version, build_data):
    project_root = self.root

    # Load constants and utils dynamically from src/
    schema_path = "a2ui.schema"
    a2ui_constants = load_module(
        project_root, schema_path, "constants.py", "_constants_load"
    )
    a2ui_utils = load_module(project_root, schema_path, "utils.py", "_utils_load")

    basic_catalog_constants = load_module(
        project_root,
        "a2ui.basic_catalog",
        "constants.py",
        "_basic_catalog_constants_load",
    )

    spec_version_map = a2ui_constants.SPEC_VERSION_MAP
    a2ui_asset_package = a2ui_constants.A2UI_ASSET_PACKAGE
    specification_dir = a2ui_constants.SPECIFICATION_DIR

    # Dynamically find repo root by looking for specification_dir
    repo_root = a2ui_utils.find_repo_root(project_root)
    if not repo_root:
      # Check for PKG-INFO which implies a packaged state (sdist).
      # If PKG-INFO is present, trust the bundled assets.
      if os.path.exists(os.path.join(project_root, "PKG-INFO")):
        print("Repository root not found, but PKG-INFO present (sdist). Skipping copy.")
        return

      raise RuntimeError(
          f"Could not find repository root (looked for '{specification_dir}'"
          " directory)."
      )

    # Target directory: src/a2ui/assets
    target_base = os.path.join(
        project_root, "src", a2ui_asset_package.replace(".", os.sep)
    )

    self._pack_schemas(repo_root, spec_version_map, target_base)
    self._pack_basic_catalogs(
        repo_root, basic_catalog_constants.BASIC_CATALOG_PATHS, target_base
    )

  def _pack_schemas(self, repo_root, spec_map, target_base):
    for ver, schema_map in spec_map.items():
      target_dir = os.path.join(target_base, ver)
      os.makedirs(target_dir, exist_ok=True)

      for _schema_key, source_rel_path in schema_map.items():
        self._copy_schema(repo_root, source_rel_path, target_dir)

  def _pack_basic_catalogs(self, repo_root, catalog_paths, target_base):
    for ver, path_map in catalog_paths.items():
      target_dir = os.path.join(target_base, ver)
      os.makedirs(target_dir, exist_ok=True)

      for _key, source_rel_path in path_map.items():
        self._copy_schema(repo_root, source_rel_path, target_dir)

  def _copy_schema(self, repo_root, source_rel_path, target_dir):
    source_path = os.path.join(repo_root, source_rel_path)

    if not os.path.exists(source_path):
      print(
          f"WARNING: Source schema file not found at {source_path}. Build"
          " might produce incomplete wheel if not running from monorepo"
          " root."
      )
      return

    filename = os.path.basename(source_path)
    dst_file = os.path.join(target_dir, filename)

    print(f"Copying {source_path} -> {dst_file}")
    shutil.copy2(source_path, dst_file)
