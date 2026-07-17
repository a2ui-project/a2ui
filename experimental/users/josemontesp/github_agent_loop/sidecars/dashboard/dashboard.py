import os
import json
import http.server
import socketserver

STATE_FILE_PATH = os.path.expanduser('~/.gemini/jetski/github_agent_state.json')


class DashboardHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()

            # Read state file
            state = {}
            if os.path.exists(STATE_FILE_PATH):
                try:
                    with open(STATE_FILE_PATH, 'r') as f:
                        state = json.load(f)
                except Exception as e:
                    state = {'error': f'Error loading state file: {e}'}
            else:
                state = {'error': f'State file not found at {STATE_FILE_PATH}'}

            # Generate HTML
            html = self.generate_html(state)
            self.wfile.write(html.encode('utf-8'))
        else:
            self.send_error(404, 'File not found')

    def generate_html(self, state):
        error_msg = state.get('error', '')
        error_html = f'<div class="error">{error_msg}</div>' if error_msg else ''

        projects = state.get('projects', {})
        projects_rows = []
        for thread_id, proj in projects.items():
            # Get short thread ID
            short_thread = thread_id.split('/')[-1] if '/' in thread_id else thread_id

            # Form github PR link if it exists
            pr_val = proj.get('github_pr', '')
            if pr_val:
                pr_link = (
                    f'<a href="https://github.com/a2ui-project/a2ui/pull/{pr_val}"'
                    f' target="_blank">#{pr_val}</a>'
                )
            else:
                pr_link = '<span class="none">None</span>'

            status_class = 'status-' + proj.get('status', 'inactive').lower()
            phase_class = 'phase-' + proj.get('phase', 'unknown').lower()

            row = f"""
            <tr>
                <td><strong>{proj.get('project_name', 'Unnamed')}</strong><br><small class="thread-id">{short_thread}</small></td>
                <td><span class="badge {phase_class}">{proj.get('phase', 'UNKNOWN')}</span></td>
                <td><span class="badge {status_class}">{proj.get('status', 'INACTIVE')}</span></td>
                <td><code>{proj.get('git_branch', '') or '<span class="none">None</span>'}</code></td>
                <td>{pr_link}</td>
                <td><small><code>{proj.get('worktree_path', '') or '<span class="none">None</span>'}</code></small></td>
            </tr>
            """
            projects_rows.append(row)

        projects_table_body = (
            '\n'.join(projects_rows)
            if projects_rows
            else '<tr><td colspan="6">No projects tracked.</td></tr>'
        )

        active_conv = state.get('active_conversation_id', 'None')
        active_improver = state.get('active_improver_conversation_id', 'None')

        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <title>Orchestrator Dashboard</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f6f8fa;
            color: #24292f;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 24px;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(27,31,35,0.12), 0 1px 2px rgba(27,31,35,0.24);
        }}
        h1 {{
            font-size: 24px;
            border-bottom: 1px solid #d0d7de;
            padding-bottom: 8px;
            margin-top: 0;
        }}
        .meta-info {{
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            background-color: #f6f8fa;
            padding: 12px;
            border-radius: 6px;
            font-size: 14px;
            border: 1px solid #d0d7de;
        }}
        .meta-item {{
            margin-right: 15px;
        }}
        .meta-label {{
            font-weight: bold;
            color: #57606a;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }}
        th, td {{
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid #d0d7de;
        }}
        th {{
            background-color: #f6f8fa;
            font-weight: 600;
        }}
        tr:hover {{
            background-color: #f6f8fa;
        }}
        .badge {{
            display: inline-block;
            padding: 4px 8px;
            font-size: 12px;
            font-weight: 600;
            line-height: 1;
            border-radius: 2em;
        }}
        /* Status Badges */
        .status-active {{
            background-color: #dafbe1;
            color: #1a7f37;
        }}
        .status-inactive {{
            background-color: #ffebe9;
            color: #cf222e;
        }}
        /* Phase Badges */
        .phase-developing {{
            background-color: #ddf4ff;
            color: #0969da;
        }}
        .phase-review_pending {{
            background-color: #fff8c5;
            color: #9a6700;
        }}
        .phase-completed {{
            background-color: #dafbe1;
            color: #1a7f37;
        }}
        .phase-unknown {{
            background-color: #eaeef2;
            color: #57606a;
        }}
        .none {{
            color: #8c959f;
            font-style: italic;
        }}
        .thread-id {{
            color: #57606a;
        }}
        .error {{
            background-color: #ffebe9;
            color: #cf222e;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #ff8585;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Orchestrator Dashboard</h1>
        {error_html}
        <div class="meta-info">
            <div class="meta-item">
                <span class="meta-label">Active Conversation:</span> <code>{active_conv}</code>
            </div>
            <div class="meta-item">
                <span class="meta-label">Active Improver:</span> <code>{active_improver}</code>
            </div>
        </div>
        
        <h2>Tracked Projects</h2>
        <table>
            <thead>
                <tr>
                    <th>Project Name</th>
                    <th>Phase</th>
                    <th>Status</th>
                    <th>Git Branch</th>
                    <th>GitHub PR</th>
                    <th>Worktree Path</th>
                </tr>
            </thead>
            <tbody>
                {projects_table_body}
            </tbody>
        </table>
    </div>
</body>
</html>
"""
        return html_content


def run():
    port = int(os.environ.get('ANTIGRAVITY_SIDECAR_WEB_PORT', 8080))
    server_address = ('', port)
    httpd = socketserver.TCPServer(server_address, DashboardHandler)
    print(f'Starting dashboard server on port {port}...')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print('Server stopped.')


if __name__ == '__main__':
    run()
