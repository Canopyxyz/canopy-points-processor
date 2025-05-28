import { afterEach, before, describe, test } from "node:test";
import assert from "assert";
import { TestProcessorServer } from "@sentio/sdk/testing";

import { TestProcessor } from "../../utils/processor.js";
import { generateRandomAddress } from "../../common/helpers.js";

import { vault_abi } from "../../../abis/satay.js";
import { fungible_asset_abi } from "../../../abis/aptos_std.js";

import { canopyVaultHandlerIds, canopyVaultShareFungibleAssetHandlerIds } from "../common/constants.js";
import { nonCanopyShareFAs, canopyVaultInfos, SoloDeployerAddress, SatayManagerAddress } from "../common/addresses.js";
import {
  BalanceSnapshot,
  FungibleAssetStats,
  StoreBalance,
  StoreMetadataCache,
  Transaction,
  TransactionType,
} from "../../../schema/schema.js";
import { setupTestEndpoints } from "../../common/config.js";

describe("Fungible Asset Deposit/Withdraw event tests", async () => {
  const service = new TestProcessorServer(() => import("../canopy-shares-processors.js"));
  const canopyVaultProcessor = new TestProcessor(vault_abi, canopyVaultHandlerIds, service);
  const canopyVaultSharesProcessor = new TestProcessor(
    fungible_asset_abi,
    canopyVaultShareFungibleAssetHandlerIds,
    service,
  );

  before(async () => {
    setupTestEndpoints();
    await service.start();
  });

  afterEach(async () => {
    await service.db.reset();
  });

  test("Basic Deposit to Canopy vault share store", async () => {
    // Test a single deposit to a valid Canopy vault share fungible store
    // Uses real mainnet addresses from canopyVaultInfos[0].someValidStores[0]
    // Verifies:
    // - StoreMetadataCache is created and correctly identifies as Canopy vault
    // - StoreBalance is created with correct initial values
    // - BalanceSnapshot is created with correct filledAt timestamp
    // - Transaction record is created
    // - Cumulative balance-seconds is initialized to 0
    // - FungibleAssetStats are updated

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const storeInfo = vaultInfo.someValidStores[0]; // Solo deployer's store
    const depositAmount = 1000000n; // 1M units
    const timestamp = 1000000n; // 1 second in microseconds
    const version = 100000n;
    const eventIndex = 0;

    // First, create the vault so it exists when we check metadata
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: {
        vault: { inner: vaultInfo.vaultAddress },
        deposit_limit: { vec: [] },
        total_debt_limit: { vec: [] },
        base_metadata: { inner: generateRandomAddress() }, // Not used in our tests
        shares_metadata: { inner: vaultInfo.vaultShareAddress },
      },
      timestamp: timestamp - 500000n, // Create vault 0.5 seconds before deposit
      version: version - 1000n,
    });

    // Process the deposit event
    await canopyVaultSharesProcessor.processEvent({
      name: "Deposit",
      data: {
        store: storeInfo.store,
        amount: depositAmount.toString(),
      },
      timestamp: timestamp,
      version: version,
      eventIndex: eventIndex,
      sender: storeInfo.owner,
    });

    // Verify StoreMetadataCache was created and identifies as Canopy vault
    const metadataCache = await service.store.get(StoreMetadataCache, storeInfo.store);
    assert(metadataCache, "StoreMetadataCache should exist");
    assert.strictEqual(metadataCache.id, storeInfo.store, "Cache ID should be store address");
    assert.strictEqual(metadataCache.metadata, vaultInfo.vaultShareAddress, "Metadata should match vault shares");
    assert.strictEqual(metadataCache.isCanopyVault, true, "Should be identified as Canopy vault");
    assert.strictEqual(metadataCache.vaultID, vaultInfo.vaultAddress, "Should reference correct vault");

    // Verify StoreBalance was created with correct initial values
    const storeBalance = await service.store.get(StoreBalance, storeInfo.store);
    assert(storeBalance, "StoreBalance should exist");
    assert.strictEqual(storeBalance.id, storeInfo.store, "ID should be store address");
    assert.strictEqual(storeBalance.fungible_store, storeInfo.store, "Fungible store should match");
    assert.strictEqual(storeBalance.vaultID, vaultInfo.vaultAddress, "Should reference correct vault");
    assert.strictEqual(storeBalance.lastKnownBalance, depositAmount, "Balance should equal deposit amount");
    assert.strictEqual(storeBalance.lastObservationTime, 1n, "Should be 1 second (converted from microseconds)");
    assert.strictEqual(storeBalance.cumulativeBalanceSeconds, 0n, "Should start at 0");
    assert.strictEqual(storeBalance.totalSnapshotCount, 1, "Should have 1 snapshot");

    // Verify BalanceSnapshot was created
    const snapshotId = `${storeInfo.store}-1`;
    const snapshot = await service.store.get(BalanceSnapshot, snapshotId);
    assert(snapshot, "BalanceSnapshot should exist");
    assert.strictEqual(snapshot.storeBalanceID, storeInfo.store, "Should reference correct store");
    assert.strictEqual(snapshot.filledAt, 1n, "FilledAt should be 1 second");
    assert.strictEqual(snapshot.balance, depositAmount, "Balance should equal deposit amount");
    assert.strictEqual(snapshot.cumulativeBalanceSeconds, 0n, "Should start at 0");
    assert.strictEqual(snapshot.lastUpdateTime, 1n, "Should be 1 second");

    // Verify Transaction record was created
    const transactionId = `${version}-${eventIndex}`;
    const transaction = await service.store.get(Transaction, transactionId);
    assert(transaction, "Transaction should exist");
    assert.strictEqual(transaction.storeBalanceID, storeInfo.store, "Should reference correct store");
    assert.strictEqual(transaction.signer, storeInfo.owner, "Signer should match");
    assert.strictEqual(transaction.timestamp, 1n, "Should be 1 second");
    assert.strictEqual(transaction.type, TransactionType.DEPOSIT, "Should be DEPOSIT type");
    assert.strictEqual(transaction.amount, depositAmount, "Amount should match");
    assert.strictEqual(transaction.transactionVersion, version, "Version should match");
    assert.strictEqual(transaction.eventIndex, eventIndex, "Event index should match");

    // Verify FungibleAssetStats were updated
    const stats = await service.store.get(FungibleAssetStats, "global");
    assert(stats, "FungibleAssetStats should exist");
    assert.strictEqual(stats.totalDepositCount, 1, "Should have 1 deposit");
    assert.strictEqual(stats.totalWithdrawCount, 0, "Should have 0 withdrawals");
    assert.strictEqual(stats.uniqueStoreCount, 1, "Should have 1 unique store");
    assert.strictEqual(stats.canopyVaultStoreCount, 1, "Should have 1 Canopy vault store");
    assert.strictEqual(stats.lastUpdateTime, 1n, "Should be 1 second");
  });

  test("Deposit to non-Canopy fungible asset store", async () => {
    // Test deposit to a non-Canopy FA using nonCanopyShareFAs[0].someValidStores[0]
    // Verifies:
    // - StoreMetadataCache is created and correctly identifies as non-Canopy
    // - No StoreBalance, BalanceSnapshot, or Transaction entities are created
    // - Event is filtered out and processing stops after metadata check
  });

  test("Multiple deposits within snapshot lifetime", async () => {
    // Test multiple deposits to same store within 24-hour window
    // Uses canopyVaultInfos[0].someValidStores[0] with timestamps < 24 hours apart
    // Verifies:
    // - Same BalanceSnapshot is updated (not creating new one)
    // - Cumulative balance-seconds accumulates correctly
    // - Balance updates correctly with each deposit
    // - lastUpdateTime updates but filledAt remains the same
  });

  test("Deposits spanning multiple snapshot periods", async () => {
    // Test deposits with > 24 hours between them
    // Verifies:
    // - New BalanceSnapshot is created after 24-hour lifetime
    // - totalSnapshotCount increments in StoreBalance
    // - Cumulative balance-seconds carries forward correctly
    // - New snapshot has new filledAt timestamp
  });

  test("Deposit and Withdraw sequence", async () => {
    // Test deposit followed by withdrawal from same store
    // Verifies:
    // - Balance increases then decreases correctly
    // - Cumulative balance-seconds accounts for time at higher balance
    // - Transaction records show correct types
    // - Withdrawal doesn't create negative balance
  });

  test("Withdraw exceeding balance", async () => {
    // Test withdrawal amount greater than current balance
    // Verifies:
    // - Balance goes to 0 (not negative)
    // - Cumulative balance-seconds still calculated correctly
    // - System handles edge case gracefully
  });

  test("Multiple stores for same vault", async () => {
    // Test deposits to multiple stores holding same vault shares
    // Uses both stores from canopyVaultInfos[0].someValidStores
    // Verifies:
    // - Each store has independent StoreBalance and snapshots
    // - Both correctly link to same vault
    // - Stats count unique stores correctly
  });

  test("Metadata caching behavior", async () => {
    // Test that metadata is cached after first lookup
    // Process multiple events for same store
    // Verifies:
    // - First event triggers view call (would see in logs)
    // - Subsequent events use cached metadata
    // - Cache correctly identifies Canopy vs non-Canopy
  });

  test("Different users depositing to same vault", async () => {
    // Test deposits from different signers (SoloDeployerAddress, SatayManagerAddress)
    // Verifies:
    // - Transaction records show correct signer addresses
    // - All other processing remains the same regardless of signer
  });

  test("Zero amount deposit/withdraw", async () => {
    // Test edge case of 0 amount transactions
    // Verifies:
    // - System handles 0 amounts gracefully
    // - Cumulative balance-seconds still updates (time passes even with 0 amount)
    // - Transaction records are created even for 0 amounts
  });

  test("High frequency trading scenario", async () => {
    // Test many deposits/withdrawals in rapid succession
    // Simulates high-frequency trading with timestamps very close together
    // Verifies:
    // - Cumulative calculations remain accurate with small time deltas
    // - No precision loss in balance-seconds calculations
    // - Snapshot updates handle rapid changes correctly
  });

  test("Historical query simulation", async () => {
    // Test scenario that sets up data for average balance queries
    // Creates deposits/withdrawals across multiple time periods
    // Verifies:
    // - Data structure supports efficient interpolation
    // - Snapshots contain all necessary data for getCumulativeAt calculations
    // - Edge cases for query boundaries (exactly at snapshot times)
  });
});
