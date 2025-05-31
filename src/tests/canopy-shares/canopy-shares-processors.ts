import { SupportedAptosChainId } from "../../chains.js";
import {
  setupCanopyVaultProcessor,
  setupCanopyVaultShareFungibleAssetProcessor,
  setupCanopyVaultShareMultiRewardsProcessor,
} from "../../config.js";

// we setup the multi rewards processor for the test
setupCanopyVaultProcessor(SupportedAptosChainId.JESTNET);
setupCanopyVaultShareFungibleAssetProcessor(SupportedAptosChainId.JESTNET);
setupCanopyVaultShareMultiRewardsProcessor(SupportedAptosChainId.JESTNET);
