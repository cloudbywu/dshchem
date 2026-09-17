# 面向化学科研的 LLM Agent / 自动化实验 / 计算化学工具链 —— 开源项目调研报告

> 调研目的：为在 DSH（DeepSeek Harness）上设计化学科研 agent 预设提供选型依据。
> 数据快照：2026-08-14。星标数 / 最后 push / 许可证均通过 GitHub REST API、GitLab API、PyPI JSON 逐一核实；架构与技术栈信息来自各仓库 README 原文与论文（已附 URL）。未核实到的项目（LlamaChem、FHI 多体模拟 Aviary、NVIDIA CRADLE 代码）均如实标注，未编造。
> 已下载的 README 原文保存在 `research/` 目录（`*README.md`），可作证据复核。

---

## 一、必查项目逐一报告

### A. 合成规划 / 通用化学推理 agent

#### 1. ChemCrow —— `ur-whitelab/chemcrow-public` ⭐946 · MIT · 最后 push 2024-12-19

**解决什么问题**：化学家/化学研究者用自然语言完成"推理密集型"化学任务——合成路线规划（retrosynthesis）、反应产物预测、分子性质计算（分子量、logP 等）、专利检索、文献查询。定位是"化学版 Code Interpreter"：LLM 负责拆解任务，化学工具负责算事实。论文：arXiv:2304.05376（2023）→ Nature Machine Intelligence（2024）。

**架构**：经典 **ReAct 单 agent + 工具调用回路**（LangChain 实现）：LLM 提出动作 → 工具执行 → 结果回喂 LLM → 下一步；支持 **human-in-the-loop** 校验（重要/危险步骤人工确认）。工具以 Python 函数/API 封装：RDKit（分子表示、性质）、paper-qa（文献）、PubChem/ChemSpace（数据库查询）、molbloom（专利）、RXN4Chem API（逆合成与正反应预测，可 Docker 自托管本地版）、化学反应与安全分析工具等（论文约 18 个工具）。**记忆/数据库层**：无长期记忆，靠对话上下文 + 外部数据库。

**技术栈**：Python；LangChain；RDKit；OpenAI（GPT-4 系列）；外部 API：PubChem、ChemSpace、IBM RXN4Chem、SerpAPI（可选）。PyPI `chemcrow` 最新 0.3.24（2024-03-27 上传，Python 3.9–3.12）。

**活跃度**：946★，MIT。注意：**PyPI 包 2024-03 后未再发版，GitHub 最后实质性 push 2024-12**——2025 年起基本停更；README 明确警告"不包含论文全部工具（API 限制），结果与论文不可复现"，实验日志单独放在 `chemcrow-runs`。

**值得复用**：①工具+校验回路设计（LLM 规划、工具执行、结果回喂）是化学 agent 的行业模板；②工具清单（RDKit 性质/反应、PubChem、专利、安全）几乎被后续项目（ChemMCP、ChemGraph 等）原样复用；③RXN4Chem 自托管 Docker 模式是"外部 API 可降级"的示范。
**明显缺陷**：①对 LLM 幻觉的校验只靠工具输出与人工，SMILES/性质仍需人工核对；②依赖单一 LLM（OpenAI）与 LangChain 旧版；③仓库/包停更、依赖老化；④逆合成等强依赖 RXN API（速度慢、要 key）。

#### 2. ChemAgent —— `gersteinlab/ChemAgent` ⭐90 · Apache-2.0（README 标注）· 最后 push 2025-07-31

**说明**：用户标注"NVIDIA"，**实际归属为耶鲁 Gerstein 实验室（ICLR 2025）**，作者群含 NVIDIA 背景学者——本报告按真实仓库归属记录。

**解决什么问题**：提升 LLM 在**化学推理题**（量子化学、化学物质、材料、普通化学，来自 SciBench 的 atkins/chemmc/matter/quan 四数据集）上的正确率，核心卖点是"**自更新记忆库**"（self-updating library）——论文 arXiv:2501.06590。

**架构**：基于 **XAgent 的多模块单 agent**：任务切分（task splitting）→ 执行（Python 工具）→ 关联（association）→ 反思（reflection）；记忆分三层：**Plan Memory（规划记忆）+ Execute Memory（执行记忆）+ Knowledge Memory（知识记忆）**，成功方案沉淀到记忆池供后续任务复用；执行失败触发策略细化（refine）。配置 gpt-3.5-turbo-16k 为主模型、gpt-4 为评测模型。

