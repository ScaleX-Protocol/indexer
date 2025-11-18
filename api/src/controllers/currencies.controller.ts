import { ponderDb } from '../config/database';
import { eq, asc, and } from 'drizzle-orm';
import { currencies } from '../schema/ponder-currencies';

export const getAllCurrencies = async ({ query }: { query: any }) => {
  try {
    const chainId = query.chainId ? parseInt(query.chainId) : undefined;
    const limit = parseInt(query.limit) || 100;
    const offset = parseInt(query.offset) || 0;

    let dbQuery = ponderDb.select({
      address: currencies.address,
      symbol: currencies.symbol,
      name: currencies.name,
      decimals: currencies.decimals,
      chainId: currencies.chainId,
    }).from(currencies);

    // Apply filters
    const conditions = [];
    if (chainId) {
      conditions.push(eq(currencies.chainId, chainId));
    }

    if (conditions.length > 0) {
      dbQuery = dbQuery.where(and(...conditions));
    }

    const allCurrencies = await dbQuery
      .orderBy(asc(currencies.symbol))
      .limit(limit)
      .offset(offset)
      .execute();

    // Get total count
    const countQuery = ponderDb.select({ count: currencies.address }).from(currencies);
    if (conditions.length > 0) {
      countQuery.where(and(...conditions));
    }
    const countResult = await countQuery.execute();
    
    return {
      success: true,
      message: 'Currencies retrieved successfully',
      data: {
        items: allCurrencies,
        total: countResult.length,
        limit,
        offset,
      }
    };
  } catch (error) {
    console.error('Error fetching currencies:', error);
    return {
      success: false,
      message: 'Failed to fetch currencies',
      data: null
    };
  }
};

export const getCurrencyByAddress = async ({ params }: { params: any }) => {
  try {
    const { address } = params;

    const currency = await ponderDb
      .select()
      .from(currencies)
      .where(eq(currencies.address, address))
      .limit(1)
      .execute();

    if (currency.length === 0) {
      return {
        success: false,
        message: 'Currency not found',
        data: null
      };
    }

    return {
      success: true,
      message: 'Currency retrieved successfully',
      data: currency[0]
    };
  } catch (error) {
    console.error('Error fetching currency:', error);
    return {
      success: false,
      message: 'Failed to fetch currency',
      data: null
    };
  }
};