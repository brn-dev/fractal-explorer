"""Independent mpmath fixtures, generated at 80 and 120 digits.

Run from repository root: .venv/Scripts/python.exe web/tests/generate-families-oracle.py
"""
import json
from pathlib import Path
import mpmath as mp

BASE = dict(x='0', y='0', span='3.6', iterations=800, bailout=64, julia_x='-.7269', julia_y='.1889')
VIEWS = [
    dict(fractal='multibrot', power=5), dict(fractal='multibrot', power=8),
    dict(fractal='multijulia', power=4, julia_x='-.55', julia_y='.45'),
    dict(fractal='multijulia', power=7, julia_x='-.3', julia_y='.1'),
    dict(fractal='phoenix', memory=-.5, julia_x='.5667', julia_y='0'),
    dict(fractal='phoenix', memory=.22, julia_x='-.5', julia_y='.2'),
    dict(fractal='ship-julia', julia_x='-1.76', julia_y='-.03'),
    dict(fractal='ship-julia', julia_x='-.72', julia_y='-.2'),
    dict(fractal='newton', power=3, relaxation=1, julia_x='1', julia_y='0', span='5'),
    dict(fractal='newton', power=5, relaxation=.75, julia_x='.7', julia_y='.4', span='5'),
]
POINTS = [[x,y] for y in [0,3,7,11,16,21,23] for x in [0,4,9,15,20,26,31]]

def calculate(v, col, row):
    z = mp.mpc(v['x'], v['y']) + mp.mpc(mp.mpf(2*col+1-32)/64, mp.mpf(24-2*row-1)/64)*mp.mpf(v['span'])
    kind = v['fractal']
    c = mp.mpc(v['julia_x'], v['julia_y'])
    d = v.get('power', 2)
    if kind == 'multibrot': c,z = z,mp.mpc(0)
    prev = mp.mpc(0)
    if kind == 'newton':
        for n in range(v['iterations']+1):
            if abs(z)**2 > mp.mpf('1e8'): return -1
            f = z**d-c
            if abs(f)**2 < mp.mpf('1e-12'):
                index = int(mp.nint((mp.arg(z)-mp.arg(c)/d)*d/(2*mp.pi))) % d
                return float(mp.expm1(5*(mp.mpf(index)/d+mp.mpf(min(n,50))*.004)))
            derivative = d*z**(d-1)
            if abs(derivative)**2 < mp.mpf('1e-24'): return -1
            z -= mp.mpf(str(v['relaxation']))*f/derivative
        return -1
    for n in range(1, v['iterations']+1):
        old = z
        if kind == 'ship-julia': z = mp.mpc(abs(z.real),abs(z.imag))
        z = z**d+c
        if kind == 'phoenix': z += mp.mpf(str(v['memory']))*prev
        prev = old
        if abs(z) > v['bailout']: return max(0, float(n+1-mp.log(mp.log(abs(z)))/mp.log(d)))
    return -1

cases=[]
for i, extra in enumerate(VIEWS):
    v=BASE | extra
    results=[]
    for digits in [80,120]:
        with mp.workdps(digits): results.append([calculate(v,*p) for p in POINTS])
    assert max(abs(a-b) for a,b in zip(*results)) < 1e-10, extra
    cases.append(dict(name=f"{v['fractal']}-{i}", view=v, width=32, height=24, points=POINTS, expected=results[-1]))
Path(__file__).with_name('families-oracle.json').write_text(json.dumps(dict(precision_digits=[80,120],cases=cases), indent=2)+'\n')
