# P7 阶段验证测试报告（分子对接 + 3D 可视化）

- **测试依据**：`reports/chemist-testing-prompts.md` 第七节（P7 主验收，4 项）
- **测试日期**：2026-08-15 21:00
- **测试方式**：在 dshchem 化学科研预设会话中，按文档 Prompt 逐项调用 `chem_dock` / `chem_convert` / `chem_druglikeness`，并实测 3D 查看后端路由 `/api/dsh-chem/xyz`，对照「预期检查表」逐项核验
- **结论总览**：主验收工具侧 **3.5/4 通过**；1 项偏差（P7-2 的 `chem_convert format=xyz` 被工具 schema 拒绝——测试 Prompt 与实现不一致，底层 xyz 能力实际可用，详见 §2 缺陷记录）；GUI「3D 查看」按钮交互需人工目检（后端链路已实测通过）

---

## 一、P7 主验收

### 1. 分子对接（chem_dock）✅

- 配体：`Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1`
- 受体：`C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb`（存在性已确认 ✅）
- 盒子中心 `[15.19, 53.903, 16.917]`、尺寸 `[20,20,20]`、exhaustiveness 8

| mode | 亲和力 (kcal/mol) | RMSD (ub/lb) |
|---|---|---|
| 1 | **-11.94** ✅（预期 < -10） | 0 / 0 |
| 2 | -8.78 | 3.02 / 12.19 |
| 3 | -8.50 | 2.27 / 12.05 |
| 4 | -8.41 | 3.16 / 11.84 |
| 5 | -8.28 | 4.01 / 12.42 |
| 6 | -8.25 | 3.90 / 12.08 |
| 7 | -8.00 | 3.56 / 6.58 |
| 8 | -7.96 | 3.36 / 6.51 |
| 9 | -7.51 | 2.72 / 12.27 |

- 共 **9 个 pose（≥3 达标）**，按亲和力**升序**排列 ✅
- 最佳亲和力 **-11.94 kcal/mol**（预期 < -10）✅
- 工具自带说明：vina 1.2 半经验打分，affinities 为 docking score 而非结合自由能 ✅
- 数值来源：AutoDock Vina 1.2（meeko 配体准备 + vina 受体转换），半经验打分。

### 2. 3D 可视化（chem_convert format=xyz / GUI 3D 查看）⚠️ 部分通过

**工具层**：`chem_convert` 的 format 枚举为 `["canonical","inchi","inchikey","mol","sdf","svg"]`，**不接受 `xyz`**，返回结构化错误：

```
Error: invalid arguments: "format" must be one of ["canonical","inchi","inchikey","mol","sdf","svg"]
```

（结构化、无崩溃——错误本身符合 B8 健壮性要求，但功能不达测试 Prompt 预期。）

**后端实测**：3D 查看按钮实际走的内部路由 `/api/dsh-chem/xyz?smiles=...`（loopback-only，直接调用 Python 引擎 convert，其 `SUPPORTED_CONVERT` 含 `"xyz"`，见 `packages/dsh-chem-core/python/chem_engine.py:31,107-115`，坐标由 ETKDG 嵌入生成）。实测同配体：

- HTTP **200**，Content-Type `chemical/x-xyz; charset=utf-8`
- 输出 70 行 = 原子数头 `68` + 注释行（canonical SMILES）+ 68 行坐标，示例：

```
C     -4.1937    -4.3800     3.1466
C     -3.1980    -3.3996     2.6179
C     -1.9689    -3.3404     3.2363
```

**GUI 层**：`packages/dsh-chem-core/client.js` 已实现「3D 查看」按钮（lazy-load 3Dmol.js 2.4.2，jsdelivr → unpkg 双 CDN 回退；加载失败显示「3D 不可用: …」而非崩溃，符合预期检查表注释）。按钮的实际点击交互**需人工在 GUI 中目检**（本会话无法代点）。

**结论**：XYZ 输出能力存在且链路（客户端 → 路由 → Python ETKDG → 3Dmol.js 渲染）实测打通；偏差仅在于**测试 Prompt 要求走 `chem_convert format=xyz`，而该格式刻意未对 agent 工具暴露**（见 §2 缺陷记录）。

### 3. 交叉验证（chem_druglikeness）✅

