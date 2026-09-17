# P6 阶段验证测试报告（药物化学 / 分子性质）

- **测试依据**：`reports/chemist-testing-prompts.md` 第六节（P6 主验收 + P6 边界验证）
- **测试日期**：2026-08-15 13:46
- **测试方式**：在 dshchem 化学科研预设会话中，按文档 Prompt 逐项调用 `chem_druglikeness` / `chem_similarity` / `chem_cluster` / `chem_mcs` / `chem_enumerate` / `chem_admet`，对照「预期检查表」逐项核验
- **结论总览**：主验收 7/7 通过；边界验证 4/5 通过，1 项存在偏差（详见 §2.2 缺陷记录）

---

## 一、P6 主验收

### 1. 类药性评估（chem_druglikeness）

输入：阿司匹林 `CC(=O)Oc1ccccc1C(=O)O`、紫杉醇（文档给定 SMILES）。

| 指标 | 阿司匹林 | 紫杉醇 |
|---|---|---|
| verdict | **drug-like** ✅ | **not drug-like** ❌ |
| MW | 180.16 | 823.89 |
| logP (Crippen) | 1.31 | 4.37 |
| HBD / HBA | 1 / 3 | 3 / 13 |
| TPSA | 63.6 | 201.1 |
| 可旋转键 | 2 | 10 |
| QED | 0.55 | 0.148 |
| SA score | 1.58 | 6.08 |
| Lipinski | pass | 违反：MW ≤ 500、HBA ≤ 10 |
| Veber | pass | 违反：TPSA ≤ 140 |
| REOS | 违反：MW 200–500（MW 180.16 低于下限 200） | 违反：MW 200–500、HBA ≤ 10 |

- 与预期一致：阿司匹林 drug-like、QED ≈ 0.55 ✅；紫杉醇 not drug-like，违规明细（MW>500、HBA>10、TPSA>140）与预期吻合 ✅。
- 数值来源：RDKit 规则/描述符计算（chem_druglikeness 工具）。

### 2. 相似性检索（chem_similarity）

查询：阿司匹林；目标：水杨酸、对乙酰氨基酚、苯、乙醇（Morgan/ECFP4 指纹，Tanimoto）。

| 排序 | 目标 | Tanimoto |
|---|---|---|
| 1 | 水杨酸 `O=C(O)c1ccccc1O` | **0.4483** ✅（预期 ≈0.448 居首） |
| 2 | 对乙酰氨基酚 `CC(=O)Nc1ccc(O)cc1` | 0.2222 |
| 3 | 苯 `c1ccccc1` | 0.125 |
| 4 | 乙醇 `CCO` | 0.1111 |

排序与预期一致，水杨酸最高。数值来源：RDKit Morgan 指纹 Tanimoto（工具计算）。

### 3. 聚类（chem_cluster）

输入 8 分子，cutoff 0.4（Butina 聚类 + Murcko 骨架统计）：

- 共 **7 簇（6 个单例）**：阿司匹林 + 水杨酸同簇（cluster 0，2 成员）✅，其余 6 分子各自成簇
- Murcko 骨架：`c1ccccc1`（苯环）**×7** ✅（预期 ≥4）
- 数值来源：RDKit 指纹/骨架（工具计算）。

### 4. 最大公共子结构（chem_mcs）

阿司匹林 vs 水杨酸：**10 原子 / 10 键**（≥8 达标 ✅），输出 SMARTS：

```
[#8&!R]=&!@[#6&!R](-&!@[#8&!R])-&!@[#6]1:&@[#6]:&@[#6]:&@[#6]:&@[#6]:&@[#6]:&@1-&!@[#8&!R]
```

即「羧基 + 苯环 + 酚羟基」公共片段，化学上合理（阿司匹林 = 水杨酸乙酰化衍生物）。数值来源：RDKit MCS 算法（工具计算）。

### 5. 组合库枚举（chem_enumerate）

骨架 `[*:1]c1ccccc1[*:2]`，R1 = [C, N, O]、R2 = [C, CC, Cl]：

- **9 组合 / 9 唯一产物（failed = 0）** ✅
- 产物示例：`Cc1ccccc1C`、`CCc1ccccc1Cl`、`Nc1ccccc1Cl`、`Oc1ccccc1Cl` 等（完整 9 个见工具返回）。
- 数值来源：RDKit 枚举（工具计算）。

### 6. ADMET 预测（chem_admet，阿司匹林）

返回 **104 个端点**（chemprop 集成模型，模型加载约 5–10 s）。关键端点：

| 端点 | 预测值 | 解读 |
|---|---|---|
| AMES | 0.0801 | 致突变风险低（概率） |
| hERG | 0.0208 | 心脏毒性风险低（概率） |
| BBB_Martins | 0.6582 | 中等偏高的血脑屏障透过概率 |
| DILI（肝损伤） | 0.6746 | 肝损伤风险中等偏高（概率） |
| CYP1A2_Veith / 2C19 / 2C9 / 2D6 / 3A4_Veith | 0.0148 / 0.0171 / 0.0147 / 0.0071 / 0.0005 | 各 CYP 抑制概率均低 |
| Clearance_Hepatocyte_AZ | 28.50 mL/min/kg | 肝细胞清除率（定量端点） |
| Clearance_Microsome_AZ | 0.14 | 微粒体清除率（定量端点） |

> ⚠️ **以上全部为 admet_ai 2.0.1 模型预测值，非实验数据**；关键端点（如 DILI、BBB）在决策前须与文献/实验对照。显示端点为工具返回的前 14 项，完整 104 端点见工具结构化输出。

### 7. 汇总（阿司匹林综合结论）

