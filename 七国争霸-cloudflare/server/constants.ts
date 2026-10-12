// 游戏常量
export const GAME_CONSTANTS = {
  TOTAL_LANDS: 200,
  TOTAL_PLAYERS: 7,
  INITIAL_TECH: 2,
  INITIAL_RESOURCES: 10,
  INITIAL_GOLD: 10000,
  INITIAL_PRODUCTIVITY: 1,
  TECH_UPGRADE_COST: 5000,
  PRODUCTIVITY_UPGRADE_COST: 1000,
  MORALE_UPGRADE_COST: 15000,
  RELOCATE_CAPITAL_COST: 20000,
  EXCHANGE_RESOURCES_AMOUNT: 2,
  EXCHANGE_GOLD_AMOUNT: 100,
  OCCUPY_COST: 2500,
  OCCUPY_REWARD_MIN: 1000,
  OCCUPY_REWARD_MAX: 5000,

  // ---- 占领敌方领地相关 ----
  // 占领敌方领地消耗：金币 3000；如果金币不够，也允许消耗 1 级士气代替（=士气也能用）
  OCCUPY_ENEMY_COST_GOLD: 3000,
  OCCUPY_ENEMY_COST_MORALE: 1, // 士气抵扣时需要消耗多少士气等级
  OCCUPY_ENEMY_FIXED_REWARD_GOLD: 5000, // 占领敌方领地固定奖励
  OCCUPY_ENEMY_PRODUCTIVITY_GAIN: 1, // 每占领 1 块敌方领地增加的生产力

  // ---- 士气产生效果 ----
  // 士气等级会：
  //   1) 在战斗中直接加入攻防计算（攻方 1:1，防方 2:1 即 1 士气 = 0.5 防御点）
  //   2) 每 TICK_GOLD_EVERY 秒，每个领土按士气等级产金 morale * MORALE_GOLD_PER_LAND 金币
  //   3) 攻击敌方领地时可抵扣 OCCUPY_ENEMY_COST_GOLD（如果金币不足）
  MORALE_ATTACK_RATIO: 1,      // 士气→攻击值 转换系数
  MORALE_DEFENSE_RATIO: 0.5,    // 士气→防御值 转换系数
  MORALE_TICK_GOLD_EVERY: 10,   // 每 N 秒结算一次士气产金
  MORALE_GOLD_PER_LAND_PER_LEVEL: 1, // 每 N 秒 · 每领土 · 每士气等级 产多少金币

  GAME_TIME_LIMIT: 40 * 60,
  ELIMINATION_GOLD_THRESHOLD: 100,
  ELIMINATION_RESOURCES_THRESHOLD: 5,
  NPC_ATTACK_TECH_THRESHOLD: 3,

  // ---- 占领类动作的冷却时间（个人 0.5 秒，不同玩家互不影响）----
  // 每次触发 occupyLand / attackLand / attackPlayer 都会触发该玩家自己的共享冷却，
  // 0.5 秒内再次点击会被拒绝并提示剩余毫秒（其他玩家仍可自由操作）。
  OCCUPY_ACTION_COOLDOWN_MS: 500,

  // ---- 季节系统 ----
  SEASON_DURATION_MS: 10 * 60 * 1000, // 每 10 分钟切换一次季节
  // 春季：占领费用 -20%；夏季：士气产金 +50%；秋季：道具掉落率提升；冬季：所有 CD 翻倍

  // ---- 联盟/外交系统 ----
  NAP_BREAK_COOLDOWN_MS: 3 * 60 * 1000, // 撕毁条约后 3 分钟内不能攻击对方

  // ---- 税收/附庸系统 ----
  VASSAL_TAX_RATE: 0.10,        // 附庸每 60 秒缴纳 10% 产金
  VASSAL_TAX_INTERVAL_MS: 60 * 1000,
  VASSAL_LIBERATION_COST_MULT: 2, // 独立战争需 2 倍金币攻打宗主国首都

  // ---- 胜利条件 ----
  VICTORY_CONQUEST_PERCENT: 0.50,  // 征服胜利：占领 50% 以上地图
  VICTORY_ECONOMIC_GOLD: 100000,   // 经济胜利：金币累积达到 100000
  VICTORY_TECH_LEVEL: 10,          // 科技胜利：科技等级达到 10
  VICTORY_DIPLOMATIC_ALLIANCES: 3,  // 外交胜利：与 3 个以上玩家建立联盟

  // ---- 间谍侦察系统 ----
  SPY_COST: 3000,  // 派遣间谍花费

  // ---- 新道具 ----
  // 侦察卡：30 货币 → 揭示 3 块随机敌方领地的归属与主人金币
  // 闪电卡：100 货币 → 本回合占领 CD 归零（限1次/局）
  // 幸运卡：100 货币 → 下次占领奖励翻 3 倍
  // 反弹卡：60 货币 → 被攻击时反弹 50% 伤害给攻击方（持续60秒）
  // 预言卡：100 货币 → 显示所有敌方玩家的金币数
  // 高级盲盒：500 货币 → 保证开出稀有道具
};

// 生成20x10平铺六边形网格相邻关系 (200个格子)
function generateAdjacency(): { [key: number]: number[] } {
  const COLS = 20;
  const ROWS = 10;
  const adj: { [key: number]: number[] } = {};

  for (let id = 0; id < COLS * ROWS; id++) {
    const row = Math.floor(id / COLS);
    const col = id % COLS;
    const isOddRow = row % 2 === 1;
    const neighbors: number[] = [];

    if (col + 1 < COLS) neighbors.push(id + 1);       // E
    if (col - 1 >= 0) neighbors.push(id - 1);            // W

    if (isOddRow) {
      if (row + 1 < ROWS && col + 1 < COLS) neighbors.push(id + COLS + 1); // NE
      if (row + 1 < ROWS) neighbors.push(id + COLS);                        // NW
      if (row - 1 >= 0 && col + 1 < COLS) neighbors.push(id - COLS + 1);    // SE
      if (row - 1 >= 0) neighbors.push(id - COLS);                          // SW
    } else {
      if (row + 1 < ROWS) neighbors.push(id + COLS);                        // NE
      if (row + 1 < ROWS && col - 1 >= 0) neighbors.push(id + COLS - 1);   // NW
      if (row - 1 >= 0) neighbors.push(id - COLS);                          // SE
      if (row - 1 >= 0 && col - 1 >= 0) neighbors.push(id - COLS - 1);     // SW
    }

    adj[id] = neighbors.sort((a, b) => a - b);
  }
  return adj;
}

export const LAND_ADJACENCY: { [key: number]: number[] } = generateAdjacency();
