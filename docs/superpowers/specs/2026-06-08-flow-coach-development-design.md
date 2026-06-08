# Flow Coach Development Design

**Date:** 2026-06-08
**Status:** Ready for development planning
**Scope:** 在现有英语口语练习项目中加入连读、弱读、语调的一套式教学指导能力。

---

## 1. 目标

把连读、弱读、语调做成一个可复用的 Flow Coach 教学层，让学习者每次练一句话时都能按同一套顺序获得指导：

1. 找信息焦点：哪些词要重读。
2. 压缩背景词：哪些功能词要弱读。
3. 连接词边界：哪些词应该连成语流块。
4. 调整说话意图：句尾和核心词使用什么语调。

这套能力必须兼容当前已经实现的功能：

- `MicButton` 继续负责录音和提交音频。
- `/api/pronunciation-assess` 继续作为 assessment mode 的 Azure 发音评分入口。
- `/api/pronunciation-coach` 继续作为 AI Coach 反馈入口。
- 现有 `PronunciationCoachFeedback`、AI Coach 卡片、follow-up practice 继续可用。
- practice mode 的低压力语义通过逻辑不被打断。

---

## 2. 第一性原理

英语自然度的底层问题不是单词逐个发准，而是语流是否符合重音节奏。

基础事实：

1. 英语是 stress-timed language，信息词承载重音，功能词通常被压缩。
2. 连读是语流省力的结果，不是装饰规则。
3. 弱读让重点词更突出，不是把小词读错。
4. 语调表达说话意图，例如确认、疑问、委婉、惊讶。
5. 学习反馈要从意义单元出发，而不是只从单词错误出发。

因此产品反馈顺序应固定为：

```text
focus words -> weak forms -> linking -> intonation -> micro-practice
```

评分归 Azure，教学归 Flow Coach。Azure 负责判断发音和流利度，Flow Coach 负责把评分信号翻译成学习者能执行的一步动作。

---

## 3. 当前系统边界

### 3.1 已有客户端流程

当前 session 页中，assessment mode 的录音链路是：

```text
MicButton
  -> POST /api/pronunciation-assess
  -> handleTranscript(transcript, assessment, audio)
  -> POST /api/pronunciation-coach
  -> render AI Coach tips
  -> optional follow-up practice
```

practice mode 的录音链路是：

```text
MicButton
  -> POST /api/transcribe
  -> POST /api/evaluate-line
  -> pass/fail progression
```

### 3.2 已有 API 和类型

`PronunciationAssessment` 当前核心字段：

```ts
interface PronunciationAssessment {
  transcript?: string;
  pass: boolean;
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  words?: {
    word: string;
    accuracyScore?: number;
    errorType?: string;
  }[];
}
```

`PronunciationCoachFeedback` 当前核心字段：

```ts
interface PronunciationCoachFeedback {
  summary: string;
  tips: PronunciationCoachTip[];
  retryPrompt: string;
}
```

兼容原则：

- 不删除字段。
- 不改变现有字段语义。
- 新字段必须可选。
- 没有 Flow Coach 数据时，旧反馈逻辑必须继续工作。

---

## 4. 推荐架构

采用三层增强架构：

```text
Reference sentence
  -> Flow guide generation
  -> Existing pronunciation assessment
  -> Coach feedback with Flow context
```

### 4.1 Flow Guide 层

对参考句进行教学标注，生成学习者录音前可看的提示。

```ts
interface ConnectedSpeechGuide {
  text: string;
  focusWords: Array<{
    word: string;
    reason: string;
  }>;
  weakForms: Array<{
    word: string;
    weakForm: string;
    strongForm?: string;
    reason: string;
  }>;
  linkedPhrases: Array<{
    text: string;
    cue: string;
    type: "consonant-vowel" | "vowel-vowel" | "same-consonant" | "reduction";
  }>;
  intonation: {
    contour: "falling" | "rising" | "fall-rise" | "rise-fall";
    tonalWord?: string;
    reason: string;
  };
  teachingPrompt: string;
}
```

### 4.2 Flow Analysis 层

结合 Azure assessment 和 guide，判断本次最值得纠正的问题。

MVP 阶段只使用已有字段：

- `fluencyScore < 75`：优先怀疑节奏、连读、停顿问题。
- `accuracyScore < 75` 或 word-level error：优先纠具体发音。
- `completenessScore < 80`：优先处理漏词或吞句。
- 没有明显低分时：给弱读或语调自然度建议。

V2 阶段再加入 word timing：

```ts
interface PronunciationAssessmentWord {
  word: string;
  accuracyScore?: number;
  errorType?: string;
  offsetMs?: number;
  durationMs?: number;
}
```

