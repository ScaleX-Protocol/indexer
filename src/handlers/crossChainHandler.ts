import { crossChainTransfers, hyperlaneMessages } from "ponder:schema";

// ChainBalanceManager deposit handling has been moved to chainBalanceManagerHandler.ts
// This file now only handles Hyperlane mailbox events

// Hyperlane Mailbox handlers (on all chains: appchain, rise, arbitrumSepolia, rari)

export async function handleHyperlaneMailboxDispatchId({ event, context }: any) {
	const { db } = context;

	console.log();

	// Store the Hyperlane DISPATCH message
	const dispatchId = `${event.args.messageId}-DISPATCH`;
	try {
		await db.insert(hyperlaneMessages).values({
			id: dispatchId,
			chainId: context.network.chainId,
			sender: event.transaction.from,
			messageId: event.args.messageId,
			type: "DISPATCH",
			transactionHash: event.transaction.hash,
			blockNumber: BigInt(event.block.number),
			timestamp: Number(event.block.timestamp),
		});
		console.log(`✅ Stored DISPATCH hyperlane message: ${dispatchId}`);
	} catch (error) {
		console.log(`❌ Error storing DISPATCH message: ${error}`);
	}

	// Update existing cross-chain transfer or create new one
	const transferId = `transfer-${event.transaction.hash}`;
	console.log(`🔍 Looking for transfer record: ${transferId}`);
}

export async function handleHyperlaneMailboxProcessId({ event, context }: any) {
	const { db } = context;

	// Store the Hyperlane PROCESS message
	const processId = `${event.args.messageId}-PROCESS`;
	try {
		await db.insert(hyperlaneMessages).values({
			id: processId,
			chainId: context.network.chainId,
			sender: event.transaction.from,
			messageId: event.args.messageId,
			type: "PROCESS",
			transactionHash: event.transaction.hash,
			blockNumber: BigInt(event.block.number),
			timestamp: Number(event.block.timestamp),
		});
		console.log(`✅ Stored PROCESS hyperlane message: ${processId}`);
	} catch (error) {
		console.log(`❌ Error storing PROCESS message: ${error}`);
	}

	// Find and update the transfer record by messageId
	console.log(`🔍 Looking for transfer record with messageId: ${event.args.messageId}`);

	try {
		const transfers = await db.find(crossChainTransfers, {
			messageId: event.args.messageId,
		});

		console.log(`🔍 Query result for messageId ${event.args.messageId}:`, {
			found: !!transfers,
			isArray: Array.isArray(transfers),
			count: Array.isArray(transfers) ? transfers.length : transfers ? 1 : 0,
		});

		if (transfers && (Array.isArray(transfers) ? transfers.length > 0 : true)) {
			const transfersArray = Array.isArray(transfers) ? transfers : [transfers];

			// Prefer transfer- records over any other records
			const transferRecord = transfersArray.find(t => t.id.startsWith("transfer-")) || transfersArray[0];

			console.log(`✅ Found transfer record ${transferRecord.id} (status: ${transferRecord.status})`);
			console.log(`🔄 Updating with destination info...`);

			// Update with destination information and mark as RELAYED
			await db
				.update(crossChainTransfers, {
					id: transferRecord.id,
				})
				.set({
					status: "RELAYED",
					destinationTransactionHash: event.transaction.hash,
					destinationBlockNumber: BigInt(event.block.number),
					destinationTimestamp: Number(event.block.timestamp),
				});

			console.log(`✅ Transfer ${transferRecord.id} completed: SENT → RELAYED`);

			// Clean up any duplicate records with same messageId
			// const duplicates = transfersArray.filter(t => t.id !== transferRecord.id);
			// for (const duplicate of duplicates) {
			// 	console.log(`🗑️ Cleaning up duplicate record: ${duplicate.id}`);
			// 	try {
			// 		await db
			// 			.update(crossChainTransfers, { id: duplicate.id })
			// 			.set({ id: `deleted-${duplicate.id}` });
			// 	} catch (cleanupError) {
			// 		console.log(`Could not clean up ${duplicate.id}: ${cleanupError}`);
			// 	}
			// }
		} else {
			console.log(`⚠️ No transfer found with messageId ${event.args.messageId}`);
			console.log(`This means ProcessId arrived before DispatchId - will wait for linking`);
			// In the new design, we don't create placeholder records
			// The transfer will be created/linked when DispatchId processes
		}
	} catch (error) {
		console.log(`❌ Error in ProcessId handler: ${error}`);
	}
}
