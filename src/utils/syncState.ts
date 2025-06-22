import dotenv from "dotenv";
import { getCachedData } from "./redis";

dotenv.config();

export const shouldEnableWebSocket = async (currentBlockNumber: number): Promise<boolean> => {
    try {
        const enabledWebSocket = process.env.ENABLE_WEBSOCKET === 'true';
        if (!enabledWebSocket) return false;

        const enabledBlockNumber = await getCachedData<number>('websocket:enable:block');
        if (!enabledBlockNumber) return true;

        console.log('shouldEnableWebSocket', currentBlockNumber, enabledBlockNumber, currentBlockNumber >= enabledBlockNumber)

        return currentBlockNumber >= enabledBlockNumber;
    } catch (error) {
        console.error(`Error checking if websocket should be enabled:`, error);
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