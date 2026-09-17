# chem_aizynth P5-AiZynth 专项验收报告

- **日期**：2026-08-14
- **依据**：`reports/chemist-testing-prompts.md` 第五节「P5-AiZynth 专项」
- **环境**：AiZynthFinder 4.4.1（PY314 移植版 venv：`aizynthfinder_dsh_314/venv314`，RDKit 2026.03.5）；USPTO 扩张策略 + ZINC 库存 + USPTO filter；`chem_aizynth(timeoutSeconds=60, maxRoutes=3)`
- **目标分子**：阿司匹林 `CC(=O)Oc1ccccc1C(=O)O`
- **总体结论**：检索性能 ✅、路线化学内容 ✅、与模板路线互补 ✅；但**路线反应 SMILES 序列化存在缺陷**（输出含非法 `[cH3:5]`，导致原子守恒校验无法直接执行）与**非法输入报错泄漏 Python 堆栈**——均已定位根因，给出修复建议。

---

## 1. 步骤 1：AiZynth 检索（✅ 通过）

| 指标 | 实测 | 预期 |
|---|---|---|
| 总耗时 | **19.11 s**（含模型加载 ~15 s） | 约 20–30 s 属正常 |
| 首解时间 | **0.019 s**（模型就绪后） | 数秒内出首解 |
| 路线数 | 返回 3 条（finder 实际生成 **12 条**，`maxRoutes=3` 截断） | 3 条 |
| 路线 score | 3 条均为 0.9976287 | — |

三条路线（模板 hash `f1de1ec6…`，template_code 40152，USPTO 苯酚酰化模板，policy_probability 0.726）：

| 路线 | 工具输出反应 SMILES（含 ">>" ✅） | 化学解读 |
|---|---|---|
| 1 | `[C:1]([CH3:2])(=[O:3])[O:4][cH3:5]>>CC(=O)O[C:1]([CH3:2])=[O:3].[O:4][cH3:5]` | **乙酸酐** + 水杨酸 → 阿司匹林（经典工业路线） |
| 2 | `…>>Cl[C:1]([CH3:2])=[O:3].[O:4][cH3:5]` | **乙酰氯** + 水杨酸 → 阿司匹林 |
| 3 | `…>>O=[C:1]([CH3:2])[O:3].[O:4][cH3:5]` | **乙酸** + 水杨酸 → 阿司匹林 |

> 化学内容核实（绕过序列化直接读树对象）：Route 1 反应物分子 = `CC(=O)OC(C)=O`（乙酸酐，7 原子）+ `O=C(O)c1ccccc1O`（水杨酸，10 原子）；根分子 = 完整阿司匹林（13 原子）✅。`[O:4][cH3:5]` 即被截断损坏的水杨酸片段渲染（见 §5）。

## 2. 步骤 2：原子守恒校验（⚠️ 发现缺陷，化学层面守恒）

### 2.1 直接校验工具输出的路线 SMILES → 全部失败（结构化报错，但原因非法）

对 3 条路线反应 SMILES 逐一调用 `chem_reaction` balance 模式，**全部**返回：

```
chem_reaction failed: lhs '[C:1]([CH3:2])(=[O:3])[O:4][cH3:5]': invalid SMILES
```

原因：LHS 含 `[cH3:5]`——芳香碳显式 3 个 H，RDKit（系统 2026.03.3 **与 venv 2026.03.5**）均判定为非法 SMILES（venv 解析时警告 `non-ring atom 1 marked aromatic`）。**不是不平衡，而是字符串本身非法，守恒无从校验**——「路线反应 SMILES 均原子守恒」预期未满足。

### 2.2 RHS 片段单独验证（合法，化学意义明确）

| 片段 | canonical | 分子式 | 判定 |
|---|---|---|---|
| `CC(=O)O[C:1]([CH3:2])=[O:3]` | 同左 | C₄H₆O₃ | ✅ 乙酸酐 |
| `O=[C:1]([CH3:2])[O:3]` | 同左 | C₂H₃O₂ | ✅ 乙酸 |
| `Cl[C:1]([CH3:2])=[O:3]` | 同左 | C₂H₃ClO | ✅ 乙酰氯 |

