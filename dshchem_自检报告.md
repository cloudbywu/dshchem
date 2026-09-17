# dshchem 化学科研环境完整自检报告

- **日期**：2026-08-14
- **环境**：dshchem 化学科研 preset（RDKit / PubChem PUG REST / ASE-EMT / Crossref / 配方库）
- **执行方式**：10 步全部通过对应工具调用完成，无记忆作答
- **总体结论**：核心计算、数据库、反应、能量、记忆链路**工作正常**；发现 **3 个环境 bug**（`chem_papers` 不可用、`chem_props` IUPAC 模式输出非法、`chem_recipe_list` 对旧条目失败），均已复现并给出规避方式。

---

## 1. 结构校验（chem_validate）

| 输入 | 结果 |
|---|---|
| `c1ccccc1C(=O)O`（苯甲酸） | ✅ valid；canonical `O=C(O)c1ccccc1`；分子式 C7H6O2；InChI `InChI=1S/C7H6O2/c8-7(9)6-4-2-1-3-5-6/h1-5H,(H,8,9)`；InChIKey `WPYMKLBDIGXBTP-UHFFFAOYSA-N`；重原子 9 |
| `C1CCCC`（非法，环闭合数不匹配） | ❌ 结构化错误：`Invalid SMILES: invalid SMILES: 'C1CCCC'` |
| `""`（空字符串） | ❌ 结构化错误：`smiles must be a non-empty string` |

> 异常输入均返回清晰的结构化错误，符合预期。

## 2. 结构转换（chem_convert，阿司匹林 `CC(=O)Oc1ccccc1C(=O)O`）

| 格式 | 结果 |
|---|---|
| InChI | `InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)` |
| InChIKey | `BSYNRYMUTXBXSQ-UHFFFAOYSA-N` |
| SVG | 有效 SVG（480×360 viewBox，8778 字符，含原子/键 path，O 原子红色标注），可嵌入文档或存为 .svg 文件 |

## 3. 性质计算（chem_props，阿司匹林，RDKit）

| 属性 | 值 |
|---|---|
| 分子式 | C9H8O4 |
| 分子量 | 180.159（exact mass 180.0423） |
| logP（Crippen） | **1.31** |
| TPSA | 63.6 Å² |
| HBD / HBA | 1 / 3 |
| 可旋转键 / 芳香环 | 2 / 1 |
| 重原子 / 形式电荷 | 13 / 0 |
| canonical SMILES | `CC(=O)Oc1ccccc1C(=O)O` |
| IUPAC 名请求 | ⚠️ 触发环境 bug（见「异常 1」），非正常"命名失败"路径 |

## 4. 数据库核对（chem_pubchem，PubChem PUG REST）

| 项目 | 名称查询 "aspirin" | InChIKey 查询 |
|---|---|---|
| CID | 2244 | 2244 |
| 名称 | Aspirin | Aspirin |
| 分子式 / MW | C9H8O4 / 180.16 | 一致 |
| **XLogP3** | **1.2** | 1.2 |
| TPSA | 63.6 | 63.6 |
| HBD / HBA | 1 / 4 | 1 / 4 |
| 可旋转键 | 3 | 3 |
| IUPAC 名 | 2-acetyloxybenzoic acid | 一致 |
| SMILES | `CC(=O)OC1=CC=CC=C1C(=O)O` | 一致 |

**双向交叉印证**：名称 → CID 2244；InChIKey `BSYNRYMUTXBXSQ-UHFFFAOYSA-N` → CID 2244。两查询结果完全一致 ✅。

### 算法差异说明（RDKit vs PubChem）

- **logP：Crippen 1.31 vs XLogP3 1.2**（差 0.11）——Crippen 为碎片加和法，XLogP3 为原子类型回归模型；同一分子的两种估计，属正常差异，引用时必须标注算法。
- **HBA：3 vs 4**——计数约定不同：PubChem 按 O 原子数计（阿司匹林 4 个 O），RDKit 按 Lipinski 电子对约定计 3 个。
- **可旋转键：2 vs 3**——PubChem 将乙酰甲基的 C–C(=O) 键计入。
- TPSA（63.6 Å²）与 MW（180.16）两来源完全一致。

## 5. 反应守恒检查（chem_reaction balance）

