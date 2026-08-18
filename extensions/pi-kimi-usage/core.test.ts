import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompactStatus,
  formatDetailedStatus,
  parseCodingUsage,
  parsePaygBalance,
  extractStoredKimiKey,
} from "./core.ts";

const codingFixture = {
  usage: {
    limit: "2048",
    used: "214",
    remaining: "1834",
    resetTime: "2026-01-09T15:23:13.716839300Z",
  },
  limits: [
    {
      window: {
        duration: 300,
        timeUnit: "TIME_UNIT_MINUTE",
      },
      detail: {
        limit: "200",
        used: "139",
        remaining: "61",
        resetTime: "2026-01-06T13:33:02.717479433Z",
      },
    },
  ],
};

test("parseCodingUsage extracts weekly and five-hour remaining quota", () => {
  assert.deepEqual(parseCodingUsage(codingFixture), {
    weekly: {
      limit: 2048,
      used: 214,
      remaining: 1834,
      resetTime: "2026-01-09T15:23:13.716839300Z",
    },
    rolling: {
      label: "5h",
      limit: 200,
      used: 139,
      remaining: 61,
      resetTime: "2026-01-06T13:33:02.717479433Z",
    },
  });
});

test("parseCodingUsage rejects a response without quota details", () => {
  assert.throws(() => parseCodingUsage({ usage: {} }), /quota/i);
});

test("parsePaygBalance accepts the documented nested balance response", () => {
  assert.deepEqual(
    parsePaygBalance({
      data: {
        available_balance: "23.48",
        voucher_balance: 10,
        cash_balance: "13.48",
      },
    }),
    {
      available: 23.48,
      voucher: 10,
      cash: 13.48,
    },
  );
});

test("parsePaygBalance rejects a response without an available balance", () => {
  assert.throws(() => parsePaygBalance({ data: {} }), /balance/i);
});

test("extractStoredKimiKey accepts current OAuth access and rejects expired access", () => {
  const now = 1_700_000_000_000;
  assert.equal(
    extractStoredKimiKey(
      { "kimi-coding": { type: "oauth", access: "oauth-access", expires: now + 60_000 } },
      now,
    ),
    "oauth-access",
  );
  assert.equal(
    extractStoredKimiKey(
      { "kimi-coding": { type: "oauth", access: "expired-access", expires: now - 1 } },
      now,
    ),
    undefined,
  );
  assert.equal(
    extractStoredKimiKey({ "kimi-coding": { type: "api_key", key: "api-key" } }, now),
    "api-key",
  );
});

test("formatCompactStatus includes only available quota and balance values", () => {
  const coding = parseCodingUsage(codingFixture);
  const payg = parsePaygBalance({ data: { available_balance: 23.48 } });

  assert.equal(
    formatCompactStatus({ coding, payg }),
    "Kimi 5h [###-------] 31% | week [#########-] 90% | CNY 23.48",
  );
  assert.equal(formatCompactStatus({ coding }), "Kimi 5h [###-------] 31% | week [#########-] 90%");
  assert.equal(formatCompactStatus({ payg }), "Kimi CNY 23.48");
  assert.equal(formatCompactStatus({}), "Kimi quota unavailable");
});

test("formatCompactStatus renders quota progress and space-free reset countdowns", () => {
  const now = Date.parse("2026-01-06T11:51:02.717Z");

  assert.equal(
    formatCompactStatus(
      {
        coding: {
          rolling: {
            label: "5h",
            limit: 200,
            used: 139,
            remaining: 61,
            resetTime: "2026-01-06T13:33:02.717Z",
          },
          weekly: {
            limit: 2048,
            used: 214,
            remaining: 1834,
            resetTime: "2026-01-08T17:51:02.717Z",
          },
        },
        payg: { available: 23.48 },
      },
      now,
    ),
    "Kimi 5h [###-------] 31% · 1h42m | week [#########-] 90% · 2d6h | CNY 23.48",
  );
});

test("formatDetailedStatus reports reset times and missing credentials", () => {
  const coding = parseCodingUsage(codingFixture);

  assert.equal(
    formatDetailedStatus({
      coding,
      missing: ["MOONSHOT_API_KEY"],
      errors: [],
    }),
    [
      "Kimi Coding 5h: 61/200 remaining (resets 2026-01-06T13:33:02.717479433Z)",
      "Kimi Coding week: 1834/2048 remaining (resets 2026-01-09T15:23:13.716839300Z)",
      "Missing credential: MOONSHOT_API_KEY",
    ].join("\n"),
  );
});
