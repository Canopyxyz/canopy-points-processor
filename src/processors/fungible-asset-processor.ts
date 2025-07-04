import { AptosContext, LATEST_LEDGER_VERSION } from "@sentio/sdk/aptos";
import { Store } from "@sentio/sdk/store";

import {
  StoreMetadataCache,
  StoreBalance,
  BalanceSnapshot,
  Transaction,
  TransactionType,
  FungibleAssetStats,
  Vault,
} from "../schema/schema.js";

import { fungible_asset as fungible_asset_movement } from "../types/aptos/movement-mainnet/aptos_std.js";
import { getTimestampInSeconds, padAptosAddress } from "../utils/helpers.js";

import { SupportedAptosChainId } from "../chains.js";
import { getSender } from "./t-state.js";
import { MoveObjectType } from "../utils/types.js";

type FungibleAssetProcessor = typeof fungible_asset_movement;

type FungibleAssetInstance = InstanceType<FungibleAssetProcessor>;

// Extract the event types from the instance methods
type DepositEventHandler = Parameters<FungibleAssetInstance["onEventDeposit"]>[0];
type DepositEvent = Parameters<DepositEventHandler>[0];

type WithdrawEventHandler = Parameters<FungibleAssetInstance["onEventWithdraw"]>[0];
type WithdrawEvent = Parameters<WithdrawEventHandler>[0];

// Constants
const SNAPSHOT_LIFETIME_SECONDS = BigInt(24 * 60 * 60); // 24 hours

// Core processor setup
export function canopyVaultShareFungibleAssetProcessor(
  supportedChainId: SupportedAptosChainId,
  startVersion: number,
  baseProcessor: FungibleAssetProcessor,
) {
  baseProcessor
    .bind({ startVersion })
    .onEventDeposit(
      async (event, ctx) => {
        await processBalanceChange(
          supportedChainId,
          padAptosAddress(event.data_decoded.store),
          event.data_decoded.amount,
          TransactionType.DEPOSIT,
          ctx,
        );
      },
      {
        partitionKey: (event: DepositEvent) => event.data_decoded.store,
      },
    )
    .onEventWithdraw(
      async (event, ctx) => {
        await processBalanceChange(
          supportedChainId,
          padAptosAddress(event.data_decoded.store),
          event.data_decoded.amount,
          TransactionType.WITHDRAW,
          ctx,
        );
      },
      {
        partitionKey: (event: WithdrawEvent) => event.data_decoded.store,
      },
    );
}

