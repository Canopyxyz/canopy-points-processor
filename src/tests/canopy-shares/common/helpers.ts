import assert from "assert";

import { TestProcessorServer } from "@sentio/sdk/testing";

import {
  Vault,
  VaultStats,
  StoreMetadataCache,
  StoreBalance,
  BalanceSnapshot,
  Transaction,
  FungibleAssetStats,
  TransactionType,
} from "../../../schema/schema.js";

import { Address } from "../../../utils/types.js";
import { secondsToMicroseconds } from "./utils.js";

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
    deposit_limit: {
      vec: depositLimit !== undefined ? ([depositLimit.toString()] as [string]) : ([] as []),
    },
    total_debt_limit: {
      vec: totalDebtLimit !== undefined ? ([totalDebtLimit.toString()] as [string]) : ([] as []),
    },
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

// Verify StoreMetadataCache entity state
export async function verifyStoreMetadataCache(
  service: TestProcessorServer,
  storeAddress: string,
  expectedState: {
    metadata: string;
    isCanopyVault: boolean;
    vaultID?: string;
  },
) {
  const metadataCache = await service.store.get(StoreMetadataCache, storeAddress);
  assert(metadataCache, `StoreMetadataCache for ${storeAddress} should exist`);

  assert.strictEqual(metadataCache.id, storeAddress, "Cache ID should be store address");
  assert.strictEqual(metadataCache.metadata, expectedState.metadata, "Metadata should match");
  assert.strictEqual(metadataCache.isCanopyVault, expectedState.isCanopyVault, "isCanopyVault should match");

  if (expectedState.isCanopyVault) {
    assert.strictEqual(metadataCache.vaultID, expectedState.vaultID, "Should reference correct vault");
  } else {
    assert.strictEqual(metadataCache.vaultID, undefined, "Non-Canopy should have no vault ID");
  }
}

// Verify StoreBalance entity state
export async function verifyStoreBalance(
  service: TestProcessorServer,
  storeAddress: string,
  expectedState: {
    vaultID: string;
    lastKnownBalance: bigint;
    lastObservationTime: bigint;
    cumulativeBalanceSeconds: bigint;
    totalSnapshotCount: number;
  },
) {
  const storeBalance = await service.store.get(StoreBalance, storeAddress);
  assert(storeBalance, `StoreBalance for ${storeAddress} should exist`);

  assert.strictEqual(storeBalance.id, storeAddress, "ID should be store address");
  assert.strictEqual(storeBalance.fungible_store, storeAddress, "Fungible store should match");
  assert.strictEqual(storeBalance.vaultID, expectedState.vaultID, "Should reference correct vault");
  assert.strictEqual(storeBalance.lastKnownBalance, expectedState.lastKnownBalance, "Balance should match");
  assert.strictEqual(
    storeBalance.lastObservationTime,
    expectedState.lastObservationTime,
    "Observation time should match",
  );
  assert.strictEqual(
    storeBalance.cumulativeBalanceSeconds,
    expectedState.cumulativeBalanceSeconds,
    "Cumulative balance-seconds should match",
  );
  assert.strictEqual(storeBalance.totalSnapshotCount, expectedState.totalSnapshotCount, "Snapshot count should match");
}

// Verify BalanceSnapshot entity state
export async function verifyBalanceSnapshot(
  service: TestProcessorServer,
  snapshotId: string,
  expectedState: {
    storeBalanceID: string;
    filledAt: bigint;
    balance: bigint;
    cumulativeBalanceSeconds: bigint;
    lastUpdateTime: bigint;
  },
) {
  const snapshot = await service.store.get(BalanceSnapshot, snapshotId);
  assert(snapshot, `BalanceSnapshot ${snapshotId} should exist`);

  assert.strictEqual(snapshot.storeBalanceID, expectedState.storeBalanceID, "Should reference correct store");
  assert.strictEqual(snapshot.filledAt, expectedState.filledAt, "FilledAt should match");
  assert.strictEqual(snapshot.balance, expectedState.balance, "Balance should match");
  assert.strictEqual(
    snapshot.cumulativeBalanceSeconds,
    expectedState.cumulativeBalanceSeconds,
    "Cumulative should match",
  );
  assert.strictEqual(snapshot.lastUpdateTime, expectedState.lastUpdateTime, "Last update time should match");
}

