import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import { createComgateSandbox } from "./comgate-sandbox.js";

const say = (line: string) => process.stdout.write(`${line}\n`);
const fail = (line: string) => process.stderr.write(`${line}\n`);
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../../.env") });

if (process.env.NODE_ENV === "production") {
  fail("comgate sandbox refuses to run with NODE_ENV=production");
  process.exit(1);
}

const port = Number.parseInt(process.env.COMGATE_SANDBOX_PORT ?? "3110", 10);
const merchant = process.env.COMGATE_MERCHANT?.trim() || "sandbox";
const secret = process.env.COMGATE_SECRET?.trim() || "sandbox-secret";
const notifyUrl =
  process.env.COMGATE_SANDBOX_NOTIFY_URL?.trim() ||
  `http://localhost:${process.env.WEB_API_PORT ?? "3002"}/api/payments/comgate/notify`;
const publicUrl = `http://localhost:${port}`;

createComgateSandbox({
  merchant,
  secret,
  notifyUrl,
  publicUrl,
  log: (line) => say(`[comgate-sandbox] ${line}`),
}).listen(port, () => {
  say(`[comgate-sandbox] ${publicUrl} — REST v2.0 at ${publicUrl}/v2.0, dashboard at ${publicUrl}/`);
  say(
    `[comgate-sandbox] .env: COMGATE_BASE_URL=${publicUrl}/v2.0 COMGATE_MERCHANT=${merchant} COMGATE_SECRET=${secret}`,
  );
});
