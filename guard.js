/**
 * Guard plus gate: x402-seatbelt guards the budget, RelayShield gates the counterparty.
 *
 * The seatbelt answers "can we afford it" (fail-closed spending rules).
 * RelayShield answers "should it happen at all" (threat-intel screening of
 * the payee URL and wallet before any payment is attempted).
 *
 * Decision matrix:
 *   seatbelt STOP (PaymentBlockedError) or RelayShield high  -> block
 *   RelayShield medium                                        -> human confirm
 *   otherwise                                                 -> proceed
 *
 * RelayShield never declares anything safe: "unknown" means no flags were
 * found against the target right now, not proof it is clean. Unknown allows.
 */

import { createSeatbelt, PaymentBlockedError } from "x402-seatbelt";

export const COMPOSITE_CHECK_URL =
  "https://atq6wtkp6k.execute-api.us-east-1.amazonaws.com/prod/v1/composite-check";
const SOURCE = "relayshield-x402-seatbelt-example";
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Screen a counterparty target against RelayShield's free keyless API.
 * Each target (url, wallet) is screened in its own call; the worst level
 * wins. Returns "high", "medium" or "unknown". Network errors and timeouts
 * fail open.
 */
export async function screenCounterparty(
  { url, wallet } = {},
  { timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const jobs = [];
  if (url) jobs.push({ url, source: SOURCE });
  if (wallet) jobs.push({ wallet, source: SOURCE });
  const rank = { unknown: 0, medium: 1, high: 2 };
  let worst = "unknown";
  for (const body of jobs) {
    const level = await screenOne(body, timeoutMs);
    if ((rank[level] ?? 0) > (rank[worst] ?? 0)) worst = level;
    if (worst === "high") break;
  }
  return worst;
}

async function screenOne(body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(COMPOSITE_CHECK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await res.json();
    return parsed?.data?.level ?? "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a guarded payer. seatbeltOptions are passed straight to
 * x402-seatbelt's createSeatbelt (maxTotalUsd, maxPaymentUsd, maxPayments...).
 * confirm, when provided, is called on a medium screening and must resolve
 * to true to proceed, false to block.
 */
export function createGuardedPayer({ seatbeltOptions = {}, confirm = null } = {}) {
  const seatbelt = createSeatbelt(seatbeltOptions);

  async function guardedPayment({ url, wallet }, pay, { baseFetch } = {}) {
    const level = await screenCounterparty({ url, wallet });
    if (level === "high") {
      return {
        decision: "blocked",
        gate: "relayshield",
        reason: `counterparty graded high risk (${url ?? wallet})`,
      };
    }
    if (level === "medium") {
      const ok = confirm ? await confirm({ url, wallet, level }) : false;
      if (!ok) {
        return {
          decision: "blocked",
          gate: "relayshield",
          reason: `counterparty graded medium risk and was not confirmed (${url ?? wallet})`,
        };
      }
    }
    try {
      const response = await pay(seatbelt.wrap(baseFetch ?? globalThis.fetch));
      return { decision: "paid", response };
    } catch (err) {
      if (err instanceof PaymentBlockedError) {
        return {
          decision: "blocked",
          gate: "seatbelt",
          reason: `seatbelt blocked the payment: ${err.reason}`,
        };
      }
      throw err;
    }
  }

  return { seatbelt, screenCounterparty, guardedPayment };
}
