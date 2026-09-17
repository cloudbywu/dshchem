# @dshchem/dsh-tool-chem

DSH `chemist` 化学科研预设的模型工具行包（**24 个 `chem_*` 工具**）。每个工具都是宿主 `chem` 服务（`@dshchem/dsh-chem-core` 提供）的薄消费者——只拥有 schema、校验与呈现，不拥有计算与网络。

## 工具清单

| 工具 | 用途 | 关键输出 |
|---|---|---|
| `chem_validate` | SMILES 校验 + canonical 化 | canonical/formula/InChI/InChIKey/heavyAtoms |
| `chem_props` | 分子描述符（RDKit） | MW/exactMw/logP/HBD/HBA/TPSA/旋转键/芳香环/电荷/分子式 |
| `chem_convert` | 结构格式转换 + 2D/3D 结构图 | canonical/inchi/inchikey/mol/sdf/svg/xyz |
| `chem_pubchem` | PubChem 交叉核对 + 名称自动补全 | CID/名称/分子式/MW/SMILES/IUPAC/InChIKey |
| `chem_calc` | 能量计算 | emt / xtb GFN2-xTB 能量与弛豫 |
| `chem_reaction` | 反应分析 | 原子守恒 / SMARTS 模板产物 |
| `chem_recipe_save` / `_search` / `_list` | 配方记忆库 | id/title/tags/content（跨会话持久） |
| `chem_papers` | 文献检索 | DOI/标题/期刊/年份/作者/摘要 |
| `chem_pdf` | 本地 PDF 文本提取 | pages/chars/text |
| `chem_retro_step` | 单步逆合成断键 | precursors/atomConserved/saScore |
| `chem_functional_groups` | 官能团识别（24 种） | name/count |
| `chem_retro_plan` | BFS 逆合成路线 | plans（route/terminal/reason） |
| `chem_reagents` | 正向合成条件推荐 | conditions/notes |
| `chem_aizynth` | AiZynthFinder 反应树搜索 | routes（score/reactionTree） |
| `chem_druglikeness` | 类药性 + QED + SA | lipinski/veber/reos/verdict/qed/saScore |
| `chem_similarity` | Tanimoto 相似性排序 | results（target/tanimoto/invalid） |
| `chem_cluster` | Butina 聚类 + Murcko 骨架 | clusters/numSingletons/murckoScaffolds |
| `chem_mcs` | 最大公共子结构 | smarts/numAtoms/numBonds |
| `chem_enumerate` | R-group 组合枚举 | combinations/generated/products |
| `chem_admet` | ADMET 端点预测（104 项） | endpoints/count |
| `chem_dock` | AutoDock Vina 对接 | poses/bestAffinity_kcal_mol/batch |
| `chem_screen` | 一站式虚拟筛选 | hits/failed/reportPath |

设计要点：LLM 只规划与叙事，分子事实一律由工具产出——这是 ChemCrow 范式在 DSH 预设中的落地（防 SMILES/性质幻觉）。

## 预设行用法

在 `agent.cordis.yml` 中（本机 `~/.dsh/.agent-presets/chemist/agent.cordis.yml`）：

```yaml
- id: tool-chem
  name: 'C:/Users/cloud/Desktop/dshchem/packages/dsh-tool-chem/lib/index.js'
```

- **开发期**：绝对路径行直接指向本仓库入口；包内 `import '@deepseek-ai/dsh-tools'` 依赖工作区 junction 解析（见顶层 README「依赖解析」）。
- **发布期**：`npm publish` 后将行改为 `name: '@dshchem/dsh-tool-chem'`，并把 `@deepseek-ai/dsh-tools` 列为常规依赖（自包含解析），或保持绝对路径用于个人部署。

## 挂载校验

```powershell
# 通过 dsh-agent-presets 的 standingKeyFor 校验（组合真实挂载，非语法检查）
# 需要 chem 服务已在当前进程提供（重启后由 chem-core bundle 提供）
```
