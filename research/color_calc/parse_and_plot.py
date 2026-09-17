# -*- coding: utf-8 -*-
"""Parse td_dft_v3.log line-by-line into td_results3.json and plot UV-Vis."""
import json, re
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

results = {"meta": {"basis": "6-31G*", "geometry": "MMFF94 (RDKit ETKDGv3)",
                    "method": "TDA, gas phase, converged, PySCF 2.14"}}
current = None
with open("td_dft_v3.log", encoding="utf-8", errors="replace") as f:
    for line in f:
        line = line.rstrip("\n")
        m = re.match(r"\[(B3LYP-TDA|CAM-B3LYP-TDA)\] E=([-\d.]+) gap=([\d.]+) eV conv=(True|False)", line)
        if m:
            current = m.group(1)
            results[current] = {"scf_e": float(m.group(2)), "gap_eV": float(m.group(3)),
                                "converged": m.group(4) == "True", "states": []}
            continue
        if current and re.match(r"\s*S\s*\d+\s", line):
            mm = re.match(r"\s*S\s*(\d+)\s+([\d.]+) nm\s+([\d.]+) eV f=([\d.]+)", line)
            if mm:
                results[current]["states"].append(
                    {"n": int(mm.group(1)), "nm": float(mm.group(2)),
                     "eV": float(mm.group(3)), "f": float(mm.group(4))})

for k in ("B3LYP-TDA", "CAM-B3LYP-TDA"):
    n = len(results[k]["states"])
    s1 = results[k]["states"][0]
    print(f"{k}: {n} states, S1={s1['nm']:.1f} nm f={s1['f']:.4f}, conv={results[k]['converged']}")

with open("td_results3.json", "w") as f:
    json.dump(results, f, indent=1)

# ---- plot ----
fig, axes = plt.subplots(2, 1, figsize=(9, 8), sharex=True)
cols = {"B3LYP-TDA": "#1f77b4", "CAM-B3LYP-TDA": "#d62728"}
for ax, (label, res) in zip(axes, results.items()):
    if label == "meta":
        continue
    nm = np.array([s["nm"] for s in res["states"]])
    f = np.array([s["f"] for s in res["states"]])
    ax.vlines(nm, 0, f, color=cols[label], lw=1.1, label=f"{label} states")
    x = np.linspace(180, 800, 2000)
    y = np.zeros_like(x)
    for w, fi in zip(nm, f):
        if fi < 1e-4:
            continue
        sigma = 0.25 * 1239.84193 / w ** 2
        y += fi * np.exp(-0.5 * ((x - w) / sigma) ** 2)
    ax.plot(x, y, color=cols[label], lw=2, label=f"{label} broadened (σ=0.25 eV)")
    ax.axvspan(380, 780, color="gray", alpha=0.18, label="visible 380–780 nm")
    ax.axvline(400, color="k", ls=":", lw=1)
    ax.set_ylabel("oscillator strength")
    ax.legend(loc="upper right", fontsize=9)
    ax.set_title(f"{label}: computed UV-Vis (gas phase, TDA/6-31G*)", fontsize=11)
    ax.grid(alpha=0.3)
    ax.set_xlim(180, 800)
axes[-1].set_xlabel("wavelength (nm)")
plt.tight_layout()
plt.savefig("uvvis_spectrum.png", dpi=150)
print("saved uvvis_spectrum.png")
