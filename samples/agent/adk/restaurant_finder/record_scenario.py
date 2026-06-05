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

import asyncio
import json
import logging
import os
import shutil
from agent import RestaurantAgent
from a2ui.schema.constants import VERSION_0_8

logging.basicConfig(level=logging.INFO)


def save_messages_with_image_copies(messages: list, image_base_url: str, out_path: str):
  """
  Saves the A2UI messages payload to the composer tools directory, copies any
  local agent images to the composer's public assets folder, and rewrites the
  JSON payload URLs to use the new public Next.js paths.
  """
  agent_dir = os.path.basename(os.path.abspath("."))
  src_images = "images"
  dest_images = f"../../../../tools/composer/public/images/{agent_dir}"

  # Copy images if they exist
  if os.path.exists(src_images):
    os.makedirs(dest_images, exist_ok=True)
    for file in os.listdir(src_images):
      src_path = os.path.join(src_images, file)
      dest_path = os.path.join(dest_images, file)
      if os.path.isfile(src_path):
        if os.path.exists(dest_path):
          print(f"Skipping {file}, already exists in {dest_images}")
          continue
        shutil.copy2(src_path, dest_images)
    print(f"Copied new images from {src_images} to {dest_images}")

  # Update JSON payload to use the new public asset paths
  json_str = json.dumps(messages, indent=2)
  # We replace the local serving url with the Next.js public URL
  json_str = json_str.replace(image_base_url, f"/images/{agent_dir}/")

  with open(out_path, "w") as f:
    f.write(json_str)
  print(f"Recorded {len(messages)} A2UI message parts to {out_path}")


def extract_restaurant_details(messages):
  """
  Extracts restaurant details (name, address, imageUrl) from A2UI messages.
  Supports both v0.8 (dataModelUpdate) and v0.9 (updateDataModel) formats.
  """
  for msg in reversed(messages):  # Check most recent updates first
    # --- Handle v0.8 (dataModelUpdate) ---
    if "dataModelUpdate" in msg:
      dm = msg["dataModelUpdate"]
      contents = dm.get("contents", [])
      # Some v0.8 implementations might have contents as a dict or list
      if isinstance(contents, list):
        for entry in contents:
          if entry.get("key") == "items" and "valueMap" in entry:
            items = entry["valueMap"]
            for item_entry in items:
              if "valueMap" in item_entry:
                sub_vmap = item_entry["valueMap"]
                details = {}
                for det in sub_vmap:
                  k = det.get("key")
                  # Handle various value field names
                  v = (
                      det.get("valueString")
                      or det.get("value")
                      or det.get("valueNumber")
                  )
                  if k:
                    details[k] = v
                if details.get("name"):
                  return details
      elif isinstance(contents, dict) and "items" in contents:
        # Handle flattened v0.8 contents if applicable
        items = contents["items"]
        if isinstance(items, list) and items:
          return items[0]

    # --- Handle v0.9 (updateDataModel) ---
    if "updateDataModel" in msg:
      udm = msg["updateDataModel"]
      if isinstance(udm, dict) and "items" in udm:
        items = udm["items"]
        first_item = None
        if isinstance(items, list) and items:
          first_item = items[0]
        elif isinstance(items, dict) and items:
          # Handle keyed items dict
          first_item = next(iter(items.values()), None)

        if first_item and isinstance(first_item, dict) and first_item.get("name"):
          return first_item

  return None


async def record_query(agent, query, session_id, ui_version):
  """
  Runs a query through the agent and collects all A2UI messages.
  """
  messages = []
  print(f"Running agent with query: {query}")
  async for event in agent.stream(query, session_id, ui_version):
    parts = event.get("parts", [])
    for p in parts:
      if p.root.metadata and p.root.metadata.get("mimeType") in (
          "application/a2ui+json",
          "application/json+a2ui",
      ):
        if isinstance(p.root.data, list):
          messages.extend(p.root.data)
        else:
          messages.append(p.root.data)
  return messages


async def main():
  base_url = "http://localhost:10007"
  ui_version = VERSION_0_8
  agent = RestaurantAgent(base_url=base_url)
  session_id = "test_session_3"
  image_base_url = f"{base_url}/static/"
  dojo_data_dir = "../../../../tools/composer/src/data/dojo"

  # 1. Search Query
  search_query = "Find me Szechuan restaurants in New York"
  search_messages = await record_query(agent, search_query, session_id, ui_version)
  if search_messages:
    search_out_path = os.path.join(dojo_data_dir, "restaurant-finder.json")
    save_messages_with_image_copies(search_messages, image_base_url, search_out_path)

    # Extract data for next queries
    first_restaurant = extract_restaurant_details(search_messages)
    if first_restaurant:
      restaurant_name = first_restaurant.get("name", "Unknown Restaurant")
      address = first_restaurant.get("address", "Unknown Address")
      image_url = first_restaurant.get("imageUrl", "")

      print(
          f"Extracted details: Name='{restaurant_name}', Address='{address}',"
          f" ImageURL='{image_url}'"
      )

      # 2. Booking Query
      booking_query = (
          f"USER_WANTS_TO_BOOK: {restaurant_name}, Address: {address}, ImageURL:"
          f" {image_url}"
      )
      booking_messages = await record_query(
          agent, booking_query, session_id, ui_version
      )
      if booking_messages:
        booking_out_path = os.path.join(dojo_data_dir, "restaurant-booking.json")
        save_messages_with_image_copies(
            booking_messages, image_base_url, booking_out_path
        )

      # 3. Confirmation Query
      party_size = 4
      reservation_time = "7:00 PM today"
      dietary_reqs = "none"
      confirmation_query = (
          f"User submitted a booking for {restaurant_name} for {party_size} people at"
          f" {reservation_time} with dietary requirements: {dietary_reqs}. The image"
          f"URL is {image_url}"
      )
      confirmation_messages = await record_query(
          agent, confirmation_query, session_id, ui_version
      )
      if confirmation_messages:
        confirmation_out_path = os.path.join(
            dojo_data_dir, "restaurant-confirmation.json"
        )
        save_messages_with_image_copies(
            confirmation_messages, image_base_url, confirmation_out_path
        )
    else:
      print("Could not extract restaurant details for subsequent queries.")
  else:
    print("No A2UI messages produced for initial query.")


if __name__ == "__main__":
  asyncio.run(main())
