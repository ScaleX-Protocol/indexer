import dotenv from "dotenv";
import { getCachedData } from "./redis";
import { createLogger, safeStringify } from "./logger";

dotenv.config();

const logger = createLogger('syncState.ts', 'shouldEnableWebSocket');
const executeLogger = createLogger('syncState.ts', 'executeIfInSync');

export const shouldEnableWebSocket = async (currentBlockNumber: number): Promise<boolean> => {
    try {
        const enabledWebSocket = process.env.ENABLE_WEBSOCKET === 'true';
        if (!enabledWebSocket) return false;

        const enabledBlockNumber = await getCachedData<number>('websocket:enable:block');
        if (!enabledBlockNumber) return true;

        console.log(`${logger.logSimple(currentBlockNumber, 'WebSocket enable check')}: ${safeStringify({
            enabledBlockNumber,
            shouldEnable: currentBlockNumber >= enabledBlockNumber
        })}`);

        return currentBlockNumber >= enabledBlockNumber;
    } catch (error) {
        console.error(`${logger.logSimple(currentBlockNumber, 'Error checking WebSocket enable status')}: ${error}`);
        return false;
    }
};

export async function executeIfInSync(
    eventBlockNumber: number,
    websocketOperations: () => Promise<void>
): Promise<void> {
    const shouldEnableWs = await shouldEnableWebSocket(eventBlockNumber);
    if (!shouldEnableWs) return;
    await websocketOperations();
}