| 反应 | 结果 |
|---|---|
| 阿司匹林水解 `CC(=O)Oc1ccccc1C(=O)O.O>>CC(=O)O.Oc1ccccc1C(=O)O` | ✅ **balanced**（左右各 C9 / O5） |
| 反例 `CCO.O>>CCO`（产物缺氧） | ❌ **NOT balanced**：lhs {C:2, O:2} vs rhs {C:2, O:1}，缺失 O |

> 能正确检出元素不守恒。注意：该工具仅校验元素计数，不校验电荷与电子数。

## 6. 模板反应预测（chem_reaction template）

- 模板：`[C:1](=[O:2])[O:3][C:4]>>[C:1](=[O:2])[O:3].[C:4]`
- 底物：乙酸乙酯 `CCOC(=O)C`
- 产物（1 组）：`CC(=O)O + CC`（**乙酸 + 乙烷**）

> **化学注释**：该模板未包含水的 O/OH 转移，乙基片段（[C:4]）被 H 饱和为乙烷而非乙醇；若要模拟真实水解，模板需加入水或 [OH] 转移项。此为模板设计问题，非工具故障。

## 7. 能量计算（chem_calc，ASE EMT）

| 输入 | 结果 |
|---|---|
| 乙醇 `CCO`（optimize=true） | ✅ E = **1.2929 eV**（弛豫前 3.6287，Δ −2.3358）；分子式 C2H6O（9 原子） |
| 70 个碳的直链烷烃 | ❌ 已拒绝：`too many heavy atoms for calc (> 60)`，符合 60 重原子上限 |

> ⚠️ EMT 为定性方法（工具自带说明），能量值不得作为热化学数据引用；如需定量结论应使用 GFN2-xTB 或 DFT。

## 8. 文献检索（chem_papers → 故障，降级 web_search）

**`chem_papers`（Crossref）在 3 种 limit/查询组合下全部失败**（见「异常 2」），按文献技能规范的降级层级改用 `web_search`，所有 DOI 均经检索结果交叉核实（非记忆）：

