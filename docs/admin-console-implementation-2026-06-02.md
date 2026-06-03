# Admin Console Implementation Plan / 管理员入口实施文档

Date / 日期: 2026-06-02

## 1. Goal / 目标

Build a local admin console for managing English practice scripts only.

增加一个本机管理员入口，仅用于管理英语口语练习题目。

The first version should fit the current architecture: script pools are stored in browser `localStorage`.

第一版应贴合当前架构：题库缓存存储在浏览器 `localStorage` 中。

## 2. Route And Entry / 路由与入口

Add a new route:

新增路由：

```text
/admin
```

Add a small admin link in the existing navigation, preferably next to `History`.

在现有导航中增加一个轻量入口，建议放在 `History` 旁边。

This is a local single-user tool for now. Do not add authentication in this phase.

当前阶段它是本机单用户工具，暂不增加登录鉴权。

## 3. Scope / 范围

### In Scope / 本期包含

- View all available scripts from built-in scripts and cached local scripts.
- 查看所有可用题目，包括内置题库和本地缓存题库。

- Add custom scripts into the local script pool.
- 向本地题库池录入自定义题目。

- Edit custom local scripts.
- 编辑自定义本地题目。

- Delete custom local scripts.
- 删除自定义本地题目。

### Out Of Scope / 本期不包含

- Server-side database or cloud sync.
- 服务端数据库或云同步。

- Multi-user roles or login.
- 多用户权限或登录。

- Direct editing of built-in source-code scripts.
- 直接编辑源码内置题库。

- Bulk delete operations.
- 批量删除操作。

- Import/export files.
- 文件导入导出。

- Practice history and score review.
- 练习历史和成绩查看。

- Script-level performance dashboard.
- 题目级成绩看板。

These should stay in `History` or a future dedicated analytics page, not in the admin console.

这些内容应保留在 `History` 或未来独立的数据统计页中，不属于管理员入口。

## 4. Data Sources / 数据来源

The admin page should read from the current localStorage-backed modules.

管理员页面应读取当前基于 localStorage 的模块。

| Data / 数据 | Current Source / 当前来源 | Usage / 用途 |
| --- | --- | --- |
| Cached scripts / 缓存题目 | `esp_script_pool_v1` | editable local scripts / 可编辑本地题目 |
| Built-in scripts / 内置题库 | `src/lib/script-pool.ts` and `src/lib/fallback-scripts.ts` | read-only reference scripts / 只读参考题目 |

Performance storage and session history are not rendered in the admin console.

管理员入口不渲染成绩存储和练习历史。

## 5. Library Changes / 库层改动

Extend `src/lib/script-pool.ts` with explicit admin helpers.

扩展 `src/lib/script-pool.ts`，增加明确的管理员辅助方法。

Recommended exports:

建议导出：

```ts
export interface AdminScriptRecord {
  key: string;
  source: "builtin" | "cached";
  script: Script;
}

export function getAdminScriptRecords(): AdminScriptRecord[];
export function upsertCachedScript(previousKey: string | null, script: Script): void;
export function deleteCachedScript(key: string): void;
```

Implementation notes:

实现注意事项：

- `scriptKey(script)` should remain the canonical identity for deduplicating scripts.
- `scriptKey(script)` 继续作为题目去重的标准身份。

- Built-in scripts should be included in the read model but rejected by edit/delete functions.
- 内置题目应出现在读取模型中，但编辑和删除函数应拒绝处理它们。

- Deleting a cached script may remove the matching performance entry only as data cleanup, but this cleanup is not a visible admin feature.
- 删除缓存题目时，可以作为数据清理同步删除对应 performance 记录，但这不是管理员入口中的可见功能。

- If an edited script changes its key, remove the old cached script record and save the edited script as the new record.
- 如果编辑题目导致 key 改变，应删除旧缓存题记录，并把编辑后的题目保存为新记录。

Recommendation: keep score/history display outside this implementation. Any performance cleanup should be internal and silent.

建议：成绩和历史展示保持在本次实现之外。任何 performance 清理都应是内部静默行为。

## 6. UI Design / 页面设计

The admin page should be utility-first and dense enough for repeated use.

管理员页面应偏工具型，信息密度适中，方便反复使用。

### Layout / 布局

- Header: `Admin` title, total scripts, cached scripts, built-in scripts.
- 顶部：`Admin` 标题、总题数、缓存题数、内置题数。

- Main view: script management list and editor.
- 主视图：题目管理列表和编辑器。

### Scripts View / 题目管理视图

Features:

功能：

- Category filter.
- 分类筛选。

- Source filter: all, built-in, cached.
- 来源筛选：全部、内置、本地缓存。

