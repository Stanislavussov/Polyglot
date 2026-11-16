import type {
  ChargeState,
  ChargeStatus,
  HostedCheckout,
  HostedCheckoutRequest,
  HostedPaymentProvider,
} from "@polyglot/core";

/** Comgate REST v2.0 — https://apidoc.comgate.cz/en/api/rest/ */
export const COMGATE_PROVIDER = "comgate";
const COMGATE_BASE_URL = "https://payments.comgate.cz/v2.0";
// Comgate rejects a label outside 1–16 characters.
const LABEL_MAX = 16;

export interface ComgateConfig {
  merchant: string;
  secret: string;
  /** Test payments on the live host; needs the Tester role in the client portal. */
  test: boolean;
  /** Off until Comgate support enables recurring payments for the shop. */
  recurring: boolean;
  /** REST v2.0 root; a local sandbox in development, Comgate itself otherwise. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface ComgateReply {
  code: number;
  message?: string;
  transId?: string;
  redirect?: string;
  status?: string;
  price?: string | number;
  curr?: string;
}

/** Comgate answered, with a non-zero code — a refusal, unlike a network failure. */
export class ComgateError extends Error {
  constructor(
    readonly path: string,
    readonly code: number,
    message = "",
  ) {
    super(`comgate ${path}: code ${code} ${message}`.trim());
  }
}

const STATUS: Record<string, ChargeStatus> = {
  PAID: "paid",
  CANCELLED: "failed",
  PENDING: "pending",
  // Card held, not captured — we never request pre-authorisation, so this is not money yet.
  AUTHORIZED: "pending",
};

export function createComgateProvider(config: ComgateConfig): HostedPaymentProvider {
  const http = config.fetch ?? fetch;
  const baseUrl = (config.baseUrl ?? COMGATE_BASE_URL).replace(/\/$/, "");
  const auth = `Basic ${Buffer.from(`${config.merchant}:${config.secret}`).toString("base64")}`;

  async function call(method: "GET" | "POST", path: string, body?: object): Promise<ComgateReply> {
    const response = await http(`${baseUrl}${path}`, {
      method,
      headers: { authorization: auth, accept: "application/json", "content-type": "application/json" },
      ...(body && { body: JSON.stringify(body) }),
    });
    const reply = (await response.json()) as ComgateReply;
    if (reply.code !== 0) throw new ComgateError(path, reply.code, reply.message);
    return reply;
  }

  async function fetchCharge(chargeId: string): Promise<ChargeState> {
    const reply = await call("GET", `/payment/transId/${encodeURIComponent(chargeId)}.json`);
    return {
      status: STATUS[reply.status ?? ""] ?? "pending",
      ...(reply.price !== undefined &&
        reply.curr && { price: { amountMinor: Number(reply.price), currency: reply.curr } }),
    };
  }

  return {
    name: COMGATE_PROVIDER,
    fetchCharge,

    async createCheckout(request: HostedCheckoutRequest): Promise<HostedCheckout> {
      const back = request.returnUrl;
      const reply = await call("POST", "/payment.json", {
        price: request.price.amountMinor,
        curr: request.price.currency,
        label: request.label.slice(0, LABEL_MAX),
        refId: request.orderId,
        method: "ALL",
        country: "ALL",
        test: config.test,
        initRecurring: request.recurring && config.recurring,
        url_paid: back,
        url_cancelled: back,
        url_pending: back,
        ...(request.email && { email: request.email }),
      });
      if (!reply.transId || !reply.redirect) throw new Error("comgate /payment.json: no transId or redirect");
      return { chargeId: reply.transId, redirectUrl: reply.redirect };
    },

    async chargeRenewal(initialChargeId, request) {
      if (!config.recurring) return null;
      let transId: string | undefined;
      try {
        transId = (
          await call("POST", "/recurring.json", {
            initRecurringId: initialChargeId,
            price: request.price.amountMinor,
            curr: request.price.currency,
            label: request.label.slice(0, LABEL_MAX),
            refId: request.orderId,
            test: config.test,
          })
        ).transId;
      } catch (error) {
        // A non-zero code is a declined card: the period runs out. A network error
        // rethrows, so an outage never expires a paying customer.
        if (!(error instanceof ComgateError)) throw error;
        return { chargeId: `declined-${request.orderId}`, status: "failed" };
      }
      if (!transId) return { chargeId: `declined-${request.orderId}`, status: "failed" };
      // The doc says code 0 means paid, yet asks for a status check before fulfilment.
      return { chargeId: transId, status: (await fetchCharge(transId)).status };
    },
  };
}

const ON = new Set(["on", "true", "1", "yes"]);

/** The one Comgate wiring every app uses; null while the shop has no credentials. */
export function comgateFromEnv(env: NodeJS.ProcessEnv, http?: typeof fetch): HostedPaymentProvider | null {
  const merchant = env.COMGATE_MERCHANT?.trim();
  const secret = env.COMGATE_SECRET?.trim();
  if (!merchant || !secret) return null;
  const flag = (name: string) => ON.has(env[name]?.trim().toLowerCase() ?? "");
  return createComgateProvider({
    merchant,
    secret,
    test: flag("COMGATE_TEST"),
    recurring: flag("COMGATE_RECURRING"),
    ...(env.COMGATE_BASE_URL?.trim() && { baseUrl: env.COMGATE_BASE_URL.trim() }),
    ...(http && { fetch: http }),
  });
}
