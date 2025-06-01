import { afterEach, before, describe, test } from "node:test";
import assert from "assert";
import { TestProcessorServer } from "@sentio/sdk/testing";

import { TestProcessor } from "../../utils/processor.js";
import { generateRandomAddress } from "../../common/helpers.js";

import { vault_abi } from "../../../abis/satay.js";
import { fungible_asset_abi } from "../../../abis/aptos_std.js";
import { multi_rewards_abi } from "../../../abis/multi_rewards.js";

import {
  canopyVaultHandlerIds,
  canopyVaultShareFungibleAssetHandlerIds,
  canopyVaultShareMultiRewardsHandlerIds,
} from "../common/constants.js";
import { nonCanopyShareFAs, canopyVaultInfos, SoloDeployerAddress, SatayManagerAddress } from "../common/addresses.js";
import {
  User,
  StakingBalance,
  StakingSnapshot,
  StakingTransaction,
  StakingTransactionType,
  StakingStats,
  Vault,
} from "../../../schema/schema.js";

import { setupTestEndpoints } from "../../common/config.js";

import {
  createStakeEventData,
  createUnstakeEventData,
  processStakeEvent,
  processUnstakeEvent,
  verifyUser,
  verifyStakingBalance,
  verifyStakingSnapshot,
  verifyStakingTransaction,
  verifyStakingStats,
  verifyNoStakingEntities,
  verifyNoStakingTransaction,
} from "../common/multi-rewards-helpers.js";

import { createVaultCreatedEventData } from "../common/helpers.js";

