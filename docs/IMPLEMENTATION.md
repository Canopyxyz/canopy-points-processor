# Implementation Details

## Overview

This document provides detailed implementation information for the Canopy Points System Sentio processor, including the mathematical approach, data structures, and query patterns for computing time-weighted average balances.

## Mathematical Foundation

### Time-Weighted Average Balance

The average balance over a time period is calculated as:

```
Average Balance = ∫(Balance(t) dt) / (t_end - t_start)
```

Since balances change discretely at transaction events, this becomes:

```
Average Balance = Σ(Balance_i × Duration_i) / Total Duration
```

### Cumulative Balance-Seconds

To avoid recalculating the entire sum for each query, we maintain a cumulative balance-seconds value:

```
CumulativeBalanceSeconds(t) = Σ(Balance_i × Duration_i) for all periods up to time t
```

This allows us to compute the average between any two times as:

```
Average(t1, t2) = (CumulativeBalanceSeconds(t2) - CumulativeBalanceSeconds(t1)) / (t2 - t1)
```

## Data Model

### Core Entities

#### StoreBalance
- Tracks the current state of a fungible store holding vault shares
- Maintains running `cumulativeBalanceSeconds` updated on each transaction
- Uses store address as the unique identifier

#### BalanceSnapshot
- Provides historical checkpoints for balance data
- Created lazily with ~24-hour lifetime to reduce storage overhead
- Contains both current balance(just informational) and cumulative balance-seconds at snapshot time
- Uses sequential count-based IDs for uniqueness while maintaining `filledAt` timestamp for queries

#### Transaction
- Immutable record of each deposit/withdrawal event
- Kept lean with only transaction-specific data (no computed fields)

### Processing Flow

1. **Event Reception**: Deposit/Withdraw events trigger processing
2. **Metadata Resolution**: Check cache or fetch fungible asset metadata
3. **Vault Validation**: Verify the store holds Canopy vault shares
4. **Balance Update**:
   - Calculate time delta since last update
   - Add `previousBalance × timeDelta` to cumulative balance-seconds
   - Update current balance
5. **Snapshot Management**:
   - Check if current snapshot is within 24-hour lifetime
   - Create new snapshot if needed, otherwise update existing
6. **Transaction Recording**: Store immutable transaction record

## Query Patterns

### Computing Average Balance

To find the average balance between timestamps `t1` and `t2`:

1. **Find Boundary Snapshots**:
   ```sql
   -- For t1: Find the active snapshot and its predecessor
   SELECT * FROM BalanceSnapshot
   WHERE storeBalanceID = ? AND filledAt <= t1
   ORDER BY filledAt DESC LIMIT 2  -- Returns: current_t1 (and previous_t1 if exists)

   -- For t2: Find the active snapshot and its predecessor
   SELECT * FROM BalanceSnapshot
   WHERE storeBalanceID = ? AND filledAt <= t2
   ORDER BY filledAt DESC LIMIT 2  -- Returns: current_t2 (and previous_t2 if exists)
   ```

2. **Calculate Cumulative Values**:
   ```typescript
    function getCumulativeAt(t: bigint, snapshot: Snapshot, previousSnapshot?: Snapshot): bigint {
        if (t >= snapshot.lastUpdateTime) {
            // Time is after the last update in this snapshot
            const timeSinceLastUpdate = t - snapshot.lastUpdateTime;
            return snapshot.cumulativeBalanceSeconds +
                (snapshot.balance * timeSinceLastUpdate);
        } else if (t >= snapshot.filledAt) {
            // Time is within the snapshot's lifetime but before lastUpdateTime

            // First, calculate cumulative at filledAt
            let cumulativeAtFilledAt: bigint;
            if (previousSnapshot) {
                // Extrapolate from previous snapshot to this snapshot's filledAt
                const timeSincePrevious = snapshot.filledAt - previousSnapshot.lastUpdateTime;
                cumulativeAtFilledAt = previousSnapshot.cumulativeBalanceSeconds +
                                        (previousSnapshot.balance * timeSincePrevious);
            } else {
                // No previous snapshot, assume cumulative was 0 at filledAt
                cumulativeAtFilledAt = BigInt(0);
            }

            // Now we know cumulative at both filledAt and lastUpdateTime
            // We can calculate the average balance during this snapshot period
            const snapshotDuration = snapshot.lastUpdateTime - snapshot.filledAt;
            const cumulativeGrowth = snapshot.cumulativeBalanceSeconds - cumulativeAtFilledAt;
            const averageBalance = cumulativeGrowth / snapshotDuration;

            // Finally, calculate cumulative at time t
            const timeFromFilledAt = t - snapshot.filledAt;
            return cumulativeAtFilledAt + (averageBalance * timeFromFilledAt);
        }
    }

   const cumulative1 = getCumulativeAt(t1, beforeOrAt_t1, after_t1);
   const cumulative2 = getCumulativeAt(t2, beforeOrAt_t2, after_t2);
   ```

3. **Calculate Average**:
   ```typescript
   const averageBalance = (cumulative2 - cumulative1) / (t2 - t1);
   ```

### Optimization Considerations

1. **Snapshot Lifetime**: The 24-hour lifetime balances storage efficiency with query precision
2. **Index Strategy**:
   - `filledAt` index on BalanceSnapshot for time-range queries
   - `fungible_store` index on StoreBalance for direct lookups
3. **Caching**: StoreMetadataCache eliminates repeated RPC calls for vault verification

## Edge Cases

### First Transaction
- Initialize cumulative balance-seconds to 0
- No time delta calculation needed

### Multiple Updates in Same Snapshot Period
- Cumulative value continues to accumulate
- Only one snapshot entry is maintained and updated

### Balance Goes to Zero
- Continue tracking cumulative balance-seconds
- Zero balance still contributes to time-weighted average

### Time Gaps
- System correctly handles long periods without transactions
- Cumulative calculation accounts for entire duration at previous balance

## Performance Characteristics

- **Storage**: O(n) where n is number of transactions
- **Average Balance Query**: O(log s) where s is number of snapshots
- **Balance Update**: O(1) amortized
- **Snapshot Creation**: O(1) with lazy creation pattern

## Future Enhancements

1. **Batch Processing**: Process multiple events in single transaction for efficiency
2. **Archival Strategy**: Move old snapshots to cold storage after certain age
3. **Aggregation Layers**: Pre-compute common time ranges (daily, weekly, monthly)
4. **Multi-Vault Queries**: Efficient computation across multiple vaults for portfolio analytics