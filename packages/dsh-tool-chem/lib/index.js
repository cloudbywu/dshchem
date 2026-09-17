/**
 * @dshchem/dsh-tool-chem — model-facing chemistry tools for the DSH chemist
 * agent preset.
 *
 * One preset row registers the whole suite. Each tool is a thin consumer of
 * the host `chem` service (provided by @dshchem/dsh-chem-core): it owns the
 * schema, validation, and presentation, never the computation or network.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Cordis plugin name used by loader diagnostics. */
export const name = "tool-chem";

/** Hard dependencies: the tools registry and the host chemistry service. */
export const inject = ["tools", "chem"];

/** Compact text rendering shared by the molecular tools. */
function textBlocks(lines) {
	return [{ type: "text", text: lines.filter(Boolean).join("\n") }];
}

/** chem_validate — canonicalize and check a SMILES with RDKit. */
function validateTool(chem) {
	return defineTool({
		name: "chem_validate",
		description:
			"Validate and canonicalize a SMILES string with RDKit. Returns the canonical (isomeric) SMILES, molecular formula, InChI, InChIKey, and heavy-atom count, or a structured error for invalid input. Use this before trusting any SMILES from the model, the user, or a database.",
		parameters: {
			smiles: {
				type: "string",
				required: true,
				description: "SMILES string to validate and canonicalize."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					valid: { type: "boolean", required: true },
					canonical: { type: "string" },
					formula: { type: "string" },
					inchi: { type: "string" },
					inchikey: { type: "string" },
					heavyAtoms: { type: "integer" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.valid === false
						? [`Invalid SMILES: ${value.error}`]
						: [
								`valid: true`,
								`canonical: ${value.canonical}`,
								`formula: ${value.formula}`,
								`InChI: ${value.inchi}`,
								`InChIKey: ${value.inchikey}`,
								`heavy atoms: ${value.heavyAtoms}`
							]
				)
		},
		async execute(args) {
			const out = await chem.validate(args.smiles);
			if (out.ok === false) return { valid: false, error: out.error };
			return { valid: true, ...out.result };
		}
	});
}

/** chem_props — RDKit molecular descriptors. */
function propsTool(chem) {
	return defineTool({
		name: "chem_props",
		description:
			"Compute molecular descriptors with RDKit: molecular weight, exact mass, Crippen logP, H-bond donors/acceptors, TPSA, rotatable bonds, aromatic rings, heavy atoms, formal charge, and formula. Optionally request an IUPAC name. Values are tool-computed; cite them as RDKit results, not literature values.",
		parameters: {
			smiles: {
				type: "string",
				required: true,
				description: "SMILES string of the molecule."
			},
			iupac: {
				type: "boolean",
				description: "Also attempt an IUPAC name (may fail for exotic molecules)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					canonical: { type: "string" },
					formula: { type: "string" },
					mw: { type: "number" },
					exactMw: { type: "number" },
					logp: { type: "number" },
					hbd: { type: "integer" },
					hba: { type: "integer" },
					tpsa: { type: "number" },
					rotatableBonds: { type: "integer" },
					aromaticRings: { type: "integer" },
					heavyAtoms: { type: "integer" },
					formalCharge: { type: "integer" },
					iupacName: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.error !== undefined
						? [`chem_props failed: ${value.error}`]
						: [
								`formula: ${value.formula} (MW ${value.mw}, exact ${value.exactMw})`,
								`logP (Crippen): ${value.logp}`,
								`HBD: ${value.hbd}, HBA: ${value.hba}, TPSA: ${value.tpsa}`,
								`rotatable bonds: ${value.rotatableBonds}, aromatic rings: ${value.aromaticRings}`,
								`heavy atoms: ${value.heavyAtoms}, formal charge: ${value.formalCharge}`,
								`canonical: ${value.canonical}`,
								...(value.iupacName !== undefined && value.iupacName !== null
									? [`IUPAC: ${value.iupacName}`]
									: value.iupacError !== undefined
										? [`IUPAC unavailable: ${value.iupacError}`]
										: [])
							]
				)
		},
		async execute(args) {
			const out = await chem.props(args.smiles, { iupac: args.iupac === true });
			if (out.ok === false) return { error: out.error };
			const { iupacName, iupacError, ...rest } = out.result;
			return {
				...rest,
				...(iupacName !== undefined ? { iupacName } : {}),
				...(iupacError !== undefined ? { iupacError } : {})
			};
		}
	});
}

/** chem_convert — structure format conversion (incl. SVG depiction). */
function convertTool(chem) {
	return defineTool({
		name: "chem_convert",
		description:
			"Convert a SMILES structure to another representation with RDKit: canonical SMILES, InChI, InChIKey, mol block, SDF, a 2D SVG depiction, or XYZ 3D coordinates (ETKDG embedding, for external 3D viewers). SVG content can be embedded in documents or saved to a .svg file for display.",
		parameters: {
			smiles: {
				type: "string",
				required: true,
				description: "SMILES string of the molecule."
			},
			format: {
				type: "string",
				required: true,
				enum: ["canonical", "inchi", "inchikey", "mol", "sdf", "svg", "xyz"],
				description: "Target representation."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					format: { type: "string", required: true },
					content: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.error !== undefined
						? [`chem_convert failed: ${value.error}`]
						: value.format === "svg"
							? [`${value.format} (SVG, ${value.content.length} chars)`, value.content]
							: [`${value.format}:`, value.content]
				)
		},
		async execute(args) {
			const out = await chem.convert(args.smiles, args.format);
			if (out.ok === false) return { format: args.format, error: out.error };
			return { format: out.result.format, content: out.result.content };
		}
	});
}

/** chem_pubchem — PubChem cross-check with name autocomplete fallback. */
function pubchemTool(chem) {
	return defineTool({
		name: "chem_pubchem",
		description:
			"Look up a compound in PubChem by name, CID, SMILES, or InChIKey and return database properties (CID, preferred name, formula, molecular weight, canonical SMILES, IUPAC name, InChIKey). Use this to cross-check model/user claims against a curated database; when a name lookup misses, suggestions are returned for disambiguation.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "Compound identifier: name, CID, SMILES, or InChIKey."
			},
			by: {
				type: "string",
				enum: ["name", "cid", "smiles", "inchikey"],
				description: "Identifier type of `query`. Defaults to name."
			},
			suggest: {
				type: "boolean",
				description:
					"On a name miss, also return autocomplete suggestions. Defaults to true."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					cid: { type: "integer" },
					name: { type: "string" },
					formula: { type: "string" },
					mw: { type: "number" },
					smiles: { type: "string" },
					iupac: { type: "string" },
					inchikey: { type: "string" },
					xlogp: { type: "number" },
					hbdPc: { type: "integer" },
					hbaPc: { type: "integer" },
					tpsaPc: { type: "number" },
					rotatablePc: { type: "integer" },
					source: { type: "string" },
					suggestions: { type: "array", items: { type: "string" } },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				const lines = [];
				if (value.cid !== undefined) {
					lines.push(
						`CID ${value.cid} — ${value.name ?? "unnamed"}`,
						`formula: ${value.formula}, MW: ${value.mw}`,
						`SMILES: ${value.smiles}`,
						`IUPAC: ${value.iupac ?? "-"}`,
						`InChIKey: ${value.inchikey ?? "-"}`,
						...(value.xlogp !== undefined && value.xlogp !== null
							? [`XLogP3: ${value.xlogp}, TPSA: ${value.tpsaPc ?? "-"}, HBD/HBA: ${value.hbdPc ?? "-"}/${value.hbaPc ?? "-"}, rotatable: ${value.rotatablePc ?? "-"}`]
							: []),
						`source: ${value.source}`
					);
				} else {
					lines.push(`pubchem lookup failed: ${value.error ?? "unknown"}`);
				}
				if (value.suggestions !== undefined && value.suggestions.length > 0) {
					lines.push(`suggestions: ${value.suggestions.join(", ")}`);
				}
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const by = args.by ?? "name";
			const lookup = await chem.pubchemLookup(args.query, by);
			if (lookup.error !== undefined) {
				const result = { error: lookup.error };
				const wantSuggest =
					(args.suggest ?? true) === true && by === "name" && lookup.error === "not-found";
				if (wantSuggest) {
					const suggest = await chem.pubchemSuggest(args.query, 10);
					if (suggest.suggestions.length > 0) result.suggestions = suggest.suggestions;
				}
				return result;
			}
			const { cid, name: cName, formula, mw, smiles, iupac, inchikey, source, xlogp, hbdPc, hbaPc, tpsaPc, rotatablePc } = lookup;
			const result = { cid, name: cName, formula, smiles, iupac, inchikey, source };
			// PubChem PUG REST returns numeric fields as STRINGS ("180.16");
			// the output schema declares them numbers — normalize, and drop
			// absent/non-numeric fields to keep the schema valid.
			const numeric = (value, key) => {
				if (value === null || value === undefined) return;
				const n = Number(value);
				if (Number.isFinite(n)) result[key] = n;
			};
			numeric(mw, "mw");
			numeric(xlogp, "xlogp");
			numeric(hbdPc, "hbdPc");
			numeric(hbaPc, "hbaPc");
			numeric(tpsaPc, "tpsaPc");
			numeric(rotatablePc, "rotatablePc");
			return result;
		}
	});
}

