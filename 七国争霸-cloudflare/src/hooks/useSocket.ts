import { useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../stores/gameStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useFriendsStore } from '../stores/friendsStore';

let socketInstance: Socket | null = null;
let listenersInitialized = false;

// 服务器地址解析优先级：
// 1. 网址参数 ?server=https://xxx（静态托管部署时用它指向后端，会自动记住）
// 2. localStorage 里记住的地址（清除方法：?server= 传空一次）
// 3. 默认同源（本地服务器 / Vite 代理场景）
export function getServerUrl(): string {
  try {
    const qs = new URLSearchParams(window.location.search);
    const fromQuery = qs.get('server');
    if (fromQuery !== null) {
      if (fromQuery) {
        localStorage.setItem('gameServerUrl', fromQuery.replace(/\/+$/, ''));
      } else {
        localStorage.removeItem('gameServerUrl'); // ?server= 清除记忆
      }
    }
    return localStorage.getItem('gameServerUrl') || '';
  } catch {
    return '';
  }
}

function getSocket(): Socket {
  if (!socketInstance) {
    const url = getServerUrl();
    socketInstance = url ? io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    }) : io('', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socketInstance;
}

function initSocketListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;
  if (!socketInstance) return;
  
  const {
    setConnected,
    setCurrentRoom,
    addMessage,
    setGameResult,
    setLastGameResult,
    setError,
    setPlayerInfo,
  } = useGameStore.getState();

  socketInstance.on('connect', () => {
    console.log('Connected to server');
    setConnected(true);
    const room = useGameStore.getState().currentRoom;
    const name = useGameStore.getState().playerName;
    if (room && name) {
      socketInstance?.emit('rejoinRoom', { roomId: room.id, playerName: name });
    }
  });

  socketInstance.on('disconnect', () => {
    console.log('Disconnected from server');
    setConnected(false);
  });

  socketInstance.on('error', ({ message }) => {
    setError(message);
    addMessage(message, 'danger');
  });

  socketInstance.on('roomCreated', (room) => {
    setCurrentRoom(room);
    useGameStore.getState().clearChatMessages(); // 进入新房间时清空旧局内聊天
    if (room.players.length > 0) {
      const hostPlayer = room.players.find((p: { isHost: boolean }) => p.isHost);
      if (hostPlayer) {
        setPlayerInfo(hostPlayer.socketId, hostPlayer.name);
      }
    }
    addMessage(`房间已创建: ${room.id}`, 'success');
  });

  socketInstance.on('roomJoined', ({ room, playerId: pid }) => {
    setCurrentRoom(room);
    useGameStore.getState().clearChatMessages(); // 进入新房间时清空旧局内聊天
    setPlayerInfo(pid, useGameStore.getState().playerName);
    addMessage(`成功加入房间: ${room.id}`, 'success');
  });

  socketInstance.on('playerJoined', (player) => {
    addMessage(`${player.name} 加入了房间`, 'info');
  });

  socketInstance.on('playerLeft', ({ playerName }) => {
    addMessage(`${playerName} 离开了房间`, 'info');
  });

  // ===== 好友系统事件 =====
  socketInstance.on('friendsData', ({ friends, requests }: { friends: { name: string; online: boolean }[]; requests: string[] }) => {
    useFriendsStore.getState().setFriendsData(friends, requests);
  });

  // 收到好友申请（实时通知）
  socketInstance.on('friendRequest', ({ from }: { from: string }) => {
    const s = useFriendsStore.getState();
    if (!s.requests.includes(from)) {
      s.setFriendsData(s.friends, [...s.requests, from]);
    }
    s.setNotice(`📨 ${from} 请求添加你为好友`);
  });

  // 好友系统通知（通过/拒绝/私聊失败等）
  socketInstance.on('friendNotice', ({ message }: { message: string }) => {
    useFriendsStore.getState().setNotice(message);
  });

  // 添加好友结果反馈
  socketInstance.on('friendAddResult', ({ ok, message }: { ok: boolean; message: string }) => {
    useFriendsStore.getState().setNotice(message);
    if (ok) {
      // 申请成功后重新拉取一次数据（互加场景下好友列表可能已变化）
      const name = useFriendsStore.getState().myName;
      if (name) getSocket().emit('friendsSync', { playerName: name });
    }
  });

  // 收到好友私聊（含自己发送的回执）
  socketInstance.on('friendChat', (msg: { from: string; to: string; message: string; time: number }) => {
    useFriendsStore.getState().receiveChat(msg);
  });

  // 私聊历史
  socketInstance.on('friendChatHistory', ({ a, b, messages }: { a: string; b: string; messages: { from: string; to: string; message: string; time: number }[] }) => {
    const myName = useFriendsStore.getState().myName;
    const peer = a === myName ? b : a;
    useFriendsStore.getState().setHistory(peer, messages);
  });
  // ===== 好友系统事件结束 =====

  // ===== 新系统事件 =====
  // 开局盲盒
  socketInstance.on('mysteryBox', ({ item }: { item: string }) => {
    useGameStore.getState().addMessage(`🎁 开局盲盒：获得道具 ${item}！`, 'success');
  });

  // 新道具使用结果
  socketInstance.on('newItemResult', ({ itemId, data }: { itemId: string; data: any }) => {
    if (data?.message) useGameStore.getState().addMessage(data.message, 'info');
    if (itemId === 'prophecy_card' && data?.enemies) {
      const info = data.enemies.map((e: any) => `${e.name}:${e.gold}金`).join('，');
      useGameStore.getState().addMessage(`🔮 敌方金币：${info}`, 'info');
    }
    if (itemId === 'recon_card' && data?.lands) {
      const info = data.lands.map((l: any) => `#${l.landId}=${l.ownerName}(${l.ownerGold}金)`).join('，');
      useGameStore.getState().addMessage(`🗺️ 侦察结果：${info}`, 'info');
    }
  });

  // 间谍侦察结果
  socketInstance.on('spyResult', ({ target, data }: { target: string; data: any }) => {
    if (data) {
      useGameStore.getState().addMessage(
        `🕵️ 侦察结果：金币${data.gold}，士气${data.morale}，领地${data.lands}块，科技${data.tech}`,
        'info'
      );
    }
  });

  socketInstance.on('gameStateUpdate', (room) => {
    setCurrentRoom(room);
  });

  socketInstance.on('playerEliminated', ({ playerId: elimPid, reason }) => {
    const room = useGameStore.getState().currentRoom;
    if (room) {
      const player = room.players.find((p) => p.socketId === elimPid);
      if (player) {
        addMessage(`${player.name} 被淘汰了！原因: ${reason}`, 'danger');
      }
    }
  });

  socketInstance.on('npcAttack', ({ damage, message }) => {
    addMessage(message, 'danger');
  });

  socketInstance.on('systemMessage', ({ message }) => {
    addMessage(message, 'info');
  });

  // 局内聊天：房间内玩家发言
  socketInstance.on('chatMessage', (data) => {
    useGameStore.getState().addChatMessage(data);
  });

  // 大厅聊天：全局发言 + 进入/改名系统消息
  socketInstance.on('lobbyChat', (data) => {
    useGameStore.getState().addLobbyMessage(data);
    // 改名系统广播（"✏️ XX 改名为 YY"）→ 派发全局事件，大厅顶部显示醒目 toast（含改名者自己）
    if (data?.system && typeof data.message === 'string' && data.message.includes('改名为')) {
      window.dispatchEvent(new CustomEvent('lobbyRenameNotice', { detail: { message: data.message } }));
    }
  });

  // 服务器直接发的系统货币奖励（比 gameOver 里的 playerId 匹配更可靠）
  socketInstance.on('currencyReward', ({ amount, reason }) => {
    useCurrencyStore.getState().addCurrency(amount);
    addMessage(`🎉 获得 ${amount} 系统货币（${reason}）`, 'success');
  });

  socketInstance.on('gameOver', (result) => {
    setGameResult(result);
    setLastGameResult(result);

    // 赢家 +10 系统货币
    const { playerId, leaveRoom: doLeaveRoom } = useGameStore.getState();
    if (!result.isDraw && result.winnerSocketId === playerId) {
      useCurrencyStore.getState().addCurrency(10);
    }

    if (result.isDraw) {
      addMessage('游戏结束，平局！', 'info');
    } else if (result.endReason === 'disconnected_lost') {
      addMessage('你中途退出/断线了，本场判负。', 'danger');
    } else if (result.endReason === 'killed') {
      addMessage(`你被${result.killedBy || '对手'}消灭了，本场判负。`, 'danger');
    } else {
      addMessage(`游戏结束！胜利者：${result.winner ?? '未知'}`, 'success');
    }

    // 所有玩家自动退出房间，回到主页面显示"我赢了/你输了"遮罩
    setTimeout(() => {
      doLeaveRoom();
    }, 2000);
  });
}

