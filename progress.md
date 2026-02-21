Original prompt: 排查一下有什么bug

- 初始化排查：建立 progress.md，准备进行静态检查与运行时复现。

- 已安装依赖并完成基础验证：`npm run lint`、`npm run build` 均通过。
- 已运行 Playwright 自动化：输出截图于 `output/web-game/shot-0.png` ~ `shot-2.png`，未发现控制台报错文件。
- 静态排查发现疑似缺陷：
  1) 玩家受击采用 `Math.max(1, amount - armor)` 且按帧传入 `10 * dt`，导致每帧至少扣 1 HP，护甲几乎失效。
  2) 磁铁掉落只给半径 1000 内宝石经验，但会清空全部宝石。
  3) 宝石/掉落吸附时除以 `dist`，在 `dist === 0` 时会出现 NaN。
  4) 经验可能跨多级时，仅触发一次升级，剩余经验不会在同帧继续结算。

- 修复完成（src/game/engine.ts）:
  1) 受击公式改为按时间缩放护甲减伤，移除每帧最小 1 点扣血。
  2) 宝石/掉落吸附新增 `dist > 0.0001` 保护，避免除零 NaN。
  3) 磁铁改为结算全部宝石 XP 后再清空，避免吞经验。
  4) 增加 `maybeTriggerLevelUp()`；拾取与升级结束后检查，支持多级经验连续弹升级。
- 验证：`npm run lint` 与 `npm run build` 通过。
- Playwright 回归：`output/web-game-fix2/shot-0.png`、`shot-1.png` 可见进入实机画面，无 `errors-*.json`。
- Boss 频率检查：当前代码没有“每分钟固定 Boss 战”；仅有 `spawnSnake()` 中 `gameTime > 30` 后 5% 概率生成 `isElite` 长蛇（不是按分钟必出）。

- 执行“年度最佳冲刺计划”第一版落地（架构+系统）：
  - 新增类型与接口：RunConfig/RunSeed/EncounterDef/BossDef/WeaponDef/PassiveDef/RuneDef/BuildSnapshot/DifficultyTier/PlatformInputMode。
  - 新增导演系统 `src/game/director.ts`（seed RNG、事件节拍、Boss调度、难度缩放）。
  - 新增输入系统 `src/game/input.ts`（桌面键盘与移动虚拟摇杆统一）。
  - 新增数据驱动内容 JSON：`src/game/content/{encounters,bosses,weapons,passives,runes}.json`。
  - 引擎重构 `src/game/engine.ts`：
    - 新 API: `startRun(config)`, `applyPlayerChoice(choiceId)`, `getBuildSnapshot()`, `setInputMode(mode)`, `setVirtualJoystick(...)`。
    - 8 武器、10 被动、6 符文的升级池。
    - 多职责敌人（stalker/charger/ranged/summoner/shield/splitter/encircler）+ 三阶段 Boss 节点（4/8/12 分钟）。
    - `render_game_to_text` 与 `advanceTime` 挂载用于自动化验证。
  - UI 改造 `src/App.tsx`：
    - 增加 run 前难度选择、输入模式切换（Desktop/Mobile）。
    - 增加 `currentEncounter`、`bossPhase`、`buildTags`、`inputMode`、`difficultyTier` 显示。
    - 增加移动端单摇杆控制层并接入引擎 `setVirtualJoystick`。
- 配置更新：`tsconfig.json` 开启 `resolveJsonModule`。
- 验证：
  - `npm run lint` 通过。
  - `npm run build` 通过。
  - Playwright 回归：
    - `output/web-game-royal/` 与 `output/web-game-royal2/` 生成 gameplay 截图与 state JSON。
    - 无 `errors-*.json`。
    - `state-*.json` 含 encounter/bossPhase/build snapshot 等新增字段。

