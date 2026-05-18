# Nathan's Unified AI Agent System

This repository contains the configuration and implementation details for Nathan's AI agent team, synchronized across multiple CLI tools: Claude Code, Gemini CLI, and Copilot CLI.

## System Architecture

The team is structured into four main domains:

1.  **Executive & Ops:** Jarvis (CEO), Friday (CTO), Nat (CBO), Sam (CSO), Scrooge (Finance), Threepio (Comms).
2.  **Engineering:** Vision (Architect), Wanda (Design), Ultron (Backend), Astra (Frontend), Pym (Database), Leo (DevOps).
3.  **Business:** Scout (Sales), Beth (Marketing).
4.  **Shared Discipline:** Shared engineering standards and 10-point discipline.

## CLI Implementation Paths

Each CLI has its own configuration folder with tailored agent definitions (models, triggers, and file path references):

*   **Claude Code:** `.claude/agents/`
*   **Gemini CLI:** `.gemini/agents/`
*   **Copilot CLI:** `.copilot/agents/`

## Synchronization

Claude Code serves as the source of truth for agent identities and roles. All updates to the system should first be implemented in the Claude configuration and then propagated to Gemini and Copilot configurations using the `sync_agents.ps1` script (or equivalent logic).

### Model Mappings

| Agent Class | Claude Model | Gemini Model | Copilot Model |
| :--- | :--- | :--- | :--- |
| **Reasoning / High** | Opus | gemini-3.1-pro-preview | GPT-5.2 |
| **Execution / Normal** | Sonnet / Haiku | gemini-3-flash-preview | GPT-4o |
| **Comms / Lite** | Haiku | gemini-3.1-flash-lite-preview | GPT-5 mini |

## Shared Discipline

All engineering agents follow a **10-Point Engineering Discipline** and the **4-D Methodology** (Deconstruct, Diagnose, Develop, Deliver). These standards are stored in the `shared/ENGINEERING-STANDARDS.md` file within each CLI's configuration.

## Usage

To use these agents, invoke them via their respective CLI triggers (e.g., `jarvis`, `friday`, or `skill jarvis` in Copilot).
