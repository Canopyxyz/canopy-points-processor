import { afterEach, before, describe, test } from "node:test";
import assert from "assert";
import { TestProcessorServer } from "@sentio/sdk/testing";

import { TestProcessor } from "../../utils/processor.js";
import { generateRandomAddress } from "../../common/helpers.js";

import { vault_abi } from "../../../abis/satay.js";
import { fungible_asset_abi } from "../../../abis/aptos_std.js";

import { canopyVaultHandlerIds, canopyVaultShareFungibleAssetHandlerIds } from "../common/constants.js";
import { nonCanopyShareFAs, canopyVaultInfos } from "../common/addresses.js";
import { getVaultsInTimeRange, verifyVaultEntity, verifyVaultStats } from "../common/helpers.js";
import { Vault } from "../../../schema/schema.js";

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
    const timestamp = 1000000n; // 1 second in microseconds
    const version = 12345n;

    // Process vault creation event
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
      timestamp: timestamp,
      version: version,
    });

    // Verify the vault entity was created correctly
    await verifyVaultEntity(service, vaultAddress, {
      createdAt: 1n, // timestamp converted to seconds
      sharesMetadata: vaultSharesAssetAddress,
      createdAtVersion: version,
    });

    // Verify the vault stats were updated
    await verifyVaultStats(service, {
      totalVaultCount: 1,
      lastUpdateTime: 1n, // timestamp converted to seconds
    });

    // Additional verification: Check that the vault can be retrieved
    const vault = await service.store.get(Vault, vaultAddress);
    assert(vault, "Vault should exist");
    assert.strictEqual(vault.id, vaultAddress, "Vault ID should match");
    assert.strictEqual(vault.sharesMetadata, vaultSharesAssetAddress, "Shares metadata should match");
    assert.strictEqual(vault.createdAt, 1n, "Created at timestamp should match");
    assert.strictEqual(vault.createdAtVersion, version, "Created at version should match");
  });

  test("Multiple VaultCreated events", async () => {
    // Test creating multiple vaults in sequence
    // Verifies that VaultStats.totalVaultCount increments correctly
    // Verifies each vault has unique ID and correct metadata
    // Tests that lastUpdateTime updates with each creation

    const vaultData = [
      {
        vaultAddress: generateRandomAddress(),
        baseAssetAddress: generateRandomAddress(),
        vaultSharesAssetAddress: generateRandomAddress(),
        timestamp: 1000000n, // 1 second
        version: 10000n,
      },
      {
        vaultAddress: generateRandomAddress(),
        baseAssetAddress: generateRandomAddress(),
        vaultSharesAssetAddress: generateRandomAddress(),
        timestamp: 2000000n, // 2 seconds
        version: 20000n,
      },
      {
        vaultAddress: generateRandomAddress(),
        baseAssetAddress: generateRandomAddress(),
        vaultSharesAssetAddress: generateRandomAddress(),
        timestamp: 3000000n, // 3 seconds
        version: 30000n,
      },
    ];

    // Process each vault creation event
    for (let i = 0; i < vaultData.length; i++) {
      const data = vaultData[i];

      await canopyVaultProcessor.processEvent({
        name: "VaultCreated",
        data: {
          vault: { inner: data.vaultAddress },
          deposit_limit: { vec: [] },
          total_debt_limit: { vec: [] },
          base_metadata: { inner: data.baseAssetAddress },
          shares_metadata: { inner: data.vaultSharesAssetAddress },
        },
        timestamp: data.timestamp,
        version: data.version,
      });

      // Verify vault was created correctly
      await verifyVaultEntity(service, data.vaultAddress, {
        createdAt: data.timestamp / 1000000n, // Convert to seconds
        sharesMetadata: data.vaultSharesAssetAddress,
        createdAtVersion: data.version,
      });

      // Verify stats after each creation
      await verifyVaultStats(service, {
        totalVaultCount: i + 1,
        lastUpdateTime: data.timestamp / 1000000n, // Convert to seconds
      });
    }

    // Additional verification: Ensure all vaults exist and are distinct
    const allVaults = await service.store.list(Vault, []);
    assert.strictEqual(allVaults.length, 3, "Should have exactly 3 vaults");

    // Verify each vault has unique addresses
    const vaultIds = new Set(allVaults.map((v) => v.id));
    const sharesMetadatas = new Set(allVaults.map((v) => v.sharesMetadata));
    assert.strictEqual(vaultIds.size, 3, "All vault IDs should be unique");
    assert.strictEqual(sharesMetadatas.size, 3, "All shares metadata should be unique");

    // Verify vaults are queryable by time range
    const vaultsInFirstTwoSeconds = await getVaultsInTimeRange(service, 0n, 2n);
    assert.strictEqual(vaultsInFirstTwoSeconds.length, 2, "Should have 2 vaults in first 2 seconds");

    const vaultsInLastSecond = await getVaultsInTimeRange(service, 3n, 3n);
    assert.strictEqual(vaultsInLastSecond.length, 1, "Should have 1 vault in the last second");
  });
});
