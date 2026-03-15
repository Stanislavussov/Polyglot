import pino from "pino";

export const logger = pino({ level: "info" }, pino.destination(1));