| 指标 | 数值 |
|---|---|
| verdict | **drug-like** ✅ |
| MW | 493.62 |
| logP (Crippen) | 4.59 |
| HBD / HBA | 2 / 7 |
| TPSA | 86.3 |
| 可旋转键 | 7 |
| QED | 0.389 |
| SA score | 2.33 |
| Lipinski / Veber / REOS | pass / pass / pass |

**初步结论（类药性 + 结合倾向）**：
- 配体 MW 493.62、logP 4.59、TPSA 86.3，三条规则全部通过，属可类药分子；QED 0.389 偏低但 SA 2.33 合成可行。
- 对接最佳打分 -11.94 kcal/mol（9 pose 中首尾跨度 -7.5 ~ -11.9），结合倾向强。
- **重要限定**：docking score 是 Vina 半经验打分，**不是结合自由能**，仅用于排序/筛选；-11.94 kcal/mol 不能直接解读为 ΔG_bind = -11.94 kcal/mol。最终结论需 MD/实验（IC50/Kd）验证。
- 数值来源：RDKit 规则/描述符（chem_druglikeness）；对接打分来源 Vina 1.2。

### 4. 边界测试（chem_dock 非法输入）✅

| 用例 | 返回 |
|---|---|
| 受体路径不存在 `C:/nonexistent/path/receptor.pdb` | `chem_dock failed: receptor PDB file not found: 'C:/nonexistent/path/receptor.pdb'`（结构化 ✅） |
| 非法 SMILES `not-a-molecule` | `chem_dock failed: invalid SMILES: 'not-a-molecule'`（结构化 ✅） |

无进程崩溃、无堆栈泄漏。

---

## 二、预期检查表对照

| 项 | 预期 | 实测 | 判定 |
|---|---|---|---|
| 1 | 多 pose（≥3）、最佳 < -10 kcal/mol、按亲和力升序 | 9 pose、-11.94 kcal/mol、升序 | ✅ |
| 2 | XYZ 输出为坐标文本；「3D 查看」出现交互式 3D | 工具层 format=xyz 被拒；后端路由实测输出 68 原子 XYZ 文本；按钮代码含 CDN 回退与错误提示 | ⚠️（见缺陷 1；按钮交互待人工目检） |
| 3 | 结论区分「打分」与「自由能」 | 已明确区分 | ✅ |
| 4 | 结构化错误（受体不存在 / 非法 SMILES） | 两条均为结构化错误 | ✅ |

## 三、缺陷记录

1. **【规格不一致】`chem_convert format=xyz` 对 agent 不可用（P7-2）**
   - 现象：`chem_convert` schema 枚举仅 6 种格式，传 `xyz` 返回结构化错误；而 Python 引擎内部与 `/api/dsh-chem/xyz` 路由均支持 xyz。
   - 定位：`packages/dsh-chem-core/lib/index.js`（工具 schema 定义，格式枚举无 xyz）vs `packages/dsh-chem-core/python/chem_engine.py:31`（`SUPPORTED_CONVERT` 含 xyz）。
   - 建议二选一：a) 修改测试 Prompt P7-2，改为「确认 GUI 3D 查看按钮 + 实测 /api/dsh-chem/xyz 路由」；b) 若希望 agent 可直接输出 XYZ，把 `xyz` 加入工具 schema 枚举（引擎已支持，改动很小）。
2. **【待人工】GUI「3D 查看」按钮交互**：后端链路已实测（HTTP 200 + XYZ 文本 + 3Dmol.js 加载逻辑），按钮点击与 3D 渲染需在浏览器人工确认（CDN 可达时显示可旋转结构；不可达时卡片应显示「3D 不可用」提示而非崩溃）。

## 四、结论

- P7 主验收工具侧 3.5/4 通过：对接（9 pose、-11.94 kcal/mol、升序）、交叉验证（drug-like + 打分/自由能区分）、边界（结构化错误）全部达标。
- 唯一偏差为测试 Prompt 与实现不一致（chem_convert 未暴露 xyz），实际 3D 能力（ETKDG XYZ + 3Dmol.js 查看器）链路完整可用。
- 遗留人工项：GUI 中点击「3D 查看」目检可旋转 3D 结构。
