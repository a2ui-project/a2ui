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

import json
import argparse
from pathlib import Path

VERSION_0_9_CATALOG_ID = (
    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
)


def _convert_map(v_map):
  res = {}
  for m_item in v_map:
    m_key = m_item["key"]
    m_val_key = [mk for mk in m_item.keys() if mk.startswith("value")][0]
    m_val = m_item[m_val_key]
    if m_val_key == "valueMap":
      res[m_key] = _convert_map(m_val)
    else:
      res[m_key] = m_val
  return res


def migrate_v08_to_v09(v08_data, catalog_id=VERSION_0_9_CATALOG_ID):
  v09_data = []

  # We need to track which component is the root for each surface
  surface_roots = {}

  for msg in v08_data:
    new_msg = {"version": "v0.9"}

    if "beginRendering" in msg:
      br = msg["beginRendering"]
      surface_id = br["surfaceId"]
      root_id = br["root"]
      surface_roots[surface_id] = root_id

      new_br = {
          "surfaceId": surface_id,
          "catalogId": catalog_id,
      }
      if "styles" in br:
        new_br["theme"] = br["styles"]

      new_msg["createSurface"] = new_br

    elif "surfaceUpdate" in msg:
      su = msg["surfaceUpdate"]
      surface_id = su["surfaceId"]
      root_id = surface_roots.get(surface_id)

      new_components = []
      for comp_wrapper in su["components"]:
        comp_id = comp_wrapper["id"]
        # Rename the designated root component to "root"
        if comp_id == root_id:
          comp_id = "root"

        # Unwrap component type and properties
        if "component" not in comp_wrapper:
          # Possibly already migrated or invalid format? Skip or attempt to handle?
          # Some custom components might be different.
          continue

        comp_keys = list(comp_wrapper["component"].keys())
        if not comp_keys:
          continue
        comp_type = comp_keys[0]
        comp_props = comp_wrapper["component"][comp_type]

        new_comp = {"id": comp_id, "component": comp_type}

        # Add weight if present
        if "weight" in comp_wrapper:
          new_comp["weight"] = comp_wrapper["weight"]

        # Transform properties
        for k, v in comp_props.items():
          if k == "children":
            if "explicitList" in v:
              # Update child IDs if they were the root
              new_comp["children"] = [
                  c if c != root_id else "root" for c in v["explicitList"]
              ]
            elif "template" in v:
              template = v["template"]
              new_comp["children"] = {
                  "componentId": (
                      template["componentId"]
                      if template["componentId"] != root_id
                      else "root"
                  ),
                  "path": template.get("dataBinding", ""),
              }
          elif k == "child":
            new_comp["child"] = v if v != root_id else "root"
          elif k == "tabItems":
            new_comp["tabs"] = [
                {
                    "title": item["title"],
                    "child": item["child"] if item["child"] != root_id else "root",
                }
                for item in v
            ]
          elif k == "entryPointChild":
            new_comp["trigger"] = v if v != root_id else "root"
          elif k == "contentChild":
            new_comp["content"] = v if v != root_id else "root"
          elif k == "usageHint":
            new_comp["variant"] = v
          elif k == "action":
            new_action = {"event": {"name": v["name"]}}
            if "context" in v:
              new_context = {}
              for item in v["context"]:
                # Unwrap context value if needed
                val = item["value"]
                if isinstance(val, dict) and "literalString" in val:
                  val = val["literalString"]
                elif isinstance(val, dict) and "literalNumber" in val:
                  val = val["literalNumber"]
                elif isinstance(val, dict) and "literalBoolean" in val:
                  val = val["literalBoolean"]

                new_context[item["key"]] = val
              new_action["event"]["context"] = new_context
            new_comp["action"] = new_action
          elif k == "fit":
            new_comp["fit"] = "scaleDown" if v == "scale-down" else v
          elif k == "alignment":
            new_comp["align"] = v
          elif k == "distribution":
            new_comp["justify"] = v
          elif k == "text" and comp_type == "TextField":
            new_comp["value"] = v
          elif k == "type" and comp_type == "TextField":
            new_comp["variant"] = v
          elif k == "primary":
            # Map Button primary to variant
            if comp_type == "Button":
              new_comp["variant"] = "primary" if v else "default"
            else:
              new_comp[k] = v
          else:
            # General literal unwrapping
            if isinstance(v, dict) and "literalString" in v:
              v = v["literalString"]
            elif isinstance(v, dict) and "literalNumber" in v:
              v = v["literalNumber"]
            elif isinstance(v, dict) and "literalBoolean" in v:
              v = v["literalBoolean"]

            # Icon specific handling
            if comp_type == "Icon":
              if k == "name":
                # Map common icon names to v0.9 enum
                icon_map = {
                    "check_circle": "check",
                    "calendar_today": "calendarToday",
                    "location_on": "locationOn",
                }
                v = icon_map.get(v, v)
              elif k in ["size", "color"]:
                # Skip properties not in basic catalog v0.9
                continue

            # Image specific handling
            if comp_type == "Image":
              if k in ["width", "height"]:
                continue

            new_comp[k] = v

        new_components.append(new_comp)

      new_msg["updateComponents"] = {
          "surfaceId": surface_id,
          "components": new_components,
      }

    elif "dataModelUpdate" in msg:
      dmu = msg["dataModelUpdate"]
      surface_id = dmu["surfaceId"]
      path = dmu.get("path", "/")

      # Simple transformation for now: convert contents array to object
      value_obj = {}
      for item in dmu.get("contents", []):
        key = item["key"]
        # Find the value key (valueString, valueNumber, etc.)
        val_key = next((k for k in item.keys() if k.startswith("value")), None)
        if val_key is None:
          continue
        val = item[val_key]

        # Recursive map conversion if needed
        if val_key == "valueMap":
          val = _convert_map(val)

        value_obj[key] = val

      new_msg["updateDataModel"] = {
          "surfaceId": surface_id,
          "path": path,
          "value": value_obj,
      }

    elif "deleteSurface" in msg:
      new_msg["deleteSurface"] = {"surfaceId": msg["deleteSurface"]["surfaceId"]}

    v09_data.append(new_msg)

  return v09_data


def process_file(src_file, dst_file, catalog_id):
  print(f"Migrating {src_file.name}...")
  with open(src_file, "r", encoding="utf-8") as f:
    v08_data = json.load(f)

  v09_data = migrate_v08_to_v09(v08_data, catalog_id=catalog_id)

  dst_file.parent.mkdir(parents=True, exist_ok=True)
  with open(dst_file, "w", encoding="utf-8") as f:
    json.dump(v09_data, f, indent=2)


def main():
  parser = argparse.ArgumentParser(description="Migrate A2UI v0.8 examples to v0.9")
  parser.add_argument("--src", required=True, help="Source file or directory")
  parser.add_argument("--dst", required=True, help="Destination file or directory")
  parser.add_argument(
      "--catalog_id",
      default=VERSION_0_9_CATALOG_ID,
      help="Catalog ID to use in v0.9",
  )

  args = parser.parse_args()

  src = Path(args.src)
  dst = Path(args.dst)

  if src.is_file():
    process_file(src, dst, args.catalog_id)
  elif src.is_dir():
    for json_file in src.glob("*.json"):
      process_file(json_file, dst / json_file.name, args.catalog_id)
  else:
    print(f"Error: {src} is not a file or directory")
    exit(1)

  print("Migration complete.")


if __name__ == "__main__":
  main()
