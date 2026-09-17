/**
 * P9 聚焦验证：对接 pose 坐标 + 复合物可视化数据链路（第九节验收）
 * 与 benchmark.mjs 的 poseOut 断言同源，另加：
 *  - bestPoseXyz 帧结构校验（行数 = 原子数 + 2）
 *  - 最佳 pose 质心到盒子中心 [15.19, 53.903, 16.917] 的距离（口袋定位代理指标）
 */
import { apply as applyCore } from "../packages/dsh-chem-core/lib/index.js";
import { apply as applyTools } from "../packages/dsh-tool-chem/lib/index.js";

const services = {};
applyCore(
	{
		get: () => undefined,
		webServer: { register: () => () => {} },
		provide(name, value) { services[name] = value; return () => {}; },
		effect(fn) { fn(); return () => {}; }
	},
	{ xtbPath: process.env.XTB_COMMAND ?? "C:/Users/cloud/.dsh/chem/bin/xtb-6.7.1/bin/xtb.exe" }
);
const chem = services.chem;
if (chem === undefined) throw new Error("chem service not provided");
applyTools({
	tools: { register() { return () => {}; } },
	chem,
	effect(fn) { fn(); return () => {}; }
});

const LIGAND = "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1";
const RECEPTOR = "C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb";
const CENTER = [15.19, 53.903, 16.917];

let passed = 0, failed = 0;
const check = (name, ok, detail) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
	ok ? passed++ : failed++;
};

const dock = await chem.dock(LIGAND, RECEPTOR, { center: CENTER, boxSize: [20, 20, 20], exhaustiveness: 4, poseOut: true });
check("dock ok", dock.ok === true, JSON.stringify(dock).slice(0, 300));

if (dock.ok === true) {
	const { poses, bestAffinity_kcal_mol, bestPoseXyz } = dock.result;
	check("9 poses returned", Array.isArray(poses) && poses.length === 9, `n=${poses?.length}`);
	check("best affinity < -10 kcal/mol", bestAffinity_kcal_mol < -10, `${bestAffinity_kcal_mol}`);
	check("poses sorted ascending", poses.every((p, i, a) => i === 0 || a[i - 1].affinity_kcal_mol <= p.affinity_kcal_mol), JSON.stringify(poses.map(p => p.affinity_kcal_mol)));
	check("bestPoseXyz is a string", typeof bestPoseXyz === "string", typeof bestPoseXyz);
	if (typeof bestPoseXyz === "string") {
		const lines = bestPoseXyz.trim().split("\n");
		const nAtoms = Number(lines[0]);
		check("XYZ frame well-formed (n = atoms + 2)", Number.isInteger(nAtoms) && nAtoms === lines.length - 2 && nAtoms > 1, `header=${lines[0]} lines=${lines.length}`);
		// parse coordinates (skipping the title line)
		const coords = lines.slice(2).map(l => l.trim().split(/\s+/).map(Number).slice(1, 4));
		const nOk = coords.filter(c => c.length === 3 && c.every(v => Number.isFinite(v))).length;
		check("all XYZ rows parse as element + 3 coords", nOk === nAtoms, `${nOk}/${nAtoms}`);
		const cx = coords.reduce((s, c) => s + c[0], 0) / nAtoms;
		const cy = coords.reduce((s, c) => s + c[1], 0) / nAtoms;
		const cz = coords.reduce((s, c) => s + c[2], 0) / nAtoms;
		const d = Math.hypot(cx - CENTER[0], cy - CENTER[1], cz - CENTER[2]);
		console.log(`  best-pose centroid = (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)})  distance to box center = ${d.toFixed(2)} A`);
		check("centroid within 8 A of box center (pocket region)", d <= 8, `${d.toFixed(2)} A`);
	}
}

console.log(`\nP9 VERIFY RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
