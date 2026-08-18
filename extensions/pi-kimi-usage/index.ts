import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  extractStoredKimiKey,
  formatCompactStatus,
  formatDetailedStatus,
  parseCodingUsage,
  parsePaygBalance,
  type BalanceSnapshot,
  type DetailedSnapshot,
} from "./core.ts";

const STATUS_ID = "pi-kimi-usage";
const KIMI_PROVIDER = "kimi-coding";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STATUS_UPDATE_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const CODING_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const PAYG_BALANCE_URL = "https://api.moonshot.cn/v1/users/me/balance";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "pi-kimi-usage/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function readStoredKimiKey(): Promise<string | undefined> {
  try {
    const authPath = join(homedir(), ".pi", "agent", "auth.json");
    const authStore = JSON.parse(await readFile(authPath, "utf8")) as unknown;
    return extractStoredKimiKey(authStore);
  } catch {
    return undefined;
  }
}

async function resolveCodingKey(ctx: ExtensionContext): Promise<string | undefined> {
  const providerAuth = await ctx.modelRegistry.getProviderAuth(KIMI_PROVIDER);
  return providerAuth?.auth.apiKey || process.env.KIMI_API_KEY || readStoredKimiKey();
}

export default function kimiBalanceExtension(pi: ExtensionAPI) {
  let active = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<DetailedSnapshot> | undefined;
  let lastSnapshot: BalanceSnapshot = {};

  const clearTimers = () => {
    if (timer) clearInterval(timer);
    if (statusTimer) clearInterval(statusTimer);
    timer = undefined;
    statusTimer = undefined;
  };

  const renderStatus = (ctx: ExtensionContext, loading = false) => {
    if (!active || ctx.model?.provider !== KIMI_PROVIDER) return;
    const text = loading ? "Kimi loading..." : formatCompactStatus(lastSnapshot);
    ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", text));
  };

  const performRefresh = async (ctx: ExtensionContext): Promise<DetailedSnapshot> => {
    const missing: string[] = [];
    const errors: string[] = [];
    const next: BalanceSnapshot = { ...lastSnapshot };

    let codingKey: string | undefined;
    try {
      codingKey = await resolveCodingKey(ctx);
    } catch (error) {
      errors.push(`Kimi Coding auth: ${errorMessage(error)}`);
    }

    const paygKey = process.env.MOONSHOT_API_KEY;
    if (!codingKey) {
      missing.push("KIMI_API_KEY");
      delete next.coding;
    }
    if (!paygKey) {
      missing.push("MOONSHOT_API_KEY");
      delete next.payg;
    }

    const requests: Promise<void>[] = [];
    if (codingKey) {
      requests.push(
        fetchJson(CODING_USAGE_URL, codingKey)
          .then((payload) => {
            next.coding = parseCodingUsage(payload);
          })
          .catch((error) => {
            errors.push(`Kimi Coding: ${errorMessage(error)}`);
          }),
      );
    }
    if (paygKey) {
      requests.push(
        fetchJson(PAYG_BALANCE_URL, paygKey)
          .then((payload) => {
            next.payg = parsePaygBalance(payload);
          })
          .catch((error) => {
            errors.push(`Moonshot PAYG: ${errorMessage(error)}`);
          }),
      );
    }

    await Promise.all(requests);
    lastSnapshot = next;
    renderStatus(ctx);
    return { ...lastSnapshot, missing, errors };
  };

  const refresh = (ctx: ExtensionContext): Promise<DetailedSnapshot> => {
    if (!inFlight) {
      inFlight = performRefresh(ctx).finally(() => {
        inFlight = undefined;
      });
    }
    return inFlight;
  };

  const deactivate = (ctx: ExtensionContext) => {
    active = false;
    clearTimers();
    ctx.ui.setStatus(STATUS_ID, undefined);
  };

  const activate = async (ctx: ExtensionContext) => {
    active = true;
    clearTimers();
    renderStatus(ctx, Object.keys(lastSnapshot).length === 0);
    await refresh(ctx);
    if (!active || ctx.model?.provider !== KIMI_PROVIDER) return;
    timer = setInterval(() => {
      void refresh(ctx);
    }, REFRESH_INTERVAL_MS);
    statusTimer = setInterval(() => {
      renderStatus(ctx);
    }, STATUS_UPDATE_INTERVAL_MS);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.model?.provider === KIMI_PROVIDER) await activate(ctx);
    else deactivate(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.model.provider === KIMI_PROVIDER) await activate(ctx);
    else deactivate(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    deactivate(ctx);
  });

  pi.registerCommand("kimi-usage", {
    description: "Refresh and show Kimi Coding quota and Moonshot PAYG balance",
    handler: async (_args, ctx) => {
      const snapshot = await refresh(ctx);
      const hasErrors = snapshot.errors.length > 0;
      ctx.ui.notify(formatDetailedStatus(snapshot), hasErrors ? "warning" : "info");
    },
  });
}
