import { AptosContext } from "@sentio/sdk/aptos";
import { Store } from "@sentio/sdk/store";

import {
    DualAssetMessageProcessingEvent,
    DualAssetMessageProcessingStats
} from "../schema/schema.oapp_dual_asset.js";

import { oapp as dual_asset_oapp_movement } from "../types/aptos/movement-mainnet/oapp_dual_asset.js";

import { SupportedAptosChainId } from "../chains.js";

type DualAssetOAppProcessor = typeof dual_asset_oapp_movement;

// Message type constants from the Move contract
const MESSAGE_TYPE_CLAIM_CONFIG: bigint = 1n;
const MESSAGE_TYPE_BATCH_CONTRIBUTION: bigint = 2n;

// Trace code constants from the Move contract
const TRACE_MESSAGE_TOO_SHORT: bigint = 100n;
const TRACE_INVALID_MESSAGE_TYPE: bigint = 101n;
const TRACE_DECODE_FAILURE: bigint = 102n;

// Core processor setup
export function dualAssetProcessor(
    supportedChainId: SupportedAptosChainId,
    startVersion: number,
    baseProcessor: DualAssetOAppProcessor
) {
    baseProcessor
        .bind({ startVersion })
        .onEventMessageProcessingEvent(async (event, ctx) => {
            const store = getStore(ctx);
            const timestamp = getTimestampInSeconds(ctx.getTimestamp());

            // Get or create stats entity
            const stats = await getOrCreateStats(store, timestamp);

            // Create event entity with unique ID (transaction version + event index)
            const eventEntity = new DualAssetMessageProcessingEvent({
                id: `${ctx.version}-${ctx.eventIndex}`,
                trace_code: Number(event.data_decoded.trace_code),
                message_type: BigInt(event.data_decoded.message_type.toString()),
                // Note: deployer_bytes removed as per your request
                from: event.data_decoded.from.toString(),
                transaction_version: BigInt(ctx.version),
                event_index: ctx.eventIndex,
                timestamp
            });

            // Update stats based on message type and trace code
            stats.total_message_count += 1;

            // Track message types
            const messageType = BigInt(event.data_decoded.message_type.toString());
            if (messageType === MESSAGE_TYPE_CLAIM_CONFIG) {
                stats.claim_config_count += 1;
            } else if (messageType === MESSAGE_TYPE_BATCH_CONTRIBUTION) {
                stats.batch_contribution_count += 1;
            } else {
                stats.invalid_message_type_count += 1;
            }

            // Track error types by trace code
            const traceCode = event.data_decoded.trace_code;
            if (traceCode === TRACE_MESSAGE_TOO_SHORT) {
                stats.message_too_short_count += 1;
            } else if (traceCode === TRACE_DECODE_FAILURE) {
                stats.decode_failure_count += 1;
            }

            // Update timestamp
            stats.last_update_time = timestamp;

            // Persist entities
            await store.upsert(eventEntity);
            await store.upsert(stats);
        });
}

// Helper Functions

// Get the data store from context
function getStore(ctx: AptosContext): Store {
    return ctx.store;
}

// Convert timestamp from microseconds to seconds
function getTimestampInSeconds(timestamp_micros: number | bigint): bigint {
    return BigInt(timestamp_micros) / 1_000_000n;
}

// Get or create stats singleton entity
async function getOrCreateStats(store: Store, timestamp: bigint): Promise<DualAssetMessageProcessingStats> {
    const STATS_ID = "global";
    let stats = await store.get(DualAssetMessageProcessingStats, STATS_ID);

    if (!stats) {
        stats = new DualAssetMessageProcessingStats({
            id: STATS_ID,
            total_message_count: 0,
            claim_config_count: 0,
            batch_contribution_count: 0,
            invalid_message_type_count: 0,
            message_too_short_count: 0,
            decode_failure_count: 0,
            last_update_time: timestamp
        });
    }

    return stats;
}

// Export a reader class for testing or external querying
export class DualAssetReader {
    constructor(private store: Store) {}

    async getStats(): Promise<DualAssetMessageProcessingStats | undefined> {
        return this.store.get(DualAssetMessageProcessingStats, "global");
    }

    async getEventByID(id: string): Promise<DualAssetMessageProcessingEvent | undefined> {
        return this.store.get(DualAssetMessageProcessingEvent, id);
    }

    // TODO: investigate if there's a way to "limit" or create an issue for it
    async getEventsByType(messageType: bigint, limit: number = 100): Promise<DualAssetMessageProcessingEvent[]> {
        return this.store.list(DualAssetMessageProcessingEvent, [
            { field: "message_type", op: "=", value: messageType }
        ]);
    }

    async getEventsByTraceCode(traceCode: number, limit: number = 100): Promise<DualAssetMessageProcessingEvent[]> {
        return this.store.list(DualAssetMessageProcessingEvent, [
            { field: "trace_code", op: "=", value: traceCode }
        ]);
    }

    async getLatestEvents(limit: number = 100): Promise<DualAssetMessageProcessingEvent[]> {
        return this.store.list(DualAssetMessageProcessingEvent, []);
    }
}
