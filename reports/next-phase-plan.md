# dshchem 下一阶段工作计划（P5–P7：合成/逆合成 + 药物化学）

> 状态：规划稿（2026-08-14）。实现前需用户确认范围与优先级。
> 延续既有架构：引擎 op 扩展（`chem_engine.py`，junction 即时生效）→ chem 服务方法 → `dsh-tool-chem` 新工具（同一包注册，预设行不变）→ client 卡片自动接入（TOOL_KEYS 注册）。

---

## 总览

| 阶段 | 主题 | 核心工具 | 新依赖 |
|---|---|---|---|
| **P5** | 有机合成 / 逆合成 | chem_retro_step, chem_retro_plan, chem_functional_groups, chem_reagents | 无（模板库）/ 可选 AiZynthFinder |
| **P6** | 药物化学 / 分子性质 | chem_druglikeness, chem_similarity, chem_cluster, chem_mcs, chem_enumerate, chem_admet | 可选 torch |
| **P7** | 深化（可选） | 对接 / 3D 可视化 / MCP / 反应预测 ML | 较重 |

---

## P5 · 有机合成 / 逆合成

### P5.1 合成基础层（零新依赖，确定性）

- **官能团转化模板库**：内置 40–60 个经典反应 SMARTS（酯化/水解/酰胺键形成/还原/氧化/Buchwald 偶联/Suzuki/加氢/卤代烃取代等），带原子映射与条件标注
- **`chem_retro_step`**：单步逆合成——模板断开 → 前体列表（canonical 化 + 原子映射校验 + SA score 评分排序）
- **`chem_functional_groups`**：SMARTS 子结构/官能团识别（可同时服务合成与药化）
- **`chem_reaction` 增强**：正向模板库匹配（当前 template 模式仅接受手写 SMARTS）

### P5.2 路线规划（逆合成树）

| 方案 | 内容 | 风险 |
|---|---|---|
| **A：AiZynthFinder 集成**（首选） | MolecularAI/aizynthfinder（活跃维护）：MCTS 树搜索 + USPTO 预训练策略网络（~5 万模板）+ 购买前体库可选 | 策略模型需下载（数百 MB）；**Windows 兼容性待实测**（官方主推 Linux/conda）；备选 Rust 版 **renkin**（跨平台，conda+model） |
| **B：自研 BFS 模板搜索**（保底） | 模板库 + 深度/宽度限制 + SA score + 终点判定（可得性启发：GDB/常见砌块列表） | 覆盖度低于 ML 策略，但确定性、可控、零下载 |

**实施顺序**：P5.1 先行（确定性价值立现）→ P5.2 先试 A（1 天内实测 Windows 兼容与模型下载），失败即回退 B。

### P5.3 条件与试剂推荐

- **`chem_reagents`**：反应类型 → 常用条件规则表（催化剂/碱/溶剂/温度/时间，来源标注）+ 可选 Crossref 文献兜底（已有 chem_papers）

### P5 验收（测试 Prompt 要点）

- 布洛芬、阿司匹林、利多卡因、对乙酰氨基酚的标准逆合成路线（人工核对 1–2 步断开合理性）
- 官能团识别（酮/酯/酰胺/芳卤/硝基……）正确率 100% 用例
- 路线产物 canonical 化 + 原子守恒校验

---

## P6 · 药物化学 / 分子性质

### P6.1 类药性（RDKit 原生，零新依赖）

- **`chem_druglikeness`**：Lipinski 五规则 / Veber / REOS 判定 + **QED**（RDKit 内置）+ **SA score**（合成可及性）+ BA score，逐条给出违反项与数值

### P6.2 相似性 / 骨架 / 聚类（RDKit 原生）

- **`chem_similarity`**：Morgan(ECFP) 指纹 + Tanimoto 相似性（批量：给定分子 vs 分子列表）
- **`chem_cluster`**：Butina 聚类 + Murcko 骨架提取（骨架去重/计数）
- **`chem_mcs`**：最大公共子结构（MCS，含环匹配选项）

### P6.3 ADMET 预测（依赖评估后定）

| 方案 | 内容 | 依赖 |
|---|---|---|
| **A：admet_ai**（首选） | swansonk14/admet_ai：~30 个 ADMET 端点模型（吸收/分布/代谢/毒性），PyTorch | torch（**Python 3.14 wheel 已发布（2.12）**，实测安装即可确认） |
| **B：规则 + 数据库**（零新依赖保底） | 描述符规则（如 logP 区间/分子量/氢键） + **PubChem BioAssay/毒性数据**（PUG REST 已有客户端可扩展） | 无 |

### P6.4 组合库与虚拟筛选

- **`chem_enumerate`**：R-group 枚举（骨架 + 取代基列表 → 组合库）
- 筛选管线：枚举 → 类药性过滤 → 相似性排序（与已知活性分子比对）→ 报告

### P6 验收（测试 Prompt 要点）

- 已知药物（阿司匹林/布洛芬/沙利度胺/紫杉醇）类药性判定与文献一致
- 相似性检索召回已知类似物（如阿司匹林 vs 水杨酸）
- 组合库枚举数量与预期一致（2×3×2=12 等）
- ADMET 方案 A 输出与文献/数据库值量级一致（标注模型版本与不确定性）

---

## P7 · 深化（可选，视 P5/P6 效果决定）

- **分子对接**：AutoDock Vina（meeko 配体准备），`chem_dock`（重依赖，最后评估）
- **3D 可视化**：3Dmol.js 进工具卡片（client 半扩展，结构图 → 3D 渲染）
- **MCP 化学工具接入**：激活本机潜伏的 `dsh-mcp-client`，接入 rdkit-mcp/xtb-mcp 生态（调研时已评估成熟）
- **反应预测 ML**：ORD 数据 + 轻量模型（可选，依赖 torch 路线打通）

---

## 关键风险与前置验证（实现前 1 天内完成）

| 风险 | 验证动作 | 决策点 |
|---|---|---|
| torch × Python 3.14 | `pip install torch` 实测 | OK → P6.3 方案 A；失败 → 方案 B |
| AiZynthFinder × Windows | 装包 + 下载策略模型 + 跑单分子逆合成 | OK → P5.2 方案 A；失败 → renkin 或方案 B |
| admet_ai 维护状态 | GitHub 最近提交 + 依赖树 | 停更 → DeepPurpose 或方案 B |

## 测试与交付节奏（延续既有约定）

1. 每个工具：引擎 op 单测 → 服务方法 → 工具 schema → 集成测试守护断言 → benchmark 用例
2. **每个阶段交付时附对应测试 Prompt**（写入 `reports/chemist-testing-prompts.md`）
3. 全程保持：确定性工具优先、来源标注、schema 无 null 字段、非法输入结构化错误
