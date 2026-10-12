import { Server, Socket } from 'socket.io';
import { GAME_CONSTANTS, LAND_ADJACENCY } from './constants.js';

export interface Player {
  id: string;
  socketId: string;
  name: string;
  isReady: boolean;
  isAlive: boolean;
  isHost: boolean;
  gold: number;
  resources: number;
  technology: number;
  productivity: number;
  morale: number;
  lands: number[];
  capitalId: number | null;
  color: string;
  // 占领类动作（occupyLand/attackLand/attackPlayer）共享 CD
  lastOccupyActionAt: number;
  // 护盾到期时间戳（毫秒，0 表示无护盾）；使用后 2 分钟内敌方无法占领/攻击本方领地
  shieldUntil: number;
  // 迅捷药水到期时间戳（毫秒，0 表示无加速）；使用后 1 分钟内占领 CD 降为 0.2 秒
  hasteUntil: number;
  // 是否为 AI 玩家（人机对战模式）
  isAI?: boolean;
  // AI 拥有的道具列表（仅 AI 用，开局随机分配；'airship'/'shield'）
  aiItems?: string[];
  // AI 难度等级（1v1 人机对战模式）：normal=普通 medium=中等 hard=困难
  aiDifficulty?: 'normal' | 'medium' | 'hard';
}

export interface Land {
  id: number;
  ownerId: string | null;
  hasNPC: boolean;
  adjacentLands: number[];
  // 是否存在城墙：使用城墙道具后，该格被第一次占领只破城墙（不改变归属），第二次才真正占领
  walled?: boolean;
}

