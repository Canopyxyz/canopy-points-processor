import { oapp as single_asset_oapp_movement } from "./types/aptos/movement-mainnet/oapp_single_asset.js";
import { oapp as dual_asset_oapp_movement } from "./types/aptos/movement-mainnet/oapp_dual_asset.js";

import { singleAssetProcessor } from "./processors/single-asset-processor.js";
import { dualAssetProcessor } from "./processors/dual-asset-processor.js";

import { SupportedAptosChainId } from "./chains.js";

// - - - single asset - - -

export const SINGLE_ASSET_OAPP_START_VERSIONS: Partial<Record<SupportedAptosChainId, number>> = {
  [SupportedAptosChainId.JESTNET]: 0,
  [SupportedAptosChainId.MOVEMENT_MAINNET]: 1_166_296,
};

export function getSingleAssetBaseProcessor(chainId: SupportedAptosChainId) {
  switch (chainId) {
    case SupportedAptosChainId.JESTNET: // use MOVEMENT_MAINNET base processor for JESTNET
    case SupportedAptosChainId.MOVEMENT_MAINNET: {
      return single_asset_oapp_movement;
    }
    default: {
      throw new Error(`SingleAssetBaseProcessor is not defined for chain ${chainId}`);
    }
  }
}

export function setupSingleAssetProcessor(chainId: SupportedAptosChainId) {
  const singleAssetStartVersion = SINGLE_ASSET_OAPP_START_VERSIONS[chainId];
  if (singleAssetStartVersion === undefined) {
    throw new Error(`Expected SINGLE_ASSET_OAPP_START_VERSIONS to be defined for chain: ${chainId}`);
  }
  singleAssetProcessor(chainId, singleAssetStartVersion, getSingleAssetBaseProcessor(chainId));
}

// - - - dual asset - - -

export const DUAL_ASSET_OAPP_START_VERSIONS: Partial<Record<SupportedAptosChainId, number>> = {
  [SupportedAptosChainId.JESTNET]: 0,
  [SupportedAptosChainId.MOVEMENT_MAINNET]: 1_046_359,
};

export function getDualAssetBaseProcessor(chainId: SupportedAptosChainId) {
  switch (chainId) {
    case SupportedAptosChainId.JESTNET: // use MOVEMENT_MAINNET base processor for JESTNET
    case SupportedAptosChainId.MOVEMENT_MAINNET: {
      return dual_asset_oapp_movement;
    }
    default: {
      throw new Error(`DualAssetBaseProcessor is not defined for chain ${chainId}`);
    }
  }
}

export function setupDualAssetProcessor(chainId: SupportedAptosChainId) {
  const dualAssetStartVersion = DUAL_ASSET_OAPP_START_VERSIONS[chainId];
  if (dualAssetStartVersion === undefined) {
    throw new Error(`Expected DUAL_ASSET_OAPP_START_VERSIONS to be defined for chain: ${chainId}`);
  }
  dualAssetProcessor(chainId, dualAssetStartVersion, getDualAssetBaseProcessor(chainId));
}