- 针对“拾取道具卡屏”追加修复（engine.ts）：
  1) `cross` 改为轻量清场结算：不再对每个敌人逐个触发 `takeDamage`（避免成百上千次命中音效/飘字/粒子/分裂链），改为批量击杀并聚合为直接 XP/Gold 奖励。
  2) 清场后立即清理 `enemyProjectiles`，并限制一次性特效爆发规模（`PURGE N` 文本 + 有上限的粒子）。
  3) `triggerLevelUp` / `triggerChest` 增加空选项兜底，防止极端情况下“暂停但无可选项”导致假死。
- 验证：`npm run lint`、`npm run build` 通过。
- Playwright 回归：`output/web-game-dropfix/` 无 `errors-*.json`，状态输出正常。

- 新需求实现：每分钟 Boss 战 + 蛇王 100+ 关节。
  - `engine.ts`：
    - 新增 `boss_segment` 敌人角色与 `isBossSegment` 标记。
    - 每满 60 秒触发一次 Boss 战（`spawnedBossMinutes`），触发时清空当前敌群并开新 Boss 回合。
    - Boss 改为蛇王长蛇：Boss 头 + `120+` 关节段（随分钟轻微增长）。
    - Boss 关节段在头部死亡后自动衰亡清理。
    - `cross` 清场逻辑跳过关节段奖励，避免异常收益。
  - `src/game/content/bosses.json`：改为 `snake-king` 定义。
- 验证：`npm run lint`、`npm run build` 均通过。
- 自动化回归：短回归通过；长时回归受脚本交互稳定性和生存时长限制，未完整跑满 60 秒场景。

- “偶发卡死”稳定性修复（engine.ts）：
  1) Boss 关节段更新改为轻量跟随路径，跳过普通敌人的大量逻辑，降低 CPU 峰值。
  2) 关节段不再进入 spatial hash，减少投射物/范围技能碰撞查询压力。
  3) 增加高压上限保护：particles/floatingTexts/enemyProjectiles/projectiles 数组做硬上限裁剪。
  4) 刷怪预算保护：敌人数量超阈值时抑制继续刷怪/召唤，避免实体失控增长。
  5) 蛇王关节数量保持 100+（当前 110+）。
- 验证：`npm run lint`、`npm run build` 通过。

- 修复“拾取道具后卡死”确定性问题：
  - 根因：`triggerChest()` 设为 `chestActive=true` 后，同帧末尾 `emitState()` 又强制覆盖为 `chestActive=false`，造成暂停但无弹窗（看起来像卡死）。
  - 处理：将 `chestActive/chestRewards` 改为引擎持久状态字段，由 `emitState()`真实透传；`applyUpgrade` / `triggerLevelUp` / `startRun` 时清理；`triggerChest` 空选项时主动恢复并发状态。
- 验证：`npm run lint`、`npm run build` 通过；Playwright 快速回归无 errors 产物。

- 本轮“针对性三项优化”已实现（src/game/engine.ts）：
  1) 中段决策密度：3-8 分钟新增强分叉节点，里程碑从 `3/5/7` 分钟扩展为 `3/4/5/6/7` 分钟；新增高代价分支 `tempo-spike/zone-anchor/drain-circuit` 与 `glass-cannon/bulwark-shift/tempo-inversion`，从中段开始强制改变构筑节奏。
  2) Boss 读招-惩罚-反击：
     - 新增 BossStrike 成败分支：吃招触发 `PUNISHED`（短暂易伤惩罚）；成功躲招触发更长 `COUNTER WINDOW`（Boss暴露窗口更明确）。
     - Boss 在暴露窗口内停止读招/远程压制，玩家可稳定反击。
     - 新增阶段转折事件 `handleBossPhaseShift`，P2/P3 切换时触发相位压迫技与提示文本，增强戏剧性。
  3) 经济与 cross 雪球：
     - `cross` 掉率继续下调并增加掉落冷却（拾取后 70s 内不再掉落）。
     - `cross` 伤害比例进一步削弱（普通/精英/Boss 30%/14%/4%），并对非击杀目标施加短暂减速而非直接清盘。
     - `cross` 经验收益增加上限，且触发更长过载惩罚（+20%受伤 8s）。

