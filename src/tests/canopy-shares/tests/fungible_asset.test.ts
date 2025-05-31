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
import {
  createDepositEventData,
  createVaultCreatedEventData,
  processDepositEvent,
  processWithdrawEvent,
  verifyBalanceSnapshot,
  verifyFungibleAssetStats,
  verifyNoBalanceEntities,
  verifyNoTransaction,
  verifyStoreBalance,
  verifyStoreMetadataCache,
  verifyTransaction,
} from "../common/helpers.js";
import { secondsToMicroseconds } from "../common/utils.js";

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
    const timestamp = 1n;
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
      timestamp: secondsToMicroseconds(timestamp),
      version: version - 1000n,
    });

    // Process the deposit event
    await canopyVaultSharesProcessor.processEvent({
      name: "Deposit",
      data: {
        store: storeInfo.store,
        amount: depositAmount.toString(),
      },
      timestamp: secondsToMicroseconds(timestamp),
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

    const nonCanopyFA = nonCanopyShareFAs[0]; // rsETH FA (not vault shares)
    const storeInfo = nonCanopyFA.someValidStores[0]; // Solo deployer's store
    const depositAmount = 1000000n; // 1M units
    const timestampSeconds = 1n;
    const timestamp = secondsToMicroseconds(timestampSeconds);
    const version = 100000n;
    const eventIndex = 0;

    // Process the deposit event to a non-Canopy FA store
    await canopyVaultSharesProcessor.processEvent({
      name: "Deposit",
      data: createDepositEventData(storeInfo.store, depositAmount),
      timestamp: timestamp,
      version: version,
      eventIndex: eventIndex,
      sender: storeInfo.owner,
    });

    // Verify StoreMetadataCache was created and correctly identifies as non-Canopy
    await verifyStoreMetadataCache(service, storeInfo.store, {
      metadata: nonCanopyFA.faMetadataAddress,
      isCanopyVault: false,
      vaultID: undefined,
    });

    // Verify no balance-related entities were created
    await verifyNoBalanceEntities(service, storeInfo.store);

    // Verify no transaction was created
    await verifyNoTransaction(service, version, eventIndex);

    // Verify FungibleAssetStats does not exist (since no Canopy vault activity occurred)
    const stats = await service.store.get(FungibleAssetStats, "global");
    assert.strictEqual(stats, undefined, "FungibleAssetStats should not exist for non-Canopy deposits");

    // Test that subsequent events to the same non-Canopy store also get filtered
    const secondTimestampSeconds = 2n;
    const secondTimestamp = secondsToMicroseconds(secondTimestampSeconds);
    const secondEventVersion = version + 1000n;
    const secondEventIndex = 1;

    await canopyVaultSharesProcessor.processEvent({
      name: "Deposit",
      data: createDepositEventData(storeInfo.store, depositAmount * 2n),
      timestamp: secondTimestamp,
      version: secondEventVersion,
      eventIndex: secondEventIndex,
      sender: storeInfo.owner,
    });

    // Verify still no balance entities
    await verifyNoBalanceEntities(service, storeInfo.store);
    await verifyNoTransaction(service, secondEventVersion, secondEventIndex);

    // Stats should still not exist
    const statsAfterSecond = await service.store.get(FungibleAssetStats, "global");
    assert.strictEqual(statsAfterSecond, undefined, "FungibleAssetStats should still not exist");
  });

  test("Multiple deposits within snapshot lifetime", async () => {
    // Test multiple deposits to same store within 24-hour window
    // Uses canopyVaultInfos[0].someValidStores[0] with timestamps < 24 hours apart
    // Verifies:
    // - Same BalanceSnapshot is updated (not creating new one)
    // - Cumulative balance-seconds accumulates correctly
    // - Balance updates correctly with each deposit
    // - lastUpdateTime updates but filledAt remains the same

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const storeInfo = vaultInfo.someValidStores[0]; // Solo deployer's store

    // First, create the vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vaultInfo.vaultAddress, generateRandomAddress(), vaultInfo.vaultShareAddress),
      timestamp: secondsToMicroseconds(0), // Create vault at time 0
      version: 1000n,
    });

    // Deposit 1: Initial deposit at t=100 seconds
    const deposit1Amount = 1000000n; // 1M units
    const t1 = 100; // seconds
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit1Amount,
      t1,
      100000n,
      0,
    );

    // Verify initial state
    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: deposit1Amount,
      lastObservationTime: BigInt(t1),
      cumulativeBalanceSeconds: 0n, // No time has passed yet
      totalSnapshotCount: 1,
    });

    const snapshot1Id = `${storeInfo.store}-1`;
    await verifyBalanceSnapshot(service, snapshot1Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t1),
      balance: deposit1Amount,
      cumulativeBalanceSeconds: 0n,
      lastUpdateTime: BigInt(t1),
    });

    // Deposit 2: 1 hour later (well within 24-hour window)
    const deposit2Amount = 500000n; // 0.5M units
    const t2 = t1 + 3600; // 1 hour later
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit2Amount,
      t2,
      101000n,
      0,
    );

    // Calculate expected cumulative: balance1 * (t2 - t1)
    const expectedCumulative2 = deposit1Amount * BigInt(t2 - t1);
    const expectedBalance2 = deposit1Amount + deposit2Amount;

    // Verify StoreBalance updated correctly
    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance2,
      lastObservationTime: BigInt(t2),
      cumulativeBalanceSeconds: expectedCumulative2,
      totalSnapshotCount: 1, // Still 1 - no new snapshot
    });

    // Verify same snapshot was updated (not a new one)
    await verifyBalanceSnapshot(service, snapshot1Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t1), // Original filledAt unchanged
      balance: expectedBalance2,
      cumulativeBalanceSeconds: expectedCumulative2,
      lastUpdateTime: BigInt(t2), // Updated to new time
    });

    // Deposit 3: 6 hours later (still within 24-hour window)
    const deposit3Amount = 2000000n; // 2M units
    const t3 = t2 + 21600; // 6 hours later
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit3Amount,
      t3,
      102000n,
      0,
    );

    // Calculate expected cumulative: previous + balance2 * (t3 - t2)
    const expectedCumulative3 = expectedCumulative2 + expectedBalance2 * BigInt(t3 - t2);
    const expectedBalance3 = expectedBalance2 + deposit3Amount;

    // Verify final state
    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance3,
      lastObservationTime: BigInt(t3),
      cumulativeBalanceSeconds: expectedCumulative3,
      totalSnapshotCount: 1, // Still using same snapshot
    });

    // Verify snapshot still has original filledAt but updated values
    await verifyBalanceSnapshot(service, snapshot1Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t1), // Still original filledAt
      balance: expectedBalance3,
      cumulativeBalanceSeconds: expectedCumulative3,
      lastUpdateTime: BigInt(t3),
    });

    // Verify all 3 transactions were recorded
    await verifyTransaction(service, "100000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t1),
      type: TransactionType.DEPOSIT,
      amount: deposit1Amount,
      transactionVersion: 100000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "101000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t2),
      type: TransactionType.DEPOSIT,
      amount: deposit2Amount,
      transactionVersion: 101000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "102000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t3),
      type: TransactionType.DEPOSIT,
      amount: deposit3Amount,
      transactionVersion: 102000n,
      eventIndex: 0,
    });

    // Verify stats
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 3,
      totalWithdrawCount: 0,
      uniqueStoreCount: 1,
      canopyVaultStoreCount: 1,
      lastUpdateTime: BigInt(t3),
    });

    // Verify no second snapshot was created
    const snapshot2Id = `${storeInfo.store}-2`;
    const snapshot2 = await service.store.get(BalanceSnapshot, snapshot2Id);
    assert.strictEqual(snapshot2, undefined, "Second snapshot should not exist within 24-hour window");
  });

  test("Deposits spanning multiple snapshot periods", async () => {
    // Test deposits with > 24 hours between them
    // Verifies:
    // - New BalanceSnapshot is created after 24-hour lifetime
    // - totalSnapshotCount increments in StoreBalance
    // - Cumulative balance-seconds carries forward correctly
    // - New snapshot has new filledAt timestamp

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const storeInfo = vaultInfo.someValidStores[0]; // Solo deployer's store

    // First, create the vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vaultInfo.vaultAddress, generateRandomAddress(), vaultInfo.vaultShareAddress),
      timestamp: secondsToMicroseconds(0),
      version: 1000n,
    });

    // Deposit 1: Initial deposit at t=1000 seconds
    const deposit1Amount = 1000000n; // 1M units
    const t1 = 1000; // seconds
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit1Amount,
      t1,
      100000n,
      0,
    );

    // Verify initial state with first snapshot
    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: deposit1Amount,
      lastObservationTime: BigInt(t1),
      cumulativeBalanceSeconds: 0n,
      totalSnapshotCount: 1,
    });

    const snapshot1Id = `${storeInfo.store}-1`;
    await verifyBalanceSnapshot(service, snapshot1Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t1),
      balance: deposit1Amount,
      cumulativeBalanceSeconds: 0n,
      lastUpdateTime: BigInt(t1),
    });

    // Deposit 2: 12 hours later (still within first snapshot)
    const deposit2Amount = 500000n;
    const t2 = t1 + 43200; // 12 hours later
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit2Amount,
      t2,
      101000n,
      0,
    );

    const expectedCumulative2 = deposit1Amount * BigInt(t2 - t1);
    const expectedBalance2 = deposit1Amount + deposit2Amount;

    // Verify snapshot 1 was updated
    await verifyBalanceSnapshot(service, snapshot1Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t1), // Original filledAt
      balance: expectedBalance2,
      cumulativeBalanceSeconds: expectedCumulative2,
      lastUpdateTime: BigInt(t2),
    });

    // Deposit 3: 25 hours after first deposit (exceeds 24-hour window)
    const deposit3Amount = 2000000n;
    const t3 = t1 + 90000; // 25 hours after t1
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit3Amount,
      t3,
      102000n,
      0,
    );

    // Calculate expected cumulative: previous + balance2 * (t3 - t2)
    const expectedCumulative3 = expectedCumulative2 + expectedBalance2 * BigInt(t3 - t2);
    const expectedBalance3 = expectedBalance2 + deposit3Amount;

    // Verify new snapshot was created
    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance3,
      lastObservationTime: BigInt(t3),
      cumulativeBalanceSeconds: expectedCumulative3,
      totalSnapshotCount: 2, // Incremented!
    });

    // Verify old snapshot remains unchanged after new one is created
    await verifyBalanceSnapshot(service, snapshot1Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t1),
      balance: expectedBalance2, // Final balance from snapshot 1
      cumulativeBalanceSeconds: expectedCumulative2, // Final cumulative from snapshot 1
      lastUpdateTime: BigInt(t2), // Last update in snapshot 1
    });

    // Verify new snapshot 2 was created
    const snapshot2Id = `${storeInfo.store}-2`;
    await verifyBalanceSnapshot(service, snapshot2Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t3), // New snapshot starts at t3
      balance: expectedBalance3,
      cumulativeBalanceSeconds: expectedCumulative3,
      lastUpdateTime: BigInt(t3),
    });

    // Deposit 4: 2 hours after t3 (within second snapshot)
    const deposit4Amount = 300000n;
    const t4 = t3 + 7200; // 2 hours later
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit4Amount,
      t4,
      103000n,
      0,
    );

    const expectedCumulative4 = expectedCumulative3 + expectedBalance3 * BigInt(t4 - t3);
    const expectedBalance4 = expectedBalance3 + deposit4Amount;

    // Verify second snapshot was updated (not a third one created)
    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance4,
      lastObservationTime: BigInt(t4),
      cumulativeBalanceSeconds: expectedCumulative4,
      totalSnapshotCount: 2, // Still 2
    });

    await verifyBalanceSnapshot(service, snapshot2Id, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t3), // Original filledAt for snapshot 2
      balance: expectedBalance4,
      cumulativeBalanceSeconds: expectedCumulative4,
      lastUpdateTime: BigInt(t4),
    });

    // Verify no third snapshot exists
    const snapshot3Id = `${storeInfo.store}-3`;
    const snapshot3 = await service.store.get(BalanceSnapshot, snapshot3Id);
    assert.strictEqual(snapshot3, undefined, "Third snapshot should not exist");

    // Verify all transactions
    await verifyTransaction(service, "100000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t1),
      type: TransactionType.DEPOSIT,
      amount: deposit1Amount,
      transactionVersion: 100000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "101000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t2),
      type: TransactionType.DEPOSIT,
      amount: deposit2Amount,
      transactionVersion: 101000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "102000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t3),
      type: TransactionType.DEPOSIT,
      amount: deposit3Amount,
      transactionVersion: 102000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "103000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t4),
      type: TransactionType.DEPOSIT,
      amount: deposit4Amount,
      transactionVersion: 103000n,
      eventIndex: 0,
    });

    // Verify final stats
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 4,
      totalWithdrawCount: 0,
      uniqueStoreCount: 1,
      canopyVaultStoreCount: 1,
      lastUpdateTime: BigInt(t4),
    });
  });

  test("Deposit and Withdraw sequence", async () => {
    // Test deposit followed by withdrawal from same store
    // Verifies:
    // - Balance increases then decreases correctly
    // - Cumulative balance-seconds accounts for time at higher balance
    // - Transaction records show correct types
    // - Withdrawal doesn't create negative balance

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const storeInfo = vaultInfo.someValidStores[0]; // Solo deployer's store

    // First, create the vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vaultInfo.vaultAddress, generateRandomAddress(), vaultInfo.vaultShareAddress),
      timestamp: secondsToMicroseconds(0),
      version: 1000n,
    });

    // Deposit 1: Initial deposit at t=1000 seconds
    const deposit1Amount = 1000000n; // 1M units
    const t1 = 1000; // seconds
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit1Amount,
      t1,
      100000n,
      0,
    );

    // Verify initial state
    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: deposit1Amount,
      lastObservationTime: BigInt(t1),
      cumulativeBalanceSeconds: 0n,
      totalSnapshotCount: 1,
    });

    // Deposit 2: 1 hour later
    const deposit2Amount = 500000n; // 0.5M units
    const t2 = t1 + 3600; // 1 hour later
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit2Amount,
      t2,
      101000n,
      0,
    );

    const expectedCumulative2 = deposit1Amount * BigInt(t2 - t1);
    const expectedBalance2 = deposit1Amount + deposit2Amount; // 1.5M

    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance2,
      lastObservationTime: BigInt(t2),
      cumulativeBalanceSeconds: expectedCumulative2,
      totalSnapshotCount: 1,
    });

    // Withdraw 1: 2 hours after deposit 2
    const withdraw1Amount = 300000n; // 0.3M units
    const t3 = t2 + 7200; // 2 hours later
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      withdraw1Amount,
      t3,
      102000n,
      0,
    );

    const expectedCumulative3 = expectedCumulative2 + expectedBalance2 * BigInt(t3 - t2);
    const expectedBalance3 = expectedBalance2 - withdraw1Amount; // 1.2M

    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance3,
      lastObservationTime: BigInt(t3),
      cumulativeBalanceSeconds: expectedCumulative3,
      totalSnapshotCount: 1,
    });

    // Withdraw 2: 30 minutes later (partial withdrawal)
    const withdraw2Amount = 700000n; // 0.7M units
    const t4 = t3 + 1800; // 30 minutes later
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      withdraw2Amount,
      t4,
      103000n,
      0,
    );

    const expectedCumulative4 = expectedCumulative3 + expectedBalance3 * BigInt(t4 - t3);
    const expectedBalance4 = expectedBalance3 - withdraw2Amount; // 0.5M

    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance4,
      lastObservationTime: BigInt(t4),
      cumulativeBalanceSeconds: expectedCumulative4,
      totalSnapshotCount: 1,
    });

    // Deposit 3: 1 hour later (after withdrawals)
    const deposit3Amount = 200000n; // 0.2M units
    const t5 = t4 + 3600; // 1 hour later
    await processDepositEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      deposit3Amount,
      t5,
      104000n,
      0,
    );

    const expectedCumulative5 = expectedCumulative4 + expectedBalance4 * BigInt(t5 - t4);
    const expectedBalance5 = expectedBalance4 + deposit3Amount; // 0.7M

    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance5,
      lastObservationTime: BigInt(t5),
      cumulativeBalanceSeconds: expectedCumulative5,
      totalSnapshotCount: 1,
    });

    // Verify the single snapshot has all updates
    const snapshotId = `${storeInfo.store}-1`;
    await verifyBalanceSnapshot(service, snapshotId, {
      storeBalanceID: storeInfo.store,
      filledAt: BigInt(t1), // Original filledAt
      balance: expectedBalance5,
      cumulativeBalanceSeconds: expectedCumulative5,
      lastUpdateTime: BigInt(t5),
    });

    // Verify all transactions with correct types
    await verifyTransaction(service, "100000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t1),
      type: TransactionType.DEPOSIT,
      amount: deposit1Amount,
      transactionVersion: 100000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "101000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t2),
      type: TransactionType.DEPOSIT,
      amount: deposit2Amount,
      transactionVersion: 101000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "102000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t3),
      type: TransactionType.WITHDRAW,
      amount: withdraw1Amount,
      transactionVersion: 102000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "103000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t4),
      type: TransactionType.WITHDRAW,
      amount: withdraw2Amount,
      transactionVersion: 103000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "104000-0", {
      storeBalanceID: storeInfo.store,
      signer: storeInfo.owner,
      timestamp: BigInt(t5),
      type: TransactionType.DEPOSIT,
      amount: deposit3Amount,
      transactionVersion: 104000n,
      eventIndex: 0,
    });

    // Verify final stats
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 3,
      totalWithdrawCount: 2,
      uniqueStoreCount: 1,
      canopyVaultStoreCount: 1,
      lastUpdateTime: BigInt(t5),
    });

    // Test complete withdrawal (balance goes to zero)
    const withdrawAllAmount = expectedBalance5; // Withdraw entire balance
    const t6 = t5 + 1800; // 30 minutes later
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      storeInfo.store,
      storeInfo.owner,
      withdrawAllAmount,
      t6,
      105000n,
      0,
    );

    const expectedCumulative6 = expectedCumulative5 + expectedBalance5 * BigInt(t6 - t5);

    await verifyStoreBalance(service, storeInfo.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: 0n, // Balance is now zero
      lastObservationTime: BigInt(t6),
      cumulativeBalanceSeconds: expectedCumulative6,
      totalSnapshotCount: 1,
    });

    // Verify stats after complete withdrawal
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 3,
      totalWithdrawCount: 3,
      uniqueStoreCount: 1,
      canopyVaultStoreCount: 1,
      lastUpdateTime: BigInt(t6),
    });
  });

  test("Multiple stores for same vault", async () => {
    // Test deposits to multiple stores holding same vault shares
    // Uses both stores from canopyVaultInfos[0].someValidStores
    // Verifies:
    // - Each store has independent StoreBalance and snapshots
    // - Both correctly link to same vault
    // - Stats count unique stores correctly

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const store1Info = vaultInfo.someValidStores[0]; // Solo deployer's store
    const store2Info = vaultInfo.someValidStores[1]; // Satay manager's store

    // First, create the vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vaultInfo.vaultAddress, generateRandomAddress(), vaultInfo.vaultShareAddress),
      timestamp: secondsToMicroseconds(0),
      version: 1000n,
    });

    // Deposit to Store 1 at t=1000
    const deposit1Amount = 1000000n; // 1M units
    const t1 = 1000;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      store1Info.store,
      store1Info.owner,
      deposit1Amount,
      t1,
      100000n,
      0,
    );

    // Verify Store 1 state
    await verifyStoreMetadataCache(service, store1Info.store, {
      metadata: vaultInfo.vaultShareAddress,
      isCanopyVault: true,
      vaultID: vaultInfo.vaultAddress,
    });

    await verifyStoreBalance(service, store1Info.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: deposit1Amount,
      lastObservationTime: BigInt(t1),
      cumulativeBalanceSeconds: 0n,
      totalSnapshotCount: 1,
    });

    const snapshot1Store1Id = `${store1Info.store}-1`;
    await verifyBalanceSnapshot(service, snapshot1Store1Id, {
      storeBalanceID: store1Info.store,
      filledAt: BigInt(t1),
      balance: deposit1Amount,
      cumulativeBalanceSeconds: 0n,
      lastUpdateTime: BigInt(t1),
    });

    // Verify stats after first store
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 1,
      totalWithdrawCount: 0,
      uniqueStoreCount: 1,
      canopyVaultStoreCount: 1,
      lastUpdateTime: BigInt(t1),
    });

    // Deposit to Store 2 at t=2000
    const deposit2Amount = 2000000n; // 2M units
    const t2 = 2000;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      store2Info.store,
      store2Info.owner,
      deposit2Amount,
      t2,
      101000n,
      0,
    );

    // Verify Store 2 state (independent from Store 1)
    await verifyStoreMetadataCache(service, store2Info.store, {
      metadata: vaultInfo.vaultShareAddress,
      isCanopyVault: true,
      vaultID: vaultInfo.vaultAddress, // Same vault!
    });

    await verifyStoreBalance(service, store2Info.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: deposit2Amount,
      lastObservationTime: BigInt(t2),
      cumulativeBalanceSeconds: 0n, // Independent cumulative
      totalSnapshotCount: 1,
    });

    const snapshot1Store2Id = `${store2Info.store}-1`;
    await verifyBalanceSnapshot(service, snapshot1Store2Id, {
      storeBalanceID: store2Info.store,
      filledAt: BigInt(t2),
      balance: deposit2Amount,
      cumulativeBalanceSeconds: 0n,
      lastUpdateTime: BigInt(t2),
    });

    // Verify stats now show 2 unique stores
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 2,
      totalWithdrawCount: 0,
      uniqueStoreCount: 2, // Incremented!
      canopyVaultStoreCount: 2, // Both are Canopy vault stores
      lastUpdateTime: BigInt(t2),
    });

    // Store 1: Another deposit at t=3000
    const deposit3Amount = 500000n;
    const t3 = 3000;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      store1Info.store,
      store1Info.owner,
      deposit3Amount,
      t3,
      102000n,
      0,
    );

    // Verify Store 1 updated independently
    const expectedCumulative1 = deposit1Amount * BigInt(t3 - t1);
    const expectedBalance1 = deposit1Amount + deposit3Amount;

    await verifyStoreBalance(service, store1Info.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance1,
      lastObservationTime: BigInt(t3),
      cumulativeBalanceSeconds: expectedCumulative1,
      totalSnapshotCount: 1,
    });

    // Verify Store 2 remains unchanged
    await verifyStoreBalance(service, store2Info.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: deposit2Amount, // Unchanged
      lastObservationTime: BigInt(t2), // Unchanged
      cumulativeBalanceSeconds: 0n, // Unchanged
      totalSnapshotCount: 1,
    });

    // Store 2: Withdrawal at t=4000
    const withdraw1Amount = 800000n;
    const t4 = 4000;
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      store2Info.store,
      store2Info.owner,
      withdraw1Amount,
      t4,
      103000n,
      0,
    );

    const expectedCumulative2 = deposit2Amount * BigInt(t4 - t2);
    const expectedBalance2 = deposit2Amount - withdraw1Amount;

    await verifyStoreBalance(service, store2Info.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: expectedBalance2,
      lastObservationTime: BigInt(t4),
      cumulativeBalanceSeconds: expectedCumulative2,
      totalSnapshotCount: 1,
    });

    // Verify transactions are properly linked to their respective stores
    await verifyTransaction(service, "100000-0", {
      storeBalanceID: store1Info.store,
      signer: store1Info.owner,
      timestamp: BigInt(t1),
      type: TransactionType.DEPOSIT,
      amount: deposit1Amount,
      transactionVersion: 100000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "101000-0", {
      storeBalanceID: store2Info.store,
      signer: store2Info.owner,
      timestamp: BigInt(t2),
      type: TransactionType.DEPOSIT,
      amount: deposit2Amount,
      transactionVersion: 101000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "102000-0", {
      storeBalanceID: store1Info.store,
      signer: store1Info.owner,
      timestamp: BigInt(t3),
      type: TransactionType.DEPOSIT,
      amount: deposit3Amount,
      transactionVersion: 102000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "103000-0", {
      storeBalanceID: store2Info.store,
      signer: store2Info.owner,
      timestamp: BigInt(t4),
      type: TransactionType.WITHDRAW,
      amount: withdraw1Amount,
      transactionVersion: 103000n,
      eventIndex: 0,
    });

    // Final stats verification
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 3,
      totalWithdrawCount: 1,
      uniqueStoreCount: 2, // Still 2 unique stores
      canopyVaultStoreCount: 2,
      lastUpdateTime: BigInt(t4),
    });

    // Test with a different vault to ensure proper isolation
    const vault2Info = canopyVaultInfos[1]; // solvBTC Echelon vault
    const vault2StoreInfo = vault2Info.someValidStores[0];

    // Create second vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vault2Info.vaultAddress, generateRandomAddress(), vault2Info.vaultShareAddress),
      timestamp: secondsToMicroseconds(100),
      version: 2000n,
    });

    // Deposit to store from different vault
    await processDepositEvent(
      canopyVaultSharesProcessor,
      vault2StoreInfo.store,
      vault2StoreInfo.owner,
      1500000n,
      5000,
      104000n,
      0,
    );

    // Verify it links to the correct (different) vault
    await verifyStoreMetadataCache(service, vault2StoreInfo.store, {
      metadata: vault2Info.vaultShareAddress,
      isCanopyVault: true,
      vaultID: vault2Info.vaultAddress, // Different vault!
    });

    // Final stats should show 3 unique stores across 2 vaults
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 4,
      totalWithdrawCount: 1,
      uniqueStoreCount: 3, // Now 3 unique stores
      canopyVaultStoreCount: 3,
      lastUpdateTime: BigInt(5000),
    });
  });

  test("Metadata caching behavior", async () => {
    // Test that metadata is cached after first lookup
    // Process multiple events for same store
    // Verifies:
    // - First event triggers view call (would see in logs)
    // - Subsequent events use cached metadata
    // - Cache correctly identifies Canopy vs non-Canopy

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const storeInfo = vaultInfo.someValidStores[0]; // Solo deployer's store
    const nonCanopyFA = nonCanopyShareFAs[0]; // rsETH FA (not vault shares)
    const nonCanopyStoreInfo = nonCanopyFA.someValidStores[0];

    // First, create the vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vaultInfo.vaultAddress, generateRandomAddress(), vaultInfo.vaultShareAddress),
      timestamp: secondsToMicroseconds(0),
      version: 1000n,
    });

    // Test 1: First deposit to Canopy vault store (should trigger view call)
    const t1 = 1000;
    await processDepositEvent(canopyVaultSharesProcessor, storeInfo.store, storeInfo.owner, 1000000n, t1, 100000n, 0);

    // Verify cache was created
    const canopyCache = await service.store.get(StoreMetadataCache, storeInfo.store);
    assert(canopyCache, "Cache should exist after first event");
    assert.strictEqual(canopyCache.isCanopyVault, true, "Should be identified as Canopy vault");

    // Test 2: Second deposit to same store (should use cache)
    const t2 = 2000;
    await processDepositEvent(canopyVaultSharesProcessor, storeInfo.store, storeInfo.owner, 500000n, t2, 101000n, 0);

    // Verify cache is unchanged (same object)
    const canopyCacheAfterSecond = await service.store.get(StoreMetadataCache, storeInfo.store);
    assert.deepStrictEqual(canopyCache, canopyCacheAfterSecond, "Cache should be unchanged");

    // Test 3: Withdrawal from same store (should also use cache)
    const t3 = 3000;
    await processWithdrawEvent(canopyVaultSharesProcessor, storeInfo.store, storeInfo.owner, 300000n, t3, 102000n, 0);

    // Verify all events were processed (balance reflects all operations)
    const storeBalance = await service.store.get(StoreBalance, storeInfo.store);
    assert(storeBalance, "StoreBalance should exist");
    assert.strictEqual(storeBalance.lastKnownBalance, 1200000n, "Balance should reflect all operations");

    // Test 4: First event to non-Canopy store (should trigger view call and cache as non-Canopy)
    const t4 = 4000;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      nonCanopyStoreInfo.store,
      nonCanopyStoreInfo.owner,
      2000000n,
      t4,
      103000n,
      0,
    );

    // Verify non-Canopy cache was created
    const nonCanopyCache = await service.store.get(StoreMetadataCache, nonCanopyStoreInfo.store);
    assert(nonCanopyCache, "Non-Canopy cache should exist");
    assert.strictEqual(nonCanopyCache.isCanopyVault, false, "Should be identified as non-Canopy");
    assert.strictEqual(nonCanopyCache.metadata, nonCanopyFA.faMetadataAddress, "Should have correct metadata");
    assert.strictEqual(nonCanopyCache.vaultID, undefined, "Should have no vault ID");

    // Verify no balance entities were created for non-Canopy
    await verifyNoBalanceEntities(service, nonCanopyStoreInfo.store);

    // Test 5: Second event to non-Canopy store (should use cache and still filter out)
    const t5 = 5000;
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      nonCanopyStoreInfo.store,
      nonCanopyStoreInfo.owner,
      500000n,
      t5,
      104000n,
      0,
    );

    // Verify cache is unchanged
    const nonCanopyCacheAfterSecond = await service.store.get(StoreMetadataCache, nonCanopyStoreInfo.store);
    assert.deepStrictEqual(nonCanopyCache, nonCanopyCacheAfterSecond, "Non-Canopy cache should be unchanged");

    // Still no balance entities
    await verifyNoBalanceEntities(service, nonCanopyStoreInfo.store);

    // Test 6: Process many events rapidly to same Canopy store (stress test cache)
    const batchStartTime = 6000;
    for (let i = 0; i < 10; i++) {
      const isDeposit = i % 2 === 0;
      const eventTime = batchStartTime + i * 100; // 100 seconds apart

      if (isDeposit) {
        await processDepositEvent(
          canopyVaultSharesProcessor,
          storeInfo.store,
          storeInfo.owner,
          100000n,
          eventTime,
          BigInt(105000 + i * 1000),
          0,
        );
      } else {
        await processWithdrawEvent(
          canopyVaultSharesProcessor,
          storeInfo.store,
          storeInfo.owner,
          50000n,
          eventTime,
          BigInt(105000 + i * 1000),
          0,
        );
      }
    }

    // Verify cache remained stable through all operations
    const canopyCacheAfterBatch = await service.store.get(StoreMetadataCache, storeInfo.store);
    assert.deepStrictEqual(canopyCache, canopyCacheAfterBatch, "Cache should be unchanged after batch");

    // Verify correct number of transactions were processed
    const allTransactions = await service.store.list(Transaction, [
      { field: "storeBalanceID", op: "=", value: storeInfo.store },
    ]);
    assert.strictEqual(
      allTransactions.length,
      13,
      "Should have 13 transactions for Canopy store (3 initial + 10 batch)",
    );

    // Test 7: Different event types to verify cache works across event types
    const vault2Info = canopyVaultInfos[1];
    const vault2StoreInfo = vault2Info.someValidStores[0];

    // Create second vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vault2Info.vaultAddress, generateRandomAddress(), vault2Info.vaultShareAddress),
      timestamp: secondsToMicroseconds(100),
      version: 2000n,
    });

    // First withdrawal to a new store (not deposit)
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      vault2StoreInfo.store,
      vault2StoreInfo.owner,
      0n, // Withdraw 0 (edge case, but should still create cache)
      7000,
      115000n,
      0,
    );

    // Verify cache was created even for withdrawal as first event
    const vault2Cache = await service.store.get(StoreMetadataCache, vault2StoreInfo.store);
    assert(vault2Cache, "Cache should be created for withdrawal event");
    assert.strictEqual(vault2Cache.isCanopyVault, true, "Should be identified as Canopy vault");
    assert.strictEqual(vault2Cache.vaultID, vault2Info.vaultAddress, "Should link to correct vault");

    // Final stats verification
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 7, // 2 initial + 5 from batch
      totalWithdrawCount: 7, // 1 initial + 5 from batch + 1 from vault2
      uniqueStoreCount: 2, // storeInfo.store and vault2StoreInfo.store
      canopyVaultStoreCount: 2,
      lastUpdateTime: BigInt(7000),
    });
  });

  test("Different users depositing to same vault", async () => {
    // Test deposits from different signers (SoloDeployerAddress, SatayManagerAddress)
    // Verifies:
    // - Transaction records show correct signer addresses
    // - All other processing remains the same regardless of signer

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const soloStore = vaultInfo.someValidStores[0]; // Solo deployer's store
    const satayStore = vaultInfo.someValidStores[1]; // Satay manager's store

    // First, create the vault
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vaultInfo.vaultAddress, generateRandomAddress(), vaultInfo.vaultShareAddress),
      timestamp: secondsToMicroseconds(0),
      version: 1000n,
    });

    // Test 1: Solo Deployer deposits to their own store
    const t1 = 1000;
    const soloDeposit1 = 1000000n;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      soloStore.store,
      soloStore.owner, // SoloDeployerAddress
      soloDeposit1,
      t1,
      100000n,
      0,
    );

    // Verify transaction has correct signer
    await verifyTransaction(service, "100000-0", {
      storeBalanceID: soloStore.store,
      signer: SoloDeployerAddress,
      timestamp: BigInt(t1),
      type: TransactionType.DEPOSIT,
      amount: soloDeposit1,
      transactionVersion: 100000n,
      eventIndex: 0,
    });

    // Test 2: Satay Manager deposits to their own store
    const t2 = 2000;
    const satayDeposit1 = 2000000n;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      satayStore.store,
      satayStore.owner, // SatayManagerAddress
      satayDeposit1,
      t2,
      101000n,
      0,
    );

    // Verify transaction has correct signer
    await verifyTransaction(service, "101000-0", {
      storeBalanceID: satayStore.store,
      signer: SatayManagerAddress,
      timestamp: BigInt(t2),
      type: TransactionType.DEPOSIT,
      amount: satayDeposit1,
      transactionVersion: 101000n,
      eventIndex: 0,
    });

    // Test 3: Cross-deposits - Solo deposits to Satay's store (unusual but valid)
    const t3 = 3000;
    const crossDeposit1 = 500000n;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      satayStore.store, // Satay's store
      soloStore.owner, // But Solo is the signer
      crossDeposit1,
      t3,
      102000n,
      0,
    );

    // Verify transaction shows Solo as signer even though it's Satay's store
    await verifyTransaction(service, "102000-0", {
      storeBalanceID: satayStore.store,
      signer: SoloDeployerAddress, // Solo is the signer
      timestamp: BigInt(t3),
      type: TransactionType.DEPOSIT,
      amount: crossDeposit1,
      transactionVersion: 102000n,
      eventIndex: 0,
    });

    // Verify Satay's store balance includes both deposits
    await verifyStoreBalance(service, satayStore.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: satayDeposit1 + crossDeposit1,
      lastObservationTime: BigInt(t3),
      cumulativeBalanceSeconds: satayDeposit1 * BigInt(t3 - t2),
      totalSnapshotCount: 1,
    });

    // Test 4: Withdrawals by different users
    const t4 = 4000;
    const soloWithdraw1 = 300000n;
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      soloStore.store,
      soloStore.owner,
      soloWithdraw1,
      t4,
      103000n,
      0,
    );

    const t5 = 5000;
    const satayWithdraw1 = 800000n;
    await processWithdrawEvent(
      canopyVaultSharesProcessor,
      satayStore.store,
      satayStore.owner,
      satayWithdraw1,
      t5,
      104000n,
      0,
    );

    // Verify withdrawal transactions have correct signers
    await verifyTransaction(service, "103000-0", {
      storeBalanceID: soloStore.store,
      signer: SoloDeployerAddress,
      timestamp: BigInt(t4),
      type: TransactionType.WITHDRAW,
      amount: soloWithdraw1,
      transactionVersion: 103000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "104000-0", {
      storeBalanceID: satayStore.store,
      signer: SatayManagerAddress,
      timestamp: BigInt(t5),
      type: TransactionType.WITHDRAW,
      amount: satayWithdraw1,
      transactionVersion: 104000n,
      eventIndex: 0,
    });

    // Test 5: Multiple signers in same transaction batch (different event indices)
    const t6 = 6000;
    await processDepositEvent(
      canopyVaultSharesProcessor,
      soloStore.store,
      soloStore.owner,
      100000n,
      t6,
      105000n,
      0, // Event index 0
    );

    await processDepositEvent(
      canopyVaultSharesProcessor,
      satayStore.store,
      satayStore.owner,
      200000n,
      t6, // Same timestamp
      105000n, // Same version
      1, // Different event index
    );

    // Verify both transactions in same version have correct signers
    await verifyTransaction(service, "105000-0", {
      storeBalanceID: soloStore.store,
      signer: SoloDeployerAddress,
      timestamp: BigInt(t6),
      type: TransactionType.DEPOSIT,
      amount: 100000n,
      transactionVersion: 105000n,
      eventIndex: 0,
    });

    await verifyTransaction(service, "105000-1", {
      storeBalanceID: satayStore.store,
      signer: SatayManagerAddress,
      timestamp: BigInt(t6),
      type: TransactionType.DEPOSIT,
      amount: 200000n,
      transactionVersion: 105000n,
      eventIndex: 1,
    });

    // Verify final balances
    const soloExpectedBalance = soloDeposit1 - soloWithdraw1 + 100000n;
    const satayExpectedBalance = satayDeposit1 + crossDeposit1 - satayWithdraw1 + 200000n;

    await verifyStoreBalance(service, soloStore.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: soloExpectedBalance,
      lastObservationTime: BigInt(t6),
      cumulativeBalanceSeconds:
        soloDeposit1 * BigInt(t4 - t1) + // First period
        (soloDeposit1 - soloWithdraw1) * BigInt(t6 - t4), // Second period
      totalSnapshotCount: 1,
    });

    await verifyStoreBalance(service, satayStore.store, {
      vaultID: vaultInfo.vaultAddress,
      lastKnownBalance: satayExpectedBalance,
      lastObservationTime: BigInt(t6),
      cumulativeBalanceSeconds:
        satayDeposit1 * BigInt(t3 - t2) + // First period
        (satayDeposit1 + crossDeposit1) * BigInt(t5 - t3) + // Second period
        (satayDeposit1 + crossDeposit1 - satayWithdraw1) * BigInt(t6 - t5), // Third period
      totalSnapshotCount: 1,
    });

    // Verify all transactions are queryable by signer
    const soloTransactions = await service.store.list(Transaction, [
      { field: "signer", op: "=", value: SoloDeployerAddress },
    ]);
    assert.strictEqual(soloTransactions.length, 4, "Solo should have 3 transactions");

    const satayTransactions = await service.store.list(Transaction, [
      { field: "signer", op: "=", value: SatayManagerAddress },
    ]);
    assert.strictEqual(satayTransactions.length, 3, "Satay should have 4 transactions");

    // Verify final stats
    await verifyFungibleAssetStats(service, {
      totalDepositCount: 5,
      totalWithdrawCount: 2,
      uniqueStoreCount: 2,
      canopyVaultStoreCount: 2,
      lastUpdateTime: BigInt(t6),
    });
  });
});
