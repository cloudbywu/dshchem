# dshchem 下一阶段工作计划（P8–P10 + 探索方向）

> 状态：规划稿（2026-08-15）。P0–P7 已全部交付（23 工具 / 100 项评测）。
> 延续既有架构与工程纪律：引擎 op → 服务 → 工具 → client 卡片 → 测试断言 → 测试 Prompt。

---

## 总览

| 阶段 | 主题 | 核心交付 | 新依赖 |
|---|---|---|---|
| **P8** | 虚拟筛选与工作流管线 | chem_screen / 批量对接 / 筛选报告 | 无（复用全部现有工具） |
| **P9** | 对接深化与复合物可视化 | vina 1.2.7 + pose 坐标 / 受体-配体 3D 复合物 | vina 1.2.7 |
| **P10** | 平台与生态 | MCP 接入 / 回归门禁 / 预设增强 | MCP server（可选） |
| **探索** | 新领域（按兴趣） | MD / 材料 / 反应预测 ML / ORCA | 按方向 |

---

## P8 · 虚拟筛选与工作流管线（零新依赖，价值立现）

现有工具已具备全部构件（enumerate/druglikeness/admet/similarity/dock），缺的是**编排层**：

- **P8.1 `chem_screen`**：一站式筛选——输入骨架 + R 基团列表 + 过滤规则（Lipinski/Veber 必过、QED 阈值、ADMET 端点阈值、相似性参考分子）→ 枚举 → 逐条过滤 → 排序输出（通过数/淘汰原因统计）。agent 一次调用完成「组合库 → 候选列表」。
- **P8.2 批量对接**：`chem_dock` 扩展 `batch` 模式（配体 SMILES 列表 vs 单受体/单盒子）→ 命中排序表（affinity 升序 + 每配体 pose 数），配 `--batch` 串行防超时。
- **P8.3 筛选报告**：`chem_screen_report`（或并入 screen 的 `reportPath` 参数）——自动生成 markdown 报告（筛选漏斗统计 + 命中表 + 每命中类药性/ADMET/对接摘要）写入工作区，并同步存配方库。

验收（测试 Prompt）：10 分子组合库 → 过滤后 3-5 命中 → 批量对接 → 报告文件存在且结构完整。

## P9 · 对接深化与复合物可视化

- **P9.1 vina 1.2.7 升级**：实测 1.2.7 的 `--out` 是否稳定写全 pose（1.2.5 Windows 写入随机丢 model）；稳定则恢复「pose 坐标」输出（对接 pose 的 3D 结构），作为 P9.2 数据源。
- **P9.2 复合物 3D 展示**：client 卡片「对接查看」——3Dmol.js 同时渲染受体（surface/cartoon）+ 配体 pose（stick），直接目检结合模式。需 host 路由返回受体与配体坐标。
- **P9.3 严格受体准备**（可选）：ADFRsuite `prepare_receptor` 的 PDBQT 预制备文档 + 配置项，供严格研究使用。

验收：对接卡片出现复合物 3D；pose 坐标可导出。

## P10 · 平台与生态

- **P10.1 MCP 化学工具接入**：先在**独立 profile 副本**验证（`dsh --profile mcp-test`）——profile 组合加 `dsh-mcp-client` 行 + 安装/配置一个化学 MCP server（rdkit-mcp-server 或自写 stdio server）→ 验证 `mcp__*` 工具可见可用 → 再决定是否并入 web profile。全程不动正在运行的 profile。
- **P10.2 一键回归门禁**：`scripts/gate.ps1`——integration + benchmark + RAG 冒烟 + 语法检查，一键跑、非零退出即失败；可挂 git pre-commit。
- **P10.3 预设增强**：新技能（`chem-vs` 虚拟筛选协议、`chem-docking` 对接工作流）、persona 补充（批量任务偏好、报告格式约定）。
- **P10.4 文档**（可选）：README 使用手册化、工具清单表自动生成。

## 探索方向（按兴趣选择，未排期）

| 方向 | 内容 | 前置/风险 |
|---|---|---|
| 分子动力学 | OpenMM 快速能量最小化/短 MD（配体-受体复合物稳定化） | OpenMM × py3.14 wheel 待实测 |
| 材料/晶体 | pymatgen 基础工具（晶体结构、能带/态密度后处理） | 纯 pip |
| 反应预测 ML | ORD 数据 + Chemprop 正向反应产物预测 | 数据下载量大；torch 已就绪 |
| 电子结构 | ORCA 接口（GFN2/DFT 单点、频率） | ORCA 学术免费闭源，需用户安装 |

## 关键前置验证（实现前 1 天内完成）

1. vina 1.2.7 `--out` 稳定性（决定 P9.1 是否恢复 pose 坐标）
2. MCP server 在独立 profile 的可运行性（决定 P10.1 路径）
3. OpenMM/其他探索方向的 wheel 兼容性（仅在选择该方向时）