- 验证：
  - `npm run lint` 通过。
  - `npm run build` 通过。
  - Playwright 快速回归：`output/web-game-balance/` 生成 `shot/state` 文件，未生成 `errors-*.json`。
  - 长链路自动化受脚本吞吐限制（高帧步进成本较高），仅获得短样本：`output/web-game-midgame/`、`output/web-game-midgame2/`。

- 后续建议（下一轮可做）：
  1) 将 Boss 读招窗口状态（telegraph/punish/counter）显式映射到 HUD 文案，降低新手理解成本。
  2) 增加可配置的 cross 平衡参数表（JSON）并做 seed 化 AB 回放，提升调参效率。
  3) 给分叉节点增加“拒绝/刷新”经济选项，避免卡死在不想要的分支。

- 修复“拾取某些道具后偶发卡死”二次加固（彻底性修复）：
  - 根因层面处理：去掉升级弹窗对外部回调状态的单点依赖，改为引擎内持有 `upgradeActive/upgradeRewards` 作为单一事实源，并通过 `GameState` 透传到 UI。
  - 新增暂停一致性自愈：若引擎处于 `isPaused=true` 但不存在任何可交互弹窗（升级/宝箱均为空），自动清理暂停状态并恢复运行，避免“暂停无弹窗假死”。
  - `onLevelUp` 回调改为 `try/catch` 防护，即使 UI 回调异常也不会把游戏锁死。
  - 同步改造 UI（App.tsx）：升级弹窗改为读取 `gameState.upgradeActive + gameState.upgradeRewards`，不再依赖本地 `upgradeOptions`。

- 影响文件：
  - `src/game/types.ts`：`GameState` 新增 `upgradeActive`、`upgradeRewards`。
  - `src/game/engine.ts`：新增升级状态字段、暂停一致性检查、状态透传与回调容错。
  - `src/App.tsx`：升级弹窗状态源切换为 `gameState`。

- 验证：
  - `npm run lint` 通过。
  - `npm run build` 通过。
  - develop-web-game 客户端脚本仍存在菜单点击不稳定（历史已知）问题；补充手工 Playwright 校验：
    - `output/web-game-freezefix-manual-run.png`（实机画面）
    - 输出 state 含 `pausedUi`，验证无“paused但无弹窗”状态残留。
    - 控制台错误 `ERRORS []`。

- 新需求实现：将“最终Boss”调整为极低通关率（目标接近万分之一）
  - 文件：`src/game/engine.ts`
  - 关键机制：
    1) `minuteIndex >= 12` 时进入 Final Boss 形态（Doom Snake King）：
       - 血量倍增（最终乘区约 `*28`）、速度与体型显著提高。
       - 关节段数量提高到 `180+`。
    2) Final Boss 专属减伤与窗口：
       - 非暴露窗口仅吃约 `12%` 伤害；暴露窗口约 `95%` 伤害。
       - 暴露窗口更短，读招频率更高，远程压制更强。
    3) 末日倒计时（Doom Timer）：
       - Final Boss 开战即 85 秒湮灭倒计时。
       - 到时直接触发 `ANNIHILATED`（强制失败）。
       - 倒计时期间周期性环形打击 + 末段持续高压伤害。
    4) 可读性：
       - 遭遇名改为 `Final Boss · Doom Snake King`。
       - 屏幕顶部显示 `DOOM TIMER`。
       - Boss 血条标注 `DOOM`。

- 验证：
  - `npm run lint` 通过。
  - `npm run build` 通过。
  - 短实机 smoke（Playwright 直接点击 PLAY RUN + advanceTime）无错误，state 输出正常（`ERRORS []`）。

- 说明：
  - 该版本已将最终Boss设为“可赢但极难”，并通过限时湮灭把通关窗口压得非常窄。
  - 若需进一步逼近“万分之一”，可继续上调：倒计时缩短、非暴露减伤再降、末段持续伤害再升。