- Search by topic or turn text.
- 按 topic 或对话内容搜索。

- Script list with topic, category, source, and turn count.
- 题目列表展示 topic、category、来源和行数。

- `Add Script` button.
- `Add Script` 按钮。

- Edit/delete actions only for cached scripts.
- 仅缓存题显示编辑/删除操作。

### Script Editor / 题目编辑器

Fields:

字段：

- Category.
- 分类。

- Topic.
- 话题。

- Turns, each with speaker and text.
- 对话行，每行包含 speaker 和 text。

Validation:

校验：

- Category must be one of `SCRIPT_CATEGORIES`.
- 分类必须来自 `SCRIPT_CATEGORIES`。

- Topic cannot be empty.
- 话题不能为空。

- At least 6 turns.
- 至少 6 行对话。

- Every turn must have speaker `coach` or `user`.
- 每行 speaker 必须是 `coach` 或 `user`。

- Every turn text cannot be empty.
- 每行文本不能为空。

- Recommend alternating coach/user turns, but do not hard-block if the script is still valid.
- 建议 coach/user 交替，但只要结构有效，不强制阻断。

## 7. Delete Rules / 删除规则

Only one explicit cached script may be deleted per user action.

每次用户操作只允许删除一个明确的缓存题目。

Deletion flow:

删除流程：

1. User clicks delete on a cached script.
1. 用户点击某个缓存题目的删除按钮。

2. Show a confirmation dialog with topic and category.
2. 弹出确认框，显示 topic 和 category。

3. On confirm, remove that script from `esp_script_pool_v1`.
3. 确认后从 `esp_script_pool_v1` 删除该题。

4. Optionally remove the matching `esp_script_performance_v1` entry as silent cleanup.
4. 可选地静默删除匹配的 `esp_script_performance_v1` 记录，作为数据清理。

5. Refresh admin state.
5. 刷新管理员页面状态。

No bulk delete UI should be added in this phase.

本阶段不增加批量删除 UI。

## 8. Safety And Fallback / 安全与兜底

- If localStorage contains invalid JSON, show an empty state and keep the app usable.
- 如果 localStorage 中存在非法 JSON，显示空状态并保持应用可用。

- If all cached scripts are deleted, session generation must still work through built-in scripts.
- 如果缓存题被删空，练习流程仍应通过内置题库正常工作。

- The admin page should not mutate data on initial render.
- 管理员页面初次渲染不应修改数据。

## 9. Implementation Steps / 实施步骤

1. Add admin read/write helpers to `src/lib/script-pool.ts`.
1. 在 `src/lib/script-pool.ts` 增加管理员读写辅助函数。

2. Add `src/app/admin/page.tsx`.
2. 新增 `src/app/admin/page.tsx`。

3. Add admin navigation link in `src/app/layout.tsx`.
3. 在 `src/app/layout.tsx` 增加管理员入口。

4. Build the script list and editor modal/panel.
4. 实现题目列表和编辑面板。

5. Add validation and delete confirmation.
5. 增加校验和删除确认。

6. Run TypeScript, lint, and manual browser verification on port `6688`.
6. 在 `6688` 端口运行 TypeScript、lint 和浏览器手动验证。

## 10. Acceptance Criteria / 验收标准

- `/admin` opens successfully from navigation.
- 可以从导航进入 `/admin`。

- Built-in scripts are visible and marked read-only.
- 内置题目可见，并明确标记为只读。

- Cached scripts can be added, edited, and deleted.
- 缓存题目可以新增、编辑、删除。

- Invalid scripts cannot be saved.
- 非法题目不能保存。

- `/admin` does not show practice history, session history, attempts, or scores.
- `/admin` 不展示练习历史、session 历史、练习次数或分数。

- Existing `/session` flow still works after admin changes.
- 管理员改动后，现有 `/session` 练习流程仍正常工作。

## 11. Verification Commands / 验证命令

```bash
npx tsc --noEmit
npx eslint src/app/admin/page.tsx src/lib/script-pool.ts src/app/layout.tsx
curl -s -o /tmp/admin.html -w '%{http_code} %{time_total}\n' http://localhost:6688/admin
curl -s -o /tmp/session.html -w '%{http_code} %{time_total}\n' http://localhost:6688/session
```

Manual checks:

手动检查：

- Open `http://localhost:6688/admin`.
- 打开 `http://localhost:6688/admin`。

- Add one custom script.
- 新增一条自定义题目。

- Edit that script.
- 编辑该题目。

- Delete that script and confirm it disappears.
- 删除该题目，并确认它消失。

- Open `http://localhost:6688/session` and confirm a practice session can still start.
- 打开 `http://localhost:6688/session`，确认练习仍可开始。