**技术栈**：Python；XAgent 框架（自研）；SciBench 数据集；OpenAI API。

**活跃度**：90★，最后 push 2025-07-31，2025 年后基本停更。**研究代码质量**：README 留有"Add installation instructions here"占位符，文档粗糙，属论文配套代码而非产品。

**值得复用**：①plan/execute/knowledge 三层记忆 + "失败→记忆沉淀→下次复用"的思路，非常适合 DSH 会话级记忆设计；②记忆池文件化（JSON），实现简单可借鉴。
**明显缺陷**：①评测局限在选择题/简答类，非真实实验；②代码工程化差、无 CI/包；③绑定 OpenAI；④停更风险高。

#### 3. ChemMCP —— `OSU-NLP-Group/ChemMCP` ⭐70 · Apache-2.0 · 最后 push 2025-06-09

**解决什么问题**：把"化学工具箱"做成 **MCP（Model Context Protocol）标准工具集**，让任意 MCP 客户端（Claude Code、Cursor、各类 agent 框架）即插即用地获得化学能力：分子分析、性质预测、反应预测、逆合成、安全检测等约 30 个工具。论文：ChemMCP（2025）与 ChemToolAgent（arXiv:2411.07228）。

**架构**：**工具层独立于 agent**——统一 schema、逐工具一个 Python 文件、自动文档；既可经 MCP 接入任何 LLM 客户端，也可作纯 Python 库嵌入自研管线；自带安全检测工具（SafetyCheck）与 Python 执行器（Jupyter+docker 沙箱）；原生支持多轮 tool-using agent 交互（RL 测试床）。工具来源：RDKit + ChemCrow 工具集 + Uni-Mol 性质模型（BBBP/毒性/溶解度/logP/HIV）+ MolT5 生成/命名 + IBM RXN 逆合成 + PubChem/ChemSpace/Tavily。

**技术栈**：Python；MCP Python SDK；RDKit；Uni-Mol/Uni-Core（PyTorch）；MolT5；IBM RXN、PubChem、ChemSpace、Tavily 云 API。

**活跃度**：70★，最后 push 2025-06-09，近一年未更新；但有完整文档站与工具清单（含每个工具的依赖与许可证表，非常规范）。

**值得复用**：①**MCP 化工具集是 DSH 预设接化学能力的现成路径**（若 DSH 支持 MCP 客户端，可整包接入）；②工具粒度适中（分子级/反应级/安全级）；③许可证与依赖透明表。
**明显缺陷**：①部分工具依赖云服务（IBM RXN、ChemSpace、Tavily）与外部模型（Uni-Mol），离线/自托管能力弱；②停更中；③是"工具包"而非完整 agent，需自行搭循环。

---

### B. 实验自动化 / 端到端自主研究

#### 4. Coscientist —— `gomesgroup/coscientist` ⭐208 · Apache-2.0 + Commons Clause（商用受限）· 最后 push 2025-08-11

**解决什么问题**：端到端自主化学研究：从自然语言指令出发完成**实验设计→协议生成→真实实验执行（液体处理机器人）→结果优化**。2023 年 CMU（Gomes 组）发表于 Nature（s41586-023-06792-0），代表作：自主规划并执行 Suzuki 偶联、复现诺奖级反应、色度优化实验。

**架构**：**单模型分层规划 + 专业化模块**：GPT-4 "lead agent" 拆解任务并派发；四个模块——**WebSearch**（Google 定制搜索，合成规划检索）、**Documentation**（技术文档检索）、**Code**（Python/Node 沙箱代码执行）、**Automation**（Opentrons 液体处理 + 实验室仪器控制）；带**验证回路**（代码语法检查、自反思、文档-代码-实验逐级校验）；支持多轮优化循环。仓库是论文 supporting information（含 `simple_implementation` 简易版）。

**技术栈**：Python；OpenAI GPT-4；Google Custom Search；Opentrons（实验自动化硬件）。

**活跃度**：208★；仓库本质是论文附材（数据/notebooks），非持续维护的库；许可证含 **Commons Clause，商用受限**。

**值得复用**：①lead agent + 专业模块（文献/代码/自动化）的分层设计是"复杂科学任务编排"的教科书；②验证回路（每层输出都过校验再进下一层）必须学；③代码执行沙箱模式。
**明显缺陷**：①绑定 OpenAI 与真实实验室硬件（Opentrons），纯软件复现只能到"代码+规划"层；②**商用许可证陷阱**；③仓库无维护、无 PyPI 包，是研究原型而非软件；④多模块编排 token 消耗大。

