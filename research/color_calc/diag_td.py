# -*- coding: utf-8 -*-
"""Diagnostic: check SCF and TDDFT convergence with verbose output."""
import numpy as np
from pyscf import gto, dft, tdscf, lib
lib.num_threads(24)

with open("geom_opt.xyz") as f:
    lines = f.readlines()
natom = int(lines[0].strip())
coords, atoms = [], []
for ln in lines[2:2 + natom]:
    p = ln.split()
    atoms.append(p[0])
    coords.append([float(x) for x in p[1:4]])
coords = np.array(coords)

mol = gto.M(atom=list(zip(atoms, coords)), basis="6-31g*", verbose=4, spin=0)
mf = dft.RKS(mol)
mf.xc = "b3lyp"
mf.max_cycle = 200
mf.conv_tol = 1e-8
e = mf.kernel()
print(f"SCF converged: {mf.converged}, E = {e:.8f} Hartree")
print(f"nelec = {mol.nelec}, nao = {mol.nao}, nmo = {mf.mo_energy.size}")
homo, lumo = mf.mo_energy[mol.nelec[0]-1], mf.mo_energy[mol.nelec[0]]
print(f"HOMO = {homo:.4f} Ha, LUMO = {lumo:.4f} Ha, gap = {(lumo-homo)*27.2114:.3f} eV")

# try TDA with 20 states, verbose on
td = tdscf.TDA(mf)
td.verbose = 4
td.nstates = 20
td.max_cycle = 200
td.conv_tol = 1e-6
td.kernel()
print(f"TDA converged: {td.converged}")
if td.converged:
    ev = np.asarray(td.e) * 27.2114
    osc = np.asarray(td.oscillator_strength())
    for i in range(len(ev)):
        print(f"  S{i+1:2d}  {ev[i]:7.3f} eV  {1239.84193/ev[i]:8.1f} nm  f={osc[i]:.4f}")
