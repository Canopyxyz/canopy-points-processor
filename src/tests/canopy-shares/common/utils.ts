// Helper to convert seconds to microseconds for event timestamps
export function secondsToMicroseconds(seconds: number | bigint): bigint {
  return BigInt(seconds) * 1000000n;
}
