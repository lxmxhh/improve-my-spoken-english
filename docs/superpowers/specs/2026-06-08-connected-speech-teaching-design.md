# Connected Speech Teaching System Design

**Date:** 2026-06-08  
**Status:** Design proposal

---

## 1. 第一性原理推导

### 1.1 问题的本质是什么？

中国学习者说英语听起来不自然，根本原因不是发音不准，而是**节奏类型不同**：

- **中文**是音节时序语言（syllable-timed）：每个音节等时长，"我-去-北-京"
- **英文**是重音时序语言（stress-timed）：重读音节等时长，非重读音节被压缩

这意味着：中国学习者把每个英语单词都清晰地"发"出来，在英语母语者听来，反而像机器人在说话。

**连读、弱读、语调**不是英语的"特技"，而是重音时序语言的**必然结果**：
- **弱读**：非重读音节自然被压缩（function words 永远不重读）
- **连读**：相邻音节为了保持节奏流畅而融合（辅元连读）
- **语调**：重读音节上的音高变化承载意义（信息焦点）

### 1.2 学习者真正需要什么？

按照**习得顺序**排列：

1. **听出差异**：听到自然英语中连读/弱读的存在（感知）
2. **理解规则**：知道"为什么"这样读（内化）
3. **模仿产出**：说出接近自然节奏的句子（产出）
4. **获得反馈**：知道自己产出是否达标（校正）
5. **反复强化**：对薄弱点进行专项练习（巩固）

### 1.3 我们有什么技术能力？

| 数据来源 | 可用信号 |
|---|---|
| Azure Pronunciation Assessment | word-level 准确度、错误类型（Omission/Insertion/Mispronunciation）、fluency score、phoneme 级别数据 |
| Azure word timing | 每个单词的起止时间（毫秒级），可以检测 inter-word gap |
| 参考文本 | 已知标准文本，可以预标注连读/弱读/语调 |
| LLM | 生成可操作的自然语言反馈 |

**关键洞察**：Azure 的 fluency score 本质上反映的是节奏，inter-word gap 过大意味着没有连读，function words 的 accuracyScore 异常高意味着没有弱读（把 "to" 读成了 /tuː/ 而非 /tə/）。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                  Pre-Session Phase                       │
│                                                         │
│  ScriptTurn text                                        │
│       ↓                                                 │
│  /api/annotate-speech                                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  LLM analyzes text and marks:                   │   │
│  │  - Linked groups: {pick_it_up}                  │   │
│  │  - Weak form targets: [to]/tə, [and]/ən         │   │
│  │  - Primary stress: PICK it up                   │   │
│  │  - Intonation contour: ↘ (falling)              │   │
│  └─────────────────────────────────────────────────┘   │
│       ↓                                                 │
│  SpeechAnnotation (cached per turn)                     │
└─────────────────────────────────────────────────────────┘
           ↓ displayed to user before recording

┌─────────────────────────────────────────────────────────┐
│                  Recording Phase                         │
│                                                         │
│  User records audio                                     │
│       ↓                                                 │
│  /api/pronunciation-assess (existing)                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Azure returns:                                 │   │
│  │  - pronunciationScore, fluencyScore, etc.       │   │
│  │  - word[].accuracyScore + errorType             │   │
│  │  - word[].offset + duration (timing)            │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
           ↓

┌─────────────────────────────────────────────────────────┐
│                  Analysis Phase (new)                    │
│                                                         │
│  /api/analyze-connected-speech (new)                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Input: Azure results + SpeechAnnotation        │   │
│  │                                                 │   │
│  │  Checks:                                        │   │
│  │  1. Linking gaps: inter-word pause > threshold  │   │
│  │     in annotated linked groups → linking miss   │   │
│  │  2. Weak forms: function word accuracyScore >   │   │
│  │     90 in weak-form group → over-articulated    │   │
│  │  3. Rhythm: fluencyScore breakdown per phrase   │   │
│  │  4. Intonation: final-word pitch trajectory     │   │
│  │     (approximated via Azure phoneme duration)   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
           ↓

