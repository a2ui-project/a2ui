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
import socketserver
import os
import urllib.parse

PORT = 8081
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        if parsed_path.path == "/pong_app_web_frame.html":
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.send_header("Access-Control-Allow-Origin", "http://localhost:4200")
            self.end_headers()

            mcp_app_proxy_dir = os.path.abspath(
                os.path.join(DIRECTORY, "..", "..", "agent", "adk", "mcp_app_proxy")
            )
            with open(
                os.path.join(mcp_app_proxy_dir, "pong_base.html"), "r", encoding="utf-8"
            ) as f:
                html_content = f.read()
            with open(
                os.path.join(DIRECTORY, "pong_web_frame_bridge.js"),
                "r",
                encoding="utf-8",
            ) as f:
                bridge = f.read()
            with open(
                os.path.join(mcp_app_proxy_dir, "pong_engine.js"), "r", encoding="utf-8"
            ) as f:
                engine = f.read()

            html_content = html_content.replace("// {{BRIDGE_SCRIPT}}", bridge).replace(
                "// {{ENGINE_SCRIPT}}", engine
            )
            html_content = html_content.replace(
                "🔌 Embedded MCP App", "🌐 Embedded Web App (URL)"
            )
            self.wfile.write(html_content.encode("utf-8"))
            return

        super().do_GET()

    def end_headers(self):
        parsed_path = urllib.parse.urlparse(self.path)
        if not parsed_path.path == "/pong_app_web_frame.html":
            self.send_header("Access-Control-Allow-Origin", "http://localhost:4200")
        super().end_headers()


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
