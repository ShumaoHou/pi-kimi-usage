export interface QuotaDetail {
  limit: number;
  used: number;
  remaining: number;
  resetTime?: string;
}

export interface RollingQuota extends QuotaDetail {
  label: string;
}

export interface CodingUsage {
  weekly?: QuotaDetail;
  rolling?: RollingQuota;
}

export interface PaygBalance {
  available: number;
  voucher?: number;
  cash?: number;
}

export interface BalanceSnapshot {
  coding?: CodingUsage;
  payg?: PaygBalance;
}

export interface DetailedSnapshot extends BalanceSnapshot {
  missing: string[];
  errors: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractStoredKimiKey(value: unknown, now = Date.now()): string | undefined {
  const store = asRecord(value);
  const credential = asRecord(store?.["kimi-coding"]);
  if (credential?.type === "api_key") {
    return typeof credential.key === "string" && credential.key ? credential.key : undefined;
  }
  if (credential?.type !== "oauth") return undefined;

  const expires = asFiniteNumber(credential.expires);
  if (expires === undefined || expires <= now) return undefined;
  return typeof credential.access === "string" && credential.access
    ? credential.access
    : undefined;
}

function parseQuotaDetail(value: unknown): QuotaDetail | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const limit = asFiniteNumber(record.limit);
  const used = asFiniteNumber(record.used);
  const remaining = asFiniteNumber(record.remaining);
  if (limit === undefined || used === undefined || remaining === undefined) return undefined;

  return {
    limit,
    used,
    remaining,
    ...(typeof record.resetTime === "string" ? { resetTime: record.resetTime } : {}),
  };
}

function rollingLabel(windowValue: unknown): string {
  const window = asRecord(windowValue);
  const duration = asFiniteNumber(window?.duration);
  const unit = window?.timeUnit;
  if (duration === 300 && unit === "TIME_UNIT_MINUTE") return "5h";
  if (duration !== undefined && typeof unit === "string") return `${duration}m`;
  return "rolling";
}

export function parseCodingUsage(value: unknown): CodingUsage {
  const record = asRecord(value);
  const weekly = parseQuotaDetail(record?.usage);
  const limits = Array.isArray(record?.limits) ? record.limits : [];
  const firstLimit = asRecord(limits[0]);
  const rollingDetail = parseQuotaDetail(firstLimit?.detail);
  const rolling = rollingDetail
    ? { ...rollingDetail, label: rollingLabel(firstLimit?.window) }
    : undefined;

  if (!weekly && !rolling) throw new Error("Kimi response contains no quota details");
  return { ...(weekly ? { weekly } : {}), ...(rolling ? { rolling } : {}) };
}

export function parsePaygBalance(value: unknown): PaygBalance {
  const root = asRecord(value);
  const data = asRecord(root?.data) ?? root;
  const available = asFiniteNumber(data?.available_balance);
  if (available === undefined) throw new Error("Moonshot response contains no available balance");

  const voucher = asFiniteNumber(data?.voucher_balance);
  const cash = asFiniteNumber(data?.cash_balance);
  return {
    available,
    ...(voucher !== undefined ? { voucher } : {}),
    ...(cash !== undefined ? { cash } : {}),
  };
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatProgress(remaining: number, limit: number): string {
  const ratio = limit > 0 ? Math.max(0, Math.min(remaining / limit, 1)) : 0;
  const percentage = Math.round(ratio * 100);
  const filled = Math.round(ratio * 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${percentage}%`;
}

function formatResetCountdown(resetTime: string | undefined, now: number): string | undefined {
  if (!resetTime) return undefined;

  const resetAt = Date.parse(resetTime);
  const remainingMs = resetAt - now;
  if (!Number.isFinite(resetAt) || remainingMs <= 0) return undefined;

  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function formatQuotaStatus(label: string, quota: QuotaDetail, now: number): string {
  const countdown = formatResetCountdown(quota.resetTime, now);
  return `${label} ${formatProgress(quota.remaining, quota.limit)}${countdown ? ` · ${countdown}` : ""}`;
}

export function formatCompactStatus(snapshot: BalanceSnapshot, now = Date.now()): string {
  const parts: string[] = [];
  if (snapshot.coding?.rolling) {
    parts.push(formatQuotaStatus(snapshot.coding.rolling.label, snapshot.coding.rolling, now));
  }
  if (snapshot.coding?.weekly) {
    parts.push(formatQuotaStatus("week", snapshot.coding.weekly, now));
  }
  if (snapshot.payg) parts.push(`CNY ${snapshot.payg.available.toFixed(2)}`);
  return parts.length > 0 ? `Kimi ${parts.join(" | ")}` : "Kimi quota unavailable";
}

function resetSuffix(resetTime?: string): string {
  return resetTime ? ` (resets ${resetTime})` : "";
}

export function formatDetailedStatus(snapshot: DetailedSnapshot): string {
  const lines: string[] = [];
  if (snapshot.coding?.rolling) {
    const quota = snapshot.coding.rolling;
    lines.push(
      `Kimi Coding ${quota.label}: ${formatAmount(quota.remaining)}/${formatAmount(quota.limit)} remaining${resetSuffix(quota.resetTime)}`,
    );
  }
  if (snapshot.coding?.weekly) {
    const quota = snapshot.coding.weekly;
    lines.push(
      `Kimi Coding week: ${formatAmount(quota.remaining)}/${formatAmount(quota.limit)} remaining${resetSuffix(quota.resetTime)}`,
    );
  }
  if (snapshot.payg) lines.push(`Moonshot PAYG: CNY ${snapshot.payg.available.toFixed(2)}`);
  for (const credential of snapshot.missing) lines.push(`Missing credential: ${credential}`);
  lines.push(...snapshot.errors);
  return lines.length > 0 ? lines.join("\n") : "No Kimi quota or balance data available";
}
