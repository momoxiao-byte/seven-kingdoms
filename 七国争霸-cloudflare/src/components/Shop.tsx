import React, { useState } from 'react';
import { useCurrencyStore, STACKABLE_ITEMS } from '../stores/currencyStore';

interface ShopItem {
  id: string;
  name: string;
  emoji: string;
  price: number;
  desc: string;
}

// 商城道具列表
const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'color_pick',
    name: '选择颜色',
    emoji: '🎨',
    price: 5,
    desc: '开局准备阶段可以自选玩家颜色，先选先得，颜色不可重复。',
  },
  {
    id: 'airship',
    name: '飞艇',
    emoji: '🛩️',
    price: 30,
    desc: '游戏开始后在装备栏可见，使用后可攻击地图上任意非敌方首都/首都相邻格。',
  },
  {
    id: 'shield',
    name: '护盾',
    emoji: '🛡️',
    price: 50,
    desc: '使用后 2 分钟内敌方无法攻击/占领你的任何领地，且你仍可正常攻击敌方。',
  },
  {
    id: 'guided_missile',
    name: '指导导弹',
    emoji: '🚀',
    price: 1500,
    desc: '一次性道具，使用后立即随机毁灭约 20 个敌方格子（变为中立地，原主不获补偿）。无法攻击首都、首都相邻格和处于护盾期的玩家。',
  },
  {
    id: 'haste',
    name: '迅捷药水',
    emoji: '⚡',
    price: 70,
    desc: '使用后 1 分钟内占领 CD 从 0.5 秒降为 0.2 秒，大幅提升扩张速度。',
  },
  {
    id: 'nuclear_missile',
    name: '核能导弹',
    emoji: '☢️',
    price: 2000,
    desc: '一次性道具，使用后选择一个国家直接消灭：该国家所有领地变为中立地，玩家直接淘汰。无视护盾和首都保护。',
  },
  {
    id: 'wall',
    name: '城墙',
    emoji: '🏰',
    price: 40,
    desc: '使用后，你当前所有领地（包括首都及首都相邻格）获得永久城墙保护。敌方需点击两次才能占领：第1次消耗3000金币击破城墙，第2次才能正常占领。不保护以后新占领的领地。',
  },
  {
    id: 'tnt',
    name: 'TNT',
    emoji: '🧨',
    price: 50,
    desc: '一次性道具，使用后选择地图上任意一格引爆：中心格及相邻共约7格变为NPC中立地。若某格有城墙，城墙只破一次不被炸成NPC。最多携带3个进入局内。',
  },
  {
    id: 'rename_card',
    name: '改名卡',
    emoji: '✏️',
    price: 200,
    desc: '一次性道具，在大厅使用：解锁一次修改游戏名字的机会，好友列表、好友申请与私聊记录会自动迁移到新名字。',
  },
  // ---- 新道具 ----
  {
    id: 'recon_card',
    name: '侦察卡',
    emoji: '🗺️',
    price: 30,
    desc: '使用后随机揭示3块敌方领地的归属与主人金币，知己知彼。',
  },
  {
    id: 'lightning_card',
    name: '闪电卡',
    emoji: '⚡',
    price: 100,
    desc: '使用后本回合占领CD归零（限1次/局），闪电扩张！',
  },
  {
    id: 'lucky_card',
    name: '幸运卡',
    emoji: '🎁',
    price: 100,
    desc: '使用后下次占领奖励翻3倍，攒好你的幸运！',
  },
  {
    id: 'reflect_card',
    name: '反弹卡',
    emoji: '🪞',
    price: 60,
    desc: '使用后60秒内被攻击时反弹50%伤害给攻击方，让敌人自食其果！',
  },
  {
    id: 'prophecy_card',
    name: '预言卡',
    emoji: '🔮',
    price: 100,
    desc: '使用后显示所有敌方玩家的金币数，知己知彼！',
  },
  {
    id: 'mystery_box_premium',
    name: '高级盲盒',
    emoji: '📦',
    price: 500,
    desc: '开启后保证获得一个稀有道具（指导导弹/核能导弹/护盾/迅捷药水等），稳赚不亏！',
  },
];

interface ShopProps {
  onBack: () => void;
  onOpenRedeem: () => void;
}