### 2.3 用规范 SMILES 重构正向反应 → 3/3 守恒（化学层面 ✅）

| 正向反应 | 元素计数 | 结果 |
|---|---|---|
| 乙酸酐 + 水杨酸 → 阿司匹林 + 乙酸 | C11O6 = C11O6 | ✅ balanced |
| 乙酰氯 + 水杨酸 → 阿司匹林 + HCl | C9O4Cl = C9O4Cl | ✅ balanced |
| 阿司匹林水解 → 乙酸 + 水杨酸 | C9O5 = C9O5 | ✅ balanced |

**结论**：底层化学正确且守恒；缺陷在工具的反应 SMILES **序列化层**（见 §5），导致「返回的路线 SMILES 可直接校验」这一验收点未通过。

## 3. 步骤 3：与模板路线对比（✅ 互补）

`chem_retro_plan` 对同一分子：**1 条确定性路线**：

```
ester_aryl: CC(=O)Oc1ccccc1C(=O)O -> CC(=O)O + O=C(O)c1ccccc1
[stop: CC(=O)O；水杨酸 O=C(O)c1ccccc1 无更多断开]
```

| 维度 | ML 路线（chem_aizynth） | 模板路线（chem_retro_plan） |
|---|---|---|
| 断开方式 | USPTO 学习策略（概率 0.726） | 内置 ester_aryl 确定性模板 |
| 酰化源 | 乙酸酐 / 乙酰氯 / 乙酸（3 种，贴近实际合成） | 仅乙酸 |
| 前体形态 | 树对象内完整分子（乙酸酐+水杨酸） | 乙酸 + 水杨酸 |
| 评分 | 路线 score 0.9976；ZINC 库存判定 | SA score + atomConserved |
| 路线数 | 12 条（截断返回 3） | 1 条 |

**互补性判断**：与文档预期「ML 路线（如乙酸酐+水杨酸）与模板断开（乙酸+水杨酸）互补」**一致**——ML 提供更贴近真实合成的酰化剂选择，模板提供骨架级确定性断开；两者互为交叉验证。⚠️ 注意：ML 路线的**序列化输出**（§5 缺陷）不能直接用于平衡校验，须用树对象分子或 metadata 中的 `mapped_reaction_smiles`。

## 4. 步骤 4：非法输入验证（⚠️ 部分通过）

输入非法 SMILES `C1CCCC`（环闭合不匹配）：

| 检查项 | 实测 | 判定 |
|---|---|---|
| 结构化错误返回（无挂起/无宿主崩溃） | `chem_aizynth failed: …` | ✅ |
| 错误消息干净可读（B8：无堆栈泄漏） | 泄漏内部 Python 堆栈：`AttributeError: 'NoneType' object has no attribute 'GetNumAtoms'`（aizynthfinder/mol.py:84，prepare_tree 处 target_mol=None） | ❌ |

根因：`tools/aizynth_run.py` 未在 `finder.target_smiles = smiles` 前用 RDKit 预检 SMILES；`prepare_tree()` 抛异常后被通用 `except` 捕获，回传 `traceback.format_exc()[-800:]`。

## 5. 缺陷根因定位（完整证据链）

### 5.1 现象：同一次运行中「正确串」与「损坏串」并存

Route 1 反应对象的 metadata 内：

```
mapped_reaction_smiles (201 字符，✅ 完整正确):
[CH3:1][C:2](=[O:3])[O:4][c:5]1[cH:6][cH:7][cH:8][cH:9][c:10]1[C:11](=[O:12])[OH:13]>>
[CH3:1][C:2](=[O:3])[O:14][C:15]([CH3:16])=[O:17].[OH:4][c:5]1[cH:6][cH:7][cH:8][cH:9][c:10]1[C:11](=[O:12])[OH:13]
```

```
rxn.smiles (76 字符，❌ 模板派生、非法):
[C:1]([CH3:2])(=[O:3])[O:4][cH3:5]>>CC(=O)O[C:1]([CH3:2])=[O:3].[O:4][cH3:5]
```

