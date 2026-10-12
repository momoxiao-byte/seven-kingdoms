import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../stores/gameStore';

interface ChatPanelProps {
  title: string;
  messages: ChatMessage[];
  onSend: (message: string) => void;
  placeholder?: string;
  /** 消息区最大高度（Tailwind class，如 max-h-40） */
  maxHeightClass?: string;
  selfId: string | null;
}

// 通用聊天面板：局天与大厅聊天共用
export default function ChatPanel({
  title,
  messages,
  onSend,
  placeholder = '输入消息...',
  maxHeightClass = 'max-h-40',
  selfId,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    onSend(msg);
    setInput('');
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-secondary/50 rounded-xl p-3 border border-accent/20 flex flex-col gap-2">
      <h3 className="text-sm font-bold text-accent flex items-center gap-1">
        💬 {title}
      </h3>

      {/* 消息列表 */}
      <div
        ref={listRef}
        className={`${maxHeightClass} overflow-y-auto space-y-1.5 pr-1`}
      >
        {messages.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-3">暂无消息，来说点什么吧</p>
        ) : (
          messages.map((msg, i) => {
            if (msg.system) {
              // 系统消息（进入游戏/改名等）
              return (
                <p key={i} className="text-xs text-yellow-500/80 text-center">
                  {msg.message}
                </p>
              );
            }
            const isSelf = msg.senderId === selfId;
            return (
              <div key={i} className="text-xs leading-relaxed">
                <span className="text-gray-500 mr-1">{fmtTime(msg.time)}</span>
                <span
                  className="font-bold mr-1"
                  style={{ color: msg.senderColor || (isSelf ? '#4ade80' : '#93c5fd') }}
                >
                  {msg.isAI ? '🤖 ' : ''}
                  {msg.senderName}
                  {isSelf ? '（我）' : ''}:
                </span>
                <span className="text-white break-all">{msg.message}</span>
              </div>
            );
          })
        )}
      </div>

      {/* 输入区 */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          maxLength={200}
          className="flex-1 min-w-0 bg-primary/50 border border-accent/30 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim()}
          className="px-3 py-1.5 bg-accent text-primary text-xs font-bold rounded-lg hover:bg-accent/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          发送
        </button>
      </div>
    </div>
  );
}
