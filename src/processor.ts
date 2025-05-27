import { GLOBAL_CONFIG } from "@sentio/runtime";

import { getSupportedAptosChainId, SupportedAptosChainId } from "./chains.js";
import { setupDualAssetProcessor, setupSingleAssetProcessor } from "./config.js";

const { CHAIN_ID } = process.env;

GLOBAL_CONFIG.execution = {
  sequential: true,
};

if (!CHAIN_ID) {
  throw new Error("please specify CHAIN_ID in .env");
}

const supportedChainId = getSupportedAptosChainId(Number(CHAIN_ID));

if (supportedChainId === SupportedAptosChainId.JESTNET) {
  throw new Error("JESTNET is only for local testing; please set a valid sentio supported CHAIN_ID");
}

// NOTE: for each chain we specify the processors that exist on that chain and
// that we want to include under the same sentio project on the dashboard

switch (supportedChainId) {
  case SupportedAptosChainId.APTOS_TESTNET: {
    // Aptos testnet has modules to be indexed by the following processors

    break;
  }
  case SupportedAptosChainId.APTOS_MAINNET: {
    // Aptos mainnet has modules to be indexed by the following processors

    break;
  }
  case SupportedAptosChainId.MOVEMENT_PORTO: {
    // Movement porto has modules to be indexed by the following processors

    break;
  }
  case SupportedAptosChainId.MOVEMENT_MAINNET: {
    // Movement mainnet has modules to be indexed by the following processors

    setupSingleAssetProcessor(supportedChainId)
    setupDualAssetProcessor(supportedChainId)
    break;
  }
  default: {
    throw new Error(`Unsupported chainId: ${supportedChainId}`);
  }
}
