import { vault_abi } from "../../../abis/satay.js";
import { fungible_asset_abi } from "../../../abis/aptos_std.js";
import { HandlerIdMapping } from "../../utils/processor.js";

// NOTE: this should follow the some order that the event handlers are bound to the sentio CanopyVaultProcessor
export const canopyVaultHandlerIds: HandlerIdMapping<typeof vault_abi> = {
  VaultCreated: 0,
};

export const canopyVaultShareFungibleAssetHandlerIds: HandlerIdMapping<typeof fungible_asset_abi> = {
  Deposit: 0,
  Withdraw: 1,
};
