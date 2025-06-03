// Convert timestamp from microseconds to seconds
export function getTimestampInSeconds(timestamp_micros: number | bigint): bigint {
  return BigInt(timestamp_micros) / 1_000_000n;
}

// Normalize timestamp to start of day (00:00:00 UTC)
export function normalizeToDayTimestamp(timestampSeconds: bigint): bigint {
  const secondsPerDay = BigInt(86400); // 24 * 60 * 60
  return (timestampSeconds / secondsPerDay) * secondsPerDay;
}

// NOTE: we manually pad all addresses for DB consistency
export function padAptosAddress(address: string): string {
  // Remove '0x' prefix if present
  const cleanAddress = address.startsWith("0x") ? address.slice(2) : address;

  // Aptos addresses are 32 bytes (64 hex characters)
  const targetLength = 64;

  // Pad with leading zeros
  const paddedAddress = cleanAddress.padStart(targetLength, "0");

  // Add '0x' prefix back
  return "0x" + paddedAddress;
}
