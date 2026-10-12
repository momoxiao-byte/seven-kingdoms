import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

// 好友数据条目：friends=好友名单，pending=申请加我为好友的人（等待我通过/拒绝）
interface FriendEntry {
  friends: string[];
  pending: string[];
}

// 账号记录：密码使用 scrypt + 随机盐哈希存储，绝不保存明文密码
interface AccountRecord {
  salt: string;
  hash: string;
  createdAt: number;
}

// 好友私聊消息
export interface FriendMsg {
  from: string;
  to: string;
  message: string;
  time: number;
}

// 数据目录固定在"本文件所在目录/data"（即 server/data），不依赖启动服务器时的工作目录 cwd：
// 无论从哪个目录、用哪个启动脚本启动，好友数据始终写在同一份 friends.json 里，
// 避免"换个启动方式 → 读到空数据，以为好友全丢了"。
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(SERVER_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'friends.json');
const NAMES_FILE = path.join(DATA_DIR, 'names.json'); // 全局名字注册表（防重名）
const USERS_FILE = path.join(DATA_DIR, 'users.json'); // 账号密码表（只存哈希）
const CHAT_HISTORY_MAX = 200; // 每对好友最多保留的私聊条数
const PASSWORD_MIN_LEN = 4;
const PASSWORD_MAX_LEN = 32;

/**
 * 好友系统管理器（以玩家名字为身份标识）：
 * - 添加好友：向目标发送申请，目标在线时实时通知，可 通过/拒绝
 * - 删除好友：双向解除
 * - 好友私聊：保留最近 CHAT_HISTORY_MAX 条，重启后仍可查看
 * - 数据持久化到 server/data/friends.json（改名时自动迁移）
 */
export class FriendsManager {
  private data: Record<string, FriendEntry> = {};
  // 名字 → socketId（在线状态跟踪）
  private online: Map<string, string> = new Map();
  // 私聊记录：key = 两个名字排序后用 | 连接
  private chats: Map<string, FriendMsg[]> = new Map();
  // 全局名字注册表：所有被使用过的名字（持久化到 names.json，防重名）
  private registeredNames: Set<string> = new Set();
  // 账号密码表：name → { salt, hash }（持久化到 users.json，只存哈希不存明文）
  private accounts: Record<string, AccountRecord> = {};
  private io: Server;

