export type WhatsAppMessenger = {
  sendMessage(message: string): Promise<{ messageId: string | null }>;
};

export function createConfiguredHermesWhatsAppMessenger(): WhatsAppMessenger {
  const chatId = process.env.LITEHARNESS_WHATSAPP_CHAT_ID?.trim();
  if (!chatId) {
    return failingMessenger(
      "WhatsApp owner chat is not configured. Set LITEHARNESS_WHATSAPP_CHAT_ID and restart Opencozy.",
    );
  }
  const bridgePort = Number(process.env.LITEHARNESS_WHATSAPP_BRIDGE_PORT?.trim() || "3000");
  try {
    return createHermesWhatsAppMessenger({ bridgePort, chatId });
  } catch (error) {
    return failingMessenger(error instanceof Error ? error.message : String(error));
  }
}

export function createHermesWhatsAppMessenger(input: {
  bridgePort: number;
  chatId: string;
}): WhatsAppMessenger {
  const bridgePort = input.bridgePort;
  const chatId = input.chatId.trim();
  if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65_535) {
    throw new Error("WhatsApp bridge port must be between 1 and 65535");
  }
  if (!chatId) {
    throw new Error("WhatsApp owner chat is not configured");
  }
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;

  return {
    async sendMessage(message) {
      let healthResponse: Response;
      try {
        healthResponse = await fetch(`${bridgeUrl}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
      } catch {
        throw whatsAppOfflineError("unreachable");
      }
      const health = readRecord(await healthResponse.json().catch(() => null));
      const healthStatus = readString(health?.status) ?? `HTTP ${healthResponse.status}`;
      if (!healthResponse.ok || healthStatus !== "connected") {
        throw whatsAppOfflineError(healthStatus);
      }

      const response = await fetch(`${bridgeUrl}/send`, {
        body: JSON.stringify({ chatId, message }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const detail = (await response.text())
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500);
        throw new Error(`WhatsApp send failed (${response.status})${detail ? `: ${detail}` : ""}`);
      }
      const result = readRecord(await response.json());
      return {
        messageId: readString(result?.messageId),
      };
    },
  };
}

function failingMessenger(message: string): WhatsAppMessenger {
  return {
    async sendMessage() {
      throw new Error(message);
    },
  };
}

function whatsAppOfflineError(status: string): Error {
  return new Error(
    `Hermes WhatsApp bridge is offline (status: ${status}). Run "hermes whatsapp" to pair or reconnect it.`,
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
