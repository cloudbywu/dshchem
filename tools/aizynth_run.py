#!/usr/bin/env python3
"""aizynth_run.py — AiZynthFinder retrosynthetic search runner.

Executed by the PY314-ported venv (aizynthfinder 4.4.1 does not install on the
system Python 3.14 without the port; see aizynthfinder_dsh_314/README-PY314.md).
chem_engine's op_aizynth spawns this script; stdin carries the JSON request,
stdout carries the JSON response.

Request:  {"smiles": "...", "config": "...", "timeoutSeconds": 60, "maxRoutes": 5}
Response: {"ok": true, "result": {...}} | {"ok": false, "error": "..."}
"""
import json
import os
import sys
import time


def _valid_fragments(part):
    """Every dot-separated fragment of a reaction side parses as a molecule."""
    from rdkit import Chem

    for frag in part.split("."):
        if not frag.strip():
            return False
        if Chem.MolFromSmiles(frag.strip()) is None:
            return False
    return True


def fix_reaction_smiles(node, target_smiles=None):
    """Repair reaction-node SMILES inside a to_dict() reaction tree.

    AiZynthFinder 4.4.1 serializes `rxn.smiles` — a SMARTS-template-derived
    string that can be invalid (e.g. aromatic carbon written as [cH3:5],
    observed in the P5-AiZynth audit). The complete, molecule-level string
    lives in metadata["mapped_reaction_smiles"]; fall back to rebuilding
    `target>>products` from the tree's own molecule nodes. Every reaction
    node gains a `smilesValid` flag so consumers can trust the string.
    """
    from rdkit import Chem

    if node.get("type") == "reaction":
        valid = False
        raw = node.get("smiles")
        meta = node.get("metadata") or {}
        mapped = meta.get("mapped_reaction_smiles")
        if isinstance(mapped, str) and ">>" in mapped:
            lhs, rhs = mapped.split(">>", 1)
            if _valid_fragments(lhs) and _valid_fragments(rhs):
                node["smiles"] = mapped
                valid = True
        if not valid and isinstance(raw, str) and ">>" in raw:
            lhs, rhs = raw.split(">>", 1)
            if _valid_fragments(lhs) and _valid_fragments(rhs):
                valid = True
        if not valid and target_smiles is not None and _valid_fragments(target_smiles):
            products = [
                child.get("smiles")
                for child in node.get("children") or []
                if child.get("type") == "mol" and isinstance(child.get("smiles"), str)
            ]
            if products and all(_valid_fragments(p) for p in products):
                node["smiles"] = f"{target_smiles}>>{'.'.join(products)}"
                valid = True
        node["smilesValid"] = valid
        if not valid:
            # keep the raw string for inspection but mark it broken
            node["smiles"] = raw or ""
    # the "target" for deeper reaction nodes is this node's own smiles when
    # this node is a molecule
    child_target = node.get("smiles") if node.get("type") == "mol" else target_smiles
    for child in node.get("children") or []:
        fix_reaction_smiles(child, child_target)


def main():
    try:
        raw = sys.stdin.read()
        req = json.loads(raw) if raw.strip() else {}
        smiles = str(req.get("smiles", "")).strip()
        if not smiles:
            print(json.dumps({"ok": False, "error": "smiles required"}))
            return 1
        # Pre-validate with RDKit: prepare_tree() would otherwise raise an
        # internal AttributeError on an invalid target and leak a Python
        # stack through the JSON error (observed in the P5-AiZynth audit).
        from rdkit import Chem, RDLogger

        RDLogger.DisableLog("rdApp.error")  # keep stderr clean
        if Chem.MolFromSmiles(smiles) is None:
            print(json.dumps({"ok": False, "error": f"invalid SMILES: {smiles!r}"}))
            return 1
        config = str(req.get("config", "")).strip() or os.environ.get("AIZYNTH_CONFIG", "")
        if not config or not os.path.isfile(config):
            print(json.dumps({"ok": False, "error": f"aizynth config not found: {config!r}"}))
            return 1

        from aizynthfinder.aizynthfinder import AiZynthFinder

        t0 = time.time()
        finder = AiZynthFinder(configfile=config)
        finder.expansion_policy.select("uspto")
        finder.stock.select("zinc")
        finder.filter_policy.select("uspto")
        finder.max_time = float(req.get("timeoutSeconds", 60))
        finder.target_smiles = smiles
        finder.prepare_tree()
        finder.tree_search()
        finder.build_routes()
        search_time = time.time() - t0
        stats = finder.extract_statistics()

        routes = []
        route_count = max(int(req.get("maxRoutes", 5)), 1)
        for idx in range(min(route_count, len(finder.routes))):
            route = finder.routes[idx]
            tree = route["reaction_tree"]
            tree_dict = tree.to_dict()
            fix_reaction_smiles(tree_dict)
            routes.append({
                "score": float(route.get("score", {}).get("state score", 0.0)),
                "reactionTree": tree_dict,
            })
        print(json.dumps({
            "ok": True,
            "result": {
                "smiles": smiles,
                "searchTime_s": round(search_time, 2),
                "firstSolutionTime_s": stats.get("first_solution_time"),
                "numRoutes": len(routes),
                "routes": routes,
            },
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        import traceback

        traceback.print_exc(file=sys.stderr)  # diagnostics only, never in JSON
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
