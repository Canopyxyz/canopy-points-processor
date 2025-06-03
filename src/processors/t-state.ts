import { AptosContext } from "@sentio/sdk/aptos";
import { SupportedAptosChainId } from "../chains.js";
import { Address } from "../utils/types.js";

let testSender: Address;
export function getSender(chainId: SupportedAptosChainId, ctx: AptosContext): Address {
  if (chainId === SupportedAptosChainId.JESTNET) {
    return testSender;
  } else {
    return ctx.transaction.sender as Address;
  }
}

export function setTestSender(address: Address) {
  testSender = address;
}
