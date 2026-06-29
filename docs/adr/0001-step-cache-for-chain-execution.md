# 0001 — 为链执行引入按步缓存

**状态**：Proposed
**日期**：2026-06-27
**决策者**：@rosme

## 背景

BASE.md 第 6 节"执行缓存"只缓存最终预览产物（`execute-*.jpg` / `execfull-*.jpg`），`POST /execute` 全量 `run_pipeline` 从原始资源一路重放所有 map 操作。当用户调整链中靠后操作的参数时，前方未改动的操作结果也会被重新计算，浪费 CPU/IO。本 ADR 引入"按步缓存"：把每张资源经过 operation 前缀 `[0..k]` 后的中间图像持久化，参数在位置 j 改动时只需从 step j-1 加载缓存、续推 j 及之后操作。

## 候选方案

讨论围绕缓存键、缓存范围/格式、存储位置、缓存清理四个主问题展开。

### 缓存键要素

| 候选 | 评价 |
|---|---|
| 键含 `chain_id` / `project_id` | 否决。operations list + parameters 一致就保证对相同输入图像输出一致，含业务对象 id 反而限制跨链复用 |
| 用 `resource.surrogate_rid` | 否决。内容相同即应复用，rid 与内容无强绑定 |
| `resource.sha1` 内容寻址 | **采纳**。资源永不修改、SHA1 去重，内容寻址天然稳定且跨链可复用 |
| 单独编码 step 号 | 否决。step 号隐含在前缀哈希长度中 |
| `CACHE_VERSION` 盐 | **采纳**。OpenCV/操作实现升级会引发算法漂移，盐使旧缓存整体失效以重生成 |

采纳键：`resource.sha1 + ops_prefix_hash[k] + CACHE_VERSION`；其中 `ops_prefix_hash[k] = sha256(canonical_json(operations[0..k+1]) + CACHE_VERSION)`，canonical 用 sorted keys + 确定性 separators。

### 缓存范围（map vs reduce）

| 候选 | 评价 |
|---|---|
| 缓存 reduce 累加器 | 否决。reduce 只持标量状态，重算近乎免费（远小于一次磁盘 I/O），缓存收益不抵一致性成本 |
| 缓存 map 步输出 | **采纳**。map 变换图像是执行主成本；PNG 无损保证下游 threshold/analyze 的精度 |

只缓存 map 步输出，reduce 每次从缓存的 map 图重放。

### 缓存格式

| 候选 | 评价 |
|---|---|
| JPEG | 否决。threshold/analyze 对像素值敏感，有损会污染下游结果 |
| PNG | **采纳**。无损；SEM 灰度图体积小；多通道亦支持 |
| npy + sidecar | 否决。当前所有图为 uint8，PNG 足够；float 场景属 YAGNI |
| sidecar `.meta.json` | 否决。校验信息可由文件名 + 当前 operations 重算，多一类文件就多一类一致性 bug |

### 存储

| 候选 | 评价 |
|---|---|
| SQLite BLOB | 否决。图像入 BLOB 与 BASE.md「图像走 FS、元数据走 SQLite」分工相悖；BLOB 膨胀 db、干扰短连接对其它表的读写；判断命中是 O(1) 文件存在性，无需 schema/索引/迁移 |
| 全局缓存池 | 否决。最大化跨链复用但 GC 复杂、与 project 生命周期脱钩 |
| 按 chain 分目录 `.../{chain_id}/` | 否决。限制了跨 chain 复用——同一项目不同 chain 共享相同 operations 前缀时各自存一份，浪费空间 |
| `_data/projects/{pid}/cache/` 扁平目录 | **采纳**。全文遍历共享，跨 chain 自动复用。删除 project 时 `rm -rf` 该目录。 |

### 缓存清理

| 候选 | 评价 |
|---|---|
| 删 chain 自动清缓存 | 否决。扁平目录下文件可能跨 chain 共享，删 chain 时无法判断哪些文件是被其它 chain 引用的 |
| 删 project 自动清缓存 | **采纳**。`rm -rf _data/projects/{pid}/cache/` 与 project 生命周期对齐，零额外成本 |
| Execute 惰性清扫（按本 chain 资源前缀清扫） | **采纳**（核心竞争力）。每次 `POST /execute`，对本 chain 的每张资源（`sha1[:16]`），在 cache 目录中匹配以该前缀开头的文件，删除其中不在当前 `V` 的。不会误伤其它 chain 的文件（因为 `sha1[:16]` 不同）。用户聚焦一个 chain 时不会察觉；跨 chain 少量重复缓存被丢弃后只影响性能不伤正确性，下次使用对应 chain 时自动重建 |
| 手动按钮：清理该 project 全缓存 | **采纳**。当用户想强制释放空间或全量重算时，由前端提供按钮，调用 `DELETE /api/projects/:pid/cache`，扫描所有 chain 的 operations 计算 `V_all`，删不在 `V_all` 中的文件 |
| 全局容量上限 + mtime 淘汰 | **否决**。缓存有效性取决于「与当前 operations 哈希是否匹配」，与写入时间无关。按 mtime 新旧删除既可能误删仍有效的旧快照（参数调后方操作时前方缓存虽旧但有效），也可能保留无用文件。Execute 惰性清扫基于哈希匹配删除，正确性闭环。单机桌面 App 不会到上限策略才触发的规模。**讨论后明确放弃此策略。** |
| 后台扫描 daemon | 否决。单机桌面应用做后台 daemon 属 over-engineering |
| `scripts/purge_cache.py` 脚本 | 否决。用户正常只通过前端图形界面操作，不应在后端控制台执行指令 |

