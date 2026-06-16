# MCP Host Application Component

This directory contains the core application components for the MCP (Model Context Protocol) Host Application.

## Overview

This application acts as a host container for Model Context Protocol (MCP) Applications. Its primary purpose is to demonstrate how to securely isolate and host untrusted third-party Angular components (Micro-Apps or A2UI components) served by an MCP server, without needing direct awareness of the app's internal UI logic. It adheres strictly to standard isolation sandbox container expectations, introducing no additional unique or custom hosting mechanisms.

## Key Features

- **Security Isolation**: Implements a secure **double-iframe proxy pattern** to isolation-test untrusted components, preventing security leaks while maintaining functionality.
- **Host Container**: Acts as the main container for the outer safe iframe.
- **Tool & Message Passthrough**: Operates as a communication bridge, routing custom tools and layout messages between the isolated iframe and the database/MCP server.
- **UI-Agnostic Isolation Infrastructure**: Holds zero A2UI or app-specific rendering knowledge; it solely manages the infrastructure frames necessary for the isolation sandbox.

## Architecture Context

- **Client (This app)**: The Angular host container.
- **Server**: Python-based MCP server providing tools and micro-app resources.
- **Isolated Micro-Apps**: Served by the server and rendered inside this host.
