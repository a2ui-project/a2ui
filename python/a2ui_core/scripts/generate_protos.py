#!/usr/bin/env python3
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

"""Compiles Protobuf schema definitions for a2ui_core."""

import os
from pathlib import Path
import shutil
import subprocess
import sys


def generate_protos() -> None:
    """Generates Python Protobuf code from canonical specification .proto files."""
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[2]
    spec_proto_dir = repo_root / "specification" / "v1_0" / "proto"
    catalog_proto_dir = repo_root / "specification" / "v1_0" / "catalogs" / "basic"
    output_dir = script_dir.parent / "src" / "a2ui" / "core" / "proto" / "v1_0"

    output_dir.mkdir(parents=True, exist_ok=True)

    spec_proto_files = sorted(str(p) for p in spec_proto_dir.glob("*.proto"))
    catalog_proto_files = sorted(str(p) for p in catalog_proto_dir.glob("*.proto"))
    all_proto_files = spec_proto_files + catalog_proto_files

    if not all_proto_files:
        raise FileNotFoundError(
            f"No .proto files found in {spec_proto_dir} or {catalog_proto_dir}"
        )

    print(f"Generating Python Protobuf code into {output_dir}...")

    cmd = [
        "protoc",
        f"--proto_path={spec_proto_dir}",
        f"--proto_path={catalog_proto_dir}",
        f"--python_out={output_dir}",
        f"--pyi_out={output_dir}",
        *all_proto_files,
    ]

    # Try grpc_tools.protoc if system protoc is not on PATH
    if shutil.which("protoc"):
        result = subprocess.run(cmd, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"protoc failed with error:\n{result.stderr}", file=sys.stderr)
            sys.exit(result.returncode)
    else:
        try:
            from grpc_tools import protoc  # type: ignore

            grpc_args = [
                "protoc",
                f"--proto_path={spec_proto_dir}",
                f"--proto_path={catalog_proto_dir}",
                f"--python_out={output_dir}",
                f"--pyi_out={output_dir}",
                *all_proto_files,
            ]
            exit_code = protoc.main(grpc_args)
            if exit_code != 0:
                print(
                    f"grpc_tools.protoc failed with exit code {exit_code}",
                    file=sys.stderr,
                )
                sys.exit(exit_code)
        except ImportError:
            print(
                "Error: Neither system 'protoc' nor 'grpc_tools' package was found.",
                file=sys.stderr,
            )
            sys.exit(1)

    # Post-process generated Python files to use package-relative imports
    for file_path in output_dir.glob("*_pb2.py*"):
        content = file_path.read_text(encoding="utf-8")
        # Replace top-level imports of other _pb2 modules
        # e.g., "import common_types_pb2 as" -> "from . import common_types_pb2 as"
        import re

        content = re.sub(
            r"^import (\w+_pb2) as",
            r"from . import \1 as",
            content,
            flags=re.MULTILINE,
        )
        content = re.sub(
            r"^from (\w+_pb2) import",
            r"from .\1 import",
            content,
            flags=re.MULTILINE,
        )
        file_path.write_text(content, encoding="utf-8")

    # Ensure __init__.py files exist
    (output_dir.parent / "__init__.py").touch()
    (output_dir / "__init__.py").touch()

    print(
        f"Protobuf code generation completed successfully ({len(all_proto_files)} files"
        " processed)."
    )


if __name__ == "__main__":
    generate_protos()
