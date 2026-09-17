# -*- coding: utf-8 -*-
"""Prepare 3D geometry (ETKDG embed + MMFF94 optimize) for CAS 1877286-69-5
and write XYZ for PySCF TD-DFT. Also prints formula / heavy atom counts.
"""
import sys
from rdkit import Chem
from rdkit.Chem import AllChem, rdMolDescriptors

SMILES = "CC1=CN=C(N=C1NC2=CC(=CC=C2)NS(=O)(=O)C(C)(C)C)NC3=CC(=C(C=C3)N4CCN(CC4)C)F"

mol = Chem.MolFromSmiles(SMILES)
assert mol is not None, "SMILES parse failed"
mol = Chem.AddHs(mol)

# embed several conformers, pick lowest MMFF energy
params = AllChem.ETKDGv3()
params.randomSeed = 0xC0FFEE
cids = AllChem.EmbedMultipleConfs(mol, numConfs=40, params=params)
print(f"embedded {len(cids)} conformers", file=sys.stderr)

energies = []
for cid in cids:
    ff = AllChem.MMFFGetMoleculeForceField(
        mol, AllChem.MMFFGetMoleculeProperties(mol), confId=cid)
    if ff is None:
        continue
    ff.Minimize(maxIts=2000)
    energies.append((ff.CalcEnergy(), cid))
energies.sort()
best_e, best_cid = energies[0]
print(f"best MMFF energy: {best_e:.2f} kcal/mol (conf {best_cid})", file=sys.stderr)

conf = mol.GetConformer(best_cid)
n_atoms = mol.GetNumAtoms()
lines = [str(n_atoms), "CAS 1877286-69-5 (BRD4-Kinases-IN-3), MMFF-optimized geometry"]
pt = Chem.GetPeriodicTable()
for atom in mol.GetAtoms():
    idx = atom.GetIdx()
    pos = conf.GetAtomPosition(idx)
    lines.append(f"{pt.GetElementSymbol(atom.GetAtomicNum()):2s} {pos.x: .6f} {pos.y: .6f} {pos.z: .6f}")

xyz = "\n".join(lines) + "\n"
with open("geom_opt.xyz", "w") as f:
    f.write(xyz)

formula = rdMolDescriptors.CalcMolFormula(Chem.RemoveHs(mol))
print(f"formula: {formula}, atoms (with H): {n_atoms}", file=sys.stderr)
print("wrote geom_opt.xyz", file=sys.stderr)