/**
 * Register the chemistry tool suite on this preset's layer of the tools
 * registry. Disposers are fiber-scoped; the registries clean up on dispose.
 */
export function apply(ctx) {
	const disposers = [
		validateTool(ctx.chem),
		propsTool(ctx.chem),
		convertTool(ctx.chem),
		pubchemTool(ctx.chem),
		calcTool(ctx.chem),
		reactionTool(ctx.chem),
		recipeSaveTool(ctx.chem),
		recipeSearchTool(ctx.chem),
		recipeListTool(ctx.chem),
		papersTool(ctx.chem),
		pdfTool(ctx.chem),
		retroStepTool(ctx.chem),
		functionalGroupsTool(ctx.chem),
		retroPlanTool(ctx.chem),
		reagentsTool(ctx.chem),
		aizynthTool(ctx.chem),
		druglikenessTool(ctx.chem),
		similarityTool(ctx.chem),
		clusterTool(ctx.chem),
		mcsTool(ctx.chem),
		enumerateTool(ctx.chem),
		admetTool(ctx.chem),
		dockTool(ctx.chem),
		screenTool(ctx.chem)
	].map((tool) => ctx.tools.register(tool));
	ctx.effect(() => () => {
		for (const dispose of disposers) dispose();
	});
}

/* ── P2/P3 tools ─────────────────────────────────────────────────────────── */

