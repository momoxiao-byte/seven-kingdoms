import { create } from 'zustand';

// 聊天消息（局内/大厅通用）
export interface ChatMessage {
  senderId: string;
  senderName: string;
  message: string;
  system?: boolean; // 系统消息（如"XX 进入了游戏"）
  senderColor?: string; // 发言者颜色（局内聊天用）
  isAI?: boolean;
  time: number;
}

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
  // 护盾到期时间戳（毫秒，0 表示无护盾）；仅自己能看见自己的具体时间
  shieldUntil?: number;
  // 是否处于护盾保护期（所有人可见，但不暴露具体到期时间）
  shieldActive?: boolean;
  // 迅捷药水到期时间戳（毫秒，0 表示无加速）；仅自己可见
  hasteUntil?: number;
  // 是否处于迅捷加速期（所有人可见）
  hasteActive?: boolean;
  // 是否为 AI 玩家（人机对战模式）
  isAI?: boolean;
}

export interface Land {
  id: number;
  ownerId: string | null;
  hasNPC: boolean;
  adjacentLands: number[];
  // 城墙标记：true 表示该地块有城墙保护，敌方需点两次才能占领（首次只破城墙）
  walled?: boolean;
  // 飞艇封锁标记：服务端基于真实首都位置计算，true 表示该地块是敌方首都或敌方首都相邻格
  // 客户端飞艇目标列表不渲染此类地块；不暴露具体哪个是首都
  airshipBlocked?: boolean;
}

interface GameState {
  // 连接状态
  isConnected: boolean;
  setConnected: (connected: boolean) => void;

  // 玩家信息
  playerId: string | null;
  playerName: string;
  setPlayerInfo: (id: string, name: string) => void;

  // 房间状态
  currentRoom: {
    id: string;
    players: Player[];
    lands: Land[];
    gameStatus: 'waiting' | 'playing' | 'ended';
    timeRemaining: number;
  } | null;
  setCurrentRoom: (room: GameState['currentRoom']) => void;

  // 系统消息
  messages: { id: string; message: string; type: 'info' | 'danger' | 'success' }[];
  addMessage: (message: string, type?: 'info' | 'danger' | 'success') => void;
  clearMessages: () => void;

  // 局内聊天（房间内玩家发言）
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChatMessages: () => void;

  // 大厅聊天（局外全局发言，含"XX 进入了游戏"/"XX 改名为 YY"系统消息）
  lobbyMessages: ChatMessage[];
  addLobbyMessage: (msg: ChatMessage) => void;

  // 游戏结果（仅在游戏结束弹窗期间使用）
  gameResult: {
    winner: string | null;
    winnerSocketId: string | null;
    loserSocketIds: string[];
    isDraw: boolean;
    endReason: 'timeup' | 'elimination' | 'empty' | 'disconnected_lost' | 'killed';
    killedBy?: string;
    rankings: { name: string; isAlive: boolean; lands: number; gold: number }[];
  } | null;
  setGameResult: (result: GameState['gameResult']) => void;

  // 上一局结果（离开房间后仍保留，用于主页面显示"我赢了/你输了"遮罩）
  lastGameResult: GameState['gameResult'];
  setLastGameResult: (result: GameState['gameResult']) => void;
  clearLastGameResult: () => void;

  // 离开房间
  leaveRoom: () => void;

  // 错误
  error: string | null;
  setError: (error: string | null) => void;
}

export const useGameStore = create<GameState>((set) => ({
  isConnected: false,
  setConnected: (connected) => set({ isConnected: connected }),

  playerId: null,
  playerName: '',
  setPlayerInfo: (id, name) => set({ playerId: id, playerName: name }),

  currentRoom: null,
  setCurrentRoom: (room) => set({ currentRoom: room }),

  messages: [],
  addMessage: (message, type = 'info') =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `${Date.now()}_${Math.random()}`, message, type },
      ].slice(-50),
    })),
  clearMessages: () => set({ messages: [] }),

  chatMessages: [],
  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg].slice(-100),
    })),
  clearChatMessages: () => set({ chatMessages: [] }),

  lobbyMessages: [],
  addLobbyMessage: (msg) =>
    set((state) => ({
      lobbyMessages: [...state.lobbyMessages, msg].slice(-100),
    })),

  gameResult: null,
  setGameResult: (result) => set({ gameResult: result }),

  lastGameResult: null,
  setLastGameResult: (result) => set({ lastGameResult: result }),
  clearLastGameResult: () => set({ lastGameResult: null }),

  leaveRoom: () => set({ currentRoom: null, gameResult: null }),

  error: null,
  setError: (error) => set({ error }),
}));
