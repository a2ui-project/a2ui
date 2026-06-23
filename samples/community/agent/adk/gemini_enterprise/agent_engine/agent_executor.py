# Copyright 2025 Google LLC
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


from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    DataPart,
    Part,
    Task,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import (
    new_agent_parts_message,
    new_task,
)
from a2a.utils.errors import ServerError
from a2ui.a2a import try_activate_a2ui_extension
from a2ui.core.schema.constants import VERSION_0_8
from agent import ContactAgent


class ContactAgentExecutor(AgentExecutor):
  """Contact AgentExecutor Example."""

  def __init__(self, base_url: str = "http://0.0.0.0:8080"):
    self._agent = ContactAgent(base_url)

  async def execute(
      self,
      context: RequestContext,
      event_queue: EventQueue,
  ) -> None:
    query = ""
    ui_event_part = None
    action = None

    print(f"--- Client requested extensions: {context.requested_extensions} ---")
    print(f"--- Agent card: {self._agent.agent_card} ---")
    # active_ui_version = try_activate_a2ui_extension(
    #     context, self._agent.agent_card
    # )
    # Hardcoded for now to test the UI flow.
    active_ui_version = VERSION_0_8

    if active_ui_version:
      print(
          "--- AGENT_EXECUTOR: A2UI extension is active"
          f" (v{active_ui_version}). Using UI runner. ---"
      )
    else:
      print("--- AGENT_EXECUTOR: A2UI extension is not active. Using text runner. ---")

    if context.message and context.message.parts:
      print(
          f"--- AGENT_EXECUTOR: Processing {len(context.message.parts)} message"
          " parts ---"
      )
      for i, part in enumerate(context.message.parts):
        if isinstance(part.root, DataPart):
          if "userAction" in part.root.data:
            print(f"  Part {i}: Found a2ui UI ClientEvent payload.")
            ui_event_part = part.root.data["userAction"]
          else:
            print(f"  Part {i}: DataPart (data: {part.root.data})")
        elif isinstance(part.root, TextPart):
          print(f"  Part {i}: TextPart (text: {part.root.text})")
        else:
          print(f"  Part {i}: Unknown part type ({type(part.root)})")

    if ui_event_part:
      print(f"Received a2ui ClientEvent: {ui_event_part}")
      # Fix: Check both 'actionName' and 'name'
      action = ui_event_part.get("name")
      ctx = ui_event_part.get("context", {})

      if action == "view_profile":
        contact_name = ctx.get("contactName", "Unknown")
        department = ctx.get("department", "")
        query = f"WHO_IS: {contact_name} from {department}"

      elif action == "send_email":
        contact_name = ctx.get("contactName", "Unknown")
        email = ctx.get("email", "Unknown")
        query = f"USER_WANTS_TO_EMAIL: {contact_name} at {email}"

      elif action == "send_message":
        contact_name = ctx.get("contactName", "Unknown")
        query = f"USER_WANTS_TO_MESSAGE: {contact_name}"

      elif action == "follow_contact":
        query = "ACTION: follow_contact"

      elif action == "view_full_profile":
        contact_name = ctx.get("contactName", "Unknown")
        query = f"USER_WANTS_FULL_PROFILE: {contact_name}"

      else:
        query = f"User submitted an event: {action} with data: {ctx}"
    else:
      print("No a2ui UI event part found. Falling back to text input.")
      query = context.get_user_input()

    print(f"--- AGENT_EXECUTOR: Final query for LLM: '{query}' ---")

    task = context.current_task

    if not task:
      task = new_task(context.message)
      await event_queue.enqueue_event(task)

    updater = TaskUpdater(event_queue, task.id, task.context_id)

    await updater.start_work()

    final_parts = await self._agent.fetch_response(
        query, task.context_id, active_ui_version
    )
    self._log_parts(final_parts)

    await updater.add_artifact(final_parts, name="response")
    await updater.complete()

  async def cancel(
      self, request: RequestContext, event_queue: EventQueue
  ) -> Task | None:
    raise ServerError(error=UnsupportedOperationError())

  def _log_parts(self, parts: list[Part]):
    print("--- PARTS TO BE SENT ---")
    for i, part in enumerate(parts):
      print(f"  - Part {i}: Type = {type(part.root)}")
      if isinstance(part.root, TextPart):
        print(f"    - Text: {part.root.text[:200]}...")
      elif isinstance(part.root, DataPart):
        print(f"    - Data: {str(part.root.data)[:200]}...")
    print("-----------------------------")
