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
import os


def map_spec_filename(filename, version_str):
    mapping = {
        'a2ui_protocol.md': f'{version_str}-a2ui.md',
        'evolution_guide.md': f'{version_str}-evolution-guide.md',
        'a2ui_extension_specification.md': (
            f'{version_str}-a2ui-extension-specification.md'
        ),
        'basic_catalog_implementation_guide.md': (
            f'{version_str}-basic-catalog-implementation-guide.md'
        ),
    }
    if version_str == 'v0.8' and filename == 'a2ui_extension_specification.md':
        return 'v0.8-a2a-extension.md'
    return mapping.get(filename)


def on_page_markdown(markdown, page, config, files):
    github_base_url = 'https://github.com/a2ui-project/a2ui/blob/main'

    # 1. Pre-expand snippet includes (--8<--)
    for _ in range(5):
        expanded = False

        def snippet_replacer(match):
            nonlocal expanded
            snippet_path = match.group('snippet_path')
            if os.path.exists(snippet_path):
                with open(snippet_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                expanded = True
                return content
            return match.group(0)

        regex = r'^\s*--8<--\s+["\'](?P<snippet_path>[^"\']+)["\']\s*$'
        new_markdown = re.sub(regex, snippet_replacer, markdown, flags=re.MULTILINE)
        if not expanded:
            break
        markdown = new_markdown

    # 2. Extract version prefix from wrapper page filename (e.g. "v0.9.1-")
    version_match = re.match(r'^(v\d+(?:\.\d+)*)-', page.file.name)
    version_str = None
    version_folder = None
    if version_match:
        version_str = version_match.group(1)
        version_folder = version_str.replace('.', '_')

    # Calculate file depth relative to docs dir
    file_depth = len(page.file.src_path.split('/')) - 1

    def replace_path(path):
        if path.startswith(('http://', 'https://', 'mailto:', 'tel:')):
            return path

        parts = path.split('#')
        base_path = parts[0]
        anchor = f'#{parts[1]}' if len(parts) > 1 else ''

        if base_path.startswith('./'):
            base_path = base_path[2:]

        if version_str:
            mapped_name = map_spec_filename(base_path, version_str)
            if mapped_name:
                return mapped_name + anchor

            # Rewrite relative paths inside same version (e.g. "../json/...") to the copied location
            if path.startswith('../') and not path.startswith('../../'):
                return version_folder + '/' + path[3:]

        # Check if the link points outside the docs folder
        up_count = 0
        temp_path = path
        while temp_path.startswith('../'):
            up_count += 1
            temp_path = temp_path[3:]

        if up_count > file_depth:
            strip_count = up_count

            # Remove the leading '../' sequences
            path_parts = path.split('/')
            while strip_count > 0 and path_parts and path_parts[0] == '..':
                path_parts.pop(0)
                strip_count -= 1
            clean_path = '/'.join(path_parts)

            # Return the newly formatted absolute GitHub link
            return f'{github_base_url}/{clean_path}'

        return path

    def replace_standard_links(text_content):
        def link_replacer(match):
            if match.group('code'):
                return match.group(0)
            path = match.group('path')
            new_path = replace_path(path)
            matched_str = match.group(0)
            start = match.start('path') - match.start(0)
            end = match.end('path') - match.start(0)
            return matched_str[:start] + new_path + matched_str[end:]

        regex = r'(?P<code>`[^`]+`|```[\s\S]*?```)|\[(?P<text>[^\]]+)\]\((?P<path>[^\s)]+)(?:\s+(?P<title>".*?"|\'.*?\'))?\)'
        return re.sub(regex, link_replacer, text_content)

    def replace_reference_links(text_content):
        def ref_replacer(match):
            path = match.group('path')
            new_path = replace_path(path)
            matched_str = match.group(0)
            start = match.start('path') - match.start(0)
            end = match.end('path') - match.start(0)
            return matched_str[:start] + new_path + matched_str[end:]

        regex = r'^\s*\[(?P<ref>[^\]]+)\]:\s*(?P<path>[^\s]+)(?:\s+(?P<title>".*?"|\'.*?\'))?\s*$'
        return re.sub(regex, ref_replacer, text_content, flags=re.MULTILINE)

    markdown = replace_standard_links(markdown)
    markdown = replace_reference_links(markdown)
    return markdown