阿司匹林（MW 180.16、logP 1.31、TPSA 63.6、HBD/HBA 1/3、QED 0.55、SA 1.58，均来自 RDKit 规则/描述符计算）通过 Lipinski 与 Veber 规则，REOS 仅因 MW 低于 200 下限告警，判定为 drug-like；对水杨酸 Tanimoto 相似度 0.4483（RDKit Morgan 指纹）为检索目标中最高，且与水杨酸共享 10 原子 MCS，符合其前药/衍生物关系；ADMET 模型预测（admet_ai 2.0.1，模型预测非实验值）显示 AMES 0.0801、hERG 0.0208 等安全性端点风险低，但 DILI 0.6746 与 BBB 0.6582 为中等偏高风险，需实验验证。综合：阿司匹林为类药性好、结构简单（SA 1.58 易合成）的口服候选，主要不确定性在于模型预测的肝损伤与入脑倾向。

---

## 二、P6 边界验证

| # | 用例 | 预期 | 实测 | 结论 |
|---|---|---|---|---|
| 1 | `chem_druglikeness("zzz")` | 结构化错误 | `chem_druglikeness failed: invalid SMILES: 'zzz'` | ✅ 通过 |
| 2 | `chem_admet("not-a-molecule")` | 结构化错误 | `chem_admet failed: invalid SMILES: 'not-a-molecule'` | ✅ 通过 |
| 3 | `chem_similarity` 目标列表混入 `"xyz"` | 标记 invalid 而非崩溃 | `Error: tool "chem_similarity" returned invalid output: "value.results[2].tanimoto" must be a number`（两次复测一致） | ⚠️ **偏差**（见缺陷记录） |
| 4 | `chem_cluster` 全非法列表 | 结构化报错 | `chem_cluster failed: no valid SMILES in the input list` | ✅ 通过 |
| 5 | `chem_enumerate` 无 dummy 骨架 `c1ccccc1` | 报错提示格式 | `chem_enumerate failed: scaffold must contain dummy atoms like [1*], [2*]` | ✅ 通过 |
| 6 | `chem_admet` 同一分子连跑两次 | 输出稳定（确定性） | 两次返回完全一致（AMES 0.0801、hERG 0.0208、BBB 0.6582、DILI 0.6746、各 CYP 值逐位相同） | ✅ 通过 |

**边界测试附加确认**：`chem_similarity` 纯合法输入对照组（水杨酸 + 乙醇）正常返回（0.4483 / 0.1111），排除工具整体故障。

### 缺陷记录（1 项，偏差）

- **chem_similarity 非法 target 未优雅处理**（P6 边界 #3）：
  - 现象：目标列表混入非法 SMILES `"xyz"` 时，工具对非法条目产出了非数字 tanimoto（NaN 类），导致 harness 层 schema 校验失败，整次调用返回 `tool ... returned invalid output` 错误——**无进程崩溃、无堆栈泄漏**（schema 层兜底），但**整次结果不可用**，且未实现预期文档要求的「per-target 标记 invalid」行为。
  - 复现性：连续两次独立调用均以相同错误失败（确定性），对照组（纯合法输入）正常，可排除偶发。
  - 影响：混合输入场景下用户拿不到任何相似度结果；与其他工具（druglikeness/admet/cluster/enumerate 均返回干净结构化错误）的处理风格不一致。
  - 建议修复：在工具端对每个 target 单独 try/parse，非法者标记 `"invalid": true` 并跳过 Tanimoto 计算（或返回结构化错误字段），避免 NaN 进入结果 schema。

---

## 三、预期检查表汇总

| 步骤 | 预期 | 实测 | 结果 |
|---|---|---|---|
| 1 | 阿司匹林 drug-like（Lipinski/Veber 通过，QED≈0.55）；紫杉醇 not drug-like（MW>500、HBA>10、TPSA>140 违规明细） | QED 0.55；紫杉醇 MW 823.89 / HBA 13 / TPSA 201.1 违规明细齐全 | ✅ |
| 2 | 水杨酸 0.4483 最高，排序正确 | 0.4483 居首，排序 水杨酸>对乙酰氨基酚>苯>乙醇 | ✅ |
| 3 | 阿司匹林+水杨酸同簇；c1ccccc1 计数 ≥4 | 同簇（cluster 0）；苯骨架 ×7 | ✅ |
| 4 | MCS ≥8 原子，SMARTS 输出 | 10 原子 / 10 键，SMARTS 输出 | ✅ |
| 5 | 9/9 组合生成、failed=0 | 9/9，failed=0 | ✅ |
| 6 | AMES/hERG 等关键端点数值 + 「模型预测」声明 | 104 端点返回，关键端点已列出并声明为模型预测 | ✅ |
| 7 | 每个数值有来源标注（规则/工具/模型） | §1.7 汇总逐项标注 RDKit 规则 / 工具计算 / admet_ai 模型 | ✅ |
| 边界 1–2 | 非法输入结构化错误 | 干净 `invalid SMILES` 错误 | ✅ |
| 边界 3 | 相似性非法 target 标记 invalid 而非崩溃 | 无崩溃，但整次调用 schema 失败，未标记 invalid | ⚠️ |
| 边界 4–5 | 聚类全非法报错 / 枚举无 dummy 报错 | 均返回结构化错误 | ✅ |
| 边界 6 | ADMET 确定性 | 两次输出逐位一致 | ✅ |

**P6 验收判定：通过（1 项偏差需修复）** —— 主验收 7/7 全部符合预期；边界验证 5/5 项无崩溃、无超时，其中 4 项完全符合预期，1 项（chem_similarity 非法 target 处理）存在确定性偏差，建议按缺陷记录修复后复测。
