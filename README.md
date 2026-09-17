# dshchem — DSH 化学科研 Agent 预设与插件环境

为 DeepSeek Harness 定制的化学科研工作环境。调研依据见 `research/`（GitHub dsh-plugin 生态 + 化学 LLM agent 开源项目对比，2026-08-14 快照）。

## 系统架构

```
┌─ Agent 预设层  ~/.dsh/.agent-presets/chemist/  ──────────────────────────┐
│  agent.cordis.yml：化学科研 persona + 事实校验/安全规则 + 工具行 tool-chem │
│  ~/.dsh/skills/chem-literature · chem-safety（技能包，目录自动发现）      │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ 每会话挂载；工具行 resolve 宿主 chem 服务
┌──────────────────────▼── Host 平面（bundle: @dshchem/dsh-chem-core）──────┐
│  chem 服务：Python 桥(RDKit/ASE) │ PubChem/Crossref │ 配方库(~/.dsh/chem) │
│  /api/dsh-chem/render-svg（loopback-only）│ 每请求一进程，超时强杀          │
│  挂载：profile package.json dsh.profile.bundles + cordis.patch.yml        │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ dsh.client 清单 → 浏览器加载 client.js
┌──────────────────────────────▼── Browser 插件层 ──────────────────────────┐
│  chem_* 工具卡片（tool.call.toolview Slot）：SMILES 2D 结构图 + 结果文本   │
└───────────────────────────────────────────────────────────────────────────┘
```

设计决策（用户确认）：**host 服务 + 预设工具行分离**——引擎/网络/存储/路由在宿主平面跨会话共享，模型工具与 persona 仅化学预设会话可见；client 半通过 dsh.client 清单随 bundle 加载。

## 工具清单（11 个）

| 工具 | 用途 | 后端 |
|---|---|---|
| `chem_validate` | SMILES 校验 + canonical 化 | RDKit |
| `chem_props` | 分子描述符（MW/logP/TPSA/HBD/HBA/…） | RDKit |
| `chem_convert` | 格式转换 + 2D SVG 结构图 | RDKit |
| `chem_pubchem` | PubChem 交叉核对（CID/MW/XLogP3/TPSA/…）+ 名称补全 | PubChem PUG |
| `chem_calc` | 单点/弛豫能量（emt 内置 / xtb 可选） | ASE |
| `chem_reaction` | 反应原子守恒检查 + SMARTS 模板产物预测 | RDKit |
| `chem_recipe_save/search/list` | 配方记忆库（ChemAgent 式知识沉淀，跨会话持久） | ~/.dsh/chem/recipes.json |
| `chem_papers` | Crossref 文献检索（DOI/期刊/作者/摘要，免 key） | Crossref API |
| `chem_pdf` | 本地 PDF 文本提取（文献层） | PyMuPDF |

## 目录结构

```
dshchem/
├─ research/                     # 调研报告 + 11 个 README 证据
├─ packages/
│  ├─ dsh-chem-core/             # host 引擎（chem 服务 + Python/RDKit/ASE 桥 + PubChem/Crossref + 配方库 + 渲染路由 + 浏览器卡片）
│  │  ├─ lib/index.js            # Cordis 插件：provide('chem') + /api/dsh-chem/render-svg 路由
│  │  ├─ python/chem_engine.py   # 确定性引擎（validate/props/convert/calc/reaction/pdftext）
│  │  ├─ client.js               # 浏览器半：chem_* 工具卡片内嵌 2D 结构图（tool.call.toolview Slot）
│  │  └─ cordis.patch.yml        # profile bundle 补丁
│  └─ dsh-tool-chem/             # 预设工具行（11 个 chem_* 工具）
│     └─ lib/index.js            # ctx.tools.register(defineTool(...))
├─ test/
│  ├─ integration.mjs            # 端到端集成测试（真引擎 + 真工具注册 + schema 防回归断言）
│  └─ benchmark.mjs              # ChemBench 风格评测（54 项：性质/校验/反应/计算/网络交叉核对/记忆）
└─ node_modules/@deepseek-ai     # junction → harness 安装（依赖解析，见下）
```

## 依赖解析（关键机制）

