#!/usr/bin/env python3
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
import shutil
import subprocess
import sys


def find_file(directory, pattern, exclude=None):
    """Finds a file matching pattern under directory, optionally excluding paths containing exclude."""
    for root, dirs, files in os.walk(directory):
        for file in files:
            if pattern in file:
                full_path = os.path.join(root, file)
                if exclude and exclude in full_path:
                    continue
                return full_path
    return None


def main():
    build_dir = '.build'
    if not os.path.exists(build_dir):
        print(f"Error: Build directory '{build_dir}' not found.")
        sys.exit(1)

    profdata_file = find_file(build_dir, '.profdata')
    if not profdata_file:
        print('Error: Profiling data (.profdata) file not found under .build.')
        sys.exit(1)

    test_binary = find_file(build_dir, 'A2UISwiftCorePackageTests', exclude='.dSYM')
    if not test_binary:
        print(
            "Error: Compiled test binary 'A2UISwiftCorePackageTests' not found under"
            ' .build.'
        )
        sys.exit(1)

    llvm_cov_cmd = ['llvm-cov', 'report', '-instr-profile', profdata_file, test_binary]
    if shutil.which('xcrun'):
        cmd = ['xcrun'] + llvm_cov_cmd
    else:
        cmd = llvm_cov_cmd

    print(f"Running: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        print(
            f"Error: Command '{cmd[0]}' not found. Please ensure LLVM tools are"
            ' installed.'
        )
        sys.exit(1)

    if result.returncode != 0:
        print('Error: llvm-cov failed.')
        print(result.stderr)
        sys.exit(1)

    lines = result.stdout.splitlines()
    total_line = next((line for line in lines if line.startswith('TOTAL')), None)
    if not total_line:
        print('Error: Could not find TOTAL line in coverage report.')
        print(result.stdout)
        sys.exit(1)

    parts = total_line.split()
    # In 'TOTAL  62  17  72.58%  11  2  81.82%  160  29  81.88% ...'
    # Lines Cover percentage is index 9 (removes % and checks)
    try:
        lines_cover_str = parts[9].replace('%', '')
        coverage = float(lines_cover_str)
    except Exception as e:
        print(
            f"Error parsing coverage percentage from line: '{total_line}'. Error: {e}"
        )
        sys.exit(1)

    print('Swift Code Coverage Summary:')
    print(f'  Overall Line Coverage: {coverage:.2f}%')

    if coverage < 90:
        print(f'❌ FAIL: Code coverage ({coverage:.2f}%) is below the 90% target!')
        sys.exit(1)
    else:
        print(f'🟢 PASS: Code coverage ({coverage:.2f}%) meets the 90% target!')
        sys.exit(0)


if __name__ == '__main__':
    main()
