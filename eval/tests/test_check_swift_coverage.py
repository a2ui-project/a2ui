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
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from unittest.mock import MagicMock, patch

from scripts.check_swift_coverage import find_file, main


def test_find_file(tmp_path):
    # Create temp directory structure
    d = tmp_path / "build"
    d.mkdir()
    f1 = d / "test1.profdata"
    f1.write_text("content1")
    os.utime(f1, (100, 100))

    f2 = d / "test2.profdata"
    f2.write_text("content2")
    os.utime(f2, (200, 200))

    # Should pick f2 because it is newer
    result = find_file(str(d), ".profdata")
    assert result == str(f2)

    # Test exclusion
    f3 = d / "test3.dSYM"
    f3.mkdir()
    f4 = f3 / "binary"
    f4.write_text("bin")

    f5 = d / "binary"
    f5.write_text("bin2")

    result_ex = find_file(str(d), "binary", exclude=".dSYM")
    assert result_ex == str(f5)


@patch("subprocess.run")
@patch("shutil.which")
@patch("os.path.exists")
@patch("scripts.check_swift_coverage.find_file")
@patch("sys.exit")
def test_main_success(mock_exit, mock_find_file, mock_exists, mock_which, mock_run):
    mock_exists.return_value = True
    mock_which.return_value = None
    mock_find_file.side_effect = [
        "/path/to/profile.profdata",
        "/path/to/binary",
    ]

    # Mock subprocess run output for llvm-cov
    mock_proc = MagicMock()
    mock_proc.stdout = """
Filename                      Regions    Missed   Regions Cover     Functions    Missed   Func Cover      Lines    Missed    Line Cover
--------------------------------------------------------------------------------------------------------------------------------------
some_file.swift                     1         0         100.00%             1           0       100.00%          5         0        100.00%
TOTAL                              62        17          72.58%            11           2        81.82%        160        10         93.75%
"""
    mock_proc.returncode = 0
    mock_run.return_value = mock_proc

    main()

    mock_exit.assert_called_once_with(0)


@patch("subprocess.run")
@patch("shutil.which")
@patch("os.path.exists")
@patch("scripts.check_swift_coverage.find_file")
@patch("sys.exit")
def test_main_failure(mock_exit, mock_find_file, mock_exists, mock_which, mock_run):
    mock_exists.return_value = True
    mock_which.return_value = None
    mock_find_file.side_effect = [
        "/path/to/profile.profdata",
        "/path/to/binary",
    ]

    mock_proc = MagicMock()
    mock_proc.stdout = """
Filename                      Regions    Missed   Regions Cover     Functions    Missed   Func Cover      Lines    Missed    Line Cover
--------------------------------------------------------------------------------------------------------------------------------------
some_file.swift                     1         0         100.00%             1           0       100.00%          5         0        100.00%
TOTAL                              62        17          72.58%            11           2        81.82%        160        80         50.00%
"""
    mock_proc.returncode = 0
    mock_run.return_value = mock_proc

    main()

    mock_exit.assert_called_once_with(1)
