import dotenv from "dotenv";
import { balances } from "ponder:schema";
import { createBalanceId } from "@/utils";
import { getAddress } from "viem";
import { pushBalanceUpdate } from "../websocket/broadcaster";
import { executeIfInSync } from "../utils/syncState";
import { getEventPublisher } from "@/events/index";

dotenv.config();

async function fetchAndPushBalance(context: any, balanceId: string, timestamp: number) {
    const blockNumber = context.block?.number || 0;

    await executeIfInSync(blockNumber, async () => {
        const balance = await context.db.find(balances, { id: balanceId });
        if (balance) {
            // Publish balance update event
            try {
                const eventPublisher = getEventPublisher();
                await eventPublisher.publishBalanceUpdate({
                    userId: balance.user,
                    token: balance.currency,
                    available: (balance.amount - balance.lockedAmount).toString(),
                    locked: balance.lockedAmount.toString(),
                    timestamp: timestamp.toString()
                });
            } catch (error) {
                console.error('Failed to publish balance update event:', error);
            }
            
            // Keep websocket for backward compatibility
            pushBalanceUpdate(balance.user, {
                e: "balanceUpdate",
                E: timestamp,
                a: balance.currency,
                b: balance.amount.toString(),
                l: balance.lockedAmount.toString()
            });
        }
    }, 'fetchAndPushBalance');
}

function fromId(id: number): string {
return `0x${id.toString(16).padStart(40, "0")}`;
}

export async function handleDeposit({ event, context }: any) {
	const { db } = context;
	const chainId = context.network.chainId;
	const user = event.args.user;
	const currency = getAddress(fromId(event.args.id));
	const balanceId = createBalanceId(chainId, currency, user);
    const timestamp = Number(event.block.timestamp);

	await db
		.insert(balances)
		.values({
			id: balanceId,
			user: user,
			chainId: chainId,
			currency: currency,
			amount: BigInt(event.args.amount),
			lockedAmount: BigInt(0),
		})
		.onConflictDoUpdate((row: any) => ({
			amount: row.amount + BigInt(event.args.amount),
		}));

    await fetchAndPushBalance(context, balanceId, Number(event.block?.timestamp ?? Date.now()));
}

export async function handleWithdrawal({ event, context }: any) {
	const chainId = context.network.chainId;
	const user = event.args.user;
	const currency = getAddress(fromId(event.args.id));
	const balanceId = createBalanceId(chainId, currency, user);
    const timestamp = Number(event.block.timestamp);

	await context.db.update(balances, { id: balanceId }).set((row: any) => ({
		amount: row.amount - BigInt(event.args.amount),
	}));

    await fetchAndPushBalance(context, balanceId, Number(event.block?.timestamp ?? Date.now()));
}

export async function handleTransferFrom({ event, context }: any) {
	const chainId = context.network.chainId;
	const netAmount = BigInt(event.args.amount) - BigInt(event.args.feeAmount);
	const currency = getAddress(fromId(event.args.id));
    const timestamp = Number(event.block.timestamp);

	// Update or insert sender balance
	const senderId = createBalanceId(chainId, currency, event.args.sender);
	await context.db.update(balances, { id: senderId }).set((row: any) => ({
		amount: row.amount - event.args.amount,
		user: event.args.sender,
		chainId: chainId,
	}));

    await fetchAndPushBalance(context, senderId, Number(event.block?.timestamp ?? Date.now()));

	// Update or insert receiver balance
	const receiverId = createBalanceId(chainId, currency, event.args.receiver);

	await context.db
		.insert(balances)
		.values({
			id: receiverId,
			user: event.args.receiver,
			chainId: chainId,
			amount: netAmount,
			lockedAmount: BigInt(0),
			currency: currency,
		})
		.onConflictDoUpdate((row: any) => ({
			amount: row.amount + netAmount,
		}));

    await fetchAndPushBalance(context, receiverId, Number(event.block?.timestamp ?? Date.now()));

	// // Update or insert operator balance
	const operatorId = createBalanceId(chainId, currency, event.args.operator);
	await context.db
		.insert(balances)
		.values({
			id: operatorId,
			user: event.args.operator,
			chainId: chainId,
			amount: BigInt(event.args.feeAmount),
			lockedAmount: BigInt(0),
			currency: currency,
		})
		.onConflictDoUpdate((row: any) => ({
			amount: row.amount + BigInt(event.args.feeAmount),
		}));

    await fetchAndPushBalance(context, operatorId, Number(event.block?.timestamp ?? Date.now()));
}

export async function handleTransferLockedFrom({ event, context }: any) {
	const chainId = context.network.chainId;
	const netAmount = BigInt(event.args.amount) - BigInt(event.args.feeAmount);
	const currency = getAddress(fromId(event.args.id));
    const timestamp = Number(event.block.timestamp);

	// Update sender locked balance
	const senderId = createBalanceId(chainId, currency, event.args.sender);
	await context.db.update(balances, { id: senderId }).set((row: any) => ({
		lockedAmount: row.lockedAmount - event.args.amount,
		user: event.args.sender,
		chainId: chainId,
	}));

    await fetchAndPushBalance(context, senderId, Number(event.block?.timestamp ?? Date.now()));

	// Update or insert receiver balance (unlocked)
	const receiverId = createBalanceId(chainId, currency, event.args.receiver);
	await context.db
		.insert(balances)
		.values({
			id: receiverId,
			user: event.args.receiver,
			chainId: chainId,
			amount: netAmount,
			lockedAmount: BigInt(0),
			currency: currency,
		})
		.onConflictDoUpdate((row: any) => ({
			amount: row.amount + netAmount,
		}));

    await fetchAndPushBalance(context, receiverId, Number(event.block?.timestamp ?? Date.now()));

	// Update or insert operator balance (unlocked)
	const operatorId = createBalanceId(chainId, currency, event.args.operator);
	await context.db
		.insert(balances)
		.values({
			id: operatorId,
			user: event.args.operator,
			chainId: chainId,
			amount: BigInt(event.args.feeAmount),
			lockedAmount: BigInt(0),
			currency: currency,
		})
		.onConflictDoUpdate((row: any) => ({
			amount: row.amount + BigInt(event.args.feeAmount),
		}));

    await fetchAndPushBalance(context, operatorId, Number(event.block?.timestamp ?? Date.now()));
}

export async function handleLock({ event, context }: any) {
	const chainId = context.network.chainId;
	const user = event.args.user;
	const currency = getAddress(fromId(event.args.id));
	const balanceId = createBalanceId(chainId, currency, user);
    const timestamp = Number(event.block.timestamp);

	await context.db.update(balances, { id: balanceId }).set((row: any) => ({
		amount: row.amount - BigInt(event.args.amount),
		lockedAmount: row.lockedAmount + BigInt(event.args.amount),
	}));

    await fetchAndPushBalance(context, balanceId, Number(event.block?.timestamp ?? Date.now()));
}

export async function handleUnlock({ event, context }: any) {
	const chainId = context.network.chainId;
	const user = event.args.user;
	const currency = getAddress(fromId(event.args.id));
	const balanceId = createBalanceId(chainId, currency, user);
    const timestamp = Number(event.block.timestamp);

	await context.db.update(balances, { id: balanceId }).set((row: any) => ({
		lockedAmount: row.lockedAmount - BigInt(event.args.amount),
		amount: row.amount + BigInt(event.args.amount),
	}));

    await fetchAndPushBalance(context, balanceId, Number(event.block?.timestamp ?? Date.now()));
}
