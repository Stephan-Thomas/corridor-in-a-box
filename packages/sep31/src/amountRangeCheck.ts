import { compareAmounts } from "@corridor/types";
import {
  buildSettlementRequest,
  type CheckResult,
  type GateCheck,
  type GateContext,
} from "@corridor/engine";

export interface InfoAdapterLike {
  getInfo(): Promise<{
    ok: boolean;
    value?: { receive: Record<string, { minAmount?: string; maxAmount?: string }> };
    error?: { message: string };
  }>;
}

function amountMax(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const cmp = compareAmounts(a, b);
  if (!cmp.ok) return undefined;
  return cmp.value > 0 ? a : b;
}

function amountMin(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const cmp = compareAmounts(a, b);
  if (!cmp.ok) return undefined;
  return cmp.value < 0 ? a : b;
}

export function amountRangeCheck(adapter: InfoAdapterLike): GateCheck {
  return {
    name: "sep31.amount.range",
    async run(ctx: GateContext): Promise<CheckResult> {
      const start = Date.now();
      const done = (passed: boolean, detail: string): CheckResult => ({
        name: "sep31.amount.range",
        passed,
        code: passed ? undefined : "PRESETTLE_AMOUNT_OUT_OF_RANGE",
        detail,
        durationMs: Date.now() - start,
      });

      const bridgeAsset = ctx.corridor.settlement.bridge_asset;
      const manifestMin = ctx.corridor.limits?.min_amount;
      const manifestMax = ctx.corridor.limits?.max_amount;

      const expected = buildSettlementRequest(ctx.opened, ctx.quote, ctx.corridor);
      const amount = expected.amount.amount;

      const infoOutcome = await adapter.getInfo();
      if (!infoOutcome.ok || !infoOutcome.value) {
        return {
          name: "sep31.amount.range",
          passed: false,
          code: "SETTLEMENT_FAILED",
          detail: `failed to fetch /info for amount check: ${infoOutcome.error?.message}`,
          durationMs: Date.now() - start,
        };
      }

      const infoMin = infoOutcome.value.receive[bridgeAsset]?.minAmount;
      const infoMax = infoOutcome.value.receive[bridgeAsset]?.maxAmount;

      const effectiveMin = amountMax(manifestMin, infoMin);
      const effectiveMax = amountMin(manifestMax, infoMax);

      if (effectiveMin) {
        const cmp = compareAmounts(amount, effectiveMin);
        if (cmp.ok && cmp.value < 0) {
          return done(false, `amount ${amount} is below minimum ${effectiveMin}`);
        }
      }

      if (effectiveMax) {
        const cmp = compareAmounts(amount, effectiveMax);
        if (cmp.ok && cmp.value > 0) {
          return done(false, `amount ${amount} is above maximum ${effectiveMax}`);
        }
      }

      return done(true, `amount ${amount} is within range`);
    },
  };
}
