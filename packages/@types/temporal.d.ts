declare namespace Temporal {
  interface ZonedDateTime {
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

  namespace Now {
    function zonedDateTimeISO(timeZone: string): ZonedDateTime;
  }
}

declare const Temporal: {
  Now: typeof Temporal.Now;
};
