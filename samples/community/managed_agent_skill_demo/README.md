# A2UI Managed Agent Skill Demo

This sample demonstrates how to generate A2UI skills dynamically for managed agent architectures (Google Gemini / Managed Agent API), provision system instructions, parse and validate response streams server-side, and render interactive UI.

---

## **Architecture Overview**

```
 ┌─────────────────────────────────────────────────────────────┐
 │ 1. Skill Compilation                                       │
 │    Component Catalog JSON + Express Format                  │
 │    => generate_skill() => SKILL.md                          │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 2. Managed Agent Provisioning (Google Gemini API)           │
 │    system_instruction = SKILL.md                            │
 │    Client prompt => Gemini Sandbox => Express DSL Output    │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 3. Server Interception & Validation                         │
 │    ExpressParser.compile(agent_output)                      │
 │    => Validated A2UI JSON Messages                          │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 4. Web Client Rendering                                     │
 │    Renders interactive A2UI components in browser           │
 └─────────────────────────────────────────────────────────────┘
```

---

## **How to Run**

### **1. Dry Run Mode (Offline Skill Generation & System Prompt Inspection)**

To test skill generation and inspect the generated system instructions without invoking the Gemini API:

```bash
python server.py --dry-run
```

### **2. Managed Agent Query Mode**

Export your Gemini API Key and run a single prompt turn:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
python server.py --prompt "Show me a form with an email input and a submit button."
```

### **3. Interactive Web Server Mode**

Launch the local web server to interactively prompt the managed agent and view validated A2UI JSON responses:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
python server.py --serve --port 8080
```

Open `http://localhost:8080` in your web browser.
