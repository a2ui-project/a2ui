#!/usr/bin/env python3
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import re
import sys
import glob

def parse_yaml(yaml_str):
    """
    A simple, zero-dependency YAML parser for blueprint frontmatter.
    Handles nested dicts and lists based on indentation.
    """
    lines = yaml_str.splitlines()
    data = {}
    path = [] # list of (indent_level, key)
    
    for line in lines:
        # Remove comments
        line = re.sub(r'#.*$', '', line)
        if not line.strip():
            continue
            
        indent = len(line) - len(line.lstrip())
        stripped = line.strip()
        
        # Adjust path based on indent
        while path and indent <= path[-1][0]:
            path.pop()
            
        if stripped.startswith('- '):
            val = stripped[2:].strip().strip('"\'')
            if val.lower() == 'true': val = True
            elif val.lower() == 'false': val = False
            
            # Find the parent in data
            parent = data
            for i, (_, pk) in enumerate(path):
                if i == len(path) - 1:
                    # If the last container is a dict, convert to list if empty
                    if isinstance(parent[pk], dict) and not parent[pk]:
                        parent[pk] = []
                parent = parent[pk]
                
            if isinstance(parent, list):
                parent.append(val)
            continue
            
        if ':' in stripped:
            key, val = stripped.split(':', 1)
            key = key.strip()
            val = val.strip().strip('"\'')
            
            # Type conversions
            if val.lower() == 'true': val = True
            elif val.lower() == 'false': val = False
            elif val == '[]': val = []
            elif val == '{}': val = {}
            elif val == '': val = {} # Initialize as dict by default
            
            # Set the value in data
            parent = data
            for _, pk in path:
                parent = parent[pk]
            
            if isinstance(parent, dict):
                parent[key] = val
            
            path.append((indent, key))
            
    return data

