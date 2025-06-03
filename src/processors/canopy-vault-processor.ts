import { Store } from "@sentio/sdk/store";

import { Vault, VaultStats } from "../schema/schema.js";

import { vault as canopy_vault_movement } from "../types/aptos/movement-mainnet/satay.js";

import { SupportedAptosChainId } from "../chains.js";
import { getTimestampInSeconds, padAptosAddress } from "../utils/helpers.js";

type CanopyVaultProcessor = typeof canopy_vault_movement;

// Core processor setup
export function canopyVaultProcessor(
  supportedChainId: SupportedAptosChainId,
  startVersion: number,
  baseProcessor: CanopyVaultProcessor,
) {
  baseProcessor.bind({ startVersion }).onEventVaultCreated(async (event, ctx) => {
    const store = ctx.store;
    const timestamp = getTimestampInSeconds(ctx.getTimestamp());

    const vaultAddress = padAptosAddress(event.data_decoded.vault);
    const vaultSharesAddress = padAptosAddress(event.data_decoded.shares_metadata);

    // Create new Vault entity
    const vaultEntity = new Vault({
      id: vaultAddress,
      createdAt: timestamp,
      sharesMetadata: vaultSharesAddress,
      createdAtVersion: BigInt(ctx.version),
    });

    // Get or create stats singleton
    const stats = await getOrCreateVaultStats(store, timestamp);

    // Update stats
    stats.totalVaultCount += 1;
    stats.lastUpdateTime = timestamp;

    // Persist entities
    await store.upsert(vaultEntity);
    await store.upsert(stats);

    // Log for monitoring
    console.log(`New Canopy vault created: ${vaultEntity.id} with shares metadata: ${vaultEntity.sharesMetadata}`);
  });
}

// Get or create vault stats singleton entity
async function getOrCreateVaultStats(store: Store, timestamp: bigint): Promise<VaultStats> {
  const STATS_ID = "global";
  let stats = await store.get(VaultStats, STATS_ID);

  if (!stats) {
    stats = new VaultStats({
      id: STATS_ID,
      totalVaultCount: 0,
      lastUpdateTime: timestamp,
    });
  }

  return stats;
}
