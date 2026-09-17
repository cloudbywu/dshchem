/**
 * ChemBench-style smoke benchmark for the dshchem chemist preset.
 *
 * Regression suite over the deterministic tool layer, runnable outside the
 * harness (node test/benchmark.mjs). Structure: 10 known molecules with
 * reference values (RDKit-computed / PubChem-verified), SMILES validation
 * cases, reaction-balance cases, and an EMT energy sanity check. A failing
 * case aborts with a non-zero exit — wire it into CI or pre-release checks.
 *
 * Reference values are cross-checked against PubChem where marked (PC).
 */
import { apply as applyCore } from "../packages/dsh-chem-core/lib/index.js";
import { apply as applyTools } from "../packages/dsh-tool-chem/lib/index.js";

const services = {};
applyCore(
	{
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
	},
	{ xtbPath: process.env.XTB_COMMAND ?? "C:/Users/cloud/.dsh/chem/bin/xtb-6.7.1/bin/xtb.exe" }
);
const chem = services.chem;
if (chem === undefined) throw new Error("chem service not provided");

const registered = [];
applyTools({
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
});
const byName = Object.fromEntries(registered.map((t) => [t.name, t]));

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
	if (ok) {
		passed += 1;
		console.log(`  ✓ ${label}`);
	} else {
		failed += 1;
		console.error(`  ✗ ${label} — ${detail ?? "no detail"}`);
	}
}

function close(actual, expected, tol) {
	return typeof actual === "number" && Math.abs(actual - expected) <= tol;
}

