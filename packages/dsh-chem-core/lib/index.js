/**
 * @dshchem/dsh-chem-core — host-plane chemistry engine for DSH.
 *
 * Provides the `chem` service: deterministic molecular facts computed by
 * RDKit/ASE through a Python subprocess bridge (`python/chem_engine.py`),
 * PubChem PUG REST lookups, Crossref literature search, and a persistent
 * recipe/notes library under $DSH_HOME/chem. Model-facing tools live in the
 * companion preset package `@dshchem/dsh-tool-chem`; this package owns
 * engines, network, storage, routes, and the service — never tool schemas.
 *
 * Mounted as a profile bundle row (see cordis.patch.yml).
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, stat as statFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin name used by loader diagnostics. */
export const name = "chem-core";

/**
 * Hard dependency: the HTTP server. The web profile always provides it
 * (dsh-web-app bundle), and waiting for it guarantees the render route is
 * registered only after the server exists — an eager `ctx.get("webServer")`
 * read would silently skip route registration (same timing trap as the
 * client-half slots dependency, observed 2026-08-14).
 */
export const inject = ["webServer"];

const ENGINE_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"python",
	"chem_engine.py"
);

const THREEDMOL_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"vendor",
	"3Dmol-min.js"
);

const PUG_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUG_UA = "dsh-chem-core/0.1.0 (dsh chemistry plugin)";
const CROSSREF_API = "https://api.crossref.org/works";
const CROSSREF_UA = "dsh-chem-core/0.1.0 (mailto:chem@localhost)";

/* ── HTTP helpers (mirror the dsh-ssh route fence) ───────────────────────── */

/** Loopback check plus browser same-origin markers; routes never serve LAN. */
function isLoopbackRequest(request) {
	const address = request.socket?.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}

/** URL query helper (first value, decoded). */
function queryParam(url, name) {
	const value = url.searchParams.get(name);
	return value === null ? undefined : value;
}

/* ── engine bridge ───────────────────────────────────────────────────────── */

/**
 * Build a JSON-over-stdin/stdout bridge to the python engine. One request per
 * process: reliable, stateless, and trivially killable on timeout.
 * @param python - python executable name or path.
 * @param timeoutMs - per-call budget; the child is killed on expiry.
 * @returns async (op, args) => engine response object ({ok, result|error}).
 */
