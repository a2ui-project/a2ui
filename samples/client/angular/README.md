# Angular A2UI

These are sample implementations of A2UI in Angular.

## Prerequisites

1. [nodejs](https://nodejs.org/en)
2. [uv](https://docs.astral.sh/uv/getting-started/installation/)

## Running

The restaurant app has two parts that run separately: the **agent backend** (a Python A2A server) and the **Angular frontend**.

1. **Install and build dependencies.** From the repository root:

   ```bash
   yarn install
   yarn build:all
   ```

2. **Set up your Gemini API key:**

   ```bash
   cd samples/client/angular
   cp ../../agent/adk/restaurant_finder/.env.example ../../agent/adk/restaurant_finder/.env
   # Edit the .env file with your actual API key (.env is gitignored for security reasons)
   ```

3. **Start the servers in two separate terminals**:

   - Agent backend — the Restaurant Finder agent, serves on `http://localhost:10002`:

     ```bash
     cd samples/agent/adk/restaurant_finder
     uv run .
     ```

   - Angular frontend — serves on `http://localhost:4200`:

     ```bash
     cd samples/client/angular
     yarn start restaurant
     ```

Then open the URL shown in the frontend output (typically http://localhost:4200).

## Streaming

By default, the Angular client uses the streaming API to communicate with the agent. To disable streaming, set the `ENABLE_STREAMING` environment variable to `false`.

```bash
export ENABLE_STREAMING=false
yarn start restaurant
```

## Security Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.
