import dotenv from "dotenv";
import { createLogger, safeStringify } from "./logger";
import { getCachedData } from "./redis";

dotenv.config();

const logger = createLogger('syncState.ts', 'shouldEnableWebSocket');

let cachedEnabledBlockNumber: number | null = null;

export const shouldEnableWebSocket = async (currentBlockNumber: number, callerFunction: string = 'shouldEnableWebSocket'): Promise<boolean> => {
    try {
        const enabledWebSocket = process.env.ENABLE_WEBSOCKET === 'true';
        if (!enabledWebSocket) return false;

        if (cachedEnabledBlockNumber === null) {
            cachedEnabledBlockNumber = await getCachedData<number>('websocket:enable:block', currentBlockNumber, callerFunction);
        }
        
        const enabledBlockNumber = cachedEnabledBlockNumber;
        if (!enabledBlockNumber) return true;

        console.log(logger.logSimple(currentBlockNumber, `${callerFunction} WebSocket enable check: ${safeStringify({
            enabledBlockNumber,
            shouldEnable: currentBlockNumber >= enabledBlockNumber
        })}`));

        return currentBlockNumber >= enabledBlockNumber;
    } catch (error) {
        console.error(logger.logSimple(currentBlockNumber, `${callerFunction} Error checking WebSocket enable status: ${error}`));
        return false;
    }
};

export async function executeIfInSync(
    eventBlockNumber: number,
    websocketOperations: () => Promise<void>,
    callerFunction: string
): Promise<void> {
    const logger = createLogger('syncState.ts', 'executeIfInSync');
    
    if (callerFunction) {
        console.log(logger.logSimple(eventBlockNumber, `${callerFunction} Called by main function: ${safeStringify({ callerFunction, eventBlockNumber })}`));
    }
    
    const shouldEnableWs = await shouldEnableWebSocket(eventBlockNumber, callerFunction || 'executeIfInSync');
    if (!shouldEnableWs) {
        if (callerFunction) {
            console.log(logger.logSimple(eventBlockNumber, `${callerFunction} WebSocket disabled - skipping: ${safeStringify({ callerFunction })}`));
        }
        return;
    }
    
    if (callerFunction) {
        console.log(logger.logSimple(eventBlockNumber, `${callerFunction} Executing WebSocket operations: ${safeStringify({ callerFunction })}`));
    }
    
    await websocketOperations();
    
    if (callerFunction) {
        console.log(logger.logSimple(eventBlockNumber, `${callerFunction} WebSocket operations completed: ${safeStringify({ callerFunction })}`));
    }
}