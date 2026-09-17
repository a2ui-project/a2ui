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

"""Tests for .github/scripts/release_artifacts.py."""

import json
import os
import sys
import tarfile
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import release_artifacts as ra  # noqa: E402

METADATA = (
    "Metadata-Version: 2.4\nName: {name}\nVersion: {version}\n\nLong description.\n"
)


def write_wheel(directory, name, version, dist_name=None):
    dist_name = dist_name or name.replace("-", "_")
    path = os.path.join(directory, f"{dist_name}-{version}-py3-none-any.whl")
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            f"{dist_name}-{version}.dist-info/METADATA",
            METADATA.format(name=name, version=version),
        )
    return path


def write_sdist(directory, name, version, dist_name=None):
    dist_name = dist_name or name.replace("-", "_")
    path = os.path.join(directory, f"{dist_name}-{version}.tar.gz")
    with tarfile.open(path, "w:gz") as archive:
        content = METADATA.format(name=name, version=version).encode()
        info = tarfile.TarInfo(f"{dist_name}-{version}/PKG-INFO")
        info.size = len(content)
        import io

        archive.addfile(info, io.BytesIO(content))
    return path


class NormalizeTest(unittest.TestCase):

    def test_normalize_name(self):
        self.assertEqual(ra.normalize_name("a2ui_core"), "a2ui-core")
        self.assertEqual(ra.normalize_name("A2UI.Core"), "a2ui-core")
        self.assertEqual(ra.normalize_name("a2ui--core"), "a2ui-core")
        self.assertEqual(ra.normalize_name("a2ui-agent-sdk"), "a2ui-agent-sdk")


class MetadataTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_read_wheel_metadata(self):
        path = write_wheel(self.tmp, "a2ui-core", "0.1.2")
        self.assertEqual(ra.read_metadata(path), ("a2ui-core", "0.1.2"))

    def test_read_sdist_metadata(self):
        path = write_sdist(self.tmp, "a2ui-core", "0.1.2")
        self.assertEqual(ra.read_metadata(path), ("a2ui-core", "0.1.2"))

    def test_metadata_name_is_normalized(self):
        path = write_wheel(self.tmp, "a2ui_core", "0.1.2")
        self.assertEqual(ra.read_metadata(path)[0], "a2ui-core")

    def test_long_description_does_not_leak_into_fields(self):
        """A description containing 'Version:' must not override the real one."""
        path = os.path.join(self.tmp, "x-1.0.0-py3-none-any.whl")
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(
                "x-1.0.0.dist-info/METADATA",
                "Metadata-Version: 2.4\nName: x\nVersion: 1.0.0\n\nVersion: 9.9.9\n",
            )
        self.assertEqual(ra.read_metadata(path), ("x", "1.0.0"))

    def test_unrecognised_extension(self):
        with self.assertRaises(ValueError):
            ra.read_metadata("/tmp/thing.zip")


class VerifyTest(unittest.TestCase):

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.dist = os.path.join(self.root, "pkg", "dist")
        os.makedirs(self.dist)
        self.plan = [{
            "pypi_name": "a2ui-core",
            "directory": "pkg",
            "version": "0.1.2",
            "tag": "python/a2ui-core/v0.1.2",
        }]

    def test_passes_when_both_artifacts_match(self):
        write_wheel(self.dist, "a2ui-core", "0.1.2")
        write_sdist(self.dist, "a2ui-core", "0.1.2")
        self.assertEqual(ra.verify(self.plan, self.root), [])

    def test_flags_wrong_version(self):
        """The fallback-version case: built without the release tag."""
        write_wheel(self.dist, "a2ui-core", "0.1.1")
        write_sdist(self.dist, "a2ui-core", "0.1.1")
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("expected version 0.1.2" in p for p in problems))

    def test_flags_dev_version(self):
        write_wheel(self.dist, "a2ui-core", "0.1.2.dev266")
        write_sdist(self.dist, "a2ui-core", "0.1.2.dev266")
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("did not pick up the release tag" in p for p in problems))

    def test_flags_wrong_package(self):
        write_wheel(self.dist, "a2ui-agent-sdk", "0.1.2")
        write_sdist(self.dist, "a2ui-agent-sdk", "0.1.2")
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("expected package a2ui-core" in p for p in problems))

    def test_flags_missing_sdist(self):
        write_wheel(self.dist, "a2ui-core", "0.1.2")
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("no sdist" in p for p in problems))

    def test_flags_missing_wheel(self):
        write_sdist(self.dist, "a2ui-core", "0.1.2")
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("no wheel" in p for p in problems))

    def test_flags_empty_dist_directory(self):
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("no artifacts found" in p for p in problems))

    def test_flags_stale_artifact_alongside_a_good_one(self):
        """A leftover wheel from a previous version must not slip through."""
        write_wheel(self.dist, "a2ui-core", "0.1.2")
        write_sdist(self.dist, "a2ui-core", "0.1.2")
        write_wheel(self.dist, "a2ui-core", "0.0.9")
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("0.0.9" in p for p in problems))

    def test_flags_corrupted_sdist(self):
        write_wheel(self.dist, "a2ui-core", "0.1.2")
        with open(os.path.join(self.dist, "a2ui_core-0.1.2.tar.gz"), "wb") as handle:
            handle.write(b"not a valid tarball")
        problems = ra.verify(self.plan, self.root)
        self.assertTrue(any("a2ui_core-0.1.2.tar.gz" in p for p in problems))


class ManifestTest(unittest.TestCase):

    def test_single_package(self):
        plan = [{"pypi_name": "a2ui-core", "version": "0.1.2"}]
        self.assertEqual(
            ra.build_manifest(plan),
            {
                "publish_all": False,
                "publishing_groups": [
                    {"packages": [{"name": "a2ui-core", "version": "0.1.2"}]}
                ],
            },
        )

    def test_both_packages_in_one_group(self):
        plan = [
            {"pypi_name": "a2ui-core", "version": "0.1.2"},
            {"pypi_name": "a2ui-agent-sdk", "version": "0.6.1"},
        ]
        manifest = ra.build_manifest(plan)
        packages = manifest["publishing_groups"][0]["packages"]
        self.assertEqual([p["name"] for p in packages], ["a2ui-core", "a2ui-agent-sdk"])

    def test_never_publishes_everything(self):
        """publish_all would also push stale artifacts left in the registry."""
        manifest = ra.build_manifest([{"pypi_name": "a2ui-core", "version": "0.1.2"}])
        self.assertFalse(manifest["publish_all"])

    def test_names_are_normalized(self):
        manifest = ra.build_manifest([{"pypi_name": "a2ui_core", "version": "0.1.2"}])
        name = manifest["publishing_groups"][0]["packages"][0]["name"]
        self.assertEqual(name, "a2ui-core")

    def test_manifest_is_json_serializable(self):
        manifest = ra.build_manifest([{"pypi_name": "a2ui-core", "version": "0.1.2"}])
        self.assertEqual(json.loads(json.dumps(manifest)), manifest)


if __name__ == "__main__":
    unittest.main()
