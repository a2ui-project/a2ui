# Copyright 2024 Google LLC
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

"""Tests for the test-only repository path helpers in `repo_paths`."""

from unittest.mock import patch

import pytest

from .repo_paths import (
    find_repo_root,
    get_basic_catalog_path,
    get_basic_examples_dir,
    get_spec_dir,
)


def test_find_repo_root_returns_none_without_specification_dir():
    with patch("os.path.isdir", return_value=False):
        assert find_repo_root("/mock/path") is None


@pytest.mark.parametrize(
    "version, expected",
    [
        ("v1_0", "specification/v1_0"),
        ("1.0", "specification/v1_0"),
        ("v0_9_1", "specification/v0_9_1"),
        ("0.9.1", "specification/v0_9_1"),
        ("v1_0_0-alpha.1", "specification/v1_0"),
        ("1.0.0-alpha.1", "specification/v1_0"),
        ("1.0.0-dev_release", "specification/v1_0"),
        ("v1_0_0-dev_release", "specification/v1_0"),
    ],
)
def test_spec_dir_maps_versions_to_base_directories(version, expected):
    assert get_spec_dir(version).endswith(expected)


@pytest.mark.parametrize(
    "version, expected",
    [
        ("v1_0", "catalogs/basic/v1/catalog.json"),
        ("1.0", "catalogs/basic/v1/catalog.json"),
        ("v0_9", "specification/v0_9/catalogs/basic/catalog.json"),
        ("v0_8", "specification/v0_8/catalogs/basic/catalog.json"),
    ],
)
def test_basic_catalog_path_by_version(version, expected):
    assert get_basic_catalog_path(version).endswith(expected)


@pytest.mark.parametrize(
    "version, expected",
    [
        ("v1_0", "catalogs/basic/v1/examples"),
        ("1.0", "catalogs/basic/v1/examples"),
        ("v0_9", "specification/v0_9/catalogs/basic/examples"),
    ],
)
def test_basic_examples_dir_by_version(version, expected):
    assert get_basic_examples_dir(version).endswith(expected)
