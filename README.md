# Guard plus gate: x402-seatbelt with RelayShield counterparty screening

An agent that pays with x402 needs two different protections, and they are
not the same thing:

- **The guard answers "can we afford it."** Fail-closed spending rules:
  budget caps, per-payment caps, an emergency stop. That is
  [x402-seatbelt](https://www.npmjs.com/package/x402-seatbelt).
- **The decision gate answers "should it happen at all."** Threat-intel
  screening of the payee before any payment is attempted. That is
  [RelayShield](https://www.relayshield.net): its free keyless API scores a
  URL, crypto wallet, or email against a monitored threat-intel corpus.

This repo composes the two. The seatbelt guards the budget on every payment
that leaves the machine; RelayShield screens the counterparty before the
payment is even attempted.

## Decision matrix

| Signal | Outcome |
|---|---|
| Seatbelt STOP (budget, cap, emergency stop) or RelayShield **high** | Block. The payment never leaves the machine. |
| RelayShield **medium** | Require human confirmation before proceeding. |
| Otherwise | Proceed. The seatbelt still guards the spend. |

RelayShield never declares anything safe. An "unknown" result means no flags
were found against the target right now, not proof it is clean. Unknown
allows; only high and medium change the outcome.

## Install and run

```bash
npm install
npm run demo
```

The demo runs three scenarios against the live RelayShield API and the real
seatbelt budget logic (payments are simulated with a stub service, so no
money moves and no x402 server is needed):

1. Clean payee, $0.03 payment under a $2.00 budget: proceeds, $0.03 recorded
   as spent.
2. Clean payee, $5.00 payment over a $2.00 budget: the seatbelt blocks it
   with reason `budget` before it is sent.
3. Flagged payee (a corpus-listed scam domain): RelayShield grades it high
   and the payment is blocked before it is attempted. The service is never
   called.

## Use it in your agent

```js
import { createGuardedPayer } from "./guard.js";

const { guardedPayment } = createGuardedPayer({
  seatbeltOptions: { maxTotalUsd: 2.0, maxPaymentUsd: 0.05 },
  confirm: async ({ url, level }) => {
    // your human-in-the-loop: return true to proceed on medium risk
    return askOperator(`RelayShield graded ${url} as ${level}. Proceed?`);
  },
});

const result = await guardedPayment(
  { url: payeeUrl, wallet: payeeWallet },
  async (guardedFetch) => {
    // guardedFetch is your seatbelt-wrapped fetch; plug it into your
    // x402 client (for example @x402/fetch) and run the payment flow here
    return runX402Payment(guardedFetch, payeeUrl);
  }
);

if (result.decision === "blocked") {
  console.log(`blocked by ${result.gate}: ${result.reason}`);
}
```

Screening runs first because counterparty risk is a property of the payee,
not the payment: there is no reason to sign or budget a payment to a flagged
counterparty. The seatbelt then applies to whatever passes the screen, so a
clean payee can still be stopped by the budget, the per-payment cap, or the
emergency stop.

## Notes

- RelayShield calls are keyless and free; every call from this example sends
  `source: "relayshield-x402-seatbelt-example"` so the traffic is
  identifiable. Screening fails open: if the API cannot be reached, the
  payment flow continues under the seatbelt's budget rules alone.
- The seatbelt also has an optional Pay Safe check with a configurable
  `paySafeUrl` endpoint that returns GO / CAUTION / STOP verdicts. That is a
  second, compatible place to plug in counterparty intelligence if you run a
  verdict endpoint of your own.

## License

MIT