- 预设行的包名从 **harness 安装基座**解析（`@deepseek-ai/dsh-agent-presets` 的 PresetTree.import），不是 profile node_modules。
- 工具包内部 `import '@deepseek-ai/dsh-tools'` 从**包自身位置**向上解析。因此开发期：
  1. 预设行用绝对路径指向 `packages/dsh-tool-chem/lib/index.js`（行名支持绝对路径）；
  2. 工作区 `node_modules/@deepseek-ai` 是到 harness `node_modules/@deepseek-ai` 的 **junction**，使包内裸导入可解析。
- 发布期：把 `@deepseek-ai/dsh-tools` 列为常规依赖发布，行名换包名即可（或继续绝对路径个人部署）。

## 安装与启动清单

1. ✓ 预设 `chemist` 写入 `~/.dsh/.agent-presets/chemist/`（persona + 规则 + tool-chem 行）
2. ✓ 技能包 `~/.dsh/skills/chem-literature`、`chem-safety`
3. ✓ `dsh plugin --profile web add link:...dsh-chem-core`（profile package.json 已含 bundle）
4. ✓ 挂载校验 `standingKeyFor('chemist')` = mounted OK（含工具行导入）
5. ✓ 集成测试 + 评测基准全绿（`node test/integration.mjs`、`node test/benchmark.mjs`，58 项）
6. ✓ 已修复 schema 校验类 bug：`chem_pubchem` mw 字符串类型、`chem_papers` 缺字段条目 null 冲突（均改为「缺失字段省略 + 回归断言」）、`chem_calc` xtbOutputTail 未声明字段
7. ✓ 引擎即时生效机制（junction link + 每请求 spawn：改引擎源码无需重启 dsh）
7. ⏳ **重启 dsh**：加载 chem-core（含新增 calc/reaction/papers/pdf/配方库/渲染路由与 client 卡片）
8. ⏳ 重启后：GUI 设置里把默认预设切换为「化学科研」，新会话验证 11 个工具 + 工具卡片结构图

## 环境要求

- Python 3.10+：`pip install rdkit ase pymupdf paper-qa litellm`（本机：Python 3.14.7 + RDKit 2026.03.3 + ase 3.29.0 + pymupdf 1.27.2.3 + paper-qa 2026.8.12 已验证）
- xtb：已安装于 `~/.dsh/chem/bin/xtb-6.7.1/bin/xtb.exe`（chem-core config `xtbPath` 或环境变量 `XTB_COMMAND` 可覆盖）
- 文献问答：LLM key 复用 DSH 凭证（`DEEPSEEK_API_KEY`，见 `~/.dsh/.credentials.yaml`）
- 自定义 Python 路径：profile 组合中 chem-core 行 config `python:` 或环境变量 `CHEM_PYTHON`

## 路线图

- **P0 ✓** 预设骨架 + 技能
- **P1 ✓** chem-core + 4 工具 + 集成测试
- **P2 ✓** client 半可视化（结构图进工具卡片）、ASE 计算（emt/xtb）、反应平衡 + SMARTS 模板
- **P3 ✓** Crossref 文献检索 + PDF 提取、ChemAgent 式配方记忆库、ChemBench 风格评测基准（57 项全绿）
- **P4 ✓**（按用户要求忽略 npm 发布）
  - **P4-1 ✓ xtb 计算**：xtb 6.7.1 二进制 + 引擎手写 GFN2-xTB subprocess 桥（ase 3.29 已移除 xtb 计算器）+ 独立长超时预算；同分异构体稳定性验证（丁醇 < 乙醚，Δ≈4.9 kJ/mol）
  - **P4-2 ✓ 本地文献问答**：`tools/paperqa_ask.py` 轻量 RAG（pymupdf 提取 + BM25 检索 + litellm/DeepSeek 综合，带 [n] 引用）；paper-qa 库已装（Python 3.14 兼容 ✓），但其索引/agent 运行时经实测评估不适用（全文索引 raw 字段无词元、aviary agent 挂起），故检索层自研；`--agent` 实验模式保留。2026-08-14 实测核验：8 论断 7 处逐字正确、1 处页码偏移（BM25 对图例数值召回不足，调参缓解）；引用纪律（逐条页码标注 + 脚注）与代理不可达预检已加入；高价值数值建议按引用页 ±1 复核
