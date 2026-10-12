import React from 'react';
import { useGameStore } from '../stores/gameStore';

/**
 * 游戏内结束弹窗：仅在 currentRoom.gameStatus === 'ended' 时显示，2 秒后自动被 useSocket 的 leaveRoom 清除。
 * 主页面（大厅）的"我赢了/你输了"遮罩由 App.tsx 的 lastGameResult 渲染。
 */
export default function ResultModal() {
  const { gameResult, playerId } = useGameStore();

  if (!gameResult) return null;

  const iWon = !gameResult.isDraw && gameResult.winnerSocketId === playerId;
  const iLost = (() => {
    if (gameResult.isDraw) return false;
    if (gameResult.endReason === 'disconnected_lost' || gameResult.endReason === 'killed') {
      return gameResult.loserSocketIds.includes(playerId ?? '');
    }
    return !iWon;
  })();

  // 画面展示
  let banner: { emoji: string; title: string; titleClassName: string };
  if (gameResult.isDraw) {
    banner = { emoji: '🤝', title: '平局', titleClassName: 'text-gray-200' };
  } else if (iWon) {
    banner = { emoji: '🏆', title: '你赢了', titleClassName: 'text-accent' };
  } else if (iLost) {
    banner = { emoji: '💀', title: '你输了', titleClassName: 'text-danger' };
  } else {
    banner = { emoji: '🎮', title: '游戏结束', titleClassName: 'text-gray-200' };
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-secondary rounded-2xl p-8 border border-accent/30 max-w-md w-full mx-4 text-center shadow-2xl">
        <div className="text-6xl mb-4 animate-bounce">{banner.emoji}</div>
        <h2 className={`text-4xl font-serif mb-3 ${banner.titleClassName}`}>{banner.title}</h2>

        {/* Rankings */}
        <div className="mt-4 text-left bg-primary/50 rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">最终排名</h3>
          <div className="space-y-2">
            {gameResult.rankings.map(
              (player: { name: string; isAlive: boolean; lands: number; gold: number }, index: number) => {
                const mine = useGameStore.getState().playerName === player.name;
                return (
                  <div
                    key={index}
                    className={`flex items-center justify-between ${
                      !player.isAlive ? 'opacity-60' : ''
                    } ${mine ? 'ring-1 ring-accent/60 rounded px-2 -mx-2 py-1 bg-accent/5' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 flex items-center justify-center rounded-full text-sm ${
                          index === 0 ? 'bg-accent text-primary font-bold' : index === 1 ? 'bg-gray-400 text-white' : index === 2 ? 'bg-amber-700 text-white' : 'bg-gray-600 text-white'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className={player.isAlive ? (mine ? 'text-accent font-medium' : 'text-white') : 'text-gray-500'}>
                        {player.name}
                        {mine && <span className="ml-1 text-[10px] text-accent/80">（我）</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-400">{player.lands} 领土</span>
                      {!player.isAlive && <span className="text-danger">淘汰</span>}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-500">即将返回主页面...</p>
      </div>
    </div>
  );
}