  constructor(io: Server) {
    this.io = io;
    // 启动即确保数据目录存在（首次运行时创建 server/data）
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
      console.error(`[FriendsManager] 创建好友数据目录失败: ${DATA_DIR}`, e);
    }
    this.load();
    this.loadNames();
    this.loadAccounts();
    // 把数据文件位置和加载量打印出来：重启后可立刻确认"好友数据从哪加载/是否还在"
    const userCount = Object.keys(this.data).length;
    console.log(`[FriendsManager] 好友数据文件: ${DATA_FILE}（已加载 ${userCount} 个玩家）`);
    console.log(`[FriendsManager] 名字注册表: ${NAMES_FILE}（已注册 ${this.registeredNames.size} 个名字）`);
    console.log(`[FriendsManager] 账号密码表: ${USERS_FILE}（已加载 ${Object.keys(this.accounts).length} 个账号）`);
  }

  // ---------- 名字注册表（防重名） ----------
  private loadNames(): void {
    try {
      if (fs.existsSync(NAMES_FILE)) {
        const raw = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'));
        if (Array.isArray(raw)) {
          for (const n of raw) {
            if (typeof n === 'string' && n) this.registeredNames.add(n);
          }
        }
      }
    } catch (e) {
      console.error('[FriendsManager] 读取 names.json 失败:', e);
    }
    // 把好友数据里已有的名字也纳入注册表（老数据兼容：升级前就存在的名字同样被占用）
    for (const name of Object.keys(this.data)) {
      this.registeredNames.add(name);
    }
  }

  private saveNames(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // 原子写：先写临时文件，再 rename 替换，防止写一半断电导致注册表损坏
      const tmpFile = path.join(DATA_DIR, `names.json.tmp-${process.pid}`);
      fs.writeFileSync(tmpFile, JSON.stringify([...this.registeredNames]), 'utf8');
      fs.renameSync(tmpFile, NAMES_FILE);
    } catch (e) {
      console.error('[FriendsManager] 写入 names.json 失败:', e);
    }
  }

  // 检查名字是否已被占用
  isNameTaken(name: string): boolean {
    return this.registeredNames.has(name);
  }

  // 注册新名字：成功返回 true；被占用返回 false
  registerName(name: string): boolean {
    if (!name || this.registeredNames.has(name)) return false;
    this.registeredNames.add(name);
    this.saveNames();
    return true;
  }

  // ---------- 账号密码（起名页注册 / 登录） ----------
  private loadAccounts(): void {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        if (raw && typeof raw === 'object') {
          for (const [name, rec] of Object.entries(raw)) {
            const r = rec as AccountRecord;
            if (name && r && typeof r.salt === 'string' && typeof r.hash === 'string') {
              this.accounts[name] = { salt: r.salt, hash: r.hash, createdAt: r.createdAt || 0 };
              this.registeredNames.add(name); // 有账号的名字一定是已注册名字
            }
          }
        }
      }
    } catch (e) {
      console.error('[FriendsManager] 读取 users.json 失败:', e);
    }
  }

  private saveAccounts(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // 原子写：先写临时文件，再 rename 替换，防止写一半断电导致账号表损坏
      const tmpFile = path.join(DATA_DIR, `users.json.tmp-${process.pid}`);
      fs.writeFileSync(tmpFile, JSON.stringify(this.accounts), 'utf8');
      fs.renameSync(tmpFile, USERS_FILE);
    } catch (e) {
      console.error('[FriendsManager] 写入 users.json 失败:', e);
    }
  }

  // scrypt 加盐哈希（64 字节），同一密码不同盐 → 不同哈希
  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  // 恒定时间比较，避免计时侧信道
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * 起名页统一入口（一个名字 + 一个密码，自动区分注册/登录）：
   * - 名字从未注册过 → 创建新账号（名字 + 密码一起登记）
   * - 名字已有账号   → 校验密码，正确才放行
   * - 老版本遗留名字（只在 names.json、没设过密码）→ 本次输入的密码直接绑定到该名字
   *   （老版本本来就没有密码，第一次输入者认领，兼容升级前的玩家数据）
   */
  authAccount(name: string, password: string): { ok: boolean; error?: string; isNew?: boolean } {
    const n = (name || '').trim().slice(0, 12);
    const pwd = password || '';
    if (!n) return { ok: false, error: '名字不能为空' };
    if (pwd.length < PASSWORD_MIN_LEN) {
      return { ok: false, error: `密码至少 ${PASSWORD_MIN_LEN} 位` };
    }
    if (pwd.length > PASSWORD_MAX_LEN) {
      return { ok: false, error: `密码最多 ${PASSWORD_MAX_LEN} 位` };
    }

    // 已有账号 → 校验密码
    const existing = this.accounts[n];
    if (existing) {
      if (!this.safeEqual(existing.hash, this.hashPassword(pwd, existing.salt))) {
        return { ok: false, error: '密码错误，再想想吧' };
      }
      return { ok: true, isNew: false };
    }

    // 没有账号记录 → 注册新账号（同时覆盖"老版本遗留名字首次绑定密码"的情况）
    const salt = crypto.randomBytes(16).toString('hex');
    this.accounts[n] = {
      salt,
      hash: this.hashPassword(pwd, salt),
      createdAt: Date.now(),
    };
    this.registeredNames.add(n);
    this.saveAccounts();
    this.saveNames();
    return { ok: true, isNew: true };
  }

  // ---------- 持久化 ----------
  private load(): void {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        this.data = raw?.friends || {};
        const chatsRaw = raw?.chats || {};
        for (const k of Object.keys(chatsRaw)) this.chats.set(k, chatsRaw[k]);
      }
    } catch (e) {
      console.error('[FriendsManager] 读取 friends.json 失败，使用空数据:', e);
      // 先备份损坏的文件，避免下一次 save() 用空数据把它覆盖、彻底无法恢复
      try {
        if (fs.existsSync(DATA_FILE)) {
          const bak = path.join(DATA_DIR, `friends.corrupted-${Date.now()}.json`);
          fs.copyFileSync(DATA_FILE, bak);
          console.error(`[FriendsManager] 损坏的数据文件已备份到: ${bak}`);
        }
      } catch {
        // 备份失败也不影响启动
      }
      this.data = {};
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const chatsObj: Record<string, FriendMsg[]> = {};
      for (const [k, v] of this.chats) chatsObj[k] = v;
      // 原子写：先写临时文件，再 rename 替换，防止写到一半进程退出/断电导致 JSON 损坏
      const tmpFile = path.join(DATA_DIR, `friends.json.tmp-${process.pid}`);
      fs.writeFileSync(tmpFile, JSON.stringify({ friends: this.data, chats: chatsObj }), 'utf8');
      fs.renameSync(tmpFile, DATA_FILE);
    } catch (e) {
      console.error('[FriendsManager] 写入 friends.json 失败:', e);
    }
  }

  private ensure(name: string): FriendEntry {
    if (!this.data[name]) this.data[name] = { friends: [], pending: [] };
    return this.data[name];
  }

  private chatKey(a: string, b: string): string {
    return [a, b].sort().join('|');
  }

  // ---------- 在线状态 ----------
  setOnline(name: string, socketId: string): void {
    if (!name) return;
    this.online.set(name, socketId);
  }

  setOffline(socketId: string): void {
    for (const [name, sid] of this.online) {
      if (sid === socketId) {
        this.online.delete(name);
        break;
      }
    }
  }

  isOnline(name: string): boolean {
    return this.online.has(name);
  }

  // 取玩家当前在线 socketId（不在线返回 undefined）
  getSocketId(name: string): string | undefined {
    return this.online.get(name);
  }

  // ---------- 查询 ----------
  getFriends(name: string): { name: string; online: boolean }[] {
    return (this.data[name]?.friends || []).map((f) => ({ name: f, online: this.isOnline(f) }));
  }

  getRequests(name: string): string[] {
    return [...(this.data[name]?.pending || [])];
  }

  // 发送某个玩家的完整好友数据到他的 socket
  pushDataTo(name: string): void {
    const sid = this.online.get(name);
    if (!sid) return;
    this.io.to(sid).emit('friendsData', {
      friends: this.getFriends(name),
      requests: this.getRequests(name),
    });
  }

  // ---------- 好友申请 ----------
  addRequest(from: string, target: string): { ok: boolean; error?: string } {
    if (!from || !target) return { ok: false, error: '名字不能为空' };
    if (from === target) return { ok: false, error: '不能添加自己为好友' };
    const fromEntry = this.ensure(from);
    const targetEntry = this.ensure(target);
    if (fromEntry.friends.includes(target)) return { ok: false, error: '你们已经是好友了' };
    if (targetEntry.pending.includes(from)) return { ok: false, error: '已发送过申请，等待对方处理' };
    if (targetEntry.friends.includes(from)) return { ok: false, error: '对方已把你加为好友，刷新后生效' };
    // 对方也给我发过申请 → 直接互加
    const myPending = fromEntry.pending.indexOf(target);
    if (myPending > -1) {
      fromEntry.pending.splice(myPending, 1);
      if (!fromEntry.friends.includes(target)) fromEntry.friends.push(target);
      if (!targetEntry.friends.includes(from)) targetEntry.friends.push(from);
      this.save();
      this.pushDataTo(from);
      this.pushDataTo(target);
      return { ok: true };
    }
    targetEntry.pending.push(from);
    this.save();
    // 目标在线 → 实时通知
    const sid = this.online.get(target);
    if (sid) {
      this.io.to(sid).emit('friendRequest', { from, time: Date.now() });
    }
    return { ok: true };
  }

  accept(me: string, from: string): void {
    const meEntry = this.ensure(me);
    const idx = meEntry.pending.indexOf(from);
    if (idx > -1) meEntry.pending.splice(idx, 1);
    const fromEntry = this.ensure(from);
    if (!meEntry.friends.includes(from)) meEntry.friends.push(from);
    if (!fromEntry.friends.includes(me)) fromEntry.friends.push(me);
    this.save();
    this.pushDataTo(me);
    this.pushDataTo(from);
    const fromSid = this.online.get(from);
    if (fromSid) {
      this.io.to(fromSid).emit('friendNotice', { message: `✅ ${me} 通过了你的好友申请，现在可以私聊了` });
    }
  }

  reject(me: string, from: string): void {
    const meEntry = this.ensure(me);
    const idx = meEntry.pending.indexOf(from);
    if (idx > -1) meEntry.pending.splice(idx, 1);
    this.save();
    this.pushDataTo(me);
    const fromSid = this.online.get(from);
    if (fromSid) {
      this.io.to(fromSid).emit('friendNotice', { message: `❌ ${me} 拒绝了你的好友申请` });
    }
  }

  removeFriend(me: string, target: string): void {
    const meEntry = this.ensure(me);
    const targetEntry = this.ensure(target);
    meEntry.friends = meEntry.friends.filter((f) => f !== target);
    targetEntry.friends = targetEntry.friends.filter((f) => f !== me);
    this.save();
    this.pushDataTo(me);
    this.pushDataTo(target);
  }

  // ---------- 改名迁移：旧名字数据整体搬到新名字 ----------
  // 返回值：{ ok: true } 成功；{ ok: false, error } 失败（新名字被占用时不迁移、不消耗任何数据）
  migrateName(oldName: string, newName: string): { ok: boolean; error?: string } {
    if (!oldName || !newName || oldName === newName) return { ok: false, error: '名字无效' };
    // 新名字已被别人占用 → 拒绝改名（自己占用的不算：改名前旧名是自己，新名不能是任何已注册名）
    if (this.registeredNames.has(newName)) {
      return { ok: false, error: `名字"${newName}"已被占用，换一个吧` };
    }
    const entry = this.data[oldName];
    if (entry) {
      delete this.data[oldName];
      this.data[newName] = entry;
    }
    // 所有人的好友列表和待处理申请里的旧名替换
    for (const k of Object.keys(this.data)) {
      const e = this.data[k];
      e.friends = e.friends.map((f) => (f === oldName ? newName : f));
      e.pending = e.pending.map((f) => (f === oldName ? newName : f));
    }
    // 私聊记录 key 与消息内名字替换
    const nextChats = new Map<string, FriendMsg[]>();
    for (const [k, msgs] of this.chats) {
      const nk = k === oldName ? newName : k.split('|').map((n) => (n === oldName ? newName : n)).join('|');
      const nm = msgs.map((m) => ({
        ...m,
        from: m.from === oldName ? newName : m.from,
        to: m.to === oldName ? newName : m.to,
      }));
      nextChats.set(nk, nm);
    }
    this.chats = nextChats;
    // 在线表替换 key
    if (this.online.has(oldName)) {
      const sid = this.online.get(oldName)!;
      this.online.delete(oldName);
      this.online.set(newName, sid);
    }
    // 名字注册表：释放旧名、占用新名（改名后旧名可以被其他人注册）
    this.registeredNames.delete(oldName);
    this.registeredNames.add(newName);
    // 账号密码随名字一起迁移：改名后仍用原来的密码登录新名字
    if (this.accounts[oldName]) {
      this.accounts[newName] = this.accounts[oldName];
      delete this.accounts[oldName];
    }
    this.saveAccounts();
    this.saveNames();
    this.save();
    return { ok: true };
  }

  // ---------- 私聊 ----------
  pushChat(from: string, to: string, message: string): FriendMsg {
    const msg: FriendMsg = { from, to, message, time: Date.now() };
    const key = this.chatKey(from, to);
    const list = this.chats.get(key) || [];
    list.push(msg);
    if (list.length > CHAT_HISTORY_MAX) list.splice(0, list.length - CHAT_HISTORY_MAX);
    this.chats.set(key, list);
    // 私聊记录落盘可以放宽（每次写盘开销小，数据量有限）
    this.save();
    return msg;
  }

  getChat(a: string, b: string): FriendMsg[] {
    return [...(this.chats.get(this.chatKey(a, b)) || [])];
  }
}