### 入口与失效语义

- `POST /execute` 默认走 `run_pipeline_cached`（包装 `run_pipeline`）：每资源算前缀哈希、找最大命中步、从该步加载图续推，并在每个 map 步后写缓存。DEBUG 模式的 `{rid}_{step}.png` 与本机制**合并为一套**（避免双轨）。
- `PATCH /chains/:cid` 不再清 step cache——这是缓存复用的前提；只清 `execute-*.jpg` / `execfull-*.jpg` 这类最终预览产物。
- 参数改在位置 j：`ops_prefix_hash[k]` 对所有 k≥j 变化 → 这些步缓存自然失配；k<j 命中复用。

## 决策

1. **缓存键**：`resource.sha1 + ops_prefix_hash[k] + CACHE_VERSION`，纯内容寻址，不含 chain_id/project_id。
2. **缓存范围**：仅 map 步输出（PNG 无损）；reduce 状态不缓存、每次从缓存图重放。
3. **存储**：文件系统 `_data/projects/{pid}/cache/`，文件名 `{sha1[:16]}_{h[:16]}.png`。
4. **缓存清理**：
   - 生命周期：删 project → `rm -rf cache/`；删 chain**不做**（文件可能跨 chain 共享）。
   - Execute 惰性清扫：每次 execute，按本 chain 的 `resource_ids` 匹配前缀、删不在 `V` 中的文件。同一 project 下其它 chain 的缓存不受影响。
   - 手动兜底：前端"清理该 project 缓存"按钮 → `DELETE /api/projects/:pid/cache`，扫描所有 chain 的 operations 计算 `V_all`，清掉不在 `V_all` 中的文件。
5. **入口**：`/execute` 走缓存版管道；PATCH 改为不清 step cache、只清最终预览产物。
6. **不引入**：chain 级目录、全局容量上限、mtime 淘汰、后台扫描、后端 purge 脚本。

## 理由

- **内容寻址，键不含业务对象 id**：operations list + parameters 一致就保证对相同输入图像输出一致，跨链复用最大化。
- **map only**：reduce 重算近乎免费，缓存它只增加一致性负担。
- **PNG 而非 JPEG**：后续 NPC（threshold/analyze）依赖精确像素，PNG 无损是唯一安全选择。
- **文件系统而非 SQLite**：与 BASE.md 第 3 节分工一致；判断命中是 O(1) 文件存在性，无需 schema/索引/迁移。
- **扁平目录跨 chain 复用而非 chain 子目录**：同一 project 下不同 chain 可能共享相同的 image × ops 前缀，扁平目录使一份缓存被各 chain 自动命中，减少重算也减少磁盘占用。代价是删 chain 不能连带清缓存——接受该代价，因为跨 chain 复用带来的节省远超残留文件量。
- **Execute 惰性清扫仅匹配本 chain resource 前缀**：用户聚焦一个 chain 调整操作时，不可能同时操作另一 chain（单用户、单当前链的商业语义）。同 project 中本 chain 专属缓存被清理后，另一 chain 下次 execute 时自动重建——只影响性能，正确性不受影响。
- **抛弃全局上限与 mtime 淘汰**：缓存文件的有效性取决于与当前 operations 的哈希匹配，与写入时间无关。按 mtime 删既可能误删仍有效的旧快照（参数调后方操作时前方缓存虽旧但有效），也可能保留无用文件。Execute 惰性清扫基于哈希匹配删除，正确性闭环；全局上限策略应对的是臆想中的规模，单机桌面 App 不会触及，加之反而引入误删风险。
- **GUI 按钮而非脚本/后台进程**：单机桌面 App，用户只应操作 GUI。后台 daemon 与控制台脚本是臆想规模的过度应对。

## 后果

好处：
- 链式迭代场景：用户调整靠后操作参数时，前方 map 步命中缓存，execute 速度显著提升。
- 跨 chain 复用：同一 project 下不同 chain 若共享相同的 operations 前缀，自动命中同一份缓存。
- GC 成本归零（project 生命周期清理 + Execute 惰性清扫），无后台进程，无 mtime 误删风险。

代价：
- 删 chain 不自动清缓存，残留文件等待 Execute 惰性清扫或手动按钮处理；量级可控（按 project 分目录，每个 project 独立）。
- 参数改在位置 j 时，所有 k≥j 步缓存自然失效，下一次 execute 才重建；首次 execute 后新生成件与残留死文件并存，待下次 execute 在惰性清扫中清掉。
- 并行调用同一 project 的 `DELETE .../cache` 与 `execute` 时存在竞争。以业务约定（清理按钮只在用户主动发起时调用，非高频操作）兜底，本 ADR 不预先引入文件锁。

未来债：
- 若某 project 内大量 chain（数十条）且频繁迭代，Execute 惰性清扫配以手动按钮仍可管控；若到数百 chain 量级，可升级为以 project 为单位的定时惰性扫描。本 ADR 不预先引入，YAGNI。
- 若 OpenCV 主版本升级使图像处理结果漂移，递增 `CACHE_VERSION` 使全局缓存一次性失效、重新生成。

## 参考

- `docs/design/BASE.md` §6 执行缓存
- `docs/CONTRIBUTORS.md` 项目状态
- `backend/engine.py` `run_pipeline` / `execute_and_preview`
- `docs/adr/README.md` ADR 模板
