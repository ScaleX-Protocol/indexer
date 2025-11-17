import { db } from '../config/database';
import { faucetRequests } from '../schema/faucet.schema';
import { FaucetService, FaucetConfig, FaucetRequest } from '../services/faucet.service';
import { RateLimitService } from '../services/ratelimit.service';
import { NewFaucetRequest } from '../schema/faucet.schema';
import { eq, and } from 'drizzle-orm';

export class FaucetController {
  private rateLimitService: RateLimitService;
  
  constructor() {
    this.rateLimitService = RateLimitService.getInstance();
  }

  public async requestTokens(
    address: string,
    tokenAddress: string,
    amount: string | undefined,
    chainId: number,
    clientIP: string,
    userAgent?: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // Validate inputs
      if (!address || !tokenAddress) {
        return {
          success: false,
          error: "Address and tokenAddress are required"
        };
      }

      if (!address.startsWith('0x') || address.length !== 42) {
        return {
          success: false,
          error: "Invalid address format"
        };
      }

      if (!tokenAddress.startsWith('0x') || tokenAddress.length !== 42) {
        return {
          success: false,
          error: "Invalid token address format"
        };
      }

      // Check rate limits and cooldowns
      const rateLimitCheck = await this.rateLimitService.checkBothLimits(
        address.toLowerCase(),
        clientIP,
        3, // 3 requests per hour
        60 * 60 * 1000, // 1 hour window
        4 * 60 * 60 * 1000 // 4 hour cooldown
      );

      if (!rateLimitCheck.allowed) {
        let message = "Request blocked";
        switch (rateLimitCheck.reason) {
          case "ADDRESS_RATE_LIMIT":
            message = "Address rate limit exceeded. Please try again later.";
            break;
          case "IP_RATE_LIMIT":
            message = "IP rate limit exceeded. Please try again later.";
            break;
          case "ADDRESS_COOLDOWN":
            message = `Address cooldown active. Please wait ${Math.ceil(rateLimitCheck.remainingCooldown / (1000 * 60))} minutes.`;
            break;
          case "IP_COOLDOWN":
            message = `IP cooldown active. Please wait ${Math.ceil(rateLimitCheck.remainingCooldown / (1000 * 60))} minutes.`;
            break;
        }

        return {
          success: false,
          error: message
        };
      }

      // Get faucet configuration
      const faucetConfig = this.getFaucetConfig(chainId);
      if (!faucetConfig) {
        return {
          success: false,
          error: "Faucet not available for this chain"
        };
      }

      // Initialize faucet service
      const faucetService = FaucetService.getInstance(chainId, faucetConfig);

      // Record initial request as pending
      const requestId = await this.recordFaucetRequest({
        chainId,
        requesterAddress: address,
        receiverAddress: address,
        tokenAddress,
        tokenSymbol: 'UNKNOWN', // Will be updated after service call
        tokenDecimals: 18, // Will be updated after service call
        amount: BigInt(0), // Will be updated after service call
        amountFormatted: amount || '0',
        status: 'pending',
        requestTimestamp: new Date(),
        ipAddress: clientIP,
        userAgent: userAgent || null
      });

      // Send tokens
      const result = await faucetService.sendTokens({
        address: address as `0x${string}`,
        tokenAddress: tokenAddress as `0x${string}`,
        amount
      });

      if (result.success && requestId) {
        // Update request as completed
        await this.updateFaucetRequest(requestId, {
          status: 'completed',
          transactionHash: result.transactionHash || '',
          tokenSymbol: result.tokenSymbol || 'UNKNOWN',
          tokenDecimals: result.tokenDecimals || 18,
          amount: result.amountRaw || BigInt(0), // Use the raw amount from service
          amountFormatted: result.amountSent || '0',
          completedTimestamp: new Date()
        });

        // Consume rate limit and set cooldowns after successful request
        await this.rateLimitService.consumeBothLimits(
          address.toLowerCase(),
          clientIP,
          3, // 3 requests per hour
          60 * 60 * 1000 // 1 hour window
        );

        await this.rateLimitService.setCooldown(`addr:${address.toLowerCase()}`, 'address', 4 * 60 * 60 * 1000); // 4 hour address cooldown
        await this.rateLimitService.setCooldown(`ip:${clientIP}`, 'ip', 4 * 60 * 60 * 1000); // 4 hour IP cooldown

        return {
          success: true,
          data: {
            message: "Tokens sent successfully",
            transactionHash: result.transactionHash,
            amountSent: result.amountSent,
            tokenSymbol: result.tokenSymbol,
            chainId,
            requestId,
            timestamp: Date.now()
          }
        };
      } else if (requestId) {
        // Update request as failed
        await this.updateFaucetRequest(requestId, {
          status: 'failed',
          errorMessage: result.error || 'Unknown error',
          completedTimestamp: new Date()
        });
      }

      return {
        success: false,
        error: result.error
      };
    } catch (error: any) {
      console.error("Faucet request error:", error);
      return {
        success: false,
        error: error?.message || "Failed to process faucet request"
      };
    }
  }

  public async getFaucetAddress(chainId: number): Promise<{ success: boolean; address?: string; error?: string }> {
    try {
      const faucetConfig = this.getFaucetConfig(chainId);
      if (!faucetConfig) {
        return {
          success: false,
          error: "Faucet not available for this chain"
        };
      }

      const faucetService = FaucetService.getInstance(chainId, faucetConfig);
      const address = await faucetService.getFaucetAddress();

      return {
        success: true,
        address
      };
    } catch (error: any) {
      console.error("Error getting faucet address:", error);
      return {
        success: false,
        error: error?.message || "Failed to get faucet address"
      };
    }
  }

  public async getFaucetHistory(
    address?: string,
    chainId?: number,
    limit: number = 50
  ): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      console.log('📜 Debug: Fetching faucet history', { address, chainId, limit });
      let query = db
        .select()
        .from(faucetRequests)
        .orderBy(faucetRequests.requestTimestamp)
        .limit(limit);

      // Apply filters
      if (address && chainId) {
        query = query.where(
          and(
            eq(faucetRequests.requesterAddress, address.toLowerCase() as string),
            eq(faucetRequests.chainId, chainId)
          )
        );
      } else if (address) {
        query = query.where(eq(faucetRequests.requesterAddress, address.toLowerCase() as string));
      } else if (chainId) {
        query = query.where(eq(faucetRequests.chainId, chainId));
      }

      console.log('🔍 Debug: Executing query...');
      const results = await query;
      console.log('📊 Debug: Query results:', results.length, 'records');

      // Convert BigInt to string for JSON serialization
      const serializedResults = results.map(record => ({
        ...record,
        amount: record.amount ? record.amount.toString() : '0',
        gasUsed: record.gasUsed ? record.gasUsed.toString() : null,
        gasPrice: record.gasPrice ? record.gasPrice.toString() : null,
      }));

      return {
        success: true,
        data: serializedResults
      };
    } catch (error: any) {
      console.error("Error getting faucet history:", error);
      return {
        success: false,
        error: error?.message || "Failed to get faucet history"
      };
    }
  }

  private async recordFaucetRequest(request: NewFaucetRequest): Promise<string | null> {
    try {
      const result = await db.insert(faucetRequests).values(request).returning({ id: faucetRequests.id });
      return result[0]?.id || null;
    } catch (error) {
      console.error('Failed to record faucet request:', error);
      return null;
    }
  }

  private async updateFaucetRequest(
    id: string,
    updates: Partial<NewFaucetRequest>
  ): Promise<boolean> {
    try {
      const updateData: any = {};

      if (updates.status) updateData.status = updates.status;
      if (updates.transactionHash) updateData.transactionHash = updates.transactionHash.toLowerCase();
      if (updates.amount) updateData.amount = updates.amount;
      if (updates.amountFormatted) updateData.amountFormatted = updates.amountFormatted;
      if (updates.tokenSymbol) updateData.tokenSymbol = updates.tokenSymbol;
      if (updates.tokenDecimals) updateData.tokenDecimals = updates.tokenDecimals;
      if (updates.errorMessage) updateData.errorMessage = updates.errorMessage;
      if (updates.completedTimestamp) updateData.completedTimestamp = updates.completedTimestamp;

      if (Object.keys(updateData).length === 0) {
        return false;
      }

      await db
        .update(faucetRequests)
        .set(updateData)
        .where(eq(faucetRequests.id, parseInt(id)));

      return true;
    } catch (error) {
      console.error('Failed to update faucet request:', error);
      return false;
    }
  }

  private getFaucetConfig(chainId: number): FaucetConfig | null {
    const configs: Record<number, FaucetConfig> = {
      // Base Sepolia Testnet (Chain ID: 84532)
      84532: {
        rpcUrl: process.env.PONDER_RPC_URL || 'https://base-sepolia.g.alchemy.com/v2/jBG4sMyhez7V13jNTeQKfVfgNa54nCmF',
        privateKey: process.env.FAUCET_PRIVATE_KEY || '',
        chainId: 84532,
        defaultAmount: process.env.FAUCET_DEFAULT_AMOUNT || '1000'
      },
      // Local Anvil (Chain ID: 31337) - for development
      31337: {
        rpcUrl: process.env.FAUCET_RPC_URL_31337 || 'http://host.docker.internal:8545',
        privateKey: process.env.FAUCET_PRIVATE_KEY || '',
        chainId: 31337,
        defaultAmount: process.env.FAUCET_DEFAULT_AMOUNT || '1000'
      },
      // Local Anvil (Chain ID: 31338) - for development
      31338: {
        rpcUrl: process.env.FAUCET_RPC_URL_31338 || 'http://host.docker.internal:8546',
        privateKey: process.env.FAUCET_PRIVATE_KEY || '',
        chainId: 31338,
        defaultAmount: process.env.FAUCET_DEFAULT_AMOUNT || '1000'
      }
    };

    return configs[chainId] || null;
  }
}