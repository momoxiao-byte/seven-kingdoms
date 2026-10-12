import React, { useState } from 'react';
import { useSocket } from '../hooks/useSocket';

interface NameEntryProps {
  // 确认登录：App 负责写入 localStorage 并放行进大厅
  onConfirm: (name: string) => void;
}

/**
 * 首次进入游戏：账号登录/注册页
 * - 输入名字 + 密码，服务端自动区分：
 *   · 新名字 → 注册新账号（请记住密码）
 *   · 已有名字 → 校验密码，正确才进入
 * - 登录成功后本机记住名字（localStorage），刷新免登录
 * - 名字确认后锁定，之后改名只能使用商城购买的"改名卡"（改名后密码自动跟随新名字）
 */
export default function NameEntry({ onConfirm }: NameEntryProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const { registerName } = useSocket();

  const handleConfirm = () => {
    const n = name.trim().slice(0, 12);
    if (!n) {
      setError('名字不能为空');
      return;
    }
    if (password.length < 4) {
      setError('密码至少 4 位');
      return;
    }
    setIsChecking(true);
    setError(null);
    // 向服务器认证：新名字自动注册，老名字校验密码
    registerName(n, password, (ok, err) => {
      setIsChecking(false);
      if (!ok) {
        setError(err || '登录失败，请重试');
        return;
      }
      onConfirm(n);
    });
  };

  const canSubmit = !!name.trim() && password.length >= 4 && !isChecking;

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-secondary/80 backdrop-blur rounded-2xl p-8 shadow-2xl w-full max-w-md border border-accent/20">
        <h1 className="text-4xl font-serif text-center text-accent mb-2">七国争霸</h1>
        <p className="text-center text-gray-400 mb-8">七雄逐鹿，问鼎中原</p>

        <label className="block text-sm text-gray-400 mb-2 text-center">
          输入你的账号名字和密码
        </label>

        {/* 用户名 */}
        <input
          type="text"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="用户名（1-12个字）"
          maxLength={12}
          autoFocus
          className="w-full bg-primary/50 border border-accent/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors text-center text-lg mb-3"
        />

        {/* 密码 */}
        <input
          type="password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setPassword(e.target.value);
            setError(null);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (canSubmit) handleConfirm();
            }
          }}
          placeholder="密码（至少4位，新名字将自动注册）"
          maxLength={32}
          className="w-full bg-primary/50 border border-accent/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors text-center text-lg"
        />
        {error && <p className="mt-2 text-xs text-danger text-center">{error}</p>}

        <p className="mt-3 text-xs text-gray-500 text-center leading-relaxed">
          🔒 新名字会自动注册账号，请记住密码；<br />
          已有账号请输入正确密码登录。改名需使用商城"改名卡"（200 货币）
        </p>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canSubmit}
          className="mt-6 w-full py-3 bg-accent text-primary font-bold rounded-lg hover:bg-accent/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed pulse-glow"
        >
          {isChecking ? '正在登录...' : '进入游戏'}
        </button>
      </div>
    </div>
  );
}
