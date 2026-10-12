import React, { useState, useEffect } from 'react';
import { useGameStore, Player } from '../stores/gameStore';
import { useSocket } from '../hooks/useSocket';
import { useCurrencyStore } from '../stores/currencyStore';

// 游戏常量（与 server/constants.ts 保持同步）
const GAME_CONSTANTS = {
  TECH_UPGRADE_COST: 5000,
  PRODUCTIVITY_UPGRADE_COST: 1000,
  MORALE_UPGRADE_COST: 15000,
  RELOCATE_CAPITAL_COST: 20000,
  EXCHANGE_RESOURCES_AMOUNT: 2,
  EXCHANGE_GOLD_AMOUNT: 100,
  ELIMINATION_GOLD_THRESHOLD: 100,
  ELIMINATION_RESOURCES_THRESHOLD: 5,

  OCCUPY_ENEMY_COST_GOLD: 3000,
  OCCUPY_ENEMY_COST_MORALE: 1,
  OCCUPY_ENEMY_FIXED_REWARD_GOLD: 5000,
  OCCUPY_ENEMY_PRODUCTIVITY_GAIN: 1,

  MORALE_TICK_GOLD_EVERY: 10,
  MORALE_GOLD_PER_LAND_PER_LEVEL: 1,
  MORALE_ATTACK_RATIO: 1,
  MORALE_DEFENSE_RATIO: 0.5,

  // 占领领地类动作 CD（服务器强校验 · 玩家个人 0.5 秒），前端也会在点击后立即禁用按钮防止连点
  OCCUPY_ACTION_COOLDOWN_MS: 500,

  // 护盾持续时间（与服务器一致）
  SHIELD_DURATION_MS: 2 * 60 * 1000,
};