export interface Room {
  id: string;
  players: Player[];
  lands: Land[];
  gameStatus: 'waiting' | 'playing' | 'ended';
  timeRemaining: number;
  createdAt: Date;
  gameLoopInterval?: NodeJS.Timeout;
  // 士气产金计时器（每 MORALE_TICK_GOLD_EVERY 秒结算一次）
  moraleGoldTick?: number;
  // 是否为人机对战模式
  isAIMode?: boolean;
  // AI 难度等级（人机对战模式），决定 AI 决策循环速度
  aiDifficulty?: 'normal' | 'medium' | 'hard';
  // AI 决策循环计时器
  aiLoopInterval?: NodeJS.Timeout;
  // ---- 新系统字段 ----
  // 联盟条约：key=`玩家A|玩家B`（sorted socketId），value={ formedAt, brokenAt? }
  alliances?: Map<string, { formedAt: number; brokenAt?: number }>;
  // 附庸关系：key=附庸socketId, value=宗主socketId
  vassals?: Map<string, string>;
  // 季节：'spring' | 'summer' | 'autumn' | 'winter'
  season?: 'spring' | 'summer' | 'autumn' | 'winter';
  seasonStartAt?: number;
  // 胜利模式
  victoryMode?: 'conquest' | 'economic' | 'tech' | 'diplomatic';
  // 闪电卡使用记录（每局限1次）
  lightningUsed?: Set<string>;
  // 幸运卡待生效标记
  luckyPending?: Set<string>;
  // 反弹卡激活记录：key=socketId, value=到期时间戳
  reflectActive?: Map<string, number>;
  // 开局盲盒已发放标记
  mysteryBoxGiven?: Set<string>;
}

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a', '#ffc107', '#673ab7', '#ff5722', '#009688', '#cddc39'];

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRoomMap: Map<string, string> = new Map();
  private roomCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private lowResourceWarned: Set<string> = new Set();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  getRooms(): { id: string; playerCount: number; status: string }[] {
    return Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      playerCount: room.players.length,
      status: room.gameStatus,
    }));
  }

  getPlayerCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      count += room.players.length;
    }
    return count;
  }

  // 根据 roomId 查找房间（用于局内聊天等场景）
  getRoomById(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  createRoom(
    socket: Socket,
    playerName: string,
    customRoomId?: string,
    aiCount?: number,
    difficulty?: 'normal' | 'medium' | 'hard'
  ): { success: boolean; room?: Room; error?: string } {
    let roomId: string;

    if (customRoomId && customRoomId.trim().length > 0) {
      const trimmed = customRoomId.trim();
      // 自定义房间号规则：长度 2-16，允许中文/英文字母/数字/下划线/减号/点号（常见好记的字符）
      if (trimmed.length < 2 || trimmed.length > 16) {
        return { success: false, error: '自定义房间号长度必须为 2~16 位' };
      }
      if (!/^[\u4e00-\u9fa5A-Za-z0-9_.\-]+$/.test(trimmed)) {
        return {
          success: false,
          error: '房间号只能包含中文、英文、数字、下划线 _、减号 - 和点 .',
        };
      }
      if (this.rooms.has(trimmed)) {
        return { success: false, error: `房间号「${trimmed}」已被占用，请换一个` };
      }
      roomId = trimmed;
    } else {
      roomId = this.generateRoomId();
    }

    // AI 数量校验：按难度限制最大数量（困难3/中等4/普通6）
    const diff = difficulty ?? 'normal';
    const maxAIByDiff: Record<string, number> = { normal: 6, medium: 4, hard: 3 };
    const maxAI = maxAIByDiff[diff] ?? 6;
    const ai = Math.max(0, Math.min(maxAI, Math.floor(aiCount ?? 0)));

    const player = this.createPlayer(socket.id, playerName, true);

    const room: Room = {
      id: roomId,
      players: [],
      lands: this.initializeLands(),
      gameStatus: 'waiting',
      timeRemaining: GAME_CONSTANTS.GAME_TIME_LIMIT,
      createdAt: new Date(),
      // 有 AI 时标记为 AI 模式，启动 AI 决策循环
      isAIMode: ai > 0,
    };

    this.rooms.set(roomId, room);
    this.assignPlayerColor(room, player);
    room.players.push(player);
    this.playerRoomMap.set(socket.id, roomId);
    socket.join(roomId);

    // 自动加入 N 个 AI 玩家（已准备），按选择的难度创建
    for (let i = 0; i < ai; i++) {
      const aiPlayer = this.createAIPlayer(room, diff);
      room.players.push(aiPlayer);
    }

    return { success: true, room };
  }

  /**
   * 创建人机对战房间：
   * - 玩家自动成为主机，房间标记 isAIMode = true
   * - 自动加入 1 个 AI 玩家（已准备）
   * - 难度等级（仅 1v1 人机对战模式）：
   *   普通 normal：道具随机分配（每种 40% 概率），占领 CD 0.5 秒，决策每 4 秒
   *   中等 medium：开局固定拥有 3 个道具，占领 CD 0.3 秒，决策每 2 秒
   *   困难 hard：  开局拥有全部 5 种道具，占领 CD 0.1 秒，决策每 1 秒
   * - AI 士气上限为 5（在 aiTick 中限制）
   * - 玩家自身无任何道具/士气限制
   */
  createAIRoom(
    socket: Socket,
    playerName: string,
    difficulty: 'normal' | 'medium' | 'hard' = 'normal'
  ): { success: boolean; room?: Room; error?: string } {
    const roomId = this.generateRoomId();
    const player = this.createPlayer(socket.id, playerName, true);

    const room: Room = {
      id: roomId,
      players: [],
      lands: this.initializeLands(),
      gameStatus: 'waiting',
      timeRemaining: GAME_CONSTANTS.GAME_TIME_LIMIT,
      createdAt: new Date(),
      isAIMode: true,
      aiDifficulty: difficulty,
    };

    this.rooms.set(roomId, room);
    this.assignPlayerColor(room, player);
    room.players.push(player);
    this.playerRoomMap.set(socket.id, roomId);
    socket.join(roomId);

    // 创建 AI 玩家并直接加入房间（已准备），道具按难度分配
    const aiPlayer = this.createAIPlayer(room, difficulty);
    room.players.push(aiPlayer);

    this.io.to(roomId).emit('roomJoined', { room, playerId: socket.id });
    this.broadcastGameState(room);

    return { success: true, room };
  }

  // 创建一个 AI 玩家（人机对战/自定义房间 AI 专用）
  // difficulty 仅在 1v1 人机对战模式传入；自定义房间的 AI 默认 normal
  private createAIPlayer(
    room: Room,
    difficulty: 'normal' | 'medium' | 'hard' = 'normal'
  ): Player {
    // AI 用一个伪 socketId（前缀 ai_ 避免与真实玩家冲突）
    // 必须保证唯一：用 room.id + 时间戳 + 玩家数 + 随机后缀，防止循环里同毫秒生成相同 ID
    const aiSocketId = `ai_${room.id}_${Date.now()}_${room.players.length}_${Math.random().toString(36).slice(2, 8)}`;
    const aiNames = ['机器将军', 'AI参谋', '电子君主', '算法之主', '机械君王'];
    const name = aiNames[Math.floor(Math.random() * aiNames.length)];

    const aiPlayer: Player = {
      id: `player_${aiSocketId}`,
      socketId: aiSocketId,
      name,
      isReady: true, // AI 自动准备
      isAlive: true,
      isHost: false,
      gold: GAME_CONSTANTS.INITIAL_GOLD,
      resources: GAME_CONSTANTS.INITIAL_RESOURCES,
      technology: GAME_CONSTANTS.INITIAL_TECH,
      productivity: GAME_CONSTANTS.INITIAL_PRODUCTIVITY,
      morale: 1,
      lands: [],
      capitalId: null,
      color: '',
      lastOccupyActionAt: 0,
      shieldUntil: 0,
      hasteUntil: 0,
      isAI: true,
      aiItems: [],
      aiDifficulty: difficulty,
    };

    // 按难度分配道具（护盾/飞艇/指导导弹/迅捷药水/核能导弹 共 5 种）：
    // - 普通：每种 40% 概率随机分配（原默认行为，0~5 个）
    // - 中等：固定随机挑 3 种
    // - 困难：全部 5 种都有
    const allItemTypes = ['shield', 'airship', 'guided_missile', 'haste', 'nuclear_missile'];
    let items: string[] = [];
    if (difficulty === 'hard') {
      items = [...allItemTypes];
    } else if (difficulty === 'medium') {
      // Fisher-Yates 洗牌后取前 3，保证每局道具组合随机
      const pool = [...allItemTypes];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      items = pool.slice(0, 3);
    } else {
      for (const it of allItemTypes) {
        if (Math.random() < 0.4) items.push(it);
      }
    }
    aiPlayer.aiItems = items;

    this.assignPlayerColor(room, aiPlayer);
    return aiPlayer;
  }

  rejoinRoom(
    socket: Socket,
    roomId: string,
    playerName: string
  ): { success: boolean; room?: Room; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    const existingPlayer = room.players.find((p) => p.name === playerName);
    if (!existingPlayer) {
      return { success: false, error: '玩家不存在' };
    }

    this.playerRoomMap.delete(existingPlayer.socketId);
    existingPlayer.socketId = socket.id;
    this.playerRoomMap.set(socket.id, roomId);
    socket.join(roomId);

    return { success: true, room };
  }

  joinRoom(
    socket: Socket,
    roomId: string,
    playerName: string
  ): { success: boolean; room?: Room; player?: Player; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }
    if (room.gameStatus !== 'waiting') {
      return { success: false, error: '游戏已经开始' };
    }
    if (room.players.length >= GAME_CONSTANTS.TOTAL_PLAYERS) {
      return { success: false, error: '房间已满' };
    }

    const player = this.createPlayer(socket.id, playerName, false);
    this.assignPlayerColor(room, player);
    room.players.push(player);
    this.playerRoomMap.set(socket.id, roomId);
    socket.join(roomId);

    return { success: true, room, player };
  }

  setPlayerReady(socketId: string, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const player = room.players.find((p) => p.socketId === socketId);
    if (player) {
      player.isReady = true;
    }

    this.broadcastGameState(room);
  }

  startGame(roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    // 检查是否至少有2名玩家（主机+至少1名准备好的其他玩家）
    const readyPlayers = room.players.filter((p) => p.isReady || p.isHost);
    if (readyPlayers.length < 2) {
      return { success: false, error: '至少需要2名玩家准备' };
    }

    // 分配初始土地
    this.assignInitialLands(room);

    // 初始化新系统（季节/联盟/附庸/胜利条件等）
    this.initGameSystems(room);

    // 开局盲盒：每个存活玩家随机送1个免费道具
    for (const p of room.players) {
      if (p.isAlive || p.isHost) {
        const freeItem = this.giveMysteryBox(p.socketId, room);
        if (freeItem) {
          this.io.to(p.socketId).emit('mysteryBox', { item: freeItem });
        }
      }
    }

    // 开始游戏循环
    room.gameStatus = 'playing';
    room.moraleGoldTick = 0;
    room.gameLoopInterval = setInterval(() => {
      this.runGameLoop(roomId);
    }, 1000);

    // 人机对战模式：启动 AI 决策循环（间隔按难度分级：普通 4 秒 / 中等 2 秒 / 困难 1 秒）
    if (room.isAIMode) {
      const aiIntervalMs =
        room.aiDifficulty === 'hard' ? 1000 : room.aiDifficulty === 'medium' ? 2000 : 4000;
      room.aiLoopInterval = setInterval(() => {
        this.aiTick(roomId);
      }, aiIntervalMs);
    }

    this.broadcastGameState(room);
    return { success: true };
  }

  /**
   * AI 决策循环（每 4 秒触发一次）：
   * 1. 优先占领相邻空地（金币够时）
   * 2. 其次攻击相邻敌方领地（非首都/非首都相邻）
   * 3. 升级科技（金币≥5000）
   * 4. 升级生产力（金币≥1000）
   * 5. 升级士气（金币≥15000 且 morale<5，AI 上限 5）
   * 6. 偶尔使用飞艇（若拥有）攻击随机敌方格
   * 7. 偶尔使用护盾（若拥有且未开）
   * AI 复用现有的 occupyLand/attackLand/upgradeXxx 方法（通过伪 socketId 调用）
   */
  private aiTick(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') return;

    for (const ai of room.players) {
      if (!ai.isAI || !ai.isAlive) continue;

      // 1. 占领相邻空地（金币够时）
      if (ai.gold >= GAME_CONSTANTS.OCCUPY_COST) {
        // 找一个与 AI 已有地相邻的空地
        const adjacentEmpty: number[] = [];
        for (const myLandId of ai.lands) {
          const adj = LAND_ADJACENCY[myLandId] || [];
          for (const adjId of adj) {
            const land = room.lands.find((l) => l.id === adjId);
            if (land && land.ownerId === null && !adjacentEmpty.includes(adjId)) {
              adjacentEmpty.push(adjId);
            }
          }
        }
        if (adjacentEmpty.length > 0) {
          const pick = adjacentEmpty[Math.floor(Math.random() * adjacentEmpty.length)];
          this.occupyLand(ai.socketId, roomId, pick);
          continue; // 本轮只做一个动作，避免连点
        }
      }

      // 2. 攻击相邻敌方领地（金币≥3000，且非首都/非首都相邻）
      if (ai.gold >= GAME_CONSTANTS.OCCUPY_ENEMY_COST_GOLD) {
        const adjacentEnemy: number[] = [];
        for (const myLandId of ai.lands) {
          const adj = LAND_ADJACENCY[myLandId] || [];
          for (const adjId of adj) {
            const land = room.lands.find((l) => l.id === adjId);
            if (!land || !land.ownerId || land.ownerId === ai.socketId) continue;
            if (adjacentEnemy.includes(adjId)) continue;
            const owner = room.players.find((p) => p.socketId === land.ownerId);
            if (!owner || !owner.isAlive) continue;
            // 排除首都
            if (owner.capitalId === adjId) continue;
            // 排除首都相邻
            if (owner.capitalId !== null) {
              const capLand = room.lands.find((l) => l.id === owner.capitalId);
              if (capLand && capLand.adjacentLands.includes(adjId)) continue;
            }
            adjacentEnemy.push(adjId);
          }
        }
        if (adjacentEnemy.length > 0) {
          const pick = adjacentEnemy[Math.floor(Math.random() * adjacentEnemy.length)];
          this.attackLand(ai.socketId, roomId, pick);
          continue;
        }
      }

      // 3. 升级科技（金币≥5000）
      if (ai.gold >= GAME_CONSTANTS.TECH_UPGRADE_COST && Math.random() < 0.5) {
        this.upgradeTech(ai.socketId, roomId);
        continue;
      }

      // 4. 升级生产力（金币≥1000 且 productivity<10）
      if (ai.gold >= GAME_CONSTANTS.PRODUCTIVITY_UPGRADE_COST && ai.productivity < 10 && Math.random() < 0.5) {
        this.upgradeProductivity(ai.socketId, roomId);
        continue;
      }

      // 5. 升级士气（金币≥15000 且 morale<5）
      if (ai.gold >= GAME_CONSTANTS.MORALE_UPGRADE_COST && ai.morale < 5 && Math.random() < 0.7) {
        this.upgradeMorale(ai.socketId, roomId);
        continue;
      }

      // 6. 偶尔使用飞艇（若拥有且未用过）
      if (ai.aiItems && ai.aiItems.includes('airship') && Math.random() < 0.2) {
        // 找一个可攻击的敌方格（非首都/非首都相邻/非护盾期）
        const validTargets: number[] = [];
        for (const land of room.lands) {
          if (!land.ownerId || land.ownerId === ai.socketId) continue;
          const owner = room.players.find((p) => p.socketId === land.ownerId);
          if (!owner || !owner.isAlive) continue;
          if (this.isPlayerShielded(owner)) continue;
          if (owner.capitalId === land.id) continue;
          if (owner.capitalId !== null) {
            const capLand = room.lands.find((l) => l.id === owner.capitalId);
            if (capLand && capLand.adjacentLands.includes(land.id)) continue;
          }
          validTargets.push(land.id);
        }
        if (validTargets.length > 0) {
          const pick = validTargets[Math.floor(Math.random() * validTargets.length)];
          this.airshipAttack(ai.socketId, roomId, pick);
          // 消耗道具
          const idx = ai.aiItems.indexOf('airship');
          if (idx > -1) ai.aiItems.splice(idx, 1);
        }
      }

      // 7. 偶尔使用护盾（若拥有且未开）
      if (
        ai.aiItems &&
        ai.aiItems.includes('shield') &&
        !this.isPlayerShielded(ai) &&
        Math.random() < 0.15
      ) {
        this.useShield(ai.socketId, roomId);
        const idx = ai.aiItems.indexOf('shield');
        if (idx > -1) ai.aiItems.splice(idx, 1);
      }

      // 8. 偶尔使用迅捷药水（若拥有且未激活）
      if (
        ai.aiItems &&
        ai.aiItems.includes('haste') &&
        ai.hasteUntil <= Date.now() &&
        Math.random() < 0.2
      ) {
        this.useHaste(ai.socketId, roomId);
        const idx = ai.aiItems.indexOf('haste');
        if (idx > -1) ai.aiItems.splice(idx, 1);
      }

      // 9. 偶尔使用指导导弹（若拥有，目标为存活非自己玩家）
      if (
        ai.aiItems &&
        ai.aiItems.includes('guided_missile') &&
        Math.random() < 0.1
      ) {
        const validTargets = room.players.filter(
          (p) => p.isAlive && p.socketId !== ai.socketId && !this.isPlayerShielded(p)
        );
        if (validTargets.length > 0) {
          this.useGuidedMissile(ai.socketId, roomId);
          const idx = ai.aiItems.indexOf('guided_missile');
          if (idx > -1) ai.aiItems.splice(idx, 1);
        }
      }

      // 10. 极少使用核能导弹（若拥有，目标为存活非自己玩家，且不针对护盾玩家）
      if (
        ai.aiItems &&
        ai.aiItems.includes('nuclear_missile') &&
        Math.random() < 0.05
      ) {
        const validTargets = room.players.filter(
          (p) => p.isAlive && p.socketId !== ai.socketId && !this.isPlayerShielded(p)
        );
        if (validTargets.length > 0) {
          const target = validTargets[Math.floor(Math.random() * validTargets.length)];
          this.useNuclearMissile(ai.socketId, roomId, target.socketId);
          const idx = ai.aiItems.indexOf('nuclear_missile');
          if (idx > -1) ai.aiItems.splice(idx, 1);
        }
      }
    }
  }

  upgradeTech(socketId: string, roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    if (player.gold < GAME_CONSTANTS.TECH_UPGRADE_COST) {
      return { success: false, error: '金币不足' };
    }

    player.gold -= GAME_CONSTANTS.TECH_UPGRADE_COST;
    player.technology += 1;

    this.broadcastGameState(room);
    return { success: true };
  }

  upgradeProductivity(socketId: string, roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    if (player.gold < GAME_CONSTANTS.PRODUCTIVITY_UPGRADE_COST) {
      return { success: false, error: '金币不足' };
    }

    // 生产力上限：每秒产 10 个物资，初始为 1，最高为 10
    if (player.productivity >= 10) {
      return { success: false, error: '生产力已达上限（10/秒）' };
    }

    player.gold -= GAME_CONSTANTS.PRODUCTIVITY_UPGRADE_COST;
    player.productivity += 1;

    this.broadcastGameState(room);
    return { success: true };
  }

  upgradeMorale(socketId: string, roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    if (player.gold < GAME_CONSTANTS.MORALE_UPGRADE_COST) {
      return { success: false, error: '金币不足' };
    }

    // 士气上限统一为 5（玩家和人机一致）
    if (player.morale >= 5) {
      return { success: false, error: '士气已达上限（5级）' };
    }

    player.gold -= GAME_CONSTANTS.MORALE_UPGRADE_COST;
    player.morale += 1;

    this.io.to(roomId).emit('systemMessage', {
      message: `${player.name}提升了士气！当前士气等级: ${player.morale}，每次点击可占领${player.morale}格`,
    });
    this.broadcastGameState(room);
    return { success: true };
  }

  relocateCapital(socketId: string, roomId: string, newLandId: number): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    if (player.gold < GAME_CONSTANTS.RELOCATE_CAPITAL_COST) {
      return { success: false, error: '金币不足' };
    }

    if (!player.lands.includes(newLandId)) {
      return { success: false, error: '该土地不属于你' };
    }

    if (player.capitalId === newLandId) {
      return { success: false, error: '该土地已经是首都' };
    }

    player.gold -= GAME_CONSTANTS.RELOCATE_CAPITAL_COST;
    player.capitalId = newLandId;

    this.io.to(roomId).emit('systemMessage', {
      message: `${player.name}将首都迁至土地${newLandId}！`,
    });
    this.broadcastGameState(room);
    return { success: true };
  }

  exchangeResources(
    socketId: string,
    roomId: string,
    count: number = 1
  ): { success: boolean; error?: string; times?: number; gainedGold?: number } {
    if (!Number.isFinite(count) || count <= 0) {
      return { success: false, error: '兑换次数无效' };
    }
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    // 按当前物资量自动 clamp 到可兑换的最大份数
    const perRes = GAME_CONSTANTS.EXCHANGE_RESOURCES_AMOUNT;
    const perGold = GAME_CONSTANTS.EXCHANGE_GOLD_AMOUNT;
    const maxTimes = Math.floor(player.resources / perRes);
    const times = Math.min(Math.floor(count), maxTimes);
    if (times <= 0) {
      return { success: false, error: '物资不足' };
    }

    player.resources -= perRes * times;
    player.gold += perGold * times;

    this.broadcastGameState(room);
    return { success: true, times, gainedGold: perGold * times };
  }

  occupyLand(socketId: string, roomId: string, landId: number): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    // 注意：CD 检查移到相邻检查之后，避免点错地也触发冷却

    const land = room.lands.find((l) => l.id === landId);
    if (!land) {
      return { success: false, error: '土地不存在' };
    }
    if (land.ownerId !== null) {
      return { success: false, error: '土地已被占领' };
    }

    // 占领花费
    const occupyCost = GAME_CONSTANTS.OCCUPY_COST;
    if (player.gold < occupyCost) {
      return { success: false, error: '金币不足' };
    }

    // 检查是否与自己的任意一块领地相邻（允许朝任意方向单独发展）
    if (player.lands.length > 0) {
      const hasAdjacentLand = player.lands.some((myLandId) => {
        const myLand = room.lands.find((l) => l.id === myLandId);
        if (!myLand) return false;
        return myLand.adjacentLands.includes(landId);
      });
      if (!hasAdjacentLand) {
        return { success: false, error: '该土地与你的领土不相邻，无法占领' };
      }
    }

    // 所有前置检查通过后才触发 CD
    const cdCheck = this.checkOccupyCooldown(player, room);
    if (!cdCheck.ok) return { success: false, error: cdCheck.error };

    this.resetOccupyCooldown(player);

    player.gold -= occupyCost;
    land.ownerId = socketId;
    land.hasNPC = false;
    player.lands.push(landId);

    // 系统随机奖励
    let totalReward =
      GAME_CONSTANTS.OCCUPY_REWARD_MIN +
      Math.floor(Math.random() * (GAME_CONSTANTS.OCCUPY_REWARD_MAX - GAME_CONSTANTS.OCCUPY_REWARD_MIN + 1));
    player.gold += totalReward;

    const occupiedIds = [landId];

    // 士气等级 > 1 时，额外占领附近的无人NPC领地
    const extraCount = player.morale - 1;
    for (let i = 0; i < extraCount; i++) {
      const candidates: number[] = [];
      for (const occId of occupiedIds) {
        const occLand = room.lands.find((l) => l.id === occId);
        if (!occLand) continue;
        for (const adjId of occLand.adjacentLands) {
          const adjLand = room.lands.find((l) => l.id === adjId);
          if (adjLand && adjLand.ownerId === null && adjLand.hasNPC && !occupiedIds.includes(adjId)) {
            candidates.push(adjId);
          }
        }
      }
      if (candidates.length === 0) break;
      const pickId = candidates[Math.floor(Math.random() * candidates.length)];
      const pickLand = room.lands.find((l) => l.id === pickId);
      if (pickLand) {
        pickLand.ownerId = socketId;
        pickLand.hasNPC = false;
        player.lands.push(pickId);
        occupiedIds.push(pickId);
        const extraReward =
          GAME_CONSTANTS.OCCUPY_REWARD_MIN +
          Math.floor(Math.random() * (GAME_CONSTANTS.OCCUPY_REWARD_MAX - GAME_CONSTANTS.OCCUPY_REWARD_MIN + 1));
        player.gold += extraReward;
        totalReward += extraReward;
      }
    }

    this.io.to(roomId).emit('systemMessage', {
      message: `${player.name}占领了土地${occupiedIds.join(', ')}，花费${occupyCost}金币，系统奖励${totalReward}金币（士气${player.morale}）`,
    });
    this.broadcastGameState(room);
    return { success: true };
  }

  // ==================== 新系统方法 ====================

  // 初始化新系统（游戏开始时调用）
  initGameSystems(room: Room): void {
    room.alliances = new Map();
    room.vassals = new Map();
    room.season = 'spring';
    room.seasonStartAt = Date.now();
    room.victoryMode = 'conquest'; // 默认征服胜利
    room.lightningUsed = new Set();
    room.luckyPending = new Set();
    room.reflectActive = new Map();
    room.mysteryBoxGiven = new Set();
  }

  // 开局盲盒：每局开始随机送1个免费道具
  giveMysteryBox(socketId: string, room: Room): string | null {
    if (!room.mysteryBoxGiven) room.mysteryBoxGiven = new Set();
    if (room.mysteryBoxGiven.has(socketId)) return null; // 已领过
    room.mysteryBoxGiven.add(socketId);
    const freeItems = ['shield', 'haste', 'wall', 'tnt', 'recon_card', 'lucky_card', 'reflect_card'];
    return freeItems[Math.floor(Math.random() * freeItems.length)];
  }

  // 联盟/外交：缔结互不侵犯条约
  formAlliance(socketId: string, targetSocketId: string, room: Room): { success: boolean; error?: string } {
    if (!room.alliances) room.alliances = new Map();
    const key = [socketId, targetSocketId].sort().join('|');
    if (room.alliances.has(key)) return { success: false, error: '已有条约' };
    room.alliances.set(key, { formedAt: Date.now() });
    const p1 = room.players.find(p => p.socketId === socketId);
    const p2 = room.players.find(p => p.socketId === targetSocketId);
    this.io.to(room.id).emit('systemMessage', {
      message: `🤝 ${p1?.name} 与 ${p2?.name} 缔结了互不侵犯条约！`,
    });
    return { success: true };
  }

  // 检查是否有联盟条约
  hasAlliance(a: string, b: string, room: Room): boolean {
    if (!room.alliances) return false;
    const key = [a, b].sort().join('|');
    const alliance = room.alliances.get(key);
    if (!alliance) return false;
    // 如果已撕毁且冷却期已过，视为无条约
    if (alliance.brokenAt && Date.now() - alliance.brokenAt > GAME_CONSTANTS.NAP_BREAK_COOLDOWN_MS) {
      room.alliances.delete(key);
      return false;
    }
    if (alliance.brokenAt) return true; // 撕毁后冷却期内仍算有条约（但不能攻击）
    return true;
  }

  // 撕毁条约
  breakAlliance(socketId: string, targetSocketId: string, room: Room): { success: boolean; error?: string } {
    if (!room.alliances) return { success: false, error: '无条约' };
    const key = [socketId, targetSocketId].sort().join('|');
    const alliance = room.alliances.get(key);
    if (!alliance) return { success: false, error: '无条约' };
    alliance.brokenAt = Date.now();
    const p1 = room.players.find(p => p.socketId === socketId);
    const p2 = room.players.find(p => p.socketId === targetSocketId);
    this.io.to(room.id).emit('systemMessage', {
      message: `💔 ${p1?.name} 撕毁了与 ${p2?.name} 的互不侵犯条约！（3分钟内无法互相攻击）`,
    });
    return { success: true };
  }

  // 检查攻击是否被联盟条约阻止
  isAttackBlockedByAlliance(attackerId: string, defenderId: string, room: Room): boolean {
    if (!room.alliances) return false;
    const key = [attackerId, defenderId].sort().join('|');
    const alliance = room.alliances.get(key);
    if (!alliance) return false;
    // 有条约且未撕毁 → 阻止攻击
    if (!alliance.brokenAt) return true;
    // 撕毁后 3 分钟内仍阻止
    if (Date.now() - alliance.brokenAt < GAME_CONSTANTS.NAP_BREAK_COOLDOWN_MS) return true;
    return false;
  }

  // 间谍侦察
  spy(socketId: string, roomId: string, targetSocketId: string): { success: boolean; error?: string; data?: any } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') return { success: false, error: '游戏未开始' };
    const player = room.players.find(p => p.socketId === socketId);
    if (!player || !player.isAlive) return { success: false, error: '玩家不存在或已淘汰' };
    const target = room.players.find(p => p.socketId === targetSocketId);
    if (!target || !target.isAlive) return { success: false, error: '目标不存在或已淘汰' };
    if (player.gold < GAME_CONSTANTS.SPY_COST) return { success: false, error: `间谍需要 ${GAME_CONSTANTS.SPY_COST} 金币` };
    player.gold -= GAME_CONSTANTS.SPY_COST;
    // 返回目标信息
    return {
      success: true,
      data: { gold: target.gold, morale: target.morale, lands: target.lands.length, tech: target.technology },
    };
  }

  // 交易系统
  trade(socketId: string, roomId: string, tradeData: { toSocketId: string; gold?: number; itemId?: string }): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') return { success: false, error: '游戏未开始' };
    const player = room.players.find(p => p.socketId === socketId);
    if (!player || !player.isAlive) return { success: false, error: '玩家不存在' };
    const target = room.players.find(p => p.socketId === tradeData.toSocketId);
    if (!target || !target.isAlive) return { success: false, error: '目标不存在' };
    if (tradeData.gold) {
      if (player.gold < tradeData.gold) return { success: false, error: '金币不足' };
      player.gold -= tradeData.gold;
      target.gold += tradeData.gold;
    }
    this.io.to(room.id).emit('systemMessage', {
      message: `💱 ${player.name} 向 ${target.name} 发送了 ${tradeData.gold || 0} 金币`,
    });
    this.broadcastGameState(room);
    return { success: true };
  }

  // 季节切换（在 gameLoop 中调用）
  checkSeasonChange(room: Room): void {
    if (!room.seasonStartAt) return;
    const elapsed = Date.now() - room.seasonStartAt;
    if (elapsed >= GAME_CONSTANTS.SEASON_DURATION_MS) {
      const seasons: Array<'spring' | 'summer' | 'autumn' | 'winter'> = ['spring', 'summer', 'autumn', 'winter'];
      const idx = seasons.indexOf(room.season || 'spring');
      room.season = seasons[(idx + 1) % 4];
      room.seasonStartAt = Date.now();
      const names: Record<string, string> = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' };
      const effects: Record<string, string> = {
        spring: '占领费用 -20%',
        summer: '士气产金 +50%',
        autumn: '道具掉落率提升',
        winter: '所有 CD 翻倍',
      };
      this.io.to(room.id).emit('systemMessage', {
        message: `🍂 季节变更：${names[room.season]}！${effects[room.season]}`,
      });
    }
  }

  // 获取当前季节修正
  getSeasonModifier(room: Room): { occupyCostMult: number; goldMult: number; cdMult: number } {
    switch (room.season) {
      case 'spring': return { occupyCostMult: 0.8, goldMult: 1.0, cdMult: 1.0 };
      case 'summer': return { occupyCostMult: 1.0, goldMult: 1.5, cdMult: 1.0 };
      case 'autumn': return { occupyCostMult: 1.0, goldMult: 1.0, cdMult: 1.0 };
      case 'winter': return { occupyCostMult: 1.0, goldMult: 1.0, cdMult: 2.0 };
      default: return { occupyCostMult: 1.0, goldMult: 1.0, cdMult: 1.0 };
    }
  }

  // 新道具使用
  useNewItem(socketId: string, roomId: string, itemId: string): { success: boolean; error?: string; data?: any } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') return { success: false, error: '游戏未开始' };
    const player = room.players.find(p => p.socketId === socketId);
    if (!player || !player.isAlive) return { success: false, error: '玩家不存在或已淘汰' };

    switch (itemId) {
      case 'lightning_card': {
        if (!room.lightningUsed) room.lightningUsed = new Set();
        if (room.lightningUsed.has(socketId)) return { success: false, error: '闪电卡每局限用1次' };
        room.lightningUsed.add(socketId);
        // 清零该玩家的占领 CD
        player.lastOccupyActionAt = 0;
        return { success: true, data: { message: '⚡ 闪电卡生效！本回合占领 CD 归零' } };
      }
      case 'lucky_card': {
        if (!room.luckyPending) room.luckyPending = new Set();
        room.luckyPending.add(socketId);
        return { success: true, data: { message: '🎁 幸运卡生效！下次占领奖励翻 3 倍' } };
      }
      case 'reflect_card': {
        if (!room.reflectActive) room.reflectActive = new Map();
        room.reflectActive.set(socketId, Date.now() + 60000); // 60秒
        return { success: true, data: { message: '🪞 反弹卡生效！60秒内被攻击反弹50%伤害' } };
      }
      case 'prophecy_card': {
        // 返回所有敌方玩家的金币数
        const enemies = room.players.filter(p => p.socketId !== socketId && p.isAlive);
        const data = enemies.map(p => ({ name: p.name, gold: p.gold }));
        return { success: true, data: { message: '🔮 预言卡生效！', enemies: data } };
      }
      case 'recon_card': {
        // 揭示3个随机敌方领地的归属与主人金币
        const enemyLands = room.lands.filter(l => l.ownerId && l.ownerId !== socketId);
        const shuffled = enemyLands.sort(() => Math.random() - 0.5).slice(0, 3);
        const data = shuffled.map(l => {
          const owner = room.players.find(p => p.socketId === l.ownerId);
          return { landId: l.id, ownerName: owner?.name || '中立', ownerGold: owner?.gold ?? 0 };
        });
        return { success: true, data: { message: '🗺️ 侦察卡生效！', lands: data } };
      }
      default:
        return { success: false, error: '未知道具' };
    }
  }

  // 检查胜利条件
  checkVictory(room: Room): string | null {
    const alivePlayers = room.players.filter(p => p.isAlive);
    if (alivePlayers.length <= 1) {
      return alivePlayers[0]?.socketId || null; // 最后存活
    }
    for (const p of alivePlayers) {
      switch (room.victoryMode) {
        case 'economic':
          if (p.gold >= GAME_CONSTANTS.VICTORY_ECONOMIC_GOLD) return p.socketId;
          break;
        case 'tech':
          if (p.technology >= GAME_CONSTANTS.VICTORY_TECH_LEVEL) return p.socketId;
          break;
        case 'diplomatic':
          if (!room.alliances) break;
          const allianceCount = Array.from(room.alliances.entries()).filter(([key]) => {
            const [a, b] = key.split('|');
            return a === p.socketId || b === p.socketId;
          }).length;
          if (allianceCount >= GAME_CONSTANTS.VICTORY_DIPLOMATIC_ALLIANCES) return p.socketId;
          break;
        default: // conquest
          const ownCount = p.lands.length;
          if (ownCount / GAME_CONSTANTS.TOTAL_LANDS >= GAME_CONSTANTS.VICTORY_CONQUEST_PERCENT) return p.socketId;
          break;
      }
    }
    return null;
  }

  attackLand(socketId: string, roomId: string, landId: number): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const attacker = room.players.find((p) => p.socketId === socketId);
    if (!attacker || !attacker.isAlive) {
      return { success: false, error: '攻击者不存在或已淘汰' };
    }

    // 注意：CD 检查移到相邻检查之后，避免点错地也触发冷却

    const targetLand = room.lands.find((l) => l.id === landId);
    if (!targetLand) {
      return { success: false, error: '土地不存在' };
    }

    if (!targetLand.ownerId) {
      return { success: false, error: '请使用占领功能占领无人领地' };
    }

    if (targetLand.ownerId === socketId) {
      return { success: false, error: '不能攻击自己的领土' };
    }

    const defender = room.players.find((p) => p.socketId === targetLand.ownerId);
    if (!defender || !defender.isAlive) {
      return { success: false, error: '目标玩家不存在或已淘汰' };
    }

    // 护盾检查：目标玩家处于护盾期 → 拒绝攻击其领地
    if (this.isPlayerShielded(defender)) {
      return { success: false, error: `${defender.name} 已开启护盾，2 分钟内无法攻击其领地` };
    }

    const attackerLand = room.lands.find((l) => attacker.lands.includes(l.id));
    if (!attackerLand) {
      return { success: false, error: '你没有领土，无法攻击' };
    }

    // 检查目标土地是否与自己的任意一块领地相邻（允许朝任意方向单独发展）
    const hasAdjacentLand = attacker.lands.some((attLandId) => {
      const attLand = room.lands.find((l) => l.id === attLandId);
      if (!attLand) return false;
      return attLand.adjacentLands.includes(landId);
    });

    if (!hasAdjacentLand) {
      return { success: false, error: '该领土与你的领土不相邻，无法攻击' };
    }

    // -------------------- 城墙：若主目标有城墙，首击只破墙（不占领，不连锁，仍消耗 3000 金币）--------------------
    const COST_GOLD_PER = GAME_CONSTANTS.OCCUPY_ENEMY_COST_GOLD;
    if (targetLand.walled) {
      // 检查 CD
      const cdCheck = this.checkOccupyCooldown(attacker, room);
      if (!cdCheck.ok) return { success: false, error: cdCheck.error };
      // 破墙同样消耗 3000 金币（不允许士气抵扣）
      if (attacker.gold < COST_GOLD_PER) {
        return { success: false, error: `击破城墙需要 ${COST_GOLD_PER} 金币，请先提升金币` };
      }
      attacker.gold -= COST_GOLD_PER;
      this.resetOccupyCooldown(attacker);
      targetLand.walled = false;
      this.io.to(roomId).emit('systemMessage', {
        message: `🏰${attacker.name} 击破了 ${defender.name} 在 #${landId} 的城墙！消耗${COST_GOLD_PER}金币。下次点击即可占领该格。`,
      });
      this.broadcastGameState(room);
      return { success: true };
    }

    // 所有前置检查通过后才触发 CD（避免点错地也消耗冷却）
    const cdCheck1 = this.checkOccupyCooldown(attacker, room);
    if (!cdCheck1.ok) return { success: false, error: cdCheck1.error };

    // -------------------- 占领敌方领地：消耗 3000 金币（或士气抵扣）--------------------
    // 士气连锁效果：
    //   - 攻击方每 1 点士气，可以多占领 1 块与"本次已占领土地"相邻的同一敌方玩家领土（=士气的周围占领效果，用于敌方）
    //   - 主目标 +（士气-1）块额外，即 士气 N → 最多 N 块
    //   - 连锁占领的每块土地：同样消耗 3000 金币（不足则本次停止）、奖励 5000 金币
    const COST_MORALE_FIRST = GAME_CONSTANTS.OCCUPY_ENEMY_COST_MORALE; // 仅金币不足时首块可抵扣 1 士气
    const REWARD_GOLD_PER = GAME_CONSTANTS.OCCUPY_ENEMY_FIXED_REWARD_GOLD;

    // 首块：金币 ≥3000 优先，否则可用 1 士气抵扣（保底 1）
    let firstPay: 'gold' | 'morale' | null = null;
    if (attacker.gold >= COST_GOLD_PER) {
      firstPay = 'gold';
    } else if (attacker.morale > COST_MORALE_FIRST) {
      firstPay = 'morale';
    }
    if (!firstPay) {
      return {
        success: false,
        error: `占领敌方领地需要 ${COST_GOLD_PER} 金币（首块可消耗 ${COST_MORALE_FIRST} 级士气抵扣），请先提升金币或士气`,
      };
    }

    const conqueredIds: number[] = [];
    const defenderId0 = defender.socketId;
    let totalGoldPaid = 0;
    let moralePaid = 0;
    let totalReward = 0;
    let payDesc: string;

    // 先扣除首块费用
    if (firstPay === 'gold') {
      attacker.gold -= COST_GOLD_PER;
      totalGoldPaid += COST_GOLD_PER;
    } else {
      attacker.morale = Math.max(1, attacker.morale - COST_MORALE_FIRST);
      moralePaid += COST_MORALE_FIRST;
    }
    payDesc =
      firstPay === 'gold'
        ? `花费${COST_GOLD_PER}金币`
        : `消耗${COST_MORALE_FIRST}级士气（抵${COST_GOLD_PER}金币）`;

    // 占领敌方领地：100% 成功占领（点击立即生效，无需概率重试）
    this.resetOccupyCooldown(attacker);

    // ------ 首块占领：从防守者移除该地，归入攻击者 ------
    {
      const lidx = defender.lands.indexOf(landId);
      if (lidx > -1) defender.lands.splice(lidx, 1);
      targetLand.ownerId = socketId;
      attacker.lands.push(landId);
      conqueredIds.push(landId);
      attacker.gold += REWARD_GOLD_PER;
      totalReward += REWARD_GOLD_PER;
      // 占领后自动移除该格城墙（若存在）—— 防止残留
      targetLand.walled = false;
      // 取消士气和生产力的关联：占领敌方领地不再增加生产力，
      // 生产力只能通过"提升生产力"按钮花钱升级（每级 1000 金币，上限 10）
    }

    // ------ 士气连锁占领：主目标相邻、且仍属于最初被攻击玩家（defenderId0）------
    // 士气 N 级 = 最多占 N 块（主目标占了 1，再占 max(0, N-1) 块）
    // 首都被占领时不连锁，保留剩余领地给分裂的新国家
    const primaryIsCapital = defender.capitalId === landId;
    const maxExtra = primaryIsCapital ? 0 : Math.max(0, attacker.morale - 1);
    for (let i = 0; i < maxExtra; i++) {
      if (!defender.isAlive) break;

      const candidates: number[] = [];
      for (const occId of conqueredIds) {
        const occLand = room.lands.find((l) => l.id === occId);
        if (!occLand) continue;
        for (const adjId of occLand.adjacentLands) {
          if (conqueredIds.includes(adjId)) continue;
          const adjLand = room.lands.find((l) => l.id === adjId);
          // 必须仍是"同一敌方玩家"的领土，且没有城墙（城墙需手动击破，不参与连锁）
          if (adjLand && adjLand.ownerId === defenderId0 && !adjLand.walled) {
            candidates.push(adjId);
          }
        }
      }
      if (candidates.length === 0) break;

      // 连锁占领的每一块仍然需要 3000 金币（金币不够就停止，不再继续）
      if (attacker.gold < COST_GOLD_PER) break;
      attacker.gold -= COST_GOLD_PER;
      totalGoldPaid += COST_GOLD_PER;

      const pickId = candidates[Math.floor(Math.random() * candidates.length)];
      const pickLand = room.lands.find((l) => l.id === pickId);
      if (!pickLand) break;

      const pickLandOwner = room.players.find((p) => p.socketId === pickLand.ownerId);
      if (pickLandOwner) {
        const idx2 = pickLandOwner.lands.indexOf(pickId);
        if (idx2 > -1) pickLandOwner.lands.splice(idx2, 1);
      }
      pickLand.ownerId = socketId;
      attacker.lands.push(pickId);
      conqueredIds.push(pickId);
      attacker.gold += REWARD_GOLD_PER;
      totalReward += REWARD_GOLD_PER;
      // 取消士气和生产力的关联：连锁占领敌方领地也不再增加生产力
      // 连锁占领首都也算灭亡
      if (pickLandOwner && pickLandOwner.capitalId === pickId) {
        pickLandOwner.isAlive = false;
        pickLandOwner.gold = 0;
        pickLandOwner.resources = 0;
        pickLandOwner.lands.forEach((id) => {
          if (id !== pickId) {
            const l = room.lands.find((land) => land.id === id);
            if (l) {
              l.ownerId = null;
              l.hasNPC = true;
            }
          }
        });
        pickLandOwner.lands = [];
        this.io.to(roomId).emit('playerEliminated', {
          playerId: pickLandOwner.socketId,
          reason: `首都被${attacker.name}攻占`,
        });
        if (pickLandOwner.socketId === defenderId0) break;
      } else if (pickLandOwner && pickLandOwner.lands.length === 0) {
        pickLandOwner.isAlive = false;
        pickLandOwner.gold = 0;
        pickLandOwner.resources = 0;
        this.io.to(roomId).emit('playerEliminated', {
          playerId: pickLandOwner.socketId,
          reason: `被${attacker.name}消灭`,
        });
        this.io.to(roomId).emit('systemMessage', {
          message: `${pickLandOwner.name}被${attacker.name}消灭了！`,
        });
        if (pickLandOwner.socketId === defenderId0) break;
      }
    }

    // ------ 主目标是否为首都（首都灭亡→分裂成新 AI 国家）------
    if (primaryIsCapital) {
      defender.isAlive = false;
      defender.gold = 0;
      defender.resources = 0;
      // 原玩家剩余领地（不含已被占领的格子）
      const remainingLands = defender.lands.filter((id) => !conqueredIds.includes(id));

      // 关键修复：检查除了被淘汰的 defender 之外，还有多少存活玩家。
      // 若 ≤1（即 defender 被淘汰后场上只剩 0 或 1 个存活玩家），
      // 说明这是决定性的一击，不应再分裂新 AI 国家阻碍游戏结束；
      // 剩余领地直接化为中立地，由后续 checkGameEnd 判定胜负。
      // 仅当场上仍有 ≥2 个其他存活玩家时，分裂新国家才有意义（增加博弈复杂度）。
      const aliveExcludingDefender = room.players.filter(
        (p) => p.isAlive && p.socketId !== defender.socketId
      ).length;
      if (aliveExcludingDefender <= 1) {
        // 决定性一击：剩余领地直接变中立，不分裂新国家
        for (const landId of remainingLands) {
          const land = room.lands.find((l) => l.id === landId);
          if (land) {
            land.ownerId = null;
            land.hasNPC = true;
          }
        }
        this.io.to(roomId).emit('systemMessage', {
          message: `${defender.name} 首都失守，剩余 ${remainingLands.length} 块领地化为中立地，彻底灭亡。`,
        });
      } else {
        // 分裂成 1-2 个新 AI 国家
        this.splitIntoNewNations(room, defender, remainingLands);
      }
      defender.lands = [];
      this.io.to(roomId).emit('playerEliminated', {
        playerId: defender.socketId,
        reason: `首都被${attacker.name}攻占`,
      });
    } else if (defender.lands.length === 0) {
      defender.isAlive = false;
      defender.gold = 0;
      defender.resources = 0;
      this.io.to(roomId).emit('playerEliminated', {
        playerId: defender.socketId,
        reason: `被${attacker.name}消灭`,
      });
      this.io.to(roomId).emit('systemMessage', {
        message: `${defender.name}被${attacker.name}消灭了！`,
      });
    }

    if (primaryIsCapital) {
      this.io.to(roomId).emit('systemMessage', {
        message:
          `${attacker.name}${payDesc}攻占了${defender.name}的首都#${landId}！` +
          (conqueredIds.length > 1
            ? `士气连锁占领敌方土地#${conqueredIds.filter((x) => x !== landId).join(',#')}！`
            : '') +
          `共 ${conqueredIds.length} 块。累计花费${totalGoldPaid}金币${
            moralePaid ? `+${moralePaid}士气` : ''
          }，奖励${totalReward}金币。${defender.name}灭亡！`,
      });
      this.broadcastGameState(room);
      this.checkGameEnd(room);
      return { success: true };
    }

    this.io.to(roomId).emit('systemMessage', {
      message:
        `${attacker.name}${payDesc}占领${defender.name}的土地#${landId}成功！` +
        (conqueredIds.length > 1
          ? `士气连锁占领 ${conqueredIds.length - 1} 块敌方土地：#${conqueredIds
              .filter((x) => x !== landId)
              .join(',#')}。`
          : '') +
        `累计花费${totalGoldPaid}金币${moralePaid ? `+${moralePaid}士气` : ''}，奖励${totalReward}金币。`,
    });

    this.broadcastGameState(room);
    this.checkGameEnd(room);
    return { success: true };
  }

  /**
   * 飞艇攻击：可攻击地图上任意格子，但不能攻击敌方首都或敌方首都相邻的格子。
   * - 无人 NPC 格：直接占领（无需金币，不触发 CD）
   * - 敌方非首都格：夺取该格，消耗 3000 金币，奖励 5000 金币，生产力 +1（与普通 attackLand 一致但不要求相邻）
   * - 敌方首都格 / 敌方首都相邻格：拒绝
   * - 自己的格子：拒绝
   */
  airshipAttack(socketId: string, roomId: string, landId: number): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const attacker = room.players.find((p) => p.socketId === socketId);
    if (!attacker || !attacker.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    const land = room.lands.find((l) => l.id === landId);
    if (!land) {
      return { success: false, error: '土地不存在' };
    }

    // 不能攻击自己的格子
    if (land.ownerId === socketId) {
      return { success: false, error: '不能攻击自己的领土' };
    }

    // 如果是敌方拥有的格子，检查是否为首都或首都相邻格
    if (land.ownerId && land.ownerId !== socketId) {
      const defender = room.players.find((p) => p.socketId === land.ownerId);
      if (defender && defender.capitalId !== null) {
        // 首都本身
        if (landId === defender.capitalId) {
          return { success: false, error: '飞艇不能攻击敌方首都' };
        }
        // 首都相邻的格子
        const capLand = room.lands.find((l) => l.id === defender.capitalId);
        if (capLand && capLand.adjacentLands.includes(landId)) {
          return { success: false, error: '飞艇不能攻击敌方首都周围的格子' };
        }
      }
    }

    // ---- 执行攻击 ----
    if (!land.ownerId) {
      // 无人 NPC 格：直接占领，不消耗金币，不触发 CD
      land.ownerId = socketId;
      land.hasNPC = false;
      attacker.lands.push(landId);
      this.io.to(roomId).emit('systemMessage', {
        message: `🛩️ ${attacker.name} 的飞艇空投占领了土地 ${landId}！`,
      });
    } else {
      // 敌方非首都格：夺取
      const defender = room.players.find((p) => p.socketId === land.ownerId);
      if (!defender) return { success: false, error: '目标玩家不存在' };

      // 护盾检查：目标玩家处于护盾期 → 拒绝飞艇攻击
      if (this.isPlayerShielded(defender)) {
        return { success: false, error: `${defender.name} 已开启护盾，2 分钟内无法攻击其领地` };
      }

      // 消耗 3000 金币（与普通 attackLand 一致）
      if (attacker.gold < GAME_CONSTANTS.OCCUPY_ENEMY_COST_GOLD) {
        return { success: false, error: '金币不足，飞艇攻击需要 3000 金币' };
      }
      attacker.gold -= GAME_CONSTANTS.OCCUPY_ENEMY_COST_GOLD;

      // 从防守者领土移除
      defender.lands = defender.lands.filter((id) => id !== landId);
      land.ownerId = socketId;
      attacker.lands.push(landId);

      // 奖励 5000 金币 + 生产力 +1
      attacker.gold += GAME_CONSTANTS.OCCUPY_ENEMY_FIXED_REWARD_GOLD;
      attacker.productivity += 1;

      this.io.to(roomId).emit('systemMessage', {
        message: `🛩️ ${attacker.name} 的飞艇轰炸夺取了 ${defender.name} 的土地 ${landId}！获得 5000 金币，生产力 +1。`,
      });

      // 关键修复：检查防守者是否因此失去所有领地 → 淘汰
      // 否则会出现 isAlive=true 但 lands=[] 的"假活"玩家，
      // 导致地图上看不到该玩家但状态栏仍显示存活，且游戏无法正确结束
      if (defender.lands.length === 0) {
        defender.isAlive = false;
        defender.gold = 0;
        defender.resources = 0;
        this.io.to(roomId).emit('playerEliminated', {
          playerId: defender.socketId,
          reason: `被${attacker.name}的飞艇消灭`,
        });
        this.io.to(roomId).emit('systemMessage', {
          message: `${defender.name}被${attacker.name}的飞艇消灭了！`,
        });
      }
    }

    this.broadcastGameState(room);
    // 关键修复：飞艇攻击可能导致玩家被淘汰，必须检查游戏是否结束
    this.checkGameEnd(room);
    return { success: true };
  }

  /**
   * 使用护盾道具（需在商城购买 'shield'）：
   * - 启用后 2 分钟内，敌方无法对本方任何领地发起 attackLand / airshipAttack / attackPlayer
   * - 本方仍可正常攻击敌方（护盾只防御，不影响进攻）
   * - 同一道具用一次即消耗；护盾未结束时再次使用会刷新时间
   */
  useShield(socketId: string, roomId: string): { success: boolean; error?: string; remainMs?: number } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }
    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }
    const DURATION = 2 * 60 * 1000; // 2 分钟
    const now = Date.now();
    player.shieldUntil = now + DURATION;
    this.io.to(roomId).emit('systemMessage', {
      message: `🛡️ ${player.name} 启动了护盾！2 分钟内其领地免疫敌方攻击。`,
    });
    this.broadcastGameState(room);
    return { success: true, remainMs: DURATION };
  }

  // 检查某玩家当前是否处于护盾保护期内
  private isPlayerShielded(player: Player): boolean {
    return player.shieldUntil > Date.now();
  }

  /**
   * 使用指导导弹道具（需在商城购买 'guided_missile'）：
   * - 一次性随机毁灭约 20 个敌方格子（变为 NPC 中立地）
   * - 不会攻击：自己的领地、任何玩家的首都、首都相邻格、处于护盾期的玩家领地
   * - 被毁灭的格子从原 owner 的 lands 中移除，原 owner 不获得任何补偿
   * - 若某玩家因导弹失去所有领地 → 淘汰
   */
  useGuidedMissile(
    socketId: string,
    roomId: string
  ): { success: boolean; error?: string; destroyedCount?: number } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }
    const attacker = room.players.find((p) => p.socketId === socketId);
    if (!attacker || !attacker.isAlive) {
      return { success: false, error: '玩家不存在或已淘汰' };
    }

    // 40% 失误率：失误时导弹打偏，随机毁灭自己 20 个格子（排除首都，避免直接灭国）
    // 60% 成功率：正常打击敌方格子
    const MISFIRE_RATE = 0.4;
    const isMisfire = Math.random() < MISFIRE_RATE;

    // 筛选可攻击目标
    const validTargets: number[] = [];
    if (isMisfire) {
      // 失误：目标为自己除首都外的所有领地
      for (const landId of attacker.lands) {
        if (attacker.capitalId !== null && landId === attacker.capitalId) continue;
        validTargets.push(landId);
      }
    } else {
      // 成功：目标为敌方非首都、非首都相邻、非护盾期的领地
      for (const land of room.lands) {
        if (!land.ownerId) continue; // NPC 地不可被导弹攻击
        if (land.ownerId === socketId) continue; // 不打自己
        const owner = room.players.find((p) => p.socketId === land.ownerId);
        if (!owner || !owner.isAlive) continue;
        // 护盾期玩家领地免疫
        if (this.isPlayerShielded(owner)) continue;
        // 排除首都
        if (owner.capitalId !== null && land.id === owner.capitalId) continue;
        // 排除首都相邻格
        if (owner.capitalId !== null) {
          const capLand = room.lands.find((l) => l.id === owner.capitalId);
          if (capLand && capLand.adjacentLands.includes(land.id)) continue;
        }
        validTargets.push(land.id);
      }
    }

    if (validTargets.length === 0) {
      return {
        success: false,
        error: isMisfire
          ? '发射失误！但你没有可毁灭的自身领地（仅剩首都）'
          : '地图上没有可攻击的目标（敌方可能开启了护盾）',
      };
    }

    // 随机选取约 20 个目标（不够则全部）
    const TARGET_COUNT = 20;
    const count = Math.min(TARGET_COUNT, validTargets.length);
    // Fisher-Yates 洗牌取前 count 个
    const shuffled = [...validTargets];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const targets = shuffled.slice(0, count);

    // 执行毁灭：目标格变回 NPC 中立地
    for (const landId of targets) {
      const land = room.lands.find((l) => l.id === landId);
      if (!land || !land.ownerId) continue;
      const owner = room.players.find((p) => p.socketId === land.ownerId);
      if (owner) {
        const idx = owner.lands.indexOf(landId);
        if (idx > -1) owner.lands.splice(idx, 1);
      }
      land.ownerId = null;
      land.hasNPC = true;
    }

    if (isMisfire) {
      // 失误：毁灭了自己 20 个格子
      this.io.to(roomId).emit('systemMessage', {
        message: `💥 ${attacker.name} 的指导导弹发射失误！误炸了自己 ${count} 个格子！`,
      });
      // 检查攻击者是否因此被消灭（损失所有非首都领地且无地可守）
      if (attacker.lands.length === 0) {
        attacker.isAlive = false;
        attacker.gold = 0;
        attacker.resources = 0;
        this.io.to(roomId).emit('playerEliminated', {
          playerId: attacker.socketId,
          reason: `自己的指导导弹发射失误，领地全毁`,
        });
        this.io.to(roomId).emit('systemMessage', {
          message: `${attacker.name} 因指导导弹发射失误，领地全毁，灭亡！`,
        });
      }
    } else {
      // 成功：毁灭了敌方格子
      let eliminatedCount = 0;
      for (const p of room.players) {
        if (p.socketId === socketId) continue;
        if (p.isAlive && p.lands.length === 0) {
          p.isAlive = false;
          p.gold = 0;
          p.resources = 0;
          eliminatedCount++;
          this.io.to(roomId).emit('playerEliminated', {
            playerId: p.socketId,
            reason: `被${attacker.name}的指导导弹毁灭`,
          });
          this.io.to(roomId).emit('systemMessage', {
            message: `${p.name}被${attacker.name}的指导导弹毁灭！`,
          });
        }
      }
      this.io.to(roomId).emit('systemMessage', {
        message:
          `🚀 ${attacker.name} 发射了指导导弹！毁灭了 ${count} 个敌方格子！` +
          (eliminatedCount > 0 ? ` ${eliminatedCount} 名玩家被消灭！` : ''),
      });
    }

    this.broadcastGameState(room);
    this.checkGameEnd(room);
    return { success: true, destroyedCount: count };
  }

  attackPlayer(socketId: string, roomId: string, targetSocketId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') {
      return { success: false, error: '游戏未开始' };
    }

    const attacker = room.players.find((p) => p.socketId === socketId);
    const target = room.players.find((p) => p.socketId === targetSocketId);

    if (!attacker || !attacker.isAlive) {
      return { success: false, error: '攻击者不存在或已淘汰' };
    }
    if (!target || !target.isAlive) {
      return { success: false, error: '目标不存在或已淘汰' };
    }

    // 护盾检查：目标处于护盾期 → 拒绝对该玩家整体进攻
    if (this.isPlayerShielded(target)) {
      return { success: false, error: `${target.name} 已开启护盾，2 分钟内无法攻击` };
    }

    const cdCheck = this.checkOccupyCooldown(attacker, room);
    if (!cdCheck.ok) return { success: false, error: cdCheck.error };

    // 检查是否相邻（至少有一块自己的领地与目标相邻）
    const hasAdjacentLand = attacker.lands.some((attLandId) => {
      const attLand = room.lands.find((l) => l.id === attLandId);
      if (!attLand) return false;
      return target.lands.some((tgtLandId) => attLand.adjacentLands.includes(tgtLandId));
    });

    if (!hasAdjacentLand) {
      return { success: false, error: '与目标不相邻，无法攻击' };
    }

    this.resetOccupyCooldown(attacker);

    // 占领目标所有数值
    attacker.gold += target.gold;
    attacker.resources += target.resources;
    attacker.technology += target.technology;
    attacker.productivity += target.productivity;
    attacker.lands.push(...target.lands);

    // 更新土地的拥有者
    target.lands.forEach((landId) => {
      const land = room.lands.find((l) => l.id === landId);
      if (land) {
        land.ownerId = socketId;
      }
    });

    target.isAlive = false;
    target.gold = 0;
    target.resources = 0;
    target.lands = [];

    // 全图播报：XX 杀掉了 XX
    this.io.to(roomId).emit('systemMessage', {
      message: `⚔️ ${attacker.name} 杀掉了 ${target.name}！`,
    });
    this.io.to(roomId).emit('playerEliminated', {
      playerId: targetSocketId,
      reason: `被${attacker.name}消灭`,
    });
    this.broadcastGameState(room);

    // 检查游戏是否结束
    // - 2 人局/剩余 1 人：checkGameEnd 会自动 endGame（赢家=attacker，全员收到 gameOver）
    // - 多人局（剩余 ≥2 人）：给被灭者本人单独发 gameOver（endReason=killed），
    //   其屏幕立即显示"我输了"，其他人继续游戏
    const aliveAfter = room.players.filter((p) => p.isAlive);
    if (aliveAfter.length <= 1) {
      // 走正常 checkGameEnd：endGame(winner, endReason=elimination)
      this.checkGameEnd(room);
    } else {
      // 多人局：被灭者本人收到"我输了"
      const loserRankings = this.buildRankings(room);
      this.io.to(targetSocketId).emit('gameOver', {
        winner: null,
        winnerSocketId: null,
        loserSocketIds: [targetSocketId],
        isDraw: false,
        endReason: 'killed',
        killedBy: attacker.name,
        rankings: loserRankings,
      });
      // 游戏继续，不 endGame
    }

    return { success: true };
  }

  leaveRoom(socketId: string, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const playerIndex = room.players.findIndex((p) => p.socketId === socketId);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];
    const wasPlaying = room.gameStatus === 'playing' && player.isAlive;

    // ========== 游戏进行中主动退出 / 断线 → 直接判该玩家失败 ==========
    if (wasPlaying) {
      // 先把该玩家标记为淘汰（领土归还 NPC，与 eliminatePlayer 行为一致）
      player.isAlive = false;
      player.lands.forEach((landId) => {
        const land = room.lands.find((l) => l.id === landId);
        if (land) {
          land.ownerId = null;
          land.hasNPC = true;
        }
      });
      player.lands = [];
      player.capitalId = null;

      // 1) 对退出者本人单独发 gameOver："我输了"
      const loserRanking = this.buildRankings(room);
      this.io
        .to(socketId)
        .emit('gameOver', {
          winner: null,
          winnerSocketId: null,
          loserSocketIds: [socketId],
          isDraw: false,
          endReason: 'disconnected_lost',
          rankings: loserRanking,
        });

      // 2) 通知场上所有人谁退出并判负
      this.io
        .to(roomId)
        .emit('systemMessage', {
          message: `【${player.name}】中途退出了游戏，判负出局，其领土已化为NPC。`,
        });

      // 3) 若退出后只剩 1 人，则全局结束（剩下的那 1 人直接赢）
      const alive = room.players.filter((p) => p.isAlive);
      if (alive.length <= 1) {
        room.players.splice(playerIndex, 1);
        this.playerRoomMap.delete(socketId);
        // 切回正常 checkGameEnd：它会处理剩下 0/1 人、endGame、room cleanup
        if (alive.length === 1) {
          this.endGame(room, alive[0].name, alive[0].socketId, false, 'elimination');
        } else {
          // 没人了直接平局
          this.endGame(room, null, null, true, 'empty');
        }
        // 提前 return，防止下面 splice / delete 重复
        return;
      }

      // 4) 否则游戏继续（仅更新其他人 state，不要 ended）
      this.broadcastGameState(room);
    }

    // 从 players 列表移除，下面是原本逻辑（waiting 等照常执行）
    room.players.splice(playerIndex, 1);
    this.io.to(roomId).emit('playerLeft', { playerId: socketId, playerName: player.name });

    // 如果是房主离开，转移房主
    if (player.isHost && room.players.length > 0) {
      room.players[0].isHost = true;
    }

    // 如果房间空了，延迟30秒后删除房间（给重连机会）
    if (room.players.length === 0) {
      if (room.gameLoopInterval) {
        clearInterval(room.gameLoopInterval);
      }
      if (room.aiLoopInterval) {
        clearInterval(room.aiLoopInterval);
      }

      const timer = setTimeout(() => {
        const currentRoom = this.rooms.get(roomId);
        if (currentRoom && currentRoom.players.length === 0) {
          this.rooms.delete(roomId);
          this.roomCleanupTimers.delete(roomId);
        }
      }, 30000);

      this.roomCleanupTimers.set(roomId, timer);
    } else {
      // 如果还有玩家，清除之前的清理计时器
      const existingTimer = this.roomCleanupTimers.get(roomId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.roomCleanupTimers.delete(roomId);
      }
    }

    this.playerRoomMap.delete(socketId);
  }

  handleDisconnect(socketId: string): void {
    const roomId = this.playerRoomMap.get(socketId);
    if (roomId) {
      this.leaveRoom(socketId, roomId);
    }
  }

  private runGameLoop(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.gameStatus !== 'playing') return;

    // 减少时间
    room.timeRemaining -= 1;

    // 士气产金计时
    if (typeof room.moraleGoldTick !== 'number') room.moraleGoldTick = 0;
    room.moraleGoldTick += 1;
    const doMoraleGoldTick =
      room.moraleGoldTick >= GAME_CONSTANTS.MORALE_TICK_GOLD_EVERY;
    if (doMoraleGoldTick) room.moraleGoldTick = 0;

    // 资源生产 + 士气产金（每 MORALE_TICK_GOLD_EVERY 秒结算一次）
    const moraleGoldLogs: string[] = [];
    room.players.forEach((player) => {
      if (player.isAlive) {
        player.resources += player.productivity;
        if (doMoraleGoldTick && player.morale > 0 && player.lands.length > 0) {
          const gain =
            player.morale *
            player.lands.length *
            GAME_CONSTANTS.MORALE_GOLD_PER_LAND_PER_LEVEL;
          if (gain > 0) {
            player.gold += gain;
            moraleGoldLogs.push(`${player.name}+${gain}`);
          }
        }
      }
    });
    if (moraleGoldLogs.length > 0) {
      this.io.to(roomId).emit('systemMessage', {
        message:
          `💪 士气产金（每${GAME_CONSTANTS.MORALE_TICK_GOLD_EVERY}秒）：` +
          moraleGoldLogs.join('；'),
      });
    }

    // NPC攻击检测
    room.players.forEach((player) => {
      if (player.isAlive && player.technology > GAME_CONSTANTS.NPC_ATTACK_TECH_THRESHOLD) {
        if (this.checkNPCAttack(player, room)) {
          this.triggerNPCAttack(player, room);
        }
      }
    });

    // 幽灵玩家检测（双保险）：每秒检查一次，捕获所有遗漏淘汰检查的代码路径。
    // 如果玩家 isAlive=true 但在地图上一块地都没有，说明是"假活"状态，必须淘汰。
    // 注意：仅在游戏进行中生效（runGameLoop 本应只在 playing 状态下运行，此处加保险）。
    let hasGhostPlayer = false;
    if (room.gameStatus === 'playing') {
      for (const p of room.players) {
        if (p.isAlive) {
          const actualLandCount = room.lands.filter((l) => l.ownerId === p.socketId).length;
          if (actualLandCount === 0) {
            // 地图上确实没有该玩家的领地 → 假活，淘汰
            p.isAlive = false;
            p.gold = 0;
            p.resources = 0;
            hasGhostPlayer = true;
            this.io.to(roomId).emit('playerEliminated', {
              playerId: p.socketId,
              reason: `领地全失，国家覆灭`,
            });
            this.io.to(roomId).emit('systemMessage', {
              message: `${p.name} 领地全失，国家覆灭！`,
            });
          } else if (p.lands.length !== actualLandCount) {
            // lands 数组与地图实际不符（可能漏移除/漏添加），修正 lands 数组
            p.lands = room.lands.filter((l) => l.ownerId === p.socketId).map((l) => l.id);
          }
        }
      }
    }

    // 国家灭亡检测 + 物资低提醒
    room.players.forEach((player) => {
      if (player.isAlive) {
        // 物资低于10但不低于5，提醒一次
        if (player.resources < 10 && player.resources >= GAME_CONSTANTS.ELIMINATION_RESOURCES_THRESHOLD) {
          if (!this.lowResourceWarned.has(player.socketId)) {
            this.lowResourceWarned.add(player.socketId);
            this.io.to(roomId).emit('systemMessage', {
              message: `⚠️ ${player.name}的物资即将耗尽（当前: ${player.resources.toFixed(1)}），低于5将灭亡！请尽快兑换或提升生产力！`,
            });
          }
        } else if (player.resources >= 10) {
          // 物资恢复后清除提醒标记
          this.lowResourceWarned.delete(player.socketId);
        }

        if (player.gold < GAME_CONSTANTS.ELIMINATION_GOLD_THRESHOLD) {
          this.eliminatePlayer(player, room, '金币不足');
        } else if (player.resources < GAME_CONSTANTS.ELIMINATION_RESOURCES_THRESHOLD) {
          this.lowResourceWarned.delete(player.socketId);
          this.eliminatePlayer(player, room, '物资不足');
        }
      }
    });

    // 胜负检测
    const alivePlayers = room.players.filter((p) => p.isAlive);
    if (alivePlayers.length === 1) {
      this.endGame(room, alivePlayers[0].name, alivePlayers[0].socketId, false, 'elimination');
      return;
    }
    if (room.timeRemaining <= 0) {
      // 时间耗尽且多人存活 → 平局
      this.endGame(room, null, null, true, 'timeup');
      return;
    }

    // 新系统：季节切换
    this.checkSeasonChange(room);

    // 新系统：胜利条件检查
    const victoryWinner = this.checkVictory(room);
    if (victoryWinner) {
      const winner = room.players.find(p => p.socketId === victoryWinner);
      if (winner) {
        this.endGame(room, winner.name, winner.socketId, false, 'victory');
        return;
      }
    }

    this.broadcastGameState(room);
  }

  private checkNPCAttack(player: Player, room: Room): boolean {
    const playerLands = room.lands.filter((l) => player.lands.includes(l.id));
    return playerLands.some((land) =>
      land.adjacentLands.some((adjId) => {
        const adjLand = room.lands.find((l) => l.id === adjId);
        return adjLand && adjLand.hasNPC && adjLand.ownerId === null;
      })
    );
  }

  private triggerNPCAttack(player: Player, room: Room): void {
    // 随机损失
    const goldLoss = Math.floor(Math.random() * 500) + 100;
    const resourcesLoss = Math.floor(Math.random() * 5) + 1;

    player.gold = Math.max(0, player.gold - goldLoss);
    player.resources = Math.max(0, player.resources - resourcesLoss);

    this.io.to(room.id).emit('npcAttack', {
      playerId: player.socketId,
      damage: { gold: goldLoss, resources: resourcesLoss },
      message: `${player.name}遭到了NPC攻击！损失${goldLoss}金币和${resourcesLoss}物资`,
    });
  }

  private eliminatePlayer(player: Player, room: Room, reason: string): void {
    player.isAlive = false;
    player.lands.forEach((landId) => {
      const land = room.lands.find((l) => l.id === landId);
      if (land) {
        land.ownerId = null;
        land.hasNPC = true;
      }
    });
    player.lands = [];

    this.io.to(room.id).emit('playerEliminated', {
      playerId: player.socketId,
      reason,
    });
    this.io.to(room.id).emit('systemMessage', {
      message: `${player.name}因${reason}而灭亡！`,
    });
  }

  private buildRankings(room: Room): { name: string; isAlive: boolean; lands: number; gold: number }[] {
    return room.players
      .map((p) => ({
        name: p.name,
        isAlive: p.isAlive,
        lands: p.lands.length,
        gold: p.gold,
      }))
      .sort((a, b) => {
        if (a.isAlive !== b.isAlive) return b.isAlive ? 1 : -1;
        return b.lands - a.lands;
      });
  }

  private checkGameEnd(room: Room): void {
    const alivePlayers = room.players.filter((p) => p.isAlive);
    if (alivePlayers.length === 1) {
      this.endGame(room, alivePlayers[0].name, alivePlayers[0].socketId, false, 'elimination');
    }
  }

  private endGame(
    room: Room,
    winner: string | null,
    winnerSocketId: string | null,
    isDraw: boolean,
    endReason: 'timeup' | 'elimination' | 'empty' | 'disconnected_lost' | 'killed' | 'victory'
  ): void {
    room.gameStatus = 'ended';
    if (room.gameLoopInterval) {
      clearInterval(room.gameLoopInterval);
    }
    // 清理 AI 决策循环
    if (room.aiLoopInterval) {
      clearInterval(room.aiLoopInterval);
    }

    const rankings = this.buildRankings(room);
    const loserSocketIds = room.players.filter((p) => {
      // 赢家不是输家；平局全员都不算输家（无胜者）；其他情况非活者即输家
      if (winnerSocketId && p.socketId === winnerSocketId) return false;
      return true;
    }).map((p) => p.socketId);

    this.io.to(room.id).emit('gameOver', {
      winner,
      winnerSocketId,
      loserSocketIds,
      isDraw,
      endReason,
      rankings,
    });

    // 直接给赢家发系统货币奖励（不依赖前端 playerId 匹配，更可靠）
    // 赢家是真人（非 ai_ 开头）且非平局时，发 10 系统货币
    if (!isDraw && winnerSocketId && !winnerSocketId.startsWith('ai_')) {
      this.io.to(winnerSocketId).emit('currencyReward', {
        amount: 10,
        reason: '游戏胜利奖励',
      });
    }
  }

  private initializeLands(): Land[] {
    const lands: Land[] = [];
    for (let i = 0; i < GAME_CONSTANTS.TOTAL_LANDS; i++) {
      lands.push({
        id: i,
        ownerId: null,
        hasNPC: true,
        adjacentLands: LAND_ADJACENCY[i] || [],
      });
    }

    return lands;
  }

  private assignInitialLands(room: Room): void {
    // 开局分配：所有格子均可作为初始领地
    const allLands = Array.from({ length: GAME_CONSTANTS.TOTAL_LANDS }, (_, i) => i);
    const assigned: number[] = [];
    const INITIAL_LANDS_PER_PLAYER = 3; // 每人开局 3 块地

    // BFS 计算从 start 到所有格子的最短六边形距离
    const bfsDistances = (start: number): number[] => {
      const dist = new Array(GAME_CONSTANTS.TOTAL_LANDS).fill(Infinity);
      dist[start] = 0;
      const queue: number[] = [start];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const neighbors = LAND_ADJACENCY[cur] || [];
        for (const nb of neighbors) {
          if (dist[nb] === Infinity) {
            dist[nb] = dist[cur] + 1;
            queue.push(nb);
          }
        }
      }
      return dist;
    };

    // 缓存：每个已分配格子到所有格子的距离（开局一次 BFS 即可，地图只有 100 格）
    const distCache = new Map<number, number[]>();
    const getDist = (a: number, b: number): number => {
      let cache = distCache.get(a);
      if (!cache) {
        cache = bfsDistances(a);
        distCache.set(a, cache);
      }
      return cache[b];
    };

    // 给定候选 landId，返回它与所有"已分配地块"之间的最小距离
    // （assigned 为空时返回 Infinity，表示无约束）
    const minDistanceToAssigned = (landId: number): number => {
      if (assigned.length === 0) return Infinity;
      let min = Infinity;
      for (const aid of assigned) {
        const d = getDist(aid, landId);
        if (d < min) min = d;
      }
      return min;
    };

    for (const player of room.players) {
      for (let block = 0; block < INITIAL_LANDS_PER_PLAYER; block++) {
        // 检查一块地是否与该玩家已有的地相邻（用于第 2/3 块地的紧挨判断）
        const isAdjacentToMyLands = (landId: number): boolean => {
          if (player.lands.length === 0) return false;
          return player.lands.some((myLandId) => {
            const adj = LAND_ADJACENCY[myLandId] || [];
            return adj.includes(landId);
          });
        };

        // 该玩家已分配过其他玩家时的"他人领地集合"= assigned
        // 注意：assigned 不包含当前玩家自己刚分到的地（因为 push 时机）
        const othersAssigned = assigned; // 当前玩家之前玩家的所有地

        let landId: number | null = null;

        if (block === 0) {
          // 首块地（首都）：尽量远离他人
          // 要求与已分配地距离 ≥ 6（2 人地图有 100 格，足够拉远）
          const unassigned = allLands.filter((id) => !assigned.includes(id));
          const dists = unassigned.map((id) => ({ id, d: minDistanceToAssigned(id) }));
          let pool = dists.filter((x) => x.d >= 6).map((x) => x.id);
          if (pool.length === 0) pool = dists.filter((x) => x.d >= 4).map((x) => x.id);
          if (pool.length === 0) pool = dists.filter((x) => x.d >= 3).map((x) => x.id);
          if (pool.length === 0) pool = dists.filter((x) => x.d >= 2).map((x) => x.id);
          if (pool.length === 0) pool = unassigned; // fallback
          landId = pool[Math.floor(Math.random() * pool.length)];
        } else {
          // 第 2/3 块地：必须紧挨自己的已有领地（确保3块地连在一起，不分散）
          let adjacentPool = allLands.filter(
            (id) => !assigned.includes(id) && isAdjacentToMyLands(id) && minDistanceToAssigned(id) >= 3
          );
          // fallback：紧挨自己 + 距离他人 ≥ 2
          if (adjacentPool.length === 0) {
            adjacentPool = allLands.filter(
              (id) => !assigned.includes(id) && isAdjacentToMyLands(id) && minDistanceToAssigned(id) >= 2
            );
          }
          // fallback：紧挨自己 + 不与他人直接相邻（距离 ≥ 1）
          if (adjacentPool.length === 0) {
            adjacentPool = allLands.filter(
              (id) => !assigned.includes(id) && isAdjacentToMyLands(id) && minDistanceToAssigned(id) >= 1
            );
          }
          // 最后兜底：只要紧挨自己就行（极端情况，避免开局失败）
          if (adjacentPool.length === 0) {
            adjacentPool = allLands.filter((id) => !assigned.includes(id) && isAdjacentToMyLands(id));
          }
          // 最终兜底：放宽到"距离自己领地2格内"的未分配地，仍然保证开局3块地聚在一起，绝不随机飞到远处
          if (adjacentPool.length === 0) {
            adjacentPool = allLands.filter((id) => {
              if (assigned.includes(id)) return false;
              return player.lands.some((myLandId) => getDist(myLandId, id) <= 2);
            });
          }
          if (adjacentPool.length === 0) {
            adjacentPool = allLands.filter((id) => !assigned.includes(id));
          }
          landId = adjacentPool[Math.floor(Math.random() * adjacentPool.length)];
          void othersAssigned; // 已通过 minDistanceToAssigned(assigned) 使用
        }

        const land = room.lands.find((l) => l.id === landId);
        if (land) {
          land.ownerId = player.socketId;
          land.hasNPC = false;
          player.lands.push(landId);
          if (block === 0) {
            player.capitalId = landId;
          }
          assigned.push(landId);
        }
      }
    }
  }

  private createPlayer(socketId: string, name: string, isHost: boolean): Player {
    return {
      id: `player_${socketId}`,
      socketId,
      name,
      isReady: false,
      isAlive: true,
      isHost,
      gold: GAME_CONSTANTS.INITIAL_GOLD,
      resources: GAME_CONSTANTS.INITIAL_RESOURCES,
      technology: GAME_CONSTANTS.INITIAL_TECH,
      productivity: GAME_CONSTANTS.INITIAL_PRODUCTIVITY,
      morale: 1,
      lands: [],
      capitalId: null,
      color: '',
      lastOccupyActionAt: 0,
      shieldUntil: 0,
      hasteUntil: 0,
    };
  }

  // ---------- 占领类动作共享 CD ----------
  // 成功后调用 resetCooldown 重置；失败（金币不足/不相邻等）不扣 CD。
  // 迅捷药水生效期间：CD 降为 0.2 秒（HASTE_COOLDOWN_MS）
  private static readonly HASTE_COOLDOWN_MS = 200; // 0.2 秒
  private static readonly HASTE_DURATION_MS = 60 * 1000; // 1 分钟
  private static readonly WALL_COOLDOWN_MS = 700; // 0.7 秒（城墙惩罚：使用城墙后占领变慢）
  // AI 难度 CD（仅 1v1 人机对战模式）：中等 0.3 秒 / 困难 0.1 秒（普通用默认 0.5 秒）
  private static readonly AI_MEDIUM_COOLDOWN_MS = 300;
  private static readonly AI_HARD_COOLDOWN_MS = 100;
  /**
   * 占领动作 CD 检查。
   * AI 优先级：困难(0.1s) > 中等(0.3s) > 普通 AI 走人类规则
   * 人类优先级：迅捷药水(0.2s) > 城墙(0.7s，有任何城墙领地时生效) > 默认(0.5s)
   */
  private checkOccupyCooldown(player: Player, room?: Room): { ok: true } | { ok: false; remainMs: number; error: string } {
    const now = Date.now();
    const isHaste = player.hasteUntil > now;
    let cd: number;
    if (player.isAI && player.aiDifficulty === 'hard') {
      cd = RoomManager.AI_HARD_COOLDOWN_MS;
    } else if (player.isAI && player.aiDifficulty === 'medium') {
      cd = RoomManager.AI_MEDIUM_COOLDOWN_MS;
    } else if (isHaste) {
      cd = RoomManager.HASTE_COOLDOWN_MS;
    } else {
      // 检查玩家是否拥有任何城墙（传了 room 才检查，避免旧调用点没 room 时出错）
      const hasWall =
        !!room &&
        room.lands.some((l) => l.ownerId === player.socketId && l.walled);
      cd = hasWall ? RoomManager.WALL_COOLDOWN_MS : GAME_CONSTANTS.OCCUPY_ACTION_COOLDOWN_MS;
    }
    const remain = player.lastOccupyActionAt + cd - now;
    if (remain > 0) {
      const sec = (remain / 1000).toFixed(1);
      return {
        ok: false,
        remainMs: remain,
        error: `操作太快啦，占领冷却还剩 ${sec} 秒${isHaste ? '(加速中)' : ''}`,
      };
    }
    return { ok: true };
  }
  private resetOccupyCooldown(player: Player): void {
    player.lastOccupyActionAt = Date.now();
  }

  // ---------- 迅捷药水 ----------
  // 使用后 1 分钟内占领 CD 降为 0.2 秒
  useHaste(socketId: string, roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在' };
    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) return { success: false, error: '玩家不存在或已淘汰' };
    const now = Date.now();
    player.hasteUntil = now + RoomManager.HASTE_DURATION_MS;
    this.io.to(roomId).emit('systemMessage', {
      message: `⚡${player.name}使用了迅捷药水，1 分钟内占领速度大幅提升！`,
    });
    this.broadcastGameState(room);
    return { success: true };
  }

  // ---------- 城墙 ----------
  // 使用后，玩家当前所有领地（包括首都和首都相邻格）都获得永久城墙保护：
  // 敌人第一次点击占领时只消耗 3000 金币，城墙被破坏，不改变归属；
  // 第二次点击才正常占领，消耗 3000 金币、奖励 5000 金币
  // 注意：使用城墙不保护以后新增的领地
  useWall(socketId: string, roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在' };
    if (room.gameStatus !== 'playing') return { success: false, error: '游戏未开始' };
    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) return { success: false, error: '玩家不存在或已淘汰' };

    let count = 0;
    for (const land of room.lands) {
      if (land.ownerId === player.socketId) {
        land.walled = true;
        count++;
      }
    }

    this.io.to(roomId).emit('systemMessage', {
      message: `🏰${player.name}使用了城墙，为 ${count} 块领地添加了永久城墙保护！（敌方需点击两次才能占领）`,
    });
    this.broadcastGameState(room);
    return { success: true, ...{ count } };
  }

  // ---------- TNT ----------
  // 使用 TNT：选择中心格，中心格及其相邻 6 格爆炸。
  // 规则：
  //   - 若某格有城墙：城墙被破坏（抵一次伤害），该格不变 NPC
  //   - 否则：该格变为 NPC 中立地（ownerId=null, hasNPC=true）
  //   - 若被炸者所有领地被炸光：判定淘汰
  useTNT(
    socketId: string,
    roomId: string,
    centerLandId: number
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在' };
    if (room.gameStatus !== 'playing') return { success: false, error: '游戏未开始' };
    const player = room.players.find((p) => p.socketId === socketId);
    if (!player || !player.isAlive) return { success: false, error: '玩家不存在或已淘汰' };

    const centerLand = room.lands.find((l) => l.id === centerLandId);
    if (!centerLand) return { success: false, error: '目标格不存在' };

    // 构建爆炸范围：中心格 + 相邻格
    const affectedIds = new Set<number>([centerLandId]);
    for (const adjId of centerLand.adjacentLands) affectedIds.add(adjId);

    // 统计：被城墙抵挡数、变 NPC 数
    let wallBlockedCount = 0;
    let npcedCount = 0;
    const affectedOwners = new Set<string>();

    for (const lid of affectedIds) {
      const land = room.lands.find((l) => l.id === lid);
      if (!land) continue;
      if (land.walled) {
        // 城墙抵挡一次 TNT 伤害：移除城墙标记，不变 NPC
        land.walled = false;
        wallBlockedCount++;
        continue;
      }
      // 记录原主人（若有），用于后续从其 lands 中移除
      const origOwnerId = land.ownerId;
      if (origOwnerId) affectedOwners.add(origOwnerId);
      // 变 NPC
      land.ownerId = null;
      land.hasNPC = true;
      land.walled = false;
      npcedCount++;
    }

    // 清理被炸玩家的 lands 数组：移除 landId 已不存在的条目
    for (const ownerId of affectedOwners) {
      const owner = room.players.find((p) => p.socketId === ownerId);
      if (!owner) continue;
      const remaining = owner.lands.filter(
        (id) => {
          const l = room.lands.find((x) => x.id === id);
          return !!l && l.ownerId === ownerId;
        }
      );
      owner.lands = remaining;
      // 领地归零 → 淘汰
      if (remaining.length === 0 && owner.isAlive) {
        owner.isAlive = false;
        owner.gold = 0;
        owner.resources = 0;
        this.io.to(roomId).emit('playerEliminated', {
          playerId: owner.socketId,
          reason: `领地被${player.name}的TNT全部炸毁`,
        });
      }
    }

    this.io.to(roomId).emit('systemMessage', {
      message: `💥${player.name}使用TNT，以格#${centerLandId}为中心引发爆炸：${
        npcedCount > 0 ? `${npcedCount}块领地化为中立NPC` : ''
      }${wallBlockedCount > 0 ? `${npcedCount > 0 ? '，' : ''}${wallBlockedCount}块被城墙抵挡` : ''}。`,
    });

    this.broadcastGameState(room);
    this.checkGameEnd(room);
    return { success: true };
  }

  // ==================== 核能导弹 ====================

  // 使用核能导弹：直接消灭一个国家（所有领地变中立，玩家淘汰）
  // 无视护盾和首都保护
  useNuclearMissile(
    socketId: string,
    roomId: string,
    targetSocketId: string
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在' };
    if (room.gameStatus !== 'playing') return { success: false, error: '游戏未在进行中' };

    const attacker = room.players.find((p) => p.socketId === socketId);
    if (!attacker || !attacker.isAlive) return { success: false, error: '玩家不存在或已淘汰' };

    const target = room.players.find((p) => p.socketId === targetSocketId);
    if (!target) return { success: false, error: '目标国家不存在' };
    if (!target.isAlive) return { success: false, error: '目标国家已被淘汰' };
    if (target.socketId === socketId) return { success: false, error: '不能对自己使用' };

    // 核能导弹无视护盾，直接消灭目标
    // 目标所有领地变中立
    const destroyedLands: number[] = [];
    for (const landId of target.lands) {
      const land = room.lands.find((l) => l.id === landId);
      if (land) {
        land.ownerId = null;
        land.hasNPC = true;
        destroyedLands.push(landId);
      }
    }

    // 目标玩家淘汰
    target.isAlive = false;
    target.gold = 0;
    target.resources = 0;
    target.lands = [];
    target.capitalId = null;
    target.shieldUntil = 0;
    target.hasteUntil = 0;

    // 系统播报
    const targetName = target.name;
    const attackerName = attacker.name;
    const landCount = destroyedLands.length;

    this.io.to(roomId).emit('systemMessage', {
      message: `☢️ ${attackerName} 发射了核能导弹！${targetName} 的 ${landCount} 块领地全部毁灭，国家覆灭！`,
    });

    // 检查游戏结束
    this.broadcastGameState(room);
    this.checkGameEnd(room);
    return { success: true };
  }

  // ==================== 首都灭亡后分裂成新 AI 国家 ====================

  /**
   * 当一个玩家/AI 的首都被占领后，其剩余领地分裂成 1-2 个新 AI 国家。
   * - 新国家初始 3-4 个格子（随机）
   * - 颜色从扩展调色板中选取（避免与已有玩家重复）
   * - 新国家自动准备就绪，加入 AI 决策循环
   * - 未被分配到的剩余领地变为 NPC 中立地
   */
  private splitIntoNewNations(room: Room, originalPlayer: Player, remainingLands: number[]): void {
    if (remainingLands.length === 0) {
      this.io.to(room.id).emit('systemMessage', {
        message: `${originalPlayer.name} 首都失守，无剩余领地，彻底灭亡。`,
      });
      return;
    }

    // 决定分裂成几个新国家：1 或 2 个（领地够多时才分裂 2 个）
    const newNationCount = remainingLands.length >= 8 && Math.random() < 0.5 ? 2 : 1;

    // 随机选择新国家的首都种子格
    const shuffled = [...remainingLands];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const newNations: { capitalId: number; lands: number[] }[] = [];
    let seedIdx = 0;
    for (let n = 0; n < newNationCount; n++) {
      if (seedIdx >= shuffled.length) break;
      const capital = shuffled[seedIdx++];
      const initialSize = 3 + Math.floor(Math.random() * 2); // 3-4 格
      const nationLands: number[] = [capital];
      // 从剩余领地中找与已有地相邻的格子，优先分配
      const usedSet = new Set<number>([capital]);
      for (let k = 1; k < initialSize && seedIdx < shuffled.length; k++) {
        // 找一个与已有地相邻的格子
        let found: number | null = null;
        for (let i = seedIdx; i < shuffled.length; i++) {
          const candidate = shuffled[i];
          const isAdjacent = nationLands.some((myLand) => {
            const adj = LAND_ADJACENCY[myLand] || [];
            return adj.includes(candidate);
          });
          if (isAdjacent) {
            found = candidate;
            shuffled.splice(i, 1);
            seedIdx--;
            break;
          }
        }
        // 如果没找到相邻的，就顺序取一个
        if (found === null) {
          found = shuffled[seedIdx];
          seedIdx++;
        }
        if (found !== null && !usedSet.has(found)) {
          nationLands.push(found);
          usedSet.add(found);
        }
      }
      newNations.push({ capitalId: capital, lands: nationLands });
    }

    // 收集所有已分配给新国家的格子
    const assignedSet = new Set<number>();
    for (const nation of newNations) {
      for (const id of nation.lands) assignedSet.add(id);
    }

    // 未被分配的领地变为 NPC 中立地
    for (const landId of remainingLands) {
      if (!assignedSet.has(landId)) {
        const land = room.lands.find((l) => l.id === landId);
        if (land) {
          land.ownerId = null;
          land.hasNPC = true;
        }
      }
    }

    // 创建新 AI 玩家
    const aiNames = ['新军', '义勇军', '自由军', '起义军', '独立军', '解放阵线', '复国军', '联盟军'];
    const usedColors = new Set(room.players.map((p) => p.color));
    const availableColors = PLAYER_COLORS.filter((c) => !usedColors.has(c));
    const aiNamesShuffled = [...aiNames].sort(() => Math.random() - 0.5);

    for (let i = 0; i < newNations.length; i++) {
      const nation = newNations[i];
      // 选一个没被用过的颜色
      const color = availableColors.length > 0
        ? availableColors[i % availableColors.length]
        : PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

      // 清除新国家格子的归属（避免继承原玩家）
      for (const landId of nation.lands) {
        const land = room.lands.find((l) => l.id === landId);
        if (land) {
          land.ownerId = null; // 先清空，后面设为新 AI
        }
      }

      const newAI: Player = {
        id: `ai_${room.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        socketId: `ai_${room.id}_${Date.now()}_${room.players.length}_${Math.random().toString(36).slice(2, 8)}`,
        name: `${aiNamesShuffled[i % aiNamesShuffled.length]}`,
        isReady: true,
        isAlive: true,
        isHost: false,
        gold: 3000,
        resources: 20,
        technology: 1,
        productivity: 1,
        morale: 1,
        lands: [...nation.lands],
        capitalId: nation.capitalId,
        color,
        lastOccupyActionAt: 0,
        shieldUntil: 0,
        hasteUntil: 0,
        isAI: true,
        aiItems: (() => {
          // 新分裂的 AI 国家也随机分配道具
          const allItemTypes = ['shield', 'airship', 'guided_missile', 'haste', 'nuclear_missile'];
          const items: string[] = [];
          for (const it of allItemTypes) {
            if (Math.random() < 0.4) items.push(it);
          }
          return items;
        })(),
      };

      // 设置格子归属
      for (const landId of nation.lands) {
        const land = room.lands.find((l) => l.id === landId);
        if (land) {
          land.ownerId = newAI.socketId;
          land.hasNPC = false;
        }
      }

      room.players.push(newAI);
      this.io.to(room.id).emit('systemMessage', {
        message: `🏳️ ${originalPlayer.name} 首都失守！剩余领地分裂出新国家「${newAI.name}」（首都 #${nation.capitalId}，${nation.lands.length} 格）！`,
      });
    }

    this.io.to(room.id).emit('systemMessage', {
      message: `💥 ${originalPlayer.name} 灭亡，分裂出 ${newNations.length} 个新国家！`,
    });
  }

  private assignPlayerColor(room: Room, player: Player): void {
    const usedColors = new Set(room.players.map((p) => p.color));
    for (const color of PLAYER_COLORS) {
      if (!usedColors.has(color)) {
        player.color = color;
        return;
      }
    }
    // 如果颜色不够用，回退到随机
    player.color = PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
  }

  /**
   * 玩家在准备阶段自选颜色（需拥有"选择颜色"道具）。
   * 先到先得：如果颜色已被其他玩家占用则拒绝。
   */
  claimPlayerColor(socketId: string, roomId: string, color: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在' };
    if (room.gameStatus !== 'waiting') return { success: false, error: '仅在准备阶段可选颜色' };

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player) return { success: false, error: '玩家不在房间内' };

    // 校验颜色合法性
    if (!PLAYER_COLORS.includes(color)) return { success: false, error: '无效的颜色' };

    // 检查颜色是否已被其他玩家占用
    const conflictPlayer = room.players.find((p) => p.color === color && p.socketId !== socketId);
    if (conflictPlayer) {
      return { success: false, error: `颜色已被【${conflictPlayer.name}】占用，请换一个` };
    }

    // 占用颜色
    player.color = color;
    this.broadcastGameState(room);
    return { success: true };
  }

  private generateRoomId(): string {
    // 自动生成短房间号：8 位小写字母+数字
    for (let i = 0; i < 10; i++) {
      const id = Math.random().toString(36).slice(2, 10);
      if (!this.rooms.has(id)) return id;
    }
    // 兜底：加时间戳后缀
    return `r${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 4)}`;
  }

  private getRoomState(room: Room, viewerSocketId?: string) {
    // 计算每个地块的飞艇封锁状态（仅服务端可知真实首都位置）
    // airshipBlocked = true 表示该地块是"敌方首都"或"敌方首都相邻格"，飞艇不可攻击也不在列表中显示
    // 自己的首都及其相邻格不被封锁（玩家可正常经过/操作）
    const enemyCapitalIds: number[] = [];
    for (const p of room.players) {
      if (!viewerSocketId || p.socketId !== viewerSocketId) {
        if (p.capitalId !== null && p.isAlive) {
          enemyCapitalIds.push(p.capitalId);
        }
      }
    }
    const enemyCapitalSet = new Set(enemyCapitalIds);
    const enemyCapitalAdjacentSet = new Set<number>();
    for (const capId of enemyCapitalIds) {
      const adj = LAND_ADJACENCY[capId] || [];
      for (const adjId of adj) {
        // 自己的首都本身不列入"敌方首都相邻格"
        if (!enemyCapitalSet.has(adjId)) {
          enemyCapitalAdjacentSet.add(adjId);
        }
      }
    }

    const isAirshipBlocked = (landId: number, ownerId: string | null): boolean => {
      // 必须是敌方首都或敌方首都相邻格；自己拥有的地块不算（即使靠近敌方首都也可正常显示）
      if (enemyCapitalSet.has(landId)) return true;
      if (enemyCapitalAdjacentSet.has(landId) && ownerId !== viewerSocketId) {
        // 仅当该地块不属于当前玩家时才封锁（自己的地不算敌方首都相邻格）
        return true;
      }
      return false;
    };

    return {
      id: room.id,
      players: room.players.map((p) => ({
        id: p.id,
        socketId: p.socketId,
        name: p.name,
        isReady: p.isReady,
        isAlive: p.isAlive,
        isHost: p.isHost,
        gold: p.gold,
        resources: p.resources,
        technology: p.technology,
        productivity: p.productivity,
        morale: p.morale,
        lands: p.lands,
        // 首都信息：只有自己能看见自己的首都，其他人看到 null
        capitalId: (viewerSocketId && p.socketId === viewerSocketId) ? p.capitalId : null,
        // 护盾到期时间戳：自己能看到自己的剩余护盾；其他人只看到是否在保护期（布尔），看不到具体时间
        shieldUntil: (viewerSocketId && p.socketId === viewerSocketId) ? p.shieldUntil : 0,
        // 对外暴露"是否处于护盾期"的布尔标记，便于 UI 显示护盾特效（但不暴露时间戳）
        shieldActive: p.shieldUntil > Date.now(),
        // 迅捷药水到期时间戳：仅自己可见
        hasteUntil: (viewerSocketId && p.socketId === viewerSocketId) ? p.hasteUntil : 0,
        // 是否处于迅捷加速期（所有人可见）
        hasteActive: p.hasteUntil > Date.now(),
        color: p.color,
        // AI 标记：前端可显示 🤖 图标区分人机/真人
        isAI: p.isAI || false,
      })),
      lands: room.lands.map((l) => ({
        id: l.id,
        ownerId: l.ownerId,
        hasNPC: l.hasNPC,
        adjacentLands: l.adjacentLands,
        // 城墙标记：所有玩家可见（用于前端格子显示城垛特效/提示）
        walled: !!l.walled,
        // 飞艇封锁标记：服务端基于真实首都位置计算，不暴露具体哪个是首都
        airshipBlocked: isAirshipBlocked(l.id, l.ownerId),
      })),
      gameStatus: room.gameStatus,
      timeRemaining: room.timeRemaining,
    };
  }

  /** 按玩家视角广播 gameStateUpdate：每个玩家只能看到自己的首都 */
  broadcastGameState(room: Room): void {
    // 一致性校验（终极兜底）：仅在游戏进行中生效，避免游戏开始前（玩家还未分配
    // 初始领地）误判为"假活"淘汰。游戏开始前所有玩家的 lands 都为空，此时不应触发淘汰。
    if (room.gameStatus === 'playing') {
      let hasGhostPlayer = false;
      for (const p of room.players) {
        if (!p.isAlive) continue;
        const actualLandCount = room.lands.filter((l) => l.ownerId === p.socketId).length;
        if (actualLandCount === 0) {
          // 地图上确实没有该玩家的领地 → 假活，淘汰
          p.isAlive = false;
          p.gold = 0;
          p.resources = 0;
          p.lands = [];
          hasGhostPlayer = true;
          this.io.to(room.id).emit('playerEliminated', {
            playerId: p.socketId,
            reason: `领地全失，国家覆灭`,
          });
          this.io.to(room.id).emit('systemMessage', {
            message: `${p.name} 领地全失，国家覆灭！`,
          });
        } else if (p.lands.length !== actualLandCount) {
          // lands 数组与地图实际不符，修正 lands 数组
          p.lands = room.lands.filter((l) => l.ownerId === p.socketId).map((l) => l.id);
        }
      }
      if (hasGhostPlayer) {
        // 有玩家被修正为淘汰，检查游戏是否应该结束
        this.checkGameEnd(room);
      }
    }
    for (const player of room.players) {
      this.io.to(player.socketId).emit('gameStateUpdate', this.getRoomState(room, player.socketId));
    }
  }
}
