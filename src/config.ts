import { vault as canopy_vault_movement } from "./types/aptos/movement-mainnet/satay.js";
import { fungible_asset as fungible_asset_movement } from "./types/aptos/movement-mainnet/aptos_std.js";
import { multi_rewards as multi_rewards_movement } from "./types/aptos/movement-mainnet/multi_rewards.js";

import { canopyVaultProcessor } from "./processors/canopy-vault-processor.js";
import { canopyVaultShareFungibleAssetProcessor } from "./processors/fungible-asset-processor.js";
import { canopyMultiRewardsProcessor } from "./processors/multi-rewards-processor.js";

import { SupportedAptosChainId } from "./chains.js";

// - - - canopy vault - - -

export const CANOPY_VAULT_START_VERSIONS: Partial<Record<SupportedAptosChainId, number>> = {
  [SupportedAptosChainId.JESTNET]: 0,
  [SupportedAptosChainId.MOVEMENT_MAINNET]: 86_487,
};

export function getCanopyVaultBaseProcessor(chainId: SupportedAptosChainId) {
  switch (chainId) {
    case SupportedAptosChainId.JESTNET: // use MOVEMENT_MAINNET base processor for JESTNET
    case SupportedAptosChainId.MOVEMENT_MAINNET: {
      return canopy_vault_movement;
    }
    default: {
      throw new Error(`CanopyVaultBaseProcessor is not defined for chain ${chainId}`);
    }
  }
}

export function setupCanopyVaultProcessor(chainId: SupportedAptosChainId) {
  const canopyVaultStartVersion = CANOPY_VAULT_START_VERSIONS[chainId];
  if (canopyVaultStartVersion === undefined) {
    throw new Error(`Expected CANOPY_VAULT_START_VERSIONS to be defined for chain: ${chainId}`);
  }
  canopyVaultProcessor(chainId, canopyVaultStartVersion, getCanopyVaultBaseProcessor(chainId));
}

// - - - canopy vault shares fungible asset - - -

export function getCanopyVaultSharesBaseProcessor(chainId: SupportedAptosChainId) {
  switch (chainId) {
    case SupportedAptosChainId.JESTNET: // use MOVEMENT_MAINNET base processor for JESTNET
    case SupportedAptosChainId.MOVEMENT_MAINNET: {
      return fungible_asset_movement;
    }
    default: {
      throw new Error(`CanopyVaultSharesBaseProcessor is not defined for chain ${chainId}`);
    }
  }
}

export function setupCanopyVaultShareFungibleAssetProcessor(chainId: SupportedAptosChainId) {
  // NOTE: since we only care about indexing for canopy vault share fungible_asset events
  const canopyVaultStartVersion = CANOPY_VAULT_START_VERSIONS[chainId];
  if (canopyVaultStartVersion === undefined) {
    throw new Error(`Expected CANOPY_VAULT_START_VERSIONS to be defined for chain: ${chainId}`);
  }
  canopyVaultShareFungibleAssetProcessor(chainId, canopyVaultStartVersion, getCanopyVaultSharesBaseProcessor(chainId));
}

// - - - canopy vault shares multi rewards staking - - -

export function getCanopyVaultSharesMultiRewardsBaseProcessor(chainId: SupportedAptosChainId) {
  switch (chainId) {
    case SupportedAptosChainId.JESTNET: // use MOVEMENT_MAINNET base processor for JESTNET
    case SupportedAptosChainId.MOVEMENT_MAINNET: {
      return multi_rewards_movement;
    }
    default: {
      throw new Error(`CanopyVaultSharesMultiRewardsBaseProcessor is not defined for chain ${chainId}`);
    }
  }
}

export function setupCanopyVaultShareMultiRewardsProcessor(chainId: SupportedAptosChainId) {
  // NOTE: since we only care about indexing for canopy vault share FA multi_rewards Stake&Withdraw events
  const canopyVaultStartVersion = CANOPY_VAULT_START_VERSIONS[chainId];
  if (canopyVaultStartVersion === undefined) {
    throw new Error(`Expected CANOPY_VAULT_START_VERSIONS to be defined for chain: ${chainId}`);
  }
  canopyMultiRewardsProcessor(chainId, canopyVaultStartVersion, getCanopyVaultSharesMultiRewardsBaseProcessor(chainId));
}
