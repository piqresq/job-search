const DEFAULT_OPERATIONAL_START_UTC_HOUR = 5;
const DEFAULT_OPERATIONAL_END_UTC_HOUR = 20;

type OperationalHoursConfig = {
  startHourUtc: number;
  endHourUtc: number;
};

export type OperationalHoursState = OperationalHoursConfig & {
  isOpenNow: boolean;
  nextWindowStartAt: number | null;
};

function parseUtcHour(raw: string | undefined, fallback: number, max: number): number {
  const n = raw?.trim() ? parseInt(raw.trim(), 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, n));
}

function utcMidnightUnix(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
}

export function getOperationalHoursConfig(env: Env): OperationalHoursConfig {
  return {
    startHourUtc: parseUtcHour(
      env.PIPELINE_OPERATIONAL_START_UTC_HOUR,
      DEFAULT_OPERATIONAL_START_UTC_HOUR,
      23,
    ),
    endHourUtc: parseUtcHour(env.PIPELINE_OPERATIONAL_END_UTC_HOUR, DEFAULT_OPERATIONAL_END_UTC_HOUR, 24),
  };
}

export function getOperationalHoursState(
  env: Env,
  nowSec = Math.floor(Date.now() / 1000),
): OperationalHoursState {
  const cfg = getOperationalHoursConfig(env);
  const startSec = cfg.startHourUtc * 3600;
  const endSec = cfg.endHourUtc * 3600;
  const midnight = utcMidnightUnix(nowSec);
  const secOfDay = nowSec - midnight;

  if (startSec === endSec) {
    return {
      ...cfg,
      isOpenNow: true,
      nextWindowStartAt: null,
    };
  }

  const sameDayWindow = startSec < endSec;
  const isOpenNow = sameDayWindow
    ? secOfDay >= startSec && secOfDay < endSec
    : secOfDay >= startSec || secOfDay < endSec;

  if (isOpenNow) {
    return {
      ...cfg,
      isOpenNow: true,
      nextWindowStartAt: null,
    };
  }

  const nextWindowStartAt =
    sameDayWindow && secOfDay < startSec
      ? midnight + startSec
      : sameDayWindow
        ? midnight + 24 * 3600 + startSec
        : midnight + startSec;

  return {
    ...cfg,
    isOpenNow: false,
    nextWindowStartAt,
  };
}
