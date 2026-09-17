# dshchem 代码审阅报告

- **日期**：2026-09-17
- **范围**：仓库工作树（`packages/`、`test/`、`tools/`、`reports/`、`research/`、`README.md`）
- **方法**：静态通读 + 用 harness 自带的 `validateJsonSchemaValue`（`@deepseek-ai/dsh-tools`）对真实工具输出做 schema 复现；引擎缺陷以实际进程调用复核
- **不在范围**：`deepseek-harness/`（上游 harness 的独立克隆，非本仓库源码）、`node_modules/`

---

## 1. 结论摘要

架构分层清晰、注释质量高、错误处理意识明确（结构化错误、超时强杀、loopback 路由围栏）。但在 **工具输出 schema 一致性** 上存在一类被反复记录却未根治的缺陷，且当前测试套件**结构性地无法发现它**——这是本次审阅最重要的发现。

| 级别 | 数量 | 代表问题 |
|---|---|---|
| 高 | 3 | `chem_props` IUPAC 模式必失败；配方库对 `null` 字段必失败；测试不做输出 schema 校验（根因） |
| 中 | 6 | 引擎退出码/序列化契约、组合爆炸、stdout 污染、PDF 资源泄漏、路径硬编码、参数未校验 |
| 低 | 4 | 死代码重复 `OPS`、docstring 陈旧、文档工具数漂移、路径安全边界 |

---

## 2. 高严重度缺陷（已复现）

### H1. `chem_props` 的 IUPAC 模式 100% 触发 harness 拒绝

- 引擎 `packages/dsh-chem-core/python/chem_engine.py:79-84`：命名失败时写入 `result["iupacName"] = None` 与 `result["iupacError"] = str(exc)`。
- 本机 RDKit **根本没有 `Chem.MolToIUPACName`**：`"module 'rdkit.Chem' has no attribute 'MolToIUPACName'"`。即只要传 `iupac: true` 就必然走失败分支（实测 9/9 分子）。
- 工具 `packages/dsh-tool-chem/lib/index.js:128-137` 把两者原样返回；而其输出 schema（同文件 L88-108）既未声明 `iupacError`，又把 `iupacName` 声明为 `string`。
- 用 harness 验证器实测：

  ```
  "value.iupacName" must be a string
  "value.iupacError" is not a declared property (additionalProperties: false)
  ```

- harness 在 `deepseek-harness/packages/core/tools/src/index.ts:1795-1796` 对每次成功输出执行该校验，违约即抛 `ToolOutputError`。**即 `chem_props(iupac=true)` 每次调用都被拒绝**。
- 该问题已在 `dshchem_自检报告.md`（2026-08-14「异常 1」）中记录，但未进入 `PROJECT-SUMMARY.md` 的 16 项修复清单，至今仍在。

**修复方向**：要么在 schema 中补 `iupacError: {type:"string"}` 并把 `None` 改为省略；要么移除已失效的 IUPAC 功能（推荐：RDKit 无此 API，功能本身就是死的）。

### H2. 配方库对 `null` 字段必失败（含真实历史数据）

- `packages/dsh-chem-core/lib/index.js:310-324` 的 `recipeSave` 在未提供 `smiles`/`project` 时写入 `null`。
- 工具 `chem_recipe_save` 直接返回该记录（`lib/index.js:501-509`），而 schema（L480-493）把 `smiles`/`project` 声明为 `string`；`chem_recipe_list`/`chem_recipe_search`（L523-621）同型。
- 在**真实账本**上复现：`~/.dsh/chem/recipes.json` 共 44 条，其中 **21 条** `project` 为 `null`。

  ```
  "value.recipes[0].project" must be a string   (×3)
  ```

- 这正与自检报告「异常 3」一致：`chem_recipe_list` 对旧条目失败。

**修复方向**：写入端不要存 `null`（缺省即省略），读取端对历史数据做归一化（丢弃 `null` 字段），并在 schema 上保持一致。

### H3. 测试套件不做输出 schema 校验（根因）

- `test/integration.mjs:61-244` 与 `test/benchmark.mjs` 只调用 `tool.execute(...)` 并断言若干业务字段，**从不把返回值对照 `tool.output.schema` 校验**。
- 因此 H1/H2 这类「字段类型/null/未声明键」缺陷对测试完全不可见——这也解释了为什么它们能在自检报告记录后继续存活。
- 现有 12 组「schema 守护断言」是逐条手写的（如 L110-117 的 mw、L236-238 的 `rulePassed`），属点状防护，无法覆盖新增回归。

**修复方向**：在集成测试里对每个工具的返回值统一执行一次 `validateJsonSchemaValue(tool.output.schema, out, "value")`，把「已修复」从人工约定升级为机械保证。

---

## 3. 中严重度问题

### M1. 引擎响应序列化在 try 之外，且未禁 NaN

- `chem_engine.py:1502` 的 `print(json.dumps(response, ...))` 位于 `try`（L1487-1501）之外。若首个参数含不可序列化值（如 numpy 标量），`json.dumps` 抛 `TypeError` → stderr traceback、stdout 无 JSON、非零退出，破坏「一条请求一条 JSON」协议。
- 未设 `allow_nan=False`：QED/logP 等若出现 `NaN` 会输出 `NaN` 字面量，严格 JSON 解析器拒绝。

### M2. 退出码与文档契约矛盾

