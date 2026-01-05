/**
 * Alass WASM Subtitle Synchronization Service
 * 
 * Provides functions to synchronize subtitles using the alass algorithm
 * compiled to WebAssembly.
 */

import init, { sync_subtitles, get_sync_offset } from './pkg/alass_wasm.js';

let initialized = false;

/**
 * Initialize the WASM module. Must be called before using sync functions.
 */
export async function initAlass(): Promise<void> {
    if (initialized) return;

    // In service worker context, we need to provide explicit URL to the WASM file
    // @ts-ignore - WXT types don't include dynamic paths
    const wasmUrl = chrome.runtime.getURL('alass-wasm/alass_wasm_bg.wasm');
    await init(wasmUrl);
    initialized = true;
}

export interface TimeSpan {
    start: number;  // milliseconds
    end: number;    // milliseconds
}

export interface SyncResult {
    /** Offset in milliseconds to apply (positive = shift forward, negative = shift backward) */
    offset: number;
    /** Per-subtitle deltas if fine-grained sync is needed */
    deltas: number[];
    /** Whether sync was successful */
    success: boolean;
}

/**
 * Synchronize subtitles using alass algorithm
 * 
 * @param incorrect - User's subtitles that need to be synced
 * @param reference - Reference subtitles from the site (already synced to video)
 * @returns SyncResult with offset and per-subtitle deltas
 */
export async function syncSubtitles(
    incorrect: TimeSpan[],
    reference: TimeSpan[]
): Promise<SyncResult> {
    await initAlass();

    if (incorrect.length === 0 || reference.length === 0) {
        return { offset: 0, deltas: [], success: false };
    }

    const incorrectStarts = new Float64Array(incorrect.map(s => s.start));
    const incorrectEnds = new Float64Array(incorrect.map(s => s.end));
    const referenceStarts = new Float64Array(reference.map(s => s.start));
    const referenceEnds = new Float64Array(reference.map(s => s.end));

    try {
        const deltas = sync_subtitles(
            incorrectStarts,
            incorrectEnds,
            referenceStarts,
            referenceEnds
        );

        const offset = get_sync_offset(
            incorrectStarts,
            incorrectEnds,
            referenceStarts,
            referenceEnds
        );

        return {
            offset: Math.round(offset),
            deltas: Array.from(deltas),
            success: true
        };
    } catch (error) {
        console.error('[Alass] Sync failed:', error);
        return { offset: 0, deltas: [], success: false };
    }
}

/**
 * Get just the median offset (simpler use case)
 */
export async function getOffset(
    incorrect: TimeSpan[],
    reference: TimeSpan[]
): Promise<number> {
    const result = await syncSubtitles(incorrect, reference);
    return result.offset;
}
