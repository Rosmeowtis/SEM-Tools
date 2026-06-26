# SEM-Tools 自动阈值分割方案：学术报告

**报告对象**：`auto_threshold` 图像处理算子
**代码位置**：`backend/studio/operations.py:333`、`backend/studio/models.py:88`、`frontend/src/types.ts:91`
**关联预设**：`presets/孔隙率.json`
**演化起止**：commit `bbae5d2`（2026-06-22）→ `060f10a`（2026-06-24）

---

## 摘要

SEM-Tools 面向扫描电子显微镜（SEM）图像的后处理，核心任务是定量孔隙率。该任务的第一步是将灰度图像二值化以分离固体相与孔隙相。本项目采用了一种**直方图几何分析 + 大津法**的三选一自动阈值方案：在单峰直方图假设下，通过寻找直方图曲线相对"峰—尾弦"的**最大垂直距离点**（即"肩部"）确定阈值；同时提供经典大津法作为双峰场景的备选；并以一个人工偏移量参数作为后验修正。本报告系统阐述该方案的数学原理、实现架构、在链式管道中的集成方式及其已知局限。

---

## 1. 背景：为什么需要自动阈值

### 1.1 量化基准

孔隙率 $\phi$ 定义为孔隙相像素占样品区域总像素的比例：

