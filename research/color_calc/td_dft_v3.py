# -*- coding: utf-8 -*-
"""v3: full TDA spectra with robust convergence + fixed JSON + aniline calibration
(HF-optimized geometry, same robust TDA settings)."""
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
mol = gto.M(atom=list(zip(atoms, coords)), basis="6-31g*", verbose=0, spin=0)
results = {"meta": {"basis": "6-31G*", "geometry": "MMFF94 (RDKit ETKDGv3)",
                    "method": "TDA, gas phase"}}

def run_tda(mol, xc, label, nstates=20):
    mf = dft.RKS(mol)
    mf.xc = xc
    mf.max_cycle = 200
    mf.conv_tol = 1e-9
    e = mf.kernel()
    td = tdscf.TDA(mf)
    td.nstates = nstates
    td.max_cycle = 300
    td.conv_tol = 1e-6
    td.kernel()
    conv = bool(np.all(td.converged))
    ev = np.asarray(td.e) * 27.2114
    nm = 1239.84193 / ev
    osc = np.asarray(td.oscillator_strength())
    gap = (mf.mo_energy[mol.nelec[0]] - mf.mo_energy[mol.nelec[0]-1]) * 27.2114
    states = [{"n": int(i+1), "eV": float(ev[i]), "nm": float(nm[i]), "f": float(osc[i])}
              for i in range(len(ev))]
    dom = []
    nocc = mol.nelec[0]
    for i in range(min(3, len(td.xy))):
        xy = td.xy[i][0]
        idx = np.argsort(-np.abs(xy).ravel())[:4]
        pairs = []
        for k in idx:
            o, v = divmod(int(k), xy.shape[1])
            pairs.append({"homo_offset": int(o - nocc + 1), "lumo_offset": int(v + 1),
                          "coef": float(xy.ravel()[k])})
        dom.append({"state": int(i+1), "top": pairs})
    results[label] = {"scf_e": float(e), "gap_eV": float(gap),
                      "converged": conv, "states": states, "dominant": dom}
    print(f"[{label}] E={e:.8f} gap={gap:.3f} eV conv={conv} ({time.time()-t0:.0f}s)", flush=True)
    for s in states:
        print(f"  S{s['n']:2d} {s['nm']:7.1f} nm {s['eV']:6.3f} eV f={s['f']:.4f}", flush=True)
    return states

run_tda(mol, "b3lyp", "B3LYP-TDA")
run_tda(mol, "cam-b3lyp", "CAM-B3LYP-TDA")

# ---------- aniline calibration (HF-opt geometry, robust TDA) ----------
an = gto.M(atom="N 0.0 0.0 1.35; C 1.214 0.0 0.64; C 1.214 0.0 -0.77; C 0.0 0.0 -1.47; C -1.214 0.0 -0.77; C -1.214 0.0 0.64; H -2.141 0.0 1.23; H 2.141 0.0 1.23; H 2.141 0.0 -1.33; H 0.0 0.0 -2.55; H -2.141 0.0 -1.33; H 0.0 1.02 1.74; H 0.0 -1.02 1.74",
           basis="6-31g*", verbose=0, spin=0)
mfh = dft.RKS(an)
mfh.xc = "hf"
mfh.kernel()
mol_eq = mfh.eq_atom.coords if False else None
# geometry optimization at HF/6-31G*
from pyscf.geomopt.berny_solver import optimize
an_opt = optimize(mfh, maxsteps=50)
calib = {}
for xc, lab in (("b3lyp", "B3LYP"), ("cam-b3lyp", "CAM-B3LYP")):
    mf = dft.RKS(an_opt)
    mf.xc = xc
    mf.max_cycle = 100
    mf.conv_tol = 1e-9
    mf.kernel()
    td = tdscf.TDA(mf)
    td.nstates = 6
    td.max_cycle = 300
    td.conv_tol = 1e-6
    td.kernel()
    conv = bool(np.all(td.converged))
    ev = np.asarray(td.e) * 27.2114
    nm = 1239.84193 / ev
    osc = np.asarray(td.oscillator_strength())
    j = int(np.argmax(osc))
    print(f"[calib aniline {lab}] conv={conv} S1={nm[0]:.1f}nm f={osc[0]:.3f} | "
          f"strongest S{j+1}={nm[j]:.1f}nm f={osc[j]:.3f} (exp ~280 nm)", flush=True)
    calib[lab] = {"S1_nm": float(nm[0]), "strongest_nm": float(nm[j]),
                  "strongest_f": float(osc[j]), "converged": conv}
results["calib_aniline"] = calib

with open("td_results3.json", "w") as f:
    json.dump(results, f, indent=1)
print(f"ALL DONE {time.time()-t0:.0f}s", flush=True)
