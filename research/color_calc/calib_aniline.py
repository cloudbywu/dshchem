# -*- coding: utf-8 -*-
"""Aniline calibration with robust TDA settings (no geometry optimizer needed)."""
import numpy as np
from pyscf import gto, dft, tdscf, lib
lib.num_threads(24)

an = gto.M(atom="N 0.0 0.0 1.35; C 1.214 0.0 0.64; C 1.214 0.0 -0.77; C 0.0 0.0 -1.47; C -1.214 0.0 -0.77; C -1.214 0.0 0.64; H -2.141 0.0 1.23; H 2.141 0.0 1.23; H 2.141 0.0 -1.33; H 0.0 0.0 -2.55; H -2.141 0.0 -1.33; H 0.0 1.02 1.74; H 0.0 -1.02 1.74",
           basis="6-31g*", verbose=0, spin=0)

for xc, lab in (("b3lyp", "B3LYP-TDA"), ("cam-b3lyp", "CAM-B3LYP-TDA")):
    mf = dft.RKS(an)
    mf.xc = xc
    mf.max_cycle = 100
    mf.conv_tol = 1e-9
    mf.kernel()
    td = tdscf.TDA(mf)
    td.nstates = 8
    td.max_cycle = 300
    td.conv_tol = 1e-6
    td.kernel()
    conv = bool(np.all(td.converged))
    ev = np.asarray(td.e) * 27.2114
    nm = 1239.84193 / ev
    osc = np.asarray(td.oscillator_strength())
    j = int(np.argmax(osc))
    print(f"[calib aniline {lab}] conv={conv}")
    for i in range(len(ev)):
        print(f"  S{i+1} {nm[i]:6.1f} nm {ev[i]:6.3f} eV f={osc[i]:.4f}")
    print(f"  -> strongest S{j+1} = {nm[j]:.1f} nm (exp ~280 nm)")
