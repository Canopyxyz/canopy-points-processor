import { vault_abi } from "../../../abis/satay.js";
import { fungible_asset_abi } from "../../../abis/aptos_std.js";
import { multi_rewards_abi } from "../../../abis/multi_rewards.js";

import { HandlerIdMapping } from "../../utils/processor.js";

// NOTE: since all the processors are being run concurrently for testing we maintain a global ordering on event handlers across processors

// NOTE: this should follow the some order that the event handlers are bound to the sentio CanopyVaultProcessor
export const canopyVaultHandlerIds: HandlerIdMapping<typeof vault_abi> = {
  VaultCreated: 0,
};

export const canopyVaultShareFungibleAssetHandlerIds: HandlerIdMapping<typeof fungible_asset_abi> = {
  Deposit: 1,
  Withdraw: 2,
};

export const canopyVaultShareMultiRewardsHandlerIds: HandlerIdMapping<typeof multi_rewards_abi> = {
  StakeEvent: 3,
  WithdrawEvent: 4,
};
