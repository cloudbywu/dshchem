/**
 * Integration test: chem-core service (real Python/RDKit bridge) + dsh-tool-chem
 * tools (real defineTool registration + execute) end to end, outside the
 * harness runtime. Requires the workspace node_modules junction so
 * `@deepseek-ai/dsh-tools` resolves:
 *   node test/integration.mjs
 */
import { apply as applyCore } from "../packages/dsh-chem-core/lib/index.js";
import { apply as applyTools } from "../packages/dsh-tool-chem/lib/index.js";

// Optional xtb binary for the calc method=xtb path (P4-1).
const XTB_PATH =
	process.env.XTB_COMMAND ?? "C:/Users/cloud/.dsh/chem/bin/xtb-6.7.1/bin/xtb.exe";

const services = {};
const coreCtx = {
	get: () => undefined,
	webServer: {
		register: () => () => {}
	},
	provide(name, value) {
		services[name] = value;
		return () => {};
	},
	effect(fn) {
		fn();
		return () => {};
	}
};
applyCore(coreCtx, { xtbPath: XTB_PATH });
const chem = services.chem;
if (chem === undefined) throw new Error("chem service not provided by chem-core");

const ASPIRIN = "CC(=O)Oc1ccccc1C(=O)O";

// 1) engine ops through the service
const validate = await chem.validate(ASPIRIN);
console.log("validate:", JSON.stringify(validate));
const props = await chem.props(ASPIRIN);
console.log("props:", JSON.stringify(props));
const convert = await chem.convert(ASPIRIN, "inchi");
console.log("convert:", JSON.stringify(convert));
const bad = await chem.validate("not-a-molecule");
console.log("invalid:", JSON.stringify(bad));

// 2) tool registration via the real defineTool
const registered = [];
const toolCtx = {
	tools: {
		register(tool) {
			registered.push(tool);
			return () => {};
		}
	},
	chem,
	effect(fn) {
		fn();
		return () => {};
	}
};
applyTools(toolCtx);
const names = registered.map((t) => t.name);
console.log("registered tools:", names.join(", "));

