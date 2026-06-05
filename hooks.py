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

import re

def on_page_markdown(markdown, page, config, files):
    github_base_url = "https://github.com/a2ui-project/a2ui/blob/main"
    
    def link_replacer(match):
        if match.group("code"):
            return match.group(0)
            
        text = match.group("text")
        path = match.group("path")
        title = match.group("title")
        
        # Ignore external links
        if path.startswith(("http://", "https://", "mailto:", "tel:")):
            return match.group(0)
            
        # Count leading ../
        up_count = 0
        temp_path = path
        while temp_path.startswith("../"):
            up_count += 1
            temp_path = temp_path[3:]
            
        # Calculate file depth relative to docs dir
        # MkDocs src_path always uses '/'
        file_depth = len(page.file.src_path.split('/')) - 1
        
        # Check if the link points outside the docs folder
        if up_count > file_depth:
            # To get to repo root from a file at file_depth, 
            # we need to go up file_depth + 1 levels.
            strip_count = file_depth + 1
            
            # Remove the leading '../' sequences that take us to the repo root
            parts = path.split('/')
            while strip_count > 0 and parts and parts[0] == '..':
                parts.pop(0)
                strip_count -= 1
            clean_path = '/'.join(parts)
            
            # Return the newly formatted absolute GitHub link
            title_suffix = f" {title}" if title else ""
            return f"[{text}]({github_base_url}/{clean_path}{title_suffix})"
        
        return match.group(0)

    # Find all standard markdown links: [text](path)
    regex = r'(?P<code>`[^`]+`|```[\s\S]*?```)|\[(?P<text>[^\]]+)\]\((?P<path>[^\s)]+)(?:\s+(?P<title>".*?"|\'.*?\'))?\)'
    return re.sub(regex, link_replacer, markdown)