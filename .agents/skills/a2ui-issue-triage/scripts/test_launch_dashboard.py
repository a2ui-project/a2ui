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

import unittest
from unittest.mock import patch, MagicMock
import sys
import os
import json
import http.server
import threading
import urllib.request
import urllib.error


import launch_dashboard


class TestLaunchDashboard(unittest.TestCase):

    def setUp(self):
        # Create temporary files for testing
        self.test_dir = os.path.dirname(__file__)
        self.data_file = os.path.join(self.test_dir, "temp_issues.json")
        self.output_file = os.path.join(self.test_dir, "temp_decisions.json")

        self.mock_issues_data = {
            "repo": "a2ui-project/a2ui",
            "issues": [
                {"id": 1, "title": "Mock Issue", "body": "Body", "comments": []}
            ],
            "labels": ["type: bug"],
            "assignees": [{"login": "gspencer", "name": "George"}],
        }

        with open(self.data_file, "w", encoding="utf-8") as f:
            json.dump(self.mock_issues_data, f)

        # Set paths in handler
        launch_dashboard.TriageDashboardHandler.data_file = self.data_file
        launch_dashboard.TriageDashboardHandler.output_file = self.output_file

        # Configure server on localhost with free port (0)
        self.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), launch_dashboard.TriageDashboardHandler
        )
        self.port = self.server.server_port

        # Reset global event
        launch_dashboard.shutdown_event.clear()

        # Start server in background thread
        self.server_thread = threading.Thread(target=self.server.serve_forever)
        self.server_thread.daemon = True
        self.server_thread.start()

    def tearDown(self):
        # Shutdown server
        self.server.shutdown()
        self.server_thread.join()
        self.server.server_close()

        # Clean up temporary files
        if os.path.exists(self.data_file):
            os.remove(self.data_file)
        if os.path.exists(self.output_file):
            os.remove(self.output_file)

    def test_get_index(self):
        url = f"http://127.0.0.1:{self.port}/"
        with urllib.request.urlopen(url) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("text/html", response.getheader("Content-Type"))
            html_content = response.read().decode("utf-8")
            self.assertIn("<!doctype html>", html_content.lower())

    def test_get_comments_api(self):
        url = f"http://127.0.0.1:{self.port}/api/comments"
        with urllib.request.urlopen(url) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("application/json", response.getheader("Content-Type"))
            data = json.loads(response.read().decode("utf-8"))
            self.assertEqual(data["repo"], "a2ui-project/a2ui")

    def test_get_missing_file_404(self):
        url = f"http://127.0.0.1:{self.port}/non_existent_file.png"
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(url)
        self.assertEqual(cm.exception.code, 404)

    def test_options_request(self):
        # Send an OPTIONS request, should return 200 (actual implementation) and CORS headers
        url = f"http://127.0.0.1:{self.port}/api/save"
        req = urllib.request.Request(url, method="OPTIONS")
        with urllib.request.urlopen(req) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(
                response.getheader("Access-Control-Allow-Methods"), "GET, POST, OPTIONS"
            )

    def test_post_save_api(self):
        url = f"http://127.0.0.1:{self.port}/api/save"
        mock_decisions = {
            "decisions": [{
                "id": 1,
                "approved": True,
                "priority": "P1",
                "assignee": "gspencer",
                "action": "investigate",
                "labels": [],
                "reply": "Draft reply",
            }]
        }
        req_data = json.dumps(mock_decisions).encode("utf-8")
        req = urllib.request.Request(url, data=req_data, method="POST")

        with urllib.request.urlopen(req) as response:
            self.assertEqual(response.status, 200)
            res_data = json.loads(response.read().decode("utf-8"))
            self.assertEqual(res_data["status"], "success")

        # Verify output
        self.assertTrue(os.path.exists(self.output_file))
        with open(self.output_file, "r", encoding="utf-8") as f:
            saved_data = json.load(f)
            self.assertEqual(saved_data["decisions"][0]["priority"], "P1")
        self.assertTrue(launch_dashboard.shutdown_event.is_set())

    def test_post_save_invalid_json(self):
        url = f"http://127.0.0.1:{self.port}/api/save"
        req_data = b"invalid-raw-json-data"
        req = urllib.request.Request(url, data=req_data, method="POST")

        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req)
        self.assertEqual(cm.exception.code, 500)

    def test_post_abort_api(self):
        url = f"http://127.0.0.1:{self.port}/api/abort"
        req = urllib.request.Request(url, method="POST")

        with urllib.request.urlopen(req) as response:
            self.assertEqual(response.status, 200)
            res_data = json.loads(response.read().decode("utf-8"))
            self.assertEqual(res_data["status"], "aborted")

        self.assertTrue(launch_dashboard.shutdown_event.is_set())
        self.assertEqual(launch_dashboard.exit_status, 1)

    @patch("webbrowser.open")
    @patch("argparse.ArgumentParser.parse_args")
    @patch("launch_dashboard.http.server.ThreadingHTTPServer")
    def test_main_cli_orchestration(
        self, mock_server_class, mock_parse_args, mock_web_open
    ):
        mock_args = MagicMock()
        mock_args.data_file = self.data_file
        mock_args.output_file = self.output_file
        mock_parse_args.return_value = mock_args

        mock_server_instance = MagicMock()
        mock_server_instance.server_port = 9999
        mock_server_class.return_value = mock_server_instance

        launch_dashboard.shutdown_event.set()
        launch_dashboard.exit_status = 0

        with self.assertRaises(SystemExit) as cm:
            launch_dashboard.main()

        self.assertEqual(cm.exception.code, 0)
        mock_web_open.assert_called_once_with("http://localhost:9999/")
        mock_server_instance.shutdown.assert_called_once()

    @patch("argparse.ArgumentParser.parse_args")
    def test_main_data_file_not_exists(self, mock_parse_args):
        mock_args = MagicMock()
        mock_args.data_file = "/mock/non_existent_data.json"
        mock_args.output_file = self.output_file
        mock_parse_args.return_value = mock_args

        # Should exit with error code 1
        with self.assertRaises(SystemExit) as cm:
            launch_dashboard.main()
        self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
