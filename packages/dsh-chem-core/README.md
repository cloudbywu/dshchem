# @dshchem/dsh-chem-core

DSH（DeepSeek Harness）宿主平面化学引擎。提供 `chem` 服务：通过 Python 子进程桥调用 **RDKit/ASE** 完成确定性分子计算（SMILES 校验/性质/格式转换/能量计算/反应分析/PDF 提取），经 **PubChem PUG REST** 与 **Crossref** 提供数据库与文献交叉核对，并提供跨会话**配方记忆库**（`~/.dsh/chem/recipes.json`）。浏览器半（`client.js`）把 2D 结构图渲染进 chem_* 工具卡片。模型工具层在配套包 `@dshchem/dsh-tool-chem`（预设工具行），本包只拥有引擎、网络、存储、路由与服务，不拥有工具 schema。

## 架构

```
模型工具 (dsh-tool-chem, 预设行) ── ctx.get('chem') ──▶ chem 服务 (本包, host 平面)
                                                          ├─ python/chem_engine.py (RDKit/ASE, 每请求一进程, JSON over stdin/stdout)
                                                          ├─ PubChem PUG REST / Crossref API (fetch)
                                                          ├─ 配方库 ~/.dsh/chem/recipes.json (node:fs)
                                                          └─ /api/dsh-chem/render-svg 路由 (loopback-only) ← client.js 卡片
```

- 引擎契约：`{"op": "validate"|"props"|"convert"|"calc"|"reaction"|"pdftext", "args": {...}}` → `{"ok": true, "result": ...} | {"ok": false, "error": "..."}`；结构化错误是**响应**而非进程失败（引擎始终以 0 退出）。
- 网络请求带 User-Agent（PubChem/Crossref 使用规范）。
- 浏览器半通过 `dsh.client` 清单加载（`window.__ModuleLoader__.load` 协议，纯 JS 无构建），在 `tool.call.toolview` Slot 注册 chem_* 工具卡片。

## 安装（作为 profile bundle）

```powershell
dsh plugin --profile web add "link:C:\path\to\dshchem\packages\dsh-chem-core"
```

这会向 profile 的 `package.json` 写入 `link:` 依赖并把包追加到 `dsh.profile.bundles`（本包的 `cordis.patch.yml` 插入 `chem-core` 行）。**重启 dsh 后生效**。

## 配置（行 config，可选）

| 键 | 默认 | 说明 |
|---|---|---|
| `python` | `python`（或环境变量 `CHEM_PYTHON`） | Python 可执行文件；需安装 RDKit |
| `timeoutMs` | 30000 | 引擎调用预算（超时强杀子进程） |
| `pubchemTimeoutMs` | 30000 | PubChem 单请求预算 |

## 服务 API

- `validate(smiles)` → `{ok, result:{valid, canonical, formula, inchi, inchikey, heavyAtoms}}`
- `props(smiles)` → 分子描述符（MW/exactMw/logP/HBD/HBA/TPSA/旋转键/芳香环/重原子/电荷/分子式）。IUPAC 名请用 `chem_pubchem`：RDKit 不提供 IUPAC 命名 API。
- `convert(smiles, format)` → `canonical | inchi | inchikey | mol | sdf | svg`（SVG 为 2D 结构图）
- `pubchemLookup(query, by)` → 按 `name | cid | smiles | inchikey` 查询属性
- `pubchemSuggest(query, limit)` → 名称前缀自动补全

## 开发

- 引擎单测：`python python/chem_engine.py` + stdin JSON。
- 集成测试（需工作区 junction，见顶层 README）：`node test/integration.mjs`。
- 环境要求：Python 3.10+、`pip install rdkit`（已在本机验证 RDKit 2026.03.3）。
