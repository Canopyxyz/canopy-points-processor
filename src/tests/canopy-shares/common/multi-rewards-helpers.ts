import assert from "assert";
import { TestProcessorServer } from "@sentio/sdk/testing";

import { Address } from "../../../utils/types.js";
import {
  User,
  StakingBalance,
  StakingSnapshot,
  StakingTransaction,
  StakingTransactionType,
  StakingStats,
} from "../../../schema/schema.js";

import { secondsToMicroseconds } from "./utils.js";

// Verify User entity state
export async function verifyUser(
  service: TestProcessorServer,
  userAddress: string,
  expectedState: {
    firstSeenAt: bigint;
  },
) {
  const user = await service.store.get(User, userAddress);
  assert(user, `User ${userAddress} should exist`);

  assert.strictEqual(user.id, userAddress, "User ID should match address");
  assert.strictEqual(user.firstSeenAt, expectedState.firstSeenAt, "First seen at should match");
}

// Verify StakingBalance entity state
export async function verifyStakingBalance(
  service: TestProcessorServer,
  userAddress: string,
  tokenMetadata: string,
  expectedState: {
    vaultID: string;
    stakingToken: string;
    lastKnownBalance: bigint;
    lastObservationTime: bigint;
    cumulativeBalanceSeconds: bigint;
    totalSnapshotCount: number;
  },
) {
  const stakingBalanceId = `${userAddress}-${tokenMetadata}`;
  const stakingBalance = await service.store.get(StakingBalance, stakingBalanceId);
  assert(stakingBalance, `StakingBalance ${stakingBalanceId} should exist`);

  assert.strictEqual(stakingBalance.id, stakingBalanceId, "ID should match");
  assert.strictEqual(stakingBalance.userID, userAddress, "User ID should match");
  assert.strictEqual(stakingBalance.stakingToken, expectedState.stakingToken, "Staking token should match");
  assert.strictEqual(stakingBalance.vaultID, expectedState.vaultID, "Vault ID should match");
  assert.strictEqual(stakingBalance.lastKnownBalance, expectedState.lastKnownBalance, "Balance should match");
  assert.strictEqual(
    stakingBalance.lastObservationTime,
    expectedState.lastObservationTime,
    "Observation time should match",
  );
  assert.strictEqual(
    stakingBalance.cumulativeBalanceSeconds,
    expectedState.cumulativeBalanceSeconds,
    "Cumulative should match",
  );
  assert.strictEqual(
    stakingBalance.totalSnapshotCount,
    expectedState.totalSnapshotCount,
    "Snapshot count should match",
  );
}

// Verify StakingSnapshot entity state
export async function verifyStakingSnapshot(
  service: TestProcessorServer,
  snapshotId: string,
  expectedState: {
    stakingBalanceID: string;
    filledAt: bigint;
    balance: bigint;
    cumulativeBalanceSeconds: bigint;
    lastUpdateTime: bigint;
  },
) {
  const snapshot = await service.store.get(StakingSnapshot, snapshotId);
  assert(snapshot, `StakingSnapshot ${snapshotId} should exist`);

  assert.strictEqual(
    snapshot.stakingBalanceID,
    expectedState.stakingBalanceID,
    "Should reference correct staking balance",
  );
  assert.strictEqual(snapshot.filledAt, expectedState.filledAt, "FilledAt should match");
  assert.strictEqual(snapshot.balance, expectedState.balance, "Balance should match");
  assert.strictEqual(
    snapshot.cumulativeBalanceSeconds,
    expectedState.cumulativeBalanceSeconds,
    "Cumulative should match",
  );
  assert.strictEqual(snapshot.lastUpdateTime, expectedState.lastUpdateTime, "Last update time should match");
}

