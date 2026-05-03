# Codex-Only PTY Boundary

OpenCozy starts Codex commands in PTYs instead of exposing a general shell. This is a deliberate scope boundary: the phone UI is allowed to create `codex`, `codex resume`, and `codex resume --last` processes, while Codex itself remains responsible for project selection, resume flows, prompts, and conversation state.
