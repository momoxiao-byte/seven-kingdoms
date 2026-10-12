import { create } from 'zustand';

// 好友信息（online 由服务端实时计算）
export interface FriendInfo {
  name: string;
  online: boolean;
}

// 好友私聊消息
export interface FriendMsg {
  from: string;
  to: string;
  message: string;
  time: number;
}

interface FriendsState {
  myName: string; // 当前登录名（用于区分消息收发方）
  friends: FriendInfo[];
  requests: string[]; // 收到的好友申请（对方名字）
  messages: Record<string, FriendMsg[]>; // key = 好友名
  unread: Record<string, number>; // key = 好友名（未读私聊数）
  activePeer: string | null; // 当前正在聊天的好友（打开聊天面板的）
  notice: string | null; // 好友系统通知（好友申请/通过/拒绝等）
  setMyName: (name: string) => void;
  setFriendsData: (friends: FriendInfo[], requests: string[]) => void;
  setActivePeer: (peer: string | null) => void;
  receiveChat: (msg: FriendMsg) => void;
  setHistory: (peer: string, msgs: FriendMsg[]) => void;
  setNotice: (msg: string | null) => void;
  clearUnread: (peer: string) => void;
  markReadIfActive: (peer: string) => void;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  myName: '',
  friends: [],
  requests: [],
  messages: {},
  unread: {},
  activePeer: null,
  notice: null,

  setMyName: (name) => set({ myName: name }),

  setFriendsData: (friends, requests) =>
    set({
      friends,
      requests,
      // 同步时过滤掉已删除好友的未读
      unread: Object.fromEntries(
        Object.entries(get().unread).filter(([k]) => friends.some((f) => f.name === k))
      ),
    }),

  setActivePeer: (peer) => {
    set({ activePeer: peer });
    if (peer) get().clearUnread(peer);
  },

  // 收到私聊：追加消息；非当前聊天对象时累计未读
  receiveChat: (msg) => {
    const { myName, messages, unread, activePeer } = get();
    const peer = msg.from === myName ? msg.to : msg.from;
    const list = [...(messages[peer] || []), msg].slice(-200);
    const nextUnread = { ...unread };
    if (peer !== activePeer) {
      nextUnread[peer] = (nextUnread[peer] || 0) + 1;
    }
    set({ messages: { ...messages, [peer]: list }, unread: nextUnread });
  },

  setHistory: (peer, msgs) => {
    const { messages } = get();
    set({ messages: { ...messages, [peer]: msgs.slice(-200) } });
  },

  setNotice: (msg) => set({ notice: msg }),

  clearUnread: (peer) => {
    const { unread } = get();
    if (!unread[peer]) return;
    const next = { ...unread };
    delete next[peer];
    set({ unread: next });
  },

  // 若消息来自当前聊天对象，确保未读为 0（切面板瞬间兜底）
  markReadIfActive: (peer) => {
    if (get().activePeer === peer) get().clearUnread(peer);
  },
}));
