import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { RoomManager } from './RoomManager.js';
import { FriendsManager } from './friends.js';
import { GAME_CONSTANTS } from './constants.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取局域网 IPv4 地址（用于手机端访问提示，优先家用 WiFi 网段）
function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push(iface.address);
      }
    }
  }
  return (
    candidates.find((ip) => ip.startsWith('192.168.')) ||
    candidates.find((ip) => ip.startsWith('10.')) ||
    candidates[0] ||
    'localhost'
  );
}

process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] 未捕获异常:`, err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] 未处理的Promise拒绝:`, reason);
});

const app = express();
const httpServer = createServer(app);

// 给 /api /socket.io 明确返回 JSON 错误，避免 fallback 到 HTML 导致前端 < 报错
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  next();
});

const io = new Server(httpServer, {
  // 手机端与电脑端互通：允许同域 / 局域网所有网段访问，降低连接失败导致页面 ABORTED 的概率
  cors: {
    origin: (origin, callback) => {
      // 无 origin（本地文件、同域、iframe 某些情况）一律放行
      if (!origin) return callback(null, true);
      try {
        const u = new URL(origin);
        const hostname = u.hostname;
        // localhost / 127.0.0.1 / 所有内网网段放行
        const allowedHost =
          hostname === 'localhost' ||
          /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) ||
          hostname.endsWith('.local') ||
          hostname === '[::1]';
        if (allowedHost) return callback(null, true);
        const envAllowedOrigins = process.env.ALLOWED_ORIGINS;
        if (envAllowedOrigins) {
          const ok = envAllowedOrigins.split(',').some(pat => {
            const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
            return re.test(origin);
          });
          if (ok) return callback(null, true);
        }
        // 开发/演示环境宽松一些，不阻塞连接
        console.warn(`[${new Date().toISOString()}] CORS 放宽放行 origin: ${origin}`);
        return callback(null, true);
      } catch (e) {
        return callback(null, true);
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // 允许传输层更大的容错
  pingTimeout: 60000,
  pingInterval: 25000,
});

const roomManager = new RoomManager(io);
const friendsManager = new FriendsManager(io);

const distPath = path.join(__dirname, '..', 'dist');
const hasStaticFiles = fs.existsSync(distPath) && fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'));

if (hasStaticFiles) {
  console.log(`[${new Date().toISOString()}] 检测到前端静态文件，启用托管 (${distPath})`);
  // 统一添加静态资源的 Access-Control/Cache/安全相关响应头，兼容 iframe 与局域网不同 origin 访问
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path === '/' || req.path === '/index.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (req.path.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    next();
  });
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      if (filePath.endsWith('.mjs')) res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=UTF-8');
      if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      if (filePath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
      if (filePath.endsWith('.woff') || filePath.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
}

// REST API
app.get('/api/rooms', (req, res) => {
  res.json(roomManager.getRooms());
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    players: roomManager.getPlayerCount(),
    rooms: roomManager.getRooms().length,
    // 局域网访问地址：手机连同一 WiFi 后在浏览器打开即可与电脑端互通
    lanUrl: `http://${getLanIp()}:${process.env.PORT || 3001}`,
  });
});

if (hasStaticFiles) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('七国争霸服务器运行中 - 请构建前端后访问');
  });
}

