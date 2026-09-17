/**
 * @dshchem/dsh-chem-core — browser half.
 *
 * Renders structure depictions inside the chem_* tool call cards: parses the
 * call arguments for a SMILES, fetches the 2D SVG from the loopback-only
 * /api/dsh-chem/render-svg route, and shows it beside the tool output text.
 *
 * Plain JavaScript, no build step: this file is loaded by the browser module
 * table through the same `window.__ModuleLoader__.load` protocol the shipped
 * client bundles use; `require` resolves package names from the module table.
 */
window.__ModuleLoader__.load({
	id: "@dshchem/dsh-chem-core",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		const TOOL_KEYS = [
			"chem_validate",
			"chem_props",
			"chem_convert",
			"chem_pubchem",
			"chem_calc",
			"chem_reaction",
			"chem_papers",
			"chem_pdf",
			"chem_retro_step",
			"chem_functional_groups",
			"chem_retro_plan",
			"chem_reagents",
			"chem_aizynth",
			"chem_druglikeness",
			"chem_similarity",
			"chem_cluster",
			"chem_mcs",
			"chem_enumerate",
			"chem_admet",
			"chem_dock",
			"chem_screen"
		];

		/** Tool names whose args may carry a SMILES worth depicting. */
		const SMILES_ARG_TOOLS = new Set([
			"chem_validate",
			"chem_props",
			"chem_convert",
			"chem_calc",
			"chem_reaction",
			"chem_retro_step",
			"chem_functional_groups"
		]);

		function parseArgs(block, done) {
			const raw = done ? block.call?.argsRaw : block.argsRaw;
			if (typeof raw !== "string" || raw === "") return null;
			try {
				const parsed = JSON.parse(raw);
				return typeof parsed === "object" && parsed !== null ? parsed : null;
			} catch {
				return null;
			}
		}

		function resultText(node) {
			const parts = [];
			for (const block of node.content ?? []) {
				if (block.type === "text") parts.push(block.text);
				else parts.push(JSON.stringify(block, null, 2));
			}
			if (parts.length === 0 && node.error !== undefined) {
				parts.push(`${node.error.name}: ${node.error.code}`);
			}
			return parts.join("\n");
		}

		/** Extract the SMILES to depict, or null. */
		function smilesFromArgs(toolName, args) {
			if (args === null || !SMILES_ARG_TOOLS.has(toolName)) return null;
			const value = args.smiles;
			if (typeof value === "string" && value.trim() !== "") return value.trim();
			// chem_reaction may pass reactants/smarts; only depict explicit molecules.
			return null;
		}

		/** Fetch the 2D SVG depiction for a SMILES, scaled to fit the card. */
		function fetchDepiction(smiles) {
			const url = `/api/dsh-chem/render-svg?smiles=${encodeURIComponent(smiles)}`;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 15000);
			return fetch(url, { signal: controller.signal })
				.then((response) => {
					if (!response.ok) throw new Error(`render-svg http ${response.status}`);
					return response.text();
				})
				.then((content) => {
					// RDKit emits fixed 480x360; keep the viewBox and let the card
					// container scale the picture instead of overflowing it.
					return content.replace(
						/width='[^']*' height='[^']*'/,
						"width='100%' height='100%'"
					);
				})
				.catch((error) => {
					throw new Error(
						error?.name === "AbortError"
							? "render-svg timeout"
							: `render-svg failed: ${error.message}`
					);
				})
				.finally(() => clearTimeout(timer));
		}

		/**
		 * One chem_* tool call card: title row, optional structure depiction,
		 * and the settled result text (or a running placeholder).
		 */
		function ChemToolCard(props) {
			const { toolName, block } = props;
			const done = "kind" in block;
			const args = parseArgs(block, done);
			const text = done ? resultText(block) : null;
			const state = !done ? "running" : block.isError ? "error" : "ok";
			const smiles = smilesFromArgs(toolName, args);
			// chem_validate renders "Invalid SMILES: ..." for bad input — skip the
			// depiction request entirely instead of surfacing a render 400.
			const invalidSmiles = text !== null && /^Invalid SMILES/.test(text);
			const [depiction, setDepiction] = React.useState({ status: "idle", svg: null, error: null });

			React.useEffect(() => {
				if (!done || smiles === null || invalidSmiles) return;
				let cancelled = false;
				setDepiction({ status: "loading", svg: null, error: null });
				fetchDepiction(smiles)
					.then((svg) => {
						if (!cancelled) setDepiction({ status: "ok", svg, error: null });
					})
					.catch((error) => {
						if (!cancelled) setDepiction({ status: "error", svg: null, error: error.message });
					});
				return () => {
					cancelled = true;
				};
			}, [done, smiles, invalidSmiles]);

			// 3D viewer (P7): lazy-load 3Dmol.js from CDN, render the ETKDG XYZ.
			const [view3d, setView3d] = React.useState(false);
			const [viewer3d, setViewer3d] = React.useState(null);
			const viewerRef = React.useRef(null);

			const load3Dmol = () =>
				new Promise((resolve, reject) => {
					if (window.$3Dmol) return resolve(window.$3Dmol);
					// Local vendored copy first (same-origin, deterministic);
					// CDN sources are fallbacks only — a hanging CDN script
					// request never fires onerror and would leave viewers stuck
					// at "loading" forever (observed in the P9 audit). A total
					// 15s timeout guarantees the promise always settles.
					const sources = [
						"/api/dsh-chem/3dmol.js",
						"https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/3Dmol-min.js",
						"https://unpkg.com/3dmol@2.4.2/build/3Dmol-min.js"
					];
					let index = 0;
					let settled = false;
					const finish = (error) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						if (error) reject(error);
						else resolve(window.$3Dmol);
					};
					const timer = setTimeout(() => finish(new Error("3Dmol.js 加载超时")), 15000);
					const tryLoad = () => {
						if (settled) return;
						if (index >= sources.length) {
							finish(new Error("3Dmol.js 加载失败（本地与 CDN 均不可用）"));
							return;
						}
						const script = document.createElement("script");
						script.src = sources[index++];
						script.onload = () => (window.$3Dmol ? finish(null) : finish(new Error("3Dmol.js 加载异常")));
						script.onerror = () => {
							script.remove();
							tryLoad();
						};
						document.head.append(script);
					};
					tryLoad();
				});

			React.useEffect(() => {
				if (!view3d || smiles === null || !done) return;
				let cancelled = false;
				setViewer3d({ status: "loading", error: null });
				load3Dmol()
					.then(() =>
						fetch(`/api/dsh-chem/xyz?smiles=${encodeURIComponent(smiles)}`).then((response) => {
							if (!response.ok) throw new Error(`xyz http ${response.status}`);
							return response.text();
						})
					)
					.then((xyz) => {
						if (cancelled) return;
						const el = viewerRef.current;
						if (!el) return;
						const viewer = window.$3Dmol.createViewer(el, { backgroundColor: "white" });
						viewer.addModel(xyz, "xyz");
						viewer.setStyle({}, { stick: { radius: 0.18 }, sphere: { scale: 0.22 } });
						viewer.zoomTo();
						viewer.render();
						setViewer3d({ status: "ok", error: null });
					})
					.catch((error) => {
						if (!cancelled) setViewer3d({ status: "error", error: error.message });
					});
				return () => {
					cancelled = true;
				};
			}, [view3d, smiles, done]);

			// Complex viewer (P9): dock card only — render receptor + best pose.
			const dockArgs =
				toolName === "chem_dock" && args !== null && typeof args.receptor === "string" && Array.isArray(args.center)
					? { receptor: args.receptor, center: args.center }
					: null;
			const [complexView, setComplexView] = React.useState({ status: "idle", error: null });
			const complexRef = React.useRef(null);
			// dockArgs is a fresh object every render; holding it in a ref keeps
			// the effect dependencies stable — an object dep would re-run the
			// effect on every re-render, cancel the in-flight fetch, and leave
			// the card stuck at "对接计算中…" forever (observed in P9 audit).
			const dockArgsRef = React.useRef(dockArgs);
			dockArgsRef.current = dockArgs;

			React.useEffect(() => {
				if (complexView.status !== "loading") return;
				const dock = dockArgsRef.current;
				if (dock === null || smiles === null || !done) return;
				let cancelled = false;
				load3Dmol()
					.then(() => {
						const center = dock.center.map(Number).join(",");
						return fetch(
							`/api/dsh-chem/complex?smiles=${encodeURIComponent(smiles)}&receptor=${encodeURIComponent(dock.receptor)}&center=${encodeURIComponent(center)}`
						).then((response) => {
							if (!response.ok) throw new Error(`complex http ${response.status}`);
							return response.json();
						});
					})
					.then((data) => {
						if (cancelled) return;
						const el = complexRef.current;
						if (!el) return;
						const viewer = window.$3Dmol.createViewer(el, { backgroundColor: "white" });
						viewer.addModel(data.receptorPdb, "pdb");
						viewer.setStyle({}, { cartoon: { color: "spectrum" } });
						viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.45, color: "white" });
						if (typeof data.poseXyz === "string") {
							viewer.addModel(data.poseXyz, "xyz");
							viewer.setStyle(
								{ model: 1 },
								{ stick: { radius: 0.22, color: "#ff8c00" }, sphere: { scale: 0.25, color: "#ff8c00" } }
							);
						}
						viewer.zoomTo();
						viewer.render();
						setComplexView({ status: "ok", error: null });
					})
					.catch((error) => {
						if (!cancelled) setComplexView({ status: "error", error: error.message });
					});
				return () => {
					cancelled = true;
				};
			}, [complexView.status, smiles, done]);

			const summary = args === null ? "" : Object.keys(args).slice(0, 3).join(", ");
			return React.createElement(
				"div",
				{
					style: {
						border: "1px solid var(--dsw-alias-border-l1)",
						borderRadius: 12,
						margin: "4px 0",
						padding: "8px 12px",
						fontFamily: "var(--dsw-font-family)",
						fontSize: 13,
						color: "var(--dsw-alias-label-primary)",
						background: "var(--dsw-alias-bg-base)"
					}
				},
				React.createElement(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } },
					React.createElement(
						"span",
						{
							style: {
								fontWeight: 600,
								fontSize: 12,
								color: "var(--dsw-alias-label-secondary)"
							}
						},
						toolName
					),
					React.createElement(
						"span",
						{
							style: {
								fontSize: 11,
								color:
									state === "error"
										? "var(--dsw-alias-state-error-primary)"
										: state === "running"
											? "var(--dsw-alias-label-tertiary)"
											: "var(--dsw-alias-label-tertiary)"
							}
						},
						state === "running" ? "计算中…" : state === "error" ? "错误" : "完成"
					),
					summary !== "" &&
						React.createElement(
							"span",
							{ style: { flex: 1, color: "var(--dsw-alias-label-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 } },
							summary
						)
				),
				smiles !== null &&
					!invalidSmiles &&
					React.createElement(
						"div",
						{
							style: {
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
								padding: 6,
								borderRadius: 8,
								background: "#ffffff",
								margin: "4px 0",
								overflow: "hidden"
							}
						},
						depiction.status === "error"
							? React.createElement(
									"span",
									{
										style: {
											fontSize: 11,
											color: /Invalid SMILES/.test(depiction.error)
												? "var(--dsw-alias-label-tertiary)"
												: "var(--dsw-alias-state-error-primary)"
										}
									},
									/Invalid SMILES/.test(depiction.error)
										? "无效 SMILES（无法渲染结构图）"
										: `结构图加载失败: ${depiction.error}`
								)
							: React.createElement("div", {
									style: { width: 220, height: 165 },
									dangerouslySetInnerHTML: {
										__html:
											depiction.svg ??
											(depiction.status === "loading" ? "<!-- loading depiction -->" : "")
									}
								})
					),
				smiles !== null &&
					!invalidSmiles &&
					React.createElement(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 8, margin: "2px 0 4px" } },
						React.createElement(
							"button",
							{
								type: "button",
								onClick: () => setView3d((v) => !v),
								style: {
									fontSize: 11,
									cursor: "pointer",
									border: "1px solid var(--dsw-alias-border-l2)",
									borderRadius: 999,
									background: "var(--dsw-alias-bg-base)",
									color: "var(--dsw-alias-label-secondary)",
									padding: "2px 10px"
								}
							},
							view3d ? "关闭 3D" : "3D 查看"
						),
						viewer3d?.status === "error" &&
							React.createElement(
								"span",
								{ style: { fontSize: 11, color: "var(--dsw-alias-state-error-primary)" } },
								`3D 不可用: ${viewer3d.error}`
							)
					),
				view3d &&
					React.createElement("div", {
						ref: viewerRef,
						// position:relative is REQUIRED — 3Dmol's canvas is
						// absolutely positioned inside the container, and without
						// a positioned ancestor it escapes to the page body and
						// renders at the top-left corner (observed in P7 audit).
						style: { position: "relative", width: "100%", height: 260, borderRadius: 8, margin: "2px 0 4px", background: "#ffffff" }
					}),
				dockArgs !== null &&
					React.createElement(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 8, margin: "2px 0 4px" } },
						React.createElement(
							"button",
							{
								type: "button",
								onClick: () =>
									setComplexView((v) => (v.status === "loading" ? v : { status: "loading", error: null })),
								style: {
									fontSize: 11,
									cursor: "pointer",
									border: "1px solid var(--dsw-alias-border-l2)",
									borderRadius: 999,
									background: "var(--dsw-alias-bg-base)",
									color: "var(--dsw-alias-label-secondary)",
									padding: "2px 10px"
								}
							},
							complexView.status === "loading" ? "对接计算中…" : "对接查看（受体+配体）"
						),
						complexView.status === "error" &&
							React.createElement(
								"span",
								{ style: { fontSize: 11, color: "var(--dsw-alias-state-error-primary)" } },
								`复合物不可用: ${complexView.error}`
							)
					),
				complexView.status === "loading" &&
					React.createElement("div", {
						ref: complexRef,
						style: { position: "relative", width: "100%", height: 320, borderRadius: 8, margin: "2px 0 4px", background: "#ffffff" }
					}),
				text !== null &&
					React.createElement(
						"pre",
						{
							style: {
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								margin: 0,
								maxHeight: 240,
								overflowY: "auto",
								fontFamily: "var(--dsw-font-markdown-code-block-small)",
								fontSize: 12,
								color: "var(--dsw-alias-label-secondary)",
								background: "var(--dsw-alias-markdown-code-block)",
								borderRadius: 8,
								padding: "8px 10px"
							}
						},
						text
					)
			);
		}

		/**
		 * Register the chem_* tool card views into the keyed tool.call.toolview
		 * slot. Each key is additive: no shipped tool uses these names.
		 * `inject: ["slots"]` (exported below) makes Cordis wait until the slots
		 * service exists before activating this plugin — without it, apply runs
		 * early, ctx.get("slots") is undefined, and registration silently never
		 * happens (observed 2026-08-14: generic tool rows rendered instead of
		 * the structure cards).
		 */
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) {
				console.error("[dsh-chem] slots service unavailable; tool cards not registered");
				return;
			}
			console.log("[dsh-chem] client active; registering", TOOL_KEYS.length, "tool card views");
			for (const key of TOOL_KEYS) {
				slots.inject("tool.call.toolview", () =>
					slots.register(
						{ name: "tool.call.toolview", key: key },
						(props) => React.createElement(ChemToolCard, props)
					)
				);
			}
		}

		/** Hard dependency: the slots service (provided by dsh-client-runtime). */
		const inject = ["slots"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
