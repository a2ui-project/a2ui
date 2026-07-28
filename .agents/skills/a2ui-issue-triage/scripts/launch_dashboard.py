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

import http.server
import json
import os
import sys
import webbrowser
import urllib.parse
import threading
import time

# Global event for shutdown synchronization, and exit status
shutdown_event = threading.Event()
exit_status = 0


class TriageDashboardHandler(http.server.BaseHTTPRequestHandler):
    data_file = ""
    output_file = ""

    def log_message(self, format, *args):
        # Suppress logging to keep terminal output clean
        pass

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)

        if parsed_url.path == "/" or parsed_url.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            html_path = os.path.join(
                os.path.dirname(__file__), "../assets/triage_dashboard.html"
            )
            with open(html_path, "rb") as f:
                self.wfile.write(f.read())

        elif parsed_url.path == "/api/comments":
            try:
                if os.path.exists(self.data_file):
                    with open(self.data_file, "r", encoding="utf-8") as f:
                        report_data = json.load(f)

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(report_data).encode("utf-8"))
                else:
                    self.send_error_json(
                        404, f"Triage comments data not found ({self.data_file})."
                    )
            except Exception as e:
                self.send_error_json(500, f"Server error: {str(e)}")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global exit_status
        parsed_url = urllib.parse.urlparse(self.path)

        if parsed_url.path == "/api/save":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode("utf-8"))

                # Write to output_file
                with open(self.output_file, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode("utf-8"))

                exit_status = 0
                shutdown_event.set()

            except Exception as e:
                self.send_error_json(500, f"Failed to save triage decisions: {str(e)}")

        elif parsed_url.path == "/api/abort":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "aborted"}).encode("utf-8"))

            exit_status = 1
            shutdown_event.set()
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def send_error_json(self, status, message):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode("utf-8"))


def run_server(server):
    server.serve_forever()


def main():

    import argparse

    parser = argparse.ArgumentParser(description="Launch issue triage dashboard.")
    parser.add_argument(
        "--data-file", required=True, help="Path to issues_to_triage.json."
    )
    parser.add_argument(
        "--output-file", required=True, help="Path to save triage_decisions.json."
    )
    args = parser.parse_args()

    # Resolve paths
    resolved_data_file = os.path.abspath(os.path.expanduser(args.data_file))
    resolved_output_file = os.path.abspath(os.path.expanduser(args.output_file))

    if not os.path.exists(resolved_data_file):
        print(
            f"Error: Data file '{resolved_data_file}' does not exist.", file=sys.stderr
        )
        sys.exit(1)

    os.makedirs(os.path.dirname(resolved_output_file), exist_ok=True)

    # Pass paths to handler class
    TriageDashboardHandler.data_file = resolved_data_file
    TriageDashboardHandler.output_file = resolved_output_file

    # Bind to random port
    server_address = ("127.0.0.1", 0)
    httpd = http.server.ThreadingHTTPServer(server_address, TriageDashboardHandler)
    port = httpd.server_port

    server_thread = threading.Thread(target=run_server, args=(httpd,))
    server_thread.daemon = True
    server_thread.start()

    url = f"http://localhost:{port}/"
    print(f"Starting issue triage dashboard on {url}", flush=True)
    print("Waiting for user decisions in the browser...", flush=True)

    # Open browser
    webbrowser.open(url)

    # Wait for the shutdown event (triggered by save/abort API)
    try:
        shutdown_event.wait()
    except KeyboardInterrupt:
        print("\nAborted by user (Ctrl+C)", flush=True)
        httpd.shutdown()
        sys.exit(1)

    httpd.shutdown()

    if exit_status == 0:
        print("Triage plan saved successfully.", flush=True)
        sys.exit(0)
    else:
        print("Triage review aborted by user.", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
