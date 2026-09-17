# P9 阶段验收记录（第九节 · 对接深化 + 复合物可视化）

> 日期：本次会话 | 方式：工具层实测 + 代码接线核查 + 数据链路脚本（GUI 人工观察项单独标注）
> 受体：`C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb`（CDK2，1iep）
> 配体：`Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1`
> 盒子中心 [15.19, 53.903, 16.917] × [20,20,20] Å，exhaustiveness 4

## 检查表

| 项 | 预期 | 结果 |
|---|---|---|
| 1 pose 坐标 | 9 poses 排序、最佳 < -10 kcal/mol | ✅ 9 poses 升序；最佳 **-11.93 kcal/mol**（-11.96 @ poseOut 重跑）；mode 1 RMSD 0 |
| 2 复合物可视化 | 卡片内受体(cartoon+半透明表面)+配体(橙色 stick) 3D；「对接计算中…」 | ⚠️ 数据链路全通，**浏览器渲染需人工目检**（见下） |
| 3 结合模式目检 | 配体位于 CDK2 口袋内 | ✅ 定量代理：最佳 pose 质心 (15.43, 53.65, 15.10)，距盒心 **1.85 Å**（<8 Å 阈值）；目检仍需人工 |
| 4 边界 | 不存在受体路径结构化报错；计算失败卡片显示「复合物不可用」不崩溃 | ✅ 两处结构化错误实测通过；客户端错误兜底接线确认 |

## 实测数据（chem_dock，exhaustiveness 4）

| mode | 亲和力 (kcal/mol) | RMSD (lower/upper) |
|---|---|---|
| 1 | **-11.93** | 0 / 0 |
| 2 | -8.71 | 3.01 / 12.21 |
| 3 | -8.48 | 2.17 / 12.15 |
| 4 | -7.82 | 1.52 / 2.33 |
| 5 | -6.83 | 2.03 / 3.71 |
| 6 | -4.39 | 3.38 / 5.08 |
| 7 | -4.08 | 3.5 / 12.05 |
| 8 | -2.91 | 3.5 / 5.47 |
| 9 | -0.81 | 2.18 / 3.57 |

注：vina 1.2 半经验打分，非结合自由能。

## 数据链路核查（第 2 项）

- `packages/dsh-chem-core/client.js`：「对接查看（受体+配体）」按钮（loading 文案「对接计算中…」）；失败兜底 `复合物不可用: {error}`；容器 `position:relative`（P7 定位修复在案）。
- `packages/dsh-chem-core/lib/index.js` `/api/dsh-chem/complex` 路由：loopback-only（403）；参数校验（400）；受体 PDB 直读（>10 MB 拒绝）；调 dock+poseOut 返回 `receptorPdb + poseXyz + bestAffinity`。
- `test/p9-verify.mjs`（本次新增，引擎同源路径）：8/8 PASS —— poseOut 返回良构 XYZ 帧（37 原子 + 2 行）、坐标行全可解析、质心-盒心距 1.85 Å。

## 边界实测

- 受体不存在：`chem_dock failed: receptor PDB file not found: 'C:/no/such/file.pdb'`（结构化）✅
- 非法 SMILES：`chem_dock failed: invalid SMILES: 'zzz'`（结构化）✅

## 结论与遗留

P9 工具层/路由层/客户端接线全部符合预期。唯一待人工项：**在 GUI 中点击 chem_dock 卡片「对接查看」按钮，目检 3Dmol.js 复合物渲染**（受体 cartoon+表面、配体橙色 stick、可旋转缩放、卡片内不逃逸），以及配体在口袋内的最终目检 —— 按文件注记，GUI 渲染只能靠重启 + 人工观察。
