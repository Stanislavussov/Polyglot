import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A local stand-in for Comgate's REST API v2.0 (https://apidoc.comgate.cz/en/api/rest/),
 * development only. The app talks to it exactly as to Comgate — same paths, JSON,
 * Basic auth, push notification, recurring charge — so going live is a change of
 * COMGATE_BASE_URL and keys, not of code. It cannot prove Comgate's quirks; the
 * first real test payment still can.
 */

export interface SandboxConfig {
  merchant: string;
  secret: string;
  /** Where the push notification goes: our /api/payments/comgate/notify. */
  notifyUrl: string;
  /** This server's own origin, for the checkout redirect it hands out. */
  publicUrl: string;
  log?: (line: string) => void;
}

type Status = "PENDING" | "PAID" | "CANCELLED";

interface Transaction {
  transId: string;
  price: number;
  curr: string;
  label: string;
  refId: string;
  email: string;
  status: Status;
  initRecurring: boolean;
  recurringOf: string | null;
  urlPaid: string | null;
  urlCancelled: string | null;
  createdAt: Date;
}

const LABEL_MAX = 16;

function transId(): string {
  const raw = randomBytes(6).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Comgate sandbox</title>
<style>body{font:17px system-ui;max-width:640px;margin:40px auto;padding:0 16px}button{font:inherit;padding:12px 18px;margin:6px 6px 0 0;border-radius:10px;border:1px solid #999;cursor:pointer}.pay{background:#1F8A74;color:#fff;border:0}table{border-collapse:collapse;width:100%;font-size:15px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}</style>
${body}`);
}

function money(tx: Pick<Transaction, "price" | "curr">): string {
  return `${(tx.price / 100).toFixed(2)} ${tx.curr}`;
}

export function createComgateSandbox(config: SandboxConfig): Server {
  const log = config.log ?? (() => {});
  const transactions = new Map<string, Transaction>();
  const settings = { declineRenewals: false };
  const expectedAuth = `Basic ${Buffer.from(`${config.merchant}:${config.secret}`).toString("base64")}`;

  function statusBody(tx: Transaction) {
    return {
      code: 0,
      message: "OK",
      test: "true",
      price: String(tx.price),
      curr: tx.curr,
      label: tx.label,
      refId: tx.refId,
      transId: tx.transId,
      status: tx.status,
      method: "CARD_CZ_CSOB_2",
      email: tx.email,
    };
  }

  // Comgate's push: a POST of the payment's fields; the shop must answer 2xx and
  // re-read the status itself — the push is not signed.
  async function push(tx: Transaction): Promise<void> {
    const body = { ...statusBody(tx), merchant: config.merchant, secret: config.secret, full_name: "Sandbox Tester" };
    try {
      const response = await fetch(config.notifyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      log(`push ${tx.transId} ${tx.status} → ${response.status}`);
    } catch (error) {
      log(`push ${tx.transId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function backUrl(template: string | null, tx: Transaction): string | null {
    // Comgate's own placeholders in the return URL, literally "${id}" and "${refId}".
    return template ? template.replaceAll(`\${id}`, tx.transId).replaceAll(`\${refId}`, tx.refId) : null;
  }

  function createPayment(input: Record<string, unknown>): { code: number; message: string } | Transaction {
    const price = input.price;
    const label = typeof input.label === "string" ? input.label : "";
    if (typeof price !== "number" || !Number.isInteger(price) || price <= 0)
      return { code: 1309, message: "Invalid price" };
    if (typeof input.curr !== "string" || input.curr.length !== 3) return { code: 1309, message: "Invalid curr" };
    if (label.length < 1 || label.length > LABEL_MAX) return { code: 1309, message: "Invalid label" };
    if (typeof input.refId !== "string" || input.refId === "") return { code: 1309, message: "Missing refId" };
    if (typeof input.method !== "string") return { code: 1309, message: "Missing method" };
    return {
      transId: transId(),
      price,
      curr: input.curr,
      label,
      refId: input.refId,
      email: typeof input.email === "string" ? input.email : "",
      status: "PENDING",
      initRecurring: input.initRecurring === true,
      recurringOf: null,
      urlPaid: typeof input.url_paid === "string" ? input.url_paid : null,
      urlCancelled: typeof input.url_cancelled === "string" ? input.url_cancelled : null,
      createdAt: new Date(),
    };
  }

  function chargeRecurring(input: Record<string, unknown>): { code: number; message: string; transId?: string } {
    const initial = typeof input.initRecurringId === "string" ? transactions.get(input.initRecurringId) : undefined;
    if (!initial?.initRecurring || initial.status !== "PAID") {
      return { code: 1400, message: "Initial recurring payment not found" };
    }
    if (typeof input.price !== "number" || input.price <= 0) return { code: 1309, message: "Invalid price" };
    if (settings.declineRenewals) {
      log(`recurring on ${initial.transId} declined (sandbox setting)`);
      return { code: 1400, message: "Payment declined by the bank" };
    }
    const tx: Transaction = {
      ...initial,
      transId: transId(),
      price: input.price,
      curr: typeof input.curr === "string" ? input.curr : initial.curr,
      refId: typeof input.refId === "string" ? input.refId : initial.refId,
      status: "PAID",
      initRecurring: false,
      recurringOf: initial.transId,
      createdAt: new Date(),
    };
    transactions.set(tx.transId, tx);
    log(`recurring ${tx.transId} on ${initial.transId} PAID ${money(tx)}`);
    return { code: 0, message: "OK", transId: tx.transId };
  }

  function checkoutPage(tx: Transaction): string {
    if (tx.status !== "PENDING") {
      return `<h1>Payment ${escapeHtml(tx.transId)}</h1><p>Already ${tx.status}.</p>`;
    }
    const button = (outcome: string, text: string, cls = "") =>
      `<form method="post" action="/pay/${tx.transId}/${outcome}" style="display:inline"><button class="${cls}">${text}</button></form>`;
    return `<p>Comgate sandbox · test payment</p>
<h1>${escapeHtml(tx.label)}</h1>
<p style="font-size:24px">${money(tx)}</p>
${tx.initRecurring ? "<p>The card will be saved for monthly charges.</p>" : ""}
${button("paid", "Pay by card", "pay")}${button("paid", "Apple Pay")}${button("paid", "Google Pay")}
<br>${button("cancelled", "Bank declines")}${button("cancelled", "Back to the shop")}`;
  }

  function dashboard(): string {
    const rows = [...transactions.values()]
      .reverse()
      .map(
        (tx) =>
          `<tr><td>${tx.transId}</td><td>${tx.recurringOf ? `renewal of ${tx.recurringOf}` : escapeHtml(tx.label)}</td><td>${money(tx)}</td><td>${tx.status}</td></tr>`,
      )
      .join("");
    return `<h1>Comgate sandbox</h1>
<p>Merchant <b>${escapeHtml(config.merchant)}</b> · push to <code>${escapeHtml(config.notifyUrl)}</code></p>
<form method="post" action="/settings"><label><input type="checkbox" name="declineRenewals" ${settings.declineRenewals ? "checked" : ""} onchange="this.form.submit()"> Bank declines monthly renewals</label></form>
<table><tr><th>transId</th><th>What</th><th>Amount</th><th>Status</th></tr>${rows || '<tr><td colspan="4">No payments yet.</td></tr>'}</table>`;
  }

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", config.publicUrl);
    const path = url.pathname;
    try {
      if (path.startsWith("/v2.0/")) {
        if (request.headers.authorization !== expectedAuth) {
          return json(response, 401, { code: 1401, message: "Unauthorized: wrong merchant or secret" });
        }
        if (request.method === "POST" && path === "/v2.0/payment.json") {
          const result = createPayment(JSON.parse((await readBody(request)) || "{}"));
          if ("code" in result) return json(response, 400, result);
          transactions.set(result.transId, result);
          log(`created ${result.transId} ${money(result)} refId=${result.refId}`);
          return json(response, 201, {
            code: 0,
            message: "OK",
            transId: result.transId,
            redirect: `${config.publicUrl}/pay/${result.transId}`,
          });
        }
        const status = /^\/v2\.0\/payment\/transId\/([^/]+)\.json$/.exec(path);
        if (request.method === "GET" && status?.[1]) {
          const tx = transactions.get(decodeURIComponent(status[1]));
          return tx ? json(response, 200, statusBody(tx)) : json(response, 404, { code: 1400, message: "Not found" });
        }
        if (request.method === "POST" && path === "/v2.0/recurring.json") {
          return json(response, 200, chargeRecurring(JSON.parse((await readBody(request)) || "{}")));
        }
        return json(response, 404, { code: 1100, message: "Unknown endpoint" });
      }

      const pay = /^\/pay\/([^/]+)(?:\/(paid|cancelled))?$/.exec(path);
      const tx = pay?.[1] ? transactions.get(pay[1]) : undefined;
      if (pay && !tx) return html(response, "<h1>Unknown payment</h1>");
      if (tx && request.method === "GET" && !pay?.[2]) return html(response, checkoutPage(tx));
      if (tx && request.method === "POST" && pay?.[2] && tx.status === "PENDING") {
        tx.status = pay[2] === "paid" ? "PAID" : "CANCELLED";
        log(`checkout ${tx.transId} → ${tx.status}`);
        // Comgate pushes before the customer's browser is back on the shop.
        await push(tx);
        const back = backUrl(tx.status === "PAID" ? tx.urlPaid : tx.urlCancelled, tx);
        response.writeHead(303, { location: back ?? "/" });
        return response.end();
      }
      if (request.method === "POST" && path === "/settings") {
        settings.declineRenewals = new URLSearchParams(await readBody(request)).has("declineRenewals");
        response.writeHead(303, { location: "/" });
        return response.end();
      }
      if (path === "/") return html(response, dashboard());
      response.writeHead(404);
      response.end();
    } catch (error) {
      json(response, 500, { code: 1500, message: error instanceof Error ? error.message : "error" });
    }
  });
}
