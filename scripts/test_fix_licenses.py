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

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shutil
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import fix_licenses


class TestFixLicenses(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.repo_root = self.test_dir

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def test_should_ignore(self):
        self.assertTrue(fix_licenses.should_ignore("LICENSE"))
        self.assertTrue(fix_licenses.should_ignore(".yarn/releases/yarn.js"))
        self.assertTrue(fix_licenses.should_ignore("yarn.lock"))
        self.assertTrue(fix_licenses.should_ignore("node_modules/foo/bar.js"))
        self.assertTrue(fix_licenses.should_ignore("eval/datasets/test.yaml"))
        self.assertTrue(fix_licenses.should_ignore("eval/bin/transcrypt"))
        self.assertTrue(fix_licenses.should_ignore("third_party/lib/foo.c"))
        self.assertFalse(fix_licenses.should_ignore("src/main.py"))

    def test_is_generated_file(self):
        self.assertTrue(
            fix_licenses.is_generated_file(
                "// GENERATED CODE - DO NOT MODIFY BY HAND\nclass Foo {}"
            )
        )
        self.assertTrue(
            fix_licenses.is_generated_file("# Auto-generated file. Do not edit.\n")
        )
        self.assertFalse(
            fix_licenses.is_generated_file("# Normal hand-written source code")
        )

    def test_strip_incorrect_headers(self):
        # Sample BSD headers (no Apache license) should be stripped
        bsd_hash_header = (
            "# Copyright "
            + "2025 The Flutter Authors.\n"
            "# Use of this source code is governed by a BSD-style license that can be\n"
            "# found in the LICENSE file.\n\n"
            "include: package:lints/recommended.yaml\n"
        )
        stripped_hash = fix_licenses.strip_incorrect_headers(bsd_hash_header)
        self.assertEqual(stripped_hash, "include: package:lints/recommended.yaml\n")

        # Header with (c) and no Apache license should be stripped
        c_symbol_header = (
            "/*\n * Copyright (c) "
            + "2023 Acme Corp.\n * All rights reserved.\n */\n\nclass Widget {}\n"
        )
        stripped_c = fix_licenses.strip_incorrect_headers(c_symbol_header)
        self.assertEqual(stripped_c, "class Widget {}\n")

        # Header with unicode © symbol and no Apache license should be stripped
        unicode_copyright_header = (
            "// Copyright © "
            + "2022 Other Author.\n// Licensed under MIT License.\n\nconst x = 1;\n"
        )
        stripped_unicode = fix_licenses.strip_incorrect_headers(
            unicode_copyright_header
        )
        self.assertEqual(stripped_unicode, "const x = 1;\n")

        # Compliant Google Apache headers should remain intact
        compliant_header = (
            "# Copyright 2024 Google LLC\n"
            "# Licensed under the Apache License, Version 2.0\n"
            "print('hello')\n"
        )
        self.assertEqual(
            fix_licenses.strip_incorrect_headers(compliant_header),
            compliant_header,
        )

    @patch("shutil.which")
    def test_find_addlicense_which(self, mock_which):
        mock_which.return_value = "/usr/local/bin/addlicense"
        self.assertEqual(fix_licenses.find_addlicense(), "/usr/local/bin/addlicense")

    @patch("os.access")
    @patch("shutil.which")
    def test_find_addlicense_gopath(self, mock_which, mock_access):
        mock_which.return_value = None
        mock_access.return_value = True
        with patch.dict(os.environ, {"GOPATH": "/go"}):
            self.assertEqual(fix_licenses.find_addlicense(), "/go/bin/addlicense")

    @patch("os.access")
    @patch("shutil.which")
    def test_find_addlicense_none(self, mock_which, mock_access):
        mock_which.return_value = None
        mock_access.return_value = False
        self.assertIsNone(fix_licenses.find_addlicense())

    @patch("fix_licenses.find_addlicense")
    def test_ensure_addlicense_existing(self, mock_find):
        mock_find.return_value = "/bin/addlicense"
        self.assertEqual(fix_licenses.ensure_addlicense(), "/bin/addlicense")

    @patch("subprocess.run")
    @patch("shutil.which")
    @patch("fix_licenses.find_addlicense")
    def test_ensure_addlicense_install_success(self, mock_find, mock_which, mock_run):
        mock_find.side_effect = [None, "/go/bin/addlicense"]
        mock_which.return_value = "/usr/bin/go"
        mock_run.return_value.returncode = 0

        res = fix_licenses.ensure_addlicense()
        self.assertEqual(res, "/go/bin/addlicense")
        mock_run.assert_called_once()

    @patch("sys.stderr", new_callable=io.StringIO)
    @patch("shutil.which")
    @patch("fix_licenses.find_addlicense")
    def test_ensure_addlicense_fail(self, mock_find, mock_which, mock_stderr):
        mock_find.return_value = None
        mock_which.return_value = None
        with self.assertRaises(SystemExit):
            fix_licenses.ensure_addlicense()

    @patch("subprocess.run")
    def test_run_addlicense(self, mock_run):
        mock_run.return_value.returncode = 0
        res = fix_licenses.run_addlicense("/bin/addlicense", False, self.repo_root)
        self.assertTrue(res)
        mock_run.assert_called_once()

        mock_run.reset_mock()
        mock_run.return_value.returncode = 1
        res_check = fix_licenses.run_addlicense("/bin/addlicense", True, self.repo_root)
        self.assertFalse(res_check)

    @patch("subprocess.run")
    def test_get_tracked_files(self, mock_run):
        mock_run.return_value.stdout = "file1.py\nfile2.js\n"
        files = fix_licenses.get_tracked_files(self.repo_root)
        self.assertEqual(
            files,
            [
                os.path.join(self.repo_root, "file1.py"),
                os.path.join(self.repo_root, "file2.js"),
            ],
        )

    def test_process_files_check_mode_errors(self):
        sample_copyright = "# Copyright " + "2026 Google LLC\n"
        sample_http_url = "# http:" + "//www.apache.org/licenses\n"
        file1 = os.path.join(self.repo_root, "file1.py")
        with open(file1, "w", encoding="utf-8") as f:
            f.write(sample_copyright + sample_http_url)

        license_path = os.path.join(self.repo_root, "LICENSE")
        with open(license_path, "w", encoding="utf-8") as f:
            f.write("http:" + "//www.apache.org/licenses\n")

        with patch(
            "fix_licenses.get_tracked_files", return_value=[file1, license_path]
        ):
            errors = fix_licenses.process_files(self.repo_root, check_mode=True)
            self.assertEqual(len(errors), 3)

    def test_process_files_check_mode_years_prior_2010_and_ranges(self):
        file1 = os.path.join(self.repo_root, "file1.py")
        with open(file1, "w", encoding="utf-8") as f:
            f.write(
                "# Copyright "
                + "2008 Google LLC\n# Licensed under the Apache License, Version 2.0\n"
            )

        file2 = os.path.join(self.repo_root, "file2.py")
        with open(file2, "w", encoding="utf-8") as f:
            f.write(
                "# Copyright "
                + "2020-2026 Google LLC\n# Licensed under the Apache License, Version"
                " 2.0\n"
            )

        with patch("fix_licenses.get_tracked_files", return_value=[file1, file2]):
            errors = fix_licenses.process_files(self.repo_root, check_mode=True)
            self.assertEqual(len(errors), 2)

    def test_process_files_skips_empty_and_generated(self):
        empty_file = os.path.join(self.repo_root, "empty.py")
        with open(empty_file, "w", encoding="utf-8") as f:
            f.write("   \n")

        gen_file = os.path.join(self.repo_root, "generated.py")
        with open(gen_file, "w", encoding="utf-8") as f:
            f.write(
                "# GENERATED CODE - DO NOT EDIT\n"
                + "# Copyright "
                + "2026 Google LLC\n"
            )

        with patch(
            "fix_licenses.get_tracked_files", return_value=[empty_file, gen_file]
        ):
            errors = fix_licenses.process_files(self.repo_root, check_mode=True)
            self.assertEqual(len(errors), 0)

    def test_process_files_check_mode_javadoc_header(self):
        file1 = os.path.join(self.repo_root, "file1.ts")
        with open(file1, "w", encoding="utf-8") as f:
            f.write(
                "/**\n * Copyright 2024 Google LLC\n * Licensed under the Apache"
                " License, Version 2.0\n */\n"
            )

        with patch("fix_licenses.get_tracked_files", return_value=[file1]):
            errors = fix_licenses.process_files(self.repo_root, check_mode=True)
            self.assertEqual(len(errors), 1)
            self.assertIn("Javadoc-style", errors[0])

    def test_process_files_fix_mode_removes_incorrect_header_and_updates_content(self):
        file1 = os.path.join(self.repo_root, "analysis_options.yaml")
        bsd_header = (
            "# Copyright "
            + "2025 The Flutter Authors.\n"
            "# Use of this source code is governed by a BSD-style license that can be\n"
            "# found in the LICENSE file.\n\n"
            "include: package:lints/recommended.yaml\n"
        )
        with open(file1, "w", encoding="utf-8") as f:
            f.write(bsd_header)

        with patch("fix_licenses.get_tracked_files", return_value=[file1]):
            errors = fix_licenses.process_files(self.repo_root, check_mode=False)
            self.assertEqual(len(errors), 0)

        with open(file1, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertNotIn("The Flutter Authors", content)
        self.assertEqual(content, "include: package:lints/recommended.yaml\n")

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("fix_licenses.process_files")
    @patch("fix_licenses.run_addlicense")
    @patch("fix_licenses.ensure_addlicense")
    def test_main_check_mode_success(
        self, mock_ensure, mock_run_add, mock_process, mock_stdout
    ):
        mock_ensure.return_value = "/bin/addlicense"
        mock_run_add.return_value = True
        mock_process.return_value = []

        fix_licenses.main(["--check"])
        mock_run_add.assert_called_once_with(
            "/bin/addlicense", check_mode=True, repo_root=unittest.mock.ANY
        )

    @patch("sys.stderr", new_callable=io.StringIO)
    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("fix_licenses.process_files")
    @patch("fix_licenses.run_addlicense")
    @patch("fix_licenses.ensure_addlicense")
    def test_main_check_mode_failure(
        self, mock_ensure, mock_run_add, mock_process, mock_stdout, mock_stderr
    ):
        mock_ensure.return_value = "/bin/addlicense"
        mock_run_add.return_value = False
        mock_process.return_value = ["error"]

        with self.assertRaises(SystemExit):
            fix_licenses.main(["--check"])

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("fix_licenses.process_files")
    @patch("fix_licenses.run_addlicense")
    @patch("fix_licenses.ensure_addlicense")
    def test_main_fix_mode(self, mock_ensure, mock_run_add, mock_process, mock_stdout):
        mock_ensure.return_value = "/bin/addlicense"
        mock_run_add.return_value = True
        mock_process.return_value = []

        fix_licenses.main([])
        mock_run_add.assert_called_once_with(
            "/bin/addlicense", check_mode=False, repo_root=unittest.mock.ANY
        )


if __name__ == "__main__":
    unittest.main()