#### 5. OpenAD —— `acceleratedscience/openad-toolkit`（PyPI `openad` v0.8.0）⭐16 · MIT · 最后 push 2026-03-24

**解决什么问题**：IBM Research Accelerated Science 的"开放加速发现"低代码工具包——统一接入 AI 模型与科学服务（分子/材料发现），通过 **CLI / Jupyter magic / API 三种入口**加速发现工作流，目标用户是"不想写代码的科学家"。

**架构**：**LLM 辅助的低代码 CLI**（非经典 agent 循环）：`openad` 命令 + Jupyter cell magic 提供自然语言/命令式交互；**插件（plugin）架构**承载各类"service"（如 REINVENT4 分子生成、BMFM 生物医学基础模型等，各 service 独立仓库 `openad-service-*`）；v0.7.5 起退役 RXN/Deep Search 工具集、改为新插件体系；配套可视化。

**技术栈**：Python（CLI）+ JavaScript（工具包组件）；IBM 及第三方 AI 服务 API；Jupyter。

**活跃度**：16★（社区很小），PyPI 活跃发版（0.8.0），属于 IBM 主导的"公司开源"项目。

**值得复用**：①低代码多入口（CLI+Notebook+API 同一内核）的交互设计；②service 插件化思路（= DSH 的工具/插件注册思想）。
**明显缺陷**：①社区与 star 极小，生态薄弱；②部分能力依赖 IBM 云 API/服务；③它本身不是 agent 循环，LLM 只是入口辅助，自动化程度低。

#### 6. Dolphin —— `InternScience/Dolphin` ⭐44 · 许可证未标注（NOASSERTION）· 最后 push 2025-06-24

**解决什么问题**：科研闭环自动化——**提出新想法 → 自动写代码实现 → 分析结果 → 反馈驱动下一轮想法**（ACL 2025 主会，arXiv:2501.03916）。验证场景是机器学习类任务（点分类/图像分类/情感分类），并非化学专用，但"闭环自研"架构对化学 agent 预设的长期目标有参考价值。

**架构**：**闭环循环**：基于上轮实验反馈 + 相关论文排序（按主题/任务属性）生成新 idea → 用"异常 traceback 引导的局部代码结构"精修调试代码模板实现 idea → 自动分析结果并回填下一轮。支持自部署模型（ollama）。

**技术栈**：Python；OpenAI API / ollama；AutoAD 文档。

**活跃度**：44★，2025-06 发布代码后基本停更，仅论文配套。

**值得复用**：反馈回路 + 论文排序驱动的 idea 生成管线。
**明显缺陷**：①非化学领域（ML 任务演示）；②代码/文档单薄；③停更。

---

### C. 文献调研 / 知识问答

#### 7. PaperQA2 —— `Future-House/paper-qa` ⭐9030 · Apache-2.0 · 最后 push 2026-08-12（非常活跃）

**解决什么问题**：面向科学文献的**高精度 agentic RAG**——对 PDF/文本/Office/代码文件提问，输出**带行内引用的 grounded 答案**；在科学问答、总结、矛盾检测任务上声称超越人类专家（论文 arXiv:2409.13740，PaperQA2）。

**架构**：**agentic 检索-重排-摘要-综合管线**：自动获取论文元数据（引用数、期刊质量、撤稿检查，来自 Semantic Scholar/Crossref/Unpaywall）→ tantivy 全文索引 → 检索 → **LLM 重排（rerank）+ 上下文摘要（RCS）**→ agent 迭代改写查询、多轮检索 → 最终综合答案带引用；LiteLLM 统一多家模型（OpenAI/Claude/本地皆可），向量库默认 NumPy 可换外部 DB；支持代码/多模态文件。

**技术栈**：Python；LiteLLM；tantivy；Semantic Scholar/Crossref/Unpaywall；Pydantic。

**活跃度**：9030★，Apache-2.0，月度活跃更新、CalVer 发版——目前**化学文献层最值得依赖的项目**。

**值得复用**：①**文献工具直接复用其管线**（检索→重排→RCS→引用）作为 DSH 化学预设的文献检索工具后端；②citation grounding 杜绝无出处结论；③LiteLLM 多 provider 抽象。
**明显缺陷**：①非化学专用（化学语料需自行构建/订阅）；②完整管线依赖多个外部元数据 API，有速率限制。

---

### D. 评测基准与 agent 环境

