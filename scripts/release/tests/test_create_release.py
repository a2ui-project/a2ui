# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Unit tests for scripts/release/create_release.py.
"""

import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add parent scripts/release/ directory to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
RELEASE_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(RELEASE_DIR))

from create_release import (
    compute_next_version,
    evaluate_semver_bump,
    get_registry_version,
    get_tag_name_for_package,
    parse_semver,
    update_changelog_header,
    update_package_version,
)


class TestCreateRelease(unittest.TestCase):

    def test_parse_semver(self):
        self.assertEqual(parse_semver("0.10.7"), (0, 10, 7))
        self.assertEqual(parse_semver("1.2.3-beta"), (1, 2, 3))
        self.assertEqual(parse_semver("0.1"), (0, 1, 0))
        self.assertEqual(parse_semver(None), (0, 0, 0))

    def test_compute_next_version_pre_1_0(self):
        # Pre-1.0: MAJOR_OR_MINOR or MINOR -> bump minor
        self.assertEqual(compute_next_version("0.10.7", "MAJOR_OR_MINOR"), "0.11.0")
        self.assertEqual(compute_next_version("0.10.7", "MINOR"), "0.11.0")
        # Pre-1.0: PATCH -> bump patch
        self.assertEqual(compute_next_version("0.10.7", "PATCH"), "0.10.8")

    def test_compute_next_version_post_1_0(self):
        # Post-1.0: MAJOR_OR_MINOR -> bump major
        self.assertEqual(compute_next_version("1.2.3", "MAJOR_OR_MINOR"), "2.0.0")
        # Post-1.0: MINOR -> bump minor
        self.assertEqual(compute_next_version("1.2.3", "MINOR"), "1.3.0")
        # Post-1.0: PATCH -> bump patch
        self.assertEqual(compute_next_version("1.2.3", "PATCH"), "1.2.4")

    def test_evaluate_semver_bump_subheadings(self):
        entries_breaking = ["### Breaking Changes", "- Changed API signature"]
        self.assertEqual(evaluate_semver_bump(entries_breaking), "MAJOR_OR_MINOR")

        entries_feat = ["### Features", "- Added streaming support"]
        self.assertEqual(evaluate_semver_bump(entries_feat), "MINOR")

        entries_fix = ["### Bug Fixes", "- Fixed memory leak"]
        self.assertEqual(evaluate_semver_bump(entries_fix), "PATCH")

    def test_evaluate_semver_bump_prefixes(self):
        entries_breaking = ["- BREAKING CHANGE: Changed API signature"]
        self.assertEqual(evaluate_semver_bump(entries_breaking), "MAJOR_OR_MINOR")

        entries_feat = ["- FEAT: Added streaming support"]
        self.assertEqual(evaluate_semver_bump(entries_feat), "MINOR")

        entries_fix = ["- FIX: Fixed memory leak"]
        self.assertEqual(evaluate_semver_bump(entries_fix), "PATCH")

    def test_get_tag_name_for_package(self):
        from create_release import WORKSPACE_ROOT
        ts_pkg = {"type": "typescript", "dir": WORKSPACE_ROOT / "renderers/web_core"}
        self.assertEqual(get_tag_name_for_package(ts_pkg, "0.10.7"), "javascript/web_core/v0.10.7")

        py_pkg = {"type": "python", "dir": WORKSPACE_ROOT / "agent_sdks/python/a2ui_core"}
        self.assertEqual(get_tag_name_for_package(py_pkg, "0.1.1"), "python/a2ui_core/v0.1.1")

    @patch("urllib.request.urlopen")
    def test_get_registry_version_success_npm(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"version": "0.10.7"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        ts_pkg = {
            "type": "typescript",
            "registry_name": "@a2ui/web_core",
            "changelog": Path("/tmp/non_existent_cl.md"),
        }
        self.assertEqual(get_registry_version(ts_pkg), "0.10.7")

    @patch("urllib.request.urlopen")
    def test_get_registry_version_404_returns_none(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="https://registry.npmjs.org/@a2ui/new-pkg/latest",
            code=404,
            msg="Not Found",
            hdrs={},
            fp=None,
        )

        ts_pkg = {
            "type": "typescript",
            "registry_name": "@a2ui/new-pkg",
            "changelog": Path("/tmp/non_existent_cl.md"),
        }
        self.assertIsNone(get_registry_version(ts_pkg))

    def test_update_package_version_typescript(self, tmp_path=None):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            pkg_json = tmppath / "package.json"
            pkg_json.write_text('{\n  "name": "@a2ui/web_core",\n  "version": "0.10.7"\n}\n', encoding="utf-8")

            pkg = {"type": "typescript", "dir": tmppath}
            update_package_version(pkg, "0.10.8")

            content = pkg_json.read_text(encoding="utf-8")
            self.assertIn('"version": "0.10.8"', content)

    def test_update_package_version_python(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            pyproject = tmppath / "pyproject.toml"
            pyproject.write_text('[project]\nname = "a2ui-core"\nversion = "0.1.1"\n', encoding="utf-8")

            vfile = tmppath / "src/a2ui/core/version.py"
            vfile.parent.mkdir(parents=True, exist_ok=True)
            vfile.write_text('__version__ = "0.1.1"\n', encoding="utf-8")

            pkg = {"type": "python", "dir": tmppath}
            update_package_version(pkg, "0.1.2")

            self.assertIn('version = "0.1.2"', pyproject.read_text(encoding="utf-8"))
            self.assertIn('__version__ = "0.1.2"', vfile.read_text(encoding="utf-8"))

    def test_update_changelog_header(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            cl = tmppath / "CHANGELOG.md"
            cl.write_text("# Changelog\n\n## Unreleased\n\n- FEAT: Added feature\n", encoding="utf-8")

            pkg = {"changelog": cl}
            update_changelog_header(pkg, "0.10.8")

            content = cl.read_text(encoding="utf-8")
            self.assertIn("## Unreleased\n\n## 0.10.8", content)


if __name__ == "__main__":
    unittest.main()