- **P5 ✓ 有机合成/逆合成**（规划确认：P5 先行/先 A 后 B/torch）
  - **P5.0**：AiZynthFinder 官方版实测不可用（v4.4.1 要求 Python <3.13）→ **用户完成 PY314 移植**（`C:\Users\cloud\Desktop\aizynthfinder_dsh_314`，官方测试 365 passed）→ **方案 A 复活并集成**
  - **P5.1 ✓**：手写验证的**断键模板库**（芳酯/芳酰胺/芳醚/芳硫醚/苄基/烯丙基/联芳/亚胺 8 类，实测确认 RDKit 环保留机制）+ `chem_retro_step`（SA score 排序 + atomConserved 标记）+ `chem_functional_groups`（24 种官能团 SMARTS）
  - **P5.2 ✓**：`chem_retro_plan` BFS 路线规划（砌块库终止 + 复杂度启发，实测生成两步路线）；**`chem_aizynth`**：AiZynthFinder 4.4.1（USPTO ONNX 策略 + ZINC 库存）完整反应树搜索（阿司匹林 3.7s 搜索、首解 0.01s、50 路线）
  - **P5.3 ✓**：`chem_reagents` 正向条件推荐（8 类反应规则表 + 逆向裂解备注）
  - **P5-AiZynth 审计修复 ✓**（验收报告驱动）：① 路线反应 SMILES 改用 `metadata.mapped_reaction_smiles`（原 `rxn.smiles` 为模板派生的非法串 `[cH3:5]`），reaction 节点带 `smilesValid` 标记；② 非法输入 RDKit 预检 + 引擎优先解析 stdout JSON，不再泄漏 Python 堆栈；③ AiZynth 模板反应为简化表示（离去小分子隐式），校验规则为「无制造原子」而非精确守恒
  - 工具总数 11 → **16**；benchmark 58 → **78 项全绿**；已知局限：模板为骨架级抽象（脂肪酯未覆盖、链上 R 裁剪），路线需人工化学校验；`chem_aizynth` 依赖 PY314 移植 venv（AIZYNTH_PYTHON/AIZYNTH_CONFIG 可覆盖）
- **P6 ✓ 药物化学/分子性质**（规划确认：接受 torch）
  - **P6.1 ✓** `chem_druglikeness`：Lipinski/Veber/REOS 逐条判定 + QED + SA score（阿司匹林 drug-like/QED 0.55、紫杉醇 not drug-like 验证）
  - **P6.2 ✓** `chem_similarity`（Morgan/MACCS + Tanimoto 排序）、`chem_cluster`（Butina + Murcko 骨架，实测修复 distFunc 语义）、`chem_mcs`
  - **P6.3 ✓** `chem_admet`：**torch 2.13 CPU + admet_ai 2.0.1**（104 端点：AMES/hERG/CYP/溶解度/毒性等，chemprop 集成模型）；实测修复 torch/torchvision CUDA 版本错配（cu128 vs cu132 → 统一 CPU 版）与 admet_ai 进度条污染 stdout JSON 协议
  - **P6.4 ✓** `chem_enumerate`：R-group 组合枚举（dummy 原子骨架，3×3=9 验证，去重/截断/失败计数）
  - **P6 审计修复 ✓**（2026-08-15 验收报告驱动）：`chem_similarity` 非法 target 的 `tanimoto: null` 触发 schema 拒绝导致整次调用不可用 → 改为**省略字段 + invalid 标记**（合法目标仍正常评分）；顺带修复同类 null 泄漏（`chem_druglikeness` qed/saScore、`chem_retro_step` saScore 失败时省略而非置 null）与排序 KeyError
  - 工具总数 16 → **22**；benchmark 78 → **95 项全绿**；ADMET 输出为模型预测（非实验数据），工具描述明确要求交叉核对
