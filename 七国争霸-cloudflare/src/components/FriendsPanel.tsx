import React, { useState, useEffect } from 'react';
import { useFriendsStore } from '../stores/friendsStore';
import { useSocket } from '../hooks/useSocket';
import ChatPanel from './ChatPanel';

interface FriendsPanelProps {
  myName: string;
  onClose: () => void;
}

type Tab = 'list' | 'add' | 'requests';

/**
 * 好友面板（大厅弹窗）：
 * - 好友列表：在线状态、删除好友、点击打开私聊
 * - 添加好友：按名字搜索发送申请
 * - 好友申请：通过 / 不通过
 * - 私聊：与好友一对一聊天，保留历史记录
 */
export default function FriendsPanel({ myName, onClose }: FriendsPanelProps) {
  const { friends, requests, messages, unread, activePeer, notice } = useFriendsStore();
  const { addFriend, acceptFriend, rejectFriend, removeFriend, sendFriendChat, loadChatHistory } = useSocket();
  const [tab, setTab] = useState<Tab>('list');
  const [addName, setAddName] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null); // 二次确认删除

  // 收到通知 4 秒后自动清除
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useFriendsStore.getState().setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // 切到私聊视图时拉取历史记录
  useEffect(() => {
    if (activePeer) {
      loadChatHistory(myName, activePeer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePeer]);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  const handleAdd = () => {
    const target = addName.trim();
    if (!target) return;
    if (target === myName) {
      useFriendsStore.getState().setNotice('不能添加自己为好友');
      return;
    }
    addFriend(myName, target);
    setAddName('');
  };

  // 把好友私聊消息映射为 ChatPanel 的 ChatMessage 结构
  const peerMessages = activePeer
    ? (messages[activePeer] || []).map((m) => ({
        senderId: m.from,
        senderName: m.from,
        message: m.message,
        time: m.time,
        system: false,
      }))
    : [];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-secondary rounded-2xl w-full max-w-md border border-accent/30 shadow-2xl flex flex-col max-h-[85vh]">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="text-lg font-bold text-accent flex items-center gap-2">
            👥 好友
            {(totalUnread > 0 || requests.length > 0) && (
              <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {totalUnread + requests.length}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-primary/60 border border-accent/30 text-gray-300 hover:text-white transition-all"
          >
            ✕
          </button>
        </div>

        {/* Tab 切换（私聊视图时隐藏） */}
        {!activePeer && (
          <div className="flex gap-2 px-4 pb-2">
            {([
              { key: 'list', label: `好友列表${totalUnread > 0 ? ` (${totalUnread})` : ''}` },
              { key: 'add', label: '添加好友' },
              { key: 'requests', label: `好友申请${requests.length ? ` (${requests.length})` : ''}` },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all relative ${
                  tab === t.key
                    ? 'bg-accent text-primary'
                    : 'bg-primary/50 text-gray-400 hover:text-white'
                }`}
              >
                {t.label}
                {t.key === 'requests' && requests.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                    {requests.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* 通知条 */}
        {notice && (
          <div className="mx-4 mb-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 text-xs text-cyan-300">
            {notice}
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
          {/* 私聊视图 */}
          {activePeer ? (
            <div className="flex flex-col gap-2 h-full">
              <button
                type="button"
                onClick={() => useFriendsStore.getState().setActivePeer(null)}
                className="self-start text-xs text-gray-400 hover:text-white transition-colors"
              >
                ← 返回好友列表
              </button>
              <ChatPanel
                title={`与 ${activePeer} 私聊`}
                messages={peerMessages}
                onSend={(msg) => sendFriendChat(myName, activePeer, msg)}
                placeholder={`给 ${activePeer} 发消息...`}
                maxHeightClass="max-h-72"
                selfId={myName}
              />
            </div>
          ) : tab === 'list' ? (
            /* 好友列表 */
            <div className="space-y-2">
              {friends.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-6">
                  还没有好友，去"添加好友"搜索玩家名字吧
                </p>
              ) : (
                friends.map((f) => (
                  <div
                    key={f.name}
                    className="bg-primary/50 rounded-lg px-3 py-2.5 border border-accent/20 flex items-center gap-2"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${f.online ? 'bg-green-400' : 'bg-gray-600'}`} />
                    <button
                      type="button"
                      onClick={() => useFriendsStore.getState().setActivePeer(f.name)}
                      className="flex-1 text-left text-sm text-white hover:text-accent transition-colors min-w-0"
                    >
                      <span className="font-bold">{f.name}</span>
                      {unread[f.name] ? (
                        <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                          {unread[f.name]}
                        </span>
                      ) : null}
                      <span className="block text-[10px] text-gray-500">
                        {f.online ? '在线' : '离线'} · 点击私聊
                      </span>
                    </button>
                    {confirmRemove === f.name ? (
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            removeFriend(myName, f.name);
                            setConfirmRemove(null);
                            useFriendsStore.getState().setNotice(`已删除好友 ${f.name}`);
                          }}
                          className="px-2 py-1 bg-red-600 text-white text-[10px] font-bold rounded"
                        >
                          确认删
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(null)}
                          className="px-2 py-1 bg-gray-600 text-white text-[10px] rounded"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(f.name)}
                        title="删除好友"
                        className="px-2 py-1 bg-red-600/20 border border-red-500/40 text-red-400 text-[10px] font-bold rounded hover:bg-red-600/40 transition-all shrink-0"
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : tab === 'add' ? (
            /* 添加好友 */
            <div className="space-y-3 py-2">
              <p className="text-xs text-gray-400 leading-relaxed">
                输入对方的游戏名字发送好友申请，对方在线会立即收到通知，通过后你们就可以私聊了。
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                  placeholder="输入玩家名字"
                  maxLength={12}
                  className="flex-1 bg-primary/50 border border-accent/30 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!addName.trim()}
                  className="px-4 py-2.5 bg-accent text-primary text-sm font-bold rounded-lg hover:bg-accent/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  发送申请
                </button>
              </div>
            </div>
          ) : (
            /* 好友申请 */
            <div className="space-y-2">
              {requests.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-6">暂无好友申请</p>
              ) : (
                requests.map((from) => (
                  <div
                    key={from}
                    className="bg-primary/50 rounded-lg px-3 py-2.5 border border-yellow-500/30"
                  >
                    <p className="text-sm text-white mb-2">
                      📨 <span className="font-bold text-yellow-400">{from}</span> 请求添加你为好友
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => acceptFriend(myName, from)}
                        className="flex-1 py-1.5 bg-green-600/80 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-all"
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectFriend(myName, from)}
                        className="flex-1 py-1.5 bg-gray-600/80 text-white text-xs font-bold rounded-lg hover:bg-gray-600 transition-all"
                      >
                        不通过
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
