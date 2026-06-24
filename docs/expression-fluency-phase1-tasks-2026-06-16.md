# Phase 1 任务清单：先产出，后揭晓

**Date:** 2026-06-16
**Design:** [superpowers/specs/2026-06-16-expression-fluency-training-design.md](superpowers/specs/2026-06-16-expression-fluency-training-design.md)
**Scope:** 把 user turn 从"看着完整参考句朗读"改成"先自己产出、判完方向后才揭晓范例 + 发音精修"。

> 现状：项目暂无测试运行器（`package.json` 只有 `lint`，无 `test`，无任何测试文件）。AGENTS.md 要求 TDD，故 T0 先把测试跑起来。
> 依赖：T0 → T1 →（T2、T4 并行）→ T3 → T5 →（T6、T7）→ T8。
> 关键路径：T1 → T2 → T4 → T5（打通即验证核心假设）。

---

## T0 ｜ 搭测试基建（前置）
- **做什么**：引入测试运行器（Vitest），加 `"test"` script，建立测试目录约定。
- **文件**：`package.json`、`vitest.config.ts`、`tests/` 或就近 `*.test.ts`
- **验收**：`npm test` 能跑；占位用例通过；`npm run build` 不受影响。

## T1 ｜ 类型层：锚点 + 脚手架字段（无行为变更）
- **做什么**：新增 `CoachPromptAnchor`；`ScriptTurn` 增 `anchor?`；`TurnResult` 增 `scaffoldLevel?`、`hintsUsed?`；`Session` 增 `avgScaffoldLevel?`、`expressionItemsMastered?`（占位）。全部可选。
- **文件**：`src/lib/types.ts`
- **测试先行**：旧 Script 无 anchor 仍合法。
- **验收**：`npm run build` 通过；旧 localStorage 数据可读。

## T2 ｜ 脚本生成产出锚点 + 规则兜底
- **做什么**：`/api/generate-script` 让模型为每个 user turn 产出 `intent / keyPoints / sampleAnswer`，归一化挂到 `turn.anchor`；无 AI key 或解析失败用规则兜底（`sampleAnswer = turn.text/hint`，keyPoints 抽名词/动词，intent 给通用值）。
- **文件**：`src/app/api/generate-script/route.ts`、`src/lib/fallback-scripts.ts`
- **测试先行**：`normalizeScript` 在带/不带/半残 anchor 三种输入；兜底函数对一句话产出非空 sampleAnswer + ≥1 keyPoint。
- **验收**：每个 user turn 都有可用 anchor；旧无 anchor 脚本不报错。

## T3 ｜ 脚本缓存/池子透传锚点
- **做什么**：确保 `anchor` 随脚本在内存缓存、文件缓存、`upsertFileCachedScript` 链路完整保留（同 `flowGuide` 处理）。
- **文件**：`src/lib/script-pool.ts`
- **测试先行**：存取带 anchor 的脚本字段不丢。
- **验收**：复用缓存脚本时锚点仍在。

## T4 ｜ `evaluate-line` 升级为「锚定式宽松判方向」
- **做什么**：请求体支持可选 `anchor`。级联：① 廉价闸门（非空/长度/乱码）② 有 anchor 时 LLM「只判在不在题、不判语法、不确定判通过」并参照 keyPoints；无 anchor 走现有宽松语义逻辑。报错/超时一律 fail-open。
- **文件**：`src/app/api/evaluate-line/route.ts`
- **测试先行**：在题/跑题/乱码/太短四类；无 anchor 走旧逻辑；LLM 失败 fail-open。
- **验收**：措辞不同但合理的通过；明显跑题不过；对的不被冤枉。

## T5 ｜ Session 呈现顺序：先产出，后揭晓（核心）
- **做什么**：user turn 默认隐藏完整参考句，只显示教练问题 + 一行 intent/关键词；用户先产出 → `evaluate-line`（带 anchor）→ 判完才揭晓 `sampleAnswer` + Flow Guide + Azure 发音 + 跟读。把"参考句卡片 + FlowGuide + AI Coach"整体从录音前移到产出后。
- **文件**：`src/app/session/page.tsx`
- **验收**：两模式都"先说后看范例"；揭晓后跟读、发音精修、follow-up 照常。

## T6 ｜ 提示阶梯（手动降档）+ 记录 scaffold/hints
- **做什么**："给点提示 💡"逐级降档：意图 → 关键词 → 完整句；记录 `scaffoldLevel`、`hintsUsed` 入 `TurnResult`，汇总进 `Session.avgScaffoldLevel`。
- **文件**：`src/components/PromptScaffold.tsx`（新增）、`src/app/session/page.tsx`、`src/lib/storage.ts`
- **测试先行**：降档逻辑与 hintsUsed 计数；avgScaffoldLevel 汇总。
- **验收**：卡住能逐级要提示、不卡死；session 记录脚手架等级与提示次数。

## T7 ｜ 模式语义对齐 + 文案
- **做什么**：让 practice/assessment 在"揭晓早晚、判定松紧"上真正有别；更新 warmup 模式说明。
- **文件**：`src/app/session/page.tsx`
- **验收**：用户能感知两模式差异。

## T8 ｜ 端到端验收 + 回归
- **做什么**：用设计文档 §8.3 四句问题手测；跑 `npm test`、`npm run lint`、`npm run build`；`npm run dev -- -p 6688` 实测。
- **验收**：先产出后揭晓闭环顺畅；跑题/乱码宽松拦截且 fail-open；构建/lint 通过。

---

## 进度

- [x] T0 测试基建（Vitest，`npm test`）
- [x] T1 类型层（`CoachPromptAnchor`、`ScriptTurn.anchor`、`TurnResult.scaffoldLevel/hintsUsed`、`Session.avgScaffoldLevel`）
- [x] T2 脚本生成锚点 + 兜底（`src/lib/anchor.ts`，prompt 升级，`ensureAnchors`）
- [x] T3 缓存透传（pool getters 经 `ensureAnchors`；锚点随 JSON 缓存保留）
- [x] T4 evaluate-line 锚定判方向（`quickVerdict`/`interpretAnswer`，fail-open）
- [x] T5 先产出后揭晓（practice 模式隐藏范例，判完才揭晓）
- [x] T6 提示阶梯 + 记录（`PromptScaffold.tsx`，`scaffoldLevel`/`hintsUsed`/`avgScaffoldLevel`）
- [x] T7 模式语义对齐（Practice=自由产出；Assessment=朗读发音打分）
- [x] T8 端到端验收（build + lint + 25 单测；server 启动，/session·/、/history=200；generate-script 真实返回锚点）

### 关键设计决策（实现时确定）
- **produce-first 仅作用于 Practice 模式**：Assessment 本质是"朗读固定句让 Azure 打发音分"，与"自由产出"互斥。这样两模式天然区分（同时满足 T7）。
- 仅依赖呈现顺序与 `evaluate-line` 升级，不依赖 Azure timing（留待 Phase 3）。
- 全部新字段可选，旧脚本/旧 session 数据照常工作。

### 已知遗留（不在 Phase 1 范围）
- 进度感知 UI（脚手架依赖度趋势 / 新旧录音并排）属 Phase 2/3。
- `avgScaffoldLevel` 已落库，但 history 页尚未展示。
- 预存的 lint 报错（home/history 的 set-state-in-effect、`.venv-kokoro` 被 lint）非本次引入。