// 3) execute every tool against the real engine
const cases = {
	chem_validate: { smiles: ASPIRIN },
	chem_props: { smiles: ASPIRIN, iupac: true },
	chem_convert: { smiles: ASPIRIN, format: "svg" },
	chem_pubchem: { query: "aspirin" },
	chem_calc: { smiles: ASPIRIN, method: "emt", optimize: true },
	chem_reaction: { mode: "balance", reaction: "CCO.O>>CCO" },
	chem_recipe_save: { title: "aspirin crosscheck", content: "logP 1.31 (RDKit) vs 1.2 (PubChem XLogP3) — consistent", tags: ["logp", "crosscheck"], smiles: ASPIRIN, project: "validation" },
	chem_recipe_search: { query: "logp" },
	chem_recipe_list: { limit: 5 },
	chem_papers: { query: "aspirin anti-inflammatory mechanism", limit: 3 },
	chem_pdf: { path: "does-not-exist.pdf" },
	chem_retro_step: { smiles: ASPIRIN },
	chem_functional_groups: { smiles: ASPIRIN },
	chem_retro_plan: { smiles: "COc1ccc(NC(C)=O)cc1" },
	chem_reagents: { template: "biaryl_C-C" },
	chem_aizynth: { smiles: ASPIRIN, timeoutSeconds: 60, maxRoutes: 3 },
	chem_druglikeness: { smiles: ASPIRIN },
	chem_similarity: { smiles: ASPIRIN, targets: ["O=C(O)c1ccccc1O", "c1ccccc1", "CCO"] },
	chem_cluster: { smiles: ["CC(=O)Oc1ccccc1C(=O)O", "O=C(O)c1ccccc1O", "CCO"], cutoff: 0.4 },
	chem_mcs: { smilesA: ASPIRIN, smilesB: "O=C(O)c1ccccc1O" },
	chem_enumerate: { scaffold: "[*:1]c1ccccc1[*:2]", rgroups: { "1": ["C", "N"], "2": ["C", "Cl"] } },
	chem_admet: { smiles: ASPIRIN },
	chem_dock: {
		smiles: "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
		receptor: "C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb",
		center: [15.19, 53.903, 16.917],
		boxSize: [20, 20, 20],
		exhaustiveness: 4
	},
	chem_screen: {
		scaffold: "[*:1]c1ccccc1[*:2]",
		rgroups: { "1": ["C", "N", "O"], "2": ["C", "CC", "Cl"] },
		reference: "CC(=O)Oc1ccccc1C(=O)O",
		reportPath: "C:/Users/cloud/Desktop/dshchem/test/screen-report.md"
	}
};
for (const tool of registered) {
	if (tool.name === "chem_pdf") continue; // negative-path tool; exercised via engine test below
	const out = await tool.execute(cases[tool.name]);
	const text = JSON.stringify(out);
	console.log(`${tool.name} => ${text.length > 260 ? text.slice(0, 260) + "…" : text}`);
	// Schema-conformance guard: the harness rejects a non-number mw. Regression
	// guard for the PubChem string-MolecularWeight bug fixed on 2026-08-14.
	if (tool.name === "chem_pubchem" && out.cid !== undefined) {
		if (typeof out.mw !== "number" || !Number.isFinite(out.mw)) {
			throw new Error(
				`chem_pubchem regression: mw must be a finite number, got ${JSON.stringify(out.mw)}`
			);
		}
		console.log("  (schema guard: mw is a finite number ✓)");
	}
	if (tool.name === "chem_calc" && out.error === undefined) {
		if (typeof out.energyAfter_eV !== "number" || !Number.isFinite(out.energyAfter_eV)) {
			throw new Error(`chem_calc regression: energyAfter_eV must be a number, got ${JSON.stringify(out.energyAfter_eV)}`);
		}
		console.log("  (calc guard: energy is a finite number ✓)");
	}
	if (tool.name === "chem_reaction" && out.balanced !== undefined) {
		if (out.balanced !== false || out.imbalance?.O !== 1) {
			throw new Error(`chem_reaction regression: CCO.O>>CCO must be unbalanced by 1 O, got ${text}`);
		}
		console.log("  (balance guard: O deficit detected ✓)");
	}
	if (tool.name === "chem_recipe_save") {
		if (typeof out.id !== "string" || out.id === "") {
			throw new Error(`chem_recipe_save regression: no id returned, got ${text}`);
		}
		console.log("  (recipe guard: stored with id ✓)");
	}
	if (tool.name === "chem_retro_step") {
		const first = out.steps?.[0];
		if (out.count < 1 || first?.atomConserved !== true || !first.precursors.includes("CC(=O)O")) {
			throw new Error(`chem_retro_step regression: aspirin must give conserved acetic acid, got ${text}`);
		}
		console.log("  (retro guard: aspirin -> acetic acid + salicylic acid, conserved ✓)");
	}
	if (tool.name === "chem_functional_groups") {
		const names = (out.groups ?? []).map((g) => g.name);
		if (!names.includes("ester") || !names.includes("carboxylic_acid")) {
			throw new Error(`chem_functional_groups regression: aspirin must show ester+acid, got ${text}`);
		}
		console.log("  (fg guard: ester + carboxylic_acid detected ✓)");
	}
	if (tool.name === "chem_retro_plan") {
		if (!Array.isArray(out.plans) || out.plans.length === 0) {
			throw new Error(`chem_retro_plan regression: no routes for anisole-acetanilide, got ${text}`);
		}
		console.log("  (plan guard: at least one route found ✓)");
	}
	if (tool.name === "chem_reagents") {
		if (typeof out.conditions !== "string" || out.conditions === "") {
			throw new Error(`chem_reagents regression: no conditions for biaryl_C-C, got ${text}`);
		}
		console.log("  (reagents guard: conditions returned ✓)");
	}
	if (tool.name === "chem_aizynth") {
		const tree = out.routes?.[0]?.reactionTree;
		if (typeof out.numRoutes !== "number" || out.numRoutes < 1 || typeof tree?.smiles !== "string") {
			throw new Error(`chem_aizynth regression: aspirin must yield routes with trees, got ${text.slice(0, 300)}`);
		}
		// every reaction node must be valid after the mapped_reaction_smiles fix
		let reactions = 0;
		let valid = 0;
		const walk = (node) => {
			if (node.type === "reaction") {
				reactions += 1;
				if (node.smilesValid === true) valid += 1;
			}
			for (const child of node.children ?? []) walk(child);
		};
		walk(tree);
		if (reactions < 1 || valid !== reactions) {
			throw new Error(`chem_aizynth regression: invalid reaction SMILES in tree (${valid}/${reactions} valid), got ${text.slice(0, 300)}`);
		}
		console.log("  (aizynth guard: route + valid reaction trees ✓)");
	}
	if (tool.name === "chem_druglikeness") {
		if (out.verdict !== "drug-like" || out.lipinski.passes !== true || typeof out.qed !== "number") {
			throw new Error(`chem_druglikeness regression: aspirin should be drug-like with QED, got ${text.slice(0, 300)}`);
		}
		console.log("  (druglikeness guard: aspirin drug-like, QED present ✓)");
	}
	if (tool.name === "chem_similarity") {
		const top = out.results?.[0];
		if (top?.tanimoto !== 0.4483 || top.target !== "O=C(O)c1ccccc1O") {
			throw new Error(`chem_similarity regression: salicylic acid should be top hit at 0.4483, got ${text.slice(0, 300)}`);
		}
		console.log("  (similarity guard: salicylic acid top hit ✓)");
	}
	if (tool.name === "chem_cluster") {
		const pair = out.clusters?.find((c) => c.size > 1);
		if (out.numClusters < 1 || pair === undefined || !pair.members.includes("O=C(O)c1ccccc1O")) {
			throw new Error(`chem_cluster regression: aspirin+salicylic should cluster, got ${text.slice(0, 300)}`);
		}
		console.log("  (cluster guard: aspirin+salicylic cluster ✓)");
	}
	if (tool.name === "chem_mcs") {
		if (out.numAtoms < 5 || typeof out.smarts !== "string") {
			throw new Error(`chem_mcs regression: aspirin vs salicylic should share a big MCS, got ${text.slice(0, 300)}`);
		}
		console.log("  (mcs guard: MCS found ✓)");
	}
	if (tool.name === "chem_enumerate") {
		if (out.combinations !== 4 || out.generated !== 4 || out.failed !== 0) {
			throw new Error(`chem_enumerate regression: 2x2 should give 4 products, got ${text.slice(0, 300)}`);
		}
		console.log("  (enumerate guard: 2x2 = 4 products ✓)");
	}
	if (tool.name === "chem_admet") {
		const eps = out.endpoints ?? {};
		if (typeof out.count !== "number" || out.count < 20 || typeof eps.AMES !== "number" || typeof eps.molecular_weight !== "number") {
			throw new Error(`chem_admet regression: aspirin should give full endpoint set, got ${text.slice(0, 300)}`);
		}
		console.log(`  (admet guard: ${out.count} endpoints, AMES=${eps.AMES} ✓)`);
	}
	if (tool.name === "chem_dock") {
		if (typeof out.bestAffinity_kcal_mol !== "number" || !Number.isFinite(out.bestAffinity_kcal_mol) || out.numPoses < 3) {
			throw new Error(`chem_dock regression: docking should yield poses with scores, got ${text.slice(0, 300)}`);
		}
		console.log(`  (dock guard: ${out.numPoses} poses, best ${out.bestAffinity_kcal_mol} kcal/mol ✓)`);
	}
	if (tool.name === "chem_screen") {
		if (typeof out.combinations !== "number" || out.combinations < 1 || !Array.isArray(out.hits) || out.hits.length === 0) {
			throw new Error(`chem_screen regression: expected hits from 3x3 library, got ${text.slice(0, 300)}`);
		}
		// Schema-conformance guard: the harness rejects undeclared top-level
		// keys (additionalProperties: false). Regression guard for the stray
		// "rulePassed" field removed 2026-08-15 — the engine and the tool
		// schema must stay in lockstep.
		if ("rulePassed" in out) {
			throw new Error(`chem_screen regression: undeclared key "rulePassed" in output (harness rejects it), got ${text.slice(0, 300)}`);
		}
		if (out.hits[0].tanimoto !== undefined && !out.hits.every((h, i, arr) => i === 0 || (arr[i - 1].tanimoto ?? -1) >= (h.tanimoto ?? -1))) {
			throw new Error(`chem_screen regression: hits not sorted by tanimoto, got ${text.slice(0, 300)}`);
		}
		console.log(`  (screen guard: ${out.combinations} combos -> ${out.hits.length} hits, ranked, schema-clean ✓)`);
	}
}