- 文件头与 L1503-1505 声明「结构化错误是响应、始终 exit 0」；但空请求（L1491）与未知 op（L1498）`return 1`。调用方 `runEngine`（`dsh-chem-core/lib/index.js:131`）会因此走 reject 分支并丢弃已打印的结构化信息。

### M3. `op_enumerate` 组合爆炸

- `chem_engine.py:1014`：`combos = list(itertools.product(...))` 先**完整物化**笛卡尔积，L1015 之后才截断到 `max_products`。多 dummy × 多取代基（如 6×10^6）会直接吃满内存/CPU。
- 建议 `itertools.islice(itertools.product(...), max_products + 1)`，并对各 R 组长度设上限。

### M4. `op_screen` 的 ADMET 模型加载在 stdout 重定向之外

- `chem_engine.py:1381` 的 `model = ADMETModel()` 在 `with contextlib.redirect_stdout(...)`（L1382）之外，模型加载若打印到 stdout 会污染 JSON。对比 `op_admet`（L1083）是正确写法。项目此前已因 admet_ai 进度条污染修过一次（PROJECT-SUMMARY #14），此处是遗留同类点。

### M5. `op_pdftext` 资源泄漏与参数未校验

- `chem_engine.py:355-369`：`fitz.open` 后无 `try/finally`，`doc[index].get_text()` 抛异常时文档句柄不关闭。
- `maxPages`/`maxChars`（L349-350）未做范围校验（负值会得到空结果或异常语义）。

### M6. 路径硬编码与参数未校验

- 硬编码绝对路径：`chem_engine.py:723,728`（AiZynthFinder venv/config，`C:/Users/cloud/Desktop/aizynthfinder_dsh_314/...`）、`L1167`（vina，`C:/Users/cloud/.dsh/...`）；测试侧 `test/integration.mjs:13,91,100`、`test/benchmark.mjs:31,423,458`、`test/p9-verify.mjs:18,29`。换机/换用户即失效。
- `L208` 的 xtb 回退是 `expanduser("~")` 派生（非写死绝对路径），但仍**版本钉死** `xtb-6.7.1` 且 Windows 专用 `.exe`。
- 数值参数未夹取：`op_cluster` 的 `cutoff`（L907，未限制 (0,1]，`1.0-cutoff` 作阈值时越界会导致 Butina 异常）、`op_mcs` timeout（L974）、`op_dock` exhaustiveness（L1171）、`op_calc` `xtbTimeoutMs//1000`（L246）。

---

## 4. 低严重度与安全边界

- **死代码**：`OPS` 字典定义两次（`chem_engine.py:1287` 与 `1463`），前者被覆盖失效；模块 docstring（L7-15）只列 6 个 op，实际 19 个。
- **任意路径读**：`pdftext`（L346）与 `dock`（L1156）接受任意本地路径；**任意路径写**：`screen` 的 `reportPath`（L1442）。这是「模型工具」的设计取舍（用户/模型提供语料与受体），但应在文档中显式标注为受信输入，而非默认安全。
- **子进程**：xtb/vina/aizynth 均以参数数组调用、无 `shell=True`，未见命令注入；可执行路径受 env/配置控制。
- **文档漂移**：
  - `README.md` 顶部「工具清单（11 个）」与实际 **24 个** 不符（路线图内已演进到 16/22/23/24，前后不一致）。
  - `packages/dsh-tool-chem/README.md` 与 `package.json` 的 description 仍写 **4 个工具**。
  - `reports/PROJECT-SUMMARY.md` 写 23 个，实际 24 个。
- **依赖声明**：`packages/dsh-tool-chem/package.json` 无 `dependencies` 字段，`@deepseek-ai/dsh-tools` 依赖工作区 junction 解析（README 已说明为开发期机制）；作为「源码」入库后，建议至少声明为 `peerDependencies` 以免误导。
- **自检报告已过时**：「异常 2」（`chem_papers` 不可用）本次复测**已恢复**（Crossref 正常返回 3 条），其余两条仍存在。

---

## 5. 建议修复顺序

1. `chem_props` IUPAC：删除失效功能或补齐 schema 与 null 处理（H1）
2. 配方库 null 归一化 + schema 对齐（H2）
3. 集成测试加通用 schema 校验闸门（H3）——前两项的回归防护
4. 引擎协议：序列化入 try、`allow_nan=False`、统一 exit 0（M1/M2）
5. `op_enumerate` 惰性截断（M3）；`op_screen` 重定向包裹（M4）
6. `pdftext` try/finally 与参数夹取（M5）；数值参数校验（M6）
7. 路径与文档收敛（第 4 节）

---

## 6. 值得肯定的设计

- **能力分层**：host 服务（引擎/网络/存储/路由）与预设工具行（schema/呈现）分离，模型工具不拥有计算，符合 ChemCrow 式「事实由工具产出」范式。
- **进程隔离**：每请求一进程、超时 SIGKILL、结构化错误经 stdout 回传，避免引擎崩溃拖垮宿主。
- **路由围栏**：`isLoopbackRequest` 同时校验远端地址、Host、`Sec-Fetch-Site` 与 Origin，`/api/dsh-chem/*` 不暴露到 LAN。
- **注释质量**：关键时序陷阱（webServer/slots 注入时机）、历史根因、3Dmol 本地化原因均有就地说明，可维护性好。