def parse_frontmatter(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return None, f"Failed to read file: {e}"
        
    if not content.startswith('---'):
        return None, "File does not start with frontmatter separator '---'"
        
    parts = content.split('---', 2)
    if len(parts) < 3:
        return None, "File does not have matching frontmatter separator '---'"
        
    try:
        data = parse_yaml(parts[1])
        return data, None
    except Exception as e:
        return None, f"Failed to parse YAML frontmatter: {e}"

def main():
    workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    errors = []
    
    # 1. Discover and validate Module Blueprints
    modules_dir = os.path.join(workspace_root, 'blueprints', 'modules')
    module_blueprints = {}
    
    if os.path.exists(modules_dir):
        for file in glob.glob(os.path.join(modules_dir, '*.blueprint.md')):
            basename = os.path.basename(file)
            data, err = parse_frontmatter(file)
            if err:
                errors.append(f"Module blueprint {basename}: {err}")
                continue
                
            name = data.get('name')
            if not name:
                errors.append(f"Module blueprint {basename}: Missing mandatory 'name' field in frontmatter")
                continue
                
            if not re.match(r'^[a-z0-9_]+$', name):
                errors.append(f"Module blueprint {basename}: 'name' '{name}' must be snake_case")
                
            expected_filename = f"{name}.blueprint.md"
            if basename != expected_filename:
                errors.append(f"Module blueprint {basename}: Filename does not match name '{name}' (expected '{expected_filename}')")
                
            module_blueprints[name] = {
                'file': basename
            }
    else:
        errors.append(f"Modules directory '{modules_dir}' does not exist")

    # 2. Discover and validate Feature Blueprints
    features_dir = os.path.join(workspace_root, 'blueprints', 'features')
    feature_blueprints = {}
    
    # We search recursively for *.blueprint.md under blueprints/features/
    if os.path.exists(features_dir):
        for root, _, files in os.walk(features_dir):
            for file in files:
                if file.endswith('.blueprint.md'):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, features_dir)
                    
                    # Validate naming convention: YYYY_MM_DD_feature_name.blueprint.md
                    match = re.match(r'^(\d{4}_\d{2}_\d{2})_([a-z0-9_]+)\.blueprint\.md$', file)
                    if not match:
                        errors.append(f"Feature blueprint '{rel_path}': Filename does not follow the required YYYY_MM_DD_feature_name.blueprint.md format")
                        continue
                        
                    file_date = match.group(1)
                    extracted_feature_name = match.group(2)
                    
                    data, err = parse_frontmatter(full_path)
                    if err:
                        errors.append(f"Feature blueprint '{rel_path}': {err}")
                        continue
                        
                    feature_name = data.get('feature_name')
                    if not feature_name:
                        errors.append(f"Feature blueprint '{rel_path}': Missing mandatory 'feature_name' field in frontmatter")
                        continue
                        
                    if feature_name != extracted_feature_name:
                        errors.append(f"Feature blueprint '{rel_path}': 'feature_name' '{feature_name}' does not match name in filename '{extracted_feature_name}'")
                        
                    module_blueprints_list = data.get('module_blueprints')
                    if module_blueprints_list is None:
                        errors.append(f"Feature blueprint '{rel_path}': Missing mandatory 'module_blueprints' field in frontmatter")
                    elif not isinstance(module_blueprints_list, list):
                        errors.append(f"Feature blueprint '{rel_path}': 'module_blueprints' must be a list of module names")
                    else:
                        for mod_name in module_blueprints_list:
                            if mod_name not in module_blueprints:
                                errors.append(f"Feature blueprint '{rel_path}': References unknown module blueprint '{mod_name}'")
                                
                    type_val = data.get('type')
                    if type_val is None:
                        errors.append(f"Feature blueprint '{rel_path}': Missing mandatory 'type' field in frontmatter")
                    elif type_val not in ('required', 'optional'):
                        errors.append(f"Feature blueprint '{rel_path}': 'type' field must be 'required' or 'optional'")
                        
                    date_added = data.get('date_added')
                    if not date_added:
                        errors.append(f"Feature blueprint '{rel_path}': Missing mandatory 'date_added' field in frontmatter")
                        
                    dependencies = data.get('dependencies')
                    if dependencies is not None:
                        if not isinstance(dependencies, list):
                            errors.append(f"Feature blueprint '{rel_path}': 'dependencies' must be a list of feature names")
                            dependencies = []
                        else:
                            for dep in dependencies:
                                if not isinstance(dep, str):
                                    errors.append(f"Feature blueprint '{rel_path}': Each dependency must be a string (feature name)")
                    else:
                        dependencies = []
                        
                    feature_blueprints[feature_name] = {
                        'file': rel_path,
                        'module_blueprints': module_blueprints_list or [],
                        'dependencies': dependencies
                    }
                    
    # Validate feature dependencies
    for feat_name, feat_info in feature_blueprints.items():
        for dep in feat_info['dependencies']:
            if dep not in feature_blueprints:
                errors.append(f"Feature blueprint '{feat_info['file']}': Dependency '{dep}' is not a valid feature blueprint in the repository")
    
    # 3. Discover and validate Codebase Blueprints
    codebase_blueprints = []
    # Search recursively for codebase.blueprint.md files
    for root, _, files in os.walk(workspace_root):
        # Skip common directories to optimize
        if any(part in root.split(os.sep) for part in ['.git', '.yarn', 'node_modules', 'blueprints', 'specification']):
            continue
            
        if 'codebase.blueprint.md' in files:
            full_path = os.path.join(root, 'codebase.blueprint.md')
            rel_dir = os.path.relpath(root, workspace_root)
            
            data, err = parse_frontmatter(full_path)
            if err:
                errors.append(f"Codebase blueprint in '{rel_dir}': {err}")
                continue
                
            associated_module = data.get('associated_module')
            if not associated_module:
                errors.append(f"Codebase blueprint in '{rel_dir}': Missing mandatory 'associated_module' field in frontmatter")
                continue
                
            if associated_module not in module_blueprints:
                errors.append(f"Codebase blueprint in '{rel_dir}': References unknown associated_module '{associated_module}'")
                    
            implemented_features = data.get('implemented_features')
            if implemented_features is not None:
                if not isinstance(implemented_features, list):
                    errors.append(f"Codebase blueprint in '{rel_dir}': 'implemented_features' must be a list of feature names")
                else:
                    for feat_name in implemented_features:
                        if feat_name not in feature_blueprints:
                            errors.append(f"Codebase blueprint in '{rel_dir}': References unknown implemented feature '{feat_name}'")
                        else:
                            # Cross check: The feature blueprint must list the associated module of this codebase
                            feat_info = feature_blueprints[feat_name]
                            if associated_module not in feat_info['module_blueprints']:
                                errors.append(f"Codebase blueprint in '{rel_dir}': Implemented feature '{feat_name}' does not target associated_module '{associated_module}' (targets: {feat_info['module_blueprints']})")
                                
            codebase_blueprints.append(rel_dir)
            
    # 4. Check that all codebases listed in modules actually exist and have codebase.blueprint.md (covered in part 1)
    
    # Summary and Exit
    if errors:
        print(f"=== Blueprint Validation Failed with {len(errors)} error(s) ===", file=sys.stderr)
        for err in errors:
            print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)
    else:
        print("=== Blueprint Validation Passed Successfully ===")
        sys.exit(0)

if __name__ == '__main__':
    main()