- **P7 ✓ 深化**（分子对接 + 3D 可视化；MCP 方案已记录）
  - **P7.1 ✓ `chem_dock`**：AutoDock Vina 1.2.5 + meeko 配体准备（SMILES→3D→PDBQT），受体直接吃 PDB（vina 内置转换）；1iep 测试体系验证（best ≈ -11.9 kcal/mol，9 poses）。实测修复：**vina 1.2.5 Windows 的 `--out` 写入随机丢失 model（1-9 波动）→ 改为解析 stdout 打分表**（始终完整）
  - **P7.2 ✓ 3D 可视化**：引擎 `convert` 新增 XYZ 输出（ETKDG 3D 坐标）+ `/api/dsh-chem/xyz` 路由 + 工具卡片「3D 查看」按钮（3Dmol.js CDN 双源加载，stick+sphere 渲染，可交互旋转）
  - **P7.3 MCP（方案已确认未启用）**：本机 `dsh-mcp-client` 接口成熟（stdio/streamable-http、工具命名 `mcp__<server>__<tool>`）；接入需在 profile 组合加行并安装 server（如 rdkit-mcp-server），改宿主组合有重启风险——**留作可选增强，未改动 profile**
  - **P7 审计修复 ✓**（2026-08-15 验收报告驱动）：① 「3D 查看」渲染位置错误（3Dmol.js canvas 为 absolute 定位，容器缺 `position: relative` 时逃逸到页面左上角）→ 容器加 `position: relative`；② `chem_convert` 工具枚举补 `xyz`（引擎已支持、工具侧未暴露——规格不一致修复）
  - 工具总数 22 → **23**；benchmark 95 → **100 项全绿**；dock 评分为半经验打分（非结合自由能）
- **P8 ✓ 虚拟筛选与工作流管线**
  - **P8.1 ✓ `chem_screen`**：一站式筛选——枚举 → Lipinski/Veber/QED/SA 规则过滤 → 可选 ADMET 端点阈值过滤（批量模型调用）→ 可选 Tanimoto 相似性排序 → 可选 markdown 报告落盘
  - **P8.2 ✓ 批量对接**：`chem_dock` 新增 batch 模式（≤5 配体 vs 单受体，串行，亲和力排序表）
  - **P8.3 ✓ 筛选报告**：`reportPath` 自动生成筛选漏斗 + 命中表 markdown（实测 3×3 库 → 9 命中排序 → 报告落盘）
  - **P8 审计修复 ✓**（2026-08-15 验收报告驱动）：`chem_screen` 输出含 schema 未声明的 `rulePassed` 字段 → harness 拒绝（`additionalProperties: false`）→ 删除冗余字段 + 集成测试回归守卫（断言输出不含该键）；引擎即时生效
  - 工具总数 23 → **24**；benchmark 100 → **106 项全绿**
- **P9 ✓ 对接深化与复合物可视化**
  - **P9.1 ✓** vina 升级 1.2.7（实测确认 out 写入不稳定为 Windows 构建固有行为，1.2.5/1.2.7 均波动 1-9 model——维持 stdout 表解析；**MODEL 1（best pose）始终存在**）→ `poseOut` 选项返回 best pose XYZ 坐标
  - **P9.2 ✓ 复合物 3D**：`/api/dsh-chem/complex` 路由（loopback-only，读受体 PDB + 实时对接 best pose）→ chem_dock 卡片「对接查看」按钮——3Dmol.js 渲染受体（cartoon + VDW 表面）+ 配体 pose（橙色 stick），直接目检结合模式
  - **P9.3** 严格受体准备：ADFRsuite 预制备 PDBQT 记入工具描述（vina 内置转换为筛选级）
  - **P9 审计修复 ✓**（2026-08-15 GUI 目检驱动，两轮）：①「对接查看」卡在「对接计算中…」且空白——complexView useEffect 依赖含每次渲染新建的 `dockArgs` 对象 → 重渲染清理并取消在途 fetch → **ref 持有 + 稳定依赖**；② 修复后仍卡 >10 分钟——根因是 **3Dmol.js CDN script 加载挂起**（受限网络下 onerror 不触发、promise 永不 settle，卡在对接前的加载环节）→ **3Dmol.js 本地化**（vendor/3Dmol-min.js + `/api/dsh-chem/3dmol.js` 同源路由，CDN 降级为回退）+ **15s 加载总超时**（任何情况下状态机必 settle）
  - benchmark 106 → **107 项全绿**（poseOut XYZ 帧断言）