#### 8. ChemBench —— `lamalab-org/chembench` ⭐144 · MIT · 最后 push 2026-01-26

**解决什么问题**：**评测 LLM/多模态模型在化学任务上的表现**（"LLM 是超人化学家吗？"，arXiv:2404.01475；多模态扩展 arXiv:2411.16955）。LAMALab（MIT Jablonka 组）出品，可类比"化学版 lm-evaluation-harness"。

**架构**：模块化评测框架：数据集（HuggingFace）→ PrompterBuilder 接入任意模型（含带工具评测）→ 评测 → 分主题报告 + 在线 leaderboard（HF Space）。

**技术栈**：Python；HuggingFace datasets；支持 OpenAI/Groq/本地模型等。

**活跃度**：144★，MIT，2026-01 仍在更新；有文档站与 eval-card。

**值得复用**：①**DSH 化学预设的验收评测集**（直接跑 ChemBench 验证预设能力）；②任务分类法（性质预测/命名/反应/机理等）。
**明显缺陷**：①是基准非 agent；②部分数据集/接口需外部 API；③"超人类"结论依赖具体模型与提示词，勿过度解读。

#### 9. ScienceAgentBench —— `OSU-NLP-Group/ScienceAgentBench` ⭐154 · MIT · 最后 push 2026-07-18

**解决什么问题**：对"数据驱动科学发现 agent"做**严格评测**：从 44 篇同行评审论文抽取 **102 个任务**（四个学科，含化学/生物/材料等），统一输出为**自包含 Python 程序**，用程序合法性、执行结果、成本多指标评估（ICLR 2025，arXiv:2410.05080）。

**架构**：任务 → agent 生成代码 → 隔离环境执行 → 自动评分；评测环境 **Docker 容器化**（102 实例约 30 分钟/8 线程）；支持 knowledge 注入与 self-debug；**防数据污染**（测试数据不公开，需申请）；2026-04 发布 verified 版本缓解误判（false negatives）；已集成进 OpenHands 评测。

**技术栈**：Python；OpenAI / Amazon Bedrock（llama/mistral/claude）；Docker；pip-tools 自动装依赖。

**活跃度**：154★，MIT，2026-07 仍在更新（活跃维护）。

**值得复用**：①**agent 能力验收的黄金基准**——DSH 化学预设上线前可用其代码型任务做回归；②容器化隔离执行 + 防污染评测方法；③"四学科 44 论文 102 任务"的任务来源清单可反向提炼出工具需求。
**明显缺陷**：①限定"代码型数据任务"，不含物理实验/DFT 计算；②评测环境搭建较重。

#### 10. Aviary —— `Future-House/aviary` ⭐277 · Apache-2.0 · 最后 push 2026-08-14（活跃）

**解决什么问题**：**语言 agent 的强化学习环境（gymnasium）**：为科学任务定义标准 env + reward，配合姊妹库 LDP（Language Decision Process）训练/评估 agent；内置环境：数学（GSM8k）、通用知识（HotPotQA）、**生物序列（LabBench）**、文献检索（LFRQA）、蛋白质稳定性、Jupyter notebook 环境（论文 arXiv:2412.21154）。

**架构**：Gymnasium 风格：`Environment` 定义状态与工具（Tool.from_function），agent 以 ToolRequestMessage 行动、环境返回观察+reward；异步；与 LDP 深度绑定做 RL 训练。

**技术栈**：Python；async；LiteLLM/本地模型。

**活跃度**：277★，Apache-2.0，2026-08 仍在活跃开发。

**值得复用**：①"任务即 env + reward"的抽象，做 agent 调优/评测的好范式；②工具即动作的接口设计。
**明显缺陷**：①无化学专用 env（偏生物/数学）；②RL 训练门槛高。

> ⚠️ **关于"FHI 多体模拟 Aviary"**：用户所指的 FHI（柏林）多体模拟框架 Aviary 未能在 GitHub/GitLab 检索到公共仓库（`Quantum-Aviary/aviary`、`mlm-org/aviary` 均 404，GitHub 搜索无结果）。化学 agent 语境下可核实、活跃的 Aviary 即上述 FutureHouse 项目。建议后续专项核实 FHI 版本是否仅随论文/机构内部发布。

---

### E. 计算化学工具链 / 接口类（DFT 自动化、分子模拟封装）

#### 11. ChemGraph —— `argonne-lcf/ChemGraph` ⭐146 · Apache-2.0 · 最后 push 2026-08-13（活跃）

