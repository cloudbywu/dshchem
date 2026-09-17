#!/usr/bin/env python3
"""chem_engine.py — deterministic chemistry engine for the dsh-chem-core plugin.

Reads one JSON request from stdin: {"op": <op>, "args": {...}}
Writes one JSON response to stdout: {"ok": true, "result": {...}} | {"ok": false, "error": "..."}

Ops:
  validate  {smiles}                 -> canonical SMILES + identity fields
  props     {smiles, iupac?}         -> molecular descriptors (RDKit)
  convert   {smiles, format}         -> canonical | inchi | inchikey | mol | sdf | svg
  calc      {smiles, method?, optimize?} -> ASE single-point/relaxation energy
                                            (emt built-in | xtb if installed)
  reaction  {mode:"balance", reaction} | {mode:"template", smarts, reactants}
                                      -> atom-conservation check | SMARTS product prediction
  pdftext   {path, maxPages?, maxChars?} -> PyMuPDF text extraction (literature layer)

Facts only, no LLM: every output is computed by RDKit/ASE. The LLM must not
invent structures or properties; this engine is the source of truth.
"""
import json
import os
import shutil
import sys

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, Crippen, Descriptors, QED, rdMolDescriptors
from rdkit.Chem.Draw import rdMolDraw2D

RDLogger.DisableLog("rdApp.error")  # keep stderr clean; errors are structured JSON

SUPPORTED_CONVERT = {"canonical", "inchi", "inchikey", "mol", "sdf", "svg", "xyz"}
SUPPORTED_CALC = {"emt", "xtb"}
MAX_CALC_HEAVY_ATOMS = 60
HARTREE_TO_EV = 27.211386245988


def _canonical(mol):
    return Chem.MolToSmiles(mol, isomericSmiles=True)


