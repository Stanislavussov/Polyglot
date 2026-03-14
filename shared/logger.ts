import pino from "pino";

const transport =
  process.env.NODE_ENV === "production" && process.env.BETTERSTACK_TOKEN
    ? pino.transport({
        target: "@logtail/pino",
        options: { sourceToken: process.env.BETTERSTACK_TOKEN },
      })
    : pino.destination(1);

export const logger = pino({ level: "info" }, transport);
