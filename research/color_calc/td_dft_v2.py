# -*- coding: utf-8 -*-
"""UV-Vis via TDA (robust), 20 states, B3LYP + CAM-B3LYP.
Includes aniline calibration and dominant-transition analysis for S1-S3.
"""
import json, time
import numpy as np
from pyscf import gto, dft, tdscf, lib

lib.num_threads(24)
t0 = time.time()

def load_xyz(path):
    with open(path) as f:
        lines = f.readlines()
    natom = int(lines[0].strip())
    atoms, coords = [], []
    for ln in lines[2:2 + natom]:
        p = ln.split()
        atoms.append(p[0])
        coords.append([float(x) for x in p[1:4]])
    return atoms, np.array(coords)

atoms, coords = load_xyz("geom_opt.xyz")
mol = gto.M(atom=list(zip(atoms, coords)), basis="6-31g*", verbose=2, spin=0)

results = {}

def run(mol, xc, label, nstates=20):
    mf = dft.RKS(mol)
    mf.xc = xc
    mf.max_cycle = 200
    mf.conv_tol = 1e-9
    e = mf.kernel()
    print(f"[{label}] SCF {e:.8f} Ha, converged={mf.converged} ({time.time()-t0:.0f}s)", flush=True)
    td = tdscf.TDA(mf)
    td.nstates = nstates
    td.max_cycle = 300
    td.conv_tol = 1e-6
    td.verbose = 2
    td.kernel()
    conv = np.all(td.converged) if hasattr(td.converged, "__len__") else td.converged
    print(f"[{label}] TDA done, converged={conv} ({time.time()-t0:.0f}s)", flush=True)
    ev = np.asarray(td.e) * 27.2114
    nm = 1239.84193 / ev
    osc = np.asarray(td.oscillator_strength())
    states = [{"n": i+1, "eV": float(ev[i]), "nm": float(nm[i]), "f": float(osc[i])}
              for i in range(len(ev))]
    # dominant configurations for first 3 states
    dom = []
    nocc = mol.nelec[0]
    for i in range(min(3, len(td.xy))):
        xy = td.xy[i][0]  # X matrix
        idx = np.argsort(-np.abs(xy).ravel())[:3]
        pairs = []
        for k in idx:
            o, v = divmod(k, xy.shape[1])
            pairs.append({"homo_offset": o - nocc + 1, "lumo_offset": v + 1,
                          "coef": float(xy.ravel()[k])})
        dom.append({"state": i+1, "top": pairs})
    results[label] = {"scf_e": float(e), "states": states, "dominant": dom,
                      "converged": bool(conv)}
    print(f"[{label}] S1: {nm[0]:.1f} nm, f={osc[0]:.4f}", flush=True)

run(mol, "b3lyp", "B3LYP-TDA")
run(mol, "cam-b3lyp", "CAM-B3LYP-TDA")

# ---------------- aniline calibration (quick) ----------------
aniline = gto.M(atom="N 0.0 0.0 1.35; C 1.214 0.0 0.64; C 1.214 0.0 -0.77; C 0.0 0.0 -1.47; C -1.214 0.0 -0.77; C -1.214 0.0 0.64; H -2.141 0.0 1.23; H 2.141 0.0 1.23; H 2.141 0.0 -1.33; H 0.0 0.0 -2.55; H -2.141 0.0 -1.33; H 0.0 1.02 1.74; H 0.0 -1.02 1.74",
                basis="6-31g*", verbose=0, spin=0)
for xc, lab in (("b3lyp", "B3LYP"), ("cam-b3lyp", "CAM-B3LYP")):
    mf = dft.RKS(aniline)
    mf.xc = xc
    mf.kernel()
    td = tdscf.TDA(mf)
    td.nstates = 5
    td.kernel()
    ev = np.asarray(td.e) * 27.2114
    nm = 1239.84193 / ev
    osc = np.asarray(td.oscillator_strength())
    j = int(np.argmax(osc))
    print(f"[calib aniline {lab}] S1 {nm[0]:.1f} nm f={osc[0]:.3f} | strongest S{j+1} {nm[j]:.1f} nm f={osc[j]:.3f} (exp: ~280 nm, strongest ~285 nm)", flush=True)

results["meta"] = {"basis": "6-31G*", "geometry": "MMFF94 (RDKit)", "method": "TDA",
                  "aniline_exp_note": "aniline exp lambda_max ~280 nm"}
with open("td_results2.json", "w") as f:
    json.dump(results, f, indent=1)
print(f"ALL DONE {time.time()-t0:.0f}s", flush=True)