// Main processing function for both deposits and withdrawals
async function processBalanceChange(
  chainId: SupportedAptosChainId,
  storeAddress: string,
  amount: bigint,
  transactionType: TransactionType,
  ctx: AptosContext,
): Promise<void> {
  if (!ctx.transaction.success) {
    // if a tx wasn't successful(and aborted) then this event was likely just for paying native fees
    return;
  }
  const store = ctx.store;
  const timestamp = getTimestampInSeconds(ctx.getTimestamp());
  const signer = getSender(chainId, ctx);

  // Check if we have cached metadata for this store
  let storeMetadata = await store.get(StoreMetadataCache, storeAddress);

  if (!storeMetadata) {
    let metadataAddress: string | null = null;

    const onJestnet = chainId === SupportedAptosChainId.JESTNET;
    if (!onJestnet) {
      metadataAddress = extractMetadataFromChanges(ctx, storeAddress);
    }

    // If not found in changes and ONLY on JESTNET, fall back to view call
    if (!metadataAddress && onJestnet) {
      const client = ctx.getClient();

      // Try latest version first, fallback to context version
      for (const ledgerVersion of [LATEST_LEDGER_VERSION, undefined]) {
        try {
          const result = await client.view({
            payload: {
              function: "0x1::fungible_asset::store_metadata",
              typeArguments: ["0x1::fungible_asset::FungibleStore"],
              functionArguments: [storeAddress],
            },
            ...(ledgerVersion !== undefined && { options: { ledgerVersion } }),
          });
          metadataAddress = padAptosAddress((result[0] as unknown as MoveObjectType).inner);
          break; // Success, exit loop
        } catch (error) {
          if (ledgerVersion === undefined) throw error; // Re-throw on final attempt
          // Otherwise, continue to next iteration
          console.warn(`view failed on latest FungibleStore has likely been deleted: ${storeAddress}`);
        }
      }
    }

    if (!metadataAddress!) {
      throw new Error("UNEXPECTED: store_metadata returned no FA metadata");
    }

    // Check if this metadata corresponds to a Canopy vault
    const vaults = await store.list(Vault, [{ field: "sharesMetadata", op: "=", value: metadataAddress }]);

    const isCanopyVault = vaults.length > 0; // should be length 1 i.e. only 1 vault

    // Create cache entry
    storeMetadata = new StoreMetadataCache({
      id: storeAddress,
      metadata: metadataAddress,
      isCanopyVault: isCanopyVault,
      vaultID: isCanopyVault ? vaults[0].id : undefined,
    });

    await store.upsert(storeMetadata);
  }

  // Only process if this is a Canopy vault share
  if (!storeMetadata.isCanopyVault) {
    return;
  }

  const stats = await getOrCreateFungibleAssetStats(store, timestamp);

  const canopyVault = (await storeMetadata.vault())!;

  // Get or create StoreBalance
  let storeBalance = await store.get(StoreBalance, storeAddress);

  if (!storeBalance) {
    // First time seeing this store
    storeBalance = new StoreBalance({
      id: storeAddress,
      fungible_store: storeAddress,
      vaultID: canopyVault.id,
      lastKnownBalance: BigInt(0),
      lastObservationTime: timestamp,
      cumulativeBalanceSeconds: BigInt(0),
      totalSnapshotCount: 0,
    });

    // Update unique store count
    stats.uniqueStoreCount += 1;
    stats.canopyVaultStoreCount += 1;
  }

  // Calculate cumulative balance-seconds before updating balance
  const timeDelta = timestamp - storeBalance.lastObservationTime;
  const additionalBalanceSeconds = storeBalance.lastKnownBalance * timeDelta;
  storeBalance.cumulativeBalanceSeconds = storeBalance.cumulativeBalanceSeconds + additionalBalanceSeconds;

  // Update balance based on transaction type
  const previousBalance = storeBalance.lastKnownBalance;
  if (transactionType === TransactionType.DEPOSIT) {
    storeBalance.lastKnownBalance = previousBalance + amount;
    stats.totalDepositCount += 1;
  } else {
    storeBalance.lastKnownBalance = previousBalance > amount ? previousBalance - amount : BigInt(0);
    stats.totalWithdrawCount += 1;
  }
  storeBalance.lastObservationTime = timestamp;

  // Create transaction record
  const transaction = new Transaction({
    id: `${ctx.version}-${ctx.eventIndex}`,
    storeBalanceID: storeAddress,
    signer: signer,
    timestamp: timestamp,
    type: transactionType,
    amount: amount,
    transactionVersion: BigInt(ctx.version),
    eventIndex: ctx.eventIndex,
  });

  // Handle snapshot creation/update
  let snapshot: BalanceSnapshot | undefined;

  // Get the most recent snapshot if it exists
  if (storeBalance.totalSnapshotCount > 0) {
    const currentSnapshotId = `${storeAddress}-${storeBalance.totalSnapshotCount}`;
    snapshot = await store.get(BalanceSnapshot, currentSnapshotId);

    // Check if we need a new snapshot (current one is older than 24 hours)
    if (snapshot && timestamp - snapshot.filledAt > SNAPSHOT_LIFETIME_SECONDS) {
      snapshot = undefined; // Force creation of new snapshot
    }
  }

  if (!snapshot) {
    // Create new snapshot
    storeBalance.totalSnapshotCount += 1;
    snapshot = new BalanceSnapshot({
      id: `${storeAddress}-${storeBalance.totalSnapshotCount}`,
      storeBalanceID: storeAddress,
      filledAt: timestamp,
      balance: storeBalance.lastKnownBalance,
      cumulativeBalanceSeconds: storeBalance.cumulativeBalanceSeconds,
      lastUpdateTime: timestamp,
    });
  } else {
    // Update existing snapshot
    // First update cumulative balance-seconds for the snapshot
    const snapshotTimeDelta = timestamp - snapshot.lastUpdateTime;
    const snapshotAdditionalBalanceSeconds = snapshot.balance * snapshotTimeDelta;
    snapshot.cumulativeBalanceSeconds = snapshot.cumulativeBalanceSeconds + snapshotAdditionalBalanceSeconds;

    // Then update balance and timestamp
    snapshot.balance = storeBalance.lastKnownBalance;
    snapshot.lastUpdateTime = timestamp;
  }

  // Update stats timestamp
  stats.lastUpdateTime = timestamp;

  // Persist all entities
  await store.upsert(storeBalance);
  await store.upsert(transaction);
  await store.upsert(snapshot);
  await store.upsert(stats);
}

// Helper Functions

// Get or create fungible asset stats singleton
async function getOrCreateFungibleAssetStats(store: Store, timestamp: bigint): Promise<FungibleAssetStats> {
  const STATS_ID = "global";
  let stats = await store.get(FungibleAssetStats, STATS_ID);

  if (!stats) {
    stats = new FungibleAssetStats({
      id: STATS_ID,
      totalDepositCount: 0,
      totalWithdrawCount: 0,
      uniqueStoreCount: 0,
      canopyVaultStoreCount: 0,
      lastUpdateTime: timestamp,
    });
  }

  return stats;
}

interface FungibleStoreData {
  balance: string;
  frozen: boolean;
  metadata: MoveObjectType;
}

// TODO: consider extending WriteSetChangeWriteResource from the sentio sdk
interface WriteResourceChange {
  type: "write_resource";
  address: string;
  state_key_hash: string;
  data: {
    type: string;
    data: FungibleStoreData;
  };
}

/**
 * Extracts fungible asset metadata address from transaction changes
 * @param ctx - The Aptos context containing transaction data
 * @param storeAddress - The padded store address to look for
 * @returns The padded metadata address if found, null otherwise
 */
function extractMetadataFromChanges(ctx: AptosContext, storeAddress: string): string | null {
  // Ensure we have changes to search through
  if (!ctx.transaction.changes || ctx.transaction.changes.length === 0) {
    return null;
  }

  // Search through all changes
  for (const change of ctx.transaction.changes) {
    // Only interested in write_resource changes
    if (change.type !== "write_resource") {
      continue;
    }

    const writeChange = change as WriteResourceChange;

    // Check if this is a FungibleStore change for our target address
    if (
      writeChange.data.type === "0x1::fungible_asset::FungibleStore" &&
      padAptosAddress(writeChange.address) === storeAddress
    ) {
      // Extract and pad the metadata address
      const metadataAddress = writeChange.data.data.metadata.inner;
      return padAptosAddress(metadataAddress);
    }
  }

  // Not found in changes
  return null;
}
