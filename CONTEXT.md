# OpenCozy

OpenCozy is a LAN-hosted PWA for using Codex from an iPhone while Codex runs on a separate computer on the same local network. It exists to provide a mobile interface to Codex without turning into a general-purpose remote shell.

## Language

**Codex Host**:
The LAN computer that runs the OpenCozy backend and starts Codex processes.
_Avoid_: server, remote machine

**OpenCozy Session**:
An active PTY process started by OpenCozy to run Codex and stream terminal I/O to the PWA.
_Avoid_: shell session, terminal session

**Codex Session**:
A conversation recorded and resumed by the Codex CLI itself.
_Avoid_: OpenCozy session

**Resume Picker**:
The interactive `codex resume` UI owned by the Codex CLI.
_Avoid_: session manager

**LAN App Shortcut**:
A saved link to another app running on the Codex Host or the same LAN.
_Avoid_: discovered app, deployment

## Relationships

- A **Codex Host** runs zero or more **OpenCozy Sessions**.
- An **OpenCozy Session** runs exactly one Codex CLI process.
- A **Codex Session** belongs to Codex, not OpenCozy.
- A **LAN App Shortcut** stores enough address information for the PWA to open one LAN app.

## Example dialogue

> **Dev:** "Should OpenCozy show every old Codex conversation?"
> **Domain expert:** "Only if Codex exposes a stable list. Otherwise OpenCozy should start the Resume Picker and let Codex own that choice."

## Flagged ambiguities

- "session" can mean **OpenCozy Session** or **Codex Session**. OpenCozy owns active PTY processes; Codex owns conversation history.
- "terminal" does not mean a general shell. OpenCozy starts Codex commands only.
