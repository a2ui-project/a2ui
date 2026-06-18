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

import yaml
import os

source_path = "/Users/gspencer/code/a2ui/a2ui_express/eval/datasets/v0_9_prompts.yaml"
dest_path = "/Users/gspencer/code/a2ui/a2ui_express/eval/datasets/v1_0_prompts.yaml"

with open(source_path, "r") as f:
    data = yaml.safe_load(f)

for sample in data:
    prompt = sample.get("promptText", "")
    target = sample.get("target", "")
    
    # 1. Message Structure Replacements (v0.9 -> v1.0)
    prompt = prompt.replace("followed by 'updateComponents' message", "with components inline")
    prompt = prompt.replace("followed by a 'updateComponents' message", "with components inline")
    prompt = prompt.replace("followed by an 'updateComponents' message", "with components inline")
    prompt = prompt.replace("generate a 'createSurface' message followed by 'updateComponents' message", "generate a single 'createSurface' message with components inline")
    prompt = prompt.replace("Generate a 'createSurface' message and a 'updateComponents' message", "Generate a single 'createSurface' message with components inline")
    prompt = prompt.replace("createSurface 'main', then updateComponents", "createSurface 'main' with components inline")
    prompt = prompt.replace("followed by 'updateDataModel' message", "with data model inline")
    prompt = prompt.replace("followed by an updateDataModel message", "with data model inline")
    prompt = prompt.replace("followed by an 'updateDataModel' message", "with data model inline")
    prompt = prompt.replace("Create a single data model update message to set", "Include an inline data model to set")
    prompt = prompt.replace("Generate a 'createSurface' message and a 'updateDataModel' message", "Generate a single 'createSurface' message with inline data model")
    prompt = prompt.replace("followed by an updateComponents message", "with components inline")
    prompt = prompt.replace("followed by an updateComponents", "with components inline")
    prompt = prompt.replace("followed by updateComponents", "with components inline")
    prompt = prompt.replace("createSurface 'main', then updateDataModel", "createSurface 'main' with inline data model")
    
    # Global target replacements for message structure
    target = target.replace("containing 'createSurface' and 'updateComponents' messages", "containing a 'createSurface' message with inline components")
    target = target.replace("containing createSurface and updateComponents messages", "containing a 'createSurface' message with inline components")
    target = target.replace("contain a createSurface message and an updateComponents message", "contain a 'createSurface' message with inline components")
    target = target.replace("contain a createSurface message and updateComponents message", "contain a 'createSurface' message with inline components")
    target = target.replace("createSurface and updateComponents messages", "createSurface message with inline components")
    target = target.replace("createSurface for 'main' and updateComponents for 'main'", "createSurface message with inline components")
    target = target.replace("and an updateComponents message", "")
    target = target.replace("and updateComponents message", "")
    target = target.replace("followed by updateComponents", "")
    target = target.replace("and an updateDataModel message", "and inline data model")
    target = target.replace("followed by 'updateDataModel' message", "and inline data model")
    target = target.replace("followed by an 'updateDataModel' message", "and inline data model")
    target = target.replace("single data model update message", "inline data model")
    target = target.replace("an updateDataModel message", "inline data model")
    target = target.replace("updateDataModel message", "inline data model")
    target = target.replace("updateComponents message", "createSurface message")
    
    # 2. Text variant replacements (h1-h5 are invalid in v1.0 schema)
    for h in ["h1", "h2", "h3", "h4", "h5"]:
        prompt = prompt.replace(f" (variant '{h}')", "")
        prompt = prompt.replace(f"(variant '{h}')", "")
        prompt = prompt.replace(f" variant '{h}'", "")
        prompt = prompt.replace(f"variant '{h}'", "")
        prompt = prompt.replace(f" (variant: '{h}')", "")
        prompt = prompt.replace(f"(variant: '{h}')", "")
        prompt = prompt.replace(f" ({h})", "")
        prompt = prompt.replace(f"({h})", "")
        
        target = target.replace(f" (variant '{h}')", "")
        target = target.replace(f"(variant '{h}')", "")
        target = target.replace(f" variant '{h}'", "")
        target = target.replace(f"variant '{h}'", "")
        target = target.replace(f" (variant: '{h}')", "")
        target = target.replace(f"(variant: '{h}')", "")
        target = target.replace(f" ({h})", "")
        target = target.replace(f"({h})", "")
        
        target = target.replace(f"an '{h}' 'Text'", "a 'Text'")
        target = target.replace(f"an '{h}' Text", "a Text")
        target = target.replace(f"an {h} Text", "a Text")
        target = target.replace(f"a '{h}' 'Text'", "a 'Text'")
        target = target.replace(f"a '{h}' Text", "a Text")
        target = target.replace(f"a {h} Text", "a Text")
        target = target.replace(f"'{h}' 'Text'", "'Text'")
        target = target.replace(f"'{h}' Text", "Text")
        target = target.replace(f"{h} Text", "Text")

    # 3. Multiline to longText replacements
    prompt = prompt.replace("(multiline)", "(longText)")
    prompt = prompt.replace("multiline", "longText")
    target = target.replace("(multiline)", "(longText)")
    target = target.replace("multiline", "longText")

    # 4. Remove returnType requirements for function calls in v1.0
    prompt = prompt.replace("with returnType 'string'", "")
    prompt = prompt.replace("with returnType string", "")
    target = target.replace("with returnType 'string'", "")
    target = target.replace("with returnType string", "")
    target = target.replace("and the returnType property", "")
    target = target.replace("returnType property", "")

    sample["promptText"] = prompt
    sample["target"] = target

with open(dest_path, "w") as f:
    yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

print("Translation complete! Written to:", dest_path)
