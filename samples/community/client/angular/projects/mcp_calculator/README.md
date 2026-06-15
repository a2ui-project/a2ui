# MCP Calculator

Sample application using the Chat-Canvas component with MCP Calculator Agent.

## Prerequisites

1. [nodejs](https://nodejs.org/en)
2. An endpoint hosting the MCP Calculator A2AService. ([Review the instructions on how to run MCP Calculator A2AService](../../../../agent/adk/mcp_app_proxy/README.md).)

## Running

1. Build the shared dependencies by running `yarn build` in the `renderers/web_core` directory
2. Install local dependencies: `yarn install`
3. Run the A2A server for all of the agents. ([Link to instructions](../../../../agent/adk/mcp_app_proxy/README.md))
4. Build the `sandbox.js` for testing MCP Apps in A2UI demo

- `yarn build:sandbox`

5. Run the app:

- `yarn start -- mcp_calculator`

6. Open http://localhost:4200/

## Usage

Once the application is running, open `http://localhost:4200/` in your browser. You will see the MCP Calculator interface.

### How to Use

You can perform calculations using standard operations. When computing the expression, there are two different "equals" buttons:

- **Local JavaScript Calculation (💻 =)**: Click this button to evaluate the expression immediately using standard JavaScript in the browser. The result will appear in the calculator display.
- **MCP Agent Tool Call Calculation (🤖 =)**: Click this button to dispatch a tool call to the MCP server. The local display will reset, and the calculation will be handled by the agent asynchronously (the result will appear in the chat conversation).

## Features

- **Client-side Tool Dispatching**: The application supports tool call requests from the MCP client bridge. It maps tool arguments to A2UI Action context and dispatches them to the host agent.
