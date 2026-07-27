# User Guide: Deploying an A2UI Agent to Cloud Run, Registering with Gemini Enterprise and Interacting with the Agent using A2UI components

This guide provides a comprehensive walkthrough of deploying an A2A
(Agent-to-Agent) enabled agent with **A2UI** extension, built with the Google
**Agent Development Kit (ADK)**, to Google **Cloud Run**. You can interact with
the agent by rich content A2UI components. You will also learn how to register
your deployed agent with Gemini Enterprise to make it discoverable and usable by
other agents.

## Introduction

This project provides a template for creating and deploying a powerful,
Gemini-based agent that can communicate with users with A2UI components. By the
end of this guide, you will have an agent running on Cloud Run and can display
A2UI components on Gemini Enterprise UI.

## Prerequisites

Before running the deployment script, ensure you have the following:

- A **Google Cloud Project** with billing enabled.
- **Google Cloud SDK** installed and up to date.

### Authentication

Authenticate with Google Cloud by running the following commands:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <YOUR_PROJECT_ID>
```

### Enable Required APIs

Enable the required Google Cloud APIs for Cloud Run, Cloud Build, Vertex AI, and Discovery Engine:

```bash
gcloud services enable \
run.googleapis.com \
cloudbuild.googleapis.com \
aiplatform.googleapis.com \
discoveryengine.googleapis.com \
--project <YOUR_PROJECT_ID>
```

## Steps

There are 2 steps:

1.  **Deployment**: Deploy an A2UI agent to Google Cloud Run from source code.
2.  **Registration**: Register the deploy agent in Gemini Enterprise.

## Deployment

The `deploy.sh` script automates the deployment process. To deploy your agent,
navigate to this directory and run the script with your Google Cloud Project ID
and a name for your new service. You can also optionally specify the Gemini
model to use.

```bash
chmod +x deploy.sh
./deploy.sh <YOUR_PROJECT_ID> <YOUR_SERVICE_NAME> [MODEL_NAME]
```

- `MODEL_NAME`: Optional. Can be `gemini-2.5-pro` or `gemini-2.5-flash`.
  Defaults to `gemini-2.5-flash` if not specified.

For example:

```bash
# Deploy with the default gemini-2.5-flash model
./deploy.sh  my-gcp-project my-gemini-agent

# Deploy with the gemini-2.5-pro model
./deploy.sh  my-gcp-project my-gemini-agent gemini-2.5-pro
```

The script will:

1.  **Build a container image** from your source code.
2.  **Push the image** to the Google Container Registry.
3.  **Deploy the image** to Cloud Run.
4.  **Set environment variables**, including the `MODEL` and the public
    `AGENT_URL` of the service itself.

Once the script completes, it will print the service URL of your deployed agent.
You will need the **Service URL** in the next step.

## Registration in Gemini Enterprise

Now that your agent is deployed, you need to register it with Gemini Enterprise
to make it discoverable. This is done programmatically using the Discovery
Engine API.

**1. Get your Gemini Enterprise App ID:**

You can create or find an existing Gemini Enterprise App ID in the Google Cloud
Console.

**2. Register the agent:**

Set your environment variables and execute the following commands to create the payload file and register the agent:

```bash
# Set your variables
PROJECT_NUMBER="TODO" # Your Google Cloud project number.
LOCATION="global" # The location of your Discovery Engine instance
GEMINI_ENTERPRISE_APP_ID="TODO" # The ID of your Gemini Enterprise engine (a.k.a App ID).
AGENT_NAME="A2UI Contact Demo Agent" # A unique name for your agent.
AGENT_DISPLAY_NAME="A2UI Contact Demo Agent" # The name that will be displayed in the Gemini Enterprise UI.
AGENT_DESCRIPTION="A demo agent that uses A2UI components to display rich contact content."
AGENT_URL="TODO" # The service URL of your deployed agent which was printed in the previous step.

# Create the add agent payload
cat <<EOF > agent_request.json
{
  "name": "$AGENT_NAME",
  "displayName": "$AGENT_DISPLAY_NAME",
  "description": "$AGENT_DESCRIPTION",
  "a2aAgentDefinition": {
     "jsonAgentCard": "{\"protocolVersion\": \"0.3.0\", \"name\": \"$AGENT_NAME\", \"description\": \"$AGENT_DESCRIPTION\", \"url\": \"$AGENT_URL\", \"version\": \"1.0.0\", \"capabilities\": {\"streaming\": false, \"preferredTransport\": \"JSONRPC\", \"extensions\": [{\"uri\": \"https://a2ui.org/a2a-extension/a2ui/v0.8\", \"description\": \"Ability to render A2UI\", \"required\": false, \"params\": {\"supportedCatalogIds\": [\"https://a2ui.org/specification/v0_8/standard_catalog_definition.json\"]}}]}, \"skills\": [], \"defaultInputModes\": [\"text\", \"text/plain\"], \"defaultOutputModes\": [\"text\", \"text/plain\"]}"
  }
}
EOF

# Send the request
curl -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json" \
     https://discoveryengine.googleapis.com/v1alpha/projects/$PROJECT_NUMBER/locations/$LOCATION/collections/default_collection/engines/$GEMINI_ENTERPRISE_APP_ID/assistants/default_assistant/agents \
     -d @agent_request.json
```

**Placeholder Descriptions:**

- `PROJECT_NUMBER`: Your Google Cloud project number.
- `LOCATION`: The location of your Discovery Engine instance (e.g., `global`).
- `ENGINE_ID`: The ID of your Gemini Enterprise engine (a.k.a App ID).
- `AGENT_NAME`: A unique name for your agent.
- `AGENT_DISPLAY_NAME`: The name that will be displayed in the Gemini
  Enterprise UI.
- `AGENT_DESCRIPTION`: A brief description of your agent's capabilities.
- `AGENT_URL`: The service URL of your deployed agent which was printed in the
  previous step.

**3. Locate the agent on the Gemini Enterprise UI:**

Your agent can be found in the Gemini Enterprise UI. You can click the 3-dots
button and select "Preview" to interact with the agent. Send queries like "Find
Alex contact card", or "List all contacts" and you will see A2UI components
being rendered.

### IAM Support for Agents Running on Cloud Run

When the agent is deployed on Cloud Run (when the `AGENT_URL` ends with
"run.app"), Gemini Enterprise attempts IAM authentication when talking to the
agent. For this to work, you should grant the "Cloud Run Invoker" role to the
following principal in the project where Cloud Run is running:

`service-PROJECT_NUMBER@gcp-sa-discoveryengine.iam.gserviceaccount.com`

### Unregistering the Agent (Optional)

The following command can be used to unregister the agent:

```bash
curl -X DELETE -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" https://discoveryengine.googleapis.com/v1alpha/projects/PROJECT_NUMBER/locations/LOCATION/collections/default_collection/engines/ENGINE_ID/assistants/default_assistant/agents/AGENT_ID
```

## Conclusion

Congratulations! You have successfully deployed an A2A-enabled agent with A2UI
capacity to Cloud Run and registered it with Gemini Enterprise. Your agent is
now ready to interact with other agents in the A2A ecosystem. You can further
customize your agent by adding more tools, refining its system instructions, and
enhancing its capabilities.
