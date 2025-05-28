import assert from "assert";

import { Vault, VaultStats } from "../../../schema/schema.js";

import { TestProcessorServer } from "@sentio/sdk/testing";
import { Address } from "../../../utils/types.js";

// Verify Vault entity state
export async function verifyVaultEntity(
  service: TestProcessorServer,
  vaultId: string,
  expectedState: {
    createdAt: bigint;
    sharesMetadata: string;
    createdAtVersion: bigint;
  },
) {
  const vault = await service.store.get(Vault, vaultId);
  assert(vault, `Vault ${vaultId} should exist`);

  assert.strictEqual(vault.id, vaultId, "Vault ID should match");
  assert.strictEqual(vault.createdAt, expectedState.createdAt, "Created at timestamp should match");
  assert.strictEqual(vault.sharesMetadata, expectedState.sharesMetadata, "Shares metadata should match");
  assert.strictEqual(vault.createdAtVersion, expectedState.createdAtVersion, "Created at version should match");
}

// Verify VaultStats singleton
export async function verifyVaultStats(
  service: TestProcessorServer,
  expectedState: {
    totalVaultCount: number;
    lastUpdateTime: bigint;
  },
) {
  const stats = await service.store.get(VaultStats, "global");
  assert(stats, "VaultStats singleton should exist");

  assert.strictEqual(stats.totalVaultCount, expectedState.totalVaultCount, "Total vault count should match");
  assert.strictEqual(stats.lastUpdateTime, expectedState.lastUpdateTime, "Last update time should match");
}

// TODO: figure out a way to get surf to play nice with types
// Helper to create a valid VaultCreated event data
export function createVaultCreatedEventData(
  vaultAddress: Address,
  baseAssetAddress: Address,
  vaultSharesAssetAddress: Address,
  depositLimit?: bigint,
  totalDebtLimit?: bigint,
) {
  return {
    vault: { inner: vaultAddress },
    deposit_limit: { vec: depositLimit !== undefined ? [depositLimit.toString()] : [] },
    total_debt_limit: { vec: totalDebtLimit !== undefined ? [totalDebtLimit.toString()] : [] },
    base_metadata: { inner: baseAssetAddress },
    shares_metadata: { inner: vaultSharesAssetAddress },
  };
}

// Get all vaults created within a time range
export async function getVaultsInTimeRange(service: TestProcessorServer, startTime: bigint, endTime: bigint) {
  // TODO: there could be a multi filter bug, though it works with only 1 filter
  // So do one filter with list then directly in TS do the other filter
  const vaults = await service.store.list(Vault, [
    { field: "createdAt", op: ">=", value: startTime },
    { field: "createdAt", op: "<=", value: endTime },
  ]);

  return vaults;
}