### 5.2 代码链（PY314 移植版 venv，非 dsh 包装层）

| 环节 | 位置 | 说明 |
|---|---|---|
| ① 坏串生成 | `chem/reaction.py:397-398` `_make_smiles` → `AllChem.ReactionToSmiles(self.rd_reaction)` | 把 **SMARTS 模板**（`rd_reaction = ReactionFromSmarts(smarts)`）转成 SMILES 作为反应 SMILES；模板中孤立芳香碳 `[c:5]`（无环信息）被 RDKit 写成 `[cH3:5]`（非法）。坏串的 map 编号（甲基:2、羰基:1、=O:3、O:4、c:5）与模板 `[C;D1;H3:2]-[C;H0;D3;+0:1](=[O;D1;H0:3])-[O;H0;D2;+0:4]-[c:5]` **逐一吻合** |
| ② 坏串传入路线树 | `reactiontree.py:350-361` `_unique_reaction`：`FixedRetroReaction(…, smiles=reaction.smiles, metadata=…)` | 正确串 `mapped_reaction_smiles` 只存入 metadata，未被使用 |
| ③ 坏串输出 | `reactiontree.py:266` `to_dict` → `dict_["smiles"] = node.smiles` | dsh 包装层 `tools/aizynth_run.py` 原样序列化 `tree.to_dict()` |
| ④ 校验失败 | `chem_reaction` balance → RDKit 拒绝 `[cH3:5]` | 系统与 venv 两个 RDKit（2026.03.3 / 2026.03.5）均拒绝 |

### 5.3 结论

- 树内分子数据正确（乙酸酐+水杨酸+阿司匹林）；**损坏仅发生在「反应 SMILES 字符串」这一展示/序列化层面**。
- 该行为疑为上游 AiZynthFinder 4.4.1 固有（`_make_smiles`/`_unique_reaction` 与上游一致），非 PY314 移植引入的新回归；但 dsh 层**应当**用 metadata 中的正确串兜底。

## 6. 修复建议

| 方案 | 位置 | 内容 |
|---|---|---|
| A1（推荐，dsh 层，立即可做） | `tools/aizynth_run.py` | 序列化 reaction 节点时优先取 `metadata["mapped_reaction_smiles"]`（完整正确的分子级串），缺失时再回退 `node.smiles`；并在输出前用 RDKit 校验每条反应 SMILES，非法则回退树对象分子 canonical smiles 重建 `A.B>>C.D` |
| A2（推荐，dsh 层） | 同上 | `finder.target_smiles = smiles` 前用 RDKit `MolFromSmiles` 预检，失败返回干净的 `invalid SMILES`，不再泄漏堆栈 |
| B（端口层，可选） | venv `reaction.py` | 对照上游修复 `_make_smiles` 的模板派生逻辑（如改用分子级 `mapped_reaction_smiles`）；需同步 venv 部署 |

## 7. 验收结论表（预期 vs 实测）

| 检查项（文档预期） | 实测 | 判定 |
|---|---|---|
| 搜索数秒内出首解 | 0.019 s（模型加载 ~15 s 后） | ✅ |
| 总耗时约 20–30 s | 19.11 s | ✅ |
| 路线反应 SMILES 均含 ">>" | 3/3 含 ">>" | ✅ |
| 路线反应 SMILES 原子守恒 | 直接校验失败（`[cH3:5]` 非法）；重构正向反应 3/3 守恒 | ⚠️ 序列化缺陷，化学层面 ✅ |
| ML 路线（乙酸酐+水杨酸）与模板断开（乙酸+水杨酸）互补 | 完全一致（树对象分子证实） | ✅ |
| 非法输入结构化报错 | 结构化返回但泄漏 Python 堆栈 | ⚠️ 部分通过（B8 未满足） |

## 8. 变更文件

| 文件 | 操作 |
|---|---|
| `reports/chem-aizynth-p5-verification-report.md` | 新建（本文档） |
| `_aizynth_debug.py`（工作区临时诊断脚本） | 已删除 |
| 代码文件 | 无改动（缺陷在 venv 端口与 `tools/aizynth_run.py`，修复建议见 §6，未在本轮实施） |
