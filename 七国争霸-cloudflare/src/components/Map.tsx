import React, { useEffect, useRef, useState } from 'react';
import { useGameStore, Player, Land } from '../stores/gameStore';
import { useSocket } from '../hooks/useSocket';

// 占领类动作 CD（与 server/constants.ts 保持 OCCUPY_ACTION_COOLDOWN_MS 一致 · 玩家个人 0.5 秒，互不影响）
const OCCUPY_ACTION_COOLDOWN_MS = 500;

// 平铺六边形网格 - 200个格子, 20列x10行, 全部平铺可见无需滚动
// 注意：行列数必须与 server/constants.ts 的 generateAdjacency（20x10）完全一致，
// 否则屏幕上显示的相邻关系会与服务端判定不一致，导致无法朝单一方向扩张
const COLS = 20;
const ROWS = 10;
const R = 25;             // 六边形半径
const W = R * 1.732;       // 水平间距 = sqrt(3)*R
const H = R * 1.5;         // 垂直间距 = 1.5*R
const PAD = R + 6;         // 边距

function hexPos(id: number): { x: number; y: number } {
  const row = Math.floor(id / COLS);
  const col = id % COLS;
  const isOddRow = row % 2 === 1;
  const x = PAD + col * W + (isOddRow ? W / 2 : 0);
  const y = PAD + row * H;
  return { x, y };
}

const HEX_POSITIONS: { [key: number]: { x: number; y: number } } = {};
for (let i = 0; i < COLS * ROWS; i++) {
  HEX_POSITIONS[i] = hexPos(i);
}

const SVG_W = PAD * 2 + (COLS - 1) * W + W / 2;
const SVG_H = PAD * 2 + (ROWS - 1) * H;