**解决什么问题**：**用自然语言自动跑分子模拟工作流**：结构生成 → 几何优化 → 热化学计算等；支持**从头算（NWChem、ORCA）、半经验（XTB/TBLite）、机器学习势（MACE、UMA）**，通过 ASE 统一后端。阿贡国家实验室 LCF 出品。

**架构**：**LangGraph agentic 工作流图**（任务以图节点编排，非自由散漫的循环）；ASE 统一计算器抽象；多入口：CLI（`chemgraph -q "query"`）、Streamlit UI、JupyterLab、**MCP server（streamable HTTP）**、Docker/GHCR 镜像；多 LLM provider（OpenAI/Anthropic/Gemini/Groq/ALCF 推理端点）。

**技术栈**：Python；LangGraph；ASE；NWChem/ORCA/TBLite/MACE/UMA；LangChain 生态。

**活跃度**：146★，Apache-2.0，2026-08 活跃更新（CI、Docker、PyPI 齐全）——**当前计算化学 agent 领域最值得跟踪的新项目**。

**值得复用**：①**ASE 统一后端 + 任务级工具粒度**（结构生成/单点/弛豫/热化学）——工具不粗不细的范本；②MCP server 形态可直接接入 DSH；③多 provider LLM 抽象；④工程完整（CI/测试/Docker/文档）。
**明显缺陷**：①依赖冲突（MACE 需 e3nn==0.4.4，UMA 需 e3nn>=0.5，二者不能同环境）；②真实 DFT 计算需 HPC/GPU 资源；③项目年轻，API 变动快。

#### 12. AtomisticSkills —— `learningmatter-mit/AtomisticSkills` ⭐145 · MIT · 最后 push 2026-08-13（活跃）

**解决什么问题**：把**原子级模拟能力做成"Agent Skills"**（Claude Code / Cursor / Antigravity / OpenClaw 等 agentic IDE 的 skill 标准），让任意编码 agent 获得 ASE 驱动的结构构建、计算、分析能力。MIT（Learning Matter Lab）出品。

**架构**：**技能包（skill）模式**：每个 skill = 带说明的代码片段/工具集，随 agent 上下文注入按需调用；底层 ASE；与"Agent Skills"开放标准兼容。

**技术栈**：Python；ASE；agentic IDE skill 生态。

**活跃度**：145★，MIT，2026-08 活跃。

**值得复用**：**skill 化封装思路与 DSH 预设（persona + tools + skills）几乎同构**——其 skill 清单可直接映射为 DSH 化学预设的技能/工具。
**明显缺陷**：①依赖目标 IDE 的 skill 机制，非独立 agent；②模拟算力仍受限于本地。

#### 13. 底层化学/材料库（工具封装的对象）

| 库 | 仓库 | star | 许可 | 状态 | 定位 |
|---|---|---|---|---|---|
| RDKit | github.com/rdkit/rdkit | 3552 | BSD-3-Clause | 活跃 | 化学信息学核心：SMILES 规范化、描述符、反应、指纹（**必装**） |
| Open Babel | github.com/openbabel/openbabel | 1369 | **GPL-2.0** | 活跃 | 100+ 格式互转；注意 GPL 传染性 |
| ASE | gitlab.com/ase/ase | 516（GitLab） | LGPL | 活跃 | 计算器统一抽象，对接 xtb/ORCA/NWChem 等 30+ 程序（**DFT 自动化的枢纽**） |
| pymatgen | github.com/materialsproject/pymatgen | 1942 | MIT（修改版） | 活跃 | 晶体结构、热力学、DFT 后处理、Materials Project API |
| xtb | github.com/grimme-lab/xtb | 828 | LGPL-3.0 | 活跃 | GFN-xTB 半经验引擎：快、准，适合 agent 高频调用 |
| atomate/atomate2 | github.com/hackingmaterials/atomate | 263 | MIT（修改版） | 缓慢 | FireWorks 驱动的 DFT 自动化工作流引擎 |
| AiiDA | github.com/aiidateam/aiida-core | 577 | MIT | 活跃 | 计算工作流 + 数据溯源（provenance）引擎 |

**ORCA / Gaussian**：均为**闭源商业软件**（ORCA 学术免费、Gaussian 商业授权），无官方开源仓库；LLM 封装方式以 ChemGraph（ORCA 经 ASE）为代表，或直接子进程调用输入/输出文件。

---

### F. 补充发现（调研中发现的同类重要项目）

