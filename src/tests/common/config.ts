import { Endpoints } from "@sentio/runtime";
import { AptosChainId } from "@sentio/chain";

// In your test setup file or at the top of your test file
export function setupTestEndpoints() {
  // TODO: update as needed

  // NOTE: we don't suffix "/v1" as this is done elsewhere in @sentio
  Endpoints.INSTANCE.chainServer.set(AptosChainId.APTOS_MOVEMENT_MAINNET, "https://mainnet.movementnetwork.xyz");
}
