import { db } from '../config/database';
import { currencies } from '../schema/aggregated';
import { eq } from 'drizzle-orm';

export class CurrencyService {
  async getAllCurrencies(): Promise<any[]> {
    const result = await db
      .select()
      .from(currencies)
      .where(eq(currencies.isActive, true));

    return result.map(currency => ({
      id: currency.id,
      address: currency.address,
      name: currency.name,
      symbol: currency.symbol,
      decimals: currency.decimals,
      isActive: currency.isActive,
      registeredAt: currency.registeredAt,
    }));
  }

  async getCurrency(address: string): Promise<any | null> {
    const result = await db
      .select()
      .from(currencies)
      .where(eq(currencies.address, address.toLowerCase()))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const currency = result[0];
    return {
      id: currency.id,
      address: currency.address,
      name: currency.name,
      symbol: currency.symbol,
      decimals: currency.decimals,
      isActive: currency.isActive,
      registeredAt: currency.registeredAt,
    };
  }
}

export const currencyService = new CurrencyService();
