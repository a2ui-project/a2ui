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

"""Main file for creating and managing A2UI agents on Agent Engine."""

import json
import os

from a2a.types import AgentSkill
from agent import ContactAgent
import agent_executor
from dotenv import load_dotenv
from google.auth import default
from google.auth.transport.requests import Request
from google.genai import types
import httpx
import requests
import vertexai
from vertexai.preview.reasoning_engines import A2aAgent
from vertexai.preview.reasoning_engines.templates.a2a import create_agent_card


def _get_bearer_token():
  """Gets a bearer token for authenticating with Google Cloud."""
  try:
    credentials, _ = default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    request = Request()
    credentials.refresh(request)
    return credentials.token
  except Exception as e:  # pylint: disable=broad-except
    print(f"Error getting credentials: {e}")
    print(
        "Please ensure you have authenticated with 'gcloud auth "
        "application-default login'."
    )
  return None


def _register_agent_on_gemini_enterprise(
    project_id: str,
    app_id: str,
    agent_card: str,
    agent_name: str,
    display_name: str,
    description: str,
    agent_authorization: str | None = None,
):
  """Register an Agent Engine to Gemini Enterprise.

  Args:
      project_id: Google Cloud project id
      app_id: Gemini Enterprise application ID
      agent_card: Agent card definition
      agent_name: Name of the agent in Gemini Enterprise
      display_name: Display name for the agent in Gemini Enterprise
      description: Description of the agent
      agent_authorization: Agent authorization config

  Returns:
      dict: Response from Discovery Engine API
  """
  api_endpoint = (
      f"https://discoveryengine.googleapis.com/v1alpha/projects/{project_id}/"
      f"locations/global/collections/default_collection/engines/{app_id}/"
      "assistants/default_assistant/agents"
  )

  payload = {
      "name": agent_name,
      "displayName": display_name,
      "description": description,
      "a2aAgentDefinition": {"jsonAgentCard": agent_card},
  }

  if agent_authorization:
    payload["authorization_config"] = {"agent_authorization": agent_authorization}

  # Get access token
  bearer_token = _get_bearer_token()

  # Prepare headers
  headers = {
      "Authorization": f"Bearer {bearer_token}",
      "Content-Type": "application/json",
      "X-Goog-User-Project": project_id,
  }

  response = requests.post(api_endpoint, headers=headers, json=payload)

  if response.status_code == 200:
    print("✓ Agent registered successfully!")
    return response.json()
  print(f"✗ Registration failed with status code: {response.status_code}")
  print(f"Response: {response.text}")
  response.raise_for_status()


def main():

  project_id = os.environ.get("PROJECT_ID")
  location = os.environ.get("LOCATION")
  # STORAGE_BUCKET starts with gs://
  storage = os.environ.get("STORAGE_BUCKET")
  app_id = os.environ.get("GEMINI_ENTERPRISE_APP_ID")
  api_endpoint = f"{location}-aiplatform.googleapis.com"

  print("≈" * 120)

  vertexai.init(
      project=project_id,
      location=location,
      api_endpoint=api_endpoint,
      staging_bucket=storage,
  )

  print("✓ Vertex AI client initialized.")

  client = vertexai.Client(
      project=project_id,
      location=location,
      http_options=types.HttpOptions(
          api_version="v1beta1",
      ),
  )
  print("✓ Vertex AI client created.")

  agent_skill = AgentSkill(
      id="contact_card_agent",
      name="Contact Card Agent",
      description="A helpful assistant agent that can find contact cards.",
      tags=["Contact-Card"],
      examples=[
          "Who is John Doe?",
          "List all contact cards.",
      ],
  )

  cc_agent_card = create_agent_card(
      agent_name="Test Contact Card Agent",
      description="A helpful assistant agent that can find contact cards.",
      skills=[agent_skill],
      streaming=False,
      default_input_modes=["text/plain"],
      default_output_modes=["text/plain"],
  )

  base_url = "http://0.0.0.0:8080"
  contact_agent = ContactAgent(base_url=base_url)

  print(f"✓ Contact Card agent card created. {cc_agent_card}")

  a2ui_agent = A2aAgent(
      agent_card=cc_agent_card,
      agent_executor_builder=agent_executor.ContactAgentExecutor,
  )
  a2ui_agent.set_up()

  print("✓ Local Contact Card agent created.")

  config = {
      "display_name": "A2UI Contact Card Agent on Agent Engine",
      "description": (
          "A helpful assistant agent that uses A2UI to render contact cards."
      ),
      "agent_framework": "google-adk",
      "staging_bucket": storage,
      # or "gcs_dir_name": str(uuid.uuid4()) to avoid collisions.
      "gcs_dir_name": "dev",
      "requirements": [
          "google-cloud-aiplatform[agent_engines,adk]",
          "google-genai>=1.27.0",
          "python-dotenv>=1.1.0",
          "uvicorn",
          "a2a-sdk==0.3.25",
          "cloudpickle>=3.1.2",
          "pydantic",
          "jsonschema>=4.0.0",
          "a2ui-agent-sdk==0.1.2",
      ],
      "http_options": {
          "api_version": "v1beta1",
      },
      "max_instances": 1,
      "extra_packages": [
          "__init__.py",
          "agent_executor.py",
          "prompt_builder.py",
          "contact_data.json",
          "agent.py",
          "tools.py",
          "examples",
      ],
      "env_vars": {
          "NUM_WORKERS": "1",
      },
  }

  remote_agent = client.agent_engines.create(agent=a2ui_agent, config=config)

  remote_engine_resource = remote_agent.api_resource.name
  print(f"✓ Remote agent created. {remote_engine_resource}")

  a2a_endpoint = f"https://{api_endpoint}/v1beta1/{remote_engine_resource}/a2a/v1/card"
  bearer_token = _get_bearer_token()
  headers = {
      "Authorization": f"Bearer {bearer_token}",
      "Content-Type": "application/json",
  }

  print(f"✓ A2A endpoint: {a2a_endpoint}")

  response = httpx.get(a2a_endpoint, headers=headers)
  response.raise_for_status()
  a2ui_agent_card_json = response.json()
  # Add A2UI capabilities to the agent card.
  # Agent card for the agent deployed to Agent Engine does not support A2UI
  # extension yet. We need to add A2UI extension to the Gemini Enterprise agent
  # card.
  a2ui_agent_card_json["capabilities"] = {
      "streaming": False,
      "extensions": [{
          "uri": "https://a2ui.org/a2a-extension/a2ui/v0.8",
          "description": "Ability to render A2UI",
          "required": False,
          "params": {
              "supportedCatalogIds": [
                  "https://a2ui.org/specification/v0_8/standard_catalog_definition.json"
              ]
          },
      }],
  }
  a2ui_agent_card_str = json.dumps(a2ui_agent_card_json)

  print("✓ A2UI agent card fetched.")

  enterprise_agent = _register_agent_on_gemini_enterprise(
      project_id=project_id,
      app_id=app_id,
      agent_card=a2ui_agent_card_str,
      agent_name="a2ui_contact_card_agent",
      display_name="A2UI Contact Card Agent",
      description="A helpful assistant agent that uses A2UI to render contact cards.",
      agent_authorization=os.environ.get("AGENT_AUTHORIZATION"),
  )

  print(enterprise_agent)
  print("≈" * 120)


if __name__ == "__main__":
  load_dotenv()
  main()
