import { create } from 'zustand';

// 系统货币 + 已购物品 store（localStorage 持久化）
const CURRENCY_KEY = 'sk_system_currency';
const ITEMS_KEY = 'sk_purchased_items';

function loadCurrency(): number {
  try {
    const v = localStorage.getItem(CURRENCY_KEY);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveCurrency(v: number): void {
  try {
    localStorage.setItem(CURRENCY_KEY, String(v));
  } catch {
    // ignore
  }
}

function loadItems(): string[] {
  try {
    const v = localStorage.getItem(ITEMS_KEY);
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}

function saveItems(items: string[]): void {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

// ---- 口令兑换码 ----
// 兑换码 → 奖励系统货币数量（输入不区分大小写）
export const REDEEM_CODES: Record<string, number> = {
  18611937288: 30,
};

// 每个用户最多可兑换次数（不区分兑换码内容，总计 46 次）
export const REDEEM_MAX_TIMES = 46;

const REDEEM_COUNT_KEY = 'sk_redeem_count';

function loadRedeemCount(): number {
  try {
    const v = localStorage.getItem(REDEEM_COUNT_KEY);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveRedeemCount(count: number): void {
  try {
    localStorage.setItem(REDEEM_COUNT_KEY, String(count));
  } catch {
    // ignore
  }
}

// 支持叠加购买的道具及其持有上限
export const STACKABLE_ITEMS: Record<string, number> = {
  tnt: 3, // TNT 最多持有 3 个
  recon_card: 5,      // 侦察卡最多 5 个
  lightning_card: 1,   // 闪电卡每局限 1 个
  lucky_card: 3,       // 幸运卡最多 3 个
  reflect_card: 3,     // 反弹卡最多 3 个
  prophecy_card: 3,    // 预言卡最多 3 个
  mystery_box_premium: 5, // 高级盲盒最多 5 个
};

interface CurrencyState {
  currency: number;
  purchasedItems: string[]; // 已购买的道具 ID 列表（可叠加道具重复出现）
  redeemCount: number; // 已使用兑换码次数
  addCurrency: (amount: number) => void;
  spendCurrency: (amount: number) => boolean;
  setCurrency: (amount: number) => void;
  hasItem: (itemId: string) => boolean; // 是否至少拥有 1 个
  getItemCount: (itemId: string) => number; // 具体持有数量
  purchaseItem: (itemId: string, price: number) => boolean; // 返回是否购买成功
  consumeItem: (itemId: string) => void; // 使用后消耗 1 个
  // 兑换码：成功时返回 { ok: true, reward }，失败时返回 { ok: false, error }
  redeemCode: (code: string) => { ok: boolean; reward?: number; remain?: number; error?: string };
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  currency: loadCurrency(),
  purchasedItems: loadItems(),
  redeemCount: loadRedeemCount(),

  addCurrency: (amount) => {
    const next = get().currency + amount;
    saveCurrency(next);
    set({ currency: next });
  },

  spendCurrency: (amount) => {
    const cur = get().currency;
    if (cur < amount) return false;
    const next = cur - amount;
    saveCurrency(next);
    set({ currency: next });
    return true;
  },

  setCurrency: (amount) => {
    saveCurrency(amount);
    set({ currency: amount });
  },

  hasItem: (itemId) => get().purchasedItems.includes(itemId),

  getItemCount: (itemId) => get().purchasedItems.filter((id) => id === itemId).length,

  purchaseItem: (itemId, price) => {
    const state = get();
    const count = state.purchasedItems.filter((id) => id === itemId).length;
    const stackMax = STACKABLE_ITEMS[itemId];
    if (stackMax !== undefined) {
      if (count >= stackMax) return false; // 已达堆叠上限
    } else {
      if (count >= 1) return false; // 非可堆叠道具：已拥有
    }
    if (state.currency < price) return false; // 货币不足
    const nextCurrency = state.currency - price;
    const nextItems = [...state.purchasedItems, itemId];
    saveCurrency(nextCurrency);
    saveItems(nextItems);
    set({ currency: nextCurrency, purchasedItems: nextItems });
    return true;
  },

  consumeItem: (itemId) => {
    // 只移除第一个匹配项（使用1个），而不是全部删掉
    const items = [...get().purchasedItems];
    const idx = items.indexOf(itemId);
    if (idx > -1) {
      items.splice(idx, 1);
      saveItems(items);
      set({ purchasedItems: items });
    }
  },

  redeemCode: (rawCode) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return { ok: false, error: '请输入兑换码' };

    const used = get().redeemCount;
    if (used >= REDEEM_MAX_TIMES) {
      return { ok: false, error: `已达兑换上限（${REDEEM_MAX_TIMES} 次）` };
    }

    const reward = REDEEM_CODES[code];
    if (reward === undefined) {
      return { ok: false, error: '兑换码无效' };
    }

    // 发奖 + 累加次数
    const nextCurrency = get().currency + reward;
    const nextCount = used + 1;
    saveCurrency(nextCurrency);
    saveRedeemCount(nextCount);
    set({ currency: nextCurrency, redeemCount: nextCount });
    return { ok: true, reward, remain: REDEEM_MAX_TIMES - nextCount };
  },
}));