def op_validate(args):
    smiles = str(args.get("smiles", "")).strip()
    if not smiles:
        return {"ok": False, "error": "smiles must be a non-empty string"}
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    result = {
        "valid": True,
        "canonical": _canonical(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "inchi": Chem.inchi.MolToInchi(mol),
        "inchikey": Chem.inchi.MolToInchiKey(mol),
        "heavyAtoms": rdMolDescriptors.CalcNumHeavyAtoms(mol),
    }
    return {"ok": True, "result": result}


def op_props(args):
    smiles = str(args.get("smiles", "")).strip()
    want_iupac = bool(args.get("iupac", False))
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    result = {
        "canonical": _canonical(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "mw": round(Descriptors.MolWt(mol), 3),
        "exactMw": round(rdMolDescriptors.CalcExactMolWt(mol), 4),
        "logp": round(Crippen.MolLogP(mol), 2),
        "hbd": rdMolDescriptors.CalcNumHBD(mol),
        "hba": rdMolDescriptors.CalcNumHBA(mol),
        "tpsa": round(rdMolDescriptors.CalcTPSA(mol), 2),
        "rotatableBonds": rdMolDescriptors.CalcNumRotatableBonds(mol),
        "aromaticRings": rdMolDescriptors.CalcNumAromaticRings(mol),
        "heavyAtoms": rdMolDescriptors.CalcNumHeavyAtoms(mol),
        "formalCharge": Chem.GetFormalCharge(mol),
    }
    if want_iupac:
        try:
            result["iupacName"] = Chem.MolToIUPACName(mol)
        except Exception as exc:  # IUPAC naming can fail for exotic molecules
            result["iupacName"] = None
            result["iupacError"] = str(exc)
    return {"ok": True, "result": result}


def op_convert(args):
    smiles = str(args.get("smiles", "")).strip()
    fmt = str(args.get("format", "canonical")).strip().lower()
    if fmt not in SUPPORTED_CONVERT:
        return {"ok": False, "error": f"unsupported format {fmt!r}; choose from {sorted(SUPPORTED_CONVERT)}"}
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    if fmt == "canonical":
        return {"ok": True, "result": {"format": "canonical", "content": _canonical(mol)}}
    if fmt == "inchi":
        return {"ok": True, "result": {"format": "inchi", "content": Chem.inchi.MolToInchi(mol)}}
    if fmt == "inchikey":
        return {"ok": True, "result": {"format": "inchikey", "content": Chem.inchi.MolToInchiKey(mol)}}
    if fmt == "mol":
        return {"ok": True, "result": {"format": "mol", "content": Chem.MolToMolBlock(mol)}}
    if fmt == "sdf":
        return {"ok": True, "result": {"format": "sdf", "content": Chem.MolToMolBlock(mol) + "$$$$"}
                }
    if fmt == "xyz":
        # 3D coordinates via ETKDG embedding (used by the browser 3D viewer)
        atoms, embed_error = _embed_ase_atoms(smiles)
        if atoms is None:
            return {"ok": False, "error": embed_error}
        lines = [str(len(atoms)), _canonical(mol)]
        for symbol, position in zip(atoms.get_chemical_symbols(), atoms.positions):
            lines.append(f"{symbol:2s} {position[0]:10.4f} {position[1]:10.4f} {position[2]:10.4f}")
        return {"ok": True, "result": {"format": "xyz", "content": "\n".join(lines)}}
    # svg — 2D depiction
    drawer = rdMolDraw2D.MolDraw2DSVG(480, 360)
    rdMolDraw2D.PrepareAndDrawMolecule(drawer, mol)
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    return {"ok": True, "result": {"format": "svg", "content": svg}}


def _embed_ase_atoms(smiles):
    """SMILES -> ASE Atoms via RDKit 3D embedding (ETKDG)."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None, f"invalid SMILES: {smiles!r}"
    if rdMolDescriptors.CalcNumHeavyAtoms(mol) > MAX_CALC_HEAVY_ATOMS:
        return None, f"too many heavy atoms for calc (> {MAX_CALC_HEAVY_ATOMS})"
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xF00D
    if AllChem.EmbedMolecule(mol, params) != 0:
        return None, "3D embedding failed for this SMILES"
    conf = mol.GetConformer()
    from ase import Atoms

    atoms = Atoms(
        [a.GetSymbol() for a in mol.GetAtoms()],
        positions=conf.GetPositions(),  # angstroms
    )
    return atoms, None


def _run_xtb(atoms, charge, optimize, xtb_command, gfn=2, timeout_s=150):
    """Run the xtb binary directly (ase 3.29 ships no xtb calculator).

    Writes an XYZ file into a temp dir, invokes `xtb ... --gfn <n> --chrg <c>
    --uhf <s> [--opt] --parallel 1`, and parses the final `TOTAL ENERGY`
    (Eh). Returns (energy_eV, relaxed, stdout_tail) or raises.
    """
    import shutil
    import subprocess
    import tempfile

    if shutil.which(xtb_command) is None and not os.path.isfile(xtb_command):
        raise RuntimeError(
            f"xtb executable not found: {xtb_command!r} (set chem-core config xtbPath or XTB_COMMAND)"
        )
    n_electrons = sum(atoms.get_atomic_numbers()) - charge
    uhf = n_electrons % 2  # simple high-spin default for unpaired electrons
    with tempfile.TemporaryDirectory(prefix="dshchem-xtb-") as tmp:
        xyz = os.path.join(tmp, "input.xyz")
        atoms.write(xyz)
        cmd = [
            xtb_command, xyz,
            "--gfn", str(gfn),
            "--chrg", str(charge),
            "--uhf", str(uhf),
            "--parallel", "1",
        ]
        if optimize:
            cmd.append("--opt")
        proc = subprocess.run(
            cmd,
            cwd=tmp,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
            raise RuntimeError(f"xtb exited {proc.returncode}: {' | '.join(tail)}")
        total = None
        for line in proc.stdout.splitlines():
            if "TOTAL ENERGY" in line.upper():
                match = __import__("re").search(r"[-+]?\d+\.\d+", line)
                if match:
                    total = float(match.group())
        if total is None:
            raise RuntimeError(f"xtb output lacked TOTAL ENERGY:\n{proc.stdout[-500:]}")
        return total * HARTREE_TO_EV, optimize, proc.stdout[-400:]


def op_calc(args):
    """Single-point / relaxation energy. emt is built-in (ASE, fast, rough);
    xtb calls the GFN2-xTB binary directly. Energies are eV per molecule."""
    smiles = str(args.get("smiles", "")).strip()
    method = str(args.get("method", "emt")).strip().lower()
    optimize = bool(args.get("optimize", True))
    xtb_command = str(args.get("xtbCommand", "")).strip() or os.environ.get("XTB_COMMAND", "xtb")
    # Fallback: machines that bundle xtb under ~/.dsh/chem/bin but do not put it
    # on PATH (and cannot set chem-core config without a restart). Takes effect
    # immediately because the engine is re-spawned per request.
    if shutil.which(xtb_command) is None and not os.path.isfile(xtb_command):
        bundled = os.path.join(
            os.path.expanduser("~"), ".dsh", "chem", "bin", "xtb-6.7.1", "bin", "xtb.exe"
        )
        if os.path.isfile(bundled):
            xtb_command = bundled
    if method not in SUPPORTED_CALC:
        return {"ok": False, "error": f"unsupported method {method!r}; choose from {sorted(SUPPORTED_CALC)}"}
    atoms, embed_error = _embed_ase_atoms(smiles)
    if atoms is None:
        return {"ok": False, "error": embed_error}
    try:
        if method == "emt":
            from ase.calculators.emt import EMT

            atoms.calc = EMT()
            e_before = atoms.get_potential_energy()
            relaxed = False
            if optimize:
                from ase.optimize import BFGS

                dyn = BFGS(atoms, logfile=None)
                dyn.run(fmax=0.05)
                relaxed = True
            e_after = atoms.get_potential_energy()
            result = {
                "method": method,
                "optimize": optimize,
                "relaxed": relaxed,
                "nAtoms": len(atoms),
                "formula": atoms.get_chemical_formula(),
                "energyBefore_eV": round(e_before, 4),
                "energyAfter_eV": round(e_after, 4),
                "delta_eV": round(e_after - e_before, 4),
                "unit": "eV (per molecule)",
                "note": "EMT is a rough embedded-atom potential; qualitative only.",
            }
        else:
            charge = int(args.get("charge", 0))
            e_after, relaxed, tail = _run_xtb(
                atoms, charge, optimize, xtb_command, gfn=2, timeout_s=int(args.get("xtbTimeoutMs", 150000)) // 1000
            )
            result = {
                "method": "xtb (GFN2-xTB)",
                "optimize": optimize,
                "relaxed": relaxed,
                "nAtoms": len(atoms),
                "formula": atoms.get_chemical_formula(),
                "energyAfter_eV": round(e_after, 4),
                "unit": "eV (per molecule)",
                "note": "GFN2-xTB semi-empirical; treat as qualitative (typical error a few kcal/mol for neutral closed-shell organics).",
            }
        return {"ok": True, "result": result}
    except Exception as exc:
        return {"ok": False, "error": f"calc failed: {type(exc).__name__}: {exc}"}


def _element_counts(smiles):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None, f"invalid SMILES: {smiles!r}"
    counts = {}
    for atom in mol.GetAtoms():
        symbol = atom.GetSymbol()
        counts[symbol] = counts.get(symbol, 0) + 1
    return counts, None


def _sum_counts(fragments):
    total = {}
    for counts in fragments:
        for symbol, n in counts.items():
            total[symbol] = total.get(symbol, 0) + n
    return total


def op_reaction(args):
    """mode=balance: atom-conservation check of "A.B>>C.D".
    mode=template: run a SMARTS reaction template over reactants."""
    mode = str(args.get("mode", "balance")).strip().lower()
    if mode == "balance":
        reaction = str(args.get("reaction", "")).strip()
        if ">>" not in reaction:
            return {"ok": False, "error": "reaction must contain '>>' (e.g. 'A.B>>C.D')"}
        lhs, rhs = reaction.split(">>", 1)
        lhs_counts = []
        for frag in lhs.split("."):
            counts, err = _element_counts(frag.strip())
            if err is not None:
                return {"ok": False, "error": f"lhs {frag!r}: {err}"}
            lhs_counts.append(counts)
        rhs_counts = []
        for frag in rhs.split("."):
            counts, err = _element_counts(frag.strip())
            if err is not None:
                return {"ok": False, "error": f"rhs {frag!r}: {err}"}
            rhs_counts.append(counts)
        left = _sum_counts(lhs_counts)
        right = _sum_counts(rhs_counts)
        elements = sorted(set(left) | set(right))
        diffs = {el: left.get(el, 0) - right.get(el, 0) for el in elements if left.get(el, 0) != right.get(el, 0)}
        return {
            "ok": True,
            "result": {
                "balanced": len(diffs) == 0,
                "lhsElements": left,
                "rhsElements": right,
                "imbalance": diffs,
                "note": "element counts only; charges and electrons are not checked",
            },
        }
    if mode == "template":
        smarts = str(args.get("smarts", "")).strip()
        reactants = str(args.get("reactants", "")).strip()
        rxn = AllChem.ReactionFromSmarts(smarts)
        if rxn is None:
            return {"ok": False, "error": f"invalid reaction SMARTS: {smarts!r}"}
        fragments = [f.strip() for f in reactants.split(".") if f.strip()]
        mols = []
        for frag in fragments:
            mol = Chem.MolFromSmiles(frag)
            if mol is None:
                return {"ok": False, "error": f"invalid reactant SMILES: {frag!r}"}
            mols.append(mol)
        try:
            outcomes = rxn.RunReactants(tuple(mols))
        except Exception as exc:
            return {"ok": False, "error": f"template run failed: {type(exc).__name__}: {exc}"}
        if not outcomes:
            return {"ok": True, "result": {"matched": False, "products": []}}
        max_results = int(args.get("maxResults", 5))
        products = []
        for outcome in outcomes[:max_results]:
            products.append([_canonical(m) for m in outcome])
        return {"ok": True, "result": {"matched": True, "products": products}}
    return {"ok": False, "error": f"unsupported reaction mode {mode!r}; choose balance|template"}


def op_pdftext(args):
    """Extract text from a local PDF (literature layer; requires pymupdf)."""
    path = str(args.get("path", "")).strip()
    if not path or not os.path.isfile(path):
        return {"ok": False, "error": f"file not found: {path!r}"}
    max_pages = int(args.get("maxPages", 20))
    max_chars = int(args.get("maxChars", 200000))
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        return {"ok": False, "error": f"pymupdf not installed: {exc}"}
    try:
        doc = fitz.open(path)
    except Exception as exc:
        return {"ok": False, "error": f"cannot open PDF: {type(exc).__name__}: {exc}"}
    total_pages = doc.page_count
    extracted = min(total_pages, max_pages)
    chunks = []
    chars = 0
    for index in range(extracted):
        text = doc[index].get_text()
        chunks.append(f"--- page {index + 1} ---\n{text}")
        chars += len(text)
        if chars >= max_chars:
            break
    doc.close()
    return {
        "ok": True,
        "result": {
            "path": path,
            "totalPages": total_pages,
            "extractedPages": len(chunks),
            "chars": chars,
            "truncated": chars >= max_chars,
            "text": "".join(chunks)[:max_chars],
        },
    }


# ── P5: retrosynthesis (deterministic template layer) ───────────────────────

# Atom-conserving disconnection templates, written in the retrosynthetic
# direction: the reactant side matches the TARGET (product) and the product
# side yields the PRECURSORS. Every entry is hand-verified on real molecules
# (2026-08-14): mapped RING atoms keep their ring environment, so aryl-side
# disconnections are complete; generic alkyl-side disconnections drop
# unmapped chain neighbors, so they are excluded. Results carry an
# `atomConserved` flag; conserved disconnections sort first.
# (AiZynthFinder evaluation: v4.4.1 requires Python <3.13; unavailable on
# this Python 3.14 host, so the deterministic template layer is the engine.)
RETRO_TEMPLATES = [
    # (name, category, retro_smarts, note)
    ("ester_aryl", "carbonyl", "[C:1](=[O:2])[O:3][c:4]>>[C:1](=[O:2])[O:3].[c:4]",
     "aryl ester hydrolysis: acyl-O break -> carboxylic acid + phenol/aryl alcohol"),
    ("amide_aryl", "carbonyl", "[C:1](=[O:2])[N:3][c:4]>>[C:1](=[O:2])[N:3].[c:4]",
     "anilide N-C(aryl) disconnection -> acyl fragment + aniline/aryl amine"),
    ("ether_aryl", "ether", "[C:1][O:2][c:3]>>[C:1][O:2].[c:3]",
     "aryl ether: break O-aryl -> alcohol/ether fragment + phenol/aryl"),
    ("thioether_aryl", "sulfur", "[C:1][S:2][c:3]>>[C:1][S:2].[c:3]",
     "aryl thioether: break S-aryl -> thiol fragment + aryl"),
    ("benzylic_C-C", "C-C", "[c:1][CH2:2][C:3]>>[c:1][CH2:2].[C:3]",
     "benzylic C-C disconnection -> benzyl fragment + alkyl"),
    ("allylic_C-C", "C-C", "[C:1]=[C:2][CH2:3][C:4]>>[C:1]=[C:2][CH2:3].[C:4]",
     "allylic C-C disconnection -> allyl fragment + alkyl"),
    ("biaryl_C-C", "C-C", "[c:1]-[c:2]>>[c:1].[c:2]",
     "biaryl C-C disconnection -> two aryl fragments"),
    ("imine_N-C", "carbonyl", "[C:1]=[N:2][C:3]>>[C:1]=[N:2].[C:3]",
     "imine: break N-C -> imine fragment + alkyl/aryl"),
]

# Functional-group SMARTS for chem_functional_groups (P5.1).
FG_SMARTS = {
    "ketone": "[#6][CX3](=O)[#6]",
    "aldehyde": "[CX3H1](=O)[#6]",
    "ester": "[#6][CX3](=O)[OX2][#6]",
    "carboxylic_acid": "[CX3](=O)[OX2H1]",
    "amide": "[CX3](=O)[NX3]",
    "nitrile": "[CX2]#[NX1]",
    "alcohol": "[OX2H][CX4]",
    "phenol": "[OX2H][cX3]",
    "primary_amine": "[NX3H2][CX4]",
    "secondary_amine": "[NX3H1]([CX4])[CX4]",
    "tertiary_amine": "[NX3]([CX4])([CX4])[CX4]",
    "aniline": "[NX3H2][cX3]",
    "nitro": "[$([NX3+](=O)[O-]),$([NX3](=O)=O)]",
    "azide": "[NX1-]=[NX2+]=[NX1]",
    "aryl_halide": "[cX3][F,Cl,Br,I]",
    "alkyl_halide": "[CX4][F,Cl,Br,I]",
    "alkene": "[CX3]=[CX3]",
    "alkyne": "[CX2]#[CX2]",
    "ether": "[OX2]([CX4])[CX4]",
    "thioether": "[SX2]([CX4])[CX4]",
    "sulfonamide": "[$([SX4](=O)(=O)[NX3])]",
    "sulfone": "[$([SX4](=O)(=O)[#6])]",
    "boronic_acid": "[BX3]([OX2H])[OX2H]",
    "aromatic_ring": "[a]",
}


def _sa_score(smiles):
    """Synthetic accessibility score (RDKit contrib sascorer). None on failure."""
    try:
        from rdkit import RDConfig

        sa_dir = os.path.join(RDConfig.RDContribDir, "SA_Score")
        if sa_dir not in sys.path:
            sys.path.append(sa_dir)
        import sascorer  # noqa: F401  (import check; contrib dir on path)

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return float(sascorer.calculateScore(mol))
    except Exception:
        return None


def op_retro_step(args):
    """One retrosynthetic disconnection step over the built-in template library.

    Returns precursor sets with template name/category, atom conservation
    enforced, and SA-score ordering (synthesis bottleneck first).
    """
    smiles = str(args.get("smiles", "")).strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    max_results = min(int(args.get("maxResults", 10)), 30)
    min_fragment_heavy = max(int(args.get("minFragmentHeavy", 2)), 1)
    results = []
    target_heavy = mol.GetNumHeavyAtoms()
    target_canonical = _canonical(mol)
    for name, category, smarts, note in RETRO_TEMPLATES:
        rxn = AllChem.ReactionFromSmarts(smarts)
        if rxn is None:
            continue
        try:
            outcomes = rxn.RunReactants((mol,))
        except Exception:
            continue
        for outcome in outcomes:
            frags = []
            ok = True
            for fragment in outcome:
                if fragment.GetNumAtoms() == 0:
                    ok = False
                    break
                try:
                    canonical = _canonical(fragment)
                except Exception:
                    ok = False
                    break
                if not canonical:
                    ok = False
                    break
                frags.append(canonical)
            if not ok or not frags:
                continue
            heavy = sum(Chem.MolFromSmiles(f).GetNumHeavyAtoms() for f in frags)
            conserved = heavy == target_heavy
            if heavy > target_heavy:
                continue  # template manufactured atoms — never accept
            if any(Chem.MolFromSmiles(f).GetNumHeavyAtoms() < min_fragment_heavy for f in frags):
                continue
            if len(frags) == 1 and frags[0] == target_canonical:
                continue  # no-op disconnection
            scores = [_sa_score(f) for f in frags]
            finite = [s for s in scores if s is not None]
            sa = max(finite) if finite else None
            entry = {
                "template": name,
                "category": category,
                "precursors": frags,
                "atomConserved": conserved,
                "note": note,
            }
            if sa is not None:  # omit, never null (schema rejects null)
                entry["saScore"] = round(sa, 2)
            results.append(entry)
    # de-duplicate precursor sets
    seen = set()
    dedup = []
    for entry in results:
        key = tuple(entry["precursors"])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(entry)
    dedup.sort(key=lambda e: (
        not e["atomConserved"],
        e["saScore"] is None,
        e["saScore"] if e["saScore"] is not None else 1e9,
    ))
    return {
        "ok": True,
        "result": {
            "smiles": target_canonical,
            "count": len(dedup),
            "steps": dedup[:max_results],
        },
    }


def op_functional_groups(args):
    """Recognize functional groups by SMARTS; returns name + occurrence count."""
    smiles = str(args.get("smiles", "")).strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    groups = []
    for name, smarts in FG_SMARTS.items():
        pattern = Chem.MolFromSmarts(smarts)
        if pattern is None:
            continue
        matches = mol.GetSubstructMatches(pattern)
        if matches:
            groups.append({"name": name, "count": len(matches)})
    return {"ok": True, "result": {"smiles": _canonical(mol), "groups": groups}}


# Common commodity building blocks for route termination (canonical SMILES).
BUILDING_BLOCKS = {
    "C", "O", "N", "Cl", "Br", "CO", "CCO", "CC", "C=O", "CC=O", "c1ccccc1",
    "Cc1ccccc1", "Nc1ccccc1", "Oc1ccccc1", "Clc1ccccc1", "Brc1ccccc1",
    "C1=CC=CC=C1", "CN", "CCN", "C1COC1", "CC(C)C", "C=C", "C#C", "N#C",
}


def op_retro_plan(args):
    """Breadth-first retrosynthetic route planning over the template library.

    Each expansion disconnects the current target (retro_step), keeps
    atom-conserved disconnections, and continues from the most complex
    precursor (highest SA score); other precursors become route terminals.
    Terminates at a commodity building block, a trivially accessible
    molecule (SA < 2.5), or the depth budget.
    """
    smiles = str(args.get("smiles", "")).strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    max_depth = min(int(args.get("maxDepth", 3)), 5)
    max_branches = min(int(args.get("maxBranches", 3)), 10)
    budget = min(int(args.get("budget", 24)), 100)
    target = _canonical(mol)
    queue = [(target, [])]
    visited = {target}
    plans = []
    while queue and budget > 0:
        budget -= 1
        current, steps = queue.pop(0)
        if current in BUILDING_BLOCKS:
            plans.append({"route": steps, "terminal": current, "reason": "building block"})
            continue
        current_sa = _sa_score(current)
        current_heavy = Chem.MolFromSmiles(current).GetNumHeavyAtoms()
        if current_sa is not None and current_sa < 1.8 and current_heavy <= 8:
            plans.append({"route": steps, "terminal": current, "reason": f"easy (SA {current_sa:.1f})"})
            continue
        if len(steps) >= max_depth:
            plans.append({"route": steps, "terminal": current, "reason": "depth budget reached"})
            continue
        step = op_retro_step({"smiles": current, "maxResults": 12, "minFragmentHeavy": 2})
        if step["ok"] is not True or step["result"]["count"] == 0:
            plans.append({"route": steps, "terminal": current, "reason": "no more disconnections"})
            continue
        expansions = 0
        for entry in step["result"]["steps"]:
            if not entry["atomConserved"]:
                continue
            frags = entry["precursors"]
            # continue from the most complex precursor (heavy-atom count
            # first, then SA — SA alone is too flat between small molecules);
            # the rest are terminals
            def _complexity(frag):
                mol = Chem.MolFromSmiles(frag)
                return (mol.GetNumHeavyAtoms() if mol else 0, _sa_score(frag) or 10.0)

            hardest = max(frags, key=_complexity)
            others = [f for f in frags if f != hardest]
            next_steps = steps + [{
                "smiles": current,
                "template": entry["template"],
                "category": entry["category"],
                "precursors": frags,
                "continueFrom": hardest,
                "terminals": others,
            }]
            if hardest not in visited or len(steps) + 1 < max_depth:
                visited.add(hardest)
                queue.append((hardest, next_steps))
            else:
                plans.append({"route": next_steps, "terminal": hardest, "reason": "already explored / cycle"})
            expansions += 1
            if expansions >= max_branches:
                break
    if not plans:
        return {"ok": True, "result": {"smiles": target, "plans": [], "note": "no route found within budget"}}
    # de-duplicate plans by route signature, keep the shortest first
    seen = set()
    dedup = []
    for plan in sorted(plans, key=lambda p: len(p["route"])):
        sig = tuple((s["template"], tuple(s["precursors"])) for s in plan["route"])
        if sig in seen:
            continue
        seen.add(sig)
        dedup.append(plan)
    return {"ok": True, "result": {"smiles": target, "plans": dedup[:5]}}


# Forward-synthesis condition hints keyed by retro template name (P5.3).
REAGENT_RULES = {
    "ester_aryl": {
        "reaction": "aryl ester from carboxylic acid + phenol",
        "conditions": "acid + phenol, EDC·HCl/DMAP (DCM) or H2SO4 cat. (toluene, reflux); or acyl chloride + phenol, pyridine/DMAP",
        "notes": "hydrolysis back: NaOH/EtOH reflux or LiOH/THF/H2O",
    },
    "amide_aryl": {
        "reaction": "anilide from carboxylic acid + aniline",
        "conditions": "EDC·HCl/HOBt or HATU/DIPEA (DMF); or acyl chloride + aniline, pyridine",
        "notes": "hydrolysis: 6M HCl reflux or NaOH/EtOH",
    },
    "ether_aryl": {
        "reaction": "aryl ether (Williamson)",
        "conditions": "phenol + alkyl halide, K2CO3 (DMF, 60-100 °C); or phenol + alcohol, Mitsunobu (DEAD/PPh3)",
        "notes": "cleavage back: BBr3 (DCM, -78 °C) or HBr/AcOH",
    },
    "thioether_aryl": {
        "reaction": "aryl thioether",
        "conditions": "thiol + aryl halide, Pd or Cu catalysis (e.g. Pd2(dba)3/Xantphos, DIPEA, toluene); or thiol + alkyl halide, base",
        "notes": "",
    },
    "benzylic_C-C": {
        "reaction": "benzyl-alkyl bond",
        "conditions": "Friedel-Crafts benzylation (ArCH2X + Ar'H, AlCl3 or FeCl3); or benzylic Grignard/organolithium + electrophile; or Suzuki (benzyl boronate)",
        "notes": "retro break is a simplification; C-C bond formation often needs a specific disconnection chosen by polarity",
    },
    "allylic_C-C": {
        "reaction": "allylic C-C bond",
        "conditions": "allylation (allyl-MgBr/ZnBr + aldehyde/ketone); or Tsuji-Trost (Pd, allyl carbonate + nucleophile)",
        "notes": "",
    },
    "biaryl_C-C": {
        "reaction": "biaryl coupling",
        "conditions": "Suzuki-Miyaura: ArB(OH)2 + Ar'X, Pd(PPh3)4 or Pd(dppf)Cl2, K2CO3/Na2CO3, toluene/H2O or dioxane, 80-110 °C",
        "notes": "alternatives: Negishi, Stille, Kumada; or direct C-H arylation",
    },
    "imine_N-C": {
        "reaction": "imine formation",
        "conditions": "amine + aldehyde/ketone, MgSO4 or 4Å MS (DCM or EtOH), cat. AcOH optional",
        "notes": "reduce with NaBH4/NaBH3CN for amine product",
    },
}


def op_reagents(args):
    """Forward-synthesis condition hints for a given retro template name."""
    template = str(args.get("template", "")).strip()
    rule = REAGENT_RULES.get(template)
    if rule is None:
        return {"ok": False, "error": f"unknown template {template!r}; known: {sorted(REAGENT_RULES)}"}
    return {"ok": True, "result": {"template": template, **rule}}


def op_aizynth(args):
    """Advanced retrosynthesis via the PY314-ported AiZynthFinder 4.4.1.

    The system Python cannot import aizynthfinder (Requires-Python <3.13); the
    port lives in a dedicated venv (aizynthfinder_dsh_314/venv314, see
    tools/aizynth_run.py). This op spawns that venv's python per request.
    """
    import subprocess

    smiles = str(args.get("smiles", "")).strip()
    if not smiles:
        return {"ok": False, "error": "smiles must be a non-empty string"}
    venv_python = (
        str(args.get("venvPython", "")).strip()
        or os.environ.get("AIZYNTH_PYTHON", "")
        or "C:/Users/cloud/Desktop/aizynthfinder_dsh_314/venv314/Scripts/python.exe"
    )
    config = (
        str(args.get("config", "")).strip()
        or os.environ.get("AIZYNTH_CONFIG", "")
        or "C:/Users/cloud/Desktop/aizynthfinder_dsh_314/data/config.yml"
    )
    runner = os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "aizynth_run.py"
    ))
    if not os.path.isfile(venv_python):
        return {"ok": False, "error": f"aizynth venv python not found: {venv_python!r} (set AIZYNTH_PYTHON)"}
    if not os.path.isfile(config):
        return {"ok": False, "error": f"aizynth config not found: {config!r} (set AIZYNTH_CONFIG)"}
    if not os.path.isfile(runner):
        return {"ok": False, "error": f"aizynth runner not found: {runner!r}"}
    request = {
        "smiles": smiles,
        "config": config,
        "timeoutSeconds": int(args.get("timeoutSeconds", 60)),
        "maxRoutes": int(args.get("maxRoutes", 5)),
    }
    try:
        proc = subprocess.run(
            [venv_python, runner],
            input=json.dumps(request),
            capture_output=True,
            text=True,
            timeout=int(args.get("subprocessTimeoutMs", 170000)) // 1000,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "aizynth search timed out (increase timeoutSeconds)"}
    if proc.returncode != 0:
        # The runner's contract is a JSON error on stdout even on failure;
        # prefer it over stderr so RDKit log noise never leaks into errors.
        try:
            parsed = json.loads(proc.stdout)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        tail = (proc.stderr or proc.stdout or "").strip()[-400:]
        return {"ok": False, "error": f"aizynth runner failed: {tail}"}
    try:
        return json.loads(proc.stdout)
    except Exception:
        return {"ok": False, "error": f"aizynth runner returned invalid JSON: {proc.stdout[:300]}"}


# ── P6: drug-likeness / similarity / clustering / enumeration ──────────────


def op_druglikeness(args):
    """Rule-based drug-likeness + QED + SA score (RDKit-native, P6.1)."""
    smiles = str(args.get("smiles", "")).strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    mw = Descriptors.MolWt(mol)
    logp = Crippen.MolLogP(mol)
    hbd = rdMolDescriptors.CalcNumHBD(mol)
    hba = rdMolDescriptors.CalcNumHBA(mol)
    tpsa = rdMolDescriptors.CalcTPSA(mol)
    rot = rdMolDescriptors.CalcNumRotatableBonds(mol)
    heavy = rdMolDescriptors.CalcNumHeavyAtoms(mol)
    charge = Chem.GetFormalCharge(mol)

    def rules(items):
        return {
            "passes": all(ok for _, ok, _ in items),
            "violations": [name for name, ok, _ in items if not ok],
            "details": {name: {"value": round(value, 2) if isinstance(value, float) else value, "passes": ok} for name, ok, value in items},
        }

    lipinski = rules([
        ("MW <= 500", mw <= 500, mw),
        ("logP <= 5", logp <= 5, logp),
        ("HBD <= 5", hbd <= 5, hbd),
        ("HBA <= 10", hba <= 10, hba),
    ])
    veber = rules([
        ("rotatable bonds <= 10", rot <= 10, rot),
        ("TPSA <= 140", tpsa <= 140, tpsa),
    ])
    reos = rules([
        ("MW 200-500", 200 <= mw <= 500, mw),
        ("-5 <= logP <= 5", -5 <= logp <= 5, logp),
        ("HBD <= 5", hbd <= 5, hbd),
        ("HBA <= 10", hba <= 10, hba),
        ("formal charge in [-2, 2]", -2 <= charge <= 2, charge),
    ])
    try:
        qed = round(float(QED.qed(mol)), 3)
    except Exception:
        qed = None
    sa = _sa_score(smiles)
    overall_passes = lipinski["passes"] and veber["passes"]
    verdict = (
        "drug-like" if overall_passes else
        "borderline" if sum(1 for v in lipinski["violations"] + veber["violations"] if True) <= 2 else
        "not drug-like"
    )
    result = {
        "smiles": _canonical(mol),
        "mw": round(mw, 2),
        "logp": round(logp, 2),
        "hbd": hbd,
        "hba": hba,
        "tpsa": round(tpsa, 1),
        "rotatableBonds": rot,
        "heavyAtoms": heavy,
        "formalCharge": charge,
        "lipinski": lipinski,
        "veber": veber,
        "reos": reos,
        "verdict": verdict,
        "note": "rule-based screening only; ADMET requires experimental or model data (see chem_admet)",
    }
    if qed is not None:  # omit, never null (schema rejects null)
        result["qed"] = qed
    if sa is not None:
        result["saScore"] = round(sa, 2)
    return {"ok": True, "result": result}


def _fingerprint(mol, fp_type, radius, nbits):
    from rdkit.Chem import MACCSkeys
    from rdkit.DataStructs import ConvertToNumpyArray  # noqa: F401  (import check)

    if fp_type == "maccs":
        return MACCSkeys.GenMACCSKeys(mol)
    return rdMolDescriptors.GetMorganFingerprintAsBitVect(mol, radius, nBits=nbits)


def op_similarity(args):
    """Tanimoto similarity of one query against a list of targets (P6.2)."""
    from rdkit.DataStructs import TanimotoSimilarity

    query = str(args.get("smiles", "")).strip()
    targets = args.get("targets", [])
    if not isinstance(targets, list) or not targets:
        return {"ok": False, "error": "targets must be a non-empty list of SMILES"}
    fp_type = str(args.get("fingerprint", "morgan")).strip().lower()
    if fp_type not in ("morgan", "maccs"):
        return {"ok": False, "error": f"unsupported fingerprint {fp_type!r}; choose morgan|maccs"}
    radius = int(args.get("radius", 2))
    nbits = int(args.get("nbits", 2048))
    qmol = Chem.MolFromSmiles(query)
    if qmol is None:
        return {"ok": False, "error": f"invalid query SMILES: {query!r}"}
    qfp = _fingerprint(qmol, fp_type, radius, nbits)
    results = []
    for target in targets:
        tmol = Chem.MolFromSmiles(target)
        if tmol is None:
            # mark invalid; omit tanimoto entirely (schema rejects null)
            results.append({"target": target, "invalid": True})
            continue
        tfp = _fingerprint(tmol, fp_type, radius, nbits)
        results.append({
            "target": _canonical(tmol),
            "tanimoto": round(float(TanimotoSimilarity(qfp, tfp)), 4),
            "invalid": False,
        })
    results.sort(key=lambda r: (r["invalid"], -(r.get("tanimoto") or 0)))
    return {
        "ok": True,
        "result": {
            "query": _canonical(qmol),
            "fingerprint": fp_type,
            "results": results,
        },
    }


def op_cluster(args):
    """Butina clustering + Murcko scaffold analysis (P6.2)."""
    from rdkit import DataStructs
    from rdkit.Chem.Scaffolds import MurckoScaffold
    from rdkit.ML.Cluster import Butina

    smiles_list = args.get("smiles", [])
    if not isinstance(smiles_list, list) or not smiles_list:
        return {"ok": False, "error": "smiles must be a non-empty list"}
    cutoff = float(args.get("cutoff", 0.4))
    radius = int(args.get("radius", 2))
    nbits = int(args.get("nbits", 2048))
    mols = []
    invalid = []
    for s in smiles_list:
        mol = Chem.MolFromSmiles(s)
        if mol is None:
            invalid.append(s)
        else:
            mols.append(mol)
    if not mols:
        return {"ok": False, "error": "no valid SMILES in the input list"}
    fps = [_fingerprint(m, "morgan", radius, nbits) for m in mols]
    # Butina.ClusterData clusters pairs whose distFunc value is BELOW the
    # threshold (distance semantics). Default distFunc is Euclidean distance,
    # useless for 2048-bit fingerprints, so pass an explicit Tanimoto
    # DISTANCE (1 - similarity) and threshold 1 - cutoff (verified 2026-08-14).
    def _tanimoto_distance(a, b):
        return 1.0 - DataStructs.TanimotoSimilarity(a, b)

    clusters = Butina.ClusterData(
        fps, len(fps), 1.0 - cutoff, isDistData=False, distFunc=_tanimoto_distance
    )
    cluster_out = []
    for index, members in enumerate(clusters):
        cluster_out.append({
            "id": index,
            "size": len(members),
            "members": [_canonical(mols[i]) for i in members],
        })
    scaffolds = {}
    for mol in mols:
        scaf = MurckoScaffold.MurckoScaffoldSmiles(_canonical(mol))
        if scaf:
            scaffolds[scaf] = scaffolds.get(scaf, 0) + 1
    scaffold_out = [{"smiles": s, "count": c} for s, c in sorted(scaffolds.items(), key=lambda kv: -kv[1])]
    singletons = [c for c in cluster_out if c["size"] == 1]
    return {
        "ok": True,
        "result": {
            "cutoff": cutoff,
            "numValid": len(mols),
            "numInvalid": len(invalid),
            "invalid": invalid,
            "numClusters": len(cluster_out),
            "clusters": cluster_out,
            "numSingletons": len(singletons),
            "murckoScaffolds": scaffold_out,
        },
    }


def op_mcs(args):
    """Maximum common substructure between two molecules (P6.2)."""
    from rdkit.Chem import rdFMCS

    a = str(args.get("smilesA", "")).strip()
    b = str(args.get("smilesB", "")).strip()
    ma = Chem.MolFromSmiles(a)
    mb = Chem.MolFromSmiles(b)
    if ma is None:
        return {"ok": False, "error": f"invalid SMILES A: {a!r}"}
    if mb is None:
        return {"ok": False, "error": f"invalid SMILES B: {b!r}"}
    mcs = rdFMCS.FindMCS(
        [ma, mb],
        timeout=int(args.get("timeout", 10)),
        ringMatchesRingOnly=bool(args.get("ringMatchesRingOnly", True)),
        completeRingsOnly=False,
    )
    return {
        "ok": True,
        "result": {
            "smilesA": _canonical(ma),
            "smilesB": _canonical(mb),
            "smarts": mcs.smartsString,
            "numAtoms": mcs.numAtoms,
            "numBonds": mcs.numBonds,
            "canceled": mcs.canceled,
        },
    }


def op_enumerate(args):
    """R-group combinatorial enumeration from a dummy-atom scaffold (P6.4)."""
    import itertools

    scaffold = str(args.get("scaffold", "")).strip()
    rgroups = args.get("rgroups", {})
    if not isinstance(rgroups, dict) or not rgroups:
        return {"ok": False, "error": "rgroups must be a dict of {mapnum: [SMILES...]}"}
    scaffold_mol = Chem.MolFromSmiles(scaffold)
    if scaffold_mol is None:
        return {"ok": False, "error": f"invalid scaffold SMILES: {scaffold!r}"}
    dummies = [(a.GetIdx(), a.GetAtomMapNum()) for a in scaffold_mol.GetAtoms() if a.GetAtomicNum() == 0]
    if not dummies:
        return {"ok": False, "error": "scaffold must contain dummy atoms like [1*], [2*]"}
    missing = [str(n) for _, n in dummies if str(n) not in rgroups]
    if missing:
        return {"ok": False, "error": f"rgroups missing for dummy map numbers: {missing}"}
    for key in rgroups:
        rgroups[key] = [str(s).strip() for s in rgroups[key]]
        rgroups[key] = [s for s in rgroups[key] if s]
    if any(not rgroups[str(n)] for _, n in dummies):
        return {"ok": False, "error": "every mapped R-group needs at least one substituent"}
    max_products = max(int(args.get("maxProducts", 100)), 1)
    combos = list(itertools.product(*[rgroups[str(n)] for _, n in dummies]))
    truncated = len(combos) > max_products
    products = []
    failed = 0
    for combo in combos[:max_products]:
        # string-template substitution: single-atom fragments splice
        # directly, multi-atom fragments are parenthesized
        template = scaffold
        ok = True
        for (_, mapnum), sub in zip(dummies, combo):
            sub_mol = Chem.MolFromSmiles(sub)
            if sub_mol is None:
                ok = False
                break
            fragment = sub if sub_mol.GetNumAtoms() == 1 else f"({sub})"
            template = template.replace(f"[{mapnum}*]", fragment).replace(f"[*:{mapnum}]", fragment)
        if not ok:
            failed += 1
            continue
        product = Chem.MolFromSmiles(template)
        if product is None:
            failed += 1
            continue
        products.append(_canonical(product))
    # de-duplicate
    seen = set()
    dedup = []
    for p in products:
        if p in seen:
            continue
        seen.add(p)
        dedup.append(p)
    return {
        "ok": True,
        "result": {
            "scaffold": scaffold,
            "combinations": len(combos),
            "generated": len(dedup),
            "failed": failed,
            "truncated": truncated,
            "products": dedup,
        },
    }


def op_admet(args):
    """ADMET predictions via admet_ai 2.0.1 (chemprop ensembles, ~100 keys).

    Model load takes a few seconds per process (engine is re-spawned per
    request), so this op runs on the slow bridge budget. Keys include RDKit
    descriptors (molecular_weight, logP, Lipinski, QED, ...) plus ADMET
    endpoint predictions (probabilities 0-1 for classification, values for
    regression). Values are model predictions — cite the model, not
    experiments.
    """
    smiles = str(args.get("smiles", "")).strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    try:
        from admet_ai import ADMETModel
    except ImportError as exc:
        return {"ok": False, "error": f"admet_ai unavailable: {exc} (pip install admet_ai torch torchvision)"}
    # admet_ai writes progress bars ("Predicting ...") to STDOUT, which would
    # corrupt the engine's JSON-over-stdout contract — redirect to stderr.
    import contextlib
    import io

    try:
        with contextlib.redirect_stdout(io.StringIO()):
            model = ADMETModel()
            predictions = model.predict(smiles)
    except Exception as exc:
        return {"ok": False, "error": f"admet failed: {type(exc).__name__}: {exc}"}
    if not isinstance(predictions, dict):
        return {"ok": False, "error": f"admet_ai returned unexpected type: {type(predictions).__name__}"}
    clean = {}
    for key, value in predictions.items():
        if isinstance(value, float):
            clean[str(key)] = round(value, 4)
        elif isinstance(value, (int, str, bool)) or value is None:
            clean[str(key)] = value
        else:
            clean[str(key)] = str(value)
    return {"ok": True, "result": {"smiles": _canonical(mol), "endpoints": clean, "count": len(clean)}}


# ── P7: molecular docking (AutoDock Vina + meeko) ───────────────────────────


def op_dock(args):
    """Dock a SMILES ligand into a receptor PDB with AutoDock Vina 1.2.

    Ligand prep: RDKit 3D embedding + meeko PDBQT. Receptor: vina's built-in
    PDB -> PDBQT conversion (adequate for screening; rigorous studies should
    pre-prepare PDBQT with ADFRsuite). Returns poses sorted by affinity
    (kcal/mol) with RMSD from the best mode.

    Batch mode (`batch: true`, `smilesList`): docks up to 5 ligands against
    the same receptor/box, serialized; the slow bridge budget bounds the run.
    """
    import shutil
    import subprocess
    import tempfile

    if bool(args.get("batch")):
        smiles_list = args.get("smilesList", [])
        if not isinstance(smiles_list, list) or not smiles_list:
            return {"ok": False, "error": "batch mode requires smilesList"}
        if len(smiles_list) > 5:
            return {"ok": False, "error": "batch mode supports at most 5 ligands per call"}
        results = []
        for smiles in smiles_list:
            single = dict(args)
            single.pop("batch", None)
            single.pop("smilesList", None)
            single["smiles"] = str(smiles).strip()
            out = op_dock(single)
            if out["ok"] is True:
                r = out["result"]
                results.append({
                    "smiles": r["smiles"],
                    "bestAffinity_kcal_mol": r["bestAffinity_kcal_mol"],
                    "numPoses": r["numPoses"],
                })
            else:
                results.append({"smiles": str(smiles).strip(), "error": out["error"]})
        results.sort(key=lambda e: (e.get("error") is not None, e.get("bestAffinity_kcal_mol", 0)))
        return {
            "ok": True,
            "result": {
                "receptor": str(args.get("receptor", "")).strip(),
                "batch": results,
                "note": "vina 1.2 semi-empirical scoring; docking scores, not binding free energies",
            },
        }

    smiles = str(args.get("smiles", "")).strip()
    receptor = str(args.get("receptor", "")).strip()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "error": f"invalid SMILES: {smiles!r}"}
    if not receptor or not os.path.isfile(receptor):
        return {"ok": False, "error": f"receptor PDB file not found: {receptor!r}"}
    center = args.get("center")
    if not isinstance(center, (list, tuple)) or len(center) != 3:
        return {"ok": False, "error": "center must be [x, y, z] in angstroms"}
    box = args.get("boxSize", [20, 20, 20])
    if not isinstance(box, (list, tuple)) or len(box) != 3:
        return {"ok": False, "error": "boxSize must be [x, y, z] in angstroms"}
    vina_path = (
        str(args.get("vinaPath", "")).strip()
        or os.environ.get("VINA_PATH", "")
        or "C:/Users/cloud/.dsh/chem/bin/vina/vina127.exe"
    )
    if not os.path.isfile(vina_path):
        return {"ok": False, "error": f"vina not found: {vina_path!r} (set VINA_PATH)"}
    exhaustiveness = int(args.get("exhaustiveness", 8))

    try:
        from meeko import MoleculePreparation, PDBQTWriterLegacy
    except ImportError as exc:
        return {"ok": False, "error": f"meeko unavailable: {exc} (pip install meeko gemmi)"}

    # 1) ligand: 3D embed + meeko PDBQT
    try:
        mol_h = Chem.AddHs(mol)
        params = AllChem.ETKDGv3()
        params.randomSeed = 0xF00D
        if AllChem.EmbedMolecule(mol_h, params) != 0:
            return {"ok": False, "error": "ligand 3D embedding failed"}
        prep = MoleculePreparation()
        setups = prep.prepare(mol_h)
        if not setups:
            return {"ok": False, "error": "meeko could not prepare the ligand"}
        ligand_pdbqt, ok, err = PDBQTWriterLegacy.write_string(setups[0])
        if not ok:
            return {"ok": False, "error": f"ligand PDBQT failed: {err}"}
    except Exception as exc:
        return {"ok": False, "error": f"ligand prep failed: {type(exc).__name__}: {exc}"}

    # 2) run vina
    with tempfile.TemporaryDirectory(prefix="dshchem-dock-") as tmp:
        lig_path = os.path.join(tmp, "ligand.pdbqt")
        out_path = os.path.join(tmp, "out.pdbqt")
        with open(lig_path, "w", encoding="utf-8") as handle:
            handle.write(ligand_pdbqt)
        cmd = [
            vina_path,
            "--receptor", receptor,
            "--ligand", lig_path,
            "--center_x", str(center[0]),
            "--center_y", str(center[1]),
            "--center_z", str(center[2]),
            "--size_x", str(box[0]),
            "--size_y", str(box[1]),
            "--size_z", str(box[2]),
            "--exhaustiveness", str(exhaustiveness),
            "--out", out_path,
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=int(args.get("subprocessTimeoutMs", 280000)) // 1000)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "vina docking timed out"}
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip()[-400:]
            return {"ok": False, "error": f"vina failed: {tail}"}
        # Parse the score table from STDOUT. vina 1.2.5 on Windows writes an
        # unreliable number of MODELs to --out (observed 1-9 randomly), while
        # the stdout table always lists every mode.
        poses = []
        in_table = False
        for line in (proc.stdout or "").splitlines():
            stripped = line.strip()
            if stripped.startswith("mode") or stripped.startswith("|"):
                in_table = True
                continue
            if not in_table or not stripped:
                continue
            parts = stripped.split()
            if len(parts) >= 4 and parts[0].isdigit():
                try:
                    poses.append({
                        "mode": int(parts[0]),
                        "affinity_kcal_mol": round(float(parts[1]), 2),
                        "rmsdLb": round(float(parts[2]), 2),
                        "rmsdUb": round(float(parts[3]), 2),
                    })
                except ValueError:
                    continue
        if not poses:
            return {"ok": False, "error": "no poses parsed from vina output"}
        poses.sort(key=lambda p: p["affinity_kcal_mol"])
        result = {
            "smiles": _canonical(mol),
            "receptor": receptor,
            "center": [float(c) for c in center],
            "boxSize": [float(b) for b in box],
            "numPoses": len(poses),
            "bestAffinity_kcal_mol": poses[0]["affinity_kcal_mol"],
            "poses": poses,
            "note": "vina 1.2 semi-empirical scoring; affinities are docking scores, not binding free energies",
        }
        if bool(args.get("poseOut")):
            # MODEL 1 (best pose) coordinates are always present in the out
            # file even though the Windows build writes a variable number of
            # models — extract them as XYZ for the browser complex viewer.
            best_xyz = None
            if os.path.isfile(out_path):
                lines = []
                in_best = False
                with open(out_path, encoding="utf-8", errors="replace") as handle:
                    for line in handle:
                        if line.startswith("MODEL"):
                            in_best = True
                            continue
                        if line.startswith("ENDMDL") and in_best:
                            break
                        if in_best and (line.startswith("ATOM") or line.startswith("HETATM")):
                            element = line[76:78].strip() or line[12:16].strip()[:1]
                            try:
                                x, y, z = float(line[30:38]), float(line[38:46]), float(line[46:54])
                                lines.append(f"{element:2s} {x:10.4f} {y:10.4f} {z:10.4f}")
                            except ValueError:
                                continue
                if lines:
                    best_xyz = f"{len(lines)}\n{_canonical(mol)}\n" + "\n".join(lines)
            if best_xyz is None:
                return {"ok": False, "error": "pose coordinates could not be extracted from vina output"}
            result["bestPoseXyz"] = best_xyz
        return {"ok": True, "result": result}


OPS = {
    "validate": op_validate,
    "props": op_props,
    "convert": op_convert,
    "calc": op_calc,
    "reaction": op_reaction,
    "pdftext": op_pdftext,
    "retro_step": op_retro_step,
    "functional_groups": op_functional_groups,
    "retro_plan": op_retro_plan,
    "reagents": op_reagents,
    "aizynth": op_aizynth,
    "druglikeness": op_druglikeness,
    "similarity": op_similarity,
    "cluster": op_cluster,
    "mcs": op_mcs,
    "enumerate": op_enumerate,
    "admet": op_admet,
    "dock": op_dock,
}


# ── P8: virtual screening pipeline ──────────────────────────────────────────


def op_screen(args):
    """One-shot virtual screening: enumerate -> rule filter -> optional ADMET
    batch filter -> optional similarity ranking -> optional markdown report.

    Reuses the enumerate/druglikeness/admet/similarity machinery so the agent
    can run a complete library-to-hits workflow in one call. ADMET filtering
    is opt-in (`admetFilter: true`) because model load adds seconds; when
    enabled, only rule-passing molecules are predicted (one batch call).
    """
    import contextlib
    import io

    scaffold = str(args.get("scaffold", "")).strip()
    rgroups = args.get("rgroups", {})
    if not scaffold or not isinstance(rgroups, dict) or not rgroups:
        return {"ok": False, "error": "scaffold and rgroups are required"}
    max_products = min(int(args.get("maxProducts", 200)), 500)
    min_qed = float(args.get("minQed", 0.3))
    max_sa = float(args.get("maxSa", 4.0))
    reference = args.get("reference")
    if reference is not None:
        reference = str(reference).strip()
    admet_filter = bool(args.get("admetFilter", False))
    admet_thresholds = args.get("admetThresholds", {}) or {}
    report_path = str(args.get("reportPath", "")).strip()

    enumerated = op_enumerate({
        "scaffold": scaffold,
        "rgroups": rgroups,
        "maxProducts": max_products,
    })
    if enumerated["ok"] is not True:
        return enumerated
    products = enumerated["result"]["products"]

    # 1) rule filter
    passed = []
    failed = []
    for smiles in products:
        dl = op_druglikeness({"smiles": smiles})
        if dl["ok"] is not True:
            failed.append({"smiles": smiles, "reasons": [dl["error"]]})
            continue
        r = dl["result"]
        reasons = []
        if not r["lipinski"]["passes"]:
            reasons.append(f"Lipinski: {', '.join(r['lipinski']['violations'])}")
        if not r["veber"]["passes"]:
            reasons.append(f"Veber: {', '.join(r['veber']['violations'])}")
        if r["qed"] is not None and r["qed"] < min_qed:
            reasons.append(f"QED {r['qed']} < {min_qed}")
        if r["saScore"] is not None and r["saScore"] > max_sa:
            reasons.append(f"SA {r['saScore']} > {max_sa}")
        if reasons:
            failed.append({"smiles": smiles, "reasons": reasons})
            continue
        passed.append({
            "smiles": smiles,
            "qed": r["qed"],
            "saScore": r["saScore"],
            "verdict": r["verdict"],
        })

    # 2) optional ADMET batch filter (only on rule-passing molecules)
    admet_results = {}
    if admet_filter and passed:
        try:
            from admet_ai import ADMETModel

            model = ADMETModel()
            with contextlib.redirect_stdout(io.StringIO()):
                batch = model.predict([p["smiles"] for p in passed])
        except Exception as exc:
            return {"ok": False, "error": f"admet batch failed: {type(exc).__name__}: {exc}"}
        for smiles, row in zip([p["smiles"] for p in passed], batch):
            if isinstance(row, dict):
                admet_results[smiles] = {k: (round(float(v), 4) if isinstance(v, float) else v) for k, v in row.items()}
            else:
                admet_results[smiles] = {}
        kept = []
        rejected = []
        for entry in passed:
            eps = admet_results.get(entry["smiles"], {})
            reasons = []
            for key, limit in admet_thresholds.items():
                value = eps.get(key)
                if isinstance(value, (int, float)) and isinstance(limit, (int, float)) and value > limit:
                    reasons.append(f"{key}={value} > {limit}")
            if reasons:
                entry["admetReject"] = reasons
                rejected.append(entry)
            else:
                entry["admet"] = eps
                kept.append(entry)
        passed = kept
        failed.extend({"smiles": e["smiles"], "reasons": e["admetReject"]} for e in rejected)

    # 3) optional similarity ranking vs a reference molecule
    if reference is not None and passed:
        sim = op_similarity({"smiles": reference, "targets": [p["smiles"] for p in passed]})
        if sim["ok"] is True:
            scores = {r["target"]: r["tanimoto"] for r in sim["result"]["results"]}
            for entry in passed:
                entry["tanimoto"] = scores.get(entry["smiles"])
            passed.sort(key=lambda e: -(e.get("tanimoto") or 0))

    # 4) optional markdown report
    written = False
    if report_path:
        try:
            lines = [
                "# dshchem 虚拟筛选报告",
                "",
                f"- 骨架：`{scaffold}`",
                f"- 组合数：{enumerated['result']['combinations']} / 生成：{enumerated['result']['generated']}",
                f"- 规则过滤后：{len(passed)} 命中（淘汰 {len(failed)}）",
                f"- ADMET 过滤：{'开启' if admet_filter else '关闭'} | 相似性参考：{reference or '-'}",
                "",
                "## 命中列表",
                "",
                "| # | SMILES | QED | SA | Tanimoto | verdict |",
                "|---|--------|-----|-----|----------|---------|",
            ]
            for i, entry in enumerate(passed, start=1):
                lines.append(
                    f"| {i} | `{entry['smiles']}` | {entry.get('qed', '-')} | "
                    f"{entry.get('saScore', '-')} | {entry.get('tanimoto', '-')} | {entry.get('verdict', '-')} |"
                )
            lines.append("")
            lines.append("> 本报告由 chem_screen 自动生成；ADMET 值为模型预测，关键端点需实验核验。")
            with open(report_path, "w", encoding="utf-8") as handle:
                handle.write("\n".join(lines))
            written = True
        except Exception as exc:
            return {"ok": False, "error": f"report write failed: {type(exc).__name__}: {exc}"}

    return {
        "ok": True,
        "result": {
            "scaffold": scaffold,
            "combinations": enumerated["result"]["combinations"],
            "generated": enumerated["result"]["generated"],
            "totalFailed": len(failed),
            "hits": passed,
            "failed": failed,
            "admetFiltered": admet_filter,
            "reportPath": report_path if written else None,
        },
    }


OPS = {
    "validate": op_validate,
    "props": op_props,
    "convert": op_convert,
    "calc": op_calc,
    "reaction": op_reaction,
    "pdftext": op_pdftext,
    "retro_step": op_retro_step,
    "functional_groups": op_functional_groups,
    "retro_plan": op_retro_plan,
    "reagents": op_reagents,
    "aizynth": op_aizynth,
    "druglikeness": op_druglikeness,
    "similarity": op_similarity,
    "cluster": op_cluster,
    "mcs": op_mcs,
    "enumerate": op_enumerate,
    "admet": op_admet,
    "dock": op_dock,
    "screen": op_screen,
}


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"ok": False, "error": "empty request"}), flush=True)
            return 1
        request = json.loads(raw)
        op = request.get("op")
        args = request.get("args") or {}
        handler = OPS.get(op)
        if handler is None:
            print(json.dumps({"ok": False, "error": f"unknown op {op!r}; ops: {sorted(OPS)}"}), flush=True)
            return 1
        response = handler(args)
    except Exception as exc:
        response = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(response, ensure_ascii=False), flush=True)
    # Contract: a structured response (ok or error) is a RESPONSE, never a
    # process failure. Exit 0 always after printing; the caller reads the JSON.
    return 0


if __name__ == "__main__":
    sys.exit(main())
