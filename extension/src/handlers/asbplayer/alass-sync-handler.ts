/**
 * Alass Subtitle Synchronization Handler
 * 
 * Replaces WhisperTranscriptionHandler with alass-based subtitle-to-subtitle sync.
 * Uses reference subtitles intercepted from the site to sync user's subtitles.
 */

import {
    Command,
    Message,
    AsbPlayerToVideoCommandV2,
    ExtensionToVideoCommand,
    SubtitleOffsetDetectedMessage,
    RequestSubtitlesMessage,
    RequestSubtitlesResponse,
    OffsetToVideoMessage,
} from '@project/common';
import { syncSubtitles, TimeSpan } from '../../services/alass-wasm/alass-service';
import { parseSubtitles } from './subtitle-parser';

interface StartAlassSyncMessage extends Message {
    readonly command: 'start-alass-sync';
}

export default class AlassSyncHandler {
    get sender() {
        return 'asbplayerv2';
    }

    get command() {
        return 'start-alass-sync';
    }

    handle(command: Command<Message>, _sender: Browser.runtime.MessageSender) {
        const syncCommand = command as AsbPlayerToVideoCommandV2<StartAlassSyncMessage>;
        const { tabId, src } = syncCommand;

        console.log('[Alass] Starting auto-sync for tab', tabId);
        this._doSync(tabId, src).catch((e) => console.error('[Alass] Error:', e));
        return false;
    }

    private async _doSync(tabId: number, src: string) {
        const debugLog: string[] = [];
        const log = (msg: string) => {
            console.log('[Alass]', msg);
            debugLog.push(`${new Date().toISOString()}: ${msg}`);
            browser.storage.session.set({ alassDebugLog: debugLog });
        };

        try {
            log('Starting sync...');

            // Get reference subtitles intercepted from the site for this tab
            const storageKey = `discoveredSubtitle_${tabId}`;
            const storage = await browser.storage.session.get(storageKey);
            log(`Storage keys: ${Object.keys(storage).join(', ')}`);

            const referenceSubtitles = storage[storageKey];

            if (!referenceSubtitles || !referenceSubtitles.content) {
                log(`ERROR: No reference subtitles found for tab ${tabId}`);
                throw new Error('No reference subtitles found. Make sure the video has loaded with subtitles.');
            }

            log(`Using reference: ${referenceSubtitles.url} (${referenceSubtitles.content.length} chars)`);

            // Get user's loaded subtitles
            console.log('[Alass] Getting user subtitles...');
            const userSubtitles = await this._requestSubtitles(tabId, src);

            if (!userSubtitles?.length) {
                throw new Error('No user subtitles loaded');
            }

            console.log('[Alass] Got', userSubtitles.length, 'user subtitles');

            // Parse reference subtitles to TimeSpan array
            const referenceTimespans = parseSubtitles(referenceSubtitles.content);
            console.log('[Alass] Parsed', referenceTimespans.length, 'reference timespans');

            // Convert user subtitles to TimeSpan array
            const userTimespans: TimeSpan[] = userSubtitles.map(sub => ({
                start: sub.originalStart,
                end: sub.originalEnd
            }));

            // Run alass synchronization
            console.log('[Alass] Running synchronization...');
            const result = await syncSubtitles(userTimespans, referenceTimespans);

            if (!result.success) {
                throw new Error('Synchronization failed');
            }

            console.log('[Alass] Sync complete! Offset:', result.offset, 'ms');

            // Apply offset to video
            await browser.tabs.sendMessage(tabId, {
                sender: 'asbplayer-extension-to-video',
                message: { command: 'offset', value: result.offset } as OffsetToVideoMessage,
                src,
            } as ExtensionToVideoCommand<OffsetToVideoMessage>);

            // Notify about detected offset
            browser.tabs.sendMessage(tabId, {
                sender: 'asbplayer-extension-to-video',
                message: {
                    command: 'subtitle-offset-detected',
                    offset: result.offset,
                    confidence: 1.0,  // Alass is deterministic
                } as SubtitleOffsetDetectedMessage,
                src,
            } as ExtensionToVideoCommand<SubtitleOffsetDetectedMessage>);

            // Notify sidepanel
            browser.runtime.sendMessage({
                sender: 'asbplayer-extension-to-sidepanel',
                message: {
                    command: 'subtitle-offset-detected',
                    offset: result.offset,
                },
            });

        } catch (error) {
            console.error('[Alass] Failed:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Notify video tab about error
            browser.tabs.sendMessage(tabId, {
                sender: 'asbplayer-extension-to-video',
                message: {
                    command: 'alass-sync-error',
                    error: errorMessage,
                },
                src,
            } as ExtensionToVideoCommand<Message>);

            // Notify sidepanel
            browser.runtime.sendMessage({
                sender: 'asbplayer-extension-to-sidepanel',
                message: {
                    command: 'alass-sync-error',
                    error: errorMessage,
                },
            });
        }
    }

    private async _requestSubtitles(tabId: number, src: string) {
        const response = (await browser.tabs.sendMessage(tabId, {
            sender: 'asbplayer-extension-to-video',
            message: { command: 'request-subtitles' } as RequestSubtitlesMessage,
            src,
        } as ExtensionToVideoCommand<RequestSubtitlesMessage>)) as RequestSubtitlesResponse | undefined;
        return response?.subtitles;
    }
}