┌─────────────────────────────────────────────────────────┐
│                  Feedback Phase                          │
│                                                         │
│  /api/pronunciation-coach (enhanced)                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Input: ConnectedSpeechAnalysis + assessment    │   │
│  │                                                 │   │
│  │  LLM generates:                                 │   │
│  │  - 1 specific linking fix with example          │   │
│  │  - 1 weak form fix with phonetic comparison     │   │
│  │  - Practice drill sentence                      │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
           ↓

┌─────────────────────────────────────────────────────────┐
│                  Micro-Practice Phase                    │
│                                                         │
│  Show focused drill: isolated phrase with issue         │
│  → TTS plays natural version                            │
│  → User records just that phrase                        │
│  → Score only fluency/rhythm (not accuracy)             │
│  → Pass if rhythm improves                              │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 数据结构

```ts
// 预标注结果（LLM 生成，per turn 缓存）
interface SpeechAnnotation {
  text: string;

  // 连读组：哪些词应该连在一起读
  linkedGroups: Array<{
    words: string[];          // e.g. ["pick", "it", "up"]
    naturalForm: string;      // e.g. "pick-it-up" (spoken as one unit)
    type: "consonant-vowel" | "vowel-vowel" | "t-linking" | "intrusive-r";
  }>;

  // 弱读词：哪些功能词应该被弱化
  weakForms: Array<{
    word: string;             // e.g. "to"
    strongForm: string;       // e.g. "/tuː/"
    weakForm: string;         // e.g. "/tə/"
    note?: string;            // e.g. "before consonants"
  }>;

  // 重音模式（标注哪个词承载信息焦点）
  stressPattern: Array<{
    word: string;
    level: "primary" | "secondary" | "unstressed";
  }>;

  // 语调轮廓
  intonation: {
    contour: "falling" | "rising" | "fall-rise" | "rise-fall";
    note: string;             // e.g. "Falling: definite statement"
    tonalWord: string;        // 语调核心词（tonic syllable 所在词）
  };
}

// 连读分析结果（基于 Azure timing 数据 + 标注）
interface ConnectedSpeechAnalysis {
  linkingIssues: Array<{
    phrase: string;           // e.g. "pick it up"
    expectedGapMs: number;   // 连读时应有的词间间隔（约 0ms）
    actualGapMs: number;     // 用户实际的词间间隔
    severity: "minor" | "major";
  }>;

  weakFormIssues: Array<{
    word: string;
    expectedForm: string;    // e.g. "/tə/"
    overArticulated: boolean; // true = 用户把 weak form 读成了 strong form
  }>;

  rhythmScore: number;        // 0-100，基于 fluencyScore + 连读分析综合
  intonationFeedback: string; // e.g. "Your sentence ended with a rising tone. For statements, use falling intonation."

  topIssue: "linking" | "weak-forms" | "rhythm" | "intonation" | null;
}
```

---

## 4. 核心检测算法

### 4.1 连读检测

Azure 返回每个 word 的 `offset`（起始时间，单位 100ns tick）和 `duration`。

```
gap(word_A, word_B) = word_B.offset - (word_A.offset + word_A.duration)

if (word_A, word_B) ∈ linkedGroup AND gap > LINKING_GAP_THRESHOLD_MS:
  → 连读缺失
```

**阈值设定：**
- 自然连读的词间间隔通常 < 50ms
- 缺乏连读时通常 > 100ms
- 建议阈值：`LINKING_GAP_THRESHOLD_MS = 80`

### 4.2 弱读检测

Function words（a, the, to, for, and, of, at, from, have, has, was, were, be, been, can, could, would, should, do, does, some, any）在非句末、非强调位置应该弱读。

检测方法：
- 若 Azure 返回这些词的 `accuracyScore > 88`，说明用户把每个音都清晰地发出来了（over-articulated）
- 结合 phoneme 数据：若 "to" 的元音被识别为 /uː/ 而非 /ə/，说明使用了 strong form

> ⚠️ 注意：Azure 的"高准确度"在这里反而是问题信号——它意味着用户读得太"正确"了。

### 4.3 语调近似检测

