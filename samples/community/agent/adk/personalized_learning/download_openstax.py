#!/usr/bin/env python3
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Download OpenStax Biology Modules to GCS

This script clones the OpenStax Biology repository from GitHub and uploads
the module CNXML files to a GCS bucket for faster runtime access.

Uses git clone with shallow clone (--depth 1) for efficient downloading,
then uploads the modules directory to GCS.

Usage:
    python download_openstax.py --bucket YOUR_BUCKET_NAME
    python download_openstax.py --bucket YOUR_BUCKET_NAME --local-dir ./modules  # Also save locally
    python download_openstax.py --local-only --local-dir ./modules  # Save locally only
    python download_openstax.py --list  # List modules that would be downloaded
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openstax_chapters import get_all_module_ids

# Configuration
GITHUB_REPO = "https://github.com/openstax/osbooks-biology-bundle.git"
DEFAULT_PREFIX = "openstax_modules/"


def check_git_available() -> bool:
  """Check if git is available on the system."""
  try:
    subprocess.run(
        ["git", "--version"],
        capture_output=True,
        check=True,
    )
    return True
  except (subprocess.CalledProcessError, FileNotFoundError):
    return False


def clone_repo(target_dir: str) -> bool:
  """
  Clone the OpenStax repository with shallow clone.

  Args:
      target_dir: Directory to clone into

  Returns:
      True if successful, False otherwise
  """
  print(f"Cloning repository (shallow clone)...")
  print(f"  Source: {GITHUB_REPO}")
  print(f"  Target: {target_dir}")

  try:
    subprocess.run(
        ["git", "clone", "--depth", "1", GITHUB_REPO, target_dir],
        capture_output=True,
        text=True,
        check=True,
    )
    print("  Clone completed successfully")
    return True
  except subprocess.CalledProcessError as e:
    print(f"  Clone failed: {e.stderr}")
    return False


def upload_modules_to_gcs(
    modules_dir: Path,
    bucket_name: str,
    prefix: str,
    module_ids: set[str],
    workers: int = 10,
) -> tuple[int, int]:
  """
  Upload module directories to GCS.

  Args:
      modules_dir: Local path to modules directory
      bucket_name: GCS bucket name
      prefix: GCS prefix for uploads
      module_ids: Set of module IDs to upload (filters what gets uploaded)
      workers: Number of parallel upload workers

  Returns:
      Tuple of (success_count, fail_count)
  """
  try:
    from google.cloud import storage
  except ImportError:
    print("ERROR: google-cloud-storage not installed")
    print("  Run: pip install google-cloud-storage")
    return 0, len(module_ids)

  from concurrent.futures import ThreadPoolExecutor, as_completed

  client = storage.Client()
  bucket = client.bucket(bucket_name)

  success_count = 0
  fail_count = 0
  total = len(module_ids)

  def upload_module(module_id: str) -> tuple[str, bool, str]:
    """Upload a single module. Returns (module_id, success, message)."""
    module_path = modules_dir / module_id / "index.cnxml"

    if not module_path.exists():
      return module_id, False, "not found in cloned repo"

    try:
      blob = bucket.blob(f"{prefix}{module_id}/index.cnxml")
      blob.upload_from_filename(str(module_path), content_type="application/xml")
      return module_id, True, "uploaded"
    except Exception as e:
      return module_id, False, str(e)

  # Use thread pool for parallel uploads
  with ThreadPoolExecutor(max_workers=workers) as executor:
    futures = {executor.submit(upload_module, mid): mid for mid in sorted(module_ids)}

    for future in as_completed(futures):
      module_id, success, message = future.result()
      if success:
        success_count += 1
        print(f"  Uploaded {module_id} ({success_count}/{total})")
      else:
        fail_count += 1
        print(f"  ! {module_id}: {message}")

  return success_count, fail_count


def copy_modules_locally(
    modules_dir: Path,
    local_dir: Path,
    module_ids: set[str],
) -> tuple[int, int]:
  """
  Copy module directories to a local directory.

  Args:
      modules_dir: Source modules directory from clone
      local_dir: Target local directory
      module_ids: Set of module IDs to copy

  Returns:
      Tuple of (success_count, fail_count)
  """
  local_dir.mkdir(parents=True, exist_ok=True)

  success_count = 0
  fail_count = 0
  total = len(module_ids)

  for module_id in sorted(module_ids):
    src_path = modules_dir / module_id
    dst_path = local_dir / module_id

    if not src_path.exists():
      print(f"  ! {module_id}: not found in cloned repo")
      fail_count += 1
      continue

    try:
      if dst_path.exists():
        shutil.rmtree(dst_path)
      shutil.copytree(src_path, dst_path)
      success_count += 1
      print(f"  Copied {module_id} ({success_count}/{total})")
    except Exception as e:
      print(f"  Failed {module_id}: {e}")
      fail_count += 1

  return success_count, fail_count