function runEngine(python, timeoutMs) {
	return (op, args) =>
		new Promise((resolvePromise, reject) => {
			const child = spawn(python, [ENGINE_PATH], {
				stdio: ["pipe", "pipe", "pipe"]
			});
			let stdout = "";
			let stderr = "";
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill("SIGKILL");
				reject(new Error(`chem engine timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.on("error", (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(new Error(`chem engine failed to start: ${error.message}`));
			});
			child.on("close", (code) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (code !== 0) {
					reject(
						new Error(
							`chem engine exited with code ${code}: ${stderr.slice(0, 500) || "no stderr"}`
						)
					);
					return;
				}
				try {
					resolvePromise(JSON.parse(stdout));
				} catch {
					reject(
						new Error(`chem engine returned invalid JSON: ${stdout.slice(0, 300)}`)
					);
				}
			});
			child.stdin.write(JSON.stringify({ op, args }));
			child.stdin.end();
		});
}

/* ── PubChem / Crossref clients ──────────────────────────────────────────── */

/**
 * Normalize one PUG REST property lookup into a plain JSON record, or a
 * structured error. Never throws for HTTP failures.
 */
async function pubchemLookup(query, by, timeoutMs) {
	const idType = by === "cid" || by === "smiles" || by === "inchikey" ? by : "name";
	const url = `${PUG_BASE}/compound/${idType}/${encodeURIComponent(query)}/property/MolecularFormula,MolecularWeight,SMILES,IUPACName,InChIKey,Title,XLogP,HBondDonorCount,HBondAcceptorCount,TPSA,RotatableBondCount/JSON`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": PUG_UA },
			signal: controller.signal
		});
		if (response.status === 404) {
			return { error: "not-found", query, by: idType };
		}
		if (!response.ok) {
			return { error: `pubchem http ${response.status}`, query, by: idType };
		}
		const data = await response.json();
		const props = data?.PropertyTable?.Properties?.[0];
		if (props === undefined) {
			return { error: "empty-response", query, by: idType };
		}
		return {
			cid: props.CID ?? null,
			name: props.Title ?? null,
			formula: props.MolecularFormula ?? null,
			mw: props.MolecularWeight ?? null,
			smiles: props.SMILES ?? null,
			iupac: props.IUPACName ?? null,
			inchikey: props.InChIKey ?? null,
			xlogp: props.XLogP ?? null,
			hbdPc: props.HBondDonorCount ?? null,
			hbaPc: props.HBondAcceptorCount ?? null,
			tpsaPc: props.TPSA ?? null,
			rotatablePc: props.RotatableBondCount ?? null,
			source: "PubChem PUG REST"
		};
	} catch (error) {
		if (error?.name === "AbortError") {
			return { error: `pubchem timeout after ${timeoutMs}ms`, query, by: idType };
		}
		return { error: `pubchem request failed: ${error.message}`, query, by: idType };
	} finally {
		clearTimeout(timer);
	}
}

/** PubChem name autocomplete: name-prefix suggestions for disambiguation. */
async function pubchemSuggest(query, limit, timeoutMs) {
	const url = `${PUG_BASE.replace("/pug", "")}/autocomplete/compound/${encodeURIComponent(query)}/json?limit=${limit}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": PUG_UA },
			signal: controller.signal
		});
		if (!response.ok) return { suggestions: [], error: `pubchem http ${response.status}` };
		const data = await response.json();
		const terms = data?.dictionary_terms?.compound;
		return {
			suggestions: Array.isArray(terms) ? terms.slice(0, limit) : [],
			error: null
		};
	} catch (error) {
		if (error?.name === "AbortError") {
			return { suggestions: [], error: `pubchem timeout after ${timeoutMs}ms` };
		}
		return { suggestions: [], error: `pubchem request failed: ${error.message}` };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Crossref literature search (works endpoint). Deterministic, key-free.
 * Returns title/DOI/journal/year/authors/abstract for the top hits.
 */
async function papersSearch(query, limit, timeoutMs) {
	const params = new URLSearchParams({
		query: query,
		rows: String(Math.min(Math.max(limit ?? 5, 1), 20)),
		select: "DOI,title,container-title,issued,author,abstract"
	});
	const url = `${CROSSREF_API}?${params.toString()}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": CROSSREF_UA },
			signal: controller.signal
		});
		if (!response.ok) return { error: `crossref http ${response.status}`, papers: [] };
		const data = await response.json();
		const items = data?.message?.items ?? [];
		return {
			papers: items.slice(0, limit).map((item) => {
				// Crossref entries legitimately lack some fields. The tool
				// output schemas declare strings/numbers without nullable, so
				// ABSENT fields must be omitted, never null (schema validation
				// rejects null — same trap as the PubChem mw bug).
				const paper = {};
				const title = item.title?.[0];
				if (typeof title === "string" && title !== "") paper.title = title;
				if (typeof item.DOI === "string" && item.DOI !== "") paper.doi = item.DOI;
				const journal = item["container-title"]?.[0];
				if (journal !== undefined && journal !== null) paper.journal = journal;
				const year = item.issued?.["date-parts"]?.[0]?.[0];
				if (year !== undefined && year !== null) paper.year = year;
				const authors = (item.author ?? [])
					.slice(0, 10)
					.map((a) => [a.given, a.family].filter(Boolean).join(" "))
					.filter((name) => name !== "");
				if (authors.length > 0) paper.authors = authors;
				if (typeof item.abstract === "string" && item.abstract !== "") {
					paper.abstract = item.abstract.slice(0, 2000);
				}
				return paper;
			}),
			error: null
		};
	} catch (error) {
		if (error?.name === "AbortError") {
			return { error: `crossref timeout after ${timeoutMs}ms`, papers: [] };
		}
		return { error: `crossref request failed: ${error.message}`, papers: [] };
	} finally {
		clearTimeout(timer);
	}
}

/* ── recipe / notes library ($DSH_HOME/chem/recipes.json) ────────────────── */

const RECIPES_PATH = () => resolve(homedir(), ".dsh", "chem", "recipes.json");

/** Load the recipe ledger (empty array when absent or corrupt). */
async function loadRecipes() {
	try {
		const raw = await readFile(RECIPES_PATH(), "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function saveRecipes(recipes) {
	const file = RECIPES_PATH();
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(recipes, null, 2), "utf8");
}

/** Append one recipe/note; returns the stored record with an id and timestamp. */
async function recipeSave(entry) {
	const recipes = await loadRecipes();
	const record = {
		id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		createdAt: new Date().toISOString(),
		title: String(entry.title ?? "untitled").slice(0, 200),
		tags: Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 20) : [],
		content: String(entry.content ?? "").slice(0, 20000),
		smiles: typeof entry.smiles === "string" ? entry.smiles.slice(0, 2000) : null,
		project: typeof entry.project === "string" ? entry.project.slice(0, 200) : null
	};
	recipes.push(record);
	await saveRecipes(recipes);
	return record;
}

/** Search the ledger by substring over title/content/tags/smiles/project. */
async function recipeSearch(query, limit) {
	const q = String(query ?? "").toLowerCase();
	const all = await loadRecipes();
	const hit = (r) =>
		q === "" ||
		r.title.toLowerCase().includes(q) ||
		r.content.toLowerCase().includes(q) ||
		r.tags.some((t) => t.toLowerCase().includes(q)) ||
		(r.smiles ?? "").toLowerCase().includes(q) ||
		(r.project ?? "").toLowerCase().includes(q);
	const matched = all.filter(hit).slice(-50).reverse();
	return { total: matched.length, recipes: matched.slice(0, Math.min(limit ?? 10, 50)) };
}

async function recipeList(limit) {
	const all = await loadRecipes();
	const recent = all.slice(-200).reverse();
	return { total: all.length, recipes: recent.slice(0, Math.min(limit ?? 20, 200)) };
}

/* ── service surface ─────────────────────────────────────────────────────── */

/**
 * The `chem` service consumed by preset tool rows.
 * @param call - engine bridge bound to the configured python/timeout.
 * @param callCalc - engine bridge with the (longer) calc budget.
 * @param config - resolved plugin config.
 */
function makeService(call, callCalc, callSlow, config) {
	const pubchemTimeoutMs = config.pubchemTimeoutMs ?? 30000;
	const crossrefTimeoutMs = config.crossrefTimeoutMs ?? 30000;
	const xtbCommand = config.xtbPath ?? globalThis.process?.env?.XTB_COMMAND ?? "xtb";
	const aizynthPython = config.aizynthPython ?? globalThis.process?.env?.AIZYNTH_PYTHON;
	const aizynthConfig = config.aizynthConfig ?? globalThis.process?.env?.AIZYNTH_CONFIG;
	return {
		/** RDKit validate + canonicalize. */
		validate: (smiles) => call("validate", { smiles }),
		/** RDKit molecular descriptors; `options.iupac` requests an IUPAC name. */
		props: (smiles, options = {}) =>
			call("props", { smiles, iupac: options.iupac === true }),
		/** Structure format conversion (canonical|inchi|inchikey|mol|sdf|svg). */
		convert: (smiles, format) => call("convert", { smiles, format }),
		/** ASE/xtb energy (emt | xtb), optional relaxation. Longer budget. */
		calc: (smiles, options = {}) =>
			callCalc("calc", {
				smiles,
				method: options.method ?? "emt",
				optimize: options.optimize !== false,
				xtbCommand,
				xtbTimeoutMs: config.calcTimeoutMs ?? 180000
			}),
		/** Atom-conservation balance check or SMARTS template reaction. */
		reaction: (args) => call("reaction", args),
		/** One retrosynthetic disconnection step (P5 template library). */
		retroStep: (smiles, options = {}) =>
			call("retro_step", {
				smiles,
				maxResults: options.maxResults ?? 10,
				minFragmentHeavy: options.minFragmentHeavy ?? 2
			}),
		/** BFS retrosynthetic route planning (P5). */
		retroPlan: (smiles, options = {}) =>
			call("retro_plan", {
				smiles,
				maxDepth: options.maxDepth ?? 3,
				maxBranches: options.maxBranches ?? 3,
				budget: options.budget ?? 24
			}),
		/** Forward-synthesis condition hints for a retro template (P5). */
		reagents: (template) => call("reagents", { template }),
		/** AiZynthFinder advanced retrosynthesis (PY314 port; slow budget). */
		aizynth: (smiles, options = {}) =>
			callSlow("aizynth", {
				smiles,
				timeoutSeconds: options.timeoutSeconds ?? 60,
				maxRoutes: options.maxRoutes ?? 5,
				...(aizynthPython ? { venvPython: aizynthPython } : {}),
				...(aizynthConfig ? { config: aizynthConfig } : {})
			}),
		/** Rule-based drug-likeness + QED + SA (P6). */
		druglikeness: (smiles) => call("druglikeness", { smiles }),
		/** Tanimoto similarity of one query vs a target list (P6). */
		similarity: (smiles, targets, options = {}) =>
			call("similarity", {
				smiles,
				targets,
				fingerprint: options.fingerprint ?? "morgan",
				radius: options.radius ?? 2,
				nbits: options.nbits ?? 2048
			}),
		/** Butina clustering + Murcko scaffolds (P6). */
		cluster: (smilesList, options = {}) =>
			call("cluster", {
				smiles: smilesList,
				cutoff: options.cutoff ?? 0.4,
				radius: options.radius ?? 2,
				nbits: options.nbits ?? 2048
			}),
		/** Maximum common substructure (P6). */
		mcs: (smilesA, smilesB, options = {}) =>
			call("mcs", {
				smilesA,
				smilesB,
				timeout: options.timeout ?? 10,
				ringMatchesRingOnly: options.ringMatchesRingOnly !== false
			}),
		/** R-group combinatorial enumeration (P6). */
		enumerate: (scaffold, rgroups, options = {}) =>
			call("enumerate", {
				scaffold,
				rgroups,
				maxProducts: options.maxProducts ?? 100
			}),
		/** ADMET predictions via admet_ai (P6.3; slow budget). */
		admet: (smiles) => callSlow("admet", { smiles }),
		/** Molecular docking via AutoDock Vina (P7; slow budget). */
		dock: (smiles, receptor, options = {}) =>
			callSlow("dock", {
				smiles,
				receptor,
				center: options.center,
				boxSize: options.boxSize ?? [20, 20, 20],
				exhaustiveness: options.exhaustiveness ?? 8,
				...(options.poseOut === true ? { poseOut: true } : {}),
				...(options.batch === true ? { batch: true, smilesList: options.smilesList } : {}),
				...(config.vinaPath ? { vinaPath: config.vinaPath } : {})
			}),
		/** One-shot virtual screening pipeline (P8; slow budget). */
		screen: (options) =>
			callSlow("screen", {
				scaffold: options.scaffold,
				rgroups: options.rgroups,
				maxProducts: options.maxProducts ?? 200,
				minQed: options.minQed ?? 0.3,
				maxSa: options.maxSa ?? 4.0,
				reference: options.reference,
				admetFilter: options.admetFilter === true,
				admetThresholds: options.admetThresholds ?? {},
				reportPath: options.reportPath
			}),
		/** SMARTS-based functional group recognition (P5). */
		functionalGroups: (smiles) => call("functional_groups", { smiles }),
		/** PyMuPDF text extraction for the literature layer. */
		pdfText: (path, options = {}) =>
			call("pdftext", {
				path,
				maxPages: options.maxPages ?? 20,
				maxChars: options.maxChars ?? 200000
			}),
		/** PubChem property lookup by name | cid | smiles | inchikey. */
		pubchemLookup: (query, by = "name") => pubchemLookup(query, by, pubchemTimeoutMs),
		/** PubChem name autocomplete suggestions. */
		pubchemSuggest: (query, limit = 10) => pubchemSuggest(query, limit, pubchemTimeoutMs),
		/** Crossref literature search (key-free). */
		papersSearch: (query, limit = 5) => papersSearch(query, limit, crossrefTimeoutMs),
		/** Recipe/notes library under $DSH_HOME/chem/recipes.json. */
		recipeSave,
		recipeSearch,
		recipeList
	};
}

/**
 * Mount the chemistry engine: provide the `chem` service in the host plane and
 * register the loopback-only /api/dsh-chem routes (structure rendering for the
 * browser tool cards).
 * @param ctx - host plugin context.
 * @param config - resolved plugin config (schema-free; defaults applied here).
 */
export function apply(ctx, config = {}) {
	const python = config.python ?? globalThis.process?.env?.CHEM_PYTHON ?? "python";
	const timeoutMs = config.timeoutMs ?? 30000;
	const calcTimeoutMs = config.calcTimeoutMs ?? 180000;
	const aizynthTimeoutMs = config.aizynthTimeoutMs ?? 200000;
	const call = runEngine(python, timeoutMs);
	const callCalc = runEngine(python, calcTimeoutMs);
	const callSlow = runEngine(python, aizynthTimeoutMs);
	ctx.provide("chem", makeService(call, callCalc, callSlow, config));

	const webServer = ctx.webServer; // injected: available by the time apply runs
	ctx.effect(() => {
			const disposers = [
				webServer.register({
					kind: "exact",
					path: "/api/dsh-chem/render-svg",
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) {
							writeJson(res, 403, { error: "forbidden: loopback-only" });
							return;
						}
						const url = new URL(req.url ?? "/", "http://localhost");
						const smiles = queryParam(url, "smiles");
						if (smiles === undefined || smiles === "") {
							writeJson(res, 400, { error: "smiles query parameter is required" });
							return;
						}
						const out = await call("convert", { smiles, format: "svg" });
						if (out.ok === false) {
							writeJson(res, 400, { error: out.error });
							return;
						}
						res.writeHead(200, {
							"content-type": "image/svg+xml; charset=utf-8",
							"cache-control": "no-store",
							"referrer-policy": "no-referrer"
						});
						res.end(out.result.content);
					}
				}),
				webServer.register({
					kind: "exact",
					path: "/api/dsh-chem/xyz",
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) {
							writeJson(res, 403, { error: "forbidden: loopback-only" });
							return;
						}
						const url = new URL(req.url ?? "/", "http://localhost");
						const smiles = queryParam(url, "smiles");
						if (smiles === undefined || smiles === "") {
							writeJson(res, 400, { error: "smiles query parameter is required" });
							return;
						}
						const out = await call("convert", { smiles, format: "xyz" });
						if (out.ok === false) {
							writeJson(res, 400, { error: out.error });
							return;
						}
						res.writeHead(200, {
							"content-type": "chemical/x-xyz; charset=utf-8",
							"cache-control": "no-store",
							"referrer-policy": "no-referrer"
						});
						res.end(out.result.content);
					}
				}),
				webServer.register({
					kind: "exact",
					path: "/api/dsh-chem/complex",
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) {
							writeJson(res, 403, { error: "forbidden: loopback-only" });
							return;
						}
						const url = new URL(req.url ?? "/", "http://localhost");
						const smiles = queryParam(url, "smiles");
						const receptor = queryParam(url, "receptor");
						const centerRaw = queryParam(url, "center");
						if (smiles === undefined || smiles === "" || receptor === undefined || centerRaw === undefined) {
							writeJson(res, 400, { error: "smiles, receptor, and center (x,y,z) query parameters are required" });
							return;
						}
						const centerParts = centerRaw.split(",").map(Number);
						if (centerParts.length !== 3 || centerParts.some((n) => !Number.isFinite(n))) {
							writeJson(res, 400, { error: "center must be three comma-separated numbers" });
							return;
						}
						// receptor PDB is read directly (loopback-only route);
						// bound the size to keep the JSON payload sane.
						let receptorText;
						try {
							const stat = await statFile(receptor);
							if (stat.size > 10 * 1024 * 1024) {
								writeJson(res, 400, { error: "receptor file too large (> 10 MB)" });
								return;
							}
							receptorText = await readFile(receptor, "utf8");
						} catch {
							writeJson(res, 400, { error: `cannot read receptor file: ${receptor}` });
							return;
						}
						const out = await callSlow("dock", {
							smiles,
							receptor,
							center: centerParts,
							boxSize: [20, 20, 20],
							exhaustiveness: 4,
							poseOut: true
						});
						if (out.ok === false) {
							writeJson(res, 400, { error: out.error });
							return;
						}
						writeJson(res, 200, {
							receptorPdb: receptorText,
							poseXyz: out.result.bestPoseXyz,
							bestAffinity_kcal_mol: out.result.bestAffinity_kcal_mol,
							note: "vina semi-empirical docking score; not a binding free energy"
						});
					}
				}),
				webServer.register({
					kind: "exact",
					path: "/api/dsh-chem/3dmol.js",
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) {
							writeJson(res, 403, { error: "forbidden: loopback-only" });
							return;
						}
						// Serve the vendored 3Dmol.js same-origin: CDN script
						// loading can hang indefinitely on restricted networks,
						// leaving the complex viewer stuck at "对接计算中…"
						// (observed in the P9 audit) — local is deterministic.
						try {
							const script = await readFile(THREEDMOL_PATH, "utf8");
							res.writeHead(200, {
								"content-type": "application/javascript; charset=utf-8",
								"cache-control": "public, max-age=86400",
								"referrer-policy": "no-referrer"
							});
							res.end(script);
						} catch {
							writeJson(res, 404, { error: "3dmol.js vendor file missing" });
						}
					}
				})
			];
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-chem: routes");
}