// 5) engine negative path: pdf on a missing file must be a structured error
const pdfMissing = await chem.pdfText("does-not-exist.pdf");
console.log("pdf missing:", JSON.stringify(pdfMissing));
if (pdfMissing.ok !== false || !pdfMissing.error.includes("not found")) {
	throw new Error(`chem pdfText regression: missing file should be a structured error, got ${JSON.stringify(pdfMissing)}`);
}
console.log("  (pdf guard: structured error ✓)");

// 4) PubChem name miss -> suggestions
const miss = await chem.pubchemLookup("zzz-no-such-compound-xyz");
console.log("pubchem miss:", JSON.stringify(miss));
const suggest = await chem.pubchemSuggest("asp");
console.log("suggestions:", JSON.stringify(suggest).slice(0, 300));

// 5) xtb path (P4-1): direct service call with the configured binary
const xtbOut = await chem.calc("CCO", { method: "xtb", optimize: true });
console.log("chem_calc xtb =>", JSON.stringify(xtbOut).slice(0, 260));
if (xtbOut.ok !== true || typeof xtbOut.result.energyAfter_eV !== "number" || !Number.isFinite(xtbOut.result.energyAfter_eV)) {
	throw new Error(`chem_calc xtb regression: got ${JSON.stringify(xtbOut)}`);
}
console.log("  (xtb guard: GFN2-xTB energy is a finite number ✓)");

// 6) xyz 3D coordinates (P7): engine convert format=xyz must be usable
const xyzOut = await chem.convert("CCO", "xyz");
console.log("chem_convert xyz =>", JSON.stringify(xyzOut).slice(0, 160));
if (xyzOut.ok !== true || typeof xyzOut.result.content !== "string") {
	throw new Error(`chem_convert xyz regression: got ${JSON.stringify(xyzOut)}`);
}
const xyzLines = xyzOut.result.content.trim().split("\n");
const xyzHeader = Number(xyzLines[0]);
if (xyzHeader !== xyzLines.length - 2 || xyzHeader < 1) {
	throw new Error(`chem_convert xyz regression: bad XYZ frame (header ${xyzHeader}, lines ${xyzLines.length})`);
}
console.log(`  (xyz guard: ${xyzHeader}-atom XYZ frame ✓)`);
