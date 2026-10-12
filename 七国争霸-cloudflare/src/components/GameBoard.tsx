import React from 'react';
import { useGameStore, Player } from '../stores/gameStore';
import { useSocket } from '../hooks/useSocket';
import { useCurrencyStore } from '../stores/currencyStore';
import Map from './Map';
import PlayerPanel from './PlayerPanel';
import ActionPanel from './ActionPanel';
import ChatPanel from './ChatPanel';

// 与后端 PLAYER_COLORS 保持一致
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];
const COLOR_NAMES: Record<string, string> = {
  '#e74c3c': '红',
  '#3498db': '蓝',
  '#2ecc71': '绿',
  '#f39c12': '橙',
  '#9b59b6': '紫',
  '#1abc9c': '青',
  '#e67e22': '橘',
};

export default function GameBoard() {
  const { currentRoom, messages, playerId, chatMessages } = useGameStore();
  const { playerReady, claimColor, startGame, leaveRoom, sendChat } = useSocket();
  const { hasItem, consumeItem } = useCurrencyStore();

  if (!currentRoom) return null;

  const myPlayer = currentRoom.players.find((p: Player) => p.socketId === playerId);
  const isHost = myPlayer?.isHost;
  const allReady = currentRoom.players.every((p: Player) => p.isReady || p.isHost);
  const canStart = isHost && currentRoom.players.length >= 2 && allReady;
  const hasColorPick = hasItem('color_pick');
  const usedColors = new Set(currentRoom.players.filter((p: Player) => p.socketId !== playerId).map((p: Player) => p.color));

  const handleClaimColor = (color: string) => {
    claimColor(color);
    // 选完即消耗道具（一局一次）
    consumeItem('color_pick');
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-secondary/80 backdrop-blur border-b border-accent/20 px-2 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto flex-wrap gap-2">
          <div className="flex items-center gap-2 sm:gap-4">
            <h1 className="text-xl sm:text-2xl font-serif text-accent">七国争霸</h1>
            <span className="text-xs sm:text-sm text-gray-400 truncate max-w-[10rem] sm:max-w-none" title={`房间号：${currentRoom.id}`}>房间：{currentRoom.id}</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-6 flex-wrap">
            {currentRoom.gameStatus === 'waiting' ? (
              <div className="flex items-center gap-2 sm:gap-4">
                <span className="text-xs sm:text-base text-gray-400">
                  {currentRoom.players.length}/7 玩家
                </span>
                {/* 选择颜色道具：仅在准备阶段且拥有道具时显示 */}
                {hasColorPick && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400 mr-1">🎨选色:</span>
                    {PLAYER_COLORS.map((c) => {
                      const taken = usedColors.has(c);
                      const isMine = myPlayer?.color === c;
                      return (
                        <button
                          key={c}
                          onClick={() => !isMine && !taken && handleClaimColor(c)}
                          disabled={taken || isMine}
                          title={COLOR_NAMES[c] + (taken ? '(已占用)' : '')}
                          className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 transition-all ${
                            isMine
                              ? 'border-white scale-110'
                              : taken
                              ? 'border-gray-600 opacity-30 cursor-not-allowed'
                              : 'border-transparent hover:scale-110 hover:border-white cursor-pointer'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      );
                    })}
                  </div>
                )}
                {isHost ? (
                  <button
                    onClick={startGame}
                    disabled={!canStart}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-accent text-primary font-bold rounded-lg disabled:opacity-50 hover:bg-accent/90 transition-all text-sm sm:text-base"
                  >
                    开始游戏
                  </button>
                ) : (
                  <button
                    onClick={playerReady}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-success text-white font-bold rounded-lg hover:bg-success/90 transition-all text-sm sm:text-base"
                  >
                    准备
                  </button>
                )}
              </div>
            ) : (
              <div className="text-xl sm:text-2xl font-mono text-accent pulse-glow">
                {formatTime(currentRoom.timeRemaining)}
              </div>
            )}
            <button
              onClick={leaveRoom}
              className="px-3 sm:px-4 py-1.5 sm:py-2 bg-danger/20 text-danger rounded-lg hover:bg-danger/30 transition-all text-sm sm:text-base"
            >
              离开
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full p-2 gap-2 min-h-0 flex flex-col lg:flex-row">
        {/* Left Panel - Players */}
        <aside className="w-full lg:w-56 flex flex-col gap-2 shrink-0 max-h-48 lg:max-h-none overflow-y-auto">
          <PlayerPanel />
        </aside>

        {/* Center - Map */}
        <div className="flex-1 flex min-h-[320px]">
          <Map />
        </div>

        {/* Right Panel - Actions */}
        <aside className="w-full lg:w-64 flex flex-col gap-2 shrink-0">
          <ActionPanel />
          <ChatPanel
            title="房间聊天"
            messages={chatMessages}
            onSend={sendChat}
            placeholder="和房间内玩家聊天..."
            maxHeightClass="max-h-40"
            selfId={playerId}
          />
        </aside>
      </main>

      {/* Message Log */}
      <footer className="bg-secondary/80 backdrop-blur border-t border-accent/20 px-4 py-2 max-h-32 overflow-y-auto">
        <div className="flex flex-wrap gap-2 text-sm max-w-screen-2xl mx-auto">
          {messages.slice(-10).map((msg: { id: string; message: string; type: 'info' | 'danger' | 'success' }) => (
            <span
              key={msg.id}
              className={`${
                msg.type === 'danger'
                  ? 'text-danger'
                  : msg.type === 'success'
                  ? 'text-success'
                  : 'text-gray-400'
              }`}
            >
              {msg.message}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}