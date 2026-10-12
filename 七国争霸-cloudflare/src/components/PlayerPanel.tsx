import React from 'react';
import { useGameStore, Player } from '../stores/gameStore';

export default function PlayerPanel() {
  const { currentRoom } = useGameStore();

  if (!currentRoom) return null;

  const hostPlayer = currentRoom.players.find((p: Player) => p.isHost);

  return (
    <div className="bg-secondary/50 rounded-xl p-4 border border-accent/20">
      <h2 className="text-lg font-bold text-accent mb-4 flex items-center gap-2">
        <span>👥</span> 玩家列表
      </h2>

      <div className="space-y-3">
        {currentRoom.players.map((player: Player) => (
          <div
            key={player.id}
            className={`p-3 rounded-lg border ${
              player.isAlive
                ? 'bg-primary/50 border-accent/20'
                : 'bg-danger/10 border-danger/30 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: player.color }}
                />
                <span className="font-medium">
                  {player.name}
                  {player.isAI && <span className="ml-1" title="人机">🤖</span>}
                  {player.isHost && <span className="text-accent ml-1">👑</span>}
                </span>
              </div>
              {!player.isAlive && (
                <span className="text-xs text-danger">已淘汰</span>
              )}
              {currentRoom.gameStatus === 'waiting' && (
                <span
                  className={`text-xs ${
                    player.isReady ? 'text-success' : 'text-gray-500'
                  }`}
                >
                  {player.isReady ? '已准备' : '等待中'}
                </span>
              )}
            </div>

            {currentRoom.gameStatus === 'playing' && player.isAlive && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">金币:</span>
                  <span className="text-yellow-400">{player.gold.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">物资:</span>
                  <span className="text-green-400">{player.resources.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">科技:</span>
                  <span className="text-blue-400">{player.technology}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">生产力:</span>
                  <span className="text-purple-400">{player.productivity}/s</span>
                </div>
                <div className="col-span-2 flex justify-between">
                  <span className="text-gray-400">领土:</span>
                  <span className="text-white">{player.lands.length} 块</span>
                </div>
              </div>
            )}
          </div>
        ))}

        {currentRoom.gameStatus === 'waiting' && currentRoom.players.length < 7 && (
          <div className="text-center text-gray-500 text-sm py-2">
            等待其他玩家加入... ({currentRoom.players.length}/7)
          </div>
        )}
      </div>
    </div>
  );
}