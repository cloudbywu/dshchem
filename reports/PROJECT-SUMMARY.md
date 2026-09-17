# dshchem 项目成果总览（截至 2026-08-14）

> DSH（DeepSeek Harness）化学科研 Agent 预设与插件环境。从调研 → 架构 → P0–P4 全部交付。
> 配套验证报告见 `reports/`，测试 Prompt 集见 `reports/chemist-testing-prompts.md`。

---

## 一、调研成果（决策依据）

| 成果 | 要点 |
|---|---|
| `research/化学科研LLM-agent开源项目调研报告.md` | 13 个必查项目 + 7 个补充项目逐一核实（star/最后提交/许可均经 GitHub/GitLab/PyPI API 实测）：活跃可依赖 PaperQA2(9030★)/ChemGraph/AtomisticSkills/ScienceAgentBench/ChemBench；停更避开 chemcrow-public/Coscientist(Commons Clause)/OpenBabel(GPL-2.0)；三大范式（工具+校验回路 / 三层记忆 / 评测先行）被本设计采用 |
| GitHub dsh-plugin 生态调研（子代理） | topic 污染严重（1649→约 280 真实）；官方仅 deepseek-harness(84.2k★)；本机插件全家桶出自社区 dsh-web-ui(1.5k★)，其 bundle 双端架构成为模板；化学 DSH 插件空白 → 自建 |
| 本机 DSH 源码勘察 | 三层 patch 组合机制、agent-presets 名册（system/user 双根）、dsh-ssh 双端 bundle 模板、dsh-tool-web 预设行工具包模板、预设行包名从 harness 基座解析、MCP 能力潜伏可用（dsh-mcp-client 已装未挂载） |

## 二、系统架构（用户确认：host 服务 + 预设工具行分离）

```
┌─ 预设层 ~/.dsh/.agent-presets/chemist/（persona + 化学规则 + 工具行）
│   技能层 ~/.dsh/skills/chem-literature · chem-safety
├─ Host 平面 @dshchem/dsh-chem-core（bundle 插件）
│   chem 服务：Python 桥(RDKit/ASE) · PubChem · Crossref · 配方库 · render-svg 路由
├─ 工具层 @dshchem/dsh-tool-chem（预设行，11 个 chem_* 工具，仅化学会话可见）
└─ 浏览器层 client.js（tool.call.toolview 卡片：2D 结构图 + 结果文本）
```

## 三、阶段交付（P0–P7 全部完成）

| 阶段 | 交付物 |
|---|---|
| **P0** | `chemist` 预设（agent.cordis.yml + preset.yml）：化学科研 persona + 六条强制规则（工具产出分子事实/来源标注/不编造/安全优先/单位规范/方法级别）；2 个技能包 |
| **P1** | `dsh-chem-core`（chem 服务 + Python/RDKit 桥 + PubChem）+ `dsh-tool-chem`（4 工具）；挂载校验 + 集成测试；junction 依赖解析机制 |
| **P2** | client 半可视化（结构图进工具卡片，Slot: tool.call.toolview）+ `chem_calc`(ASE/EMT) + `chem_reaction`(原子守恒/SMARTS 模板) + render-svg 路由(loopback-only) |
| **P3** | `chem_papers`(Crossref) + `chem_pdf`(PyMuPDF) + 配方记忆库(recipe_save/search/list, ~/.dsh/chem/recipes.json) + ChemBench 风格 benchmark(58 项) |
| **P4** | xtb 6.7.1 二进制 + 引擎 GFN2-xTB subprocess 桥（独立 180s 超时、异构体稳定性验证 Δ=4.9 kJ/mol）+ `tools/paperqa_ask.py` 本地文献 RAG（pymupdf+BM25+litellm/DeepSeek，带 [n] 引用；引用纪律 + 代理预检；npm 发布按用户要求忽略） |
| **P5** | 有机合成/逆合成：模板库（8 类断键，环保留机制实测）+ `chem_retro_step`（SA 评分/守恒标记）+ `chem_functional_groups`（24 类）+ `chem_retro_plan`（BFS 路线）+ `chem_reagents`（条件推荐）+ **`chem_aizynth`**（用户 PY314 移植版 AiZynthFinder 4.4.1，USPTO 策略 + ZINC 库存，含序列化/堆栈泄漏审计修复） |
| **P6** | 药物化学：`chem_druglikeness`（Lipinski/Veber/REOS/QED/SA）+ `chem_similarity`（Morgan/MACCS+Tanimoto）+ `chem_cluster`（Butina+Murcko）+ `chem_mcs` + `chem_enumerate`（R-group）+ **`chem_admet`**（torch 2.13 CPU + admet_ai 2.0.1，104 端点；版本错配/stdout 污染修复） |
| **P7** | 深化：**`chem_dock`**（AutoDock Vina 1.2.5 + meeko，1iep 体系 -11.94 kcal/mol；vina Windows out 写入不稳 → stdout 表解析）+ **3D 可视化**（XYZ 输出 + /api/dsh-chem/xyz + 3Dmol.js 卡片视图；定位逃逸修复）+ MCP 可行性确认（方案记录未启用） |