Azure 提供 phoneme 级别的时长数据。结合以下规则近似推断语调：

- **下降调**：句末关键词的最后一个音节时长显著拉长（母语者结束时自然降调延长）
- **上升调**：句末时长相对短且发音更清晰（问句结尾通常时长更均匀）

> 这是近似检测，精确语调分析需要 pitch 数据（Azure 不直接提供）。精准方案在 Phase 2 可引入 praat.js 做客户端音高分析。

---

## 5. UI 展示设计

### 5.1 录音前：标注文本展示

```
Coach says:  "Can you pick it up for me?"

Your line:   Can you ˈpick-it-ˌup for me?
             ~~~~   [连读]    [弱: fər]

Stress:      PICK is the focus word
Intonation:  ↘ Falling (polite request confirmation)
```

用颜色和图标区分：
- 🔗 下划线 = 连读组
- 🔈 灰色小字 = 弱读标注
- **粗体** = 主重音词
- ↘↗ 箭头 = 语调方向

### 5.2 录音后：反馈卡片

```
┌─────────────────────────────────────────────────┐
│ Pronunciation: 82  Fluency: 68  Rhythm: 61      │
│                                                 │
│ 🔗 Linking issue detected                       │
│ "pick it up" — you paused between words         │
│ Try: "picki-tup" (one flowing unit)             │
│ [▶ Hear natural version]                        │
│                                                 │
│ 🔈 Weak form tip                                │
│ "for" → say /fər/, not /fɔːr/                   │
│                                                 │
│ [Practice this phrase] [Move on]                │
└─────────────────────────────────────────────────┘
```

### 5.3 Micro-Practice（针对连读的专项小练习）

触发条件：linking issue severity = "major" 或 rhythm score < 60

流程：
1. 提取问题短语（如 "pick it up"）
2. TTS 播放自然版本（强制使用 Qwen-TTS 的自然语速，不可调慢）
3. 用户跟读该短语
4. 只评估 fluency score，不评估 accuracy score
5. 通过门槛：fluency > 75，即可继续

---

## 6. API 设计

### 6.1 新增：`POST /api/annotate-speech`

**用途：** 对参考文本进行连读/弱读/语调标注（LLM 完成，结果缓存在 script 里）

**Request:**
```ts
{
  text: string;           // 参考文本
  turnContext?: string;   // 上下句语境（可选，提升语调判断准确性）
}
```

**Response:** `SpeechAnnotation`

**缓存策略：** 以 `text` 的 hash 为 key，缓存在 `Script.turns[i].annotation`，不重复调用 LLM。

---

### 6.2 新增：`POST /api/analyze-connected-speech`

**用途：** 结合 Azure 结果和标注，检测连读/弱读问题

**Request:**
```ts
{
  azureResult: PronunciationAssessment & { wordTimings: WordTiming[] };
  annotation: SpeechAnnotation;
}
```

**Response:** `ConnectedSpeechAnalysis`

**注意：** 这是纯计算逻辑（无 LLM），在服务端执行，延迟 < 20ms。

---

### 6.3 增强：`POST /api/pronunciation-coach`

在现有 prompt 中增加 connected speech 上下文：

```
Additional context:
- Linked groups in this sentence: {linkedGroups}
- Words that should be weakened: {weakForms}
- Detected issues: {ConnectedSpeechAnalysis.topIssue}

Generate feedback that:
1. Addresses the top connected speech issue specifically
2. Gives a concrete phonetic example (e.g., "say /pɪkɪtʌp/ not /pɪk ɪt ʌp/")
3. Provides a one-sentence practice drill targeting only that issue
```

---

## 7. 实施计划

### Phase 1（MVP，2 周）

**目标：** 在现有 session 流程中嵌入连读标注和基础反馈

| 任务 | 实现方式 |
|---|---|
| 实现 `/api/annotate-speech` | LLM prompt，结果存入 ScriptTurn.annotation |
| 实现连读 gap 检测算法 | 纯 TypeScript，server-side |
| 实现弱读过度发音检测 | 基于 Azure word accuracyScore 阈值 |
| 增强 `/api/pronunciation-coach` | 在 prompt 中注入 annotation context |
| UI：录音前显示标注文本 | 在 CoachLine 组件下方展示 |
| UI：录音后显示 connected speech 卡片 | 新组件 `ConnectedSpeechCard` |

