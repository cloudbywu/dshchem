# -*- coding: utf-8 -*-
"""TD-DFT UV-Vis spectrum of CAS 1877286-69-5 (BRD4-Kinases-IN-3).
Gas-phase, 6-31G* basis, 24 threads.
B3LYP: full TDDFT; CAM-B3LYP: TDA (robust for charge-transfer states).
"""
import json, sys, time
import numpy as np
from pyscf import gto, dft, tdscf, lib

lib.num_threads(24)

t0 = time.time()

# ---------- read geometry ----------
with open("geom_opt.xyz") as f:
    lines = f.readlines()
natom = int(lines[0].strip())
coords, atoms = [], []
for ln in lines[2:2 + natom]:
    p = ln.split()
    atoms.append(p[0])
    coords.append([float(x) for x in p[1:4]])
coords = np.array(coords)

mol = gto.M(atom=list(zip(atoms, coords)), basis="6-31g*", verbose=0, spin=0)

results = {"compound": "BRD4-Kinases-IN-3", "cas": "1877286-69-5",
           "basis": "6-31G*", "geometry": "RDKit ETKDGv3 + MMFF94 opt"}

def run_td(mf, nstates=40, label="", tda=False):
    mf.max_cycle = 200
    mf.conv_tol = 1e-8
    e_scf = mf.kernel()
    print(f"[{label}] SCF done: {e_scf:.6f} Hartree ({time.time()-t0:.0f}s)", flush=True)
    td = tdscf.TDA(mf) if tda else tdscf.TDDFT(mf)
    td.nstates = nstates
    td.kernel()
    print(f"[{label}] TD done ({time.time()-t0:.0f}s)", flush=True)
    evals = np.asarray(td.e)
    osc = np.asarray(td.oscillator_strength())
    nm = 1239.84193 / evals  # eV -> nm
    gap = mf.mo_energy[mol.nelec[0]] - mf.mo_energy[mol.nelec[0]-1]  # LUMO - HOMO (au)
    states = []
    for i in range(len(evals)):
        states.append({"n": i+1, "eV": float(evals[i]), "nm": float(nm[i]),
                       "f": float(osc[i])})
    return {"label": label, "scf_e_hartree": float(e_scf),
            "homo_lumo_gap_ev": float(gap*27.2114), "states": states}

# ---------- B3LYP TDDFT ----------
mf1 = dft.RKS(mol)
mf1.xc = "b3lyp"
r1 = run_td(mf1, 40, "B3LYP-TDDFT", tda=False)
results["B3LYP"] = r1

# ---------- CAM-B3LYP TDA ----------
mf2 = dft.RKS(mol)
mf2.xc = "cam-b3lyp"
r2 = run_td(mf2, 40, "CAM-B3LYP-TDA", tda=True)
results["CAM-B3LYP"] = r2

with open("td_results.json", "w") as f:
    json.dump(results, f, indent=1)

# ---------- summary ----------
def summary(r):
    evals = np.array([s["eV"] for s in r["states"]])
    fs = np.array([s["f"] for s in r["states"]])
    nm = np.array([s["nm"] for s in r["states"]])
    strong = [(s["n"], s["nm"], s["f"]) for s in r["states"] if s["f"] > 0.05]
    print(f"\n===== {r['label']} =====", flush=True)
    print(f"HOMO-LUMO gap: {r['homo_lumo_gap_ev']:.2f} eV", flush=True)
    print("all states (n, nm, f):")
    for s in r["states"]:
        print(f"  {s['n']:2d}  {s['nm']:8.1f} nm  {s['eV']:6.3f} eV  f={s['f']:.4f}", flush=True)
    if strong:
        print("strongest transitions (f>0.05):")
        for n, w, f in sorted(strong, key=lambda x: -x[2])[:8]:
            print(f"  S{n}  {w:.1f} nm  f={f:.3f}", flush=True)
    else:
        print("no transition with f>0.05", flush=True)
    return strong

for k in ("B3LYP", "CAM-B3LYP"):
    summary(results[k])

print(f"\ntotal wall time {time.time()-t0:.0f}s", flush=True)