// Verify Transaction entity state
export async function verifyTransaction(
  service: TestProcessorServer,
  transactionId: string,
  expectedState: {
    storeBalanceID: string;
    signer: string;
    timestamp: bigint;
    type: TransactionType;
    amount: bigint;
    transactionVersion: bigint;
    eventIndex: number;
  },
) {
  const transaction = await service.store.get(Transaction, transactionId);
  assert(transaction, `Transaction ${transactionId} should exist`);

  assert.strictEqual(transaction.storeBalanceID, expectedState.storeBalanceID, "Should reference correct store");
  assert.strictEqual(transaction.signer, expectedState.signer, "Signer should match");
  assert.strictEqual(transaction.timestamp, expectedState.timestamp, "Timestamp should match");
  assert.strictEqual(transaction.type, expectedState.type, "Transaction type should match");
  assert.strictEqual(transaction.amount, expectedState.amount, "Amount should match");
  assert.strictEqual(transaction.transactionVersion, expectedState.transactionVersion, "Version should match");
  assert.strictEqual(transaction.eventIndex, expectedState.eventIndex, "Event index should match");
}

// Verify FungibleAssetStats state
export async function verifyFungibleAssetStats(
  service: TestProcessorServer,
  expectedState: {
    totalDepositCount: number;
    totalWithdrawCount: number;
    uniqueStoreCount: number;
    canopyVaultStoreCount: number;
    lastUpdateTime: bigint;
  },
) {
  const stats = await service.store.get(FungibleAssetStats, "global");
  assert(stats, "FungibleAssetStats should exist");

  assert.strictEqual(stats.totalDepositCount, expectedState.totalDepositCount, "Deposit count should match");
  assert.strictEqual(stats.totalWithdrawCount, expectedState.totalWithdrawCount, "Withdraw count should match");
  assert.strictEqual(stats.uniqueStoreCount, expectedState.uniqueStoreCount, "Unique store count should match");
  assert.strictEqual(
    stats.canopyVaultStoreCount,
    expectedState.canopyVaultStoreCount,
    "Canopy vault store count should match",
  );
  assert.strictEqual(stats.lastUpdateTime, expectedState.lastUpdateTime, "Last update time should match");
}

// Verify that no balance-related entities exist for a store
export async function verifyNoBalanceEntities(service: TestProcessorServer, storeAddress: string) {
  const storeBalance = await service.store.get(StoreBalance, storeAddress);
  assert.strictEqual(storeBalance, undefined, `StoreBalance for ${storeAddress} should not exist`);

  // Check that no snapshots exist (would have ID pattern: storeAddress-1, storeAddress-2, etc.)
  const snapshot1 = await service.store.get(BalanceSnapshot, `${storeAddress}-1`);
  assert.strictEqual(snapshot1, undefined, `No BalanceSnapshot should exist for ${storeAddress}`);
}

// Verify that no transaction exists for a specific version and event index
export async function verifyNoTransaction(service: TestProcessorServer, version: bigint, eventIndex: number) {
  const transactionId = `${version}-${eventIndex}`;
  const transaction = await service.store.get(Transaction, transactionId);
  assert.strictEqual(transaction, undefined, `Transaction ${transactionId} should not exist`);
}

// Helper to create a deposit event data
export function createDepositEventData(store: Address, amount: bigint) {
  return {
    store: store,
    amount: amount.toString(),
  };
}

// Helper to create a withdraw event data
export function createWithdrawEventData(store: Address, amount: bigint) {
  return {
    store: store,
    amount: amount.toString(),
  };
}

// Helper to process a deposit event with cleaner syntax
export async function processDepositEvent(
  processor: any, // TestProcessor type
  store: Address,
  owner: Address,
  amount: bigint,
  timestampSeconds: number,
  version: bigint,
  eventIndex: number = 0,
) {
  await processor.processEvent({
    name: "Deposit",
    data: createDepositEventData(store, amount),
    timestamp: secondsToMicroseconds(timestampSeconds),
    version: version,
    eventIndex: eventIndex,
    sender: owner,
  });
}

// Helper to process a withdraw event with cleaner syntax
export async function processWithdrawEvent(
  processor: any, // TestProcessor type
  store: Address,
  owner: Address,
  amount: bigint,
  timestampSeconds: number,
  version: bigint,
  eventIndex: number = 0,
) {
  await processor.processEvent({
    name: "Withdraw",
    data: createWithdrawEventData(store, amount),
    timestamp: secondsToMicroseconds(timestampSeconds),
    version: version,
    eventIndex: eventIndex,
    sender: owner,
  });
}
