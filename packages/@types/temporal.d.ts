declare namespace Temporal {
  interface ZonedDateTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
    microsecond: number;
    nanosecond: number;
    toPlainDateTime(): PlainDateTime;
    withTimeZone(timeZone: string): ZonedDateTime;
  }

  interface PlainDateTime {
    with(fields: { hour?: number; minute?: number }): PlainDateTime;
    toZonedDateTime(timeZone: string): ZonedDateTime;
  }

  interface Instant {
    toZonedDateTimeISO(timeZone: string): ZonedDateTime;
  }

  namespace Now {
    function zonedDateTimeISO(timeZone: string): ZonedDateTime;
  }

  namespace Instant {
    function from(iso: string): Instant;
  }
}

declare const Temporal: {
  Now: typeof Temporal.Now;
  Instant: typeof Temporal.Instant;
};