| 项目 | 仓库 | star/许可/最后 push | 一句话 |
|---|---|---|---|
| ChemLLMBench | ChemFoundationModels/ChemLLMBench | 174 / 未标注 / 2024-07 | NeurIPS 2023"LLM 能在化学做什么"八任务基准（**可能是"LlamaChem"的相近所指**） |
| ChemDFM | OpenDFM/ChemDFM | 109 / Apache-2.0 / 2025-05 | 复旦开源的化学对话基础模型（agent 式问答/工具） |
| LLM4Chem / LlaSMol | OSU-NLP-Group/LLM4Chem | 113 / MIT / 2025-06 | 化学指令微调数据 + 评测综述 |
| MatAgent | adibgpt/MatAgent | 23 / MIT / 2025-02 | 物理感知多 agent 材料发现框架（小但可参考） |
| awesome-agents4science | OSU-NLP-Group/awesome-agents4science | — | 科学 agent 论文/项目精选列表（持续追踪入口） |
| CRADLE（NVIDIA 系自主材料研究） | 未找到官方公开仓库 | — | 同名混淆多（Cradle.bio 等无关项目）；论文存在但**代码未核实到公开仓库**，未展开 |
| **LlamaChem** | **未核实到可用仓库** | — | 多轮检索无匹配的维护中项目；相近语义项目为 ChemLLMBench/ChemDFM/LlaSMol，请以仓库核实为准 |

---

## 二、横向对比表

| 项目 | 解决什么问题 / 场景 | Agent 架构 | 技术栈 | 活跃度（最后 push / star） | 许可 | URL |
|---|---|---|---|---|---|---|
| ChemCrow | 合成规划、性质计算、反应预测（NL→工具） | 单 agent ReAct + 工具回路 + 人类在环（LangChain） | Python/LangChain/RDKit/RXN/PubChem | 2024-12 / 946★（已停更） | MIT | https://github.com/ur-whitelab/chemcrow-public |
| Coscientist | 端到端实验自动化（设计→代码→机器人） | 单模型分层规划 + 4 模块（搜索/文档/代码/自动化）+ 验证回路 | Python/GPT-4/Opentrons | 2025-08 / 208★（论文附材） | Apache-2.0+Commons Clause | https://github.com/gomesgroup/coscientist |
| ChemAgent | 化学推理题正确率（记忆驱动） | 多模块单 agent + 三层记忆（plan/execute/knowledge） | Python/XAgent/OpenAI | 2025-07 / 90★（研究代码） | Apache-2.0 | https://github.com/gersteinlab/ChemAgent |
| OpenAD | 分子/材料发现低代码工作台 | LLM 辅助 CLI + 插件服务（非 agent 循环） | Python/JS/IBM 服务 | 2026-03 / 16★（公司开源） | MIT | https://github.com/acceleratedscience/openad-toolkit |
| PaperQA2 | 文献问答/总结（grounded+引用） | agentic RAG（检索→重排→RCS→综合） | Python/LiteLLM/tantivy/S2 | 2026-08 / 9030★（活跃） | Apache-2.0 | https://github.com/Future-House/paper-qa |
| ChemBench | LLM 化学能力评测 | 模块化评测框架（非 agent） | Python/HF datasets | 2026-01 / 144★（活跃） | MIT | https://github.com/lamalab-org/chembench |
| ScienceAgentBench | 科学发现 agent 严格评测（102 任务） | 评测 harness + 容器沙箱（非 agent） | Python/Docker/Bedrock | 2026-07 / 154★（活跃） | MIT | https://github.com/OSU-NLP-Group/ScienceAgentBench |
| Aviary（FutureHouse） | 语言 agent RL 环境（科学任务） | Gym 风格 env + LDP RL | Python/async | 2026-08 / 277★（活跃） | Apache-2.0 | https://github.com/Future-House/aviary |
| ChemMCP | 化学工具 MCP 化（即插即用） | 工具层独立 + MCP 协议（非 agent） | Python/MCP/RDKit/Uni-Mol/RXN | 2025-06 / 70★（停更中） | Apache-2.0 | https://github.com/OSU-NLP-Group/ChemMCP |
| ChemGraph | DFT/分子模拟自然语言自动化 | LangGraph 工作流图 + ASE 后端 | Python/LangGraph/ASE/NWChem/ORCA/xtb | 2026-08 / 146★（活跃） | Apache-2.0 | https://github.com/argonne-lcf/ChemGraph |
| AtomisticSkills | 原子模拟 skill 化（agentic IDE） | Skill 包模式（非独立 agent） | Python/ASE | 2026-08 / 145★（活跃） | MIT | https://github.com/learningmatter-mit/AtomisticSkills |
| Dolphin | 科研闭环自研（idea→代码→反馈） | 闭环循环（idea 生成+代码调试+反馈） | Python/OpenAI/ollama | 2025-06 / 44★（停更） | 未标注 | https://github.com/InternScience/Dolphin |
| RDKit / OpenBabel / ASE / pymatgen / xtb | 化学信息学与计算后端 | 库（被上述 agent 封装调用） | Python/C++/Fortran | 全部活跃 | BSD-3 / GPL-2.0 / LGPL / MIT 改 / LGPL-3.0 | 见上文表 |