**成功指标：**
- 用户在录音前能看到连读/弱读标注
- 发音评估后能看到至少 1 条连读具体建议
- 不影响现有 practice/assessment 流程

---

### Phase 2（语调精准化，后续迭代）

- 引入客户端 **pitch 分析**（Web Audio API + autocorrelation 算法）
- 生成用户语调曲线 vs 标准语调曲线的可视化对比
- 使用 Azure Neural TTS 生成带情感/语调变化的示范音频（而非 flat TTS）

---

### Phase 3（自适应专项练习）

- 记录每个用户的连读错误模式（按 error type 分组）
- 每天在 session 开始前安排 2 分钟**针对性热身**：专门练习用户最常出错的连读类型
- 例：用户 /t/ + vowel 连读长期失败 → 每天开始前练 5 个含该模式的句子

---

## 8. 风险与局限

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| Azure 不提供 pitch 数据 | 语调检测只能近似 | Phase 1 用文字反馈代替，Phase 2 加客户端 pitch 分析 |
| 弱读检测误报 | 句末或强调位置的功能词应该用 strong form | 在标注阶段让 LLM 标注哪些词"此处不弱读" |
| 连读 gap 阈值因人而异 | 快语速 vs 慢语速阈值不同 | 结合整句的平均语速动态调整阈值 |
| LLM 标注质量不稳定 | 标注可能有误 | 加校验层：只标注有高置信度的连读类型（辅元连读是最规则、最可靠的） |

---

## 9. 发音相似度：找出"哪一段"出了问题

### 9.1 方案一：透传 Azure Phoneme 数据（低成本，已有能力）

**现状：** `/api/pronunciation-assess` 已经向 Azure 请求了 phoneme 粒度的数据，但当前代码只把 `word[]` 层传回前端，phoneme 层被丢弃。

**Azure 返回的完整结构：**

```
Sentence
└── Word[]
    ├── word: "pick"
    ├── accuracyScore: 91
    ├── errorType: "None"
    └── Phoneme[]
        ├── { phoneme: "p", accuracyScore: 95 }
        ├── { phoneme: "ɪ", accuracyScore: 88 }
        └── { phoneme: "k", accuracyScore: 94 }
```

**改动：** 仅修改 `/api/pronunciation-assess` 的返回结构，把 `phoneme[]` 透传到前端。

**前端展示：**

```
Can you  [pick]  it up for me?
          p  ✓
          ɪ  ✓
          k  ✓

[want]  →  w ✓  ɒ ✗(68)  n ✓  t ✓
                  ↑ 这个音发得不准
```

用颜色编码：绿色 ≥85，黄色 70-84，红色 <70。

**局限：** Azure 只告诉你"哪个音低分"，不告诉你"你实际发的是什么音"——没有错误音标对应。

**实施成本：** 极低。只需修改 route.ts 的返回逻辑 + 前端增加 phoneme 展示组件。

---

### 9.2 方案二：DTW 声学相似度对比（中等成本，真正的"段级相似度"）

**原理：**

DTW（Dynamic Time Warping，动态时间规整）是语音识别领域的经典算法，专门用于对比两段语速不同的语音。它能：
- 给出整体相似度（0-100）
- 找出哪个时间段偏离最大
- 不受语速差异影响（stretch/compress 时间轴后再对比）

**数据流：**

```
用户录音 ──ffmpeg抽样──→ MFCC特征向量序列A (13维 × N帧)
                                                  ↘
                                                   DTW对齐 → 相似度 + 偏离段
                                                  ↗
TTS参考音 ──ffmpeg抽样──→ MFCC特征向量序列B (13维 × M帧)
         ↑
  /api/tts-say 生成（Qwen-TTS，已有）
```

**与 Azure word timing 结合：**

Azure 已提供每个词的 `offset`（起始时间，100ns 单位）和 `duration`，可以把 DTW 找出的"偏离时间段"精确映射到对应的词或短语：

