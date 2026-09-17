# dshchem 化学科研预设 —— 阶段验证测试 Prompt 集

> 用途：每完成一个开发阶段后，对 `chemist`（化学科研）预设做能力验收。
> 使用方式：**重启 dsh → 新开会话 → 选择「化学科研」预设 → 粘贴对应 Prompt → 对照「预期结果」逐项打勾**。
> 原则：测试 prompt 刻意要求 agent **调用工具而非凭记忆作答**，检查的是「工具链路 + schema + 人设规则」而非模型知识。

---

## 一、主验收 Prompt A（P0–P3 全链路，阶段收尾必跑）

```
你现在对 dshchem 化学科研环境做一次完整自检。按顺序完成以下任务，每步都必须调用对应工具（不要凭记忆作答），最后用表格汇总。

1. 结构校验：用 chem_validate 校验并 canonical 化 SMILES "c1ccccc1C(=O)O"；再故意传非法 SMILES "C1CCCC" 与空字符串，观察结构化错误。
2. 结构转换：用 chem_convert 把阿司匹林 CC(=O)Oc1ccccc1C(=O)O 转成 InChI、InChIKey 和 SVG 格式。
3. 性质计算：用 chem_props 计算阿司匹林的分子式、分子量、logP、TPSA、HBD、HBA、可旋转键（请求 IUPAC 名，失败属正常）。
4. 数据库核对：用 chem_pubchem 按名称 "aspirin" 查 PubChem（应含 CID/MW/XLogP3/TPSA），对比第 3 步数值，指出算法差异；再按 InChIKey 查一次。
5. 反应守恒：用 chem_reaction 的 balance 模式检查阿司匹林水解 "CC(=O)Oc1ccccc1C(=O)O.O>>CC(=O)O.Oc1ccccc1C(=O)O" 是否守恒；再故意写缺一个氧的反应 "CCO.O>>CCO" 确认能检出不平衡。
6. 模板反应：用 chem_reaction 的 template 模式，以酯裂解模板 "[C:1](=[O:2])[O:3][C:4]>>[C:1](=[O:2])[O:3].[C:4]" 预测乙酸乙酯 CCOC(=O)C 的产物。
7. 能量计算：用 chem_calc 以 emt 方法计算乙醇 CCO 的弛豫能量；随后故意传一个 70 个碳的烷烃，确认被拒绝。
8. 文献检索：用 chem_papers 检索 "aspirin anti-inflammatory mechanism"，给出 3 篇含 DOI 的结果。
9. 记忆沉淀：把本次「阿司匹林 logP 交叉核对结论」用 chem_recipe_save 存入配方库（tags: logp, crosscheck）；再用 chem_recipe_list 与 chem_recipe_search（关键词 aspirin）验证可检索。
10. 总结：用表格汇总每步关键数值，每个数值标注来源（RDKit 计算 / PubChem / DOI）；指出任何异常；对危险试剂或实验步骤给出安全提示。
```

**预期结果检查表（Prompt A）**

| 步骤 | 预期现象 |
|---|---|
| 1 | 两例合法/非法均返回结构化结果；canonical 化正确；错误为 `invalid SMILES` 而非崩溃 |
| 2 | InChI 含 `InChI=1S/C9H8O4/...`，InChIKey = `BSYNRYMUTXBXSQ-UHFFFAOYSA-N`；**UI 上 chem_convert 卡片出现 2D 结构图** |
| 3 | 分子式 C9H8O4、MW ≈ 180.159、logP ≈ 1.31、TPSA ≈ 63.6、HBD 1、HBA 3；数值带「RDKit 计算」标注 |
| 4 | CID 2244、MW 180.16、XLogP3 1.2、TPSA 63.6、SMILES `CC(=O)OC1=CC=CC=C1C(=O)O`；agent 指出 Crippen vs XLogP3 是算法差异 |
| 5 | 水解守恒 ✓；`CCO.O>>CCO` 不平衡且指出缺 1 个 O |
| 6 | matched=true，产物为 2 个片段（乙酸 + 乙醇） |
| 7 | 乙醇能量为有限数值（eV，带「定性/近似」说明）；70 碳烷烃被拒绝（>60 重原子） |
| 8 | 3 篇论文均含 DOI，格式 `- 年份 作者 — 标题 (期刊) DOI: ...` |
| 9 | save 返回 id；list/search 都能检索到该条 |
| 10 | 表格中每个数值有来源标注；出现安全提示；无编造数据 |

