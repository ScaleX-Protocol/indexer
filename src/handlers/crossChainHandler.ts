import { crossChainTransfers, hyperlaneMessages } from "ponder:schema";

// Get chain name helper function
const getChainName = (chainId: number) => {
	switch (chainId) {
		case 4661:
			return "appchain-testnet";
		case 11155931:
			return "rise-sepolia";
		case 421614:
			return "arbitrum-sepolia";
		case 1918988905:
			return "rari-testnet";
		default:
			return "unknown";
	}
};

// ChainBalanceManager handlers (only on source chains: appchain, rise, arbitrum)
export async function handleChainBalanceManagerDeposit({ event, context }: any) {
	const { db } = context;
	console.log(`=== ChainBalanceManager Deposit event.args:`, event.args);
	console.log(
		`=== Extracted values: depositor=${event.args.depositor}, recipient=${event.args.recipient}, token=${event.args.token}, amount=${event.args.amount}, txHash=${event.transaction.hash} ===`
	);

	// Use transaction hash as the primary ID for the entire transfer lifecycle
	const transferId = `transfer-${event.transaction.hash}`;

	const depositData = {
		id: transferId,
		sourceChainId: context.network.chainId,
		destinationChainId: 1918988905, // Always Rari for deposits
		sender: event.args.depositor || event.transaction.from,
		recipient: event.args.recipient || event.args.depositor || event.transaction.from,
		sourceToken: event.args.token,
		amount: BigInt(event.args.amount),
		sourceTransactionHash: event.transaction.hash,
		sourceBlockNumber: BigInt(event.block.number),
		timestamp: Number(event.block.timestamp),
		status: "SENT",
		direction: "DEPOSIT",
		// These will be filled by DispatchId and ProcessId events
		messageId: null,
		destinationTransactionHash: null,
		destinationBlockNumber: null,
		destinationTimestamp: null,
	};

	console.log(`💡 Creating/updating deposit record: ${transferId}`);

	try {
		// Use Ponder's built-in upsert with conflict resolution
		await db
			.insert(crossChainTransfers)
			.values(depositData)
			.onConflictDoUpdate(row => ({
				// Update existing record (from DispatchId) with accurate deposit data
				sender: depositData.sender,
				recipient: depositData.recipient,
				sourceToken: depositData.sourceToken,
				amount: depositData.amount,
				sourceChainId: depositData.sourceChainId,
				destinationChainId: depositData.destinationChainId,
				sourceTransactionHash: depositData.sourceTransactionHash,
				sourceBlockNumber: depositData.sourceBlockNumber,
				timestamp: depositData.timestamp,
				direction: depositData.direction,
				// Keep messageId and status from DispatchId if they exist
				messageId: row.messageId || depositData.messageId,
				status: row.status || depositData.status,
				// Keep destination fields if ProcessId already updated them
				destinationTransactionHash: row.destinationTransactionHash || depositData.destinationTransactionHash,
				destinationBlockNumber: row.destinationBlockNumber || depositData.destinationBlockNumber,
				destinationTimestamp: row.destinationTimestamp || depositData.destinationTimestamp,
			}));

		console.log(`✅ Upserted deposit record: ${transferId}`);
	} catch (error) {
		console.log(`❌ Error upserting deposit: ${error}`);
	}
}

// Hyperlane Mailbox handlers (on all chains: appchain, rise, arbitrum, rari)

export async function handleHyperlaneMailboxDispatchId({ event, context }: any) {
	const { db } = context;

	console.log(
		`=== DispatchId event: messageId=${event.args.messageId}, txHash=${event.transaction.hash}, chainId=${context.network.chainId} ===`
	);

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

	console.log(
		`=== ProcessId event: messageId=${event.args.messageId}, txHash=${event.transaction.hash}, chainId=${context.network.chainId} ===`
	);

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