export function useSocket() {
  const { currentRoom, leaveRoom } = useGameStore();

  useEffect(() => {
    const socket = getSocket();
    initSocketListeners();

    return () => {};
  }, []);

  const createRoom = useCallback((playerName: string, customRoomId?: string, aiCount?: number, difficulty?: 'normal' | 'medium' | 'hard') => {
    getSocket().emit('createRoom', { playerName, roomId: customRoomId, aiCount, difficulty });
  }, []);

  const createAIRoom = useCallback((playerName: string, difficulty?: 'normal' | 'medium' | 'hard') => {
    getSocket().emit('createAIRoom', { playerName, difficulty });
  }, []);

  const joinRoom = useCallback((roomId: string, playerName: string) => {
    getSocket().emit('joinRoom', { roomId, playerName });
  }, []);

  const playerReady = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('playerReady', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const claimColor = useCallback((color: string) => {
    if (currentRoom) {
      getSocket().emit('claimColor', { roomId: currentRoom.id, color });
    }
  }, [currentRoom]);

  const airshipAttack = useCallback((landId: number) => {
    if (currentRoom) {
      getSocket().emit('airshipAttack', { roomId: currentRoom.id, landId });
    }
  }, [currentRoom]);

  const useShield = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('useShield', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const useGuidedMissile = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('useGuidedMissile', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const useHaste = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('useHaste', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const useWall = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('useWall', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const useTNT = useCallback((landId: number) => {
    if (currentRoom) {
      getSocket().emit('useTNT', { roomId: currentRoom.id, landId });
    }
  }, [currentRoom]);

  const useNuclearMissile = useCallback((targetSocketId: string) => {
    if (currentRoom) {
      getSocket().emit('useNuclearMissile', { roomId: currentRoom.id, targetSocketId });
    }
  }, [currentRoom]);

  const startGame = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('startGame', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const upgradeTech = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('upgradeTech', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const upgradeProductivity = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('upgradeProductivity', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const upgradeMorale = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('upgradeMorale', { roomId: currentRoom.id });
    }
  }, [currentRoom]);

  const relocateCapital = useCallback((landId: number) => {
    if (currentRoom) {
      getSocket().emit('relocateCapital', { roomId: currentRoom.id, landId });
    }
  }, [currentRoom]);

  const exchangeResources = useCallback((count?: number) => {
    if (currentRoom) {
      getSocket().emit('exchangeResources', { roomId: currentRoom.id, count });
    }
  }, [currentRoom]);

  const occupyLand = useCallback((landId: number) => {
    if (currentRoom) {
      getSocket().emit('occupyLand', { roomId: currentRoom.id, landId });
    }
  }, [currentRoom]);

  const attackLand = useCallback((landId: number) => {
    if (currentRoom) {
      getSocket().emit('attackLand', { roomId: currentRoom.id, landId });
    }
  }, [currentRoom]);

  const attackPlayer = useCallback((targetSocketId: string) => {
    if (currentRoom) {
      getSocket().emit('attackPlayer', {
        roomId: currentRoom.id,
        targetPlayerId: targetSocketId,
      });
    }
  }, [currentRoom]);

  const handleLeaveRoom = useCallback(() => {
    if (currentRoom) {
      getSocket().emit('leaveRoom', { roomId: currentRoom.id });
      leaveRoom();
    }
  }, [currentRoom, leaveRoom]);

  // 局内聊天：向房间内所有玩家发送消息
  const sendChat = useCallback((message: string) => {
    if (currentRoom) {
      getSocket().emit('chatMessage', { roomId: currentRoom.id, message });
    }
  }, [currentRoom]);

  // 大厅聊天：向所有在线玩家发送消息
  const sendLobbyChat = useCallback((playerName: string, message: string) => {
    getSocket().emit('lobbyChat', { playerName, message });
  }, []);

  // 广播"XX 进入了游戏"（大厅页面加载时调用）
  const announceLobbyJoin = useCallback((playerName: string) => {
    getSocket().emit('lobbyJoin', { playerName });
  }, []);

  // 广播"XX 改名为 YY"（大厅页面修改名字时调用；服务端同步迁移好友数据）
  // 改名前必须先校验新名字是否被占用 → callback: (ok, error?) => void
  const announceLobbyRename = useCallback((
    oldName: string,
    newName: string,
    callback?: (ok: boolean, error?: string) => void
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getSocket() as any).emit('lobbyRename', { oldName, newName }, (res: { ok: boolean; error?: string }) => {
      if (typeof callback === 'function') {
        callback(res.ok, res.error);
      }
    });
  }, []);

  // 起名页：名字 + 密码统一认证（服务端自动区分注册/登录）
  const registerName = useCallback((playerName: string, password: string, callback: (ok: boolean, error?: string, isNew?: boolean) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getSocket() as any).emit('registerName', { playerName, password }, (res: { ok: boolean; error?: string; isNew?: boolean }) => {
      callback(res.ok, res.error, res.isNew);
    });
  }, []);

  // ===== 好友系统 =====
  // 同步好友数据（大厅加载时调用，同时向服务端注册在线状态）
  const syncFriends = useCallback((playerName: string) => {
    useFriendsStore.getState().setMyName(playerName);
    getSocket().emit('friendsSync', { playerName });
  }, []);

  // 添加好友（向对方发申请）
  const addFriend = useCallback((from: string, target: string) => {
    getSocket().emit('friendAdd', { from, target });
  }, []);

  const acceptFriend = useCallback((playerName: string, from: string) => {
    getSocket().emit('friendAccept', { playerName, from });
  }, []);

  const rejectFriend = useCallback((playerName: string, from: string) => {
    getSocket().emit('friendReject', { playerName, from });
  }, []);

  const removeFriend = useCallback((playerName: string, target: string) => {
    getSocket().emit('friendRemove', { playerName, target });
  }, []);

  // 好友私聊
  const sendFriendChat = useCallback((from: string, to: string, message: string) => {
    getSocket().emit('friendChat', { from, to, message });
  }, []);

  // 拉取与某好友的私聊记录
  const loadChatHistory = useCallback((a: string, b: string) => {
    getSocket().emit('friendChatHistory', { a, b });
  }, []);

  return {
    createRoom,
    createAIRoom,
    joinRoom,
    playerReady,
    claimColor,
    airshipAttack,
    useShield,
    useGuidedMissile,
    useHaste,
    useWall,
    useTNT,
    useNuclearMissile,
    startGame,
    upgradeTech,
    upgradeProductivity,
    upgradeMorale,
    relocateCapital,
    exchangeResources,
    occupyLand,
    attackLand,
    attackPlayer,
    sendChat,
    sendLobbyChat,
    announceLobbyJoin,
    announceLobbyRename,
    registerName,
    syncFriends,
    addFriend,
    acceptFriend,
    rejectFriend,
    removeFriend,
    sendFriendChat,
    loadChatHistory,
    leaveRoom: handleLeaveRoom,
    // 新系统方法
    formAlliance: useCallback((targetSocketId: string) => {
      const room = useGameStore.getState().currentRoom;
      if (room) getSocket().emit('formAlliance', { roomId: room.id, targetSocketId });
    }, []),
    breakAlliance: useCallback((targetSocketId: string) => {
      const room = useGameStore.getState().currentRoom;
      if (room) getSocket().emit('breakAlliance', { roomId: room.id, targetSocketId });
    }, []),
    spy: useCallback((targetSocketId: string) => {
      const room = useGameStore.getState().currentRoom;
      if (room) getSocket().emit('spy', { roomId: room.id, targetSocketId });
    }, []),
    trade: useCallback((toSocketId: string, gold: number) => {
      const room = useGameStore.getState().currentRoom;
      if (room) getSocket().emit('trade', { roomId: room.id, tradeData: { toSocketId, gold } });
    }, []),
    useNewItem: useCallback((itemId: string) => {
      const room = useGameStore.getState().currentRoom;
      if (room) getSocket().emit('useNewItem', { roomId: room.id, itemId });
    }, []),
    setVictoryMode: useCallback((mode: string) => {
      const room = useGameStore.getState().currentRoom;
      if (room) getSocket().emit('setVictoryMode', { roomId: room.id, mode });
    }, []),
  };
}