export default function Shop({ onBack, onOpenRedeem }: ShopProps) {
  const { currency, purchasedItems, purchaseItem, addCurrency, getItemCount } = useCurrencyStore();
  const [toast, setToast] = useState<string | null>(null);
  // 开发者模式弹窗状态
  const [devOpen, setDevOpen] = useState(false);
  const [devInput, setDevInput] = useState('');
  const [devError, setDevError] = useState<string | null>(null);
  // 开发者口令（仅用于测试道具，输入正确一次性奖励 3000 货币）
  const DEV_PASSWORD = 'Yoyoo@12';
  const DEV_REWARD = 3000;

  const handleBuy = (item: ShopItem) => {
    if (item.price === 0) {
      setToast('此道具位尚未开放，敬请期待！');
      setTimeout(() => setToast(null), 2000);
      return;
    }
    const ok = purchaseItem(item.id, item.price);
    if (ok) {
      setToast(
        item.id === 'rename_card'
          ? '改名卡购买成功！回到大厅，点击名字旁的"✏️ 改名"按钮即可使用。'
          : `购买成功：${item.name}！进入房间准备阶段即可使用。`
      );
    } else {
      if (purchasedItems.includes(item.id)) {
        setToast('已拥有该道具');
      } else {
        setToast('系统货币不足！');
      }
    }
    setTimeout(() => setToast(null), 2500);
  };

  // 开发者口令校验：成功则一次性 +3000 货币（用于测试道具）
  const handleDevSubmit = () => {
    if (devInput === DEV_PASSWORD) {
      addCurrency(DEV_REWARD);
      setToast(`🛠️ 开发者模式：已发放 ${DEV_REWARD} 系统货币（仅供测试）`);
      setDevOpen(false);
      setDevInput('');
      setDevError(null);
      setTimeout(() => setToast(null), 3000);
    } else {
      setDevError('口令错误');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-secondary/80 backdrop-blur rounded-2xl p-6 sm:p-8 shadow-2xl w-full max-w-2xl border border-accent/20">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-3xl font-serif text-accent flex items-center gap-2">
            <span>🛒</span> 系统商城
          </h1>
          <div className="flex items-center gap-3">
            <div className="bg-primary/50 rounded-lg px-4 py-2 border border-yellow-500/30">
              <span className="text-yellow-400 font-bold text-lg">{currency}</span>
              <span className="text-gray-400 text-sm ml-1">系统货币</span>
            </div>
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-all text-sm"
            >
              ← 返回大厅
            </button>
          </div>
        </div>

        {/* 道具网格 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {SHOP_ITEMS.map((item) => {
            const count = getItemCount(item.id);
            const stackMax = STACKABLE_ITEMS[item.id];
            const isStackable = stackMax !== undefined;
            const owned = isStackable ? count >= stackMax : count >= 1; // 堆叠满才算"已拥有"
            return (
              <div
                key={item.id}
                className={`bg-primary/50 rounded-xl p-4 border ${
                  owned
                    ? 'border-success/40 opacity-70'
                    : 'border-accent/20 hover:border-accent/50'
                } transition-all flex flex-col items-center text-center`}
              >
                <div className="text-4xl mb-2">{item.emoji}</div>
                <h3 className="font-bold text-white mb-1 flex items-center gap-1">
                  {item.name}
                  {isStackable && count > 0 && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                      x{count}/{stackMax}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-gray-500 mb-3 flex-1">{item.desc}</p>
                {item.price > 0 && (
                  <p className="text-yellow-400 text-sm font-bold mb-2">{item.price} 货币</p>
                )}
                <button
                  onClick={() => handleBuy(item)}
                  disabled={owned || item.price === 0}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-all ${
                    owned
                      ? 'bg-success/20 text-success cursor-default'
                      : item.price === 0
                      ? 'bg-gray-600/50 text-gray-500 cursor-not-allowed'
                      : 'bg-accent text-primary hover:bg-accent/90'
                  }`}
                >
                  {owned
                    ? isStackable
                      ? `已达上限 (${stackMax})`
                      : '已拥有'
                    : item.price === 0
                    ? '未开放'
                    : isStackable
                    ? `购买（已持有${count}）`
                    : '购买'}
                </button>
              </div>
            );
          })}
        </div>

        {/* 说明 */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>💡 赢得对局可获得 +10 系统货币，可用于购买商城道具</p>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-black/80 text-white px-6 py-3 rounded-lg shadow-lg z-50 border border-accent/30">
            {toast}
          </div>
        )}
      </div>

      {/* 左下角小字入口：兑换码 */}
      <button
        onClick={onOpenRedeem}
        className="fixed bottom-4 left-4 text-xs text-gray-400 hover:text-accent underline underline-offset-4 transition-colors z-40"
      >
        兑换码
      </button>

      {/* 右下角小字入口：开发者模式（仅供测试道具） */}
      <button
        onClick={() => { setDevOpen(true); setDevError(null); setDevInput(''); }}
        className="fixed bottom-4 right-4 text-xs text-gray-600 hover:text-accent underline underline-offset-4 transition-colors z-40"
      >
        开发者模式
      </button>

      {/* 开发者模式弹窗 */}
      {devOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-secondary rounded-2xl p-6 w-full max-w-sm border border-accent/30 shadow-2xl">
            <h2 className="text-xl font-serif text-accent mb-2 flex items-center gap-2">
              <span>🛠️</span> 开发者模式
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              输入口令可一次性获得 {DEV_REWARD} 系统货币，用于测试商城道具。
            </p>
            <input
              type="password"
              autoFocus
              value={devInput}
              onChange={(e) => { setDevInput(e.target.value); setDevError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDevSubmit(); }}
              placeholder="请输入开发者口令"
              className="w-full px-3 py-2 bg-primary rounded-md text-white text-sm placeholder:text-gray-500 border border-accent/20 focus:outline-none focus:border-accent mb-2"
            />
            {devError && (
              <div className="text-xs text-danger mb-2">{devError}</div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleDevSubmit}
                className="flex-1 py-2 rounded-md text-sm font-medium bg-accent text-primary hover:bg-accent/90 transition-all"
              >
                确认
              </button>
              <button
                onClick={() => { setDevOpen(false); setDevInput(''); setDevError(null); }}
                className="px-4 py-2 rounded-md text-sm font-medium bg-gray-600 text-white hover:bg-gray-500 transition-all"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