```
DTW偏离区间: [1.2s, 1.8s]
Azure word timing:
  "pick"  offset=1.1s  duration=0.3s
  "it"    offset=1.4s  duration=0.2s  ← 落在偏离区间
  "up"    offset=1.6s  duration=0.3s  ← 落在偏离区间

→ 反馈: "pick **it up** 这部分与标准发音差异最大"
```

**MFCC 提取：** 使用 `ffmpeg` 可直接提取（服务端已有 ffmpeg 依赖）。DTW 算法本身 <100 行 TypeScript，无需额外依赖。

**前端展示（可视化）：**

```
标准发音:  ──────────────────────────────────────────
用户发音:  ──────────────────═══════════─────────────
                              ↑ 偏离最大区域
                              "it up" (相似度 54%)

整体相似度: 78%
最大偏离片段: "it up" → 建议连读为 /ɪtʌp/
```

**实施步骤：**

1. `/api/tts-say` 生成参考音频并返回（已有）
2. 服务端新增 `/api/compare-pronunciation` 端点：
   - 接收用户音频 + 参考文本
   - 调用 `/api/tts-say` 生成参考音频
   - ffmpeg 提取双方 MFCC
   - 运行 DTW
   - 结合 Azure word timing 映射偏离段
   - 返回相似度 + 偏离段列表
3. 前端展示相似度 + 高亮问题词/短语

**新增数据类型：**

```ts
interface SimilarityAnalysis {
  overallSimilarity: number;       // 0-100，整体声学相似度
  segments: Array<{
    words: string[];               // 对应的词
    startSec: number;
    endSec: number;
    similarity: number;            // 0-100，该片段相似度
    suggestion?: string;           // e.g. "Try linking 'it up' as /ɪtʌp/"
  }>;
  worstSegment: {
    words: string[];
    similarity: number;
  } | null;
}
```

**局限：**
- MFCC 只比较声学频谱特征，不区分"发音不准"vs"节奏不对"——需要结合 Azure phoneme 数据才能定性
- 生成 TTS 参考音频增加约 500-1000ms 延迟（可以在用户录音期间并行请求）
- Qwen-TTS 的语速和真人母语者有差异，相似度分数仅作参考，不作为 pass/fail 依据

---

### 9.3 两个方案的组合策略

| | 方案一（Phoneme 透传） | 方案二（DTW 相似度） |
|---|---|---|
| **能回答什么** | 词内哪个**音素**发错了 | 句内哪个**片段**整体偏离最大 |
| **粒度** | 音素级 | 短语/词组级 |
| **告诉用户** | "这个音 /ɒ/ 发得不准" | "这段 'it up' 和标准差异最大" |
| **实施成本** | 极低（修改现有 API） | 中等（新增端点 + DTW 算法） |
| **延迟影响** | 无 | +500-1000ms（可并行） |
| **排期建议** | P0，下一个迭代 | P1，独立排期 |

两者互补：方案一定位"哪个音"，方案二定位"哪一段"。配合连读标注（§2-§8），形成完整的反馈链：

```
整体反馈:  "it up 这段与标准差异最大（相似度 54%）"  ← DTW
词级反馈:  "want 这个词准确度 71"                    ← Azure word score
音素反馈:  "want 中的 /ɒ/ 得分 68，需要改进"          ← Azure phoneme
连读反馈:  "it up 应该连读为 /ɪtʌp/"                 ← 连读检测
```

---

## 10. 总结：第一性原理回溯验证

整个方案的设计起点是一个事实：**英语是重音时序语言，连读/弱读/语调是这种节奏体系的自然表现，而不是可选的技巧**。

因此：
- 反馈粒度应该是**节奏单元（rhythmic unit）**，而不是单个单词
- 评分核心应该是 **fluency/timing**，而不是 phoneme accuracy
- 练习方式应该是**整体模仿（chunking）**，而不是逐词纠正
- 成功信号是用户产出的节奏模式越来越接近自然英语，而不是每个音越来越"完美"

> **核心原则：** 让每个英语句子感觉像一串珠子而不是一块块积木。