有 timing 后，才能做真正的 inter-word gap 检测。

### 4.3 Coach Feedback 层

继续使用 `/api/pronunciation-coach` 作为反馈入口，但允许传入可选 Flow 上下文。

```ts
interface PronunciationCoachRequest {
  referenceText: string;
  transcript?: string;
  assessment: PronunciationAssessment;
  connectedSpeechGuide?: ConnectedSpeechGuide;
  connectedSpeechAnalysis?: ConnectedSpeechAnalysis;
}
```

返回值仍保持：

```ts
PronunciationCoachFeedback
```

这样前端可以先不改 AI Coach 卡片结构，只改文案质量和 practiceText 选择。

---

## 5. API 设计

### 5.1 新增 `POST /api/connected-speech-guide`

用途：为一句参考文本生成录音前教学提示。

Request:

```ts
{
  text: string;
  previousCoachLine?: string;
  level?: "A2" | "B1" | "B2" | "C1";
}
```

Response:

```ts
ConnectedSpeechGuide
```

失败策略：

- AI key 缺失或 LLM 失败时，返回规则兜底结果。
- 规则兜底至少识别常见弱读词和简单辅音加元音连读。
- 不因 guide 生成失败阻塞 session。

### 5.2 增强 `POST /api/pronunciation-coach`

当前请求保持可用：

```ts
{
  referenceText: string;
  transcript?: string;
  assessment: PronunciationAssessment;
}
```

新增可选字段：

```ts
{
  connectedSpeechGuide?: ConnectedSpeechGuide;
  connectedSpeechAnalysis?: ConnectedSpeechAnalysis;
}
```

Prompt 规则：

- 最多返回 2 条 tips。
- 如果存在 word-level 发音错误，保留一条 pronunciation tip。
- 如果 fluencyScore 低，优先返回一条 Flow tip。
- Flow tip 必须包含一个可跟读短语，放入 `practiceText`。
- 不向用户提 Azure、API、JSON、算法。

### 5.3 后续增强 `/api/pronunciation-assess`

V2 时扩展 words 字段：

```ts
words?: {
  word: string;
  accuracyScore?: number;
  errorType?: string;
  offsetMs?: number;
  durationMs?: number;
  phonemes?: {
    phoneme: string;
    accuracyScore?: number;
  }[];
}[]
```

这一步保持向后兼容。旧 UI 忽略新增字段即可。

---

## 6. 前端设计

### 6.1 录音前 Flow Guide

在当前参考句卡片下方增加一个紧凑指导区。

信息顺序：

```text
Focus: PICK / UP / WORK
Weak: to -> /tə/
Link: pick it up -> pick-it-up
Tone: falling statement
```

交互要求：

- assessment mode 默认显示。
- practice mode 可显示简化版，但不影响快速练习。
- guide 加载失败时隐藏，不显示错误。
- 点击参考句 TTS 按钮仍使用现有 `speakLine`。

建议新增组件：

```text
src/components/FlowGuide.tsx
```

### 6.2 录音后 AI Coach

继续使用现有 AI Coach 卡片。

改动点：

- tip type 可以继续使用 `"naturalness"` 表示 Flow 类建议。
- `target` 可以填 linked phrase，例如 `"pick it up"`。
- `practiceText` 优先使用短语，不强制整句重读。
- follow-up practice 继续复用现有 `MicButton mode="assessment"`。

### 6.3 后续可选展示

V2 再考虑新增独立卡片：

```text
Flow Coach
  Rhythm: Needs smoother linking
  Try: pick-it-up
  Record this phrase
```

MVP 不需要新增复杂 UI，避免拖慢排期。

---

## 7. 分阶段排期

### Phase 1: Coach-only MVP

目标：不改 Azure assessment 结构，先把教学指导接入现有反馈链路。

工作项：

1. 新增 `ConnectedSpeechGuide`、`ConnectedSpeechAnalysis` 可选类型。
2. 新增 `/api/connected-speech-guide`。
3. 在 session 中为当前 user turn 拉取 guide。
4. 增强 `/api/pronunciation-coach` prompt，接收 guide。
5. 前端在参考句下方显示 Flow Guide。
6. AI Coach 中优先展示一条 Flow 类建议。

验收标准：

- assessment mode 中，用户录音前能看到 focus、weak、link、tone。
- 录音后 AI Coach 至少能在 fluency 较低时给出连读或节奏建议。
- follow-up practice 能继续使用短语级 practiceText。
- 没有 AI key 时 session 不崩溃，仍可使用兜底反馈。

### Phase 2: Timing-based Detection

