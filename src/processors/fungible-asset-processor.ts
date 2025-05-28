import { AptosContext } from "@sentio/sdk/aptos";
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
import { getTimestampInSeconds, normalizeToDayTimestamp } from "../utils/helpers.js";

import { SupportedAptosChainId } from "../chains.js";

type FungibleAssetProcessor = typeof fungible_asset_movement;

// Core processor setup
export function canopyVaultShareFungibleAssetProcessor(
  supportedChainId: SupportedAptosChainId,
  startVersion: number,
  baseProcessor: FungibleAssetProcessor,
) {
  baseProcessor
    .bind({ startVersion })
    .onEventDeposit(async (event, ctx) => {
      await processBalanceChange(
        event.data_decoded.store.toString(),
        event.data_decoded.amount,
        TransactionType.DEPOSIT,
        ctx,
      );
    })
    .onEventWithdraw(async (event, ctx) => {
      await processBalanceChange(
        event.data_decoded.store.toString(),
        event.data_decoded.amount,
        TransactionType.WITHDRAW,
        ctx,
      );
    });
}

// Main processing function for both deposits and withdrawals
async function processBalanceChange(
  storeAddress: string,
  amount: bigint,
  transactionType: TransactionType,
  ctx: AptosContext,
): Promise<void> {
  const store = ctx.store;
  const timestamp = getTimestampInSeconds(ctx.getTimestamp());
  const signer = ctx.transaction.sender;

  // Check if we have cached metadata for this store
  let storeMetadata = await store.get(StoreMetadataCache, storeAddress);

  // Get or create stats
  const stats = await getOrCreateFungibleAssetStats(store, timestamp);

  if (!storeMetadata) {
    // Cache miss - need to make view call
    const client = ctx.getClient();

    try {
      const result = await client.view({
        payload: {
          function: "0x1::fungible_asset::store_metadata",
          functionArguments: [storeAddress],
        },
      });

      const metadataAddress = result[0]?.toString();

      if (!metadataAddress) {
        throw new Error("UNEXPECTED: store_metadata returned no FA metadata");
      }

      // Check if this metadata corresponds to a Canopy vault
      const vaults = await store.list(Vault, [{ field: "sharesMetadata", op: "=", value: metadataAddress }]);

      const isCanopyVault = vaults.length > 0; // should be length 1 i.e. only 1 vault

      // Determine if this is a primary store
      let owner: string | undefined = undefined;
      if (isCanopyVault) {
        // Check if this store is the signer's primary store
        const primaryStoreResult = await client.view({
          payload: {
            function: "0x1::primary_fungible_store::primary_store_address",
            functionArguments: [signer, metadataAddress],
          },
        });

        const primaryStoreAddress = primaryStoreResult[0]?.toString();
        if (primaryStoreAddress === storeAddress) {
          owner = signer;
        }
      }

      // Create cache entry
      storeMetadata = new StoreMetadataCache({
        id: storeAddress,
        metadata: metadataAddress,
        owner: owner,
        isCanopyVault: isCanopyVault,
        vaultID: isCanopyVault ? vaults[0].id : undefined,
      });

      await store.upsert(storeMetadata);
    } catch (error) {
      console.error(`Failed to get metadata for store ${storeAddress}:`, error);
      return;
    }
  }

  // Only process if this is a Canopy vault share
  if (!storeMetadata.isCanopyVault) {
    return;
  }

  const canopyVault = (await storeMetadata.vault())!;

  // Get or create StoreBalance
  const storeBalanceId = `${canopyVault.id}-${storeAddress}`;
  let storeBalance = await store.get(StoreBalance, storeBalanceId);

  if (!storeBalance) {
    // First time seeing this store-vault combination
    storeBalance = new StoreBalance({
      id: storeBalanceId,
      fungible_store: storeAddress,
      vaultID: canopyVault.id,
      lastKnownBalance: BigInt(0),
      lastObservationTime: timestamp,
    });

    // Update unique store count
    stats.uniqueStoreCount += 1;
    stats.canopyVaultStoreCount += 1;
  }

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
    storeBalanceID: storeBalance.id,
    signer: signer,
    timestamp: timestamp,
    type: transactionType,
    amount: amount,
    transactionVersion: BigInt(ctx.version),
    eventIndex: ctx.eventIndex,
  });

  // Update or create daily snapshot
  const dayTimestamp = normalizeToDayTimestamp(timestamp);
  const snapshotId = `${storeBalanceId}-${dayTimestamp}`;
  let snapshot = await store.get(BalanceSnapshot, snapshotId);

  if (!snapshot) {
    snapshot = new BalanceSnapshot({
      id: snapshotId,
      storeBalanceID: storeBalance.id,
      dayTimestamp: dayTimestamp,
      balance: storeBalance.lastKnownBalance,
      lastUpdateTime: timestamp,
    });
  } else {
    // Update existing snapshot
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