export default function Map() {
  const { currentRoom } = useGameStore();
  const { occupyLand, attackLand } = useSocket();

  // 冷却状态：仅用于视觉提示（顶部横幅 + 光标），不再拦截点击。
  // 真正的冷却判定由服务端 OCCUPY_ACTION_COOLDOWN_MS 负责，前端点击直接发往服务端，
  // 避免"前端锁死全图 → 看起来点什么都没反应"的假死体验。
  const [isCooldown, setIsCooldown] = useState(false);
  const cdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 飞艇模式：ActionPanel 切换后，点击地图格子触发空袭（不触发占领/攻击）
  const [airshipMode, setAirshipMode] = useState(false);
  // TNT 模式：ActionPanel 切换后，点击地图任意格引爆（不触发占领/攻击）
  const [tntMode, setTntMode] = useState(false);

  // 点击后启动冷却视觉计时（不影响交互）
  const startCooldownVisual = () => {
    if (cdTimerRef.current) clearTimeout(cdTimerRef.current);
    setIsCooldown(true);
    cdTimerRef.current = setTimeout(() => setIsCooldown(false), OCCUPY_ACTION_COOLDOWN_MS);
  };

  useEffect(() => {
    return () => {
      if (cdTimerRef.current) clearTimeout(cdTimerRef.current);
    };
  }, []);

  // 监听飞艇模式
  useEffect(() => {
    const onAirship = (e: Event) => setAirshipMode((e as CustomEvent).detail === true);
    window.addEventListener('airshipMode', onAirship);
    return () => window.removeEventListener('airshipMode', onAirship);
  }, []);

  // 监听 TNT 模式
  useEffect(() => {
    const onTnt = (e: Event) => setTntMode((e as CustomEvent).detail === true);
    window.addEventListener('tntMode', onTnt);
    return () => window.removeEventListener('tntMode', onTnt);
  }, []);

  const cdHint = isCooldown ? `占领冷却中 ${(OCCUPY_ACTION_COOLDOWN_MS / 1000).toFixed(1)}s` : null;

  if (!currentRoom) return null;

  const getLandOwner = (ownerId: string | null): Player | null => {
    if (!ownerId) return null;
    return currentRoom.players.find((p: Player) => p.socketId === ownerId) || null;
  };

  const handleLandClick = (landId: number) => {
    const land = currentRoom.lands.find((l: Land) => l.id === landId);
    if (!land) return;

    // ===== 以下操作（占领/攻击/飞艇/TNT）共享 0.5 秒冷却 =====
    if (isCooldown) return;

    // 飞艇模式：点格子直接触发空袭（由 ActionPanel 处理具体逻辑）
    if (airshipMode) {
      window.dispatchEvent(new CustomEvent('airshipLandClick', { detail: landId }));
      startCooldownVisual();
      return;
    }

    // TNT 模式：点任意格子直接引爆（由 ActionPanel 处理具体逻辑）
    if (tntMode) {
      window.dispatchEvent(new CustomEvent('tntLandClick', { detail: landId }));
      startCooldownVisual();
      return;
    }

    if (land.ownerId === null) {
      // 任意无主地都可以点击占领（是否相邻由服务端判定，相邻即可，允许朝单一方向发展）
      occupyLand(landId);
      startCooldownVisual();
    } else if (land.ownerId) {
      const owner = getLandOwner(land.ownerId);
      if (owner && owner.isAlive) {
        attackLand(landId);
        startCooldownVisual();
      }
    }
  };

  const hexPoints = `0,${-R} ${R * 0.866},${-R / 2} ${R * 0.866},${R / 2} 0,${R} ${-R * 0.866},${R / 2} ${-R * 0.866},${-R / 2}`;

  const mySocketId = currentRoom.players.find((p: Player) => p.isHost)?.socketId;

  return (
    <div className="relative bg-primary/30 rounded-2xl border border-accent/20 overflow-hidden flex-1 flex items-center justify-center min-h-0">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
      >
        {/* 六边形格子 */}
        {currentRoom.lands.map((land: Land) => {
          const pos = HEX_POSITIONS[land.id];
          if (!pos) return null;

          const owner = getLandOwner(land.ownerId);
          const isMyLand = owner?.socketId === mySocketId;

          return (
            <g
              key={land.id}
              onClick={() => handleLandClick(land.id)}
              className={isCooldown ? 'cursor-wait' : 'cursor-pointer'}
            >
              <polygon
                points={hexPoints}
                fill={
                  !land.ownerId
                    ? land.hasNPC ? '#2d2d2d' : '#1a1a1a'
                    : owner?.color || '#666'
                }
                stroke={isMyLand ? '#d4af37' : '#555'}
                strokeWidth={isMyLand ? 2 : 1}
                transform={`translate(${pos.x}, ${pos.y})`}
                className={`transition-colors hover:opacity-90 ${isCooldown ? 'opacity-80' : ''}`}
              />
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fill="#fff"
                fontSize="9"
                fontWeight="bold"
              >
                {land.id}
              </text>
              {!land.ownerId && land.hasNPC && (
                <text
                  x={pos.x}
                  y={pos.y - 16}
                  textAnchor="middle"
                  fill="#999"
                  fontSize="6"
                >
                  NPC
                </text>
              )}
              {land.walled && land.ownerId && (
                <text
                  x={pos.x}
                  y={pos.y - 30}
                  textAnchor="middle"
                  fill="#8b5cf6"
                  fontSize="9"
                  fontWeight="bold"
                >
                  🏰
                </text>
              )}
              {land.ownerId && (() => {
                const owner = getLandOwner(land.ownerId);
                if (owner && owner.capitalId === land.id) {
                  return (
                    <text
                      x={pos.x}
                      y={pos.y - 16}
                      textAnchor="middle"
                      fill="#ff4444"
                      fontSize="10"
                      fontWeight="bold"
                    >
                      ★
                    </text>
                  );
                }
                return null;
              })()}
            </g>
          );
        })}
      </svg>

      {/* 冷却横幅 */}
      {cdHint && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/70 border border-orange-500/60 text-orange-300 text-xs font-medium shadow-lg">
          ⏱ {cdHint}
        </div>
      )}

      {/* 图例 */}
      <div className="absolute bottom-2 left-2 bg-secondary/80 rounded-lg p-2 text-xs">
        <div className="text-gray-400 mb-1">图例</div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 bg-gray-600 rounded"></div>
          <span>无人领地</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-accent rounded"></div>
          <span>你的领土</span>
        </div>
      </div>
    </div>
  );
}