目标：从“教学建议”升级到“基于语音 timing 的检测”。

工作项：

1. 从 Azure detailed result 中解析 word offset 和 duration。
2. 扩展 `PronunciationAssessment.words` 的可选 timing 字段。
3. 新增纯函数 `analyzeConnectedSpeech(assessment, guide)`。
4. 用 inter-word gap 检测 linked phrase 是否断开。
5. 将 `connectedSpeechAnalysis` 注入 `/api/pronunciation-coach`。

验收标准：

- 对 guide 中的 linked phrase，能计算相邻词 gap。
- gap 超阈值时，AI Coach 明确指出具体短语。
- 没有 timing 字段时自动退回 Phase 1 逻辑。

### Phase 3: Intonation Analysis

目标：让语调从文本指导升级到音高反馈。

工作项：

1. 客户端用 Web Audio API 提取 pitch contour。
2. 对比句尾 contour 和 guide 中的 expected contour。
3. 只给轻量反馈，不把语调作为 pass/fail 硬门槛。

验收标准：

- 陈述句明显升调时提示使用 falling tone。
- 疑问句明显降调时提示尝试 rising tone。
- pitch 分析失败时不影响发音评估。

---

## 8. 测试计划

### 8.1 单元测试

建议覆盖：

- guide fallback 规则。
- weak form 识别。
- linked phrase 识别。
- coach request schema 校验。
- timing gap 计算。

### 8.2 API 测试

建议覆盖：

- `/api/connected-speech-guide` 正常返回结构化 guide。
- AI key 缺失时返回 fallback guide。
- `/api/pronunciation-coach` 在没有 guide 时保持旧行为。
- `/api/pronunciation-coach` 在有 guide 时返回 speakable `practiceText`。

### 8.3 手动验收样例

使用以下句子验收：

```text
I have to pick it up after work.
Can you send it over to me?
I want to talk about it later.
Would you like a cup of tea?
```

每句至少验证：

- focus words 是否合理。
- weak forms 是否不过度标注。
- linked phrases 是否可跟读。
- intonation reason 是否符合句子意图。
- feedback 不超过 2 条，且能执行。

### 8.4 回归测试

每次代码改动后至少运行：

```bash
npm run build
```

如果改动涉及 lint/type-sensitive 文件，也运行项目已有 lint 或 typecheck 命令。

---

## 9. 风险和约束

### 9.1 Azure timing 不是当前返回字段

当前 `/api/pronunciation-assess` 的 `words` 只暴露 `word`、`accuracyScore`、`errorType`。因此 Phase 1 不能依赖 gap 检测，只能用 guide 加 fluency 做教学判断。

缓解：把 timing 检测放到 Phase 2，字段设计为可选。

### 9.2 弱读不能简单等于低准确度

弱读是自然语流现象，不是“读错”。Azure accuracy 高或低都不能单独证明弱读好坏。

缓解：Phase 1 把弱读作为指导，不作为硬评分。Phase 2 再结合 timing、duration、phoneme 数据改进判断。

### 9.3 语调缺少 pitch 数据

当前 Azure result 不直接提供可用的 pitch contour。

缓解：Phase 1 只给文本指导。Phase 3 用客户端音高分析做增强。

### 9.4 反馈过载

同一句同时纠发音、连读、弱读、语调会让学习者崩溃。

缓解：每次最多两条 tips，其中最多一条 Flow tip。系统始终选择最值得改的一点。

---

## 10. 开发任务拆分

建议排期单位：

1. 类型和 fallback 规则：0.5 天。
2. `/api/connected-speech-guide`：1 天。
3. session 拉取和缓存 guide：0.5 天。
4. `FlowGuide` UI：1 天。
5. `/api/pronunciation-coach` prompt 增强：0.5 天。
6. API 和 fallback 测试：1 天。
7. 端到端手动验收和 build 修复：0.5 天。

Phase 1 合计约 4.5 到 5 个开发日。

Phase 2 预计 3 到 4 个开发日，取决于 Azure detailed result 的 timing 字段解析复杂度。

Phase 3 预计 4 到 6 个开发日，主要风险在 pitch 提取稳定性和移动端浏览器表现。

---

## 11. 决策结论

采用 Flow Coach 作为兼容增强层：

- 不替换现有 assessment mode。
- 不改变现有 pass/fail 机制。
- 不把连读、弱读、语调做成独立考试。
- 先用结构化 guide 改善教学反馈。
- 后续再用 timing 和 pitch 数据提升检测精度。

这能在最小改动下验证核心价值：学习者是否能从“逐词读准”转向“按意义和节奏成组表达”。