## 四、工具清单（23 个 chem_* 工具）

| 工具 | 功能 | 后端 |
|---|---|---|
| chem_validate | SMILES 校验/canonical/公式/InChI/InChIKey | RDKit |
| chem_props | MW/logP/TPSA/HBD/HBA/旋转键/电荷/可选 IUPAC | RDKit |
| chem_convert | canonical/inchi/inchikey/mol/sdf/SVG/**XYZ(3D)** | RDKit |
| chem_pubchem | CID/MW/XLogP3/TPSA/HBD/HBA 交叉核对 + 名称补全 | PubChem PUG |
| chem_calc | 弛豫/单点能量（emt 内置 / xtb GFN2-xTB），>60 重原子拒绝 | ASE/xtb |
| chem_reaction | 反应原子守恒检查 + SMARTS 模板产物预测 | RDKit |
| chem_recipe_save/search/list | 配方记忆库（跨会话持久化，ChemAgent 式知识沉淀） | ~/.dsh/chem/recipes.json |
| chem_papers | 文献检索（DOI/期刊/作者/摘要） | Crossref |
| chem_pdf | 本地 PDF 文本提取 | PyMuPDF |
| chem_retro_step | 单步逆合成（8 类模板，SA 评分 + atomConserved） | RDKit |
| chem_functional_groups | 24 种官能团识别 | RDKit |
| chem_retro_plan | BFS 逆合成路线规划（砌块库终止） | RDKit |
| chem_reagents | 正向合成条件推荐（8 类规则表） | 规则库 |
| chem_aizynth | ML 逆合成（USPTO 策略 + ZINC 库存，完整反应树） | AiZynthFinder 4.4.1 (PY314 移植) |
| chem_druglikeness | Lipinski/Veber/REOS + QED + SA score | RDKit |
| chem_similarity | Morgan/MACCS 指纹 Tanimoto 排序 | RDKit |
| chem_cluster | Butina 聚类 + Murcko 骨架统计 | RDKit |
| chem_mcs | 最大公共子结构（SMARTS + 原子/键数） | RDKit |
| chem_enumerate | R-group 组合库枚举 | RDKit |
| chem_admet | 104 端点 ADMET 预测（chemprop 集成模型） | admet_ai 2.0.1 + torch |
| chem_dock | 分子对接（SMILES→meeko→vina，pose 打分） | AutoDock Vina 1.2.5 |
| （附）tools/paperqa_ask.py | 本地 PDF 语料 RAG 问答（带 [n] 引用） | pymupdf+BM25+litellm |

## 五、测试与评测防线

| 防线 | 规模 | 状态 |
|---|---|---|
| `test/integration.mjs` | 23 工具真实注册 + 执行 + 12 组 schema/类型守护断言（mw 数字、能量、平衡、配方 id、xtb、pdf、retro、fg、plan、reagents、aizynth 有效树、druglikeness、similarity、cluster、mcs、enumerate、admet、dock、xyz 帧） | ✅ 全绿 |
| `test/benchmark.mjs` | **100 项**：性质(10 分子)/校验/反应平衡/模板/EMT/xtb 异构体/网络交叉核对/logP 算法核对/Crossref/记忆/逆合成(4)/官能团/路线/Suzuki 条件/AiZynth(含无制造原子)/类药性(2)/QED/Lipinski/相似性(含混合列表)/MACCS/Butina/Murcko/MCS/枚举/ADMET(104 端点)/对接(5) | ✅ 100/100 |
| 文献 RAG 冒烟 | Sharpless 语料问答（真实 LLM） | ✅ |
| 人工验证报告 | 8 份：阿司匹林交叉核对 / xtb 启用 / PaperQA 问答 / 结构图卡片 / P5-AiZynth 审计 / P6 验收 / P7 验收 / 自检 | ✅ 见 reports/ |

## 六、过程中修复的问题（16 项，均带回归防护）

| # | 问题 | 修复 |
|---|---|---|
| 1 | PubChem MolecularWeight 字符串 vs schema number | 数值归一化 + 回归断言 |
| 2 | client 卡片未注册（slots 时序） | client 导出 `inject: ["slots"]` 等待服务 |
| 3 | render-svg 路由未注册（webServer 时序） | chem-core `inject: ["webServer"]` 硬依赖 |
| 4 | Crossref 缺字段条目返回 null → schema 拒绝 | 缺失字段省略 + 断言 |
| 5 | chem_calc xtbOutputTail 未声明字段 | 引擎移除该字段 |
| 6 | 非法 SMILES 触发渲染 400 | 卡片跳过 + 错误分类降级 |
| 7 | RDKit SVG 480×360 溢出卡片 | width/height 100% + viewBox 缩放 |
| 8 | 死代理导致 LLM 连接拒绝 | 脚本代理不可达预检告警 |
| 9 | 文献引用页码错配 | 引用纪律 prompt + top_n 12 + 段落不截断 |
| 10 | AiZynth 路线 SMILES 非法（`[cH3:5]`） | mapped_reaction_smiles 优先 + smilesValid 标记 |
| 11 | AiZynth 非法输入堆栈泄漏 | RDKit 预检 + 引擎优先解析 stdout JSON |
| 12 | Butina 聚类 distFunc 语义（欧氏距离对位向量失效） | 显式 Tanimoto 距离 + 1-cutoff 阈值 |
| 13 | torch/torchvision CUDA 版本错配（cu128 vs cu132） | PyTorch CPU 索引重装匹配版 |
| 14 | admet_ai 进度条污染 stdout JSON 协议 | redirect_stdout 隔离 |
| 15 | chem_similarity 非法 target 的 null → schema 拒绝 | 省略字段 + invalid 标记（含 druglikeness/retro 同型修复） |
| 16 | vina Windows --out 写入随机丢 model；3D 视图逃逸左上角 | stdout 打分表解析；viewer 容器 position:relative |

## 七、已知局限（诚实记录）

1. **BM25 对图例/表格数值召回不足**：文献问答页码可能偏移 1-2 页——高价值数值按引用页 ±1 复核
2. **paper-qa 官方 agent 运行时不可用** → 检索层自研；`--agent` 实验模式保留
3. **xtb 为半经验方法**：定性至半定量（典型误差 1-3 kcal/mol）；定量需 DFT+ZPE
4. **chem 服务代码（.js）改动需重启 dsh**；引擎（.py）经 junction + 每请求 spawn 即时生效
5. **MCP 化学工具生态未接入**（本机 dsh-mcp-client 潜伏可用，方案已记录未启用）
6. **vina 受体为内置转换**（严格研究应 ADFRsuite 预制备 PDBQT）；docking score 非结合自由能
7. **ADMET 为模型预测**（非实验数据）；关键端点需文献/实验交叉核对

## 八、使用入口

- **日常使用**：重启 dsh → 设置选择「化学科研」预设 → 新会话（23 工具 + 结构图/3D 卡片）
- **测试**：Prompt A 主验收 + B1-B8 专项 + P5/P6/P7 阶段 Prompt（reports/chemist-testing-prompts.md）
- **回归**：`node test/integration.mjs`、`node test/benchmark.mjs`、`python tools/paperqa_ask.py ...`
- **环境**：Python 3.14 + RDKit 2026.03.5 + ase 3.29 + pymupdf 1.27 + paper-qa 2026.8.12 + torch 2.13 CPU + admet_ai 2.0.1 + xtb 6.7.1 + vina 1.2.5 + meeko 0.7 + AiZynthFinder 4.4.1（PY314 移植 venv）+ DEEPSEEK_API_KEY（复用 DSH 凭证）