---

## 三、设计经验总结（为 DSH 化学科研 agent 预设）

### 必须学的设计

1. **工具 + 校验回路（ChemCrow 范式）**：LLM 只做规划与叙事，化学事实一律由确定性工具产出（RDKit 算性质、xtb/ASE 算能量、PubChem 查证），结果回喂后 LLM 才能继续——这是化学 agent 区别于普通聊天的最核心设计。工具输出（如 SMILES）必须经 RDKit canonical 化校验，杜绝幻觉字符串。
2. **分层模块化（Coscientist 范式）**：lead agent（规划）+ 专业模块（文献检索 / 代码执行沙箱 / 计算化学 / 数据库）解耦，每层输出过校验再进下一层。DSH 预设可先做"单 agent + 强工具集"，复杂任务再升级为规划-执行分层。
3. **三层记忆（ChemAgent）**：plan / execute / knowledge 记忆分离、失败沉淀复用——与 DSH 的会话持久化 + 预设内记忆天然契合，值得移植为"工作日志 + 成功配方库"。
4. **MCP 标准化（ChemMCP / ChemGraph）**：工具统一 schema、即插即用、自动文档。若 DSH 支持 MCP 客户端，**ChemMCP 工具集与 ChemGraph 的 MCP server 可直接接入**作为化学预设的起步工具层；否则按其 schema 风格自建工具注册。
5. **评测先行（ScienceAgentBench / ChemBench）**：预设上线前用 ScienceAgentBench 代码型任务 + ChemBench 化学题做回归验收；评测环境容器化、测试数据防污染（verified 版本经验）。
6. **统一计算后端抽象（ASE）**：一套 API 对接 xtb（快、agent 高频调用首选）/ ORCA / NWChem / ML 势，工具粒度取"任务级"（结构生成、单点、弛豫、热化学），避免过粗黑盒或过细碎调用（ChemGraph 为范本）。
7. **文献答案必须 grounded（PaperQA2）**：检索→LLM 重排→上下文摘要→行内引用；化学预设的文献工具应直接复用其管线或作为子工具，杜绝无出处的结论。
8. **安全与人类在环（ChemCrow / ChemMCP）**：毒性/危险分子 SafetyCheck 工具 + 高危步骤人工审批（合成、采购、实验指令默认需确认）。
9. **多 provider 抽象（LiteLLM）**：模型可替换（OpenAI/Claude/DeepSeek/本地），避免绑定单一 LLM。
10. **skill 化交付（AtomisticSkills）**：能力按 skill/技能包组织、按需注入——与 DSH 预设（persona + skills + tools）同构，其 skill 目录可直接借鉴。

### 要避开的坑