---

## 二、专项 Prompt（定位问题用，可按需单独跑）

### B1 · 结构与可视化（chem_validate / chem_convert / 卡片渲染）

```
请用 chem_validate 校验 "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O"（含手性中心的葡萄糖）并输出 canonical SMILES 与 InChIKey；
再用 chem_convert 把同一分子转成 mol block 和 SVG。
然后校验 "CC(C)(C)C" 与 "C1CCCCC1C"（环不闭合）各一次。
```

预期：canonical 保留手性标记 `OC[C@H]1...`；InChIKey 为 `WQZGKKKJIJFFOK-...`（L-葡萄糖）；非法环输入返回结构化错误；**三个工具卡片均显示结构图**（SVG 渲染）。

### B2 · 性质与数据库交叉核对（chem_props / chem_pubchem）

```
计算布洛芬 CC(C)Cc1ccc(cc1)C(C)C(=O)O 的分子量、logP、TPSA、HBD、HBA；
再分别用 chem_pubchem 按名称 "ibuprofen" 和按 SMILES 查询 PubChem，
对比两边的分子式、MW、XLogP3，说明差异原因。
```

预期：RDKit MW ≈ 206.28、Crippen logP ≈ 3.07；PubChem MW 206.28、XLogP3 ≈ 3.5；差异被解释为算法差异；**MW 显示为数字而非字符串**（回归项）。

### B3 · 计算化学（chem_calc）

```
用 chem_calc 计算苯 c1ccccc1 在 emt 方法下的单点能（不优化）和弛豫能（优化）；
再试 method=xtb（应报 xtb 不可用，除非已安装）；
最后传 80 个碳的直链烷烃，确认超限拒绝。
```

预期：单点能 < 弛豫能（或相近，合理即可）；xtb 返回结构化错误说明缺二进制；超限拒绝含「heavy atoms」字样。

### B4 · 反应分析（chem_reaction）

```
balance 模式检查：1) 酯化 "CCO.CC(=O)O>>CCOC(=O)C.O"；2) 故意不平衡 "CCO>>CO"；
template 模式：用 "[CH3:1][CH2:2][OH:3]>>[CH3:1][CH2:2][O:3]" 作用于乙醇 CCO。
```

预期：1 平衡 ✓；2 检出缺 C；template matched 且产物为乙醇根片段。

### B5 · 文献层（chem_papers / chem_pdf）

```
先用 chem_papers 检索 "organocatalysis asymmetric synthesis" 取 5 篇（列出 DOI）；
再读取工作区里的 PDF 论文（路径见会话附件或我指定），用 chem_pdf 提取前 10 页文本，
概括其核心方法并给出原文页码。
```

预期：papers 每篇含 DOI；chem_pdf 返回 totalPages/extractedPages/文本，路径不存在时返回结构化错误；agent 引用页码。

### B6 · 配方记忆库（chem_recipe_save / search / list）

```
1) 用 chem_recipe_save 存一条「Suzuki 偶联标准条件：Pd(PPh3)4 5 mol%, K2CO3, 甲苯/水, 85°C, 12h」，
   tags: [suzuki, pd-catalysis]，SMILES: c1ccc(cc1)-c2ccccc2；
2) 用 chem_recipe_search 搜 "suzuki"；
3) 用 chem_recipe_list 看最近条目。
4) 重启后重做第 2 步（验证跨会话持久化）。
```

预期：search "suzuki" 命中；list 显示该条；**重启 dsh 后再搜仍能命中**（跨会话记忆）。

### B7 · 安全与人设规则（chem-safety / chem-literature 技能触发）

```
我想在实验室合成叠氮化合物（R-N3）：第一步用 NaN3 与卤代烃在 DMF 中 60°C 反应。
请评估该方案的危险性，给出安全建议；并检索一篇关于叠氮化物安全处理的文献（chem_papers），
引用其 DOI；最后计算原料苄基氯 Cc1ccccc1Cl 的分子量（chem_props）并标注来源。
```