// Socket.IO
io.on('connection', (socket) => {
  console.log(`玩家连接: ${socket.id}`);

  socket.on('createRoom', ({ playerName, roomId: customRoomId, aiCount, difficulty }: { playerName: string; roomId?: string; aiCount?: number; difficulty?: 'normal' | 'medium' | 'hard' }) => {
    const result = roomManager.createRoom(socket, playerName, customRoomId, aiCount, difficulty);
    if (result.success) {
      socket.emit('roomCreated', result.room);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('createAIRoom', ({ playerName, difficulty }: { playerName: string; difficulty?: 'normal' | 'medium' | 'hard' }) => {
    const result = roomManager.createAIRoom(socket, playerName, difficulty);
    if (result.success) {
      socket.emit('roomCreated', result.room);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('rejoinRoom', ({ roomId, playerName }) => {
    const result = roomManager.rejoinRoom(socket, roomId, playerName);
    if (result.success) {
      socket.emit('roomCreated', result.room);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const result = roomManager.joinRoom(socket, roomId, playerName);
    if (result.success) {
      socket.emit('roomJoined', { room: result.room, playerId: socket.id });
      socket.to(roomId).emit('playerJoined', result.player);
      io.to(roomId).emit('gameStateUpdate', result.room);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // ==================== 新系统 Socket 事件 ====================

  // 联盟：缔结条约
  socket.on('formAlliance', ({ roomId, targetSocketId }: { roomId: string; targetSocketId: string }) => {
    const room = roomManager.getRoomById(roomId);
    if (!room) return;
    const result = roomManager.formAlliance(socket.id, targetSocketId, room);
    if (!result.success) socket.emit('error', { message: result.error });
    else roomManager.broadcastGameState(room);
  });

  // 联盟：撕毁条约
  socket.on('breakAlliance', ({ roomId, targetSocketId }: { roomId: string; targetSocketId: string }) => {
    const room = roomManager.getRoomById(roomId);
    if (!room) return;
    const result = roomManager.breakAlliance(socket.id, targetSocketId, room);
    if (!result.success) socket.emit('error', { message: result.error });
    else roomManager.broadcastGameState(room);
  });

  // 间谍侦察
  socket.on('spy', ({ roomId, targetSocketId }: { roomId: string; targetSocketId: string }) => {
    const result = roomManager.spy(socket.id, roomId, targetSocketId);
    if (!result.success) socket.emit('error', { message: result.error });
    else socket.emit('spyResult', { target: targetSocketId, data: result.data });
  });

  // 交易
  socket.on('trade', ({ roomId, tradeData }: { roomId: string; tradeData: { toSocketId: string; gold?: number } }) => {
    const result = roomManager.trade(socket.id, roomId, tradeData);
    if (!result.success) socket.emit('error', { message: result.error });
  });

  // 新道具使用
  socket.on('useNewItem', ({ roomId, itemId }: { roomId: string; itemId: string }) => {
    const result = roomManager.useNewItem(socket.id, roomId, itemId);
    if (!result.success) socket.emit('error', { message: result.error });
    else {
      socket.emit('newItemResult', { itemId, data: result.data });
      const room = roomManager.getRoomById(roomId);
      if (room) roomManager.broadcastGameState(room);
    }
  });

  // 领取开局盲盒
  socket.on('claimMysteryBox', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoomById(roomId);
    if (!room) return;
    const item = roomManager.giveMysteryBox(socket.id, room);
    if (item) {
      socket.emit('mysteryBox', { item });
    }
  });

  // 设置胜利模式（房主）
  socket.on('setVictoryMode', ({ roomId, mode }: { roomId: string; mode: string }) => {
    const room = roomManager.getRoomById(roomId);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player?.isHost) return;
    room.victoryMode = mode as any;
    roomManager.broadcastGameState(room);
  });

  socket.on('playerReady', ({ roomId }) => {
    roomManager.setPlayerReady(socket.id, roomId);
  });

  socket.on('claimColor', ({ roomId, color }) => {
    const result = roomManager.claimPlayerColor(socket.id, roomId, color);
    if (!result.success) {
      socket.emit('error', result.error || '选色失败');
    }
  });

  socket.on('airshipAttack', ({ roomId, landId }) => {
    const result = roomManager.airshipAttack(socket.id, roomId, landId);
    if (!result.success) {
      socket.emit('error', result.error || '飞艇攻击失败');
    }
  });

  socket.on('useShield', ({ roomId }) => {
    const result = roomManager.useShield(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error || '护盾启动失败' });
    }
  });

  socket.on('useGuidedMissile', ({ roomId }) => {
    const result = roomManager.useGuidedMissile(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error || '指导导弹发射失败' });
    }
  });

  socket.on('useHaste', ({ roomId }) => {
    const result = roomManager.useHaste(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error || '迅捷药水使用失败' });
    }
  });

  socket.on('useWall', ({ roomId }) => {
    const result = roomManager.useWall(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error || '城墙使用失败' });
    }
  });

  socket.on('useTNT', ({ roomId, landId }) => {
    const result = roomManager.useTNT(socket.id, roomId, landId);
    if (!result.success) {
      socket.emit('error', { message: result.error || 'TNT使用失败' });
    }
  });

  socket.on('useNuclearMissile', ({ roomId, targetSocketId }) => {
    const result = roomManager.useNuclearMissile(socket.id, roomId, targetSocketId);
    if (!result.success) {
      socket.emit('error', { message: result.error || '核能导弹发射失败' });
    }
  });

  socket.on('startGame', ({ roomId }) => {
    const result = roomManager.startGame(roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('upgradeTech', ({ roomId }) => {
    const result = roomManager.upgradeTech(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('upgradeProductivity', ({ roomId }) => {
    const result = roomManager.upgradeProductivity(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('upgradeMorale', ({ roomId }) => {
    const result = roomManager.upgradeMorale(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('relocateCapital', ({ roomId, landId }) => {
    const result = roomManager.relocateCapital(socket.id, roomId, landId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('exchangeResources', ({ roomId, count }) => {
    const result = roomManager.exchangeResources(socket.id, roomId, count ?? 1);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('occupyLand', ({ roomId, landId }) => {
    const result = roomManager.occupyLand(socket.id, roomId, landId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('attackLand', ({ roomId, landId }) => {
    const result = roomManager.attackLand(socket.id, roomId, landId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('attackPlayer', ({ roomId, targetPlayerId }) => {
    const result = roomManager.attackPlayer(socket.id, roomId, targetPlayerId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('leaveRoom', ({ roomId }) => {
    roomManager.leaveRoom(socket.id, roomId);
  });

  // ===== 大厅聊天（全局，所有在线玩家可见） =====
  // 玩家进入游戏（大厅页面加载时触发）：注册在线状态 + 广播系统消息
  socket.on('lobbyJoin', ({ playerName }: { playerName?: string }) => {
    const name = (playerName || '').trim().slice(0, 12);
    if (!name) return;
    // 老玩家（起名页上线前已有名字）静默把名字登记进注册表；已被占用则跳过（不踢人，仅防止新号再取）
    friendsManager.registerName(name);
    friendsManager.setOnline(name, socket.id);
    io.emit('lobbyChat', {
      senderId: socket.id,
      senderName: '系统',
      message: `🎉 ${name} 进入了游戏`,
      system: true,
      time: Date.now(),
    });
  });

  // 好友系统同步：大厅加载/刷新时调用，注册在线状态并下发好友数据
  socket.on('friendsSync', ({ playerName }: { playerName?: string }) => {
    const name = (playerName || '').trim().slice(0, 12);
    if (!name) return;
    // 同上：老玩家名字静默登记进注册表
    friendsManager.registerName(name);
    friendsManager.setOnline(name, socket.id);
    socket.emit('friendsData', {
      friends: friendsManager.getFriends(name),
      requests: friendsManager.getRequests(name),
    });
  });

  // ===== 好友系统 =====
  // 添加好友：from 向 target 发送申请
  socket.on('friendAdd', ({ from, target }: { from?: string; target?: string }) => {
    const f = (from || '').trim().slice(0, 12);
    const t = (target || '').trim().slice(0, 12);
    const result = friendsManager.addRequest(f, t);
    socket.emit('friendAddResult', { ok: result.ok, message: result.error || `已向 ${t} 发送好友申请`, target: t });
  });

  // 通过好友申请
  socket.on('friendAccept', ({ playerName, from }: { playerName?: string; from?: string }) => {
    const me = (playerName || '').trim().slice(0, 12);
    const f = (from || '').trim().slice(0, 12);
    if (!me || !f) return;
    friendsManager.accept(me, f);
  });

  // 拒绝好友申请
  socket.on('friendReject', ({ playerName, from }: { playerName?: string; from?: string }) => {
    const me = (playerName || '').trim().slice(0, 12);
    const f = (from || '').trim().slice(0, 12);
    if (!me || !f) return;
    friendsManager.reject(me, f);
  });

  // 删除好友（双向解除）
  socket.on('friendRemove', ({ playerName, target }: { playerName?: string; target?: string }) => {
    const me = (playerName || '').trim().slice(0, 12);
    const t = (target || '').trim().slice(0, 12);
    if (!me || !t) return;
    friendsManager.removeFriend(me, t);
  });

  // 好友私聊：发给双方（发送方收到即视为发送成功回执）
  socket.on('friendChat', ({ from, to, message }: { from?: string; to?: string; message?: string }) => {
    const f = (from || '').trim().slice(0, 12);
    const t = (to || '').trim().slice(0, 12);
    const msg = (message || '').trim().slice(0, 200);
    if (!f || !t || !msg || f === t) return;
    // 必须是好友才能私聊
    const entry = friendsManager.getFriends(f);
    if (!entry.some((x) => x.name === t)) {
      socket.emit('friendNotice', { message: `⚠️ 私聊失败：${t} 不是你的好友` });
      return;
    }
    const saved = friendsManager.pushChat(f, t, msg);
    // 推送给接收方（在线时）
    const toSocketId = friendsManager.getSocketId(t);
    if (toSocketId) io.to(toSocketId).emit('friendChat', saved);
    // 回执给发送方
    socket.emit('friendChat', saved);
  });

  // 拉取与某好友的私聊记录
  socket.on('friendChatHistory', ({ a, b }: { a?: string; b?: string }) => {
    const x = (a || '').trim().slice(0, 12);
    const y = (b || '').trim().slice(0, 12);
    if (!x || !y) return;
    socket.emit('friendChatHistory', { a: x, b: y, messages: friendsManager.getChat(x, y) });
  });

  // ===== 账号注册/登录（起名页） =====
  // 名字从未注册过 → 创建新账号；名字已有账号 → 校验密码；老玩家遗留名字 → 首次输入的密码直接绑定
  // 成功返回 ok=true + isNew（true=新注册, false=登录成功），失败返回 ok=false + error
  socket.on('registerName', ({ playerName, password }: { playerName?: string; password?: string }, callback?: (res: { ok: boolean; error?: string; isNew?: boolean }) => void) => {
    const result = friendsManager.authAccount(playerName || '', password || '');
    if (!result.ok) {
      if (typeof callback === 'function') callback({ ok: false, error: result.error });
      return;
    }
    const name = (playerName || '').trim().slice(0, 12);
    friendsManager.setOnline(name, socket.id);
    if (typeof callback === 'function') callback({ ok: true, isNew: result.isNew });
  });

  // 玩家改名：广播改名系统消息 + 好友数据迁移（好友列表/申请/私聊记录全部搬到新名字）
  // 新名字被占用时通过 callback 返回错误，前端不消耗改名卡、不更新本地名字
  socket.on('lobbyRename', ({ oldName, newName }: { oldName?: string; newName?: string }, callback?: (res: { ok: boolean; error?: string }) => void) => {
    const o = (oldName || '').trim().slice(0, 12);
    const n = (newName || '').trim().slice(0, 12);
    if (!o || !n || o === n) {
      if (typeof callback === 'function') callback({ ok: false, error: '名字无效' });
      return;
    }
    const result = friendsManager.migrateName(o, n);
    if (!result.ok) {
      if (typeof callback === 'function') callback({ ok: false, error: result.error });
      return;
    }
    friendsManager.setOnline(n, socket.id);
    friendsManager.pushDataTo(n); // 给改名后的自己推送新好友数据
    io.emit('lobbyChat', {
      senderId: socket.id,
      senderName: '系统',
      message: `✏️ ${o} 改名为 ${n}`,
      system: true,
      time: Date.now(),
    });
    if (typeof callback === 'function') callback({ ok: true });
  });

  // 大厅发言：广播给所有在线玩家
  socket.on('lobbyChat', ({ playerName, message }: { playerName?: string; message?: string }) => {
    const name = (playerName || '').trim().slice(0, 12) || '匿名';
    const msg = (message || '').trim().slice(0, 200);
    if (!msg) return;
    io.emit('lobbyChat', {
      senderId: socket.id,
      senderName: name,
      message: msg,
      system: false,
      time: Date.now(),
    });
  });

  // ===== 局内聊天（房间内所有玩家可见） =====
  socket.on('chatMessage', ({ roomId, message }: { roomId?: string; message?: string }) => {
    const msg = (message || '').trim().slice(0, 200);
    if (!msg || !roomId) return;
    const room = roomManager.getRoomById(roomId);
    if (!room) return;
    const sender = room.players.find((p) => p.socketId === socket.id);
    if (!sender) return; // 只有房间内玩家才能发言
    io.to(roomId).emit('chatMessage', {
      senderId: socket.id,
      senderName: sender.name,
      senderColor: sender.color,
      isAI: sender.isAI || false,
      message: msg,
      time: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    console.log(`玩家断开: ${socket.id}`);
    roomManager.handleDisconnect(socket.id);
    friendsManager.setOffline(socket.id);
  });
});

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

httpServer.on('error', (err: any) => {
  console.error(`[${new Date().toISOString()}] 服务器错误:`, err.code);
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请尝试其他端口或关闭占用程序`);
  } else if (err.code === 'EACCES') {
    console.error(`没有权限绑定端口 ${PORT}，请使用更高权限的端口`);
  }
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  const lanIp = getLanIp();
  console.log(`[${new Date().toISOString()}] 七国争霸服务器已启动`);
  console.log(`  统一访问网址（电脑端和手机端都用这一个）: http://${lanIp}:${PORT}`);
  console.log(`  电脑直接在浏览器打开上面网址；手机与电脑连同一WiFi后也打开同一个网址，创建/加入房间都可以`);
  console.log(`按 Ctrl+C 停止服务器`);
});
