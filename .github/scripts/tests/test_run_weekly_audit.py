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

"""Unit tests for .github/scripts/run_weekly_audit.py."""

import os
import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Dynamically import run_weekly_audit script
import importlib.util

script_path = REPO_ROOT / ".github" / "scripts" / "run_weekly_audit.py"
spec = importlib.util.spec_from_file_location("run_weekly_audit", script_path)
assert spec is not None
assert spec.loader is not None
run_weekly_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_weekly_audit)
main = run_weekly_audit.main


class TestRunWeeklyAudit(unittest.TestCase):

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_gemini_api_key(self) -> None:
        with self.assertRaisesRegex(ValueError, "GEMINI_API_KEY"):
            main()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "fake-key"}, clear=True)
    def test_missing_github_token(self) -> None:
        with self.assertRaisesRegex(ValueError, "GITHUB_TOKEN"):
            main()

    @patch("time.sleep", return_value=None)
    @patch.dict(
        os.environ,
        {"GEMINI_API_KEY": "fake-key", "GITHUB_TOKEN": "fake-token"},
        clear=True,
    )
    def test_successful_audit_run(self, mock_sleep: MagicMock) -> None:
        mock_genai = MagicMock()
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_interaction_queued = MagicMock(id="test-id-123", status="queued")
        mock_interaction_completed = MagicMock(
            id="test-id-123", status="completed", output_text="Audit Passed"
        )

        mock_client.interactions.create.return_value = mock_interaction_queued
        mock_client.interactions.get.return_value = mock_interaction_completed

        mock_google = MagicMock()
        mock_google.genai = mock_genai

        with patch.dict(
            sys.modules, {"google": mock_google, "google.genai": mock_genai}
        ):
            main()

        mock_genai.Client.assert_called_once_with(api_key="fake-key")
        mock_client.interactions.create.assert_called_once()
        mock_client.interactions.get.assert_called_with(id="test-id-123")
        mock_sleep.assert_called_once_with(30)

    @patch("time.sleep", return_value=None)
    @patch.dict(
        os.environ,
        {"GEMINI_API_KEY": "fake-key", "GITHUB_TOKEN": "fake-token"},
        clear=True,
    )
    def test_failed_audit_run(self, mock_sleep: MagicMock) -> None:
        mock_genai = MagicMock()
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_interaction_queued = MagicMock(id="test-id-123", status="queued")
        mock_interaction_failed = MagicMock(
            id="test-id-123", status="failed", output_text="Audit Failed"
        )

        mock_client.interactions.create.return_value = mock_interaction_queued
        mock_client.interactions.get.return_value = mock_interaction_failed

        mock_google = MagicMock()
        mock_google.genai = mock_genai

        with patch.dict(
            sys.modules, {"google": mock_google, "google.genai": mock_genai}
        ):
            with self.assertRaisesRegex(RuntimeError, "status: failed"):
                main()


if __name__ == "__main__":
    unittest.main()
