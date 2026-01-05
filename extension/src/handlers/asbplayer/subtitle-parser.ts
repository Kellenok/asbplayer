/**
 * Simple subtitle parser for VTT, SRT, and ASS formats
 * Extracts timespans for alass synchronization
 */

import { TimeSpan } from '../../services/alass-wasm/alass-service';

/**
 * Parse subtitle content and extract timespans
 */
export function parseSubtitles(content: string): TimeSpan[] {
    content = content.trim();

    // Detect format and parse
    if (content.startsWith('WEBVTT')) {
        return parseVTT(content);
    } else if (content.includes('[Script Info]') || content.includes('Dialogue:')) {
        return parseASS(content);
    } else if (/^\d+\r?\n\d{2}:\d{2}/.test(content)) {
        return parseSRT(content);
    }

    // Try SRT as fallback
    return parseSRT(content);
}

/**
 * Parse VTT format
 */
function parseVTT(content: string): TimeSpan[] {
    const timespans: TimeSpan[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match timestamp line: 00:00.000 --> 00:00.000 or 00:00:00.000 --> 00:00:00.000
        const match = line.match(/((?:\d{1,2}:)?\d{1,2}:\d{1,2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}[.,]\d{3})/);
        if (match) {
            const start = parseTimestamp(match[1]);
            const end = parseTimestamp(match[2]);
            timespans.push({ start, end });
        }
    }

    return timespans;
}

/**
 * Parse SRT format
 */
function parseSRT(content: string): TimeSpan[] {
    const timespans: TimeSpan[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match timestamp line: 00:00,000 --> 00:00,000 or 00:00:00,000 --> 00:00:00,000
        const match = line.match(/((?:\d{1,2}:)?\d{1,2}:\d{1,2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}[.,]\d{3})/);
        if (match) {
            const start = parseTimestamp(match[1]);
            const end = parseTimestamp(match[2]);
            timespans.push({ start, end });
        }
    }

    return timespans;
}

/**
 * Parse ASS/SSA format
 */
function parseASS(content: string): TimeSpan[] {
    const timespans: TimeSpan[] = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        if (line.startsWith('Dialogue:')) {
            // Dialogue: 0,0:00:00.00,0:00:00.00,Style,...
            const parts = line.split(',');
            if (parts.length >= 3) {
                const start = parseASSTimestamp(parts[1]);
                const end = parseASSTimestamp(parts[2]);
                if (start >= 0 && end >= 0) {
                    timespans.push({ start, end });
                }
            }
        }
    }

    return timespans;
}

/**
 * Parse VTT/SRT timestamp to milliseconds
 * Supported formats:
 * - MM:SS.mmm
 * - HH:MM:SS.mmm
 */
function parseVTTTimestamp(timestamp: string): number {
    return parseTimestamp(timestamp);
}

function parseSRTTimestamp(timestamp: string): number {
    return parseTimestamp(timestamp);
}

function parseTimestamp(timestamp: string): number {
    // Replace comma with dot for consistency
    timestamp = timestamp.replace(',', '.');
    // Split by dot to separate milliseconds
    const parts = timestamp.split('.');
    const timeParts = parts[0].split(':');
    const milliseconds = parseInt(parts[1] || '0', 10);

    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (timeParts.length === 3) {
        hours = parseInt(timeParts[0], 10);
        minutes = parseInt(timeParts[1], 10);
        seconds = parseInt(timeParts[2], 10);
    } else if (timeParts.length === 2) {
        minutes = parseInt(timeParts[0], 10);
        seconds = parseInt(timeParts[1], 10);
    } else {
        return 0;
    }

    return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
}

/**
 * Parse ASS timestamp to milliseconds
 * Format: H:MM:SS.cc (centiseconds)
 */
function parseASSTimestamp(timestamp: string): number {
    const parts = timestamp.trim().split(':');

    if (parts.length !== 3) return -1;

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0], 10);
    const centiseconds = parseInt(secondsParts[1] || '0', 10);

    return hours * 3600000 + minutes * 60000 + seconds * 1000 + centiseconds * 10;
}