// Verify StakingTransaction entity state
export async function verifyStakingTransaction(
  service: TestProcessorServer,
  transactionId: string,
  expectedState: {
    stakingBalanceID: string;
    userID: string;
    timestamp: bigint;
    type: StakingTransactionType;
    amount: bigint;
    transactionVersion: bigint;
    eventIndex: number;
  },
) {
  const transaction = await service.store.get(StakingTransaction, transactionId);
  assert(transaction, `StakingTransaction ${transactionId} should exist`);

  assert.strictEqual(
    transaction.stakingBalanceID,
    expectedState.stakingBalanceID,
    "Should reference correct staking balance",
  );
  assert.strictEqual(transaction.userID, expectedState.userID, "User ID should match");
  assert.strictEqual(transaction.timestamp, expectedState.timestamp, "Timestamp should match");
  assert.strictEqual(transaction.type, expectedState.type, "Transaction type should match");
  assert.strictEqual(transaction.amount, expectedState.amount, "Amount should match");
  assert.strictEqual(transaction.transactionVersion, expectedState.transactionVersion, "Version should match");
  assert.strictEqual(transaction.eventIndex, expectedState.eventIndex, "Event index should match");
}

// Verify StakingStats state
export async function verifyStakingStats(
  service: TestProcessorServer,
  expectedState: {
    totalStakeCount: number;
    totalUnstakeCount: number;
    uniqueUserCount: number;
    canopyVaultStakerCount: number;
    lastUpdateTime: bigint;
  },
) {
  const stats = await service.store.get(StakingStats, "global");
  assert(stats, "StakingStats should exist");

  assert.strictEqual(stats.totalStakeCount, expectedState.totalStakeCount, "Stake count should match");
  assert.strictEqual(stats.totalUnstakeCount, expectedState.totalUnstakeCount, "Unstake count should match");
  assert.strictEqual(stats.uniqueUserCount, expectedState.uniqueUserCount, "Unique user count should match");
  assert.strictEqual(
    stats.canopyVaultStakerCount,
    expectedState.canopyVaultStakerCount,
    "Canopy vault staker count should match",
  );
  assert.strictEqual(stats.lastUpdateTime, expectedState.lastUpdateTime, "Last update time should match");
}

// Verify that no staking entities exist for a user-token combination
export async function verifyNoStakingEntities(
  service: TestProcessorServer,
  userAddress: string,
  tokenMetadata: string,
) {
  const stakingBalanceId = `${userAddress}-${tokenMetadata}`;
  const stakingBalance = await service.store.get(StakingBalance, stakingBalanceId);
  assert.strictEqual(stakingBalance, undefined, `StakingBalance for ${stakingBalanceId} should not exist`);

  // Check that no snapshots exist
  const snapshot1 = await service.store.get(StakingSnapshot, `${stakingBalanceId}-1`);
  assert.strictEqual(snapshot1, undefined, `No StakingSnapshot should exist for ${stakingBalanceId}`);
}

// Verify that no staking transaction exists for a specific version and event index
export async function verifyNoStakingTransaction(service: TestProcessorServer, version: bigint, eventIndex: number) {
  const transactionId = `${version}-${eventIndex}`;
  const transaction = await service.store.get(StakingTransaction, transactionId);
  assert.strictEqual(transaction, undefined, `StakingTransaction ${transactionId} should not exist`);
}

// Helper to create a stake event data
export function createStakeEventData(user: Address, stakingToken: Address, amount: bigint) {
  return {
    user: user,
    staking_token: {
      inner: stakingToken,
    },
    amount: amount.toString(),
  };
}

// Helper to create an unstake event data
export function createUnstakeEventData(user: Address, stakingToken: Address, amount: bigint) {
  return {
    user: user,
    staking_token: {
      inner: stakingToken,
    },
    amount: amount.toString(),
  };
}

// Helper to process a stake event with cleaner syntax
export async function processStakeEvent(
  processor: any, // TestProcessor type
  user: Address,
  stakingToken: Address,
  amount: bigint,
  timestampSeconds: number,
  version: bigint,
  eventIndex: number = 0,
) {
  await processor.processEvent({
    name: "StakeEvent",
    data: createStakeEventData(user, stakingToken, amount),
    timestamp: secondsToMicroseconds(timestampSeconds),
    version: version,
    eventIndex: eventIndex,
  });
}

// Helper to process an unstake event with cleaner syntax
export async function processUnstakeEvent(
  processor: any, // TestProcessor type
  user: Address,
  stakingToken: Address,
  amount: bigint,
  timestampSeconds: number,
  version: bigint,
  eventIndex: number = 0,
) {
  await processor.processEvent({
    name: "WithdrawEvent",
    data: createUnstakeEventData(user, stakingToken, amount),
    timestamp: secondsToMicroseconds(timestampSeconds),
    version: version,
    eventIndex: eventIndex,
  });
}
