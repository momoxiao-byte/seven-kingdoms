import React, { useState } from 'react';
import { useCurrencyStore, REDEEM_MAX_TIMES } from '../stores/currencyStore';

interface RedeemProps {
  onBack: () => void;
}

export default function Redeem({ onBack }: RedeemProps) {
  const { currency, redeemCount, redeemCode } = useCurrencyStore();
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const remain = Math.max(0, REDEEM_MAX_TIMES - redeemCount);
  const reachedLimit = redeemCount >= REDEEM_MAX_TIMES;

  const handleRedeem = () => {
    const result = redeemCode(input);
    if (result.ok) {
      setMsg({
        text: `兑换成功！获得 ${result.reward} 系统货币，剩余 ${result.remain} 次`,
        ok: true,
      });
      setInput('');
    } else {
      setMsg({ text: result.error || '兑换失败', ok: false });
    }
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-secondary/80 backdrop-blur rounded-2xl p-6 sm:p-8 shadow-2xl w-full max-w-md border border-accent/20">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-serif text-accent flex items-center gap-2">
            <span>🎁</span> 口令兑换码
          </h1>
          <button
            onClick={onBack}
            className="px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-all text-sm"
          >
            ← 返回
          </button>
        </div>

        {/* 货币 + 剩余次数 */}
        <div className="flex items-center justify-between bg-primary/50 rounded-lg px-4 py-3 border border-yellow-500/30 mb-5">
          <div>
            <div className="text-xs text-gray-400">当前系统货币</div>
            <div className="text-yellow-400 font-bold text-lg">{currency}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">剩余兑换次数</div>
            <div className={`font-bold text-lg ${remain > 0 ? 'text-accent' : 'text-danger'}`}>
              {remain} / {REDEEM_MAX_TIMES}
            </div>
          </div>
        </div>

        {/* 输入区 */}
        <div className="space-y-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !reachedLimit) handleRedeem(); }}
            disabled={reachedLimit}
            placeholder="请输入兑换码"
            className="w-full bg-primary text-white px-4 py-3 rounded-lg border border-gray-600 text-base focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            onClick={handleRedeem}
            disabled={reachedLimit || !input.trim()}
            className="w-full py-3 bg-accent text-primary rounded-lg font-bold text-base hover:bg-accent/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            兑换
          </button>
        </div>

        {/* 结果反馈 */}
        {msg && (
          <div
            className={`mt-4 text-center text-sm ${
              msg.ok ? 'text-success' : 'text-danger'
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* 已达上限提示 */}
        {reachedLimit && (
          <div className="mt-4 text-center text-xs text-danger">
            您的兑换次数已用完（{REDEEM_MAX_TIMES} 次）
          </div>
        )}

        {/* 说明 */}
        <div className="mt-6 text-center text-xs text-gray-500">
          <p>💡 每个用户累计可兑换 {REDEEM_MAX_TIMES} 次</p>
        </div>
      </div>
    </div>
  );
}
