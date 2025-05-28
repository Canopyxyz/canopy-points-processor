import { afterEach, before, describe, test } from "node:test";
import assert from "assert";
import { TestProcessorServer } from "@sentio/sdk/testing";

import { TestProcessor } from "../../utils/processor.js";
import { generateRandomAddress } from "../../common/helpers.js";

import { vault_abi } from "../../../abis/satay.js";
import { fungible_asset_abi } from "../../../abis/aptos_std.js";

import { canopyVaultHandlerIds, canopyVaultShareFungibleAssetHandlerIds } from "../common/constants.js";

describe("VaultCreated event tests", async () => {
  const service = new TestProcessorServer(() => import("../canopy-shares-processors.js"));
  const canopyVaultProcessor = new TestProcessor(vault_abi, canopyVaultHandlerIds, service);
  const canopyVaultSharesProcessor = new TestProcessor(
    fungible_asset_abi,
    canopyVaultShareFungibleAssetHandlerIds,
    service,
  );

  before(async () => {
    await service.start();
  });

  afterEach(async () => {
    await service.db.reset();
  });

  test("Basic VaultCreated", async () => {
    // Generate test data
    const vaultAddress = generateRandomAddress();
    const baseAssetAddress = generateRandomAddress();
    const vaultSharesAssetAddress = generateRandomAddress();

    // Process pool creation event
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: {
        vault: { inner: vaultAddress },
        deposit_limit: { vec: [] }, // this is how the Option none is represented in a typesafe way
        total_debt_limit: { vec: [] },
        base_metadata: {
          inner: baseAssetAddress,
        },
        shares_metadata: {
          inner: vaultSharesAssetAddress,
        },
      },
    });
  });

  // TODO: implement other VaultCreated tests
});