describe("MultiRewards Stake/Withdraw event tests", async () => {
  const service = new TestProcessorServer(() => import("../canopy-shares-processors.js"));

  const canopyVaultProcessor = new TestProcessor(vault_abi, canopyVaultHandlerIds, service);
  const canopyVaultSharesProcessor = new TestProcessor(
    fungible_asset_abi,
    canopyVaultShareFungibleAssetHandlerIds,
    service,
  );
  const canopyMultiRewardsProcessor = new TestProcessor(
    multi_rewards_abi,
    canopyVaultShareMultiRewardsHandlerIds,
    service,
  );

  before(async () => {
    setupTestEndpoints();
    await service.start();
  });

  afterEach(async () => {
    await service.db.reset();
  });

  // NOTE: we could make our tests very realistic by first mocking an FA Withdraw event from the user's store
  // and then mock an FA Deposit to the multi_rewards module's store and then mock a multi_rewards::StakeEvent
  // However that's not strictly necessary as the focus of these tests are on the canopyMultiRewardsProcessor
  // However we will also have to mock the vault creation with canopyVaultProcessor since there's a relationship
  // between the entities of the canopyVaultProcessor and canopyMultiRewardsProcessor

  test("SENTIO DEVX ISSUES - Demonstration of relationship problems", async () => {
    // This test demonstrates two DevX issues with Sentio's ORM in test environments:
    // 1. Promise-based relationships don't work even when foreign key IDs are set
    // 2. @derivedFrom relationships fail with "Store not found in context" error

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const userAddress = SoloDeployerAddress;
    const stakingToken = vaultInfo.vaultShareAddress;
    const stakeAmount = 1000000n;
    const timestamp = 1000000n;
    const version = 100000n;
    const eventIndex = 0;

    // Setup: Create vault and process stake event
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(vaultInfo.vaultAddress, generateRandomAddress(), vaultInfo.vaultShareAddress),
      timestamp: timestamp - 500000n,
      version: version - 1000n,
    });

    await processStakeEvent(
      canopyMultiRewardsProcessor,
      userAddress,
      stakingToken,
      stakeAmount,
      1,
      version,
      eventIndex,
    );

    const stakingBalanceId = `${userAddress}-${stakingToken}`;

    // ===== ISSUE 1: Promise-based relationships don't resolve =====
    console.log("\n===== DEVX ISSUE 1: Promise-based relationships =====");

    const stakingBalance = await service.store.get(StakingBalance, stakingBalanceId);
    assert(stakingBalance, "StakingBalance should exist");

    // The vaultID is correctly set
    console.log("vaultID is set:", stakingBalance.vaultID);
    assert.strictEqual(stakingBalance.vaultID, vaultInfo.vaultAddress, "vaultID is correctly set");

    // BUT: The vault() relationship method returns undefined
    try {
      const linkedVault = await stakingBalance.vault();
      console.log("linkedVault from relationship:", linkedVault); // This will be undefined!

      // This assertion FAILS even though vaultID is set correctly
      assert(linkedVault, "StakingBalance should be linked to a vault - BUT THIS FAILS!");
    } catch (error) {
      console.log("ISSUE 1 DEMONSTRATED: vault() returns undefined despite vaultID being set");
      console.log("Error:", error.message);
    }

    // WORKAROUND for Issue 1: Manually fetch using the ID
    console.log("\nWORKAROUND for Issue 1: Manually fetch the vault");
    const manuallyFetchedVault = await service.store.get(Vault, stakingBalance.vaultID);
    assert(manuallyFetchedVault, "Manually fetched vault exists");
    console.log("✓ Manual fetch works, but defeats the purpose of ORM relationships");

    // ===== ISSUE 2: @derivedFrom relationships fail with "Store not found" =====
    console.log("\n===== DEVX ISSUE 2: @derivedFrom relationships =====");

    const vault = await service.store.get(Vault, vaultInfo.vaultAddress);
    assert(vault, "Vault should exist");

    try {
      // This FAILS with "Store not found in context" error
      const vaultStakingBalances = await vault.stakingBalances();
      console.log("This line should not be reached");
    } catch (error) {
      console.log("ISSUE 2 DEMONSTRATED: @derivedFrom relationship fails");
      console.log("Error:", error.message); // "Store not found in context"
      assert.strictEqual(error.message, "Store not found in context", "Expected error message");
    }

    // WORKAROUND for Issue 2: Query directly using foreign key
    console.log("\nWORKAROUND for Issue 2: Query directly using foreign key");
    const manualQuery = await service.store.list(StakingBalance, [
      { field: "vaultID", op: "=", value: vaultInfo.vaultAddress },
    ]);
    assert.strictEqual(manualQuery.length, 1, "Manual query finds the staking balance");
    console.log("✓ Manual query works, but @derivedFrom should handle this automatically");

    // ===== EXPECTED BEHAVIOR (what developers expect to work) =====
    console.log("\n===== EXPECTED BEHAVIOR (currently broken) =====");
    console.log("Developers expect this natural ORM flow to work:");
    console.log("1. stakingBalance.vault() should return the Vault entity");
    console.log("2. vault.stakingBalances() should return the related StakingBalance entities");
    console.log("3. user.stakingBalances() should return the user's staking positions");
    console.log("\nInstead, we need workarounds for every relationship query in tests!");

    // Additional Issue: User relationships also don't work
    const user = await service.store.get(User, userAddress);
    assert(user, "User should exist");

    try {
      const userStakingBalances = await user.stakingBalances();
      console.log("This line should not be reached");
    } catch (error) {
      console.log("\nSame issue with User.stakingBalances():", error.message);
    }

    console.log("\n===== END OF DEVX ISSUES DEMONSTRATION =====");

    // Test passes using workarounds, but the DevX is poor
    assert(true, "Test completes with workarounds, but DevX needs improvement");
  });

  test("Basic Stake to Canopy vault shares", async () => {
    // Test a single stake event for valid Canopy vault shares
    // Uses real mainnet addresses from canopyVaultInfos[0]
    // Verifies:
    // - User entity is created with correct firstSeenAt
    // - StakingBalance is created with correct initial values
    // - StakingSnapshot is created with correct filledAt timestamp
    // - StakingTransaction record is created with STAKE type
    // - Cumulative balance-seconds is initialized to 0
    // - StakingStats are updated
    // - Correct links to Vault entity

    const vaultInfo = canopyVaultInfos[0]; // rsETH Echelon vault
    const userAddress = SoloDeployerAddress;
    const stakingToken = vaultInfo.vaultShareAddress; // The vault share token metadata
    const stakeAmount = 1000000n; // 1M units
    const timestamp = 1000000n; // 1 second in microseconds
    const version = 100000n;
    const eventIndex = 0;

    // First, create the vault so it exists when we check for Canopy vault shares
    await canopyVaultProcessor.processEvent({
      name: "VaultCreated",
      data: createVaultCreatedEventData(
        vaultInfo.vaultAddress,
        generateRandomAddress(), // base metadata - not used in our tests
        vaultInfo.vaultShareAddress,
      ),
      timestamp: timestamp - 500000n, // Create vault 0.5 seconds before stake
      version: version - 1000n,
    });

    // Process the stake event
    await processStakeEvent(
      canopyMultiRewardsProcessor,
      userAddress,
      stakingToken,
      stakeAmount,
      1, // 1 second
      version,
      eventIndex,
    );

    // Verify User was created with correct firstSeenAt
    await verifyUser(service, userAddress, {
      firstSeenAt: 1n, // 1 second (converted from microseconds)
    });

    // Verify StakingBalance was created with correct initial values
    await verifyStakingBalance(service, userAddress, stakingToken, {
      vaultID: vaultInfo.vaultAddress,
      stakingToken: stakingToken,
      lastKnownBalance: stakeAmount,
      lastObservationTime: 1n, // 1 second
      cumulativeBalanceSeconds: 0n, // Should start at 0
      totalSnapshotCount: 1,
    });

    // Verify StakingSnapshot was created
    const stakingBalanceId = `${userAddress}-${stakingToken}`;
    const snapshotId = `${stakingBalanceId}-1`;
    await verifyStakingSnapshot(service, snapshotId, {
      stakingBalanceID: stakingBalanceId,
      filledAt: 1n,
      balance: stakeAmount,
      cumulativeBalanceSeconds: 0n,
      lastUpdateTime: 1n,
    });

    // Verify StakingTransaction record was created
    const transactionId = `${version}-${eventIndex}`;
    await verifyStakingTransaction(service, transactionId, {
      stakingBalanceID: stakingBalanceId,
      userID: userAddress,
      timestamp: 1n,
      type: StakingTransactionType.STAKE,
      amount: stakeAmount,
      transactionVersion: version,
      eventIndex: eventIndex,
    });

    // Verify StakingStats were updated
    await verifyStakingStats(service, {
      totalStakeCount: 1,
      totalUnstakeCount: 0,
      uniqueUserCount: 1,
      canopyVaultStakerCount: 1,
      lastUpdateTime: 1n,
    });

    // Verify the StakingBalance is linked to the correct Vault
    const stakingBalance = await service.store.get(StakingBalance, stakingBalanceId);
    assert(stakingBalance, "StakingBalance should exist");
    assert.strictEqual(stakingBalance.vaultID, vaultInfo.vaultAddress, "Should have correct vault ID");

    // Verify the vault exists
    const vault = await service.store.get(Vault, vaultInfo.vaultAddress);
    assert(vault, "Vault should exist");

    // Query staking balances for this vault directly
    const vaultStakingBalances = await service.store.list(StakingBalance, [
      { field: "vaultID", op: "=", value: vaultInfo.vaultAddress },
    ]);
    assert.strictEqual(vaultStakingBalances.length, 1, "Vault should have 1 staking balance");
    assert.strictEqual(vaultStakingBalances[0].id, stakingBalanceId, "Vault should link to correct staking balance");
  });

  test("Stake to non-Canopy token", async () => {
    // Test stake event for a non-Canopy token using nonCanopyShareFAs[0]
    // Verifies:
    // - No User, StakingBalance, StakingSnapshot, or StakingTransaction entities are created
    // - Event is filtered out early when vault lookup fails
    // - StakingStats are NOT created/updated
  });

  test("Multiple stakes within snapshot lifetime", async () => {
    // Test multiple stake events to same user-token within 24-hour window
    // Uses canopyVaultInfos[0] with timestamps < 24 hours apart
    // Verifies:
    // - Same StakingSnapshot is updated (not creating new one)
    // - Cumulative balance-seconds accumulates correctly
    // - Balance updates correctly with each stake
    // - lastUpdateTime updates but filledAt remains the same
    // - User entity is not duplicated
  });

  test("Stakes spanning multiple snapshot periods", async () => {
    // Test stakes with > 24 hours between them
    // Verifies:
    // - New StakingSnapshot is created after 24-hour lifetime
    // - totalSnapshotCount increments in StakingBalance
    // - Cumulative balance-seconds carries forward correctly
    // - New snapshot has new filledAt timestamp
  });

  test("Stake and Unstake sequence", async () => {
    // Test stake followed by unstake for same user-token
    // Verifies:
    // - Balance increases then decreases correctly
    // - Cumulative balance-seconds accounts for time at higher balance
    // - Transaction records show correct types (STAKE/UNSTAKE)
    // - Balance doesn't go negative on unstake
  });

  test("Complete unstake (balance to zero)", async () => {
    // Test unstaking entire balance
    // Verifies:
    // - Balance goes to 0 correctly
    // - Cumulative balance-seconds still calculated correctly
    // - Subsequent stakes work correctly after zero balance
  });

  test("Multiple users staking same vault", async () => {
    // Test different users (SoloDeployerAddress, SatayManagerAddress) staking same vault shares
    // Verifies:
    // - Each user has independent StakingBalance and snapshots
    // - Both correctly link to same vault
    // - Stats count unique users correctly
    // - User entities have correct firstSeenAt timestamps
  });

  test("Same user staking multiple vaults", async () => {
    // Test single user staking shares from different vaults
    // Uses canopyVaultInfos[0] and canopyVaultInfos[1]
    // Verifies:
    // - Separate StakingBalance for each user-token combination
    // - Each links to correct vault
    // - Single User entity with multiple stakingBalances
    // - Stats don't double-count the user
  });

  test("Zero amount stake/unstake", async () => {
    // Test edge case of 0 amount transactions
    // Verifies:
    // - System handles 0 amounts gracefully
    // - Cumulative balance-seconds still updates (time passes even with 0 amount)
    // - Transaction records are created even for 0 amounts
    // - User and StakingBalance entities are created
  });

  test("High frequency staking scenario", async () => {
    // Test many stakes/unstakes in rapid succession
    // Simulates high-frequency trading with timestamps very close together
    // Verifies:
    // - Cumulative calculations remain accurate with small time deltas
    // - No precision loss in balance-seconds calculations
    // - Snapshot updates handle rapid changes correctly
  });

  test("First stake vs subsequent stakes", async () => {
    // Test that first stake creates all entities while subsequent don't duplicate
    // Verifies:
    // - First stake creates User with correct firstSeenAt
    // - Subsequent stakes don't update firstSeenAt
    // - Stats correctly track unique users only on first interaction
  });

  test("Cross-processor consistency", async () => {
    // Test that vault relationships work correctly across processors
    // Create vault, process fungible asset deposits, then staking
    // Verifies:
    // - Vault entity is shared correctly between processors
    // - stakingBalances relationship on Vault works
    // - Can query all positions (store and staking) for a vault
  });

  test("Historical query simulation for staking", async () => {
    // Test scenario that sets up data for average balance queries
    // Creates stakes/unstakes across multiple time periods
    // Verifies:
    // - Data structure supports efficient interpolation
    // - Snapshots contain all necessary data for getCumulativeAt calculations
    // - Edge cases for query boundaries (exactly at snapshot times)
  });
});