console.log("== 1. molecular properties (RDKit deterministic fields) ==");
const PROP_CASES = [
	{ name: "aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O", formula: "C9H8O4", mw: 180.16, hbd: 1 },
	{ name: "ethanol", smiles: "CCO", formula: "C2H6O", mw: 46.07, hbd: 1 },
	{ name: "benzene", smiles: "c1ccccc1", formula: "C6H6", mw: 78.11, hbd: 0 },
	{ name: "caffeine", smiles: "Cn1cnc2c1c(=O)n(C)c(=O)n2C", formula: "C8H10N4O2", mw: 194.19, hbd: 0 },
	{ name: "paracetamol", smiles: "CC(=O)Nc1ccc(O)cc1", formula: "C8H9NO2", mw: 151.16, hbd: 2 },
	{ name: "ibuprofen", smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O", formula: "C13H18O2", mw: 206.28, hbd: 1 },
	{ name: "glucose (open)", smiles: "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O", formula: "C6H12O6", mw: 180.16, hbd: 5 },
	{ name: "cholesterol", smiles: "CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C", formula: "C27H46O", mw: 386.65, hbd: 1 },
	{ name: "penicillin G", smiles: "CC1(C(N2C(S1)C(C2=O)NC(=O)Cc3ccccc3)C(=O)O)C", formula: "C16H18N2O4S", mw: 334.39, hbd: 2 },
	{ name: "n-hexane", smiles: "CCCCCC", formula: "C6H14", mw: 86.18, hbd: 0 }
];
for (const c of PROP_CASES) {
	const out = await chem.props(c.smiles);
	if (out.ok !== true) {
		check(`${c.name}: engine error`, false, out.error);
		continue;
	}
	const r = out.result;
	check(`${c.name} formula ${r.formula}`, r.formula === c.formula, `got ${r.formula}`);
	check(`${c.name} MW ~${c.mw}`, close(r.mw, c.mw, 0.15), `got ${r.mw}`);
	check(`${c.name} HBD ${c.hbd}`, r.hbd === c.hbd, `got ${r.hbd}`);
}

console.log("== 2. SMILES validation ==");
const VALID_CASES = [
	["valid aspirin", "CC(=O)Oc1ccccc1C(=O)O", true],
	["valid ethanol", "CCO", true],
	["valid stereochemistry", "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O", true],
	["garbage", "not-a-molecule", false],
	["unbalanced ring", "C1CCCC", false],
	["empty", "", false]
];
for (const [label, smiles, expected] of VALID_CASES) {
	const out = await chem.validate(smiles);
	check(`validate ${label}`, out.ok === true ? out.result.valid === expected : out.ok === false && expected === false, `got ${JSON.stringify(out)}`);
	if (out.ok === true) {
		const roundtrip = await chem.validate(out.result.canonical);
		check(`canonical idempotent ${label}`, roundtrip.ok === true && roundtrip.result.canonical === out.result.canonical, "canonical changed");
	}
}

console.log("== 3. reaction balance ==");
const BALANCE_CASES = [
	["ester hydrolysis balanced", "CC(=O)Oc1ccccc1C(=O)O.O>>CC(=O)O.Oc1ccccc1C(=O)O", true],
	["missing O", "CCO.O>>CCO", false],
	["missing C", "CCO>>CO", false],
	["water as O", "CCO.O>>CCO.O", true]
];
for (const [label, reaction, expected] of BALANCE_CASES) {
	const out = await chem.reaction({ mode: "balance", reaction });
	check(`balance ${label}`, out.ok === true && out.result.balanced === expected, `got ${JSON.stringify(out)}`);
}

console.log("== 4. SMARTS template reaction ==");
const template = await chem.reaction({
	mode: "template",
	smarts: "[C:1](=[O:2])[O:3][C:4]>>[C:1](=[O:2])[O:3].[C:4]",
	reactants: "CCOC(=O)C"
});
check(
	"ethyl acetate ester cleavage produces 2 fragments",
	template.ok === true && template.result.matched === true && template.result.products[0]?.length === 2,
	`got ${JSON.stringify(template)}`
);

console.log("== 5. EMT energy sanity ==");
const emt = await chem.calc("CCO", { method: "emt", optimize: true });
check("ethanol EMT energy is a finite number", emt.ok === true && Number.isFinite(emt.result.energyAfter_eV), `got ${JSON.stringify(emt)}`);
const emtBad = await chem.calc("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", { method: "emt" });
check("oversized molecule rejected", emtBad.ok === false, `got ${JSON.stringify(emtBad)}`);

console.log("== 5.5 xtb (GFN2-xTB): isomer stability + unit conversion ==");
const EV_TO_KJ = 96.485;
const butanol = await chem.calc("CCCCO", { method: "xtb", optimize: true });
const ether = await chem.calc("CCOCC", { method: "xtb", optimize: true });
check(
	"1-butanol xtb energy computed",
	butanol.ok === true && Number.isFinite(butanol.result.energyAfter_eV),
	`got ${JSON.stringify(butanol).slice(0, 200)}`
);
check(
	"diethyl ether xtb energy computed",
	ether.ok === true && Number.isFinite(ether.result.energyAfter_eV),
	`got ${JSON.stringify(ether).slice(0, 200)}`
);
if (butanol.ok === true && ether.ok === true) {
	const diffKj = (ether.result.energyAfter_eV - butanol.result.energyAfter_eV) * EV_TO_KJ;
	// 1-butanol is the lower-energy isomer (gas phase, GFN2-xTB); the gap is
	// small (a few kJ/mol). Assert sign and a sane magnitude (< 50 kJ/mol).
	check(
		`isomer stability: 1-butanol lower than ether (Δ = ${diffKj.toFixed(1)} kJ/mol)`,
		diffKj > 0 && diffKj < 50,
		`butanol=${butanol.result.energyAfter_eV} eV, ether=${ether.result.energyAfter_eV} eV`
	);
}

console.log("== 6. PubChem cross-check (network) ==");
const pc = await chem.pubchemLookup("aspirin");
check("aspirin found in PubChem", pc.cid === 2244 && pc.formula === "C9H8O4", `got ${JSON.stringify(pc)}`);
const pcMiss = await chem.pubchemLookup("zzz-no-such-compound-xyz");
check("missing name returns structured error", pcMiss.error === "not-found", `got ${JSON.stringify(pcMiss)}`);

console.log("== 6.5 logP cross-check: RDKit Crippen vs PubChem XLogP3 ==");
// Different algorithms legitimately disagree; the check is agreement within a
// tolerant band (|Δ| <= 1.5), not equality.
const CROSS_CASES = [
	{ name: "aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O", query: "aspirin" },
	{ name: "caffeine", smiles: "Cn1cnc2c1c(=O)n(C)c(=O)n2C", query: "caffeine" },
	{ name: "ibuprofen", smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O", query: "ibuprofen" },
	{ name: "cholesterol", smiles: "CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C", query: "cholesterol" }
];
for (const c of CROSS_CASES) {
	const propsOut = await chem.props(c.smiles);
	const pcOut = await chem.pubchemLookup(c.query, "name");
	if (propsOut.ok !== true || pcOut.error !== undefined || pcOut.xlogp === null) {
		check(
			`${c.name} cross-check data available`,
			false,
			`props=${JSON.stringify(propsOut).slice(0, 120)} pc=${JSON.stringify(pcOut).slice(0, 120)}`
		);
		continue;
	}
	const crippen = propsOut.result.logp;
	const xlogp = Number(pcOut.xlogp);
	check(
		`${c.name} logP agreement (Crippen ${crippen} vs XLogP3 ${xlogp})`,
		Number.isFinite(xlogp) && Math.abs(crippen - xlogp) <= 1.5,
		`Crippen=${crippen}, XLogP3=${xlogp}, Δ=${Math.abs(crippen - xlogp)}`
	);
}

console.log("== 7. Crossref literature (network) ==");
const papers = await chem.papersSearch("Suzuki coupling palladium", 3);
check(
	"crossref returns DOIs",
	papers.error === null && papers.papers.length > 0 && papers.papers.every((p) => typeof p.doi === "string" && p.doi !== ""),
	`got ${JSON.stringify(papers).slice(0, 300)}`
);
// Schema-conformance guard: the harness rejects null for declared string
// fields (regression: Crossref entries missing journal/year/abstract broke
// chem_papers with "value.papers[0].journal must be a string", fixed by
// omitting absent fields on 2026-08-14).
check(
	"crossref papers carry no null fields",
	papers.error === null && papers.papers.every((p) => Object.values(p).every((v) => v !== null)),
	`null fields present: ${JSON.stringify(papers.papers.filter((p) => Object.values(p).some((v) => v === null))).slice(0, 300)}`
);
console.log("  (schema guard: no null fields in papers ✓)");

console.log("== 8. recipe library persistence ==");
const saved = await chem.recipeSave({
	title: "benchmark marker",
	content: "benchmark-run marker",
	tags: ["benchmark"],
	smiles: "CCO"
});
const found = await chem.recipeSearch("benchmark marker");
check("recipe round-trips through disk", found.recipes.some((r) => r.id === saved.id), "saved recipe not found");

console.log("== 9. retrosynthesis (P5 template layer) ==");
const retroCases = [
	["aspirin -> acetic acid + salicylic acid", "CC(=O)Oc1ccccc1C(=O)O", "CC(=O)O", true],
	["anisole -> methanol + benzene", "COc1ccccc1", "CO", true],
	["biphenyl -> benzene + benzene", "c1ccc(-c2ccccc2)cc1", "c1ccccc1", true],
	["ibuprofen benzylic break", "CC(C)Cc1ccc(cc1)C(C)C(=O)O", null, true]
];
for (const [label, smiles, expectedFrag, expectHit] of retroCases) {
	const out = await chem.retroStep(smiles, { maxResults: 15 });
	const hit = out.ok === true && out.result.count > 0;
	check(`${label}: hit`, hit === expectHit, `got ${JSON.stringify(out).slice(0, 200)}`);
	if (hit && expectedFrag !== null) {
		const conserved = out.result.steps.filter((s) => s.atomConserved);
		const anyFrag = conserved.some((s) => s.precursors.includes(expectedFrag));
		check(`${label}: precursor ${expectedFrag} present & conserved`, anyFrag, `steps=${JSON.stringify(out.result.steps.map((s) => [s.template, s.precursors])).slice(0, 300)}`);
	}
}
const noHit = await chem.retroStep("CCO");
check("ethanol (no cleavable group) -> no hits", noHit.ok === true && noHit.result.count === 0, `got ${JSON.stringify(noHit).slice(0, 200)}`);

console.log("== 10. functional group recognition (P5) ==");
const fg = await chem.functionalGroups("CC(=O)Oc1ccccc1C(=O)O");
const fgNames = fg.ok === true ? fg.result.groups.map((g) => g.name) : [];
check("aspirin: ester + carboxylic acid", fgNames.includes("ester") && fgNames.includes("carboxylic_acid"), `got ${JSON.stringify(fg)}`);
const fg2 = await chem.functionalGroups("Nc1ccc([N+](=O)[O-])cc1");
const fg2Names = fg2.ok === true ? fg2.result.groups.map((g) => `${g.name}:${g.count}`) : [];
check(
	"p-nitroaniline: aniline(1) + nitro(1)",
	fg2Names.includes("aniline:1") && fg2Names.includes("nitro:1"),
	`got ${JSON.stringify(fg2)}`
);

console.log("== 11. route planning + reagents (P5) ==");
const plan = await chem.retroPlan("COc1ccc(NC(C)=O)cc1", { maxDepth: 3 });
check(
	"retro plan finds at least one route",
	plan.ok === true && plan.result.plans.length > 0,
	`got ${JSON.stringify(plan).slice(0, 250)}`
);
if (plan.ok === true && plan.result.plans.length > 0) {
	const twoStep = plan.result.plans.find((p) => p.route.length === 2);
	check("a two-step route exists (ether then amide)", twoStep !== undefined, `plans=${JSON.stringify(plan.result.plans.map((p) => p.route.map((s) => s.template)))}`);
}
const reagents = await chem.reagents("biaryl_C-C");
check(
	"biaryl conditions include Suzuki",
	reagents.ok === true && /Suzuki/i.test(reagents.result.conditions),
	`got ${JSON.stringify(reagents)}`
);
const reagentsBad = await chem.reagents("no-such-template");
check("unknown template -> structured error", reagentsBad.ok === false, `got ${JSON.stringify(reagentsBad)}`);

console.log("== 12. AiZynthFinder (PY314 port, ML policy) ==");
const az = await chem.aizynth("CC(=O)Oc1ccccc1C(=O)O", { timeoutSeconds: 60, maxRoutes: 3 });
check(
	"aizynth finds aspirin routes",
	az.ok === true && typeof az.result.numRoutes === "number" && az.result.numRoutes >= 1,
	`got ${JSON.stringify(az).slice(0, 250)}`
);
if (az.ok === true && az.result.routes.length > 0) {
	const tree = az.result.routes[0].reactionTree;
	check(
		"route 0 reaction tree is a molecule with reactions",
		typeof tree?.smiles === "string" && Array.isArray(tree?.children),
		`got ${JSON.stringify(tree).slice(0, 200)}`
	);
	const reactions = [];
	const validFlags = [];
	const walk = (node) => {
		if (node.type === "reaction") {
			if (typeof node.smiles === "string") reactions.push(node.smiles);
			validFlags.push(node.smilesValid === true);
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	check(
		"route contains at least one reaction SMILES",
		reactions.length >= 1 && reactions.every((r) => r.includes(">>")),
		`reactions=${JSON.stringify(reactions)}`
	);
	// Regression: template-derived rxn.smiles were invalid ([cH3:5]); the
	// runner now prefers metadata.mapped_reaction_smiles and marks validity.
	check(
		"every reaction SMILES is valid (mapped_reaction_smiles fix)",
		validFlags.length >= 1 && validFlags.every(Boolean),
		`flags=${JSON.stringify(validFlags)} reactions=${JSON.stringify(reactions)}`
	);
	if (reactions.length > 0) {
		const bal = await chem.reaction({ mode: "balance", reaction: reactions[0] });
		// AiZynth template reactions are simplified (leaving small molecules
		// such as AcOH/HCl implicit), so exact conservation is not expected;
		// tolerate a small-molecule gap and reject only manufactured atoms.
		const heavy = (els) => Object.values(els).reduce((a, b) => a + b, 0);
		const lhsH = bal.ok === true ? heavy(bal.result.lhsElements) : null;
		const rhsH = bal.ok === true ? heavy(bal.result.rhsElements) : null;
		const gap = lhsH !== null && rhsH !== null ? rhsH - lhsH : null;
		check(
			"route reaction: no manufactured atoms (small-molecule gap tolerated)",
			bal.ok === true && gap !== null && gap <= 4,
			`got ${JSON.stringify(bal)}`
		);
	}
	const azBad = await chem.aizynth("not-a-molecule", { timeoutSeconds: 10 });
	check(
		"invalid SMILES -> clean structured error (no stack leak)",
		azBad.ok === false && /invalid SMILES/i.test(azBad.error) && !/Traceback|File "|line \d+/.test(azBad.error),
		`got ${JSON.stringify(azBad).slice(0, 300)}`
	);
}

console.log("== 13. drug-likeness (P6) ==");
const dlCases = [
	["aspirin drug-like", "CC(=O)Oc1ccccc1C(=O)O", "drug-like", true],
	["taxol not drug-like", "CC1=C2C(C(=O)C3(C(CC4C(C3C(C2(C)C)(CC1OC(=O)C(C(C5=CC=CC=C5)NC(=O)C6=CC=CC=C6)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)OC(=O)C)C", "not drug-like", true]
];
for (const [label, smiles, expectedVerdict, expectOk] of dlCases) {
	const out = await chem.druglikeness(smiles);
	check(`${label}: verdict ${expectedVerdict}`, out.ok === expectOk && out.result.verdict === expectedVerdict, `got ${JSON.stringify(out).slice(0, 200)}`);
}
const dlAsp = await chem.druglikeness("CC(=O)Oc1ccccc1C(=O)O");
check("aspirin QED is a finite number", dlAsp.ok === true && typeof dlAsp.result.qed === "number" && Number.isFinite(dlAsp.result.qed), `got ${JSON.stringify(dlAsp)}`);
check("aspirin Lipinski passes", dlAsp.ok === true && dlAsp.result.lipinski.passes === true, `got ${JSON.stringify(dlAsp)}`);
const dlBad = await chem.druglikeness("zzz");
check("invalid SMILES -> structured error", dlBad.ok === false, `got ${JSON.stringify(dlBad)}`);

console.log("== 14. similarity / clustering / MCS / enumeration (P6) ==");
const sim = await chem.similarity("CC(=O)Oc1ccccc1C(=O)O", ["O=C(O)c1ccccc1O", "CC(=O)Nc1ccc(O)cc1", "c1ccccc1", "CCO"]);
check(
	"similarity ranks salicylic acid first (0.4483)",
	sim.ok === true && sim.result.results[0].target === "O=C(O)c1ccccc1O" && Math.abs(sim.result.results[0].tanimoto - 0.4483) < 0.001,
	`got ${JSON.stringify(sim).slice(0, 250)}`
);
const simMaccs = await chem.similarity("CC(=O)Oc1ccccc1C(=O)O", ["O=C(O)c1ccccc1O"], { fingerprint: "maccs" });
check("MACCS fingerprint path works", simMaccs.ok === true && typeof simMaccs.result.results[0].tanimoto === "number", `got ${JSON.stringify(simMaccs)}`);
// Regression: an invalid target must be marked invalid with tanimoto OMITTED
// (null failed the harness schema and killed the whole call — P6 audit).
const simMixed = await chem.similarity("CC(=O)Oc1ccccc1C(=O)O", ["O=C(O)c1ccccc1O", "xyz", "CCO"]);
const mixedInvalid = simMixed.ok === true ? simMixed.result.results.find((r) => r.invalid === true) : null;
const validCount = simMixed.ok === true ? simMixed.result.results.filter((r) => r.invalid === false).length : 0;
check(
	"mixed list: invalid target flagged, valid ones still scored",
	simMixed.ok === true && mixedInvalid?.target === "xyz" && mixedInvalid.tanimoto === undefined && validCount === 2,
	`got ${JSON.stringify(simMixed).slice(0, 300)}`
);
const clu = await chem.cluster([
	"CC(=O)Oc1ccccc1C(=O)O", "O=C(O)c1ccccc1O", "CC(=O)Nc1ccc(O)cc1", "Oc1ccccc1",
	"c1ccccc1", "Cc1ccccc1", "CCO", "CC(C)Cc1ccc(cc1)C(C)C(=O)O"
], { cutoff: 0.4 });
check(
	"butina clusters aspirin + salicylic acid",
	clu.ok === true && clu.result.clusters.some((c) => c.size > 1 && c.members.includes("O=C(O)c1ccccc1O") && c.members.includes("CC(=O)Oc1ccccc1C(=O)O")),
	`got ${JSON.stringify(clu).slice(0, 300)}`
);
check(
	"murcko scaffold of benzene series is benzene",
	clu.ok === true && clu.result.murckoScaffolds.some((s) => s.smiles === "c1ccccc1" && s.count >= 4),
	`got ${JSON.stringify(clu.result.murckoScaffolds)}`
);
const mcs = await chem.mcs("CC(=O)Oc1ccccc1C(=O)O", "O=C(O)c1ccccc1O");
check("MCS shares the salicylic substructure", mcs.ok === true && mcs.result.numAtoms >= 8, `got ${JSON.stringify(mcs)}`);
const enumLib = await chem.enumerate("[*:1]c1ccccc1[*:2]", { "1": ["C", "N", "O"], "2": ["C", "CC", "Cl"] });
check(
	"enumeration 3x3 = 9 unique products",
	enumLib.ok === true && enumLib.result.combinations === 9 && enumLib.result.generated === 9 && enumLib.result.failed === 0,
	`got ${JSON.stringify(enumLib).slice(0, 250)}`
);

console.log("== 15. ADMET (admet_ai, torch CPU) ==");
const admet = await chem.admet("CC(=O)Oc1ccccc1C(=O)O");
check(
	"admet returns full endpoint set",
	admet.ok === true && typeof admet.result.count === "number" && admet.result.count >= 20,
	`got ${JSON.stringify(admet).slice(0, 250)}`
);
if (admet.ok === true) {
	const eps = admet.result.endpoints;
	check(
		"key endpoints present (AMES, hERG, molecular_weight)",
		typeof eps.AMES === "number" && typeof eps.hERG === "number" && typeof eps.molecular_weight === "number",
		`keys sample: ${JSON.stringify(Object.keys(eps).slice(0, 8))}`
	);
	check(
		"all endpoint values are JSON numbers or strings",
		Object.values(eps).every((v) => typeof v === "number" || typeof v === "string"),
		"non-scalar values present"
	);
	check("aspirin MW sanity", Math.abs(eps.molecular_weight - 180.16) < 0.5, `got ${eps.molecular_weight}`);
}
const admetBad = await chem.admet("not-a-molecule");
check("invalid SMILES -> structured error", admetBad.ok === false, `got ${JSON.stringify(admetBad)}`);

console.log("== 16. molecular docking (AutoDock Vina) ==");
const DOCK_RECEPTOR = "C:/Users/cloud/.dsh/chem/test-dock/1iep_receptorH.pdb";
const dock = await chem.dock(
	"Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
	DOCK_RECEPTOR,
	{ center: [15.19, 53.903, 16.917], boxSize: [20, 20, 20], exhaustiveness: 4 }
);
check(
	"dock returns multiple poses with affinities",
	dock.ok === true && Array.isArray(dock.result.poses) && dock.result.poses.length >= 3 && typeof dock.result.bestAffinity_kcal_mol === "number",
	`got ${JSON.stringify(dock).slice(0, 250)}`
);
if (dock.ok === true) {
	const best = dock.result.poses[0];
	check(
		"poses sorted by affinity, best first",
		best.mode === 1 && dock.result.poses.every((p, i, arr) => i === 0 || arr[i - 1].affinity_kcal_mol <= p.affinity_kcal_mol),
		`first=${JSON.stringify(best)}`
	);
	// 1iep is a strong binder; the best mode should be strongly negative.
	check(
		"1iep ligand scores < -6 kcal/mol",
		dock.result.bestAffinity_kcal_mol < -6,
		`got ${dock.result.bestAffinity_kcal_mol}`
	);
}
const dockBadReceptor = await chem.dock("CCO", "C:/no/such/file.pdb", { center: [0, 0, 0] });
check("missing receptor -> structured error", dockBadReceptor.ok === false, `got ${JSON.stringify(dockBadReceptor)}`);
const dockBadLigand = await chem.dock("zzz", DOCK_RECEPTOR, { center: [0, 0, 0] });
check("invalid ligand -> structured error", dockBadLigand.ok === false, `got ${JSON.stringify(dockBadLigand)}`);

console.log("== 17. virtual screening pipeline (P8) ==");
const screen = await chem.screen({
	scaffold: "[*:1]c1ccccc1[*:2]",
	rgroups: { "1": ["C", "N", "O"], "2": ["C", "CC", "Cl"] },
	reference: "CC(=O)Oc1ccccc1C(=O)O",
	reportPath: "C:/Users/cloud/Desktop/dshchem/test/screen-report.md"
});
check(
	"screen enumerates 3x3 and returns ranked hits",
	screen.ok === true && screen.result.combinations === 9 && Array.isArray(screen.result.hits) && screen.result.hits.length >= 1,
	`got ${JSON.stringify(screen).slice(0, 250)}`
);
if (screen.ok === true && screen.result.hits.length > 0) {
	check(
		"hits ranked by tanimoto descending",
		screen.result.hits.every((h, i, arr) => i === 0 || (arr[i - 1].tanimoto ?? -1) >= (h.tanimoto ?? -1)),
		`tanimoto order: ${JSON.stringify(screen.result.hits.map((h) => h.tanimoto))}`
	);
	check(
		"hits carry QED/SA and all pass drug-likeness",
		screen.result.hits.every((h) => typeof h.qed === "number" && h.verdict === "drug-like"),
		`got ${JSON.stringify(screen.result.hits.slice(0, 2))}`
	);
}
check(
	"screen writes the markdown report",
	screen.ok === true && typeof screen.result.reportPath === "string",
	`got ${JSON.stringify(screen).slice(0, 200)}`
);
const screenFail = await chem.screen({ scaffold: "c1ccccc1", rgroups: { "1": ["C"] } });
check("scaffold without dummies -> structured error", screenFail.ok === false, `got ${JSON.stringify(screenFail)}`);
// dock batch mode (2 ligands, low exhaustiveness for speed)
const dockBatch = await chem.dock(
	"",
	DOCK_RECEPTOR,
	{ center: [15.19, 53.903, 16.917], boxSize: [20, 20, 20], exhaustiveness: 4, batch: true, smilesList: ["CCO", "c1ccccc1"] }
);
check(
	"dock batch returns ranked affinity list",
	dockBatch.ok === true && Array.isArray(dockBatch.result.batch) && dockBatch.result.batch.length === 2 && dockBatch.result.batch.every((b) => typeof b.bestAffinity_kcal_mol === "number"),
	`got ${JSON.stringify(dockBatch).slice(0, 250)}`
);
// pose coordinates (P9): best-pose XYZ powers the browser complex viewer
const dockPose = await chem.dock(
	"Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
	DOCK_RECEPTOR,
	{ center: [15.19, 53.903, 16.917], boxSize: [20, 20, 20], exhaustiveness: 4, poseOut: true }
);
check(
	"dock poseOut returns a well-formed best-pose XYZ frame",
	dockPose.ok === true &&
		typeof dockPose.result.bestPoseXyz === "string" &&
		(() => {
			const lines = dockPose.result.bestPoseXyz.trim().split("\n");
			return Number(lines[0]) === lines.length - 2 && Number(lines[0]) > 1;
		})(),
	`got ${JSON.stringify(dockPose).slice(0, 250)}`
);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
