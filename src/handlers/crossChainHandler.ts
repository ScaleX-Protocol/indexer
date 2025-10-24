import { crossChainTransfers, hyperlaneMessages, crossChainMessageLinks } from "ponder:schema";

// ChainBalanceManager deposit handling has been moved to chainBalanceManagerHandler.ts
// This file now only handles Hyperlane mailbox events

// Hyperlane Mailbox handlers (on all chains: appchain, rise, arbitrumSepolia, rari)

export async function handleHyperlaneMailboxDispatchId({ event, context }: any) {
	const { db } = context;

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

	// Create cross-chain message link record using conflict-based approach
	try {
		await db.insert(crossChainMessageLinks).values({
			messageId: event.args.messageId,
			sourceTransactionHash: event.transaction.hash,
			destinationTransactionHash: null, // Will be filled by Process handler
			sourceChainId: context.network.chainId,
			destinationChainId: null, // Will be filled by Process handler
			sourceTimestamp: Number(event.block.timestamp),
			destinationTimestamp: null, // Will be filled by Process handler
			status: "SENT", // Initial status
		}).onConflictDoUpdate({
			sourceTransactionHash: event.transaction.hash,
			sourceChainId: context.network.chainId,
			sourceTimestamp: Number(event.block.timestamp),
			status: "SENT",
		});
		console.log(`🔗 Created link record for DISPATCH: ${event.args.messageId}`);
	} catch (error) {
		console.log(`❌ Error creating link record: ${error}`);
	}

	// Update transfer record using sourceTransactionHash ID (same as deposit handler)
	try {
		const transferId = `transfer-${event.transaction.hash}`;
		
		await db.insert(crossChainTransfers).values({
			id: transferId, // Use same ID pattern as deposit handler (sourceTransactionHash)
			messageId: event.args.messageId,
			dispatchMessageId: `${event.args.messageId}-DISPATCH`, // Reference to DISPATCH message
			processMessageId: null, // Will be set by PROCESS handler
			status: "SENT",
			sourceChainId: context.network.chainId,
			destinationChainId: null, // Will be determined by PROCESS handler
			sender: "", // Will be preserved from existing deposit record
			recipient: "", // Will be preserved from existing deposit record
			sourceToken: "", // Will be preserved from existing deposit record
			amount: 0n, // Will be preserved from existing deposit record
			sourceTransactionHash: event.transaction.hash,
			sourceBlockNumber: BigInt(event.block.number),
			timestamp: Number(event.block.timestamp),
			direction: "DEPOSIT",
			destinationTransactionHash: null, // Will be set by PROCESS handler
			destinationBlockNumber: null,
			destinationTimestamp: null,
		}).onConflictDoUpdate({
			messageId: event.args.messageId,
			dispatchMessageId: `${event.args.messageId}-DISPATCH`,
			status: "SENT",
			sourceChainId: context.network.chainId,
			sourceTransactionHash: event.transaction.hash,
			sourceBlockNumber: BigInt(event.block.number),
			timestamp: Number(event.block.timestamp),
		});
		
		console.log(`✅ Updated transfer record ${transferId} with messageId: ${event.args.messageId}`);
	} catch (error) {
		console.log(`❌ Error updating transfer record: ${error}`);
	}
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

	// Simplified approach: Update crossChainMessageLinks table with conflict resolution
	console.log(`🔗 Updating message link record for messageId: ${event.args.messageId}`);
	
	try {
		// Update the crossChainMessageLinks table using conflict-based approach
		await db.insert(crossChainMessageLinks).values({
			messageId: event.args.messageId,
			sourceTransactionHash: null, // Keep existing if any
			destinationTransactionHash: event.transaction.hash,
			sourceChainId: null, // Keep existing if any
			destinationChainId: context.network.chainId,
			sourceTimestamp: null, // Keep existing if any
			destinationTimestamp: Number(event.block.timestamp),
			status: "RELAYED",
		}).onConflictDoUpdate({
			destinationTransactionHash: event.transaction.hash,
			destinationChainId: context.network.chainId,
			destinationTimestamp: Number(event.block.timestamp),
			status: "RELAYED",
		});
		
		console.log(`✅ Updated message link record to RELAYED for messageId: ${event.args.messageId}`);
		
		// Update transfer record using consistent ID pattern (find sourceTransactionHash from messageId)
		try {
			// Find the existing transfer record by messageId to get the sourceTransactionHash
			const existingTransfer = await db.sql`
				SELECT source_transaction_hash FROM cross_chain_transfers 
				WHERE message_id = ${event.args.messageId}
				AND source_transaction_hash IS NOT NULL
				LIMIT 1
			`;
			
			if (existingTransfer && existingTransfer.length > 0) {
				// Use the same ID pattern as deposit and dispatch handlers
				const transferId = `transfer-${existingTransfer[0].source_transaction_hash}`;
				
				await db.insert(crossChainTransfers).values({
					id: transferId, // Use consistent ID pattern based on sourceTransactionHash
					messageId: event.args.messageId,
					dispatchMessageId: null, // Will be preserved from existing record
					processMessageId: `${event.args.messageId}-PROCESS`, // Reference to PROCESS message
					status: "RELAYED",
					destinationTransactionHash: event.transaction.hash,
					destinationBlockNumber: BigInt(event.block.number),
					destinationTimestamp: Number(event.block.timestamp),
					destinationChainId: context.network.chainId,
					sourceChainId: null, // Will be preserved from existing record
					sender: "", // Will be preserved from existing record
					recipient: "", // Will be preserved from existing record
					sourceToken: "", // Will be preserved from existing record
					amount: 0n, // Will be preserved from existing record
					sourceTransactionHash: existingTransfer[0].source_transaction_hash, // Preserve from existing
					sourceBlockNumber: BigInt(0), // Will be preserved from existing record
					timestamp: 0, // Will be preserved from existing record
					direction: "DEPOSIT",
				}).onConflictDoUpdate({
					messageId: event.args.messageId,
					processMessageId: `${event.args.messageId}-PROCESS`,
					status: "RELAYED",
					destinationTransactionHash: event.transaction.hash,
					destinationBlockNumber: BigInt(event.block.number),
					destinationTimestamp: Number(event.block.timestamp),
					destinationChainId: context.network.chainId,
				});
				
				console.log(`✅ Updated transfer record ${transferId} to RELAYED using messageId: ${event.args.messageId}`);
			} else {
				console.log(`⚠️  No existing transfer record found for process: ${event.args.messageId}`);
			}
		} catch (error) {
			console.log(`❌ Error updating transfer record with process: ${error}`);
		}
		
		} catch (error) {
		console.log(`❌ Error in ProcessId handler: ${error}`);
	}
}

