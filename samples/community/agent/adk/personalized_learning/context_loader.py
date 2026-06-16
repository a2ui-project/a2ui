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
Context Loader for Learner Profile Data

Loads learner context from GCS or local filesystem.
This simulates the handoff from an upstream personalization pipeline.
"""

import os
import logging
from typing import Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# GCS configuration
GCS_BUCKET = os.getenv("GCS_CONTEXT_BUCKET", "a2ui-demo-context")
GCS_PREFIX = os.getenv("GCS_CONTEXT_PREFIX", "learner_context/")

# Local fallback path (relative to sample root)
LOCAL_CONTEXT_PATH = Path(__file__).parent / "learner_context"


def _load_from_gcs(filename: str) -> Optional[str]:
  """Load a context file from GCS."""
  try:
    from google.cloud import storage

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(f"{GCS_PREFIX}{filename}")

    if blob.exists():
      content = blob.download_as_text()
      logger.info(f"Loaded {filename} from GCS bucket {GCS_BUCKET}")
      return content
    else:
      logger.warning(f"File {filename} not found in GCS bucket {GCS_BUCKET}")
      return None

  except Exception as e:
    logger.warning(f"Failed to load from GCS: {e}")
    return None


def _load_from_local(filename: str) -> Optional[str]:
  """Load a context file from local filesystem."""
  filepath = LOCAL_CONTEXT_PATH / filename

  if filepath.exists():
    content = filepath.read_text()
    logger.info(f"Loaded {filename} from local path {filepath}")
    return content
  else:
    logger.warning(f"File {filename} not found at local path {filepath}")
    return None


def load_context_file(filename: str) -> Optional[str]:
  """
  Load a context file with fallback chain: local files → GCS.

  Priority order:
  1. Local files (for development with adk web)
  2. GCS bucket (for Agent Engine deployment)

  This matches the fallback order in agent.py's _safe_get_combined_context().

  Args:
      filename: Name of the context file (e.g., "01_maria_learner_profile.txt")

  Returns:
      File content as string, or None if not found
  """
  # Try local files first (for local development)
  content = _load_from_local(filename)
  if content:
    return content

  # Fall back to GCS (for Agent Engine)
  return _load_from_gcs(filename)


def load_all_context() -> dict[str, str]:
  """
  Load all misconception vector context files.

  Returns:
      Dictionary mapping filename to content
  """
  context_files = [
      "01_maria_learner_profile.txt",
      "02_chemistry_bond_energy.txt",
      "03_chemistry_thermodynamics.txt",
      "04_biology_atp_cellular_respiration.txt",
      "05_misconception_resolution.txt",
      "06_mcat_practice_concepts.txt",
  ]

  context = {}
  for filename in context_files:
    content = load_context_file(filename)
    if content:
      context[filename] = content

  logger.info(f"Loaded {len(context)} context files")
  return context


def get_learner_profile() -> Optional[str]:
  """Get the learner profile context."""
  return load_context_file("01_maria_learner_profile.txt")


def get_misconception_context() -> Optional[str]:
  """Get the misconception resolution context."""
  return load_context_file("05_misconception_resolution.txt")


def get_mcat_concepts() -> Optional[str]:
  """Get the MCAT practice concepts."""
  return load_context_file("06_mcat_practice_concepts.txt")


def get_combined_context() -> str:
  """
  Get all context combined into a single string for prompting.

  Returns:
      Combined context string
  """
  all_context = load_all_context()

  combined = []
  for filename, content in sorted(all_context.items()):
    combined.append(f"=== {filename} ===\n{content}\n")

  return "\n".join(combined)