1. **Vane JR.** *Inhibition of prostaglandin synthesis as a mechanism of action for aspirin-like drugs.* Nat. New Biol. **1971**, 231, 232–235 — DOI [10.1038/newbio231232a0](https://pubmed.ncbi.nlm.nih.gov/5284360/)（PMID 5284360；经典"阿司匹林作用机制=抑制前列腺素合成"发现论文）
2. **Vane JR, Botting RM.** *The mechanism of action of aspirin.* Thromb. Res. **2003**, 110, 255–258 — DOI [10.1016/S0049-3848(03)00379-7](https://pubmed.ncbi.nlm.nih.gov/14592543/)（PMID 14592543；期刊卷页经 [scholarsportal](https://journals.scholarsportal.info/details/00493848/v110i5-6/255_tmoaoa.xml) 确认）
3. **Garavito RM, Mulichak AM.** *The structure of mammalian cyclooxygenases.* Annu. Rev. Biophys. Biomol. Struct. **2003**, 32, 183–206 — DOI [10.1146/annurev.biophys.32.110601.141906](https://pubmed.ncbi.nlm.nih.gov/12574066/)（PMID 12574066；卷页经 [hanspub 引用记录](https://www.hanspub.org/reference/referencepapers?referenceid=107592) 确认）
4. （补充）**Vane JR.** *Anti-inflammatory drugs and their mechanism of action.* Inflamm. Res. **1998**, 47(Suppl 2), S78 — DOI [10.1007/s000110050284](https://pubmed.ncbi.nlm.nih.gov/9831328/)（PMID 9831328；DOI 经 [MTMT 引用记录](https://m2.mtmt.hu/api/reference/44913240?&labelLang=eng) 确认）

## 9. 记忆沉淀（chem_recipe 配方库）

- ✅ 已保存：`rmssy4lxo1543`《阿司匹林 logP 交叉核对结论（RDKit Crippen vs PubChem XLogP3）》，项目 `dshchem-selfcheck`，tags: `#logp #crosscheck #aspirin`
- ✅ `chem_recipe_search("aspirin")` 返回 3 条匹配，含本条目及 2 条历史记录（`rmssxazbstsqa`、`rmssxaqrgot8l`，内容与本次 logP 结论一致——印证配方库跨会话持久化正常）
- ⚠️ `chem_recipe_list` 因旧条目 `project` 为 null 触发 schema 失败（见「异常 3」）；**当前可用 `chem_recipe_search` 替代**。

## 10. 关键数值总表

| 步骤 | 项目 | 数值 | 来源 |
|---|---|---|---|
| 1 | 苯甲酸 canonical | `O=C(O)c1ccccc1`（C7H6O2） | RDKit 计算 |
| 1 | 非法/空输入错误 | 结构化错误信息（见上） | chem_validate |
| 2 | 阿司匹林 InChIKey | `BSYNRYMUTXBXSQ-UHFFFAOYSA-N` | RDKit 计算 |
| 3 | MW / exact mass | 180.159 / 180.0423 | RDKit 计算 |
| 3 | logP（Crippen） | 1.31 | RDKit 计算 |
| 3 | TPSA | 63.6 Å² | RDKit 计算 |
| 3 | HBD / HBA / rot | 1 / 3 / 2 | RDKit 计算 |
| 4 | CID / MW | 2244 / 180.16 | PubChem PUG REST |
| 4 | XLogP3 | 1.2 | PubChem PUG REST |
| 4 | TPSA / HBD / HBA / rot | 63.6 / 1 / 4 / 3 | PubChem PUG REST |
| 5 | 水解守恒 | balanced（C9 O5 ×2） | chem_reaction |
| 5 | 反例 | NOT balanced（缺 O） | chem_reaction |
| 6 | 模板产物 | 乙酸 + 乙烷 | RDKit 反应 SMARTS |
| 7 | 乙醇 EMT 弛豫能 | 1.2929 eV（Δ −2.3358） | ASE EMT（定性） |
| 7 | 70C 烷烃 | 拒绝（>60 重原子） | chem_calc |
| 8 | 文献 | 4 篇含核实 DOI（见上） | web_search 核实 |
| 9 | 配方条目 | `rmssy4lxo1543`，可检索 | chem_recipe 库 |

## 异常清单（均复现 ≥2 次）

| # | 工具 | 现象 | 建议修复 / 规避 |
|---|---|---|---|
| 1 | `chem_props`（iupac=true） | IUPAC 命名失败时返回 `iupacName: null` 且附带未声明的 `iupacError` 字段 → 输出恒不合输出 schema | 失败时返回空字符串并删除 `iupacError`（或将其加入 schema 声明）；**规避：不带 iupac 参数调用** |
| 2 | `chem_papers` | 3 种 limit/查询组合全部失败：Crossref 条目缺 `abstract`/`journal`/`year`（null）即触发 schema 校验错误 | 输出前过滤缺字段条目或允许 null；**规避：降级 web_search + DOI 定向核实** |
| 3 | `chem_recipe_list` | 库中第 2 条起的旧条目 `project` 为 null → schema 校验失败，与 limit 无关（limit=2 同样失败） | schema 允许 null 或 list 时补空串；**规避：使用 `chem_recipe_search`** |

## 安全提示

- 本次自检**全程为计算与文献操作，无湿实验**，无直接危险。
- 若后续实际开展阿司匹林水解实验：
  - 产物**乙酸**（刺激性、腐蚀性）与**水杨酸**（皮肤/眼刺激）——通风橱内操作，佩戴护目镜与丁腈手套；
  - 碱催化水解（NaOH）放热且强腐蚀，需缓慢加料；
  - **乙醇**易燃，远离火源；
  - 涉及采购/制备管制化学品前，人工确认并遵守当地法规。
- 以上为建议，不替代 SDS / 实验室规章与安全培训。
- 能量值（EMT）为定性结果，不得作为热化学数据引用。

## 环境健康度总评

| 链路 | 状态 |
|---|---|
| 结构校验 / 转换（1、2） | ✅ 正常 |
| 性质计算（3） | ✅ 正常（IUPAC 模式除外，见异常 1） |
| 数据库核对（4） | ✅ 正常，双向交叉印证 |
| 反应分析（5、6） | ✅ 正常 |
| 能量计算（7） | ✅ 正常（上限拒绝符合预期） |
| 文献检索（8） | ❌ `chem_papers` 不可用（异常 2），已降级 web_search |
| 记忆沉淀（9） | ✅ 保存/检索正常（list 除外，见异常 3） |

**优先修复项**：`chem_papers` 的 null 字段处理（异常 2）→ `chem_props` IUPAC 模式（异常 1）→ `chem_recipe_list`（异常 3）。
