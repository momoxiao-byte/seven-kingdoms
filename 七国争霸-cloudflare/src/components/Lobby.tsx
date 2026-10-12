import React, { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useSocket } from '../hooks/useSocket';
import { useCurrencyStore } from '../stores/currencyStore';
import { useFriendsStore } from '../stores/friendsStore';
import ChatPanel from './ChatPanel';
import FriendsPanel from './FriendsPanel';

// 名字持久化 key：首次进入自选名字，之后锁定（改名需改名卡）
// 导出供 App.tsx 恢复名字使用
export const PLAYER_NAME_KEY = 'sk_player_name';

interface LobbyProps {
  playerName: string;
  setPlayerName: (name: string) => void;
  createRoom: (playerName: string, customRoomId?: string, aiCount?: number, difficulty?: 'normal' | 'medium' | 'hard') => void;
  createAIRoom: (playerName: string, difficulty?: 'normal' | 'medium' | 'hard') => void;
  joinRoom: (roomId: string, playerName: string) => void;
  onOpenShop: () => void;
}

// 每次页面加载只广播一次"进入了游戏"（从商城/兑换页返回大厅时不重复广播）
let hasAnnouncedJoin = false;

export default function Lobby({ playerName, setPlayerName, createRoom, createAIRoom, joinRoom, onOpenShop }: LobbyProps) {
  const [joinRoomId, setJoinRoomId] = useState('');
  const [customCreateRoomId, setCustomCreateRoomId] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');

  // 大厅聊天
  const { lobbyMessages, playerId, isConnected } = useGameStore();
  const { sendLobbyChat, announceLobbyJoin, announceLobbyRename } = useSocket();

  // 手机互通提示：从服务器获取局域网访问地址
  const [phoneUrl, setPhoneUrl] = useState('');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: { lanUrl?: string }) => {
        if (d.lanUrl) setPhoneUrl(d.lanUrl);
      })
      .catch(() => {});
  }, []);

  // 首次进入大厅：广播"XX 进入了游戏"（仅在已填名字时；每次页面加载只广播一次，从商城返回不重复广播）
  useEffect(() => {
    if (!hasAnnouncedJoin && playerName.trim()) {
      hasAnnouncedJoin = true;
      announceLobbyJoin(playerName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 改名（需商城"改名卡"，200 货币一张） =====
  // 大厅只读展示当前名字；点"✏️ 改名"→ 持有改名卡才弹出改名弹窗，
  // 确认后消耗 1 张改名卡，服务端广播"XX 改名为 YY"并自动迁移好友数据
  const { hasItem, getItemCount, consumeItem } = useCurrencyStore();
  const [renameOpen, setRenameOpen] = useState(false); // 改名弹窗
  const [newNameInput, setNewNameInput] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false); // 防重名服务端校验中（防连点）
  const [nameTip, setNameTip] = useState<string | null>(null);
  const showNameTip = (msg: string) => {
    setNameTip(msg);
    setTimeout(() => setNameTip(null), 3000);
  };

  // 改名按钮：没有改名卡只给提示，不弹窗
  const handleRenameClick = () => {
    if (!hasItem('rename_card')) {
      showNameTip('需要"改名卡"才能改名，请到系统商城购买（200 货币）');
      return;
    }
    setNewNameInput('');
    setRenameError(null);
    setRenameOpen(true);
  };

  // 弹窗确认改名：先向服务端校验新名字是否被占用（防重名），成功后才消耗改名卡
  const handleRenameConfirm = () => {
    const oldName = localStorage.getItem(PLAYER_NAME_KEY) || playerName.trim();
    const newName = newNameInput.trim().slice(0, 12);
    if (!newName) {
      setRenameError('名字不能为空');
      return;
    }
    if (newName === oldName) {
      setRenameError('新名字和当前名字一样，改名卡未消耗');
      return;
    }
    setIsRenaming(true);
    setRenameError(null);
    // 服务端校验：名字被占用会返回 error，此时不消耗改名卡、不更新本地名字
    announceLobbyRename(oldName, newName, (ok, err) => {
      setIsRenaming(false);
      if (!ok) {
        setRenameError(err || '这个名字被占用了，换一个吧');
        return;
      }
      consumeItem('rename_card');
      localStorage.setItem(PLAYER_NAME_KEY, newName);
      setPlayerName(newName); // 同步 App 状态（playerName 变化会自动触发 friendsSync）
      useFriendsStore.getState().setMyName(newName);
      setRenameOpen(false);
      showNameTip(`改名成功：${newName}`);
    });
  };

  // 好友系统
  const [showFriends, setShowFriends] = useState(false);
  const { requests, unread, notice: friendNotice } = useFriendsStore();
  // 好友按钮未读徽标：私聊未读 + 待处理申请
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (friendNotice) {
      const t = setTimeout(() => useFriendsStore.getState().setNotice(null), 4000);
      return () => clearTimeout(t);
    }
  }, [friendNotice]);

  // 改名广播醒目提示：useSocket 收到"XX 改名为 YY"系统消息时派发全局事件，
  // 所有在线玩家（含改名者自己）都在大厅顶部显示 toast
  const [renameToast, setRenameToast] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<{ message?: string }>).detail?.message || '';
      setRenameToast(msg);
      setTimeout(() => setRenameToast(null), 4000);
    };
    window.addEventListener('lobbyRenameNotice', handler);
    return () => window.removeEventListener('lobbyRenameNotice', handler);
  }, []);

  // 大厅加载 / 连接恢复 / 名字变化时：同步好友数据（同时向服务端注册在线状态）
  const { syncFriends } = useSocket();
  useEffect(() => {
    if (playerName.trim() && isConnected) {
      syncFriends(playerName.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerName, isConnected]);

  // 创建房间的人机配置弹窗
  const [showAIModal, setShowAIModal] = useState(false);
  const [enableAI, setEnableAI] = useState(false);
  const [aiCountInput, setAiCountInput] = useState('1');
  // 联机房间 AI 难度：不同难度限制最大 AI 数量
  // 普通=最多6个，中等=最多4个，困难=最多3个
  const [roomAIDifficulty, setRoomAIDifficulty] = useState<'normal' | 'medium' | 'hard'>('normal');
  const MAX_AI_BY_DIFF: Record<'normal' | 'medium' | 'hard', number> = { normal: 6, medium: 4, hard: 3 };

  // 真正执行创建房间（由弹窗确认后触发）
  const doCreateRoom = (aiCount: number, diff: 'normal' | 'medium' | 'hard') => {
    const customId = customCreateRoomId.trim();
    createRoom(playerName, customId || undefined, aiCount, diff);
    setShowAIModal(false);
    setEnableAI(false);
    setAiCountInput('1');
  };

  // 点击"创建房间"按钮：先弹出人机配置弹窗
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;

    if (mode === 'create') {
      // 弹出人机配置弹窗
      setShowAIModal(true);
    } else {
      if (joinRoomId.trim()) {
        joinRoom(joinRoomId.trim(), playerName);
      }
    }
  };

  // 人机对战快捷入口（1v1 AI）
  // 难度：普通=原默认（随机道具/CD 0.5s/决策4s）；中等=3道具/CD 0.3s/决策2s；困难=全道具/CD 0.1s/决策1s
  const [aiDifficulty, setAiDifficulty] = useState<'normal' | 'medium' | 'hard'>('normal');
  const handleAIPlay = () => {
    if (!playerName.trim()) return;
    createAIRoom(playerName, aiDifficulty);
  };

  // 弹窗确认
  const handleConfirmCreate = () => {
    const maxAI = MAX_AI_BY_DIFF[roomAIDifficulty];
    const n = enableAI ? Math.max(0, Math.min(maxAI, parseInt(aiCountInput, 10) || 0)) : 0;
    doCreateRoom(n, roomAIDifficulty);
  };

  // AI 数量增减：上限随难度变化
  const incAI = () => {
    const n = parseInt(aiCountInput, 10) || 0;
    const max = MAX_AI_BY_DIFF[roomAIDifficulty];
    if (n < max) setAiCountInput(String(n + 1));
  };
  const decAI = () => {
    const n = parseInt(aiCountInput, 10) || 0;
    if (n > 0) setAiCountInput(String(n - 1));
  };

  // 切换难度时自动限制 AI 数量（如果当前数量超出新难度上限则截断）
  const handleRoomDifficultyChange = (d: 'normal' | 'medium' | 'hard') => {
    setRoomAIDifficulty(d);
    const max = MAX_AI_BY_DIFF[d];
    const cur = parseInt(aiCountInput, 10) || 0;
    if (cur > max) setAiCountInput(String(max));
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-secondary/80 backdrop-blur rounded-2xl p-8 shadow-2xl w-full max-w-md border border-accent/20">
        <h1 className="text-4xl font-serif text-center text-accent mb-2">七国争霸</h1>
        <p className="text-center text-gray-400 mb-4">七雄逐鹿，问鼎中原</p>

        {/* 当前名字卡片：名字已锁定，改名需使用商城"改名卡" */}
        <div className="mb-6 flex items-center justify-between bg-primary/40 rounded-lg px-4 py-3 border border-accent/20">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl">👤</span>
            <div className="min-w-0">
              <p className="text-[10px] text-gray-500 leading-tight">当前名字</p>
              <p className="text-white font-bold truncate">{playerName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasItem('rename_card') && (
              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                改名卡 x{getItemCount('rename_card')}
              </span>
            )}
            <button
              type="button"
              onClick={handleRenameClick}
              title="改名需要消耗商城购买的改名卡（200 货币）"
              className="px-3 py-1.5 bg-blue-600/20 border border-blue-500/40 text-blue-400 text-sm font-bold rounded-lg hover:bg-blue-600/30 transition-all"
            >
              ✏️ 改名
            </button>
          </div>
        </div>
        {nameTip && (
          <p className="-mt-4 mb-4 text-xs text-yellow-400 text-center">{nameTip}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 未连接服务器警告：静态托管下没有后端时给明确提示，而不是让玩家误以为游戏坏了 */}
          {!isConnected && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-lg px-4 py-3 text-center">
              <p className="text-sm text-red-400 font-bold">⚠️ 未连接到游戏服务器</p>
              <p className="text-xs text-red-300/70 mt-1 leading-relaxed">
                联机对战需要运行中的后端服务器。本地玩请先双击启动器；
                静态托管部署时请在网址后加 <code>?server=后端地址</code> 指定服务器。
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                mode === 'create'
                  ? 'bg-accent text-primary'
                  : 'bg-primary/50 text-gray-400 hover:text-white'
              }`}
            >
              创建房间
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                mode === 'join'
                  ? 'bg-accent text-primary'
                  : 'bg-primary/50 text-gray-400 hover:text-white'
              }`}
            >
              加入房间
            </button>
          </div>

          {mode === 'create' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                自定义房间号 <span className="text-gray-500">（留空自动生成）</span>
              </label>
              <input
                type="text"
                value={customCreateRoomId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCustomCreateRoomId(e.target.value)}
                placeholder="例如：秦楚对决 / 1234 / abc.77"
                className="w-full bg-primary/50 border border-accent/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors"
                maxLength={16}
              />
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                长度 2~16 位，支持中文、英文、数字、<code className="text-gray-400">_</code>、<code className="text-gray-400">-</code>、<code className="text-gray-400">.</code>
              </p>
            </div>
          )}

          {mode === 'join' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">房间号</label>
              <input
                type="text"
                value={joinRoomId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setJoinRoomId(e.target.value)}
                placeholder="输入朋友创建的房间号（例如：秦楚对决）"
                className="w-full bg-primary/50 border border-accent/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!playerName.trim() || (mode === 'join' && !joinRoomId.trim())}
            className="w-full py-3 bg-accent text-primary font-bold rounded-lg hover:bg-accent/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed pulse-glow"
          >
            {mode === 'create' ? '创建房间' : '加入房间'}
          </button>
        </form>

        {/* 提示：创建房间会弹出人机配置 */}
        {mode === 'create' && (
          <p className="mt-2 text-xs text-purple-400/70 text-center">
            💡 点击创建后可选择是否加入 AI 玩家
          </p>
        )}

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>游戏规则:</p>
          <p className="mt-1">7名玩家争夺200块土地</p>
          <p>40分钟限时，最后存活者为胜</p>
          <p className="mt-2 text-accent/70">💡 自定义房间号：电脑、手机输入同一个名字即可一起玩</p>
        </div>

        {/* 统一网址提示：电脑端和手机端都用同一个局域网地址 */}
        {phoneUrl && (
          <div className="mt-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-cyan-400 leading-relaxed">
              🌐 <span className="font-bold">统一访问网址</span>（电脑端和手机端都用这一个）
              <br />
              <span className="text-cyan-300 font-bold text-base select-all">{phoneUrl}</span>
              <br />
              <span className="text-cyan-400/70">电脑浏览器直接打开；手机与电脑连同一 WiFi 后打开同一个网址，创建房间 / 加入房间都可以</span>
            </p>
          </div>
        )}

        {/* 系统商城入口 */}
        <button
          onClick={onOpenShop}
          className="mt-6 w-full py-3 bg-yellow-600/20 border border-yellow-500/40 text-yellow-400 font-bold rounded-lg hover:bg-yellow-600/30 transition-all flex items-center justify-center gap-2"
        >
          <span className="text-xl">🛒</span> 系统商城
        </button>

        {/* 好友系统入口：好友列表 / 添加好友 / 好友申请 / 私聊 */}
        <button
          onClick={() => setShowFriends(true)}
          className="mt-3 w-full py-3 bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold rounded-lg hover:bg-blue-600/30 transition-all flex items-center justify-center gap-2"
        >
          <span className="text-xl">👥</span> 好友
          {totalUnread + requests.length > 0 && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
              {totalUnread + requests.length}
            </span>
          )}
        </button>

        {/* 人机对战难度选择（1v1 专用） */}
        <div className="mt-3">
          <p className="text-xs text-gray-400 mb-2 text-center">🤖 人机对战难度（1v1 快捷）</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'normal', label: '普通', desc: '随机道具', color: 'border-green-500/40 text-green-400 bg-green-600/20' },
              { key: 'medium', label: '中等', desc: '3道具·0.3秒', color: 'border-yellow-500/40 text-yellow-400 bg-yellow-600/20' },
              { key: 'hard', label: '困难', desc: '全道具·0.1秒', color: 'border-red-500/40 text-red-400 bg-red-600/20' },
            ] as const).map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setAiDifficulty(d.key)}
                className={`py-2 px-1 rounded-lg border text-sm font-bold transition-all ${
                  aiDifficulty === d.key
                    ? `${d.color} scale-105`
                    : 'bg-primary/40 border-accent/20 text-gray-400 hover:text-white'
                }`}
              >
                {d.label}
                <span className="block text-[10px] font-normal opacity-70">{d.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleAIPlay}
          disabled={!playerName.trim()}
          className="mt-2 w-full py-3 bg-purple-600/20 border border-purple-500/40 text-purple-400 font-bold rounded-lg hover:bg-purple-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-xl">🤖</span> 开始人机对战（{({ normal: '普通', medium: '中等', hard: '困难' } as const)[aiDifficulty]}）
        </button>
        <p className="text-xs text-gray-500 mt-2 text-center">
          中等：开局 3 道具、占领 CD 0.3 秒；困难：全部道具、占领 CD 0.1 秒；玩家无任何限制
        </p>

        {/* 大厅聊天：所有在线玩家可见 */}
        <div className="mt-4">
          <ChatPanel
            title="大厅聊天"
            messages={lobbyMessages}
            onSend={(msg) => sendLobbyChat(playerName || '匿名', msg)}
            placeholder="和所有在线玩家聊天..."
            maxHeightClass="max-h-32"
            selfId={playerId}
          />
        </div>
      </div>

      {/* 创建房间的人机配置弹窗 */}
      {showAIModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-secondary rounded-2xl p-6 w-full max-w-sm border border-accent/30 shadow-2xl">
            <h2 className="text-xl font-bold text-accent mb-4 text-center">🤖 人机配置</h2>
            <p className="text-sm text-gray-400 mb-4 text-center">
              创建房间前可选择是否加入 AI 玩家
            </p>

            {/* 开启 AI 开关 */}
            <div className="flex items-center justify-between bg-primary/40 rounded-lg p-3 mb-4">
              <div>
                <p className="text-white font-medium">加入 AI 玩家</p>
                <p className="text-xs text-gray-500 mt-1">开启后房间会自动加入 N 个 AI</p>
              </div>
              <button
                type="button"
                onClick={() => setEnableAI((v) => !v)}
                className={`w-12 h-7 rounded-full transition-colors relative ${
                  enableAI ? 'bg-accent' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                    enableAI ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* AI 难度选择 + 数量选择（仅开启时显示） */}
            {enableAI && (
              <div className="bg-primary/40 rounded-lg p-3 mb-4 space-y-3">
                {/* 难度选择 */}
                <div>
                  <p className="text-sm text-gray-400 mb-2">AI 难度</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: 'normal', label: '普通', desc: '最多6个', color: 'border-green-500/40 text-green-400 bg-green-600/20' },
                      { key: 'medium', label: '中等', desc: '最多4个', color: 'border-yellow-500/40 text-yellow-400 bg-yellow-600/20' },
                      { key: 'hard', label: '困难', desc: '最多3个', color: 'border-red-500/40 text-red-400 bg-red-600/20' },
                    ] as const).map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => handleRoomDifficultyChange(d.key)}
                        className={`py-2 px-1 rounded-lg border text-sm font-bold transition-all ${
                          roomAIDifficulty === d.key
                            ? `${d.color} scale-105`
                            : 'bg-primary/40 border-accent/20 text-gray-400 hover:text-white'
                        }`}
                      >
                        {d.label}
                        <span className="block text-[10px] font-normal opacity-70">{d.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI 数量 */}
                <div>
                  <p className="text-sm text-gray-400 mb-2">AI 数量</p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={decAI}
                      className="w-10 h-10 rounded-lg bg-primary/60 border border-accent/30 text-accent text-xl font-bold hover:bg-accent/20"
                    >
                      −
                    </button>
                    <input
                      type="text"
                      value={aiCountInput}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const v = e.target.value.replace(/[^0-9]/g, '');
                        const max = MAX_AI_BY_DIFF[roomAIDifficulty];
                        const n = v === '' ? '' : String(Math.min(max, parseInt(v, 10)));
                        setAiCountInput(n);
                      }}
                      className="flex-1 text-center bg-primary/50 border border-accent/30 rounded-lg px-2 py-2 text-white text-xl font-bold"
                    />
                    <button
                      type="button"
                      onClick={incAI}
                      className="w-10 h-10 rounded-lg bg-primary/60 border border-accent/30 text-accent text-xl font-bold hover:bg-accent/20"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    你 + 朋友 + AI ≤ 7（当前难度最多 {MAX_AI_BY_DIFF[roomAIDifficulty]} 个 AI）
                  </p>
                </div>
              </div>
            )}

            {/* 按钮组 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAIModal(false);
                  setEnableAI(false);
                  setAiCountInput('1');
                  setRoomAIDifficulty('normal');
                }}
                className="flex-1 py-2 rounded-lg bg-primary/50 border border-gray-500/40 text-gray-300 hover:bg-primary/70"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmCreate}
                className="flex-1 py-2 rounded-lg bg-accent text-primary font-bold hover:bg-accent/90"
              >
                确认创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 改名弹窗：消耗 1 张改名卡改新名字 */}
      {renameOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-secondary rounded-2xl p-6 w-full max-w-sm border border-accent/30 shadow-2xl">
            <h2 className="text-xl font-bold text-accent mb-2 text-center">✏️ 使用改名卡</h2>
            <p className="text-xs text-gray-400 mb-4 text-center leading-relaxed">
              当前持有改名卡：{getItemCount('rename_card')} 张，确认改名将消耗 1 张
              <br />
              好友列表、好友申请与私聊记录会自动迁移到新名字
            </p>
            <input
              type="text"
              value={newNameInput}
              onChange={(e) => {
                setNewNameInput(e.target.value);
                setRenameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleRenameConfirm();
                }
              }}
              placeholder={`当前名字：${playerName}`}
              maxLength={12}
              autoFocus
              className="w-full bg-primary/50 border border-accent/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors text-center"
            />
            {renameError && (
              <p className="mt-2 text-xs text-danger text-center">{renameError}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                className="flex-1 py-2 rounded-lg bg-primary/50 border border-gray-500/40 text-gray-300 hover:bg-primary/70 transition-all"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleRenameConfirm}
                disabled={!newNameInput.trim() || isRenaming}
                className="flex-1 py-2 rounded-lg bg-accent text-primary font-bold hover:bg-accent/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRenaming ? '正在检查...' : '确认改名'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 改名广播醒目提示：所有在线玩家（含改名者自己）都能看到"XX 改名为 YY" */}
      {renameToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] bg-yellow-500/15 border border-yellow-500/50 text-yellow-300 px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold max-w-sm text-center">
          {renameToast}
        </div>
      )}

      {/* 好友面板：好友列表 / 添加好友 / 好友申请 / 私聊 */}
      {showFriends && (
        <FriendsPanel myName={playerName.trim()} onClose={() => setShowFriends(false)} />
      )}

      {/* 好友系统全局通知（好友面板关闭时也能看到申请/通过/拒绝提醒） */}
      {friendNotice && !showFriends && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 px-5 py-2.5 rounded-lg shadow-lg text-sm max-w-sm text-center">
          🔔 {friendNotice}
        </div>
      )}
    </div>
  );
}