/** chem_calc — ASE single-point / relaxation energy (emt | xtb). */
function calcTool(chem) {
	return defineTool({
		name: "chem_calc",
		description:
			"Compute an approximate molecular energy with ASE: `emt` (built-in effective medium theory, fast, qualitative) or `xtb` (GFN2-xTB, requires the xtb binary; slower). Optionally relax the 3D structure first. Energies are in eV per molecule and are qualitative, not thermochemical accuracy — always state the method when reporting.",
		parameters: {
			smiles: {
				type: "string",
				required: true,
				description: "SMILES string; 3D embedding is generated internally (max 60 heavy atoms)."
			},
			method: {
				type: "string",
				enum: ["emt", "xtb"],
				description: "Calculator method. Defaults to emt."
			},
			optimize: {
				type: "boolean",
				description: "Relax geometry before reporting the energy. Defaults to true."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					method: { type: "string" },
					optimize: { type: "boolean" },
					relaxed: { type: "boolean" },
					nAtoms: { type: "integer" },
					formula: { type: "string" },
					energyBefore_eV: { type: "number" },
					energyAfter_eV: { type: "number" },
					delta_eV: { type: "number" },
					unit: { type: "string" },
					note: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.error !== undefined
						? [`chem_calc failed: ${value.error}`]
						: [
								`method: ${value.method} (${value.optimize ? "relaxed" : "single-point"})`,
								`formula: ${value.formula} (${value.nAtoms} atoms)`,
								`energy: ${value.energyAfter_eV} eV (before: ${value.energyBefore_eV}, Δ ${value.delta_eV})`,
								`unit: ${value.unit}`,
								`note: ${value.note}`
							]
				)
		},
		async execute(args) {
			const out = await chem.calc(args.smiles, {
				method: args.method ?? "emt",
				optimize: args.optimize !== false
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_reaction — atom-conservation balance check or SMARTS template run. */
function reactionTool(chem) {
	return defineTool({
		name: "chem_reaction",
		description:
			"Reaction analysis in two modes. `balance`: check element conservation of a reaction written as 'A.B>>C.D' (dot-separated molecules). `template`: run a reaction SMARTS template over reactants and return the canonical-SMILES products (up to maxResults). Use balance to sanity-check any reaction the model or user proposes.",
		parameters: {
			mode: {
				type: "string",
				enum: ["balance", "template"],
				description: "balance (default): atom conservation; template: SMARTS product prediction."
			},
			reaction: {
				type: "string",
				description: "mode=balance: reaction SMILES string, e.g. 'CCO.O>>CCO'."
			},
			smarts: {
				type: "string",
				description: "mode=template: reaction SMARTS with atom-map numbers, e.g. '[C:1](=[O:2])[O:3][C:4]>>[C:1](=[O:2])[O:3].[C:4]'."
			},
			reactants: {
				type: "string",
				description: "mode=template: dot-separated reactant SMILES."
			},
			maxResults: {
				type: "integer",
				description: "mode=template: max product sets to return (default 5)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					balanced: { type: "boolean" },
					lhsElements: { type: "object", additionalProperties: true },
					rhsElements: { type: "object", additionalProperties: true },
					imbalance: { type: "object", additionalProperties: true },
					matched: { type: "boolean" },
					products: { type: "array", items: { type: "array", items: { type: "string" } } },
					note: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_reaction failed: ${value.error}`]);
				if (value.balanced !== undefined) {
					const lines = [
						value.balanced
							? "balanced ✓ (element counts match)"
							: `NOT balanced: ${JSON.stringify(value.imbalance)}`,
						`lhs: ${JSON.stringify(value.lhsElements)}`,
						`rhs: ${JSON.stringify(value.rhsElements)}`,
						value.note ?? ""
					];
					return textBlocks(lines);
				}
				if (value.matched === false) return textBlocks(["template did not match the reactants"]);
				return textBlocks([
					`template matched (${value.products.length} outcome(s)):`,
					...value.products.map((p, i) => `${i + 1}. ${p.join(" + ")}`)
				]);
			}
		},
		async execute(args) {
			const mode = args.mode ?? "balance";
			const out =
				mode === "template"
					? await chem.reaction({ mode, smarts: args.smarts, reactants: args.reactants, maxResults: args.maxResults ?? 5 })
					: await chem.reaction({ mode, reaction: args.reaction });
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_recipe_save — persist a successful protocol into the shared library. */
function recipeSaveTool(chem) {
	return defineTool({
		name: "chem_recipe_save",
		description:
			"Save a verified protocol, recipe, or note into the persistent chemistry library ($DSH_HOME/chem/recipes.json, shared across sessions). Use for successful syntheses, calculation workflows, or reusable findings — the ChemAgent-style knowledge memory of this preset.",
		parameters: {
			title: { type: "string", required: true, description: "Short title of the recipe." },
			content: { type: "string", required: true, description: "The protocol or note body (steps, conditions, results)." },
			tags: { type: "array", items: { type: "string" }, description: "Search tags, e.g. ['suzuki', 'pd-catalysis']." },
			smiles: { type: "string", description: "Optional SMILES of the key molecule." },
			project: { type: "string", description: "Optional project label." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: { type: "string", required: true },
					createdAt: { type: "string", required: true },
					title: { type: "string", required: true },
					tags: { type: "array", items: { type: "string" } },
					smiles: { type: "string" },
					project: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.error !== undefined
						? [`chem_recipe_save failed: ${value.error}`]
						: [`saved recipe ${value.id}: ${value.title} (${value.createdAt})`]
				)
		},
		async execute(args) {
			try {
				const record = await chem.recipeSave(args);
				const { content, ...rest } = record;
				return rest;
			} catch (error) {
				return { error: error.message };
			}
		}
	});
}

/** chem_recipe_search — find past recipes by keyword. */
function recipeSearchTool(chem) {
	return defineTool({
		name: "chem_recipe_search",
		description:
			"Search the persistent chemistry recipe library by keyword over titles, content, tags, SMILES, and project. Returns the most recent matches first.",
		parameters: {
			query: { type: "string", required: true, description: "Search keywords; empty matches all recent entries." },
			limit: { type: "integer", description: "Max results (default 10, max 50)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					total: { type: "integer" },
					recipes: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								createdAt: { type: "string" },
								title: { type: "string" },
								tags: { type: "array", items: { type: "string" } },
								content: { type: "string" },
								smiles: { type: "string" },
								project: { type: "string" }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_recipe_search failed: ${value.error}`]);
				if (value.recipes.length === 0) return textBlocks(["no recipes match"]);
				const lines = [`${value.total} match(es):`];
				for (const r of value.recipes) {
					lines.push(
						`- [${r.id}] ${r.title} (${r.createdAt.slice(0, 10)})${r.project ? ` · ${r.project}` : ""}${r.tags.length > 0 ? ` · #${r.tags.join(" #")}` : ""}`,
						`  ${r.content.split("\n")[0].slice(0, 160)}`
					);
				}
				return textBlocks(lines);
			}
		},
		async execute(args) {
			try {
				return await chem.recipeSearch(args.query, args.limit ?? 10);
			} catch (error) {
				return { recipes: [], total: 0, error: error.message };
			}
		}
	});
}

/** chem_recipe_list — recent recipes. */
function recipeListTool(chem) {
	return defineTool({
		name: "chem_recipe_list",
		description: "List the most recent entries of the persistent chemistry recipe library.",
		parameters: {
			limit: { type: "integer", description: "Max results (default 20, max 200)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					total: { type: "integer" },
					recipes: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								createdAt: { type: "string" },
								title: { type: "string" },
								tags: { type: "array", items: { type: "string" } },
								content: { type: "string" },
								smiles: { type: "string" },
								project: { type: "string" }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_recipe_list failed: ${value.error}`]);
				if (value.recipes.length === 0) return textBlocks(["recipe library is empty"]);
				const lines = [`${value.total} recipe(s) total, showing ${value.recipes.length}:`];
				for (const r of value.recipes) {
					lines.push(`- [${r.id}] ${r.title} (${r.createdAt.slice(0, 10)})${r.tags.length > 0 ? ` · #${r.tags.join(" #")}` : ""}`);
				}
				return textBlocks(lines);
			}
		},
		async execute(args) {
			try {
				return await chem.recipeList(args.limit ?? 20);
			} catch (error) {
				return { recipes: [], total: 0, error: error.message };
			}
		}
	});
}

/** chem_papers — Crossref literature search (key-free, grounded). */
function papersTool(chem) {
	return defineTool({
		name: "chem_papers",
		description:
			"Search scholarly literature via Crossref by keyword. Returns up to `limit` papers with title, DOI, journal, year, authors, and abstract (when available). Use before making literature claims; cite the returned DOIs. No API key required.",
		parameters: {
			query: { type: "string", required: true, description: "Keyword query, e.g. 'Suzuki coupling palladium mechanism'." },
			limit: { type: "integer", description: "Max results (default 5, max 20)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					papers: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								title: { type: "string" },
								doi: { type: "string" },
								journal: { type: "string" },
								year: { type: "integer" },
								authors: { type: "array", items: { type: "string" } },
								abstract: { type: "string" }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_papers failed: ${value.error}`]);
				if (value.papers.length === 0) return textBlocks(["no papers found"]);
				const lines = value.papers.map(
					(p) =>
						`- ${p.year ?? "n.d."} ${p.authors?.slice(0, 3).join(", ") ?? ""} — ${p.title} (${p.journal ?? ""}) DOI: ${p.doi}`
				);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.papersSearch(args.query, args.limit ?? 5);
			return out;
		}
	});
}

/** chem_pdf — extract text from a local PDF (literature layer). */
function pdfTool(chem) {
	return defineTool({
		name: "chem_pdf",
		description:
			"Extract text from a local PDF file (up to maxPages pages / maxChars characters) so the paper's content can be analyzed and cited. Requires pymupdf in the engine's Python. Use on user-provided papers before summarizing or quoting them.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Absolute path of the PDF file on this machine."
			},
			maxPages: { type: "integer", description: "Pages to extract (default 20)." },
			maxChars: { type: "integer", description: "Character cap (default 200000)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: { type: "string" },
					totalPages: { type: "integer" },
					extractedPages: { type: "integer" },
					chars: { type: "integer" },
					truncated: { type: "boolean" },
					text: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.error !== undefined
						? [`chem_pdf failed: ${value.error}`]
						: [
								`PDF ${value.path}`,
								`pages: ${value.extractedPages}/${value.totalPages}, chars: ${value.chars}${value.truncated ? " (truncated)" : ""}`,
								"---",
								value.text.slice(0, 8000)
							]
				)
		},
		async execute(args) {
			const out = await chem.pdfText(args.path, {
				maxPages: args.maxPages ?? 20,
				maxChars: args.maxChars ?? 200000
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/* ── P5 tools: retrosynthesis ────────────────────────────────────────────── */

/** chem_retro_step — one template-based retrosynthetic disconnection. */
function retroStepTool(chem) {
	return defineTool({
		name: "chem_retro_step",
		description:
			"One retrosynthetic disconnection step over the built-in, hand-verified reaction template library (aryl ester/amide/ether/thioether cleavage, benzylic/allylic/biaryl C-C breaks, imine N-C). Returns precursor sets with template name, category, atom-conservation flag (atomConserved), SA score (synthetic accessibility; lower = easier), and a chemistry note. Use iteratively to build a synthesis plan: disconnect a precursor, then disconnect again. Templates are a deterministic skeleton-level abstraction — always sanity-check precursors chemically before reporting a route.",
		parameters: {
			smiles: {
				type: "string",
				required: true,
				description: "Target molecule SMILES to disconnect."
			},
			maxResults: {
				type: "integer",
				description: "Max precursor sets to return (default 10, max 30)."
			},
			minFragmentHeavy: {
				type: "integer",
				description: "Minimum heavy atoms per precursor fragment (default 2)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smiles: { type: "string" },
					count: { type: "integer" },
					steps: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								template: { type: "string" },
								category: { type: "string" },
								precursors: { type: "array", items: { type: "string" } },
								atomConserved: { type: "boolean" },
								saScore: { type: "number" },
								note: { type: "string" }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_retro_step failed: ${value.error}`]);
				if (value.count === 0) return textBlocks(["no disconnections found for this molecule"]);
				const lines = [`${value.count} disconnection(s) (atom-conserving first, by SA score):`];
				for (const s of value.steps) {
					const flag = s.atomConserved ? "conserved" : "TRUNCATED";
					lines.push(
						`- [${s.template}] ${s.precursors.join(" + ")}`,
						`  ${flag} · SA ${s.saScore ?? "-"} · ${s.note}`
					);
				}
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.retroStep(args.smiles, {
				maxResults: args.maxResults ?? 10,
				minFragmentHeavy: args.minFragmentHeavy ?? 2
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_functional_groups — SMARTS-based functional group recognition. */
function functionalGroupsTool(chem) {
	return defineTool({
		name: "chem_functional_groups",
		description:
			"Recognize functional groups in a molecule by SMARTS patterns: ketone, aldehyde, ester, carboxylic acid, amide, nitrile, alcohol, phenol, amines (primary/secondary/tertiary), aniline, nitro, azide, aryl/alkyl halide, alkene, alkyne, ether, thioether, sulfonamide, sulfone, boronic acid, aromatic ring. Returns each hit with occurrence count. Use to identify reactive handles before planning reactions or evaluating drug-likeness.",
		parameters: {
			smiles: { type: "string", required: true, description: "SMILES of the molecule." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smiles: { type: "string" },
					groups: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: { type: "string" },
								count: { type: "integer" }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_functional_groups failed: ${value.error}`]);
				if (value.groups.length === 0) return textBlocks(["no functional groups matched"]);
				const lines = value.groups.map((g) => `- ${g.name}: ${g.count}`);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.functionalGroups(args.smiles);
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_retro_plan — BFS retrosynthetic route planning. */
function retroPlanTool(chem) {
	return defineTool({
		name: "chem_retro_plan",
		description:
			"Plan a retrosynthetic route by breadth-first search over the built-in template library: disconnects atom-conserving bonds, continues from the most complex precursor, and terminates at commodity building blocks or trivially accessible molecules. Returns up to 5 routes, each a sequence of disconnection steps (template, precursors, terminal). Deterministic and skeleton-level — always validate routes against known chemistry and available starting materials before proposing a synthesis.",
		parameters: {
			smiles: { type: "string", required: true, description: "Target molecule SMILES." },
			maxDepth: { type: "integer", description: "Max disconnection depth (default 3, max 5)." },
			maxBranches: { type: "integer", description: "Max branches per expansion (default 3, max 10)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smiles: { type: "string" },
					plans: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								route: {
									type: "array",
									items: {
										type: "object",
										additionalProperties: false,
										properties: {
											smiles: { type: "string" },
											template: { type: "string" },
											category: { type: "string" },
											precursors: { type: "array", items: { type: "string" } },
											continueFrom: { type: "string" },
											terminals: { type: "array", items: { type: "string" } }
										}
									}
								},
								terminal: { type: "string" },
								reason: { type: "string" }
							}
						}
					},
					note: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_retro_plan failed: ${value.error}`]);
				if (value.plans.length === 0) return textBlocks([`no route found (${value.note ?? ""})`]);
				const lines = [];
				value.plans.forEach((plan, i) => {
					lines.push(`Route ${i + 1} (terminal: ${plan.terminal} — ${plan.reason}):`);
					for (const step of plan.route) {
						lines.push(
							`  ${step.template}: ${step.smiles} -> ${step.precursors.join(" + ")}` +
								(step.terminals.length > 0 ? `  [stop: ${step.terminals.join(", ")}]` : "")
						);
					}
				});
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.retroPlan(args.smiles, {
				maxDepth: args.maxDepth ?? 3,
				maxBranches: args.maxBranches ?? 3
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_reagents — forward-synthesis condition hints per reaction type. */
function reagentsTool(chem) {
	return defineTool({
		name: "chem_reagents",
		description:
			"Return typical forward-synthesis conditions for a reaction type (keyed by retro template name: ester_aryl, amide_aryl, ether_aryl, thioether_aryl, benzylic_C-C, allylic_C-C, biaryl_C-C, imine_N-C). Includes catalysts, bases, solvents, temperatures, and notes on the reverse (cleavage) conditions. Rule-of-thumb guidance — confirm against literature (chem_papers) before execution.",
		parameters: {
			template: {
				type: "string",
				required: true,
				description: "Reaction type name from chem_retro_step/chem_retro_plan."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					template: { type: "string" },
					reaction: { type: "string" },
					conditions: { type: "string" },
					notes: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.error !== undefined
						? [`chem_reagents failed: ${value.error}`]
						: [
								`${value.template}: ${value.reaction}`,
								`conditions: ${value.conditions}`,
								...(value.notes ? [`notes: ${value.notes}`] : [])
							]
				)
		},
		async execute(args) {
			const out = await chem.reagents(args.template);
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_aizynth — AiZynthFinder (ML policy) retrosynthesis. */
function aizynthTool(chem) {
	return defineTool({
		name: "chem_aizynth",
		description:
			"Advanced retrosynthesis with AiZynthFinder 4.4.1 (AstraZeneca; USPTO-trained expansion policy + ZINC purchasing stock, ONNX models) via the local PY314 port. Returns up to maxRoutes full reaction trees (nested reaction SMILES with atom mapping, template hash, stock availability). Slower than chem_retro_plan (model load ~15 s + search); first solutions usually appear within seconds. Prefer chem_retro_plan for quick deterministic disconnections and use this for real-world-grade route proposals — then sanity-check each route's reaction SMILES (e.g. with chem_reaction balance) before proposing a synthesis.",
		parameters: {
			smiles: { type: "string", required: true, description: "Target molecule SMILES." },
			timeoutSeconds: { type: "integer", description: "Search budget in seconds (default 60)." },
			maxRoutes: { type: "integer", description: "Max routes to return (default 5)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smiles: { type: "string" },
					searchTime_s: { type: "number" },
					firstSolutionTime_s: { type: "number" },
					numRoutes: { type: "integer" },
					routes: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								score: { type: "number" },
								reactionTree: { type: "object", additionalProperties: true }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_aizynth failed: ${value.error}`]);
				const lines = [
					`search: ${value.searchTime_s}s (first solution ${value.firstSolutionTime_s}s), ${value.numRoutes} route(s):`
				];
				for (const [i, r] of (value.routes ?? []).entries()) {
					const reactions = [];
					const walk = (node) => {
						if (node.type === "reaction" && typeof node.smiles === "string") reactions.push(node.smiles);
						for (const child of node.children ?? []) walk(child);
					};
					walk(r.reactionTree);
					lines.push(`Route ${i + 1} (score ${r.score}): ${reactions.join("  =>  ") || "(empty)"}`);
				}
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.aizynth(args.smiles, {
				timeoutSeconds: args.timeoutSeconds ?? 60,
				maxRoutes: args.maxRoutes ?? 5
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/* ── P6 tools: drug-likeness / similarity / clustering / enumeration ─────── */

/** chem_druglikeness — rule-based screening + QED + SA. */
function druglikenessTool(chem) {
	return defineTool({
		name: "chem_druglikeness",
		description:
			"Rule-based drug-likeness screening: Lipinski's rule of five, Veber rules, REOS, plus QED (quantitative estimate of drug-likeness) and SA score (synthetic accessibility). Returns each rule set with per-rule pass/fail details and an overall verdict. Rules are a first-pass filter, not ADMET — pair with chem_admet for model predictions.",
		parameters: {
			smiles: { type: "string", required: true, description: "Molecule SMILES." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smiles: { type: "string" },
					mw: { type: "number" },
					logp: { type: "number" },
					hbd: { type: "integer" },
					hba: { type: "integer" },
					tpsa: { type: "number" },
					rotatableBonds: { type: "integer" },
					heavyAtoms: { type: "integer" },
					formalCharge: { type: "integer" },
					qed: { type: "number" },
					saScore: { type: "number" },
					lipinski: { type: "object", additionalProperties: true },
					veber: { type: "object", additionalProperties: true },
					reos: { type: "object", additionalProperties: true },
					verdict: { type: "string" },
					note: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_druglikeness failed: ${value.error}`]);
				const lines = [
					`verdict: ${value.verdict}`,
					`MW ${value.mw}, logP ${value.logp}, HBD ${value.hbd}, HBA ${value.hba}, TPSA ${value.tpsa}, rot ${value.rotatableBonds}`,
					`QED ${value.qed}, SA ${value.saScore}`,
					`Lipinski: ${value.lipinski.passes ? "pass" : `violations: ${value.lipinski.violations.join(", ")}`}`,
					`Veber: ${value.veber.passes ? "pass" : `violations: ${value.veber.violations.join(", ")}`}`,
					`REOS: ${value.reos.passes ? "pass" : `violations: ${value.reos.violations.join(", ")}`}`
				];
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.druglikeness(args.smiles);
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_similarity — Tanimoto similarity against a target list. */
function similarityTool(chem) {
	return defineTool({
		name: "chem_similarity",
		description:
			"Compute Tanimoto similarity between one query molecule and a list of targets using Morgan (ECFP, default radius 2) or MACCS fingerprints. Results sorted by similarity. Use for hit expansion, analog searching, and scaffold hopping triage.",
		parameters: {
			smiles: { type: "string", required: true, description: "Query SMILES." },
			targets: { type: "array", items: { type: "string" }, required: true, description: "Target SMILES list (up to a few hundred)." },
			fingerprint: { type: "string", enum: ["morgan", "maccs"], description: "Fingerprint type (default morgan)." },
			radius: { type: "integer", description: "Morgan radius (default 2 = ECFP4)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					query: { type: "string" },
					fingerprint: { type: "string" },
					results: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								tanimoto: { type: "number" },
								invalid: { type: "boolean" }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_similarity failed: ${value.error}`]);
				const lines = value.results.map(
					(r) => `${r.invalid ? "[invalid] " : ""}${r.target} — ${r.tanimoto ?? "-"}`
				);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.similarity(args.smiles, args.targets, {
				fingerprint: args.fingerprint ?? "morgan",
				radius: args.radius ?? 2
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_cluster — Butina clustering + Murcko scaffolds. */
function clusterTool(chem) {
	return defineTool({
		name: "chem_cluster",
		description:
			"Cluster a SMILES list with Butina clustering (Morgan fingerprints, Tanimoto distance) and summarize Murcko scaffolds. Returns clusters with members, singleton count, and scaffold frequencies. Use to reduce a hit list to representative series.",
		parameters: {
			smiles: { type: "array", items: { type: "string" }, required: true, description: "SMILES list to cluster." },
			cutoff: { type: "number", description: "Similarity cutoff for clustering (default 0.4; 0.6 is stricter)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					cutoff: { type: "number" },
					numValid: { type: "integer" },
					numInvalid: { type: "integer" },
					invalid: { type: "array", items: { type: "string" } },
					numClusters: { type: "integer" },
					clusters: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "integer" },
								size: { type: "integer" },
								members: { type: "array", items: { type: "string" } }
							}
						}
					},
					numSingletons: { type: "integer" },
					murckoScaffolds: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								smiles: { type: "string" },
								count: { type: "integer" }
							}
						}
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_cluster failed: ${value.error}`]);
				const lines = [`${value.numClusters} clusters (${value.numSingletons} singletons), cutoff ${value.cutoff}:`];
				for (const c of value.clusters) {
					if (c.size > 1) lines.push(`- cluster ${c.id} (${c.size}): ${c.members.join(", ")}`);
				}
				lines.push(`scaffolds: ${value.murckoScaffolds.map((s) => `${s.smiles}×${s.count}`).join("  ")}`);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.cluster(args.smiles, { cutoff: args.cutoff ?? 0.4 });
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_mcs — maximum common substructure. */
function mcsTool(chem) {
	return defineTool({
		name: "chem_mcs",
		description:
			"Compute the maximum common substructure (MCS) between two molecules as a SMARTS pattern with atom/bond counts. Use to quantify scaffold overlap and guide bioisostere or SAR decisions.",
		parameters: {
			smilesA: { type: "string", required: true, description: "First molecule." },
			smilesB: { type: "string", required: true, description: "Second molecule." },
			ringMatchesRingOnly: { type: "boolean", description: "Ring atoms only match ring atoms (default true)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smilesA: { type: "string" },
					smilesB: { type: "string" },
					smarts: { type: "string" },
					numAtoms: { type: "integer" },
					numBonds: { type: "integer" },
					canceled: { type: "boolean" },
					error: { type: "string" }
				}
			},
			render: (_args, value) =>
				textBlocks(
					value.error !== undefined
						? [`chem_mcs failed: ${value.error}`]
						: [`MCS: ${value.numAtoms} atoms, ${value.numBonds} bonds${value.canceled ? " (timed out, partial)" : ""}`, `SMARTS: ${value.smarts}`]
				)
		},
		async execute(args) {
			const out = await chem.mcs(args.smilesA, args.smilesB, {
				ringMatchesRingOnly: args.ringMatchesRingOnly !== false
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_enumerate — R-group combinatorial enumeration. */
function enumerateTool(chem) {
	return defineTool({
		name: "chem_enumerate",
		description:
			"Enumerate a combinatorial library from a scaffold with dummy atoms and R-group substituent lists. Scaffold format: SMILES with dummy atoms, e.g. [*:1]c1ccccc1[*:2]; rgroups maps map numbers to substituent SMILES lists, e.g. {\"1\": [\"C\", \"N\", \"O\"], \"2\": [\"C\", \"CC\", \"Cl\"]}. Returns all canonical product combinations (deduplicated, capped by maxProducts). Pair with chem_druglikeness/chem_similarity for virtual screening.",
		parameters: {
			scaffold: { type: "string", required: true, description: "Scaffold SMILES with dummy atoms like [1*] or [*:1]." },
			rgroups: { type: "object", additionalProperties: true, required: true, description: "Map of dummy map number -> substituent SMILES list." },
			maxProducts: { type: "integer", description: "Cap on returned products (default 100)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					scaffold: { type: "string" },
					combinations: { type: "integer" },
					generated: { type: "integer" },
					failed: { type: "integer" },
					truncated: { type: "boolean" },
					products: { type: "array", items: { type: "string" } },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_enumerate failed: ${value.error}`]);
				const lines = [
					`${value.combinations} combinations, ${value.generated} unique products${value.failed ? ` (${value.failed} failed)` : ""}${value.truncated ? " [truncated]" : ""}:`
				];
				for (const p of value.products.slice(0, 20)) lines.push(`- ${p}`);
				if (value.products.length > 20) lines.push(`... (${value.products.length - 20} more)`);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.enumerate(args.scaffold, args.rgroups, {
				maxProducts: args.maxProducts ?? 100
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/** chem_admet — ADMET predictions via admet_ai (P6.3). */
function admetTool(chem) {
	return defineTool({
		name: "chem_admet",
		description:
			"Predict ADMET properties with admet_ai 2.0.1 (chemprop-based ensembles, ~100 endpoints covering absorption, distribution, metabolism (CYP), excretion, toxicity (Ames, hERG, hepatotoxicity, ...), solubility, permeability, and drug-likeness descriptors). Returns every endpoint as a number. Model load takes a few seconds per call. Values are MODEL PREDICTIONS — never present them as experimental data; cross-check critical endpoints against literature or assays before decisions.",
		parameters: {
			smiles: { type: "string", required: true, description: "Molecule SMILES." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smiles: { type: "string" },
					endpoints: { type: "object", additionalProperties: true },
					count: { type: "integer" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_admet failed: ${value.error}`]);
				const eps = value.endpoints ?? {};
				const keys = Object.keys(eps);
				const headline = keys.filter((k) => /ames|herg|hepatotox|bbb|solub|permeab|cyp|clearance|dili|cardio|neuro|respir|nephro|repro/i.test(k)).slice(0, 14);
				const lines = [`${value.count} endpoints (model predictions):`];
				for (const k of headline) lines.push(`- ${k}: ${eps[k]}`);
				if (keys.length > headline.length) lines.push(`... (${keys.length - headline.length} more; full set in structured output)`);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.admet(args.smiles);
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/* ── P7 tools: docking ───────────────────────────────────────────────────── */

/** chem_dock — AutoDock Vina molecular docking. */
function dockTool(chem) {
	return defineTool({
		name: "chem_dock",
		description:
			"Dock a SMILES ligand into a receptor PDB file with AutoDock Vina 1.2 (meeko ligand preparation + vina built-in receptor conversion). Requires a receptor PDB (e.g. downloaded from RCSB), the binding-site center [x, y, z] in angstroms, and an optional box size (default 20 Å cube). Returns poses sorted by affinity (kcal/mol) with RMSD from the best mode. Batch mode: set batch=true with smilesList (up to 5 ligands, same receptor/box) for hit-list ranking. Scoring is semi-empirical — treat affinities as docking scores, not binding free energies; validate hits with literature or experiments. The receptor is converted by vina's built-in converter (adequate for screening; rigorous studies should pre-prepare PDBQT with ADFRsuite).",
		parameters: {
			smiles: { type: "string", description: "Ligand SMILES (single mode; ignored in batch mode)." },
			receptor: { type: "string", required: true, description: "Absolute path to the receptor PDB file on this machine." },
			center: {
				type: "array",
				items: { type: "number" },
				required: true,
				description: "Binding-site center [x, y, z] in angstroms."
			},
			boxSize: { type: "array", items: { type: "number" }, description: "Search box [x, y, z] in angstroms (default [20, 20, 20])." },
			exhaustiveness: { type: "integer", description: "Search exhaustiveness (default 8; 16+ for better sampling, slower)." },
			batch: { type: "boolean", description: "Batch mode: dock multiple ligands (default false)." },
			smilesList: { type: "array", items: { type: "string" }, description: "Batch mode: ligand SMILES list (max 5)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					smiles: { type: "string" },
					receptor: { type: "string" },
					center: { type: "array", items: { type: "number" } },
					boxSize: { type: "array", items: { type: "number" } },
					numPoses: { type: "integer" },
					bestAffinity_kcal_mol: { type: "number" },
					poses: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								mode: { type: "integer" },
								affinity_kcal_mol: { type: "number" },
								rmsdLb: { type: "number" },
								rmsdUb: { type: "number" }
							}
						}
					},
					batch: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								smiles: { type: "string" },
								bestAffinity_kcal_mol: { type: "number" },
								numPoses: { type: "integer" },
								error: { type: "string" }
							}
						}
					},
					note: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_dock failed: ${value.error}`]);
				if (value.batch !== undefined) {
					const lines = ["batch docking (sorted by affinity):"];
					for (const b of value.batch) {
						lines.push(
							`  ${b.smiles.slice(0, 50)}: ${b.error ?? `${b.bestAffinity_kcal_mol} kcal/mol (${b.numPoses} poses)`}`
						);
					}
					lines.push(`note: ${value.note}`);
					return textBlocks(lines);
				}
				const lines = [
					`best: ${value.bestAffinity_kcal_mol} kcal/mol (${value.numPoses} poses):`
				];
				for (const p of value.poses) {
					lines.push(`  mode ${p.mode}: ${p.affinity_kcal_mol} kcal/mol (rmsd ${p.rmsdLb}/${p.rmsdUb})`);
				}
				lines.push(`note: ${value.note}`);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.dock(args.smiles, args.receptor, {
				center: args.center,
				boxSize: args.boxSize ?? [20, 20, 20],
				exhaustiveness: args.exhaustiveness ?? 8,
				batch: args.batch === true,
				smilesList: args.smilesList ?? []
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}

/* ── P8 tools: virtual screening ─────────────────────────────────────────── */

/** chem_screen — one-shot library-to-hits virtual screening pipeline. */
function screenTool(chem) {
	return defineTool({
		name: "chem_screen",
		description:
			"One-shot virtual screening pipeline: enumerate an R-group library (scaffold + rgroups), filter by drug-likeness rules (Lipinski/Veber must pass, QED >= minQed, SA <= maxSa), optionally filter by ADMET endpoint thresholds (admetFilter: true — one batch model call on rule-passing molecules; thresholds map endpoint names to upper limits, e.g. {\"hERG\": 0.5, \"AMES\": 0.5}), optionally rank by Tanimoto similarity to a reference molecule, and optionally write a markdown report (reportPath). Returns hits with QED/SA/Tanimoto and a failed list with reasons. Use to go from a combinatorial idea to a ranked candidate list in one call; follow up promising hits with chem_dock.",
		parameters: {
			scaffold: { type: "string", required: true, description: "Scaffold SMILES with dummy atoms, e.g. [*:1]c1ccccc1[*:2]." },
			rgroups: { type: "object", additionalProperties: true, required: true, description: "Map of dummy map number -> substituent SMILES list." },
			minQed: { type: "number", description: "Minimum QED to pass (default 0.3)." },
			maxSa: { type: "number", description: "Maximum SA score to pass (default 4.0)." },
			reference: { type: "string", description: "Reference SMILES for Tanimoto ranking of hits." },
			admetFilter: { type: "boolean", description: "Also filter by ADMET endpoint thresholds (adds model load time, default false)." },
			admetThresholds: { type: "object", additionalProperties: true, description: "ADMET endpoint upper limits, e.g. {\"hERG\": 0.5, \"AMES\": 0.5}." },
			reportPath: { type: "string", description: "Absolute path to write a markdown screening report." },
			maxProducts: { type: "integer", description: "Cap on enumerated products (default 200, max 500)." }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					scaffold: { type: "string" },
					combinations: { type: "integer" },
					generated: { type: "integer" },
					totalFailed: { type: "integer" },
					hits: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								smiles: { type: "string" },
								qed: { type: "number" },
								saScore: { type: "number" },
								verdict: { type: "string" },
								tanimoto: { type: "number" },
								admet: { type: "object", additionalProperties: true }
							}
						}
					},
					failed: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								smiles: { type: "string" },
								reasons: { type: "array", items: { type: "string" } }
							}
						}
					},
					admetFiltered: { type: "boolean" },
					reportPath: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (value.error !== undefined) return textBlocks([`chem_screen failed: ${value.error}`]);
				const lines = [
					`${value.combinations} combos -> ${value.hits.length} hits, ${value.totalFailed} failed${value.admetFiltered ? " (ADMET filtered)" : ""}:`
				];
				for (const h of value.hits) {
					lines.push(
						`  ${h.smiles} — QED ${h.qed ?? "-"}, SA ${h.saScore ?? "-"}${h.tanimoto !== undefined ? `, sim ${h.tanimoto}` : ""}`
					);
				}
				if (value.reportPath) lines.push(`report: ${value.reportPath}`);
				return textBlocks(lines);
			}
		},
		async execute(args) {
			const out = await chem.screen({
				scaffold: args.scaffold,
				rgroups: args.rgroups,
				maxProducts: args.maxProducts ?? 200,
				minQed: args.minQed ?? 0.3,
				maxSa: args.maxSa ?? 4.0,
				reference: args.reference,
				admetFilter: args.admetFilter === true,
				admetThresholds: args.admetThresholds ?? {},
				reportPath: args.reportPath
			});
			if (out.ok === false) return { error: out.error };
			return out.result;
		}
	});
}