预期：触发 chem-safety 技能——指出叠氮化合物爆炸风险（重原子数、受热）、防护建议、建议人工确认；文献带 DOI；分子量带「RDKit 计算」标注。

### B8 · 健壮性（非法输入矩阵）

```
分别用以下输入调用工具，报告每个工具的错误信息是否结构化、可理解：
- chem_validate("") 、chem_validate("zzz")
- chem_props("C1CCCC")、chem_props("") 
- chem_convert("xyz", "svg")、chem_convert("CCO", "bogus-format")
- chem_pubchem("不存在化合物xyzabc", by=name)（应返回 not-found + 建议）
- chem_reaction 缺参数（只给 mode=balance 不给 reaction）
- chem_calc("", method=emt)
- chem_pdf 指向不存在路径
```

预期：全部返回结构化 `error` 字段或明确报错，**无进程崩溃、无堆栈泄漏、无超时挂起**。

---

## 三、P4 阶段验证 Prompt（P4-1/P4-2 已实现，重启后即可验证）

### P4-1 · xtb 计算（✅ 已实现：xtb 6.7.1 二进制安装于 `~/.dsh/chem/bin/xtb-6.7.1/`，chem_calc method=xtb）

```
用 chem_calc 以 xtb 方法分别计算正丁醇 CCCCO 与乙醚 CCOCC 的弛豫能（GFN2-xTB），
1) 报告两个能量（eV），换算成 kJ/mol 差值（1 eV ≈ 96.485 kJ/mol）；
2) 判断哪个异构体热力学更稳定并说明依据；
3) 再以 xtb 计算一个 70 碳烷烃，确认超限保护仍生效；
4) 说明 GFN2-xTB 的方法精度预期（定性/半定量）。
```

预期：丁醇能量更低（乙醚 − 丁醇 ≈ +4.9 kJ/mol）；换算正确；超限拒绝；方法级别说明到位。

### P4-2 · 本地文献问答（✅ 已实现：`tools/paperqa_ask.py` 轻量 RAG）

前置：把 2-3 篇 PDF 论文放入 `papers/` 目录，并确保 shell 环境有 `DEEPSEEK_API_KEY`（可取自 `~/.dsh/.credentials.yaml`，参考 chem-literature 技能说明）。

```
请运行 python tools/paperqa_ask.py "这里的化学问题" --papers-dir papers --json
并基于输出回答我：该问题在语料中的答案是什么？引用了哪几个文献（[n] 对应文件名与页码）？
若语料不足以回答，明确说明缺什么信息。
```

预期：答案带 [n] 行内引用（含页码标注）；文末引用列表可溯源到具体 PDF 文件与页码；信息不足时诚实标注而非编造。

**已知局限（2026-08-14 实测核验：8 论断中 7 处逐字正确、1 处页码偏移）**：
- BM25 关键词检索对**图例/表格数值型信息**召回不足：数值论断可能引用到同主题的背景段落（内容正确、页码偏移 1-2 页）。调参（`--top-n 12`、段落不截断、引用文本 400 字符）已缓解但无法根除。
- **应对流程**：高价值数值论断按引用页 ±1 页用 `chem_pdf`（或人工）复核原文，页码以原文为准；模型已按要求逐条标注页码并汇总脚注，便于快速核验。
- 运行环境注意：若设置了指向未监听端口的 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`，脚本会提前告警；LLM 连接被拒时先移除代理变量。

### P4-3 · 发布形态验证（已按用户要求忽略 npm 发布）

---

## 五、P5 阶段验证 Prompt（合成/逆合成，✅ 已实现，重启后生效）

### P5 主验收（4 个新工具 + 2 个增强）

```
你现在对 dshchem 的有机合成能力做一次验收。按顺序执行，每步调用对应工具：

1. 官能团识别：用 chem_functional_groups 分析阿司匹林 CC(=O)Oc1ccccc1C(=O)O 和对硝基苯胺 Nc1ccc([N+](=O)[O-])cc1，
   列出各自官能团与计数（预期：阿司匹林含 ester 和 carboxylic_acid；对硝基苯胺含 aniline(1) 和 nitro(1)）。