1. **停更/过时仓库**：chemcrow-public（PyPI 2024-03 后停更、LangChain 旧版）、ChemAgent、ChemMCP、ChemLLMBench、Dolphin 均属论文/演示级代码——选型时检查"最后 push + PyPI 发版频率 + CI 绿否"，优先 ChemGraph / AtomisticSkills / PaperQA2 / ScienceAgentBench 这类活跃维护、有 CI/Docker/PyPI 的项目。
2. **许可陷阱**：Coscientist 的 **Commons Clause 商用受限**；OpenBabel **GPL-2.0 传染性**（DSH 预设内置需谨慎）；pymatgen/atomate 为修改版 MIT；ChemAgent 主分支无 LICENSE 文件——商用前逐项核对。
3. **封闭/单一依赖**：Coscientist 绑定 OpenAI + 真实实验室硬件；ChemCrow 强依赖 RXN API——预设应支持"云 API 默认 + 自托管降级"（ChemCrow 的 Docker 自托管 RXN 就是好先例）。
4. **幻觉无校验**：任何只让 LLM 直接输出的 SMILES、性质、反应式都是事故源头；必须有 canonicalize + 数据库交叉验证 + 计算回填。
5. **论文仓库 ≠ 可用软件**：Coscientist 仓库是 supporting info、无包无维护；CRADLE 等"论文存在但代码未公开"的项目一律不做依赖。
6. **依赖冲突与环境隔离**：ChemGraph 的 MACE/UMA（e3nn）冲突、ChemMCP 的 Uni-Mol/Uni-Core 较重——按功能拆分环境/容器，避免一个预设装爆。
7. **过度多 agent 化**：ScienceAgentBench 显示直接 prompting + self-debug 已有竞争力；多 agent 编排 token 与延迟成本高、难调试——从单 agent 起步，确有跨域协作需求再加分层。
8. **基准结论误读**：ChemBench"超人类"依赖具体模型/提示词；ScienceAgentBench 已发布 verified 版修正误判——评测结果要标注版本与条件。

### 对 DSH 化学预设的具体建议（按优先级）

1. **文献层**：接入 PaperQA2（Apache-2.0）为文献检索/引用工具（或独立 RAG service）。
2. **信息学层**：RDKit（BSD-3）+ PubChem/PubChemPy 封装成工具（分子性质、SMILES 校验、命名互转、专利检查）。
3. **计算层**：ASE + xtb（LGPL-3.0）做"快计算"（几何优化、单点能、IR），可选 ORCA/NWChem 扩展；封装为任务级工具。
4. **反应层**：正反应/逆合成先接可自托管的开源模型（如 RXN 自托管 Docker 或 ChemMCP 的 ForwardSynthesis），云 API 作为可选后端。
5. **记忆层**：按 ChemAgent 的三层记忆做预设内"成功配方库 + 实验日志"，跨会话复用。
6. **安全层**：SafetyCheck（毒性/危险性）+ 高危动作人类审批。
7. **验收**：ChemBench 子集 + ScienceAgentBench 代码型任务做 CI 式回归。

---

## 四、主要来源 URL

**仓库（GitHub API 核实）**：https://github.com/ur-whitelab/chemcrow-public · https://github.com/gomesgroup/coscientist · https://github.com/gersteinlab/ChemAgent · https://github.com/acceleratedscience/openad-toolkit · https://github.com/Future-House/paper-qa · https://github.com/lamalab-org/chembench · https://github.com/OSU-NLP-Group/ScienceAgentBench · https://github.com/Future-House/aviary · https://github.com/OSU-NLP-Group/ChemMCP · https://github.com/argonne-lcf/ChemGraph · https://github.com/learningmatter-mit/AtomisticSkills · https://github.com/InternScience/Dolphin · https://github.com/rdkit/rdkit · https://github.com/openbabel/openbabel · https://gitlab.com/ase/ase · https://github.com/materialsproject/pymatgen · https://github.com/grimme-lab/xtb · https://github.com/hackingmaterials/atomate · https://github.com/aiidateam/aiida-core · https://github.com/ChemFoundationModels/ChemLLMBench · https://github.com/OpenDFM/ChemDFM · https://github.com/OSU-NLP-Group/LLM4Chem · https://github.com/adibgpt/MatAgent · https://github.com/OSU-NLP-Group/awesome-agents4science

**PyPI**：https://pypi.org/project/chemcrow/ · https://pypi.org/project/openad/

**论文/官方页**：ChemCrow https://arxiv.org/abs/2304.05376 · Coscientist https://www.nature.com/articles/s41586-023-06792-0 · ChemAgent https://arxiv.org/abs/2501.06590 · PaperQA2 https://arxiv.org/abs/2409.13740 · ChemBench https://arxiv.org/abs/2404.01475 · ScienceAgentBench https://arxiv.org/abs/2410.05080 · Aviary https://arxiv.org/abs/2412.21154 · ChemToolAgent https://arxiv.org/abs/2411.07228 · Dolphin https://arxiv.org/abs/2501.03916 · OpenAD https://openad.accelerate.science · ChemMCP https://osu-nlp-group.github.io/ChemMCP/ · ChemBench docs https://lamalab-org.github.io/chembench/

**新闻/第三方**：CMU Coscientist 报道 https://www.cmu.edu/mcs/news-events/2023/1220-ai-coscientist-automates-discovery#1 · HF papers ChemCrow https://huggingface.co/papers/2304.05376
