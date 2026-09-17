# PaperQA 语料问答运行与核验报告

- **日期**：2026-08-14
- **工具**：`tools/paperqa_ask.py`（light 模式：pymupdf 文本提取 + BM25 式评分检索 + litellm 合成）
- **模型**：`deepseek/deepseek-chat`（temperature 0.2，LLM 调用超时 90 s）
- **语料**：`papers/`（3 篇 PDF，均为靶向蛋白降解/分子胶方向）
- **输出格式**：`--json`（`answer` + `citations[{n, docname, page, text}]` + `status`）
- **总体结论**：`status: ok`；答案两部分均有语料支撑；模型关键数字经 PDF 原文核验基本正确，但发现 **1 处引用页码归属错误**（[4] 应为 p6，模型标注 p10）。

---

## 1. 执行情况

### 1.1 命令

```powershell
python tools/paperqa_ask.py "What are the advantages of Direct-to-Biology workflows in
molecular glue discovery, and how does reversible covalent chemistry enhance intracellular
accumulation and target engagement of PROTACs?" --papers-dir papers --json
```

- 命令模板中的「你的问题」为占位符，按语料主题选定上述英文问题（英文提问方可命中 BM25 检索；PDF 文本为英文）。
- API key 从 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY` 读取注入环境（不落盘、不回显）。

### 1.2 环境问题与解决

| 现象 | 根因 | 解决 |
|---|---|---|
| 首次运行抛 `litellm.InternalServerError: DeepseekException - [WinError 10061] 连接被拒绝`（httpx 堆栈含 `http_proxy.py`） | 环境变量 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY = http://127.0.0.1:7897` 指向**未监听的本地代理** | 运行前移除三个代理环境变量；验证直连 `api.deepseek.com` 返回 401（网络通、缺鉴权），重跑成功（exit 0） |
| LiteLLM 警告无法拉取远程模型价格表 | 网络受限（raw.githubusercontent.com 不可达） | 自动回退本地备份，不影响结果 |

---

## 2. 答案（模型输出，[n] 为引用编号）

### 2.1 Direct-to-Biology 工作流在分子胶发现中的优势

- Direct-to-Biology 策略可**绕过小分子纯化**，直接在体外筛选邻近效应（proximity）[6]。
- 依托**高通量化学合成**的最新进展，降低化学类似物合成的机会成本，已成功应用于 PROTAC、共价配体与非共价配体的开发 [6]。
- 通过区分**三元复合物与二元复合物的亲和力差异**，可功能性将分子胶与非分子胶分类，从而从超过 20,000 种粗化学反应混合物中筛选出分子胶 [7]。
- ⚠️ 模型自述局限：语料**未量化** Direct-to-Biology 相比传统方法的速度、成本或通量优势，无法进一步补充。

### 2.2 可逆共价化学如何增强 PROTAC 的细胞内积累与靶点结合

- 不可逆共价 PROTAC 结合靶蛋白后即被消耗，无法以亚化学计量/催化方式诱导蛋白降解；可逆共价设计可规避该「一次性消耗」缺点 [1]。
- 氰基丙烯酰胺（cyano-acrylamide）可逆共价部分能显著增强 PROTAC 的**细胞内积累与靶点结合（target engagement, TE）**[1][2][4]。
- **BTK 靶点**：RC-1 的 TE IC₅₀ = 0.043 µM，显著低于不可逆共价 IRC-1（0.13 µM）与可逆非共价 RNC-1（1.27 µM）[5]。
- **FLT3 靶点**：RC-FLT3 的 TE IC₅₀ 比 IRC-FLT3 和 RNC-FLT3 分别低 **5 倍和 34 倍**[4]。
- RC-1 能以相似效力**同时降解野生型 BTK 与 C481S 突变体**；对照文献中的可逆共价 PROTAC 仅能降解野生型 [3]。

---

## 3. 引用清单（[n] → 文件名 + 页码）

