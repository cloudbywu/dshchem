# -*- coding: utf-8 -*-
"""Plot UV-Vis stick + Gaussian-broadened spectrum from td_results.json."""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

with open("td_results.json") as f:
    data = json.load(f)

fig, axes = plt.subplots(2, 1, figsize=(9, 8), sharex=True)
colors = {"B3LYP": "#1f77b4", "CAM-B3LYP": "#d62728"}
for ax, (label, res) in zip(axes, data.items()):
    if label in ("compound", "cas", "basis", "geometry"):
        continue
    nm = np.array([s["nm"] for s in res["states"]])
    f = np.array([s["f"] for s in res["states"]])
    ax.vlines(nm, 0, f, color=colors[label], lw=1.2, label=f"{label} stick")
    # Gaussian broadening, sigma=0.25 eV
    x = np.linspace(180, 800, 2000)
    y = np.zeros_like(x)
    for w, fi in zip(nm, f):
        if fi < 1e-4:
            continue
        sigma = 0.25 * 1239.84193 / w ** 2  # eV width -> nm width
        y += fi * np.exp(-0.5 * ((x - w) / sigma) ** 2)
    ax.plot(x, y, color=colors[label], lw=2, label=f"{label} (σ=0.25 eV)")
    ax.axvspan(380, 780, color="gray", alpha=0.15, label="visible 380–780 nm")
    ax.set_ylabel("oscillator strength")
    ax.legend(loc="upper right", fontsize=9)
    ax.set_title(f"{label}: UV-Vis spectrum (gas phase, 6-31G*)", fontsize=11)
    ax.grid(alpha=0.3)
axes[-1].set_xlabel("wavelength (nm)")
axes[-1].set_xlim(180, 800)
plt.tight_layout()
plt.savefig("uvvis_spectrum.png", dpi=150)
print("saved uvvis_spectrum.png")