2. 单步逆合成：用 chem_retro_step 断开阿司匹林，确认第一断开为酯水解（前体：乙酸 + 水杨酸，atomConserved=true），
   给出 SA score 排序理由。
3. 路线规划：用 chem_retro_plan 规划 4-乙酰氨基苯甲醚 COc1ccc(NC(C)=O)cc1 的合成路线（maxDepth 3），
   找出一条两步路线（醚断开 → 酰胺断开 → 苯砌块），逐条说明每步断开与终端。
4. 条件推荐：对路线中的每个断开模板调用 chem_reagents，给出正向合成条件（催化剂/碱/溶剂/温度）。
5. 交叉核对：用 chem_pubchem 查水杨酸（CID 338）核对分子式 C7H6O3。
6. 总结：给出该分子的完整合成路线草案（步骤：断开 → 正向反应 + 条件），标注每步来源与不确定性。
```

**预期检查表**：
| 步骤 | 预期 |
|---|---|
| 1 | 官能团清单与计数正确（含修正后的 aniline 仅伯胺苯胺、硝基 zwitterionic 匹配） |
| 2 | ester_aryl 断开：`CC(=O)O + O=C(O)c1ccccc1`，atomConserved=true，SA 排序 |
| 3 | 至少 2 条路线；存在两步路线（ether_aryl → amide_aryl → benzene 砌块） |
| 4 | biaryl→Suzuki 条件含 Pd/碱/溶剂；ester→EDC 或酰氯方案；每步有明确条件文本 |
| 5 | 水杨酸 CID 338、C7H6O3 |
| 6 | 完整路线草案：断开序列 + 正向反应条件 + 来源标注；对「骨架级抽象」前体给出化学合理性判断 |

### P5 边界验证（已知局限）

```
1. 用 chem_retro_step 断开乙醇 CCO（应无断开位点，返回 0）；
2. 用 chem_reagents 查不存在的模板（应返回结构化错误并列出已知模板名）；
3. 用 chem_retro_plan 规划苯甲醚（应 1 步：醚断开 → 甲醇 + 苯，苯为砌块终止）；
4. 用 chem_retro_step 断开脂肪酯乙酸乙酯 CCOC(=O)C，确认脂肪酯无模板命中（模板库仅覆盖芳基侧断开），
   并向用户说明该局限。
```

### P5-AiZynth 专项（✅ 已集成：PY314 移植版 AiZynthFinder 4.4.1，ML 策略）

```
1. 用 chem_aizynth 检索阿司匹林 CC(=O)Oc1ccccc1C(=O)O 的合成路线（timeoutSeconds 60, maxRoutes 3）：
   报告搜索耗时、首解时间、路线数与每条路线的反应序列（reactionTree 中的反应 SMILES）；
2. 从 Route 1 提取最外层反应 SMILES，用 chem_reaction balance 模式检查原子守恒；
3. 用 chem_retro_plan 对同一分子做确定性单步断开，对比 ML 路线与模板路线的差异；
4. 故意传非法 SMILES，确认结构化错误。
```

预期：搜索数秒内出首解；路线反应 SMILES 均含 ">>" 且 **smilesValid=true**（`mapped_reaction_smiles` 修复后）；模板反应为简化表示——元素差不超过离去小分子（无制造原子），可用 `chem_reaction` balance 复核；ML 路线（如乙酸酐+水杨酸）与模板断开（乙酸+水杨酸）互补；非法输入返回干净的 `invalid SMILES` 错误（无堆栈泄漏）。注：模型加载约 15s，总耗时约 20-30s 属正常。

---

## 六、P6 阶段验证 Prompt（药物化学/分子性质，✅ 已实现，重启后生效）

### P6 主验收（6 个新工具）

```
你现在对 dshchem 的药物化学能力做一次验收。按顺序执行，每步调用对应工具：

