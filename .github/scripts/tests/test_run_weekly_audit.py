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

    @patch("time.sleep", return_value=None)
    @patch.dict(
        os.environ,
        {"GEMINI_API_KEY": "fake-key", "GITHUB_TOKEN": "fake-token"},
        clear=True,
    )
    def test_transient_polling_error_recovery(self, mock_sleep: MagicMock) -> None:
        """Verifies that transient API 500 errors during status polling are retried."""
        mock_genai = MagicMock()
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_interaction_queued = MagicMock(id="test-id-123", status="queued")
        mock_interaction_completed = MagicMock(
            id="test-id-123", status="completed", output_text="Audit Passed"
        )

        mock_client.interactions.create.return_value = mock_interaction_queued
        mock_client.interactions.get.side_effect = [
            Exception("500 Internal Server Error"),
            mock_interaction_completed,
        ]

        mock_google = MagicMock()
        mock_google.genai = mock_genai

        with patch.dict(
            sys.modules, {"google": mock_google, "google.genai": mock_genai}
        ):
            main()

        self.assertEqual(mock_client.interactions.get.call_count, 2)

    @patch("time.sleep", return_value=None)
    @patch.dict(
        os.environ,
        {"GEMINI_API_KEY": "fake-key", "GITHUB_TOKEN": "fake-token"},
        clear=True,
    )
    def test_persistent_polling_failure_fails_fast(self, mock_sleep: MagicMock) -> None:
        """Verifies that 20 consecutive status polling failures cause script to fail fast."""
        mock_genai = MagicMock()
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_interaction_queued = MagicMock(id="test-id-123", status="queued")
        mock_client.interactions.create.return_value = mock_interaction_queued
        mock_client.interactions.get.side_effect = Exception(
            "500 Internal Server Error"
        )

        mock_google = MagicMock()
        mock_google.genai = mock_genai

        with patch.dict(
            sys.modules, {"google": mock_google, "google.genai": mock_genai}
        ):
            with self.assertRaisesRegex(RuntimeError, "20 consecutive times"):
                main()

        self.assertEqual(mock_client.interactions.get.call_count, 20)

    @patch("time.sleep", return_value=None)
    @patch.dict(
        os.environ,
        {
            "GEMINI_API_KEY": "fake-key",
            "GITHUB_TOKEN": "fake-token",
            "GITHUB_REF_NAME": "feature-branch",
        },
        clear=True,
    )
    def test_allowlist_and_ref_name(self, mock_sleep: MagicMock) -> None:
        """Verifies network allowlist contains authorization transforms and ref_name is used."""
        mock_genai = MagicMock()
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_interaction_completed = MagicMock(
            id="test-id-123", status="completed", output_text="Audit Passed"
        )
        mock_client.interactions.create.return_value = mock_interaction_completed
        mock_client.interactions.get.return_value = mock_interaction_completed

        mock_google = MagicMock()
        mock_google.genai = mock_genai

        with patch.dict(
            sys.modules, {"google": mock_google, "google.genai": mock_genai}
        ):
            main()

        create_kwargs = mock_client.interactions.create.call_args.kwargs
        self.assertIn("branch: feature-branch", create_kwargs["input"])
        allowlist = create_kwargs["environment"]["network"]["allowlist"]
        self.assertEqual(len(allowlist), 2)
        self.assertEqual(
            allowlist[0],
            {
                "domain": "api.github.com",
                "transform": [{"Authorization": "Bearer fake-token"}],
            },
        )
        self.assertEqual(
            allowlist[1],
            {
                "domain": "github.com",
                "transform": [{"Authorization": "Bearer fake-token"}],
            },
        )


if __name__ == "__main__":
    unittest.main()
