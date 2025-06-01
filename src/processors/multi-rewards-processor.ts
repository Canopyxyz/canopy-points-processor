import { AptosContext } from "@sentio/sdk/aptos";
import { Store } from "@sentio/sdk/store";

import {
  StakingBalance,
  StakingSnapshot,
  StakingTransaction,
  StakingTransactionType,
  StakingStats,
  Vault,
  User,
} from "../schema/schema.js";

import { multi_rewards as multi_rewards_movement } from "../types/aptos/movement-mainnet/multi_rewards.js";

import { SupportedAptosChainId } from "../chains.js";
import { getSender, getVersionForViewCall } from "./t-state.js";

import { getTimestampInSeconds } from "../utils/helpers.js";
import { MoveObjectType } from "../utils/types.js";

type MultiRewardsProcessor = typeof multi_rewards_movement;

// Constants
const SNAPSHOT_LIFETIME_SECONDS = BigInt(24 * 60 * 60); // 24 hours

// Core processor setup
export function canopyMultiRewardsProcessor(
  supportedChainId: SupportedAptosChainId,
  startVersion: number,
  baseProcessor: MultiRewardsProcessor,
) {
  baseProcessor
    .bind({ startVersion })
    .onEventStakeEvent(async (event, ctx) => {
      await processStakingChange(
        supportedChainId,
        event.data_decoded.user.toString(),
        event.data_decoded.staking_token.toString(),
        event.data_decoded.amount,
        StakingTransactionType.STAKE,
        ctx,
      );
    })
    .onEventWithdrawEvent(async (event, ctx) => {
      await processStakingChange(
        supportedChainId,
        event.data_decoded.user.toString(),
        event.data_decoded.staking_token.toString(),
        event.data_decoded.amount,
        StakingTransactionType.UNSTAKE,
        ctx,
      );
    });
}

// Main processing function for both stake and unstake events
async function processStakingChange(
  chainId: SupportedAptosChainId,
  userAddress: string,
  stakingTokenMetadata: string,
  amount: bigint,
  transactionType: StakingTransactionType,
  ctx: AptosContext,
): Promise<void> {
  const store = ctx.store;
  const timestamp = getTimestampInSeconds(ctx.getTimestamp());

  // Check if this staking token is a Canopy vault share
  const vaults = await store.list(Vault, [{ field: "sharesMetadata", op: "=", value: stakingTokenMetadata }]);

  // Only process if this is a Canopy vault share token
  if (vaults.length === 0) {
    return;
  }

  const vault = vaults[0];

  // Get or create stats
  const stats = await getOrCreateStakingStats(store, timestamp);

  // Get or create User
  let user = await store.get(User, userAddress);
  if (!user) {
    user = new User({
      id: userAddress,
      firstSeenAt: timestamp,
    });

    // Update unique user count
    stats.uniqueUserCount += 1;
    stats.canopyVaultStakerCount += 1;
  }

  // Get or create StakingBalance
  const stakingBalanceId = `${userAddress}-${stakingTokenMetadata}`;
  let stakingBalance = await store.get(StakingBalance, stakingBalanceId);

  if (!stakingBalance) {
    // First time seeing this user-token combination
    stakingBalance = new StakingBalance({
      id: stakingBalanceId,
      userID: userAddress,
      stakingToken: stakingTokenMetadata,
      vaultID: vault.id,
      lastKnownBalance: BigInt(0),
      lastObservationTime: timestamp,
      cumulativeBalanceSeconds: BigInt(0),
      totalSnapshotCount: 0,
    });
  }

  // Calculate cumulative balance-seconds before updating balance
  const timeDelta = timestamp - stakingBalance.lastObservationTime;
  const additionalBalanceSeconds = stakingBalance.lastKnownBalance * timeDelta;
  stakingBalance.cumulativeBalanceSeconds = stakingBalance.cumulativeBalanceSeconds + additionalBalanceSeconds;

  // Update balance based on transaction type
  const previousBalance = stakingBalance.lastKnownBalance;
  if (transactionType === StakingTransactionType.STAKE) {
    stakingBalance.lastKnownBalance = previousBalance + amount;
    stats.totalStakeCount += 1;
  } else {
    stakingBalance.lastKnownBalance = previousBalance > amount ? previousBalance - amount : BigInt(0);
    stats.totalUnstakeCount += 1;
  }
  stakingBalance.lastObservationTime = timestamp;

  // Create transaction record
  const transaction = new StakingTransaction({
    id: `${ctx.version}-${ctx.eventIndex}`,
    stakingBalanceID: stakingBalanceId,
    userID: userAddress,
    timestamp: timestamp,
    type: transactionType,
    amount: amount,
    transactionVersion: BigInt(ctx.version),
    eventIndex: ctx.eventIndex,
  });

  // Handle snapshot creation/update
  let snapshot: StakingSnapshot | undefined;

  // Get the most recent snapshot if it exists
  if (stakingBalance.totalSnapshotCount > 0) {
    const currentSnapshotId = `${stakingBalanceId}-${stakingBalance.totalSnapshotCount}`;
    snapshot = await store.get(StakingSnapshot, currentSnapshotId);

    // Check if we need a new snapshot (current one is older than 24 hours)
    if (snapshot && timestamp - snapshot.filledAt > SNAPSHOT_LIFETIME_SECONDS) {
      snapshot = undefined; // Force creation of new snapshot
    }
  }

  if (!snapshot) {
    // Create new snapshot
    stakingBalance.totalSnapshotCount += 1;
    snapshot = new StakingSnapshot({
      id: `${stakingBalanceId}-${stakingBalance.totalSnapshotCount}`,
      stakingBalanceID: stakingBalanceId,
      filledAt: timestamp,
      balance: stakingBalance.lastKnownBalance,
      cumulativeBalanceSeconds: stakingBalance.cumulativeBalanceSeconds,
      lastUpdateTime: timestamp,
    });
  } else {
    // Update existing snapshot
    // First update cumulative balance-seconds for the snapshot
    const snapshotTimeDelta = timestamp - snapshot.lastUpdateTime;
    const snapshotAdditionalBalanceSeconds = snapshot.balance * snapshotTimeDelta;
    snapshot.cumulativeBalanceSeconds = snapshot.cumulativeBalanceSeconds + snapshotAdditionalBalanceSeconds;

    // Then update balance and timestamp
    snapshot.balance = stakingBalance.lastKnownBalance;
    snapshot.lastUpdateTime = timestamp;
  }

  // Update stats timestamp
  stats.lastUpdateTime = timestamp;

  // Persist all entities
  await store.upsert(user);
  await store.upsert(stakingBalance);
  await store.upsert(transaction);
  await store.upsert(snapshot);
  await store.upsert(stats);
}

// Helper Functions

// Get or create staking stats singleton
async function getOrCreateStakingStats(store: Store, timestamp: bigint): Promise<StakingStats> {
  const STATS_ID = "global";
  let stats = await store.get(StakingStats, STATS_ID);

  if (!stats) {
    stats = new StakingStats({
      id: STATS_ID,
      totalStakeCount: 0,
      totalUnstakeCount: 0,
      uniqueUserCount: 0,
      canopyVaultStakerCount: 0,
      lastUpdateTime: timestamp,
    });
  }

  return stats;
}