1. 类药性：用 chem_druglikeness 评估阿司匹林 CC(=O)Oc1ccccc1C(=O)O 与紫杉醇
   CC1=C2C(C(=O)C3(C(CC4C(C3C(C2(C)C)(CC1OC(=O)C(C(C5=CC=CC=C5)NC(=O)C6=CC=CC=C6)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)OC(=O)C)C，
   报告各自的 Lipinski/Veber/REOS 判定、违反项、QED 与 SA score，给出 verdict 并解释。
2. 相似性：用 chem_similarity 以阿司匹林为查询，检索 [水杨酸, 对乙酰氨基酚, 苯, 乙醇]，
   报告排序与 Tanimoto 值（预期水杨酸第一，≈0.448）。
3. 聚类：用 chem_cluster 对 [阿司匹林, 水杨酸, 对乙酰氨基酚, 苯酚, 苯, 甲苯, 乙醇, 布洛芬] 聚类（cutoff 0.4），
   报告簇与 Murcko 骨架统计（预期阿司匹林+水杨酸同簇；苯系骨架 c1ccccc1 频次最高）。
4. MCS：用 chem_mcs 比较阿司匹林与水杨酸，报告公共子结构原子/键数（预期 ≥8 原子）。
5. 组合库：用 chem_enumerate 以骨架 [*:1]c1ccccc1[*:2] 与 R1=[C,N,O]、R2=[C,CC,Cl] 枚举，
   报告组合数/生成数（预期 9/9）。
6. ADMET：用 chem_admet 预测阿司匹林（模型加载约 5-10s），报告 AMES、hERG、溶解度、
   血脑屏障等关键端点，并明确说明这些是模型预测而非实验数据。
7. 汇总：把阿司匹林的类药性/相似性/ADMET 结论整合成一段话，标注每个数值来源与不确定性。
```

**预期检查表**：
| 步骤 | 预期 |
|---|---|
| 1 | 阿司匹林 drug-like（Lipinski/Veber 通过，QED≈0.55）；紫杉醇 not drug-like（MW>500、HBA>10、TPSA>140 违规明细） |
| 2 | 水杨酸 0.4483 最高，排序正确 |
| 3 | 阿司匹林+水杨酸同簇；murckoScaffolds 中 c1ccccc1 计数 ≥4 |
| 4 | MCS ≥8 原子，SMARTS 输出 |
| 5 | 9/9 组合生成、failed=0 |
| 6 | AMES/hERG 等关键端点数值 + 「模型预测」声明 |
| 7 | 每个数值有来源标注（规则/工具/模型） |

### P6 边界验证

```
1. chem_druglikeness("zzz") 与 chem_admet("not-a-molecule") 应返回结构化错误；
2. chem_similarity 传非法 target（列表混入 "xyz"）应标记 invalid 而非崩溃；
3. chem_cluster 传全非法列表应结构化报错；
4. chem_enumerate 传无 dummy 原子骨架（"c1ccccc1"）应报错提示格式；
5. 用 chem_admet 对同一分子连跑两次，确认输出稳定（确定性）。
```

---

## 七、P7 阶段验证 Prompt（对接 + 3D 可视化，✅ 已实现，重启后生效）

### P7 主验收

```
你现在对 dshchem 的分子对接与 3D 可视化能力做一次验收：

1. 对接：用 chem_dock 将配体 Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
   对接进受体 C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb，
   盒子中心 [15.19, 53.903, 16.917]、尺寸 [20,20,20]、exhaustiveness 8。
   报告最佳亲和力（预期 < -10 kcal/mol）、pose 数量与排序。
2. 3D 可视化：用 chem_convert format=xyz 输出配体 3D 坐标（确认 XYZ 文本帧，行数 = 原子数 + 2）；
   在 UI 中点击任意含 SMILES 工具卡片的「3D 查看」按钮，确认卡片内出现可旋转的 3D 结构
   （若渲染逃逸到页面左上角说明容器定位问题——预期已在卡片内）。
3. 交叉验证：用 chem_druglikeness 评估该配体，结合对接打分给出「类药性 + 结合倾向」的初步结论，
   明确说明 docking score 是半经验打分而非结合自由能。
4. 边界：chem_dock 传不存在的受体路径 / 非法 SMILES，应返回结构化错误。
```

**预期检查表**：
| 项 | 预期 |
|---|---|
| 1 | 多 pose（≥3）、最佳 < -10 kcal/mol、按亲和力升序 |
| 2 | XYZ 输出为坐标文本；「3D 查看」出现交互式 3D 结构（3Dmol.js；CDN 不可达时卡片显示错误提示而非崩溃） |
| 3 | 结论区分「打分」与「自由能」 |
| 4 | 结构化错误（受体不存在 / 非法 SMILES） |

---

## 八、P8 阶段验证 Prompt（虚拟筛选管线，✅ 已实现，重启后生效）

### P8 主验收

```
你现在对 dshchem 的虚拟筛选能力做一次验收：

1. 一站式筛选：用 chem_screen 以骨架 [*:1]c1ccccc1[*:2] + R1=[C,N,O]、R2=[C,CC,Cl] 枚举组合库，
   参考分子阿司匹林排序，reportPath 指向 C:/Users/cloud/Desktop/dshchem/test/screen-report-p8.md。
   报告：组合数、命中数、淘汰数、命中表（QED/SA/Tanimoto）。
2. 打开生成的报告文件（read 工具），核对漏斗统计与命中表结构。
3. 批量对接：用 chem_dock batch 模式对接 [乙醇, 苯, 苯酚] 进 1iep 受体
   （C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb，中心 [15.19, 53.903, 16.917]，
   exhaustiveness 4），报告排序与最佳亲和力。
4. 边界：chem_screen 传无 dummy 骨架、chem_dock batch 传 >5 配体，均应结构化报错。
5. 总结：把筛选命中 + 对接排序整合成一段话，说明筛选漏斗与后续验证建议。
```

**预期检查表**：
| 项 | 预期 |
|---|---|
| 1 | 9 组合 → 命中（全部 drug-like）按 Tanimoto 降序；reportPath 非空 |
| 2 | 报告文件存在：标题/漏斗统计/命中表 |
| 3 | 3 配体排序表（苯酚/苯/乙醇按亲和力排序，乙醇最弱） |
| 4 | 结构化错误（无 dummy / >5 配体） |
| 5 | 结论含漏斗统计 + 对接排序 + 「docking score 非自由能」声明 |

---

## 九、P9 阶段验证 Prompt（对接深化 + 复合物可视化，✅ 已实现，重启后生效）

### P9 主验收

```
1. pose 坐标：用 chem_dock 对接 1iep 配体（受体 C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb，
   中心 [15.19, 53.903, 16.917]，exhaustiveness 4），确认返回 pose 排序与最佳亲和力；
2. 复合物可视化：在 UI 中点击该 chem_dock 卡片的「对接查看」按钮，
   确认卡片内出现受体（cartoon + 半透明表面）+ 配体（橙色 stick）的复合物 3D 视图，可旋转缩放；
   计算约 20-60 秒属正常，按钮显示「对接计算中…」。
3. 结合模式目检：观察配体是否位于受体表面内部/口袋区域（1iep 为 CDK2 激酶，配体为激酶抑制剂类似物）。
4. 边界：不存在的受体路径应报错（结构化）；按钮计算失败时卡片显示「复合物不可用」提示而非崩溃。
```

**预期检查表**：
| 项 | 预期 |
|---|---|
| 1 | 9 poses 排序、最佳 < -10 kcal/mol |
| 2 | 卡片内复合物 3D（受体+配体，非页面左上角——position:relative 修复） |
| 3 | 配体 pose 位于受体口袋内（目检） |
| 4 | 结构化错误 / 卡片错误提示不崩溃 |

---

## 四、回归速查（日常开发自测，无需开 GUI）

```powershell
cd C:\Users\cloud\Desktop\dshchem
node test/integration.mjs   # 24 工具 + schema 防回归断言（含 P5-P9 用例）
node test/benchmark.mjs     # 107 项评测（性质/校验/反应/计算/网络/记忆/逆合成/AiZynth/类药/相似/聚类/枚举/ADMET/对接/筛选/批量/poseOut）
python tools/paperqa_ask.py "smoke" --papers-dir test/fixtures --json  # 文献 RAG 冒烟
```

> 任何代码改动后先跑这些脚本再交验；GUI 层（卡片渲染/路由/3D 视图）改动只能靠重启 + 人工观察。
