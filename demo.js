/**
 * Live demo: guard plus gate for x402 agent payments.
 *
 * Scenario 1: clean payee, payment under budget -> proceeds.
 * Scenario 2: clean payee, payment over budget  -> seatbelt blocks it.
 * Scenario 3: flagged payee                      -> RelayShield blocks it before
 *                                                any payment is attempted.
 *
 * Run: npm run demo
 */

import { createGuardedPayer } from "./guard.js";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BENIGN_WALLET = "0x0000000000000000000000000000000000000000";

/** Build an x402 v2 style payment header the seatbelt can parse. */
function paymentHeader({ payTo, usdc }) {
  const units = String(Math.round(usdc * 1e6));
  const payload = {
    payload: { authorization: { to: payTo, value: units } },
    accepted: {
      amount: units,
      asset: BASE_USDC,
      network: "eip155:8453",
      payTo,
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** A stub service: pretends to accept the payment, so the demo needs no live x402 server. */
function stubService(calls) {
  return async (input, init) => {
    calls.count += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "x-payment-response": "settled" },
    });
  };
}

async function main() {
  const results = {};

  // Scenario 1: clean payee, under budget.
  {
    const { seatbelt, guardedPayment } = createGuardedPayer({
      seatbeltOptions: { maxTotalUsd: 2.0, maxPaymentUsd: 0.05 },
    });
    const calls = { count: 0 };
    const out = await guardedPayment(
      { url: "https://example.com/paid-api", wallet: BENIGN_WALLET },
      async (guardedFetch) => {
        return guardedFetch("https://example.com/paid-api", {
          headers: {
            "x-payment": paymentHeader({ payTo: BENIGN_WALLET, usdc: 0.03 }),
          },
        });
      },
      { baseFetch: stubService(calls) }
    );
    const report = seatbelt.report();
    results.scenario1_clean_under_budget = {
      decision: out.decision,
      spentUsd: report.spentUsd,
      payments: report.payments,
      serviceCalls: calls.count,
    };
    console.log("scenario 1 (clean payee, $0.03 under budget):", JSON.stringify(results.scenario1_clean_under_budget));
  }

  // Scenario 2: clean payee, over budget.
  {
    const { seatbelt, guardedPayment } = createGuardedPayer({
      seatbeltOptions: { maxTotalUsd: 2.0, maxPaymentUsd: 10.0 },
    });
    const calls = { count: 0 };
    const out = await guardedPayment(
      { url: "https://example.com/paid-api", wallet: BENIGN_WALLET },
      async (guardedFetch) => {
        return guardedFetch("https://example.com/paid-api", {
          headers: {
            "x-payment": paymentHeader({ payTo: BENIGN_WALLET, usdc: 5.0 }),
          },
        });
      },
      { baseFetch: stubService(calls) }
    );
    results.scenario2_over_budget = {
      decision: out.decision,
      gate: out.gate,
      reason: out.reason,
      serviceCalls: calls.count,
      blocked: seatbelt.report().blocked,
    };
    console.log("scenario 2 (clean payee, $5.00 over $2.00 budget):", JSON.stringify(results.scenario2_over_budget));
  }

  // Scenario 3: flagged payee. The payment must never be attempted.
  {
    const { seatbelt, guardedPayment } = createGuardedPayer({
      seatbeltOptions: { maxTotalUsd: 2.0, maxPaymentUsd: 0.05 },
    });
    const calls = { count: 0 };
    const out = await guardedPayment(
      { url: "https://sandboxle.com.cn/paid-api" },
      async (guardedFetch) => {
        return guardedFetch("https://sandboxle.com.cn/paid-api", {
          headers: {
            "x-payment": paymentHeader({ payTo: BENIGN_WALLET, usdc: 0.03 }),
          },
        });
      },
      { baseFetch: stubService(calls) }
    );
    results.scenario3_flagged_payee = {
      decision: out.decision,
      gate: out.gate,
      reason: out.reason,
      serviceCalls: calls.count,
    };
    console.log("scenario 3 (flagged payee):", JSON.stringify(results.scenario3_flagged_payee));
  }

  const ok =
    results.scenario1_clean_under_budget.decision === "paid" &&
    results.scenario1_clean_under_budget.spentUsd === 0.03 &&
    results.scenario2_over_budget.decision === "blocked" &&
    results.scenario2_over_budget.gate === "seatbelt" &&
    /budget/.test(results.scenario2_over_budget.reason) &&
    results.scenario3_flagged_payee.decision === "blocked" &&
    results.scenario3_flagged_payee.gate === "relayshield" &&
    results.scenario3_flagged_payee.serviceCalls === 0;

  console.log(ok ? "DEMO OK: all three scenarios behaved as designed." : "DEMO FAILED: unexpected result above.");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("demo crashed:", err);
  process.exit(1);
});
