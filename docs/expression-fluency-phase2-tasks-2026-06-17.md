# Phase 2 任务清单：4-3-2 限时复述 + 新旧录音对比

**Date:** 2026-06-17
**Design:** [superpowers/specs/2026-06-16-expression-fluency-training-design.md](superpowers/specs/2026-06-16-expression-fluency-training-design.md) §7 Phase 2
**Builds on:** [expression-fluency-phase1-tasks-2026-06-16.md](expression-fluency-phase1-tasks-2026-06-16.md)

> 单次练习的内容是一句短句而非独白，故不用字面 4/3/2 秒。保留技术内核——**同一目标连说 3 遍、时间预算递减**，逼出自动化。
> "新旧对比" = 用户**最初 produce-first 录音 vs 速度轮最后一遍**（均为内存中已有录音，复用 `userRecordings`，不引入音频存储层）。
> 跨 session 音频对比需要 IndexedDB，明确延后到后续阶段。

---

## P2-T1 ｜ 速度轮纯逻辑 + 测试
- **做什么**：`speedRoundBudgetsMs(text)` 按词数算出 3 个递减、clamp 过的录音时间预算；`improvementMs(durations)` 算首末用时差。
- **文件**：`src/lib/speed-round.ts`、`tests/speed-round.test.ts`
- **验收**：预算单调递减且在边界内；improvement 正负号正确。

## P2-T2 ｜ MicButton 支持自定义时间预算
- **做什么**：新增可选 `timeBudgetMs?`，存在时覆盖 `estimateRecordingLimitMs`。不传则行为不变。
- **文件**：`src/components/MicButton.tsx`
- **验收**：旧调用行为不变；速度轮可传更紧的预算。

## P2-T3 ｜ SpeedRound 组件（3 遍递减 + 对比面板）
- **做什么**：揭晓后出现"Speed Round"，对目标句连说 3 遍，预算递减；每遍存录音 + 用时；3 遍后并排回放"第一遍 vs 最后一遍" + 用时差与鼓励文案。
- **文件**：`src/components/SpeedRound.tsx`
- **验收**：能完成 3 遍；每遍可回放；对比面板显示用时差，更快时给正向反馈。

## P2-T4 ｜ 接入 session（practice 模式、揭晓后）
- **做什么**：practice 模式 user turn 揭晓后渲染 SpeedRound，target = 已揭晓的 sampleAnswer，baseline = 该 turn 的 produce-first 录音。turn 切换时清理。
- **文件**：`src/app/session/page.tsx`
- **验收**：揭晓后可进入速度轮；可跳过直接 Continue；切题时状态/录音清理。

## P2-T5 ｜ 回归
- **做什么**：`npm test`、`npm run lint`、`npm run build`、`npm run start -- -p 6688` 实测路由。
- **验收**：构建/测试通过；无新增 lint 错误。

---

## 进度
- [x] P2-T1 速度轮逻辑（`speedRoundBudgetsMs`/`improvementMs` + 6 单测）
- [x] P2-T2 MicButton 时间预算（可选 `timeBudgetMs`，不传行为不变）
- [x] P2-T3 SpeedRound 组件（3 遍递减 + 第一遍 vs 最后一遍并排回放 + 用时差文案）
- [x] P2-T4 接入 session（practice 模式揭晓后，按 turn `key` 重置，baseline=该 turn 的 produce-first 录音）
- [x] P2-T5 回归（31 单测通过 / build 通过 / lint 无新增错误 / `/session`=200）

### 已知遗留（后续阶段）
- 跨 session 音频对比（"一个月前 vs 今天"）需 IndexedDB 持久化音频，未做。
- 速度轮的"起说延迟"暂用整段用时近似；真正的首词延迟需 Azure word timing（Phase 3）。
- 速度轮成绩未落库（不计入 `Session`），目前只做"当下即时胜利"，趋势化属 Phase 3。