$$\phi = \frac{\#\{p \mid I(p)=255\}}{\#\{p \mid p\in\Omega\}}$$

其中 $\Omega$ 为样品区域，二值化后白（255）表示孔隙。因此阈值 $T$ 的选择直接决定 $\phi$ 的量级与可比性。

### 1.2 固定阈值的缺陷

固定阈值（`threshold` 算子，`T=127`）要求所有图像光照、衬度一致，这在 SEM 实测中难以满足——不同电镜条件、不同样品的灰度分布漂移显著。人工逐图调阈值又破坏了批处理的可重复性。因此需要**逐图自适应**的阈值确定方法，且该过程须是链中的一个 Map 算子，融入流式管道。

### 1.3 直方图形态假设

SEM 多孔材料图像的灰度直方图通常呈**单峰偏态**：一个主导峰对应基体/衬底，一侧拖尾对应孔隙相。对这类分布，经典的双峰阈值法（如 Otsu）并非最优；而 Ostu 类方法更适配双峰分布。本项目据此同时提供两类方法，由用户按直方图形态选择。

---

## 2. 算法设计

算子签名：`op_auto_threshold(img, params) -> binary_img`，参数 `params = {algorithm, offset}`，`algorithm \in {left_peak, right_peak, otsu}`。

记归一化前的离散灰度直方图为 $h(i),\ i\in[0,255]$。预处理：若输入为多通道，转灰度。

### 2.1 主峰与尾端定位

对所有三个分支，先求主峰：

$$p = \arg\max_{i}\ h(i)$$

对峰型分支，再定位**尾端非零端点**：
- `left_peak`：$L = \min\{i < p \mid h(i) > 0\}$（峰左首个非零灰度级）
- `right_peak`：$R = \max\{i > p \mid h(i) > 0\}$（峰右末个非零灰度级）

### 2.2 峰—尾弦最大垂直距离法（left_peak / right_peak）

以 `left_peak` 为例，构造从峰到左尾端点的弦 $A B$，其中 $A=(L,\,h(L))$，$B=(p,\,h(p))$。对区间 $[L,\,p)$ 内任一点 $P=(i,\,h(i))$，其到弦所在直线的垂直距离 $d_\perp$ 正比于叉积：

$$d_\perp(i)\ \propto\ \big|\,(p-L)\,(h(i)-h(L)) \;-\; (i-L)\,(h(p)-h(L))\,\big|$$

因 $|AB|$ 对给定直方图为常数，最大化上述叉积即等价于最大化真垂直距离。阈值取：

$$T_0 = \arg\max_{i\in[L,\,p)} d_\perp(i)$$

`right_peak` 对称地在 $(p,\,R]$ 上、对弦 $B=(p,\,h(p))$ 到 $C=(R,\,h(R))$ 求最大垂直距离点。

**几何诠释**：最大垂直距离点即直方图曲线相对"峰—尾基底弦"凸出最显著的位置——直观对应单峰分布的**肩部（shoulder）**，通常近似主相与拖尾相的边界。该思想是单峰直方图阈值化的经典启发式（"shoulder / maximum-distance-to-chord" 法），实现上以 O(256) 的线性扫描完成，无迭代、无收敛依赖。

### 2.3 大津法（otsu）

对双峰直方图，改用 OpenCV 内置 Otsu，即最大化类间方差：

$$T_0 = \arg\max_{t}\ \sigma_B^2(t) = \omega_0(t)\omega_1(t)\,[\mu_0(t)-\mu_1(t)]^2$$

由 `cv2.threshold(gray, 0, 255, THRESH_BINARY | THRESH_OTSU)` 直接返回 $T_0$。

### 2.4 偏移量后验修正

三个分支均允许人工偏移：

$$T = \mathrm{clip}_{[0,255]}(T_0 + \text{offset})$$

随后以 `cv2.threshold(gray, T, 255, THRESH_BINARY)` 生成二值图。`offset \in [-255,255]$ 提供了"算法给基线、人给微调"的协作接口，既保留自适应主干，又允许针对特定样品族系的系统性偏置校正。

**实现细节**：`otsu` 分支当 `offset==0` 时直接使用 Otsu 内部产生的二值图，避免二次阈值化引入数值差异；仅当 `offset \neq 0` 时才以修正后的 $T$ 重新阈值化。峰型分支无论 offset 是否为 0 都走显式阈值化。

---

## 3. 实现架构

### 3.1 数据模型（Pydantic 判别联合）

`AutoThresholdParams`（`models.py:88`）：

```python
class AutoThresholdParams(BaseModel):
    algorithm: Literal["left_peak", "right_peak", "otsu"] = "left_peak"
    offset: int = 0
```

`AutoThresholdOp` 以 `kind="auto_threshold"`、`mode="map"` 注册进判别联合 `Operation`，保证 JSON 链文件可被服务端严格校验。

### 3.2 算子实现与注册

`op_auto_threshold`（`operations.py:333`）为纯函数，输入/输出 `np.ndarray`。它通过 `_MAP_OPS` 字典注册（`operations.py:671`），由统一调度函数 `apply_map_op`（`operations.py:680`）按 `op["kind"]` 派发。该结构使新增算法只需扩展函数内分支 + `Literal` 选项 + 前端 `OP_KINDS` 三处，符合项目"平坦 Union 而非策略类层级"的设计取舍。

### 3.3 前端契约

`frontend/src/types.ts:91` 以声明式 `OP_KINDS` 数组定义算子元数据（含 `algorithm` 下拉与 `offset` 数值字段、上下界与帮助文本），由通用 `SchemaForm` 自动渲染。前后端类型各自主维护、靠 JSON 文件作为运行时契约——这是该项目"无 codegen、无 service 层"约定的直接体现。

### 3.4 管道集成

`auto_threshold` 是 Map 算子，参与流式管道：内存中至多驻留一张图，逐图独立变换，无跨图状态。其输出二值图沿管道向后流动，最终被 Reduce 算子 `analyze(type=porosity)` 采集统计孔隙率。

---

## 4. 应用场景：孔隙率分析链

`presets/孔隙率.json` 是该方案的典型落地，构成完整可重现处理链：

1. `crop` → 规整感兴趣区
2. `blur(ksize=5)` → 高斯降噪，抑制直方图毛刺对峰/肩检测的扰动
3. `grayscale` → 归一为单通道
4. **`auto_threshold(algorithm=left_peak, offset=0)`** → 自适应二值化
5. `morphology(close ksize=9)` → 填充孔隙内暗洞
6. `morphology(open ksize=9)` → 去除孤立亮噪
7. `invert` → 校正极性，使孔隙为白
8. `analyze(porosity)` → Reduce 阶段统计白像素占比

值得注意的是：`reduce_porosity_accumulate`（`operations.py:430`）在统计前以固定 `T=127` 再阈值化一次。对纯净 0/255 二值图这是恒等操作，但形成了一个隐式耦合——Reduce 假定上游已近似二值。若上游链被改为非二值输出，孔隙率将失真。这是当前架构的隐性约束。

---

## 5. 讨论与局限

### 5.1 已记录的局限（`docs/todo/todo.md:3`）

> "目前的 auto_threshold 函数仍然会将部分阴影误识别成孔隙。"

根因：肩部法仅依赖一阶灰度分布，无法区分类似的灰度级但语义不同的区域——**阴影**与**真孔隙**在直方图上可能落在同一拖尾。todo 提出的改进方向是基于**灰度梯度特征**：孔隙应在边界处呈高梯度、内部低梯度。这是一个由灰度统计向局部梯度/纹理建模的升级路径。

### 5.2 方法论局限

- **单峰假设强依赖**：当直方图呈明显双峰或多峰时，峰型法的主峰可能落在非基体相，导致肩部误判；此时应切至 `otsu`。当前依赖用户按直方图形态手选 algorithm。
- **无空间先验**：纯直方图法丢弃空间信息，对渐变光照、局部阴影无抵抗力。项目已提供 `tophat` 顶帽算子（`operations.py:396`）作为预处理消光照，但二者是否组合由用户决定，无自动编排。
- **尾端用"非零端点"而非极值端**：弦端点取首个非零灰度级，对含稀疏离群像素的直方图，弦方向易被极端值牵引。在数据干净（已 blur）时影响有限。
- **offset 为全局标量**：对单图族系有效，对异质批处理无法逐图自适应。

### 5.3 复杂度

所有分支为 $O(N)$（$N$ = 像素数，用于建直方图）+ $O(256)$（极值/最大距离扫描），常数级内存，可安全流式逐图执行，满足项目"O(一张图)内存"约束。

---

## 6. 演化历程

| 日期 | Commit | 内容 |
|---|---|---|
| 2026-06-22 | `bbae5d2` | 首版：直方图单峰左肩最大距离点 + `offset` 偏移，当时实现内联于 `engine.py` 50 行 |
| 6-22 后 | `bd29469` | 重构：拆出 `studio/operations.py`，统一 `_MAP_OPS` 注册，原内联逻辑迁为 `op_auto_threshold` |
| 2026-06-24 | `060f10a` | 扩展：`AutoThresholdParams` 增 `algorithm` 字段，三路分支（left/right/otsu），前端增算法下拉 |

演化呈现"先单启发式落地 → 重构解耦 → 按直方图形态补齐备选算法"的渐进路径，未引入策略类层级，始终维持函数注册表结构。

---

## 7. 结论

SEM-Tools 的 `auto_threshold` 是一组**轻量、无依赖、O(N)** 的逐图自适应二值化算子：以峰—尾弦最大垂直距离点处理单峰形态、以 Otsu 处理双峰形态、以 offset 接入人工先验。它作为 Map 算子无缝接入流式管道与孔隙率 Reduce 统计，在数据干净、直方图形态明确时表现稳健。其主要局限在于纯灰度统计无法区分阴影与孔隙——这正是下一步引入灰度梯度/局部纹理特征的动机。整体方案是"链式可重现 + 流式 Map/Reduce"架构在阈值化这一步的恰当工程收敛：以最小复杂度覆盖主流场景，将难题（空间先验、异质批处理）显式留为 TODO 而非过度建模。

---

## 参考文献（内部）

- `docs/design/BASE.md` §2 Map Operation 表、§7 关键设计决策
- `backend/studio/operations.py` `op_auto_threshold:333`、`reduce_porosity_accumulate:430`
- `backend/studio/models.py:88` `AutoThresholdParams`
- `frontend/src/types.ts:91` `OP_KINDS`
- `presets/孔隙率.json`
- `docs/todo/todo.md:3`
- Git: `bbae5d2`, `bd29469`, `060f10a`