export default function ActionPanel() {
  const { currentRoom, playerId, addMessage } = useGameStore();
  const { upgradeTech, upgradeProductivity, upgradeMorale, relocateCapital, exchangeResources, airshipAttack, useShield, useGuidedMissile, useHaste, useWall, useTNT, useNuclearMissile, formAlliance, spy, trade, useNewItem } = useSocket();
  const { hasItem, consumeItem, getItemCount } = useCurrencyStore();
  const [airshipMode, setAirshipMode] = useState(false);
  const [tntMode, setTntMode] = useState(false);
  // TNT 远程投掷模式（需消耗 1 个飞艇）：true=远程（任意格，除敌方首都及周边），false=近程（自己领地 1-2 格范围）
  const [tntRemoteMode, setTntRemoteMode] = useState(false);
  // 护盾剩余秒数：每秒刷新一次，仅当 myPlayer.shieldUntil > now 时倒计时
  const [shieldTick, setShieldTick] = useState(0);
  // 迅捷药水剩余秒数：每秒刷新一次
  const [hasteTick, setHasteTick] = useState(0);
  // 批量兑换物资的输入值（用户想兑换多少"份数"，每份 = EXCHANGE_RESOURCES_AMOUNT 物资）
  const [batchCount, setBatchCount] = useState<string>('');
  // 操作面板折叠状态（默认展开）
  const [collapsed, setCollapsed] = useState(false);
  // 核能导弹选择模式
  const [nuclearMissileMode, setNuclearMissileMode] = useState(false);

  // 飞艇模式下通知 Map 组件（必须在条件 return 之前调用，否则违反 React Hooks 规则）
  useEffect(() => {
    if (!airshipMode) return;
    window.dispatchEvent(new CustomEvent('airshipMode', { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent('airshipMode', { detail: false }));
    };
  }, [airshipMode]);

  // TNT 模式下通知 Map 组件
  useEffect(() => {
    if (!tntMode) return;
    window.dispatchEvent(new CustomEvent('tntMode', { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent('tntMode', { detail: false }));
    };
  }, [tntMode]);

  // 护盾倒计时刷新（每秒一次，避免 UI 卡在过期值上）
  useEffect(() => {
    const t = setInterval(() => setShieldTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  // 迅捷药水倒计时刷新（每秒一次）
  useEffect(() => {
    const t = setInterval(() => setHasteTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 飞艇模式：点击地图格子触发空袭（必须在条件 return 之前，遵守 React Hooks 规则）
  useEffect(() => {
    if (!airshipMode) return;
    const handler = (e: Event) => {
      const landId = (e as CustomEvent).detail;
      airshipAttack(landId);
      consumeItem('airship');
      setAirshipMode(false);
    };
    window.addEventListener('airshipLandClick', handler);
    return () => window.removeEventListener('airshipLandClick', handler);
  }, [airshipMode, airshipAttack, consumeItem]);

  // TNT 模式：点击地图格子引爆
  useEffect(() => {
    if (!tntMode) return;
    const handler = (e: Event) => {
      const landId = (e as CustomEvent).detail;
      if (!currentRoom) return;
      // 近程模式：校验是否在自己领地 1-2 格范围内
      if (!tntRemoteMode) {
        const myLandIds = currentRoom.lands.filter((l) => l.ownerId === playerId).map((l) => l.id);
        const visited = new Set<number>(myLandIds);
        // BFS 2 层
        let frontier = [...myLandIds];
        for (let step = 0; step < 2; step++) {
          const next: number[] = [];
          for (const id of frontier) {
            const land = currentRoom.lands.find((l) => l.id === id);
            if (land) {
              for (const adjId of land.adjacentLands) {
                if (!visited.has(adjId)) {
                  visited.add(adjId);
                  next.push(adjId);
                }
              }
            }
          }
          frontier = next;
        }
        if (!visited.has(landId)) {
          window.alert('⚠️ 近程投掷：目标必须在你的领地 1-2 格范围内。\n如需远程投掷，请重新点击 TNT 按钮并选择"远程投掷"（需消耗飞艇）。');
          return;
        }
      } else {
        // 远程模式：禁止敌方首都及周边格（airshipBlocked 已由服务端按视角过滤）
        const targetLand = currentRoom.lands.find((l) => l.id === landId);
        if (targetLand?.airshipBlocked) {
          window.alert('⚠️ 远程投掷：无法攻击敌方首都或首都周边格。');
          return;
        }
      }
      const costHint = tntRemoteMode ? '\n本投掷为远程投掷，将额外消耗 1 个飞艇。' : '';
      if (!window.confirm(`💥 确定以格#${landId}为中心引爆TNT？\n\n爆炸范围：中心格及相邻共约7格变为NPC中立地。有城墙的格只破城墙不变NPC，爆炸不花费金币。${costHint}`)) {
        return;
      }
      useTNT(landId);
      consumeItem('tnt');
      if (tntRemoteMode) consumeItem('airship');
      setTntMode(false);
      setTntRemoteMode(false);
    };
    window.addEventListener('tntLandClick', handler);
    return () => window.removeEventListener('tntLandClick', handler);
  }, [tntMode, tntRemoteMode, useTNT, consumeItem, currentRoom, playerId]);

  if (!currentRoom || currentRoom.gameStatus !== 'playing') return null;

  const myPlayer = currentRoom.players.find((p: Player) => p.socketId === playerId);
  if (!myPlayer || !myPlayer.isAlive) return null;

  const hasAirship = hasItem('airship');
  const hasShield = hasItem('shield');
  const hasMissile = hasItem('guided_missile');
  const hasHaste = hasItem('haste');
  const hasNuclearMissile = hasItem('nuclear_missile');
  const hasWall = hasItem('wall');
  const hasTNT = hasItem('tnt');
  const tntCount = getItemCount('tnt');
  // 新道具
  const hasReconCard = hasItem('recon_card');
  const hasLightningCard = hasItem('lightning_card');
  const hasLuckyCard = hasItem('lucky_card');
  const hasReflectCard = hasItem('reflect_card');
  const hasProphecyCard = hasItem('prophecy_card');
  // 城墙无时间戳，直接看当前自己领地的 walled 数量
  const walledCount = currentRoom.lands.filter((l) => l.ownerId === playerId && l.walled).length;
  // 自己的护盾剩余毫秒（仅自己能看到 shieldUntil）
  const shieldRemainMs = myPlayer.shieldUntil ? Math.max(0, myPlayer.shieldUntil - Date.now()) : 0;
  const shieldActive = shieldRemainMs > 0;
  // 自己的迅捷剩余毫秒（仅自己能看到 hasteUntil）
  const hasteRemainMs = myPlayer.hasteUntil ? Math.max(0, myPlayer.hasteUntil - Date.now()) : 0;
  const hasteActive = hasteRemainMs > 0;
  // 强制 React 在 tick 变化时重渲染（避免闭包过期）
  void shieldTick;
  void hasteTick;

  // 启动护盾
  const handleUseShield = () => {
    useShield();
    consumeItem('shield'); // 使用后消耗
  };

  // 使用迅捷药水
  const handleUseHaste = () => {
    useHaste();
    consumeItem('haste'); // 使用后消耗
  };

  // 发射指导导弹（二次确认，避免误触）
  const handleUseMissile = () => {
    if (!window.confirm('🚀 确定发射指导导弹？\n\n• 60% 成功：随机毁灭约 20 个敌方格子\n• 40% 失误：导弹打偏，随机毁灭自己 20 个格子（首都除外）\n\n不可撤销，请谨慎操作！')) {
      return;
    }
    useGuidedMissile();
    consumeItem('guided_missile'); // 使用后消耗
  };

  // 使用城墙（二次确认，避免误触）
  const handleUseWall = () => {
    if (!window.confirm('🏰 确定对当前所有领地使用城墙？\n\n• 作用：你当前拥有的所有领地获得永久城墙保护\n• 敌方需要点击两次才能占领：第1次花3000金币破城，第2次才能正常占领\n• 注意：以后新占领的领地没有城墙，需再次使用才能保护')) {
      return;
    }
    useWall();
    consumeItem('wall'); // 使用后消耗
  };

  // 秒数格式化 mm:ss
  const fmtRemain = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-secondary/50 rounded-xl p-4 border border-accent/20 space-y-4">
      {/* 标题栏 + 折叠按钮 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-accent flex items-center gap-2">
          <span>⚔️</span> 操作面板
        </h2>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? '展开操作面板' : '收起操作面板'}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/60 border border-accent/30 text-accent hover:bg-accent/20 transition-all"
        >
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      {/* 折叠状态：只显示一个紧凑条，点击可展开 */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full py-2 rounded-lg bg-primary/40 border border-accent/30 text-accent text-sm hover:bg-accent/20 transition-all"
        >
          ▲ 点击展开操作面板
        </button>
      ) : (
      <>
      {/* 装备栏 */}
      {(hasAirship || airshipMode || hasShield || shieldActive || hasMissile || hasWall || walledCount > 0 || hasHaste || hasteActive || hasTNT || tntMode || hasNuclearMissile) && (
        <div className="bg-primary/50 rounded-lg p-3 border border-yellow-500/30 space-y-2">
          <h3 className="text-sm text-gray-400">🎒 装备栏</h3>

          {/* 飞艇 */}
          {(hasAirship || airshipMode) && (
            <>
              <button
                onClick={() => setAirshipMode(!airshipMode)}
                className={`w-full py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-between ${
                  airshipMode
                    ? 'bg-yellow-500 text-black'
                    : 'bg-yellow-600/20 border border-yellow-500/40 text-yellow-400 hover:bg-yellow-600/30'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xl">🛩️</span> 飞艇
                </span>
                <span className="text-xs">
                  {airshipMode ? '点击地图目标格 →' : '使用'}
                </span>
              </button>
              {airshipMode && (
                <p className="text-xs text-yellow-400/70">
                  ⚠️ 可攻击任意非敌方首都/首都相邻格。点击地图上的格子发动空袭。
                </p>
              )}
              {/* 飞艇模式下的目标选择列表 */}
              {airshipMode && (
                <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                  {currentRoom.lands
                    .filter((land) => land.ownerId !== playerId) // 不显示自己的
                    .filter((land) => !land.airshipBlocked) // 不显示敌方首都及首都相邻格（服务端按视角计算）
                    .map((land) => {
                      const ownerName = land.ownerId
                        ? currentRoom.players.find((p) => p.socketId === land.ownerId)?.name
                        : null;
                      return (
                        <button
                          key={land.id}
                          onClick={() => {
                            airshipAttack(land.id);
                            consumeItem('airship');
                            setAirshipMode(false);
                          }}
                          className="w-full text-left px-2 py-1 rounded text-xs transition-all bg-primary/50 text-white hover:bg-accent/20"
                        >
                          格{land.id} {ownerName ? `(${ownerName})` : '(NPC)'}
                        </button>
                      );
                    })}
                </div>
              )}
            </>
          )}

          {/* 护盾 */}
          {(hasShield || shieldActive) && (
            <>
              {shieldActive ? (
                <div className="w-full py-2 px-3 rounded-lg flex items-center justify-between bg-cyan-500/20 border border-cyan-400/60 text-cyan-300">
                  <span className="flex items-center gap-2">
                    <span className="text-xl">🛡️</span> 护盾生效中
                  </span>
                  <span className="text-xs font-bold tabular-nums">
                    剩 {fmtRemain(shieldRemainMs)}
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleUseShield}
                  className="w-full py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-between bg-cyan-600/20 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-600/30"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xl">🛡️</span> 护盾
                  </span>
                  <span className="text-xs">使用</span>
                </button>
              )}
              {!shieldActive && (
                <p className="text-xs text-cyan-400/70">
                  🛡️ 使用后 2 分钟内敌方无法攻击/占领你的任何领地，你仍可正常进攻。
                </p>
              )}
            </>
          )}

          {/* 指导导弹 */}
          {hasMissile && (
            <>
              <button
                onClick={handleUseMissile}
                className="w-full py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-between bg-red-600/20 border border-red-500/50 text-red-400 hover:bg-red-600/40"
              >
                <span className="flex items-center gap-2">
                  <span className="text-xl">🚀</span> 指导导弹
                </span>
                <span className="text-xs">发射</span>
              </button>
              <p className="text-xs text-red-400/70">
                🚀 一次性毁灭约 20 个敌方格子（变为中立地）。不可攻击首都、首都相邻格、护盾期玩家。
              </p>
            </>
          )}

          {/* 迅捷药水 */}
          {hasHaste && (
            <>
              {hasteActive ? (
                <div className="w-full py-2 px-3 rounded-lg font-medium flex items-center justify-between bg-yellow-600/20 border border-yellow-500/40 text-yellow-400">
                  <span className="flex items-center gap-2">
                    <span className="text-xl">⚡</span> 迅捷生效中
                  </span>
                  <span className="text-xs font-bold tabular-nums">
                    剩 {fmtRemain(hasteRemainMs)}
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleUseHaste}
                  className="w-full py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-between bg-yellow-600/20 border border-yellow-500/40 text-yellow-400 hover:bg-yellow-600/30"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xl">⚡</span> 迅捷药水
                  </span>
                  <span className="text-xs">使用</span>
                </button>
              )}
              {!hasteActive && (
                <p className="text-xs text-yellow-400/70">
                  ⚡ 1 分钟内占领 CD 从 0.5 秒降为 0.2 秒。
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* 城墙 */}
      {(hasWall || walledCount > 0) && (
        <div className="space-y-1">
          <button
            onClick={handleUseWall}
            disabled={!hasWall}
            className={`w-full py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-between ${
              hasWall
                ? 'bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30'
                : 'bg-indigo-600/10 border border-indigo-500/20 text-indigo-300/60 cursor-not-allowed'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-xl">🏰</span> 城墙
            </span>
            <span className="text-xs">
              {walledCount > 0 ? `已保护 ${walledCount} 块` : hasWall ? '使用' : '已使用完毕'}
            </span>
          </button>
          {walledCount > 0 && (
            <p className="text-xs text-indigo-400/70">
              🔒 你有 {walledCount} 块领地处于城墙保护中，敌方需点击两次才能占领。
            </p>
          )}
        </div>
      )}

      {/* TNT */}
      {(hasTNT || tntMode) && (
        <div className="space-y-1">
          <button
            onClick={() => {
              if (tntMode) {
                // 退出 TNT 模式
                setTntMode(false);
                setTntRemoteMode(false);
                return;
              }
              if (tntCount === 0) return;
              // 进入 TNT 模式：先询问远程/近程
              const wantRemote = window.confirm(
                '🧨 是否远程投掷 TNT？\n\n' +
                '[确定] 远程投掷：消耗 1 个飞艇 🛩️，可投任意格（除敌方首都及周边格）\n' +
                '[取消] 近程投掷：仅限自己领地 1-2 格范围内，无需飞艇'
              );
              if (wantRemote) {
                if (!hasAirship) {
                  window.alert('⚠️ 远程投掷需要消耗 1 个飞艇道具，您当前未持有飞艇。\n请先在商城购买飞艇，或选择近程投掷。');
                  return;
                }
                setTntRemoteMode(true);
              } else {
                setTntRemoteMode(false);
              }
              setTntMode(true);
            }}
            className={`w-full py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-between ${
              tntMode
                ? 'bg-orange-500 text-black'
                : tntCount > 0
                ? 'bg-orange-600/20 border border-orange-500/40 text-orange-400 hover:bg-orange-600/30'
                : 'bg-orange-600/10 border border-orange-500/20 text-orange-400/60 cursor-not-allowed'
            }`}
            disabled={tntCount === 0 && !tntMode}
          >
            <span className="flex items-center gap-2">
              <span className="text-xl">🧨</span> TNT
            </span>
            <span className="text-xs">
              {tntMode
                ? tntRemoteMode
                  ? '远程模式：点击地图目标格 →'
                  : '近程模式：点击地图目标格 →'
                : tntCount > 0
                ? `持有 x${tntCount}/3`
                : '已用完'}
            </span>
          </button>
          {tntMode && (
            <>
              <p className="text-xs text-orange-400/70">
                {tntRemoteMode
                  ? '💥 远程投掷：可点击任意非敌方首都周边格引爆。本次将额外消耗 1 个飞艇。'
                  : '💥 近程投掷：仅可点击自己领地 1-2 格范围内的目标引爆。'}
                <br />
                爆炸范围：中心格+相邻约7格变NPC。有城墙的格只破城墙不变NPC。
              </p>
              {/* 目标选择列表 */}
              <div className="mt-1 max-h-36 overflow-y-auto space-y-1">
                {(() => {
                  // 计算玩家自己的领地 ID 集合
                  const myLandIds = new Set(
                    currentRoom.lands.filter((l) => l.ownerId === playerId).map((l) => l.id)
                  );
                  // 近程：BFS 2 层，得到可达格集合
                  let reachable: Set<number> | null = null;
                  if (!tntRemoteMode) {
                    reachable = new Set<number>(myLandIds);
                    let frontier = Array.from(myLandIds);
                    for (let step = 0; step < 2; step++) {
                      const next: number[] = [];
                      for (const id of frontier) {
                        const land = currentRoom.lands.find((l) => l.id === id);
                        if (land) {
                          for (const adjId of land.adjacentLands) {
                            if (!reachable.has(adjId)) {
                              reachable.add(adjId);
                              next.push(adjId);
                            }
                          }
                        }
                      }
                      frontier = next;
                    }
                  }
                  return currentRoom.lands
                    .filter((land) => {
                      // 不能投自己的格
                      if (myLandIds.has(land.id)) return false;
                      if (tntRemoteMode) {
                        // 远程：排除敌方首都及周边（airshipBlocked 由服务端按视角过滤）
                        return !land.airshipBlocked;
                      } else {
                        // 近程：必须在 1-2 格范围内
                        return reachable ? reachable.has(land.id) : false;
                      }
                    })
                    .map((land) => {
                      const ownerName = land.ownerId
                        ? currentRoom.players.find((p) => p.socketId === land.ownerId)?.name
                        : null;
                      return (
                        <button
                          key={land.id}
                          onClick={() => {
                            const costHint = tntRemoteMode ? '\n本投掷为远程投掷，将额外消耗 1 个飞艇。' : '';
                            if (!window.confirm(`💥 确定以格#${land.id}为中心引爆TNT？\n\n爆炸范围：中心格及相邻共约7格变为NPC中立地。有城墙的格只破城墙不变NPC，爆炸不花费金币。${costHint}`)) return;
                            useTNT(land.id);
                            consumeItem('tnt');
                            if (tntRemoteMode) consumeItem('airship');
                            setTntMode(false);
                            setTntRemoteMode(false);
                          }}
                          className="w-full text-left px-2 py-1 rounded text-xs transition-all bg-primary/50 text-white hover:bg-orange-500/20"
                        >
                          格{land.id} {land.walled ? '🏰' : ''} {land.airshipBlocked ? '🚫首都区' : ''} {ownerName ? `(${ownerName})` : land.hasNPC ? '(NPC)' : '(空)'}
                        </button>
                      );
                    });
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* 新道具区 */}
      {(hasReconCard || hasLightningCard || hasLuckyCard || hasReflectCard || hasProphecyCard) && (
        <div className="bg-primary/50 rounded-lg p-3 border border-purple-500/30 space-y-2">
          <h3 className="text-sm text-gray-400">🃏 特殊道具</h3>
          <div className="grid grid-cols-2 gap-2">
            {hasReconCard && (
              <button
                onClick={() => { useNewItem('recon_card'); consumeItem('recon_card'); }}
                className="py-2 px-2 rounded-lg text-xs font-medium bg-green-900/30 border border-green-500/40 text-green-400 hover:bg-green-900/50 transition-all"
              >
                🗺️ 侦察卡
              </button>
            )}
            {hasLightningCard && (
              <button
                onClick={() => { useNewItem('lightning_card'); consumeItem('lightning_card'); }}
                className="py-2 px-2 rounded-lg text-xs font-medium bg-yellow-900/30 border border-yellow-500/40 text-yellow-400 hover:bg-yellow-900/50 transition-all"
              >
                ⚡ 闪电卡
              </button>
            )}
            {hasLuckyCard && (
              <button
                onClick={() => { useNewItem('lucky_card'); consumeItem('lucky_card'); }}
                className="py-2 px-2 rounded-lg text-xs font-medium bg-pink-900/30 border border-pink-500/40 text-pink-400 hover:bg-pink-900/50 transition-all"
              >
                🎁 幸运卡
              </button>
            )}
            {hasReflectCard && (
              <button
                onClick={() => { useNewItem('reflect_card'); consumeItem('reflect_card'); }}
                className="py-2 px-2 rounded-lg text-xs font-medium bg-cyan-900/30 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-900/50 transition-all"
              >
                🪞 反弹卡
              </button>
            )}
            {hasProphecyCard && (
              <button
                onClick={() => { useNewItem('prophecy_card'); consumeItem('prophecy_card'); }}
                className="py-2 px-2 rounded-lg text-xs font-medium bg-indigo-900/30 border border-indigo-500/40 text-indigo-400 hover:bg-indigo-900/50 transition-all"
              >
                🔮 预言卡
              </button>
            )}
          </div>
        </div>
      )}

      {/* 外交系统 */}
      <div className="bg-primary/50 rounded-lg p-3 border border-emerald-500/30 space-y-2">
        <h3 className="text-sm text-gray-400">🤝 外交系统</h3>
        <div className="grid grid-cols-2 gap-2">
          {currentRoom.players
            .filter((p) => p.socketId !== playerId && p.isAlive)
            .slice(0, 4)
            .map((p) => (
              <div key={p.socketId} className="bg-primary/40 rounded-lg p-2 space-y-1">
                <div className="text-xs text-gray-300 truncate">{p.name}</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => formAlliance(p.socketId)}
                    className="flex-1 py-1 rounded text-[10px] bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/50 transition-all"
                  >
                    🤝 缔约
                  </button>
                  <button
                    onClick={() => spy(p.socketId)}
                    className="flex-1 py-1 rounded text-[10px] bg-slate-600/30 border border-slate-500/30 text-slate-300 hover:bg-slate-600/50 transition-all"
                  >
                    🕵️ 间谍
                  </button>
                  <button
                    onClick={() => {
                      const gold = window.prompt(`向 ${p.name} 发送多少金币？`);
                      if (gold) trade(p.socketId, parseInt(gold) || 0);
                    }}
                    className="flex-1 py-1 rounded text-[10px] bg-amber-600/30 border border-amber-500/30 text-amber-400 hover:bg-amber-600/50 transition-all"
                  >
                    💱 交易
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* 核能导弹：选择国家灭国 */}
      {hasNuclearMissile && !nuclearMissileMode && (
        <button
          onClick={() => setNuclearMissileMode(true)}
          className="w-full py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-between bg-red-900/30 border border-red-500/50 text-red-400 hover:bg-red-900/50"
        >
          <span className="flex items-center gap-2">
            <span className="text-xl">☢️</span> 核能导弹
          </span>
          <span className="text-xs">选择国家灭国</span>
        </button>
      )}
      {nuclearMissileMode && (
        <div className="space-y-2 bg-red-900/20 border border-red-500/30 rounded-lg p-2">
          <div className="text-xs text-red-400 font-medium">☢️ 选择要消灭的国家：</div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {currentRoom.players
              .filter((p) => p.socketId !== playerId && p.isAlive)
              .map((p) => (
                <button
                  key={p.socketId}
                  onClick={() => {
                    if (!window.confirm(`☢️ 确认对「${p.name}」发射核能导弹？\n\n该国家所有领地将被毁灭，玩家直接淘汰！\n不可撤销！`)) return;
                    useNuclearMissile(p.socketId);
                    consumeItem('nuclear_missile');
                    setNuclearMissileMode(false);
                  }}
                  className="w-full text-left px-2 py-1 rounded text-xs transition-all bg-red-600/20 text-red-300 hover:bg-red-600/40 border border-red-700/30"
                >
                  {p.isAI ? '🤖' : '👤'} {p.name}（{p.lands.length} 格）
                </button>
              ))}
          </div>
          <button
            onClick={() => setNuclearMissileMode(false)}
            className="w-full py-1 px-2 rounded text-xs bg-gray-600/30 text-gray-400 hover:bg-gray-600/50"
          >取消</button>
        </div>
      )}

      {/* Stats Summary */}
      <div className="bg-primary/50 rounded-lg p-3 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-gray-400">我的领土</span>
          <span className="text-white font-bold">{myPlayer.lands.length} 块</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">金币</span>
          <span className="text-yellow-400 font-bold">
            {myPlayer.gold.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">物资</span>
          <span className="text-green-400 font-bold">
            {myPlayer.resources.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">科技值</span>
          <span className="text-blue-400 font-bold">{myPlayer.technology}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">生产力</span>
          <span className="text-purple-400 font-bold">
            {myPlayer.productivity}/秒
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">士气等级</span>
          <span className="text-orange-400 font-bold">
            Lv.{myPlayer.morale} (每次占领{myPlayer.morale}格)
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">首都</span>
          <span className="text-red-400 font-bold">
            #{myPlayer.capitalId !== null ? myPlayer.capitalId : '无'}
          </span>
        </div>
      </div>

      {/* Upgrade Actions */}
      <div className="space-y-2">
        <h3 className="text-sm text-gray-400 font-medium">升级</h3>

        <button
          onClick={upgradeProductivity}
          disabled={myPlayer.gold < GAME_CONSTANTS.PRODUCTIVITY_UPGRADE_COST}
          className="w-full p-3 bg-primary/50 rounded-lg border border-purple-500/30 hover:border-purple-500/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
        >
          <div className="flex justify-between items-center">
            <span className="text-purple-400">提升生产力</span>
            <span className="text-yellow-400 text-sm">
              💰 {GAME_CONSTANTS.PRODUCTIVITY_UPGRADE_COST.toLocaleString()}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            生产力 +1，当前: {myPlayer.productivity}
          </div>
        </button>

        <button
          onClick={upgradeTech}
          disabled={myPlayer.gold < GAME_CONSTANTS.TECH_UPGRADE_COST}
          className="w-full p-3 bg-primary/50 rounded-lg border border-blue-500/30 hover:border-blue-500/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
        >
          <div className="flex justify-between items-center">
            <span className="text-blue-400">提升科技</span>
            <span className="text-yellow-400 text-sm">
              💰 {GAME_CONSTANTS.TECH_UPGRADE_COST.toLocaleString()}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            科技值 +1，当前: {myPlayer.technology}
          </div>
        </button>

        <button
          onClick={upgradeMorale}
          disabled={myPlayer.gold < GAME_CONSTANTS.MORALE_UPGRADE_COST}
          className="w-full p-3 bg-primary/50 rounded-lg border border-orange-500/30 hover:border-orange-500/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
        >
          <div className="flex justify-between items-center">
            <span className="text-orange-400">增长士气</span>
            <span className="text-yellow-400 text-sm">
              💰 {GAME_CONSTANTS.MORALE_UPGRADE_COST.toLocaleString()}
            </span>
          </div>
          <div className="text-xs text-orange-300/90 mt-1 leading-relaxed">
            士气 +1，当前 Lv.{myPlayer.morale}。
            <br />• 占领无人地：一次可占 {myPlayer.morale} 块
            <br />• 攻击敌方：首块若金币不足可消耗 {GAME_CONSTANTS.OCCUPY_ENEMY_COST_MORALE} 士气抵扣 {GAME_CONSTANTS.OCCUPY_ENEMY_COST_GOLD} 金币；并可连锁占领相邻敌方土地（最多 {myPlayer.morale} 块/次）
            <br />• 战斗加成：攻击+{Math.round(myPlayer.morale * GAME_CONSTANTS.MORALE_ATTACK_RATIO)}、防御+约{Math.floor(myPlayer.morale * GAME_CONSTANTS.MORALE_DEFENSE_RATIO)}
            <br />• 每 {GAME_CONSTANTS.MORALE_TICK_GOLD_EVERY} 秒自动产金：{myPlayer.lands.length * myPlayer.morale * GAME_CONSTANTS.MORALE_GOLD_PER_LAND_PER_LEVEL} 金币（领土数 × 士气）
          </div>
        </button>
      </div>

      {/* 占领敌方领地规则说明 */}
      <div className="space-y-2">
        <h3 className="text-sm text-gray-400 font-medium">占领敌方领地规则</h3>
        <div className="bg-primary/50 rounded-lg p-3 border border-red-500/20 text-xs text-gray-300 space-y-1 leading-relaxed">
          <div>💰 <span className="text-yellow-400">每次消耗 {GAME_CONSTANTS.OCCUPY_ENEMY_COST_GOLD} 金币</span>（首块金币不够时可消耗 {GAME_CONSTANTS.OCCUPY_ENEMY_COST_MORALE} 士气代替）</div>
          <div>🎁 <span className="text-green-400">每块固定奖励 {GAME_CONSTANTS.OCCUPY_ENEMY_FIXED_REWARD_GOLD} 金币</span>，并 <span className="text-purple-400">生产力 +{GAME_CONSTANTS.OCCUPY_ENEMY_PRODUCTIVITY_GAIN}</span></div>
          <div>💥 <span className="text-orange-300">士气连锁占领</span>：攻击敌方 1 次，会把与已占领地块相邻的同敌方领土一并吃下来（最多 "当前士气数" 块）</div>
          <div className="text-gray-500 pt-1">提示：士气越高 → 单次攻击能"吞"的敌方领土越多，同时每次结算获得的金币/生产力也滚雪球式放大。</div>
        </div>
      </div>

      {/* Capital Management */}
      <div className="space-y-2">
        <h3 className="text-sm text-gray-400 font-medium">首都管理</h3>

        <div className="bg-primary/50 rounded-lg p-3 border border-red-500/20">
          <div className="text-xs text-gray-500 mb-2">
            首都是你的核心领土，被敌人占领即灭亡！花费金币可将首都迁至你的其他领土。
          </div>
          <div className="flex gap-2 items-center">
            <select
              id="capitalSelect"
              className="flex-1 bg-secondary text-white p-2 rounded border border-gray-600 text-sm"
              defaultValue=""
            >
              <option value="" disabled>选择新首都位置</option>
              {myPlayer.lands
                .filter((id: number) => id !== myPlayer.capitalId)
                .map((id: number) => (
                  <option key={id} value={id}>土地 #{id}</option>
                ))}
            </select>
            <button
              onClick={() => {
                const select = document.getElementById('capitalSelect') as HTMLSelectElement;
                if (select && select.value) {
                  relocateCapital(parseInt(select.value));
                  select.value = '';
                }
              }}
              disabled={myPlayer.gold < GAME_CONSTANTS.RELOCATE_CAPITAL_COST || myPlayer.lands.length <= 1}
              className="px-3 py-2 bg-red-500/30 border border-red-500/50 rounded text-red-300 text-sm hover:bg-red-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              迁都
            </button>
          </div>
          <div className="text-xs text-yellow-400 mt-2">
            花费: 💰 {GAME_CONSTANTS.RELOCATE_CAPITAL_COST.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Exchange */}
      <div className="space-y-2">
        <h3 className="text-sm text-gray-400 font-medium">兑换</h3>

        <button
          onClick={() => exchangeResources(1)}
          disabled={myPlayer.resources < GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT}
          className="w-full p-3 bg-primary/50 rounded-lg border border-green-500/30 hover:border-green-500/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
        >
          <div className="flex justify-between items-center">
            <span className="text-green-400">兑换物资为金币</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT} 箱物资 →{' '}
            {GAME_CONSTANTS.EXCHANGE_GOLD_AMOUNT} 金币
          </div>
        </button>

        {/* 批量兑换物资 */}
        <div className="p-3 bg-primary/50 rounded-lg border border-green-500/30">
          <div className="flex justify-between items-center mb-2">
            <span className="text-green-400 text-sm font-medium">批量兑换物资</span>
            <span className="text-xs text-gray-500">
              最多可兑 {Math.max(0, Math.floor(myPlayer.resources / GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT))} 次
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              placeholder={`每次${GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT}物资`}
              value={batchCount}
              onChange={(e) => setBatchCount(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = parseInt(batchCount, 10);
                  if (n > 0) exchangeResources(n);
                }
              }}
              className="flex-1 px-3 py-2 bg-secondary rounded-md text-white text-sm placeholder:text-gray-500 border border-green-500/20 focus:outline-none focus:border-green-400"
            />
            <button
              onClick={() => {
                const n = parseInt(batchCount, 10);
                if (n > 0) exchangeResources(n);
              }}
              disabled={
                myPlayer.resources < GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT ||
                !batchCount ||
                parseInt(batchCount, 10) <= 0
              }
              className="px-4 py-2 rounded-md text-sm font-medium bg-green-600/40 border border-green-500/40 text-green-300 hover:bg-green-600/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              一键兑换
            </button>
          </div>
          {/* 预估 */}
          {batchCount && parseInt(batchCount, 10) > 0 && (
            <div className="mt-2 text-xs text-gray-400 flex justify-between">
              <span>
                消耗 {Math.min(
                  parseInt(batchCount, 10),
                  Math.max(0, Math.floor(myPlayer.resources / GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT))
                ) * GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT} 箱物资
              </span>
              <span className="text-green-300">
                预计获得{' '}
                {Math.min(
                  parseInt(batchCount, 10),
                  Math.max(0, Math.floor(myPlayer.resources / GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT))
                ) * GAME_CONSTANTS.EXCHANGE_GOLD_AMOUNT}{' '}
                金币
              </span>
            </div>
          )}
          <div className="text-xs text-gray-600 mt-1">
            比例：{GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT} 物资 = {GAME_CONSTANTS.EXCHANGE_GOLD_AMOUNT} 金币
          </div>
        </div>
      </div>

      {/* Warning */}
      {(myPlayer.gold < GAME_CONSTANTS.ELIMINATION_GOLD_THRESHOLD ||
        myPlayer.resources < GAME_CONSTANTS.ELIMINATION_RESOURCES_THRESHOLD) && (
        <div className="p-3 bg-danger/20 rounded-lg border border-danger/50">
          <div className="flex items-center gap-2 text-danger">
            <span>⚠️</span>
            <span className="font-bold">警告：国家即将灭亡！</span>
          </div>
          <div className="text-xs text-danger/80 mt-1">
            {myPlayer.gold < GAME_CONSTANTS.ELIMINATION_GOLD_THRESHOLD &&
              `金币低于 ${GAME_CONSTANTS.ELIMINATION_GOLD_THRESHOLD}`}
            {myPlayer.gold < GAME_CONSTANTS.ELIMINATION_GOLD_THRESHOLD &&
              myPlayer.resources < GAME_CONSTANTS.ELIMINATION_RESOURCES_THRESHOLD &&
              ' 或 '}
            {myPlayer.resources < GAME_CONSTANTS.ELIMINATION_RESOURCES_THRESHOLD &&
              `物资低于 ${GAME_CONSTANTS.ELIMINATION_RESOURCES_THRESHOLD}`}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}