export type ShortcutProtocol = "http" | "https";

export type AppShortcut = {
  id: string;
  name: string;
  protocol: ShortcutProtocol;
  host: string;
  port: number;
  path: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type AppShortcutInput = {
  name: string;
  protocol: ShortcutProtocol;
  host: string;
  port: number;
  path: string;
};

export type OpenCozySessionMode = "new" | "resume" | "resumeLast";

export type OpenCozySessionSummary = {
  id: string;
  name: string;
  mode: OpenCozySessionMode;
  command: string;
  args: string[];
  cwd: string;
  status: "running" | "exited";
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
};
