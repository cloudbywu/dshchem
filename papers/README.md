# papers/ — 本地文献语料

本目录存放供 `tools/paperqa_ask.py` 与 `chem_pdf` 使用的**本地 PDF 语料**（例如靶向蛋白降解 / 分子胶方向的期刊论文）。

- 论文 PDF 属出版商版权内容，**不纳入版本库**（见根目录 `.gitignore` 的 `papers/*`）。
- 因此克隆本仓库后本目录为空，请自行放入 PDF 后运行，例如：

  ```powershell
  python tools/paperqa_ask.py "你的问题" --papers-dir papers --json
  ```

- `test/fixtures/sharpless-epoxidation.pdf` 是 MuPDF 合成的 1.3 KB 测试夹具，与这里的文献语料无关，仍受版本控制。

历史运行与核验记录见 `reports/paperqa-qa-run-report.md`。
