// Convert timestamp from microseconds to seconds
export function getTimestampInSeconds(timestamp_micros: number | bigint): bigint {
  return BigInt(timestamp_micros) / 1_000_000n;
}

// Normalize timestamp to start of day (00:00:00 UTC)
export function normalizeToDayTimestamp(timestampSeconds: bigint): bigint {
  const secondsPerDay = BigInt(86400); // 24 * 60 * 60
  return (timestampSeconds / secondsPerDay) * secondsPerDay;
}