| [n] | 文件名 | 页码 | 内容要点 |
|---|---|---|---|
| [1] | Enhancing Intracellular Accumulation and Target Engagement of PROTACs with Reversible Covalent Chemistry.pdf | 2 | 不可逆共价 PROTAC 被消耗、无法催化式降解的假说 |
| [2] | 同上 | 1 | 论文标题页（可逆共价化学增强积累与靶点结合） |
| [3] | 同上 | 12 | RC-1 同时降解 WT/C481S，与他组结论的差异讨论 |
| [4] | 同上 | 10 ⚠️ | 模型引为 FLT3 数据出处，实际 FLT3 数据在 p6（见 §4） |
| [5] | 同上 | 6 | BTK TE IC₅₀（0.043/0.13/1.27 µM）及 NanoBRET 方法 |
| [6] | Direct-to-Biology Enabled Molecular Glue Discovery.pdf | 1 | D2B 策略：绕纯化、直接筛邻近、高通量合成 |
| [7] | 同上 | 1 | 三元/二元亲和力差异分类、>20,000 粗混合物筛胶（摘要） |
| [8] | Enhancing Intracellular Accumulation…pdf | 2 | PROTAC 背景定义（答案正文未引用） |

> 语料中第三篇 PDF（czestkowski-et-al-2024，基于结构的配体发现）未被检索命中，未出现在引用中。

---

## 4. 关键论断逐条核验（对照 PDF 原文）

核验方法：用 pymupdf 按页提取原文文本核对；图 3 中数值用**带坐标的 `get_text("words")` 重建图例布局**（当前模型不支持读图），逐行确定化合物-数值对应。

| 模型论断 | 核验结果 |
|---|---|
| BTK TE IC₅₀：RC-1 0.043 / IRC-1 0.13 / RNC-1 1.27 µM | ✅ p6 图 3c 原文数值一致 |
| FLT3 靶点结合低 5× 与 34× | ✅ 数值正确：p6 图 3 图例坐标重建为 Pomalidomide 0.3 / **RC-FLT3 0.3** / IRC-FLT3 1.5 / RNC-FLT3 10.1 µM → 1.5/0.3=5×，10.1/0.3≈34×。**但页码归属错误**：模型标 [4]→p10，而 p10 原文为 BTK 语境「DD-03-171 和 MT-802 的 TE IC₅₀ 是 RC-1 的 5×/11×」；FLT3 数据实际在 **p6**（图 3） |
| RC-1 同时降解 WT 与 C481S、效力相似；他组 RC 仅降解 WT | ✅ p12 原文逐字一致（"RC-1 degrades both wild-type BTK and the C481S mutant with similar potency"） |
| 不可逆共价 PROTAC 结合后即被消耗 | ✅ p2 原文（"consumed once they bind to their targeted protein"，原文标注为 postulated） |
| 氰基丙烯酰胺增强细胞内积累（RC-1 为 IRC-1/RNC-1 的 10×/16×） | ✅ p6 正文 + p12 结论一致 |
| D2B 绕纯化、直接体外筛邻近、高通量合成降低机会成本、用于 PROTAC/共价/非共价配体 | ✅ p1 原文逐句一致 |
| 三元/二元亲和力差异区分胶与非胶；>20,000 粗混合物筛胶 | ✅ p1 摘要一致 |

**结论**：8 处论断中 7 处完全正确；1 处（FLT3 5×/34×）数值正确但**页码引用错误**（应 p6，非 p10）——内容可用，溯源需修正。

---

## 5. 语料充分性结论

- **足以回答**：问题的两个部分均有直接文献支撑（引用全部来自 2 篇相关论文）；关键数字经原文核验基本正确。
- **不足以回答的部分（明确说明）**：
  1. Direct-to-Biology 相比传统方法的**量化**优势（速度、成本、通量对比数据）语料未提供，模型已自行声明无法补充；
  2. 第三篇语料（czestkowski 2024，结构基配体发现）与本题无关，未命中、未引用；
  3. 引用页码错误 1 处（[4]），已在上表修正——提示模型引用页码需人工复核。

---

## 6. 附注

- light 模式检索为 BM25 式关键词评分（非语义检索），`--top-n 8`；引用文本为命中段落前 300 字符。
- 原始 JSON 输出含 8 条 citation 记录（n/docname/page/text），本次核验以 PDF 原文为最终依据。