def main():
  parser = argparse.ArgumentParser(
      description="Download OpenStax Biology modules to GCS using git clone"
  )
  parser.add_argument(
      "--bucket",
      type=str,
      default=os.getenv("GCS_OPENSTAX_BUCKET"),
      help="GCS bucket name for storing modules",
  )
  parser.add_argument(
      "--prefix",
      type=str,
      default=DEFAULT_PREFIX,
      help=f"GCS prefix for module files (default: {DEFAULT_PREFIX})",
  )
  parser.add_argument(
      "--local-only",
      action="store_true",
      help="Only save locally, don't upload to GCS",
  )
  parser.add_argument(
      "--local-dir",
      type=str,
      default=None,
      help="Local directory to save modules (optional)",
  )
  parser.add_argument(
      "--list",
      action="store_true",
      help="List modules that would be downloaded, don't download",
  )
  parser.add_argument(
      "--workers",
      type=int,
      default=10,
      help="Number of parallel workers for GCS uploads (default: 10)",
  )

  args = parser.parse_args()

  # Get all unique module IDs we need
  all_modules = get_all_module_ids()
  print(f"Found {len(all_modules)} unique modules across all chapters")

  if args.list:
    print("\nModules to download:")
    for module_id in sorted(all_modules):
      print(f"  {module_id}")
    print(f"\nTotal: {len(all_modules)} modules")
    return

  if not args.local_only and not args.bucket:
    print("ERROR: --bucket is required unless using --local-only")
    sys.exit(1)

  if args.local_only and not args.local_dir:
    print("ERROR: --local-dir is required when using --local-only")
    sys.exit(1)

  # Check git is available
  if not check_git_available():
    print("ERROR: git is not available on this system")
    print("  Please install git to use this script")
    sys.exit(1)

  # Clone into a temporary directory
  with tempfile.TemporaryDirectory() as tmpdir:
    print(f"\nUsing temporary directory: {tmpdir}")

    # Clone the repository
    if not clone_repo(tmpdir):
      print("ERROR: Failed to clone repository")
      sys.exit(1)

    modules_dir = Path(tmpdir) / "modules"

    if not modules_dir.exists():
      print(f"ERROR: modules directory not found at {modules_dir}")
      sys.exit(1)

    # Count available modules
    available_modules = {d.name for d in modules_dir.iterdir() if d.is_dir()}
    all_modules_set = set(all_modules)  # Convert list to set for set operations
    needed_modules = all_modules_set & available_modules
    missing_modules = all_modules_set - available_modules

    print(f"\nModule status:")
    print(f"  Needed: {len(all_modules)}")
    print(f"  Available in repo: {len(needed_modules)}")
    if missing_modules:
      print(f"  Missing from repo: {len(missing_modules)}")
      for m in sorted(missing_modules)[:5]:
        print(f"    - {m}")
      if len(missing_modules) > 5:
        print(f"    ... and {len(missing_modules) - 5} more")

    # Copy locally if requested
    if args.local_dir:
      local_dir = Path(args.local_dir)
      print(f"\nCopying modules to {local_dir}...")
      local_success, local_fail = copy_modules_locally(
          modules_dir, local_dir, needed_modules
      )
      print(f"Local copy complete: {local_success} succeeded, {local_fail} failed")

    # Upload to GCS if not local-only
    if not args.local_only and args.bucket:
      print(f"\nUploading to gs://{args.bucket}/{args.prefix}...")
      print(f"Using {args.workers} parallel workers...")
      gcs_success, gcs_fail = upload_modules_to_gcs(
          modules_dir, args.bucket, args.prefix, needed_modules, args.workers
      )
      print(f"\nUpload complete: {gcs_success} succeeded, {gcs_fail} failed")
      print(f"Modules available at: gs://{args.bucket}/{args.prefix}")

  # Temp directory is automatically cleaned up here
  print("\nTemporary files cleaned up")
  print("Done!")


if __name__ == "__main__":
  main()
