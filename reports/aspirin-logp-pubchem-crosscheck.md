# 阿司匹林 logP 计算与 PubChem 交叉核对报告

- 日期：2026-08-14 20:18
- 工作目录：`C:\Users\cloud\Desktop\dshchem`
- 会话：DSH 化学工具验证（chem_validate / chem_props / chem_convert / chem_pubchem）
- 状态：✅ 核对完成；⚠️ 附带一个工具 bug 报告（见 §4）

---

## 1. 任务概述

1. 验证新会话工具列表中化学相关工具是否齐备（应包含 4 个：`chem_validate`、`chem_props`、`chem_convert`、`chem_pubchem`）。
2. 计算阿司匹林（acetylsalicylic acid）的 logP（RDKit Crippen 法），并与 PubChem 数据库值交叉核对。

## 2. 工具列表验证结果

| 工具 | 状态 | 本次使用 |
|---|---|---|
| `chem_validate` | ✅ 正常 | 已用 |
| `chem_props` | ✅ 正常 | 已用 |
| `chem_convert` | ✅ 可用 | 未用到 |
| `chem_pubchem` | ⚠️ 有 bug（见 §4） | 尝试 4 次，全部失败 |

## 3. logP 计算与交叉核对结果

### 3.1 结构确认（chem_validate，RDKit）

| 项目 | 值 |
|---|---|
| 输入 SMILES | `CC(=O)OC1=CC=CC=C1C(=O)O` |
| 规范 SMILES | `CC(=O)Oc1ccccc1C(=O)O` |
| 分子式 | C9H8O4 |
| InChI | `InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)` |
| InChIKey | `BSYNRYMUTXBXSQ-UHFFFAOYSA-N` |
| 重原子数 | 13 |

### 3.2 性质对比表

| 性质 | RDKit 计算值 | PubChem（CID 2244） | 一致性 |
|---|---|---|---|
| **logP** | **1.31**（Crippen 碎片法） | **1.2**（XLogP3 原子法） | ✅ 接近（差 0.1，属不同算法正常偏差） |
| 分子量 | 180.159（exact 180.0423） | 180.16 | ✅ |
| 分子式 | C9H8O4 | C9H8O4 | ✅ |
| TPSA | 63.6 | 63.6 | ✅ |
| HBD | 1 | 1 | ✅ |
| HBA | 3 | 4 | ⚠️ 定义差异：PubChem 用 N+O 原子计数，RDKit 默认用更严格的 SMARTS 定义 |
| 可旋转键 | 2 | 3 | ⚠️ 同上，均为合法定义差异 |

### 3.3 结论

两个独立算法给出 logP ≈ **1.2–1.3**，交叉核对一致，结论可靠。

**注意**：两者均为**计算值**，非实验测量值：
- RDKit Crippen logP = 1.31（工具计算）；
- PubChem XLogP3 = 1.2（数据库计算值）；
- 文献中阿司匹林实验 logP 约 1.2（如需精确实验值，应另行查证文献来源）。

## 4. `chem_pubchem` 工具 Bug 报告

### 4.1 现象

`chem_pubchem` 对所有四种查询方式均稳定失败：

| 查询方式 | 查询内容 | 结果 |
|---|---|---|
| name | `aspirin` | ❌ `Error: tool "chem_pubchem" returned invalid output: "value.mw" must be a number` |
| cid | `2244` | ❌ 同上 |
| inchikey | `BSYNRYMUTXBXSQ-UHFFFAOYSA-N` | ❌ 同上 |
| smiles | `CC(=O)OC1=CC=CC=C1C(=O)O` | ❌ 同上 |

### 4.2 根因分析

1. PubChem REST API（PUG）将 `MolecularWeight` 以**字符串**返回，例如：
   `"MolecularWeight": "180.16"`（实测确认）。
2. `chem_pubchem` 工具的输出 JSON Schema 将 `mw` 声明为 number 类型。
3. 工具返回字符串 → DSH 工具输出校验（`dsh-tools` 的 JSON Schema 校验器）拒绝：
   `"value.mw" must be a number`（该校验逻辑位于 `dsh-tools/lib/index.js` 的 schema 校验框架，报错路径 `value.mw` 指向工具输出对象的 `mw` 字段）。

**修复建议**：在 `chem_pubchem` 工具实现中，对 PubChem API 返回的 `MolecularWeight` 做类型归一化，例如 `Number(mw)` 后再放入输出对象（约一行代码）。属上游运行时内置工具，需在运行时实现侧修复。

### 4.3 定位说明

已确认该工具实现**不在本机 DSH 安装目录**中：

- `npm root -g` = `C:\Users\cloud\AppData\Roaming\npm\node_modules`，其中仅 `@deepseek-ai\dsh` 一个包；
- 在该目录下检索 `chem_pubchem`、`Crippen`、`pubchem` 关键字均无匹配；
- 结论：`chem_*` 工具由 harness 运行时内置注入，本机无法直接修补源码。

### 4.4 替代方案（本次实际采用）

直接调用 PubChem REST API 完成交叉核对（数据来源与工具相同，不影响结论有效性）：

```
GET https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName,IsomericSMILES,XLogP,HBondDonorCount,HBondAcceptorCount,TPSA,RotatableBondCount/JSON
```

返回（节选）：

| 字段 | 值 |
|---|---|
| CID | 2244 |
| MolecularFormula | C9H8O4 |
| MolecularWeight | 180.16（字符串类型） |
| CanonicalSMILES | CC(=O)OC1=CC=CC=C1C(=O)O |
| IUPACName | 2-acetyloxybenzoic acid |
| XLogP | 1.2 |
| TPSA | 63.6 |
| HBondDonorCount | 1 |
| HBondAcceptorCount | 4 |
| RotatableBondCount | 3 |

## 5. 附注与安全提示

- 阿司匹林为常见药物，本报告仅涉及结构计算与数据库核对，不涉及实验操作。
- 所有数值均为计算值或数据库值，已标注来源；无任何捏造的实验数据。
